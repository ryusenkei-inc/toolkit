// バイト列と文字列の符号化（webhook の署名、JWT の検証で共通。Web 標準の atob・btoa だけで動く）

/** 符号化の形式 */
export type ByteEncoding = 'base64url' | 'base64' | 'hex';

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

/** バイト列を文字列にする（base64url は末尾の `=` を付けない） */
export function encodeBytes(bytes: Uint8Array, encoding: ByteEncoding): string {
  if (encoding === 'hex') return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const base64 = toBase64(bytes);
  return encoding === 'base64' ? base64 : base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 文字列をバイト列に戻す（形の誤りは `null`。base64 と base64url は末尾の `=` を省いてもよい） */
export function decodeBytes(value: string, encoding: ByteEncoding): Uint8Array<ArrayBuffer> | null {
  try {
    if (encoding === 'hex') return /^(?:[0-9a-fA-F]{2})+$/.test(value) ? Uint8Array.from(value.match(/../g)!, (h) => parseInt(h, 16)) : null;
    const base64 = encoding === 'base64url' ? value.replace(/-/g, '+').replace(/_/g, '/') : value;
    return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
