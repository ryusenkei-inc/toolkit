import { describe, expect, it } from 'vitest';
import type { RateLimiter } from './index.ts';

/**
 * 実装が守る契約の試験（Vitest）
 * @param make 期間内に `limit` 回まで通す、空の状態の実装を返す
 */
export function rateLimiterContract(name: string, make: () => RateLimiter, options: { limit: number }): void {
  describe(`${name}: RateLimiter の契約`, () => {
    it('上限までは通し、超えたら rate_limited', async () => {
      const limiter = make();
      for (let i = 0; i < options.limit; i++) expect(await limiter.limit('a')).toEqual({ ok: true, value: undefined });
      expect(await limiter.limit('a')).toEqual({ ok: false, error: 'rate_limited' });
    });

    it('キーごとに数える', async () => {
      const limiter = make();
      for (let i = 0; i < options.limit; i++) await limiter.limit('a');
      expect((await limiter.limit('b')).ok).toBe(true);
    });
  });
}
