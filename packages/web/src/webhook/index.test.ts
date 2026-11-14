import { ConfigError } from '@ryusenkei/core';
import { describe, expect, it } from 'vitest';
import { requestScheme, signWebhook, verifyWebhook, verifyWebhookRequest, webhookHeaders, type WebhookScheme } from './index.ts';

const NOW = 1_800_000_000_000;
const parts = { method: 'POST', url: 'https://hooks.example.com/in?x=1', body: '{"a":1}' };
const passed = { ok: true, value: undefined };

describe('signWebhook と verifyWebhook', () => {
  it('同じ鍵と内容なら通り、本文・パス・主体の違いは不一致', async () => {
    const header = await signWebhook('s', parts, { now: NOW });
    expect(header).toMatch(/^t=1800000000,v1=[\w-]+$/);
    expect(await verifyWebhook('s', header, parts, { now: NOW })).toEqual(passed);
    expect(await verifyWebhook('s', header, { ...parts, body: '{"a":2}' }, { now: NOW })).toEqual({ ok: false, error: 'signature_mismatch' });
    expect(await verifyWebhook('s', header, { ...parts, url: 'https://hooks.example.com/in?x=2' }, { now: NOW })).toEqual({ ok: false, error: 'signature_mismatch' });
    expect(await verifyWebhook('s', header, { ...parts, subject: 'a@example.com' }, { now: NOW })).toEqual({ ok: false, error: 'signature_mismatch' });
    expect(await verifyWebhook('other', header, parts, { now: NOW })).toEqual({ ok: false, error: 'signature_mismatch' });
  });

  it('既定の形式は v1・時刻・メソッド・パスとクエリ・主体・本文の SHA-256 を改行でつないだもの', async () => {
    const enc = new TextEncoder();
    const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const digest = b64url(await crypto.subtle.digest('SHA-256', enc.encode(parts.body)));
    const key = await crypto.subtle.importKey('raw', enc.encode('s'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`v1\n1800000000\nPOST\n/in?x=1\na@example.com\n${digest}`)));
    expect(await signWebhook('s', { ...parts, subject: 'a@example.com' }, { now: NOW })).toBe(`t=1800000000,v1=${mac}`);
  });

  it('ホスト名は署名の対象外で、本文は文字列とバイト列で同じ', async () => {
    const header = await signWebhook('s', parts, { now: NOW });
    expect(await verifyWebhook('s', header, { ...parts, url: 'http://localhost:8787/in?x=1', body: new TextEncoder().encode(parts.body) }, { now: NOW })).toEqual(passed);
  });

  it('時刻のずれは既定で前後300秒まで、toleranceSec で変えられる', async () => {
    const header = await signWebhook('s', parts, { now: NOW });
    expect(await verifyWebhook('s', header, parts, { now: NOW + 300_000 })).toEqual(passed);
    expect(await verifyWebhook('s', header, parts, { now: NOW + 301_000 })).toEqual({ ok: false, error: 'signature_expired' });
    expect(await verifyWebhook('s', header, parts, { now: NOW - 301_000 })).toEqual({ ok: false, error: 'signature_expired' });
    expect(await verifyWebhook('s', header, parts, { now: NOW + 600_000, toleranceSec: 600 })).toEqual(passed);
  });

  it('鍵の入れ替え: 鍵ごとの v1 を並べ、検証は鍵のどれかと v1 のどれかが合えば通る', async () => {
    const both = await signWebhook(['new', 'old'], parts, { now: NOW });
    const [a, b] = [await signWebhook('new', parts, { now: NOW }), await signWebhook('old', parts, { now: NOW })];
    expect(both).toBe(`${a},${b.split(',')[1]}`);
    expect(await verifyWebhook('old', both, parts, { now: NOW })).toEqual(passed);
    expect(await verifyWebhook(['new', 'old'], b, parts, { now: NOW })).toEqual(passed);
  });

  it('ヘッダーがない、形が違う、署名が壊れているときは失敗', async () => {
    expect(await verifyWebhook('s', null, parts, { now: NOW })).toEqual({ ok: false, error: 'signature_missing' });
    expect(await verifyWebhook('s', 'v1=abc', parts, { now: NOW })).toEqual({ ok: false, error: 'signature_missing' });
    expect(await verifyWebhook('s', 't=1800000000', parts, { now: NOW })).toEqual({ ok: false, error: 'signature_missing' });
    expect(await verifyWebhook('s', 't=1800000000,v1=!!!', parts, { now: NOW })).toEqual({ ok: false, error: 'signature_mismatch' });
  });

  it('鍵が空なら ConfigError（検証を飛ばして通さない）', async () => {
    await expect(verifyWebhook(undefined, 't=1,v1=a', parts)).rejects.toBeInstanceOf(ConfigError);
    await expect(verifyWebhook(['', ''], 't=1,v1=a', parts)).rejects.toBeInstanceOf(ConfigError);
    await expect(signWebhook('', parts)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('署名の形式', () => {
  it('時刻と本文を点でつなぎ、16進で署名する形式', async () => {
    const dotted: WebhookScheme = { message: ({ timestamp, body }) => [`${timestamp}.`, body], encoding: 'hex' };
    const header = await signWebhook('s', parts, { now: NOW, scheme: dotted });
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    // 同じ値を Web Crypto で直に計算して比べる
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`1800000000.${parts.body}`)));
    expect(header.split('v1=')[1]).toBe(Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join(''));
    expect(await verifyWebhook('s', header, parts, { now: NOW, scheme: dotted })).toEqual(passed);
  });

  it('base64 の署名は末尾の = ごと読む', async () => {
    const padded: WebhookScheme = { ...requestScheme, encoding: 'base64' };
    const header = await signWebhook('s', parts, { now: NOW, scheme: padded });
    expect(header).toMatch(/=$/);
    expect(await verifyWebhook('s', header, parts, { now: NOW, scheme: padded })).toEqual(passed);
  });

  it('plain: 署名だけを前置きつきで送り、時刻は照合しない', async () => {
    const plain: WebhookScheme = { message: ({ body }) => body, encoding: 'hex', header: 'plain', prefix: 'sha256=' };
    const header = await signWebhook(['s', 'old'], parts, { now: NOW, scheme: plain });
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifyWebhook('s', header, parts, { now: 0, scheme: plain })).toEqual(passed);
    expect(await verifyWebhook('s', header.slice('sha256='.length), parts, { scheme: plain })).toEqual({ ok: false, error: 'signature_missing' });
  });
});

