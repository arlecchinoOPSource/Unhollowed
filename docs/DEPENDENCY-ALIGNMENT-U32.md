# U-32 — Native dependency alignment

Issue: [U-32 (#34)](https://github.com/arlecchinoOPSource/Unhollowed/issues/34). Date: 2026-11-10. Evidence branch: `spike/u32-dependency-alignment` (`spikes/u32`, throwaway). Gap: G1 in [AUDIT-U-01.md](AUDIT-U-01.md).

## Question

Can the Rust backends of Terminal, Ember and Swish live in one Cargo build graph, and what is the smallest change that makes them?

## Method

Cloned the three apps at the audited commits (Terminal `420a5e6`, Ember `5af1eae`, Swish `735370a`) into a scratch folder and made a `u32-combined` crate depending on `terminal-journal`, `ember-by-arlecchino` and `swish-data` by path. Ran `cargo generate-lockfile`, `cargo tree`, `cargo check` and the `swish-data` tests with Rust/Cargo 1.99.1 on macOS. No repository was modified; the Swish change was made only in the scratch clone.

## Results

| Check | Result |
| --- | --- |
| Locked SQLite crates in each app | Terminal and Ember: `rusqlite 0.41.1`, `libsqlite3-sys 0.39.1`. Swish: `rusqlite 0.37.0`, `libsqlite3-sys 0.35.0` |
| Terminal + Ember together | Resolves; one `libsqlite3-sys 0.39.1` |
| All three together | **Fails**: `libsqlite3-sys` links to native library `sqlite3` and conflicts with a second copy (Cargo's `links` rule, not fixable by feature flags) |
| Swish `swish-data` baseline tests (rusqlite 0.37) | 56 pass |
| After changing `swish-data` to `rusqlite = "0.41"` (one line plus lockfile) | 56 tests pass unchanged; app crate `cargo check --locked` passes; all three resolve to one `rusqlite 0.41.1` / `libsqlite3-sys 0.39.1`; `cargo check` of the combined crate passes |
| Other shared versions in the combined lockfile | One `tauri 2.12.5`, one `tauri-plugin-dialog 2.8.4` (Terminal asked `2.8.3`, Swish `2.8.4`), one `tauri-build 2.7.4` |
| Duplicate crates (`cargo tree -d`) | Ordinary transitive duplicates (for example `base64`, `getrandom`, `indexmap`); none carries a `links` key |

## Crate shape for a host

- **Terminal** (`terminal-journal`, lib `app_lib`) and **Ember** (`ember-by-arlecchino`, lib `ember_lib`): already libraries, but each exposes only `run()`, which builds and runs the whole Tauri app. A host needs command registration and storage as reusable pieces, not `run()`.
- **Swish**: `swish-data` is Tauri-free and reusable; the app crate `swish` is binary-only, so its command layer (`main.rs`) cannot be depended on until it gets a library target.

## Recommendations

1. **Change `swish-data` to `rusqlite 0.41`** in the Swish repository. It is a one-line change; the issue is filed as [Swish#35](https://github.com/arlecchinoOPSource/Swish/issues/35). Before release, run Swish's native and backup checks and old-schema fixtures, because the bundled SQLite engine version changes.
2. **Policy:** all three apps and the UNHLW workspace stay on the same `rusqlite` minor and the same Tauri 2.12.x line; upgrades happen in all repos together. UNHLW CI should run a resolution check (`cargo generate-lockfile` on a combined manifest) to catch drift early.
3. **For UNHLW's native workspace**, use `[workspace.dependencies]` for `tauri`, plugins, `rusqlite`, `serde`, `serde_json` and pin the app crates by tag or commit (not branch), per the release-hygiene issue U-34.
4. **Extraction work (U-06, U-08, U-10)** should produce, per app: a Tauri-free data crate, plus a small Tauri plugin that registers prefixed commands (matching the accepted U-31 baseline). Editing those repositories needs separate owner authorization.

## Not verified

- No app was launched; only compile, resolution and the `swish-data` tests ran. Terminal's and Ember's own test suites were not run.
- Behavior of the newer bundled SQLite on real Swish data; Windows builds; release-profile builds.
- Whether Terminal's and Ember's `cdylib`/`staticlib` crate types cause trouble when the crates are linked into a larger binary beyond `cargo check` (not linked or run here).
