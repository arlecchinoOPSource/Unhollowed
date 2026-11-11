//! The host owns close and quit (docs/HOST-CONTRACT-U35.md). A close request asks each active
//! module to save through its own close event; the host waits for each module's flush report
//! (or a timeout), lets any close sound finish, then exits once.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager, State};
use unhlw_host_contract::{FLUSH_EVENT, Flushed, MAX_LINGER_MS};

use crate::modules;

/// How long the host waits for modules to report that they have saved.
pub const MAX_WAIT_MS: u64 = 8000;

#[derive(Default)]
pub struct Lifecycle {
    active: Mutex<HashSet<String>>,
    /// module -> requested linger (ms), recorded when its flush report arrives.
    flushed: Mutex<HashMap<String, u64>>,
    closing: AtomicBool,
}

/// True when every active module has reported.
pub fn all_flushed(active: &HashSet<String>, flushed: &HashMap<String, u64>) -> bool {
    active.iter().all(|module| flushed.contains_key(module))
}

/// The longest linger asked for by an active module, capped.
pub fn linger_ms(active: &HashSet<String>, flushed: &HashMap<String, u64>) -> u64 {
    active
        .iter()
        .filter_map(|module| flushed.get(module))
        .copied()
        .max()
        .unwrap_or(0)
        .min(MAX_LINGER_MS)
}

/// Polls `probe` until it reports a value or `max` has passed. Returns the value (if any) and the time waited.
pub fn wait_for(
    mut probe: impl FnMut() -> Option<u64>,
    max: Duration,
    poll: Duration,
) -> (Option<u64>, u64) {
    let started = Instant::now();
    loop {
        if let Some(value) = probe() {
            return (Some(value), started.elapsed().as_millis() as u64);
        }
        if started.elapsed() >= max {
            return (None, started.elapsed().as_millis() as u64);
        }
        std::thread::sleep(poll);
    }
}

/// What a per-module power-off found out.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PowerOff {
    /// The module confirmed that it saved. When false it is still running and nothing was removed.
    pub flushed: bool,
    pub waited_ms: u64,
    /// How long its close sound should be left to play before the frame is removed (capped).
    pub linger_ms: u64,
}

/// Asks one module to save and waits for its confirmation. It never removes the module: the page removes the
/// frame only after `flushed` is true, so a module that did not answer keeps its unsaved work.
#[tauri::command]
pub async fn host_power_off(app: AppHandle, module: String) -> Result<PowerOff, String> {
    let info = modules::find(&module).ok_or("Unknown module.")?;
    {
        let state = app.state::<Lifecycle>();
        if !state
            .active
            .lock()
            .map_err(|_| "Lifecycle unavailable.")?
            .contains(&module)
        {
            return Err("That module is not on.".into());
        }
        if state.closing.load(Ordering::SeqCst) {
            return Err("The app is closing.".into());
        }
        // A report left over from before must not count as this module's answer.
        state
            .flushed
            .lock()
            .map_err(|_| "Lifecycle unavailable.")?
            .remove(&module);
    }
    app.emit_to("main", info.close_event, ())
        .map_err(|error| error.to_string())?;
    let handle = app.clone();
    let name = module.clone();
    let (answer, waited_ms) = tauri::async_runtime::spawn_blocking(move || {
        wait_for(
            || {
                let state = handle.state::<Lifecycle>();
                state.flushed.lock().ok()?.get(&name).copied()
            },
            Duration::from_millis(MAX_WAIT_MS),
            Duration::from_millis(25),
        )
    })
    .await
    .map_err(|error| error.to_string())?;
    // Whatever happened, drop the report: a late one must not satisfy a later close.
    if let Ok(mut flushed) = app.state::<Lifecycle>().flushed.lock() {
        flushed.remove(&module);
    }
    Ok(PowerOff {
        flushed: answer.is_some(),
        waited_ms,
        linger_ms: answer.unwrap_or(0).min(MAX_LINGER_MS),
    })
}

/// Things the person should be told about their data (e.g. a verified copy made before an upgrade).
#[tauri::command]
pub fn host_data_notices() -> Vec<unhlw_data_safety::Notice> {
    unhlw_data_safety::notices()
}

