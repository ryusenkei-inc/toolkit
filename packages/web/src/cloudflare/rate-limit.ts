import { ConfigError, err, ok, TransientError, type Result } from '../core/index.ts';

/** キー（IP アドレスなど）ごとの回数の制限（`@ryusenkei/web/form/server` の `rateLimiter` に渡せる） */
export type RateLimiter = Readonly<{ limit(key: string): Promise<Result<void, 'rate_limited'>> }>;

/** Workers の Rate Limiting の binding（使う部分だけの型。`@cloudflare/workers-types` に依存しない） */
export type RateLimitBinding = { limit(options: { key: string }): Promise<{ success: boolean }> };

/**
 * Workers の Rate Limiting の binding による回数の制限
 * - 上限と期間は wrangler の設定（`ratelimits`）で決める
 * - 数え方は Cloudflare の拠点ごとで、厳密な全体の上限ではない
 */
export function cloudflareRateLimiter(binding: RateLimitBinding | undefined): RateLimiter {
  return {
    async limit(key) {
      if (!binding) throw new ConfigError('Rate Limiting の binding が未設定');
      let result: { success: boolean };
      try {
        result = await binding.limit({ key });
      } catch (e) {
        throw new TransientError('Rate Limiting の binding の失敗', { cause: e });
      }
      return result.success ? ok() : err('rate_limited');
    },
  };
}
