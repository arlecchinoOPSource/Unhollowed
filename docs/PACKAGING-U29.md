# U-29 — Packaging (first slice) and the app icon

Issue: [U-29 (#29)](https://github.com/arlecchinoOPSource/Unhollowed/issues/29); also evidence for [U-27 (#28)](https://github.com/arlecchinoOPSource/Unhollowed/issues/28). Date: 2026-11-13. Decisions already made ([DECISIONS.md](DECISIONS.md), [SIGNING-IDENTITY-U36.md](SIGNING-IDENTITY-U36.md)): product name **Unhollowed**, identifier `com.arlecchino.unhlw`, **no in-app updater for 1.0, all builds unsigned** (macOS ad-hoc, Windows unsigned), macOS universal `app` + `dmg` (minimum 11.0), Windows NSIS per-user plus MSI with the WebView2 bootstrapper embedded. **This document and its scripts sign nothing, notarize nothing, upload nothing and publish nothing.** A release is made by the owner.

## The app icon

The owner's logo (`~/Pictures/rack logo.svg`: a rack with three coloured units) is the app icon. The source SVG and a 1024 px transparent render are in `src-tauri/icons/source/`; `npx tauri icon src-tauri/icons/source/rack-logo-1024.png` regenerates every size (`icon.icns` up to 512@2x, `icon.ico` 16 to 256, the PNGs and the Windows tiles). Tauri also writes `android/` and `ios/` folders, which are deleted: 1.0 targets macOS and Windows only. The logo is the owner's own work, so there is nothing to license. At 32 px the three coloured bars are still legible.

## Build and check (macOS, on a Mac)

```bash
node scripts/package.mjs --universal     # modules, host page, release build for arm64 and x86_64, app + dmg; checksums and status note in release-out/
node scripts/verify-package.mjs --universal
```

Needs `rustup target add aarch64-apple-darwin x86_64-apple-darwin`. Without `--universal` it builds for this Mac's architecture only (about 5 minutes less). The script refuses to build when `package.json`, `src-tauri/tauri.conf.json` and the workspace `Cargo.toml` disagree on the version. It writes `release-out/SHA256SUMS.txt` and `release-out/STATUS.txt` (the honest signing/updater status to paste into release notes).

What `verify-package.mjs` checks on the macOS bundle: identity (`com.arlecchino.unhlw`), version and minimum macOS 11.0; the icon is the repository's; the binary is universal; the signature is intact (`codesign --verify --deep --strict`); it is signed **ad-hoc and nothing more**; it is **not notarized** (no stapled ticket); the packaged app **starts**; each module gets its own owner-only (`0700`) data folder directly under `~/Library/Application Support` (so the release data root is shared with the standalone apps); the **debug-only data override is ignored** by a packaged app; the `.dmg` verifies, mounts, and contains the app and an Applications shortcut. The app is started with a throwaway `HOME`, so none of your real data is touched.

## Build and check (Windows)

`.github/workflows/package.yml` runs on a pull request that touches packaging, and on demand (`workflow_dispatch`): it builds the NSIS and MSI installers (unsigned), then `verify-package.mjs` **silently installs the NSIS installer per user on the runner** (the runner is disposable; on any other machine this part is skipped unless `--allow-real-install` is given, because the installer writes to the real profile), starts the app, checks the module folders it creates under the roaming profile, **uninstalls**, and checks that the program files are gone and that **every module's data (a sentinel file planted in each module's folder) is still there**. The installers are kept as a 14-day workflow artifact, not a release. Like the native self-test it needs the `CORE_READ_KEY` secret (Swish's private Core submodule) and is skipped, not failed, without it ([CI.md](CI.md)).

## What users see on first launch (unsigned)

- **macOS:** Gatekeeper refuses an unnotarized app opened by double-click. Open it with right-click, **Open**, then **Open** again; or, if macOS says it cannot verify the app, go to System Settings, **Privacy & Security**, and choose **Open Anyway**. Verify the download against `SHA256SUMS.txt` first. (The exact wording and steps of the dialogs vary by macOS version and are not verified on a clean Mac here.)
- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info**, then **Run anyway**. Smart App Control on Windows 11 may block unsigned installers outright (not verified here).
- **No automatic updates.** A new version is installed by hand from GitHub Releases; the app does not check for updates and makes no network request for it. Module data is untouched by uninstalling.

Release-notes template (fill the checksums from `SHA256SUMS.txt`; keep the status lines exactly as `STATUS.txt` says):

```text
Unhollowed X.Y.Z
<what changed>
Status: macOS builds are ad-hoc signed and NOT notarized; Windows installers are NOT code-signed. There is no automatic updater.
Data: Terminal, Ember and Swish keep their data in the same folders as the standalone apps. Before upgrading a module's data format the app asks first and makes a verified copy (docs/DATA-SAFETY-U14.md).
SHA-256: <checksums>
```

## Evidence (macOS 26.5.1, Apple Silicon, 2026-11-13)

- `node scripts/package.mjs --universal` built `Unhollowed_0.1.0_universal.dmg` (about 26 MB; the `.app` is about 46 MB) from the pinned modules; `verify-package.mjs --universal`: **14 of 14 checks passed**, including that the bundle carries the new logo.
- An earlier arm64-only build was checked the same way. **Found by running it:** my first check expected the host's own `com.arlecchino.unhlw` folder to exist after start; it is not created yet (the host stores nothing of its own), which is correct, so the check now asks only for the module folders.
- This closes the open item from [DATA-AUDIT-U12.md](DATA-AUDIT-U12.md) that the real release data path had not been exercised on macOS: it resolves to `~/Library/Application Support/com.arlecchino.<module>` with mode `0700`.
- `npm test`: 4 tests for the version gate and the status wording (never claims signing or auto-update).

## Not verified (do not claim)

- **Windows installers have not been built or run by me**; the workflow is written and will run in the pull request. Whether NSIS and MSI install, start and uninstall as intended, and where exactly NSIS puts the files, is established by that run (the check tries `%LOCALAPPDATA%\Unhollowed` and `%LOCALAPPDATA%\Programs\Unhollowed`).
- A clean-Mac first launch (Gatekeeper dialogs), an Intel Mac, macOS older than 26, Windows 10, SmartScreen behaviour, Smart App Control, and the MSI install/uninstall.
- Upgrading over a previous Unhollowed build, and installing beside each standalone app with data intact (the data-safety tests cover the data side; the installer side is untested).
- Installer and DMG appearance (window background, size) and the dmg layout are Tauri defaults.
- U-28 (performance, accessibility, privacy and asset review, including Terminal's CC BY 3.0 keyboard-sound attribution) and U-30 (the release checklist, and the 1.0.0 version number, still 0.1.0 here) are separate.

## Rollback

Revert the PR: it adds scripts, a workflow, tests, docs and the icon set; the only change to the shipped app is the icon.
