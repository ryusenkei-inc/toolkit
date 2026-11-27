// 書式の規則: 句点・括弧の幅・コロン・和欧間のスペース（表記の揺れは notation.ts）
//   句点と和欧間のスペースは文の種類（`Kind`）で変わる
import { JA, type Kind, type Rule } from './rule.ts';
import { autoSpace, isEnglish, removeSpacing } from './spacing.ts';

const NBSP = String.fromCharCode(0xa0);

// コメントの和欧間のスペース = `autoSpace`（英字を含む語だけ空け、数字だけの語は詰める）
// 対象外: コード・URL・メールアドレス・構造の記号（行頭の `- `・`1. `・`: `・`, `・` / `・` = `・` - `・` -> `）
//   autoSpace は `:`・`,`・`-`・`.` を語の一部として詰めるため
const KEEP = /(`[^`]*`|https?:\/\/\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|^\s*- |^\s*\d+\. |: |, | \/ | = | - | -> )/;
export const fixSpacing = (text: string) =>
  text
    .split(KEEP)
    .map((part, i) => (i % 2 === 1 ? part : autoSpace(part).replaceAll(NBSP, ' ')))
    .join('');

// 文書・コミットメッセージの和欧間のスペース = すべて詰める
export { removeSpacing };

// 句点が必要な文（Markdown の段落・引用）のうち、判定の対象外の行
//   Starlight の注記の開始・終了（`:::note[Why]`・`:::`）、HTML の行
//   「キー: 値」の形（キーに句読点がない。`**キー:** 値` を含む）
const EXEMPT = /^\s*(:::|<)/;
const KEY_VALUE = /^[^。、:]*:(\*\*|__)? /;
// 文の終わり: 句点・疑問符・感嘆符と、後続の閉じ括弧・強調の記号・改行の指定
//   コロンで終わる行（箇条書き・コードの導入）も許可
const ENDED = /([。！？!?][）)」』】\]"'*_~]*|[:：](\*\*|__)?)\s*(\\|<br\s*\/?>)?\s*$/;
// 日本語のない行（コード・URL・英語だけ）と英語の文（文の中の日本語の語を含む）は対象外
export const needsPeriod = (text: string, prose: string) => JA.test(prose) && !isEnglish(prose) && !EXEMPT.test(text) && !KEY_VALUE.test(prose) && !ENDED.test(text);

// 句点: 段落は付ける、箇条書きは判定しない、ほか（コメント・コミット・見出し・表のセル）は付けない
const period = (text: string, prose: string, kind: Kind) => {
  if (kind === 'paragraph') return needsPeriod(text, prose) ? ['末尾に句点を付ける'] : [];
  if (kind === 'item') return [];
  return /。\s*$/.test(prose) ? ['末尾に句点を付けない'] : [];
};

const spacing = (text: string, kind: Kind) => {
  if (kind === 'comment') return fixSpacing(text) !== text ? ['和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）'] : [];
  return removeSpacing(text) !== text ? ['英単語と日本語の間に空白を入れない'] : [];
};

export const FORMAT_RULES: Rule[] = [
  { id: 'format/period', check: period },
  { id: 'format/paren-width', check: (_, p) => (JA.test(p) && /[()]/.test(p) ? ['括弧は全角（コードはバッククォート）'] : []) },
  { id: 'format/colon', check: (_, p) => (/：/.test(p) ? ['コロンは半角（キー: 値）'] : []) },
  { id: 'format/spacing', check: (t, _, kind) => spacing(t, kind) },
];
