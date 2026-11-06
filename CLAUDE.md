# CLAUDE.md

複数のリポで共有するパッケージのモノリポ。構成と運用は [README.md](README.md) にある

## 規約

- パッケージの一覧は README の「Packages」に載せる
- エントリポイントはパッケージごとの `src/index.ts`。export するのは外部で使うものだけで、他パッケージのものを export し直さない
- パッケージは npm に public で公開する。パッケージに入るのは `package.json` の `files` だけ（ビルドするパッケージは `dist`）
  - 秘密値、個人名、特定のリポに固有の値を入れない
- `packages/conventions` の `rules*.md` と `files/` は、利用する側のリポの規約と共通ファイル。このリポの作業には、書き方の節（文章を書く場所、書く量、書き方）だけを当てはめる
- YAML の拡張子は `.yaml` にする（pnpm のファイルに合わせる）
- バージョンは semver で上げる。利用する側は `^` で依存するので、互換性のない変更では 0.x の間は minor、1.0.0 以降は major を上げる
- 個人名はリポに書かない。コード、コメント、ドキュメント、設定値、`package.json` の `author` のすべてが対象

## 文章

- 書き方は `packages/conventions/rules.md` の「文章を書く場所」「書く量」「書き方」に従う
- README は英語で書く（公開のパッケージのため）。パッケージの README は使う人向け、リポの README は開発と公開の手順
- コメントと Markdown は `pnpm lint:prose` で検査する（規則はこのリポの `packages/prose-lint`）

## コミット

- Conventional Commits で書く。type と scope は英語、subject は日本語
- subject は1行だけで、body は書かない（背景は PR に書く）
- バージョンを上げるだけのコミットは `chore(release): <package>@<version>`（英語の定型で、タグ名と同じ）
- Claude や AI の署名、trailer を付けない
