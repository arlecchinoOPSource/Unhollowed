# U-31 — Embedding-model spike and recommendation

Issue: [U-31 (#33)](https://github.com/arlecchinoOPSource/Unhollowed/issues/33). Date: 2026-11-10. Prototype: branch `spike/u31-embedding`, folder `spikes/u31` (throwaway, not for main). Evidence base: [AUDIT-U-01.md](AUDIT-U-01.md) gaps G2–G5.

## Question

Which way should Terminal, Ember and Swish be embedded in one UNHLW host so that command names, permissions, DOM/CSS state and storage do not collide?

## Method and environment

One Tauri host with two tiny plugins, `alpha` and `beta`, standing in for two modules. Both define `ping` and `finish_exit`. Test pages run in four setups and report JSON through an app command. Synthetic data only; none of the real apps was used. One run on macOS 26.5.1 (WKWebView), Rust 1.99.1, `tauri` 2.12.5, `tauri-runtime-wry` 2.12.3, `wry` 0.57.2, `tao` 0.37.2. Full output: `spikes/u31/results.json` on the spike branch.

## Results

| Question | A. One webview, modules in one document | B. One native webview per module (`add_child`) | C. Same-origin iframe per module | D. Sandboxed iframe + host broker |
| --- | --- | --- | --- | --- |
| Same command name in two modules (G2) | Works when each module is a plugin (`plugin:alpha\|finish_exit`, `plugin:beta\|finish_exit`) | same | same | same |
| Can module A call module B's commands (G5) | **Yes** | **No**: denied per webview with a precise capability error | **Yes**: iframe reached the parent's IPC and called both | **No**: parent's IPC unreachable (`SecurityError`); only broker allow-listed calls succeeded, `beta` was refused |
| Theme/`<html>` state (G4) | **Collides**: last write won (`ember` over `mint`) | Isolated (each webview kept its own value) | Isolated (iframe's `amber` left parent unchanged) | Isolated by construction |
| Global key-capture listener from one module (G4) | **Blocked the other module's input** (it never saw the key) | Separate documents | Separate documents (not individually tested) | Separate documents (not individually tested) |
| Storage (`localStorage`) | Shared | **Shared across webviews** (same origin `tauri://localhost`; each saw the other's key) | Shared (same origin) | **Unavailable** (`SecurityError`) |
| API stability | Stable | `add_child` exists only with the `unstable` feature, desktop only (checked in `tauri-2.12.5` source) | Stable | Stable |
| Vite-style `<script type="module">` | Normal | Normal (expected, not tested) | Normal (expected, not tested) | **Did not run** in the sandboxed frame; a classic script ran. `fetch` of a same-directory file also failed (`Load failed`). |

## Interpretation

- **Plugin namespacing solves the command-name clash in every option.** Each module should be a Tauri plugin so its commands are `plugin:<module>|…` and its permissions are `<module>:allow-…`. This also fits the Ember ACL-sync test (handler list, `build.rs`, capability agree).
- **Enforced command isolation is available only in B and D, and each has a cost.** B needs the `unstable` feature and keeps one shared storage origin. D breaks module scripts and `localStorage`, which the apps' Vite bundles and local settings rely on.
- **Option C isolates the DOM and CSS but not commands**, and A isolates neither. Because all module code is first-party, the realistic risk in A/C is an accidental cross-module call, not a hostile one.
- **Storage is not isolated in any option that keeps real module code unchanged**, so each module needs its own key prefix or store (or a Core/host settings adapter) regardless of choice.

## Recommendation (pending product-owner approval)

1. **Baseline for 1.0: option C.** Mount each module in its own same-origin iframe inside the host webview, with each module registered as a Tauri plugin (prefixed commands and permissions). Use a host-side convention that modules reach IPC only through a thin per-module client that targets their own plugin, and keep the ACL-sync test for the merged manifest.
2. **Accept and document the residual risk** that capability isolation is not enforced in C. Revisit if a module ever loads non-first-party content.
3. **Keep B as the fallback** if enforced isolation or independent crash/shutdown becomes a requirement, noting the unstable API and that overlaying rack art and transparency over native child webviews is unproven.
4. **Reject D** unless the apps are changed to avoid module scripts and `localStorage`.
5. **Namespace storage per module** and have the host own audio, startup and close behavior (see the host-owns-lifecycle decision).

## What this spike did not test

- Windows (WebView2); only macOS WKWebView ran. Behaviour of iframes, `add_child` and sandboxing may differ.
- Any real app code; only synthetic pages. Module scripts inside a same-origin iframe, real Vite bundles, Terminal's Tiptap editor and Ember's native sound path are untested.
- Keyboard focus movement between modules, window resizing, accessibility, per-iframe global listeners individually, audio contexts, shutdown/flush, and performance.
- Whether native child webviews (B) can be layered with CSS art or made transparent for the hologram effect.
- Run-to-run variation (one run).

These belong in the U-03 first-slice work, which should embed one real app surface under option C and re-run the same checks.

## Reproduce

See `spikes/u31/README.md` on branch `spike/u31-embedding`.
