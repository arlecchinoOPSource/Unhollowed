# U-26 — Rack sounds (first slice: the sound engine)

Issue: [U-26 (#26)](https://github.com/arlecchinoOPSource/Unhollowed/issues/26). Date: 2026-11-12. Rule from [HOST-CONTRACT-U35.md](HOST-CONTRACT-U35.md): **each module keeps its own audio and startup sounds for 1.0; the host plays only rack and projector sounds.** Requirement F8: sound is optional, independently adjustable, failure-tolerant, never blocks work, and is independent of reduced motion.

## What is built

- `src/sound.ts` (pure, tested): seven cues (`key-on`, `key-off`, `boot`, `shutdown`, `error`, `switch`, `blocked`), the settings (off by default; master volume; one switch per cue; read back safely from storage under the host-only key `unhlw.host.sound.v1`, written only when the person changes something), which projector-state changes call for which cue, and each cue's **time budget**: boot 0.7 s, shutdown 0.9 s and switch 0.45 s equal the projection times (a test fails if they ever drift), so sound and picture end together.
- `src/synth.ts`: **placeholder sounds made from maths** (relay clicks, a rising and a falling power sweep, a double low pulse for an error, a two-note blip, a dull thud). Original, nothing to license, deterministic, tested for length, peak and a click-free end. They stand in until the sounds the owner chooses exist; the player is built so a file in `public/rack-audio/` can replace each one.
- `src/hostSound.ts` (environment injected, tested with fakes): `play` never throws, never waits and never blocks power-on, power-off or a save. No device, a throwing device, a throwing source, a locked context or a failed save of the settings all end in "nothing sounded", logged with a reason. A device that failed is tried again on the next request. The first click is not lost: a context that is still locked when the key is pressed is resumed and the cue sounds as soon as it unlocks (if that takes under 0.4 s).
- `src/SoundDialog.tsx`: "Sound…" (top right, beside "Restore data…"): one switch for all rack sounds, a volume, and a switch plus a preview button for each cue. It floats over the workspace instead of pushing it down.
- **Wiring (`src/App.tsx`).** Key presses sound in the key handler (so they happen inside the click that unlocks audio). Boot, error and switch sounds follow the projector states. **The shutdown sound starts when the retract starts, which is after the save is confirmed**, not when power-off is pressed. A key that cannot be used sounds the `blocked` cue. After a module has closed, keyboard focus that would be left on nothing returns to that unit's power-on key.

## Found by running it (and fixed)

- The first rack sound after the page opens was silent: a new audio context is still locked when the click arrives. Now it sounds as soon as it unlocks.
- **Focus return in the Restore dialog never worked** (U-14 claimed it): the opener was read in an effect, after `autoFocus` had already moved focus into the dialog. It is now read while rendering, in both dialogs. Safari-family web views also do not focus a button on click, so the page also remembers the clicked button.
- Escape did not close a dialog when focus was on the page (again because of those web views). It now works from anywhere.
- The Sound and Restore dialogs were banners that pushed the workspace down and shrank the rack; they now float.

## Licensing of ElevenLabs sounds (checked 2026-11-12; not legal advice)

Official sources: [ElevenLabs help: "Can I publish the content I generate on the platform?"](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform) and the [Terms of Use](https://elevenlabs.io/terms-of-use).

- **Free plan: non-commercial use only.** The help page says free-plan content "cannot be used for any commercial purpose", and Terms section 1(c) says free users "may only use the Services for non-commercial purposes" with a personal email address. The Terms do not define "commercial".
- **Attribution on the free plan.** Free-plan content that is published must credit ElevenLabs by including "elevenlabs.io" or "11.ai" in the title (for Eleven Music, "Eleven Music"). What "title" means for sounds inside an app is not stated.
- **Paid plans** (from Starter) include a commercial license for what is generated while subscribed; attribution then follows your agreement. Free-plan output made before upgrading is generally **not** covered, so final sounds should be generated on a paid plan.
- **Beta services** cannot be used commercially or in production under any plan.
- **Separately:** ElevenLabs may produce the same or similar output for others, you must review output before distributing it, and bundling the service itself into a product needs separate OEM terms (this is about the service, not about shipping sounds).

**What this means here.** A free, non-monetised, non-business app is probably "non-commercial", but the term is undefined, the attribution wording is unclear for an app, and any later monetisation, donations, bundling into a business or paid support would make free-plan sounds a problem. Options, cheapest risk first: (1) generate the final sounds during one paid month (Starter) and keep provenance; (2) keep the free tier but add the credit and accept the ambiguity, asking ElevenLabs support to confirm for a freely distributed desktop app; (3) keep the procedural sounds in `synth.ts`, which are original and carry no restriction. The owner decides; no ElevenLabs sound is in the repository.

## Evidence

- `npm test`: 67 tests (6 for the cue logic and settings, 10 for the player and its failure paths, plus the placeholder checks and the existing suites).
- Native, macOS 26.5.1 arm64, 36/36 (run twice): boot, shutdown and switch sounds were requested during the real power cycle; **nothing sounded while sound was off**; a request with sound on never threw even with audio locked; the Sound dialog opened with focus on Close, had 17 controls, closed on Escape and returned focus; the self-test starts from default sound settings so it is repeatable.
- WebKit (Playwright, stubbed host): the dialog floats over the workspace and leaves the rack at full size; the first Play click is reported honestly when audio stays locked.

## Limits (not claimed)

- **No sound has been heard.** Whether the placeholders are pleasant, level with the modules' sounds, or audible through a real device on macOS or Windows is a listening check by the owner. Headless runs keep the audio locked.
- **Autoplay inside the module frames is unmeasured:** whether a click on a rack key unlocks the modules' own audio contexts (they stay suspended without a gesture) is still an open question, and so is the overlap between a module's own close sound and the host's shutdown sound.
- Not done in this slice: the sound files themselves, keyboard shortcuts for switching modules, announcing state changes to screen readers beyond the existing hidden status text, and Windows (CI runs the native test; real playback there is untested). The upgrade dialog still closes on Escape only when focus is inside it.

## Rollback

Revert the PR. Sound is off by default, so nothing changes for anyone who has not opened the dialog; the only other behaviour changes are the floating dialogs and the focus fixes.
