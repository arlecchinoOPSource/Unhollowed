mod activation;
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
        .manage(activation::Activation::default())
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
            lifecycle::host_power_off,
            lifecycle::host_data_notices,
            activation::host_module_status,
            activation::host_confirm_migration,
            activation::host_list_backups,
            activation::host_schedule_restore,
            activation::host_cancel_restore,
            selftest::selftest_enabled,
            selftest::selftest_scenario,
            selftest::selftest_report,
            selftest::selftest_resize,
            selftest::selftest_finish
        ])
        .setup(|app| {
            let host_dir = app.path().app_data_dir()?;
            // Debug builds only: a throwaway data root so tests never touch real data.
            let override_root = std::env::var_os("UNHLW_DATA_ROOT").map(PathBuf::from);
            for info in modules::MODULES {
                let folder = modules::module_data_dir(
                    &host_dir,
                    info.identifier,
                    override_root.as_deref(),
                    cfg!(debug_assertions),
                );
                activation::start(app.handle(), info, folder)?;
            }
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
            let handler_name = if matches!(
                *command,
                "host_module_status"
                    | "host_confirm_migration"
                    | "host_list_backups"
                    | "host_schedule_restore"
                    | "host_cancel_restore"
            ) {
                format!("activation::{command}")
            } else {
                command
                    .replace("host_", "lifecycle::host_")
                    .replace("selftest_", "selftest::selftest_")
            };
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
