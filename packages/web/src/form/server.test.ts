import { ConfigError, TransientError } from '@ryusenkei/core';
import { memoryMailer } from '../mail/testing.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitForm } from './client.ts';
import { defineForm } from './index.ts';
import { httpDestination, jwtAuthenticator, mailDestination, notificationText, submissionHandler, webhookDestination, type Destination, type Submission, type SubmissionOnce } from './server.ts';
import { fakeAuthenticator, fakeBotCheck, fakeRateLimiter, memoryDailyQuota, memoryDestination, memorySubmissionOnce } from './testing.ts';
import { verifyWebhook } from '../webhook/index.ts';

afterEach(() => vi.restoreAllMocks());
const quiet = () => {
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
};

const feedback = defineForm({ fields: { email: { kind: 'email' }, message: { kind: 'multiline', maxLength: 1000, required: true } } });
const inquiry = defineForm({ fields: { name: { kind: 'text', maxLength: 100, required: true }, email: { kind: 'email', required: true }, message: { kind: 'multiline', maxLength: 1000, required: true } } });

const setup = () => {
  const bot = fakeBotCheck();
  const limiter = fakeRateLimiter();
  const a = memoryDestination('a');
  const b = memoryDestination('b');
  const handle = submissionHandler({ forms: { inquiry, feedback }, destinations: [a, b], rateLimiter: limiter, botCheck: bot, now: () => Date.parse('2026-11-07T00:00:00Z') });
  return { bot, limiter, a, b, handle };
};
const post = (fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request('https://app.example.com/api/form', { method: 'POST', body, headers: { 'cf-connecting-ip': '203.0.113.1', ...headers } });
};
const ok = { form: 'inquiry', name: '山田', email: 'taro@example.com', message: '本文', 'cf-turnstile-response': 'tok' };

