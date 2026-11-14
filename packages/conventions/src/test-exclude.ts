// Vitest の既定に足す除外（各リポの vitest.config で `[...configDefaults.exclude, ...TEST_EXCLUDE]` にする）
// - `.claude/**`: リポの中の作業用の worktree（同じテストを重複して集める）
// - `**/.terraform/**`: Terraform の作業のディレクトリ。git の Terraform のモジュールの取得で、toolkit などのリポ全体（テストを含む）が置かれる

/** Vitest の既定の `exclude` に足すパターン */
export const TEST_EXCLUDE = ['.claude/**', '**/.terraform/**'] as const satisfies readonly string[];

const CONFIG_FILES = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs'];

/**
 * ルートの Vitest の設定が除外を含むかの検査。問題がなければ `undefined`、あれば対処の文
 * - `vitest` に依存しないリポは対象の外
 * - 設定が `TEST_EXCLUDE` を使うか、すべてのパターンを書いていれば通す
 */
export function testExcludeProblem(dependencies: readonly string[], read: (file: string) => string | undefined): { path: string; message: string } | undefined {
  if (!dependencies.includes('vitest')) return undefined;
  const found = CONFIG_FILES.map((file) => ({ file, text: read(file) })).find((c) => c.text !== undefined);
  const usage = '`import { TEST_EXCLUDE } from \'@ryusenkei/conventions\'` を読み、`test.exclude` を `[...configDefaults.exclude, ...TEST_EXCLUDE]` にする';
  if (!found) return { path: 'vitest.config.ts', message: `Vitest の設定がない → ${usage}` };
  if (found.text!.includes('TEST_EXCLUDE') || TEST_EXCLUDE.every((p) => found.text!.includes(p))) return undefined;
  return { path: found.file, message: `テストの除外（${TEST_EXCLUDE.map((p) => `\`${p}\``).join('・')}）がない → ${usage}` };
}
