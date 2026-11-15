// 推測できないトークンと、その保存用のハッシュ（セッションと招待で共通。Web Crypto だけで動く）
import { encodeBytes } from './encoding.ts';

/** `bytes` バイトの乱数の base64url（32 バイトで43文字） */
export const randomToken = (bytes: number): string => encodeBytes(crypto.getRandomValues(new Uint8Array(bytes)), 'base64url');

/** SHA-256 の hex（保存するのはハッシュだけにし、置き場所が漏れてもトークンを戻せないようにする。乱数のトークンなのでソルトは要らない） */
export async function sha256Hex(value: string): Promise<string> {
  return encodeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), 'hex');
}

/** base64url のトークンの形（形の合わない値で置き場所を引かない） */
export const isTokenShaped = (value: string, minLength: number): boolean => value.length >= minLength && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
