#!/usr/bin/env node
// Claude Code の hook（`.claude/settings.json` から `node` で直接実行）
// - PreToolUse: 規約に反するツールの実行を拒否 → 終了コード2・理由は stderr
// - Stop: 変更があれば `pnpm lint`・`pnpm test` を実行し、失敗時は完了を差し戻し
// - hook 自体の失敗は終了コード1（拒否にしない → 作業を継続）
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { denyReason, type ToolUse } from './policy.ts';

type Input = ToolUse & { hook_event_name: string; stop_hook_active?: boolean };

const input = JSON.parse(readFileSync(0, 'utf8')) as Input;
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
// Windows の `pnpm` は `.cmd` → シェル経由でのみ起動可能
const shell = process.platform === 'win32';

if (input.hook_event_name === 'PreToolUse') {
  const reason = denyReason(input, { titleIssues, readFile });
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
} else if (input.hook_event_name === 'Stop') {
  stop();
}

// PR のタイトル = squash のコミットのメッセージ → prose-lint のコミットの規則で検査（リポの `prose-lint.json` を反映）
function titleIssues(title: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'conventions-'));
  try {
    const file = join(dir, 'title');
    writeFileSync(file, `${title}\n`);
    const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@ryusenkei/prose-lint')));
    const r = spawnSync(process.execPath, [cli, '--commit-msg', file], { cwd: root, encoding: 'utf8' });
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
