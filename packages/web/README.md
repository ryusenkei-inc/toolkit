# @ryusenkei/web

Runtime libraries for launching small web products on Cloudflare Workers or Vercel: typed errors and failure responses, contact and feedback forms with delivery by email or webhook, a privacy policy, a 特定商取引法 notice, and an advertising disclosure built from a declaration, and the Cloudflare, Turnstile, and Access integrations they need. Each area is a subpath export. There are no runtime dependencies, the server side is a standard `(Request) => Response`, and nothing renders UI.

## Install

```sh
pnpm add @ryusenkei/web
```

| Import | Contents |
| --- | --- |
| `@ryusenkei/web` | `Result`, infrastructure errors and their classification, failure responses, error reporting, logging |
| `@ryusenkei/web/form` | Field declarations, sanitizing, validation |
| `@ryusenkei/web/form/server` | The submission handler and its destinations (email, webhook) |
| `@ryusenkei/web/form/client` | Submitting from the page |
| `@ryusenkei/web/form/testing` | Fakes for the bot check, rate limiter, and destinations |
| `@ryusenkei/web/legal` | Privacy policy, 特定商取引法 notice, advertising disclosure, operator details |
| `@ryusenkei/web/mail` | The `Mail` shape, the `Mailer` interface, and the checks before sending |
| `@ryusenkei/web/mail/testing` | An in-memory `Mailer` |
| `@ryusenkei/web/cloudflare` | Workers bindings: Rate Limiting and Email Service |
| `@ryusenkei/web/turnstile` | Turnstile's server-side check |
| `@ryusenkei/web/access` | Cloudflare Access JWT verification |

This package replaces `@ryusenkei/web`, `form`, `legal`, `mail`, `adapter-cloudflare`, `adapter-turnstile`, and `adapter-access`.

## Errors, responses, and logging (`@ryusenkei/web`)

The base of the other subpaths: a `Result` type for business failures, typed errors for infrastructure failures and their classification, HTTP failure responses with a request ID, an error-reporter hook, and structured logging. Nothing here is specific to Cloudflare Workers, Node, or Vercel.

### Business failures: `Result` and `Problem`

Return expected failures (not found, duplicate, invalid input) as values with a code, instead of throwing:

```ts
import { err, ok, type Result } from '@ryusenkei/web';

function findUser(id: string): Result<User, 'not_found'> {
  const user = users.get(id);
  return user ? ok(user) : err('not_found');
}
```

Input problems are `{ path, code, params? }`. They carry no text; the UI looks the code up in its own dictionary and fills in `params` (for example, a maximum length).

### Infrastructure failures

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

### HTTP

```ts
import { failureResponse, withRequestId } from '@ryusenkei/web';

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

### Error reporting

`ErrorReporter` is `{ report(error, context) }`. The default `jsonLogReporter` writes an `error_report` log line. `combineReporters` sends to several reporters, and `reportSafely` swallows a reporter's own failure (logged as `error_report_failed`) so reporting never breaks a response.

### Logging

```ts
import { log } from '@ryusenkei/web';

log('warn', 'rate_limit_fallback', { key: 'ip' });
// {"key":"ip","level":"warn","event":"rate_limit_fallback"}
```

- One JSON line per event. The event is a code, not a sentence.
- `level` and `event` always win over fields with the same name.
- `Error` values anywhere in the fields go through `serializeError`: the message is capped at 500 characters, the stack at 8 lines, one level of `cause` is kept, and the error's own fields (such as `key` or `retryAfterSec`) stay.
- Don't put request bodies or email addresses in the fields.

## Forms (`@ryusenkei/web/form`)

Contact, feedback, and sign-up forms without writing the plumbing each time: declare the fields, and get sanitizing, validation, rate limiting, bot checks, and delivery by email or webhook. The server side is a standard `(Request) => Response` function, so it runs on Cloudflare Workers, Vercel, Astro endpoints, and Hono.

### Declare a form

```ts
import { defineForm } from '@ryusenkei/web/form';

