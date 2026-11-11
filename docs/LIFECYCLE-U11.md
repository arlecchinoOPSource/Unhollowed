# Activation and lifecycle (U-11)

The rules below are implemented in `src/lifecycle.ts` (pure, unit tested), `src-tauri/src/lifecycle.rs` and `public/modules/shim.js`, and checked in a real window by `npm run test:native`.

## Rules

1. **A module is off, on or closing.** Power-on mounts its frame and puts it in front. Power-off asks it to save through its own close event; the frame stays mounted while it is `closing`.
2. **Navigation never unmounts.** Bringing a module to the front (a button, a click inside it, or Tab moving into it) changes only which module is in front. The frame, its page state, its drafts and its running timers are untouched. Only a confirmed power-off removes a frame.
3. **One module is in front, and only it may take keyboard focus.** A page has one focused element, so a background module that focuses itself (an autofocus at load, a timer) would take the keyboard from the module in use. The shim wraps `HTMLElement.focus()` and asks the host; a background or closing module's call does nothing. With no host answer nothing is restricted (a module run on its own is unaffected).
4. **Power-off saves first.** `host_power_off` emits the module's close event and waits for its flush report (the same report the app-wide close uses), up to 8 s. On confirmation the frame is hidden, its close sound is left up to its requested linger (capped at 6.5 s), then it is removed.
5. **No confirmation means no loss.** If the module does not confirm (or the call fails) the frame is kept, the page says so, and the owner chooses *Keep it open* or *Power off anyway (unsaved changes are lost)*. Nothing is discarded silently.
6. **Reports cannot be stale.** A flush report is forgotten when a module is powered on, when a power-off starts and ends, and when an app-wide close starts, so an old report never satisfies a later wait.
7. **Every power-on is a new frame.** A module that was asked to close has run its own close handling (Ember and Terminal set a "closing" flag and then ignore further requests), so it is never reused. Each power-on gets a new frame identity (`epoch` in the model), even when a power-off and the next power-on land in the same render. The host's state is a ref that changes at once, so a second request right after the first is judged against the truth.
8. **App close and quit** are unchanged: the host asks every active module to save, waits, lets the close sound finish and exits once. A module cannot exit the app.

## Background services and timers

Nothing in this slice moves a frame out of view: powered-on modules are shown side by side, so no module is hidden and no timer is throttled. When the rack layout (U-21/U-23) can hide a module, hidden frames will be kept mounted (not `display: none` on a page that must keep working) and the timer test below is the regression guard. Browsers may throttle timers in hidden frames; that is not yet measured.

## Evidence (`npm run test:native`, macOS 26.5.1 arm64)

- Swish's page variable and a 100 ms interval survived two navigations and 700 ms in the background; the frame element was the same node.
- With Ember in front, a `focus()` from Terminal did nothing; after Terminal was brought to the front the same call worked.
- Powering Ember off returned a confirmation, removed only its frame, left Swish's project on screen and refused a second power-off. A later power-on produced a different frame that showed the habit read back from the saved database, and the final app close then collected a flush from that new frame as well as from the other two.
- Found by running it: the first version reused the old frame when power-off and power-on landed in one render, and the app close then timed out waiting for an Ember that had already closed. The epoch rule and the synchronous state above are the fix.
- Unit tests: 9 for the model, 3 for the focus gate, 2 Rust tests for the wait.

## Limits (not claimed)

- Not exercised: a module that fails to confirm in a real window (covered by the unit-tested wait and model only), keyboard shortcuts for switching, screen readers, the close sound during power-off, hidden-frame timer throttling, and Windows native behavior until CI runs it.
- **"Keep it open" after a timeout is the owner's risk.** If a module never answered, it may have missed the request or be mid-save; a module that did run its close handling will ignore a second request. The page says changes may be lost on *Power off anyway*, but it cannot know what an unresponsive module holds. This path is covered by the model's unit tests, not by a real unresponsive module.
- Focus is gated by wrapping `focus()`. A module that sets the `autofocus` attribute on parsing, or calls `window.focus()`, is not gated; none of the three modules does either today (the host's own `window.focus()` on a frame is deliberately allowed).
- The module's own state after `finish_exit` is not reset: a module is powered off by removing its frame, so nothing depends on it.
- Real user data and concurrent standalone access are U-14/U-15/U-16.
