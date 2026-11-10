# U-01 — Audit of Core and existing application integrations

Date: 2026-11-10 · Issue: [Unhollowed#1](https://github.com/arlecchinoOPSource/Unhollowed/issues/1) · Method: read-only inspection of the Terminal, Ember, Swish and Unhollowed default branches via the GitHub API, plus an owner-supplied zip of Core `main` (Core is private). Nothing was built, run or modified; no user data touched.

## 1. Verdict

**The plan's intent, governance and honesty rules are strong. Its structure has gaps that should be fixed before U-03 and U-05 lock in the foundation.** The audit found four problems the current backlog does not mention, and one that blocks the build outright:

1. **Two incompatible `rusqlite` versions** (0.37 in Swish, 0.41.1 in Terminal and Ember). Both bundle SQLite via `libsqlite3-sys`, which declares a native `links` key, so Cargo should refuse to put them in one binary. Confirm with `cargo tree` in U-03.
2. **No app can be mounted as a module today.** Each Tauri app owns the whole process: window "main", close/exit interception, `app.exit(0)`, a flat command namespace, one global `<html data-theme>`, and its own audio/startup/shortcut singletons.
3. **Data location is derived from the Tauri identifier.** A host with a new identifier resolves a different app-data folder, so existing journals/habits/reminders would silently appear empty.
4. **The embedding model is never compared against alternatives.** The docs jump to "mount modules in React"; the evidence points to needing a spike comparing in-DOM modules with isolated webviews/frames.
5. **Release metadata is already inconsistent** (Ember tag `v2.0.2` points at a commit whose manifests say 2.0.1; Swish crate says 0.1.0 while the app says 2.0.1).
6. **Core is UI-only and the three apps sit on three different UI generations.** Core `suite-ui` is 0.5.1 (TypeScript/React/CSS, no Rust, no host or module-lifecycle concepts). Ember carries a fork at 0.2.0, Terminal carries none, Swish pins Core. Migrating Terminal and Ember onto Core (C-11/C-12) is gated behind Core 1.0 (C-10), so this divergence will still exist while UNHLW's integration milestones run. Core provides nothing a host contract can build on; U-05 is greenfield.

## 2. Evidence (commits inspected)

| Repo | Default-branch commit | Manifest version | Latest release | Notes |
| --- | --- | --- | --- | --- |
| [Terminal](https://github.com/arlecchinoOPSource/Arlecchino-s-Terminal-Journal/commit/420a5e66d1a3bd1c771dafce1ec0a33db7e7f7f8) | `420a5e6` | 2.0.1 | v2.0.1 | consistent |
| [Ember](https://github.com/arlecchinoOPSource/Ember-by-Arlecchino/commit/5af1eae6020f69eeed56a7aa7f63f3a93ad12ae3) | `5af1eae` | 2.0.1 | **v2.0.2** | tag `v2.0.2` = `5af1eae`, a commit that says "ships as 2.0.1"; open issue #34 "2.0.2" |
| [Swish](https://github.com/arlecchinoOPSource/Swish/commit/735370a0b62494c66d1ff1c208ac54e377891313) | `735370a` | npm/tauri 2.0.1, **Cargo 0.1.0** | v2.0.1 (also v1.0.0, v1.0.1) | open issue #34 titled "1.0.1" though 1.0.1 shipped |
| Core | Swish pins gitlink `42b811f`; inspected a **zip of `main`** supplied by the owner (no git metadata, so its commit is unknown) | root 0.1.0, `@arlecchino/suite-ui` **0.5.1** | none | repo is still private (404 to API); zip may be ahead of Swish's pin (earlier cached audit saw suite-ui 0.5.0 at `42b811f`) |
| Unhollowed | `3fa63d1` | — | — | docs only |

Drift from `docs/AUDIT-DRAFT.md` (cached refs): Swish `002a6f3` → `735370a`; Ember `46323a4` → `5af1eae`; Swish's Core pin `60971fb` → `42b811f`. Terminal unchanged. The draft's cache was stale, as it warned.

## 3. Per-repo findings

### Terminal (crate `terminal-journal`, identifier `com.arlecchino.terminal`)
- Stack: Tauri 2.12.5, React 19.3.1, Vite 8.3.5, TS 7.0.2, Tiptap 3.32.2, rusqlite 0.41.1 bundled, `tauri-plugin-dialog`.
- Crate is a **library** (`app_lib`) whose `run()` builds the entire app. `journal.rs`, `storage.rs`, `backup.rs`, `preferences.rs` are separate modules; only `lib.rs` is coupled to Tauri.
- Commands (13): `journal_list/last/select/save/delete`, `journal_finish_exit`, `preferences_get/set`, `backup_export/choose/restore/cancel`, `entry_export`.
- Storage: `journal.sqlite3` in `app_data_dir()`. Tables `entries`, `entry_sequence`, `settings`. `user_version` 1, future versions rejected. WAL, `synchronous=FULL`, 3 s busy timeout, one `Mutex<Connection>`. Owner-only permissions on Unix. `entries.revision` provides optimistic concurrency (`journal_delete` takes an expected revision; save semantics not read).
- Window/exit: intercepts `CloseRequested` and `ExitRequested`, emits `journal-close-requested`, `emit_to("main")`, then `app.exit(0)` in `finish_exit`.
- Tests: `npm run check` = oxlint, tsc, node tests, web build, Playwright, cargo fmt/clippy/test, `sqlite_schema.py`.
- Shared UI: **does not use suite-ui**; owns `tokens.css`/`app.css`.

### Ember (`desktop/`, id `com.arlecchino.ember`)
- Same toolchain versions; rusqlite 0.41.1, chrono, sha2. Library crate `ember_lib` with `run()`.
- Commands (17): `habits_*` (7), `completions_month/toggle`, `practice_days`, `export_history`, `restore_history`, `website_snapshot`, `finish_exit`, `play_startup_sound`, `sound_preferences_set`, `startup_sound_native`.
- Storage: `ember.sqlite3` plus `sound.json` and `Exports/` in app data. Schema v1 (`habits`, `completions`), future/damaged DB reported and untouched. Fixture: `tests/fixtures/v1-synthetic.sql`.
- Shell/UI: **in-repo `packages/suite-ui`** (`file:../packages/suite-ui`), not the external Core.
- macOS-specific: spawns `/usr/bin/afplay` for startup/close cues; reads `sound.json` before the webview loads.
- History of ACL bugs: v2.0.0 shipped commands without permissions (`habits_delete_preview not allowed by ACL`). Fixed with an ACL test keeping `generate_handler!`, `build.rs` and the capability in step.

### Swish (id `com.arlecchino.swish`)
- Same frontend toolchain; **depends on Core's suite-ui via git submodule** `vendor/arlecchino-core` at `42b811f` (`file:vendor/arlecchino-core/packages/suite-ui`).
- Best-separated backend: Tauri-free `swish-data` crate (`src-tauri/data`, workspace member) holds domain, migrations, backup. **But** it uses `rusqlite 0.37`, and the app is a **binary crate only** (`main.rs`, no lib target), so its command layer cannot be reused as a dependency without refactoring.
- Commands (15): `load_workspace`, project/reminder CRUD, `export_backup`, `inspect_backup`, `cancel_restore`, `restore_backup`, `undo_restore`, `finish_exit`.
- Storage: `swish.sqlite3`, `PRAGMA application_id = 0x53575348`, foreign keys on, `trusted_schema=OFF`, WAL, `synchronous=FULL`, 5 s busy timeout, STRICT tables, append-only migrations. Command signatures show no expected-version parameter (inputs not read), so conflict handling is probably last-write-wins; verify.
- Window: `create: false`; main window built in `setup`. Debug-only `SWISH_DATA_DIR` override.
- Bundle targets `app`, `nsis` only (the v1.0.0 release notes mention a DMG; reconcile).
- `npm run check` is **build only** (tsc + vite); native tests are separate.
- CI: private Core needs a read-only deploy key secret `CORE_READ_KEY`; fork PRs cannot run it.

### Core (`Arlecchino-Core`, inspected from owner-supplied zip of `main`)
- **Contents:** one package, `packages/suite-ui` (`@arlecchino/suite-ui` 0.5.1, private, MIT): about 1.2k lines of TypeScript/TSX/CSS plus five bundled WAV cues. Root workspace 0.1.0. **No Rust, no Tauri code, no storage, no host/module/lifecycle abstractions**; Core's own docs say apps keep storage, permissions, identifiers and release pipelines.
- **Exports:** theme tokens and `applyTheme`, motion levels, startup screen, `AppShell`/`Rail`/`BrandMark`/`IdentityStrip`/`StatusBar`, `Icon`/`IconButton`/`Popover`/`Modal`, `CompletionControl`, preference panels (`ThemeControls`, `SoundControls`, `MotionControls`), and a Web Audio `SoundManager`.
- **Consumption:** TypeScript source compiled by the app's Vite build; a `file:` dependency (Swish: `file:vendor/arlecchino-core/packages/suite-ui`) needs `preserveSymlinks` and React dedupe. Peer deps: React ^19, `@fontsource/ibm-plex-mono` 5.3.0, `@fontsource/orbitron` 5.3.0, matching the three apps.
- **Tests/CI:** pure Node tests (tokens, WCAG contrast, motion, startup, CSS hygiene, sound) and a `compare:terminal` script. CI is one job (`npm test` on ubuntu, `actions/checkout@v4`, `setup-node@v4`, tags not SHA-pinned). No consumer build in CI, despite roadmap item C-09 and Swish's docs mentioning "Core's existing contract tests".
- **Embedding-relevant behaviour (new evidence for G4):**
  - Good: theme tokens are scoped to `[data-theme]` on any element and `applyTheme(theme, root)` accepts a root, so per-module theming inside one document is feasible.
  - Bad: `applyMotion` defaults to `document.documentElement` and motion CSS only matches `:root[data-motion]`; `shell.css` sets global `* { box-sizing }`, `html, body, #root { height: 100% }` and body background/typography; `StartupScreen` registers capture-phase `keydown`/`pointerdown` listeners on `window`; `Popover` registers document-level `keydown`/`pointerdown`; `Modal` portals to `document.body`; `SoundManager` creates its own `AudioContext` per instance (`createSoundManager`), with page-level visibility/pagehide handlers.
- **Drift inside Core's docs:** `README.md` says suite-ui "0.4.0"; `package.json`, `src/index.ts` and `CHANGELOG.md` say 0.5.1. Root README says Core extracted from Ember; `FOUNDATION-AUDIT.md`/`PROVENANCE.md` cite Terminal `778a8b5` and Ember `63ddadd`, which are older than the commits audited here (Terminal `420a5e6`, Ember `5af1eae`). `suite-ui/README.md` still lists the extraction as "from Terminal 2.0.0" and names Terminal/Ember as users. Core's root has `pnpm-workspace.yaml` but its scripts and README use npm.
- **Audio provenance:** `AUDIO-PROVENANCE.md` records hashes for five cues and states the startup/close recordings are owner-authored Terminal recordings whose suite reuse "follows the owner's framework request". That documents the owner's decision for Core; Ember's `SUITE-UI.md` still says rights are unconfirmed (stale).
- **Adoption chain (Core roadmap):** Terminal migration C-11 and Ember migration C-12 both depend on C-10 (Core 1.0), which depends on C-09 → C-08 → C-04…C-07. Issue states are not readable (private repo); roadmap lists them as open.
- **Divergence of copies:** Ember's in-repo suite-ui is **0.2.0** (no `panels.css`, `Modal`, shared sound manager, or preference controls) versus Core **0.5.1**; Core's own changelog marks 0.5.0 as breaking for sound/preferences APIs. Terminal has no copy.

## 4. Cross-cutting integration gaps

| # | Gap | Evidence | Consequence |
| --- | --- | --- | --- |
| G1 | Two SQLite bindings | Swish-data `rusqlite 0.37`; Terminal/Ember `0.41.1`; all `bundled` | One binary cannot contain both. Align versions (Swish-side change, needs its own issue). |
| G2 | Flat command namespace with name clashes | `finish_exit` in Ember **and** Swish; Terminal uses `journal_finish_exit`; backup/restore verbs overlap in meaning | Needs per-module prefixes or separate webviews. |
| G3 | Each app owns process lifetime | `prevent_close`, `prevent_exit`, `app.exit(0)`, `emit_to("main")`, hard-coded events (`journal-close-requested`, `ember:exit-requested`) | A module's "quit" would quit the whole host. Host must own lifecycle; modules need a `flushAndRelease()` instead of `finish_exit`. |
| G4 | Singleton web environment | `<html data-theme>` by default, global `html/body/#root` rules, `:root[data-motion]`, window-level capture key listeners in `StartupScreen`, document listeners in `Popover`, `Modal` portals to `body`, per-app audio managers, shared `localStorage` origin; Terminal still has its own global CSS | Themes can be scoped per element (`[data-theme]`, `applyTheme(theme, root)`), but motion, resets, startup keys, popovers and modals are global. Needs frames/shadow DOM or webview isolation, or Core changes. |
| G5 | Least privilege cannot hold in one webview | Tauri capabilities attach to windows/webviews; one webview exposing three apps' commands lets any module call any other's | Docs promise per-capability review; real isolation needs separate webviews. Multi-webview support in Tauri 2 is, to my knowledge, behind an unstable flag — **verify in a spike**. |
| G6 | Data path is identifier-derived | All three call `app_data_dir()` | Host identifier ≠ existing identifiers ⇒ empty data. Host must resolve existing sibling folders explicitly. |
| G7 | Three UI foundations | Terminal own CSS; Ember in-repo suite-ui **0.2.0**; Swish pins Core (suite-ui 0.5.x); Core 0.5.0 changed sound/preference APIs incompatibly | C-11/C-12 are gated behind Core 1.0 (C-10). Plan U-06–U-10 around the divergence or pull Core migrations earlier. |
| G13 | Core has no host-facing layer | Core is UI only; no Rust, lifecycle, capability or module concepts | U-05's host contract has no Core foundation; decide whether it lives in UNHLW or Core. |
| G14 | Core's own checks are thin | One `npm test` job, no consumer build, actions not SHA-pinned, doc/version drift (README 0.4.0 vs 0.5.1) | UNHLW's TESTING.md requires SHA-pinned actions; a pinned Core commit must be verified by a consumer build, not just Core's tests. |
| G8 | Ember ACL fragility | Shipped ACL bug, fixed twice | Merging three permission manifests into one host is the same failure class. Keep the ACL-sync test pattern. |
| G9 | Release/source mismatch | Ember `v2.0.2` tag = 2.0.1 commit; Swish Cargo 0.1.0 vs 2.0.1 | Host cannot pin "released" versions reliably until tags map to commits. |
| G10 | No updater/signing | No updater plugin in any Cargo.toml; macOS ad-hoc signed, not notarized; Windows unsigned | U-29 starts from zero. |
| G11 | Asset rights documented inconsistently | Core `AUDIO-PROVENANCE.md` records owner-authored startup/close cues and hashes; Ember `SUITE-UI.md` still says rights need confirmation; Terminal's keyboard sounds include CC BY 3.0 (Clicky) needing attribution | Owner decision for Core's five cues is recorded; reconcile Ember's doc and carry Terminal's attribution into the host (U-28). |
| G12 | Platform-specific code paths | Ember `afplay` child process on macOS; Terminal/Swish different close-sound plumbing | Host audio must be unified or modules told to defer to it. |

## 5. Data and concurrency (documented, not assumed)

- Three separate SQLite files, three identifiers, no shared schema: `journal.sqlite3`, `ember.sqlite3`, `swish.sqlite3`. All use WAL and `synchronous=FULL`; busy timeouts differ (3 s / unspecified in Ember read / 5 s).
- Each process serializes through one in-process mutex. **Nothing coordinates two processes beyond SQLite locking**, and nothing notifies a running process that another changed the file. Standalone + host open at once means stale UI.
- Migrations: all three use `user_version`, forward-only, and refuse newer schemas. A **newer app opening an older file migrates it**; an **older standalone then refuses the file** — this is a one-way door that standalone-preserving upgrades must plan for.
- Backups are app-specific formats (Terminal JSON, Ember versioned JSON with pre-restore copy, Swish backup with safety copy). No common format.
- Not inspected: Terminal `journal.rs`/`backup.rs`, Ember `storage.rs`/`import.rs`/`backup.rs`, `swish-data` `store.rs`/`migrations.rs`, all frontend code, capability files for Ember and Swish.

## 6. Evaluation of the plan

### What is right
- Evidence-first: audit, then architecture, then scaffold. Honest-claims rules (no signing/updates/native claims without proof) match the real state of the three apps.
- "Not a launcher", standalone preserved, no monorepo merge — consistent with what exists.
- Data safety treated as a first-class milestone with synthetic fixtures, backup before migration, concurrency testing.
- Owner-approval gates, one branch per issue, independent review, PR template with risk/rollback.
- Hybrid 2.5D rather than a real-time 3D engine: appropriate scope control.

### What to change (ordered by cost of getting it wrong)
1. **Add an embedding-model decision to U-02, with a spike.** Compare (a) modules mounted in one React tree, (b) one webview per projector with per-webview capabilities, (c) frames. Judge by G2–G5. This is the single decision the rest of the foundation depends on.
2. **Add a "dependency alignment" issue before U-03:** unify `rusqlite`, confirm `cargo tree` resolves in one workspace, align Tauri/plugin versions, decide how each app exposes a library crate (Terminal and Ember already have `lib`; Swish needs one).
3. **Move the data-path and identifier decision into M1 (U-02).** Recommend: host keeps each app's existing files and folders, no merged store, no new schema; U-13's "canonical shared data" should be re-scoped to "shared files, per-app schema" unless the audit later shows a reason to merge. Changing the host identifier later changes where data lives.
4. **Resequence M3 ahead of the integrations (U-07/09/10).** Concurrency and migration direction (G6, §5) shape the module APIs; U-12 largely duplicates §5 and can shrink.
5. **Define the module contract from a first real slice.** Integrate the easiest app (Swish: clean data crate) in U-03/U-05 before drawing the contract for all three, rather than contract-first.
6. **Add a "host owns lifecycle" requirement to U-05/U-11:** replace each app's `finish_exit` with a flush/release hook; host handles close/quit; remove `app.exit` from modules.
7. **Add small hygiene issues:** reconcile versions/tags (G9), settle Core access for CI and for this audit, adopt suite-ui in Terminal or explicitly decide not to (G7), resolve audio rights (G11).
8. **Bring signing/update key and identifier strategy forward** from M6 (G10); changing them late is costly.
9. **Decide where the host contract lives** (UNHLW or Core; Core has no host layer, G13) and whether to pull Terminal/Ember Core migrations (C-11/C-12) ahead of Core 1.0, or plan U-06–U-10 around three UI generations (G7).

### Smaller observations
- Issue numbers and U-IDs are scrambled (e.g. U-05 is #2, U-18 is #20). The docs link correctly; just don't assume `U-nn` = `#nn`.
- GitHub reported `Unhollowed` as `private: false`; the owner has confirmed they made it public. README/CONTRIBUTING still say it is private and that branch protection is unavailable. Re-check branch protection now that the repo is public and update those docs.
- Swish "check" runs only the build, while Terminal/Ember run lint, unit, UI and native checks — CI parity matters for U-04.
- Toolchain versions are well aligned across the three (React 19.3.1, Vite 8.3.5, TS 7.0.2, Tauri 2.12.x, Rust 1.90/edition 2024), which is a real advantage.

## 7. Unverified or inaccessible

- Core's git history, issues and PRs (C-01 … C-13) remain unreadable (private repo); only the zip snapshot was inspected. The zip's commit is unknown, so whether Swish's pin `42b811f` equals this snapshot is unverified. Core was not built; only its source and docs were read, and Core's tests were not run.
- Whether Tauri 2's multi-webview works without an unstable flag in 2.12.x, and whether capabilities can be scoped per frame: needs a spike.
- Runtime behavior: nothing was built or run. Windows behavior, WebView2 specifics, and macOS Gatekeeper behavior are taken from release notes, not tested.
- Swish release assets (DMG vs bundle targets) not reconciled.

## 8. Cross-references

Core, titles and dependencies taken from Core's `docs/ROADMAP.md`; states not verified: [C-01](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/1) baselines audit, [C-02](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/2) exports/consumer contract, [C-05](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/5) audio engine and catalogue, [C-09](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/9) consumer regression checks, [C-10](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/10) Core 1.0, [C-11](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/11) Terminal migration, [C-12](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/12) Ember migration. Swish [S-07](https://github.com/arlecchinoOPSource/Swish/issues/7)/[S-13](https://github.com/arlecchinoOPSource/Swish/issues/13) were not readable and are not verified. Open issues in app repos: Terminal #62 (audio / fullscreen close), #20 (v1 release task, still open although v2.0.1 shipped); Ember #34 (2.0.2); Swish #34 (1.0.1), #17–#20 (iOS). No open PRs in Swish.
