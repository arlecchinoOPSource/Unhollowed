# U-28 — Performance, accessibility, privacy and asset review

Issue: [U-28 (#27)](https://github.com/arlecchinoOPSource/Unhollowed/issues/27). Date: 2026-11-13. Host at `main` after U-26 and U-29; modules as pinned in `modules.json` (Swish `b9a244f`, Terminal `0c7b9e9`, Ember `2351a23`). Everything below was measured or read in this session; what could not be measured is in "Not verified". Machine: macOS 26.5.1, Apple Silicon. Browser measurements use the real built host page with a stubbed host (WebKit and Chromium through Playwright); the native numbers come from the real debug app.

## 1. Privacy and local data handling

| Question | Finding | How |
| --- | --- | --- |
| Does shipped web content contact other sites? | **No.** The only absolute URLs in the host and the three module bundles are XML namespaces, React's error-message links and a code comment. `fetch(` appears in four bundles and is used for same-origin files (the preload helper and local audio); there is no `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, WebRTC or service worker. | text scan of `dist/` |
| Is that enforced, not only observed? | The page's security policy allows only `'self'` content and the local command channel (`connect-src 'self' ipc: http://ipc.localhost`, `frame-src 'self'`, `object-src 'none'`, `form-action 'none'`). | `tauri.conf.json` |
| Can the host itself make network requests? | **No HTTP client is in the build.** `hyper`, `reqwest`, `ureq`, `h2`, `rustls`, `native-tls`, `openssl` and `curl` are not in the dependency graph; no updater, shell, fs or http plugin is installed (only the dialog plugin, used from Rust for native file dialogs). | `cargo tree` |
| What may the page call? | 61 permissions: the host's own commands, the three modules' own commands and event listen/unlisten. No filesystem, shell, network or window-management permission. | `capabilities/main.json` |
| Did a real run connect anywhere? | **No.** While the real app ran its self-test with all three modules, sampling every 2 s found no new connection from the app or WebKit's helper processes (the only new ones belonged to an unrelated browser) and no listening socket. Short connections between samples could be missed. | `lsof` sampling |
| Telemetry, accounts, update checks | None exist in code; there is no updater (decision U-36). | code and dependency review |
| What does it write and where? | Module data in the same folders as the standalone apps, owner-only on macOS (checked in the native test and on the packaged app); verified backups `0600` in a `0700` folder; no host-owned data yet. The packaged app ignores the debug-only data override. | native test, `verify-package.mjs` |
| Is content ever logged? | The host and plugins print nothing, except one `eprintln!` in Ember's plugin that reports a storage-open failure reason. | grep of `println!`/`eprintln!` |
| Real user data | Never touched by any test here (throwaway data roots and a throwaway `HOME`). | |

**Accepted risks (spec N3):** command isolation between the three same-origin iframes is not enforced; they are first-party code. **Not claimed (spec N1):** zero network traffic. The operating system's web view, and WebView2 on Windows, may make its own connections; that cannot be audited from here. The README now states the verified privacy facts, and no more.

## 2. Assets and licensing

`scripts/third-party-notices.mjs` builds `THIRD-PARTY-NOTICES.txt` from what really ships (Rust crates in the macOS arm64, macOS x86_64 and Windows build graphs, without proc-macro crates, which run only at build time; npm packages reachable from the production `dependencies` of the host and the three modules, without platform-specific optional add-ons, so the list is the same on every machine that generates it) with each package's own licence text. The file ships inside the app (`Contents/Resources` on macOS, beside the program on Windows), `scripts/package.mjs` refuses to build when it is out of date, and `verify-package.mjs` checks that the shipped copy matches.

- **234 packages (59 npm, 175 Rust). Every licence is permissive or an alternative we may choose**: MIT and Apache-2.0 (the large majority), Unicode-3.0, Zlib, BSD-3-Clause, Unlicense, 0BSD, CC0, OFL-1.1 (6 font packages), and **MPL-2.0 for 5 crates** (file-level copyleft, fine unmodified; we do not modify them). No GPL, LGPL or AGPL anywhere.
- 13 Rust crates do not include a licence file in their published package (the `objc2` family, `alloc-stdlib`, `selectors`, ...). For those the notice gives the standard Apache-2.0 or MPL-2.0 text where that is one of the licences, or points to the source repository; it does not invent a copyright line.
- **Fonts** (IBM Plex, Orbitron, Literata) are OFL-1.1; the OFL requires the licence to travel with the fonts, and it now does.
- **Sounds.** Terminal's startup, close and error sounds are the owner's recordings; its "Thock" keys and Kenney interface clicks are CC0; its "Clicky" keys are **CC BY 3.0** (eklee, qubodup), which requires attribution: Terminal shows it in Settings, About, and the notices file now repeats it. The rack sounds are generated from maths in this repository (original); no ElevenLabs sound is included. The rack art, hologram art and app icon are the owner's own work.
- **Terminal and Ember carry an MIT `LICENSE`. The host repository and Swish have none.** That is a decision only the owner can make; it is flagged below and nothing was added.

## 3. Accessibility (spec F7 and N6)

**Automated (axe-core 4, WCAG 2.0/2.1 A and AA plus best practices, host chrome only, WebKit):** 0 violations in each of seven states: all projectors off, Terminal on, Sound dialog, Restore dialog, a refused save (error banner), reduced motion, and the smallest window (640 x 480). Axe could not judge the contrast of the two small links over the rack, so contrast was computed by hand.

**Contrast (WCAG AA needs 4.5:1):** every host text colour passes: links 6.2:1 (13.5:1 on hover), page text 14.1:1, dialogs 12.6:1, notices 11.3:1, the unsaved-work alert 10.0:1, buttons 12.9:1.

**Keyboard.** All host controls are real buttons with names, visible focus rings, and work with Enter and Space (power on and off checked from the keyboard only). Powering a module on moves focus into its interface; the Sound and Restore dialogs open from the keyboard, start on Close, close on Escape from anywhere and return focus to the button that opened them. Tab order (checked in Chromium, the engine WebView2 uses): the notice, then the rack's power keys unit by unit, then Sound and Restore.

**Found and fixed in this review:**
1. **The power keys were smaller than WCAG 2.2's 24 x 24 px minimum target** (21 x 15 px at 800 x 568; 16 x 12 px at the smallest window). They now have an invisible hit area of at least 24 x 24 px that grows vertically and outward from each key; measured in the real app at 800 x 568. A second bug was hiding behind it: the picture layers around the keys (emitter and chase boxes) were catching clicks on top of the keys' surroundings; they now ignore the pointer.
2. **Tab order put Sound and Restore before the power keys**; the rack is now first.
3. **After a module closed, focus stayed on that unit's now-unusable power-off key**; it now moves to that unit's power-on key.

**Text scaling and small windows.** At the minimum window (640 x 480), with all text enlarged to 200%, and at 1100 x 700 with 200% text, nothing overflows, every key stays inside the window, and the Sound dialog fits or scrolls with Close reachable. The keys are drawn small at the minimum window size (16 x 12 px) but are still 24 x 24 px to hit.

**macOS keyboard note.** In WebKit (the macOS web view) Tab does not reach buttons unless macOS "Keyboard navigation" (Full Keyboard Access) is on, or the person uses Option+Tab; this is the system's behaviour and applies to the standalone apps too. It means keyboard-only operation on macOS depends on that setting. Windows (Chromium) tabs normally.

## 4. Performance and memory (spec N5; budgets were never set, these are proposals)

**Frame times (browser, software-rendered headless, 60 Hz):** boot, retract, steady state and module switch all ran at the display rate: average 16.3 to 17.9 ms, p95 16.7 to 19 ms. Single long frames: 1 to 3 frames over 33 ms during boot (the module frame loading, worst 77 ms in WebKit at 800 x 568) and one frame of 117 to 133 ms in Chromium when a second module frame is created during a switch. No frame loop runs when nothing moves: **0 animation-frame requests from the app** with all projectors off, with one steady active, and after a power-off (an earlier reading of 180 was my own measuring loop being counted).

**Memory.** The rack images decode to about **20 MB** (42 images). The real debug app with all three modules running peaked at about **124 MB** for the main process plus about **379 MB** in the web view's helper processes (about 500 MB in total, with the self-test driving every module; a debug build; other apps using WebKit share some of those helpers, so treat it as an upper bound). JS heap in Chromium: 13 MB.

**Proposed budgets (owner to approve):** p95 frame time at most 20 ms during projection animations at 60 Hz; no frame loop while idle (met); decoded rack art at most 32 MB (met: 20 MB); total memory with all three modules running at most 600 MB on a typical Mac (met by the debug measurement; the release figure is to be measured). A cost knob exists if needed: the layers could be shipped at a lower resolution, or as WebP.

## 5. What changed in the code

Rack keys' hit areas (24 x 24 px minimum) and click-through picture layers; Tab order; focus after close; `THIRD-PARTY-NOTICES.txt` and its generator, shipped in both installers and checked by the packaging scripts; README status and privacy sections rewritten from verified facts (the old status text still said Ember was not embedded). The native test now asserts the 24 px hit areas, and `npm test` covers the licence rules.

## 6. Not verified (do not claim)

- **No screen reader has been run** (VoiceOver, NVDA, Narrator). Names, roles and states are present and axe is clean, which is necessary but not sufficient. The modules' own interfaces are not part of this review (each has its own tests); only the host chrome was audited.
- Windows: all measurements here are macOS. The Windows keyboard and target-size results come from Chromium, not from WebView2 itself; Windows performance and memory are unmeasured; so is startup time.
- A release build's memory and CPU, long-running behaviour, and a physical or high-DPI display.
- Whether anyone on the real network could observe anything from the web view; the "no connection while sampled" result is a sample, not a proof.
- Touch input, high-contrast mode and zoom beyond 200%.

## 7. Owner decisions (2026-11-13)

Decided: **MIT** for the host repository and Swish (Terminal and Ember already are); the owner's own audio may be **reused** across the suite; the proposed **budgets are accepted** and the **minimum window stays 640 x 480**; a **screen-reader pass** is wanted ([SCREEN-READER-U28.md](SCREEN-READER-U28.md)). Recorded in [DECISIONS.md](DECISIONS.md).