describe('webhookHeaders と verifyWebhookRequest', () => {
  it('署名と主体を付けた要求を、ヘッダーの名前を指定して検証する。本文は後で読める', async () => {
    const headers = await webhookHeaders('s', { ...parts, subject: 'a@example.com' }, { header: 'x-app-signature', subjectHeader: 'x-app-email', init: { 'content-type': 'application/json' } });
    expect(headers.get('x-app-email')).toBe('a@example.com');
    expect(headers.get('content-type')).toBe('application/json');
    const request = new Request(parts.url, { method: 'POST', headers, body: parts.body });
    expect(await verifyWebhookRequest('s', request, { header: 'x-app-signature', subjectHeader: 'x-app-email' })).toEqual(passed);
    // 主体のヘッダーを読まない検証は、主体を空として照合するので合わない
    expect(await verifyWebhookRequest('s', request, { header: 'x-app-signature' })).toEqual({ ok: false, error: 'signature_mismatch' });
    expect(await request.text()).toBe(parts.body);
    expect(await verifyWebhookRequest('s', new Request(parts.url), { header: 'x-app-signature' })).toEqual({ ok: false, error: 'signature_missing' });
  });

  it('本文のない GET も検証できる', async () => {
    const url = 'https://site.example.com/articles/1';
    const headers = await webhookHeaders(['s'], { method: 'GET', url }, { header: 'x-preview-signature' });
    expect(await verifyWebhookRequest('s', new Request(url, { headers }), { header: 'x-preview-signature' })).toEqual(passed);
  });
});
