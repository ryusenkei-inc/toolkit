import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  articleJsonLd,
  breadcrumbJsonLd,
  canonicalPath,
  canonicalUrl,
  itemListJsonLd,
  jsonLdGraph,
  jsonLdScript,
  jsonLdText,
  metaTags,
  metaTagsHtml,
  organizationJsonLd,
  robotsTxt,
  sitemapIndexXml,
  sitemapXml,
  websiteJsonLd,
} from './index.ts';

describe('正規の URL', () => {
  it('クエリ、.html、index、末尾のスラッシュを外し、トップは /', () => {
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath('/index.html')).toBe('/');
    expect(canonicalPath('/blog/')).toBe('/blog');
    expect(canonicalPath('/blog/index')).toBe('/blog');
    expect(canonicalPath('/about.html?x=1#top')).toBe('/about');
  });

  it('絶対 URL。トップの末尾のスラッシュは選べる', () => {
    expect(absoluteUrl('https://example.com', '/')).toBe('https://example.com/');
    expect(absoluteUrl('https://example.com/', '/', { trailingSlash: false })).toBe('https://example.com');
    expect(absoluteUrl(new URL('https://example.com'), '/a b')).toBe('https://example.com/a%20b');
    expect(canonicalUrl('https://example.com', '/blog/')).toBe('https://example.com/blog');
  });
});

describe('metaTags', () => {
  it('title、説明、canonical、OG、画像と twitter:card', () => {
    const tags = metaTags({
      title: 'Post | Example',
      ogTitle: 'Post',
      description: 'A "quoted" <post>',
      canonical: 'https://example.com/post',
      robots: 'max-image-preview:large',
      type: 'article',
      siteName: 'Example',
      locale: 'ja_JP',
      image: { url: 'https://example.com/og.png', alt: 'Post', width: 1200, height: 630, type: 'image/png' },
      publishedTime: '2026-11-14T09:00:00+09:00',
    });
    expect(tags[0]).toEqual({ tag: 'title', text: 'Post | Example' });
    expect(tags).toContainEqual({ tag: 'link', attrs: { rel: 'canonical', href: 'https://example.com/post' } });
    expect(tags).toContainEqual({ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } });
    expect(tags).toContainEqual({ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } });
    expect(tags.find((t) => t.tag === 'meta' && t.attrs.property === 'og:title')).toEqual({ tag: 'meta', attrs: { property: 'og:title', content: 'Post' } });
    expect(metaTagsHtml({ title: 'A & B', description: 'A "quoted" <post>' })).toBe(
      ['<title>A &amp; B</title>', '<meta name="description" content="A &quot;quoted&quot; &lt;post&gt;">', '<meta property="og:title" content="A &amp; B">', '<meta property="og:type" content="website">', '<meta property="og:description" content="A &quot;quoted&quot; &lt;post&gt;">'].join('\n'),
    );
  });

  it('noindex は canonical と og:url を出さない', () => {
    const tags = metaTags({ title: 'Draft', canonical: 'https://example.com/draft', noindex: true, robots: 'max-image-preview:large' });
    expect(tags).toContainEqual({ tag: 'meta', attrs: { name: 'robots', content: 'noindex' } });
    expect(tags.some((t) => t.tag === 'link' || (t.tag === 'meta' && t.attrs.property === 'og:url'))).toBe(false);
  });
});

describe('JSON-LD', () => {
  it('埋め込みの文字列は < を逃がす', () => {
    expect(jsonLdText({ name: '</script>' })).toBe('{"name":"\\u003c/script>"}');
    expect(jsonLdScript({ a: 1 })).toBe('<script type="application/ld+json">{"a":1}</script>');
  });

  it('組織、サイト、パンくず、記事、一覧、@graph', () => {
    const org = organizationJsonLd({ id: 'https://example.com/#organization', name: 'Example', url: 'https://example.com/', sameAs: [] });
    expect(org).toEqual({ '@context': 'https://schema.org', '@type': 'Organization', '@id': 'https://example.com/#organization', name: 'Example', url: 'https://example.com/' });
    expect(websiteJsonLd({ name: 'Example', url: 'https://example.com/', inLanguage: 'ja', publisher: { '@id': 'https://example.com/#organization' } })).toMatchObject({ publisher: { '@id': 'https://example.com/#organization' } });
    expect(breadcrumbJsonLd([{ name: 'Top', url: 'https://example.com/' }, { name: 'Post' }]).itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Top', item: 'https://example.com/' },
      { '@type': 'ListItem', position: 2, name: 'Post' },
    ]);
    expect(articleJsonLd({ headline: 'Post', url: 'https://example.com/post', datePublished: '2026-11-14', authors: [{ type: 'Organization', name: 'Editors' }] })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Post',
      url: 'https://example.com/post',
      mainEntityOfPage: 'https://example.com/post',
      datePublished: '2026-11-14',
      dateModified: '2026-11-14',
      author: [{ '@type': 'Organization', name: 'Editors' }],
    });
    expect(itemListJsonLd([{ name: 'A', url: 'https://example.com/a' }])).toMatchObject({ numberOfItems: 1 });
    expect(jsonLdGraph([org])).toEqual({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization', '@id': 'https://example.com/#organization', name: 'Example', url: 'https://example.com/' }] });
  });
});

describe('sitemap と robots.txt', () => {
  it('sitemap はパスを絶対 URL にし、重複を除き、XML の文字を逃がす', () => {
    expect(sitemapXml([{ loc: '/' }, { loc: '/a?x=1&y=2', lastmod: '2026-11-14', priority: 0.5 }, { loc: '/' }], { origin: 'https://example.com' })).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url><loc>https://example.com/</loc></url>',
        '  <url><loc>https://example.com/a?x=1&amp;y=2</loc><lastmod>2026-11-14</lastmod><priority>0.5</priority></url>',
        '</urlset>',
        '',
      ].join('\n'),
    );
    expect(sitemapIndexXml([{ loc: 'https://example.com/sitemap-1.xml' }])).toContain('<sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>');
  });

  it('robots.txt の既定は全体の許可で、規則と sitemap を並べる', () => {
    expect(robotsTxt({ sitemaps: ['https://example.com/sitemap.xml'] })).toBe('User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n');
    expect(robotsTxt({ rules: [{ userAgent: ['*'], allow: ['/'], disallow: ['/legal/'] }] })).toBe('User-agent: *\nAllow: /\nDisallow: /legal/\n');
  });
});
