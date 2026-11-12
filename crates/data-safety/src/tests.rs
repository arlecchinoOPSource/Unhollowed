use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

fn scratch(name: &str) -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "unhlw-data-safety-{}-{}-{name}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A WAL-mode database with `rows` rows. The returned connection stays open, so data sits in the WAL, as in a running app.
fn make_db(path: &Path, version: i64, rows: &[&str]) -> Connection {
    let db = Connection::open(path).unwrap();
    db.pragma_update(None, "journal_mode", "WAL").unwrap();
    db.execute_batch("CREATE TABLE notes (text TEXT NOT NULL)")
        .unwrap();
    for row in rows {
        db.execute("INSERT INTO notes (text) VALUES (?1)", [row])
            .unwrap();
    }
    db.pragma_update(None, "user_version", version).unwrap();
    db
}

fn notes(path: &Path) -> Vec<String> {
    let db = read_only(path).unwrap();
    let mut s = db.prepare("SELECT text FROM notes ORDER BY rowid").unwrap();
    s.query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn bytes(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

#[test]
fn inspect_tells_the_five_situations_apart() {
    let dir = scratch("inspect");
    let db = dir.join("m.sqlite3");
    assert_eq!(inspect(&db, 2), Inspection::Missing);
    drop(Connection::open(&db).unwrap());
    assert_eq!(inspect(&db, 2), Inspection::Fresh);
    let _keep = make_db(&dir.join("v1.sqlite3"), 1, &["a"]);
    assert_eq!(inspect(&dir.join("v1.sqlite3"), 1), Inspection::Current);
    assert_eq!(
        inspect(&dir.join("v1.sqlite3"), 2),
        Inspection::NeedsMigration { from: 1, to: 2 }
    );
    assert_eq!(
        inspect(&dir.join("v1.sqlite3"), 0),
        Inspection::TooNew {
            found: 1,
            supported: 0
        }
    );
    std::fs::write(
        dir.join("junk.sqlite3"),
        b"this is not a database at all, just text",
    )
    .unwrap();
    assert!(matches!(
        inspect(&dir.join("junk.sqlite3"), 1),
        Inspection::Unreadable(_)
    ));
}

#[test]
fn a_backup_includes_data_still_in_the_wal_and_leaves_the_original_alone() {
    let dir = scratch("wal");
    let db = dir.join("m.sqlite3");
    let writer = make_db(&db, 1, &["first", "second"]);
    assert!(
        std::fs::metadata(dir.join("m.sqlite3-wal")).unwrap().len() > 0,
        "the data is in the WAL, not yet in the main file"
    );
    let before = bytes(&db);
    let copy = backup_verified(&db, &dir.join("backups"), "test").unwrap();
    assert_eq!(notes(&copy.path), ["first", "second"]);
    assert_eq!(copy.user_version, 1);
    assert!(copy.bytes > 0);
    assert_eq!(bytes(&db), before, "the original file was not written");
    drop(writer);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&copy.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(dir.join("backups"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
}

#[test]
fn two_backups_in_the_same_millisecond_never_overwrite_each_other() {
    let dir = scratch("unique");
    let db = dir.join("m.sqlite3");
    let _w = make_db(&db, 1, &["x"]);
    let a = backup_verified(&db, &dir.join("backups"), "same").unwrap();
    let b = backup_verified(&db, &dir.join("backups"), "same").unwrap();
    assert_ne!(a.path, b.path);
    assert!(a.path.exists() && b.path.exists());
}

#[test]
fn restore_puts_back_the_backup_after_saving_what_it_replaced() {
    let dir = scratch("restore");
    let db = dir.join("m.sqlite3");
    let writer = make_db(&db, 1, &["old one", "old two"]);
    let backup = backup_verified(&db, &dir.join("backups"), "manual").unwrap();
    writer
        .execute(
            "INSERT INTO notes (text) VALUES ('written after the backup')",
            [],
        )
        .unwrap();
    drop(writer);
    let restored = restore(&backup.path, &db).unwrap();
    // Checked before anything opens the restored file (opening a WAL database creates its -shm again).
    for suffix in ["-wal", "-shm"] {
        assert!(
            !dir.join(format!("m.sqlite3{suffix}")).exists(),
            "no stale {suffix} left to be applied to the restored file"
        );
    }
    assert_eq!(notes(&db), ["old one", "old two"]);
    let safety = restored
        .safety_copy
        .expect("a safety copy of the replaced data");
    assert_eq!(
        notes(&safety.path),
        ["old one", "old two", "written after the backup"],
        "what was replaced is kept"
    );
    assert!(!dir.join("m.sqlite3.restoring").exists());
}

#[test]
fn restore_refuses_a_damaged_or_foreign_file_and_changes_nothing() {
    let dir = scratch("badrestore");
    let db = dir.join("m.sqlite3");
    let writer = make_db(&db, 1, &["intact"]);
    drop(writer);
    let before = bytes(&db);
    std::fs::write(
        dir.join("garbage.sqlite3"),
        b"definitely not sqlite, just some text to fill the file",
    )
    .unwrap();
    assert!(restore(&dir.join("garbage.sqlite3"), &db).is_err());
    assert!(restore(&dir.join("missing.sqlite3"), &db).is_err());
    let unversioned = dir.join("plain.sqlite3");
    let plain = Connection::open(&unversioned).unwrap();
    plain.execute_batch("CREATE TABLE t (x)").unwrap();
    drop(plain);
    let error = restore(&unversioned, &db).unwrap_err();
    assert!(error.contains("not a versioned module database"), "{error}");
    assert_eq!(bytes(&db), before);
    assert!(
        !dir.join("backups").exists(),
        "no safety copy was needed because nothing was replaced"
    );
}

#[test]
fn restore_into_an_empty_folder_needs_no_safety_copy() {
    let dir = scratch("fresh");
    let source = dir.join("source.sqlite3");
    let _w = make_db(&source, 1, &["only"]);
    let backup = backup_verified(&source, &dir.join("backups"), "manual").unwrap();
    let target = dir.join("elsewhere").join("m.sqlite3");
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();
    assert_eq!(restore(&backup.path, &target).unwrap().safety_copy, None);
    assert_eq!(notes(&target), ["only"]);
}

#[test]
fn a_backup_appears_under_its_final_name_only_when_complete_and_failures_leave_nothing() {
    let dir = scratch("atomic");
    let db = dir.join("m.sqlite3");
    let _w = make_db(&db, 1, &["x"]);
    let copy = backup_verified(&db, &dir.join("backups"), "ok").unwrap();
    let listed: Vec<String> = std::fs::read_dir(dir.join("backups"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        listed,
        [copy
            .path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned()],
        "no .partial left behind"
    );
    assert_eq!(
        notes(&copy.path),
        ["x"],
        "the file with the final name is complete"
    );
    // A source that cannot be read: an error, and nothing in the folder.
    let empty = scratch("atomic-failure");
    assert!(
        backup_verified(
            &empty.join("missing.sqlite3"),
            &empty.join("backups"),
            "bad"
        )
        .is_err()
    );
    assert_eq!(
        std::fs::read_dir(empty.join("backups")).unwrap().count(),
        0,
        "a failed backup leaves no file, partial or final"
    );
}

#[test]
fn an_upgrade_backup_is_verified_named_for_the_versions_and_announced() {
    let dir = scratch("upgrade");
    let db = dir.join("m.sqlite3");
    let _w = make_db(&db, 1, &["keep me"]);
    let copy = backup_for_upgrade("upgrades", &db, &dir.join("backups"), 1, 2).unwrap();
    assert_eq!(notes(&copy.path), ["keep me"]);
    assert_eq!(
        copy.user_version, 1,
        "the copy is the pre-migration version"
    );
    assert!(
        copy.path
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("before-migrate-v1-to-v2-")
    );
    let notice = notices()
        .into_iter()
        .find(|n| n.module == "upgrades")
        .expect("the person is told");
    assert!(notice.message.contains("refuse"), "{}", notice.message);
    assert!(notice.message.contains(copy.path.to_str().unwrap()));
}

#[test]
fn if_the_upgrade_backup_cannot_be_made_there_is_an_error_no_notice_and_the_file_is_unchanged() {
    let dir = scratch("upgrade-fails");
    let db = dir.join("m.sqlite3");
    drop(make_db(&db, 1, &["precious"]));
    let before = bytes(&db);
    // The backups location is a regular file, so a folder cannot be created there.
    std::fs::write(dir.join("backups"), b"in the way").unwrap();
    assert!(backup_for_upgrade("fails", &db, &dir.join("backups"), 1, 2).is_err());
    assert!(
        notices().iter().all(|n| n.module != "fails"),
        "no notice for an upgrade that did not happen"
    );
    assert_eq!(
        bytes(&db),
        before,
        "the original is byte-for-byte as it was"
    );
    assert_eq!(user_version(&db).unwrap(), 1);
}

fn touch_backup(dir: &Path, name: &str) {
    std::fs::create_dir_all(dir).unwrap();
    let db = Connection::open(dir.join(name)).unwrap();
    db.execute_batch("CREATE TABLE notes (text TEXT); PRAGMA user_version = 1;")
        .unwrap();
}

#[test]
fn retention_keeps_every_upgrade_copy_and_only_the_newest_restore_copies() {
    let dir = scratch("retention").join("backups");
    touch_backup(&dir, "before-migrate-v1-to-v2-1.sqlite3");
    for n in 0..8 {
        touch_backup(&dir, &format!("before-restore-{n:03}.sqlite3"));
        std::thread::sleep(Duration::from_millis(15));
    }
    std::fs::write(dir.join("before-restore-9.sqlite3.partial"), b"half").unwrap();
    let removed = prune(&dir);
    assert_eq!(removed, 3 + 1, "three old restore copies and the leftover");
    let left: Vec<String> = list_backups(&dir).into_iter().map(|b| b.file).collect();
    assert!(left.contains(&"before-migrate-v1-to-v2-1.sqlite3".to_string()));
    assert_eq!(
        left.iter()
            .filter(|f| f.starts_with("before-restore-"))
            .count(),
        KEEP_RESTORE_COPIES
    );
    assert!(
        left.contains(&"before-restore-007.sqlite3".to_string()),
        "newest kept"
    );
    assert!(
        !left.contains(&"before-restore-000.sqlite3".to_string()),
        "oldest pruned"
    );
    assert!(!dir.join("before-restore-9.sqlite3.partial").exists());
}

#[test]
fn a_scheduled_restore_waits_for_the_next_start_and_then_replaces_the_data() {
    let dir = scratch("scheduled");
    let db = dir.join("m.sqlite3");
    let writer = make_db(&db, 1, &["kept"]);
    let backup = backup_verified(&db, &dir.join("backups"), "migrate-v1-to-v2").unwrap();
    writer
        .execute("INSERT INTO notes (text) VALUES ('later')", [])
        .unwrap();
    drop(writer);
    let file = backup
        .path
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    schedule_restore(&dir, &file, 1).unwrap();
    assert_eq!(notes(&db), ["kept", "later"], "scheduling changes nothing");
    assert_eq!(pending_restore(&dir), Some(file));
    apply_pending_restore("m", &db, 1);
    assert_eq!(notes(&db), ["kept"]);
    assert_eq!(pending_restore(&dir), None, "done once");
    assert!(
        notices()
            .iter()
            .any(|n| n.module == "m" && n.message.contains("was restored"))
    );
}

#[test]
fn a_restore_is_refused_for_a_path_a_newer_backup_or_a_missing_file_and_changes_nothing() {
    let dir = scratch("refused");
    let db = dir.join("m.sqlite3");
    drop(make_db(&db, 1, &["x"]));
    let backups = dir.join("backups");
    touch_backup(&backups, "before-migrate-v1-to-v2-1.sqlite3");
    let new = Connection::open(backups.join("before-migrate-v2-to-v3-1.sqlite3")).unwrap();
    new.execute_batch("CREATE TABLE notes (text TEXT); PRAGMA user_version = 3;")
        .unwrap();
    drop(new);
    for bad in [
        "../m.sqlite3",
        "/etc/passwd",
        "before-gone.sqlite3",
        "notes.txt",
    ] {
        assert!(schedule_restore(&dir, bad, 2).is_err(), "{bad}");
    }
    assert!(
        schedule_restore(&dir, "before-migrate-v2-to-v3-1.sqlite3", 2).is_err(),
        "newer than supported"
    );
    assert_eq!(pending_restore(&dir), None);
    // A marker that goes bad before the next start is reported, removed, and the data stays.
    std::fs::write(dir.join("restore-pending"), "before-gone.sqlite3").unwrap();
    apply_pending_restore("refused", &db, 1);
    assert_eq!(notes(&db), ["x"]);
    assert_eq!(pending_restore(&dir), None);
    assert!(
        notices()
            .iter()
            .any(|n| n.module == "refused" && n.message.contains("not restored"))
    );
}

#[test]
fn per_entry_versions_must_agree_between_a_file_and_its_copy() {
    let dir = scratch("entries");
    let db = dir.join("t.sqlite3");
    let c = Connection::open(&db).unwrap();
    c.execute_batch("CREATE TABLE entries (id TEXT, schema_version INTEGER NOT NULL); INSERT INTO entries VALUES ('a',1),('b',1); PRAGMA user_version = 1;").unwrap();
    assert_eq!(entry_version_range(&db), Some((1, 1)));
    let good = backup_verified(&db, &dir.join("backups"), "t").unwrap();
    assert_eq!(entry_version_range(&good.path), Some((1, 1)));
    let other = dir.join("other.sqlite3");
    let o = Connection::open(&other).unwrap();
    o.execute_batch("CREATE TABLE entries (id TEXT, schema_version INTEGER NOT NULL); INSERT INTO entries VALUES ('a',2); PRAGMA user_version = 1;").unwrap();
    assert!(verify(&other, &db).unwrap_err().contains("per-entry"));
    assert_eq!(entry_version_range(&dir.join("missing.sqlite3")), None);
}
