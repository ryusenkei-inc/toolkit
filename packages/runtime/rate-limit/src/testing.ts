import { err, ok } from '@ryusenkei/core';
import type { RateLimiter } from './index.ts';

/** 固定の時間窓で数えるメモリの実装（テストと dev 用。プロセスをまたいで共有しない） */
export function memoryRateLimiter(options: { limit: number; periodSec: number; now?: () => number }): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async limit(key) {
      const t = now();
      const w = windows.get(key);
      if (!w || t - w.start >= options.periodSec * 1000) {
        windows.set(key, { start: t, count: 1 });
        return ok();
      }
      w.count++;
      return w.count > options.limit ? err('rate_limited') : ok();
    },
  };
}
