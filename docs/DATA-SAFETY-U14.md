# U-14 — Backup before migration, and verified restore

Issue: [U-14 (#14)](https://github.com/arlecchinoOPSource/Unhollowed/issues/14). Date: 2026-11-12. Implements decision 6 of [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md). Code: `crates/data-safety`; wiring in each module plugin; policy in [DATA-COMPAT-U13.md](DATA-COMPAT-U13.md).

## What exists

- **`inspect`** reads a module's file without changing it and reports one of: missing, fresh, current, needs-migration (older), too-new, unreadable.
- **`backup_verified`** copies a database with SQLite's online backup, which is consistent while the app has it open and includes data still in the write-ahead log. The copy is opened read-only and must pass `integrity_check` and have the same schema version, application id and tables as the original; otherwise it is deleted and an error returned. Files are `before-<label>-<ms>.sqlite3` in the module's `backups/` folder (`0700`, files `0600`), never overwritten.
- **`prepare`** runs before a module opens its file. If opening would migrate an older file it makes a verified copy first and records a notice; **if the copy cannot be made it returns a refusal and the module is not opened** (it shows the reason, the file is byte-for-byte unchanged). A newer file is left to the module's own refusal; nothing is backed up or touched.
- **`restore`** replaces a module's file from a backup only after the backup passes its own integrity check and is a versioned module database, a verified safety copy of the current file has been made, and the replacement was staged and verified; leftover `-wal`/`-shm` files are removed so they cannot be applied to the restored file. **The module must be off** (nothing else may have the file open).
- **Notices:** the host page shows what `prepare` recorded, once, with a dismiss button.
- **Schema guard:** each plugin declares the schema version its pinned module writes (`ModuleInfo`), and a test fails if the real module disagrees, so a pin that moves a schema cannot silently skip the backup rule.

## Evidence

- `cargo test -p unhlw-data-safety`: 10 tests — the five inspection cases; a backup that captures rows still only in the WAL (the writer connection stayed open) and does not write the original; unique names for two backups in one millisecond; no-op when nothing needs migrating (no folder created); a newer file is untouched; an older file is backed up and verified and the person is notified; **a failed copy refuses and leaves the file byte-for-byte unchanged**; restore round-trip with the replaced data kept in a safety copy and no stale WAL; a damaged, missing or unversioned backup is refused with nothing changed; restore into an empty folder.
- Three plugin tests (one per module) tie the declared schema version to the real module.
- **Native, in the real host (macOS 26.5.1 arm64):** the host is started on the synthetic data it just created, told (debug builds only, `UNHLW_TEST_SCHEMA_VERSION=2`) that every module now writes schema 2, so every file looks one version old. Each of Terminal, Ember and Swish got exactly one verified copy: integrity `ok`, schema 1, same row count as the original, and the originals unchanged.

## What is not done (this is why U-14 stays open)

- **No confirmation before migrating.** Decision 6 says the person is told *before* the migration runs. Today they are told after the verified copy exists, in a banner, and the migration then proceeds. A real prompt needs a UI flow and a way to reopen a module's storage after it was deferred. No module has a schema above 1, so nothing can trigger this yet; it must be built before the first schema bump.
- **No restore UI.** `restore` is an engine with tests; nothing in the host calls it. The recovery procedure today is manual: power the module off, then restore the chosen `backups/before-…` file with `restore`.
- **The refusal path is unit-tested but not exercised natively** (the native test covers the backup path).
- **Retention:** copies are never deleted, so repeated upgrades accumulate backups. No size limit or clean-up exists. A full disk makes the copy fail, which refuses the migration (safe, but the module stays unavailable until space is freed).
- **Terminal's per-entry `schema_version`** (audit F3) is not understood by the engine; it checks the database version only.
- **Debug seam:** `UNHLW_TEST_SCHEMA_VERSION` is read only in debug builds (like `UNHLW_DATA_ROOT`); a release build ignores it.
- **Windows:** the new native phase and the engine run in CI on Windows but have not been run natively by the author; Roaming-profile behaviour of WAL files and `rename` over an open file are untested (U-27).
- Migration atomicity itself belongs to each module (one transaction each, per the audit); the host does not verify it. Crash-during-migration and other failure injection are U-16.
- Real user data is still blocked from host builds until the prompt, restore UI and U-15 are done.

## Rollback

Revert the PR. The only change to existing behavior is a backup before an upgrade that does not occur today, so with schemas at 1 the host behaves as before apart from the banner area staying empty.
