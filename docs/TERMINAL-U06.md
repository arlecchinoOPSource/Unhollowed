# U-06 — Terminal as a module

Issue: [U-06 (#7)](https://github.com/arlecchinoOPSource/Unhollowed/issues/7). Date: 2026-11-11. Terminal change: [Terminal PR #70](https://github.com/arlecchinoOPSource/Arlecchino-s-Terminal-Journal/pull/70) (authorized by the product owner). This records what was extracted, how it was verified, and what was not.

## What Terminal needed

Terminal's journal logic (`journal`, `storage`, `backup`, `preferences`) was already plain Rust, but its Tauri commands, the state they use and the app's `run()` all sat in the crate root of `lib.rs`. Three things stopped a host reusing them:

1. **Commands in the crate root cannot be exported** (Tauri generates helper macros that clash with `pub`), and three more helpers (`write_atomically`, `safe_file_name`, `display_name`) were private.
2. **`backup_restore` asked the app for its own data folder** (`app_data_dir()`), which inside a host is the host's folder, not the journal's.
3. **`generate_context!` in `run()`** demands the standalone app's frontend build whenever the crate is compiled, even as a dependency.

## The upstream change (no behaviour change for the standalone app)

- **`commands.rs` (public module):** the 12 commands, `Database`, `PendingRestore`, the helpers and a new `open_in(dir)` (the folder creation and database open that `setup` did inline), moved unchanged. Command names, arguments and the capability lists are untouched.
- **`DataDir`:** managed state holding the journal folder. The standalone app fills it from its own identifier exactly as before; `backup_restore` reads it, so a host points it at the journal's existing folder (decision U-33).
- **`standalone.rs` behind a default feature `standalone`:** the window, close handling, `journal_finish_exit`, the exit plan and `run()`. A host depends on the crate with `default-features = false` and gets none of it.
- Two JS tests that read the Rust source now read the files the code moved to.

Checks on Terminal: `cargo fmt --check`, `clippy -D warnings` (both feature sets), 34 Rust tests, 89 JS tests, `startup-metrics` build.

## The module (this repository)

`crates/module-terminal` is a Tauri plugin named `terminal`. It registers **Terminal's own commands** (`app_lib::commands::*`) and supplies the one that must differ, `journal_finish_exit`, which reports to the host and never exits the app. Its setup opens `<data root>/com.arlecchino.terminal/journal.sqlite3` through Terminal's own `open_in`. The plugin is typed to the desktop runtime because Terminal's commands are. No Terminal code is copied; `.modules/terminal` is a clone at the commit pinned in `modules.json` (manifests verified). The host registers the dialog plugin Terminal's backup and export commands use from Rust.

Terminal's frontend needed no adapter work: it imports only `invoke`, `isTauri` and `listen`, which the adapters already provide. The host now shows several modules side by side.

## Verification

macOS, native self-test with both modules mounted, synthetic data (16 checks, all passed): Terminal and Swish render in their iframes; a Terminal entry was typed into the real editor, the UI reported "Saved", and `journal_list` through the plugin returned it; Swish's project test as before; every command routed to its own plugin; each iframe keeps its own theme; no localStorage collision (both were empty at that point, so this proves little); the close handshake waited for both modules and exited cleanly; both databases were written in the throwaway root. Frame widths after resizing to 800 px were 400 and 400.

Windows and the Terminal PR's own CI are the remaining evidence; the CI results are linked from the pull requests.

## Finding: two modules compete for focus (Windows)

The first Windows run with both modules passed 15 of 16 checks; the failure was Swish's "name field focused after the dialog opens". A page has one focused element, and Chromium-based WebView2 blurs another frame's focused element when a different frame takes focus (WKWebView on macOS keeps each document's own). Terminal focuses its editor as it finishes starting, which took the focus Swish had just given its dialog field. The self-test now probes one module at a time and focuses the probed frame first. The product consequence is real and unresolved: with several modules visible, a module that autofocuses at load can take focus from the one the person is using. The host needs a rule (only the foreground module may autofocus; part of power and lifecycle, U-11 / open decision O3) before the rack arrives.

## Not done or not verified

- **Backup, restore and export** (native file dialogs) are registered but not exercised by the self-test.
- **Sound** (typing sounds, the close sound's real playback after a gesture) and the Terminal-specific keyboard shortcuts were not tested inside the host; an `AudioContext` created without a gesture is `suspended` on macOS.
- **Terminal's concurrent use alongside the standalone app** is unchanged and unverified here (U-15).
- **Real journals:** the host was never pointed at real user data.
- The pin is the head of Terminal PR #70 until it merges; the commit stays reachable after a merge commit.
