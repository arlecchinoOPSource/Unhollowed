# Contributing

Read AGENTS.md and the issue first. Use a focused issue branch, preserve unrelated work, and open a PR that explains behavior, checks, platform coverage, migration/security impact and remaining risks. Use synthetic data. Changes that affect shared architecture or storage require explicit review; the product owner approves merges and releases. Build and check commands exist (README) and run in CI (docs/CI.md).

GitHub reported on 2026-11-10 that branch protection rules would not be enforced while this repository was private under the current account plan. The repository has since been made public and GitHub now offers branch protection (verified, see docs/CI.md); it is not enabled, so the manual gate below still applies. Until enforcement is available and verified, the product owner must manually confirm the PR, independent review, applicable checks and final approval before merging. No required status checks exist until genuine CI is established.
