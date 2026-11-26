// 書式の規則: 句点（なし・あり）・括弧の幅・コロン・和欧間のスペース（表記の揺れは notation.ts）
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

// 句点ありの判定の対象外の行
//   Starlight の注記の開始・終了（`:::note[Why]`・`:::`）
//   「キー: 値」の形（キーに句読点がない。`**キー:** 値` を含む）
const DIRECTIVE = /^\s*:::/;
const KEY_VALUE = /^[^。、:]*:(\*\*|__)? /;
// 文の終わり: 句点・疑問符・感嘆符と、後続の閉じ括弧・強調の記号・改行の指定
//   コロンで終わる行（箇条書き・コードの導入）も許可
const ENDED = /([。！？!?][）)」』】\]"'*_~]*|[:：](\*\*|__)?)\s*(\\|<br\s*\/?>)?\s*$/;
// 日本語のない行（コード・URL・英語だけ）は対象外
const needsPeriod = (text: string, prose: string) => JA.test(prose) && !DIRECTIVE.test(text) && !KEY_VALUE.test(prose) && !ENDED.test(text);

// 既定で無効の規則（設定で `true` にした場合だけ判定）
export const OPT_IN_RULE_IDS = ['format/period-required'];

export const FORMAT_RULES: Rule[] = [
  { id: 'format/period', check: (_, p) => (/。\s*$/.test(p) ? ['末尾に句点を付けない'] : []) },
  { id: 'format/period-required', check: (t, p) => (needsPeriod(t, p) ? ['末尾に句点を付ける'] : []) },
  { id: 'format/paren-width', check: (_, p) => (JA.test(p) && /[()]/.test(p) ? ['括弧は全角（コードはバッククォート）'] : []) },
  { id: 'format/colon', check: (_, p) => (/：/.test(p) ? ['コロンは半角（キー: 値）'] : []) },
  { id: 'format/spacing', check: (t) => (fixSpacing(t) !== t ? ['和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）'] : []) },
];
