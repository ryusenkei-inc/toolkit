# CLAUDE.md

複数のリポで共有するパッケージのモノリポ。構成と運用は[README.md](README.md)にある。

## 規約

- パッケージの一覧はREADMEの「Packages」に載せる
- エントリポイントはパッケージごとの`src/index.ts`。exportするのは外部で使うものだけで、他パッケージのものをexportし直さない
- パッケージはnpmにpublicで公開する。パッケージに入るのは`package.json`の`files`だけ（ビルドするパッケージは`dist`）
  - 秘密値、個人名、特定のリポに固有の値を入れない
- `packages/conventions`の`rules*.md`と`files/`は、利用する側のリポの規約と共通ファイル。このリポの作業には、`rules.md`の「文章を書く場所」「書く量」と`style.md`だけを当てはめる
- YAMLの拡張子は`.yaml`にする（pnpmのファイルに合わせる）
- バージョンはsemverで上げる。利用する側は`^`で依存するので、破壊的変更では0.xの間はminor、1.0.0以降はmajorを上げる
- 変更はパッケージの`CHANGELOG.md`（Terraformは`terraform/CHANGELOG.md`）に、機能のPRで書く。破壊的変更には、利用する側が切り替えに使う旧 → 新の対応表を載せる
- 個人名はリポに書かない。コード、コメント、ドキュメント、設定値、`package.json`の`author`のすべてが対象

## 文章

- 書き方は`packages/conventions/rules.md`の「文章を書く場所」「書く量」と、スタイルガイド（下記）に従う
- READMEは英語で書く（公開のパッケージのため）。パッケージのREADMEは使う人向け、リポのREADMEは開発と公開の手順
- コメントとMarkdownは`pnpm lint:prose`で検査する（規則はこのリポの`packages/prose-lint`）

@packages/conventions/style.md

## コミット

- Conventional Commitsで書く。typeとscopeは英語、subjectは日本語
- subjectは1行だけで、bodyは書かない（背景はPRに書く）
- バージョンを上げるだけのコミットは`chore(release): <package>@<version>`（英語の定型で、タグ名と同じ）
- ClaudeやAIの署名、trailerを付けない
