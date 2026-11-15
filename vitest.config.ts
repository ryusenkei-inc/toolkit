import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// パッケージの間の import はビルドの前のソースを読む（CI はビルドせずに試験する）
const core = (path: string) => fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url));

// 実行時のライブラリ（core、web）は Workers と Vercel Edge の環境（Web 標準の API だけ）でも試験する
const RUNTIME_TESTS = ['packages/core/src/**/*.test.ts', 'packages/web/src/**/*.test.ts'];

export default defineConfig({
  test: {
    alias: [
      { find: /^@ryusenkei\/core$/, replacement: core('index.ts') },
      { find: /^@ryusenkei\/core\/context$/, replacement: core('context/index.ts') },
      { find: /^@ryusenkei\/core\/trace$/, replacement: core('trace/index.ts') },
      { find: /^@ryusenkei\/core\/csv$/, replacement: core('csv/index.ts') },
    ],
    // `.claude/`: リポの中の作業用の worktree、`.terraform/`: Terraform の作業のディレクトリ
    exclude: [...configDefaults.exclude, '.claude/**', '**/.terraform/**'],
    projects: [
      { extends: true, test: { name: 'node' } },
      { extends: true, test: { name: 'edge', environment: 'edge-runtime', include: RUNTIME_TESTS } },
    ],
  },
});
