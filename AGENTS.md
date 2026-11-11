# Agent operating guide

For local macOS validation and reporting, follow [Local macOS testing](docs/LOCAL_MACOS_TESTING.md).

UNHLW is a local-first integrated desktop host, not a launcher. Preserve the standalone applications, user data and the product owner's control of direction, merges and releases. Read the assigned issue, README, relevant docs and any more specific instructions before changing code. Treat current capabilities and proposals separately.

Use one branch and one primary implementing agent per issue. Coordinate shared files; open a focused PR with an independent review and do not merge without the owner's approval. Do not modify other Arlecchino repositories unless the assigned issue explicitly requires it. Never commit credentials or real personal data. Use synthetic fixtures, reversible migrations and tested backups; don't assume concurrent database access is safe.

Keep shared UI in the pinned Core dependency and application data and services in their proper owners. Don't copy Core or silently track a moving branch. Read docs/AUDIT-U-01.md for current evidence and limitations (docs/AUDIT-DRAFT.md is superseded). The host owns window, close and quit: embedded modules never call `app.exit` or intercept close. Host builds use synthetic data directories until U-14 and U-15 pass. Supported commands are in the README (`npm run check`, `npm run build:modules`, `npm run test:native`); CI runs them (docs/CI.md). Add tests proportional to the change; document commands, outcomes, native platforms, limitations and rollback in the PR. A completed handoff states the issue, branch, commits, checks, reviewer findings, outstanding risks and next action.
