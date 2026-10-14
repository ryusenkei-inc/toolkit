// 記事の HTML のキャッシュ（Cache API）
// - キー: 記事の Slug
// - 有効期限: 5分 → 公開の反映は期限の経過後
// - 対象外: dev・プレビュー → Notion の変更を即時に確認するため

/** キャッシュの有効期限（秒） */
export const TTL = 300;

/**
 * 記事の HTML を返却（キャッシュになければ描画して格納）
 * @param slug 記事の Slug
 * @param render 描画の関数
 */
export async function cachedHtml(slug: string, render: (slug: string) => Promise<string>): Promise<string> {
  const cache = await caches.open('articles');
  const key = new Request(`https://cache.local/${slug}`);
  const hit = await cache.match(key);
  if (hit) return hit.text();
  const html = await render(slug);
  // 格納の失敗時もページは返却
  //   キャッシュは次の要求で再試行 → 描画の失敗と区別するため例外にしない
  await cache.put(key, new Response(html, { headers: { 'Cache-Control': `max-age=${TTL}` } })).catch(() => undefined);
  return html;
}

/** キャッシュに格納する記事 */
export type CachedArticle = {
  slug: string;        // 記事の URL のキー
  html: string;        // 描画済みの HTML
  publishedAt: string; // 公開日時（ISO 8601）→ 表示の直前に JST へ変換
};
