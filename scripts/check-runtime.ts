// 実行時のライブラリ（packages/runtime/*）の検査
// - バージョン: すべて同じ（`runtime@<version>` のタグでまとめて公開するため）
// - 会社固有の値: ソースに入れない。使う側が渡す
//   一覧に具体的な値を書くと公開のリポに載るので、形で検出する
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'packages/runtime';
const PATTERNS: { name: string; re: RegExp }[] = [
  // Cloudflare のアカウント・ゾーンの ID など
  { name: '32桁の16進数の ID', re: /\b[0-9a-f]{32}\b/i },
  { name: 'メールアドレス', re: /\b[\w.+-]+@(?!example\.(?:com|org|net)\b)[\w-]+(?:\.[\w-]+)+/ },
  { name: 'URL', re: /https?:\/\/(?!(?:[\w-]+\.)*(?:example\.(?:com|org|net)|cloudflare\.com|cloudflareaccess\.com|github\.com|npmjs\.com|localhost)\b)[\w.-]+/ },
  // パッケージのスコープ（`@ryusenkei/`）以外の社名
  { name: '社名', re: /(?<!@)ryusenkei(?!\/)/i },
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(path).isDirectory() ? files(path) : /\.(ts|json|md)$/.test(name) ? [path] : [];
  });

const problems: string[] = [];
const packages = readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isDirectory());
const versions = new Map(packages.map((name) => [name, (JSON.parse(readFileSync(join(ROOT, name, 'package.json'), 'utf8')) as { version: string }).version]));
if (new Set(versions.values()).size > 1) problems.push(`バージョンが不一致: ${[...versions].map(([n, v]) => `${n}@${v}`).join('、')}`);

for (const file of packages.flatMap((name) => files(join(ROOT, name, 'src')))) {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const { name, re } of PATTERNS) if (re.test(line)) problems.push(`${file.replaceAll('\\', '/')}:${i + 1}: ${name}`);
    });
}

for (const p of problems) console.error(p);
process.exitCode = problems.length ? 1 : 0;
