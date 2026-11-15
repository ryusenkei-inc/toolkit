// サイトのセッション: 署名つきの Cookie と、置き場所のポート、メモリの実装
// - ログインの照合（ID トークンなど）の結果でサイトのドメインの Cookie を発行し、照合の結果（権利など）を短い時間キャッシュする
// - Cookie はセッションの ID と HMAC の署名だけを持ち、置き場所には ID のハッシュだけを保存する
// - D1 のアダプターは `@ryusenkei/web/cloudflare` の `d1SessionStore`
import { ConfigError, err, ok, UsageError, type Result } from '@ryusenkei/core';
import { decodeBytes, encodeBytes } from '../internal/encoding.ts';
import { isTokenShaped, randomToken, sha256Hex } from '../internal/secret.ts';

/** 置き場所に保存するセッション。`data` は JSON の文字列、時刻はミリ秒 */
export type StoredSession = Readonly<{ subject: string; data: string; createdAt: number; refreshedAt: number; expiresAt: number }>;

/**
 * セッションの置き場所のポート
 * - 実装: `@ryusenkei/web/cloudflare` の `d1SessionStore`、`memorySessionStore`
 * - `key` は Cookie のセッションの ID のハッシュ。置き場所は Cookie の値を知らない
 * - `update` は行があるときだけ書き換え、なければ `false`（失効と同時の書き換えで、失効したセッションを戻さないため）
 * - 置き場所の障害は `TransientError`、設定の不足は `ConfigError` を投げる
 */
export type SessionStore = Readonly<{
  insert(key: string, session: StoredSession): Promise<void>;
  get(key: string): Promise<StoredSession | null>;
  update(key: string, patch: Readonly<{ data: string; refreshedAt: number }>): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** 主体のセッションをすべて消し、消した数を返す */
  deleteBySubject(subject: string): Promise<number>;
  /** 期限 `expiresAt` が `before` 以前のセッションを消し、消した数を返す */
  deleteExpired(before: number): Promise<number>;
}>;

/**
 * 読み出したセッション
 * - `id`: 置き場所のキー（Cookie の値ではない）
 * - `stale`: 最後の照合から `refreshAfterMs` が過ぎた。照合し直して `refresh` に渡す
 */
export type SiteSession<T> = Readonly<{ id: string; subject: string; data: T; createdAt: number; refreshedAt: number; expiresAt: number; stale: boolean }>;

/** セッションを読めない理由。`no_session` は Cookie がない、`invalid_session` は署名の誤り、期限切れ、失効（Cookie を消す） */
export type SessionError = 'no_session' | 'invalid_session';

export type SessionCookieOptions = Readonly<{
  /** Cookie の名前（既定は `__Host-session`。`__Host-` は `Secure`・`Path=/`・`Domain` なしを強制する） */
  name?: string;
  /** サブドメインと共有するときの `Domain`（`__Host-` の名前とは使えない） */
  domain?: string;
  /** 既定は `/` */
  path?: string;
  /** 既定は `Lax`（LINE のトークや外のサイトからのリンクで開いても送る） */
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** 既定は `true`。`false` は手元の http の開発だけで使う（`__Host-` の名前とは使えない） */
  secure?: boolean;
}>;

export type SiteSessionsOptions = {
  store: SessionStore;
  /**
   * Cookie の署名の鍵（HMAC-SHA256）。配列は鍵の入れ替えの間に使い、新しい鍵を先に並べる（署名は先頭、照合はすべて）
   * - 未設定（空）は、使うときに `ConfigError`（`key: 'secret'`）
   */
  secret: string | readonly string[] | undefined;
  cookie?: SessionCookieOptions;
  /** セッションの寿命（ミリ秒、既定は30日。ブラウザの上限の400日まで）。照合し直しても延びない */
  maxAgeMs?: number;
  /** 照合の結果をキャッシュする時間（ミリ秒、既定は10分）。過ぎたら `stale` */
  refreshAfterMs?: number;
  /** 今の時刻（ミリ秒）を返す関数（既定は `Date.now`） */
  now?: () => number;
};

