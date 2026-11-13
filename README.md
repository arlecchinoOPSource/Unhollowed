# U.N.H.L.W. (Unhollowed)

UNHLW is a planned local-first desktop suite uniting the real Terminal journal, Ember habit tracker and Swish productivity utility in a hardware-inspired host. The standalone apps remain independently maintainable and usable. It is intended for people who want the Arlecchino tools together in one installation on macOS and Windows.

The interface is envisioned as a solid metallic rack with three projector units and interactive holographic app interfaces. The planned implementation uses Tauri 2, React, TypeScript, Vite and Rust, with Blender-produced 2.5D assets and a reviewed, pinned Arlecchino Core dependency.

**Status:** development build 0.1.0, not released. Unhollowed runs the real Terminal, Ember and Swish web apps in one host window, each against its own storage code and data folder (shared with the standalone apps), behind a rack of three projectors with a hologram effect, optional rack sounds and verified backups before any data upgrade. macOS and Windows installers can be built (docs/PACKAGING-U29.md) but are **unsigned**: macOS builds are ad-hoc signed and not notarized, Windows installers are not code-signed, and there is **no automatic updater**. The remaining release work is tracked in the issues (U-27, U-28, U-30).

## Privacy (what has been verified, docs/REVIEW-U28.md)

- No accounts, no telemetry and no update check. The shipped web content makes no network request to any other site, the host contains no HTTP client, and its security policy only allows the app's own content and its local command channel. While a real run was sampled, the app opened no network connection.
- Data stays on this computer, in the same folders as the standalone apps (owner-only permissions on macOS), and is never opened or changed without a verified copy first when its format must be upgraded.
- Not claimed: zero network traffic. The operating system's web view (Windows WebView2 in particular) may make its own connections.
- Third-party code, fonts and sounds and their licences: THIRD-PARTY-NOTICES.txt (also inside the installed app).

Use the private [Arlecchino Development board](https://github.com/users/arlecchinoOPSource/projects/3) to follow the backlog. Branch protection is enabled on `main` (docs/CI.md): changes need a pull request and green `checks` on macOS and Windows; the owner's approval and the independent review stay a manual gate.

## Build and run (macOS verified; Windows not yet)

For prerequisites, local checks, native self-tests and troubleshooting, see [Local macOS testing](docs/LOCAL_MACOS_TESTING.md).

Needs Node 24, Rust 1.90 or newer, and your own GitHub access for the private Core repository (Swish pulls it as a submodule).

```sh
npm ci
npm run build:modules      # clones Swish at the commit in modules.json, checks its manifests, builds its bundle
npm run dev                # development window
npm run check              # typecheck, JS tests, web build, cargo fmt, clippy, cargo test
npm run build:web && cargo build -p unhollowed --features custom-protocol
npm run test:native        # opens a window for about 20 s and drives Swish with synthetic data
```

`npm run test:native` uses a throwaway data folder (`UNHLW_DATA_ROOT`, debug builds only) and never touches real data. See [the slice report](docs/SLICE-U03.md).
