// 招待のコード: 1回だけ使える、期限つきのコードの発行と照合。置き場所のポートとメモリの実装
// - 置き場所に保存するのはコードのハッシュだけ。コードは発行のときに1回だけ返す
// - D1 のアダプターは `@ryusenkei/web/cloudflare` の `d1InviteStore`
import { err, ok, UsageError, type Result } from '@ryusenkei/core';
import { isTokenShaped, randomToken, sha256Hex } from '../internal/secret.ts';

/** 置き場所に保存する招待。時刻はミリ秒、`usedAt` は未使用なら `null` */
export type InviteRecord = Readonly<{ scope: string; subject: string; createdAt: number; expiresAt: number; usedAt: number | null }>;

/**
 * 招待の置き場所のポート
 * - 実装: `@ryusenkei/web/cloudflare` の `d1InviteStore`、`memoryInviteStore`
 * - `key` は scope とコードのハッシュ。置き場所はコードを知らない
 * - `use` は、未使用で期限 `expiresAt` が `at` より後のときだけ `usedAt` を入れて記録を返し、ほかは `null`。同時の照合でも1つだけが成功する
 * - 置き場所の障害は `TransientError`、設定の不足は `ConfigError` を投げる
 */
export type InviteStore = Readonly<{
  insert(key: string, record: InviteRecord): Promise<void>;
  find(key: string): Promise<InviteRecord | null>;
  use(key: string, at: number): Promise<InviteRecord | null>;
  /** scope と主体の未使用の招待を消し、消した数を返す */
  revoke(scope: string, subject: string): Promise<number>;
  /** 期限が `before` 以前の招待を（使用済みも）消し、消した数を返す */
  deleteExpired(before: number): Promise<number>;
}>;

/** 照合の失敗。`not_found` はない（形の誤り、別の scope を含む）、`expired` は期限切れ、`used` は使用済み */
export type InviteError = 'not_found' | 'expired' | 'used';

/** 照合を通った招待 */
export type Invite = Readonly<{ scope: string; subject: string; expiresAt: number }>;

export type InvitesOptions = {
  store: InviteStore;
  /** 有効な期間（ミリ秒、既定は7日）。発行ごとに `issue` の `ttlMs` で変えられる */
  ttlMs?: number;
  /** コードの乱数のバイト数（既定は32で43文字。16以上） */
  bytes?: number;
  /** 今の時刻（ミリ秒）を返す関数（既定は `Date.now`） */
  now?: () => number;
};

export type Invites = Readonly<{
  /**
   * 招待を発行し、コードを返す（コードを返すのはこの1回だけ）
   * - `scope`: 使える範囲（媒体やプロジェクトの ID、招待の用途）。照合では同じ `scope` だけが通る
   * - `subject`: 招待の相手（会員の ID など）
   */
  issue(scope: string, subject: string, options?: Readonly<{ ttlMs?: number }>): Promise<Readonly<{ code: string; expiresAt: number }>>;
  /** 使わずに確かめる（画面を開いたときの表示、使う前の検査） */
  check(scope: string, code: string): Promise<Result<Invite, InviteError>>;
  /** 使う。成功は1回だけ */
  redeem(scope: string, code: string): Promise<Result<Invite, InviteError>>;
  /** scope と主体の未使用の招待を取り消す（発行し直す前など）。取り消した数を返す */
  revoke(scope: string, subject: string): Promise<number>;
  /** 期限の過ぎた招待を消す（定期の処理から呼ぶ）。消した数を返す */
  purge(): Promise<number>;
}>;

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BYTES = 32;
const MIN_BYTES = 16;

const assertTtl = (ttlMs: number) => {
  if (!(ttlMs > 0 && Number.isFinite(ttlMs))) throw new UsageError('invalid_ttl', `招待の有効な期間の誤り: ${ttlMs}`);
};

/**
 * 招待のコードを作る
 * - コードは URL に入れられる base64url の乱数。人が打ち込む短いコードは持たない（ハッシュだけの保存では短いコードを総当たりで戻せるため）
 * - 置き場所のキーは scope とコードの SHA-256
 * - 期間とバイト数の誤りは `UsageError`
 */
export function invites(options: InvitesOptions): Invites {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const bytes = options.bytes ?? DEFAULT_BYTES;
  assertTtl(ttl);
  if (!(Number.isInteger(bytes) && bytes >= MIN_BYTES && bytes <= 128)) throw new UsageError('invalid_bytes', `招待のコードのバイト数の誤り: ${bytes}`);
  const minLength = Math.ceil((MIN_BYTES * 4) / 3);
  const { store } = options;
  const keyOf = (scope: string, code: string) => sha256Hex(JSON.stringify([scope, code]));
  const invite = (r: InviteRecord): Invite => ({ scope: r.scope, subject: r.subject, expiresAt: r.expiresAt });
  const reason = (r: InviteRecord | null, at: number): InviteError => (!r ? 'not_found' : r.usedAt !== null ? 'used' : r.expiresAt <= at ? 'expired' : 'not_found');

  return {
    async issue(scope, subject, issueOptions = {}) {
      const ttlMs = issueOptions.ttlMs ?? ttl;
      assertTtl(ttlMs);
      const code = randomToken(bytes);
      const at = now();
      const record: InviteRecord = { scope, subject, createdAt: at, expiresAt: at + ttlMs, usedAt: null };
      await store.insert(await keyOf(scope, code), record);
      return { code, expiresAt: record.expiresAt };
    },
    async check(scope, code) {
      if (!isTokenShaped(code, minLength)) return err('not_found');
      const record = await store.find(await keyOf(scope, code));
      const at = now();
      return record && record.usedAt === null && record.expiresAt > at ? ok(invite(record)) : err(reason(record, at));
    },
    async redeem(scope, code) {
      if (!isTokenShaped(code, minLength)) return err('not_found');
      const key = await keyOf(scope, code);
      const at = now();
      const used = await store.use(key, at);
      return used ? ok(invite(used)) : err(reason(await store.find(key), at));
    },
    revoke: (scope, subject) => store.revoke(scope, subject),
    purge: () => store.deleteExpired(now()),
  };
}

/** メモリの `InviteStore`（試験と手元の開発用。isolate の間で共有しない）。`records` に保存した値を持つ */
export function memoryInviteStore(): InviteStore & { readonly records: ReadonlyMap<string, InviteRecord> } {
  const records = new Map<string, InviteRecord>();
  const removeWhere = (match: (r: InviteRecord) => boolean) => {
    let count = 0;
    for (const [key, r] of records) if (match(r) && records.delete(key)) count += 1;
    return count;
  };
  return {
    records,
    async insert(key, record) {
      if (records.has(key)) throw new Error(`招待のキーの重複: ${key}`);
      records.set(key, { ...record });
    },
    find: async (key) => {
      const r = records.get(key);
      return r ? { ...r } : null;
    },
    async use(key, at) {
      const r = records.get(key);
      if (!r || r.usedAt !== null || r.expiresAt <= at) return null;
      const used = { ...r, usedAt: at };
      records.set(key, used);
      return { ...used };
    },
    revoke: async (scope, subject) => removeWhere((r) => r.scope === scope && r.subject === subject && r.usedAt === null),
    deleteExpired: async (before) => removeWhere((r) => r.expiresAt <= before),
  };
}
