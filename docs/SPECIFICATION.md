# UNHLW specification

Status: v0.1, 2026-11-10 (issue [U-02 (#3)](https://github.com/arlecchinoOPSource/Unhollowed/issues/3)). This is the product and requirements baseline. It states what UNHLW must do, which decisions are accepted, what is still open, and which issue delivers each requirement. How it is built is in [ARCHITECTURE.md](ARCHITECTURE.md). Status labels: **Accepted** (owner-approved, recorded in [DECISIONS.md](DECISIONS.md)), **Open** (undecided), **Untested** (decided but not yet proven). Nothing here claims implemented behaviour; no application code exists yet.

## 1. Purpose and scope

UNHLW is a local-first desktop suite for macOS and Windows that installs once and gives the user the real Terminal (journal), Ember (habit tracker) and Swish (projects and reminders) applications inside one hardware-inspired host: an industrial rack with three projector units whose holograms contain the live apps. The standalone apps remain independently released and maintained. The rack is the frame, not a substitute for app functionality ([VISION.md](VISION.md)).

**Out of scope for 1.0** (from [PRODUCT.md](PRODUCT.md) and [DECISIONS.md](DECISIONS.md)): accounts, cloud sync, telemetry, replacing the standalone products, a real-time 3D engine, an in-app updater, a monorepo merge, other platforms (Linux, iOS).

## 2. Users and platforms

People who already use, or want to use, the Arlecchino tools together. Supported: macOS 11 or later (the apps' current minimum) and Windows 10/11 x64. Windows has not been run natively by any decision spike so far (**Untested**).

## 3. Functional requirements

| ID | Requirement | Status | Delivered by |
| --- | --- | --- | --- |
| F1 | One installer provides working Terminal, Ember and Swish; no separately installed app is launched. | Accepted | U-07, U-09, U-10 |
| F2 | Each module is the app's real UI and logic: Terminal writes, saves, searches and archives entries; Ember creates habits, records completions and keeps history; Swish manages projects and reminders. | Accepted | U-06 to U-10 |
| F3 | Three projector units on a metal rack, each with an aperture, a functional power control and indicator lighting; three visually distinct identities with a shared hardware language. | Accepted | U-17 to U-22 |
| F4 | Projector power controls the module surface through defined states (off, booting, active, shutting-down, error). Exact meaning of power-off for unsaved work and running timers is **Open** (see §9). | Open | U-23, U-24, U-11 |
| F5 | Decorative controls (knobs, switches without a function) never change user data. | Accepted | U-25 |
| F6 | Switching or powering a projector never loses unsaved work or wrongly resets active timers. | Accepted (mechanism Untested) | U-11 |
| F7 | Keyboard operation of all host controls and focus movement between modules; screen-reader labels; text scaling; readable at small window sizes. | Accepted | U-26, U-28 |
| F8 | Sound is optional, independently adjustable, failure-tolerant and does not block work; reduced motion is honoured; motion never blocks input. | Accepted | U-26 |
| F9 | Existing user data from the standalone apps is visible in UNHLW with no import step, and data written in UNHLW is visible to the standalone apps. | Accepted (Untested) | U-14, U-15, U-16 |
| F10 | Backups: each module keeps its own backup/restore; nothing is deleted by uninstalling UNHLW. | Accepted | U-14, U-29 |

## 4. Non-functional requirements

| ID | Requirement | Status |
| --- | --- | --- |
| N1 | **Local-first:** no accounts, telemetry, cloud service or network requirement introduced by UNHLW; no claim of zero network traffic (the Windows WebView2 component makes its own connections, per Terminal's release notes). | Accepted |
| N2 | **Data safety:** modules keep their existing files and folders; no merged store; verified backup before any module migration; never open real user data until U-14 and U-15 pass; synthetic data only before that. | Accepted |
| N3 | **Least privilege:** one Tauri plugin per module with prefixed commands and its own permissions; no direct frontend filesystem, shell or network access. Command isolation between same-origin iframes is **not enforced** (accepted risk, first-party code only). | Accepted |
| N4 | **Standalone independence:** no change to another repository without an owner-authorized issue; apps do not depend on UNHLW; each standalone build, test and release continues unchanged. | Accepted |
| N5 | **Performance:** frame time and memory measured on typical hardware before any claim; no real-time 3D engine. | Open (budgets not set) |
| N6 | **Accessibility and contrast:** WCAG AA contrast for host chrome; assets licensed and recorded. | Accepted |
| N7 | **Reproducibility:** modules are pinned by full commit SHA whose manifests agree ([RELEASE-HYGIENE-U34.md](RELEASE-HYGIENE-U34.md)); dependency versions aligned across modules ([DEPENDENCY-ALIGNMENT-U32.md](DEPENDENCY-ALIGNMENT-U32.md)). | Accepted |
| N8 | **Honest status:** signing, notarization, update behaviour and platform support are described exactly as verified. | Accepted |

## 5. Accepted decisions (summary)

| Topic | Decision | Source |
| --- | --- | --- |
| Product shape | One independently installable host embedding the three real apps; standalone products continue | DECISIONS |
| Visual strategy | Blender-authored assets in a hybrid 2.5D frontend; live app UI above; no real-time 3D engine | DECISIONS |
| Embedding model | Each module is a Tauri plugin mounted in its own same-origin iframe; native child webviews are the fallback; sandboxed frames rejected | [SPIKE-U31.md](SPIKE-U31.md) |
| Host contract | UNHLW owns it (iframe shim, message protocol, Rust module convention); Core stays UI-only; app frontends mounted unmodified from relative-base builds; backend extraction in the app repos by owner-authorized issues | [HOST-CONTRACT-U35.md](HOST-CONTRACT-U35.md) |
| Lifecycle | The host owns window, close and quit; modules never call `app.exit` | DECISIONS |
| Data | Host identifier `com.arlecchino.unhlw`; modules keep their folders; host resolves them as siblings; verified backup before any migration | [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md) |
| Updates | No in-app updater for 1.0 | [SIGNING-IDENTITY-U36.md](SIGNING-IDENTITY-U36.md) |
| Dependencies | Same `rusqlite` minor and Tauri 2.12.x line everywhere; Swish bump proposed (Swish#35) | [DEPENDENCY-ALIGNMENT-U32.md](DEPENDENCY-ALIGNMENT-U32.md) |
| Governance | One branch and PR per issue; independent review; owner approves merges and releases | AGENTS, CONTRIBUTING |

## 6. Modules

| Module | Identifier | Data file | Today | Needed from its repo |
| --- | --- | --- | --- | --- |
| Terminal | `com.arlecchino.terminal` | `journal.sqlite3` | 2.0.1, library crate whose `run()` starts the whole app; revision-checked saves | Plugin builder with injected data directory (U-06) |
| Ember | `com.arlecchino.ember` | `ember.sqlite3` (+ `sound.json`, `Exports/`) | 2.0.1 source (release v2.0.2 unreconciled, Ember#35); library crate with `run()`; own suite-ui 0.2.0 | Same (U-08); decide host-vs-module audio |
| Swish | `com.arlecchino.swish` | `swish.sqlite3` | 2.0.1 on `main`; Tauri-free data crate, binary-only app crate; `rusqlite 0.37` | Library target plus plugin builder (U-10); `rusqlite` 0.41 (Swish#35) |

Pins (full SHA, recorded 2026-11-10): Terminal `420a5e6` (tag `v2.0.1` is `605020d`), Ember `5af1eae`, Swish `735370a`. Core `d869e09` is read-only reference; Swish pins `42b811f`.

## 7. Constraints

- Tauri 2.12.x, React 19.3.1, Vite 8.3.5, TypeScript 7.0.2, Rust 1.90 minimum, edition 2024, Node 24 (as in the apps).
- Window, close and quit belong to the host; module exits are intercepted (**Untested**).
- Capabilities per module plugin; the merged permission manifest must be tested so handler list, `build.rs` and capability stay in step (lesson from Ember 2.0.0).
- No secrets, real user data or private journals in Git, logs or handoffs.

## 8. Release gates

As in [RELEASE.md](RELEASE.md): functional embedded modules, preserved standalone operation, tested persistence and recovery, documented migration and compatibility, accessible interaction, performance validation, asset licensing, privacy and security review, macOS and Windows native install and regression evidence, upgrade and rollback paths, accurate signing/notarization statements, and explicit owner approval. Setup work is not a release.

## 9. Open decisions

| # | Question | Needed by | Notes |
| --- | --- | --- | --- |
| O1 | Product name for the installer and window (bundle identifier is fixed) | U-03 | Owner |
| O2 | macOS notarization, Windows signing route or unsigned, bundle targets, credential custody | U-29 | U-36 stays open |
| O3 | Meaning of projector power for unsaved work and timers; whether power-off unmounts or hides the iframe | U-11, U-23 | Decide with the U-03 slice evidence |
| O4 | Whether the host or each module owns audio and startup screens beyond 1.0 | U-26 | Modules keep their own for 1.0 (Accepted); iframe autoplay Untested |
| O5 | Cross-process change notification and conflict policy | U-15 | No notification exists today |
| O6 | Performance and memory budgets | U-17, U-28 | None set |
| O7 | Windows data paths and behaviour (Roaming profile, WebView2) | U-27 | Untested |
| O8 | Branch protection now that the repository is public | U-04 | Docs still say private |
| O9 | Whether Ember's v2.0.2 fix exists in any commit | Ember#35 | Pin is source-only meanwhile |
| O10 | Release cadence and compatibility matrix between UNHLW and standalone versions | U-30 | Needs the schema-version table |

## 10. Verification of this specification

Each requirement names the issue that must demonstrate it. A requirement is not met until that issue's acceptance criteria pass on the real platforms listed in [TESTING.md](TESTING.md). Untested items above must be re-run in the U-03 first slice (Ember and Swish bundles, close handshake, iframe audio autoplay, Windows).