export const feedback = defineForm({
  fields: {
    email: { kind: 'email' },
    rating: { kind: 'choice', choices: ['good', 'ok', 'bad'], required: true },
    message: { kind: 'multiline', maxLength: 2000, required: true },
  },
});
```

| Kind | Options | Sanitizing | Codes |
| --- | --- | --- | --- |
| `text` | `maxLength` | Line breaks and control characters become spaces | `too_long` |
| `multiline` | `maxLength` | Line breaks become `\n`, other control characters are removed | `too_long` |
| `email` | `maxLength` (default 254) | As `text` | `too_long`, `invalid_email` |
| `url` | `maxLength`, `hosts?` | As `text` | `too_long`, `invalid_url` (http/https only), `url_host` |
| `choice` | `choices` | None | `invalid_choice` |

- `required: true` adds `required`.
- Field order is the order for display, validation, and the notification body.
- Lengths count UTF-16 code units, the same as HTML `maxlength`.
- U+0085, U+2028, and U+2029 count as line breaks too, so a one-line field can't inject a mail header.
- `refine(values)` adds rules across fields (for example, "a correction needs a URL"). It runs only when every field passed.

`parseForm(form, formDataOrObject)` returns `{ ok: true, values }` or `{ ok: false, problems }`, where each problem is `{ path, code, params? }` (`too_long` has `params.max`). There is no text; look the codes up in your dictionary.

### Handle submissions (`@ryusenkei/web/form/server`)

```ts
import { mailDestination, submissionHandler, webhookDestination } from '@ryusenkei/web/form/server';
import { cloudflareMailer, cloudflareRateLimiter } from '@ryusenkei/web/cloudflare';
import { turnstileBotCheck } from '@ryusenkei/web/turnstile';

export const handleForm = (env: Env) =>
  submissionHandler({
    forms: { inquiry, feedback },
    rateLimiter: cloudflareRateLimiter(env.FORM_LIMITER),
    botCheck: turnstileBotCheck({ secret: env.TURNSTILE_SECRET_KEY, hostnames: ['app.example.com'] }),
    destinations: [
      mailDestination({ mailer: cloudflareMailer(env.EMAIL), from, to, subject: (s) => `[${s.form}] ${s.values.name ?? ''}`, copy }),
      webhookDestination({ url: env.SLACK_WEBHOOK_URL, format: 'slack', copy }),
    ],
  });
```

The order is validate, then rate limit, then bot check, then deliver. Validation comes first, so only well-formed submissions count against the limit.

| Result | Status | `error` |
| --- | --- | --- |
| Accepted (at least one destination succeeded) | 200 | — |
| Not `POST` | 405 | `method_not_allowed` |
| Body over `maxBodyBytes` (default 64 KiB) | 413 | `too_large` |
| Invalid fields, or an unknown form name | 400 | `invalid`, with `problems` |
| Rate limited | 429 | `rate_limited` |
| Bot check rejected | 403 | `bot_check_failed` |
| Every destination failed | 502 | `unavailable` |
| Infrastructure failure (an outage, a missing setting) | 503 / 500 | from `@ryusenkei/web` `failureResponse` |

How submissions are read and logged:

- With several forms, the `form` field picks one; with one form it can be omitted. Form data and JSON bodies are both accepted.
- The rate-limit key is the client IP (`cf-connecting-ip`, then the first `x-forwarded-for`).
- Submitted values are never logged; logs carry the form name, destination names, and the request ID.

Destinations:

- `mailDestination`: sends `notificationText` (each field as `■ label` and its value, in declared order). Replies go to the submitter's `email` and `name`.
- `webhookDestination`: posts JSON (`{ event: 'form.submitted', form, values, order, receivedAt }`) or Slack text, with a 3-second timeout and no redirects.
  - With `secret`, it adds `x-signature: t=<seconds>,v1=<HMAC-SHA256>`. `signWebhook` builds the same value for verification.
- Write your own as `{ name, deliver(submission) }`.

`rateLimiter` and `botCheck` are structural types, so anything with `limit(key)` / `verify(input)` returning a `Result` works.

### Submit from the page (`@ryusenkei/web/form/client`)

```ts
import { submitForm } from '@ryusenkei/web/form/client';

