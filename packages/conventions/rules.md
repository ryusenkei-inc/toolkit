## コード

- パッケージ・クレートの責務と依存は、READMEの構成の表に従う
- リポ内で共有するコードは`packages/*`に置く。リポをまたぐものはtoolkit（npmの`@ryusenkei/*`）に置き、変更もtoolkitで行う
- エントリポイントでは外部で使うものだけを公開し、他パッケージのものを公開し直さない
- テストは対象の近くに置く。言語ごとの置き方は`rules-ts.md`・`rules-go.md`・`rules-rust.md`
- エラー、ログ、標準出力はコード（識別子）で表す。人が読む文言は表示のマスタ（辞書）から引き、その場に日本語を書かない
- テストでgitを動かすときは、`GIT_DIR`などのgitの環境変数を外す。フックから動くと、呼び出し元のリポを書き換える
- 依存の更新はDependabotのPRで行う。月1回で自動のrebaseはしないので、マージの前に手でrebaseする
  - `package.json`に`"ryusenkei": { "dependabot": false }`を設定したリポでは、手元で`pnpm update`してまとめて更新する

## 設定と秘密値

- 秘密値はルートの`.env`にまとめ、配信は`pnpm env:push`だけで行う
- `*.tfvars`とTerraformのstateはコミットしない
- `.env.example`に変数を足したら、`scripts/env.ts`の`targets`にも定義する。`scripts/env.ts`は`@ryusenkei/scripts`の`envCli`に配信先を渡すだけにする
- Cloudflareのトークンはデプロイ用とTerraform用に分ける。CIでデプロイしないなら、どちらもGitHubに配信しない
- 環境変数を付けて実行するときは`node scripts/env.ts run NAME=value <cmd>`を使う。`NAME=value cmd`はWindowsで動かない
- YAMLの拡張子は`.yaml`にする（pnpmのファイルに合わせる）
- 共通ファイル（`.editorconfig`、`.github/dependabot.yaml`、`.claude/settings.json`など）は`@ryusenkei/conventions`から同期するので、直接編集しない。変えるときはtoolkitで直し、`ryusenkei-conventions sync`で反映する

## 文章を書く場所

| 場所 | 性格 | 書くこと |
| --- | --- | --- |
| コード | 常に最新 | 意図は名前、型、関数の分け方で表す。コメントはその場所に欠かせない制約だけ |
| README | 変更と一緒に直す | 今の構成と設計の方針 |
| PR、issue | その時点の記録 | 経緯、検証、判断、採用しなかった案 |

- 決定の記録のファイル（ADRなど）は置かない
- 個人名は書かない。コード、コメント、ドキュメント、設定値のすべてが対象

## 書く量

| 種類 | 書く | 書かない |
| --- | --- | --- |
| コードのコメント | 既定は書かない。書くのは、読み手が直そうとしてしまう一見おかしなコードの理由、コードから読み取れない外部の事実（仕様、プラットフォームの癖）、型で表せない単位や形式だけ | コードがしていることの説明、経緯、採用しなかった案、issueに結びつかないTODO |
| exportのJSDoc | 名前と型以上の情報があるときだけ（単位、副作用、エラーコード、前提条件） | 名前を言い換えるだけのJSDoc |
| README | 何のリポか、動かし方、構成、今の設計の方針 | 経緯、判断の理由の長文、機能の宣伝 |
| PR | 背景（1〜3行）、レビューに要る粒度での変更、実際に行った検証 | 差分をなぞる説明、ファイルごとの実況 |
| issue | 問題、決めた範囲、未決の点。決まったら決定を書き足す | 調査の過程の全文 |
| コミットメッセージ | 1行で変更を言い切る | 本文での経緯の説明 |

説明が要ると感じたら、先にコードや構成を直せないか考える。

## 書き方

語彙、文体、形式、表記は、スタイルガイドに従う。

@style.md

## GitとPR

- addは変更・追加したファイルをパスで指定する。一括のaddはフックで止まる
- pushの前に`pnpm check`を通す。pre-pushで強制される（`check`のscriptはどのリポにも置く）
  - `pnpm check`はPRの向き先（`origin/main`かepicの`origin/dev/*`）からの変更の影響の範囲だけを検査する。全体の検査の`pnpm check --all`はデプロイの前に手元で回す
- PRの本文は背景、変更、検証の順に書く
- issueとPRで検討する場合は、検討事項をQの番号つきのリストで書き、Qごとに1件のコメントで議論する
- 前のPRのブランチからPRを重ねた場合は、親のマージの後にスキル`stacked-pr`の手順で整理する
- マージはsquashで、CIの全チェックの成功を確かめてから行う（フックで強制）
  - `main`行きのPRはdraftで作り、マージの前にreadyにする。CIはreadyのPRだけで回る（GitHub Actionsの無料枠の節約）
  - CIが走らない・止まったとき（無料枠の超過など）は、PRのheadのコミットで手元の`pnpm check --base origin/<base>`を通せばマージできる
- epicのフロー（有効にしたリポだけ）
  - epicごとに`dev/<issue の番号>-<内容>`を作り、sub-issueのPRはdevのブランチに向ける
  - devのブランチへのマージにCIは使わず、pre-pushの`pnpm check`を関門にする。チェックがある場合は成功が必要
  - `main`へのマージは、デプロイのときにdevのブランチからだけ行う。方法はほかのPRと同じsquashで、sub-issueごとのコミットはsub-issueのPRに残る
  - デプロイの後もepicを続ける場合は、スキル`stacked-pr`の手順でdevのブランチを`main`から作り直し、開いているsub-issueのPRを載せ直す

## CI（GitHub Actions）

- CIはtoolkitの再利用可能なワークフロー（`reusable-ci.yaml`、`reusable-pr-title.yaml`）を呼ぶ。リポ独自の検査は入力の`checks`に書き、言語ごとのジョブ（Go、Rust）は呼ぶ側に足す。呼び方は`@ryusenkei/conventions`のREADME

非公開のリポではGitHub Freeの時間を節約する（上限は組織の合計で月2,000分、ジョブごとに分単位で切り上げて計上）。

- 実行するのは`main`行きのPRだけ。マージの結果のrefはPRで検査済みなので、`main`へのpushでは実行しない
- 検査は1つのジョブに順に並べる。並列に分けると、切り上げと準備の時間が増える
- 同じPRで新しい実行が始まったら、古い実行を中止する（`concurrency`の`cancel-in-progress`）
- PRのタイトルの変更（`edited`）は、タイトルだけを検査する別のワークフローで扱う。依存は入れない
- キャッシュのキーにコミットのID（`github.sha`）を含めない。毎回保存が走り、復元が効かなくなる
- WindowsとmacOSのランナーは公開のリポだけで使う。非公開では2倍と10倍で計上される

## 完了の条件

- `pnpm lint`（型検査、prose-lint、共通ファイルの検査）と`pnpm test`が通る
- READMEの構成とコマンドの記述が変更と合っている
