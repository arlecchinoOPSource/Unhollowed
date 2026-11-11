# Decisions

## Accepted product direction — 2026-11-10

- UNHLW is an independently installable integrated host for three real applications, and their standalone products remain independently maintainable. No monorepo merge is authorized.
- Initial visual strategy is Blender-authored mechanical assets rendered in a hybrid 2.5D frontend with live app interfaces. A real-time 3D engine is not a prerequisite for 1.0.
- Local-first behavior, configurable sound and motion, accessibility, and product-owner approval for merges and releases are requirements.

## Accepted plan revisions — 2026-11-10 (owner delegation after the U-01 audit)

Evidence: [AUDIT-U-01.md](AUDIT-U-01.md). Owner: product owner, who delegated these changes to the implementing agent on 2026-11-10; review them with the audit PR.

- **The host owns the window, close and quit.** Modules expose `flush()`/`release()` hooks and never intercept `CloseRequested`/`ExitRequested` or call `app.exit`. Consequence: each app's `finish_exit` becomes a host responsibility ([U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2), [U-11](https://github.com/arlecchinoOPSource/Unhollowed/issues/11)).
- **No merged data store and no new shared schema** is the working direction; the host reads each app's existing files. [U-33](https://github.com/arlecchinoOPSource/Unhollowed/issues/35) confirms paths and identifier. Alternative (a unified store) is rejected unless an audit finding requires it.
- **Interim data rule:** host builds use synthetic data directories until [U-14](https://github.com/arlecchinoOPSource/Unhollowed/issues/14) and [U-15](https://github.com/arlecchinoOPSource/Unhollowed/issues/15) pass.
- **Embedding model is decided by prototype**, not assumed ([U-31](https://github.com/arlecchinoOPSource/Unhollowed/issues/33)). Command names are prefixed per module regardless of the outcome.
- **Foundation order:** audit, then U-31 to U-36 decisions, then scaffold with one real slice, then the host contract derived from it.

## Accepted — U-31 embedding model (product owner, 2026-11-10)

- **Baseline:** each module is a Tauri plugin (prefixed commands and permissions) mounted in its own same-origin iframe inside the host webview. Native child webviews are the fallback if enforced isolation becomes a requirement; sandboxed frames are rejected unless the apps change. Per-module `localStorage` namespacing is required.
- **Accepted risk:** command isolation is not enforced between same-origin iframes; all module code is first-party.
- **Conditions:** the U-03 first slice re-runs the spike checks with a real app surface, including Windows, focus, resize, audio and shutdown, and the decision is revisited if they fail. Evidence and limits: [SPIKE-U31.md](SPIKE-U31.md).

## Accepted — U-33 data locations, identifier and migration policy (product owner, 2026-11-10)

Host identifier `com.arlecchino.unhlw` (approved name; irreversible after release); modules keep their existing files and folders; the host resolves module folders as siblings of its own data folder and modules accept an injected data directory; verified backup before any module migration; concurrent standalone and host use allowed at the file level with documented staleness until U-15. Evidence, alternatives and risks: [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md).

## Accepted — U-36 signing, updater and identity (product owner, 2026-11-10)

- **No in-app updater for 1.0.** Users install new builds manually from GitHub Releases. An installed 1.0 cannot self-update later; adding an updater means one manual install of a newer build.
- **Unsigned.** UNHLW, like the standalone apps, ships unsigned: macOS builds are ad-hoc signed and not notarized, Windows installers are unsigned. No Apple Developer account, certificate, signing service or credential is needed. Release notes and the README must say so, with the first-launch steps (macOS right-click then Open; Windows SmartScreen More info then Run anyway).
- **Product name: Unhollowed.** Window and installer name; the bundle identifier stays `com.arlecchino.unhlw`.
- **Bundle targets** follow the recommendation unless the owner changes them: macOS universal `app` and `dmg`, minimum 11.0; Windows NSIS per-user install plus MSI for managed installs, WebView2 bootstrapper embedded. Uninstall never touches module data folders.
- Evidence and rationale: [SIGNING-IDENTITY-U36.md](SIGNING-IDENTITY-U36.md). Signing and notarization are no longer open; U-29 verifies packaging and the honesty of the status wording only.

## Accepted — U-35 host contract and Core (product owner, 2026-11-10)

UNHLW owns the host contract (iframe shim, message protocol, Rust module convention); Core stays UI-only; app frontends are mounted unmodified from relative-base builds; backend extraction stays in the app repositories by separate owner-authorized issues; no Core embeddable mode and no early C-11/C-12; Core pins by SHA verified by a consumer build. Evidence and risks: [HOST-CONTRACT-U35.md](HOST-CONTRACT-U35.md).

## Accepted — module Tauri calls routed by build-time adapters (product owner, 2026-11-11)

Result of the U-31 Windows re-run (issue [#52](https://github.com/arlecchinoOPSource/Unhollowed/issues/52)): the run-time shim cannot replace the iframe's Tauri internals on WebView2. The owner chose option 1: when a module is built, its `@tauri-apps/api` `core` and `event` imports are aliased to host adapters (`adapter/`) that prefix commands to `plugin:<module>|…` and register events through the host window. The iframe embedding model of U-31 stands. Native child webviews remain the fallback. Evidence: [SLICE-U03.md](SLICE-U03.md).

## Proposals and unresolved decisions

Specification and architecture baseline: [SPECIFICATION.md](SPECIFICATION.md), [ARCHITECTURE.md](ARCHITECTURE.md). Still open: meaning of projector power for unsaved work and timers; cross-process change notification and conflict policy (U-15); performance budgets; Windows behaviour; branch protection; Ember release v2.0.2 provenance. Record alternatives, rationale, consequences, date and owner when each is decided.