const result = await submitForm('/api/form', new FormData(formElement));
if (!result.ok) showErrors(result.error, result.problems); // codes only; 'network' when there was no usable response
```

### Testing (`@ryusenkei/web/form/testing`)

`fakeBotCheck()` and `fakeRateLimiter()` record calls and switch with `allow(false)`. `memoryDestination()` keeps what it received and fails with `fail('value' | 'throw')`.

## Legal documents (`@ryusenkei/web/legal`)

Builds a privacy policy, a notice under Japan's Act on Specified Commercial Transactions (`特定商取引法に基づく表記`), an advertising disclosure page, and the operator details for a footer from a short declaration. The output is structured data (articles, paragraphs, lists, tables) in Japanese; rendering is yours.

> The standard wording is a starting point, not legal advice. Have it reviewed before you publish.

### Operator

```ts
import type { Operator } from '@ryusenkei/web/legal';

const operator: Operator = {
  name: 'Example',
  url: 'https://www.example.com/',
  status: 'registered', // or 'preparing'
  legalName: { disclosure: 'on_request' },
  address: { disclosure: 'on_request' },
  representative: { disclosure: 'public', value: '...' },
  email: 'hi@example.com',
};
```

- `name` is the display name (the operator row and the copyright line); `legalName` is the registered trade name. While a company is being set up (`status: 'preparing'`), leave `legalName` out and the name row reads `設立準備中`.
- Each detail is either `public` with a value, or `on_request` without one; the latter is shown as `ご請求があれば、電子メールで遅滞なく提供します` (disclosed on request). Because an `on_request` detail carries no value, the declaration can live in a public repository without a personal name.
- `operatorRows(operator)` gives the table rows. `copyrightLine(operator, year)` gives the footer line.

### Privacy policy

Declare what you collect and which services see it:

```ts
import { privacyPolicy, retentionDaysOf } from '@ryusenkei/web/legal';

const declaration = {
  subject: 'Example のウェブサイト',
  operator,
  enactedOn: '2026-11-07', // null while drafting
  collected: [{ name: 'お問い合わせの内容', method: 'お問い合わせのフォーム', purposes: ['お問い合わせへの対応'], retention: { days: 365 } }],
  services: [{ name: 'Turnstile', provider: 'Cloudflare, Inc.', country: '米国', role: 'transmission', purpose: '不正な送信の防止', items: ['端末と操作の情報'] }],
  cookies: { analytics: [] },
} satisfies PrivacyDeclaration;

const doc = privacyPolicy(declaration);
const retentionDays = retentionDaysOf(declaration, 'お問い合わせの内容'); // 365, for the deletion job
```

What the declaration drives:

| Declared | Generated |
| --- | --- |
| `collected` | The items with their method and purposes, and a retention article (`{ days }`, `{ months }`, `{ until: 'request' }` until the user asks for deletion, or `{ until: 'purpose' }` for as long as the purposes need). Multiples of 365 days are written in years |
| `services` with `role: 'processor'` | An outsourcing (`委託`) article |
| `services` with `role: 'transmission'` | What is sent, to whom, and why (external transmission from the user's device) |
| any service outside 日本 | An article on provision to third parties in foreign countries, and a security-measure line about understanding those countries' rules |
| `cookies` | The purposes and services that use cookies, or a statement that no cookies or external analytics are used |
| `revisions` | `revisedOn` (the latest) and the history |

The standard articles (disclosure, correction and suspension, security measures, contact with the operator table, changes) are always included.

Drafting:

- With `enactedOn: null`, undecided items are allowed and listed in `doc.missing`: the operator's legal name, address, and representative; retention periods; service countries.
- Setting `enactedOn` while anything is still missing throws `LegalDeclarationError`.

Keep the retention in the declaration and read it with `retentionDaysOf` in the deletion job, so the policy text and the actual deletion never disagree.

### 特定商取引法に基づく表記

```ts
import { tokushoNotice } from '@ryusenkei/web/legal';

