mod lifecycle;
mod modules;
mod selftest;

use std::path::PathBuf;

use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        // Terminal's file dialogs (backup, export) use this plugin from Rust; no page may call it.
        .plugin(tauri_plugin_dialog::init())
        .manage(lifecycle::Lifecycle::default())
        .on_window_event(|window, event| {
            // The host owns close: hold it while modules save (docs/HOST-CONTRACT-U35.md).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                lifecycle::begin_close(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            lifecycle::host_module_activated,
            lifecycle::host_module_deactivated,
            selftest::selftest_enabled,
            selftest::selftest_report,
            selftest::selftest_resize,
            selftest::selftest_finish
        ])
        .setup(|app| {
            let host_dir = app.path().app_data_dir()?;
            // Debug builds only: a throwaway data root so tests never touch real data.
            let override_root = std::env::var_os("UNHLW_DATA_ROOT").map(PathBuf::from);
            let swish_dir = modules::module_data_dir(
                &host_dir,
                tauri_plugin_swish::INFO.identifier,
                override_root.as_deref(),
                cfg!(debug_assertions),
            );
            app.handle().plugin(tauri_plugin_swish::init(swish_dir))?;
            let terminal_dir = modules::module_data_dir(
                &host_dir,
                tauri_plugin_terminal::INFO.identifier,
                override_root.as_deref(),
                cfg!(debug_assertions),
            );
            app.handle()
                .plugin(tauri_plugin_terminal::init(terminal_dir))?;
            let ember_dir = modules::module_data_dir(
                &host_dir,
                tauri_plugin_ember::INFO.identifier,
                override_root.as_deref(),
                cfg!(debug_assertions),
            );
            app.handle().plugin(tauri_plugin_ember::init(ember_dir))?;
            lifecycle::listen_for_flush(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Unhollowed could not start");
    app.run(|app, event| {
        // Quit from the menu or keyboard takes the same path as closing the window.
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
            lifecycle::begin_close(app);
        }
    });
}

#[cfg(test)]
mod tests {
    include!("app_commands.rs");

    /// Keeps the three places that must agree in step: the command list, the handler and the
    /// capability (Ember 2.0.0 shipped commands without permissions).
    #[test]
    fn app_commands_are_declared_handled_and_granted() {
        // Windows checkouts use CRLF line endings; compare on LF.
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let granted: Vec<&str> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        for command in APP_COMMANDS {
            let handler_name = command
                .replace("host_", "lifecycle::host_")
                .replace("selftest_", "selftest::selftest_");
            let handled = source.contains(&format!("{handler_name},"))
                || source.contains(&format!("{handler_name}\n"));
            assert!(handled, "{command} is not in generate_handler!");
            let permission = format!("allow-{}", command.replace('_', "-"));
            assert!(
                granted.contains(&permission.as_str()),
                "{permission} is not granted in capabilities/main.json"
            );
        }
    }

    #[test]
    fn every_module_command_is_granted_with_its_plugin_prefix() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let granted: Vec<&str> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .collect();
        let modules: [(&str, &[&str]); 3] = [
            ("swish", tauri_plugin_swish::COMMANDS),
            ("terminal", tauri_plugin_terminal::COMMANDS),
            ("ember", tauri_plugin_ember::COMMANDS),
        ];
        for (plugin, commands) in modules {
            for command in commands {
                let permission = format!("{plugin}:allow-{}", command.replace('_', "-"));
                assert!(
                    granted.contains(&permission.as_str()),
                    "{permission} is not granted"
                );
            }
        }
    }
}
