# U-21 and U-23 — The rack, and the projector state machine

Issues: [U-21 (#21)](https://github.com/arlecchinoOPSource/Unhollowed/issues/21), [U-23 (#23)](https://github.com/arlecchinoOPSource/Unhollowed/issues/23). Date: 2026-11-12. Art: the owner's `UNHLW rack assets 2026-11-12` package (Blender source `UNHLW - Fable pass 01.blend`, layers and manifest). Builds on [LIFECYCLE-U11.md](LIFECYCLE-U11.md).

## What is built

- **`src/Rack.tsx`** assembles the rack from `src/rack-manifest.json` (copied unchanged from the art package) and `public/rack/*.png`. Every layer is a decorative image (`alt=""`); positions are percentages of the plate's world rectangle, so the whole rack scales as one picture. The VU needles are one image drawn twice, rotated about each meter's pivot, clipped to its window. The only interactive parts are six real `<button>`s over the I and O rocker keys, with names such as "Power on Terminal", `aria-pressed`, a visible focus ring and the art's hover and pressed layers.
- **`src/lifecycle.ts`** gains the five projector states. `projectorState(rack, name)` derives what a projector shows from the phase and whether its frame has reported loading:

  `off → booting → active → shutting-down → off`; `booting → error`, `shutting-down → error`; `error → keep open → active` (or booting if it never loaded), `error → retry → shutting-down`, `error → power off anyway → off`. Out-of-order calls change nothing. `error` means *still mounted, nothing lost*: a frame that never loaded within 20 s, or a module that did not confirm its save. The owner decides, as before.
- **Page wiring (`src/App.tsx`, `src/ModuleFrame.tsx`).** A frame reports loaded (booting → active); a failed or unconfirmed power-off now sets `error` instead of only showing the alert; the rack keys call the same handlers as the host bar (power on, bring to front, power off, keep open). (The host bar's text buttons were removed afterwards; see [HOLOGRAM-U24.md](HOLOGRAM-U24.md).)
- **What each state looks like** (CSS, from the art's layers): *off* — plain unit, O key pressed; *booting* — glow flickers on for about a second; *active* — glow, chase LEDs running, needles moving; *shutting-down* — glow fades out over 0.9 s, keys show the disabled art and ignore clicks; *error* — status LED blinks red (2 Hz), the frame stays visible if nothing else is in front. `prefers-reduced-motion` turns the flicker, chase, blink and needle sway into static states.
- **Layout.** The rack is as tall as the space under the host bar and keeps its aspect ratio (never wider than 45% of the window); the stage takes the rest. **One module is in front at full size; the others stay mounted at the same size, only invisible** (`visibility: hidden`, never `display: none`, so their timers and drafts keep running as [LIFECYCLE-U11.md](LIFECYCLE-U11.md) requires). Before this, three modules shared the stage side by side and were about 141 px wide at 800 px; now the front module is about 495 px wide.

## Assets

`public/rack/` holds 35 layers (3.9 MB), the art package's layers without the unused `-on` renders. Layers wider than 1000 px were downscaled to 40% (plate 993 x 1435, units 848 x 368) with `sips`; small layers are unchanged. The full-size masters stay in the owner's package, not in this repository; coordinates in the manifest are in rack units, so the scale does not matter. Format (PNG now; WebP or AVIF later) and the resolution budget are still the owner's open decisions. All geometry and shaders are the owner's own work; no third-party font is embedded.

## Evidence

- `npm test`: 15 lifecycle tests, 6 new for the states (booting until loaded; shutting-down then off, and a new power-on boots again; error keeps the frame and the owner's three choices; a module that never loaded; out-of-order calls change nothing; every state reachable and deterministic).
- Native, macOS 26.5.1 arm64, 34/34: after the existing checks, all three projectors read `active`, six buttons have accessible names, every rack image loaded, the rack fits inside an 800 px window, exactly one frame is visible, and the front frame is at least 380 px wide (measured 495 px). All earlier checks (focus gate, power cycle, data safety, change notice) still pass with the new layout.
- In a browser with a stubbed host (checked by hand): power on and off from the rack keys, the keys' names and pressed states, and the error path (a refused save left the Terminal frame visible with the "Keep it open" / "Power off anyway" choices and the error LED animating).

## Limits (not claimed)

- **Not run on Windows** (CI runs the native test there). **Not checked with a screen reader or on a touch screen.**
- **The shutting-down look was not seen in motion** (the stubbed host saved too fast; a real save takes longer). The model state and the CSS exist; the fade itself is unobserved.
- The boot is a fixed flicker, not tied to real progress; the "booting" state lasts exactly until the frame loads.
- Animated screens are single frames (the art exports one), so the displays do not animate; only needles, chase LEDs and the glow do.
- U-24 (hologram) is built in [HOLOGRAM-U24.md](HOLOGRAM-U24.md). 
- Keyboard shortcuts for switching modules do not exist; with only one module visible, a hidden module is reached through the rack key or the host bar.
- Layer images are decoded at startup (3.9 MB); no measurement of load time or memory yet.

## Rollback

Revert the PR. The state machine additions are backward compatible (`on`, `closing` and `off` behave as before); the layout change is in `App.tsx` and `styles.css` only.
