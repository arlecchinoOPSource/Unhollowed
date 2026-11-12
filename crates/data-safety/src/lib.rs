//! Host-level data safety for the embedded modules (docs/DATA-SAFETY-U14.md).
//!
//! Decision 6 of docs/DATA-DECISIONS-U33.md: before any module migrates a real file, the host takes a verified copy
//! (a SQLite online backup, which includes data still in the write-ahead log) into the module's `backups/` folder; if
//! the copy cannot be made, the migration does not run. The person confirms first (the host page asks); [`inspect`] says
//! whether a file needs that question, [`backup_for_upgrade`] is the step taken after the answer. The host never migrates, rewrites or deletes a module's file
//! itself, except in [`restore`], which replaces it only from a verified backup after saving a safety copy.
//!
//! No module has a schema above version 1 today, so nothing asks on real files yet; the engine is tested
//! here so it is ready the first time a module's schema moves. [`inspect`] decides whether to ask.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::backup::Backup as OnlineBackup;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

/// The schema version to treat as the one a module writes. Debug builds accept `UNHLW_TEST_SCHEMA_VERSION` so the native
/// test can make an existing file look one version old and watch the backup happen; release builds ignore it (the same
/// pattern as `UNHLW_DATA_ROOT`).
pub fn effective_version(declared: i64) -> i64 {
    #[cfg(debug_assertions)]
    if let Some(value) = std::env::var("UNHLW_TEST_SCHEMA_VERSION")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        return value;
    }
    declared
}

/// What the host found in a module's database file, without changing it.
#[derive(Debug, PartialEq, Eq)]
pub enum Inspection {
    /// No file yet: the module will create it.
    Missing,
    /// A file with no tables and no version: the module will set it up.
    Fresh,
    /// The file is at the schema version this host's module supports.
    Current,
    /// The file is older than the module supports, so opening it would migrate it.
    NeedsMigration { from: i64, to: i64 },
    /// The file was written by a newer module. The module refuses it itself; the host does not touch it.
    TooNew { found: i64, supported: i64 },
    /// The file could not be read (the module reports its own error).
    Unreadable(String),
}

fn read_only(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

fn pragma(db: &Connection, name: &str) -> rusqlite::Result<i64> {
    db.pragma_query_value(None, name, |row| row.get(0))
}

fn tables(db: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut statement = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
    statement.query_map([], |row| row.get(0))?.collect()
}

/// The schema version stored in the file (`PRAGMA user_version`).
pub fn user_version(path: &Path) -> Result<i64, String> {
    let db = read_only(path).map_err(|e| e.to_string())?;
    pragma(&db, "user_version").map_err(|e| e.to_string())
}

/// Looks at a module's database without changing it. `supported` is the schema version the module writes.
pub fn inspect(path: &Path, supported: i64) -> Inspection {
    if !path.exists() {
        return Inspection::Missing;
    }
    let found = (|| {
        let db = read_only(path)?;
        Ok::<_, rusqlite::Error>((pragma(&db, "user_version")?, !tables(&db)?.is_empty()))
    })();
    match found {
        Err(error) => Inspection::Unreadable(error.to_string()),
        Ok((0, false)) => Inspection::Fresh,
        Ok((found, _)) if found > supported => Inspection::TooNew { found, supported },
        Ok((found, _)) if found == supported => Inspection::Current,
        Ok((found, _)) => Inspection::NeedsMigration {
            from: found,
            to: supported,
        },
    }
}

/// A verified copy of a database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backup {
    pub path: PathBuf,
    pub user_version: i64,
    pub bytes: u64,
}

fn private_folder(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn private_file(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    let _ = path;
    Ok(())
}

/// Copies `source` into `target` with SQLite's online backup, which is consistent while the source is open and
/// includes changes still in its write-ahead log.
///
/// The target is created owner-only *before* SQLite touches it, and the copy is taken out of WAL mode: a backup is one
/// self-contained file, and a WAL-mode copy would grow `-wal`/`-shm` files (with default modes) every time it is opened.
fn copy_database(source: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        options
            .open(target)
            .map_err(|e| format!("cannot create the copy: {e}"))?;
    }
    let from = read_only(source).map_err(|e| format!("cannot read the data file: {e}"))?;
    let mut to = Connection::open(target).map_err(|e| format!("cannot create the copy: {e}"))?;
    OnlineBackup::new(&from, &mut to)
        .and_then(|backup| backup.run_to_completion(64, Duration::from_millis(5), None))
        .map_err(|e| format!("the copy failed: {e}"))?;
    to.pragma_update(None, "journal_mode", "DELETE")
        .map_err(|e| format!("the copy could not be finished: {e}"))?;
    Ok(())
}

