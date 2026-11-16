// Standard Webhooks の仕様の署名と検証。Web Crypto だけで動く
// - ヘッダーは `webhook-id`、`webhook-timestamp`（秒）、`webhook-signature`（`v1,<base64>` を空白で並べる）
// - 署名の対象は `<id>.<timestamp>.<本文>`、鍵は `whsec_` に続く base64 を戻したバイト列
import { ConfigError, err, ok, type Result } from '@ryusenkei/core';
import { decodeBytes as decode, encodeBytes as encode } from '../internal/encoding.ts';
import type { WebhookVerifyError } from './index.ts';

/** 署名の鍵（`whsec_<base64>`）。鍵の入れ替えの間は新しい鍵を先、古い鍵を後に並べる */
export type StandardWebhookSecrets = string | readonly string[];

/** 署名の対象 */
export type StandardWebhookParts = Readonly<{
  /** 通知の ID（再送でも同じ値。受け手はこれで重複を除く） */
  id: string;
  /** 本文（受けたまま、または送るまま） */
  body: string | ArrayBuffer | Uint8Array;
}>;

/** 検証に通った通知の ID と時刻（秒） */
export type StandardWebhookVerified = Readonly<{ id: string; timestamp: number }>;

export type StandardWebhookOptions = Readonly<{
  /** 今の時刻（ミリ秒）を返す関数（既定は `Date.now`） */
  now?: () => number;
}>;

export type VerifyStandardWebhookOptions = StandardWebhookOptions &
  Readonly<{
    /** 署名の時刻と今の時刻のずれの許容（秒、既定は300）。範囲の中の再送は ID で除く */
    toleranceSec?: number;
  }>;

/** ヘッダーの名前 */
export const STANDARD_WEBHOOK_HEADERS = { id: 'webhook-id', timestamp: 'webhook-timestamp', signature: 'webhook-signature' } as const;

const PREFIX = 'whsec_';
const enc = new TextEncoder();
const DEFAULT_TOLERANCE_SEC = 300;
// 1つのヘッダーで照合する署名の上限（長いヘッダーで照合の回数を増やされないため）
const MAX_SIGNATURES = 8;

function keysOf(secret: StandardWebhookSecrets | null | undefined): Uint8Array<ArrayBuffer>[] {
  const list = (typeof secret === 'string' ? [secret] : [...(secret ?? [])]).filter(Boolean);
  if (!list.length) throw new ConfigError('署名の鍵が未設定', { key: 'secret' });
  return list.map((s) => {
    const key = decode(s.startsWith(PREFIX) ? s.slice(PREFIX.length) : s, 'base64');
    if (!key?.length) throw new ConfigError('署名の鍵が whsec_<base64> の形でない', { key: 'secret' });
    return key;
  });
}

const hmacKey = (key: Uint8Array<ArrayBuffer>, usage: 'sign' | 'verify') => crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

function contentOf(id: string, timestamp: number, body: StandardWebhookParts['body']): Uint8Array<ArrayBuffer> {
  const head = enc.encode(`${id}.${timestamp}.`);
  const bytes = typeof body === 'string' ? enc.encode(body) : new Uint8Array(body);
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head);
  out.set(bytes, head.length);
  return out;
}

/** 新しい鍵（`whsec_` と、24バイトの乱数の base64） */
export function generateStandardWebhookSecret(): string {
  return `${PREFIX}${encode(crypto.getRandomValues(new Uint8Array(24)), 'base64')}`;
}

/**
 * `webhook-signature` の値（`v1,<base64>`。鍵ごとに空白で並べる）
 * - `timestamp` は秒
 * - 鍵が空か形が違えば `ConfigError`
 */
export async function standardWebhookSignature(secret: StandardWebhookSecrets, parts: StandardWebhookParts, timestamp: number): Promise<string> {
  const content = contentOf(parts.id, timestamp, parts.body);
  const sigs = await Promise.all(keysOf(secret).map(async (k) => `v1,${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(k, 'sign'), content)), 'base64')}`));
  return sigs.join(' ');
}

/** 署名の3つのヘッダーを足した `Headers`（`init` に足した新しいもの） */
export async function standardWebhookHeaders(secret: StandardWebhookSecrets, parts: StandardWebhookParts, options: StandardWebhookOptions & Readonly<{ init?: HeadersInit }> = {}): Promise<Headers> {
  const timestamp = Math.floor((options.now ?? Date.now)() / 1000);
  const headers = new Headers(options.init);
  headers.set(STANDARD_WEBHOOK_HEADERS.id, parts.id);
  headers.set(STANDARD_WEBHOOK_HEADERS.timestamp, String(timestamp));
  headers.set(STANDARD_WEBHOOK_HEADERS.signature, await standardWebhookSignature(secret, parts, timestamp));
  return headers;
}

/** ヘッダーの読み方（`Headers` か、名前 → 値のオブジェクト） */
type HeaderSource = Headers | Readonly<Record<string, string | null | undefined>>;

const headerOf = (headers: HeaderSource, name: string): string | null => {
  if (headers instanceof Headers) return headers.get(name);
  const found = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  return found?.[1] ?? null;
};

/**
 * 署名を検証する（鍵のどれかと `v1` の署名のどれかが合えば成功）。通れば通知の ID と時刻
 * - 鍵が空か形が違えば `ConfigError`（検証を飛ばして通さない）
 * - `body` は受けた本文そのもの（JSON を読み直した値では合わない）
 * - `v1` 以外の版の署名は無視する
 */
export async function verifyStandardWebhook(
  secret: StandardWebhookSecrets | null | undefined,
  headers: HeaderSource,
  body: StandardWebhookParts['body'],
  options: VerifyStandardWebhookOptions = {},
): Promise<Result<StandardWebhookVerified, WebhookVerifyError>> {
  const keys = keysOf(secret);
  const id = headerOf(headers, STANDARD_WEBHOOK_HEADERS.id);
  const ts = headerOf(headers, STANDARD_WEBHOOK_HEADERS.timestamp)?.trim();
  const signatures = (headerOf(headers, STANDARD_WEBHOOK_HEADERS.signature) ?? '')
    .split(' ')
    .filter((s) => s.startsWith('v1,') && s.length > 3)
    .slice(0, MAX_SIGNATURES)
    .map((s) => decode(s.slice(3), 'base64'))
    .filter((s) => s !== null);
  if (!id || !ts || !/^\d+$/.test(ts) || !signatures.length) return err('signature_missing');
  const timestamp = Number(ts);
  if (Math.abs((options.now ?? Date.now)() / 1000 - timestamp) > (options.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) return err('signature_expired');
  const content = contentOf(id, timestamp, body);
  for (const k of keys) {
    const key = await hmacKey(k, 'verify');
    for (const sig of signatures) if (await crypto.subtle.verify('HMAC', key, sig, content)) return ok({ id, timestamp });
  }
  return err('signature_mismatch');
}

/** 要求の署名を検証する。本文は複製から読むので、元の要求の本文は後で読める */
export async function verifyStandardWebhookRequest(secret: StandardWebhookSecrets | null | undefined, request: Request, options: VerifyStandardWebhookOptions = {}): Promise<Result<StandardWebhookVerified, WebhookVerifyError>> {
  keysOf(secret);
  if (!request.headers.get(STANDARD_WEBHOOK_HEADERS.signature)) return err('signature_missing');
  return verifyStandardWebhook(secret, request.headers, new Uint8Array(await request.clone().arrayBuffer()), options);
}
