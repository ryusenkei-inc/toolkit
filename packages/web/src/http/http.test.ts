import { ConfigError, TransientError } from '@ryusenkei/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failureResponse, sanitizeRequestId, withRequestId } from './index.ts';

afterEach(() => vi.restoreAllMocks());
const silence = (level: 'warn' | 'error' | 'info') => vi.spyOn(console, level).mockImplementation(() => undefined);

describe('相関の ID', () => {
  it('正しい形の値はそのまま、ないか不正なら新しく作る', () => {
    expect(sanitizeRequestId('abc-123')).toBe('abc-123');
    for (const v of [null, '', 'a b', 'x'.repeat(129), '<script>']) expect(sanitizeRequestId(v)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('withRequestId は不正な値を置き換えた要求を返す', () => {
    const kept = new Request('https://app.example.com/', { headers: { 'x-request-id': 'r1' } });
    expect(withRequestId(kept)).toEqual({ request: kept, requestId: 'r1' });
    const { request, requestId } = withRequestId(new Request('https://app.example.com/', { headers: { 'x-request-id': 'bad id' } }));
    expect(request.headers.get('x-request-id')).toBe(requestId);
    expect(requestId).not.toBe('bad id');
  });
});

describe('failureResponse', () => {
  it('一時的な失敗は 503 と Retry-After（切り上げ）、本文はコードと相関の ID だけ', async () => {
    silence('warn');
    const res = failureResponse(new TransientError('secret detail', { retryAfterSec: 1.5 }), { requestId: 'r1' });
    expect(res.status).toBe(503);
    expect(Object.fromEntries(res.headers)).toMatchObject({ 'retry-after': '2', 'cache-control': 'no-store', 'x-request-id': 'r1' });
    expect(await res.json()).toEqual({ error: 'unavailable', requestId: 'r1' });
  });

  it('設定の不足は 503 not_configured。設定の名前を本文に出さない', async () => {
    const warn = silence('warn');
    const res = failureResponse(new ConfigError('TURNSTILE_SECRET_KEY がない', { key: 'TURNSTILE_SECRET_KEY' }));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(await res.text()).toBe('{"error":"not_configured"}');
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ event: 'not_configured', error: { key: 'TURNSTILE_SECRET_KEY' } });
  });

  it('想定外の失敗は 500 で報告先へ。defer があれば報告を任せる', async () => {
    const reports: unknown[] = [];
    const deferred: Promise<unknown>[] = [];
    const res = failureResponse(new Error('bug'), { requestId: 'r2', context: { stage: 'route' }, reporter: { report: (e, c) => void reports.push([e, c]) }, defer: (p) => deferred.push(p) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal', requestId: 'r2' });
    await Promise.all(deferred);
    expect(reports).toEqual([[new Error('bug'), { stage: 'route', requestId: 'r2', status: 500 }]]);
  });

  it('body で本文の形を変えられる。状態とヘッダーは同じ', async () => {
    silence('warn');
    const res = failureResponse(new TransientError('x'), { requestId: 'r3', body: ({ failure, requestId }) => ({ code: failure.code, requestId, error: '一時的に利用できません' }) });
    expect(res.status).toBe(503);
    expect(res.headers.get('x-request-id')).toBe('r3');
    expect(await res.json()).toEqual({ code: 'unavailable', requestId: 'r3', error: '一時的に利用できません' });
  });

  it('requestId の null は本文とヘッダーに出さず、報告には null を渡す', async () => {
    const reports: unknown[] = [];
    const res = failureResponse(new Error('bug'), { requestId: null, context: { project: 'p1' }, reporter: { report: (_e, c) => void reports.push(c) } });
    expect(res.headers.get('x-request-id')).toBeNull();
    expect(await res.json()).toEqual({ error: 'internal' });
    await Promise.resolve();
    expect(reports).toEqual([{ project: 'p1', requestId: null, status: 500 }]);
  });
});
