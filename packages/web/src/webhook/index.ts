// Webhook とアプリどうしの要求の署名と検証（HMAC-SHA256、Web Crypto だけで動く）
// - 仕組み（時刻の許容、鍵の入れ替え、本文の読み方）はここ、ヘッダーの名前と署名の形式は使う側の値
// - 既定の形式 `requestScheme` は、時刻・メソッド・パスとクエリ・主体・本文の SHA-256 を署名する
import { ConfigError, err, ok, type Result } from '@ryusenkei/core';

/** 署名の鍵。鍵の入れ替えの間は新しい鍵を先、古い鍵を後に並べる */
export type WebhookSecrets = string | readonly string[];

/** 署名の対象 */
export type WebhookParts = Readonly<{
  method: string;
  url: string;
  /** 本文（なしは空） */
  body?: string | ArrayBuffer | Uint8Array | null;
  /** 主体（呼び出した人のメールアドレスなど。なしは空） */
  subject?: string | null;
}>;

/** 署名の形式に渡す値。本文はバイト列にしてある */
export type WebhookMessageInput = Readonly<{ method: string; url: URL; subject: string; body: Uint8Array<ArrayBuffer>; timestamp: number }>;

/** 署名する内容。配列はつないで1つにする */
export type WebhookMessage = string | Uint8Array | readonly (string | Uint8Array)[];

/**
 * 署名の形式（使う側の値）
 * - `message`: 署名する内容。時刻を使わない形式は `timestamp` を無視する
 * - `encoding`: 署名の符号化（既定は `base64url`）
 * - `header`: `timestamped`（既定）は `t=<秒>,v1=<署名>`（鍵ごとに `v1` を並べる）。`plain` は署名だけで、前に `prefix` を付ける。`plain` は時刻を照合せず、署名には最初の鍵だけを使う
 */
export type WebhookScheme = Readonly<{
  message(input: WebhookMessageInput): WebhookMessage | Promise<WebhookMessage>;
  encoding?: 'base64url' | 'base64' | 'hex';
  header?: 'timestamped' | 'plain';
  prefix?: string;
}>;

/** 検証の失敗のコード */
export type WebhookVerifyError = 'signature_missing' | 'signature_expired' | 'signature_mismatch';

export type SignWebhookOptions = Readonly<{
  /** 今の時刻（ミリ秒） */
  now?: number;
  /** 署名の形式（既定は `requestScheme`） */
  scheme?: WebhookScheme;
}>;

export type VerifyWebhookOptions = SignWebhookOptions &
  Readonly<{
    /** 署名の時刻と今の時刻のずれの許容（秒、既定は300）。範囲の中の再送は防がない */
    toleranceSec?: number;
  }>;

const enc = new TextEncoder();
const DEFAULT_TOLERANCE_SEC = 300;
// 1つのヘッダーで照合する署名の上限（長いヘッダーで照合の回数を増やされないため）
const MAX_SIGNATURES = 8;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function encode(bytes: Uint8Array, encoding: NonNullable<WebhookScheme['encoding']>): string {
  if (encoding === 'hex') return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return encoding === 'base64' ? toBase64(bytes) : base64Url(bytes);
}

function decode(value: string, encoding: NonNullable<WebhookScheme['encoding']>): Uint8Array<ArrayBuffer> | null {
  try {
    if (encoding === 'hex') return /^(?:[0-9a-fA-F]{2})+$/.test(value) ? Uint8Array.from(value.match(/../g)!, (h) => parseInt(h, 16)) : null;
    const b64 = encoding === 'base64url' ? value.replace(/-/g, '+').replace(/_/g, '/') : value;
    return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const bytesOf = (body: WebhookParts['body']): Uint8Array<ArrayBuffer> => (typeof body === 'string' ? enc.encode(body) : body ? new Uint8Array(body) : new Uint8Array());

function concat(message: WebhookMessage): Uint8Array<ArrayBuffer> {
  const parts = (Array.isArray(message) ? message : [message]) as readonly (string | Uint8Array)[];
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * 既定の署名の形式（`@ryusenkei/web/form/server` の `webhookDestination` が使う）
 * - 署名する内容: `v1`、時刻、メソッド、パスとクエリ、主体、本文の SHA-256（base64url）を改行でつないだもの
 * - ホスト名は対象外（service binding と手元の fetch で宛先のホスト名が違うため）
 * - 署名は base64url、ヘッダーは `t=<秒>,v1=<署名>`
 */
export const requestScheme: WebhookScheme = {
  async message({ method, url, subject, body, timestamp }) {
    const digest = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', body)));
    return ['v1', timestamp, method.toUpperCase(), `${url.pathname}${url.search}`, subject, digest].join('\n');
  },
};

const secretsOf = (secret: WebhookSecrets | null | undefined): string[] => (typeof secret === 'string' ? [secret] : [...(secret ?? [])]).filter(Boolean);

function requireSecrets(secret: WebhookSecrets | null | undefined): string[] {
  const secrets = secretsOf(secret);
  if (!secrets.length) throw new ConfigError('署名の鍵が未設定', { key: 'secret' });
  return secrets;
}

const hmacKey = (secret: string, usage: 'sign' | 'verify') => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

async function messageOf(scheme: WebhookScheme, parts: WebhookParts, timestamp: number): Promise<Uint8Array<ArrayBuffer>> {
  return concat(await scheme.message({ method: parts.method, url: new URL(parts.url), subject: parts.subject ?? '', body: bytesOf(parts.body), timestamp }));
}

/**
 * 署名のヘッダーの値
 * - 鍵が空なら `ConfigError`
 * - `timestamped` の形式は鍵ごとの `v1` を鍵の順に並べる
 */
export async function signWebhook(secret: WebhookSecrets, parts: WebhookParts, options: SignWebhookOptions = {}): Promise<string> {
  const scheme = options.scheme ?? requestScheme;
  const encoding = scheme.encoding ?? 'base64url';
  const secrets = requireSecrets(secret);
  const t = Math.floor((options.now ?? Date.now()) / 1000);
  const message = await messageOf(scheme, parts, t);
  const sign = async (s: string) => encode(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(s, 'sign'), message)), encoding);
  if (scheme.header === 'plain') return `${scheme.prefix ?? ''}${await sign(secrets[0]!)}`;
  const sigs = await Promise.all(secrets.map(sign));
  return [`t=${t}`, ...sigs.map((s) => `v1=${s}`)].join(',');
}

function parseHeader(scheme: WebhookScheme, header: string): { timestamp?: number; signatures: string[] } {
  if (scheme.header === 'plain') {
    const prefix = scheme.prefix ?? '';
    const value = header.trim();
    return { signatures: value.startsWith(prefix) && value.length > prefix.length ? [value.slice(prefix.length)] : [] };
  }
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const field of header.split(',')) {
    // 値の base64 の `=` を切らないよう、最初の `=` で分ける
    const at = field.indexOf('=');
    const [key, value] = at < 0 ? [field.trim(), ''] : [field.slice(0, at).trim(), field.slice(at + 1).trim()];
    if (key === 't' && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && value && signatures.length < MAX_SIGNATURES) signatures.push(value);
  }
  return { ...(timestamp !== undefined && { timestamp }), signatures };
}

