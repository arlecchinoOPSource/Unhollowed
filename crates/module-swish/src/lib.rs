//! Unhollowed module adapter for Swish.
//!
//! Interim (first slice): this crate only wraps the real `swish-data` crate behind the same
//! command names Swish's frontend already uses, so the unmodified Swish bundle runs behind
//! the host shim. Moving this plugin builder into the Swish repository is tracked in U-10.
//! Backup and restore commands (native file dialogs) are not part of this slice.

use std::path::PathBuf;
use std::sync::Mutex;

use swish_data::{
    ApiError, DATABASE_FILE, DeletedProject, Error, Project, ProjectInput, Reminder, ReminderInput,
    Store, Workspace,
};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use unhlw_host_contract::{FLUSH_EVENT, Flushed, ModuleInfo};

include!("../commands.rs");

pub const INFO: ModuleInfo = ModuleInfo {
    name: "swish",
    identifier: "com.arlecchino.swish",
    close_event: "swish-close-requested",
};

/// The open store, or why it could not be opened; the UI explains the failure instead of the app crashing.
pub struct Storage(Mutex<Result<Store, ApiError>>);

impl Storage {
    fn with<T>(&self, work: impl FnOnce(&mut Store) -> Result<T, Error>) -> Result<T, ApiError> {
        // A panic mid-write already rolled its transaction back; the connection stays usable.
        let mut guard = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match guard.as_mut() {
            Ok(store) => work(store).map_err(ApiError::from),
            Err(error) => Err(error.clone()),
        }
    }
}

#[tauri::command]
fn load_workspace(storage: State<'_, Storage>) -> Result<Workspace, ApiError> {
    storage.with(|store| store.workspace())
}

#[tauri::command]
fn create_project(storage: State<'_, Storage>, input: ProjectInput) -> Result<Project, ApiError> {
    storage.with(|store| store.create_project(&input))
}

#[tauri::command]
fn update_project(
    storage: State<'_, Storage>,
    id: String,
    input: ProjectInput,
) -> Result<Project, ApiError> {
    storage.with(|store| store.update_project(&id, &input))
}

#[tauri::command]
fn create_reminder(
    storage: State<'_, Storage>,
    input: ReminderInput,
) -> Result<Reminder, ApiError> {
    storage.with(|store| store.create_reminder(&input))
}

#[tauri::command]
fn update_reminder(
    storage: State<'_, Storage>,
    id: String,
    input: ReminderInput,
) -> Result<Reminder, ApiError> {
    storage.with(|store| store.update_reminder(&id, &input))
}

#[tauri::command]
fn set_reminder_completed(
    storage: State<'_, Storage>,
    id: String,
    completed: bool,
) -> Result<Reminder, ApiError> {
    storage.with(|store| store.set_completed(&id, completed))
}

#[tauri::command]
fn delete_project(
    storage: State<'_, Storage>,
    id: String,
    expected_reminders: u32,
) -> Result<DeletedProject, ApiError> {
    storage.with(|store| store.delete_project(&id, expected_reminders))
}

#[tauri::command]
fn delete_reminder(storage: State<'_, Storage>, id: String) -> Result<Reminder, ApiError> {
    storage.with(|store| store.delete_reminder(&id))
}

#[tauri::command]
fn restore_reminder(storage: State<'_, Storage>, reminder: Reminder) -> Result<Reminder, ApiError> {
    storage.with(|store| store.restore_reminder(&reminder))
}

/// Swish calls this after saving and starting its close sound. The module never exits the
/// app: it tells the host, which decides when to quit (docs/HOST-CONTRACT-U35.md).
#[tauri::command]
fn finish_exit<R: Runtime>(app: AppHandle<R>, linger_ms: Option<u64>) {
    let payload = Flushed {
        module: INFO.name.into(),
        linger_ms: linger_ms.unwrap_or(0),
    };
    let _ = app.emit(FLUSH_EVENT, payload);
}

/// Builds the plugin. `data_dir` is Swish's existing folder (`<data_dir>/com.arlecchino.swish`),
/// injected by the host so existing data is found (docs/DATA-DECISIONS-U33.md).
pub fn init<R: Runtime>(data_dir: PathBuf) -> TauriPlugin<R> {
    Builder::new(INFO.name)
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            create_project,
            update_project,
            create_reminder,
            update_reminder,
            set_reminder_completed,
            delete_project,
            delete_reminder,
            restore_reminder,
            finish_exit
        ])
        .setup(move |app, _api| {
            let store = Store::open(&data_dir.join(DATABASE_FILE)).map_err(ApiError::from);
            app.manage(Storage(Mutex::new(store)));
            Ok(())
        })
        .build()
}
