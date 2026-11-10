# Preliminary architectural audit — 2026-11-10

This is an incomplete, read-only audit of **locally cached** `origin/main` refs; they may lag GitHub. Re-fetch and verify current default-branch heads, releases, issues and PRs before drawing final conclusions. No build or native behavior was tested.

| Project | Cached main commit | Evidence and observations |
| --- | --- | --- |
| Core | `42b811f2347988b7e0b3bea1b6182aa1c52d056a` | `packages/suite-ui/package.json` declares private `@arlecchino/suite-ui` 0.5.0, React entry and separate CSS exports. This is shared UI infrastructure, not the applications. |
| Swish | `002a6f3a82ae3b93e2590e532a7e42e344e3276d` | `package.json` declares 0.1.0 and a `file:vendor/arlecchino-core/packages/suite-ui` dependency. `.gitmodules` points to Core; the cached main gitlink is `60971fbf53b965a84c0a90c0a0aa8659268edaf8`. Source includes a Rust data crate and migrations. The local checkout has modified generated schema and untracked installers; preserve them. |
| Ember | `46323a4ca12c0d80e423e438bd09177dce00cac8` | `desktop/package.json` declares 2.0.0 and `file:../packages/suite-ui`, an in-repository UI package rather than the external Core submodule. Native storage code exists. The active local checkout is a separate branch, not this cached main. |
| Terminal | `420a5e66d1a3bd1c771dafce1ec0a33db7e7f7f8` | `package.json` declares 2.0.1 and no external Core dependency. Native code uses bundled rusqlite and a versioned initial migration; local storage includes `journal.sqlite3`. Confirm resolved platform paths and all migration/backup semantics before designing access. |

Manifest versions are not evidence of published releases. The accessible GitHub metadata identifies `main` as the default branch for all four; the current source commit and release status have not yet been independently verified. No claim is made that any complete application can be imported as a host module. Inspect frontend entry points, Rust commands and capabilities, schemas and paths, native packaging, tests, and current upstream PRs before making an integration decision.

Relevant existing work includes [Core C-02](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/2), [C-09](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/9), [C-10](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/10), [Terminal Core migration C-11](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/11), [Ember Core migration C-12](https://github.com/arlecchinoOPSource/Arlecchino-Core/issues/12), [Swish storage S-07](https://github.com/arlecchinoOPSource/Swish/issues/7), and [Swish recovery S-13](https://github.com/arlecchinoOPSource/Swish/issues/13). Their current state and applicability require verification.
