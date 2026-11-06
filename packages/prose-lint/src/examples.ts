// 規則ごとの修正の例（誤 → 正）
//   指摘の出力に、指摘のあった規則の分だけ表示
//   誤の例が規則に該当し、正の例がすべての規則を通ることは試験で検査
//   行の長さ・行末コメントの位置は例が長い → 対象外
export const EXAMPLES: Record<string, [bad: string, good: string]> = {
  'format/period': ['キャッシュを削除する。', 'キャッシュを削除する'],
  'format/paren-width': ['上限 (D1) の行数', '上限（D1）の行数'],
  'format/colon': ['期限：5分', '期限: 5分'],
  'format/spacing': ['D1の上限は 1回', 'D1 の上限は1回'],
  'format/notation': ['設定を全て削除', '設定をすべて削除'],
  'commit/format': ['OG 画像を更新', 'feat(site): OG 画像を更新'],
  'commit/subject-ja': ['fix: update OG image', 'fix: OG 画像を更新'],
  'commit/body': ['fix: OG 画像を更新\n\n背景の説明', 'fix: OG 画像を更新'],
  'commit/trailer': ['fix: OG 画像を更新\n\nCo-Authored-By: Claude <noreply@anthropic.com>', 'fix: OG 画像を更新'],
};

// 指摘のあった規則の例（改行は `⏎` で表示）
export function examplesFor(rules: Iterable<string>): string[] {
  const show = (s: string) => s.replaceAll('\n', ' ⏎ ');
  return [...new Set(rules)].flatMap((id) => (EXAMPLES[id] ? [`${id}: ${show(EXAMPLES[id][0])} → ${show(EXAMPLES[id][1])}`] : []));
}
