import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatTraceparent, log, logTracer, parseTraceparent, sampleRateOf, type Span, type SpanAttributes, type TraceContext, type Tracer } from '../index.ts';
import { currentTraceparent, traceEntry, tracedFetch, traceRequest, withSpan, withTraceparent } from './index.ts';

afterEach(() => vi.restoreAllMocks());

const TRACE = 'ab'.repeat(16);
const PARENT = '00f067aa0ba902b7';

type Recorded = { name: string; context: TraceContext; parent: TraceContext | null; attributes: Record<string, unknown>; status?: string };

// 区間を配列に残す出力先
function memoryTracer(sampled = true): Tracer & { spans: Recorded[] } {
  const spans: Recorded[] = [];
  let n = 0;
  return {
    spans,
    startSpan(name, attributes: SpanAttributes = {}, parent = null) {
      const context = { traceId: parent?.traceId ?? TRACE, spanId: String(++n).padStart(16, '0'), sampled: parent ? parent.sampled : sampled };
      const recorded: Recorded = { name, context, parent, attributes: { ...attributes } };
      spans.push(recorded);
      const span: Span = { context, setAttributes: (a) => void Object.assign(recorded.attributes, a), end: (status = 'ok') => void (recorded.status ??= status) };
      return span;
    },
  };
}

describe('traceparent', () => {
  it('読み書きが往復し、フラグの末尾のビットが記録の対象', () => {
    const value = `00-${TRACE}-${PARENT}-01`;
    expect(parseTraceparent(value)).toEqual({ traceId: TRACE, spanId: PARENT, sampled: true });
    expect(formatTraceparent(parseTraceparent(value)!)).toBe(value);
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-02`)?.sampled).toBe(false);
  });

  it('形の誤りは null、将来の版は先頭の4項だけを読む', () => {
    for (const bad of [null, '', `ff-${TRACE}-${PARENT}-01`, `00-${'0'.repeat(32)}-${PARENT}-01`, `00-${TRACE}-${'0'.repeat(16)}-01`, `00-${TRACE.toUpperCase()}-${PARENT}-01`, `00-${TRACE}-${PARENT}-01-x`]) expect(parseTraceparent(bad)).toBeNull();
    expect(parseTraceparent(`01-${TRACE}-${PARENT}-01-future`)).toEqual({ traceId: TRACE, spanId: PARENT, sampled: true });
  });

  it('sampleRateOf: 範囲の外と数でない値は1', () => {
    expect([sampleRateOf('0.1'), sampleRateOf('0'), sampleRateOf(undefined), sampleRateOf(''), sampleRateOf('2'), sampleRateOf('x')]).toEqual([0.1, 0, 1, 1, 1, 1]);
  });
});

describe('logTracer', () => {
  it('区間を終えたときに1行のログを書き、2回目の end と記録の対象の外は書かない', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const tracer = logTracer();
    const root = tracer.startSpan('root', { a: 1 });
    const child = tracer.startSpan('child', {}, root.context);
    child.setAttributes({ b: 2 });
    child.end('error');
    child.end();
    root.end();
    logTracer({ sampleRate: 0 }).startSpan('skipped').end();
    const lines = info.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: 'span', name: 'child', traceId: root.context.traceId, parentSpanId: root.context.spanId, status: 'error', attributes: { b: 2 } });
    expect(lines[1]).toMatchObject({ event: 'span', name: 'root', parentSpanId: null, status: 'ok', attributes: { a: 1 } });
    expect(root.context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root.context.spanId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('区間の受け渡し', () => {
  it('traceEntry: 受け取った traceparent の子になり、ログの各行に traceId と spanId が付く', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const tracer = memoryTracer();
    await traceEntry(tracer, 'job', async () => {
      await Promise.resolve();
      log('info', 'inside');
      await withSpan('step', async () => log('info', 'step'));
    }, { traceparent: `00-${TRACE}-${PARENT}-01` });
    log('info', 'after');
    const [job, step] = tracer.spans;
    expect(job).toMatchObject({ name: 'job', parent: { spanId: PARENT }, status: 'ok' });
    expect(step).toMatchObject({ name: 'step', parent: job!.context, status: 'ok' });
    expect(info.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
      { traceId: TRACE, spanId: job!.context.spanId, level: 'info', event: 'inside' },
      { traceId: TRACE, spanId: step!.context.spanId, level: 'info', event: 'step' },
      { level: 'info', event: 'after' },
    ]);
  });

  it('例外は error で終えて投げ直す', async () => {
    const tracer = memoryTracer();
    await expect(traceEntry(tracer, 'job', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(tracer.spans[0]!.status).toBe('error');
  });

  it('traceRequest: 属性はメソッド・パス・状態で、500以上は error', async () => {
    const tracer = memoryTracer();
    const request = new Request('https://site.example.com/articles/1?q=secret', { headers: { traceparent: `00-${TRACE}-${PARENT}-01` } });
    const res = await traceRequest(tracer, 'site.request', request, async () => new Response(null, { status: 503 }));
    expect(res.status).toBe(503);
    expect(tracer.spans[0]).toMatchObject({ attributes: { 'http.method': 'GET', 'http.path': '/articles/1', 'http.status': 503 }, status: 'error', parent: { spanId: PARENT } });
  });

  it('tracedFetch: 区間 fetch を作り、その traceparent を送る。区間の外は送るだけ', async () => {
    const sent: Headers[] = [];
    const fetcher = async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers));
      return new Response(null, { status: 200 });
    };
    const tracer = memoryTracer();
    await traceEntry(tracer, 'job', () => tracedFetch('https://api.example.com/v1/items?id=1', { method: 'post', headers: { a: '1' } }, { fetcher }));
    const fetchSpan = tracer.spans[1]!;
    expect(fetchSpan).toMatchObject({ name: 'fetch', attributes: { 'http.method': 'POST', 'http.host': 'api.example.com', 'http.status': 200 }, status: 'ok' });
    expect(sent[0]!.get('traceparent')).toBe(formatTraceparent(fetchSpan.context));
    expect(sent[0]!.get('a')).toBe('1');

    await tracedFetch('https://api.example.com/', {}, { fetcher });
    expect(sent[1]!.has('traceparent')).toBe(false);
    await traceEntry(tracer, 'job', () => tracedFetch('https://other.example.com/', {}, { fetcher, propagate: false }));
    expect(sent[2]!.has('traceparent')).toBe(false);
  });

  it('記録の対象の外: 子の区間は作らないが、traceparent はフラグ00で送る', async () => {
    const tracer = memoryTracer(false);
    let header: string | null = null;
    await traceEntry(tracer, 'job', async () => {
      await withSpan('step', () => undefined);
      header = withTraceparent().get('traceparent');
    });
    expect(tracer.spans.map((s) => s.name)).toEqual(['job']);
    expect(header).toMatch(/-00$/);
    expect(currentTraceparent()).toBeNull();
  });
});
