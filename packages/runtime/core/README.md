# @ryusenkei/core

The base of the RYUSENKEI runtime libraries: a `Result` type for business failures, typed errors for infrastructure failures and their classification, HTTP failure responses with a request ID, an error-reporter hook, and structured logging. No runtime dependencies, and nothing specific to Cloudflare Workers, Node, or Vercel.

## Install

```sh
pnpm add @ryusenkei/core
```

## Business failures: `Result` and `Problem`

Return expected failures (not found, duplicate, invalid input) as values with a code, instead of throwing:

```ts
import { err, ok, type Result } from '@ryusenkei/core';

function findUser(id: string): Result<User, 'not_found'> {
  const user = users.get(id);
  return user ? ok(user) : err('not_found');
}
```

Input problems are `{ path, code, params? }`. They carry no text; the UI looks the code up in its own dictionary and fills in `params` (for example, a maximum length).

## Infrastructure failures

| Error | Meaning |
| --- | --- |
| `TransientError` | May succeed on retry. `retryAfterSec` is optional; negative or non-finite values are ignored |
| `ConfigError` | A missing or wrong setting. `key` names it |

`classifyFailure(e)` returns a kind, so queues and scheduled jobs can use it as well as HTTP handlers:

| Thrown value | Kind | Retry after |
| --- | --- | --- |
| `ConfigError` | `config` | — |
| `TransientError` | `transient` | its `retryAfterSec`, or 5 seconds |
| Durable Object error with `overloaded: true` | `transient` | 10 seconds |
| Durable Object error with `retryable: true` | `transient` | 5 seconds |
| `TimeoutError` / `AbortError` (fetch timeouts and aborts) | `transient` | 5 seconds |
| anything else | `unknown` | — |

`asTransient(e, message)` wraps an unknown error as a `TransientError` with the original as `cause`, and returns typed errors unchanged.

## HTTP

```ts
import { failureResponse, withRequestId } from '@ryusenkei/core';

export default {
  async fetch(req, env, ctx) {
    const { request, requestId } = withRequestId(req);
    try {
      return await handle(request, env);
    } catch (e) {
      return failureResponse(e, { requestId, context: { stage: 'route' }, defer: (p) => ctx.waitUntil(p) });
    }
  },
};
```

| Kind | Response |
| --- | --- |
| `transient` | 503 `{"error":"unavailable"}` with `Retry-After` (seconds, rounded up) |
| `config` | 503 `{"error":"not_configured"}`, logged at `warn` |
| `unknown` | 500 `{"error":"internal"}`, sent to the reporter |

- The body has only the code and the request ID, never the error message or a setting name.
- Every failure response has `cache-control: no-store` and `x-request-id`.
- `withRequestId` keeps a well-formed incoming `x-request-id` and replaces a missing or malformed one with a UUID.
- `failureOf(e)` gives `{ status, code }` without building a response.

## Error reporting

`ErrorReporter` is `{ report(error, context) }`. The default `jsonLogReporter` writes an `error_report` log line. `combineReporters` sends to several reporters, and `reportSafely` swallows a reporter's own failure (logged as `error_report_failed`) so reporting never breaks a response.

## Logging

```ts
import { log } from '@ryusenkei/core';

log('warn', 'rate_limit_fallback', { key: 'ip' });
// {"key":"ip","level":"warn","event":"rate_limit_fallback"}
```

- One JSON line per event. The event is a code, not a sentence.
- `level` and `event` always win over fields with the same name.
- `Error` values anywhere in the fields go through `serializeError`: the message is capped at 500 characters, the stack at 8 lines, one level of `cause` is kept, and the error's own fields (such as `key` or `retryAfterSec`) stay.
- Don't put request bodies or email addresses in the fields.

## Versioning

The runtime libraries are released together with one version (`runtime@<version>` tags in toolkit). While the version is 0.x, a minor bump may break the API.

## License

MIT
