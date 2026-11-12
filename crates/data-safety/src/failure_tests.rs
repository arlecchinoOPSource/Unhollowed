//! U-16: what happens when things go wrong (docs/DATA-SAFETY-U14.md, docs/FAILURE-TESTS-U16.md). Each test injects one
//! failure and checks that the person's data is either intact or the error says nothing was changed.

use super::*;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

fn scratch(name: &str) -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "unhlw-failure-{}-{}-{name}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn open_wal(path: &Path, rows: u32) -> Connection {
    let db = Connection::open(path).unwrap();
    db.pragma_update(None, "journal_mode", "WAL").unwrap();
    db.pragma_update(None, "synchronous", "FULL").unwrap();
    db.execute_batch("CREATE TABLE notes (n INTEGER NOT NULL, pad TEXT NOT NULL)")
        .unwrap();
    for n in 0..rows {
        db.execute(
            "INSERT INTO notes VALUES (?1, ?2)",
            rusqlite::params![n, "x".repeat(200)],
        )
        .unwrap();
    }
    db.pragma_update(None, "user_version", 1).unwrap();
    db
}

fn count(path: &Path) -> i64 {
    read_only(path)
        .unwrap()
        .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
        .unwrap()
}

fn sha(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

#[test]
fn backups_taken_while_another_connection_keeps_writing_are_each_consistent() {
    let dir = scratch("busy-writer");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 200));
    let stop = Arc::new(AtomicBool::new(false));
    let writer = {
        let (stop, db) = (stop.clone(), db.clone());
        std::thread::spawn(move || {
            let conn = Connection::open(&db).unwrap();
            conn.busy_timeout(Duration::from_secs(5)).unwrap();
            let mut n = 1000;
            while !stop.load(Ordering::SeqCst) {
                conn.execute("INSERT INTO notes VALUES (?1, 'w')", [n])
                    .unwrap();
                n += 1;
            }
            n - 1000
        })
    };
    let mut last = 0;
    for _ in 0..6 {
        let backup =
            backup_verified(&db, &dir.join("backups"), "busy").expect("a backup under write load");
        let rows = count(&backup.path);
        assert!(
            rows >= 200 && rows >= last,
            "rows only grow: {rows} after {last}"
        );
        last = rows;
    }
    stop.store(true, Ordering::SeqCst);
    let written = writer.join().unwrap();
    assert!(written > 0, "the writer really ran");
    assert_eq!(
        count(&db),
        200 + written as i64,
        "no write was lost to the backups"
    );
}

#[test]
fn an_uncommitted_write_is_not_in_a_backup_and_does_not_block_it() {
    let dir = scratch("uncommitted");
    let db = dir.join("m.sqlite3");
    let mut writer = open_wal(&db, 3);
    let tx = writer.transaction().unwrap();
    tx.execute("INSERT INTO notes VALUES (99, 'pending')", [])
        .unwrap();
    let backup = backup_verified(&db, &dir.join("backups"), "mid-write").unwrap();
    assert_eq!(count(&backup.path), 3, "only committed rows");
    tx.commit().unwrap();
    assert_eq!(count(&db), 4);
}

// Windows refuses to copy a -shm another handle has mapped, so the image cannot be taken there.
#[cfg(not(windows))]
#[test]
fn a_crash_image_of_the_files_reopens_with_every_committed_row() {
    // Copy the database, -wal and -shm while the writer still has them open and never closed: what a power cut leaves.
    let dir = scratch("crash-image");
    let db = dir.join("m.sqlite3");
    let _writer = open_wal(&db, 50);
    let image = scratch("crash-image-copy");
    for suffix in ["", "-wal", "-shm"] {
        let from = dir.join(format!("m.sqlite3{suffix}"));
        if from.exists() {
            std::fs::copy(&from, image.join(format!("m.sqlite3{suffix}"))).unwrap();
        }
    }
    let reopened = Connection::open(image.join("m.sqlite3")).unwrap();
    let rows: i64 = reopened
        .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
        .unwrap();
    let check: String = reopened
        .pragma_query_value(None, "integrity_check", |r| r.get(0))
        .unwrap();
    assert_eq!((rows, check.as_str()), (50, "ok"));
}

#[test]
fn a_truncated_database_is_refused_by_the_backup_and_left_alone() {
    let dir = scratch("truncated");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 400));
    let full = std::fs::read(&db).unwrap();
    assert!(full.len() > 8192);
    std::fs::write(&db, &full[..full.len() / 2 + 7]).unwrap();
    let before = sha(&db);
    let backups = dir.join("backups");
    assert!(backup_verified(&db, &backups, "broken").is_err());
    assert_eq!(sha(&db), before, "the damaged original is untouched");
    assert!(
        list_backups(&backups).is_empty(),
        "no backup of the damaged file is offered"
    );
    assert!(
        !std::fs::read_dir(&backups)
            .map(|d| d
                .flatten()
                .any(|e| e.file_name().to_string_lossy().ends_with(".partial")))
            .unwrap_or(false),
        "no half-written file left"
    );
}

