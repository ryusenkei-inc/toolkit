# @ryusenkei/bot-check

The port for checking that a form was sent by a person (Turnstile and similar): the `BotCheck` interface, its error codes, an in-memory implementation, and a contract test. No runtime dependencies besides `@ryusenkei/core`. Implementations for a provider live in the `adapter-*` packages.

## Install

```sh
pnpm add @ryusenkei/bot-check
```

## Interface

`verify({ token, remoteIp?, action? })`.

- Business failures come back as `Result` with these codes: `missing_token`, `rejected`, `hostname_mismatch`, `action_mismatch`
- Infrastructure failures are thrown as `TransientError` (may succeed on retry) or `ConfigError` (a missing setting), from `@ryusenkei/core`

```ts
const check = await services.botCheck.verify({ token: form.get('cf-turnstile-response'), remoteIp });
if (!check.ok) return Response.json({ error: 'turnstile' }, { status: 400 });
```

## Testing

| Entry | Contents |
| --- | --- |
| `@ryusenkei/bot-check/testing` | `memoryBotCheck({ accept, action? })`: accepts only the listed tokens (default `pass`). For tests and local development; keep it out of production code |
| `@ryusenkei/bot-check/contract` | `botCheckContract(name, make, { valid, invalid })`: the behavior every implementation must have, as Vitest tests. Run it against each adapter |

The contract imports `vitest`, so it is a separate entry from the in-memory implementation, which local development can use without Vitest.

## License

MIT