const notice = tokushoNotice({
  operator: { ...operator, phone: { disclosure: 'on_request' } },
  finalConfirmationScreen: false,
  price: { disclosure: 'on_request' },
  extraFees: '...', paymentMethods: ['クレジットカード'], paymentTiming: '...', delivery: '...', returns: '...',
  updatedOn: '2026-11-07',
});
```

- When any detail is `on_request`, the notice ends with a `表示の省略について` (omitted items) row saying that those details are sent by email, without delay, on a request to the operator's email address. Omission relies on the proviso of Article 11.
- With `finalConfirmationScreen: true`, the site has a final order-confirmation screen (Article 12-6), so `price` must be `public` (enforced by the type). The seller's name, address, and phone can still be `on_request`; Article 12-6 covers quantity, price, payment, delivery, the order period, and cancellation, not the seller's details.
- A missing seller name, address, phone, or price also throws.

### Advertising disclosure

A `広告の掲載について` page: the ad programs the site takes part in, how ads are labeled in articles, and the statements a program's terms require. It follows the Consumer Affairs Agency's guidelines on stealth marketing (`ステルスマーケティング`) under the Act against Unjustifiable Premiums and Misleading Representations, and the labeling customs of affiliate networks.

```ts
import { adDisclosure, adStatements, amazonAssociates } from '@ryusenkei/web/legal';

const declaration = {
  subject: 'Example のウェブサイト',
  operator,
  programs: [amazonAssociates('Example'), { name: 'A8.net', provider: '株式会社ファンコミュニケーションズ', kind: 'affiliate' }],
  labeling: { label: 'PR', position: 'top' }, // or 'near_link', 'both'
  privacyPolicyUrl: 'https://www.example.com/privacy',
  enactedOn: '2026-11-13', // null while drafting
} satisfies AdDisclosureDeclaration;

const doc = adDisclosure(declaration);
const footer = adStatements(declaration); // statements required by program terms, for a footer
```

- `kind` is `affiliate`, `advertising` (ad slots filled by a network), or `sponsored` (articles or links requested by an advertiser). It decides which paragraphs appear: the reward and link-destination notes for affiliates, the cookie paragraph for affiliates and ad networks.
- `statement` is printed as is. `amazonAssociates(who)` fills in the wording the Amazon Associates terms require (`Amazonのアソシエイトとして、<who>は適格販売により収入を得ています。`).
- With no programs, the page says the site carries no ads and lists only the contact.
- With `enactedOn: null`, a missing `labeling` is listed in `doc.missing`; setting `enactedOn` with programs but no `labeling` throws `LegalDeclarationError`.

Terms of use are not generated; they differ too much between products.

## Mail (`@ryusenkei/web/mail`)

The shared shape of an email (`Mail`, `MailAddress`), the `Mailer` interface, and the checks every sender runs before sending. Senders for a provider live in their own subpath (for example, `cloudflareMailer` in `@ryusenkei/web/cloudflare`); `@ryusenkei/web/form` uses the interface for its mail destination.

### Interface

```ts
type Mail = { from: MailAddress; to: MailAddress[]; replyTo?: MailAddress; subject: string; text: string; html?: string };
interface Mailer { send(mail: Mail): Promise<Result<{ id: string | undefined }, 'invalid_input' | 'rejected'>> }
```

- `invalid_input`: a malformed address, no recipient, or a line break in a header field (blocks header injection).
- `rejected`: the provider would not deliver it (a suppressed recipient, a delivery failure).
- Infrastructure failures are thrown as `TransientError` or `ConfigError` from `@ryusenkei/web`.

### Checks

- `validateMail(mail)` is what every sender runs before sending. It rejects:
  - CR, LF, NUL, U+0085, U+2028, and U+2029 in the subject or a display name
  - addresses that fail `isEmailAddress`
  - an empty `to`
- `isEmailAddress(value)` is deliberately loose (not full RFC 5322). It rejects whitespace and `< > ( ) " , ; :`. `@ryusenkei/web/form` uses the same check, so an address that passes the form is never rejected at send time.

### Testing

`memoryMailer()` from `@ryusenkei/web/mail/testing` validates, then keeps sent mail in `outbox`.

## Cloudflare Workers bindings (`@ryusenkei/web/cloudflare`)

Cloudflare Workers bindings as the rate limiter and mail sender that `@ryusenkei/web/form` uses. The binding types are structural, so there is no dependency on `@cloudflare/workers-types`.

### Usage

```ts
import { cloudflareMailer, cloudflareRateLimiter } from '@ryusenkei/web/cloudflare';

const rateLimiter = cloudflareRateLimiter(env.FORM_LIMITER);
const mailer = cloudflareMailer(env.EMAIL);
```