#[tauri::command]
pub fn host_module_activated(state: State<'_, Lifecycle>, module: String) -> Result<(), String> {
    modules::find(&module).ok_or("Unknown module.")?;
    // A fresh frame starts with no report: one left from an earlier run must not count as its answer.
    state
        .flushed
        .lock()
        .map_err(|_| "Lifecycle unavailable.")?
        .remove(&module);
    state
        .active
        .lock()
        .map_err(|_| "Lifecycle unavailable.")?
        .insert(module);
    Ok(())
}

#[tauri::command]
pub fn host_module_deactivated(state: State<'_, Lifecycle>, module: String) -> Result<(), String> {
    state
        .active
        .lock()
        .map_err(|_| "Lifecycle unavailable.")?
        .remove(&module);
    Ok(())
}

/// Records flush reports sent by module plugins.
pub fn listen_for_flush(app: &AppHandle) {
    let handle = app.clone();
    app.listen(FLUSH_EVENT, move |event| {
        if let Ok(report) = serde_json::from_str::<Flushed>(event.payload()) {
            let state = handle.state::<Lifecycle>();
            if let Ok(mut flushed) = state.flushed.lock() {
                flushed.insert(report.module, report.linger_ms);
            }
        }
    });
}

/// Starts the close sequence once; later requests while closing are ignored.
pub fn begin_close(app: &AppHandle) {
    let state = app.state::<Lifecycle>();
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let active = state.active.lock().map(|a| a.clone()).unwrap_or_default();
    // Only reports sent in answer to this request count.
    if let Ok(mut flushed) = state.flushed.lock() {
        flushed.clear();
    }
    for name in &active {
        if let Some(module) = modules::find(name) {
            let _ = app.emit_to("main", module.close_event, ());
        }
    }
    let app = app.clone();
    // Not on the main thread: the wait would stall the run loop (as in the standalone apps).
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut timed_out = false;
        loop {
            let state = app.state::<Lifecycle>();
            let done = {
                let flushed = state.flushed.lock().map(|f| f.clone()).unwrap_or_default();
                all_flushed(&active, &flushed)
            };
            if done {
                break;
            }
            if started.elapsed() >= Duration::from_millis(MAX_WAIT_MS) {
                timed_out = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let waited_ms = started.elapsed().as_millis() as u64;
        let linger = {
            let state = app.state::<Lifecycle>();
            let flushed = state.flushed.lock().map(|f| f.clone()).unwrap_or_default();
            linger_ms(&active, &flushed)
        };
        crate::selftest::record_close(&app, &active, waited_ms, linger, timed_out);
        if linger > 0 {
            // Hide the window at once and let the close sound finish, as the standalone apps do.
            for window in app.webview_windows().into_values() {
                let _ = window.hide();
            }
            std::thread::sleep(Duration::from_millis(linger));
        }
        app.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn close_waits_for_every_active_module() {
        let active = set(&["swish", "ember"]);
        let mut flushed = HashMap::new();
        assert!(!all_flushed(&active, &flushed));
        flushed.insert("swish".to_string(), 0);
        assert!(!all_flushed(&active, &flushed));
        flushed.insert("ember".to_string(), 0);
        assert!(all_flushed(&active, &flushed));
    }

    #[test]
    fn wait_returns_as_soon_as_the_probe_answers() {
        let mut calls = 0;
        let (answer, _) = wait_for(
            || {
                calls += 1;
                (calls == 3).then_some(1200)
            },
            Duration::from_secs(5),
            Duration::from_millis(1),
        );
        assert_eq!(answer, Some(1200));
        assert_eq!(calls, 3);
    }

    #[test]
    fn wait_gives_up_without_an_answer_after_the_limit() {
        let (answer, waited) =
            wait_for(|| None, Duration::from_millis(30), Duration::from_millis(5));
        assert_eq!(answer, None);
        assert!(waited >= 30);
    }

    #[test]
    fn no_active_modules_means_nothing_to_wait_for() {
        assert!(all_flushed(&HashSet::new(), &HashMap::new()));
        assert_eq!(linger_ms(&HashSet::new(), &HashMap::new()), 0);
    }

    #[test]
    fn linger_is_the_longest_request_capped_and_ignores_inactive_modules() {
        let active = set(&["swish"]);
        let mut flushed = HashMap::new();
        flushed.insert("swish".to_string(), 4200);
        flushed.insert("ember".to_string(), 6000);
        assert_eq!(linger_ms(&active, &flushed), 4200);
        flushed.insert("swish".to_string(), u64::MAX);
        assert_eq!(linger_ms(&active, &flushed), MAX_LINGER_MS);
    }
}
