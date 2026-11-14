import { ConfigError, TransientError } from '@ryusenkei/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineEventSchema } from '../analytics/index.ts';
import { analyticsEngineCounts, analyticsEngineRecorder, type AnalyticsEngineDataset } from './index.ts';

afterEach(() => vi.restoreAllMocks());

const schema = defineEventSchema({ blobs: ['event', 'page', 'visitor'], doubles: ['price', 'current'], index: (e) => e.page ?? '' });

describe('analyticsEngineRecorder', () => {
  it('schema の順に blob と double を入れ、index を付ける', () => {
    const points: unknown[] = [];
    const dataset: AnalyticsEngineDataset = { writeDataPoint: (p) => void points.push(p) };
    analyticsEngineRecorder(dataset, schema, { missingDouble: -1 }).record({ event: 'view', visitor: 'ab12cd', price: 1200 });
    expect(points).toEqual([{ blobs: ['view', '', 'ab12cd'], doubles: [1200, -1], indexes: [''] }]);
  });

  it('書き込みの失敗は記録して無視し、binding がなければ既定で記録しない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    analyticsEngineRecorder({ writeDataPoint: () => { throw new Error('x'); } }, schema).record({ event: 'view' });
    expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({ event: 'analytics_write_failed' });
    expect(() => analyticsEngineRecorder(undefined, schema).record({ event: 'view' })).not.toThrow();
    expect(() => analyticsEngineRecorder(undefined, schema, { whenMissing: 'error' }).record({ event: 'view' })).toThrow(ConfigError);
  });
});

describe('analyticsEngineCounts', () => {
  const reply = (data: unknown[], status = 200) => new Response(JSON.stringify({ data }), { status });

  it('日と項目で集計する SQL を送り、行を読む', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return reply([{ day: '2026-11-14', k0: 'top', events: '12.0', uniq: '3' }]);
    }) as unknown as typeof fetch;
    const counts = analyticsEngineCounts({ accountId: 'acc', token: 'tok', dataset: 'site_events', schema, fetch: fetcher });
    const rows = await counts.count({ from: '2026-11-01', to: '2026-11-14', timeZone: 'Asia/Tokyo', groupBy: ['page'], where: { event: ['view', 'copy'] }, distinct: 'visitor' });
    expect(rows).toEqual([{ day: '2026-11-14', keys: { page: 'top' }, count: 12, distinct: 3 }]);
    expect(sent[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/analytics_engine/sql');
    expect(sent[0]!.init.headers).toEqual({ authorization: 'Bearer tok' });
    expect(sent[0]!.init.body).toBe(
      "SELECT formatDateTime(timestamp, '%Y-%m-%d', 'Asia/Tokyo') AS day, blob2 AS k0, SUM(_sample_interval) AS events, count(DISTINCT blob3) AS uniq FROM site_events" +
        " WHERE timestamp >= toDateTime('2026-11-01 00:00:00', 'Asia/Tokyo') AND timestamp < toDateTime('2026-11-15 00:00:00', 'Asia/Tokyo') AND (blob1 = 'view' OR blob1 = 'copy')" +
        ' GROUP BY day, k0 ORDER BY day, k0 LIMIT 10000 OFFSET 0 FORMAT JSON',
    );
  });

  it('1万行ごとに次の頁を読む', async () => {
    const full = Array.from({ length: 10_000 }, () => ({ day: '2026-11-14', events: 1 }));
    const fetcher = vi.fn(async () => reply(fetcher.mock.calls.length === 1 ? full : [{ day: '2026-11-14', events: 1 }]));
    const rows = await analyticsEngineCounts({ accountId: 'acc', token: 'tok', dataset: 'd', schema, fetch: fetcher as unknown as typeof fetch }).count({ from: '2026-11-14', to: '2026-11-14', timeZone: 'UTC' });
    expect(rows).toHaveLength(10_001);
    expect(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body)).toContain('OFFSET 10000');
  });

  it('429 と 5xx は TransientError、ほかの失敗と不正な値は例外', async () => {
    const counts = (status: number) => analyticsEngineCounts({ accountId: 'acc', token: 'tok', dataset: 'd', schema, fetch: (async () => reply([], status)) as unknown as typeof fetch });
    const query = { from: '2026-11-14', to: '2026-11-14', timeZone: 'UTC' };
    await expect(counts(429).count(query)).rejects.toBeInstanceOf(TransientError);
    await expect(counts(503).count(query)).rejects.toBeInstanceOf(TransientError);
    await expect(counts(400).count(query)).rejects.toThrow('analytics_query_failed: 400');
    await expect(counts(200).count({ ...query, where: { page: "x' OR 1=1" } })).rejects.toThrow('invalid_value');
    await expect(counts(200).count({ ...query, from: '2026-02-30' })).rejects.toThrow('invalid_date');
    await expect(counts(200).count({ ...query, timeZone: "UTC'" })).rejects.toThrow('invalid_time_zone');
    expect(() => analyticsEngineCounts({ accountId: 'a', token: 't', dataset: 'bad-name', schema })).toThrow(ConfigError);
  });
});
