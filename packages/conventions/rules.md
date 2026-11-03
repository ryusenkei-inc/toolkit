## コード

- 構成: パッケージの責務・依存は README の構成の表に準拠
- 共有: リポ内は `packages/*`、リポ間は toolkit（npm の `@ryusenkei/*`）。`@ryusenkei/*` の変更は toolkit で実施
- エントリポイント: パッケージごとに `src/index.ts`。export は外部で使用するものだけ・他パッケージの再 export なし
- TypeScript: ビルドせず Node で直接実行（`node scripts/x.ts`）
- テスト: Vitest。対象と同じディレクトリに `*.test.ts`
- 子プロセス: `scripts/lib/exec.ts` の `exec`（Windows の `.cmd` に対応）
- 依存の更新: Dependabot の PR で実施（月1回・自動の rebase なし → マージの前に手で rebase）

## 設定・秘密値

- 秘密値: ルート `.env` に集約。配信は `pnpm env:push` に一本化
- `*.tfvars`・Terraform の state: コミット禁止
- `.env.example`: 変数の追加時は `scripts/env.ts` の `TARGETS` にも定義
- 環境変数を付けた実行: `node scripts/env.ts run NAME=value <cmd>`（`NAME=value cmd` は Windows で不可）
- YAML の拡張子: `.yaml`（pnpm のファイルと統一）
- 共通ファイル（`.editorconfig`・`.github/dependabot.yaml`・`.claude/settings.json` など）: `@ryusenkei/conventions` のマスタから同期。直接編集しない
  - 変更は toolkit で実施し、`ryusenkei-conventions sync` で反映

## 記述内容（コード・コメント・ドキュメント共通）

- コメント: 非自明な理由・制約のみ。処理の内容はコードの名前で表現
- 変更の経緯: コメントに書かず PR に記載
- `export` する関数・型・定数: JSDoc
- 個人名: 記載禁止（コード・コメント・ドキュメント・設定値すべて）

## 文体（Markdown・コメント共通）

- 散文より構造化（表・箇条書き・キー: 値）
- ドメインの概念・説明・表示文字列は日本語
- 文体の指摘（`prose-lint`）がドメインの用語に該当する場合: `prose-lint.json` の `allow`・`vocabulary` に追加

## Git・PR

- コミット: 変更・追加したファイルをパスで指定して add（一括の add は禁止、フックで強制）
- push の前: `pnpm check`（`check` を持つリポは pre-push で強制）
- PR の本文: 背景・変更・検証
- マージ: CI の全チェックの成功を確認してから（フックで強制）
- epic のフロー（有効にしたリポのみ）
  - epic ごとに `dev/<issue の番号>-<内容>` を作成し、sub-issue の PR は dev のブランチへ
  - `main` へのマージはデプロイのときだけ dev のブランチから

## 完了の条件

- `pnpm lint`（型検査・prose-lint・共通ファイルの検査）と `pnpm test` が通過
- README の構成・コマンドの記述が変更と一致
