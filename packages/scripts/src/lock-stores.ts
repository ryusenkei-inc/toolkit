// ロックの置き場所のアダプター: R2（S3 互換の API、署名は AWS Signature V4）と GCS（JSON API）
// - 外部の SDK に依存しない。認証は使う側が渡す（R2 は `r2CredentialsOf` の値、GCS はアクセストークン）
// - 失敗: 認証と権限（401、403）は `ConfigError`、接続の失敗と一時的な状態（408、429、5xx）は `TransientError`
// - ほかの失敗は `UsageError`（`lock_*_failed`）
import { createHash, createHmac } from 'node:crypto';
import { httpFailure, send as sendOrThrow } from './failure.ts';
import type { HttpRequestInit, LockStore, StoredLock } from './lock.ts';

export type S3Credentials = Readonly<{ accessKeyId: string; secretAccessKey: string }>;

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
// R2 は gzip で返す応答の ETag を弱い形（`W/"…"`）にし、`If-Match` の弱い ETag を412で拒む。比べるのは強い形
const strongEtag = (etag: string | null) => (etag ?? '').replace(/^W\//, '');
const encodePath = (key: string) => key.split('/').map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');

/**
 * S3 の要求の署名（AWS Signature V4、クエリなし）。`host`、`x-amz-date`、`x-amz-content-sha256` と `extra` のヘッダーに署名する
 * @param extra 足すヘッダー（`if-match` など。名前は小文字）
 */
export function signS3Request(
  input: Readonly<{ method: string; url: string; body?: string; region?: string; credentials: S3Credentials; extra?: Readonly<Record<string, string>>; now?: () => number }>,
): HttpRequestInit {
  const url = new URL(input.url);
  const region = input.region ?? 'auto';
  const amzDate = new Date((input.now ?? Date.now)()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(input.body ?? '');
  const signed: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...input.extra };
  const names = Object.keys(signed).sort();
  const canonical = [input.method, url.pathname, '', ...names.map((n) => `${n}:${signed[n]!.trim()}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host: _, ...headers } = signed;
  return {
    url: url.href,
    method: input.method,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
  };
}

export type R2LockStoreOptions = Readonly<{
  accountId: string;
  bucket: string;
  /** ロックのキー（例: `deploy.lock`、`<リポ>/deploy.lock`） */
  key: string;
  /** S3 互換の認証（`r2CredentialsOf` の値か、R2 の API トークン） */
  credentials: S3Credentials;
  /** 既定は `https://<accountId>.r2.cloudflarestorage.com` */
  endpoint?: string;
  fetch?: typeof fetch;
}>;

/**
 * R2 のオブジェクトのロック（S3 互換の API）
 * - 版は ETag。作るときは `If-None-Match: *`、上書きは `If-Match`。条件が合わない応答（412、409）は `null`
 * - 圧縮させない（`Accept-Encoding: identity`）。gzip の応答の ETag は弱い形になり、書いたときの ETag と一致しない
 */
export function r2LockStore(options: R2LockStoreOptions): LockStore {
  const fetcher = options.fetch ?? fetch;
  const endpoint = (options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`).replace(/\/$/, '');
  const url = `${endpoint}/${encodeURIComponent(options.bucket)}/${encodePath(options.key)}`;
  const request = (method: string, body?: string, extra?: Record<string, string>) => signS3Request({ method, url, credentials: options.credentials, ...(body !== undefined && { body }), ...(extra && { extra }) });
  const send = (r: HttpRequestInit, body?: string) => sendOrThrow('ロックの置き場所（R2）', () => fetcher(r.url, { method: r.method, headers: { ...r.headers, 'accept-encoding': 'identity' }, ...(body !== undefined && { body }), signal: AbortSignal.timeout(15_000) }));
  return {
    name: `r2://${options.bucket}/${options.key}`,
    async read(): Promise<StoredLock | null> {
      const res = await send(request('GET'));
      if (res.status === 404) return null;
      if (!res.ok) throw await httpFailure(res, 'lock_read_failed', 'ロックの読み込みの失敗');
      return { content: await res.text(), version: strongEtag(res.headers.get('etag')) };
    },
    async write(content, ifVersion) {
      const condition: Record<string, string> = ifVersion === null ? { 'if-none-match': '*' } : { 'if-match': strongEtag(ifVersion) };
      const res = await send(request('PUT', content, { 'content-type': 'application/json', ...condition }), content);
      if (res.status === 412 || res.status === 409) return null;
      if (!res.ok) throw await httpFailure(res, 'lock_write_failed', 'ロックの書き込みの失敗');
      return strongEtag(res.headers.get('etag'));
    },
    async remove() {
      const res = await send(request('DELETE'));
      if (!res.ok && res.status !== 404) throw await httpFailure(res, 'lock_remove_failed', 'ロックの削除の失敗');
    },
    removeRequest: () => request('DELETE'),
  };
}

export type GcsLockStoreOptions = Readonly<{
  bucket: string;
  key: string;
  /** アクセストークン（`gcloudAccessToken()` など。権限はバケットのオブジェクトの読み書き） */
  accessToken: () => Promise<string> | string;
  fetch?: typeof fetch;
}>;

const GCS = 'https://storage.googleapis.com';

/**
 * GCS のオブジェクトのロック（JSON API）
 * - 版は generation。作るときは `ifGenerationMatch=0`、上書きはその generation。条件が合わない応答（412）は `null`
 * - 終了の処理で消す要求には、最後に使ったトークンを使う
 */
export function gcsLockStore(options: GcsLockStoreOptions): LockStore {
  const fetcher = options.fetch ?? fetch;
  const object = `${GCS}/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodeURIComponent(options.key)}`;
  let lastToken = '';
  const headers = async (extra: Record<string, string> = {}) => {
    lastToken = await options.accessToken();
    return { authorization: `Bearer ${lastToken}`, ...extra };
  };
  const timeout = () => AbortSignal.timeout(15_000);
  return {
    name: `gs://${options.bucket}/${options.key}`,
    async read(): Promise<StoredLock | null> {
      const res = await sendOrThrow('ロックの置き場所（GCS）', async () => fetcher(`${object}?alt=media`, { headers: await headers(), signal: timeout() }));
      if (res.status === 404) return null;
      if (!res.ok) throw await httpFailure(res, 'lock_read_failed', 'ロックの読み込みの失敗');
      return { content: await res.text(), version: res.headers.get('x-goog-generation') ?? '' };
    },
    async write(content, ifVersion) {
      const query = new URLSearchParams({ uploadType: 'media', name: options.key, ifGenerationMatch: ifVersion ?? '0' });
      const res = await sendOrThrow('ロックの置き場所（GCS）', async () => fetcher(`${GCS}/upload/storage/v1/b/${encodeURIComponent(options.bucket)}/o?${query}`, { method: 'POST', headers: await headers({ 'content-type': 'application/json' }), body: content, signal: timeout() }));
      if (res.status === 412) return null;
      if (!res.ok) throw await httpFailure(res, 'lock_write_failed', 'ロックの書き込みの失敗');
      const body = (await res.json()) as { generation?: string };
      return String(body.generation ?? '');
    },
    async remove() {
      const res = await sendOrThrow('ロックの置き場所（GCS）', async () => fetcher(object, { method: 'DELETE', headers: await headers(), signal: timeout() }));
      if (!res.ok && res.status !== 404) throw await httpFailure(res, 'lock_remove_failed', 'ロックの削除の失敗');
    },
    removeRequest: () => ({ url: object, method: 'DELETE', headers: { authorization: `Bearer ${lastToken}` } }),
  };
}
