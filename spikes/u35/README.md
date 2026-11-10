# U-35 spike: an unmodified app bundle in an iframe behind an IPC shim (throwaway)

Extends the U-31 spike (`spikes/u31`). Evidence for `docs/HOST-CONTRACT-U35.md`. Not production code.

1. Clone Terminal at `420a5e6`, run `npm ci`, then `npx vite build --base=./ --outDir <out>`. Copy `<out>` to `host/dist/modules/terminal/` (not committed, 3.9 MB) and add `<script src="../../shim.js"></script>` inside its `<head>`.
2. `cargo build -p u31-host --features custom-protocol` then `U31_OUT="$PWD/out.json" ./target/debug/u31-host`.
3. `results.json` (key `E_terminal_real_bundle_in_iframe`) is the recorded output: macOS, Tauri 2.12.5, `wry` 0.57.2.

`host/dist/shim.js` installs `window.isTauri`, a replacement `__TAURI_INTERNALS__` whose `invoke` prefixes unprefixed commands with `plugin:<module>|`, and passes everything else through to the parent window's internals. Note: Tauri defines `invoke` as non-writable, so the shim must use `Object.defineProperty`.
