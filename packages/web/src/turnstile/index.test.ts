import { ConfigError, TransientError } from '../core/index.ts';
import { describe, expect, it } from 'vitest';
import { TURNSTILE_TEST_KEYS, turnstileBotCheck } from './index.ts';

// siteverify の偽物: 送られたフォームを記録し、決めた応答を返す
const fakeFetch = (respond: (form: FormData) => Response | Promise<Response>) => {
  const sent: FormData[] = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(init?.body as FormData);
    return respond(init?.body as FormData);
  }) as typeof fetch;
  return Object.assign(fn, { sent });
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('判定の結果', () => {
  const check = () => turnstileBotCheck({ secret: 'secret', hostnames: ['app.example.com'], fetch: fakeFetch((form) => json(form.get('response') === 'good' ? { success: true, hostname: 'app.example.com' } : { success: false, 'error-codes': ['invalid-input-response'] })) });

  it('正しいトークンは通し、ないトークンは missing_token、不正なトークンは rejected', async () => {
    expect(await check().verify({ token: 'good' })).toEqual({ ok: true, value: undefined });
    for (const token of [undefined, null, '']) expect(await check().verify({ token })).toEqual({ ok: false, error: 'missing_token' });
    expect(await check().verify({ token: 'bad' })).toEqual({ ok: false, error: 'rejected' });
  });

  it('時間切れと読めない応答は TransientError', async () => {
    await expect(turnstileBotCheck({ secret: 's', hostnames: [], fetch: fakeFetch(() => Promise.reject(new DOMException('t', 'TimeoutError'))) }).verify({ token: 't' })).rejects.toBeInstanceOf(TransientError);
    await expect(turnstileBotCheck({ secret: 's', hostnames: [], fetch: fakeFetch(() => new Response('<html>')) }).verify({ token: 't' })).rejects.toBeInstanceOf(TransientError);
  });
});

describe('turnstileBotCheck', () => {
  it('秘密鍵・トークン・IP アドレスを送る', async () => {
    const fetch = fakeFetch(() => json({ success: true, hostname: 'app.example.com' }));
    await turnstileBotCheck({ secret: 's', hostnames: ['app.example.com'], fetch }).verify({ token: 't', remoteIp: '203.0.113.1' });
    expect(Object.fromEntries(fetch.sent[0]!)).toEqual({ secret: 's', response: 't', remoteip: '203.0.113.1' });
  });

  it('ホスト名と action を照合', async () => {
    const check = turnstileBotCheck({ secret: 's', hostnames: ['app.example.com'], fetch: fakeFetch(() => json({ success: true, hostname: 'evil.example.net', action: 'login' })) });
    expect(await check.verify({ token: 't' })).toEqual({ ok: false, error: 'hostname_mismatch' });
    const actions = turnstileBotCheck({ secret: 's', hostnames: ['app.example.com'], fetch: fakeFetch(() => json({ success: true, hostname: 'app.example.com', action: 'login' })) });
    expect(await actions.verify({ token: 't', action: 'inquiry' })).toEqual({ ok: false, error: 'action_mismatch' });
    expect((await actions.verify({ token: 't', action: 'login' })).ok).toBe(true);
  });

  it('テスト用の秘密鍵は example.com のホスト名を許し、action を照合しない', async () => {
    const check = turnstileBotCheck({ secret: TURNSTILE_TEST_KEYS.secret.pass, hostnames: ['app.example.com'], fetch: fakeFetch(() => json({ success: true, hostname: 'example.com' })) });
    expect((await check.verify({ token: TURNSTILE_TEST_KEYS.token, action: 'inquiry' })).ok).toBe(true);
  });

  it('使用済み・期限切れのトークンは rejected、長すぎるトークンは送らずに rejected', async () => {
    const fetch = fakeFetch(() => json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    const check = turnstileBotCheck({ secret: 's', hostnames: [], fetch });
    expect(await check.verify({ token: 't' })).toEqual({ ok: false, error: 'rejected' });
    expect(await check.verify({ token: 'x'.repeat(2049) })).toEqual({ ok: false, error: 'rejected' });
    expect(fetch.sent).toHaveLength(1);
  });

  it('秘密鍵の不足・不正は ConfigError、判定の API の障害は TransientError', async () => {
    const ok = fakeFetch(() => json({ success: true }));
    await expect(turnstileBotCheck({ secret: undefined, hostnames: [], fetch: ok }).verify({ token: 't' })).rejects.toBeInstanceOf(ConfigError);
    await expect(turnstileBotCheck({ secret: 's', hostnames: [], fetch: fakeFetch(() => json({ success: false, 'error-codes': ['invalid-input-secret'] })) }).verify({ token: 't' })).rejects.toBeInstanceOf(ConfigError);
    await expect(turnstileBotCheck({ secret: 's', hostnames: [], fetch: fakeFetch(() => json({ success: false, 'error-codes': ['internal-error'] })) }).verify({ token: 't' })).rejects.toBeInstanceOf(TransientError);
    await expect(turnstileBotCheck({ secret: 's', hostnames: [], fetch: fakeFetch(() => json({}, 502)) }).verify({ token: 't' })).rejects.toBeInstanceOf(TransientError);
    await expect(turnstileBotCheck({ secret: 's', hostnames: [], fetch: fakeFetch(() => Promise.reject(new TypeError('network'))) }).verify({ token: 't' })).rejects.toBeInstanceOf(TransientError);
  });
});
