# Continuous integration

Issue: [U-04 (#5)](https://github.com/arlecchinoOPSource/Unhollowed/issues/5). Workflow: `.github/workflows/ci.yml`. It runs only commands that exist in this repository (see the README).

## What runs

| Job | When | What it proves |
| --- | --- | --- |
| `checks (macos-latest)`, `checks (windows-latest)` | every pull request and push to `main` | `npm run check`: TypeScript, the JS tests (shim, pin checks), the web build, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` for the whole workspace. The pinned Swish source is cloned without submodules and its manifests are verified, so no private repository is needed |
| `native self-test` (macOS, Windows; independent of `checks`) | pushes to `main` and pull requests from this repository, when the secret `CORE_READ_KEY` exists (it does as of 2026-11-11) | builds the pinned Swish bundle and the host, then `npm run test:native`: a real window drives the real Swish UI with synthetic data and checks close handling. This is the first run of that test on Windows |

Not covered: Linux (not a supported platform), UI tests of the rack (none exist yet), installers and packaging (U-29), accessibility and performance (U-28).

## Design choices

- **Least privilege:** `permissions: contents: read` for the whole workflow; checkouts do not persist credentials; the only secret is `CORE_READ_KEY`, used in one job.
- **Pinned actions:** every third-party action is pinned to a full commit SHA, with the tag in a comment, as `docs/TESTING.md` requires. Update them deliberately, one pull request at a time.
- **Fork pull requests** do not receive secrets, so they run `checks` only.
- **Concurrency:** a newer push cancels the older run for the same ref.

## Reading the private Core repository

Swish's web build needs the private `Arlecchino-Core` repository (its submodule). GitHub allows a deploy key on only one repository, so Swish's key cannot be reused. This repository therefore has its own **read-only deploy key on Core** (title "Unhollowed CI (read-only)", key id 169472165, created 2026-11-11), and its private half is the Actions secret `CORE_READ_KEY`. Both were created by the agent at the owner's request and tested: with only that key, `git ls-remote git@github.com:arlecchinoOPSource/Arlecchino-Core.git HEAD` returned Core's `main` (`d869e09`). The local key files were deleted afterwards; the private half exists only in the secret, which cannot be read back.

The sequence that worked (run from a throwaway folder; needs `gh` signed in as an admin of both repositories):

```sh
cd "$(mktemp -d)"
ssh-keygen -t ed25519 -N "" -C "unhollowed-ci-core-read" -f ./unhlw-core-read -q
gh repo deploy-key add ./unhlw-core-read.pub -R arlecchinoOPSource/Arlecchino-Core --title "Unhollowed CI (read-only)"
gh secret set CORE_READ_KEY -R arlecchinoOPSource/Unhollowed < ./unhlw-core-read
# optional check, using only this key:
GIT_SSH_COMMAND="ssh -i ./unhlw-core-read -o IdentitiesOnly=yes" git ls-remote git@github.com:arlecchinoOPSource/Arlecchino-Core.git HEAD
rm ./unhlw-core-read ./unhlw-core-read.pub
```

Do not pass `--allow-write`. Check the result with `gh api repos/arlecchinoOPSource/Arlecchino-Core/keys` (the new key must show `read_only=true`) and `gh secret list -R arlecchinoOPSource/Unhollowed`.

To rotate: run the sequence again, confirm a CI run passes, then remove the old key with `gh repo deploy-key delete <id> -R arlecchinoOPSource/Arlecchino-Core`. A longer-term alternative is to make Core public or to publish `@arlecchino/suite-ui` as a package, which removes the secret entirely (U-35 / Core C-10).

## Branch protection

The repository is public, and GitHub's API answers "Branch not protected" for `main` rather than a plan limitation, so protection is available. It is **not enabled**: enabling it is a settings change that needs the owner's approval, and required checks should exist first. After the workflow has run green once, a suitable rule is: require a pull request, require the two `checks (...)` jobs, no force-pushes or deletion, administrators not exempted only if the owner wants that:

```sh
gh api -X PUT repos/arlecchinoOPSource/Unhollowed/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["checks (macos-latest)", "checks (windows-latest)"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Zero required approvals keeps a single-owner repository workable while still forcing a pull request and green checks; the independent review the project asks for stays a manual step.

## Known limits

- `macos-latest` is now macOS 26 arm64; its pool was over capacity and its jobs were cancelled unscheduled on every attempt, and `macos-14` is deprecated and rejected by GitHub ("configuration not supported"). The workflow therefore names `macos-15` (arm64). A job that "was not acquired by Runner" is cancelled, not failed.
- The native self-test opens a window; if a runner session cannot show one, the job fails rather than skipping.
- Both `checks` jobs and both native self-tests passed on macOS-15 and Windows in run 42953004601 (2026-11-11). Windows uses a different web view (WebView2) from macOS (WKWebView); keep both in the matrix.
