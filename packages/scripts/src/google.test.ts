import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addSite, gcloudAccessToken, googleAccessToken, serviceAccountToken, siteVerificationToken } from './google.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const key = { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey };

describe('serviceAccountToken', () => {
  it('RS256 の JWT でトークンを得て、期限の前は使い回す', async () => {
    const bodies: URLSearchParams[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      bodies.push(init.body as URLSearchParams);
      return Response.json({ access_token: `tok-${bodies.length}`, expires_in: 3600 });
    }) as unknown as typeof fetch;
    let now = 1_800_000_000_000;
    const token = serviceAccountToken(JSON.stringify(key), ['scope-a', 'scope-b'], { fetch: fetcher, now: () => now });
    expect(await token()).toBe('tok-1');
    expect(await token()).toBe('tok-1');
    now += 3600_000;
    expect(await token()).toBe('tok-2');
    const [header, payload, signature] = bodies[0]!.get('assertion')!.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: key.client_email, scope: 'scope-a scope-b', aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000 });
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('400 は鍵の誤りとして ConfigError、5xx と接続の失敗は TransientError', async () => {
    const make = (reply: () => Promise<Response>) => serviceAccountToken(key, ['s'], { fetch: reply as unknown as typeof fetch });
    await expect(make(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))()).rejects.toMatchObject({ name: 'ConfigError', key: 'GOOGLE_APPLICATION_CREDENTIALS' });
    await expect(make(async () => new Response(null, { status: 503 }))()).rejects.toMatchObject({ name: 'TransientError' });
    await expect(make(() => Promise.reject(new TypeError('offline')))()).rejects.toMatchObject({ name: 'TransientError' });
  });
});

describe('gcloudAccessToken と googleAccessToken', () => {
  it('gcloud のトークンを50分使い回し、取れなければ ConfigError', async () => {
    let n = 0;
    let now = 0;
    const token = gcloudAccessToken({ now: () => now, run: () => `g-${++n}` });
    expect([await token(), await token()]).toEqual(['g-1', 'g-1']);
    now = 50 * 60_000;
    expect(await token()).toBe('g-2');
    await expect(gcloudAccessToken({ run: () => null })()).rejects.toMatchObject({ name: 'ConfigError' });
  });

  it('GOOGLE_APPLICATION_CREDENTIALS がなければ gcloud のログインを使う', () => {
    expect(typeof googleAccessToken(['s'], { env: {} })).toBe('function');
  });
});

describe('Search Console の API', () => {
  const api = (status: number, body: unknown = {}) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, options: { accessToken: async () => 'tok', fetch: fetcher } };
  };

  it('トークンを付けて呼び、値を返す', async () => {
    const { calls, options } = api(200, { token: 'google-site-verification=abc' });
    expect(await siteVerificationToken('example.com', options)).toBe('google-site-verification=abc');
    expect(calls[0]!.url).toBe('https://www.googleapis.com/siteVerification/v1/token');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('403 は ConfigError、429 は TransientError、404 は UsageError（google_api_failed）', async () => {
    await expect(addSite('sc-domain:example.com', api(403).options)).rejects.toMatchObject({ name: 'ConfigError' });
    await expect(addSite('sc-domain:example.com', api(429).options)).rejects.toMatchObject({ name: 'TransientError' });
    await expect(addSite('sc-domain:example.com', api(404).options)).rejects.toMatchObject({ name: 'UsageError', code: 'google_api_failed' });
  });
});
