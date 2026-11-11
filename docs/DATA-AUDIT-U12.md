# U-12 — Audit of the existing data stores

Issue: [U-12 (#12)](https://github.com/arlecchinoOPSource/Unhollowed/issues/12). Date: 2026-11-12. Builds on [AUDIT-U-01.md](AUDIT-U-01.md) §3 and §5 and [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md); it records only what was verified here.

**Method.** The pinned host (Swish `c29ded9`, Terminal `0c7b9e9`, Ember `2351a23`) was run on macOS 26.5.1 (arm64) with a debug-only synthetic data root (`UNHLW_DATA_ROOT`) and its self-test, which creates one synthetic project, entry and habit. The resulting files were then opened read-only with `sqlite3 3.51.0` (`.schema`, `PRAGMA`s, row counts), and the open/migration code of each store was read. No real user data was touched. Windows was not run natively.

## Files, locations and permissions (measured)

| Module | Folder (identifier) | Database | Folder mode | File mode |
| --- | --- | --- | --- | --- |
| Terminal | `com.arlecchino.terminal` | `journal.sqlite3` (+`-wal`, `-shm`) | `0700` | `0600` (also `-wal`/`-shm`) |
| Ember | `com.arlecchino.ember` | `ember.sqlite3` (+`-wal`, `-shm`) | `0700` | `0600` |
| Swish | `com.arlecchino.swish` | `swish.sqlite3` (+`-wal`, `-shm`) | **`0755`** | **`0644`** |

The host resolved all three folders under the one synthetic root as `<root>/<identifier>/`, as decided in U-33.

**Finding F1 — Swish's data is not private.** Terminal and Ember set `0700`/`0600` explicitly and have tests for it (Terminal `storage.rs`, Ember `storage.rs`). Swish sets nothing and inherits the umask, so its folder and files are world-readable on a default macOS umask. Whether another local account can reach them depends on the parent folders (`~/Library/Application Support` is normally inside a home folder other users cannot enter), so this is defence in depth, not an open door. The fix belongs in Swish (set the modes as the others do); it is not part of the host.

## Schemas and pragmas (measured from the real files)

| | Terminal | Ember | Swish |
| --- | --- | --- | --- |
| `user_version` | 1 | 1 | 1 |
| `application_id` | 0 | 0 | `1398231880` ("SWSH") |
| `journal_mode` | wal | wal | wal |
| `synchronous` | FULL (code) | FULL (code, tested) | FULL (code) |
| `integrity_check` | ok | ok | ok |
| Busy timeout | 3 s | 3 s | 5 s |
| `foreign_keys` | not used | ON per connection | ON per connection (checked at open) |
| Tables | `entries`, `entry_sequence`, `settings` (+ index `entries_modified`) | `habits`, `completions` (+ index `completions_by_date`) | `projects`, `reminders` (+ index `reminders_by_project`), both `STRICT` |
| Notable constraints | `json_valid(content)`, `revision > 0`, `schema_version = 1` per entry, singleton counter | `habits.sort_order UNIQUE`, composite key on `completions` | id length 36, date `GLOB` checks, `ON DELETE CASCADE` for reminders |

**Finding F2 — only Swish marks its file as its own.** Terminal's and Ember's files carry `application_id` 0 and the same `user_version` (1) as each other, so a file placed in the wrong folder is detected only by missing tables, not by a stamp. Low risk today (the host picks folders by identifier), but a backup or restore routine must verify what it is restoring, not trust the file name.

**Finding F3 — Terminal has two version fields.** The database `user_version` and a per-entry `schema_version` (constrained to 1). A future entry format needs a migration that moves both; a host that only reads `user_version` would miss the second.

## Migrations and newer files (code read, plus tests that exist upstream)

- All three schemas are at version 1, created from scratch by `migrate`. **No migration has ever run on an existing v2 file**, so the one-way door of U-14 has not been exercised.
- A **newer** schema is refused before any write by all three (Terminal and Ember tests open a file set to `user_version` 99 and check it is unchanged; Swish checks before touching the file and also refuses other apps' `application_id`).
- **Backup before migrate: none in any app.** The migration code has no backup step. This is the gap U-14 closes at the host level.

## Concurrency and conflict control (code read)

- Terminal: immediate transactions and an `entries.revision` compare; a stale save or delete is rejected.
- Ember: per habit-day toggles (a set/unset of one `(habit_id, date)` row), so two writers rarely conflict; no revision.
- **Finding F4 (resolves the open item in U-33) — Swish is last-write-wins.** `update_project`/`update_reminder` write whole fields by id inside an immediate transaction with no expected version (`ProjectInput` and `ReminderInput` carry no version field). Two processes editing the same project silently overwrite each other; the transaction only keeps each write atomic. This matters for U-15.

## Permission boundaries in the host (verified)

- The host's window may call only the commands listed in `src-tauri/capabilities/main.json` (a test checks the list against each module's command set); no page has file-system or dialog permission. Backup, export and restore open their native dialogs from Rust.
- Modules are same-origin iframes behind build-time adapters; every command is routed to its own plugin (`plugin:<module>|…`), checked by the native self-test for all three.
- A module's plugin receives its own folder only, injected by the host.

## What remains unverified

- **Windows paths.** `%APPDATA%\<identifier>\` is from Tauri's source, not a native run; Roaming-profile and network-profile behaviour of WAL files is untested (U-27).
- Resolved paths for a *release* build: the debug override (`UNHLW_DATA_ROOT`) was used here; the real `dirs::data_dir()` resolution for identifier `com.arlecchino.unhlw` was not exercised.
- Behaviour on corrupted files, full disks and killed processes (U-16).

## Follow-ups this audit creates

1. Swish: set `0700`/`0600` (F1) — a Swish PR, needs the owner's go-ahead.
2. Swish update conflicts (F4) — decide in U-15 whether a version field is added upstream or the host warns.
3. Backups and restores verify the file's identity (F2) and migrate both Terminal version fields (F3) — U-14.
