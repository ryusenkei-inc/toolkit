#!/usr/bin/env node
// Claude Code の hook（`.claude/settings.json` から `node` で直接実行）
// - PreToolUse: 規約に反するツールの実行を拒否 → 終了コード2・理由は stderr
// - Stop: 変更があれば `pnpm lint`・`pnpm test` を実行し、失敗時は完了を差し戻し
// - hook 自体の失敗は終了コード1（拒否にしない → 作業を継続）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { denyReason, type Checks, type ToolUse } from './policy.ts';

type Input = ToolUse & { hook_event_name: string; stop_hook_active?: boolean };

const input = JSON.parse(readFileSync(0, 'utf8')) as Input;
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
// Windows の `pnpm` は `.cmd` → シェル経由でのみ起動可能
const shell = process.platform === 'win32';

if (input.hook_event_name === 'PreToolUse') {
  const reason = denyReason(input, { root, repoRoot, resolveDir, titleIssues, readFile, currentBranch, prHead, prBase, hasPrWorkflow, prChecks });
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
} else if (input.hook_event_name === 'Stop') {
  stop();
}

// PR のタイトル = squash のコミットのメッセージ → prose-lint のコミットの規則で検査（対象のリポの `prose-lint.json` を反映）
function titleIssues(title: string, cwd: string | undefined): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'conventions-'));
  try {
    const file = join(dir, 'title');
    writeFileSync(file, `${title}\n`);
    const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@ryusenkei/prose-lint')));
    const r = spawnSync(process.execPath, [cli, '--commit-msg', file], { cwd: repoRoot(cwd) ?? root, encoding: 'utf8' });
    return r.status === 0 ? [] : [`${r.stdout}${r.stderr}`.trim()];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function repoRoot(cwd: string | undefined): string | undefined {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: cwd ?? root, encoding: 'utf8' });
  return (r.status === 0 && r.stdout.trim()) || undefined;
}

// 変数・コマンド置換・`cd -` は解決しない
// Git Bash の `/c/...` は Windows のパス `C:/...` に変換
function resolveDir(base: string | undefined, dir: string): string | undefined {
  if (dir === '-' || /[$`]/.test(dir)) return undefined;
  const home = dir === '~' || dir.startsWith('~/') ? join(homedir(), dir.slice(1)) : dir;
  const native = process.platform === 'win32' ? home.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : home;
  return isAbsolute(native) ? resolve(native) : resolve(base ?? root, native);
}

function currentBranch(cwd: string | undefined): string | undefined {
  const r = spawnSync('git', ['branch', '--show-current'], { cwd: cwd ?? root, encoding: 'utf8' });
  return (r.status === 0 && r.stdout.trim()) || undefined;
}

function prHead(pr: string | undefined, cwd: string | undefined): string | undefined {
  const r = spawnSync('gh', ['pr', 'view', ...(pr ? [pr] : []), '--json', 'headRefName', '--jq', '.headRefName'], { cwd: cwd ?? root, encoding: 'utf8' });
  return (r.status === 0 && r.stdout.trim()) || undefined;
}

function prBase(pr: string | undefined, cwd: string | undefined): string | undefined {
  const r = spawnSync('gh', ['pr', 'view', ...(pr ? [pr] : []), '--json', 'baseRefName', '--jq', '.baseRefName'], { cwd: cwd ?? root, encoding: 'utf8' });
  return (r.status === 0 && r.stdout.trim()) || undefined;
}

// GitHub で無効にしたワークフローはチェックを出さない → 有効なものだけを数える
// 読めなければ「ある」とみなす（チェックなしのマージを許可しない側に倒す）
function hasPrWorkflow(cwd: string | undefined): boolean {
  const dir = join(repoRoot(cwd) ?? root, '.github', 'workflows');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f) && /^\s*pull_request(_target)?\s*:|^on:.*\bpull_request/m.test(readFileSync(join(dir, f), 'utf8')));
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  if (files.length === 0) return false;
  const r = spawnSync('gh', ['workflow', 'list', '--all', '--json', 'path,state'], { cwd: cwd ?? root, encoding: 'utf8' });
  try {
    const states = new Map((JSON.parse(r.stdout) as { path: string; state: string }[]).map((w) => [w.path, w.state]));
    // GitHub にまだないファイル（未 push）は有効とみなす
    return files.some((f) => (states.get(`.github/workflows/${f}`) ?? 'active') === 'active');
  } catch {
    return true;
  }
}

// `gh pr checks` は実行中・失敗で終了コードが0以外（8・1）→ 終了コードではなく出力で判定
function prChecks(pr: string | undefined, cwd: string | undefined): Checks {
  const r = spawnSync('gh', ['pr', 'checks', ...(pr ? [pr] : []), '--json', 'bucket'], { cwd: cwd ?? root, encoding: 'utf8' });
  let buckets: string[];
  try {
    buckets = (JSON.parse(r.stdout) as { bucket: string }[]).map((c) => c.bucket);
  } catch {
    return /no checks reported/i.test(r.stderr ?? '') ? 'none' : 'unknown';
  }
  if (buckets.some((b) => b === 'fail' || b === 'cancel')) return 'fail';
  if (buckets.some((b) => b === 'pending')) return 'pending';
  // すべてスキップ = 成功したチェックがない
  if (!buckets.includes('pass')) return 'none';
  return buckets.every((b) => b === 'pass' || b === 'skipping') ? 'pass' : 'unknown';
}

// 差し戻しは1回まで（`stop_hook_active` = 差し戻し後の再実行）→ 解消できない失敗で停止しない状態を防止
function stop() {
  if (input.stop_hook_active) return;
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (!status.stdout?.trim()) return;
  for (const script of ['lint', 'test']) {
    const r = spawnSync('pnpm', [script], { cwd: root, encoding: 'utf8', shell });
    if (r.status === 0) continue;
    const tail = `${r.stdout}${r.stderr}`.trim().split('\n').slice(-40).join('\n');
    console.log(JSON.stringify({ decision: 'block', reason: `\`pnpm ${script}\` が失敗。修正してから完了\n${tail}` }));
    return;
  }
}
