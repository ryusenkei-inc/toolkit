import { ConfigError, err, ok, type Result } from '@ryusenkei/core';
import { jwtFromRequest, jwtVerifier, type JwtAlgorithm, type JwtClaims } from './jwt.ts';

export { jwtFromRequest, jwtVerifier, type JwtAlgorithm, type JwtClaims, type JwtVerifier, type JwtVerifierOptions } from './jwt.ts';

/**
 * 認証した利用者
 * - `user`: ログインした人。`email` は小文字
 * - `service`: Access のサービストークン（機械からの呼び出し）。`subject` は `service:<クライアントの ID>`
 * - `claims`: 検証を通った JWT のクレームのすべて
 */
export type Identity = Readonly<{ kind: 'user' | 'service'; subject: string; email: string | undefined; groups: readonly string[]; claims: JwtClaims }>;

export type AccessOptions = {
  /** Cloudflare One のチーム名（`<team>.cloudflareaccess.com` の `<team>`） */
  team: string | undefined;
  /** Access のアプリの Application Audience（AUD）タグ。複数のアプリの後ろにいるときは配列で渡し、どれか1つに一致すれば受け付ける */
  aud: string | readonly string[] | undefined;
  /** JWT を読むヘッダー（既定は `cf-access-jwt-assertion`）。配列は先頭から順に探す。`authorization` は `Bearer` の形 */
  header?: string | readonly string[];
  /** 受け付ける署名の形式（既定は RS256 と ES256） */
  algorithms?: readonly JwtAlgorithm[];
  /** 鍵の一覧の取得の時間切れ（ミリ秒、既定は5秒） */
  timeoutMs?: number;
  /** テストで差し替える `fetch` と現在時刻（ミリ秒） */
  fetch?: typeof fetch;
  now?: () => number;
};

/** 要求から利用者を認証する */
export type Authenticator = Readonly<{ authenticate(request: Request): Promise<Result<Identity, 'unauthenticated'>> }>;

const DEFAULT_HEADER = 'cf-access-jwt-assertion';

/**
 * Cloudflare Access の JWT による認証
 * - 検証は `jwtVerifier`（発行元は `https://<team>.cloudflareaccess.com`、鍵の一覧はその `/cdn-cgi/access/certs`）
 * - `email_verified` が `false` のログインは拒否する
 * - `groups` は JWT に含まれる場合だけ返す（含めるには Access の設定が要る）
 */
export function accessAuthenticator(options: AccessOptions): Authenticator {
  const issuer = options.team ? `https://${options.team}.cloudflareaccess.com` : undefined;
  const verifier = jwtVerifier({
    issuer,
    audience: options.aud,
    jwksUrl: issuer && `${issuer}/cdn-cgi/access/certs`,
    ...(options.algorithms && { algorithms: options.algorithms }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(options.fetch && { fetch: options.fetch }),
    ...(options.now && { now: options.now }),
  });
  const hasAud = (typeof options.aud === 'string' ? [options.aud] : (options.aud ?? [])).some((a) => a);

  return {
    async authenticate(request) {
      if (!options.team || !hasAud) throw new ConfigError('Access のチーム名・AUD タグが未設定', { key: !options.team ? 'team' : 'aud' });
      const verified = await verifier.verify(jwtFromRequest(request, options.header ?? DEFAULT_HEADER));
      if (!verified.ok) return verified;
      const claims = verified.value;
      const groups = Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [];
      if (typeof claims.email === 'string' && claims.email.includes('@')) {
        if (claims.email_verified === false || typeof claims.sub !== 'string' || !claims.sub) return err('unauthenticated');
        return ok({ kind: 'user', subject: claims.sub, email: claims.email.toLowerCase(), groups, claims });
      }
      if (typeof claims.common_name === 'string' && claims.common_name) return ok({ kind: 'service', subject: `service:${claims.common_name}`, email: undefined, groups, claims });
      return err('unauthenticated');
    },
  };
}
