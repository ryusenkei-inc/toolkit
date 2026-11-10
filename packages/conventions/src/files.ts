// 利用側のリポにある共通ファイルの同期・検査
// - マスタ: パッケージの `files/`（npm は `.gitignore` を同梱しない → 先頭の `.` を除いた名前で格納）
// - 比較は改行コードを LF に正規化（Windows の作業ツリーは CRLF になりうる）
// - `append`: 条件のファイルがあるリポのみ、記載の順に末尾に追加（例: go.mod のないリポで gomod の更新はエラー）
// - `optOut`: `package.json` の `"ryusenkei"` のキーが `false` のリポでは配らず、残っていれば削除
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hasStop, managedSettings, type Settings } from './settings.ts';

const FILES: { from: string; to: string; mode?: number; append?: { from: string; if: string }[]; optOut?: 'dependabot' }[] = [
  { from: 'editorconfig', to: '.editorconfig' },
  { from: 'gitattributes', to: '.gitattributes' },
  { from: 'gitignore', to: '.gitignore', append: [{ from: 'gitignore-cargo', if: 'Cargo.toml' }] },
  { from: 'gitleaks.toml', to: '.gitleaks.toml' },
  { from: 'mise.toml', to: 'mise.toml' },
  {
    from: 'dependabot.yaml',
    to: '.github/dependabot.yaml',
    append: [
      { from: 'dependabot-gomod.yaml', if: 'go.mod' },
      { from: 'dependabot-cargo.yaml', if: 'Cargo.toml' },
    ],
    // 非公開のリポで GitHub Actions の消費を抑える → 依存は手元でまとめて更新
    optOut: 'dependabot',
  },
  { from: 'commit-msg', to: '.githooks/commit-msg', mode: 0o755 },
  { from: 'pre-push', to: '.githooks/pre-push', mode: 0o755 },
  // スキル: 管理するのはこの一覧の名前だけ（リポ独自のスキルは維持）
  { from: 'skills/stacked-pr/SKILL.md', to: '.claude/skills/stacked-pr/SKILL.md' },
];
const SETTINGS = '.claude/settings.json';
const WORKSPACE = 'pnpm-workspace.yaml';
/** CLAUDE.md で共通の規約を読み込む import */
export const IMPORT = '@node_modules/@ryusenkei/conventions/rules.md';
// 言語・UI の規約: 条件に合うリポだけ import を求める（UI は `package.json` の `"ryusenkei": { "ui": true }` で opt-in）
const LANG_RULES: { file: string; if: (root: string) => boolean }[] = [
  { file: 'rules-ts.md', if: (root) => existsSync(join(root, 'tsconfig.json')) },
  { file: 'rules-go.md', if: (root) => existsSync(join(root, 'go.mod')) },
  { file: 'rules-rust.md', if: (root) => existsSync(join(root, 'Cargo.toml')) },
  { file: 'rules-ui.md', if: (root) => uiOptIn(root) },
];

/** ルートの `package.json` の `"ryusenkei"` の設定（読めない → 空） */
function config(root: string): Record<string, unknown> {
  try {
    return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { ryusenkei?: Record<string, unknown> }).ryusenkei ?? {};
  } catch {
    return {};
  }
}
const uiOptIn = (root: string) => config(root).ui === true;
// `.github/dependabot.yaml` の `cooldown` と同値
const RELEASE_AGE = [
  '# 公開から2日未満のバージョンは解決しない（`.github/dependabot.yaml` の `cooldown` と同値）',
  'minimumReleaseAge: 2880',
  'minimumReleaseAgeExclude:',
  '  - "@ryusenkei/*"',
];

/** 差分のあるファイル（`expected` が `null` = 削除、`undefined` = 自動で修正できない → `message` に対処） */
export type Drift = { path: string; expected?: string | null; message: string };

const lf = (s: string) => s.replaceAll('\r\n', '\n');
const read = (path: string) => (existsSync(path) ? lf(readFileSync(path, 'utf8')) : undefined);
const master = (name: string) => lf(readFileSync(new URL(`../files/${name}`, import.meta.url), 'utf8'));

/** マスタとの差分 */
export function drifts(root: string, options: { stop?: boolean } = {}): Drift[] {
  const out: Drift[] = [];
  const settingsOf = config(root);
  for (const f of FILES) {
    if (f.optOut && settingsOf[f.optOut] === false) {
      if (existsSync(join(root, f.to))) out.push({ path: f.to, expected: null, message: `\`"${f.optOut}": false\` のため削除` });
      continue;
    }
    const appended = (f.append ?? []).filter((a) => existsSync(join(root, a.if))).map((a) => master(a.from));
    const expected = master(f.from) + appended.join('');
    if (read(join(root, f.to)) !== expected) out.push({ path: f.to, expected, message: 'マスタと不一致' });
  }

  const raw = read(join(root, SETTINGS));
  const current = raw === undefined ? {} : (JSON.parse(raw) as Settings);
  const settings = `${JSON.stringify(managedSettings(current, { stop: options.stop ?? hasStop(current) }), null, 2)}\n`;
  if (raw !== settings) out.push({ path: SETTINGS, expected: settings, message: 'hook・`attribution`・`permissions.deny`・プラグインが不一致' });

  const workspace = read(join(root, WORKSPACE)) ?? '';
  if (!workspace.includes(RELEASE_AGE.slice(1).join('\n'))) {
    if (/^minimumReleaseAge/m.test(workspace)) out.push({ path: WORKSPACE, message: `\`minimumReleaseAge\`・\`minimumReleaseAgeExclude\` を次の値に修正\n${RELEASE_AGE.join('\n')}` });
    else out.push({ path: WORKSPACE, expected: `${workspace.trimEnd()}\n\n${RELEASE_AGE.join('\n')}\n`, message: '`minimumReleaseAge` が未設定' });
  }

  const claude = read(join(root, 'CLAUDE.md')) ?? '';
  const lines = claude.split('\n');
  const at = lines.findIndex((l) => l.trim() === IMPORT);
  const missing = LANG_RULES.filter((r) => r.if(root)).map((r) => IMPORT.replace('rules.md', r.file)).filter((line) => !lines.some((l) => l.trim() === line));
  if (at === -1) out.push({ path: 'CLAUDE.md', message: `共通の規約の import（\`${[IMPORT, ...missing].join('`・`')}\`）を追加` });
  else if (missing.length) out.push({ path: 'CLAUDE.md', expected: [...lines.slice(0, at + 1), ...missing, ...lines.slice(at + 1)].join('\n'), message: `規約の import（\`${missing.join('`・`')}\`）が不足` });
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
    if (d.expected === null) {
      rmSync(path);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, d.expected);
    const mode = FILES.find((f) => f.to === d.path)?.mode;
    if (mode) chmodSync(path, mode);
  }
  return rest;
}
