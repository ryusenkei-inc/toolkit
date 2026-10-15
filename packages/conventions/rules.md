## コード

- 構成: パッケージの責務・依存は README の構成の表に準拠
- 共有: リポ内は `packages/*`、リポ間は toolkit（npm の `@ryusenkei/*`）
  - `@ryusenkei/*` の変更は toolkit で実施。`node_modules` を直接編集しない
- エントリポイント: パッケージごとに `src/index.ts`。export は外部で使用するものだけ・他パッケージの再 export なし
- TypeScript: ビルドせず Node で直接実行（`node scripts/x.ts`）
- テスト: Vitest。対象と同じディレクトリに `*.test.ts`
- 子プロセス: `scripts/lib/exec.ts` の `exec`（Windows の `.cmd` に対応）

## 依存

- パッケージ管理: pnpm のみ
- 公開から2日未満のバージョンは解決しない（`pnpm-workspace.yaml` の `minimumReleaseAge`）
  - `@ryusenkei/*` は対象外
  - 値は `.github/dependabot.yaml` の `cooldown` と同値
- 更新: Dependabot の PR で実施

## 設定・秘密値

- 秘密値: ルート `.env` に集約。配信は `pnpm env:push` に一本化
- `.env`・`*.tfvars`・state: コミット禁止
- `.env.example`: 変数の追加時は `scripts/env.ts` の `TARGETS` にも定義
- 環境変数を付けた実行: `node scripts/env.ts run NAME=value <cmd>`（`NAME=value cmd` は Windows で不可）
- YAML の拡張子: `.yaml`（pnpm のファイルと統一）

## 記述内容（コード・コメント・ドキュメント共通）

- コメント: 非自明な理由・制約のみ。処理の内容はコードの名前で表現
- 変更の経緯: コメントに書かず PR に記載
- `export` する関数・型・定数: JSDoc
- 個人名: 記載禁止（コード・コメント・ドキュメント・設定値すべて）

## 文体（Markdown・コメント・コミットメッセージ共通）

- 散文より構造化（表・箇条書き・キー: 値）
- 常体・体言止め。推量を避けて断定
- 技術語彙（カタカナ語・漢語・漢語複合）で簡潔に
- コード上の値・環境変数はコードの名前で、バッククォートで囲む
- ドメインの概念・説明・表示文字列は日本語

## 文体の検査

- 検査: `pnpm lint:prose`（コメント・Markdown）。編集後は `.claude/settings.json` のフックが自動で実行
- 規則: `@ryusenkei/prose-lint`。手本は `npx prose-lint --golden`
- 指摘の修正: 指摘の末尾の「修正の例」を参照。語の置換で不自然な場合は文を再構成
- リポ固有の語彙・規則の無効化: `prose-lint.json` の `vocabulary`・`allow`・`rules`（必要な場合のみ作成）

## Git

- ブランチ名: `<type>/<内容>`（type は PR のタイトルと同じ）
- コミット: Conventional Commits。type・scope は英語、subject は日本語
  - subject は1行のみ。body は書かない
  - 書式は `.githooks/commit-msg` が検査
- PR: タイトルはコミットのメッセージと同じ書式。本文に背景・変更
- マージ: squash のみ → `main` のコミットのメッセージ = PR のタイトル
- Claude・AI の署名・trailer: コミット・PR ともに禁止

## 完了の条件

- `pnpm lint`（型検査・prose-lint）と `pnpm test` が通過
- README の構成・コマンドの記述が変更と一致
