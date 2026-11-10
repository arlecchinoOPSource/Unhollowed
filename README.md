# U.N.H.L.W. (Unhollowed)

UNHLW is a planned local-first desktop suite uniting the real Terminal journal, Ember habit tracker and Swish productivity utility in a hardware-inspired host. The standalone apps remain independently maintainable and usable. It is intended for people who want the Arlecchino tools together in one installation on macOS and Windows.

The interface is envisioned as a solid metallic rack with three projector units and interactive holographic app interfaces. The planned implementation uses Tauri 2, React, TypeScript, Vite and Rust, with Blender-produced 2.5D assets and a reviewed, pinned Arlecchino Core dependency.

**Status:** foundation scaffold (U-03). A Tauri host named Unhollowed runs the real Swish web app inside an iframe through a small IPC shim, against Swish's real storage code, as the first slice. Terminal and Ember are not embedded yet, there is no rack artwork, CI runs the checks on macOS and Windows (docs/CI.md); packaging and release are not established. Builds are unsigned and there is no in-app updater. Follow [the backlog](docs/BACKLOG-DRAFT.md), [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md) and [contributing](CONTRIBUTING.md). Track work in [GitHub issues](https://github.com/arlecchinoOPSource/Unhollowed/issues). The owner approves merges and releases.

Use the private [Arlecchino Development board](https://github.com/users/arlecchinoOPSource/projects/3) to follow the backlog. Branch protection was not enforceable while the repository was private; the repository is now public and availability will be re-verified (U-04). Until then the owner approval and review gate is manual.

## Build and run (macOS verified; Windows not yet)

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
