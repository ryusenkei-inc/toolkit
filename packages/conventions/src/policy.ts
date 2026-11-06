// PreToolUse で拒否するツールの実行
// - 判定は純粋な関数 → 外部の処理（タイトルの検査・ファイルの読み込み・git・gh）は `Context` で注入
// - 拒否の理由は Claude に返却 → Claude が修正して再実行
// - 対象のリポ・ブランチはコマンドから解決: `cd`・`git -C` の後はその git のルート、ブランチの切り替えの後はその先のブランチ
import { isAbsolute, join } from 'node:path';
import { commands, option } from './shell.ts';

/** PreToolUse の入力（使用する項目のみ） */
export type ToolUse = { tool_name: string; tool_input: Record<string, unknown>; cwd?: string };

/** PR のチェックの集計（`unknown` = 取得に失敗） */
export type Checks = 'pass' | 'pending' | 'fail' | 'none' | 'unknown';

/** 判定に必要な外部の処理 */
export type Context = {
  /** セッションのリポのルート（作業ディレクトリの git のルートが不明なときの判定の対象） */
  root: string;
  /** 作業ディレクトリの git のルート（git の外・取得の失敗時は `undefined`） */
  repoRoot: (cwd: string | undefined) => string | undefined;
  /** `cd` の移動先（`base` からの相対・`~` などを解決。解決できなければ `undefined`） */
  resolveDir: (base: string | undefined, dir: string) => string | undefined;
  /** PR のタイトルの指摘（なければ空配列） */
  titleIssues: (title: string, cwd: string | undefined) => string[];
  /** ファイルの内容（読み込みの失敗時は `undefined`） */
  readFile: (path: string) => string | undefined;
  /** 現在のブランチ（detached HEAD・取得の失敗時は `undefined`） */
  currentBranch: (cwd: string | undefined) => string | undefined;
  /** PR の head のブランチ（`pr` の省略時は現在のブランチの PR） */
  prHead: (pr: string | undefined, cwd: string | undefined) => string | undefined;
  /** PR の base のブランチ（`pr` の省略時は現在のブランチの PR） */
  prBase: (pr: string | undefined, cwd: string | undefined) => string | undefined;
  /** PR のチェックの集計（`pr` の省略時は現在のブランチの PR） */
  prChecks: (pr: string | undefined, cwd: string | undefined) => Checks;
};

const TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];
const BRANCH = new RegExp(`^(${TYPES.join('|')})/[a-z0-9][a-z0-9._-]*$`);
// epic のフローの統合ブランチ（`dev/<issue の番号>-<内容>`）
const DEV_BRANCH = /^dev\/\d+-[a-z0-9][a-z0-9._-]*$/;
const PROTECTED = ['main', 'master'];
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
// pnpm 以外のパッケージ管理の操作（`npm view`・`npm pack`・`npx` などの参照・実行は対象外）
const NPM_CHANGES = ['install', 'i', 'add', 'ci', 'uninstall', 'un', 'remove', 'rm', 'update', 'up', 'link'];
// AI の署名: trailer の値に AI の名前・生成元の表記（prose-lint のコミットの規則と同じ対象）
const AI_TRAILER = /^[\w-]+:.*\b(claude|anthropic|openai|chatgpt|gpt-\d|copilot|gemini|codex|cursor)\b/im;
const AI_NOTE = /generated (with|by) \[?(claude|chatgpt|copilot|gemini|codex|cursor)|🤖/i;
// `git branch` の作成以外の操作
const BRANCH_QUERY = ['-d', '-D', '--delete', '-l', '--list', '-a', '-r', '--all', '--remotes', '-v', '-vv', '--verbose', '--show-current', '--contains', '--no-contains', '--merged', '--no-merged', '-u', '--set-upstream-to', '--unset-upstream', '--edit-description'];
// 作業ツリー全体を対象にする pathspec
const ALL_PATHS = ['.', './', ':/', ':', '*'];
// 値を取るオプション（位置引数・短いオプションの束の判定で値を除外）
const COMMIT_VALUE_SHORT = 'mFCctS';
const ADD_VALUE = ['--chmod', '--pathspec-from-file'];
const PUSH_VALUE = ['-o', '--push-option', '--repo', '--receive-pack', '--exec'];
const MERGE_VALUE = ['-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '--match-head-commit', '-R', '--repo'];
const EDIT_VALUE = ['-t', '--title', '-b', '--body', '-F', '--body-file', '-B', '--base', '-m', '--milestone', '-R', '--repo', '--add-assignee', '--remove-assignee', '--add-label', '--remove-label', '--add-project', '--remove-project', '--add-reviewer', '--remove-reviewer'];

const ASK_USER = '必要な場合はユーザーに実行を依頼';
const BULK_STAGING = '一括の add（`git add -A`・`.`・`-u`、`git commit -a`）は禁止。変更・追加したファイルをパスで指定して add（`git status --short` で確認）';
const BRANCH_RULE = `\`<type>/<内容>\`（type = ${TYPES.join('・')}、内容 = 英小文字・数字・\`-\`）`;
const CHECKS_REASON: Record<Exclude<Checks, 'pass'>, string> = {
  pending: 'CI が実行中。全チェックの成功を確認してからマージ（`gh pr checks --watch`）',
  fail: 'CI が失敗。修正して全チェックが成功してからマージ',
  none: 'PR にチェックがない。CI の成功を確認できない PR はマージしない',
  unknown: 'CI の結果を取得できない（`gh pr checks` が失敗）。全チェックの成功を確認してからマージ',
};

// コマンドの列を順に評価するときの状態
// - `branch`: 同じコマンドの列で切り替えたブランチ（`undefined` = 実行前の現在のブランチ）
type State = { cwd: string | undefined; branch?: string };

/** 拒否の理由（許可する場合は `undefined`） */
export function denyReason(use: ToolUse, ctx: Context): string | undefined {
  if (EDIT_TOOLS.includes(use.tool_name)) {
    const path = String(use.tool_input.file_path ?? use.tool_input.notebook_path ?? '');
    if (/(^|[\\/])node_modules[\\/]/.test(path)) return '`node_modules` は直接編集しない。`@ryusenkei/*` の変更は toolkit のリポで実施';
    return undefined;
  }
  if (use.tool_name !== 'Bash') return undefined;
  const st: State = { cwd: use.cwd };
  const reasons = commands(String(use.tool_input.command ?? '')).flatMap((words) => commandReasons(words, st, ctx));
  return reasons.length ? reasons.join('\n') : undefined;
}

// 判定の後に、`cd`・ブランチの切り替えを状態に反映
function commandReasons(words: string[], st: State, ctx: Context): string[] {
  const [cmd, ...args] = words;
  if (cmd === 'cd' || cmd === 'pushd') {
    const dir = args.find((a) => !a.startsWith('-'));
    const next = dir === undefined ? undefined : ctx.resolveDir(st.cwd, dir);
    if (next !== undefined && next !== st.cwd) Object.assign(st, { cwd: next, branch: undefined });
    return [];
  }
  if (cmd === 'yarn' || (cmd === 'npm' && NPM_CHANGES.includes(args[0] ?? ''))) return ['パッケージ管理は pnpm のみ（`pnpm add`・`pnpm install` など）'];
  if (cmd === 'git') {
    const { dir, rest } = gitArgs(args);
    // `git -C <path>` はその場所の git で判定し、切り替えは状態に反映しない
    const target: State = dir === undefined ? st : { cwd: ctx.resolveDir(st.cwd, dir) ?? st.cwd };
    const reasons = gitReasons(rest, target, ctx);
    const branch = dir === undefined ? switchedBranch(rest[0], rest.slice(1)) : undefined;
    if (branch !== undefined) st.branch = branch;
    return reasons;
  }
  if (cmd === 'gh' && args[0] === 'pr') return prReasons(args[1], args.slice(2), st, ctx);
  return [];
}

const branchOf = (st: State, ctx: Context) => st.branch ?? ctx.currentBranch(st.cwd);

// epic のフローの opt-in: 対象のリポのルートの `package.json` の `"ryusenkei": { "flow": "epic" }`
function epicFlow(st: State, ctx: Context): boolean {
  const raw = ctx.readFile(join(ctx.repoRoot(st.cwd) ?? ctx.root, 'package.json'));
  if (raw === undefined) return false;
  try {
    return (JSON.parse(raw) as { ryusenkei?: { flow?: unknown } }).ryusenkei?.flow === 'epic';
  } catch {
    return false;
  }
}

// git の全体のオプション（`-C <path>`・`-c <name=value>` など）を除去
// - `dir`: `-C` の場所（複数あれば git と同じく前から順に連結）
function gitArgs(args: string[]): { dir: string | undefined; rest: string[] } {
  let i = 0;
  let dir: string | undefined;
  while (i < args.length && args[i]!.startsWith('-')) {
    const value = args[i + 1];
    if (args[i] === '-C' && value !== undefined) dir = dir === undefined || isAbsolute(value) ? value : join(dir, value);
    i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
  }
  return { dir, rest: args.slice(i) };
}

// 切り替え先のブランチ（`git switch`・`git checkout`）
// - `git checkout <path>` と区別できない形（`--` を含む・位置引数が2つ以上）は対象外
function switchedBranch(sub: string | undefined, args: string[]): string | undefined {
  if (sub !== 'switch' && sub !== 'checkout') return undefined;
  const created = sub === 'switch' ? option(args, ['-c', '-C', '--create', '--force-create']) : option(args, ['-b', '-B']);
  if (created !== undefined) return created;
  if (args.includes('--') || args.includes('--detach') || args.includes('-d')) return undefined;
  const names = args.filter((a) => !a.startsWith('-'));
  return names.length === 1 && names[0] !== '-' ? names[0] : undefined;
}

// 位置引数（`--` 以降はすべて位置引数）
function positionals(args: string[], valued: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') return [...out, ...args.slice(i + 1)];
    if (valued.includes(a)) i++;
    else if (!a.startsWith('-')) out.push(a);
  }
  return out;
}

// 短いオプションの束（`-am` など）の `flag` の有無
// - `valued` の文字の後ろは値
function hasShort(args: string[], flag: string, valued = ''): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') return false;
    if (!/^-[a-zA-Z]/.test(a)) continue;
    for (const c of a.slice(1)) {
      if (c === flag) return true;
      if (valued.includes(c)) {
        if (a.endsWith(c)) i++;
        break;
      }
    }
  }
  return false;
}

