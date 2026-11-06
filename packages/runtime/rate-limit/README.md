# @ryusenkei/rate-limit

The port for rate limiting per key (IP address, user ID): the `RateLimiter` interface, its error codes, an in-memory implementation, and a contract test. No runtime dependencies besides `@ryusenkei/core`. Implementations for a provider live in the `adapter-*` packages.

## Install

```sh
pnpm add @ryusenkei/rate-limit
```

## Interface

`limit(key)` counts one hit and returns `rate_limited` once the limit is exceeded.

- Business failures come back as `Result` with these codes: `rate_limited`
- Infrastructure failures are thrown as `TransientError` (may succeed on retry) or `ConfigError` (a missing setting), from `@ryusenkei/core`

```ts
const result = await services.rateLimiter.limit(ip);
if (!result.ok) return Response.json({ error: result.error }, { status: 429 });
```

## Testing

| Entry | Contents |
| --- | --- |
| `@ryusenkei/rate-limit/testing` | `memoryRateLimiter({ limit, periodSec })`: a fixed window in memory, not shared across processes. For tests and local development; keep it out of production code |
| `@ryusenkei/rate-limit/contract` | `rateLimiterContract(name, make, { limit })`: the behavior every implementation must have, as Vitest tests. Run it against each adapter |

The contract imports `vitest`, so it is a separate entry from the in-memory implementation, which local development can use without Vitest.

## License

MIT
