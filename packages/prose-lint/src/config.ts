// 設定の読み込みと検証
// 場所 = `--config` の指定、なければリポのルートにある次のいずれか1つ
//   `prose-lint.json`・`.config/prose-lint.json`・`package.json` の `prose-lint`
//   複数あれば失敗（どれが有効か曖昧になるため）
//   未知のキー・規則の ID も失敗
// `overrides` = パスごとの規則の上書き
//   `files` に一致するファイルに `rules` を重ねる（複数の一致は順に適用 → 後の指定が優先）
import { existsSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { COMMIT_RULE_IDS } from './commit.ts';
import { NOTATION } from './notation.ts';
import type { Vocabulary } from './rule.ts';
import { OPT_IN_RULE_IDS } from './format.ts';
import { TEXT_RULE_IDS, type Options } from './text.ts';

export type Config = {
  paths: string[]; // 対象のパス（git の pathspec。追跡しているファイルのみ）
  docs: string[]; // 検査する Markdown（git の pathspec）
  extensions: string[]; // コメントを検査する拡張子。`tf`・`py` などは `#`、ほかは `//`・`/* */`・`<!-- -->`
  skip: string; // 対象外のパス（正規表現。空 = なし）
  trailingFiles: string; // 1 フィールド 1 行・説明は行末コメントのファイル（正規表現。空 = なし）
  vocabulary: { re: string; flags?: string; to: string }[]; // リポ固有の表記（共通の表記に追加）
  allow: string[]; // 表記の判定から除外する語（正規表現。ドメインの用語など）
  rules: Record<string, boolean>; // 規則の ID ごとの有効・無効（既定 = `OPT_IN_RULE_IDS` 以外は有効）
  overrides: Override[]; // パスごとの規則の上書き
};

// `files` = リポのルートからの相対パスの glob
export type Override = { files: string[]; rules: Record<string, boolean> };

const DEFAULTS: Config = {
  paths: ['.'],
  docs: ['*.md'],
  extensions: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'astro', 'vue', 'svelte', 'css'],
  skip: '',
  trailingFiles: '',
  vocabulary: [],
  allow: [],
  rules: {},
  overrides: [],
};

export const RULE_IDS = [...TEXT_RULE_IDS, 'format/trailing-align', ...COMMIT_RULE_IDS];
const FILES = ['prose-lint.json', '.config/prose-lint.json'];

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

function checkRules(where: string, rules: object) {
  const unknown = Object.keys(rules).filter((id) => !RULE_IDS.includes(id));
  if (unknown.length) throw new Error(`${where}: 未知の規則 ${unknown.join('・')}（規則 = ${RULE_IDS.join('・')}）`);
}

function checkOverride(where: string, value: unknown) {
  const { files, rules, ...rest } = (value ?? {}) as Partial<Override>;
  if (Object.keys(rest).length) throw new Error(`${where}: 未知のキー ${Object.keys(rest).join('・')}`);
  if (!Array.isArray(files) || !files.length || !files.every((f) => typeof f === 'string')) throw new Error(`${where}: \`files\` は glob の配列（1つ以上）`);
  if (typeof rules !== 'object' || rules === null) throw new Error(`${where}: \`rules\` が必要`);
  checkRules(where, rules);
}

// ファイルに適用する規則の設定（`file` = リポのルートからの相対パス。なければ上書きを適用しない）
function rulesFor(config: Config, file?: string): Record<string, boolean> {
  const matched = file === undefined ? [] : config.overrides.filter((o) => o.files.some((pattern) => matchesGlob(file, pattern)));
  return Object.assign({}, config.rules, ...matched.map((o) => o.rules));
}

// `dir` = リポのルート、`explicit` = `--config` の指定（`dir` からの相対）
export function loadConfig(dir = '.', explicit?: string): { config: Config; source?: string } {
  const found: { source: string; value: Record<string, unknown> }[] = [];
  if (explicit) found.push({ source: explicit, value: json(join(dir, explicit)) });
  else {
    for (const file of FILES) if (existsSync(join(dir, file))) found.push({ source: file, value: json(join(dir, file)) });
    const pkg = existsSync(join(dir, 'package.json')) ? json(join(dir, 'package.json'))['prose-lint'] : undefined;
    if (pkg !== undefined) found.push({ source: 'package.json#prose-lint', value: pkg as Record<string, unknown> });
  }
  if (found.length > 1) throw new Error(`設定が複数: ${found.map((f) => f.source).join('・')}（1 つに統一）`);
  const [entry] = found;
  if (!entry) return { config: DEFAULTS };
  const unknownKeys = Object.keys(entry.value).filter((k) => !(k in DEFAULTS));
  if (unknownKeys.length) throw new Error(`${entry.source}: 未知のキー ${unknownKeys.join('・')}`);
  const config = { ...DEFAULTS, ...entry.value } as Config;
  checkRules(entry.source, config.rules);
  if (!Array.isArray(config.overrides)) throw new Error(`${entry.source}: \`overrides\` は配列`);
  config.overrides.forEach((o, i) => checkOverride(`${entry.source} の overrides[${i}]`, o));
  return { config, source: entry.source };
}

export function textOptions(config: Config, file?: string): Options & { vocabulary: Vocabulary; disabled: Set<string>; enabled: Set<string> } {
  const rules = Object.entries(rulesFor(config, file));
  return {
    vocabulary: [...NOTATION, ...config.vocabulary.map((v) => ({ re: new RegExp(v.re, v.flags), to: v.to }))],
    allow: config.allow.map((re) => new RegExp(re, 'gu')),
    disabled: new Set(rules.filter(([, on]) => !on).map(([id]) => id)),
    enabled: new Set(rules.filter(([id, on]) => on && OPT_IN_RULE_IDS.includes(id)).map(([id]) => id)),
  };
}
