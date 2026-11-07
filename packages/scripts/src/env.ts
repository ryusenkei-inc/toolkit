// ルートの `.env` の CLI の核。配信先（`targets`）とリポ独自のコマンドは、各リポの `scripts/env.ts` から渡す
import type { SpawnSyncOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { exec } from './exec.ts';
import { currentRepo } from './repo.ts';

/** 配信先。`wrangler:secret:<worker>` は Worker の秘密値（`wrangler secret put --name <worker>`） */
export type Target = 'github:variable' | 'github:secret' | `wrangler:secret:${string}`;

export type EnvValues = Record<string, string | undefined>;

/** リポ独自のコマンドに渡す操作 */
export type EnvContext = {
  root: string;
  /** `.env` の値（未作成なら終了コード1で終了） */
  values: () => EnvValues;
  /** `.env` と `extra` を環境変数にしてコマンドを実行。`args` の先頭の `NAME=value` も環境変数 */
  run: (args: string[], extra?: EnvValues) => number;
};

export type EnvConfig = {
  /** リポのルート（`.env` の場所）。`new URL('..', import.meta.url)` など */
  root: string | URL;
  /** 変数ごとの配信先（配信しない変数は空配列） */
  targets: Record<string, Target[]>;
  /** リポ独自のサブコマンド（例: `tf`、`deploy`） */
  commands?: Record<string, (args: string[], ctx: EnvContext) => number | Promise<number>>;
};

const ASSIGN = /^[A-Z_][A-Z0-9_]*=/;

/** 先頭の `NAME=value` とコマンドに分ける（Windows の cmd は `NAME=value cmd` の書き方を解釈しない） */
export function splitAssignments(args: string[]): { env: EnvValues; command: string[] } {
  const start = args.findIndex((a) => !ASSIGN.test(a));
  const assigns = start === -1 ? args : args.slice(0, start);
  const env = Object.fromEntries(assigns.map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
  return { env, command: start === -1 ? [] : args.slice(start) };
}

/** 配信の計画。`only` は配信先の前方一致（例: `github:`、`wrangler:secret:api`） */
export function pushPlan(values: EnvValues, targets: Record<string, Target[]>, only?: string): { skips: string[]; items: { key: string; target: Target; value: string }[] } {
  const skips = Object.keys(values)
    .filter((k) => !(k in targets))
    .map((k) => `${k}: 配信先が未定義（scripts/env.ts の targets に追加）`);
  const items: { key: string; target: Target; value: string }[] = [];
  for (const [key, list] of Object.entries(targets)) {
    const chosen = list.filter((t) => only === undefined || t.startsWith(only));
    if (!chosen.length) continue;
    const value = values[key];
    if (!value) skips.push(`${key}: 値が未設定`);
    else for (const target of chosen) items.push({ key, target, value });
  }
  return { skips, items };
}

/** CLI を実行して終了。サブコマンドは `run`・`push` と `commands` */
export async function envCli(config: EnvConfig, argv = process.argv.slice(2)): Promise<never> {
  const root = typeof config.root === 'string' ? config.root : fileURLToPath(config.root);
  const envPath = join(root, '.env');
  const values = (): EnvValues => {
    if (!existsSync(envPath)) {
      console.error('.env が未作成（.env.example を複製して値を設定）');
      process.exit(1);
    }
    return parseEnv(readFileSync(envPath, 'utf8'));
  };
  const run = (args: string[], extra: EnvValues = {}): number => {
    const { env, command } = splitAssignments(args);
    const [cmd, ...rest] = command;
    if (!cmd) {
      console.error('usage: node scripts/env.ts run [NAME=value ...] <command> [...args]');
      return 1;
    }
    Object.assign(process.env, values(), extra, env);
    return exec(cmd, rest);
  };
  const ctx: EnvContext = { root, values, run };

  const push = (args: string[]): number => {
    const dryRun = args.includes('--dry-run');
    const at = args.indexOf('--only');
    const plan = pushPlan(values(), config.targets, at === -1 ? undefined : args[at + 1]);
    for (const skip of plan.skips) console.warn(`skip  ${skip}`);
    const repo = dryRun || !plan.items.some((i) => i.target.startsWith('github:')) ? '' : currentRepo(root);
    let failed = false;
    for (const { key, target, value } of plan.items) {
      console.log(`${dryRun ? 'plan' : 'push'}  ${key} → ${target}`);
      if (!dryRun && pushTo(root, repo, target, key, value) !== 0) failed = true;
    }
    return failed ? 1 : 0;
  };

  const commands: Record<string, (args: string[]) => number | Promise<number>> = {
    run: (args) => run(args),
    push,
    ...Object.fromEntries(Object.entries(config.commands ?? {}).map(([name, fn]) => [name, (args: string[]) => fn(args, ctx)])),
  };
  const [subcommand, ...rest] = argv;
  const handler = subcommand ? commands[subcommand] : undefined;
  if (!handler) {
    console.error(`usage: node scripts/env.ts <${Object.keys(commands).join('|')}> ...`);
    process.exit(1);
  }
  process.exit(await handler(rest));
}

// 値は標準入力で渡す（プロセスの引数に出さない）
function pushTo(root: string, repo: string, target: Target, key: string, value: string): number {
  const options: SpawnSyncOptions = { input: value, stdio: ['pipe', 'inherit', 'inherit'], cwd: root };
  if (target === 'github:variable' || target === 'github:secret') return exec('gh', [target === 'github:variable' ? 'variable' : 'secret', 'set', key, '--repo', repo], options);
  return exec('pnpm', ['exec', 'wrangler', 'secret', 'put', key, '--name', target.slice('wrangler:secret:'.length)], options);
}
