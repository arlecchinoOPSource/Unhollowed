//! The modules the host embeds and where their data lives (docs/DATA-DECISIONS-U33.md).

use std::path::{Path, PathBuf};

use unhlw_host_contract::ModuleInfo;

/// Modules available in this build.
pub const MODULES: &[ModuleInfo] = &[
    tauri_plugin_swish::INFO,
    tauri_plugin_terminal::INFO,
    tauri_plugin_ember::INFO,
];

pub fn find(name: &str) -> Option<&'static ModuleInfo> {
    MODULES.iter().find(|module| module.name == name)
}

/// A module's existing data folder: a sibling of the host's own data folder
/// (`<data_dir>/<identifier>`), because the standalone apps derive theirs from their own identifier.
/// `override_root` (debug builds only) points at a throwaway root so tests never touch real data.
pub fn module_data_dir(
    host_data_dir: &Path,
    identifier: &str,
    override_root: Option<&Path>,
    allow_override: bool,
) -> PathBuf {
    match override_root {
        Some(root) if allow_override => root.join(identifier),
        _ => host_data_dir
            .parent()
            .unwrap_or(host_data_dir)
            .join(identifier),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_folder_is_a_sibling_of_the_host_folder() {
        let host = Path::new("/home/x/Library/Application Support/com.arlecchino.unhlw");
        assert_eq!(
            module_data_dir(host, "com.arlecchino.swish", None, true),
            Path::new("/home/x/Library/Application Support/com.arlecchino.swish")
        );
    }

    #[test]
    fn override_root_is_used_only_when_allowed() {
        let host = Path::new("/real/com.arlecchino.unhlw");
        let root = Path::new("/tmp/synthetic");
        assert_eq!(
            module_data_dir(host, "com.arlecchino.swish", Some(root), true),
            Path::new("/tmp/synthetic/com.arlecchino.swish")
        );
        // Release builds ignore the override and use the real sibling folder.
        assert_eq!(
            module_data_dir(host, "com.arlecchino.swish", Some(root), false),
            Path::new("/real/com.arlecchino.swish")
        );
    }

    #[test]
    fn swish_is_registered_with_its_standalone_identifier() {
        let swish = find("swish").expect("swish module");
        assert_eq!(swish.identifier, "com.arlecchino.swish");
        let terminal = find("terminal").expect("terminal module");
        assert_eq!(terminal.identifier, "com.arlecchino.terminal");
        assert_eq!(terminal.close_event, "journal-close-requested");
        let ember = find("ember").expect("ember module");
        assert_eq!(ember.identifier, "com.arlecchino.ember");
        assert_eq!(ember.close_event, "ember:exit-requested");
        assert!(find("unknown").is_none());
    }
}
