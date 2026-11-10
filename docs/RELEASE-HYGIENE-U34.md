# U-34 — Release tags and manifests across the apps

Issue: [U-34 (#36)](https://github.com/arlecchinoOPSource/Unhollowed/issues/36). Date: 2026-11-10. Method: read-only. Fetched all tags in clones of the three repositories, read `package.json`, `Cargo.toml` and `tauri.conf.json` at each tag commit, and compared them with the GitHub release metadata and asset names. No repository was modified.

## Tag, commit, version and release table

"Manifests" are the app version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (Ember under `desktop/`) at the tag commit.

### Terminal — consistent

| Tag | Commit | Manifests | Release assets | Verdict |
| --- | --- | --- | --- | --- |
| v1.0.0 | `7071143` | 1.0.0 | built by Actions | OK |
| v2.0.0 | `041e0cc` | 2.0.0 | built by Actions | OK |
| v2.0.1 | `605020d` (ancestor of `main` `420a5e6`) | 2.0.1 | universal dmg and app archive, NSIS, MSI | OK |

### Ember — one mismatch

| Tag | Commit | Manifests | Release assets | Verdict |
| --- | --- | --- | --- | --- |
| v1.0.0 | `051c84e` | 1.0.0 | — | OK |
| v2.0.0 | `46323a4` | 2.0.0 | universal dmg/zip, NSIS, MSI, checksums | OK |
| v2.0.1 | `5af1eae` (`main`) | 2.0.1 | universal dmg/zip, NSIS, MSI, checksums | OK |
| v2.0.2 | `5af1eae` (**same commit as v2.0.1**) | **2.0.1** | `Ember_2.0.2_aarch64.dmg` only | **Mismatch**: no source revision says 2.0.2; the fix named in its notes is already in v2.0.1; open Ember issue #34 reports the same error after 2.0.1; `main` has no later commit. The binary may not be reproducible from any commit. |

### Swish — three mismatches

| Tag | Commit | Manifests | Release assets | Verdict |
| --- | --- | --- | --- | --- |
| v1.0.0 | `476cc6e` (on branch `codex/centered-dialogs`) | package/tauri/Cargo 0.1.0 | `Swish_0.1.0_aarch64.dmg`, `Swish_0.1.0_x64-setup.exe` | Release is "1.0.0" but binaries and manifests say 0.1.0 |
| v1.0.1 | `002a6f3` (**ancestor of v1.0.0**) | 0.1.0 | `Swish_1.0.1_macos.zip` only | **Mismatch**: tag predates the 1.0.1 change (`23316fa`); no Windows installer |
| v2.0.1 | `a307351` (one commit before `main` `735370a`) | package/tauri **1.0.1**, Cargo 0.1.0 | `Swish_2.0.1_macos.zip` only | **Mismatch**: the commit that sets 2.0.1 (`735370a`) is not tagged; no Windows installer |

Also: Swish `src-tauri/Cargo.toml` and `swish-data` say 0.1.0 at every tag and on `main`; `bundle.targets` lists `app` and `nsis` while v1.0.0 shipped a dmg; open Swish issue #34 is titled "1.0.1" though 1.0.1 shipped. Terminal issue #20 (T-20) is stale after the 1.0 and 2.x releases.

## Issues filed in the owning repositories

- Ember: [Ember#35](https://github.com/arlecchinoOPSource/Ember-by-Arlecchino/issues/35) — release v2.0.2 matches no source revision.
- Swish: [Swish#36](https://github.com/arlecchinoOPSource/Swish/issues/36) — tags v1.0.1 and v2.0.1 do not match releases or manifests.
- Terminal: [Terminal#69](https://github.com/arlecchinoOPSource/Arlecchino-s-Terminal-Journal/issues/69) — stale T-20 only.

## What UNHLW pins

Rule (recommended, pending approval):

1. UNHLW pins each module by **full commit SHA** and records the tag and manifest version next to it. A tag is only a label.
2. A pin is accepted only if the commit's three manifests agree and equal the release version (a one-line check per repo, see below).
3. Today's usable pins, taken from the audited heads, are Terminal `420a5e6`/tag `v2.0.1` `605020d`, Ember `5af1eae` (tags `v2.0.1` and `v2.0.2` both resolve here, so treat as 2.0.1), and Swish `735370a` (not tagged; `v2.0.1` is one commit earlier and reports 1.0.1). Re-evaluate after the owning repositories fix their tags.
4. Cross-repository edits stay with the owners; UNHLW does not retag or force-push anywhere.

Check used (per repository, from a clone):

```sh
for f in package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json; do
  git show "$SHA:$f" | grep -m1 -E '"version"|^version'
done
```

## Not verified

- Which commit produced each binary; assets were not downloaded or inspected, only their names.
- Whether Terminal's and Ember's earlier tags (v1.0.0, v2.0.0) match their release assets beyond names.
- Whether the Ember 2.0.2 fix exists outside the pushed branches.
