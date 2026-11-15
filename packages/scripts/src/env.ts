// ルートの `.env` の CLI の核。配信先（`targets`）とリポ独自のコマンドは、各リポの `scripts/env.ts` から渡す
import type { SpawnSyncOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { DRIFT_LABELS, driftStateOf, fingerprintOf, isDrift, newFingerprintRecord, parseFingerprintRecord, type FingerprintRecord, type RemoteState } from './env-drift.ts';
import { execOutputSync, execSync } from './exec.ts';
import { currentRepo } from './repo.ts';
import { backendConfigArgs, r2CredentialsOf, s3CredentialsEnv, stackOf, stateKeyOf, type TerraformConfig } from './terraform.ts';

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
  /** リポ独自のサブコマンド（例: `deploy`） */
  commands?: Record<string, (args: string[], ctx: EnvContext) => number | Promise<number>>;
  /** 指定すると `tf` のサブコマンドを足す（Terraform 用のトークン、R2 の state の認証と backend の設定） */
  terraform?: TerraformConfig;
  /** 配信した値の指紋を残す GitHub の variable（既定は `ENV_FINGERPRINTS`）。`check` が `.env` と比べる。`false` で残さない */
  fingerprints?: false | { variable?: string };
};

const ASSIGN = /^[A-Z_][A-Z0-9_]*=/;
const NAME = /^[A-Z_][A-Z0-9_]*$/;

