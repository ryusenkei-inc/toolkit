import { ConfigError } from '@ryusenkei/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { jwtFromRequest, jwtVerifier, type JwtVerifierOptions } from './jwt.ts';

const ISS = 'https://login.example.com';
const JWKS = 'https://login.example.com/.well-known/jwks.json';
const NOW_MS = 1_800_000_000_000;
const NOW = NOW_MS / 1000;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

const EC = { name: 'ECDSA', namedCurve: 'P-256' };
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
let ec: CryptoKeyPair;
let rsa: CryptoKeyPair;
let keys: JsonWebKey[];
beforeAll(async () => {
  ec = (await crypto.subtle.generateKey(EC, true, ['sign', 'verify'])) as CryptoKeyPair;
  rsa = (await crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])) as CryptoKeyPair;
  keys = [
    { ...(await crypto.subtle.exportKey('jwk', ec.publicKey)), kid: 'ec1' } as JsonWebKey,
    { ...(await crypto.subtle.exportKey('jwk', rsa.publicKey)), kid: 'rsa1', alg: 'RS256' } as JsonWebKey,
  ];
});

const signEs256 = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'ES256', kid: 'ec1' }) => {
  const input = `${text(header)}.${text(claims)}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ec.privateKey, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
};
const claims = { iss: ISS, aud: 'client-1', sub: 'u1', email: 'a@example.com', exp: NOW + 600 };
const jwks = (async () => Response.json({ keys })) as unknown as typeof fetch;
const make = (options: Partial<JwtVerifierOptions> = {}) => jwtVerifier({ issuer: ISS, audience: 'client-1', jwksUrl: JWKS, fetch: jwks, now: () => NOW_MS, ...options });

describe('jwtVerifier', () => {
  it('ES256 の JWT を検証し、クレームを返す', async () => {
    expect(await make().verify(await signEs256(claims))).toEqual({ ok: true, value: claims });
  });

  it('受け付けない形式、鍵の種類との不一致、JWK の alg との不一致、iss・aud の誤りは unauthenticated', async () => {
    const verifier = make();
    const bad = [
      await make({ algorithms: ['RS256'] }).verify(await signEs256(claims)),
      await verifier.verify(await signEs256(claims, { alg: 'RS256', kid: 'ec1' })),
      await verifier.verify(await signEs256(claims, { alg: 'ES256', kid: 'rsa1' })),
      await verifier.verify(await signEs256({ ...claims, iss: 'https://evil.example.com' })),
      await verifier.verify(await signEs256({ ...claims, aud: 'other' })),
      await verifier.verify(null),
    ];
    for (const r of bad) expect(r).toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('設定の不足は ConfigError', async () => {
    const token = await signEs256(claims);
    await expect(make({ issuer: undefined }).verify(token)).rejects.toBeInstanceOf(ConfigError);
    await expect(make({ jwksUrl: '' }).verify(token)).rejects.toMatchObject({ key: 'jwksUrl' });
    await expect(make({ audience: [] }).verify(token)).rejects.toMatchObject({ key: 'audience' });
  });
});

describe('jwtFromRequest', () => {
  const request = (headers: Record<string, string>) => new Request('https://app.example.com/', { headers });

  it('authorization は Bearer の形だけ、配列は値のある最初のヘッダー', () => {
    expect(jwtFromRequest(request({ authorization: 'Bearer abc' }), 'authorization')).toBe('abc');
    expect(jwtFromRequest(request({ authorization: 'Basic abc' }), 'authorization')).toBeUndefined();
    expect(jwtFromRequest(request({ 'x-operator-jwt': 'op' }), ['cf-access-jwt-assertion', 'x-operator-jwt'])).toBe('op');
    expect(jwtFromRequest(request({}), 'cf-access-jwt-assertion')).toBeUndefined();
  });
});
