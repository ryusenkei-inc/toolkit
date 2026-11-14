# @ryusenkei/core

The runtime-independent base of the RYUSENKEI packages: a `Result` type for business failures, typed errors for infrastructure failures and their classification, structured logging with per-request context, tracing with `traceparent`, and an error-reporter hook. It runs anywhere JavaScript does (Cloudflare Workers, Node, Vercel, CLIs, queue consumers, scheduled jobs) and has no runtime dependencies. HTTP responses and the web parts live in [`@ryusenkei/web`](../web).

## Install

```sh
pnpm add @ryusenkei/core
```

| Import | Contents |
| --- | --- |
| `@ryusenkei/core` | `Result`, infrastructure errors and their classification, error reporting, logging, `traceparent` and the `Tracer` port |
| `@ryusenkei/core/context` | `withLogContext`, which adds fields to every log line inside a call (AsyncLocalStorage) |
| `@ryusenkei/core/trace` | Spans that follow the call (AsyncLocalStorage), and `tracedFetch` |

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

## Tracing

W3C Trace Context (`traceparent`) and spans, so one request can be followed across your Workers and services in the logs. Spans go to a `Tracer`; the default `logTracer` writes each finished span as one log line.

```ts
import { log, logTracer, sampleRateOf } from '@ryusenkei/core';
import { tracedFetch, traceRequest, withSpan } from '@ryusenkei/core/trace';

const tracer = logTracer({ sampleRate: sampleRateOf(env.TRACE_SAMPLE_RATE) });

export default {
  fetch: (request, env) =>
    traceRequest(tracer, 'site.request', request, async () => {
      const data = await withSpan('load', () => tracedFetch('https://api.example.com/items', {}, { fetcher: env.API.fetch.bind(env.API) }));
      log('info', 'loaded'); // carries traceId and spanId
      return render(await data.json());
    }),
};
```

From the root import (`@ryusenkei/core`, no AsyncLocalStorage):

| Export | Does |
| --- | --- |
| `parseTraceparent(value)` / `formatTraceparent(ctx)` | Reads and writes the header. A malformed value (version `ff`, all-zero IDs, upper case, extra fields on version `00`) is `null`; later versions are read by their first four fields |
| `TraceContext` | `{ traceId, spanId, sampled }` (32 and 16 hex digits) |
| `newTraceId()` / `newSpanId()` | Random IDs |
| `sampleRateOf(value)` | Reads a sample rate from an environment string. Missing, out-of-range, and non-numeric values give 1 |
| `Tracer`, `Span` | The port: `startSpan(name, attributes?, parent?)`, then `setAttributes` and `end(status?)` |
| `logTracer({ sampleRate? })` | Writes `{"event":"span","traceId","spanId","parentSpanId","name","durationMs","status","attributes"}` at `info` when a span ends. New traces are sampled at `sampleRate`; children follow their parent |

From `@ryusenkei/core/trace` (AsyncLocalStorage, like `@ryusenkei/core/context`):

| Export | Does |
| --- | --- |
| `traceEntry(tracer, name, fn, { traceparent?, attributes?, statusOf? })` | Runs `fn` in an entry span (a request, a scheduled job, a queue consumer). The parent is the running span, or else `traceparent` |
| `traceRequest(tracer, name, request, handle)` | `traceEntry` for a `Request`: the parent comes from its `traceparent` header, the attributes are `http.method`, `http.path` (no query), and `http.status`, and a status of 500 or more is an error |
| `withSpan(name, fn, attributes?)` | A child span for a step of the work |
| `tracedFetch(url, init?, { fetcher?, propagate? })` | A `fetch` span with `http.method`, `http.host`, and `http.status`, which sends its `traceparent` so the callee's spans become its children. Pass `propagate: false` for third parties |
| `annotateSpan(attributes)` | Adds attributes to the running span |
| `currentTraceContext()` / `currentTraceparent()` / `withTraceparent(headers?)` | The running span, for passing it on by hand |

- Inside a span, every log line carries `traceId` and `spanId`, through `withLogContext`.
- A thrown error ends the span as `error` and is rethrown.
- Outside any span, `withSpan` and `tracedFetch` just run. Under an unsampled trace, they create no child spans, but `traceparent` is still sent (with the sampled flag off) and logs still carry the IDs.
- Attributes go to logs: keep out bodies, queries, and email addresses.
- On Workers, durations count only time spent waiting on I/O, because the clock doesn't advance during CPU work.

## Versioning

While the version is 0.x, a minor bump may break the API. 0.3.0 moved the HTTP parts (`failureResponse`, `withRequestId`) to `@ryusenkei/web`.

## License

MIT
