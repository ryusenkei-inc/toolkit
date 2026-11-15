// OIDC のプロバイダーが発行する JWT の検証（ID トークン、アクセストークン、Cloudflare Access の JWT）
// - Web Crypto だけで動く（Workers、Vercel、Node）。Cloudflare Access の認証は `@ryusenkei/web/access` がこれを使う
import { ConfigError, err, ok, TransientError, type Result } from '@ryusenkei/core';
import { decodeBytes } from '../internal/encoding.ts';

/** 署名の形式 */
export type JwtAlgorithm = 'RS256' | 'ES256';

/** 検証を通った JWT のクレーム */
export type JwtClaims = Readonly<Record<string, unknown>>;

export type JwtVerifierOptions = {
  /** 発行元（`iss` と完全に一致） */
  issuer: string | undefined;
  /** 宛先。配列はどれか1つが `aud` に含まれれば受け付ける */
  audience: string | readonly string[] | undefined;
  /** 公開鍵の一覧（JWKS）の URL */
  jwksUrl: string | undefined;
  /** 受け付ける署名の形式（既定は RS256 と ES256） */
  algorithms?: readonly JwtAlgorithm[];
  /** 鍵の一覧の取得の時間切れ（ミリ秒、既定は5秒） */
  timeoutMs?: number;
  /** テストで差し替える `fetch` と現在時刻（ミリ秒） */
  fetch?: typeof fetch;
  now?: () => number;
};

/** JWT を検証し、通ればクレームを返す。トークンがないときも `unauthenticated` */
export type JwtVerifier = Readonly<{ verify(token: string | null | undefined): Promise<Result<JwtClaims, 'unauthenticated'>> }>;

type Jwk = JsonWebKey & { kid?: string };

// 時計のずれの許容（秒）
const LEEWAY_SEC = 60;
// 鍵の一覧のキャッシュ（鍵の入れ替えには、知らない kid での取り直しで追従する）
const CACHE_MS = 60 * 60 * 1000;
// 知らない kid での取り直しの間隔の下限（不正なトークンの連打で取得を繰り返さないため）
const REFRESH_MIN_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;

const ALGORITHMS: Record<JwtAlgorithm, { kty: string; crv?: string; import: RsaHashedImportParams | EcKeyImportParams; verify: AlgorithmIdentifier | EcdsaParams }> = {
  RS256: { kty: 'RSA', import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: 'RSASSA-PKCS1-v1_5' },
  ES256: { kty: 'EC', crv: 'P-256', import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } },
};