/// The copy must be a database that opens, passes SQLite's own integrity check and has the same identity (schema
/// version, application id and tables) as the original at the moment it was copied.
fn verify(copy: &Path, original: &Path) -> Result<i64, String> {
    let fail = |e: rusqlite::Error| format!("the copy could not be checked: {e}");
    let a = read_only(original).map_err(fail)?;
    let b = read_only(copy).map_err(fail)?;
    let check: String = b
        .pragma_query_value(None, "integrity_check", |row| row.get(0))
        .map_err(fail)?;
    if check != "ok" {
        return Err(format!(
            "the copy failed SQLite's integrity check ({check})"
        ));
    }
    let version = pragma(&b, "user_version").map_err(fail)?;
    if version != pragma(&a, "user_version").map_err(fail)? {
        return Err("the copy has a different schema version than the original".into());
    }
    if pragma(&b, "application_id").map_err(fail)? != pragma(&a, "application_id").map_err(fail)? {
        return Err("the copy has a different application id than the original".into());
    }
    if tables(&b).map_err(fail)? != tables(&a).map_err(fail)? {
        return Err("the copy has different tables than the original".into());
    }
    if entry_versions(&b) != entry_versions(&a) {
        return Err("the copy has different per-entry formats than the original".into());
    }
    Ok(version)
}

/// Terminal keeps a second version, one per journal entry (audit F3). A file whose entries are on a different format
/// than another file is not interchangeable even if `user_version` matches, so copies must agree on it. `None` when the
/// file has no such column (Ember, Swish).
pub fn entry_versions(conn: &Connection) -> Option<(i64, i64)> {
    conn.query_row(
        "SELECT MIN(schema_version), MAX(schema_version) FROM entries",
        [],
        |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?)),
    )
    .ok()
    .and_then(|(min, max)| Some((min?, max?)))
}

/// The per-entry format range of a database file, for a host that must refuse entries it cannot read.
pub fn entry_version_range(path: &Path) -> Option<(i64, i64)> {
    entry_versions(&read_only(path).ok()?)
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Writes a verified copy of `db` into `dir` as `before-<label>-<ms>.sqlite3`. Never overwrites a file; a copy that
/// fails verification is deleted and reported.
pub fn backup_verified(db: &Path, dir: &Path, label: &str) -> Result<Backup, String> {
    private_folder(dir).map_err(|e| format!("cannot create the backups folder: {e}"))?;
    let mut path = dir.join(format!("before-{label}-{}.sqlite3", stamp()));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("before-{label}-{}-{n}.sqlite3", stamp()));
        n += 1;
    }
    // Built under a temporary name and renamed only once it verifies, so a file with its final name is always a complete,
    // checked backup: nothing that lists the folder (a restore screen, a test) can ever pick up a half-written one.
    let partial = dir.join(format!(
        "{}.partial",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("backup")
    ));
    let _ = std::fs::remove_file(&partial);
    let outcome = copy_database(db, &partial)
        .and_then(|()| verify(&partial, db))
        .and_then(|user_version| {
            std::fs::rename(&partial, &path)
                .map(|()| user_version)
                .map_err(|e| format!("the copy could not be put in place: {e}"))
        });
    match outcome {
        Ok(user_version) => {
            let _ = private_file(&path);
            let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            Ok(Backup {
                path,
                user_version,
                bytes,
            })
        }
        Err(error) => {
            let _ = std::fs::remove_file(&partial);
            Err(error)
        }
    }
}

/// Something the person should be told, shown by the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub module: String,
    pub message: String,
}

static NOTICES: Mutex<Vec<Notice>> = Mutex::new(Vec::new());