| Function | Returns | Binding |
| --- | --- | --- |
| `cloudflareRateLimiter` | `limit(key)` → `rate_limited` over the limit | Rate Limiting (`ratelimits` in wrangler config; limit and period are set there). Counts are per Cloudflare location, not a strict global limit |
| `cloudflareMailer` | a `Mailer` from `@ryusenkei/web/mail` | Email Service (`send_email`). The sender domain must be onboarded to Email Sending |

### Errors

- A missing binding throws `ConfigError`, so a misconfigured deploy answers 503 `not_configured`.
- A Rate Limiting binding failure throws `TransientError`.
- The mailer runs `validateMail` first, then maps Email Service error codes:

| Codes | Result |
| --- | --- |
| `E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`, `E_INTERNAL_SERVER_ERROR` | throws `TransientError` |
| `E_SENDER_NOT_VERIFIED`, `E_SENDER_DOMAIN_NOT_AVAILABLE`, `E_ACCOUNT_SUSPENDED`, `E_RECIPIENT_NOT_ALLOWED` | throws `ConfigError` |
| `E_RECIPIENT_SUPPRESSED`, `E_DELIVERY_FAILED` | `rejected` |
| validation and header errors | `invalid_input` |
| anything else | rethrown as is |

## Turnstile (`@ryusenkei/web/turnstile`)

Cloudflare Turnstile's server-side check, as the bot check that `@ryusenkei/web/form` uses. It works anywhere `fetch` does (Workers, Vercel, Node).

### Usage

```ts
import { turnstileBotCheck } from '@ryusenkei/web/turnstile';

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

### Test keys

`TURNSTILE_TEST_KEYS` has Cloudflare's published test sitekeys, test secrets, and the dummy token. With a test secret, a successful response always carries `example.com` as the hostname and no action, so the adapter accepts `example.com` and skips the action check for test secrets only.

```ts
turnstileBotCheck({ secret: TURNSTILE_TEST_KEYS.secret.pass, hostnames: ['localhost'] });
```

## Cloudflare Access (`@ryusenkei/web/access`)

Authenticates requests behind Cloudflare Access, for example a product's admin pages. It verifies the Access JWT with Web Crypto, so it runs on Workers, Vercel, and Node without dependencies.

### Usage

```ts
import { accessAuthenticator } from '@ryusenkei/web/access';

const auth = accessAuthenticator({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD });
const user = await auth.authenticate(request);
if (!user.ok) return new Response(null, { status: 401 });
```

- `team`: the Cloudflare One team name (`<team>.cloudflareaccess.com`)
- `aud`: the Application Audience (AUD) tag of the Access application. When one Worker sits behind several Access applications, pass all of their tags as an array; a token for any of them is accepted. Empty tags are ignored:

  ```ts
  accessAuthenticator({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD?.split(',') });
  ```

The result is an `Identity`:

| `kind` | When | `subject` | `email` |
| --- | --- | --- | --- |
| `user` | A person signed in | the `sub` claim | lowercased |
| `service` | An Access service token (machine to machine) | `service:<client id>` | `undefined` |

`groups` is filled only when the JWT carries a `groups` claim.

### What is verified

The token comes from the `Cf-Access-Jwt-Assertion` header. Anything else gives `unauthenticated`:

- The signature is RS256 and matches a key from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with the same `kid`
- `aud` contains one of the configured AUD tags, and `iss` is `https://<team>.cloudflareaccess.com`
- `exp` has not passed and `nbf` has (60 seconds of clock skew allowed)
- A user token has `sub` and an email, and `email_verified` is not `false`

### Keys and failures

- The key list is cached for an hour. A token with an unknown `kid` refetches it, at most once every 30 seconds, since Access rotates keys every six weeks and junk tokens must not trigger a fetch each time.
- Imported keys are cached per `kid`.
- A missing `team` or `aud` (including an array with no non-empty tag) throws `ConfigError`.
- A key-list fetch that fails, times out (5 seconds by default, `timeoutMs`), or can't be read throws `TransientError`.

## Versioning

While the version is 0.x, a minor bump may break the API.

## License

MIT
