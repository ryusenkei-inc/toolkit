import type { Authenticator, Identity } from '@ryusenkei/auth';
import { ConfigError, err, ok, TransientError } from '@ryusenkei/core';

export type AccessOptions = {
  /** Cloudflare One のチーム名（`<team>.cloudflareaccess.com` の `<team>`） */
  team: string | undefined;
  /** Access のアプリの Application Audience（AUD）タグ */
  aud: string | undefined;
  /** テストで差し替える `fetch` と現在時刻（ミリ秒） */
  fetch?: typeof fetch;
  now?: () => number;
};

type Jwk = JsonWebKey & { kid?: string };
type Claims = { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; sub?: string; email?: string; groups?: unknown };

// 時計のずれの許容（秒）
const LEEWAY_SEC = 60;
// 鍵の一覧のキャッシュ（Access は鍵を6週ごとに替え、古い鍵も7日は有効なので、知らない kid のときだけ取り直す）
const CACHE_MS = 60 * 60 * 1000;

const decode = (part: string): Uint8Array => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const json = <T>(part: string): T | undefined => {
  try {
    return JSON.parse(new TextDecoder().decode(decode(part))) as T;
  } catch {
    return undefined;
  }
};

/**
 * Cloudflare Access の JWT（`Cf-Access-Jwt-Assertion` のヘッダー）による認証
 * - 署名（RS256、チームの鍵の一覧）、`aud`、`iss`、`exp`・`nbf` を検証
 * - `groups` は JWT に含まれる場合だけ返す（含めるには Access の設定が要る）
 */
export function accessAuthenticator(options: AccessOptions): Authenticator {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cache: { at: number; keys: Jwk[] } | undefined;

  const keys = async (refresh: boolean): Promise<Jwk[]> => {
    if (cache && !refresh && now() - cache.at < CACHE_MS) return cache.keys;
    let res: Response;
    try {
      res = await fetcher(`https://${options.team}.cloudflareaccess.com/cdn-cgi/access/certs`);
    } catch (e) {
      throw new TransientError('Access の鍵の一覧を取得できない', { cause: e });
    }
    if (!res.ok) throw new TransientError(`Access の鍵の一覧が ${res.status} を返した`);
    cache = { at: now(), keys: ((await res.json()) as { keys?: Jwk[] }).keys ?? [] };
    return cache.keys;
  };

  return {
    async authenticate(request) {
      if (!options.team || !options.aud) throw new ConfigError('Access のチーム名・AUD タグが未設定', { key: !options.team ? 'team' : 'aud' });
      const token = request.headers.get('cf-access-jwt-assertion');
      const parts = token?.split('.');
      if (!parts || parts.length !== 3) return err('unauthenticated');
      const [h, p, s] = parts as [string, string, string];
      const header = json<{ alg?: string; kid?: string }>(h);
      const claims = json<Claims>(p);
      if (!header || !claims || header.alg !== 'RS256' || !header.kid) return err('unauthenticated');

      let jwk = (await keys(false)).find((k) => k.kid === header.kid);
      if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid);
      if (!jwk) return err('unauthenticated');
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      let signature: Uint8Array;
      try {
        signature = decode(s);
      } catch {
        return err('unauthenticated');
      }
      const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature as BufferSource, new TextEncoder().encode(`${h}.${p}`));
      if (!valid) return err('unauthenticated');

      const t = now() / 1000;
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!auds.includes(options.aud)) return err('unauthenticated');
      if (claims.iss !== `https://${options.team}.cloudflareaccess.com`) return err('unauthenticated');
      if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_SEC < t) return err('unauthenticated');
      if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_SEC > t) return err('unauthenticated');
      if (!claims.sub) return err('unauthenticated');

      const identity: Identity = { subject: claims.sub, email: claims.email, groups: Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [] };
      return ok(identity);
    },
  };
}
