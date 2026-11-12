# U-24 — Hologram projection and retraction

Issue: [U-24 (#24)](https://github.com/arlecchinoOPSource/Unhollowed/issues/24). Date: 2026-11-12. Art and assembly recipe: the owner's package (`docs/RACK-ASSETS-U17-U22.md`, section "U-24 hologram"; 16 layers in `public/rack/`, listed in `src/rack-manifest.json` under `hologram`). Builds on [RACK-U21-U23.md](RACK-U21-U23.md) and [LIFECYCLE-U11.md](LIFECYCLE-U11.md).

## What it does

Pressing a projector's I key opens its projection screen, builds a beam from it to the stage and **reveals the live interface from the stage's left edge outward**. Power-off reverses it, but only after the save is confirmed. The interface is never copied or covered: it is **clipped** (`clip-path` from the right, driven by `--surface-<unit>`) and nothing is drawn over a revealed pixel.

| State | What you see |
| --- | --- |
| off | nothing projected |
| booting | screen opens, ring charges, beam grows, interface unfolds. Takes 1.2 s but **holds at 0.5 until the frame has really loaded** |
| active | faint steady beam (22%), frame at 60%, interface fully shown, slow 6 s shimmer |
| shutting-down | the interface **stays exactly as it is while the module saves** (however long); once the save is confirmed it retracts in 0.9 s, then the frame is hidden and removed |
| error | interface fully shown at once; red dashed frame with a second bracket, segmented red beam, half-open aperture, stepping twice a second |
| switch | the old beam fades while the new one builds late (0.45 s) |
| reduced motion | no sweep, flicker, shimmer or stepping: cross-fades only; the interface appears at once from p = 0.5, never half-transparent; a retract resolves at once |

## How it is built

- `src/projection.ts` — pure and unit tested (14 tests): the progress rules (`Projection`), what each piece shows (`unitPieces`, `stagePieces`, the owner's formulas), the stage margin (`stageMargin`), and the beam geometry (`beamSlices`).
- `src/Hologram.tsx` — the overlay (`aria-hidden`, `pointer-events: none` on every element): a canvas for the beam, the lenses, landing glow, 9-slice frame and reveal line, all additive (`plus-lighter`). Its frame loop **stops when nothing moves** and is woken by inputs and by a retract request.
- `src/lifecycle.ts` gains `stageOwner`: the module in front, or, when none is, the one that is saving or in error, so unsaved work is never hidden.
- `src/Rack.tsx` draws each unit's emitter screen and ring; `src/App.tsx` waits for the retract after a confirmed save (with a 2.5 s safety cap) before hiding and removing the frame.
- The stage has the margin the art needs: M = clamp(14, 3.5% of the window height, 30 px); the interface starts 2.5 M right of the rack and keeps 1.5 M elsewhere. The old unit-glow **flicker (five changes in 0.54 s, faster than 3 Hz) is replaced by a 0.6 s ramp**.

**One deliberate deviation from the owner's recipe: the beam is drawn on a canvas in 96 thin vertical slices, not with the `matrix3d` quad.** In WebKit (the engine on macOS) the `matrix3d` quad pointed the beam up and left through the nameplate; Chromium got it right. The beam is a trapezoid with vertical sides, so the slices are exact and identical in every engine. The scan texture inside the beam is tiled on screen, not warped with the beam.

## Evidence

- `npm test` 51 tests (14 for the hologram: boot hold and timing; a slow save holds the interface and only then retracts; retract of a module not on stage resolves at once; error; reduced motion; switch; steady state overlays nothing; reveal line on the not-yet-revealed side; beam slices have no gaps; margin; stage owner; a retract request wakes a stopped loop).
- **Found by running it:** the first version stopped its frame loop while a module was saving, so the retract was never driven and the module stayed in "shutting-down" forever. A retract request now wakes the loop (tested), and the app caps the wait.
- Real **WebKit** (Playwright, the real built page with a stubbed host, 1100x700): the beam goes from the unit's screen to the stage; booting reveals the real Terminal from the left; active and error look as designed; a 700 ms save holds the interface at full reveal and then retracts (1.00, 0.91, 0.25, 0.00, then off); a refused save shows the error treatment with the interface visible and the existing "Keep it open / Power off anyway" choices; a switch hands over the stage; reduced motion shows the interface at once. No page errors.
- Native, macOS 26.5.1 arm64, 35/35: the overlay is decorative and ignores the pointer, **the beam was drawn in the real web view (about 100,000 canvas pixels)**, the stage has its margin, and the front interface is fully revealed. All earlier checks still pass (the fill check now measures the padded stage).
- The art: frame pieces are fully transparent over the interface side (alpha 0, measured).

## Limits (not claimed)

- **Not run on Windows** (CI does; WebView2 is Chromium, which the owner's recipe already works in). **No screen reader or touch test.** Performance of the blended, masked layers is not measured.
- The beam is faint in the active state by the owner's design (22%) and was not tuned; error is hard to see at small sizes.
- The scan texture is not perspective-warped; the shimmer is a CSS opacity animation.
- The main displays are still single frames; only the hologram, needles and LEDs move.
- Timings (1.2 s, 0.9 s, 0.45 s), opacities, the reveal direction and the error colour are the owner's proposals, unchanged here.
- During a very slow save the unit's keys are disabled and the interface stays in place; there is no progress indicator beyond that.
- The host bar's duplicate text buttons remain.

## Rollback

Revert the PR. The only change to existing behaviour is the stage margin, the flicker ramp, and a retract (0.9 s) before a saved module is hidden.
