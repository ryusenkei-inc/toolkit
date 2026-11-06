# @ryusenkei/auth

The port for authenticating the user of a request (Cloudflare Access and similar): the `Authenticator` interface, its error codes, an in-memory implementation, and a contract test. No runtime dependencies besides `@ryusenkei/core`. Implementations for a provider live in the `adapter-*` packages.

## Install

```sh
pnpm add @ryusenkei/auth
```

## Interface

`authenticate(request)` returns `{ subject, email, groups }`.

- Business failures come back as `Result` with these codes: `unauthenticated`
- Infrastructure failures are thrown as `TransientError` (may succeed on retry) or `ConfigError` (a missing setting), from `@ryusenkei/core`

```ts
const user = await services.auth.authenticate(request);
if (!user.ok) return new Response(null, { status: 401 });
```

## Testing

| Entry | Contents |
| --- | --- |
| `@ryusenkei/auth/testing` | `memoryAuthenticator(identities, { header? })`: picks the user from a header value (default `authorization`). For tests and local development; keep it out of production code |
| `@ryusenkei/auth/contract` | `authenticatorContract(name, make, { valid, identity, invalid })`: the behavior every implementation must have, as Vitest tests. Run it against each adapter |

The contract imports `vitest`, so it is a separate entry from the in-memory implementation, which local development can use without Vitest.

## License

MIT
