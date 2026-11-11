# Ember inside Unhollowed (U-08, U-09)

Ember is the third embedded module, built the same way as Terminal ([TERMINAL-U06.md](TERMINAL-U06.md)): Ember's own library supplies the habit commands and storage, a small plugin crate registers them under the `ember` plugin, and Ember's unmodified web app runs in an iframe behind the host adapters.

## What changed in Ember (Ember PR 38, pinned by full SHA in `modules.json`)

- `commands.rs` holds the habit and history commands, `Database` and `open_at`, moved unchanged and made `pub`.
- `standalone.rs` holds sounds, close handling and `run()`, behind a default-on `standalone` feature. The host depends on the crate with `default-features = false`, so `generate_context!` never needs Ember's own frontend build.
- Command names, arguments, permissions and behavior are unchanged; standalone Ember still passes its own tests.

## What the host adds

- `crates/module-ember`: plugin `ember`, data in `<data_dir>/com.arlecchino.ember/ember.sqlite3` (Ember's existing file; `UNHLW_DATA_ROOT` overrides it in debug builds). `finish_exit` reports to the host (`unhlw://module-flushed`) and never exits the app.
- `adapter/tauri-window.js`: Ember asks `getCurrentWindow().onCloseRequested`; a module has no say over close, so this registers nothing. The host sends `ember:exit-requested`, which Ember already handles.
- `modules.json` gains `appDir` because Ember's app is in `desktop/`; `scripts/build-modules.mjs` installs and builds there. Ember's `@arlecchino/suite-ui` is its own `packages/suite-ui`, so no private repository is needed for Ember.
- The preview-only `@tauri-apps/api/mocks` import is not in the host bundle; the build's internals check passes.

## Limits (not claimed)

- **Audio:** the host plays none of Ember's native startup or close cues. `play_startup_sound` and `sound_preferences_set` do nothing and `startup_sound_native` returns false. Who owns audio in the host is still open (U-10 audio decision).
- **Not exercised in the host:** export/restore of history, the website snapshot import, rename/move/archive/delete, keyboard grid navigation. The native self-test creates one habit through the real UI and reads it back through the plugin.
- **Focus:** three modules show at once; the autofocus rule is U-11.
- **Real user data:** untested; synthetic data only (U-14, U-15).
