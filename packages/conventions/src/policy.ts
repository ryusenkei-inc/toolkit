// PreToolUse で拒否するツールの実行
// - 判定は純粋な関数 → 外部の処理（タイトルの検査・ファイルの読み込み）は `Context` で注入
// - 拒否の理由は Claude に返却 → Claude が修正して再実行
import { isAbsolute, join } from 'node:path';
import { commands, option } from './shell.ts';

/** PreToolUse の入力（使用する項目のみ） */
export type ToolUse = { tool_name: string; tool_input: Record<string, unknown>; cwd?: string };

/** 判定に必要な外部の処理 */
export type Context = {
  /** PR のタイトルの指摘（なければ空配列） */
  titleIssues: (title: string) => string[];
  /** ファイルの内容（読み込みの失敗時は `undefined`） */
  readFile: (path: string) => string | undefined;
};

const TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];
const BRANCH = new RegExp(`^(${TYPES.join('|')})/[a-z0-9][a-z0-9._-]*$`);
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
// pnpm 以外のパッケージ管理の操作（`npm view`・`npm pack`・`npx` などの参照・実行は対象外）
const NPM_CHANGES = ['install', 'i', 'add', 'ci', 'uninstall', 'un', 'remove', 'rm', 'update', 'up', 'link'];
// AI の署名: trailer の値に AI の名前・生成元の表記（prose-lint のコミットの規則と同じ対象）
const AI_TRAILER = /^[\w-]+:.*\b(claude|anthropic|openai|chatgpt|gpt-\d|copilot|gemini|codex|cursor)\b/im;
const AI_NOTE = /generated (with|by) \[?(claude|chatgpt|copilot|gemini|codex|cursor)|🤖/i;
// `git branch` の作成以外の操作
const BRANCH_QUERY = ['-d', '-D', '--delete', '-l', '--list', '-a', '-r', '--all', '--remotes', '-v', '-vv', '--verbose', '--show-current', '--contains', '--no-contains', '--merged', '--no-merged', '-u', '--set-upstream-to', '--unset-upstream', '--edit-description'];

/** 拒否の理由（許可する場合は `undefined`） */
export function denyReason(use: ToolUse, ctx: Context): string | undefined {
  if (EDIT_TOOLS.includes(use.tool_name)) {
    const path = String(use.tool_input.file_path ?? use.tool_input.notebook_path ?? '');
    if (/(^|[\\/])node_modules[\\/]/.test(path)) return '`node_modules` は直接編集しない。`@ryusenkei/*` の変更は toolkit のリポで実施';
    return undefined;
  }
  if (use.tool_name !== 'Bash') return undefined;
  const reasons = commands(String(use.tool_input.command ?? '')).flatMap((words) => commandReasons(words, use.cwd, ctx));
  return reasons.length ? reasons.join('\n') : undefined;
}

function commandReasons(words: string[], cwd: string | undefined, ctx: Context): string[] {
  const [cmd, ...args] = words;
  if (cmd === 'yarn' || (cmd === 'npm' && NPM_CHANGES.includes(args[0] ?? ''))) return ['パッケージ管理は pnpm のみ（`pnpm add`・`pnpm install` など）'];
  if (cmd === 'git') return gitReasons(gitArgs(args));
  if (cmd === 'gh' && args[0] === 'pr') return prReasons(args[1], args.slice(2), cwd, ctx);
  return [];
}

// git の全体のオプション（`-C <path>`・`-c <name=value>` など）を除去
function gitArgs(args: string[]): string[] {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
  return args.slice(i);
}

function gitReasons([sub, ...args]: string[]): string[] {
  if ((sub === 'commit' || sub === 'push') && args.includes('--no-verify')) return ['フックの省略（`--no-verify`）は禁止'];
  // `git commit -n` = `--no-verify`（`git push -n` は dry run）
  if (sub === 'commit' && args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a))) return ['フックの省略（`-n`）は禁止'];
  const name = newBranch(sub, args);
  if (name !== undefined && !BRANCH.test(name)) return [`ブランチ名は \`<type>/<内容>\`（type = ${TYPES.join('・')}、内容 = 英小文字・数字・\`-\`）: \`${name}\``];
  return [];
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

function prReasons(sub: string | undefined, args: string[], cwd: string | undefined, ctx: Context): string[] {
  if (sub === 'merge' && args.some((a) => a === '--merge' || a === '--rebase' || a === '-m' || a === '-r')) return ['マージは squash のみ（`--squash`）'];
  if (sub !== 'create' && sub !== 'edit') return [];
  const reasons: string[] = [];
  const title = option(args, ['--title', '-t']);
  if (title === undefined && sub === 'create') reasons.push('PR のタイトルを `--title` で指定（`main` のコミットのメッセージになるため検査）');
  if (title !== undefined) reasons.push(...ctx.titleIssues(title).map((i) => `PR のタイトル: ${i}`));
  const file = option(args, ['--body-file', '-F']);
  const body = [option(args, ['--body', '-b']), file && file !== '-' ? ctx.readFile(isAbsolute(file) || !cwd ? file : join(cwd, file)) : undefined].join('\n');
  if (AI_TRAILER.test(body) || AI_NOTE.test(body)) reasons.push('PR の本文に AI の署名を付けない');
  return reasons;
}
