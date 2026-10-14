// 規則ごとの修正の例（誤 → 正）
//   指摘の出力に、指摘のあった規則の分だけ表示
//   誤の例が規則に該当し、正の例がすべての規則を通ることは試験で検査
//   行の長さ・行末コメントの位置は例が長い → 対象外
export const EXAMPLES: Record<string, [bad: string, good: string]> = {
  'format/period': ['キャッシュを削除する。', 'キャッシュを削除する'],
  'format/sentences': ['記事を取得する。失敗時は再試行', '記事を取得（失敗時は再試行）'],
  'format/paren-width': ['上限 (D1) の行数', '上限（D1）の行数'],
  'format/paren-nest': ['対象（記事（公開済み））', '対象（公開済みの記事）'],
  'format/paren-count': ['記事（公開済み）の日付（JST）', '公開済みの記事の日付（JST）'],
  'format/colon': ['期限：5分', '期限: 5分'],
  'format/spacing': ['D1の上限は 1回', 'D1 の上限は1回'],
  'style/vocabulary': ['キャッシュを作る', 'キャッシュを作成'],
  'style/verbose': ['確認を行う', '確認する'],
  'style/chain': ['記事の取得の結果の型', '記事の取得結果の型'],
  'style/hedge': ['原因はキャッシュだと思う', '原因はキャッシュ'],
  'style/polite': ['キャッシュを削除します', 'キャッシュを削除'],
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
