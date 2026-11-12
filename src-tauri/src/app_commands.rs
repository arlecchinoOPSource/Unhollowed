/// Commands the host itself exposes to its webview. build.rs declares them and
/// capabilities/main.json grants each one (the Ember 2.0.0 lesson: a command missing from
/// either place fails at run time). A test keeps this list, the handler and the capability in step.
pub const APP_COMMANDS: &[&str] = &[
    "host_module_activated",
    "host_module_deactivated",
    "host_power_off",
    "host_data_notices",
    "host_module_status",
    "host_confirm_migration",
    "host_list_backups",
    "host_schedule_restore",
    "host_cancel_restore",
    "selftest_enabled",
    "selftest_scenario",
    "selftest_report",
    "selftest_resize",
    "selftest_finish",
];
