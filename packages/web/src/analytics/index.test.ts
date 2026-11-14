import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEvent } from './client.ts';
import { dayIn, defineEventSchema, isBotUserAgent, memoryAnalytics, visitorKey } from './index.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const schema = defineEventSchema({ blobs: ['event', 'page', 'visitor'], doubles: ['price'], index: (e) => e.page ?? '' });

describe('dayIn と isBotUserAgent', () => {
  it('時間帯の日付', () => {
    const at = Date.parse('2026-11-13T16:00:00Z');
    expect([dayIn('Asia/Tokyo', at), dayIn('UTC', at)]).toEqual(['2026-11-14', '2026-11-13']);
  });

  it('bot の User-Agent', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0')).toBe(false);
    expect(isBotUserAgent(null)).toBe(false);
  });
});

describe('visitorKey', () => {
  const at = Date.parse('2026-11-14T03:00:00Z');

  it('同じ日・IP・範囲は同じ鍵で、日・範囲・秘密値が違えば別の鍵', async () => {
    const key = visitorKey({ secret: 's', timeZone: 'Asia/Tokyo' });
    const a = await key('203.0.113.1', 'view:x', at);
    expect(a).toMatch(/^[0-9a-f]{6}$/);
    expect(await key('203.0.113.1', 'view:x', at + 3_600_000)).toBe(a);
    expect(await key('203.0.113.1', 'view:x', at + 86_400_000)).not.toBe(a);
    expect(await key('203.0.113.1', 'copy:x', at)).not.toBe(a);
    expect(await visitorKey({ secret: 't', timeZone: 'Asia/Tokyo' })('203.0.113.1', 'view:x', at)).not.toBe(a);
    expect(await key(undefined, 'view:x', at)).toBe('');
  });

  it('鍵は日ごとの鍵で IP と範囲の HMAC を計算した先頭のバイト（label と bytes は使う側の値）', async () => {
    const enc = new TextEncoder();
    const hmac = async (raw: Uint8Array<ArrayBuffer>, text: string) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(text)));
    const day = await hmac(enc.encode('s'), 'site-metrics:2026-11-14');
    const mac = await hmac(day, '203.0.113.1\nview:x');
    const expected = Array.from(mac.slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await visitorKey({ secret: 's', timeZone: 'Asia/Tokyo', label: 'site-metrics', bytes: 4 })('203.0.113.1', 'view:x', at)).toBe(expected);
  });
});

describe('memoryAnalytics', () => {
  it('日と項目で分けて数え、絞り込みと値の種類の数を返す', async () => {
    let now = new Date('2026-11-13T15:30:00Z'); // 日本時間の 11-14
    const store = memoryAnalytics(schema, { now: () => now });
    store.record({ event: 'view', page: 'top', visitor: 'a' });
    store.record({ event: 'view', page: 'top', visitor: 'a' });
    store.record({ event: 'view', page: 'list', visitor: 'b' });
    store.record({ event: 'copy', page: 'top', visitor: 'a', price: 100 });
    now = new Date('2026-11-14T15:30:00Z'); // 日本時間の 11-15
    store.record({ event: 'view', visitor: 'c' });
    expect(store.events).toHaveLength(5);

    const rows = await store.count({ from: '2026-11-14', to: '2026-11-15', timeZone: 'Asia/Tokyo', groupBy: ['page'], where: { event: 'view' }, distinct: 'visitor' });
    expect(rows).toEqual([
      { day: '2026-11-14', keys: { page: 'list' }, count: 1, distinct: 1 },
      { day: '2026-11-14', keys: { page: 'top' }, count: 2, distinct: 1 },
      { day: '2026-11-15', keys: { page: '' }, count: 1, distinct: 1 },
    ]);
    expect(await store.count({ from: '2026-11-14', to: '2026-11-14', timeZone: 'Asia/Tokyo', where: { event: ['view', 'copy'] } })).toEqual([{ day: '2026-11-14', keys: {}, count: 4 }]);
  });
});

describe('sendEvent', () => {
  it('sendBeacon で JSON を送り、使えなければ keepalive の fetch', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { sendBeacon: beacon, webdriver: false });
    sendEvent('/api/events', { event: 'view' });
    expect(beacon).toHaveBeenCalledWith('/api/events', '{"event":"view"}');

    const fetcher = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('navigator', { sendBeacon: () => false, webdriver: false });
    sendEvent('/api/events', { event: 'copy' });
    expect(fetcher).toHaveBeenCalledWith('/api/events', expect.objectContaining({ method: 'POST', body: '{"event":"copy"}', keepalive: true }));
  });

  it('自動操作のブラウザとサーバーの上では送らない', () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon, webdriver: false });
    sendEvent('/api/events', {});
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { sendBeacon: beacon, webdriver: true });
    sendEvent('/api/events', {});
    expect(beacon).not.toHaveBeenCalled();
  });
});
