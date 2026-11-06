import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyFailure, ConfigError, err, failureResponse, log, ok, TransientError, type Result } from './index.ts';

afterEach(() => vi.restoreAllMocks());

describe('Result', () => {
  it('成功と失敗を値で返す', () => {
    const find = (id: string): Result<{ id: string }, 'not_found'> => (id === 'a' ? ok({ id }) : err('not_found'));
    expect(find('a')).toEqual({ ok: true, value: { id: 'a' } });
    expect(find('b')).toEqual({ ok: false, error: 'not_found' });
    expect(ok()).toEqual({ ok: true, value: undefined });
  });
});

describe('classifyFailure', () => {
  it('基盤のエラーの種類で分類', () => {
    expect(classifyFailure(new TransientError('x', { retryAfterSec: 30 }))).toEqual({ status: 503, code: 'unavailable', retryAfterSec: 30 });
    expect(classifyFailure(new ConfigError('x', { key: 'API_KEY' }))).toEqual({ status: 503, code: 'not_configured' });
    expect(classifyFailure(new Error('x'))).toEqual({ status: 500, code: 'internal' });
    expect(classifyFailure('string')).toEqual({ status: 500, code: 'internal' });
  });
});

describe('failureResponse', () => {
  it('応答はコードだけを返し、一時的な失敗に Retry-After を付ける', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = failureResponse(new TransientError('x', { retryAfterSec: 1.5 }));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('2');
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(failureResponse(new ConfigError('x')).headers.get('retry-after')).toBeNull();
  });

  it('想定外の例外は error で報告し、本文に詳細を出さない', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = failureResponse(new Error('secret detail'));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal"}');
    expect(JSON.parse(String(error.mock.calls[0]![0]))).toMatchObject({ level: 'error', event: 'internal', error: { name: 'Error', message: 'secret detail' } });
  });
});

describe('log', () => {
  it('1行の JSON で出力', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    log('info', 'sent', { to: 1 });
    expect(info).toHaveBeenCalledWith('{"level":"info","event":"sent","to":1}');
  });
});
