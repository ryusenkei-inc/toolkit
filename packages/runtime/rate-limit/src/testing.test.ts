import { describe, expect, it } from 'vitest';
import { rateLimiterContract } from './contract.ts';
import { memoryRateLimiter } from './testing.ts';

rateLimiterContract('memoryRateLimiter', () => memoryRateLimiter({ limit: 3, periodSec: 60 }), { limit: 3 });

describe('memoryRateLimiter', () => {
  it('期間が過ぎたら数え直す', async () => {
    let t = 0;
    const limiter = memoryRateLimiter({ limit: 1, periodSec: 10, now: () => t });
    expect((await limiter.limit('a')).ok).toBe(true);
    expect((await limiter.limit('a')).ok).toBe(false);
    t = 10_000;
    expect((await limiter.limit('a')).ok).toBe(true);
  });
});
