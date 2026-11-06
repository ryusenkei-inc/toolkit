## Rust

- ライブラリのエントリポイントは `src/lib.rs`。`pub` にするのは外部で使うものだけ
- 単体テストは対象と同じファイルの `#[cfg(test)] mod tests` に書く
- `unsafe` は OS の API の呼び出しだけに使い、箇所ごとに `#[allow(unsafe_code)]` と `SAFETY` のコメントを付ける
- `pnpm lint` に `cargo fmt --all --check` と `cargo clippy --workspace --all-targets -- -D warnings`、`pnpm test` に `cargo test --workspace` を含める
