import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// パッケージの間の import はビルドの前のソースを読む（CI はビルドせずに試験する）
const core = (path: string) => fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url));

export default defineConfig({
  test: {
    alias: [
      { find: /^@ryusenkei\/core$/, replacement: core('index.ts') },
      { find: /^@ryusenkei\/core\/context$/, replacement: core('context/index.ts') },
    ],
  },
});