/** 先頭の `NAME=value` とコマンドに分ける（Windows の cmd は `NAME=value cmd` の書き方を解釈しない） */
export function splitAssignments(args: string[]): { env: EnvValues; command: string[] } {
  const start = args.findIndex((a) => !ASSIGN.test(a));
  const assigns = start === -1 ? args : args.slice(0, start);
  const env = Object.fromEntries(assigns.map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
  return { env, command: start === -1 ? [] : args.slice(start) };
}

/** `--only` の値を変数名（`NAME` の形）と配信先の接頭辞（それ以外、例: `github:`）に分ける */
export function parseOnly(only: string | readonly string[] = []): { names: string[]; prefixes: string[] } {
  const list = typeof only === 'string' ? [only] : [...only];
  return { names: list.filter((o) => NAME.test(o)), prefixes: list.filter((o) => !NAME.test(o)) };
}

/** 選んだ変数と配信先の組。`only` は変数名か配信先の接頭辞（`parseOnly`） */
export function selectTargets(targets: Record<string, Target[]>, only?: string | readonly string[]): { key: string; target: Target }[] {
  const { names, prefixes } = parseOnly(only);
  return Object.entries(targets)
    .filter(([key]) => !names.length || names.includes(key))
    .flatMap(([key, list]) => list.filter((t) => !prefixes.length || prefixes.some((p) => t.startsWith(p))).map((target) => ({ key, target })));
}

/**
 * 配信の計画
 * - `only` は変数名（例: `LINE_TOKEN`）か配信先の接頭辞（例: `github:`、`wrangler:secret:api`）
 * - 変数名どうし・接頭辞どうしはいずれか、両方を渡すと両方に合うもの
 * - 変数名を渡したときは、targets にない `.env` の変数を警告しない
 */
export function pushPlan(values: EnvValues, targets: Record<string, Target[]>, only?: string | readonly string[]): { skips: string[]; items: { key: string; target: Target; value: string }[] } {
  const skips = parseOnly(only).names.length
    ? []
    : Object.keys(values)
        .filter((k) => !(k in targets))
        .map((k) => `${k}: 配信先が未定義（scripts/env.ts の targets に追加）`);
  const items: { key: string; target: Target; value: string }[] = [];
  const empty = new Set<string>();
  for (const { key, target } of selectTargets(targets, only)) {
    const value = values[key];
    if (value) items.push({ key, target, value });
    else empty.add(key);
  }
  for (const key of empty) skips.push(`${key}: 値が未設定`);
  return { skips, items };
}

/** 読む `.env`。`from` は作業ツリーのルートのものか、本体のチェックアウトのものか */
export type EnvFile = { path: string; from: 'worktree' | 'main' };

const gitCommonDirOf = (cwd: string): string | null => execOutputSync('git', ['rev-parse', '--git-common-dir'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * 読む `.env` を探す。見つからなければ `undefined`
 * - `root` の `.env` があればそれ
 * - なければ `git rev-parse --git-common-dir` から本体のチェックアウトのルートを求め、その `.env`（git worktree には `.env` がない）
 */
export function findEnvFile(root: string, gitCommonDir: (cwd: string) => string | null = gitCommonDirOf): EnvFile | undefined {
  const own = join(root, '.env');
  if (existsSync(own)) return { path: own, from: 'worktree' };
  const common = gitCommonDir(root);
  // 本体の `.git` のときだけ（bare のリポには作業ツリーがない）
  if (!common || basename(common) !== '.git') return undefined;
  const main = resolve(root, common, '..');
  const path = join(main, '.env');
  return main !== resolve(root) && existsSync(path) ? { path, from: 'main' } : undefined;
}

/** `--only <値>`・`--only=<値>`（複数可）と、ほかの引数 */
export function onlyArgs(args: readonly string[]): { only: string[]; rest: string[] } {
  const only: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--only' && i + 1 < args.length) only.push(args[++i]!);
    else if (arg.startsWith('--only=')) only.push(arg.slice('--only='.length));
    else rest.push(arg);
  }
  return { only, rest };
}

/**
 * CLI を実行して終了。サブコマンドは `run`・`push`・`check` と `commands`
 * - 終了の状態: 成功は0、失敗は1（サブコマンドの値）、使い方の誤りは2。`--help` は使い方を表示して0
 */
export async function envCli(config: EnvConfig, argv = process.argv.slice(2)): Promise<never> {
  const root = typeof config.root === 'string' ? config.root : fileURLToPath(config.root);
  let envFile: EnvFile | undefined;
  const values = (): EnvValues => {
    if (!envFile) {
      envFile = findEnvFile(root);
      if (!envFile) {
        console.error('.env が未作成（.env.example を複製して値を設定）');
        process.exit(1);
      }
      // 標準出力は run のコマンドが使うので、標準エラーに出す
      console.error(`env  ${envFile.path}（${envFile.from === 'worktree' ? '作業ツリー' : '本体のチェックアウト'}）`);
    }
    return parseEnv(readFileSync(envFile.path, 'utf8'));
  };
  const run = (args: string[], extra: EnvValues = {}): number => {
    const { env, command } = splitAssignments(args);
    const [cmd, ...rest] = command;
    if (!cmd) {
      console.error('usage: node scripts/env.ts run [NAME=value ...] <command> [...args]');
      return 2;
    }
    Object.assign(process.env, values(), extra, env);
    return execSync(cmd, rest);
  };
  const ctx: EnvContext = { root, values, run };
  const fingerprintVar = config.fingerprints === false ? undefined : (config.fingerprints?.variable ?? 'ENV_FINGERPRINTS');

  // `--only` の変数名が targets にあるか（打ち間違いで何も送らずに終わらないように）
  const unknownNames = (only: string[]): boolean => {
    const unknown = parseOnly(only).names.filter((n) => !(n in config.targets));
    for (const name of unknown) console.error(`${name}: targets にない変数（scripts/env.ts の targets を確認）`);
    return unknown.length > 0;
  };

  const push = (args: string[]): number => {
    const { only, rest } = onlyArgs(args);
    if (unknownNames(only)) return 2;
    const plan = pushPlan(values(), config.targets, only);
    for (const skip of plan.skips) console.warn(`skip  ${skip}`);
    if (rest.includes('--dry-run')) {
      for (const { key, target } of plan.items) console.log(`plan  ${key} → ${target}`);
      return 0;
    }
    const toGithub = plan.items.some((i) => i.target.startsWith('github:'));
    const recordable = fingerprintVar !== undefined && plan.items.some((i) => i.target !== 'github:variable');
    // GitHub に送らないとき（Worker だけ）は、リポが分からなくても配信は続ける（指紋を記録しないだけ）
    const repo = toGithub || recordable ? repoOf(root, !toGithub) : '';
    if (toGithub && !repo) return 1;
    let failed = false;
    const pushed: { key: string; target: Target; value: string }[] = [];
    for (const item of plan.items) {
      console.log(`push  ${item.key} → ${item.target}`);
      if (pushTo(root, repo, item.target, item.key, item.value) !== 0) failed = true;
      else if (item.target !== 'github:variable') pushed.push(item);
    }
    if (fingerprintVar && repo && pushed.length) recordFingerprints(root, repo, fingerprintVar, pushed);
    return failed ? 1 : 0;
  };

  // 本番の値・指紋と `.env` を比べる。値はどこにも出さない
  const check = (args: string[]): number => {
    const { only } = onlyArgs(args);
    if (unknownNames(only)) return 2;
    const env = values();
    const selected = selectTargets(config.targets, only);
    if (!selected.length) return 0;
    const repo = repoOf(root, false);
    if (!repo) return 1;
    const variables = githubVariables(root, repo);
    if (!variables) return 1;
    const record = (fingerprintVar && parseFingerprintRecord(variables.get(fingerprintVar))) || newFingerprintRecord();
    if (fingerprintVar && !variables.has(fingerprintVar) && selected.some((s) => s.target !== 'github:variable')) {
      console.warn(`指紋の記録（GitHub の variable ${fingerprintVar}）がない。秘密値は本番にあるかだけを確かめる`);
    }
    const names = new Map<Target, Set<string> | null>();
    const namesOf = (target: Target): Set<string> | null => {
      if (!names.has(target)) names.set(target, target === 'github:variable' ? new Set(variables.keys()) : remoteNames(root, repo, target));
      return names.get(target)!;
    };
    let drift = false;
    for (const { key, target } of selected) {
      const list = namesOf(target);
      if (!list) {
        console.log(`取得できない  ${key} → ${target}`);
        drift = true;
        continue;
      }
      const remote: RemoteState = { exists: list.has(key), ...(target === 'github:variable' ? { value: variables.get(key) } : { fingerprint: record.targets[target]?.[key] }) };
      const state = driftStateOf(key, env[key], remote, record.salt);
      if (state === 'absent') continue;
      if (isDrift(state)) drift = true;
      console.log(`${DRIFT_LABELS[state]}  ${key} → ${target}`);
    }
    return drift ? 1 : 0;
  };

  // terraform を Terraform 用のトークンで実行する。init には backend の設定を足す
  const tf = async (args: string[]): Promise<number> => {
    const tfConfig = config.terraform!;
    const env = values();
    const tokenVar = tfConfig.tokenVar ?? 'CF_TERRAFORM_TOKEN';
    const token = env[tokenVar];
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !accountId) {
      console.error(`${!token ? tokenVar : 'CLOUDFLARE_ACCOUNT_ID'} が未設定（.env に設定）`);
      return 1;
    }
    const extra: EnvValues = { CLOUDFLARE_API_TOKEN: token, AWS_ENDPOINT_URL_S3: env.AWS_ENDPOINT_URL_S3 ?? `https://${accountId}.r2.cloudflarestorage.com` };
    if (!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)) {
      const credentials = await r2CredentialsOf(token, accountId);
      if (credentials) Object.assign(extra, s3CredentialsEnv(credentials));
      else console.warn('R2 の認証をトークンから導出できない（.env に AWS_ACCESS_KEY_ID・AWS_SECRET_ACCESS_KEY を設定）');
    }
    const stack = stackOf(args);
    const withBackend = stack.subcommand === 'init' ? [...args.slice(0, stack.index + 1), ...backendConfigArgs(tfConfig.stateBucket, stateKeyOf(tfConfig.stateKeyPrefix, stack.dir, process.cwd())), ...args.slice(stack.index + 1)] : args;
    return run(['terraform', ...withBackend], extra);
  };

  const commands: Record<string, (args: string[]) => number | Promise<number>> = {
    run: (args) => run(args),
    push,
    check,
    ...(config.terraform && { tf }),
    ...Object.fromEntries(Object.entries(config.commands ?? {}).map(([name, fn]) => [name, (args: string[]) => fn(args, ctx)])),
  };
  const [subcommand, ...rest] = argv;
  const usage = `usage: node scripts/env.ts <${Object.keys(commands).join('|')}> ...
  push [--dry-run] [--only <NAME|target prefix>]...
  check [--only <NAME|target prefix>]...`;
  if (subcommand === '--help' || subcommand === '-h') {
    console.log(usage);
    process.exit(0);
  }
  const handler = subcommand ? commands[subcommand] : undefined;
  if (!handler) {
    console.error(usage);
    process.exit(2);
  }
  process.exit(await handler(rest));
}