/// The notices recorded so far (the host page shows them).
pub fn notices() -> Vec<Notice> {
    NOTICES.lock().map(|n| n.clone()).unwrap_or_default()
}

fn notify(module: &str, message: String) {
    if let Ok(mut notices) = NOTICES.lock() {
        notices.push(Notice {
            module: module.into(),
            message,
        });
    }
}

/// The verified copy the host takes after the person confirmed that a module's older file may be upgraded. It records the
/// notice the page shows afterwards. If the copy cannot be made, the error says so and **the file is untouched**: the
/// caller must not open the module.
pub fn backup_for_upgrade(
    module: &str,
    db: &Path,
    backups: &Path,
    from: i64,
    to: i64,
) -> Result<Backup, String> {
    let copy = backup_verified(db, backups, &format!("migrate-v{from}-to-v{to}"))?;
    notify(
        module,
        format!(
            "{module}'s data was upgraded from schema {from} to {to}. A verified copy made first is at {}. Older standalone releases of {module} will refuse the upgraded file; restoring that copy is the only way back.",
            copy.path.display()
        ),
    );
    Ok(copy)
}

/// A backup must open, pass SQLite's integrity check and be a versioned module database. Returns its schema version.
fn check_backup(backup: &Path) -> Result<i64, String> {
    let copy = read_only(backup).map_err(|e| format!("The backup cannot be read: {e}"))?;
    let check: String = copy
        .pragma_query_value(None, "integrity_check", |row| row.get(0))
        .map_err(|e| format!("The backup cannot be checked: {e}"))?;
    if check != "ok" {
        return Err(format!(
            "The backup failed SQLite's integrity check ({check}). Nothing was changed."
        ));
    }
    let version = pragma(&copy, "user_version").map_err(|e| e.to_string())?;
    if version <= 0 {
        return Err("That file is not a versioned module database. Nothing was changed.".into());
    }
    Ok(version)
}

/// What a restore did.
#[derive(Debug, PartialEq, Eq)]
pub struct Restored {
    /// A verified copy of what was replaced, when there was a file to replace.
    pub safety_copy: Option<Backup>,
}

/// Replaces `db` with the contents of a backup, only after the backup itself checks out and a safety copy of the
/// current file exists. **Nothing else may have the file open** (the module must be powered off).
pub fn restore(backup: &Path, db: &Path) -> Result<Restored, String> {
    check_backup(backup)?;
    let folder = db.parent().ok_or("The data file has no folder.")?;
    let safety_copy = if db.exists() {
        Some(backup_verified(db, &folder.join("backups"), "restore").map_err(|e| format!("A safety copy of the current data could not be made ({e}). Nothing was changed."))?)
    } else {
        None
    };
    let name = db
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("The data file has no name.")?;
    let staging = folder.join(format!("{name}.restoring"));
    let _ = std::fs::remove_file(&staging);
    let staged = copy_database(backup, &staging).and_then(|()| verify(&staging, backup));
    if let Err(error) = staged {
        let _ = std::fs::remove_file(&staging);
        return Err(format!(
            "The backup could not be restored ({error}). Nothing was changed."
        ));
    }
    let _ = private_file(&staging);
    // Left-over write-ahead files belong to the file being replaced; they must not be applied to the restored one.
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(folder.join(format!("{name}{suffix}")));
    }
    std::fs::rename(&staging, db).map_err(|e| format!("The restored file could not be put in place ({e}). Your previous data is in the safety copy."))?;
    Ok(Restored { safety_copy })
}

/// How many safety copies taken by restores are kept. Upgrade copies are never pruned: each is the only way back to
/// the older format and is rare.
pub const KEEP_RESTORE_COPIES: usize = 5;

/// One backup the person may choose to restore.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    pub user_version: i64,
    pub bytes: u64,
    pub modified_ms: u64,
    /// `upgrade` (taken before a migration) or `restore` (what a restore replaced).
    pub kind: String,
}

fn backup_files(dir: &Path) -> Vec<(PathBuf, String, std::time::SystemTime)> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if !(name.starts_with("before-") && name.ends_with(".sqlite3")) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((entry.path(), name, modified))
        })
        .collect();
    files.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1)));
    files
}

