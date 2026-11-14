// HTTP の応答と送信の失敗を、core の例外の分類に合わせる
import { ConfigError, TransientError, UsageError } from '@ryusenkei/core';

/**
 * 成功でない応答の例外
 * - 認証と権限（401、403）は `ConfigError`、一時的な状態（408、429、5xx）は `TransientError`、ほかは `UsageError`（`code`）
 * - 文には状態と、本文の先頭（300字まで）を入れる
 */
export async function httpFailure(res: Response, code: string, what: string): Promise<Error> {
  const text = (await res.text().catch(() => '')).slice(0, 300);
  const message = `${what}: ${res.status} ${text}`.trim();
  if (res.status === 401 || res.status === 403) return new ConfigError(message, { key: 'credentials' });
  if (res.status === 408 || res.status === 429 || res.status >= 500) return new TransientError(message);
  return new UsageError(code, message);
}

/** 送信の失敗（接続できない、時間切れ）を `TransientError` にする */
export async function send(what: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    throw new TransientError(`${what}: 接続できない`, { cause: e });
  }
}
