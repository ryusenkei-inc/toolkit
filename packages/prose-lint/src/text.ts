// 文章の判定: 書式の規則（format.ts）と表記の揺れ（notation.ts）を適用
import { FORMAT_RULES } from './format.ts';
import { NOTATION, notationRule } from './notation.ts';
import { mask, type Issue, type Vocabulary } from './rule.ts';

export type Options = {
  vocabulary?: Vocabulary; // 表記の一覧（既定 = 共通の表記）
  allow?: RegExp[]; // 表記の判定から除外する語（ドメインの用語など）
  disabled?: ReadonlySet<string>; // 無効化する規則の ID
};

// 規則の ID の一覧（設定の検証用・コミットの規則は commit.ts）
export const TEXT_RULE_IDS = [...FORMAT_RULES, notationRule([])].map((r) => r.id).concat('format/length');

// コメントの1行の上限（文字数）
//   Markdown は段落を折り返さない → 対象外
export const MAX_LENGTH = 100;

// バッククォートの中（コード）は判定対象外
const code = /`[^`]*`/g;

const global = (re: RegExp) => (re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`));

export function textIssues(text: string, options: Options = {}): Issue[] {
  const { vocabulary = NOTATION, allow = [], disabled = new Set() } = options;
  const prose = mask(text, code);
  const notationProse = allow.reduce((p, re) => mask(p, global(re)), prose);
  const issues: Issue[] = [];
  for (const rule of FORMAT_RULES) if (!disabled.has(rule.id)) for (const message of rule.check(text, prose)) issues.push({ rule: rule.id, message });
  const notation = notationRule(vocabulary);
  if (!disabled.has(notation.id)) for (const message of notation.check(text, notationProse)) issues.push({ rule: notation.id, message });
  return issues;
}

// URL は折り返せない → 行の長さでは1字として数える
const URL = /https?:\/\/\S+/g;

// コメントの1行: 文章の規則と行の長さ
export function commentIssues(text: string, options: Options = {}): Issue[] {
  const issues = textIssues(text, options);
  const length = [...text.replace(URL, 'U')].length;
  if (length > MAX_LENGTH && !options.disabled?.has('format/length')) issues.push({ rule: 'format/length', message: `1 行は ${MAX_LENGTH} 字まで（${length} 字。行を分割）` });
  return issues;
}
