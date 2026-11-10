use tauri::{plugin::{Builder, TauriPlugin}, Runtime};
#[tauri::command] fn ping() -> &'static str { "alpha:pong" }
#[tauri::command] fn finish_exit() -> &'static str { "alpha:finish_exit" }
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("alpha").invoke_handler(tauri::generate_handler![ping, finish_exit]).build()
}
