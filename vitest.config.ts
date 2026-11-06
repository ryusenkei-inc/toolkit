// 実行時のライブラリの間の import はソースを参照（ビルドの前でもテストできるように）
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const runtime = new URL('./packages/runtime/', import.meta.url);
const names = readdirSync(runtime, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

export default defineConfig({
  resolve: {
    alias: names.flatMap((name) => [
      { find: `@ryusenkei/${name}/testing`, replacement: fileURLToPath(new URL(`${name}/src/testing.ts`, runtime)) },
      { find: `@ryusenkei/${name}/contract`, replacement: fileURLToPath(new URL(`${name}/src/contract.ts`, runtime)) },
      { find: new RegExp(`^@ryusenkei/${name}$`), replacement: fileURLToPath(new URL(`${name}/src/index.ts`, runtime)) },
    ]),
  },
});
