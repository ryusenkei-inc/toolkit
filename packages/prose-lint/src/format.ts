// 書式の規則: 句点・括弧の幅・コロン・和欧間のスペース（表記の揺れは notation.ts）
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

export const FORMAT_RULES: Rule[] = [
  { id: 'format/period', check: (_, p) => (/。\s*$/.test(p) ? ['末尾に句点を付けない'] : []) },
  { id: 'format/paren-width', check: (_, p) => (JA.test(p) && /[()]/.test(p) ? ['括弧は全角（コードはバッククォート）'] : []) },
  { id: 'format/colon', check: (_, p) => (/：/.test(p) ? ['コロンは半角（キー: 値）'] : []) },
  { id: 'format/spacing', check: (t) => (fixSpacing(t) !== t ? ['和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）'] : []) },
];
