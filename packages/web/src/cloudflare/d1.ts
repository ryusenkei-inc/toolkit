import { ConfigError, err, ok, TransientError, UsageError } from '@ryusenkei/core';
import type { DailyQuota, SubmissionOnce } from '../form/server.ts';
import { assertTimeZone, dayIn } from '../internal/day.ts';
import type { InviteRecord, InviteStore } from '../invite/index.ts';
import type { SessionStore, StoredSession } from '../session/index.ts';

type D1Value = string | number | null;

/** D1 の文（使う部分だけの型） */
export type D1StatementLike = {
  bind(...values: D1Value[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
};

/** D1 の database の binding（使う部分だけの型。`@cloudflare/workers-types` に依存しない） */
export type D1DatabaseBinding = { prepare(query: string): D1StatementLike };

export type D1SubmissionOnceOptions = Readonly<{
  /** 表の名前（既定は `submission_once`） */
  table?: string;
  /** binding の名前（`ConfigError` の `key` に入れる） */
  name?: string;
  /** 今の時刻（ミリ秒）を返す関数（既定は `Date.now`。`claimed_at` に入れる） */
  now?: () => number;
}>;

export type D1DailyQuotaOptions = Readonly<{
  /** 日の区切りの時間帯（IANA の名前。誤りは `UsageError`（`invalid_time_zone`）） */
  timeZone: string;
  /** 表の名前（既定は `daily_quota`） */
  table?: string;
  /** binding の名前（`ConfigError` の `key` に入れる） */
  name?: string;
  /** 今の時刻（ミリ秒）を返す関数（既定は `Date.now`） */
  now?: () => number;
}>;

export type D1StoreOptions = Readonly<{
  /** 表の名前（既定は `site_sessions`・`invite_codes`） */
  table?: string;
  /** binding の名前（`ConfigError` の `key` に入れる） */
  name?: string;
}>;

const DEFAULT_ONCE_TABLE = 'submission_once';
const DEFAULT_QUOTA_TABLE = 'daily_quota';
const DEFAULT_SESSION_TABLE = 'site_sessions';
const DEFAULT_INVITE_TABLE = 'invite_codes';

const tableName = (table: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new UsageError('invalid_table', `表の名前の誤り: ${table}`);
  return table;
};

/** `d1SubmissionOnce` の表を作る SQL（D1 のマイグレーションに入れる） */
export const submissionOnceTableSql = (table = DEFAULT_ONCE_TABLE): string =>
  `CREATE TABLE IF NOT EXISTS ${tableName(table)} (scope TEXT NOT NULL, subject TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (scope, subject));`;

/** `d1DailyQuota` の表を作る SQL（D1 のマイグレーションに入れる） */
export const dailyQuotaTableSql = (table = DEFAULT_QUOTA_TABLE): string =>
  `CREATE TABLE IF NOT EXISTS ${tableName(table)} (key TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, day));`;

/** `d1SessionStore` の表と索引を作る SQL（D1 のマイグレーションに入れる） */
export const sessionTableSql = (table = DEFAULT_SESSION_TABLE): string => {
  const t = tableName(table);
  return [
    `CREATE TABLE IF NOT EXISTS ${t} (key TEXT PRIMARY KEY, subject TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, refreshed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);`,
    `CREATE INDEX IF NOT EXISTS ${t}_subject ON ${t} (subject);`,
    `CREATE INDEX IF NOT EXISTS ${t}_expires_at ON ${t} (expires_at);`,
  ].join('\n');
};

/** `d1InviteStore` の表と索引を作る SQL（D1 のマイグレーションに入れる） */
export const inviteTableSql = (table = DEFAULT_INVITE_TABLE): string => {
  const t = tableName(table);
  return [
    `CREATE TABLE IF NOT EXISTS ${t} (key TEXT PRIMARY KEY, scope TEXT NOT NULL, subject TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);`,
    `CREATE INDEX IF NOT EXISTS ${t}_subject ON ${t} (scope, subject);`,
    `CREATE INDEX IF NOT EXISTS ${t}_expires_at ON ${t} (expires_at);`,
  ].join('\n');
};

const caller = (db: D1DatabaseBinding | undefined, name: string | undefined) =>
  async <T>(op: string, run: (db: D1DatabaseBinding) => Promise<T>): Promise<T> => {
    if (!db) throw new ConfigError('D1 の binding が未設定', { key: name ?? 'binding' });
    try {
      return await run(db);
    } catch (e) {
      throw new TransientError(`D1 の ${op} の失敗`, { cause: e });
    }
  };

/**
 * D1 による主体ごとに1回だけの受け付け（`@ryusenkei/web/form/server` の `SubmissionOnce`）
 * - 表は `submissionOnceTableSql()` で作る。`(scope, subject)` の主キーへの insert で、同時の送信でも1つだけが成功する
 * - binding がなければ `ConfigError`、D1 の失敗は `TransientError`
 */
export function d1SubmissionOnce(db: D1DatabaseBinding | undefined, options: D1SubmissionOnceOptions = {}): SubmissionOnce {
  const table = tableName(options.table ?? DEFAULT_ONCE_TABLE);
  const now = options.now ?? Date.now;
  const call = caller(db, options.name);
  return {
    async has(scope, subject) {
      return (await call('select', (d) => d.prepare(`SELECT 1 AS found FROM ${table} WHERE scope = ? AND subject = ?`).bind(scope, subject).first())) !== null;
    },
    async claim(scope, subject) {
      const result = await call('insert', (d) => d.prepare(`INSERT INTO ${table} (scope, subject, claimed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).bind(scope, subject, now()).run());
      return result.meta?.changes === 1 ? ok() : err('duplicate');
    },
    async release(scope, subject) {
      await call('delete', (d) => d.prepare(`DELETE FROM ${table} WHERE scope = ? AND subject = ?`).bind(scope, subject).run());
    },
  };
}

/**
 * D1 による日ごとの受付の上限（`@ryusenkei/web/form/server` の `DailyQuota`）
 * - 表は `dailyQuotaTableSql()` で作る。キーと日（`timeZone` での `YYYY-MM-DD`）ごとに1行
 * - 1つの upsert で数えるので、同時の送信でも上限を超えない
 * - 古い日の行は消さない（キーと日ごとに1行。要るなら使う側で消す）
 * - binding がなければ `ConfigError`、D1 の失敗は `TransientError`
 */
export function d1DailyQuota(db: D1DatabaseBinding | undefined, options: D1DailyQuotaOptions): DailyQuota {
  assertTimeZone(options.timeZone);
  const table = tableName(options.table ?? DEFAULT_QUOTA_TABLE);
  const now = options.now ?? Date.now;
  const call = caller(db, options.name);
  // 上限に達した行は更新せず、RETURNING が行を返さない
  const sql = `INSERT INTO ${table} (key, day, count) VALUES (?, ?, 1) ON CONFLICT (key, day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`;
  return {
    async take(key, limit) {
      if (!(limit >= 1)) return err('quota_exceeded');
      const day = dayIn(options.timeZone, now());
      const row = await call('upsert', (d) => d.prepare(sql).bind(key, day, limit).first<{ count: number }>());
      return row ? ok() : err('quota_exceeded');
    },
  };
}

type SessionRow = { subject: string; data: string; created_at: number; refreshed_at: number; expires_at: number };
type InviteRow = { scope: string; subject: string; created_at: number; expires_at: number; used_at: number | null };

const sessionOf = (r: SessionRow): StoredSession => ({ subject: r.subject, data: r.data, createdAt: r.created_at, refreshedAt: r.refreshed_at, expiresAt: r.expires_at });
const inviteOf = (r: InviteRow): InviteRecord => ({ scope: r.scope, subject: r.subject, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at });
const changes = (result: { meta?: { changes?: number } }) => result.meta?.changes ?? 0;

/**
 * D1 によるサイトのセッションの置き場所（`@ryusenkei/web/session` の `SessionStore`）
 * - 表は `sessionTableSql()` で作る。期限の過ぎた行は `siteSessions` の `purge` を定期の処理から呼んで消す
 * - binding がなければ `ConfigError`、D1 の失敗は `TransientError`
 */
export function d1SessionStore(db: D1DatabaseBinding | undefined, options: D1StoreOptions = {}): SessionStore {
  const table = tableName(options.table ?? DEFAULT_SESSION_TABLE);
  const call = caller(db, options.name);
  return {
    async insert(key, s) {
      await call('insert', (d) => d.prepare(`INSERT INTO ${table} (key, subject, data, created_at, refreshed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(key, s.subject, s.data, s.createdAt, s.refreshedAt, s.expiresAt).run());
    },
    async get(key) {
      const row = await call('select', (d) => d.prepare(`SELECT subject, data, created_at, refreshed_at, expires_at FROM ${table} WHERE key = ?`).bind(key).first<SessionRow>());
      return row && sessionOf(row);
    },
    async update(key, patch) {
      return changes(await call('update', (d) => d.prepare(`UPDATE ${table} SET data = ?, refreshed_at = ? WHERE key = ?`).bind(patch.data, patch.refreshedAt, key).run())) === 1;
    },
    async delete(key) {
      await call('delete', (d) => d.prepare(`DELETE FROM ${table} WHERE key = ?`).bind(key).run());
    },
    deleteBySubject: async (subject) => changes(await call('delete', (d) => d.prepare(`DELETE FROM ${table} WHERE subject = ?`).bind(subject).run())),
    deleteExpired: async (before) => changes(await call('delete', (d) => d.prepare(`DELETE FROM ${table} WHERE expires_at <= ?`).bind(before).run())),
  };
}

/**
 * D1 による招待のコードの置き場所（`@ryusenkei/web/invite` の `InviteStore`）
 * - 表は `inviteTableSql()` で作る。`use` は1つの `UPDATE ... RETURNING` で、同時の照合でも1つだけが成功する
 * - binding がなければ `ConfigError`、D1 の失敗は `TransientError`
 */
export function d1InviteStore(db: D1DatabaseBinding | undefined, options: D1StoreOptions = {}): InviteStore {
  const table = tableName(options.table ?? DEFAULT_INVITE_TABLE);
  const call = caller(db, options.name);
  const columns = 'scope, subject, created_at, expires_at, used_at';
  return {
    async insert(key, r) {
      await call('insert', (d) => d.prepare(`INSERT INTO ${table} (key, ${columns}) VALUES (?, ?, ?, ?, ?, ?)`).bind(key, r.scope, r.subject, r.createdAt, r.expiresAt, r.usedAt).run());
    },
    async find(key) {
      const row = await call('select', (d) => d.prepare(`SELECT ${columns} FROM ${table} WHERE key = ?`).bind(key).first<InviteRow>());
      return row && inviteOf(row);
    },
    async use(key, at) {
      const row = await call('update', (d) => d.prepare(`UPDATE ${table} SET used_at = ? WHERE key = ? AND used_at IS NULL AND expires_at > ? RETURNING ${columns}`).bind(at, key, at).first<InviteRow>());
      return row && inviteOf(row);
    },
    revoke: async (scope, subject) => changes(await call('delete', (d) => d.prepare(`DELETE FROM ${table} WHERE scope = ? AND subject = ? AND used_at IS NULL`).bind(scope, subject).run())),
    deleteExpired: async (before) => changes(await call('delete', (d) => d.prepare(`DELETE FROM ${table} WHERE expires_at <= ?`).bind(before).run())),
  };
}
