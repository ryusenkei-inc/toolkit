import { ConfigError, TransientError } from '../core/index.ts';
import { beforeAll, describe, expect, it } from 'vitest';
import { accessAuthenticator } from './index.ts';

const TEAM = 'acme';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
let keyPair: CryptoKeyPair;
let other: CryptoKeyPair;
let jwk: JsonWebKey;
beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair;
  other = (await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair;
  jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' } as JsonWebKey;
});

const sign = async (claims: Record<string, unknown>, options: { kid?: string; alg?: string; key?: CryptoKey } = {}) => {
  const head = text({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'k1' });
  const body = text(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', options.key ?? keyPair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
};
const claims = { aud: [AUD], iss: ISS, sub: 'user-1', email: 'User@example.com', exp: NOW + 600, nbf: NOW - 10 };
const request = (token?: string) => new Request('https://app.example.com/', { headers: token ? { 'cf-access-jwt-assertion': token } : {} });

// 鍵の一覧の偽物（呼ばれた回数を数える）
const certs = () => {
  let calls = 0;
  const fn = (async () => {
    calls++;
    return Response.json({ keys: [jwk] });
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls: () => calls });
};
const make = (fetch: typeof globalThis.fetch = certs(), now = () => NOW_MS) => accessAuthenticator({ team: TEAM, aud: AUD, fetch, now });

describe('accessAuthenticator', () => {
  it('正しいトークンは利用者を返し、メールアドレスは小文字にする', async () => {
    expect(await make().authenticate(request(await sign(claims)))).toMatchObject({ ok: true, value: { kind: 'user', subject: 'user-1', email: 'user@example.com', groups: [] } });
  });

  it('サービストークンは service:<クライアントの ID>', async () => {
    const token = await sign({ aud: [AUD], iss: ISS, sub: '', common_name: 'abc.access', exp: NOW + 600 });
    expect(await make().authenticate(request(token))).toMatchObject({ ok: true, value: { kind: 'service', subject: 'service:abc.access', email: undefined, groups: [] } });
  });

  it('aud・iss・期限・署名・kid・alg・email_verified の誤りと、形の崩れは unauthenticated', async () => {
    const auth = make();
    const valid = await sign(claims);
    const bad = await Promise.all([
      sign({ ...claims, aud: ['other'] }),
      sign({ ...claims, iss: 'https://evil.cloudflareaccess.com' }),
      sign({ ...claims, exp: NOW - 120 }),
      sign({ ...claims, nbf: NOW + 120 }),
      sign({ ...claims, email_verified: false }),
      sign({ ...claims, email: undefined }),
      sign(claims, { key: other.privateKey }),
      sign(claims, { kid: 'unknown' }),
      sign(claims, { alg: 'HS256' }),
    ]);
    for (const token of [...bad, 'a.b', 'x.y.z', `${valid.slice(0, -4)}AAAA`]) expect(await auth.authenticate(request(token))).toEqual({ ok: false, error: 'unauthenticated' });
    expect(await auth.authenticate(request())).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('aud の配列は、トークンの aud がどれか1つに一致すれば受け付ける', async () => {
    const auth = accessAuthenticator({ team: TEAM, aud: ['first', AUD], fetch: certs(), now: () => NOW_MS });
    expect((await auth.authenticate(request(await sign(claims)))).ok).toBe(true);
    expect((await auth.authenticate(request(await sign({ ...claims, aud: 'first' })))).ok).toBe(true);
    expect(await auth.authenticate(request(await sign({ ...claims, aud: ['other'] })))).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('時計のずれは60秒まで許す', async () => {
    expect((await make().authenticate(request(await sign({ ...claims, exp: NOW - 30 })))).ok).toBe(true);
  });

  it('JWT の groups を文字列だけ返す', async () => {
    expect(await make().authenticate(request(await sign({ ...claims, groups: ['admin', 1] })))).toMatchObject({ ok: true, value: { groups: ['admin'] } });
  });

  it('鍵の一覧はキャッシュし、知らない kid での取り直しは30秒に1回まで', async () => {
    let t = NOW_MS;
    const fetch = certs();
    const auth = make(fetch, () => t);
    const valid = await sign(claims);
    const rotated = await sign(claims, { kid: 'rotated' });
    await auth.authenticate(request(valid));
    await auth.authenticate(request(valid));
    expect(fetch.calls()).toBe(1);
    t += 31_000;
    await auth.authenticate(request(rotated));
    await auth.authenticate(request(rotated));
    expect(fetch.calls()).toBe(2);
    t += 31_000;
    await auth.authenticate(request(rotated));
    expect(fetch.calls()).toBe(3);
  });

  it('設定の不足は ConfigError、鍵の一覧の取得・読み取りの失敗は TransientError', async () => {
    const valid = await sign(claims);
    await expect(accessAuthenticator({ team: undefined, aud: AUD }).authenticate(request(valid))).rejects.toBeInstanceOf(ConfigError);
    await expect(accessAuthenticator({ team: TEAM, aud: [] }).authenticate(request(valid))).rejects.toBeInstanceOf(ConfigError);
    await expect(accessAuthenticator({ team: TEAM, aud: [''] }).authenticate(request(valid))).rejects.toBeInstanceOf(ConfigError);
    await expect(make((async () => new Response(null, { status: 503 })) as unknown as typeof fetch).authenticate(request(valid))).rejects.toBeInstanceOf(TransientError);
    await expect(make((async () => new Response('<html>')) as unknown as typeof fetch).authenticate(request(valid))).rejects.toBeInstanceOf(TransientError);
    await expect(make((async () => Promise.reject(new DOMException('t', 'TimeoutError'))) as unknown as typeof fetch).authenticate(request(valid))).rejects.toBeInstanceOf(TransientError);
  });
});