export type SiteSessions<T> = Readonly<{
  /**
   * 照合を通った主体のセッションを作り、`Set-Cookie` の値を返す
   * - `replacing`: ログインの要求。今のセッションの Cookie があれば、そのセッションを消す（ログインのたびに ID を替える）
   */
  issue(subject: string, data: T, options?: Readonly<{ replacing?: Request }>): Promise<Readonly<{ session: SiteSession<T>; setCookie: string }>>;
  /** 要求の Cookie のセッションを読む。`invalid_session` なら応答に `clearCookie()` を付ける */
  read(request: Request): Promise<Result<SiteSession<T>, SessionError>>;
  /** 照合し直した結果でキャッシュを替える。失効していれば `invalid_session` */
  refresh(session: SiteSession<T>, data: T): Promise<Result<SiteSession<T>, 'invalid_session'>>;
  /** ログアウト: 要求の Cookie のセッションを消し、Cookie を消す `Set-Cookie` の値を返す */
  revoke(request: Request): Promise<string>;
  /** 主体のセッションをすべて消す（停止や削除の Webhook を受けたとき）。消した数を返す */
  revokeSubject(subject: string): Promise<number>;
  /** Cookie を消す `Set-Cookie` の値 */
  clearCookie(): string;
  /** 期限の過ぎたセッションを消す（定期の処理から呼ぶ）。消した数を返す */
  purge(): Promise<number>;
}>;

const DEFAULT_COOKIE = '__Host-session';
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const DEFAULT_REFRESH_AFTER_MS = 10 * 60 * 1000;
const ID_BYTES = 32;
// 署名する内容の接頭辞（同じ鍵をほかの署名に使っても、値を取り違えないため）
const SIGN_LABEL = 'session.v1.';

/** 要求の `Cookie` から名前の値を取り出す（同じ名前が複数なら先頭） */
export function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

const keysOf = (secret: string | readonly string[] | undefined): string[] => (typeof secret === 'string' ? [secret] : (secret ?? [])).filter((s) => s);

/**
 * サイトのセッションを作る
 * - Cookie の値は `<ID>.<署名>`。署名の合わない値は置き場所を引かずに `invalid_session`
 * - 置き場所のキーは ID の SHA-256。置き場所が漏れても Cookie は作れない
 * - Cookie は常に `HttpOnly`。`Max-Age` は寿命の残り
 * - 名前と属性の組み合わせの誤り（`__Host-` に `domain` など）、寿命の範囲の外は、作るときに `UsageError`
 */
