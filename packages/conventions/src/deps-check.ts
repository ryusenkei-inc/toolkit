// 依存の向きの検査の実行（各リポの scripts/deps.ts から規則を渡して呼ぶ）
// - 対象: ソースの import と package.json の依存（git が追跡するファイルと、無視されていない未追跡のファイル）
// - 違反・規則のないワークスペースのパッケージがあれば終了コード1
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { checkManifest, checkSource, uncovered, type Exception, type Manifest, type Rule, type Violation, type Workspace } from './deps.ts';

type PackageJson = { name?: string; exports?: Record<string, unknown>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

const readJson = (file: string): PackageJson => JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
const dependenciesOf = (pkg: PackageJson): string[] => Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });

/** ワークスペースのパッケージのディレクトリ（pnpm-workspace.yaml の packages、リポのルートから `/` 区切り） */
export function workspaceDirs(): string[] {
  const packagesBlock = /^packages:\r?\n((?:[ \t]+.*\r?\n?)+)/m.exec(readFileSync('pnpm-workspace.yaml', 'utf8'))?.[1] ?? '';
  const patterns = [...packagesBlock.matchAll(/-\s+["']?([^"'\s#]+)/g)].map((m) => m[1]!);
  return patterns.flatMap((p) => globSync(`${p}/package.json`)).map((f) => posix.dirname(f.replaceAll('\\', '/')));
}

// サブパスの export: 指定子 `名前/サブパス` をファイルに解決（パッケージの中で規則が分かれる場合の照合、`.` とパターンはディレクトリのまま）
const entriesOf = (dir: string): [string, string][] => {
  const pkg = readJson(`${dir}/package.json`);
  const name = pkg.name ?? dir;
  const subpaths = Object.entries(pkg.exports ?? {}).flatMap(([key, value]): [string, string][] => (key !== '.' && !key.includes('*') && typeof value === 'string' ? [[`${name}/${key.slice(2)}`, posix.join(dir, value)]] : []));
  return [[name, dir], ...subpaths];
};

/**
 * リポのルートで依存の向きを検査し、結果を出力して終了コードを設定
 * @param options.rulesFile 案内に出す規則のファイル
 */
export function runDepsCheck(options: { rules: Rule[]; exceptions?: Exception[]; rulesFile?: string }): void {
  const { rules, exceptions = [], rulesFile = 'scripts/lib/deps-rules.ts' } = options;
  const dirs = workspaceDirs();
  const workspace: Workspace = new Map(dirs.flatMap(entriesOf));
  const manifests: Manifest[] = [{ dir: '', ruleAt: 'scripts', dependencies: dependenciesOf(readJson('package.json')) }, ...dirs.map((dir) => ({ dir, ruleAt: dir, dependencies: dependenciesOf(readJson(`${dir}/package.json`)) }))];

  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  if (listed.status !== 0) {
    console.error(listed.stderr);
    process.exitCode = 1;
    return;
  }
  const files = listed.stdout.split('\n').filter((f) => f && existsSync(f));

  const violations: Violation[] = [...manifests.flatMap((m) => checkManifest(rules, workspace, exceptions, m)), ...files.flatMap((f) => checkSource(rules, workspace, exceptions, f, readFileSync(f, 'utf8')))];
  const missing = uncovered(rules, workspace);
  for (const dir of missing) console.error(`${dir}: 依存の規則がない（${rulesFile} に追加）`);
  for (const v of violations) console.error(`${v.file}: '${v.specifier}'（${v.rule}）→ ${v.reason}`);
  if (missing.length > 0 || violations.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log('依存の向き: 問題なし');
}
