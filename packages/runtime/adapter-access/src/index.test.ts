import { authenticatorContract } from '@ryusenkei/auth/contract';
import { ConfigError, TransientError } from '@ryusenkei/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { accessAuthenticator } from './index.ts';

const TEAM = 'acme';
const AUD = 'aud-tag';
const ISS = `https://${TEAM}.cloudflareaccess.com`;
const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

let keyPair: CryptoKeyPair;
let other: CryptoKeyPair;
let jwk: JsonWebKey;

const algorithm = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
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
const claims = { aud: [AUD], iss: ISS, sub: 'user-1', email: 'user@example.com', exp: NOW + 600, nbf: NOW - 10 };
const request = (token?: string) => new Request('https://app.example.com/', { headers: token ? { 'cf-access-jwt-assertion': token } : {} });

const certs = () => {
  let calls = 0;
  const fn = (async () => {
    calls++;
    return Response.json({ keys: [jwk] });
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls: () => calls });
};
const make = (fetch: typeof globalThis.fetch = certs()) => accessAuthenticator({ team: TEAM, aud: AUD, fetch, now: () => NOW_MS });

describe('accessAuthenticator', () => {
  let valid: string;
  let invalid: string[];
  beforeAll(async () => {
    valid = await sign(claims);
    invalid = await Promise.all([
      sign({ ...claims, aud: ['other'] }),
      sign({ ...claims, iss: 'https://evil.cloudflareaccess.com' }),
      sign({ ...claims, exp: NOW - 120 }),
      sign({ ...claims, nbf: NOW + 120 }),
      sign(claims, { key: other.privateKey }),
      sign(claims, { kid: 'unknown' }),
      sign(claims, { alg: 'HS256' }),
    ]);
  });

  it('aud・iss・期限・署名・kid・alg の誤りは unauthenticated', async () => {
    const auth = make();
    for (const token of [...invalid, 'a.b', 'x.y.z', `${valid.slice(0, -4)}AAAA`]) expect(await auth.authenticate(request(token)), token.slice(0, 20)).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('JWT の groups を返す', async () => {
    expect(await make().authenticate(request(await sign({ ...claims, groups: ['admin', 1] })))).toMatchObject({ ok: true, value: { groups: ['admin'] } });
  });

  it('鍵の一覧はキャッシュし、知らない kid のときだけ取り直す', async () => {
    const fetch = certs();
    const auth = make(fetch);
    await auth.authenticate(request(valid));
    await auth.authenticate(request(valid));
    expect(fetch.calls()).toBe(1);
    await auth.authenticate(request(await sign(claims, { kid: 'rotated' })));
    expect(fetch.calls()).toBe(2);
  });

  it('設定の不足は ConfigError、鍵の一覧の取得の失敗は TransientError', async () => {
    await expect(accessAuthenticator({ team: undefined, aud: AUD }).authenticate(request(valid))).rejects.toBeInstanceOf(ConfigError);
    const down = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    await expect(make(down).authenticate(request(valid))).rejects.toBeInstanceOf(TransientError);
  });
});

// 契約の試験は同期で登録するので、トークンは beforeAll で作って要求の生成のときに読む
let validToken = '';
beforeAll(async () => {
  validToken = await sign(claims);
});
authenticatorContract('accessAuthenticator', () => make(), {
  valid: () => request(validToken),
  identity: { subject: 'user-1', email: 'user@example.com', groups: [] },
  invalid: [() => request(), () => request('a.b.c')],
});
