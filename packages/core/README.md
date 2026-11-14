# @ryusenkei/core

The runtime-independent base of the RYUSENKEI packages: a `Result` type for business failures, typed errors for infrastructure failures and their classification, structured logging with per-request context, and an error-reporter hook. It runs anywhere JavaScript does (Cloudflare Workers, Node, Vercel, CLIs, queue consumers, scheduled jobs) and has no runtime dependencies. HTTP responses and the web parts live in [`@ryusenkei/web`](../web).

## Install

```sh
pnpm add @ryusenkei/core
```

| Import | Contents |
| --- | --- |
| `@ryusenkei/core` | `Result`, infrastructure errors and their classification, error reporting, logging |
| `@ryusenkei/core/context` | `withLogContext`, which adds fields to every log line inside a call (AsyncLocalStorage) |

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

Errors are recognized by a `Symbol.for` brand, not by class identity, so `classifyFailure`, `isTransientError`, `isConfigError`, and `instanceof` still work when two copies of this package end up in one bundle. Errors from `@ryusenkei/core` 0.2.x and `@ryusenkei/web` 0.5.x and earlier carry no brand and are classified as `unknown`.

`asTransient(e, message)` wraps an unknown error as a `TransientError` with the original as `cause`, and returns typed errors unchanged.

## Error reporting

`ErrorReporter` is `{ report(error, context) }`. The default `jsonLogReporter` writes an `error_report` log line. `combineReporters` sends to several reporters, and `reportSafely` swallows a reporter's own failure (logged as `error_report_failed`) so reporting never breaks a response.

`ErrorContext` has `requestId` (a string, or `null` for work with no request such as a scheduled job), `stage`, `method`, `path`, and `status`, and takes other fields too (for example a tenant ID). Keep personal data out of it.

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

### Context on every line

`setLogContext(provider)` registers a function that returns fields to add to every line, such as the trace and span IDs of the running request. It is called for each line; fields passed to `log` win over it, and a provider that throws is ignored. There is one provider at a time, and `undefined` removes it.

For the common case, `withLogContext` from `@ryusenkei/core/context` keeps the fields in an `AsyncLocalStorage`, so they follow the call through `await`:

```ts
import { withLogContext } from '@ryusenkei/core/context';

export default {
  fetch: (request, env, ctx) => withLogContext({ requestId: request.headers.get('x-request-id') }, () => handle(request, env, ctx)),
};
```

- Nested calls add to the outer fields; the inner value wins for the same name.
- Each call registers its own provider with `setLogContext`, replacing any other.
- It imports `node:async_hooks`. On Cloudflare Workers, enable the `nodejs_als` or `nodejs_compat` compatibility flag. The root import (`@ryusenkei/core`) doesn't need it.

## Versioning

While the version is 0.x, a minor bump may break the API. 0.3.0 moved the HTTP parts (`failureResponse`, `withRequestId`) to `@ryusenkei/web`.

## License

MIT