describe('submissionHandler', () => {
  it('受け付けた送信をすべての届け先へ渡し、200 を返す', async () => {
    quiet();
    const t = setup();
    const res = await t.handle(post(ok));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(t.a.received).toEqual([{ form: 'inquiry', values: { name: '山田', email: 'taro@example.com', message: '本文' }, order: ['name', 'email', 'message'], receivedAt: '2026-11-07T00:00:00.000Z' }]);
    expect(t.b.received).toHaveLength(1);
    expect(t.limiter.keys).toEqual(['form:203.0.113.1']);
    expect(t.bot.calls).toEqual([{ token: 'tok', remoteIp: '203.0.113.1' }]);
  });

  it('検査を先に行い、誤った送信は数えず判定もしない', async () => {
    const t = setup();
    const res = await t.handle(post({ ...ok, email: 'bad' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid', problems: [{ path: 'email', code: 'invalid_email' }] });
    expect(t.limiter.keys).toEqual([]);
    expect(t.bot.calls).toEqual([]);
  });

  it('フォームの名前の改変は invalid（unknown_form）', async () => {
    const t = setup();
    for (const form of ['other', '__proto__', '']) expect(await (await t.handle(post({ ...ok, form }))).json()).toMatchObject({ error: 'invalid', problems: [{ path: '', code: 'unknown_form' }] });
  });

  it('回数の上限は 429、bot の判定で拒否は 403。どちらも届け先に渡さない', async () => {
    const t = setup();
    t.limiter.allow(false);
    expect((await t.handle(post(ok))).status).toBe(429);
    t.limiter.allow(true);
    t.bot.allow(false);
    const res = await t.handle(post(ok));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'bot_check_failed' });
    expect(t.a.received).toEqual([]);
  });

  it('届け先の1つが失敗しても、ほかが成功すれば 200。すべて失敗なら 502', async () => {
    quiet();
    const t = setup();
    t.a.fail('throw');
    expect((await t.handle(post(ok))).status).toBe(200);
    t.b.fail('value');
    const res = await t.handle(post(ok));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'unavailable' });
  });

  it('入力の値をログに出さない', async () => {
    const logs: string[] = [];
    for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((line: string) => void logs.push(line));
    const t = setup();
    t.a.fail('throw');
    await t.handle(post(ok));
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) for (const value of ['山田', 'taro@example.com', '本文']) expect(line).not.toContain(value);
  });

  it('基盤の失敗は core の応答（一時的は 503、設定の不足は 503 not_configured）', async () => {
    quiet();
    const transient = submissionHandler({ forms: { feedback }, destinations: [], botCheck: { verify: () => Promise.reject(new TransientError('down')) } });
    expect((await transient(post({ message: 'x' }))).status).toBe(503);
    const config = submissionHandler({ forms: { feedback }, destinations: [], rateLimiter: { limit: () => Promise.reject(new ConfigError('no binding')) } });
    expect(await (await config(post({ message: 'x' }))).json()).toMatchObject({ error: 'not_configured' });
  });

  it('フォームが1つなら名前を省略でき、JSON の本文も受け取る', async () => {
    quiet();
    const d = memoryDestination();
    const handle = submissionHandler({ forms: { feedback }, destinations: [d] });
    const res = await handle(new Request('https://app.example.com/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '良い' }) }));
    expect(res.status).toBe(200);
    expect(d.received[0]?.form).toBe('feedback');
  });

  it('POST 以外は 405、大きすぎる本文は 413、読めない本文は 400', async () => {
    const handle = submissionHandler({ forms: { feedback }, destinations: [memoryDestination('a')], maxBodyBytes: 10 });
    expect((await handle(new Request('https://app.example.com/'))).status).toBe(405);
    expect((await handle(new Request('https://app.example.com/', { method: 'POST', body: 'x'.repeat(11) }))).status).toBe(413);
    const json = submissionHandler({ forms: { feedback }, destinations: [memoryDestination('a')] });
    expect((await json(new Request('https://app.example.com/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1]' }))).status).toBe(400);
  });

  it('届け先が0件なら 503 not_configured', async () => {
    quiet();
    const res = await submissionHandler({ forms: { feedback }, destinations: [] })(post({ message: '本文' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'not_configured' });
  });

  it('acceptedId で届け先の値から受付の番号を応答に入れ、submitForm が返す', async () => {
    quiet();
    const store: Destination = { name: 'store', deliver: async () => ({ ok: true, value: { id: '42' } }) };
    const handle = submissionHandler({ forms: { feedback }, destinations: [store, memoryDestination('log')], acceptedId: (r) => (r.store?.ok ? (r.store.value as { id: string }).id : null) });
    const res = await handle(post({ message: '本文' }));
    expect(await res.json()).toMatchObject({ ok: true, id: '42' });
    const fetcher = (async (_url: string, init: RequestInit) => handle(new Request('https://app.example.com/', init))) as unknown as typeof fetch;
    const body = new FormData();
    body.set('message', '本文');
    expect(await submitForm('/api/form', body, { fetch: fetcher })).toEqual({ ok: true, id: '42' });
  });
});

const submission: Submission = { form: 'inquiry', values: { name: '山田', email: 'taro@example.com', message: '本文' }, order: ['company', 'name', 'email', 'message'], receivedAt: '2026-11-07T00:00:00.000Z' };
const copy = { labels: { company: '会社名', name: '名前', email: 'メール', message: '内容' }, footer: '-- フォームから送信' };

