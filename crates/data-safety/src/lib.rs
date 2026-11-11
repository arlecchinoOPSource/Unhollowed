//! Host-level data safety for the embedded modules (docs/DATA-SAFETY-U14.md).
//!
//! Decision 6 of docs/DATA-DECISIONS-U33.md: before any module migrates a real file, the host takes a verified copy
//! (a SQLite online backup, which includes data still in the write-ahead log) into the module's `backups/` folder; if
//! the copy cannot be made, the migration does not run. The host never migrates, rewrites or deletes a module's file
//! itself, except in [`restore`], which replaces it only from a verified backup after saving a safety copy.
//!
//! No module has a schema above version 1 today, so [`prepare`] does nothing on real files yet; the engine is tested
//! here so it is ready the first time a module's schema moves.

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
    Ok(version)
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
    let outcome = copy_database(db, &path).and_then(|()| verify(&path, db));
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
            let _ = std::fs::remove_file(&path);
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

/// What to do about a module's file before the module opens it.
#[derive(Debug, PartialEq, Eq)]
pub enum Prepared {
    /// Nothing to protect: open the module normally.
    Proceed,
    /// The file will be migrated by opening it, and a verified copy was made first. Open normally.
    BackedUp(Backup),
    /// Do NOT open the file: show this reason instead. Nothing was changed.
    Refused(String),
}

/// Call before a module opens its database. If opening would migrate an existing file, a verified copy is made
/// first; if that fails the answer is [`Prepared::Refused`] and the file is untouched.
pub fn prepare(module: &str, db: &Path, backups: &Path, supported: i64) -> Prepared {
    match inspect(db, supported) {
        Inspection::Missing
        | Inspection::Fresh
        | Inspection::Current
        | Inspection::TooNew { .. }
        | Inspection::Unreadable(_) => Prepared::Proceed,
        Inspection::NeedsMigration { from, to } => {
            match backup_verified(db, backups, &format!("migrate-v{from}-to-v{to}")) {
                Ok(copy) => {
                    notify(
                        module,
                        format!(
                            "{module}'s data was upgraded from schema {from} to {to}. A verified copy made first is at {}. Older standalone releases of {module} will refuse the upgraded file; restoring that copy is the only way back.",
                            copy.path.display()
                        ),
                    );
                    Prepared::BackedUp(copy)
                }
                Err(error) => Prepared::Refused(format!(
                    "{module} was not upgraded because a safety copy could not be made first ({error}). Nothing was changed; your data is as it was."
                )),
            }
        }
    }
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
    {
        let copy = read_only(backup).map_err(|e| format!("The backup cannot be read: {e}"))?;
        let check: String = copy
            .pragma_query_value(None, "integrity_check", |row| row.get(0))
            .map_err(|e| format!("The backup cannot be checked: {e}"))?;
        if check != "ok" {
            return Err(format!(
                "The backup failed SQLite's integrity check ({check}). Nothing was changed."
            ));
        }
        if pragma(&copy, "user_version").map_err(|e| e.to_string())? <= 0 {
            return Err(
                "That file is not a versioned module database. Nothing was changed.".into(),
            );
        }
    }
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

#[cfg(test)]
mod tests;
