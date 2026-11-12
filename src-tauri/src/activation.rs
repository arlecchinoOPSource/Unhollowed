//! Whether a module may be opened yet (docs/DATA-SAFETY-U14.md).
//!
//! At start the host looks at each module's database file without changing it. If the file is older than the module writes,
//! opening it would migrate it, and that needs the person's confirmation first. Such a module's plugin is **not registered**
//! (its storage is not opened and its commands do not exist) until the person confirms; then the host takes a verified copy,
//! and only if that succeeds registers the plugin, which opens (and migrates) the file. Every other module is registered at
//! once. The page does not mount a module's frame until its state is `ready`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use unhlw_data_safety::{
    BackupInfo, Inspection, apply_pending_restore, backup_for_upgrade, effective_version, inspect,
    list_backups, pending_restore, prune, schedule_restore,
};
use unhlw_host_contract::ModuleInfo;

/// What the page needs to know about a module's data before powering it on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    /// The module's plugin is registered; it can be powered on.
    Ready,
    /// The module's file is older than the module writes. Nothing has been opened or changed; the person must confirm.
    NeedsConfirmation { from: i64, to: i64 },
}

#[derive(Default)]
pub struct Activation {
    status: Mutex<HashMap<String, Status>>,
    folders: Mutex<HashMap<String, PathBuf>>,
}

/// Registers a module's plugin, which opens its storage.
fn register(app: &AppHandle, name: &str, folder: PathBuf) -> tauri::Result<()> {
    match name {
        "swish" => app.plugin(tauri_plugin_swish::init(folder)),
        "terminal" => app.plugin(tauri_plugin_terminal::init(folder)),
        "ember" => app.plugin(tauri_plugin_ember::init(folder)),
        other => Err(tauri::Error::PluginInitialization(
            other.into(),
            "unknown module".into(),
        )),
    }
}

/// What to do with a module whose file is in this state: ask first only when opening would migrate it.
pub fn needs_confirmation(inspection: &Inspection) -> Option<Status> {
    match inspection {
        Inspection::NeedsMigration { from, to } => Some(Status::NeedsConfirmation {
            from: *from,
            to: *to,
        }),
        // A missing, new, current or unreadable file opens normally; a newer one is refused by the module itself.
        _ => None,
    }
}

/// Called at startup for each module.
pub fn start(app: &AppHandle, info: &ModuleInfo, folder: PathBuf) -> tauri::Result<()> {
    let activation = tauri::Manager::state::<Activation>(app);
    let file = folder.join(info.database_file);
    let supported = effective_version(info.schema_version);
    // A restore the person scheduled last time happens now, before anything has the file open; then old copies are pruned.
    apply_pending_restore(info.name, &file, supported);
    prune(&folder.join("backups"));
    let status = match needs_confirmation(&inspect(&file, supported)) {
        Some(status) => status,
        None => {
            register(app, info.name, folder.clone())?;
            crate::changes::watch(app, info.name, file.clone());
            Status::Ready
        }
    };
    if let Ok(mut folders) = activation.folders.lock() {
        folders.insert(info.name.into(), folder);
    }
    if let Ok(mut map) = activation.status.lock() {
        map.insert(info.name.into(), status);
    }
    Ok(())
}

#[tauri::command]
pub fn host_module_status(state: State<'_, Activation>, module: String) -> Result<Status, String> {
    state
        .status
        .lock()
        .map_err(|_| "Activation unavailable.")?
        .get(&module)
        .cloned()
        .ok_or_else(|| "Unknown module.".into())
}

/// The person confirmed the upgrade: take the verified copy, and only if that works open the module. On failure nothing
/// was changed and the module stays waiting, so the person can try again (for example after freeing disk space).
#[tauri::command]
pub fn host_confirm_migration(
    app: AppHandle,
    state: State<'_, Activation>,
    module: String,
) -> Result<(), String> {
    let info = crate::modules::find(&module).ok_or("Unknown module.")?;
    let mut statuses = state.status.lock().map_err(|_| "Activation unavailable.")?;
    let Some(Status::NeedsConfirmation { from, to }) = statuses.get(&module).cloned() else {
        return Err("There is nothing to confirm for that module.".into());
    };
    let folder = state
        .folders
        .lock()
        .map_err(|_| "Activation unavailable.")?
        .get(&module)
        .cloned()
        .ok_or("Unknown module folder.")?;
    backup_for_upgrade(
        info.name,
        &folder.join(info.database_file),
        &folder.join("backups"),
        from,
        to,
    )
    .map_err(|error| {
        format!(
            "{} was not upgraded because a safety copy could not be made first ({error}). Nothing was changed; your data is as it was.",
            info.name
        )
    })?;
    register(&app, info.name, folder.clone()).map_err(|error| error.to_string())?;
    crate::changes::watch(&app, info.name, folder.join(info.database_file));
    statuses.insert(module, Status::Ready);
    Ok(())
}

fn module_folder(state: &Activation, module: &str) -> Result<PathBuf, String> {
    state
        .folders
        .lock()
        .map_err(|_| "Activation unavailable.")?
        .get(module)
        .cloned()
        .ok_or_else(|| "Unknown module.".into())
}

/// The module's backups (newest first) and the one waiting to be restored at the next start, if any.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backups {
    pub backups: Vec<BackupInfo>,
    pub pending: Option<String>,
}

#[tauri::command]
pub fn host_list_backups(state: State<'_, Activation>, module: String) -> Result<Backups, String> {
    let folder = module_folder(&state, &module)?;
    Ok(Backups {
        backups: list_backups(&folder.join("backups")),
        pending: pending_restore(&folder),
    })
}

/// Schedules a restore for the next start (a running module has its file open). Nothing is replaced now.
#[tauri::command]
pub fn host_schedule_restore(
    state: State<'_, Activation>,
    module: String,
    file: String,
) -> Result<(), String> {
    let info = crate::modules::find(&module).ok_or("Unknown module.")?;
    let folder = module_folder(&state, &module)?;
    schedule_restore(&folder, &file, effective_version(info.schema_version))
}

#[tauri::command]
pub fn host_cancel_restore(state: State<'_, Activation>, module: String) -> Result<(), String> {
    unhlw_data_safety::cancel_restore(&module_folder(&state, &module)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_file_that_would_be_migrated_needs_the_person() {
        assert_eq!(
            needs_confirmation(&Inspection::NeedsMigration { from: 1, to: 2 }),
            Some(Status::NeedsConfirmation { from: 1, to: 2 })
        );
        for other in [
            Inspection::Missing,
            Inspection::Fresh,
            Inspection::Current,
            Inspection::TooNew {
                found: 3,
                supported: 2,
            },
            Inspection::Unreadable("damaged".into()),
        ] {
            assert_eq!(needs_confirmation(&other), None, "{other:?}");
        }
    }

    #[test]
    fn status_serializes_for_the_page() {
        assert_eq!(
            serde_json::to_string(&Status::Ready).unwrap(),
            r#"{"state":"ready"}"#
        );
        assert_eq!(
            serde_json::to_string(&Status::NeedsConfirmation { from: 1, to: 2 }).unwrap(),
            r#"{"state":"needsConfirmation","from":1,"to":2}"#
        );
    }
}
