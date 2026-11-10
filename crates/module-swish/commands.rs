/// Every command the module exposes; build.rs generates a permission for each.
/// Names are Swish's own, so its unmodified frontend works behind the host shim.
pub const COMMANDS: &[&str] = &[
    "load_workspace",
    "create_project",
    "update_project",
    "create_reminder",
    "update_reminder",
    "set_reminder_completed",
    "delete_project",
    "delete_reminder",
    "restore_reminder",
    "finish_exit",
];
