# CLAUDE.md

複数のリポで共有するパッケージのモノリポ。構成・運用は [README.md](README.md)

## 規約

- 構成: パッケージの一覧は README の「Packages」
- エントリポイント: パッケージごとに `src/index.ts`。export は外部で使用するものだけ・他パッケージの再 export なし
- 公開: npm の public。パッケージに入るのは `dist` のみ
  - 秘密値・個人名・特定のリポ固有の値を含めない
- YAML の拡張子: `.yaml`（pnpm のファイルと統一）
- バージョン: semver。互換性のない変更は major を上げる（利用側は `^` で依存）
- 個人名: リポに記載禁止（コード・コメント・ドキュメント・設定値・`package.json` の `author` すべて）

## 文体（README・コメント共通）

- 散文より構造化（表・箇条書き・キー: 値）
- 技術語彙（カタカナ語・漢語・漢語複合）で簡潔に
- README: 英語（公開パッケージのため）。パッケージの README はユーザー向け、リポの README は開発・公開の手順
- コード上の値・環境変数の参照はコードの名前で、バッククォートで囲む。ドメインの概念・説明・表示文字列は日本語
- コメントは非自明な理由・制約のみ。`pnpm lint:prose` で確認（規則 = このリポの `packages/prose-lint`）

## コミット

- Conventional Commits。type・scope は英語、subject は日本語
- subject は1行のみ。body は書かない（背景は PR に記載）
- バージョンを上げるだけのコミット: `chore(release): <package>@<version>`（英語の定型。タグ名と同じ）
- Claude・AI の署名・trailer 禁止
