import { classifyFailure } from './errors.ts';
import { log } from './log.ts';
import { jsonLogReporter, reportSafely, type ErrorContext, type ErrorReporter } from './report.ts';

export const REQUEST_ID_HEADER = 'x-request-id';
// 外から来た値を、ログや応答にそのまま書いても安全な形に限る
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** 相関の ID。正しい形の値はそのまま使い、ないか不正なら新しく作る */
export const sanitizeRequestId = (value: string | null | undefined): string => (value && REQUEST_ID_PATTERN.test(value) ? value : crypto.randomUUID());

/** 要求に相関の ID を付ける（ヘッダーの値を正しい形にそろえた要求を返す） */
export function withRequestId(request: Request): Readonly<{ request: Request; requestId: string }> {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = sanitizeRequestId(incoming);
  if (incoming === requestId) return { request, requestId };
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return { request: new Request(request, { headers }), requestId };
}

/** 基盤の失敗の HTTP の形 */
export type Failure =
  | Readonly<{ status: 503; code: 'unavailable'; retryAfterSec: number }>
  | Readonly<{ status: 503; code: 'not_configured' }>
  | Readonly<{ status: 500; code: 'internal' }>;

/** 例外の分類を HTTP の形にする */
export function failureOf(e: unknown): Failure {
  const c = classifyFailure(e);
  if (c.kind === 'transient') return { status: 503, code: 'unavailable', retryAfterSec: c.retryAfterSec };
  if (c.kind === 'config') return { status: 503, code: 'not_configured' };
  return { status: 500, code: 'internal' };
}

export type FailureResponseOptions = {
  requestId?: string;
  context?: Omit<ErrorContext, 'requestId' | 'status'>;
  /** 想定外の失敗の報告先（既定はログ） */
  reporter?: ErrorReporter;
  /** 報告を応答の後に回す（Workers の `ctx.waitUntil` など） */
  defer?: (promise: Promise<unknown>) => void;
};

/**
 * 例外を JSON の応答（`{ "error": <code>, "requestId": <id> }`）に変える
 * - 本文にはコードだけを入れる（例外の文や設定の名前を出さない）
 * - 一時的な失敗は `Retry-After`（秒、切り上げ）、設定の不足はログに `warn`、想定外の失敗は報告先へ
 * - すべての応答に `cache-control: no-store` と相関の ID
 */
export function failureResponse(e: unknown, options: FailureResponseOptions = {}): Response {
  const failure = failureOf(e);
  const context: ErrorContext = { ...options.context, ...(options.requestId && { requestId: options.requestId }), status: failure.status };
  if (failure.code === 'internal') {
    const reported = reportSafely(options.reporter ?? jsonLogReporter, e, context);
    if (options.defer) options.defer(reported);
    else void reported;
  } else {
    log('warn', failure.code, { ...context, error: e });
  }
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  if (options.requestId) headers.set(REQUEST_ID_HEADER, options.requestId);
  if (failure.code === 'unavailable') headers.set('retry-after', String(Math.ceil(failure.retryAfterSec)));
  return new Response(JSON.stringify({ error: failure.code, ...(options.requestId && { requestId: options.requestId }) }), { status: failure.status, headers });
}
