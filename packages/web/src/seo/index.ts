// 検索エンジン向けの値: 正規の URL、メタタグ、JSON-LD、sitemap、robots.txt
// - 見た目を持たない。返すのはデータと HTML・XML・テキストの文字列で、head への差し込みは使う側のフレームワーク
// - サイトの名前や組織の値は使う側が渡す
import { UsageError } from '@ryusenkei/core';

/** オリジン（`https://example.com`）か、サイトの URL */
export type Origin = string | URL;

/**
 * 正規のパス（canonical と sitemap に使う）
 * - クエリと断片を除き、`.html` と末尾の `/index` を外し、末尾のスラッシュをなくす。トップは `/`
 */
export function canonicalPath(pathname: string): string {
  const path = pathname.replace(/[?#].*$/, '').replace(/\.html$/, '').replace(/(^|\/)index$/, '$1');
  return path.replace(/\/+$/, '') || '/';
}

/**
 * 絶対 URL。`path` はルートからのパスか絶対 URL
 * - `trailingSlash: false` はトップも `https://example.com` にする（既定はトップだけ `https://example.com/`）
 */
export function absoluteUrl(origin: Origin, path: string, options: Readonly<{ trailingSlash?: boolean }> = {}): string {
  const url = new URL(path, origin).href;
  return options.trailingSlash === false && new URL(url).pathname === '/' && !/[?#]/.test(url) ? url.replace(/\/$/, '') : url;
}

/** 正規の URL（`canonicalPath` を `origin` で絶対 URL にしたもの） */
export const canonicalUrl = (origin: Origin, pathname: string, options: Readonly<{ trailingSlash?: boolean }> = {}): string => absoluteUrl(origin, canonicalPath(pathname), options);

// URL の正規化の転送（www なし、末尾のスラッシュなし）

export type NormalizeOptions = Readonly<{
  /** 正規のホスト。指定すると、ほかのホストをこのホストへ転送する。既定は先頭の `www.` を外したホスト */
  host?: string;
  /** 末尾のスラッシュを外す（既定は真。トップの `/` は残す） */
  stripTrailingSlash?: boolean;
  /** 対象の外のパス（API の経路、末尾のスラッシュが要る経路など）。接頭辞の一覧か関数 */
  exclude?: readonly string[] | ((pathname: string) => boolean);
}>;

/**
 * 正規化した URL（www なし、末尾のスラッシュなし。クエリと断片は保つ）
 * - 対象の外のパスはホストだけを正規化する
 */
export function normalizeUrl(url: string | URL, options: NormalizeOptions = {}): string {
  const u = new URL(url);
  u.host = options.host ?? u.host.replace(/^www\./i, '');
  const excluded = typeof options.exclude === 'function' ? options.exclude(u.pathname) : (options.exclude ?? []).some((p) => u.pathname.startsWith(p));
  if (options.stripTrailingSlash !== false && !excluded && u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.href;
}

/**
 * 正規化の転送（`(Request) => Response | null`）。正規の URL と違えば状態301で転送し、同じなら `null`（次の処理へ）
 * - 転送するのは GET と HEAD だけ（ほかの方式は状態301の転送で GET に変わるため）
 * - 例: `return canonicalRedirect(request, { exclude: ['/api/'] }) ?? handle(request)`
 */
export function canonicalRedirect(request: Request, options: NormalizeOptions & Readonly<{ status?: 301 | 308 }> = {}): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const target = normalizeUrl(request.url, options);
  if (target === new URL(request.url).href) return null;
  return new Response(null, { status: options.status ?? 301, headers: { location: target } });
}

// メタタグ

/** OG の画像。`url` は絶対 URL */
export type OgImage = Readonly<{ url: string; alt?: string; width?: number; height?: number; type?: string }>;

export type MetaInput = Readonly<{
  /** `<title>` の文字列（サイト名との連結は使う側） */
  title: string;
  description?: string;
  /** 正規の URL。`noindex` のときは出さない */
  canonical?: string;
  /** 検索結果に載せない（`robots` を `noindex` にし、canonical と `og:url` を出さない） */
  noindex?: boolean;
  /** `robots` の値（`noindex` でないとき。例: `max-image-preview:large`） */
  robots?: string;
  /** `og:title`（既定は `title`） */
  ogTitle?: string;
  /** `og:type`（既定は `website`） */
  type?: 'website' | 'article' | (string & {});
  siteName?: string;
  /** `og:locale`（例: `ja_JP`） */
  locale?: string;
  image?: OgImage;
  /** `twitter:card`（既定は画像があれば `summary_large_image`、なければ出さない） */
  twitterCard?: 'summary' | 'summary_large_image';
  /** 記事の公開と更新の日時（ISO 8601）。`article:published_time`、`article:modified_time` */
  publishedTime?: string;
  modifiedTime?: string;
}>;

/** head の要素（データの形）。`text` は `<title>` の中身 */
export type HeadTag = Readonly<{ tag: 'title'; text: string }> | Readonly<{ tag: 'meta' | 'link'; attrs: Readonly<Record<string, string>> }>;

/** メタタグの一覧（データ）。フレームワークの head の部品に渡す */
export function metaTags(input: MetaInput): HeadTag[] {
  const tags: HeadTag[] = [{ tag: 'title', text: input.title }];
  const meta = (key: 'name' | 'property', name: string, content: string | number | undefined) => {
    if (content !== undefined && content !== '') tags.push({ tag: 'meta', attrs: { [key]: name, content: String(content) } });
  };
  const canonical = input.noindex ? undefined : input.canonical;
  meta('name', 'description', input.description);
  meta('name', 'robots', input.noindex ? 'noindex' : input.robots);
  if (canonical) tags.push({ tag: 'link', attrs: { rel: 'canonical', href: canonical } });
  meta('property', 'og:title', input.ogTitle ?? input.title);
  meta('property', 'og:type', input.type ?? 'website');
  meta('property', 'og:url', canonical);
  meta('property', 'og:description', input.description);
  meta('property', 'og:site_name', input.siteName);
  meta('property', 'og:locale', input.locale);
  meta('property', 'article:published_time', input.publishedTime);
  meta('property', 'article:modified_time', input.modifiedTime);
  if (input.image) {
    meta('property', 'og:image', input.image.url);
    meta('property', 'og:image:alt', input.image.alt);
    meta('property', 'og:image:width', input.image.width);
    meta('property', 'og:image:height', input.image.height);
    meta('property', 'og:image:type', input.image.type);
  }
  meta('name', 'twitter:card', input.twitterCard ?? (input.image ? 'summary_large_image' : undefined));
  return tags;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** head の要素の HTML（1行に1要素） */
export function headHtml(tags: readonly HeadTag[]): string {
  return tags
    .map((t) =>
      t.tag === 'title'
        ? `<title>${escapeHtml(t.text)}</title>`
        : `<${t.tag} ${Object.entries(t.attrs)
            .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
            .join(' ')}>`,
    )
    .join('\n');
}

/** メタタグの HTML（`headHtml(metaTags(input))`） */
export const metaTagsHtml = (input: MetaInput): string => headHtml(metaTags(input));

// JSON-LD

/** JSON-LD のノード */
export type JsonLd = Readonly<Record<string, unknown>>;

const CONTEXT = 'https://schema.org';

/**
 * script の中に置く JSON の文字列
 * - `<` を `\u003c` にし、値の `</script>` で要素が閉じないようにする
 */
export const jsonLdText = (data: JsonLd | readonly JsonLd[]): string => JSON.stringify(data).replace(/</g, '\\u003c');

/** `<script type="application/ld+json">` の HTML */
export const jsonLdScript = (data: JsonLd | readonly JsonLd[]): string => `<script type="application/ld+json">${jsonLdText(data)}</script>`;

/** 複数のノードを1つの `@graph` にまとめる（各ノードの `@context` は外す） */
export function jsonLdGraph(nodes: readonly JsonLd[]): JsonLd {
  return { '@context': CONTEXT, '@graph': nodes.map(({ '@context': _, ...rest }) => rest) };
}

/** 値が `undefined` の項目を外す */
const compact = (node: Record<string, unknown>): JsonLd => Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined));

/** 組織か人への参照（`@id` だけ、または種類と名前と URL） */
export type PartyRef = Readonly<{ '@id': string }> | Readonly<{ type: 'Organization' | 'Person'; name: string; url?: string }>;

const party = (ref: PartyRef): JsonLd => ('@id' in ref ? { '@id': ref['@id'] } : compact({ '@type': ref.type, name: ref.name, url: ref.url }));

/** 組織（Organization）。`id` を付けると、ほかのノードから `{ '@id': id }` で参照できる */
export function organizationJsonLd(input: Readonly<{ name: string; url: string; id?: string; logo?: string; sameAs?: readonly string[]; alternateName?: string }>): JsonLd {
  return compact({
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': input.id,
    name: input.name,
    alternateName: input.alternateName,
    url: input.url,
    logo: input.logo,
    sameAs: input.sameAs?.length ? input.sameAs : undefined,
  });
}

/** サイト（WebSite）。検索結果のサイト名の候補。トップのページに置く */
export function websiteJsonLd(input: Readonly<{ name: string; url: string; alternateName?: string; description?: string; inLanguage?: string; publisher?: PartyRef }>): JsonLd {
  return compact({
    '@context': CONTEXT,
    '@type': 'WebSite',
    name: input.name,
    alternateName: input.alternateName,
    url: input.url,
    description: input.description,
    inLanguage: input.inLanguage,
    publisher: input.publisher && party(input.publisher),
  });
}

/** パンくず（BreadcrumbList）。トップから順に。`url` のない段は現在のページ */
export function breadcrumbJsonLd(items: readonly Readonly<{ name: string; url?: string }>[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => compact({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

/** 記事（Article、`type` で BlogPosting、NewsArticle にもできる）。日時は ISO 8601 */
export function articleJsonLd(
  input: Readonly<{
    type?: 'Article' | 'BlogPosting' | 'NewsArticle';
    headline: string;
    url: string;
    description?: string;
    datePublished: string;
    dateModified?: string;
    images?: readonly string[];
    authors?: readonly PartyRef[];
    publisher?: PartyRef;
    inLanguage?: string;
  }>,
): JsonLd {
  return compact({
    '@context': CONTEXT,
    '@type': input.type ?? 'Article',
    headline: input.headline,
    description: input.description,
    url: input.url,
    mainEntityOfPage: input.url,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    image: input.images?.length ? input.images : undefined,
    author: input.authors?.length ? input.authors.map(party) : undefined,
    publisher: input.publisher && party(input.publisher),
    inLanguage: input.inLanguage,
  });
}

/** 一覧（ItemList）。項目は表示の順 */
export function itemListJsonLd(items: readonly Readonly<{ name: string; url: string }>[], input: Readonly<{ name?: string }> = {}): JsonLd {
  return compact({
    '@context': CONTEXT,
    '@type': 'ItemList',
    name: input.name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: it.url })),
  });
}

// sitemap と robots.txt

/** sitemap の1件。`loc` は絶対 URL か、`origin` を渡したときはルートからのパス */
export type SitemapEntry = Readonly<{ loc: string; lastmod?: string; changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'; priority?: number }>;

/** 1つの sitemap に入れられる URL の数（sitemaps.org の上限） */
export const SITEMAP_MAX_URLS = 50_000;

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

/**
 * sitemap の XML（sitemaps.org の形式）
 * - 同じ `loc` は最初の1件だけ残す。並びは渡した順
 * - 上限（`SITEMAP_MAX_URLS`）を超えたら `UsageError`（`sitemap_too_large`）。分けるときは `sitemapIndexXml`
 */
export function sitemapXml(entries: readonly SitemapEntry[], options: Readonly<{ origin?: Origin }> = {}): string {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const e of entries) {
    const loc = options.origin ? absoluteUrl(options.origin, e.loc) : e.loc;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const parts = [`<loc>${escapeXml(loc)}</loc>`];
    if (e.lastmod) parts.push(`<lastmod>${escapeXml(e.lastmod)}</lastmod>`);
    if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
    if (e.priority !== undefined) parts.push(`<priority>${e.priority.toFixed(1)}</priority>`);
    urls.push(`  <url>${parts.join('')}</url>`);
  }
  if (urls.length > SITEMAP_MAX_URLS) throw new UsageError('sitemap_too_large', `sitemap の URL が上限を超えた: ${urls.length}`);
  return [XML_HEAD, `<urlset xmlns="${NS}">`, ...urls, '</urlset>', ''].join('\n');
}

/** sitemap の索引の XML（複数の sitemap をまとめる） */
export function sitemapIndexXml(sitemaps: readonly Readonly<{ loc: string; lastmod?: string }>[]): string {
  const items = sitemaps.map((s) => `  <sitemap><loc>${escapeXml(s.loc)}</loc>${s.lastmod ? `<lastmod>${escapeXml(s.lastmod)}</lastmod>` : ''}</sitemap>`);
  return [XML_HEAD, `<sitemapindex xmlns="${NS}">`, ...items, '</sitemapindex>', ''].join('\n');
}

/** robots.txt の1つの規則 */
export type RobotsRule = Readonly<{ userAgent: string | readonly string[]; allow?: readonly string[]; disallow?: readonly string[] }>;

/**
 * robots.txt の本文
 * - 規則の既定は全体の許可（`User-agent: *`、`Allow: /`）
 * - 検索結果に載せないページは、ここで拒まずにページの `robots` メタタグで指定する（クロールを拒むとメタタグも読まれない）
 */
export function robotsTxt(input: Readonly<{ rules?: readonly RobotsRule[]; sitemaps?: readonly string[] }> = {}): string {
  const rules = input.rules ?? [{ userAgent: '*', allow: ['/'] }];
  const blocks = rules.map((r) =>
    [
      ...(typeof r.userAgent === 'string' ? [r.userAgent] : r.userAgent).map((ua) => `User-agent: ${ua}`),
      ...(r.allow ?? []).map((p) => `Allow: ${p}`),
      ...(r.disallow ?? []).map((p) => `Disallow: ${p}`),
    ].join('\n'),
  );
  const sitemaps = (input.sitemaps ?? []).map((s) => `Sitemap: ${s}`);
  return [...blocks, ...(sitemaps.length ? [sitemaps.join('\n')] : [])].join('\n\n') + '\n';
}
