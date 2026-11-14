// 受け取りの処理の試験用の偽物（呼び出しの記録と失敗の注入）
import { err, ok } from '@ryusenkei/core';
import type { BotCheckLike, Destination, RateLimiterLike, Submission } from './server.ts';

/** 判定の結果を切り替えられる bot の判定 */
export function fakeBotCheck(): BotCheckLike & { calls: { token: string | null | undefined; remoteIp?: string }[]; allow(value: boolean): void } {
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
export function fakeRateLimiter(): RateLimiterLike & { keys: string[]; allow(value: boolean): void } {
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
