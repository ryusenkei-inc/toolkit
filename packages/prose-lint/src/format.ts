// 書式の規則: 句読点・文の数・括弧・コロン・和欧間のスペース（語の選択は style.ts）
import { JA, type Rule } from './rule.ts';
import { autoSpace } from './spacing.ts';

const NBSP = String.fromCharCode(0xa0);

// 和欧間のスペース = `autoSpace`（英字を含む語だけ空け、数字だけの語は詰める）
// 対象外: コード・URL・メールアドレス・構造の記号（行頭の `- `・`1. `・`: `・`, `・` / `・` = `・` - `・` -> `）
//   autoSpace は `:`・`,`・`-`・`.` を語の一部として詰めるため
const KEEP = /(`[^`]*`|https?:\/\/\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|^\s*- |^\s*\d+\. |: |, | \/ | = | - | -> )/;
export const fixSpacing = (text: string) =>
  text
    .split(KEEP)
    .map((part, i) => (i % 2 === 1 ? part : autoSpace(part).replaceAll(NBSP, ' ')))
    .join('');

const parens = (prose: string) => {
  let depth = 0;
  let max = 0;
  let count = 0;
  for (const c of prose) {
    if (c === '（') {
      depth++;
      count++;
      max = Math.max(max, depth);
    } else if (c === '）') depth = Math.max(0, depth - 1);
  }
  return { max, count };
};

export const FORMAT_RULES: Rule[] = [
  { id: 'format/period', check: (_, p) => (/。\s*$/.test(p) ? ['末尾に句点を付けない'] : []) },
  { id: 'format/sentences', check: (_, p, max) => ((p.match(/。(?=\s*\S)/g) ?? []).length >= max ? [max === 1 ? '1 行に 1 文（文ごとに行を分割）' : `1 行の文は ${max} つまで（超える場合は行を分割）`] : []) },
  { id: 'format/paren-width', check: (_, p) => (JA.test(p) && /[()]/.test(p) ? ['括弧は全角（コードはバッククォート）'] : []) },
  { id: 'format/paren-nest', check: (_, p) => (parens(p).max > 1 ? ['括弧を入れ子にしない'] : []) },
  { id: 'format/paren-count', check: (_, p) => (parens(p).count > 1 ? ['括弧の補足は 1 つまで'] : []) },
  { id: 'format/colon', check: (_, p) => (/：/.test(p) ? ['コロンは半角（キー: 値）'] : []) },
  { id: 'format/spacing', check: (t) => (fixSpacing(t) !== t ? ['和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）'] : []) },
];
