# @ryusenkei/mail

The shared shape of an email (`Mail`, `MailAddress`), the `Mailer` interface, and the checks every sender runs before sending. Senders for a provider live elsewhere (for example, `cloudflareMailer` in `@ryusenkei/adapter-cloudflare`); `@ryusenkei/form` uses the interface for its mail destination.

## Install

```sh
pnpm add @ryusenkei/mail
```

## Interface

```ts
type Mail = { from: MailAddress; to: MailAddress[]; replyTo?: MailAddress; subject: string; text: string; html?: string };
interface Mailer { send(mail: Mail): Promise<Result<{ id: string | undefined }, 'invalid_input' | 'rejected'>> }
```

- `invalid_input`: a malformed address, no recipient, or a line break in a header field (blocks header injection).
- `rejected`: the provider would not deliver it (a suppressed recipient, a delivery failure).
- Infrastructure failures are thrown as `TransientError` or `ConfigError` from `@ryusenkei/core`.

## Checks

- `validateMail(mail)` is what every sender runs before sending. It rejects:
  - CR, LF, NUL, U+0085, U+2028, and U+2029 in the subject or a display name
  - addresses that fail `isEmailAddress`
  - an empty `to`
- `isEmailAddress(value)` is deliberately loose (not full RFC 5322). It rejects whitespace and `< > ( ) " , ; :`. `@ryusenkei/form` uses the same check, so an address that passes the form is never rejected at send time.

## Testing

`memoryMailer()` from `@ryusenkei/mail/testing` validates, then keeps sent mail in `outbox`.

## License

MIT
