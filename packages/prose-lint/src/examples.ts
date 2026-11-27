// 規則ごとの修正の例（誤 → 正）
//   指摘の出力に、指摘のあった規則の分だけ表示
//   句点・和欧間のスペースは文の種類で規則が変わる → 指摘の文言で例を選択
//   誤の例が規則に該当し、正の例がすべての規則を通ることは試験で検査
//   行の長さ・行末コメントの位置は例が長い → 対象外
import type { Issue, Kind } from './rule.ts';

export type Example = { rule: string; message?: string; kind: Kind; bad: string; good: string };

export const EXAMPLES: Example[] = [
  { rule: 'format/period', message: '末尾に句点を付けない', kind: 'comment', bad: 'キャッシュを削除する。', good: 'キャッシュを削除する' },
  { rule: 'format/period', message: '末尾に句点を付ける', kind: 'paragraph', bad: 'キャッシュを削除する', good: 'キャッシュを削除する。' },
  { rule: 'format/paren-width', kind: 'comment', bad: '上限 (D1) の行数', good: '上限（D1）の行数' },
  { rule: 'format/colon', kind: 'comment', bad: '期限：5分', good: '期限: 5分' },
  { rule: 'format/spacing', message: '和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）', kind: 'comment', bad: 'D1の上限は 1回', good: 'D1 の上限は1回' },
  { rule: 'format/spacing', message: '英単語と日本語の間に空白を入れない', kind: 'paragraph', bad: 'D1 の上限は 1 回。', good: 'D1の上限は1回。' },
  { rule: 'format/notation', kind: 'comment', bad: '設定を全て削除', good: '設定をすべて削除' },
  { rule: 'commit/format', kind: 'commit', bad: 'OG画像を更新', good: 'feat(site): OG画像を更新' },
  { rule: 'commit/subject-ja', kind: 'commit', bad: 'fix: update OG image', good: 'fix: OG画像を更新' },
  { rule: 'commit/body', kind: 'commit', bad: 'fix: OG画像を更新\n\n背景の説明', good: 'fix: OG画像を更新' },
  { rule: 'commit/trailer', kind: 'commit', bad: 'fix: OG画像を更新\n\nCo-Authored-By: Claude <noreply@anthropic.com>', good: 'fix: OG画像を更新' },
];

// 指摘のあった規則の例（改行は `⏎` で表示）
export function examplesFor(issues: Iterable<Issue>): string[] {
  const show = (s: string) => s.replaceAll('\n', ' ⏎ ');
  const list = [...issues];
  return EXAMPLES.filter((e) => list.some((i) => i.rule === e.rule && (e.message === undefined || i.message === e.message))).map((e) => `${e.rule}: ${show(e.bad)} → ${show(e.good)}`);
}
