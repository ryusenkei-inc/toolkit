// 観測: W3C Trace Context の traceparent、区間（span）の型、ログに書く区間の出力先
// - 実行中の区間の受け渡し（AsyncLocalStorage）は `@ryusenkei/core/trace`。ここは実行環境の機能に依らない
import { log } from './log.ts';

/** traceparent のヘッダーの名前 */
export const TRACEPARENT_HEADER = 'traceparent';

/** トレースの文脈。`traceId` は32桁、`spanId` は16桁の16進、`sampled` は記録の対象か */
export type TraceContext = Readonly<{ traceId: string; spanId: string; sampled: boolean }>;

// 形: <版2桁>-<トレース ID 32桁>-<親区間 ID 16桁>-<フラグ2桁>（16進の小文字）
const PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);

/**
 * traceparent を読む（なし、形の誤りは `null`）
 * - 版 `ff`、すべて0の ID、大文字は誤り。版 `00` は4項だけで、将来の版は先頭の4項だけを読む
 * - フラグは末尾のビット（記録の対象）だけを使う
 */
export function parseTraceparent(value: string | null | undefined): TraceContext | null {
  const m = value ? PATTERN.exec(value.trim()) : null;
  if (!m) return null;
  const [, version, traceId, spanId, flags, rest] = m as unknown as [string, string, string, string, string, string | undefined];
  if (version === 'ff' || (version === '00' && rest !== undefined)) return null;
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return null;
  return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

/** traceparent の値（版は `00`） */
export const formatTraceparent = (ctx: TraceContext): string => `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;

function randomHex(bytes: number): string {
  let hex = '';
  for (const b of crypto.getRandomValues(new Uint8Array(bytes))) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** 新しいトレースの ID（32桁） */
export const newTraceId = (): string => randomHex(16);
/** 新しい区間の ID（16桁） */
export const newSpanId = (): string => randomHex(8);

/** 記録の割合を環境変数の文字列から読む（0〜1。なし、範囲の外、数でない値は1） */
export function sampleRateOf(value: string | null | undefined): number {
  const rate = value == null || value.trim() === '' ? NaN : Number(value);
  return rate >= 0 && rate <= 1 ? rate : 1;
}

/** 区間の属性。本文、クエリ、メールアドレスなどの個人情報は入れない */
export type SpanAttributes = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** 区間の結果 */
export type SpanStatus = 'ok' | 'error';

/** 処理の区間。`end` は最初の1回だけ有効 */
export type Span = {
  readonly context: TraceContext;
  setAttributes(attributes: SpanAttributes): void;
  end(status?: SpanStatus): void;
};

/**
 * 区間の出力先（ログ、OpenTelemetry など）
 * - `parent` は親の区間の文脈（なしは新しいトレース）
 * - 記録の対象は新しいトレースで実装が決め、子は親の `sampled` を継ぐ。対象の外の区間は `end` で何も出さない
 */
export type Tracer = {
  startSpan(name: string, attributes?: SpanAttributes, parent?: TraceContext | null): Span;
};

export type LogTracerOptions = Readonly<{
  /** 新しいトレースを記録する割合（0〜1、既定は1） */
  sampleRate?: number;
}>;

/**
 * 区間を終えたときに1行のログ（`event` は `span`、重さは `info`）を書く出力先
 * - 項目: `traceId`、`spanId`、`parentSpanId`、`name`、`durationMs`、`status`、`attributes`
 * - Workers の時刻は I/O の間だけ進むので、区間の時間は待ち合わせの時間になる
 */
export function logTracer(options: LogTracerOptions = {}): Tracer {
  const sampleRate = options.sampleRate ?? 1;
  return {
    startSpan(name, attributes = {}, parent = null) {
      const context: TraceContext = { traceId: parent?.traceId ?? newTraceId(), spanId: newSpanId(), sampled: parent ? parent.sampled : Math.random() < sampleRate };
      const attrs: Record<string, unknown> = { ...attributes };
      const started = performance.now();
      let ended = false;
      return {
        context,
        setAttributes: (more) => void Object.assign(attrs, more),
        end(status = 'ok') {
          if (ended) return;
          ended = true;
          if (!context.sampled) return;
          const durationMs = Math.round((performance.now() - started) * 10) / 10;
          log('info', 'span', { traceId: context.traceId, spanId: context.spanId, parentSpanId: parent?.spanId ?? null, name, durationMs, status, attributes: attrs });
        },
      };
    },
  };
}
