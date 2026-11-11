# Swish inside Unhollowed (U-10)

Swish was the first embedded module (U-03). U-10 finishes it the way Terminal ([TERMINAL-U06.md](TERMINAL-U06.md)) and Ember ([EMBER-U09.md](EMBER-U09.md)) are built.

## What changed

- **Upstream (Swish PR 38, pinned by full SHA in `modules.json`):** Swish is now a library (`swish_lib`) plus a standalone shell. `commands.rs` holds `Storage` and the nine data commands, `backup_commands.rs` the export/restore commands, `standalone.rs` the window, close handling and `run()` behind a default-on `standalone` feature. `Storage` remembers its data folder, so restore's safety copies land beside the database wherever the window's owner put it. Command names and permissions are unchanged.
- **Here:** `crates/module-swish` no longer copies any command code. It registers Swish's own commands under the `swish` plugin and supplies only `finish_exit`, which reports to the host instead of exiting. The plugin builder that lived in Unhollowed since U-03 is gone.
- **Backup and restore** (left out of the first slice) are now registered and granted: `export_backup`, `inspect_backup`, `cancel_restore`, `restore_backup`, `undo_restore`. They open native file dialogs through the host's dialog plugin; no page may call that plugin.

## Evidence and limits

- The native self-test creates a project through Swish's real UI and reads it back through the plugin. It also calls `cancel_restore` and `undo_restore`, which open no dialog: this shows the backup commands are routed and permitted and their state is managed by the plugin.
- **Not exercised:** the native export/restore dialogs themselves and an actual restore, the close sound, keyboard shortcuts, real user data. Swish's own Windows WebDriver test and UI tests run in Swish's CI, not here.
- Restoring replaces Swish's whole database; until safe migration and backup handling (U-14) are done, host builds keep using synthetic data directories.