// 値は標準入力で渡す（プロセスの引数に出さない）
function pushTo(root: string, repo: string, target: Target, key: string, value: string): number {
  const options: SpawnSyncOptions = { input: value, stdio: ['pipe', 'inherit', 'inherit'], cwd: root };
  if (target === 'github:variable' || target === 'github:secret') return execSync('gh', [target === 'github:variable' ? 'variable' : 'secret', 'set', key, '--repo', repo], options);
  return execSync('pnpm', ['exec', 'wrangler', 'secret', 'put', key, '--name', target.slice('wrangler:secret:'.length)], options);
}

// GitHub のリポ。`optional` は GitHub に送らないとき（指紋の記録だけに使う）で、失敗は警告にとどめる
function repoOf(root: string, optional: boolean): string {
  try {
    return currentRepo({ cwd: root });
  } catch {
    if (optional) console.warn('GitHub のリポが分からないので指紋を記録しない（gh にログインすると記録する）');
    else console.error('GitHub のリポが分からない（gh にログインして実行）');
    return '';
  }
}

// GitHub の variable の名前 → 値（失敗は null）
function githubVariables(root: string, repo: string): Map<string, string> | null {
  const out = execOutputSync('gh', ['variable', 'list', '--repo', repo, '--json', 'name,value'], { cwd: root });
  if (out === null) return null;
  return new Map((JSON.parse(out || '[]') as { name: string; value: string }[]).map((v) => [v.name, v.value]));
}

