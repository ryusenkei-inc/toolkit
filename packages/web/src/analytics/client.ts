// 計測の送り口（ブラウザ）。受け取る側は使う側の API（検査して `EventRecorder` に記録する）

/**
 * 出来事を JSON で送る（応答を待たず、失敗は無視する）
 * - `navigator.sendBeacon` で送る（画面を移った後も送り終える）。使えない環境は `keepalive` の `fetch`
 * - 本文の型は `text/plain`（preflight を起こさない）。受け取る側は本文を JSON として読む
 * - 自動操作のブラウザ（`navigator.webdriver`）とサーバーの上では送らない
 */
export function sendEvent(url: string, event: unknown): void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || navigator.webdriver) return;
  try {
    const body = JSON.stringify(event);
    if (navigator.sendBeacon?.(url, body)) return;
    void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => undefined);
  } catch {
    // 計測の失敗で画面の操作を止めない
  }
}
