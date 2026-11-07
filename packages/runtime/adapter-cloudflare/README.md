# @ryusenkei/adapter-cloudflare

Implementations of the runtime ports with Cloudflare Workers bindings. The binding types are structural, so this package does not depend on `@cloudflare/workers-types`. Pass the bindings from `env` in your `services.ts`.

## Install

```sh
pnpm add @ryusenkei/adapter-cloudflare
```

## Usage

```ts
import { cloudflareMailer, cloudflareRateLimiter, r2BlobStore } from '@ryusenkei/adapter-cloudflare';

export const servicesFromEnv = (env: Env) => ({
  rateLimiter: cloudflareRateLimiter(env.INQUIRY_RATE_LIMITER),
  mailer: cloudflareMailer(env.EMAIL),
  blob: r2BlobStore(env.UPLOADS),
});
```

| Function | Port | Binding |
| --- | --- | --- |
| `cloudflareRateLimiter` | [`RateLimiter`](../rate-limit) | Rate Limiting (`ratelimits` in wrangler config; limit and period are set there). Counts are per Cloudflare location, not a strict global limit |
| `cloudflareMailer` | [`Mailer`](../mail) | Email Service (`send_email`). The sender domain must be onboarded to Email Sending |
| `r2BlobStore` | [`BlobStore`](../blob) | R2 bucket. `list` follows the cursor past 1,000 keys |

Error handling:

- A missing binding throws `ConfigError`, so a misconfigured deploy returns 503 `not_configured` through `failureResponse`
- Rate Limiting and R2 failures throw `TransientError`
- Email Service error codes:
  - `E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`, and `E_INTERNAL_SERVER_ERROR` throw `TransientError`
  - Unverified or unavailable sender domains, a suspended account, and recipients not allowed by the binding throw `ConfigError`
  - Suppressed recipients and delivery failures return `rejected`
  - Validation and header errors return `invalid_input`
  - Unknown codes are rethrown as is

D1 (`db`) is not here yet.

## License

MIT
