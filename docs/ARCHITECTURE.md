# Architecture

Status: v0.2, 2026-11-10. The U-03 scaffold implements this design for one module (Swish); Terminal and Ember, the rack and the projector state machine are not built. See [SLICE-U03.md](SLICE-U03.md) for what was verified. Requirements and open questions are in [SPECIFICATION.md](SPECIFICATION.md); decisions are in [DECISIONS.md](DECISIONS.md). **Untested** marks parts decided but not yet proven.

## Overview

```
Tauri host (com.arlecchino.unhlw)
├─ native: window, capabilities, data-dir resolver, one Tauri plugin per module
│    plugin:terminal | plugin:ember | plugin:swish   (prefixed commands + permissions)
└─ one webview (React): rack, projectors, lifecycle controls
     ├─ iframe: Terminal bundle ─┐
     ├─ iframe: Ember bundle    ─┼─ host adapters → plugin:<module>|<command>
     └─ iframe: Swish bundle    ─┘
data (unchanged, owned by each module):
  <data_dir>/com.arlecchino.terminal/journal.sqlite3
  <data_dir>/com.arlecchino.ember/ember.sqlite3
  <data_dir>/com.arlecchino.swish/swish.sqlite3
```

## Layers

1. **Native host (Rust).** Owns the window, close and quit, capabilities, and the resolver that maps each module to its existing data folder (a sibling of the host's own `app_data_dir()`; debug builds accept `UNHLW_DATA_ROOT` for throwaway data). Registers one Tauri plugin per module. Modules never call `app.exit` or intercept `CloseRequested`/`ExitRequested`.
2. **Module plugins (Rust, built in each app's repository).** Each app exposes a plugin builder that takes an injected data directory and registers its existing commands under the module's prefix. Business logic and storage stay with the app; UNHLW does not copy backend code. Extraction is U-06, U-08 and U-10, each needing owner authorization in the owning repository.
3. **Host webview (React).** Draws the rack, projector units and controls with Blender-rendered 2.5D layers and live React content; hosts the iframes; runs the projector state machine (off, booting, active, shutting-down, error).
4. **Module iframes.** Each app's own web bundle, built by UNHLW from the pinned source with a relative base (`--base=./`) and loaded unmodified in a same-origin iframe. The document boundary isolates DOM, CSS, theme, global listeners and audio contexts.
5. **Tauri API adapters (build time) and a small shim (run time).** When a module's bundle is built, its `@tauri-apps/api` `core` and `event` imports are redirected to adapters in `adapter/` ([issue #52](https://github.com/arlecchinoOPSource/Unhollowed/issues/52)). The adapters send the module's commands to `plugin:<module>|<command>` and register event listeners through the **host window's** internals, so the same bundle behaves identically on macOS and Windows; the build fails if the real calls survive. This replaces the earlier run-time replacement of the iframe's internals, which cannot work on Windows: WebView2 (wry has no main-frame-only option there) gives every frame its own permanent `__TAURI_INTERNALS__`. A tiny shim (`public/modules/shim.js`) still sets `window.isTauri` and, where the frame has no internals (macOS), provides them, because modules also test for their presence. Modules that use further Tauri APIs (Ember's window API, Terminal's dialog plugin) need the adapter surface extended; an unsupported import fails that module's build.

## Lifecycle (design; close handshake **Untested**)

- **Activate:** the host loads the module's iframe and its plugin initializes with the injected data directory.
- **Flush and close:** the host emits the app's own close event (for example Terminal's `journal-close-requested`) so the app saves; the shim intercepts the app's exit command (for example `journal_finish_exit`) and acknowledges it to the host instead of exiting. Ember and Swish use different event and command names and need the same mapping.
- **Power-off and unsaved work:** open decision O3 in the specification; the host must not lose unsaved work or reset timers.
- **Quit:** the host waits for every active module to confirm flush, then exits once.

## Data and concurrency

- Modules keep their SQLite files, schemas and migrations; the host opens nothing itself.
- All three stores use WAL, `synchronous=FULL`, immediate write transactions and 3 to 5 second busy timeouts, and refuse newer schemas without modifying them. Terminal rejects stale saves with a `revision`; Swish's conflict control is unverified.
- No change notification exists between processes. Interim: modules re-read on window focus and after errors; the policy is U-15.
- Verified backup precedes any module migration (none exists today; U-14). Uninstall never touches module folders.
- Until U-14 and U-15 pass, host builds use synthetic data only.

## Security and permissions

One plugin and one permission set per module; the merged manifest is tested so the handler list, `build.rs` and capabilities agree. CSP stays restrictive as in the apps. Because iframes share the webview's capability, a module's code could call another module's commands; accepted because all code is first-party, and revisited if that changes. Native child webviews are the fallback if enforced isolation is required.

## Dependencies and build

- One Rust workspace pins `tauri`, plugins, `rusqlite` (one minor, currently 0.41.x), `serde` and `serde_json` together; a resolution check in CI detects drift (U-32, U-04).
- Modules are pinned by full commit SHA whose manifests agree; frontends are built from the pinned source with a relative base.
- Core is not a dependency of the host. If host UI uses suite-ui, pin by SHA and verify with a consumer build. Core migrations of Terminal and Ember (C-11, C-12) are not prerequisites.
- Packaging includes the modules; it never launches separately installed apps. No in-app updater in 1.0; signing and notarization are open (U-36).

## Evidence

[AUDIT-U-01.md](AUDIT-U-01.md) (gaps G1 to G14), [SPIKE-U31.md](SPIKE-U31.md) (embedding options), [DEPENDENCY-ALIGNMENT-U32.md](DEPENDENCY-ALIGNMENT-U32.md), [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md), [RELEASE-HYGIENE-U34.md](RELEASE-HYGIENE-U34.md), [HOST-CONTRACT-U35.md](HOST-CONTRACT-U35.md), [SIGNING-IDENTITY-U36.md](SIGNING-IDENTITY-U36.md).
