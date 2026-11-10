# U-32 native dependency alignment (throwaway evidence)

Not production code. Reproduces the check in `docs/DEPENDENCY-ALIGNMENT-U32.md`.

1. Clone Terminal `420a5e6`, Ember `5af1eae`, Swish `735370a` next to each other (`terminal/`, `ember/`, `swish/`).
2. In a new folder `combined/`, use `combined-Cargo.toml` as `Cargo.toml` (with a `src/main.rs` containing `fn main(){}`) and run `cargo generate-lockfile`. It fails with a `links = "sqlite3"` conflict.
3. In `swish/`, apply `swish-rusqlite-0.41.patch` (one-line `swish-data` change plus its lockfile) and repeat. It resolves to one `rusqlite 0.41.1` / `libsqlite3-sys 0.39.1` and `cargo check` passes; `combined-Cargo.lock` is that lockfile.
