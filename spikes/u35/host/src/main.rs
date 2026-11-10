use std::sync::Mutex;
use tauri::{webview::WebviewBuilder, window::WindowBuilder, LogicalPosition, LogicalSize, WebviewUrl};
struct Results(Mutex<serde_json::Map<String, serde_json::Value>>);
#[tauri::command]
fn report(state: tauri::State<Results>, name: String, data: serde_json::Value) {
    let mut m = state.0.lock().unwrap();
    m.insert(name, data);
    if let Ok(p) = std::env::var("U31_OUT") {
        let _ = std::fs::write(p, serde_json::to_string_pretty(&*m).unwrap());
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_alpha::init())
        .plugin(tauri_plugin_beta::init())
        .manage(Results(Default::default()))
        .invoke_handler(tauri::generate_handler![report])
        .setup(|app| {
            let w = WindowBuilder::new(app, "multi").title("u31 multi").inner_size(800.0, 300.0).build()?;
            w.add_child(WebviewBuilder::new("child-a", WebviewUrl::App("child-a.html".into())), LogicalPosition::new(0.0, 0.0), LogicalSize::new(400.0, 300.0))?;
            w.add_child(WebviewBuilder::new("child-b", WebviewUrl::App("child-b.html".into())), LogicalPosition::new(400.0, 0.0), LogicalSize::new(400.0, 300.0))?;
            let h = app.handle().clone();
            std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_secs(14)); h.exit(0); });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run");
}
