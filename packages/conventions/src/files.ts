// 利用側のリポにある共通ファイルの同期・検査
// - マスタ: パッケージの `files/`（npm は `.gitignore` を同梱しない → 先頭の `.` を除いた名前で格納）
// - 比較は改行コードを LF に正規化（Windows の作業ツリーは CRLF になりうる）
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hasStop, managedSettings, type Settings } from './settings.ts';

const FILES: { from: string; to: string; mode?: number }[] = [
  { from: 'editorconfig', to: '.editorconfig' },
  { from: 'gitattributes', to: '.gitattributes' },
  { from: 'gitignore', to: '.gitignore' },
  { from: 'gitleaks.toml', to: '.gitleaks.toml' },
  { from: 'mise.toml', to: 'mise.toml' },
  { from: 'dependabot.yaml', to: '.github/dependabot.yaml' },
  { from: 'commit-msg', to: '.githooks/commit-msg', mode: 0o755 },
];
const SETTINGS = '.claude/settings.json';
const WORKSPACE = 'pnpm-workspace.yaml';
/** CLAUDE.md で共通の規約を読み込む import */
export const IMPORT = '@node_modules/@ryusenkei/conventions/rules.md';
// `.github/dependabot.yaml` の `cooldown` と同値
const RELEASE_AGE = [
  '# 公開から2日未満のバージョンは解決しない（`.github/dependabot.yaml` の `cooldown` と同値）',
  'minimumReleaseAge: 2880',
  'minimumReleaseAgeExclude:',
  '  - "@ryusenkei/*"',
];

/** 差分のあるファイル（`expected` が `undefined` = 自動で修正できない → `message` に対処） */
export type Drift = { path: string; expected?: string; message: string };

const lf = (s: string) => s.replaceAll('\r\n', '\n');
const read = (path: string) => (existsSync(path) ? lf(readFileSync(path, 'utf8')) : undefined);

/** マスタとの差分 */
export function drifts(root: string, options: { stop?: boolean } = {}): Drift[] {
  const out: Drift[] = [];
  for (const f of FILES) {
    const expected = lf(readFileSync(new URL(`../files/${f.from}`, import.meta.url), 'utf8'));
    if (read(join(root, f.to)) !== expected) out.push({ path: f.to, expected, message: 'マスタと不一致' });
  }

  const raw = read(join(root, SETTINGS));
  const current = raw === undefined ? {} : (JSON.parse(raw) as Settings);
  const settings = `${JSON.stringify(managedSettings(current, { stop: options.stop ?? hasStop(current) }), null, 2)}\n`;
  if (raw !== settings) out.push({ path: SETTINGS, expected: settings, message: 'hook・`attribution`・`permissions.deny` が不一致' });

  const workspace = read(join(root, WORKSPACE)) ?? '';
  if (!workspace.includes(RELEASE_AGE.slice(1).join('\n'))) {
    if (/^minimumReleaseAge/m.test(workspace)) out.push({ path: WORKSPACE, message: `\`minimumReleaseAge\`・\`minimumReleaseAgeExclude\` を次の値に修正\n${RELEASE_AGE.join('\n')}` });
    else out.push({ path: WORKSPACE, expected: `${workspace.trimEnd()}\n\n${RELEASE_AGE.join('\n')}\n`, message: '`minimumReleaseAge` が未設定' });
  }

  const claude = read(join(root, 'CLAUDE.md')) ?? '';
  if (!claude.split('\n').some((l) => l.trim() === IMPORT)) out.push({ path: 'CLAUDE.md', message: `共通の規約の import（\`${IMPORT}\`）を追加` });
  return out;
}

/** 自動で修正できる差分を書き込み、残りの差分を返却 */
export function sync(root: string, options: { stop?: boolean } = {}): Drift[] {
  const rest: Drift[] = [];
  for (const d of drifts(root, options)) {
    if (d.expected === undefined) {
      rest.push(d);
      continue;
    }
    const path = join(root, d.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, d.expected);
    const mode = FILES.find((f) => f.to === d.path)?.mode;
    if (mode) chmodSync(path, mode);
  }
  return rest;
}
