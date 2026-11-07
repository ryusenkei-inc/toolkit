/**
 * 構造化ログ（1行の JSON）。事象は `event` のコードで表し、文言を書かない
 * - Workers のログは JSON の行をフィールドに分解して保存する
 * - `Error` の値は `name`・`message`・`stack` に展開（`JSON.stringify` は空のオブジェクトにするため）
 */
export function log(level, event, fields = {}) {
    const line = JSON.stringify({ level, event, ...fields }, (_key, value) => (value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value));
    console[level](line);
}
