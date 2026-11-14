// AsyncLocalStorage の型だけを `@types/node` から読む（出力の型定義には残らない）
/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks';
import { withLogContext } from '../context/index.ts';
import { formatTraceparent, parseTraceparent, TRACEPARENT_HEADER, type Span, type SpanAttributes, type SpanStatus, type TraceContext, type Tracer } from '../tracing.ts';

type Active = Readonly<{ tracer: Tracer; span: Span }>;

const store = new AsyncLocalStorage<Active>();

// 区間の中で実行する。ログの各行に traceId と spanId を付け、例外は error で終えて投げ直す
async function runSpan<R>(active: Active, fn: (span: Span) => Promise<R> | R, statusOf?: (result: R) => SpanStatus): Promise<R> {
  const { traceId, spanId } = active.span.context;
  try {
    const result = await store.run(active, () => withLogContext({ traceId, spanId }, () => fn(active.span)));
    active.span.end(statusOf?.(result) ?? 'ok');
    return result;
  } catch (e) {
    active.span.end('error');
    throw e;
  }
}

export type TraceEntryOptions<R> = Readonly<{
  /** 受け取った traceparent（形の誤りは新しいトレース） */
  traceparent?: string | null;
  attributes?: SpanAttributes;
  /** 戻り値から区間の結果を決める（既定は `ok`、例外は `error`） */
  statusOf?: (result: R) => SpanStatus;
}>;

/**
 * 入口の区間で実行する（要求、定期の処理、キューの consumer）
 * - 親は、実行中の区間があればその区間、なければ受け取った traceparent
 * - `fn` の中のログの各行に `traceId` と `spanId` が付く（`@ryusenkei/core/context` の `withLogContext`）
 * - `node:async_hooks` を使う。Workers は互換のフラグ `nodejs_als` か `nodejs_compat` が要る
 */
export function traceEntry<R>(tracer: Tracer, name: string, fn: (span: Span) => Promise<R> | R, options: TraceEntryOptions<R> = {}): Promise<R> {
  const parent = store.getStore()?.span.context ?? parseTraceparent(options.traceparent);
  return runSpan({ tracer, span: tracer.startSpan(name, options.attributes, parent) }, fn, options.statusOf);
}

/**
 * 要求を入口の区間で処理する
 * - 親は要求の traceparent。属性はメソッド、クエリを除いたパス、応答の状態（`http.method`、`http.path`、`http.status`）
 * - 応答の状態が500以上と例外は `error`
 */
export function traceRequest(tracer: Tracer, name: string, request: Request, handle: (span: Span) => Promise<Response>): Promise<Response> {
  return traceEntry(
    tracer,
    name,
    async (span) => {
      const res = await handle(span);
      span.setAttributes({ 'http.status': res.status });
      return res;
    },
    { traceparent: request.headers.get(TRACEPARENT_HEADER), attributes: { 'http.method': request.method, 'http.path': new URL(request.url).pathname }, statusOf: (res) => (res.status >= 500 ? 'error' : 'ok') },
  );
}

/** 処理の区切りの区間。区間の外と、記録の対象の外では `fn` をそのまま実行する */
export function withSpan<R>(name: string, fn: () => Promise<R> | R, attributes?: SpanAttributes): Promise<R> {
  const active = store.getStore();
  if (!active?.span.context.sampled) return Promise.resolve().then(fn);
  return runSpan({ tracer: active.tracer, span: active.tracer.startSpan(name, attributes, active.span.context) }, fn);
}

/** 実行中の区間に属性を足す（区間の外では何もしない） */
export function annotateSpan(attributes: SpanAttributes): void {
  store.getStore()?.span.setAttributes(attributes);
}

/** 実行中の区間の文脈（区間の外は `null`） */
export function currentTraceContext(): TraceContext | null {
  return store.getStore()?.span.context ?? null;
}

/** 実行中の区間の traceparent（区間の外は `null`） */
export function currentTraceparent(): string | null {
  const ctx = currentTraceContext();
  return ctx ? formatTraceparent(ctx) : null;
}

/** ヘッダーに実行中の区間の traceparent を足す（区間の外は足さない。戻り値は新しい `Headers`） */
export function withTraceparent(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const value = currentTraceparent();
  if (value) headers.set(TRACEPARENT_HEADER, value);
  return headers;
}

export type TracedFetchOptions = Readonly<{
  /** 送る関数（service binding の `fetch` など。既定は全体の `fetch`） */
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  /** traceparent を送る（既定は `true`。トレースを知らない第三者へ送るときは `false`） */
  propagate?: boolean;
}>;

/**
 * 外への送信を区間 `fetch` にする
 * - 属性はメソッド、ホスト、応答の状態（`http.method`、`http.host`、`http.status`）。パスとクエリは記録しない
 * - 応答の状態が500以上と例外は `error`。区間の外では送るだけ
 * - 区間の traceparent を送るので、受け手の区間がこの区間の子になる
 */
export function tracedFetch(target: string | URL, init: RequestInit = {}, options: TracedFetchOptions = {}): Promise<Response> {
  const url = String(target);
  const call = (requestInit: RequestInit) => (options.fetcher ? options.fetcher(url, requestInit) : fetch(url, requestInit));
  const active = store.getStore();
  if (!active) return call(init);
  const send = async () => {
    const res = await call(options.propagate === false ? init : { ...init, headers: withTraceparent(init.headers) });
    annotateSpan({ 'http.status': res.status });
    return res;
  };
  if (!active.span.context.sampled) return send();
  const attributes = { 'http.method': (init.method ?? 'GET').toUpperCase(), 'http.host': URL.parse(url)?.host ?? null };
  return runSpan({ tracer: active.tracer, span: active.tracer.startSpan('fetch', attributes, active.span.context) }, send, (res) => (res.status >= 500 ? 'error' : 'ok'));
}
