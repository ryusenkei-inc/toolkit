import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addSite, domainProperty, gcloudAccessToken, serviceAccountToken, siteVerificationToken, submitSitemap } from './google.ts';
import { licenseAllowed, licenseViolations } from './licenses.ts';
import { checkUrls, formatCheckResults } from './verify.ts';

describe('checkUrls', () => {
  it('状態、本文、ヘッダー、転送先を確かめ、失敗した URL だけを試し直す', async () => {
    let hits = 0;
    const fetcher = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/slow')) return new Response(++hits < 2 ? 'old' : 'new build', { status: 200 });
      if (url.endsWith('/old/')) {
        expect(init.redirect).toBe('manual');
        return new Response(null, { status: 301, headers: { location: '/old' } });
      }
      return new Response('<h1>Top</h1> mock', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const results = await checkUrls(
      [
        { url: 'https://example.com/', includes: ['<h1>Top</h1>'], excludes: ['mock'], headers: { 'content-type': 'text/html' } },
        { url: 'https://example.com/slow', includes: ['new build'] },
        { url: 'https://example.com/old/', location: 'https://example.com/old' },
      ],
      { attempts: 3, intervalMs: 10, fetch: fetcher, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(results.map((r) => r.ok)).toEqual([false, true, true]);
    expect(results[0]!.problems).toEqual(['本文に「mock」がある']);
    expect(hits).toBe(2);
    expect(sleeps).toEqual([10, 10]);
    expect(formatCheckResults(results)).toEqual(['NG  https://example.com/: 本文に「mock」がある', 'ok  https://example.com/slow', 'ok  https://example.com/old/']);
  });

  it('要求の失敗と状態の違い', async () => {
    const fetcher = (async (url: string) => {
      if (url.includes('down')) throw new Error('ECONNREFUSED');
      return new Response('x', { status: 503 });
    }) as unknown as typeof fetch;
    const results = await checkUrls([{ url: 'https://down.example.com/' }, { url: 'https://example.com/', status: [200, 204] }], { fetch: fetcher });
    expect(results.map((r) => r.problems)).toEqual([['要求の失敗: ECONNREFUSED'], ['状態 503（期待は 200、204）']]);
  });
});

describe('licenses', () => {
  it('SPDX の式と違反の一覧', () => {
    expect(licenseAllowed('MIT')).toBe(true);
    expect(licenseAllowed('(MIT OR GPL-3.0)')).toBe(true);
    expect(licenseAllowed('MIT AND GPL-3.0')).toBe(false);
    expect(licenseAllowed('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(licenseAllowed('GPL-3.0', ['GPL-3.0'])).toBe(true);
    const listing = { MIT: [{ name: 'a', versions: ['1.0.0'] }], 'GPL-3.0': [{ name: 'b', versions: ['1.0.0', '2.0.0'] }, { name: 'c', versions: ['1.0.0'] }] };
    expect(licenseViolations(listing)).toEqual(['GPL-3.0: b@1.0.0,2.0.0', 'GPL-3.0: c@1.0.0']);
    expect(licenseViolations(listing, { ignore: ['c'] })).toEqual(['GPL-3.0: b@1.0.0,2.0.0']);
  });
});

describe('Google', () => {
  it('サービスアカウントの鍵で JWT を署名してトークンを取り、期限まで使い回す', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const bodies: URLSearchParams[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      bodies.push(init.body as URLSearchParams);
      return Response.json({ access_token: 'at', expires_in: 3600 });
    }) as unknown as typeof fetch;
    let now = 1_700_000_000_000;
    const token = serviceAccountToken({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }, ['scope-a', 'scope-b'], { fetch: fetcher, now: () => now });
    expect(await token()).toBe('at');
    now += 30 * 60_000;
    expect(await token()).toBe('at');
    expect(bodies).toHaveLength(1);
    const [header, payload, signature] = bodies[0]!.get('assertion')!.split('.');
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({ iss: 'sa@example.iam.gserviceaccount.com', scope: 'scope-a scope-b', aud: 'https://oauth2.googleapis.com/token' });
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });

  it('gcloud のトークンは取れなければ例外', async () => {
    await expect(gcloudAccessToken({ run: () => null })()).rejects.toThrow('gcloud_token_failed');
    expect(await gcloudAccessToken({ run: () => 'tok' })()).toBe('tok');
  });

  it('Search Console の API の要求', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', ...(init.body !== undefined && { body: String(init.body) }) });
      return url.endsWith('/token') ? Response.json({ token: 'google-site-verification=abc' }) : new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const options = { accessToken: async () => 'tok', fetch: fetcher };
    expect(await siteVerificationToken('example.com', options)).toBe('google-site-verification=abc');
    await addSite(domainProperty('example.com'), options);
    await submitSitemap('sc-domain:example.com', 'https://example.com/sitemap.xml', options);
    expect(calls).toEqual([
      { url: 'https://www.googleapis.com/siteVerification/v1/token', method: 'POST', body: '{"site":{"type":"INET_DOMAIN","identifier":"example.com"},"verificationMethod":"DNS_TXT"}' },
      { url: 'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com', method: 'PUT' },
      { url: 'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps/https%3A%2F%2Fexample.com%2Fsitemap.xml', method: 'PUT' },
    ]);
    const failing = { accessToken: async () => 'tok', fetch: (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch };
    await expect(addSite('sc-domain:example.com', failing)).rejects.toThrow('google_api_failed: PUT /webmasters/v3/sites/sc-domain%3Aexample.com 403 denied');
  });
});