const json = <T>(part: string): T | undefined => {
  const bytes = decodeBytes(part, 'base64url');
  if (!bytes) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 要求のヘッダーから JWT を取り出す
 * - 配列は先頭から順に探し、値のある最初のヘッダーを使う
 * - `authorization` は `Bearer <token>` の形だけを受け付ける
 */
export function jwtFromRequest(request: Request, header: string | readonly string[]): string | undefined {
  for (const name of typeof header === 'string' ? [header] : header) {
    const value = request.headers.get(name);
    if (!value) continue;
    return name.toLowerCase() === 'authorization' ? /^Bearer\s+(\S+)$/i.exec(value)?.[1] : value;
  }
  return undefined;
}

/**
 * OIDC のプロバイダーが発行する JWT（ID トークン、アクセストークン、Cloudflare Access の JWT）の検証
 * - 署名（RS256・ES256、JWKS の鍵を `kid` で選ぶ）、`aud`、`iss`、`exp`・`nbf`（ずれは60秒まで）を検証
 * - 鍵の種類が署名の形式と合わないとき、JWK の `alg` がヘッダーと違うときは拒否する
 * - 鍵の一覧は1時間キャッシュし、知らない `kid` では取り直す（30秒に1回まで）
 * - 設定の不足は `ConfigError`、鍵の一覧の取得の失敗は `TransientError` を投げる
 */
export function jwtVerifier(options: JwtVerifierOptions): JwtVerifier {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const algorithms = options.algorithms ?? ['RS256', 'ES256'];
  const allowed = (typeof options.audience === 'string' ? [options.audience] : (options.audience ?? [])).filter((a) => a);
  let cache: { at: number; keys: Jwk[] } | undefined;
  const imported = new Map<string, Promise<CryptoKey | undefined>>();

  const keys = async (url: string, refresh: boolean): Promise<Jwk[]> => {
    const age = cache ? now() - cache.at : Number.POSITIVE_INFINITY;
    if (cache && age < (refresh ? REFRESH_MIN_MS : CACHE_MS)) return cache.keys;
    let res: Response;
    try {
      res = await fetcher(url, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    } catch (e) {
      throw new TransientError('JWT の鍵の一覧を取得できない', { cause: e });
    }
    if (!res.ok) throw new TransientError(`JWT の鍵の一覧が ${res.status} を返した`);
    const body = (await res.json().catch(() => null)) as { keys?: unknown } | null;
    if (!body) throw new TransientError('JWT の鍵の一覧を読めない');
    cache = { at: now(), keys: Array.isArray(body.keys) ? (body.keys as Jwk[]) : [] };
    imported.clear();
    return cache.keys;
  };

  const keyOf = async (url: string, kid: string, alg: JwtAlgorithm): Promise<CryptoKey | undefined> => {
    let jwk = (await keys(url, false)).find((k) => k.kid === kid);
    if (!jwk) jwk = (await keys(url, true)).find((k) => k.kid === kid);
    const spec = ALGORITHMS[alg];
    if (!jwk || jwk.kty !== spec.kty || (spec.crv && jwk.crv !== spec.crv) || (jwk.alg && jwk.alg !== alg)) return undefined;
    const id = `${alg}:${kid}`;
    let key = imported.get(id);
    if (!key) {
      key = crypto.subtle.importKey('jwk', jwk, spec.import, false, ['verify']).catch(() => undefined);
      imported.set(id, key);
    }
    return key;
  };

  return {
    async verify(token) {
      const { issuer, jwksUrl } = options;
      if (!issuer || !jwksUrl || allowed.length === 0) throw new ConfigError('JWT の発行元・宛先・鍵の一覧の URL が未設定', { key: !issuer ? 'issuer' : !jwksUrl ? 'jwksUrl' : 'audience' });
      const parts = token?.split('.');
      if (!parts || parts.length !== 3) return err('unauthenticated');
      const [h, p, s] = parts as [string, string, string];
      const header = json<{ alg?: unknown; kid?: unknown }>(h);
      const claims = json<Record<string, unknown>>(p);
      const alg = algorithms.find((a) => a === header?.alg);
      if (!header || !claims || !alg || typeof header.kid !== 'string' || !header.kid) return err('unauthenticated');

      const key = await keyOf(jwksUrl, header.kid, alg);
      if (!key) return err('unauthenticated');
      const signature = decodeBytes(s, 'base64url');
      if (!signature) return err('unauthenticated');
      const verified = await crypto.subtle.verify(ALGORITHMS[alg].verify, key, signature, new TextEncoder().encode(`${h}.${p}`)).catch(() => false);
      if (!verified) return err('unauthenticated');

      const t = now() / 1000;
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!auds.some((a) => typeof a === 'string' && allowed.includes(a))) return err('unauthenticated');
      if (claims.iss !== issuer) return err('unauthenticated');
      if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_SEC < t) return err('unauthenticated');
      if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_SEC > t) return err('unauthenticated');
      return ok(claims);
    },
  };
}

export type LineIdTokenVerifierOptions = {
  /** LINE Login のチャネル ID（`aud` と照合） */
  channelId: string | undefined;
  /** 鍵の一覧の取得の時間切れ（ミリ秒、既定は5秒） */
  timeoutMs?: number;
  /** テストで差し替える `fetch` と現在時刻（ミリ秒） */
  fetch?: typeof fetch;
  now?: () => number;
};

const LINE_ISSUER = 'https://access.line.me';
const LINE_JWKS_URL = 'https://api.line.me/oauth2/v2.1/certs';

/**
 * LINE の ID トークン（LIFF の `liff.getIDToken()`、LINE SDK）の検証。`jwtVerifier` に LINE の発行元・鍵の一覧・ES256 を入れたもの
 * - チャネルのシークレットで署名する HS256 のトークン（ウェブアプリの LINE Login）は受け付けない
 * - `channelId` の不足は、検証のときに `ConfigError`（`key: 'audience'`）
 */
export function lineIdTokenVerifier(options: LineIdTokenVerifierOptions): JwtVerifier {
  return jwtVerifier({
    issuer: LINE_ISSUER,
    audience: options.channelId,
    jwksUrl: LINE_JWKS_URL,
    algorithms: ['ES256'],
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(options.fetch && { fetch: options.fetch }),
    ...(options.now && { now: options.now }),
  });
}
