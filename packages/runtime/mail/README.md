# @ryusenkei/mail

The port for sending email: the `Mailer` interface, its error codes, an in-memory implementation, and a contract test. No runtime dependencies besides `@ryusenkei/core`. Implementations for a provider live in the `adapter-*` packages.

## Install

```sh
pnpm add @ryusenkei/mail
```

## Interface

`send({ from, to, replyTo?, subject, text, html? })` returns the provider message ID.

- Business failures come back as `Result` with these codes: `invalid_input` (malformed address, or a line break in a header field, which blocks header injection), `rejected`
- Infrastructure failures are thrown as `TransientError` (may succeed on retry) or `ConfigError` (a missing setting), from `@ryusenkei/core`

`validateMail(mail)` is the shared input check. Every implementation runs it before sending.

```ts
const sent = await services.mailer.send({ from, to: [owner], subject, text });
if (!sent.ok) log('warn', 'mail_rejected', { error: sent.error });
```

## Testing

| Entry | Contents |
| --- | --- |
| `@ryusenkei/mail/testing` | `memoryMailer()`: keeps sent mail in `outbox`. For tests and local development; keep it out of production code |
| `@ryusenkei/mail/contract` | `mailerContract(name, make, mail)`: the behavior every implementation must have, as Vitest tests. Run it against each adapter |

The contract imports `vitest`, so it is a separate entry from the in-memory implementation, which local development can use without Vitest.

## License

MIT