/**
 * 署名を検証する（鍵のどれかと署名のどれかが合えば成功）
 * - 鍵が空なら `ConfigError`（検証を飛ばして通さない）
 * - `body` は受けた本文そのもの（JSON を読み直した値では合わない）
 * - 署名の比較は Web Crypto の `verify`（一致する位置で時間が変わらない）
 */
export async function verifyWebhook(secret: WebhookSecrets | null | undefined, header: string | null | undefined, parts: WebhookParts, options: VerifyWebhookOptions = {}): Promise<Result<void, WebhookVerifyError>> {
  const scheme = options.scheme ?? requestScheme;
  const encoding = scheme.encoding ?? 'base64url';
  const secrets = requireSecrets(secret);
  const { timestamp, signatures } = parseHeader(scheme, header ?? '');
  const timed = scheme.header !== 'plain';
  if (!signatures.length || (timed && timestamp === undefined)) return err('signature_missing');
  if (timed && Math.abs((options.now ?? Date.now()) / 1000 - timestamp!) > (options.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) return err('signature_expired');
  const message = await messageOf(scheme, parts, timestamp ?? 0);
  const decoded = signatures.map((s) => decode(s, encoding)).filter((s) => s !== null);
  for (const s of secrets) {
    const key = await hmacKey(s, 'verify');
    for (const sig of decoded) if (await crypto.subtle.verify('HMAC', key, sig, message)) return ok();
  }
  return err('signature_mismatch');
}

export type WebhookHeadersOptions = SignWebhookOptions &
  Readonly<{
    /** 署名のヘッダーの名前 */
    header: string;
    /** 主体のヘッダーの名前（なしは主体を署名しない） */
    subjectHeader?: string;
    /** 元のヘッダー */
    init?: HeadersInit;
  }>;

/** 署名を足したヘッダー（`init` に署名と主体を足した新しい `Headers`） */
export async function webhookHeaders(secret: WebhookSecrets, parts: WebhookParts, options: WebhookHeadersOptions): Promise<Headers> {
  const headers = new Headers(options.init);
  const subject = options.subjectHeader ? (parts.subject ?? null) : null;
  if (options.subjectHeader && subject) headers.set(options.subjectHeader, subject);
  headers.set(options.header, await signWebhook(secret, { ...parts, subject }, options));
  return headers;
}

export type VerifyWebhookRequestOptions = VerifyWebhookOptions &
  Readonly<{
    /** 署名のヘッダーの名前 */
    header: string;
    /** 主体のヘッダーの名前（なしは主体なしで検証する） */
    subjectHeader?: string;
  }>;

/** 要求の署名を検証する。本文は複製から読むので、元の要求の本文は後で読める */
export async function verifyWebhookRequest(secret: WebhookSecrets | null | undefined, request: Request, options: VerifyWebhookRequestOptions): Promise<Result<void, WebhookVerifyError>> {
  requireSecrets(secret);
  const header = request.headers.get(options.header);
  if (!header) return err('signature_missing');
  const body = request.body ? new Uint8Array(await request.clone().arrayBuffer()) : null;
  const subject = options.subjectHeader ? request.headers.get(options.subjectHeader) : null;
  return verifyWebhook(secret, header, { method: request.method, url: request.url, body, subject }, options);
}
