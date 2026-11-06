import type { Result } from '@ryusenkei/core';

/** 回数の制限の業務の失敗。基盤の失敗（binding の障害など）は `TransientError` を投げる */
export type RateLimitError = 'rate_limited';

/** キー（IP アドレス、ユーザーの ID など）ごとの回数の制限 */
export interface RateLimiter {
  /** 1回分を数え、上限を超えていれば `rate_limited` */
  limit(key: string): Promise<Result<void, RateLimitError>>;
}
