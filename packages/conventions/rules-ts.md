## TypeScript

- エントリポイントはパッケージごとの `src/index.ts`
- TypeScript はビルドせず、Node で直接実行する（`node scripts/x.ts`）
- テストは Vitest で書き、対象と同じディレクトリに `*.test.ts` を置く
- 子プロセスは `scripts/lib/exec.ts` の `exec` で起動する。Windows の `.cmd` に対応するため

## 定数

- export するモジュールの定数は UPPER_SNAKE で書き、`as const satisfies T` を付ける。フィールドは camelCase
- 数値は単位を接尾辞で表す（`Ms`、`Sec`、`Px`、`Rem`、`Pct`、`MB` など）
- enum は使わない。`const X = [...] as const` と `type X = (typeof X)[number]` で表す
- 条件、数値、識別子は config に置き、表示の文言は辞書に置く。複数の言語から使う値は JSON のマスタを1つ置く
