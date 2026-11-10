# Product and architecture — draft

> Superseded by [SPECIFICATION.md](SPECIFICATION.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Kept for history.

UNHLW is intended to unify three real applications inside one independently installable desktop host. A metallic, physical-looking rack holds three distinctive projector units; their illuminated holograms contain live, interactive application interfaces. Projector power affects activation, while decorative controls must not alter user data. Keyboard accessibility, configurable sound and reduced motion are requirements.

The selected initial visual strategy is hybrid 2.5D: create mechanical assets in Blender, render optimized assets in the React frontend, and present real interactive application UI above them. A real-time 3D engine is not a 1.0 prerequisite. The Blender files in the workspace are existing design references whose suitability, licenses and export pipeline still need review.

## Proposed boundaries

- A Tauri host provides a window and narrowly scoped native services. React renders rack, lifecycle controls and application surfaces.
- A versioned host contract should define initialization, mount/unmount, capabilities, error recovery, and preservation of unsaved state. Existing app code must be audited before choosing extraction boundaries; Core UI alone is not application functionality.
- Use a reviewed, commit-pinned Core dependency if the audit supports it. Do not copy Core or silently track a moving branch. Private dependency access in CI must be designed.
- Keep each app independently buildable. No edits to other repositories without an issue explicitly authorizing them. Avoid a monorepo unless separately decided.
- Treat storage and migration architecture as unresolved. Identify actual application paths, schemas, locks, migration versions, backup and restore before selecting a canonical store. Concurrent standalone and host access must be tested with synthetic data; never assume SQLite alone solves compatibility.
- Local-first expectations exclude introducing accounts, telemetry, cloud or network requirements without approval. Review all Tauri permissions and runtime behavior before making privacy claims.

## Release gates and open decisions

The 1.0.0 target requires real application integration, data safety and recovery, accessible keyboard controls, reduced motion, performance and asset licensing review, native macOS and Windows tests, packaging and accurately described signing and update behavior. Product owner approval is required for merges and releases. No release or signing capability is established by this draft.

Decisions still needed include app extraction and versioning, host capabilities, compatible storage and backups, concurrent writes, migration/rollback, existing assets and formats, app power semantics, signing and distribution. Record alternatives and owner decisions with evidence; do not turn proposals into claims of implemented behavior.
