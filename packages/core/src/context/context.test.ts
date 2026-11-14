import { afterEach, describe, expect, it, vi } from 'vitest';
import { log, setLogContext } from '../index.ts';
import { withLogContext } from './index.ts';

afterEach(() => vi.restoreAllMocks());

describe('withLogContext', () => {
  it('待ち合わせの後も文脈の項目が付き、入れ子は外の項目に足す。外に出ると付かない', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await withLogContext({ traceId: 't1', spanId: 's1' }, async () => {
      await Promise.resolve();
      log('info', 'outer');
      await withLogContext({ spanId: 's2' }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        log('info', 'inner');
      });
    });
    log('info', 'after');
    expect(info.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
      { traceId: 't1', spanId: 's1', level: 'info', event: 'outer' },
      { traceId: 't1', spanId: 's2', level: 'info', event: 'inner' },
      { level: 'info', event: 'after' },
    ]);
  });

  it('並行する要求の文脈は混ざらない', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const request = (id: string, ms: number) =>
      withLogContext({ requestId: id }, async () => {
        await new Promise((r) => setTimeout(r, ms));
        log('info', 'done');
      });
    await Promise.all([request('a', 5), request('b', 1)]);
    expect(info.mock.calls.map((c) => JSON.parse(String(c[0])).requestId)).toEqual(['b', 'a']);
    setLogContext(undefined);
  });
});
