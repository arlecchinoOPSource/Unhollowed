//! Tells the page when another program changed a module's data (docs/CHANGE-NOTICE-U15.md).
//!
//! One thread per module opens its own read-only connection and asks SQLite once a second whether anyone else committed.
//! It reads nothing and writes nothing. The event carries only the module's name; the page decides whether the change was
//! the module's own (it knows when the module last called a command) and tells the person.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use unhlw_data_safety::ChangeWatcher;

pub const EVENT: &str = "unhlw-data-changed";
const EVERY: Duration = Duration::from_millis(1000);

/// Starts watching a module's database file. Call once per module, after any restore has been applied.
pub fn watch(app: &AppHandle, module: &'static str, file: PathBuf) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut watcher = ChangeWatcher::new(&file);
        loop {
            std::thread::sleep(EVERY);
            if watcher.changed() {
                let _ = app.emit_to("main", EVENT, module);
            }
        }
    });
}
