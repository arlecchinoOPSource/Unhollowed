//! Debug-only native self-test. Inert unless this is a debug build and `UNHLW_SELFTEST_OUT` is set.
//! The host page runs probes against the embedded module, reports them here, and the results are
//! written as JSON for `scripts/native-selftest.mjs`. Release builds never act on any of it.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

fn out_path() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        std::env::var_os("UNHLW_SELFTEST_OUT").map(PathBuf::from)
    } else {
        None
    }
}

fn results() -> &'static Mutex<Map<String, Value>> {
    static RESULTS: OnceLock<Mutex<Map<String, Value>>> = OnceLock::new();
    RESULTS.get_or_init(|| Mutex::new(Map::new()))
}

fn write_out() {
    if let (Some(path), Ok(map)) = (out_path(), results().lock()) {
        let _ = std::fs::write(
            path,
            serde_json::to_string_pretty(&*map).unwrap_or_default(),
        );
    }
}

#[tauri::command]
pub fn selftest_enabled() -> bool {
    out_path().is_some()
}

#[tauri::command]
pub fn selftest_report(name: String, data: Value) {
    if out_path().is_none() {
        return;
    }
    if let Ok(mut map) = results().lock() {
        map.insert(name, data);
    }
    write_out();
}

#[tauri::command]
pub fn selftest_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if out_path().is_none() {
        return Err("Self-test is not enabled.".into());
    }
    let window = app.get_webview_window("main").ok_or("No main window.")?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

/// The page is done probing: start the same close sequence a user's close would.
#[tauri::command]
pub fn selftest_finish(app: AppHandle) -> Result<(), String> {
    if out_path().is_none() {
        return Err("Self-test is not enabled.".into());
    }
    crate::lifecycle::begin_close(&app);
    Ok(())
}

/// Called by the close sequence just before the app exits.
pub fn record_close(
    app: &AppHandle,
    active: &HashSet<String>,
    waited_ms: u64,
    linger_ms: u64,
    timed_out: bool,
) {
    if out_path().is_none() {
        return;
    }
    let mut modules: Vec<&String> = active.iter().collect();
    modules.sort();
    let mut data = json!({
        "active_modules": modules,
        "waited_ms": waited_ms,
        "linger_ms": linger_ms,
        "timed_out": timed_out,
    });
    if let Some(root) = std::env::var_os("UNHLW_DATA_ROOT") {
        for (name, file_name) in [("swish", "swish.sqlite3"), ("terminal", "journal.sqlite3")] {
            if let Some(module) = crate::modules::find(name) {
                let file = PathBuf::from(&root).join(module.identifier).join(file_name);
                data[format!("{name}_database_exists")] = json!(file.exists());
                data[format!("{name}_database_bytes")] =
                    json!(std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0));
            }
        }
    }
    let _ = app;
    if let Ok(mut map) = results().lock() {
        map.insert("close_handshake".into(), data);
    }
    write_out();
}
