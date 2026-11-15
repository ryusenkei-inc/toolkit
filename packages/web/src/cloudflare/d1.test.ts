// D1 のアダプターの SQL を、Node の SQLite（node:sqlite）で実際に動かして検査する（D1 は SQLite）
import { TransientError } from '@ryusenkei/core';
import { describe, expect, it } from 'vitest';
import { dailyQuotaContract, submissionOnceContract } from '../form/contract.ts';
import { d1DailyQuota, d1SubmissionOnce, dailyQuotaTableSql, submissionOnceTableSql, type D1DatabaseBinding, type D1StatementLike } from './d1.ts';

type Value = string | number | null;
type SqliteStatement = { get(...values: Value[]): unknown; run(...values: Value[]): { changes: number | bigint } };
type SqliteDatabase = { exec(sql: string): void; prepare(sql: string): SqliteStatement };

// Edge の環境では node:sqlite を読めないので、その環境では飛ばす。web は Node の型を読まないので、名前を変数にして型の解決を避ける
const SQLITE = 'node:sqlite';
const sqlite = (await import(SQLITE).catch(() => null)) as { DatabaseSync: new (path: string) => SqliteDatabase } | null;

// D1 の binding の形を node:sqlite で作る（D1 と同じく、文ごとに非同期で返す）
const fakeD1 = (db: SqliteDatabase): D1DatabaseBinding => ({
  prepare(query) {
    const statement = (values: Value[]): D1StatementLike => ({
      bind: (...next) => statement(next),
      first: async <T,>() => (db.prepare(query).get(...values) ?? null) as T | null,
      run: async () => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }),
    });
    return statement([]);
  },
});

const open = (sql: string): D1DatabaseBinding => {
  const db = new sqlite!.DatabaseSync(':memory:');
  db.exec(sql);
  return fakeD1(db);
};

describe.skipIf(!sqlite)('D1 のアダプター（SQLite）', () => {
  submissionOnceContract('d1', () => d1SubmissionOnce(open(submissionOnceTableSql())));
  dailyQuotaContract('d1', (now) => d1DailyQuota(open(dailyQuotaTableSql()), { timeZone: 'Asia/Tokyo', now }));

  it('表の名前を変えられ、名前の誤りは UsageError', async () => {
    const once = d1SubmissionOnce(open(submissionOnceTableSql('survey_once')), { table: 'survey_once' });
    expect((await once.claim('s', 'u')).ok).toBe(true);
    expect(() => submissionOnceTableSql('x; DROP TABLE y')).toThrow(expect.objectContaining({ name: 'UsageError', code: 'invalid_table' }));
    expect(() => d1DailyQuota(undefined, { timeZone: 'Asia/Tokyo', table: 'a b' })).toThrow(expect.objectContaining({ code: 'invalid_table' }));
  });
});

describe('D1 のアダプターの失敗', () => {
  const broken: D1DatabaseBinding = {
    prepare: () => {
      throw new Error('D1_ERROR');
    },
  };

  it('binding がなければ ConfigError（key は name）', async () => {
    await expect(d1SubmissionOnce(undefined).claim('s', 'u')).rejects.toMatchObject({ name: 'ConfigError', key: 'binding' });
    await expect(d1DailyQuota(undefined, { timeZone: 'Asia/Tokyo', name: 'DB' }).take('k', 1)).rejects.toMatchObject({ name: 'ConfigError', key: 'DB' });
  });

  it('D1 の失敗は TransientError', async () => {
    await expect(d1SubmissionOnce(broken).has('s', 'u')).rejects.toBeInstanceOf(TransientError);
    await expect(d1DailyQuota(broken, { timeZone: 'Asia/Tokyo' }).take('k', 1)).rejects.toBeInstanceOf(TransientError);
  });

  it('時間帯の名前の誤りは UsageError', () => {
    expect(() => d1DailyQuota(broken, { timeZone: 'Mars/Base' })).toThrow(expect.objectContaining({ name: 'UsageError', code: 'invalid_time_zone' }));
  });
});
