# Screen-reader pass (U-28)

Date: 2026-11-13. The owner asked for a screen-reader pass. **A real screen reader has not been run by the author**: macOS blocks scripted access to its accessibility interfaces without a permission only the user can grant, and VoiceOver's speech cannot be listened to from here. What was done is the part that can be: reading the accessibility tree the browser engines build (the data VoiceOver, NVDA and Narrator speak from), fixing what it showed, and writing the hands-on checklist below for the release-candidate build.

## What the accessibility tree says (host chrome, Chromium engine, four states)

- **Landmarks and headings:** one `main`, a level-1 heading "Unhollowed" (visually hidden), a labelled group "Projector rack", a labelled region "Active modules". Dialogs are `dialog` with a name ("Rack sounds", "Restore ...") and a level-2 heading.
- **Rack keys:** six real buttons with names that say what they will do: "Power on Terminal", "Power off Terminal", "Bring Terminal to front" (when it is running and not in front), "Keep Terminal open" and "Retry saving and power off Terminal" (after an error). The key that cannot be used is `disabled` and reported as pressed.
- **State announcements:** each unit has a visually hidden `status` ("Terminal: off", "booting", "active", "shutting down", "error"), so a change is announced without moving focus. An unsaved-work problem is a `role="alert"`; notices are `role="status"`.
- **Dialogs:** the Sound dialog exposes the master checkbox, a volume slider with its value in words ("70 percent"), and each sound as a checkbox plus a button named "Play <sound>".
- **Decorative parts:** the whole hologram and beam overlay is `aria-hidden`; the rack pictures have empty alt text.

## Found and fixed

- The unsaved-work alert said the same sentence twice ("Terminal did not confirm that it saved. It did not confirm that it saved."), which a screen reader reads aloud twice. The second sentence now says what is true and useful: nothing was closed, the module is still open with its unsaved changes.

## Limits visible in the tree (not fixed)

- The disabled "Power off" keys are reported as both disabled and pressed. That is accurate (the unit is already off) but may sound odd; it is how the rocker is modelled (the pair is a two-state switch).
- The module frames are plain frames with a title; what each app exposes inside is that app's own accessibility, not audited here.

## Hands-on checklist for the release candidate (about 15 minutes)

**macOS, VoiceOver (Command+F5).** Safari-family web views reach buttons with VoiceOver's own navigation (VO+Right) or, with Full Keyboard Access on, Tab.
1. On launch, VO should announce the window and let you reach "Projector rack". Move through the six keys: each should read as a button with its full name.
2. Press "Power on Terminal" (VO+Space). Expect: it announces "Terminal: booting" then "active" (or just "active"), and focus lands in the Terminal interface. Terminal's own controls are then Terminal's.
3. Return to the rack. The Terminal key now reads "Bring Terminal to front"; "Power off Terminal" is available. Power it off: expect "shutting down", then "off", and focus on "Power on Terminal".
4. Open "Sound…": VO should read the dialog name and let you tick "Play rack sounds", change the volume (read in percent) and press a "Play ..." button; Escape closes it and focus returns to "Sound…".
5. Open "Restore data…": the dialog names itself, the copy list is readable, and Escape closes it.
6. With Reduce Motion on (System Settings, Accessibility, Display), nothing should flash or sweep.

**Windows, NVDA (or Narrator).** Same steps; Tab reaches all buttons. Check that the status changes are announced and that the Sound dialog sliders read their values.

Write down anything that is unclear, repeated, silent or announced in the wrong order, with the step number; those are the findings for the release notes or a fix.
