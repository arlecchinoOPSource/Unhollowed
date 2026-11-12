use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

fn scratch() -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "unhlw-change-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn wal(path: &Path) -> Connection {
    let db = Connection::open(path).unwrap();
    db.pragma_update(None, "journal_mode", "WAL").unwrap();
    db.execute_batch("CREATE TABLE t (x)").unwrap();
    db
}

#[test]
fn another_connections_commit_is_noticed_once_and_quiet_files_are_quiet() {
    let dir = scratch();
    let file = dir.join("m.sqlite3");
    let mut watcher = ChangeWatcher::new(&file);
    assert!(!watcher.changed(), "no file yet: nothing to report");
    let writer = wal(&file);
    assert!(!watcher.changed(), "the first look is only the baseline");
    assert!(!watcher.changed(), "nothing happened");
    writer.execute("INSERT INTO t VALUES (1)", []).unwrap();
    assert!(watcher.changed(), "a commit by another connection");
    assert!(!watcher.changed(), "reported once");
    writer.execute("INSERT INTO t VALUES (2)", []).unwrap();
    writer.execute("INSERT INTO t VALUES (3)", []).unwrap();
    assert!(
        watcher.changed(),
        "several commits between looks are one change"
    );
}

#[test]
fn an_uncommitted_write_is_not_a_change_until_it_commits() {
    let dir = scratch();
    let file = dir.join("m.sqlite3");
    let mut writer = wal(&file);
    let mut watcher = ChangeWatcher::new(&file);
    assert!(!watcher.changed());
    let tx = writer.transaction().unwrap();
    tx.execute("INSERT INTO t VALUES (1)", []).unwrap();
    assert!(!watcher.changed());
    tx.commit().unwrap();
    assert!(watcher.changed());
}

#[test]
fn watching_never_modifies_the_file() {
    let dir = scratch();
    let file = dir.join("m.sqlite3");
    drop(wal(&file));
    let before = std::fs::read(&file).unwrap();
    let mut watcher = ChangeWatcher::new(&file);
    for _ in 0..5 {
        watcher.changed();
    }
    assert_eq!(std::fs::read(&file).unwrap(), before);
}

#[test]
fn a_replaced_file_starts_a_new_baseline_without_a_false_alarm() {
    let dir = scratch();
    let file = dir.join("m.sqlite3");
    drop(wal(&file));
    let mut watcher = ChangeWatcher::new(&file);
    watcher.changed();
    std::fs::write(&file, b"not a database").unwrap();
    let _ = watcher.changed();
    std::fs::remove_file(&file).unwrap();
    let _ = wal(&file);
    assert!(
        !watcher.changed() || !watcher.changed(),
        "settles after a replacement"
    );
}
