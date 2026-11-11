# Contributing

Read AGENTS.md and the issue first. Use a focused issue branch, preserve unrelated work, and open a PR that explains behavior, checks, platform coverage, migration/security impact and remaining risks. Use synthetic data. Changes that affect shared architecture or storage require explicit review; the product owner approves merges and releases. Build and check commands exist (README) and run in CI (docs/CI.md).

Branch protection is enabled on `main` (since 2026-11-11, owner decision; see docs/CI.md): force-pushes and deletion are blocked, changes need a pull request, and the `checks (macos-15)` and `checks (windows-latest)` jobs must pass. It requires no approving review and does not apply to repository administrators, so the product owner must still manually confirm the independent review, the native self-test results and final approval before merging.
