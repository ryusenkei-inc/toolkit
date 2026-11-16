import { ConfigError } from '@ryusenkei/core';
import { describe, expect, it } from 'vitest';
import { generateStandardWebhookSecret, standardWebhookHeaders, standardWebhookSignature, verifyStandardWebhook, verifyStandardWebhookRequest } from './index.ts';

// 参照の実装（standard-webhooks、MIT）の試験と仕様の例の値
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const TIMESTAMP = 1614265330;
const BODY = '{"test": 2432232314}';
const SIGNATURE = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
const NOW = TIMESTAMP * 1000;
const headersOf = (signature: string, id = ID, timestamp = String(TIMESTAMP)) => ({ 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature });

describe('standardWebhookSignature', () => {
  it('参照の実装と同じ署名になる', async () => {
    expect(await standardWebhookSignature(SECRET, { id: ID, body: BODY }, TIMESTAMP)).toBe(SIGNATURE);
    expect(await standardWebhookSignature(SECRET, { id: ID, body: new TextEncoder().encode(BODY) }, TIMESTAMP)).toBe(SIGNATURE);
  });

  it('whsec_ がなくても base64 の鍵として読む', async () => {
    expect(await standardWebhookSignature(SECRET.slice('whsec_'.length), { id: ID, body: BODY }, TIMESTAMP)).toBe(SIGNATURE);
  });

  it('鍵の入れ替え: 鍵ごとの v1 を空白で並べる', async () => {
    const other = generateStandardWebhookSecret();
    const both = await standardWebhookSignature([SECRET, other], { id: ID, body: BODY }, TIMESTAMP);
    expect(both.split(' ')).toEqual([SIGNATURE, await standardWebhookSignature(other, { id: ID, body: BODY }, TIMESTAMP)]);
  });

  it('鍵が空か形が違えば ConfigError', async () => {
    await expect(standardWebhookSignature('', { id: ID, body: BODY }, TIMESTAMP)).rejects.toBeInstanceOf(ConfigError);
    await expect(standardWebhookSignature('whsec_!!!', { id: ID, body: BODY }, TIMESTAMP)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('verifyStandardWebhook', () => {
  it('参照の実装の署名が通り、ID と時刻を返す', async () => {
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE), BODY, { now: () => NOW })).toEqual({ ok: true, value: { id: ID, timestamp: TIMESTAMP } });
  });

  it('本文、ID、時刻、鍵の違いは不一致', async () => {
    const mismatch = { ok: false, error: 'signature_mismatch' };
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE), '{"test": 2432232315}', { now: () => NOW })).toEqual(mismatch);
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE, 'msg_other'), BODY, { now: () => NOW })).toEqual(mismatch);
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE, ID, String(TIMESTAMP + 1)), BODY, { now: () => NOW })).toEqual(mismatch);
    expect(await verifyStandardWebhook(generateStandardWebhookSecret(), headersOf(SIGNATURE), BODY, { now: () => NOW })).toEqual(mismatch);
  });

  it('時刻のずれは既定で前後300秒まで、toleranceSec で変えられる', async () => {
    expect((await verifyStandardWebhook(SECRET, headersOf(SIGNATURE), BODY, { now: () => NOW + 300_000 })).ok).toBe(true);
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE), BODY, { now: () => NOW + 301_000 })).toEqual({ ok: false, error: 'signature_expired' });
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE), BODY, { now: () => NOW - 301_000 })).toEqual({ ok: false, error: 'signature_expired' });
    expect((await verifyStandardWebhook(SECRET, headersOf(SIGNATURE), BODY, { now: () => NOW + 600_000, toleranceSec: 600 })).ok).toBe(true);
  });

  it('署名のどれかが合えば通り、v1 以外の版と壊れた署名は無視する', async () => {
    const list = `v1a,${SIGNATURE.slice(3)} v1,AAAA v1,!!! ${SIGNATURE}`;
    expect((await verifyStandardWebhook(SECRET, headersOf(list), BODY, { now: () => NOW })).ok).toBe(true);
    expect(await verifyStandardWebhook(SECRET, headersOf(`v2,${SIGNATURE.slice(3)}`), BODY, { now: () => NOW })).toEqual({ ok: false, error: 'signature_missing' });
  });

  it('鍵の入れ替え: 鍵のどれかが合えば通る', async () => {
    expect((await verifyStandardWebhook([generateStandardWebhookSecret(), SECRET], headersOf(SIGNATURE), BODY, { now: () => NOW })).ok).toBe(true);
  });

  it('ヘッダーがない、時刻が数でないときは signature_missing', async () => {
    const missing = { ok: false, error: 'signature_missing' };
    expect(await verifyStandardWebhook(SECRET, {}, BODY, { now: () => NOW })).toEqual(missing);
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE, ''), BODY, { now: () => NOW })).toEqual(missing);
    expect(await verifyStandardWebhook(SECRET, headersOf(SIGNATURE, ID, '16142653.30'), BODY, { now: () => NOW })).toEqual(missing);
    expect(await verifyStandardWebhook(SECRET, headersOf(''), BODY, { now: () => NOW })).toEqual(missing);
  });

  it('ヘッダーの名前の大文字と小文字を区別しない', async () => {
    const headers = { 'Webhook-Id': ID, 'Webhook-Timestamp': String(TIMESTAMP), 'Webhook-Signature': SIGNATURE };
    expect((await verifyStandardWebhook(SECRET, headers, BODY, { now: () => NOW })).ok).toBe(true);
  });

  it('鍵が空なら ConfigError（検証を飛ばして通さない）', async () => {
    await expect(verifyStandardWebhook(undefined, headersOf(SIGNATURE), BODY)).rejects.toBeInstanceOf(ConfigError);
    await expect(verifyStandardWebhook(['', ''], headersOf(SIGNATURE), BODY)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('standardWebhookHeaders と verifyStandardWebhookRequest', () => {
  it('送る側のヘッダーで受ける側が通り、本文は後で読める', async () => {
    const secret = generateStandardWebhookSecret();
    const headers = await standardWebhookHeaders(secret, { id: 'msg_1', body: BODY }, { now: () => NOW, init: { 'content-type': 'application/json' } });
    expect(headers.get('webhook-id')).toBe('msg_1');
    expect(headers.get('webhook-timestamp')).toBe(String(TIMESTAMP));
    expect(headers.get('content-type')).toBe('application/json');
    const request = new Request('https://example.com/hooks', { method: 'POST', headers, body: BODY });
    expect(await verifyStandardWebhookRequest(secret, request, { now: () => NOW })).toEqual({ ok: true, value: { id: 'msg_1', timestamp: TIMESTAMP } });
    expect(await request.text()).toBe(BODY);
  });

  it('参照の値の要求が通り、署名のヘッダーがなければ signature_missing', async () => {
    const request = new Request('https://example.com/hooks', { method: 'POST', headers: headersOf(SIGNATURE), body: BODY });
    expect((await verifyStandardWebhookRequest(SECRET, request, { now: () => NOW })).ok).toBe(true);
    const unsigned = new Request('https://example.com/hooks', { method: 'POST', body: BODY });
    expect(await verifyStandardWebhookRequest(SECRET, unsigned, { now: () => NOW })).toEqual({ ok: false, error: 'signature_missing' });
  });
});

describe('generateStandardWebhookSecret', () => {
  it('whsec_ と24バイトの base64', () => {
    const secret = generateStandardWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    expect(generateStandardWebhookSecret()).not.toBe(secret);
  });
});