#[test]
fn a_page_of_garbage_in_the_middle_fails_the_integrity_check_and_is_not_backed_up() {
    let dir = scratch("garbage-page");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 400));
    let mut bytes = std::fs::read(&db).unwrap();
    let start = bytes.len() / 2;
    for byte in &mut bytes[start..start + 4096] {
        *byte = 0xA5;
    }
    std::fs::write(&db, &bytes).unwrap();
    let result = backup_verified(&db, &dir.join("backups"), "garbage");
    assert!(
        result.is_err(),
        "a backup must not be offered for a file that fails its own integrity check"
    );
    assert!(list_backups(&dir.join("backups")).is_empty());
    assert_eq!(sha(&db), bytes);
}

#[test]
fn inspecting_a_file_never_changes_its_bytes() {
    let dir = scratch("inspect-readonly");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 20));
    let before = sha(&db);
    for supported in [0, 1, 2] {
        let _ = inspect(&db, supported);
    }
    assert_eq!(sha(&db), before);
}

#[cfg(unix)]
#[test]
fn a_backup_folder_that_cannot_be_created_is_an_error_and_changes_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch("readonly-parent");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 5));
    let backups = dir.join("backups");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    // Running as root ignores modes; then there is nothing to inject.
    if std::fs::write(dir.join("probe"), b"x").is_ok() {
        let _ = std::fs::remove_file(dir.join("probe"));
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        return;
    }
    let before = sha(&db);
    let error = backup_for_upgrade("ro", &db, &backups, 1, 2).unwrap_err();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(!error.is_empty());
    assert_eq!(sha(&db), before);
    assert!(!backups.exists());
    assert!(
        !notices().iter().any(|n| n.module == "ro"),
        "no notice for an upgrade that did not happen"
    );
}

#[cfg(unix)]
#[test]
fn a_backup_folder_with_unsafe_modes_is_tightened_rather_than_trusted() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch("loose-folder");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 5));
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    std::fs::set_permissions(&backups, std::fs::Permissions::from_mode(0o777)).unwrap();
    let copy = backup_verified(&db, &backups, "loose").unwrap();
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!((mode(&backups), mode(&copy.path)), (0o700, 0o600));
}

#[cfg(unix)]
#[test]
fn a_restore_that_cannot_stage_the_file_changes_nothing_and_keeps_the_safety_copy() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch("restore-readonly");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 5));
    let backup = backup_verified(&db, &dir.join("backups"), "keep").unwrap();
    // Make the folder unwritable for new files; the `backups/` subfolder stays writable for the safety copy.
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    if std::fs::write(dir.join("probe"), b"x").is_ok() {
        let _ = std::fs::remove_file(dir.join("probe"));
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        return;
    }
    let before = sha(&db);
    let error = restore(&backup.path, &db).unwrap_err();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(error.contains("Nothing was changed"), "{error}");
    assert_eq!(sha(&db), before);
    assert!(!dir.join("m.sqlite3.restoring").exists());
}

#[test]
fn a_backup_killed_halfway_leaves_only_a_partial_that_is_never_offered_and_is_cleaned_up() {
    let dir = scratch("killed-backup");
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    std::fs::write(
        backups.join("before-migrate-v1-to-v2-5.sqlite3.partial"),
        b"SQLite format 3\0 half",
    )
    .unwrap();
    assert!(list_backups(&backups).is_empty());
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 3));
    let fresh = backup_verified(&db, &backups, "after-crash").unwrap();
    assert_eq!(list_backups(&backups).len(), 1);
    assert_eq!(prune(&backups), 1, "the leftover is removed");
    assert!(fresh.path.exists());
}

#[test]
fn an_empty_file_is_treated_as_fresh_and_a_backup_of_it_is_refused_rather_than_trusted() {
    let dir = scratch("empty-file");
    let db = dir.join("m.sqlite3");
    std::fs::write(&db, b"").unwrap();
    assert_eq!(inspect(&db, 1), Inspection::Fresh);
    // A copy of an empty file has no schema version, so it can never be offered as something to restore.
    if let Ok(backup) = backup_verified(&db, &dir.join("backups"), "empty") {
        assert!(restore(&backup.path, &dir.join("target.sqlite3")).is_err());
    }
}

#[test]
fn an_older_file_is_backed_up_byte_for_row_and_the_original_is_never_modified_by_the_backup() {
    let dir = scratch("older-file");
    let db = dir.join("m.sqlite3");
    drop(open_wal(&db, 30));
    assert_eq!(
        inspect(&db, 2),
        Inspection::NeedsMigration { from: 1, to: 2 }
    );
    let before = sha(&db);
    let copy = backup_for_upgrade("older", &db, &dir.join("backups"), 1, 2).unwrap();
    assert_eq!(copy.user_version, 1);
    assert_eq!(count(&copy.path), 30);
    assert_eq!(sha(&db), before);
}
