# @ryusenkei/adapter-turnstile

Cloudflare Turnstile's server-side check, as the bot check that `@ryusenkei/form` uses. It works anywhere `fetch` does (Workers, Vercel, Node).

## Install

```sh
pnpm add @ryusenkei/adapter-turnstile
```

## Usage

```ts
import { turnstileBotCheck } from '@ryusenkei/adapter-turnstile';

const botCheck = turnstileBotCheck({ secret: env.TURNSTILE_SECRET_KEY, hostnames: ['www.example.com'] });
const result = await botCheck.verify({ token: form.get('cf-turnstile-response'), remoteIp: request.headers.get('cf-connecting-ip') ?? undefined, action: 'inquiry' });
```

It calls siteverify with the secret, the token, and the IP address, then checks:

| Check | Result |
| --- | --- |
| No token | `missing_token` (no API call) |
| Token longer than 2,048 characters | `rejected` (no API call) |
| Turnstile rejects it (invalid, expired, already used) | `rejected` |
| The issuing hostname is not in `hostnames` | `hostname_mismatch` |
| `action` is given and differs from the token's | `action_mismatch` |
| Missing or invalid secret | throws `ConfigError` |
| siteverify is unreachable, times out (5 seconds by default, `timeoutMs`), returns non-2xx or an unreadable body, or reports `internal-error` | throws `TransientError` |

## Test keys

`TURNSTILE_TEST_KEYS` has Cloudflare's published test sitekeys, test secrets, and the dummy token. With a test secret, a successful response always carries `example.com` as the hostname and no action, so the adapter accepts `example.com` and skips the action check for test secrets only.

```ts
turnstileBotCheck({ secret: TURNSTILE_TEST_KEYS.secret.pass, hostnames: ['localhost'] });
```

## License

MIT
