# Architecture

No UNHLW application exists yet. [Audit notes](AUDIT-DRAFT.md) record the inspected cached source references and limitations. A complete, current upstream audit is tracked in [U-01](https://github.com/arlecchinoOPSource/Unhollowed/issues/1).

## Proposed host

Tauri owns the native window, capabilities and explicitly scoped commands; React renders the rack, projector controls, host lifecycle and real app surfaces. A versioned host contract should specify initialization, mounting, shutdown, error and unsaved-state handling, and service capabilities. Each app's reusable frontend and native domain must first be identified and adapted; a shared UI package is not the app itself. Standalone releases must continue to build and operate independently. Each native capability should follow least privilege, with separate review of filesystem and inter-process access.

A pinned Core dependency, following Swish's submodule pattern if verified appropriate, is proposed; Core is private and CI access needs design. The initial frontend should use Blender-rendered 2.5D assets with live React content and does not require a real-time 3D engine. Packaging must include the necessary modules and services, rather than launching separately installed apps. Actual storage, schema compatibility, native command collisions and package distribution remain unresolved; see [data](DATA.md) and [integration](INTEGRATION.md).
