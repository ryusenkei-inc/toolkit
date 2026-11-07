# @ryusenkei/adapter-cloudflare

Cloudflare Workers bindings as the rate limiter and mail sender that `@ryusenkei/form` uses. The binding types are structural, so this package does not depend on `@cloudflare/workers-types`.

## Install

```sh
pnpm add @ryusenkei/adapter-cloudflare
```

## Usage

```ts
import { cloudflareMailer, cloudflareRateLimiter } from '@ryusenkei/adapter-cloudflare';

const rateLimiter = cloudflareRateLimiter(env.FORM_LIMITER);
const mailer = cloudflareMailer(env.EMAIL);
```

| Function | Returns | Binding |
| --- | --- | --- |
| `cloudflareRateLimiter` | `limit(key)` → `rate_limited` over the limit | Rate Limiting (`ratelimits` in wrangler config; limit and period are set there). Counts are per Cloudflare location, not a strict global limit |
| `cloudflareMailer` | a `Mailer` from `@ryusenkei/mail` | Email Service (`send_email`). The sender domain must be onboarded to Email Sending |

## Errors

- A missing binding throws `ConfigError`, so a misconfigured deploy answers 503 `not_configured`.
- A Rate Limiting binding failure throws `TransientError`.
- The mailer runs `validateMail` first, then maps Email Service error codes:

| Codes | Result |
| --- | --- |
| `E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`, `E_INTERNAL_SERVER_ERROR` | throws `TransientError` |
| `E_SENDER_NOT_VERIFIED`, `E_SENDER_DOMAIN_NOT_AVAILABLE`, `E_ACCOUNT_SUSPENDED`, `E_RECIPIENT_NOT_ALLOWED` | throws `ConfigError` |
| `E_RECIPIENT_SUPPRESSED`, `E_DELIVERY_FAILED` | `rejected` |
| validation and header errors | `invalid_input` |
| anything else | rethrown as is |

## License

MIT