describe('届け先', () => {
  it('通知の本文は宣言の順で、未入力は既定の表示', () => {
    expect(notificationText(submission, copy)).toBe('■ 会社名\n—\n\n■ 名前\n山田\n\n■ メール\ntaro@example.com\n\n■ 内容\n本文\n\n-- フォームから送信');
  });

  it('メール: 返信先は送信した人', async () => {
    const mailer = memoryMailer();
    const dest = mailDestination({ mailer, from: { email: 'noreply@example.com', name: 'Site' }, to: { email: 'owner@example.com' }, subject: (s) => `問い合わせ：${s.values.name}`, copy });
    expect((await dest.deliver(submission, { requestId: 'r' })).ok).toBe(true);
    expect(mailer.outbox[0]).toMatchObject({ to: [{ email: 'owner@example.com' }], replyTo: { email: 'taro@example.com', name: '山田' }, subject: '問い合わせ：山田' });
  });

  it('webhook: 署名を付けて送り、2xx を成功とする', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const dest = webhookDestination({ url: 'https://hooks.example.com/in?x=1', secret: 's3cret', fetch: fetcher });
    expect(await dest.deliver(submission, { requestId: 'r' })).toEqual({ ok: true, value: 204 });
    const { init } = sent[0]!;
    expect(init.redirect).toBe('manual');
    const header = (init.headers as Record<string, string>)['x-signature']!;
    expect(await verifyWebhook('s3cret', header, { method: 'POST', url: 'https://hooks.example.com/in?x=1', body: String(init.body) })).toEqual({ ok: true, value: undefined });
    expect(JSON.parse(String(init.body))).toMatchObject({ event: 'form.submitted', form: 'inquiry' });
  });

  it('webhook: slack の形は通知の本文、2xx 以外は失敗', async () => {
    const fetcher = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const dest = webhookDestination({ url: 'https://hooks.example.com/in', format: 'slack', copy, fetch: fetcher });
    expect(await dest.deliver(submission, { requestId: 'r' })).toEqual({ ok: false, error: 'status_500' });
  });
});

