# U-30 — v1.0.0 release checklist

Issue: [U-30 (#30)](https://github.com/arlecchinoOPSource/Unhollowed/issues/30). Date: 2026-11-13. **This is a release candidate. Nothing has been tagged, uploaded or published, and nothing will be without the owner's explicit authorization.** Gates are those of [RELEASE.md](RELEASE.md) and [SPECIFICATION.md](SPECIFICATION.md) section 8. Status words: **Met** (evidence linked), **Met with limits** (evidence plus a stated gap), **Open** (needs the owner or a machine I do not have).

## What 1.0.0 contains

Unhollowed 1.0.0 (identifier `com.arlecchino.unhlw`, MIT): the host, the rack, the hologram, rack sounds, verified data safety, and the pinned modules:

| Module | Version | Pinned commit | Data folder | Data schema |
| --- | --- | --- | --- | --- |
| Swish | 2.0.1 | `b9a244f` (stale edits are refused) | `com.arlecchino.swish` | 1 (stamped `application_id`) |
| Terminal | 2.0.1 | `0c7b9e9` | `com.arlecchino.terminal` | 1 (plus a per-entry format version, 1) |
| Ember | 2.0.2 | `2351a23` | `com.arlecchino.ember` | 1 |

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Functional embedded modules | **Met** | Native self-test drives the real Swish, Terminal and Ember UIs in the host and checks that what they save reaches each module's own storage (36 native checks on macOS and Windows CI). [SLICE-U03](SLICE-U03.md), [TERMINAL-U06](TERMINAL-U06.md), [EMBER-U09](EMBER-U09.md), [SWISH-U10](SWISH-U10.md) |
| Preserved standalone operation | **Met with limits** | The standalone apps are unchanged except two optional, backward-compatible library seams and Swish's optional stale-edit check. At the pinned commits: Terminal's own tests 89 of 89 (run here); Ember's unit tests 11 + 23 of 34 and UI tests 49 of 50 on macOS (the one failure is a WebKit focus test that **fails identically on the commit before any of our changes**); Swish's CI is green and its UI suite passed 156 of 156. Upstream `main` CI is red for Ember and Core and cancelled for Terminal's macOS/Linux jobs: Ember's failing jobs fail in the **setup steps** ("Install Tauri and WebDriver system packages", "playwright install --with-deps"), not in tests, and the macOS/Linux cancellations are the hosted-runner capacity problem already recorded. Not run: each standalone app's installer and native tests on Windows beyond what their CI did. |
| Tested persistence and recovery | **Met** | [DATA-AUDIT-U12](DATA-AUDIT-U12.md), [DATA-COMPAT-U13](DATA-COMPAT-U13.md), [DATA-SAFETY-U14](DATA-SAFETY-U14.md), [CHANGE-NOTICE-U15](CHANGE-NOTICE-U15.md), [FAILURE-TESTS-U16](FAILURE-TESTS-U16.md): verified backup before any upgrade, confirm-before-migrate, restore at next start, change notice, 29 engine tests including failure injection. Disk-full and a failing migration inside a module are not injected. |
| Documented migration and compatibility | **Met** | The table above, the rules in [DATA-COMPAT-U13](DATA-COMPAT-U13.md) (approved), and the release notes. Every schema is 1, so no migration exists yet to exercise on a real upgrade. |
| Accessible interaction | **Met with limits** | [REVIEW-U28](REVIEW-U28.md): axe 0 violations in seven states, AA contrast, 24 px targets, keyboard and focus. [SCREEN-READER-U28](SCREEN-READER-U28.md): accessibility tree reviewed and one fix. **Open: the hands-on VoiceOver and NVDA pass (checklist in that document), to be run on the release candidate.** |
| Performance validation | **Met with limits** | [REVIEW-U28](REVIEW-U28.md) section 4 against the budgets the owner accepted: 60 Hz animations, no idle frame loop, 20 MB art. Not measured: Windows, release-build memory under all three modules, startup time. |
| Asset licensing | **Met** | `THIRD-PARTY-NOTICES.txt` (234 packages, all permissive; CC BY credit), MIT `LICENSE` for the host and Swish, owner audio reuse decided; shipped inside both installers and checked by the packaging scripts. |
| Privacy and security review | **Met** | [REVIEW-U28](REVIEW-U28.md) section 1. Not claimed: zero network traffic (the OS web view may connect). |
| macOS and Windows native install and regression evidence | **Met with limits** | macOS universal `.app` + `.dmg`: 15 of 15 packaged-app checks. Windows: NSIS and MSI built in CI, silent per-user install, start, uninstall, data untouched (12 of 12). [PACKAGING-U29](PACKAGING-U29.md). **Open: a first launch on a clean Mac and a clean Windows machine, an Intel Mac, installing the MSI, and installing beside the standalone apps with their real data.** |
| Honest status wording | **Met** | Unsigned, ad-hoc on macOS, not notarized, no updater: in the README, `STATUS.txt`, and the release notes; a test fails if the wording ever claims otherwise. |

## Known issues to state in the release notes

- Unsigned builds: macOS Gatekeeper and Windows SmartScreen warn on first launch (steps in [PACKAGING-U29](PACKAGING-U29.md)).
- On macOS, keyboard navigation reaches buttons only with Full Keyboard Access on (or Option+Tab); this is the system's behaviour.
- The hologram and rack art were not tested with a screen reader or on touch screens.
- Ember's UI test "Full, Reduced, Off, and OS reduced motion keep navigation and focus usable" fails in WebKit in Ember's own repository (also before our changes).
- No automatic updates: a newer version is installed by hand, over the old one.

## Before the owner publishes

1. Run the screen-reader checklist on the candidate and record the result.
2. Open the candidate on a clean Mac and a clean Windows machine (or a fresh user account) and check first launch, then open a real data file you have a copy of.
3. Decide the tag and the GitHub release (this branch is not tagged). Attach `Unhollowed_1.0.0_universal.dmg`, the Windows installers (the CI artifact of the release commit), `SHA256SUMS.txt`, and `RELEASE-NOTES-1.0.0.md`.
4. Re-run the full check on the commit that will be tagged.

## Regression run for this candidate (macOS 26.5.1, Apple Silicon)

See the pull request for the exact outputs: `npm run check` (types, 80+ JS tests, web build, Rust fmt/clippy/tests), the native self-test, `node scripts/package.mjs --universal` and `node scripts/verify-package.mjs --universal`, and the Windows CI jobs.
