# U-13 — How the host and the standalone apps share the same data

Issue: [U-13 (#13)](https://github.com/arlecchinoOPSource/Unhollowed/issues/13). Date: 2026-11-12. Evidence: [DATA-AUDIT-U12.md](DATA-AUDIT-U12.md). Extends decisions 1–8 of [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md), which already chose *shared files, per-app schemas*; this document turns that into rules for access, version compatibility and permissions. Items marked **Proposed** need the product owner's approval.

## The model

The host and a standalone app are two programs reading and writing **the same file**: `<data_dir>/<module identifier>/<database file>`. There is no merged store, no copy and no host-owned schema. The module's own library opens the file, so every rule of that module (constraints, migrations, refusal of newer files) applies identically in both programs.

| File | Owner of the schema |
| --- | --- |
| `com.arlecchino.terminal/journal.sqlite3` | Terminal |
| `com.arlecchino.ember/ember.sqlite3` | Ember |
| `com.arlecchino.swish/swish.sqlite3` | Swish |

## Who may open the file, and when

- Both programs may be open at once. SQLite's write-ahead log and the modules' immediate transactions keep each write atomic (audit: all three use WAL, `synchronous=FULL`, 3–5 s busy timeouts).
- **What this does not give you:** a running program is not told about the other's writes, and Swish's updates are last-write-wins (audit F4). The host notices another program's commits and offers a reload (see [CHANGE-NOTICE-U15.md](CHANGE-NOTICE-U15.md)); it does not merge or resolve conflicts.
- The host opens a file only through the module's own code, after [`prepare`](DATA-SAFETY-U14.md) has had the chance to back it up. It never rewrites, migrates, copies or deletes a module's file by itself. The one exception is a restore from a verified backup, which requires the module to be off and saves a safety copy first.
- Real user data stays out of host builds until U-14's remaining items and U-15 pass (accepted earlier; the host still uses synthetic roots in debug builds).

## Version compatibility, both directions

Compatibility is the file's `PRAGMA user_version`, owned by the module.

| Situation | What happens | Who protects the data |
| --- | --- | --- |
| Host and standalone write the same schema | Both work | — |
| **Host's module is newer** than the file | Opening migrates the file. The host asks the person first; only after they confirm does it make a verified copy, and it refuses to proceed if it cannot copy. A standalone app older than the new schema will then **refuse the file** (the one-way door) | The host (U-14) |
| **Standalone is newer** than the host's module | The standalone migrates. The host's older module refuses the file with the module's own message and changes nothing (tested upstream for all three) | The module |
| File from another app or damaged | The module refuses (Swish checks `application_id`; Terminal and Ember find missing tables) | The module |

Rules for any future schema change (**Approved by the product owner, 2026-11-12**; to be written into each module's contributor guide):

1. Migrations are forward-only, run in one transaction, and refuse a newer file before any write (already true for all three).
2. A schema bump changes the module's `schema_version` declared in the host (`ModuleInfo`). A test in each plugin fails until it does, so the backup-before-migrate rule cannot silently stop applying.
3. The host's release notes list the schema version of each bundled module, so a person can tell whether an older standalone will still open the data.
4. Terminal has a second version, per entry (audit F3); a bump of the entry format must move both.
5. Terminal and Ember files carry no `application_id` (audit F2). Add one **with the next schema bump** (it is a write, so it needs a migration; not worth a bump on its own).

## Permissions

- Folder `0700` and files `0600` on macOS (including the `-wal`, `-shm` and `backups/` contents) — true for all three since Swish PR 39 (audit F1), and guarded by the native test, which fails if any file or folder under a module's data folder, including the host's `backups/`, is group- or world-accessible.
- The host passes a module's plugin its own folder only. No page has file-system or dialog permission; backups and exports use native dialogs opened from Rust.
- The host's backups are written `0600` in a `0700` `backups/` folder inside the module's folder, so they are as private as the data they protect.
- Windows: files inherit the permissions of the Roaming profile folder. Not verified natively (U-27); do not claim equivalent privacy there.

## What this deliberately does not do

- No exclusive lock between host and standalone (it would break "standalone stays independently usable" while the other runs).
- No cross-app transactions, and no promise that two programs editing the same row converge (U-15).
- No downgrade path: restoring the pre-migration copy is the only way back, and it discards later changes.

## Decisions (owner, 2026-11-12)

1. **Approved:** the five rules above for schema changes.
2. **Approved:** Swish gets an expected-version check upstream (audit F4). Swish PR [#40](https://github.com/arlecchinoOPSource/Swish/pull/40) adds an optional `expectedUpdatedAt` to `update_project` and `update_reminder` (no schema change, so no migration): a stale edit is refused with the existing `changed` error and the other change is kept. Merged as Swish `b9a244f` and pinned in the host from that commit, so a stale Swish edit in the host is now refused (verified by Swish's own tests; the host's native test does not drive a concurrent Swish edit). Terminal's revision check and Ember's per-day toggles already behaved this way.
