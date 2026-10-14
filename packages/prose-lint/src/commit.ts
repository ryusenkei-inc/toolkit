// コミットメッセージの検査（git の commit-msg フック用）
//   - 書式: Conventional Commits・subject は日本語・1行のみ（body なし）・AI の署名なし
//   - subject の文は書式・文体の規則で判定
//   - `type(scope)!: ` は英語の決まった書式 → 対象外
//   - `#` で始まる行・`--verbose` の差分（切り取り線以降）は git が除去 → 対象外
import { JA, type Issue } from './rule.ts';
import { textIssues, type Options } from './text.ts';

const TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];
const HEADER = /^([a-z]+)(?:\(([^)]*)\))?!?: (\S.*)$/;
const SCOPE = /^[a-z0-9][a-z0-9._/-]*(,[a-z0-9][a-z0-9._/-]*)*$/;
const SCISSORS = /^# -+ >8 -+$/;
// git が生成するメッセージ（マージ・取り消し・fixup）は対象外
const GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;
// AI の署名: trailer の値に AI の名前・生成元の表記
const AI_TRAILER = /^[\w-]+:.*\b(claude|anthropic|openai|chatgpt|gpt-\d|copilot|gemini|codex|cursor)\b/i;
const AI_NOTE = /generated (with|by)|🤖/i;

export const COMMIT_RULE_IDS = ['commit/format', 'commit/subject-ja', 'commit/body', 'commit/trailer'];

export function commitMessageIssues(message: string, options: Options = {}): { line: number; text: string; issues: Issue[] }[] {
  const disabled = options.disabled ?? new Set<string>();
  const on = (id: string) => !disabled.has(id);
  const out: { line: number; text: string; issues: Issue[] }[] = [];
  const lines: { line: number; raw: string }[] = [];
  for (const [i, raw] of message.split(/\r?\n/).entries()) {
    if (SCISSORS.test(raw)) break;
    if (!raw.startsWith('#') && raw.trim()) lines.push({ line: i + 1, raw });
  }
  const [head, ...rest] = lines;
  if (!head || GENERATED.test(head.raw)) return [];

  const issues: Issue[] = [];
  const m = head.raw.match(HEADER);
  if (on('commit/format') && (!m || !TYPES.includes(m[1]!) || (m[2] !== undefined && !SCOPE.test(m[2])))) issues.push({ rule: 'commit/format', message: `Conventional Commits の \`type(scope): subject\`（type = ${TYPES.join('・')}、scope = 英小文字）` });
  const subject = m?.[3] ?? head.raw;
  // バージョンを上げるだけのコミット（`chore(release): <package>@<version>`）は英語の定型
  const release = m?.[1] === 'chore' && m[2] === 'release';
  if (on('commit/subject-ja') && !release && !JA.test(subject)) issues.push({ rule: 'commit/subject-ja', message: 'subject は日本語' });
  if (!release) issues.push(...textIssues(subject, { ...options, sentences: 1 }));
  if (issues.length) out.push({ line: head.line, text: subject, issues });

  for (const { line, raw } of rest) {
    const body: Issue[] = [];
    if (on('commit/trailer') && (AI_TRAILER.test(raw) || AI_NOTE.test(raw))) body.push({ rule: 'commit/trailer', message: 'AI の署名・trailer を付けない' });
    if (on('commit/body')) body.push({ rule: 'commit/body', message: 'body を書かない（背景は PR に記載）' });
    else body.push(...textIssues(raw, options));
    if (body.length) out.push({ line, text: raw, issues: body });
  }
  return out;
}
