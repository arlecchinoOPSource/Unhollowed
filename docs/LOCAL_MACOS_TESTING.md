# Local macOS testing

GitHub-hosted macOS runners can queue for a long time or be cancelled before a job starts. Running the same repository commands on a Mac gives faster feedback. It supplements independent CI; it does not replace the required GitHub checks or Windows testing.

This guide describes the commands in `package.json` and `.github/workflows/ci.yml` at this revision. Run them from the repository root. Stop on a failed command and report the failure; do not interpret a skipped or incomplete check as a pass.

## Prerequisites

- macOS with an interactive desktop session for the native test. The bundle configuration sets macOS 11 as its minimum; that setting is not proof that every version has been tested. CI uses Apple Silicon `macos-15`; local testing has also been reported on Apple Silicon macOS 26. Other versions and Intel require their own validation.
- Git, Xcode Command Line Tools and the macOS SDK. Check `xcode-select -p` and `clang --version`. If missing, run `xcode-select --install` and complete Apple's installation prompts.
- Node.js 24 and npm (`node --version`, `npm --version`). Install Node 24 from [nodejs.org](https://nodejs.org/) or use your existing version manager; the project requires `>=24 <25`.
- Rust and Cargo, Rust 1.90 or newer, plus rustfmt and Clippy. CI uses the moving `stable` toolchain. Install Rust using [rustup](https://rustup.rs/), then run `rustup component add rustfmt clippy`. Check `rustc --version`, `cargo --version`, and `rustup component list --installed`.
- Network access to GitHub and package registries for initial downloads. Access to the private Unhollowed repository is needed to clone it. Full module builds also need your own authorized Git access to private Arlecchino-Core, Swish's submodule. Source-only checks do not need Core.

Check the Mac and active architecture with `sw_vers` and `uname -m`. For closest parity with the CI Mac, use native `arm64` tools on Apple Silicon; a translated `x86_64` environment is a different test environment. The build also needs sufficient disk space for npm packages and Rust build artifacts.

## Initial setup

Clone with an authenticated GitHub account that can read this repository. If HTTPS is not configured for your account, use your approved Git credential setup or the repository's SSH URL.

```sh
git clone https://github.com/arlecchinoOPSource/Unhollowed.git
cd Unhollowed
npm ci
node scripts/build-modules.mjs --source-only
```

The last command clones Swish and Terminal into ignored `.modules/`, checks out the exact commits in `modules.json`, and checks their manifest versions. It does not initialize Core or build module web bundles. It requires network access when a source or pinned commit is missing. **Do not use these managed module directories for your own edits:** when a checkout differs from the pin, the script fetches and forcibly checks out the pinned commit.

To inspect the actual and expected revisions:

```sh
node -p "JSON.stringify(require('./modules.json'), null, 2)"
git -C .modules/swish rev-parse HEAD
git -C .modules/terminal rev-parse HEAD
```

Compare each `HEAD` to its `sha` in `modules.json`. For the full build, Swish's Core submodule must also be available at the commit Swish pins. Configure Git authentication for the submodule URL in `.modules/swish/.gitmodules` using your own authorized credentials; do not put credentials in this repository or its logs. The build script initializes missing submodules. A pre-populated submodule folder is accepted by the script, so check it explicitly:

```sh
npm run build:modules
git -C .modules/swish rev-parse HEAD:vendor/arlecchino-core
git -C .modules/swish/vendor/arlecchino-core rev-parse HEAD
```

The two Core hashes must match. The full build installs each module's npm dependencies and writes generated bundles under `public/modules/`; it uses the host's Tauri API adapters. The GitHub Actions `CORE_READ_KEY` secret is CI-specific: a local developer does not need to set it if their Git authentication can read Core. No other environment variable is required for these commands. The native test sets its own temporary data and output paths.

## Running local macOS tests

After source-only setup, the following is the local equivalent of the CI `checks (macos-15)` job:

```sh
npm run check
```

It runs TypeScript checking, JavaScript tests, a web build, Rust formatting, Clippy with warnings denied, and locked workspace Rust tests. The existing individual commands are useful for faster feedback:

```sh
npm run typecheck          # TypeScript
npm test                   # JavaScript unit tests
npm run build:web          # TypeScript and Vite host web build
cargo fmt --check          # Rust formatting
npm run check:rust         # formatting, Clippy and workspace Rust tests
cargo test --workspace --locked
```

Clippy is the Rust lint check within `check:rust`; there is no separate JavaScript lint script in `package.json`. Rust workspace commands need the pinned module sources, even when Core is unnecessary.

For the native integration test, first complete the full module build and verify the Core pin as described above, then run:

```sh
test -f public/modules/swish/index.html
npm run build:web
cargo build -p unhollowed --features custom-protocol
npm run test:native
```

This matches the native CI build and test sequence after module setup. It builds a debug host and opens a real window; allow up to the script's 90-second timeout and do not interfere with the window. It uses a temporary synthetic data root and removes it afterwards. It exercises the real embedded Swish and Terminal interfaces, plugin routing, saving, and the close handshake. A successful process prints its individual `PASS` checks; the local-storage check is weak when both stores are empty. The test records some observations, including audio state and frame widths, without asserting them. It is not a test of real user data.

For a release-mode application compilation without an installer, the existing command is `npm run build` after `npm run build:modules`. It is separate from the debug native test and does not establish installer or signing readiness.

## Recommended AI agent workflow

1. Inspect the changed files and repository instructions; identify the affected behavior and tests.
2. Run the fastest relevant existing checks first. Fix failures introduced by the change and rerun the affected checks.
3. Run `npm run check` and, when native integration may be affected, the full module build and native self-test. Use synthetic data and an interactive session.
4. Record each command, result, macOS version and architecture. State whether the native window actually ran, and report any failure, skipped check, missing access or infrastructure limitation accurately.
5. Commit and push only after the required local checks pass unless explicitly instructed otherwise. Follow the repository's branch, review and owner-approval rules; local success does not authorize a merge.

## Troubleshooting

- **Missing tools:** check `git --version`, `node --version`, `npm --version`, `rustc --version`, `cargo --version`, `xcode-select -p` and `clang --version`. Install the missing prerequisite and open a new terminal if its PATH changed.
- **Wrong Node or Rust:** select Node 24 using your installation method. Select an appropriate stable Rust toolchain and install rustfmt and Clippy. Compare `rustc --version` with the workspace minimum; CI's moving stable version may differ from yours.
- **Rust compilation fails:** read the first error, confirm Xcode tools, Rust components and pinned module sources, and rerun the relevant command. Avoid changing dependencies or the lockfile merely to hide an error; report the complete failure and tool versions.
- **Missing modules or pin mismatch:** run `node scripts/build-modules.mjs --source-only` with network access, then compare the hashes above. Preserve any work in `.modules` first: the script can forcibly change its checkout. Run the full build for bundles and check the Core hash separately.
- **Private Core authentication fails:** confirm that your account has read access and Git can authenticate to the URL in Swish's `.gitmodules`. Do not paste tokens into commands, documentation or logs. CI's deploy key is not a personal login.
- **Permission or launch failures:** use a logged-in desktop session, ensure the repository and temporary directory are writable, and inspect macOS prompts and the command output. Do not weaken system security globally to make the test pass. The debug test must be rebuilt after relevant changes; it requires the host web build and module bundles.
- **Architecture mismatch:** compare `uname -m`, `node -p 'process.arch'`, and `rustc -vV`. Check whether the terminal is running under translation and use a consistent native toolchain. Record the architecture actually tested.
- **Passes locally, fails in Actions:** compare commit, OS and architecture, Node and Rust versions, fresh dependency installation, module/Core pins and the failing job's logs. CI starts with a clean hosted runner, uses a separate read-only Core key for native tests, and can skip the native job for forks or missing credentials. A queued or cancelled runner is not a test failure or a pass.

## Local testing vs GitHub Actions

| | Local Mac | GitHub Actions |
| --- | --- | --- |
| Environment | Your macOS version, architecture, tools and desktop session | Fresh `macos-15` Apple Silicon runner for each job; Windows is a separate matrix entry |
| Availability and speed | No hosted-runner queue; depends on your machine and downloads | Can queue or be cancelled for infrastructure or concurrency reasons |
| Cache | Existing npm, Rust and build caches may speed subsequent runs and can hide clean-build differences | Node's npm cache is configured; jobs still set up their tools and checkout independently |
| Reproducibility | Record tool versions, commit and pins; local machine state varies | Workflow defines the steps and pins Actions, but stable Rust and hosted images can change |
| Security | Uses your own Git access; keep credentials and real data out of output | Read-only repository permissions; native job uses a private Core key. Forks cannot use that secret |
| Limitations | Does not prove Windows, other Mac architectures, clean-room or release behavior | Native tests are not required branch checks and may be skipped; hosted CI also does not cover every manual or release scenario |

Passing on an Apple Silicon Mac does not guarantee success on Intel, another macOS release, Windows, or in a packaged release. Neither path currently proves real sound playback, native backup/restore/export dialogs, full keyboard shortcuts, installers, accessibility, performance, or safe concurrent access to standalone app data. Ember is not embedded yet. See [CI.md](CI.md) and [TERMINAL-U06.md](TERMINAL-U06.md).

## Quick reference

```sh
# From the repository root, after installing prerequisites:
npm ci
node scripts/build-modules.mjs --source-only
npm run check

# Native integration, with authorized Core access and an interactive desktop:
npm run build:modules
git -C .modules/swish rev-parse HEAD:vendor/arlecchino-core
git -C .modules/swish/vendor/arlecchino-core rev-parse HEAD
# Compare the two hashes before continuing.
test -f public/modules/swish/index.html
npm run build:web
cargo build -p unhollowed --features custom-protocol
npm run test:native
```
