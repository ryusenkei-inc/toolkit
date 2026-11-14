import { ConfigError, err, ok, TransientError } from '@ryusenkei/core';
import type { RateLimiter } from '../form/server.ts';

/** Workers の Rate Limiting の binding（使う部分だけの型。`@cloudflare/workers-types` に依存しない） */
export type RateLimitBinding = { limit(options: { key: string }): Promise<{ success: boolean }> };

export type CloudflareRateLimiterOptions = {
  /** binding がないときの扱い。`error`（既定）は `ConfigError` を投げ、`allow` は制限せずに通す（手元の開発や、制限を任意にする構成） */
  whenMissing?: 'error' | 'allow';
  /** binding の名前（`ConfigError` の `key` に入れる） */
  name?: string;
};

/**
 * Workers の Rate Limiting の binding による回数の制限（`@ryusenkei/web/form/server` の `RateLimiter`）
 * - 上限と期間は wrangler の設定（`ratelimits`）で決める
 * - 数え方は Cloudflare の拠点ごとで、厳密な全体の上限ではない
 */
export function cloudflareRateLimiter(binding: RateLimitBinding | undefined, options: CloudflareRateLimiterOptions = {}): RateLimiter<'rate_limited'> {
  return {
    async limit(key) {
      if (!binding) {
        if (options.whenMissing === 'allow') return ok();
        throw new ConfigError('Rate Limiting の binding が未設定', { key: options.name ?? 'binding' });
      }
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