describe('submitForm', () => {
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

  it('結果をコードで返す', async () => {
    expect(await submitForm('/api/form', new FormData(), { fetch: reply(200, { ok: true }) })).toEqual({ ok: true });
    expect(await submitForm('/api/form', new FormData(), { fetch: reply(400, { ok: false, error: 'invalid', problems: [{ path: 'email', code: 'invalid_email' }] }) })).toEqual({ ok: false, error: 'invalid', problems: [{ path: 'email', code: 'invalid_email' }] });
    expect(await submitForm('/api/form', new FormData(), { fetch: reply(503, { error: 'unavailable' }, { 'retry-after': '5' }) })).toEqual({ ok: false, error: 'unavailable', problems: [], retryAfterSec: 5 });
  });

  it('通信の失敗と想定外の応答は network', async () => {
    expect(await submitForm('/api/form', new FormData(), { fetch: (async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch })).toEqual({ ok: false, error: 'network', problems: [] });
    expect(await submitForm('/api/form', new FormData(), { fetch: (async () => new Response('<html>', { status: 502 })) as unknown as typeof fetch })).toEqual({ ok: false, error: 'network', problems: [] });
  });
});

describe('httpDestination', () => {
  it('値を JSON で転送し、応答の JSON を値にする。鍵のヘッダーと相関の ID を送る', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ id: '7' }, { status: 201 });
    }) as unknown as typeof fetch;
    const d = httpDestination({ name: 'cms', url: 'https://cms.example.com/forms/contact', headers: { authorization: 'Bearer key' }, fetch: fetcher });
    expect(d.name).toBe('cms');
    expect(await d.deliver(submission, { requestId: 'r1' })).toEqual({ ok: true, value: { id: '7' } });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(submission.values);
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer key', 'x-request-id': 'r1' });
    expect(calls[0]!.init.redirect).toBe('manual');
  });

  it('2xx 以外は status_<状態>、URL がなければ ConfigError', async () => {
    const fetcher = (async () => new Response('', { status: 400 })) as unknown as typeof fetch;
    expect(await httpDestination({ url: 'https://cms.example.com/', fetch: fetcher }).deliver(submission, { requestId: 'r' })).toEqual({ ok: false, error: 'status_400' });
    await expect(httpDestination({ url: undefined }).deliver(submission, { requestId: 'r' })).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('届け先の名前と回数の制限のキー', () => {
  it('mailDestination は name で名前を変えられる', () => {
    const mailer = memoryMailer();
    expect(mailDestination({ mailer, from: { email: 'a@example.com' }, to: { email: 'b@example.com' }, subject: () => 's', copy }).name).toBe('mail');
    expect(mailDestination({ mailer, name: 'mail-owner', from: { email: 'a@example.com' }, to: { email: 'b@example.com' }, subject: () => 's', copy }).name).toBe('mail-owner');
  });

  it('rateLimitKey は IP アドレスとフォームの名前からキーを作る', async () => {
    quiet();
    const limiter = fakeRateLimiter();
    const handle = submissionHandler({ forms: { inquiry }, destinations: [memoryDestination()], rateLimiter: limiter, rateLimitKey: ({ ip, form }) => `contact:${form}:${ip}` });
    await handle(post(ok));
    expect(limiter.keys).toEqual(['contact:inquiry:203.0.113.1']);
  });
});

describe('webhookDestination の選択肢', () => {
  it('名前、署名のヘッダー名、鍵ごとの v1、本文の id', async () => {
    let sent: { headers: Record<string, string>; body: string } | undefined;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = { headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const d = webhookDestination({ url: 'https://hooks.example.com/in', name: 'hook-1', secret: ['new', 'old'], header: 'x-cms-signature', fetch: fetcher });
    expect(d.name).toBe('hook-1');
    expect((await d.deliver(submission, { requestId: 'r' })).ok).toBe(true);
    expect(sent!.headers['x-cms-signature']).toMatch(/^t=\d+,v1=[\w-]+,v1=[\w-]+$/);
    expect(sent!.headers['x-signature']).toBeUndefined();
    expect(JSON.parse(sent!.body)).toMatchObject({ event: 'form.submitted', id: expect.stringMatching(/^[0-9a-f-]{36}$/), form: 'inquiry' });
  });

  it('項目の secret が空なら ConfigError（署名なしで送らない）、項目がなければ署名しない', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await expect(webhookDestination({ url: 'https://hooks.example.com/in', secret: undefined, fetch: fetcher }).deliver(submission, { requestId: 'r' })).rejects.toBeInstanceOf(ConfigError);
    await expect(webhookDestination({ url: 'https://hooks.example.com/in', secret: ['', ''], fetch: fetcher }).deliver(submission, { requestId: 'r' })).rejects.toBeInstanceOf(ConfigError);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await webhookDestination({ url: 'https://hooks.example.com/in', fetch: fetcher }).deliver(submission, { requestId: 'r' })).ok).toBe(true);
    expect((vi.mocked(fetcher).mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('x-signature');
  });

  it('heading は通知の本文の先頭', () => {
    expect(notificationText(submission, { ...copy, heading: '[Example] お問い合わせ' }).split('\n\n')[0]).toBe('[Example] お問い合わせ');
  });
});

describe('主体の認証・1回だけ・日ごとの上限', () => {
  const survey = defineForm({ fields: { found: { kind: 'multiChoice', choices: ['sns', 'search', 'other'], required: true }, note: { kind: 'text', maxLength: 100, requiredWhen: { field: 'found', in: ['other'] } } } });
  const send = (body: Record<string, unknown>) => new Request('https://api.example.com/survey', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.1' }, body: JSON.stringify(body) });
  const NOON_JST = Date.parse('2026-11-15T03:00:00Z');
  const setup = (limit = 10) => {
    quiet();
    const auth = fakeAuthenticator('U1');
    const once = memorySubmissionOnce();
    const d = memoryDestination();
    const handle = submissionHandler({ forms: { survey }, destinations: [d], authenticator: auth, once: { store: once }, quota: { store: memoryDailyQuota({ timeZone: 'Asia/Tokyo', now: () => NOON_JST }), limit }, now: () => NOON_JST });
    return { auth, once, d, handle };
  };

  it('認証した主体を Submission.subject で届け先へ渡し、2回目は 409 already_submitted', async () => {
    const t = setup();
    const res = await t.handle(send({ found: ['other', 'sns'], note: '雑誌' }));
    expect(res.status).toBe(200);
    expect(t.d.received[0]).toMatchObject({ form: 'survey', subject: 'U1', values: { found: ['sns', 'other'], note: '雑誌' } });
    expect(await t.once.has('survey', 'U1')).toBe(true);
    const again = await t.handle(send({ found: ['sns'] }));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ ok: false, error: 'already_submitted' });
    expect(t.d.received).toHaveLength(1);
  });

  it('認証できなければ 401 unauthenticated。検査の失敗は認証より先', async () => {
    const t = setup();
    t.auth.as(null);
    expect((await t.handle(send({ found: [] }))).status).toBe(400);
    expect(t.auth.calls).toBe(0);
    const res = await t.handle(send({ found: ['sns'] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthenticated' });
  });

  it('日ごとの上限を超えたら 429 quota_exceeded で、確保を戻す', async () => {
    const t = setup(1);
    expect((await t.handle(send({ found: ['sns'] }))).status).toBe(200);
    t.auth.as('U2');
    const res = await t.handle(send({ found: ['sns'] }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'quota_exceeded' });
    expect(await t.once.has('survey', 'U2')).toBe(false);
  });

  it('届け先がすべて失敗したら 502 で、確保を戻す（もう一度送れる）', async () => {
    const t = setup();
    t.d.fail('value');
    expect((await t.handle(send({ found: ['sns'] }))).status).toBe(502);
    expect(await t.once.has('survey', 'U1')).toBe(false);
    t.d.fail(false);
    expect((await t.handle(send({ found: ['sns'] }))).status).toBe(200);
  });

  it('上限の数え方の失敗は基盤の失敗（503）で、確保を戻す', async () => {
    quiet();
    const once = memorySubmissionOnce();
    const handle = submissionHandler({ forms: { survey }, destinations: [memoryDestination()], authenticator: fakeAuthenticator('U1'), once: { store: once }, quota: { store: { take: () => Promise.reject(new TransientError('d1 down')) }, limit: 10 } });
    expect((await handle(send({ found: ['sns'] }))).status).toBe(503);
    expect(await once.has('survey', 'U1')).toBe(false);
  });

  it('戻すのに失敗しても応答は変えない', async () => {
    quiet();
    const base = memorySubmissionOnce();
    const once: SubmissionOnce = { ...base, release: () => Promise.reject(new Error('down')) };
    const d = memoryDestination();
    d.fail('throw');
    const handle = submissionHandler({ forms: { survey }, destinations: [d], authenticator: fakeAuthenticator('U1'), once: { store: once } });
    expect((await handle(send({ found: ['sns'] }))).status).toBe(502);
  });

  it('scope と上限のキーを変えられ、キーの関数に主体が渡る', async () => {
    quiet();
    const once = memorySubmissionOnce();
    const keys: string[] = [];
    const limiter = fakeRateLimiter();
    const handle = submissionHandler({
      forms: { survey },
      destinations: [memoryDestination()],
      authenticator: fakeAuthenticator('U1'),
      once: { store: once, scope: ({ form }) => `${form}:2026` },
      quota: { store: { take: async (key) => (keys.push(key), { ok: true, value: undefined }) }, limit: 1, key: ({ subject }) => `user:${subject}` },
      rateLimiter: limiter,
      rateLimitKey: ({ subject }) => `rl:${subject}`,
    });
    expect((await handle(send({ found: ['sns'] }))).status).toBe(200);
    expect(await once.has('survey:2026', 'U1')).toBe(true);
    expect(keys).toEqual(['user:U1']);
    expect(limiter.keys).toEqual(['rl:U1']);
  });

  it('once があって authenticator がなければ、作るときに UsageError', () => {
    expect(() => submissionHandler({ forms: { survey }, destinations: [memoryDestination()], once: { store: memorySubmissionOnce() } })).toThrow(expect.objectContaining({ name: 'UsageError', code: 'once_without_authenticator' }));
  });

  it('入力の値と主体をログに出さない', async () => {
    const logs: string[] = [];
    for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((line: string) => void logs.push(line));
    const handle = submissionHandler({ forms: { survey }, destinations: [memoryDestination()], authenticator: fakeAuthenticator('U-secret'), once: { store: memorySubmissionOnce() } });
    await handle(send({ found: ['other'], note: '秘密の記述' }));
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) for (const value of ['U-secret', '秘密の記述']) expect(line).not.toContain(value);
  });
});

describe('jwtAuthenticator', () => {
  const verifier = (subject: unknown = 'U1') => {
    const tokens: (string | null | undefined)[] = [];
    return {
      tokens,
      async verify(token: string | null | undefined) {
        tokens.push(token);
        return token === 'good' ? { ok: true as const, value: { sub: subject } } : { ok: false as const, error: 'unauthenticated' as const };
      },
    };
  };
  const input = (fields: Record<string, string>, headers: Record<string, string> = {}) => ({ request: new Request('https://api.example.com/', { headers }), field: (name: string) => fields[name] });

  it('本文の idToken を検証し、sub を主体にする', async () => {
    const v = verifier();
    expect(await jwtAuthenticator(v).authenticate(input({ idToken: 'good' }))).toEqual({ ok: true, value: { subject: 'U1' } });
    expect(await jwtAuthenticator(v).authenticate(input({ idToken: 'bad' }))).toEqual({ ok: false, error: 'unauthenticated' });
    expect(await jwtAuthenticator(v).authenticate(input({}))).toEqual({ ok: false, error: 'unauthenticated' });
    expect(v.tokens).toEqual(['good', 'bad', undefined]);
  });

  it('ヘッダーを本文より先に見る。項目の名前と主体の取り出しを変えられる', async () => {
    const v = verifier();
    expect(await jwtAuthenticator(v, { header: 'authorization', field: null }).authenticate(input({ idToken: 'good' }, { authorization: 'Bearer good' }))).toMatchObject({ ok: true });
    expect(await jwtAuthenticator(v, { header: 'authorization', field: null }).authenticate(input({ idToken: 'good' }))).toMatchObject({ ok: false });
    expect(await jwtAuthenticator(v, { field: 'token', subject: (c) => `line:${String(c.sub)}` }).authenticate(input({ token: 'good' }))).toEqual({ ok: true, value: { subject: 'line:U1' } });
  });

  it('主体が取れなければ unauthenticated', async () => {
    expect(await jwtAuthenticator(verifier(42)).authenticate(input({ idToken: 'good' }))).toEqual({ ok: false, error: 'unauthenticated' });
  });
});

describe('複数選択の通知と JSON の送信', () => {
  it('notificationText は選択肢の表示を区切りでつなぐ', () => {
    const s: Submission = { form: 'survey', values: { found: ['sns', 'other'] }, order: ['found', 'none'], receivedAt: '' };
    const copy = { labels: { found: 'きっかけ', none: 'なし' }, choices: { found: { sns: 'SNS', other: 'その他' } } };
    expect(notificationText(s, copy)).toBe('■ きっかけ\nSNS、その他\n\n■ なし\n—');
    expect(notificationText(s, { ...copy, separator: ' / ' })).toContain('SNS / その他');
  });

  it('submitForm はオブジェクトを JSON で送る', async () => {
    let sent: RequestInit | undefined;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = init;
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
    expect(await submitForm('https://api.example.com/survey', { found: ['sns'] }, { fetch: fetcher })).toEqual({ ok: true });
    expect(sent).toMatchObject({ method: 'POST', body: '{"found":["sns"]}', headers: { 'content-type': 'application/json' } });
  });
});