function gitReasons([sub, ...args]: string[], st: State, ctx: Context): string[] {
  if ((sub === 'commit' || sub === 'push') && args.includes('--no-verify')) return ['フックの省略（`--no-verify`）は禁止'];
  // `git commit -n` = `--no-verify`（`git push -n` は dry run）
  if (sub === 'commit' && hasShort(args, 'n', COMMIT_VALUE_SHORT)) return ['フックの省略（`-n`）は禁止'];
  if (sub === 'commit' && (args.includes('--all') || hasShort(args, 'a', COMMIT_VALUE_SHORT))) return [BULK_STAGING];
  if (sub === 'add' && bulkAdd(args)) return [BULK_STAGING];
  if (sub === 'push') return pushReasons(args, st, ctx);
  const name = newBranch(sub, args);
  if (name === undefined || BRANCH.test(name)) return [];
  if (!epicFlow(st, ctx)) return [`ブランチ名は ${BRANCH_RULE}: \`${name}\``];
  if (DEV_BRANCH.test(name)) return [];
  return [`ブランチ名は ${BRANCH_RULE}、epic は \`dev/<issue の番号>-<内容>\`: \`${name}\``];
}

function bulkAdd(args: string[]): boolean {
  if (args.some((a) => a === '--all' || a === '--update')) return true;
  if (args.some((a) => /^-[a-zA-Z]*[Au][a-zA-Z]*$/.test(a))) return true;
  return positionals(args, ADD_VALUE).some((p) => ALL_PATHS.includes(p));
}

// main・master への force push を拒否
function pushReasons(args: string[], st: State, ctx: Context): string[] {
  const forceAll = args.some((a) => a === '--force' || a.startsWith('--force-with-lease')) || hasShort(args, 'f', 'o');
  if (args.includes('--all') || args.includes('--mirror')) return forceAll ? [`\`--all\`・\`--mirror\` の force push は禁止（${PROTECTED.join('・')} を含む）。${ASK_USER}`] : [];
  const [, ...refspecs] = positionals(args, PUSH_VALUE);
  const targets = refspecs.length
    ? refspecs.map((r) => ({ force: forceAll || r.startsWith('+'), branch: pushTarget(r.replace(/^\+/, ''), st, ctx) }))
    : [{ force: forceAll, branch: branchOf(st, ctx) }];
  const hit = targets.find((t) => t.force && t.branch !== undefined && PROTECTED.includes(t.branch));
  return hit ? [`\`${hit.branch}\` への force push は禁止。${ASK_USER}`] : [];
}

