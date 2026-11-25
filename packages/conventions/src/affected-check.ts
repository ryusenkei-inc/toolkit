// push の前の検査の実行（各リポの scripts/check.ts から呼ぶ、範囲の決定は affected.ts）
// - pnpm check: 基準（PR の向き先との分岐点）からの変更（コミット済み・作業中・未追跡）に絞って型検査とテスト
// - pnpm check --all: すべて（デプロイの前）
// - 重い検査（型検査・テスト）は順に、軽い検査はそれと並列に実行（push の前のメモリのピークを1つの重い検査に抑えるため）
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { GLOBAL_FILES, nearestBase, scopeOf, type Candidate } from './affected.ts';
import { writeCheckRecord } from './check-record.ts';
import { workspaceDirs } from './deps-check.ts';

export type CheckStep = { name: string; command: string; args: string[] };
export type CheckContext = { base: string | undefined; changed: string[]; full: boolean };
export type CheckResult = { name: string; ok: boolean; output: string };

export type AffectedCheckOptions = {
  /** GLOBAL_FILES に足す、変更されたらすべてを検査するファイル */
  globalFiles?: (string | RegExp)[];
  /** 型検査・テストと並列に実行する軽い検査（数秒で終わる、全体にかかるもの） */
  steps?: (ctx: CheckContext) => CheckStep[];
  /** vitest に足す引数（reporter など） */
  testArgs?: string[];
  /** 型検査で同時に動かすパッケージの数（`pnpm -r --workspace-concurrency`） */
  concurrency?: number;
};

const git = (args: string[]): string | null => {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
};
const lines = (text: string | null): string[] => (text ?? '').split('\n').filter(Boolean);
const nameOf = (dir: string): string => (JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as { name: string }).name;

function candidates(): Candidate[] {
  const branch = git(['branch', '--show-current']);
  const refs = ['origin/main', ...lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/dev/'])).filter((r) => r !== `origin/${branch}`)];
  return refs.flatMap((ref) => {
    const mergeBase = git(['merge-base', 'HEAD', ref]);
    const ahead = mergeBase === null ? null : git(['rev-list', '--count', `${mergeBase}..HEAD`]);
    return mergeBase === null || ahead === null ? [] : [{ ref, mergeBase, ahead: Number(ahead) }];
  });
}

function baseOf(argv: string[]): { ref: string; mergeBase: string } | undefined {
  const i = argv.indexOf('--base');
  if (i === -1) return nearestBase(candidates());
  const ref = argv[i + 1]!;
  const mergeBase = git(['merge-base', 'HEAD', ref]);
  return mergeBase === null ? undefined : { ref, mergeBase };
}

/** 検査の計画（表示する行と、重い検査・軽い検査） */
function planOf(options: AffectedCheckOptions, argv: string[]): { plan: string[]; heavy: CheckStep[]; ctx: CheckContext; covered: string } {
  const { globalFiles = [], testArgs = [], concurrency = 2 } = options;
  const all = argv.includes('--all');
  const base = all ? undefined : baseOf(argv);
  const changed = base === undefined ? [] : [...new Set([...lines(git(['diff', '--name-only', base.mergeBase])), ...lines(git(['ls-files', '--others', '--exclude-standard']))])];
  const dirs = workspaceDirs();
  const scriptsChanged = changed.some((f) => f.startsWith('scripts/'));
  // ルートの scripts/ を相対パスで import するパッケージ（apps/api/scripts など）は、scripts/ の変更で型の検査の結果に影響
  const importers = scriptsChanged && dirs.length > 0 ? lines(git(['grep', '-l', '-E', String.raw`from '(\.\./)+scripts/`, '--', ...dirs])) : [];
  const scope = base === undefined ? ({ full: true, reason: all ? '--all' : 'no base (origin/main or origin/dev/*)' } as const) : scopeOf(changed, dirs, importers, [...GLOBAL_FILES, ...globalFiles]);
  const vitest = (args: string[]): CheckStep => ({ name: 'test', command: 'pnpm', args: ['exec', 'vitest', 'run', '--passWithNoTests', ...args, ...testArgs] });
  const ctx: CheckContext = { base: base?.mergeBase, changed, full: scope.full };

  if (scope.full) return { plan: [`all (${scope.reason})`], heavy: [{ name: 'typecheck', command: 'pnpm', args: ['typecheck'] }, vitest([])], ctx, covered: 'all' };
  const sha = base!.mergeBase.slice(0, 7);
  const plan = [`base: ${base!.ref} (merge base ${sha}), ${changed.length} changed files`];
  const heavy: CheckStep[] = [];
  const names = scope.dirs.map(nameOf).sort();
  if (names.length > 0) {
    plan.push(`typecheck: ${names.join(', ')} and dependents`);
    heavy.push({ name: 'typecheck (packages)', command: 'pnpm', args: ['-r', '--if-present', `--workspace-concurrency=${concurrency}`, ...names.flatMap((n) => ['--filter', `...${n}`]), 'typecheck'] });
  }
  if (scope.root && existsSync('tsconfig.json')) {
    plan.push('typecheck: root (tsc)');
    heavy.push({ name: 'typecheck (root)', command: 'pnpm', args: ['exec', 'tsc'] });
  }
  if (heavy.length === 0) plan.push('typecheck: none');
  if (scope.tests) {
    plan.push(`test: related to changes (vitest --changed ${sha})`);
    heavy.push(vitest(['--changed', base!.mergeBase]));
  } else plan.push('test: none (Markdown only)');
  return { plan, heavy, ctx, covered: base!.ref };
}

const seconds = (from: number): string => `${((Date.now() - from) / 1000).toFixed(1)}s`;

/**
 * 起動するファイルと引数（pnpm は実行中の pnpm の npm_execpath から）
 * - .js・.cjs・.mjs は node で起動、.exe は直接、.cmd・.bat はシェル経由（単体の pnpm.exe を指す場合があるため）
 */
export function spawnTarget(command: string, args: string[], execpath = process.env.npm_execpath): { file: string; argv: string[]; shell: boolean } {
  if (command !== 'pnpm' || !execpath) return { file: command, argv: args, shell: false };
  if (/\.[cm]?js$/i.test(execpath)) return { file: process.execPath, argv: [execpath, ...args], shell: false };
  return { file: execpath, argv: args, shell: /\.(cmd|bat)$/i.test(execpath) };
}

function capture(command: string, args: string[]): Promise<{ status: number; output: string }> {
  const { file, argv, shell } = spawnTarget(command, args);
  return new Promise((resolve) => {
    const child = spawn(file, argv, { stdio: ['ignore', 'pipe', 'pipe'], shell });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (status) => resolve({ status: status ?? 1, output }));
    child.on('error', (error) => resolve({ status: 1, output: `${output}${error.message}\n` }));
  });
}

