//! The Rust half of the Unhollowed host contract (docs/HOST-CONTRACT-U35.md).
//!
//! The host owns the window, close and quit. A module never exits the app. When the
//! host asks a module to close (by emitting the module's own close event), the module
//! saves and then reports back by emitting [`FLUSH_EVENT`] with a [`Flushed`] payload.

use serde::{Deserialize, Serialize};

/// Event a module plugin emits when it has finished saving after a close request.
pub const FLUSH_EVENT: &str = "unhlw://module-flushed";

/// Upper bound on keeping the hidden app alive for a close sound, as in all three apps.
pub const MAX_LINGER_MS: u64 = 6500;

/// What the host needs to know about a module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModuleInfo {
    /// Short name; also the Tauri plugin name, so commands are `plugin:<name>|<command>`.
    pub name: &'static str,
    /// The standalone app's Tauri identifier; its data folder is `<data_dir>/<identifier>`.
    pub identifier: &'static str,
    /// The event the app already listens for to start its own close sequence.
    pub close_event: &'static str,
}

/// Payload of [`FLUSH_EVENT`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flushed {
    pub module: String,
    /// How long the app asked to stay alive for its close sound (capped by the host).
    pub linger_ms: u64,
}
