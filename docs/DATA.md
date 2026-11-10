# Data and compatibility

Existing applications own their own data; [audit notes](AUDIT-DRAFT.md) are preliminary and do not establish a canonical storage strategy. Terminal cached source uses rusqlite and a versioned migration, and identifies a `journal.sqlite3` file; resolved platform locations and current release behavior must be verified. Audit Ember and Swish schemas, paths, migrations, permissions, backups and actual versions before proposing access.

Decide whether host and standalone builds share a store, use a service, or migrate/import data only after reviewing permissions, version compatibility and failure recovery. Back up and validate before any migration; preserve originals, test rollback and restore, and avoid destructive downgrades. SQLite transactions alone do not guarantee safe cross-process migrations or refresh: test locking, simultaneous writes, busy handling, notifications, schema version mismatch and interrupted operations. Use synthetic fixtures. No personal content, credentials or user databases belong in Git, logs or handoffs. Local-first is an expectation, not proof of zero network traffic or encryption.

U-33 data-location and migration recommendations: [DATA-DECISIONS-U33.md](DATA-DECISIONS-U33.md).