async function run(step: CheckStep): Promise<CheckResult> {
  const from = Date.now();
  const { status, output } = await capture(step.command, step.args);
  console.log(`\n${status === 0 ? '[ok]' : '[failed]'} ${step.name} (${seconds(from)})`);
  if (status !== 0) console.log(output.trimEnd());
  return { name: step.name, ok: status === 0, output };
}

/**
 * リポのルートで push の前の検査を実行し、結果を返す（終了コードは呼ぶ側が設定）
 * - 引数: `--all` ですべて、`--base <ref>` で基準を指定（省略時は origin/main と origin/dev/* のうち最も近いもの）
 * - 成功し、作業ツリーに変更がなければ HEAD の検査の記録を書く（check-record.ts）
 */
export async function runAffectedCheck(options: AffectedCheckOptions = {}, argv: string[] = process.argv.slice(2)): Promise<CheckResult[]> {
  const { plan, heavy, ctx, covered } = planOf(options, argv);
  const light = options.steps?.(ctx) ?? [];
  if (light.length > 0) plan.push(`${light.map((s) => s.name).join(', ')}: all`);
  console.log(['pnpm check', ...plan.map((p) => `- ${p}`)].join('\n'));
  const started = Date.now();
  const sequential = async (): Promise<CheckResult[]> => {
    const results: CheckResult[] = [];
    for (const step of heavy) results.push(await run(step));
    return results;
  };
  const [heavyResults, lightResults] = await Promise.all([sequential(), Promise.all(light.map(run))]);
  const results = [...heavyResults, ...lightResults];
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? 'all passed' : `${failed} check(s) failed`} (${seconds(started)})`);
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const head = git(['rev-parse', 'HEAD']);
  if (failed === 0 && commonDir && head && git(['status', '--porcelain']) === '') writeCheckRecord(commonDir, head, covered);
  return results;
}
