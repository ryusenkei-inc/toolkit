import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asTransient,
  classifyFailure,
  combineReporters,
  ConfigError,
  DEFAULT_RETRY_AFTER_SEC,
  err,
  failureResponse,
  log,
  ok,
  reportSafely,
  sanitizeRequestId,
  serializeError,
  TransientError,
  withRequestId,
  type Result,
} from './index.ts';

afterEach(() => vi.restoreAllMocks());
const silence = (level: 'warn' | 'error' | 'info') => vi.spyOn(console, level).mockImplementation(() => undefined);

describe('Result', () => {
  it('成功と失敗を値で返す', () => {
    const find = (id: string): Result<{ id: string }, 'not_found'> => (id === 'a' ? ok({ id }) : err('not_found'));
    expect(find('a')).toEqual({ ok: true, value: { id: 'a' } });
    expect(find('b')).toEqual({ ok: false, error: 'not_found' });
    expect(ok()).toEqual({ ok: true, value: undefined });
  });
});

describe('TransientError', () => {
  it('再試行までの秒は0以上の有限の数だけ', () => {
    expect(new TransientError('x', { retryAfterSec: 3 }).retryAfterSec).toBe(3);
    for (const sec of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(new TransientError('x', { retryAfterSec: sec }).retryAfterSec).toBeUndefined();
  });
});

describe('classifyFailure', () => {
  it('型つきの例外', () => {
    expect(classifyFailure(new TransientError('x', { retryAfterSec: 3 }))).toEqual({ kind: 'transient', retryAfterSec: 3 });
    expect(classifyFailure(new TransientError('x'))).toEqual({ kind: 'transient', retryAfterSec: DEFAULT_RETRY_AFTER_SEC });
    expect(classifyFailure(new ConfigError('x', { key: 'API_KEY' }))).toEqual({ kind: 'config' });
  });

  it('Durable Object の retryable・overloaded と、fetch の時間切れ・中断は一時的', () => {
    expect(classifyFailure(Object.assign(new Error('reset'), { retryable: true }))).toEqual({ kind: 'transient', retryAfterSec: 5 });
    expect(classifyFailure(Object.assign(new Error('busy'), { overloaded: true }))).toEqual({ kind: 'transient', retryAfterSec: 10 });
    expect(classifyFailure(new DOMException('t', 'TimeoutError'))).toMatchObject({ kind: 'transient' });
    expect(classifyFailure(new DOMException('a', 'AbortError'))).toMatchObject({ kind: 'transient' });
  });

  it('ほかは unknown（true でない flag、Error でない値を含む）', () => {
    for (const e of [new Error('x'), Object.assign(new Error('x'), { retryable: 'yes' }), 'x', null]) expect(classifyFailure(e)).toEqual({ kind: 'unknown' });
  });
});

describe('asTransient', () => {
  it('型つきの例外はそのまま、ほかは元の例外を cause に持つ一時的な失敗', () => {
    const config = new ConfigError('x');
    expect(asTransient(config, 'm')).toBe(config);
    const cause = new Error('D1');
    expect(asTransient(cause, 'ledger')).toMatchObject({ name: 'TransientError', message: 'ledger', cause });
    expect(asTransient(Object.assign(new Error('busy'), { overloaded: true }), 'm')).toMatchObject({ retryAfterSec: 10 });
  });
});

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
});

describe('報告', () => {
  it('報告先の失敗は飲み込み、ほかの報告先には届く', async () => {
    const warn = silence('warn');
    const got: string[] = [];
    await combineReporters({ report: () => Promise.reject(new Error('down')) }, { report: () => void got.push('ok') }).report(new Error('x'), {});
    expect(got).toEqual(['ok']);
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ event: 'error_report_failed' });
    await expect(reportSafely({ report: () => { throw new Error('sync'); } }, 'x', {})).resolves.toBeUndefined();
  });
});

describe('log', () => {
  it('1行の JSON。level と event は項目で上書きできない', () => {
    const info = silence('info');
    log('info', 'sent', { to: 1, level: 'error', event: 'x' });
    expect(JSON.parse(String(info.mock.calls[0]![0]))).toEqual({ to: 1, level: 'info', event: 'sent' });
  });

  it('例外は文とスタックを短くし、cause を1段と、例外の項目を残す', () => {
    const e = new ConfigError('m'.repeat(600), { key: 'K', cause: new Error('c', { cause: new Error('deep') }) });
    const s = serializeError(e);
    expect(s).toMatchObject({ name: 'ConfigError', key: 'K', cause: { name: 'Error', message: 'c' } });
    expect(s.message).toHaveLength(500);
    expect(s.cause?.cause).toBeUndefined();
    expect(serializeError('text')).toEqual({ name: 'NonError', message: 'text' });
  });
});
