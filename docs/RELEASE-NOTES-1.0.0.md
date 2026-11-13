# Unhollowed 1.0.0

Unhollowed puts Terminal (journal), Ember (habit tracker) and Swish (projects and reminders) in one window: a metal rack with three projectors, each beaming the real app from its screen when you press its power key. The standalone apps stay separate and keep working; Unhollowed uses the same data folders as they do.

## What is in it

- The real Terminal 2.0.1, Ember 2.0.2 and Swish 2.0.1, each with its own storage and settings.
- Power keys that start and stop each app; a module is saved before it closes, and nothing unsaved is ever hidden.
- Safe data: before an app's data format is upgraded, Unhollowed asks first and makes a verified copy; a restore screen brings a copy back at the next start; changes made by another program (for example a standalone app) are noticed and offer a reload; Swish refuses to overwrite a newer change.
- Optional rack sounds (off until you switch them on), keyboard operation, reduced motion, power keys that are at least 24 x 24 px to hit, and a layout that stays usable down to a 640 x 480 window and with enlarged text.
- Built for macOS 11 or later (one universal build for Apple Silicon and Intel) and Windows 10 or later (64-bit). **Tested only on macOS 26 (Apple Silicon) and on GitHub's Windows runner**; Intel Macs, older systems and real Windows PCs are untested.

## Status, honestly

- **The builds are not signed.** macOS: ad-hoc signed, not notarized, so Gatekeeper warns on first launch (right-click the app, choose Open, then Open again; or System Settings, Privacy & Security, Open Anyway). Windows: not code-signed, so SmartScreen warns (More info, Run anyway). Check the download against `SHA256SUMS.txt`.
- **No automatic updates.** Unhollowed never checks for updates; install a newer version by hand. Uninstalling never deletes your data.
- **Privacy.** No accounts, no telemetry. The app's own content makes no network requests; the operating system's web view may. Your data stays in your user folders (owner-only permissions on macOS).

## Data compatibility

| App | Data folder | Format version |
| --- | --- | --- |
| Terminal | `com.arlecchino.terminal` | 1 |
| Ember | `com.arlecchino.ember` | 1 |
| Swish | `com.arlecchino.swish` | 1 |

Unhollowed and the standalone apps read and write the same files. If a future version changes a format, Unhollowed asks before upgrading and keeps a verified copy; an older standalone app will refuse a file that has been upgraded.

## Known issues

- Keyboard navigation on macOS reaches buttons only with Full Keyboard Access on (or Option+Tab).
- The rack and hologram have not been tested with a screen reader or on touch screens.
- Windows MSI installers are provided but have been built and checked less than the NSIS installer.

## Licence

MIT. Third-party notices are in `THIRD-PARTY-NOTICES.txt` (also installed with the app).
