// Markdown の自動修正: 和欧間のスペースを詰め、段落の末尾に句点を付ける
//   見出し・箇条書き・引用の記号は変えない
//   表記・括弧・コロンは文脈の判断が必要 → 対象外
import { markdownTexts } from './comments.ts';
import { needsPeriod, removeSpacing } from './format.ts';
import { mask } from './rule.ts';

const PREFIX = /^(?:\s*>)*\s*(?:#{1,6}\s+|(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?)?/;
// 句点は末尾の空白・改行の指定（`\`・`<br>`）の前に挿入
const addPeriod = (line: string) => line.replace(/(\s*(?:\\|<br\s*\/?>)?\s*)$/, '。$1');

// 改行は行ごとに元のまま保つ（改行の種類が混在するファイルも、修正した行以外は変えない）
export function fixMarkdown(source: string, rules: { spacing: boolean; period: boolean } = { spacing: true, period: true }): string {
  const parts = source.split(/(\r?\n)/);
  const join = () => parts.join('');
  // `markdownTexts` の行番号 → `parts` の位置（行と改行が交互）
  const at = (line: number) => (line - 1) * 2;
  if (rules.spacing) {
    for (const line of new Set(markdownTexts(source).map((t) => t.line))) {
      const raw = parts[at(line)]!;
      const prefix = raw.match(PREFIX)![0];
      // 表はセルごとに判定（英語のセルと日本語のセルが混在するため）
      const body = raw.slice(prefix.length);
      parts[at(line)] = prefix + (body.startsWith('|') ? body.split(/((?<!\\)\|)/).map(removeSpacing).join('') : removeSpacing(body));
    }
  }
  if (rules.period) {
    for (const t of markdownTexts(join())) if (t.kind === 'paragraph' && needsPeriod(t.text, mask(t.text, /`[^`]*`/g))) parts[at(t.line)] = addPeriod(parts[at(t.line)]!);
  }
  return join();
}
