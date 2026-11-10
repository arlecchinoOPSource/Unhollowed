# Decisions

## Accepted product direction — 2026-11-10

- UNHLW is an independently installable integrated host for three real applications, and their standalone products remain independently maintainable. No monorepo merge is authorized.
- Initial visual strategy is Blender-authored mechanical assets rendered in a hybrid 2.5D frontend with live app interfaces. A real-time 3D engine is not a prerequisite for 1.0.
- Local-first behavior, configurable sound and motion, accessibility, and product-owner approval for merges and releases are requirements.

## Accepted plan revisions — 2026-11-10 (owner delegation after the U-01 audit)

Evidence: [AUDIT-U-01.md](AUDIT-U-01.md). Owner: product owner, who delegated these changes to the implementing agent on 2026-11-10; review them with the audit PR.

- **The host owns the window, close and quit.** Modules expose `flush()`/`release()` hooks and never intercept `CloseRequested`/`ExitRequested` or call `app.exit`. Consequence: each app's `finish_exit` becomes a host responsibility ([U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2), [U-11](https://github.com/arlecchinoOPSource/Unhollowed/issues/11)).
- **No merged data store and no new shared schema** is the working direction; the host reads each app's existing files. [U-33](https://github.com/arlecchinoOPSource/Unhollowed/issues/35) confirms paths and identifier. Alternative (a unified store) is rejected unless an audit finding requires it.
- **Interim data rule:** host builds use synthetic data directories until [U-14](https://github.com/arlecchinoOPSource/Unhollowed/issues/14) and [U-15](https://github.com/arlecchinoOPSource/Unhollowed/issues/15) pass.
- **Embedding model is decided by prototype**, not assumed ([U-31](https://github.com/arlecchinoOPSource/Unhollowed/issues/33)). Command names are prefixed per module regardless of the outcome.
- **Foundation order:** audit, then U-31 to U-36 decisions, then scaffold with one real slice, then the host contract derived from it.

## Accepted — U-31 embedding model (product owner, 2026-11-10)

- **Baseline:** each module is a Tauri plugin (prefixed commands and permissions) mounted in its own same-origin iframe inside the host webview. Native child webviews are the fallback if enforced isolation becomes a requirement; sandboxed frames are rejected unless the apps change. Per-module `localStorage` namespacing is required.
- **Accepted risk:** command isolation is not enforced between same-origin iframes; all module code is first-party.
- **Conditions:** the U-03 first slice re-runs the spike checks with a real app surface, including Windows, focus, resize, audio and shutdown, and the decision is revisited if they fail. Evidence and limits: [SPIKE-U31.md](SPIKE-U31.md).

## Proposals and unresolved decisions

The embedding model, host contract, source extraction, pinned Core revision, canonical data access, concurrent use, migration and backup design, signing and update distribution require evidence and review. Do not treat them as accepted simply because they appear in an architecture draft. Record alternatives, rationale, consequences, date and owner when decisions are made.
