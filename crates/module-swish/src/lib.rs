//! Unhollowed module adapter for Swish.
//!
//! Swish's storage, data commands and backup/restore live in Swish's own library (`swish_lib`); this crate
//! registers those very commands under the `swish` plugin so the unmodified Swish frontend works behind the
//! host adapters, and supplies the one command that must differ: `finish_exit` reports to the host and never
//! exits the app (docs/HOST-CONTRACT-U35.md). Nothing is copied from Swish.

use std::path::PathBuf;

use swish_data::ApiError;
use swish_lib::backup_commands::{self, LastSafetyCopy, PendingRestore};
use swish_lib::commands::{self, Storage};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use unhlw_host_contract::{FLUSH_EVENT, Flushed, ModuleInfo};

include!("../commands.rs");

pub const INFO: ModuleInfo = ModuleInfo {
    name: "swish",
    identifier: "com.arlecchino.swish",
    close_event: "swish-close-requested",
    database_file: "swish.sqlite3",
    schema_version: 1,
};

/// Swish calls this after saving and starting its close sound. The module never exits the app:
/// it tells the host, which decides when to quit.
#[tauri::command]
fn finish_exit<R: Runtime>(app: AppHandle<R>, linger_ms: Option<u64>) {
    let payload = Flushed {
        module: INFO.name.into(),
        linger_ms: linger_ms.unwrap_or(0),
    };
    let _ = app.emit(FLUSH_EVENT, payload);
}

/// Builds the plugin. `data_dir` is Swish's existing folder (`<data_dir>/com.arlecchino.swish`),
/// injected by the host so existing data is found (docs/DATA-DECISIONS-U33.md). Swish's backup commands open
/// native file dialogs, so they are written for the desktop runtime (`Wry`) and the plugin is too.
pub fn init(data_dir: PathBuf) -> TauriPlugin<tauri::Wry> {
    Builder::<tauri::Wry>::new(INFO.name)
        .invoke_handler(tauri::generate_handler![
            commands::load_workspace,
            commands::create_project,
            commands::update_project,
            commands::create_reminder,
            commands::update_reminder,
            commands::set_reminder_completed,
            commands::delete_project,
            commands::delete_reminder,
            commands::restore_reminder,
            backup_commands::export_backup,
            backup_commands::inspect_backup,
            backup_commands::cancel_restore,
            backup_commands::restore_backup,
            backup_commands::undo_restore,
            finish_exit
        ])
        .setup(move |app, _api| {
            let storage = match unhlw_data_safety::prepare(
                INFO.name,
                &data_dir.join(INFO.database_file),
                &data_dir.join("backups"),
                unhlw_data_safety::effective_version(INFO.schema_version),
            ) {
                unhlw_data_safety::Prepared::Refused(reason) => Storage::unavailable(ApiError {
                    // Swish's own code for "storage cannot be used", with the reason the host refused (its own
                    // message for this code would only say the file could not be reached).
                    code: "storage",
                    field: None,
                    message: reason,
                }),
                _ => Storage::open(data_dir.clone()),
            };
            app.manage(storage);
            app.manage(PendingRestore::default());
            app.manage(LastSafetyCopy::default());
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The schema version the host declares must be the one the pinned Swish really writes (see Terminal's twin test).
    #[test]
    fn declared_schema_version_matches_the_real_module() {
        let dir = std::env::temp_dir().join(format!("unhlw-swish-schema-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        drop(Storage::open(dir.clone()));
        let file = dir.join(INFO.database_file);
        assert!(file.exists(), "{} was not created", INFO.database_file);
        assert_eq!(
            unhlw_data_safety::user_version(&file).unwrap(),
            INFO.schema_version
        );
        assert_eq!(INFO.database_file, swish_data::DATABASE_FILE);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
