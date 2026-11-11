//! Unhollowed module adapter for Ember.
//!
//! Ember's habit logic, storage, backup code and Tauri commands live in Ember's own library
//! (`ember_lib::commands`); this crate registers those very commands under the `ember` plugin so the
//! unmodified Ember frontend works behind the host adapters. It supplies the commands that must differ
//! because they touch the window or the sound system, which the host owns (docs/HOST-CONTRACT-U35.md):
//! `finish_exit` reports to the host and never exits the app; the startup-sound commands do nothing yet.

use std::path::PathBuf;
use std::sync::Mutex;

use ember_lib::commands::{self, Database};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use unhlw_host_contract::{FLUSH_EVENT, Flushed, ModuleInfo};

include!("../commands.rs");

pub const INFO: ModuleInfo = ModuleInfo {
    name: "ember",
    identifier: "com.arlecchino.ember",
    close_event: "ember:exit-requested",
    database_file: "ember.sqlite3",
    schema_version: 1,
};

/// Ember calls this after its habits are saved. The module never exits the app: it tells the host, which
/// decides when to quit. Ember's native close cue is not played in the host (audio ownership is undecided).
#[tauri::command]
fn finish_exit<R: Runtime>(
    app: AppHandle<R>,
    native_cue_volume: Option<u8>,
    linger_ms: Option<u64>,
) {
    let _ = native_cue_volume;
    let payload = Flushed {
        module: INFO.name.into(),
        linger_ms: linger_ms.unwrap_or(0),
    };
    let _ = app.emit(FLUSH_EVENT, payload);
}

/// Ember's native startup sound is a standalone-app feature (macOS `afplay`); the host plays none yet.
#[tauri::command]
fn play_startup_sound(volume: u8) -> Result<(), String> {
    let _ = volume;
    Ok(())
}

/// Nothing is stored: the host starts no native startup sound, so there is nothing to remember.
#[tauri::command]
fn sound_preferences_set(startup_volume: u8) -> Result<(), String> {
    let _ = startup_volume;
    Ok(())
}

/// No native startup sound has started, so Ember's interface is told to play its own if it wants one.
#[tauri::command]
fn startup_sound_native() -> bool {
    false
}

/// Builds the plugin. `data_dir` is Ember's existing folder (`<data_dir>/com.arlecchino.ember`), injected by
/// the host so existing data is found (docs/DATA-DECISIONS-U33.md).
pub fn init(data_dir: PathBuf) -> TauriPlugin<tauri::Wry> {
    Builder::<tauri::Wry>::new(INFO.name)
        .invoke_handler(tauri::generate_handler![
            commands::practice_days,
            commands::website_snapshot,
            commands::export_history,
            commands::restore_history,
            commands::habits_list,
            commands::habits_create,
            commands::habits_rename,
            commands::habits_move,
            commands::habits_archive,
            commands::habits_delete_preview,
            commands::habits_delete_archived,
            commands::completions_month,
            commands::completions_toggle,
            finish_exit,
            play_startup_sound,
            sound_preferences_set,
            startup_sound_native
        ])
        .setup(move |app, _api| {
            let path = data_dir.join(INFO.database_file);
            let connection = match unhlw_data_safety::prepare(
                INFO.name,
                &path,
                &data_dir.join("backups"),
                unhlw_data_safety::effective_version(INFO.schema_version),
            ) {
                unhlw_data_safety::Prepared::Refused(reason) => Err(reason),
                _ => commands::open_at(&path),
            };
            if let Err(reason) = &connection {
                eprintln!("ember storage: {reason}");
            }
            app.manage(Database {
                connection: Mutex::new(connection),
                path: Some(path),
            });
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The schema version the host declares must be the one the pinned Ember really writes (see Terminal's twin test).
    #[test]
    fn declared_schema_version_matches_the_real_module() {
        let dir = std::env::temp_dir().join(format!("unhlw-ember-schema-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join(INFO.database_file);
        drop(commands::open_at(&file).expect("Ember opens a fresh folder"));
        assert!(file.exists(), "{} was not created", INFO.database_file);
        assert_eq!(
            unhlw_data_safety::user_version(&file).unwrap(),
            INFO.schema_version
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
