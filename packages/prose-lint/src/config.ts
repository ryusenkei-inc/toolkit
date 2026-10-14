// 設定の読み込みと検証
// 場所 = `--config` の指定、なければリポのルートにある次のいずれか1つ
//   `prose-lint.json`・`.config/prose-lint.json`・`package.json` の `prose-lint`
//   複数あれば失敗（どれが有効か曖昧になるため）
//   未知のキー・規則の ID も失敗
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMIT_RULE_IDS } from './commit.ts';
import type { Vocabulary } from './rule.ts';
import { VOCABULARY } from './style.ts';
import { TEXT_RULE_IDS, type Options } from './text.ts';

export type Config = {
  paths: string[]; // 対象のパス（git の pathspec。追跡しているファイルのみ）
  docs: string[]; // 検査する Markdown（git の pathspec）
  extensions: string[]; // コメントを検査する拡張子。`tf`・`py` などは `#`、ほかは `//`・`/* */`・`<!-- -->`
  skip: string; // 対象外のパス（正規表現。空 = なし）
  trailingFiles: string; // 1 フィールド 1 行・説明は行末コメントのファイル（正規表現。空 = なし）
  vocabulary: { re: string; flags?: string; to: string }[]; // リポ固有の語彙（共通の語彙に追加）
  allow: string[]; // 文体の判定から除外する語（正規表現。ドメインの用語など）
  rules: Record<string, boolean>; // 規則の ID ごとの有効・無効（既定 = すべて有効）
};

const DEFAULTS: Config = {
  paths: ['.'],
  docs: ['*.md'],
  extensions: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'astro', 'vue', 'svelte', 'css'],
  skip: '',
  trailingFiles: '',
  vocabulary: [],
  allow: [],
  rules: {},
};

export const RULE_IDS = [...TEXT_RULE_IDS, 'format/wrap', 'format/trailing-align', ...COMMIT_RULE_IDS];
const FILES = ['prose-lint.json', '.config/prose-lint.json'];

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

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
  const unknownRules = Object.keys(config.rules).filter((id) => !RULE_IDS.includes(id));
  if (unknownRules.length) throw new Error(`${entry.source}: 未知の規則 ${unknownRules.join('・')}（規則 = ${RULE_IDS.join('・')}）`);
  return { config, source: entry.source };
}

export function textOptions(config: Config): Options & { vocabulary: Vocabulary; disabled: Set<string> } {
  return {
    vocabulary: [...VOCABULARY, ...config.vocabulary.map((v) => ({ re: new RegExp(v.re, v.flags), to: v.to }))],
    allow: config.allow.map((re) => new RegExp(re, 'gu')),
    disabled: new Set(Object.entries(config.rules).filter(([, on]) => !on).map(([id]) => id)),
  };
}
