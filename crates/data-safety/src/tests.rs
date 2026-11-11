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
fn nothing_to_migrate_means_nothing_is_written() {
    let dir = scratch("noop");
    let db = dir.join("m.sqlite3");
    let _w = make_db(&db, 1, &["x"]);
    assert_eq!(
        prepare("noop", &db, &dir.join("backups"), 1),
        Prepared::Proceed
    );
    assert_eq!(
        prepare("noop", &dir.join("absent.sqlite3"), &dir.join("backups"), 1),
        Prepared::Proceed
    );
    assert!(
        !dir.join("backups").exists(),
        "no backups folder was created"
    );
}

#[test]
fn a_newer_file_is_not_touched_and_not_backed_up() {
    let dir = scratch("newer");
    let db = dir.join("m.sqlite3");
    let _w = make_db(&db, 5, &["x"]);
    let before = bytes(&db);
    assert_eq!(
        prepare("newer", &db, &dir.join("backups"), 1),
        Prepared::Proceed,
        "the module refuses it itself"
    );
    assert_eq!(bytes(&db), before);
    assert!(!dir.join("backups").exists());
}

#[test]
fn an_older_file_is_backed_up_and_verified_before_anyone_may_migrate_it() {
    let dir = scratch("migrate");
    let db = dir.join("m.sqlite3");
    let _w = make_db(&db, 1, &["keep me"]);
    let Prepared::BackedUp(copy) = prepare("migrates", &db, &dir.join("backups"), 2) else {
        panic!("expected a backup")
    };
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
        .find(|n| n.module == "migrates")
        .expect("the person is told");
    assert!(notice.message.contains("refuse"), "{}", notice.message);
    assert!(notice.message.contains(copy.path.to_str().unwrap()));
}

#[test]
fn if_the_safety_copy_cannot_be_made_the_file_is_refused_and_unchanged() {
    let dir = scratch("refuse");
    let db = dir.join("m.sqlite3");
    let writer = make_db(&db, 1, &["precious"]);
    drop(writer);
    let before = bytes(&db);
    // The backups location is a regular file, so a folder cannot be created there.
    std::fs::write(dir.join("backups"), b"in the way").unwrap();
    let Prepared::Refused(reason) = prepare("refused", &db, &dir.join("backups"), 2) else {
        panic!("expected a refusal")
    };
    assert!(reason.contains("Nothing was changed"), "{reason}");
    assert_eq!(
        bytes(&db),
        before,
        "the original is byte-for-byte as it was"
    );
    assert_eq!(user_version(&db).unwrap(), 1);
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
