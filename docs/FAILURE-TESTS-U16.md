# U-16 — Failure-injection tests for data integrity and recovery

Issue: [U-16 (#16)](https://github.com/arlecchinoOPSource/Unhollowed/issues/16). Date: 2026-11-12. Code: `crates/data-safety/src/failure_tests.rs`, plus the native phases in `scripts/native-selftest.mjs`. Synthetic data only; source revisions as pinned in `modules.json` (Swish `c32d85c`, Terminal `0c7b9e9`, Ember `2351a23`).

## What each injected failure shows

| Failure injected | Test | Result |
| --- | --- | --- |
| Another connection writes continuously while backups are taken | `backups_taken_while_another_connection_keeps_writing…` | 6 backups, each verified; rows only grow; no write lost |
| A write is open but uncommitted | `an_uncommitted_write_is_not_in_a_backup…` | backup holds committed rows only and is not blocked |
| Power cut (files copied while the writer is open and never closed) | `a_crash_image_of_the_files_reopens…` (not on Windows: a mapped `-shm` cannot be copied) | reopens with every committed row, integrity `ok` |
| Database truncated mid-page | `a_truncated_database_is_refused…` | backup refused, original byte-identical, nothing offered, no `.partial` left |
| A page of garbage | `a_page_of_garbage_in_the_middle…` | integrity check fails, no backup offered, original untouched |
| Backup process killed mid-copy | `a_backup_killed_halfway…` | only a `.partial`, never listed, removed by retention; a later backup works |
| Backup folder cannot be created (unix, non-root) | `a_backup_folder_that_cannot_be_created…` | error, file unchanged, no notice, so the migration does not proceed |
| Backup folder has loose modes | `a_backup_folder_with_unsafe_modes…` | tightened to `0700`/`0600` |
| Restore cannot stage its file (unix, non-root) | `a_restore_that_cannot_stage…` | "Nothing was changed", file identical, safety copy kept |
| Empty file | `an_empty_file_is_treated_as_fresh…` | seen as fresh; a copy of it can never be restored |
| Older file at upgrade time | `an_older_file_is_backed_up…` | verified copy at the old schema, original bytes unchanged |
| Inspecting at any supported version | `inspecting_a_file_never_changes_its_bytes` | bytes identical |

Earlier tests (U-14) already cover: failed copy refuses and leaves the file unchanged, damaged/foreign/newer backups refused, bad restore paths, restart persistence of data in the real host (native phases 1–3 reopen the same synthetic data), and the failed-copy path through the real dialog.

Run: `cargo test -p unhlw-data-safety` (25 tests).

## Not covered, and why

- **Disk full.** Not injected (needs a quota-limited volume). The designed behaviour — the verified copy fails and the migration is refused — is tested with an unusable backup location instead, which exercises the same error path, not the same cause.
- **A migration that fails halfway.** Each module runs its migration in one transaction in its own code. The host cannot inject a failure there without editing the modules; the host's guarantee is the verified copy taken first, restorable through the UI.
- **Killing the whole host process mid-write** (`kill -9`) and **a standalone app running at the same time** are not run natively. The crash-image test is the file-level equivalent for the first; the second is U-15.
- **Windows.** The engine tests run in Windows CI; the permission-injection tests and the crash image are unix-only. Roaming-profile behaviour is U-27.
