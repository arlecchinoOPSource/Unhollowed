# U-15 — Concurrent use with a standalone app, and change notification

Issue: [U-15 (#15)](https://github.com/arlecchinoOPSource/Unhollowed/issues/15). Date: 2026-11-12. Builds on [DATA-AUDIT-U12.md](DATA-AUDIT-U12.md) (F4) and [DATA-COMPAT-U13.md](DATA-COMPAT-U13.md). Source revisions: Swish `c32d85c`, Terminal `0c7b9e9`, Ember `2351a23`.

## What was found (code read, pinned revisions)

- Writes are safe: all three modules use WAL, `synchronous=FULL`, immediate transactions and busy timeouts, so two programs never corrupt the file (and U-16 injects a busy writer during backups).
- **Nothing tells a running program about the other's writes.** Only Swish (`today.ts`) and Ember (`hooks.ts`) re-read on window focus, and only the narrow data those hooks load; Terminal does not re-read at all. So a module can keep showing old data after a standalone app changed the file.
- Conflict control differs: Terminal rejects a stale save (`entries.revision`); Ember toggles one habit-day at a time; **Swish updates whole fields by id with no expected version (last write wins, F4).**

## Policy (this PR) — notify, do not merge

The host cannot safely push new data into a module's screen (it would replace what the person is typing) and must not edit the modules to do so. So:

1. **Detect.** For each module whose plugin is registered, the host runs one thread with its own read-only connection and asks SQLite once a second for `PRAGMA data_version`, which changes only when *another connection* commits (`ChangeWatcher`, `crates/data-safety`). It reads no rows and writes nothing; a replaced or briefly unreadable file starts a new baseline instead of raising an alarm.
2. **Tell the page** with the event `unhlw-data-changed` (module name only).
3. **Ignore the module's own commits.** The watcher also sees the module's own writes. The adapter stamps each module command (at start and when it settles) on the host window; the page treats a change as another program's only if the module made no call in the last 3 s (`src/changes.ts`).
4. **Offer a reload**, for a running module only (a module that is off reads fresh when powered on): a notice names the module and says another program changed its data. *Reload* is the existing power-off path (the module saves first; if it cannot confirm, the unsaved alert takes over) followed by power-on from the current data. *Dismiss* keeps going.
5. **Conflicts are not resolved by the host.** Terminal keeps rejecting a stale save through its own revision check. Swish stays last-write-wins; the notice is the host's mitigation for F4. Whether Swish gets an expected-version check upstream remains the owner's decision (U-13, decision 2); nothing was changed in Swish.

## Evidence

- `cargo test -p unhlw-data-safety`: 17 tests, 4 new for the watcher (another connection's commit reported once; quiet file quiet; uncommitted write not a change until it commits; file never modified; a replaced file settles).
- `npm test`: 31 tests, including the classification rule and that the adapter stamps activity at start and on failure.
- Native, macOS 26.5.1 arm64, 33/33: a fourth phase starts the real host, powers on Swish and leaves it alone for 8 s (no notice, no change recorded), then a **separate process** commits to Swish's file every 1.5 s; the page showed the notice naming Swish, *Reload Swish* produced a new frame, and the notice cleared.

## Limits (not hidden)

- **Latency:** about one second of polling plus the 3 s own-write window.
- **False negative:** another program's write that lands within 3 s of the module's own command is not reported. A later change is.
- **False positive:** none seen; a module that writes without a command call (it has none) would be reported.
- **Native own-write classification is not exercised end to end** (it would need driving Swish's UI in that scenario); the rule and the adapter stamping are unit tested.
- **The notice does not merge or show a diff**, and does not stop the person from saving over newer data in Swish before they reload.
- **Windows:** the watcher and phase run in CI on Windows but were not run natively by the author. Whether a read-only connection on a file another process holds open behaves identically on a Roaming profile is untested (U-27).
- **Standalone-versus-host with real standalone binaries** was not run; another process writing the same file stands in for it.

## Rollback

Revert the PR. The watcher is read-only; removing it returns to the previous interim rule (re-read on focus where a module does so).
