/// Every command the module exposes; build.rs generates a permission for each.
/// Names are Ember's own, so its unmodified frontend works behind the host adapters.
pub const COMMANDS: &[&str] = &[
    "practice_days",
    "website_snapshot",
    "export_history",
    "restore_history",
    "habits_list",
    "habits_create",
    "habits_rename",
    "habits_move",
    "habits_archive",
    "habits_delete_preview",
    "habits_delete_archived",
    "completions_month",
    "completions_toggle",
    "finish_exit",
    "play_startup_sound",
    "sound_preferences_set",
    "startup_sound_native",
];