// 秘密値の名前の一覧（値は読めない）。失敗は null
function remoteNames(root: string, repo: string, target: Target): Set<string> | null {
  const out =
    target === 'github:secret'
      ? execOutputSync('gh', ['secret', 'list', '--repo', repo, '--json', 'name'], { cwd: root })
      : execOutputSync('pnpm', ['exec', 'wrangler', 'secret', 'list', '--name', target.slice('wrangler:secret:'.length), '--format', 'json'], { cwd: root });
  if (out === null) return null;
  try {
    return new Set((JSON.parse(out.slice(Math.max(0, out.indexOf('['))) || '[]') as { name: string }[]).map((s) => s.name));
  } catch {
    return null;
  }
}

// 配信した値の指紋を記録に足す。失敗は警告にとどめる（配信は済んでいる）
function recordFingerprints(root: string, repo: string, variable: string, pushed: { key: string; target: Target; value: string }[]): void {
  const variables = githubVariables(root, repo);
  if (!variables) {
    console.warn(`指紋を記録できない（GitHub の variable ${variable} を読めない）`);
    return;
  }
  const record: FingerprintRecord = parseFingerprintRecord(variables.get(variable)) ?? newFingerprintRecord();
  for (const { key, target, value } of pushed) (record.targets[target] ??= {})[key] = fingerprintOf(key, value, record.salt);
  const status = execSync('gh', ['variable', 'set', variable, '--repo', repo], { input: JSON.stringify(record), stdio: ['pipe', 'ignore', 'inherit'], cwd: root });
  if (status === 0) console.log(`record  指紋 → GitHub の variable ${variable}`);
  else console.warn(`指紋を記録できない（GitHub の variable ${variable} に書けない）`);
}
