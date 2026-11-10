const COMMANDS: &[&str] = &["ping", "finish_exit"];
fn main() { tauri_plugin::Builder::new(COMMANDS).build(); }
