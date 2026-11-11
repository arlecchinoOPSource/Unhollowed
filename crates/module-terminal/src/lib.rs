//! Unhollowed module adapter for Terminal.
//!
//! Terminal's journal logic, storage, backup code and Tauri commands live in Terminal's own library
//! (`app_lib::commands`); this crate registers those very commands under the `terminal` plugin so the
//! unmodified Terminal frontend works behind the host adapters, and supplies the one command that must
//! differ: `journal_finish_exit` reports to the host and never exits the app (docs/HOST-CONTRACT-U35.md).

use std::path::PathBuf;
use std::sync::Mutex;

use app_lib::commands::{self, DataDir, Database, PendingRestore};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use unhlw_host_contract::{FLUSH_EVENT, Flushed, ModuleInfo};

include!("../commands.rs");

pub const INFO: ModuleInfo = ModuleInfo {
    name: "terminal",
    identifier: "com.arlecchino.terminal",
    close_event: "journal-close-requested",
    database_file: "journal.sqlite3",
    schema_version: 1,
};

/// Terminal calls this after saving and starting its close sound. The module never exits the app:
/// it tells the host, which decides when to quit.
#[tauri::command]
fn journal_finish_exit<R: Runtime>(app: AppHandle<R>, linger_ms: Option<u64>) {
    let payload = Flushed {
        module: INFO.name.into(),
        linger_ms: linger_ms.unwrap_or(0),
    };
    let _ = app.emit(FLUSH_EVENT, payload);
}

/// Builds the plugin. `data_dir` is Terminal's existing folder (`<data_dir>/com.arlecchino.terminal`),
/// injected by the host so existing data is found (docs/DATA-DECISIONS-U33.md).
/// Terminal's own commands are written for the desktop runtime (`Wry`), so the plugin is too.
pub fn init(data_dir: PathBuf) -> TauriPlugin<tauri::Wry> {
    Builder::<tauri::Wry>::new(INFO.name)
        .invoke_handler(tauri::generate_handler![
            app_lib::commands::journal_list,
            app_lib::commands::journal_last,
            app_lib::commands::journal_select,
            app_lib::commands::journal_save,
            app_lib::commands::journal_delete,
            journal_finish_exit,
            app_lib::commands::preferences_get,
            app_lib::commands::preferences_set,
            app_lib::commands::backup_export,
            app_lib::commands::backup_choose,
            app_lib::commands::backup_restore,
            app_lib::commands::backup_cancel,
            app_lib::commands::entry_export
        ])
        .setup(move |app, _api| {
            let database = match unhlw_data_safety::prepare(
                INFO.name,
                &data_dir.join(INFO.database_file),
                &data_dir.join("backups"),
                unhlw_data_safety::effective_version(INFO.schema_version),
            ) {
                unhlw_data_safety::Prepared::Refused(reason) => Err(reason),
                _ => commands::open_in(&data_dir),
            };
            app.manage(Database(Mutex::new(database)));
            app.manage(PendingRestore::default());
            app.manage(DataDir(Ok(data_dir.clone())));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The schema version the host declares must be the one the pinned Terminal really writes: a pin that moves the
    /// schema fails here, so the host's backup-before-migrate rule cannot silently stop applying.
    #[test]
    fn declared_schema_version_matches_the_real_module() {
        let dir =
            std::env::temp_dir().join(format!("unhlw-terminal-schema-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let connection = commands::open_in(&dir).expect("Terminal opens a fresh folder");
        drop(connection);
        let file = dir.join(INFO.database_file);
        assert!(file.exists(), "{} was not created", INFO.database_file);
        assert_eq!(
            unhlw_data_safety::user_version(&file).unwrap(),
            INFO.schema_version
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
