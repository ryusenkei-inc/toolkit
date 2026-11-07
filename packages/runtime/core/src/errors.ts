/** 再試行までの秒の既定（`Retry-After`） */
export const DEFAULT_RETRY_AFTER_SEC = 5;
// Durable Object の過負荷は、再起動より回復に時間がかかる
const OVERLOADED_RETRY_AFTER_SEC = 10;

/** 再試行で回復しうる基盤の失敗（外部の API の一時的な障害、回数の上限など） */
export class TransientError extends Error {
  override readonly name = 'TransientError';
  /** 再試行までの秒（未指定なら分類のときに `DEFAULT_RETRY_AFTER_SEC`） */
  readonly retryAfterSec: number | undefined;
  constructor(message: string, options: { retryAfterSec?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    const sec = options.retryAfterSec;
    this.retryAfterSec = sec !== undefined && Number.isFinite(sec) && sec >= 0 ? sec : undefined;
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

/** 例外の分類（HTTP に限らず、キューやスケジュールの処理でも使う） */
export type FailureKind = Readonly<{ kind: 'transient'; retryAfterSec: number }> | Readonly<{ kind: 'config' }> | Readonly<{ kind: 'unknown' }>;

const flag = (e: unknown, key: 'retryable' | 'overloaded') => typeof e === 'object' && e !== null && (e as Record<string, unknown>)[key] === true;
const nameOf = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined);

/**
 * 例外を分類する
 * - Durable Object の RPC の例外は `retryable`・`overloaded` が `true` なら一時的（Cloudflare の仕様）
 * - fetch の時間切れ・中断（`TimeoutError`・`AbortError`）は一時的
 */
export function classifyFailure(e: unknown): FailureKind {
  if (e instanceof ConfigError) return { kind: 'config' };
  if (e instanceof TransientError) return { kind: 'transient', retryAfterSec: e.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC };
  if (flag(e, 'overloaded')) return { kind: 'transient', retryAfterSec: OVERLOADED_RETRY_AFTER_SEC };
  if (flag(e, 'retryable')) return { kind: 'transient', retryAfterSec: DEFAULT_RETRY_AFTER_SEC };
  const name = nameOf(e);
  if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'transient', retryAfterSec: DEFAULT_RETRY_AFTER_SEC };
  return { kind: 'unknown' };
}

/** 一時的な失敗として包む。型つきの例外はそのまま返し、ほかは元の例外を `cause` に持つ */
export function asTransient(e: unknown, message: string): TransientError | ConfigError {
  if (e instanceof TransientError || e instanceof ConfigError) return e;
  const c = classifyFailure(e);
  return new TransientError(message, { cause: e, ...(c.kind === 'transient' && { retryAfterSec: c.retryAfterSec }) });
}
