# U-03 — Foundation scaffold and first slice (Swish)

Issue: [U-03 (#4)](https://github.com/arlecchinoOPSource/Unhollowed/issues/4). Date: 2026-11-10. This records what was built, how it was verified, and what was not. Design: [ARCHITECTURE.md](ARCHITECTURE.md). Product name: Unhollowed; identifier `com.arlecchino.unhlw`; unsigned; no in-app updater ([DECISIONS.md](DECISIONS.md)).

## What exists

| Part | Where | What it does |
| --- | --- | --- |
| Host app | `src-tauri/`, `src/` | Tauri 2.12.5 window "Unhollowed" with a placeholder: one power switch for Swish. Owns close and quit. React 19.3.1, Vite 8.3.5, TypeScript 7.0.2, the same versions as the apps |
| Host contract (Rust) | `crates/host-contract/` | The flush event, linger cap and module descriptor shared by host and modules |
| Swish module adapter | `crates/module-swish/` | A Tauri plugin named `swish` exposing Swish's own command names over the real `swish-data` crate; `finish_exit` reports to the host and never exits the app |
| IPC shim | `public/modules/shim.js` | Makes the iframe look like a Tauri window and routes unprefixed commands to `plugin:<module>|<command>` |
| Module build | `scripts/build-modules.mjs`, `modules.json` | Clones Swish at a pinned full SHA, refuses it unless its manifests agree, builds its unmodified bundle with `--base=./`, injects the shim |
| Data folders | `src-tauri/src/modules.rs` | Resolves Swish's existing folder as a sibling of the host's own; `UNHLW_DATA_ROOT` (debug builds only) redirects to a throwaway root |
| Self-test | `src/selftest.ts`, `src-tauri/src/selftest.rs`, `scripts/native-selftest.mjs` | Debug-only: drives the real Swish UI with synthetic data and checks the result |

Placeholder icons were generated with the Tauri CLI and are not final artwork.

## Verification (macOS 26.5.1, Rust 1.99.1, Node 24.22.2, `tauri` 2.12.5, WKWebView)

- `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace --locked`: 8 tests pass (module data folders, close-wait logic, and a test that keeps the command list, the handler and the capability in step, applied to both the host and the Swish plugin).
- `npm test`: 9 JS tests pass (shim routing and read-only `invoke`; pin manifest checks that reject the Swish `v2.0.1` and Ember `v2.0.2` situations).
- `npm run test:native` (a real window, about 20 seconds): all eleven checks passed.
  - Swish's real UI rendered inside the iframe and its startup screen finished.
  - A project was created through the real UI and read back through the plugin; the database file was written in the throwaway root.
  - After the project dialog opened, focus was on the name field.
  - Every command went through the shim to `plugin:swish|…`; the iframe's theme (`blue`) was independent of the host's.
  - The close handshake worked: the host sent Swish's own close event, Swish saved and reported through its own exit command, the host waited 27 ms, honoured Swish's 6000 ms close-sound linger, and exited with code 0.
- Recorded, not asserted: after resizing the window to 800 px the frame followed (800 px); an `AudioContext` created in the frame without a user gesture was `suspended`.

## Re-run of the U-31 and U-35 open checks

| Check | Result |
| --- | --- |
| Real Swish bundle in an iframe | Passed |
| Focus | Passed for the dialog's first control; moving focus between modules not tested (one module) |
| Resize | Passed on macOS |
| Audio autoplay | An unprompted `AudioContext` is suspended; real cue playback after a click was not tested |
| Shutdown / close handshake | Passed for Swish through its own event and exit command |
| Windows | **Not run** |
| Ember and Terminal bundles | **Not run** (their module plugins do not exist) |

## Decisions applied and deviations

- **No Core dependency in the host** ([HOST-CONTRACT-U35.md](HOST-CONTRACT-U35.md)); the Core part of the original U-03 wording is superseded.
- **Interim deviation from U-35:** the Swish plugin builder lives in this repository instead of the Swish repository, as a thin wrapper over `swish-data`. No Swish domain or storage code is copied; moving the builder upstream remains in U-10.
- **`swish-data` is a path dependency on the pinned clone**, not a git dependency: Cargo would also fetch Swish's private Core submodule and cannot authenticate to it. Because Swish's repository includes that submodule, building the Swish bundle also needs your own GitHub access to Core (CI access is U-04).
- Swish's backup, restore and file-dialog commands are not part of the slice.

## Not done

- Rack artwork, projector state machine, power-off (open decision O3), Terminal and Ember, Windows verification, CI, packaging checks, accessibility and performance review.
- The pin in `modules.json` points at a Swish commit; update it to the commit on Swish `main` once the Swish alignment pull request is merged (U-34 pin rule).