/// The complete backups in `dir`, newest first. Half-written copies (`.partial`) are never listed.
pub fn list_backups(dir: &Path) -> Vec<BackupInfo> {
    backup_files(dir)
        .into_iter()
        .filter_map(|(path, name, modified)| {
            let user_version = user_version(&path).ok()?;
            Some(BackupInfo {
                kind: if name.starts_with("before-restore-") {
                    "restore"
                } else {
                    "upgrade"
                }
                .into(),
                bytes: std::fs::metadata(&path).ok()?.len(),
                modified_ms: modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64,
                file: name,
                user_version,
            })
        })
        .collect()
}

/// Retention: removes leftover `.partial` files (no backup runs while the host starts) and all but the newest
/// `KEEP_RESTORE_COPIES` restore safety copies. Upgrade copies are kept. Returns how many files were removed.
pub fn prune(dir: &Path) -> usize {
    let mut removed = 0;
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            if entry.file_name().to_string_lossy().ends_with(".partial")
                && std::fs::remove_file(entry.path()).is_ok()
            {
                removed += 1;
            }
        }
    }
    let old_restore_copies = backup_files(dir)
        .into_iter()
        .filter(|(_, name, _)| name.starts_with("before-restore-"))
        .skip(KEEP_RESTORE_COPIES);
    for (path, _, _) in old_restore_copies {
        if std::fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }
    removed
}

const PENDING: &str = "restore-pending";

/// A backup file name must be a plain name inside `backups/`, never a path.
fn backup_path(folder: &Path, file: &str) -> Result<PathBuf, String> {
    let plain = Path::new(file).file_name().and_then(|n| n.to_str()) == Some(file);
    if !plain || !file.starts_with("before-") || !file.ends_with(".sqlite3") {
        return Err("That is not one of this module's backups.".into());
    }
    let path = folder.join("backups").join(file);
    if path.is_file() {
        Ok(path)
    } else {
        Err("That backup no longer exists.".into())
    }
}

/// Records that the chosen backup is to replace the module's data **the next time Unhollowed starts**. A running module
/// has its file open, so the replacement happens before any module opens it. The backup is checked now so the person
/// hears about a bad one immediately, and refused if it is on a newer schema than this version supports.
pub fn schedule_restore(folder: &Path, file: &str, supported: i64) -> Result<(), String> {
    let path = backup_path(folder, file)?;
    let version = check_backup(&path)?;
    if version > supported {
        return Err(format!(
            "That backup is on schema {version}; this version of Unhollowed supports up to {supported}. Nothing was changed."
        ));
    }
    std::fs::write(folder.join(PENDING), file)
        .map_err(|e| format!("The restore could not be scheduled: {e}"))?;
    let _ = private_file(&folder.join(PENDING));
    Ok(())
}

/// The restore waiting for the next start, if any.
pub fn pending_restore(folder: &Path) -> Option<String> {
    std::fs::read_to_string(folder.join(PENDING))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Cancels a scheduled restore.
pub fn cancel_restore(folder: &Path) {
    let _ = std::fs::remove_file(folder.join(PENDING));
}

/// Called at start, **before** the module's plugin opens the file: carries out a scheduled restore and tells the person
/// the outcome. The marker is removed either way so a failing restore is not retried on every start.
pub fn apply_pending_restore(module: &str, db: &Path, supported: i64) {
    let Some(folder) = db.parent() else { return };
    let Some(file) = pending_restore(folder) else {
        return;
    };
    cancel_restore(folder);
    let outcome = backup_path(folder, &file).and_then(|path| {
        let version = check_backup(&path)?;
        if version > supported {
            return Err(format!(
                "it is on schema {version}, newer than this version supports"
            ));
        }
        restore(&path, db)
    });
    notify(
        module,
        match outcome {
            Ok(done) => format!(
                "{module}'s data was restored from {file}.{}",
                done.safety_copy
                    .map(|c| format!(" What it replaced was kept at {}.", c.path.display()))
                    .unwrap_or_default()
            ),
            Err(error) => {
                format!("{module}'s data was not restored ({error}). Nothing was changed.")
            }
        },
    );
    prune(&folder.join("backups"));
}

#[cfg(test)]
mod failure_tests;
#[cfg(test)]
mod tests;
