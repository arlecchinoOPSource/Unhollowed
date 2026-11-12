# U-14 — Backup before migration, and verified restore

Issue: [U-14 (#14)](https://github.com/arlecchinoOPSource/Unhollowed/issues/14). Date: 2026-11-12. Implements decision 6 of [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md). Code: `crates/data-safety`; wiring in each module plugin; policy in [DATA-COMPAT-U13.md](DATA-COMPAT-U13.md).

## What exists

- **`inspect`** reads a module's file without changing it and reports one of: missing, fresh, current, needs-migration (older), too-new, unreadable.
- **`backup_verified`** copies a database with SQLite's online backup, which is consistent while the app has it open and includes data still in the write-ahead log. The copy is opened read-only and must pass `integrity_check` and have the same schema version, application id and tables as the original; otherwise it is deleted and an error returned. Files are `before-<label>-<ms>.sqlite3` in the module's `backups/` folder (`0700`, files `0600`), never overwritten. A copy is created owner-only before SQLite touches it and is taken out of WAL mode, so it is one self-contained file with no `-wal`/`-shm` beside it (the first version left group/world-readable `-shm` files; the native permissions guard caught it).
- **Confirmation before migrating (`src-tauri/src/activation.rs`).** At start the host inspects each module's file without changing it. If opening would migrate it (the file is older than the module writes), that module's **plugin is not registered**: its storage is not opened, its commands do not exist, and the page does not mount its frame. Powering it on shows a dialog saying which schema the data is on, which this version uses, that a verified copy is made first (and nothing changes if it cannot be), and that older standalone releases will refuse the upgraded file. *Not now* leaves everything as it was. *Back up and upgrade* calls `host_confirm_migration`: the verified copy is made (`backup_for_upgrade`, which records the notice), and **only if that succeeds** the plugin is registered, which opens and migrates the file. If the copy fails the error says so, nothing is changed, and the module keeps waiting so the person can retry (for example after freeing disk space). A newer file is left to the module's own refusal; a missing, new, current or unreadable file opens as before.
- **`restore`** replaces a module's file from a backup only after the backup passes its own integrity check and is a versioned module database, a verified safety copy of the current file has been made, and the replacement was staged and verified; leftover `-wal`/`-shm` files are removed so they cannot be applied to the restored file. **The module must be off** (nothing else may have the file open).
- **Notices:** after an upgrade the host page shows what `backup_for_upgrade` recorded, with a dismiss button.
- **Schema guard:** each plugin declares the schema version its pinned module writes (`ModuleInfo`), and a test fails if the real module disagrees, so a pin that moves a schema cannot silently skip the backup rule.

## Evidence

- `cargo test -p unhlw-data-safety`: 10 tests — the five inspection cases; a backup that captures rows still only in the WAL (the writer connection stayed open) and does not write the original; unique names for two backups in one millisecond; no-op when nothing needs migrating (no folder created); a newer file is untouched; an older file is backed up and verified and the person is notified; **a failed copy refuses and leaves the file byte-for-byte unchanged**; restore round-trip with the replaced data kept in a safety copy and no stale WAL; a damaged, missing or unversioned backup is refused with nothing changed; restore into an empty folder.
- Three plugin tests (one per module) tie the declared schema version to the real module.
- **Native, in the real host (macOS 26.5.1 arm64):** the host is started on the synthetic data it just created and told (debug builds only, `UNHLW_TEST_SCHEMA_VERSION=2`) that every module now writes schema 2, so every file looks one version old. A scripted scenario then drives the real page: at start all three modules wait, no frame is mounted and none of their commands exist; the dialog for Terminal names the module, both schemas, the verified copy and the refusal by older releases; *Not now* leaves Terminal closed; a confirm whose copy cannot be made (the runner made Terminal's backup location unusable) returns an honest error, opens nothing and changes nothing (Terminal's file is byte-identical afterwards, no copy exists); Ember is confirmed in the real dialog and Swish through the command, each getting exactly one verified copy first (integrity `ok`, schema 1, same row count as the original, originals intact) and then working; a repeated confirm is refused; and only the confirmed modules produced a notice.

## What is not done

- **No restore UI.** `restore` is an engine with tests; nothing in the host calls it. The recovery procedure today is manual: power the module off, then restore the chosen `backups/before-…` file with `restore`.
- **Retention:** copies are never deleted, so repeated upgrades accumulate backups. No size limit or clean-up exists. A full disk makes the copy fail, which refuses the migration (safe, but the module stays unavailable until space is freed).
- **Terminal's per-entry `schema_version`** (audit F3) is not understood by the engine; it checks the database version only.
- **The dialog is minimal.** It is a placeholder like the rest of the host page: it is keyboard-operable (focus starts on *Not now*, Escape cancels, `role="alertdialog"`) but it has not been checked with a screen reader, and it is not styled as part of the rack (U-21/U-23).
- **The gate is the page, not the plugin.** A plugin is registered only after the file is allowed, so its commands truly do not exist before then; but a module's *frame* is kept off by the page. Only the host's own frames exist, so this is enough today.
- **Debug seam:** `UNHLW_TEST_SCHEMA_VERSION` is read only in debug builds (like `UNHLW_DATA_ROOT`); a release build ignores it.
- **Windows:** the new native phase and the engine run in CI on Windows but have not been run natively by the author; Roaming-profile behaviour of WAL files and `rename` over an open file are untested (U-27).
- Migration atomicity itself belongs to each module (one transaction each, per the audit); the host does not verify it. Crash-during-migration and other failure injection are U-16.
- Real user data is still blocked from host builds until the prompt, restore UI and U-15 are done.

## Rollback

Revert the PR. The only change to existing behavior is a backup before an upgrade that does not occur today, so with schemas at 1 the host behaves as before apart from the banner area staying empty.
