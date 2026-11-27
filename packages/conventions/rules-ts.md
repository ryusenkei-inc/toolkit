## TypeScript

- エントリポイントはパッケージごとの`src/index.ts`
- TypeScriptはビルドせず、Nodeで直接実行する（`node scripts/x.ts`）
- テストはVitestで書き、対象と同じディレクトリに`*.test.ts`を置く。ルートのvitest.configの`test.exclude`は`[...configDefaults.exclude, ...TEST_EXCLUDE]`（`@ryusenkei/conventions`）
- 子プロセスは`@ryusenkei/scripts`の`execSync`などで起動する。Windowsの`.cmd`に対応するため
- 層の依存の向きは`scripts/lib/deps-rules.ts`に規則を書き、`@ryusenkei/conventions`の`runDepsCheck`で検査する（`pnpm lint`に含める）

## 定数

- exportするモジュールの定数はUPPER_SNAKEで書き、`as const satisfies T`を付ける。フィールドはcamelCase
- 数値は単位を接尾辞で表す（`Ms`、`Sec`、`Px`、`Rem`、`Pct`、`MB`など）
- enumは使わない。`const X = [...] as const`と`type X = (typeof X)[number]`で表す
- 条件、数値、識別子はconfigに置き、表示の文言は辞書に置く。複数の言語から使う値はJSONのマスタを1つ置く
