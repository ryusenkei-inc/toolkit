// 実行時のライブラリ（packages/core、packages/web）の検査
// - 会社固有の値: ソースに入れない。使う側が渡す（会社の値は packages/company に置く）
//   一覧に具体的な値を書くと公開のリポに載るので、形で検出する
// - ビルドの生成物: ビルドの設定の誤りで src に出た .js・.d.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCES = ['packages/core/src', 'packages/web/src'];
const PATTERNS: { name: string; re: RegExp }[] = [
  // Cloudflare のアカウント・ゾーンの ID など
  { name: '32桁の16進数の ID', re: /\b[0-9a-f]{32}\b/i },
  { name: 'メールアドレス', re: /\b[\w.+-]+@(?!example\.(?:com|org|net)\b)[\w-]+(?:\.[\w-]+)+/ },
  { name: 'URL', re: /https?:\/\/(?!(?:[\w-]+\.)*(?:example\.(?:com|org|net)|cloudflare\.com|cloudflareaccess\.com|github\.com|npmjs\.com|localhost)\b)[\w.-]+/ },
  // パッケージのスコープ（`@ryusenkei/`）以外の社名
  { name: '社名', re: /(?<!@)ryusenkei(?!\/)/i },
];

const all = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? all(join(dir, name)) : [join(dir, name)]));
const problems: string[] = [];

for (const file of SOURCES.flatMap(all)) {
  const path = file.replaceAll('\\', '/');
  if (/\.(js|d\.ts)$/.test(file)) problems.push(`${path}: src の中のビルドの生成物`);
  if (!/\.(ts|json|md)$/.test(file)) continue;
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const { name, re } of PATTERNS) if (re.test(line)) problems.push(`${path}:${i + 1}: ${name}`);
    });
}

for (const p of problems) console.error(p);
process.exitCode = problems.length ? 1 : 0;
