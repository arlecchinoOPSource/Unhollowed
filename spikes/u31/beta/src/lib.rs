use tauri::{plugin::{Builder, TauriPlugin}, Runtime};
#[tauri::command] fn ping() -> &'static str { "beta:pong" }
#[tauri::command] fn finish_exit() -> &'static str { "beta:finish_exit" }
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("beta").invoke_handler(tauri::generate_handler![ping, finish_exit]).build()
}
