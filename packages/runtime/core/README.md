# @ryusenkei/core

The base of the RYUSENKEI runtime libraries: a `Result` type for business failures, typed errors for infrastructure failures, a converter from those errors to HTTP responses, and structured logging. No runtime dependencies, and nothing specific to Cloudflare Workers, Node, or Vercel.

## Install

```sh
pnpm add @ryusenkei/core
```

## Business failures: `Result`

Return expected failures (not found, duplicate, invalid input, forbidden) as values with a code, instead of throwing:

```ts
import { err, ok, type Result } from '@ryusenkei/core';

function findUser(id: string): Result<User, 'not_found'> {
  const user = users.get(id);
  return user ? ok(user) : err('not_found');
}

const result = findUser(id);
if (!result.ok) return Response.json({ error: result.error }, { status: 404 });
```

## Infrastructure failures: typed errors

Throw these from adapters, and turn any thrown value into a response at the boundary:

| Error | Meaning | Response |
| --- | --- | --- |
| `TransientError` | May succeed on retry (an outage, a rate limit upstream). `retryAfterSec` is optional | 503 `{"error":"unavailable"}` with `Retry-After` when known |
| `ConfigError` | A missing or wrong setting (environment variable, binding). `key` names it | 503 `{"error":"not_configured"}` |
| anything else | A bug | 500 `{"error":"internal"}` |

```ts
import { failureResponse, TransientError } from '@ryusenkei/core';

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return failureResponse(e);
    }
  },
};
```

`failureResponse` logs the failure (`warn` for transient and config errors, `error` for anything else) and never puts the error message in the response body. Use `classifyFailure(e)` to get `{ status, code }` without building a response.

## Logging

```ts
import { log } from '@ryusenkei/core';

log('warn', 'not_configured', { key: 'TURNSTILE_SECRET_KEY' });
// {"level":"warn","event":"not_configured","key":"TURNSTILE_SECRET_KEY"}
```

One JSON line per event. The event is a code, not a sentence, so logs can be searched and text can be translated elsewhere. `Error` values in the fields are expanded to `name`, `message`, and `stack`.

## Versioning

The runtime libraries are released together with one version (`runtime@<version>` tags in toolkit). While the version is 0.x, a minor bump may break the API.

## License

MIT
