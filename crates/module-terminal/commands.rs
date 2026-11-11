/// Every command the module exposes; build.rs generates a permission for each.
/// Names are Terminal's own, so its unmodified frontend works behind the host adapters.
pub const COMMANDS: &[&str] = &[
    "journal_list",
    "journal_last",
    "journal_select",
    "journal_save",
    "journal_delete",
    "journal_finish_exit",
    "preferences_get",
    "preferences_set",
    "backup_export",
    "backup_choose",
    "backup_restore",
    "backup_cancel",
    "entry_export",
];
