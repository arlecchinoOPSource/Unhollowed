# Backlog and dependencies — draft

This is the product owner’s requested backlog, preserved as a local draft. The 30 requested issues have been created and assigned to milestones. Verify and expand issue details as the audit proceeds.



Create thirty GitHub issues covering the following objectives.

Use the identifiers [U-01](https://github.com/arlecchinoOPSource/Unhollowed/issues/1) through [U-30](https://github.com/arlecchinoOPSource/Unhollowed/issues/30) in their titles so that the roadmap remains stable independently of GitHub's automatically assigned issue numbers.

Associate each issue with its proper milestone.

Every issue must include:
- Context and objective.
- Expected outcome.
- Scope of work.
- Out-of-scope work.
- Implementation guidance.
- Dependencies and blockers.
- Acceptance criteria using checkboxes.
- Verification and test requirements.
- Risks and rollback considerations where applicable.
- Suggested implementing agent.
- Suggested independent reviewer.
- Definition of done.

The issues must be sufficiently detailed for Claude or Codex to begin implementation without having to reconstruct the entire product concept from our conversation.

Inspect related existing issues in the Core and standalone repositories. Cross-reference them instead of duplicating the same implementation work.

## M1 issues

**[U-01](https://github.com/arlecchinoOPSource/Unhollowed/issues/1) — Audit Core and existing application integrations**

Verify the actual source structure, dependencies, storage, reusable modules, version compatibility, and integration gaps across all four existing repositories.

Deliver an evidence-based audit report.

Suggested owner: Codex.

**[U-02](https://github.com/arlecchinoOPSource/Unhollowed/issues/3) — Establish product specification and architecture**

Define UNHLW's functional requirements, embedded-module strategy, host responsibilities, architecture constraints, and design decisions.

Suggested owner: Codex, architecture review required.

**[U-03](https://github.com/arlecchinoOPSource/Unhollowed/issues/4) — Scaffold the UNHLW Tauri application**

Establish the basic buildable frontend and native shell.

Connect the verified Core dependency, implement a minimal host placeholder, and demonstrate the development build.

Do not begin complex rack graphics.

Suggested owner: Claude.

**[U-04](https://github.com/arlecchinoOPSource/Unhollowed/issues/5) — Establish continuous integration and repository workflows**

Configure supported checks, PR templates, contribution standards, and development protections.

Use actual supported commands only.

Suggested owner: Codex.

## M2 issues

**[U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2) — Implement embedded application host contract**

Define reusable lifecycle and capability interfaces for independently developed applications running inside UNHLW.

Include native command boundaries, initialization, mounting, and cleanup.

**[U-06](https://github.com/arlecchinoOPSource/Unhollowed/issues/7) — Expose Terminal's reusable application functionality**

Identify and extract or adapt Terminal's journal interface and logic without unnecessarily duplicating its standalone implementation.

Coordinate with existing Core migration tasks.

**[U-07](https://github.com/arlecchinoOPSource/Unhollowed/issues/8) — Integrate Terminal inside UNHLW**

Render a genuine, functional Terminal interface inside the host window.

Test editing, saving, searching, and archives.

**[U-08](https://github.com/arlecchinoOPSource/Unhollowed/issues/9) — Expose Ember's reusable application functionality**

Identify and extract or adapt Ember's grid, habit engine, and user interface.

Preserve its existing behavior and completion history.

**[U-09](https://github.com/arlecchinoOPSource/Unhollowed/issues/6) — Integrate Ember inside UNHLW**

Render a genuine, functional Ember interface inside the host.

Verify habit creation, completion, history, and persistence.

**[U-10](https://github.com/arlecchinoOPSource/Unhollowed/issues/10) — Integrate Swish inside UNHLW**

Reuse its existing Core foundation and embed its functional project, reminder, and utility interfaces.

Preserve the standalone experience.

**[U-11](https://github.com/arlecchinoOPSource/Unhollowed/issues/11) — Implement application activation and lifecycle management**

Develop the host's activation, deactivation, navigation, state preservation, and background-service policies.

Switching between app interfaces must not destroy unsaved work or incorrectly reset active timers.

## M3 issues

**[U-12](https://github.com/arlecchinoOPSource/Unhollowed/issues/12) — Audit existing data stores and schemas**

Document actual SQLite schemas, storage locations, migrations, and permission boundaries.

**[U-13](https://github.com/arlecchinoOPSource/Unhollowed/issues/13) — Design canonical shared-data compatibility**

Define the correct approach for standalone and integrated builds to access the same logical user data.

Explicitly address application permissions and version compatibility.

**[U-14](https://github.com/arlecchinoOPSource/Unhollowed/issues/14) — Implement safe migration and backup handling**

Preserve existing user data when introducing UNHLW.

Prevent destructive migrations and provide appropriate recovery procedures.

**[U-15](https://github.com/arlecchinoOPSource/Unhollowed/issues/15) — Implement concurrency and change notification**

Handle simultaneous use of standalone applications and UNHLW.

Use safe transaction boundaries and refresh data when necessary.

**[U-16](https://github.com/arlecchinoOPSource/Unhollowed/issues/16) — Validate data integrity and recovery**

Test restarts, failed writes, migration failures, concurrent writes, backups, and older-version compatibility.

## M4 issues

**[U-17](https://github.com/arlecchinoOPSource/Unhollowed/issues/17) — Define industrial rack and projector design specification**

Translate the established visual concept into concrete geometry, layout, dimensions, colors, materials, and rendering requirements.

**[U-18](https://github.com/arlecchinoOPSource/Unhollowed/issues/20) — Model the reusable master projector chassis**

Create a maintainable Blender model that establishes the common mechanical architecture.

Include reusable housing, mounting, button, and aperture components.

**[U-19](https://github.com/arlecchinoOPSource/Unhollowed/issues/19) — Create Terminal, Ember, and Swish projector variants**

Produce three recognizable units with distinct visual identities while retaining consistent hardware language.

**[U-20](https://github.com/arlecchinoOPSource/Unhollowed/issues/18) — Establish Blender asset export and optimization pipeline**

Define source asset management, rendering, transparent layers, optimized formats, asset licensing, and frontend integration.

**[U-21](https://github.com/arlecchinoOPSource/Unhollowed/issues/21) — Implement the rack frontend layout**

Assemble the rack in the application with appropriate scaling, interaction regions, window resizing, and display behavior.

**[U-22](https://github.com/arlecchinoOPSource/Unhollowed/issues/22) — Polish mechanical materials, panel lighting, and visual detail**

Refine metallic surfaces, hardware depth, typography, labels, LED lighting, and consistent rendering.

## M5 issues

**[U-23](https://github.com/arlecchinoOPSource/Unhollowed/issues/23) — Implement projector state machine**

Define off, booting, active, shutting-down, and error states with deterministic transitions.

**[U-24](https://github.com/arlecchinoOPSource/Unhollowed/issues/24) — Implement hologram projection and retraction**

Make the actual interactive interfaces visually emerge from their projectors and retract upon deactivation.

Preserve readability and input reliability.

**[U-25](https://github.com/arlecchinoOPSource/Unhollowed/issues/25) — Implement power controls and decorative machine behavior**

Connect functional power buttons to the state machine.

Add indicator LEDs and decorative mechanical responses without creating unintended application behavior.

**[U-26](https://github.com/arlecchinoOPSource/Unhollowed/issues/26) — Implement audio, timing, and accessibility behavior**

Integrate activation sounds, shutdown sounds, animation timing, audio settings, keyboard interaction, and reduced-motion support.

## M6 issues

**[U-27](https://github.com/arlecchinoOPSource/Unhollowed/issues/28) — Complete native macOS and Windows integration testing**

Verify actual desktop builds, lifecycle behavior, installation, and native functionality.

**[U-28](https://github.com/arlecchinoOPSource/Unhollowed/issues/27) — Complete performance, accessibility, privacy, and asset review**

Verify rendering performance, memory behavior, keyboard accessibility, licensing, local data handling, and runtime privacy claims.

**[U-29](https://github.com/arlecchinoOPSource/Unhollowed/issues/29) — Establish packaging, signing, and release update pipeline**

Configure supported desktop artifacts and signed update infrastructure.

Do not claim code signing or automatic updates work until verified.

**[U-30](https://github.com/arlecchinoOPSource/Unhollowed/issues/30) — Complete final v1.0.0 release checklist**

Coordinate regression verification, documentation, outstanding defects, and release readiness.

Do not publish or approve the final release without my authorization.

---

# 8. Issue dependencies

Use these as the initial dependency relationships.

Adjust them only when the repository audit provides a clear reason.

- [U-02](https://github.com/arlecchinoOPSource/Unhollowed/issues/3) depends on [U-01](https://github.com/arlecchinoOPSource/Unhollowed/issues/1).
- [U-03](https://github.com/arlecchinoOPSource/Unhollowed/issues/4) depends on [U-01](https://github.com/arlecchinoOPSource/Unhollowed/issues/1) and the relevant architecture decisions.
- [U-04](https://github.com/arlecchinoOPSource/Unhollowed/issues/5) depends on the actual scaffold and build tooling.
- [U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2) depends on the architecture contract.
- [U-06](https://github.com/arlecchinoOPSource/Unhollowed/issues/7) and [U-08](https://github.com/arlecchinoOPSource/Unhollowed/issues/9) depend on the existing application architectures and relevant Core tasks.
- [U-07](https://github.com/arlecchinoOPSource/Unhollowed/issues/8) depends on [U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2) and [U-06](https://github.com/arlecchinoOPSource/Unhollowed/issues/7).
- [U-09](https://github.com/arlecchinoOPSource/Unhollowed/issues/6) depends on [U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2) and [U-08](https://github.com/arlecchinoOPSource/Unhollowed/issues/9).
- [U-10](https://github.com/arlecchinoOPSource/Unhollowed/issues/10) depends on [U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2) and verified Swish integration.
- [U-11](https://github.com/arlecchinoOPSource/Unhollowed/issues/11) depends on [U-05](https://github.com/arlecchinoOPSource/Unhollowed/issues/2) and the embedded application lifecycle requirements.
- [U-13](https://github.com/arlecchinoOPSource/Unhollowed/issues/13) depends on [U-12](https://github.com/arlecchinoOPSource/Unhollowed/issues/12).
- [U-14](https://github.com/arlecchinoOPSource/Unhollowed/issues/14) and [U-15](https://github.com/arlecchinoOPSource/Unhollowed/issues/15) depend on the approved data architecture.
- [U-16](https://github.com/arlecchinoOPSource/Unhollowed/issues/16) depends on the data implementation issues.
- [U-18](https://github.com/arlecchinoOPSource/Unhollowed/issues/20) depends on [U-17](https://github.com/arlecchinoOPSource/Unhollowed/issues/17).
- [U-19](https://github.com/arlecchinoOPSource/Unhollowed/issues/19) depends on [U-18](https://github.com/arlecchinoOPSource/Unhollowed/issues/20).
- [U-20](https://github.com/arlecchinoOPSource/Unhollowed/issues/18) depends on the asset format decision and can progress alongside modeling.
- [U-21](https://github.com/arlecchinoOPSource/Unhollowed/issues/21) depends on the frontend scaffold and relevant asset specifications.
- [U-22](https://github.com/arlecchinoOPSource/Unhollowed/issues/22) depends on the projector variants and initial layout.
- [U-23](https://github.com/arlecchinoOPSource/Unhollowed/issues/23) depends on the host lifecycle contract.
- [U-24](https://github.com/arlecchinoOPSource/Unhollowed/issues/24) depends on [U-23](https://github.com/arlecchinoOPSource/Unhollowed/issues/23) and the usable host interface.
- [U-25](https://github.com/arlecchinoOPSource/Unhollowed/issues/25) depends on [U-23](https://github.com/arlecchinoOPSource/Unhollowed/issues/23) and the graphical rack integration.
- [U-26](https://github.com/arlecchinoOPSource/Unhollowed/issues/26) depends on the animation and sound contracts.
- [U-27](https://github.com/arlecchinoOPSource/Unhollowed/issues/28) through [U-30](https://github.com/arlecchinoOPSource/Unhollowed/issues/30) require the relevant functional systems to be implemented.

Do not turn these into artificial sequential blockers when independent tasks can safely progress concurrently.

Replace textual references with actual GitHub issue links once the issues are created.

---