export function siteSessions<T>(options: SiteSessionsOptions): SiteSessions<T> {
  const now = options.now ?? Date.now;
  const cookie = options.cookie ?? {};
  const name = cookie.name ?? DEFAULT_COOKIE;
  const secure = cookie.secure ?? true;
  const path = cookie.path ?? '/';
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const refreshAfterMs = options.refreshAfterMs ?? DEFAULT_REFRESH_AFTER_MS;
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new UsageError('invalid_cookie_name', `Cookie の名前の誤り: ${name}`);
  if (name.startsWith('__Host-') && (cookie.domain !== undefined || path !== '/' || !secure)) throw new UsageError('invalid_cookie_options', '__Host- の Cookie には domain・path・secure: false を使えない');
  if (name.startsWith('__Secure-') && !secure) throw new UsageError('invalid_cookie_options', '__Secure- の Cookie には secure: false を使えない');
  if (cookie.sameSite === 'None' && !secure) throw new UsageError('invalid_cookie_options', 'SameSite=None の Cookie には secure が要る');
  if (!(maxAgeMs > 0 && maxAgeMs <= MAX_MAX_AGE_MS)) throw new UsageError('invalid_max_age', `セッションの寿命の範囲の外: ${maxAgeMs}`);
  if (!(refreshAfterMs >= 0)) throw new UsageError('invalid_refresh_after', `照合し直す間隔の誤り: ${refreshAfterMs}`);

  const { store } = options;
  const imported = new Map<string, Promise<CryptoKey>>();
  const hmacKey = (secret: string) => {
    let key = imported.get(secret);
    if (!key) {
      key = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
      imported.set(secret, key);
    }
    return key;
  };
  const secrets = () => {
    const keys = keysOf(options.secret);
    if (!keys.length) throw new ConfigError('セッションの署名の鍵が未設定', { key: 'secret' });
    return keys;
  };
  const sign = async (id: string) => encodeBytes(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secrets()[0]!), new TextEncoder().encode(SIGN_LABEL + id))), 'base64url');
  const verified = async (value: string | undefined): Promise<string | undefined> => {
    // 鍵の未設定は、Cookie の形にかかわらず設定の誤りとして知らせる
    const keys = secrets();
    const at = value?.lastIndexOf('.') ?? -1;
    if (!value || at < 0) return undefined;
    const id = value.slice(0, at);
    const signature = decodeBytes(value.slice(at + 1), 'base64url');
    if (!signature || !isTokenShaped(id, 43)) return undefined;
    const data = new TextEncoder().encode(SIGN_LABEL + id);
    for (const secret of keys) if (await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, data)) return id;
    return undefined;
  };

  const attributes = (maxAgeSec: number) =>
    [`Path=${path}`, `Max-Age=${maxAgeSec}`, ...(cookie.domain ? [`Domain=${cookie.domain}`] : []), 'HttpOnly', ...(secure ? ['Secure'] : []), `SameSite=${cookie.sameSite ?? 'Lax'}`].join('; ');
  const clearCookie = () => `${name}=; ${attributes(0)}`;
  const view = (id: string, s: StoredSession, data: T, at: number): SiteSession<T> => ({ id, subject: s.subject, data, createdAt: s.createdAt, refreshedAt: s.refreshedAt, expiresAt: s.expiresAt, stale: at - s.refreshedAt >= refreshAfterMs });
  const keyOf = async (request: Request) => {
    const id = await verified(cookieValue(request, name));
    return id && sha256Hex(id);
  };

  return {
    async issue(subject, data, issueOptions = {}) {
      if (issueOptions.replacing) {
        const old = await keyOf(issueOptions.replacing);
        if (old) await store.delete(old);
      }
      const id = randomToken(ID_BYTES);
      const at = now();
      const stored: StoredSession = { subject, data: JSON.stringify(data), createdAt: at, refreshedAt: at, expiresAt: at + maxAgeMs };
      const key = await sha256Hex(id);
      await store.insert(key, stored);
      return { session: view(key, stored, data, at), setCookie: `${name}=${id}.${await sign(id)}; ${attributes(Math.floor(maxAgeMs / 1000))}` };
    },
    async read(request) {
      const value = cookieValue(request, name);
      if (!value) return err('no_session');
      const id = await verified(value);
      if (!id) return err('invalid_session');
      const key = await sha256Hex(id);
      const stored = await store.get(key);
      const at = now();
      if (!stored) return err('invalid_session');
      if (stored.expiresAt <= at) {
        await store.delete(key);
        return err('invalid_session');
      }
      let data: T;
      try {
        data = JSON.parse(stored.data) as T;
      } catch {
        return err('invalid_session');
      }
      return ok(view(key, stored, data, at));
    },
    async refresh(session, data) {
      const at = now();
      if (session.expiresAt <= at) return err('invalid_session');
      const updated = await store.update(session.id, { data: JSON.stringify(data), refreshedAt: at });
      return updated ? ok({ ...session, data, refreshedAt: at, stale: false }) : err('invalid_session');
    },
    async revoke(request) {
      const key = await keyOf(request);
      if (key) await store.delete(key);
      return clearCookie();
    },
    revokeSubject: (subject) => store.deleteBySubject(subject),
    clearCookie,
    purge: () => store.deleteExpired(now()),
  };
}

/** メモリの `SessionStore`（試験と手元の開発用。isolate の間で共有しない）。`sessions` に保存した値を持つ */
export function memorySessionStore(): SessionStore & { readonly sessions: ReadonlyMap<string, StoredSession> } {
  const sessions = new Map<string, StoredSession>();
  const removeWhere = (match: (s: StoredSession) => boolean) => {
    let count = 0;
    for (const [key, s] of sessions) if (match(s) && sessions.delete(key)) count += 1;
    return count;
  };
  return {
    sessions,
    async insert(key, session) {
      sessions.set(key, { ...session });
    },
    get: async (key) => {
      const s = sessions.get(key);
      return s ? { ...s } : null;
    },
    async update(key, patch) {
      const s = sessions.get(key);
      if (!s) return false;
      sessions.set(key, { ...s, data: patch.data, refreshedAt: patch.refreshedAt });
      return true;
    },
    delete: async (key) => void sessions.delete(key),
    deleteBySubject: async (subject) => removeWhere((s) => s.subject === subject),
    deleteExpired: async (before) => removeWhere((s) => s.expiresAt <= before),
  };
}
