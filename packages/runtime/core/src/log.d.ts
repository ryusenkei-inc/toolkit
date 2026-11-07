export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
/**
 * 構造化ログ（1行の JSON）。事象は `event` のコードで表し、文言を書かない
 * - Workers のログは JSON の行をフィールドに分解して保存する
 * - `Error` の値は `name`・`message`・`stack` に展開（`JSON.stringify` は空のオブジェクトにするため）
 */
export declare function log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
