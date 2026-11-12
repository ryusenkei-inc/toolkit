import { ConfigError, err, ok, TransientError, type Result } from '@ryusenkei/core';

/**
 * 認証した利用者
 * - `user`: ログインした人。`email` は小文字
 * - `service`: Access のサービストークン（機械からの呼び出し）。`subject` は `service:<クライアントの ID>`
 */
export type Identity = Readonly<{ kind: 'user' | 'service'; subject: string; email: string | undefined; groups: readonly string[] }>;

export type AccessOptions = {
  /** Cloudflare One のチーム名（`<team>.cloudflareaccess.com` の `<team>`） */
  team: string | undefined;
  /** Access のアプリの Application Audience（AUD）タグ。複数のアプリの後ろにいるときは配列で渡し、どれか1つに一致すれば受け付ける */
  aud: string | readonly string[] | undefined;
  /** 鍵の一覧の取得の時間切れ（ミリ秒、既定は5秒） */
  timeoutMs?: number;
  /** テストで差し替える `fetch` と現在時刻（ミリ秒） */
  fetch?: typeof fetch;
  now?: () => number;
};

type Jwk = JsonWebKey & { kid?: string };
type Claims = { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; sub?: string; email?: unknown; email_verified?: unknown; common_name?: unknown; groups?: unknown };

// 時計のずれの許容（秒）
const LEEWAY_SEC = 60;
// 鍵の一覧のキャッシュ。Access は鍵を6週ごとに替え、古い鍵も7日は有効
const CACHE_MS = 60 * 60 * 1000;
// 知らない kid での取り直しの間隔の下限（不正なトークンの連打で取得を繰り返さないため）
const REFRESH_MIN_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

const decode = (part: string): Uint8Array => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = <T>(part: string): T | undefined => {
  try {
    return JSON.parse(new TextDecoder().decode(decode(part))) as T;
  } catch {
    return undefined;
  }
};

/** 要求から利用者を認証する */
export type Authenticator = Readonly<{ authenticate(request: Request): Promise<Result<Identity, 'unauthenticated'>> }>;

/**
 * Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion` のヘッダー）による認証
 * - 署名（RS256、チームの鍵の一覧）、`aud`（設定したタグのどれか）、`iss`、`exp`・`nbf` を検証
 * - `email_verified` が `false` のログインは拒否する
 * - `groups` は JWT に含まれる場合だけ返す（含めるには Access の設定が要る）
 */
export function accessAuthenticator(options: AccessOptions): Authenticator {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cache: { at: number; keys: Jwk[] } | undefined;
  const imported = new Map<string, Promise<CryptoKey>>();
  const allowed = (typeof options.aud === 'string' ? [options.aud] : (options.aud ?? [])).filter((a) => a);

  const keys = async (refresh: boolean): Promise<Jwk[]> => {
    const age = cache ? now() - cache.at : Number.POSITIVE_INFINITY;
    if (cache && age < (refresh ? REFRESH_MIN_MS : CACHE_MS)) return cache.keys;
    let res: Response;
    try {
      res = await fetcher(`https://${options.team}.cloudflareaccess.com/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    } catch (e) {
      throw new TransientError('Access の鍵の一覧を取得できない', { cause: e });
    }
    if (!res.ok) throw new TransientError(`Access の鍵の一覧が ${res.status} を返した`);
    const body = (await res.json().catch(() => null)) as { keys?: Jwk[] } | null;
    if (!body) throw new TransientError('Access の鍵の一覧を読めない');
    cache = { at: now(), keys: body.keys ?? [] };
    imported.clear();
    return cache.keys;
  };

  const keyOf = async (kid: string): Promise<CryptoKey | undefined> => {
    let jwk = (await keys(false)).find((k) => k.kid === kid);
    if (!jwk) jwk = (await keys(true)).find((k) => k.kid === kid);
    if (!jwk) return undefined;
    let key = imported.get(kid);
    if (!key) {
      key = crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['verify']);
      imported.set(kid, key);
    }
    return key;
  };

  return {
    async authenticate(request) {
      if (!options.team || allowed.length === 0) throw new ConfigError('Access のチーム名・AUD タグが未設定', { key: !options.team ? 'team' : 'aud' });
      const parts = request.headers.get('cf-access-jwt-assertion')?.split('.');
      if (!parts || parts.length !== 3) return err('unauthenticated');
      const [h, p, s] = parts as [string, string, string];
      const header = json<{ alg?: string; kid?: string }>(h);
      const claims = json<Claims>(p);
      if (!header || !claims || header.alg !== 'RS256' || !header.kid) return err('unauthenticated');

      const key = await keyOf(header.kid);
      if (!key) return err('unauthenticated');
      let signature: Uint8Array;
      try {
        signature = decode(s);
      } catch {
        return err('unauthenticated');
      }
      if (!(await crypto.subtle.verify(ALGORITHM, key, signature as BufferSource, new TextEncoder().encode(`${h}.${p}`)))) return err('unauthenticated');

      const t = now() / 1000;
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!auds.some((a) => typeof a === 'string' && allowed.includes(a))) return err('unauthenticated');
      if (claims.iss !== `https://${options.team}.cloudflareaccess.com`) return err('unauthenticated');
      if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_SEC < t) return err('unauthenticated');
      if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_SEC > t) return err('unauthenticated');

      const groups = Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [];
      if (typeof claims.email === 'string' && claims.email.includes('@')) {
        if (claims.email_verified === false || !claims.sub) return err('unauthenticated');
        return ok({ kind: 'user', subject: claims.sub, email: claims.email.toLowerCase(), groups });
      }
      if (typeof claims.common_name === 'string' && claims.common_name) return ok({ kind: 'service', subject: `service:${claims.common_name}`, email: undefined, groups });
      return err('unauthenticated');
    },
  };
}
