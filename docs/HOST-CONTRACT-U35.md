# U-35 — Host contract ownership and Core divergence plan

Issue: [U-35 (#37)](https://github.com/arlecchinoOPSource/Unhollowed/issues/37). Date: 2026-11-10. Builds on the accepted embedding baseline ([SPIKE-U31.md](SPIKE-U31.md)) and the approved data decisions ([DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md)). Evidence branch: `spike/u35-iframe-shim` (`spikes/u35`, throwaway).

## Questions

1. Where does the host contract live: UNHLW, Core, or elsewhere?
2. Does Core need an "embeddable mode" first?
3. Must the Terminal and Ember migrations onto Core (Core C-11, C-12) happen before UNHLW integrates them?
4. Which Core commit does UNHLW pin, and how is it verified?

## Evidence

**Core, read with the owner's account (read-only).** Core `main` is `d869e09` (2026-11-08). The zip the owner supplied is identical to it: all 58 files match by git blob hash. Swish pins `42b811f`, which is suite-ui **0.5.0**, eight commits behind `main` (0.5.1: centered modal dialogs, modal focus fixes, optional minimum startup display time). All thirteen Core issues, C-01 to C-13, are open; there are no tags, releases or pull requests.

**Terminal's real web bundle runs unmodified in an iframe.** On the U-31 prototype host (macOS, Tauri 2.12.5), Terminal `420a5e6` was built as shipped (`vite build --base=./`) and loaded in a same-origin iframe behind a 20-line IPC shim. Result:

| Check | Result |
| --- | --- |
| App renders | Yes: Terminal's full UI (rail, toolbar, editor frame) appeared; no page errors |
| Theme independence | The iframe kept Terminal's own `mint`; the host page was `ember` |
| `listen` for `journal-close-requested` | Worked through the host's event permission |
| Unprefixed app commands | `preferences_get`, `journal_last`, `journal_list` were each routed to `plugin:terminal\|<command>` by the shim |
| Backend | Not present yet: the host answered `terminal.journal_last not allowed. Plugin not found`, which is the expected result before U-06 builds a Terminal plugin |

Two things the shim needed, both learned the hard way: `isTauri()` in `@tauri-apps/api` reads a separate global (`window.isTauri`), so the shim sets it; and Tauri defines `__TAURI_INTERNALS__.invoke` as non-writable, so the shim must use `Object.defineProperty`, not assignment.

**Core's global side effects are per document.** Core's resets, motion attribute, key listeners and modal portal act on the document they run in. Inside an iframe that is the module's own document, so they cannot disturb the host or another module (this follows from option C; only theme independence was observed directly).

## Decisions (approved by the product owner, 2026-11-10)

1. **UNHLW owns the host contract.** It consists of: the iframe shim and a small message protocol for activation, visibility and flush/release (TypeScript, in UNHLW); and a Rust module convention (a Tauri plugin per module, built with an injected data directory) with the host-side adapter code (in UNHLW). Core stays UI-only. The apps do **not** depend on UNHLW; UNHLW wraps what they expose, so standalone builds are unaffected.
2. **Mount app frontends unmodified.** UNHLW builds each pinned app with a relative-base build (`--base=./`) and loads it in its own iframe behind the shim, so no frontend edits are required in the apps. The shim also maps each module's unprefixed commands to its plugin.
3. **Host-owned close, without editing the apps (design, not yet tested).** Terminal listens for `journal-close-requested` and finishes by calling its exit command. The host can emit that event to the iframe to make the app save, and the shim can intercept the exit command and acknowledge it to the host instead of exiting. Ember and Swish use different event names and need the same mapping. Confirm in the U-03 slice.
4. **Backend extraction stays in the app repositories, each by owner-authorized issue.** Each app exposes a Tauri plugin builder that takes a data directory (U-06, U-08, U-10); UNHLW does not copy backend code. This is the real work behind the contract.
5. **No Core "embeddable mode", and do not pull Core C-11/C-12 forward.** Because each module runs in its own document, the three UI generations (Terminal's own CSS, Ember's 0.2.0 copy, Swish on Core) can coexist in 1.0. Core migrations proceed on Core's own roadmap.
6. **Core pin policy** (applies to any UNHLW code that uses suite-ui, and to Swish's existing pin): pin by full commit SHA; verify by building a consumer against that SHA (Core's CI only runs `npm test`); advance pins in separate focused PRs. Swish's pin is behind by eight commits and should be advanced by its owner; it does not block UNHLW.
7. **Audio and startup stay inside each module for 1.0**; the host plays only rack and projector sounds (U-26). Iframe autoplay behaviour is untested and belongs in the U-03 slice.

## Alternatives considered

- **Contract in Core:** rejected for now. Core is private, UI-only, gated on its own 1.0, and would force every app to depend on host concepts it does not otherwise need.
- **A separate contract repository:** possible later if third parties appear; not needed for three first-party modules.
- **Compile the apps' frontends into one React tree:** rejected by the accepted U-31 baseline; it would reintroduce the global-state collisions.
- **Pull C-11/C-12 forward:** rejected; it widens scope in two other repositories without being needed for integration.

## Risks and open items

- One app, one run, no backend: Ember and Swish bundles, the close handshake, and iframe audio autoplay are untested; Windows not run.
- The shim relies on Tauri internals (`__TAURI_INTERNALS__`, `window.isTauri`), which are not a public API; pin Tauri and re-run this spike on upgrades (supports the U-32 alignment policy).
- Relative-base builds are not what the apps ship; the UNHLW build must prove it does not change behaviour (asset paths, fonts).
- Backend extraction requires owner authorization in three other repositories.

## Verification

Git blob comparison of the Core zip against `d869e09`; GitHub API reads of Core history and issues; one native run of the spike on macOS. No app source was modified; Terminal's `node_modules` and build output stayed in a scratch folder.