function pushTarget(refspec: string, st: State, ctx: Context): string | undefined {
  const dst = refspec.includes(':') ? refspec.slice(refspec.indexOf(':') + 1) : refspec;
  const name = dst.replace(/^refs\/heads\//, '');
  return name === 'HEAD' ? branchOf(st, ctx) : name;
}

// 作成・リネームするブランチの名前
function newBranch(sub: string | undefined, args: string[]): string | undefined {
  const positionals = args.filter((a) => !a.startsWith('-'));
  switch (sub) {
    case 'switch':
      return option(args, ['-c', '-C', '--create', '--force-create']);
    case 'checkout':
      return option(args, ['-b', '-B']);
    case 'worktree':
      return args[0] === 'add' ? option(args, ['-b', '-B']) : undefined;
    case 'branch':
      if (args.some((a) => BRANCH_QUERY.includes(a))) return undefined;
      if (args.some((a) => ['-m', '-M', '--move', '-c', '-C', '--copy'].includes(a))) return positionals.at(-1);
      return positionals[0];
    default:
      return undefined;
  }
}

function prReasons(sub: string | undefined, args: string[], st: State, ctx: Context): string[] {
  const { cwd } = st;
  if (sub === 'merge') return mergeReasons(args, st, ctx);
  if (sub !== 'create' && sub !== 'edit') return [];
  const reasons: string[] = [];
  const title = option(args, ['--title', '-t']);
  if (title === undefined && sub === 'create') reasons.push('PR のタイトルを `--title` で指定（`main` のコミットのメッセージになるため検査）');
  if (title !== undefined) reasons.push(...ctx.titleIssues(title, cwd).map((i) => `PR のタイトル: ${i}`));
  const file = option(args, ['--body-file', '-F']);
  const body = [option(args, ['--body', '-b']), file && file !== '-' ? ctx.readFile(isAbsolute(file) || !cwd ? file : join(cwd, file)) : undefined].join('\n');
  if (AI_TRAILER.test(body) || AI_NOTE.test(body)) reasons.push('PR の本文に AI の署名を付けない');
  if (epicFlow(st, ctx)) reasons.push(...epicReasons(sub, args, st, ctx));
  return reasons;
}

// `--auto` も対象（必須のチェックがないリポでは即時にマージされる）
// - epic のフローの dev/* への PR: チェックなしを許可（CI を実行せず pre-push の `pnpm check` が関門）
function mergeReasons(args: string[], st: State, ctx: Context): string[] {
  const { cwd } = st;
  if (args.some((a) => a === '--merge' || a === '--rebase' || a === '-m' || a === '-r')) return ['マージは squash のみ（`--squash`）'];
  const pr = positionals(args, MERGE_VALUE)[0];
  const checks = ctx.prChecks(pr, cwd);
  if (checks === 'pass') return [];
  if (checks === 'none' && epicFlow(st, ctx)) {
    const base = ctx.prBase(pr, cwd);
    if (base !== undefined && DEV_BRANCH.test(base)) return [];
  }
  return [CHECKS_REASON[checks]];
}

// epic のフロー: main への PR は dev/* から、それ以外のブランチの PR は dev/* へ
// - `gh pr create` の base の省略 = main（既定のブランチ）
// - `gh pr edit` は base を変更する場合のみ
function epicReasons(sub: 'create' | 'edit', args: string[], st: State, ctx: Context): string[] {
  const explicit = option(args, ['--base', '-B']);
  if (sub === 'edit' && explicit === undefined) return [];
  const base = explicit ?? 'main';
  const head = sub === 'create' ? (option(args, ['--head', '-H'])?.replace(/^.*:/, '') ?? branchOf(st, ctx)) : ctx.prHead(positionals(args, EDIT_VALUE)[0], st.cwd);
  if (head !== undefined && DEV_BRANCH.test(head)) return [];
  if (PROTECTED.includes(base)) return [`\`${base}\` への PR は epic の \`dev/<issue の番号>-<内容>\` からのみ（デプロイのとき）。sub-issue の PR は \`--base dev/...\` で epic のブランチへ`];
  if (!DEV_BRANCH.test(base)) return [`PR の base は epic の \`dev/<issue の番号>-<内容>\`: \`${base}\``];
  return [];
}
