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

/** ログの各行に足す文脈の項目を返す関数（実行中の要求の traceId など） */
export type LogContextProvider = () => Readonly<Record<string, unknown>> | undefined;

let contextOf: LogContextProvider | undefined;

/**
 * ログの各行に足す文脈の項目を登録する（`undefined` で解除）
 * - 行を書くたびに呼ぶ。要求ごとの値は、呼ばれた時点の実行の文脈（AsyncLocalStorage など）から返す
 * - 登録は1つだけで、後の登録が前の登録を置き換える
 * - 呼ぶ側の項目が文脈の項目より優先する
 */
export function setLogContext(provider: LogContextProvider | undefined): void {
  contextOf = provider;
}

/**
 * 構造化ログ（1行の JSON）。事象は `event` のコードで表し、文言を書かない
 * - Workers のログは JSON の行をフィールドに分解して保存する
 * - 項目の中の `Error` は `serializeError` の形にする
 * - `setLogContext` の文脈の項目を足す（文脈の関数の例外は無視して行を書く）
 * - 入力の本文やメールアドレスなどの個人情報は項目に入れない（呼ぶ側の責任）
 */
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  let context: Readonly<Record<string, unknown>> | undefined;
  try {
    context = contextOf?.();
  } catch {
    context = undefined;
  }
  const line = JSON.stringify({ ...context, ...fields, level, event }, (_key, value: unknown) => (value instanceof Error ? serializeError(value) : value));
  console[level](line);
}
