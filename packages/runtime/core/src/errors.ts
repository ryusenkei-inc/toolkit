import { log } from './log.ts';

/** 再試行で回復しうる基盤の失敗（外部の API の一時的な障害、回数の上限など） */
export class TransientError extends Error {
  override readonly name = 'TransientError';
  /** 再試行までの秒数（不明なら `undefined`） */
  readonly retryAfterSec: number | undefined;
  constructor(message: string, options: { retryAfterSec?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.retryAfterSec = options.retryAfterSec;
  }
}

/** 設定の不足・誤り（環境変数、binding）。直すまで回復しない */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  /** 不足・誤りのある設定の名前 */
  readonly key: string | undefined;
  constructor(message: string, options: { key?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.key = options.key;
  }
}

/** 境界で分類した基盤の失敗 */
export type Failure =
  | { status: 503; code: 'unavailable'; retryAfterSec: number | undefined }
  | { status: 503; code: 'not_configured' }
  | { status: 500; code: 'internal' };

export function classifyFailure(e: unknown): Failure {
  if (e instanceof TransientError) return { status: 503, code: 'unavailable', retryAfterSec: e.retryAfterSec };
  if (e instanceof ConfigError) return { status: 503, code: 'not_configured' };
  return { status: 500, code: 'internal' };
}

/**
 * 例外を分類してログに出し、JSON の応答（`{ "error": <code> }`）に変える
 * - 一時的な失敗は `Retry-After` を付ける
 * - 想定外の例外は `error` で報告し、設定の不足は `warn`
 */
export function failureResponse(e: unknown, init: { headers?: HeadersInit } = {}): Response {
  const failure = classifyFailure(e);
  log(failure.code === 'internal' ? 'error' : 'warn', failure.code, { error: e });
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (failure.code === 'unavailable' && failure.retryAfterSec !== undefined) headers.set('retry-after', String(Math.ceil(failure.retryAfterSec)));
  return new Response(JSON.stringify({ error: failure.code }), { status: failure.status, headers });
}
