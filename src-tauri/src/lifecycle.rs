//! The host owns close and quit (docs/HOST-CONTRACT-U35.md). A close request asks each active
//! module to save through its own close event; the host waits for each module's flush report
//! (or a timeout), lets any close sound finish, then exits once.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

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

#[tauri::command]
pub fn host_module_activated(state: State<'_, Lifecycle>, module: String) -> Result<(), String> {
    modules::find(&module).ok_or("Unknown module.")?;
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
