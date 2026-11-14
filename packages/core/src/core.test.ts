import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asTransient,
  classifyFailure,
  combineReporters,
  ConfigError,
  DEFAULT_RETRY_AFTER_SEC,
  err,
  isConfigError,
  isTransientError,
  jsonLogReporter,
  log,
  ok,
  reportSafely,
  serializeError,
  setLogContext,
  TransientError,
  type Result,
} from './index.ts';

afterEach(() => {
  vi.restoreAllMocks();
  setLogContext(undefined);
});
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

describe('印による判定', () => {
  // 版の違う core の複製が作った例外（同じ印を持つ別のクラス）
  const copied = (brand: string) => Object.assign(new Error('copy'), { [Symbol.for(brand)]: true, retryAfterSec: 7 });

  it('別の複製の例外も分類し、instanceof も一致する', () => {
    const transient = copied('@ryusenkei/core.TransientError');
    expect(classifyFailure(transient)).toEqual({ kind: 'transient', retryAfterSec: 7 });
    expect(classifyFailure(copied('@ryusenkei/core.ConfigError'))).toEqual({ kind: 'config' });
    expect(transient instanceof TransientError).toBe(true);
    expect(isTransientError(transient) && !isConfigError(transient)).toBe(true);
    expect(new Error('x') instanceof TransientError).toBe(false);
  });

  it('派生のクラスの instanceof は通常の判定', () => {
    class QuotaError extends TransientError {}
    expect(new QuotaError('q') instanceof TransientError).toBe(true);
    expect(new TransientError('t') instanceof QuotaError).toBe(false);
  });
});

describe('ログの文脈', () => {
  it('登録した文脈の項目を各行に足し、呼ぶ側の項目と level・event が優先する', () => {
    const info = silence('info');
    setLogContext(() => ({ traceId: 't1', spanId: 's1', event: 'ctx' }));
    log('info', 'sent', { spanId: 's2' });
    expect(JSON.parse(String(info.mock.calls[0]![0]))).toEqual({ traceId: 't1', spanId: 's2', level: 'info', event: 'sent' });
  });

  it('文脈の関数の例外と undefined は無視し、解除できる', () => {
    const info = silence('info');
    setLogContext(() => {
      throw new Error('broken');
    });
    log('info', 'a');
    setLogContext(() => undefined);
    log('info', 'b');
    setLogContext(undefined);
    log('info', 'c');
    expect(info.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
      { level: 'info', event: 'a' },
      { level: 'info', event: 'b' },
      { level: 'info', event: 'c' },
    ]);
  });

  it('ErrorContext は追加の項目と null の requestId を持てる', () => {
    const error = silence('error');
    void jsonLogReporter.report(new Error('x'), { requestId: null, project: 'p1', stage: 'queue' });
    expect(JSON.parse(String(error.mock.calls[0]![0]))).toMatchObject({ event: 'error_report', requestId: null, project: 'p1', stage: 'queue' });
  });
});
