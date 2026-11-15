// 受け取りの処理の試験用の偽物（呼び出しの記録と失敗の注入）と、1回だけ・日ごとの上限のメモリの実装
import { err, ok } from '@ryusenkei/core';
import { assertTimeZone, dayIn } from '../internal/day.ts';
import type { Authenticator, BotCheck, DailyQuota, Destination, RateLimiter, Submission, SubmissionOnce } from './server.ts';

/** 判定の結果を切り替えられる bot の判定 */
export function fakeBotCheck(): BotCheck<'rejected'> & { calls: { token: string | null | undefined; remoteIp?: string }[]; allow(value: boolean): void } {
  let allowed = true;
  const calls: { token: string | null | undefined; remoteIp?: string }[] = [];
  return {
    calls,
    allow: (value) => void (allowed = value),
    async verify(input) {
      calls.push({ token: input.token, ...(input.remoteIp && { remoteIp: input.remoteIp }) });
      return allowed ? ok() : err('rejected');
    },
  };
}

/** 結果を切り替えられる回数の制限 */
export function fakeRateLimiter(): RateLimiter<'rate_limited'> & { keys: string[]; allow(value: boolean): void } {
  let allowed = true;
  const keys: string[] = [];
  return {
    keys,
    allow: (value) => void (allowed = value),
    async limit(key) {
      keys.push(key);
      return allowed ? ok() : err('rate_limited');
    },
  };
}

/** 受け取った送信を溜める届け先。`fail` で失敗させる */
export function memoryDestination(name = 'memory'): Destination & { received: Submission[]; fail(mode: false | 'value' | 'throw'): void } {
  let mode: false | 'value' | 'throw' = false;
  const received: Submission[] = [];
  return {
    name,
    received,
    fail: (value) => void (mode = value),
    async deliver(submission) {
      if (mode === 'throw') throw new Error('destination down');
      if (mode === 'value') return err('rejected');
      received.push(submission);
      return ok();
    },
  };
}

/** 主体を切り替えられる認証。`null` で認証に失敗させる */
export function fakeAuthenticator(subject: string | null = 'user-1'): Authenticator<'unauthenticated'> & { calls: number; as(value: string | null): void } {
  let current = subject;
  const self = {
    calls: 0,
    as: (value: string | null) => void (current = value),
    async authenticate() {
      self.calls += 1;
      return current === null ? err('unauthenticated') : ok({ subject: current });
    },
  };
  return self;
}

/** 主体ごとに1回だけのメモリの実装（試験と手元の開発用。isolate の間で共有しない） */
export function memorySubmissionOnce(): SubmissionOnce {
  const claimed = new Set<string>();
  const id = (scope: string, subject: string) => JSON.stringify([scope, subject]);
  return {
    has: async (scope, subject) => claimed.has(id(scope, subject)),
    async claim(scope, subject) {
      const key = id(scope, subject);
      if (claimed.has(key)) return err('duplicate');
      claimed.add(key);
      return ok();
    },
    release: async (scope, subject) => void claimed.delete(id(scope, subject)),
  };
}

export type MemoryDailyQuotaOptions = Readonly<{
  /** 日の区切りの時間帯（IANA の名前。誤りは `UsageError`（`invalid_time_zone`）） */
  timeZone: string;
  /** 今の時刻（ミリ秒）を返す関数（既定は `Date.now`） */
  now?: () => number;
}>;

/** 日ごとの受付の上限のメモリの実装（試験と手元の開発用。isolate の間で共有しない） */
export function memoryDailyQuota(options: MemoryDailyQuotaOptions): DailyQuota {
  assertTimeZone(options.timeZone);
  const now = options.now ?? Date.now;
  const counts = new Map<string, number>();
  return {
    async take(key, limit) {
      const id = JSON.stringify([key, dayIn(options.timeZone, now())]);
      const count = counts.get(id) ?? 0;
      if (count >= limit) return err('quota_exceeded');
      counts.set(id, count + 1);
      return ok();
    },
  };
}
