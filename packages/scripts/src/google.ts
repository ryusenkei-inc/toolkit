// Google の API のアクセストークンと、Search Console（所有権の確認、プロパティ、sitemap）の呼び出し
// - 鍵は作らない。使う側がサービスアカウントの鍵か、gcloud のログイン（ADC）を渡す
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execOutput } from './exec.ts';

/** アクセストークンを返す関数（期限の前に作り直す） */
export type AccessToken = () => Promise<string>;

export const GOOGLE_SCOPES = {
  /** Search Console（プロパティの追加、sitemap の送信と一覧） */
  webmasters: 'https://www.googleapis.com/auth/webmasters',
  /** 所有権の確認（Site Verification API） */
  siteVerification: 'https://www.googleapis.com/auth/siteverification',
  /** GCS などの Google Cloud の API */
  cloudPlatform: 'https://www.googleapis.com/auth/cloud-platform',
} as const;

/** サービスアカウントの鍵（JSON）の使う項目 */
export type ServiceAccountKey = Readonly<{ client_email: string; private_key: string; token_uri?: string }>;

const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/**
 * サービスアカウントの鍵からアクセストークン（JWT の bearer の付与、RS256）
 * @param key 鍵の JSON の値、JSON の文字列、または鍵のファイルのパス
 * @param scopes `GOOGLE_SCOPES` の値など
 */
export function serviceAccountToken(key: ServiceAccountKey | string, scopes: readonly string[], options: Readonly<{ fetch?: typeof fetch; now?: () => number }> = {}): AccessToken {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    const k: ServiceAccountKey = typeof key === 'string' ? (JSON.parse(key.trimStart().startsWith('{') ? key : readFileSync(key, 'utf8')) as ServiceAccountKey) : key;
    const tokenUri = k.token_uri ?? 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iss: k.client_email, scope: scopes.join(' '), aud: tokenUri, iat, exp: iat + 3600 }))}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(k.private_key);
    const res = await fetcher(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(signature)}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`google_token_failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    cached = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  };
}

/**
 * gcloud のログインからアクセストークン（`gcloud auth application-default print-access-token`）
 * - Search Console の権限を含めてログインしておく:
 *   `gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/siteverification`
 * - トークンは50分ごとに取り直す
 */
export function gcloudAccessToken(options: Readonly<{ now?: () => number; run?: () => string | null }> = {}): AccessToken {
  const now = options.now ?? Date.now;
  const run = options.run ?? (() => execOutput('gcloud', ['auth', 'application-default', 'print-access-token']));
  let cached: { token: string; at: number } | undefined;
  return async () => {
    if (cached && now() - cached.at < 50 * 60_000) return cached.token;
    const token = run();
    if (!token) throw new Error('gcloud_token_failed: gcloud auth application-default login でログインする');
    cached = { token, at: now() };
    return token;
  };
}

/** 環境変数からアクセストークン: `GOOGLE_APPLICATION_CREDENTIALS`（鍵のファイル）があればサービスアカウント、なければ gcloud のログイン */
export function googleAccessToken(scopes: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): AccessToken {
  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS;
  return keyFile ? serviceAccountToken(keyFile, scopes) : gcloudAccessToken();
}

// ---- Search Console

/** ドメインのプロパティの URL（`sc-domain:example.com`） */
export const domainProperty = (domain: string): string => `sc-domain:${domain}`;

type ApiOptions = Readonly<{ accessToken: AccessToken; fetch?: typeof fetch }>;

async function googleApi<T>(options: ApiOptions, method: string, url: string, body?: unknown): Promise<T> {
  const res = await (options.fetch ?? fetch)(url, {
    method,
    headers: { authorization: `Bearer ${await options.accessToken()}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google_api_failed: ${method} ${new URL(url).pathname} ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const VERIFY = 'https://www.googleapis.com/siteVerification/v1';
const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3';

/**
 * ドメインの所有権の確認の TXT の値（`google-site-verification=...`）
 * - DNS に入れるのは Terraform のモジュール `search-console-verification`
 * - 値はトークンの持ち主（サービスアカウントか人）ごとに違う
 */
export async function siteVerificationToken(domain: string, options: ApiOptions): Promise<string> {
  const body = await googleApi<{ token: string }>(options, 'POST', `${VERIFY}/token`, { site: { type: 'INET_DOMAIN', identifier: domain }, verificationMethod: 'DNS_TXT' });
  return body.token;
}

/** DNS の TXT でドメインの所有権を確認する（TXT が引けるまで失敗する）。確認できたらトークンの持ち主が所有者になる */
export async function verifyDomain(domain: string, options: ApiOptions & Readonly<{ owners?: readonly string[] }>): Promise<void> {
  await googleApi(options, 'POST', `${VERIFY}/webResource?verificationMethod=DNS_TXT`, { site: { type: 'INET_DOMAIN', identifier: domain }, ...(options.owners?.length && { owners: options.owners }) });
}

/** Search Console にプロパティを足す（所有権の確認の後。足してあれば何もしない） */
export async function addSite(siteUrl: string, options: ApiOptions): Promise<void> {
  await googleApi(options, 'PUT', `${WEBMASTERS}/sites/${encodeURIComponent(siteUrl)}`);
}

/** sitemap を送る（同じ URL の再送は、取り直しの依頼になる） */
export async function submitSitemap(siteUrl: string, sitemapUrl: string, options: ApiOptions): Promise<void> {
  await googleApi(options, 'PUT', `${WEBMASTERS}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`);
}

/** 送った sitemap の状態 */
export type SitemapStatus = Readonly<{ path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; errors?: string; warnings?: string }>;

/** 送った sitemap の一覧 */
export async function listSitemaps(siteUrl: string, options: ApiOptions): Promise<readonly SitemapStatus[]> {
  const body = await googleApi<{ sitemap?: SitemapStatus[] }>(options, 'GET', `${WEBMASTERS}/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
  return body.sitemap ?? [];
}
