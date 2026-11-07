export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** ログに書く例外の形 */
export type SerializedError = Readonly<{ name: string; message: string; stack?: string; cause?: SerializedError } & Record<string, unknown>>;

// ログの1行を大きくしないための上限
const MESSAGE_MAX = 500;
const STACK_LINES = 8;
const STACK_MAX = 2000;
const OWN_KEYS_SKIPPED = new Set(['name', 'message', 'stack', 'cause']);

/**
 * 例外をログの形にする
 * - 文とスタックは先頭だけ、`cause` は1段まで
 * - 例外が持つ項目（`ConfigError` の `key`、`TransientError` の `retryAfterSec` など）も残す
 * - `Error` でない値は名前 `NonError` と文字列
 */
export function serializeError(e: unknown, depth = 0): SerializedError {
  if (!(e instanceof Error)) return { name: 'NonError', message: String(e).slice(0, MESSAGE_MAX) };
  const own = Object.fromEntries(Object.entries(e).filter(([k, v]) => !OWN_KEYS_SKIPPED.has(k) && v !== undefined && typeof v !== 'function'));
  const stack = e.stack?.split('\n').slice(0, STACK_LINES).join('\n').slice(0, STACK_MAX);
  const cause = depth === 0 && e.cause !== undefined ? serializeError(e.cause, 1) : undefined;
  return { ...own, name: e.name, message: e.message.slice(0, MESSAGE_MAX), ...(stack && { stack }), ...(cause && { cause }) };
}

/**
 * 構造化ログ（1行の JSON）。事象は `event` のコードで表し、文言を書かない
 * - Workers のログは JSON の行をフィールドに分解して保存する
 * - 項目の中の `Error` は `serializeError` の形にする
 * - 入力の本文やメールアドレスなどの個人情報は項目に入れない（呼ぶ側の責任）
 */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ...fields, level, event }, (_key, value: unknown) => (value instanceof Error ? serializeError(value) : value));
  console[level](line);
}
