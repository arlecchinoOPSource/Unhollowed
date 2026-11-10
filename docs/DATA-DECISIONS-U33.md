# U-33 — Host identifier, data locations and migration policy

Issue: [U-33 (#35)](https://github.com/arlecchinoOPSource/Unhollowed/issues/35). Date: 2026-11-10. Evidence: source of Terminal `420a5e6`, Ember `5af1eae`, Swish `735370a` and Tauri 2.12.5, plus native test runs. See also [AUDIT-U-01.md](AUDIT-U-01.md) §5 and [DATA.md](DATA.md).

## What the source shows

**Where data lives.** Each app calls Tauri's `app_data_dir()`, which Tauri 2.12.5 implements as `dirs::data_dir()` joined with the app's bundle identifier (`path/desktop.rs`). The folder therefore depends entirely on the identifier of whichever app is running.

| Module | Identifier | Files in its folder | Source of the path |
| --- | --- | --- | --- |
| Terminal | `com.arlecchino.terminal` | `journal.sqlite3` (+`-wal`, `-shm`), `backups/before-restore-<ms>.json` | `lib.rs` lines 203, 373 |
| Ember | `com.arlecchino.ember` | `ember.sqlite3` (+`-wal`, `-shm`), `sound.json`, `Exports/` | `lib.rs` lines 48, 312 |
| Swish | `com.arlecchino.swish` | `swish.sqlite3` (+`-wal`, `-shm`), `backups/before-restore-*.json` | `main.rs` `data_dir()` (debug-only `SWISH_DATA_DIR` override) |

| Platform | `data_dir()` | Status |
| --- | --- | --- |
| macOS | `~/Library/Application Support/<identifier>/` | Matches Ember's `DATA.md`; Terminal/Swish same mechanism |
| Windows | `%APPDATA%\<identifier>\` (Roaming) | From Tauri source and Ember's `DATA.md`; **not run natively here** |

**How each store behaves** (source, plus passing native tests: Terminal 34, Ember 22, `swish-data` 56):

| Behaviour | Terminal | Ember | Swish |
| --- | --- | --- | --- |
| Schema version | `user_version` 1 | `user_version` 1 | `user_version` 1 (one migration) |
| Newer schema | Refused, file unchanged (test) | Refused (test) | Refused before any write (`check`); also refuses other apps' files via `application_id` |
| Journal / sync | WAL, `synchronous=FULL` | WAL, `synchronous=FULL` | WAL, `synchronous=FULL` |
| Busy timeout | 3 s | 3 s | 5 s |
| Write conflict control | Immediate transactions; entries carry a `revision`, stale save/delete rejected (test) | Per-habit-day toggle; no revision | Immediate transactions; command signatures carry no expected version (inputs not read) |
| Backup before migrate | **None** (migration code has no backup step) | **None** | **None** |
| Backup before restore | JSON copy in `backups/` | Private pre-restore JSON | Safety copy in `backups/` |

All three schemas are at version 1, so **no migration has ever run on a v2 file**. The one-way door (a newer module migrates a file that an older standalone then refuses) is real but not yet exercised.

**What blocks reuse of the existing paths.** Every app resolves its folder internally, so a host with a different identifier would look in the wrong folder and show empty data.

## Decisions (recommended, pending product-owner approval)

1. **Host identifier: `com.arlecchino.unhlw`** (name proposed; the owner may choose another). It is **irreversible after the first release**: changing it later changes the host's own settings folder and update identity. Aligned with U-36.
2. **Modules keep their existing files and folders.** No merged store, no new shared schema, no copying databases into a host folder.
3. **The host resolves module folders explicitly:** `<data_dir>/<module identifier>`, taken as a sibling of the host's own `app_data_dir()` (equivalently `dirs::data_dir()`). Modules must **accept an injected data directory** instead of calling `app_data_dir()` themselves; the extraction issues (U-06, U-08, U-10) change those call sites. Debug builds accept `UNHLW_DATA_ROOT` pointing to a throwaway root containing the same three subfolders; release builds ignore it (same pattern as Swish's `SWISH_DATA_DIR`).
4. **Synthetic data only until U-14 and U-15 pass** (already accepted).
5. **Schema ownership stays with each module.** The host bundles specific module versions and lists their schema versions in its release notes. A host refuses a newer-than-supported file using the module's own check and shows the module's message.
6. **Migration rule (applies from the first v2 schema, since none exists today):** before any module migrates a real file, the host takes a verified copy (SQLite online backup into the module's `backups/` folder, plus the module's own export where it has one) and records it. If the copy fails, the migration does not run. The user is told, before it runs, that older standalone releases will refuse the migrated file. No downgrade path is promised; restore from the pre-migration copy is the only way back.
7. **Concurrent standalone and host use is permitted at the file level** (WAL, immediate transactions, 3–5 s busy timeouts) with a documented limitation: nothing notifies a running process of another process's writes, so views can be stale. Interim host behaviour: re-read module data on window focus and after errors. Change notification and conflict policy are U-15; options such as a cross-app lock-out were considered and not chosen now.
8. **Backups remain per-module formats in each module's folder.** A host-level "back up everything" may later call each module's export; formats are not unified.

## Alternatives considered

- **A merged UNHLW store** (new database, imports from three apps): rejected; it changes standalone behaviour, doubles migration risk, and nothing in the audit needs it.
- **Copy each module's data into the host folder on first run:** rejected; two diverging copies of the same user's history.
- **Exclusive lock between standalone and host:** deferred to U-15; simple, but breaks the "standalone remains independently usable" promise while the other runs.

## Risks and open items

- **Windows paths are unverified natively.** Windows `data_dir()` is the Roaming profile folder; SQLite WAL files on roaming or network profiles can misbehave. The existing apps already live there; test in U-27.
- **Identifier is irreversible** after release (item 1).
- **No backup-before-migrate exists in any app**; item 6 requires new code (U-14).
- **Swish conflict control is unverified** (inputs not read); confirm before relying on it.
- The data-folder injection touches three other repositories; each needs separate owner authorization.

## Verification

Read-only source inspection; `cargo test --locked` in the Terminal and Ember crates (34 and 22 tests passed) and `cargo test -p swish-data` (56 passed) on macOS, Rust 1.99.1. No app was launched and no real user data was touched.
