# @ryusenkei/web

Runtime libraries for launching small web products on Cloudflare Workers or Vercel: HTTP failure responses, contact and feedback forms with delivery by email or webhook, webhook signing and verification, event analytics, meta tags and JSON-LD and sitemaps for SEO, a privacy policy, a 特定商取引法 notice, and an advertising disclosure built from a declaration, and the Cloudflare, Turnstile, and Access integrations they need. Each area is a subpath export. The only runtime dependency is [`@ryusenkei/core`](../core), for errors, `Result`, and logging. The server side is a standard `(Request) => Response`, and nothing renders UI. The tests run on Node and again in an Edge runtime with only Web-standard globals, as on Cloudflare Workers and Vercel Edge.

## Install

```sh
pnpm add @ryusenkei/core @ryusenkei/web
```

| Import | Contents |
| --- | --- |
| `@ryusenkei/web` | HTTP failure responses, the request ID, and CORS |
| `@ryusenkei/web/form` | Field declarations, sanitizing, validation |
| `@ryusenkei/web/form/server` | The submission handler, its destinations (email, webhook), and sign-in for submissions |
| `@ryusenkei/web/form/client` | Submitting from the page |
| `@ryusenkei/web/form/testing` | Fakes for the bot check, rate limiter, sign-in, and destinations; in-memory once-per-person and daily limits |
| `@ryusenkei/web/legal` | Privacy policy, 特定商取引法 notice, advertising disclosure, operator details |
| `@ryusenkei/web/mail` | The `Mail` shape, the `Mailer` interface, and the checks before sending |
| `@ryusenkei/web/mail/testing` | An in-memory `Mailer` |
| `@ryusenkei/web/blob` | The `BlobStore` port and an in-memory store |
| `@ryusenkei/web/webhook` | Signing and verifying webhooks and app-to-app requests (HMAC-SHA256) |
| `@ryusenkei/web/analytics` | Event recording and count ports, cookieless visitor keys, an in-memory store |
| `@ryusenkei/web/analytics/client` | Sending events from the page with `sendBeacon` |
| `@ryusenkei/web/seo` | Canonical URLs, meta tags, JSON-LD, sitemaps, `robots.txt` |
| `@ryusenkei/web/cloudflare` | Workers bindings: Rate Limiting, Email Service, R2, and Analytics Engine |
| `@ryusenkei/web/turnstile` | Turnstile's server-side check |
| `@ryusenkei/web/access` | Cloudflare Access authentication |
| `@ryusenkei/web/oidc` | JWT verification for any OIDC provider |

This package replaces `form`, `legal`, `mail`, `adapter-cloudflare`, `adapter-turnstile`, and `adapter-access`. Up to 0.5.x, `@ryusenkei/web` also contained what is now `@ryusenkei/core`; from 0.6.0, import errors, `Result`, and logging from `@ryusenkei/core`.

Across the package, required arguments are positional and optional settings go in a trailing options object. Clocks are `now: () => number` (milliseconds), and `fetch` replacements are named `fetch`.


## HTTP failure responses (`@ryusenkei/web`)

Turns a thrown error into a JSON response with a request ID. Errors, `Result`, logging, and reporting come from [`@ryusenkei/core`](../core); install it alongside this package.

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

`failureResponse` options:

- `requestId`: a string, or `null` for work without one. It goes into the body, the `x-request-id` header, and the report.
- `context`: fields for the log line and the report (`stage`, `method`, `path`, and any others such as a tenant ID).
- `body`: builds the body from `{ failure, requestId, error }` when an API has its own error contract, for example `({ failure, requestId }) => ({ code: failure.code, requestId })`. The status and headers stay the same. The default body never carries the error message; with `body`, what goes in is up to you.

### CORS

`withCors(handler, { origins })` lets pages on other origins call a handler, for example a LIFF page posting JSON to a form handler on its own Worker:

```ts
import { withCors } from '@ryusenkei/web';

const handle = withCors(submissionHandler({ forms: { survey }, destinations }), { origins: ['https://liff.example.com'] });
```

- `OPTIONS` from an allowed origin gets 204 with `access-control-allow-methods` (`methods`, default `POST`), `access-control-allow-headers` (`headers`, default `content-type`), and `access-control-max-age` (`maxAgeSec`, default 600). The handler is not called.
- Other requests from an allowed origin go to the handler, and the response gets `access-control-allow-origin` and `access-control-expose-headers` (`exposeHeaders`, default `x-request-id` and `retry-after`).
- A request or preflight whose `Origin` is not allowed gets 403 `{ "ok": false, "error": "forbidden_origin" }` without calling the handler. The request's own origin is always allowed, and requests without `Origin` (server to server) pass through.
- Origins match exactly: `https://app.example.com`, without a trailing slash. Credentials (cookies) are not allowed.

## Forms (`@ryusenkei/web/form`)

Contact, feedback, and sign-up forms without writing the plumbing each time: declare the fields, and get sanitizing, validation, standard error messages, rate limiting, bot checks, and delivery by email, webhook, or another API. The server side is a standard `(Request) => Response` function, so it runs on Cloudflare Workers, Vercel, Astro endpoints, and Hono.

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
| `text` | `maxLength`, `minLength?` | Line breaks and control characters become spaces | `too_long`, `too_short` |
| `multiline` | `maxLength`, `minLength?` | Line breaks become `\n`, other control characters are removed | `too_long`, `too_short` |
| `email` | `maxLength` (default 254) | As `text` | `too_long`, `invalid_email` |
| `url` | `maxLength`, `hosts?` | As `text` | `too_long`, `invalid_url` (http/https only), `url_host` |
| `choice` | `choices` | None | `invalid_choice` |
| `multiChoice` | `choices`, `minItems?`, `maxItems?` | Duplicates removed, sorted in `choices` order | `invalid_choice`, `too_few`, `too_many` |

- `required: true` adds `required`. `requiredWhen: { field: 'type', in: ['correction'] }` makes a field required only when another field has one of the listed values. When the other field is a `multiChoice`, it applies when any picked value is listed, for example a free-text field for 「その他」.
- A `multiChoice` value is a `string[]`: every form-data entry with the field's name, or a JSON array of strings. Picking nothing counts as empty. Other fields are strings, so `values` has the type `Partial<Record<F, string | readonly string[]>>`.
- Field order is the order for display, validation, and the notification body.
- Lengths count UTF-16 code units, the same as HTML `maxlength`.
- U+0085, U+2028, and U+2029 count as line breaks too, so a one-line field can't inject a mail header.
- `refine(values)` adds rules that a declaration can't express. It runs only when every field passed.
- Without `refine`, a declaration is plain JSON. A server can send it to the page, so the page and the handler check with the same declaration.

`parseForm(form, formDataOrObject)` returns `{ ok: true, values }` or `{ ok: false, problems }`, where each problem is `{ path, code, params? }` (`too_long` and `too_many` have `params.max`, `too_short` and `too_few` have `params.min`).

### Messages

Problems and handler results carry codes only. `FORM_MESSAGES_JA` has standard Japanese messages for every code, and `problemMessage` and `formMessage` fill in `params`:

```ts
import { formMessage, problemMessage } from '@ryusenkei/web/form';

problemMessage({ path: 'message', code: 'too_short', params: { min: 10 } }); // '10文字以上で入力してください'
problemMessage(problem, { messages: { url_host: 'サイトの記事の URL を入力してください' } }); // a product's own wording wins
formMessage(result.error); // handler results such as 'rate_limited' and 'network'
formMessage('too_long', { params: { max: 100 } });
```

An unknown code (for example one from `refine`) comes back as is unless you pass a message for it.

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

The order is validate, then sign-in, rate limit, bot check, once per person, daily limit, and deliver. Validation comes first, so only well-formed submissions count against the limits.

| Result | Status | `error` |
| --- | --- | --- |
| Accepted (at least one destination succeeded) | 200 | —, with `id` when `acceptedId` is set |
| Not `POST` | 405 | `method_not_allowed` |
| Body over `maxBodyBytes` (default 64 KiB) | 413 | `too_large` |
| Invalid fields, or an unknown form name | 400 | `invalid`, with `problems` |
| Sign-in failed (`authenticator`) | 401 | `unauthenticated` |
| Rate limited | 429 | `rate_limited` |
| Bot check rejected | 403 | `bot_check_failed` |
| The same person again (`once`) | 409 | `already_submitted` |
| Daily limit reached (`quota`) | 429 | `quota_exceeded` |
| Every destination failed | 502 | `unavailable` |
| Infrastructure failure (an outage, a missing setting, no destinations) | 503 / 500 | from `failureResponse` |

How submissions are read and logged:

- With several forms, the `form` field picks one; with one form it can be omitted. Form data and JSON bodies are both accepted.
- The rate-limit key is `form:<client IP>` (`cf-connecting-ip`, then the first `x-forwarded-for`). `rateLimitKey: ({ ip, form, subject }) => string` changes it, for example to share one limiter between products.
- `now` (`() => number`) replaces the clock for `receivedAt`.
- Submitted values and the signed-in subject are never logged; logs carry the form name, destination names, and the request ID.

Destinations:

- `mailDestination`: sends `notificationText` (each field as `■ label` and its value, in declared order; `multiChoice` values joined with `copy.separator`, default `、`). Replies go to the submitter's `email` and `name`. `name` (default `mail`) tells several mail destinations apart.
- `webhookDestination`: posts JSON (`{ event: 'form.submitted', id, form, values, order, receivedAt }`, where `id` is a UUID per submission for deduplication) or Slack text, with a 3-second timeout and no redirects.
  - With `secret`, it adds `x-signature: t=<seconds>,v1=<HMAC-SHA256>`, signed by `signWebhook` from [`@ryusenkei/web/webhook`](#webhooks-ryusenkeiwebwebhook). The receiver checks it with `verifyWebhookRequest`.
  - A `secret` that is present but empty (such as an unset environment variable) throws `ConfigError` instead of sending unsigned. Leave the option out to send unsigned.
  - `header` renames the header, and `scheme` changes the format. During a key rotation, pass `secret` as an array (new key first); each key adds its own `v1`.
  - `name` (default `webhook`) tells several webhooks apart in logs and results. `copy.heading` puts a line above the Slack text.
- `httpDestination`: forwards the values as JSON to another API, for example from a site's server to a CMS that stores the submission. It sends `headers` (such as an API key) and `x-request-id`; a 2xx answer is success, and its JSON body becomes the destination's value. `body` changes what is sent.
- Write your own as `{ name, deliver(submission) }`. Names must be unique.

`acceptedId(results)` picks the `id` for the accepted response from the results by destination name (`{ ok: true, value }` or `{ ok: false, reason }`), for example the number a store returned:

```ts
submissionHandler({
  forms: { contact },
  destinations: [httpDestination({ name: 'cms', url: env.CMS_FORM_URL, headers: { authorization: `Bearer ${env.CMS_KEY}` } })],
  acceptedId: (r) => (r.cms?.ok ? (r.cms.value as { id: string }).id : null),
});
```

`rateLimiter` and `botCheck` take the `RateLimiter` and `BotCheck` ports exported from `@ryusenkei/web/form/server`: anything with `limit(key)` / `verify({ token, remoteIp?, action? })` returning a `Result` works. `cloudflareRateLimiter` and `turnstileBotCheck` implement them.

### Sign-in, once per person, and a daily limit

A LINE survey on a LIFF page, answered once per LINE user, at most 500 answers a day, stored in D1:

```ts
import { withCors } from '@ryusenkei/web';
import { defineForm } from '@ryusenkei/web/form';
import { jwtAuthenticator, submissionHandler, type Destination } from '@ryusenkei/web/form/server';
import { d1DailyQuota, d1SubmissionOnce } from '@ryusenkei/web/cloudflare';
import { lineIdTokenVerifier } from '@ryusenkei/web/oidc';

const survey = defineForm({
  fields: {
    found: { kind: 'multiChoice', choices: ['sns', 'search', 'friend', 'other'], required: true },
    foundOther: { kind: 'text', maxLength: 200, requiredWhen: { field: 'found', in: ['other'] } },
  },
});

export const handleSurvey = (env: Env) => {
  const answers: Destination = {
    name: 'answers',
    async deliver(s) {
      await env.DB.prepare('INSERT INTO answers (subject, body, received_at) VALUES (?, ?, ?)').bind(s.subject, JSON.stringify(s.values), s.receivedAt).run();
      return { ok: true, value: null };
    },
  };
  return withCors(
    submissionHandler({
      forms: { survey },
      authenticator: jwtAuthenticator(lineIdTokenVerifier({ channelId: env.LINE_CHANNEL_ID })),
      once: { store: d1SubmissionOnce(env.DB, { name: 'DB' }) },
      quota: { store: d1DailyQuota(env.DB, { timeZone: 'Asia/Tokyo', name: 'DB' }), limit: 500 },
      destinations: [answers],
    }),
    { origins: ['https://liff.example.com'] },
  );
};
```

The page sends the ID token with the answers: `submitForm(url, { form: 'survey', idToken: liff.getIDToken(), found: ['sns', 'other'], foundOther: '…' })`.

- `authenticator` takes the `Authenticator` port: `authenticate({ request, field })` returning `{ subject }` or an error code (401 `unauthenticated`). The subject reaches destinations as `submission.subject`.
  - `jwtAuthenticator(verifier, { field, header, subject })` reads a JWT from the `idToken` body field (`field`), or first from a header (`header`, such as `'authorization'` for `Bearer <token>`; `field: null` reads only the header). It verifies the JWT with a `JwtVerifier` from [`@ryusenkei/web/oidc`](#oidc-ryusenkeiweboidc) and takes `sub` as the subject (`subject` changes that).
  - The token field isn't declared in the form, so it never reaches `values`.
- `once: { store, scope? }` accepts one submission per subject and scope (default scope: the form name). It needs `authenticator`; without one, `submissionHandler` throws `UsageError` (`once_without_authenticator`).
  - `store` is the `SubmissionOnce` port: `has(scope, subject)`, `claim(scope, subject)` (`duplicate` when taken, and only one of several concurrent claims wins), and `release(scope, subject)`.
  - The handler claims before delivering. If the daily limit refuses or every destination fails, it releases the claim, so the person can send again.
  - `has` answers "already answered?" when the page opens. Authenticate the same way and call `store.has('survey', subject)`.
- `quota: { store, limit, key? }` accepts at most `limit` submissions per day and key (default key: `form:<form name>`; `key: ({ form, ip, subject }) => string` counts per person or IP address instead). `store` is the `DailyQuota` port: `take(key, limit)` → `quota_exceeded` at the limit. The time zone that ends the day is set on the store. Workers Rate Limiting only has 10- and 60-second periods, so a daily limit needs this.

### Submit from the page (`@ryusenkei/web/form/client`)

```ts
import { submitForm } from '@ryusenkei/web/form/client';

const result = await submitForm('/api/form', new FormData(formElement));
if (!result.ok) showErrors(result.error, result.problems); // codes only; 'network' when there was no usable response
```

An accepted result has `id` when the handler set one. A plain object instead of `FormData` is sent as JSON (pass `multiChoice` values as arrays).

### Testing (`@ryusenkei/web/form/testing`)

`fakeBotCheck()` and `fakeRateLimiter()` record calls and switch with `allow(false)`. `fakeAuthenticator(subject)` signs in as `subject` and switches with `as(subject | null)` (`null` fails). `memoryDestination()` keeps what it received and fails with `fail('value' | 'throw')`.

`memorySubmissionOnce()` and `memoryDailyQuota({ timeZone, now? })` implement `SubmissionOnce` and `DailyQuota` in memory, for tests and local development. They are not shared between isolates.

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
- `operatorRows(operator, { contact })` gives the table rows; `contact` changes the `窓口` row (see [Speaker and contact](#speaker-and-contact)). `copyrightLine(operator, year)` gives the footer line.

### Speaker and contact

The privacy policy and the advertising disclosure take the same two options.

- `speaker` is the word the text speaks as. Without it, the text says `当社` (the company), and the output is unchanged from earlier versions. With `speaker: '当サイト'`, the preamble defines the operator under that word, and the site itself becomes `本サイト`: `<subject>（以下「本サイト」といいます。）の運営者（以下「当サイト」といいます。）は、…`. Pass `subjectShort` to name the site differently; `speaker` and `subjectShort` can't be the same word.
- `contact` is where questions go: `{ email }`, or `{ url, text? }` for a contact form (`text` defaults to `お問い合わせのフォーム`). It is used in the contact article and the `窓口` row. Without it, the operator's `email` is used.

`当社` means a company. When the operator is not a company yet (`status: 'preparing'`), or the site is run under a site name, set `speaker` (`当サイト`, or `運営者`) so the text does not call the operator a company. The operator row still reads `設立準備中` until `legalName` is set.

```ts
privacyPolicy({ subject: 'Example', speaker: '当サイト', contact: { url: '/contact' }, operator, ... });
```

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
| `accessLog` | An article on the site's own access log (`閲覧の記録`): what is recorded (`items`), why (`purposes`), what is not recorded (`excludes`, for example `IP アドレス` and `Cookie`), that it is not used to identify anyone, and with `keepsAggregates: true`, that aggregate statistics are kept without a time limit. List the log in `collected` too, for its retention |
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

#### Articles for media sites

A site that publishes articles can add these articles. Each appears only when declared, and they appear with or without programs:

```ts
adDisclosure({
  subject: 'Example',
  speaker: '当サイト',
  operator,
  contact: { url: '/contact' },
  programs: [], // no program yet
  adTypes: [
    { kind: 'affiliate', label: '広告', position: 'after_title' },
    { kind: 'provided', label: '広告', position: 'after_title', namesSource: true },
    { kind: 'sponsored', label: '広告', position: 'after_title', namesSource: true },
  ],
  independence: { decidedBy: '編集部とライター' },
  copyright: { holder: '記事を執筆したライター（編集部の記事は運営者）' },
  links: { inbound: 'free' },
  disclaimer: { corrections: '記事の末尾の訂正の履歴' },
  enactedOn: '2026-11-16',
});
```

| Declared | Generated |
| --- | --- |
| `adTypes` | `広告の種類と表示`: a table of the kinds of ads the site may carry (`affiliate`, `advertising`, `sponsored`, `provided` for products given free of charge), each with its label and position (`after_title` is right after the title), and with `namesSource: true`, that the advertiser or provider is named. The page no longer says the site carries no ads; with no programs, it says the site takes part in none for now. `labeling` is not needed |
| `independence` | `編集の独立`: articles are planned and written by `decidedBy` (default: the speaker), advertisers have no say, and rewards don't change reviews. It replaces the selection paragraph of `紹介する内容` |
| `copyright` | `著作権と引用`: who holds the copyright (`holder`, default: the speaker), no reproduction beyond what the law allows, and how to cite |
| `links` | `リンク`: linking to the site is free (`inbound: 'free'`) or asks for contact first (`'ask'`), and no responsibility for linked sites |
| `disclaimer` | `免責`: information is as of publication, where corrections are announced (`corrections`), and liability for damage is limited except for intent or gross negligence. The linked-site sentence moves here when `links` is not declared |

`contentName` (default `記事`) is the word for what the site publishes. Change the page title by spreading the result (`{ ...doc, title: '広告の方針・免責' }`).

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
- Infrastructure failures are thrown as `TransientError` or `ConfigError` from `@ryusenkei/core`.

### Checks

- `validateMail(mail)` is what every sender runs before sending. It rejects:
  - CR, LF, NUL, U+0085, U+2028, and U+2029 in the subject or a display name
  - addresses that fail `isEmailAddress`
  - an empty `to`
- `isEmailAddress(value)` is deliberately loose (not full RFC 5322). It rejects whitespace and `< > ( ) " , ; :`. `@ryusenkei/web/form` uses the same check, so an address that passes the form is never rejected at send time.

### Testing

`memoryMailer()` from `@ryusenkei/web/mail/testing` validates, then keeps sent mail in `outbox`. It passes the same contract tests as `cloudflareMailer`.

## Blob storage (`@ryusenkei/web/blob`)

The `BlobStore` port for files kept by key, and an in-memory store. The R2 adapter is `r2BlobStore` in `@ryusenkei/web/cloudflare`.

```ts
import { memoryBlobStore, type BlobStore } from '@ryusenkei/web/blob';

const files: BlobStore = env.FILES ? r2BlobStore(env.FILES, { name: 'FILES' }) : memoryBlobStore();
await files.put('avatars/1.png', bytes, { contentType: 'image/png' });
```

- `put(key, body, { contentType? })` stores a string, bytes, or a stream.
- `get(key)` gives `{ body, contentType, size }`, or `null` when the key is missing. `contentType` is `null` when none was stored. The body is a stream and can be read once.
- `exists(key)` checks without reading the body.
- `delete(key | keys)` takes one key or many. Missing keys count as deleted.
- `memoryBlobStore()` keeps what was stored in `objects`. It passes the same contract tests as `r2BlobStore`.

## Webhooks (`@ryusenkei/web/webhook`)

Signs and verifies webhooks and requests between your own apps (a CMS calling a site's preview, a site posting to a CMS) with HMAC-SHA256 and Web Crypto only. The mechanism (timestamp tolerance, key rotation, reading the body) lives here; the header names and the signature format are yours.

```ts
import { verifyWebhookRequest, webhookHeaders } from '@ryusenkei/web/webhook';

// Sender
const headers = await webhookHeaders(env.PREVIEW_SECRET, { method: 'POST', url, body }, { header: 'x-preview-signature' });
await fetch(url, { method: 'POST', headers, body });

// Receiver
const verified = await verifyWebhookRequest(env.PREVIEW_SECRET, request, { header: 'x-preview-signature' });
if (!verified.ok) return new Response(null, { status: 401 }); // signature_missing | signature_expired | signature_mismatch
const payload = await request.json(); // the body was read from a clone, so it is still readable
```

| Function | Does |
| --- | --- |
| `signWebhook(secret, parts, { now?, scheme? })` | The signature header value. `now` returns the time in milliseconds |
| `verifyWebhook(secret, header, parts, { now?, toleranceSec?, scheme? })` | Checks a header value against the parts, as `Result<void, code>` |
| `webhookHeaders(secret, parts, { header, subjectHeader?, init?, ... })` | `Headers` with the signature (and the subject) added |
| `verifyWebhookRequest(secret, request, { header, subjectHeader?, ... })` | Checks a `Request` |

- `parts` is `{ method, url, body?, subject? }`. `body` is the raw body (a string or bytes), not JSON parsed again. `subject` is an optional signed value such as the caller's email address, sent in `subjectHeader`.
- A timestamp more than 300 seconds (`toleranceSec`) away from now is `signature_expired`. Replays inside the window are not blocked; deduplicate with an ID in the body when that matters.
- Key rotation: pass the secrets as an array, new key first. The signer adds one `v1` per key, and the verifier accepts any key matching any `v1`.
- An empty secret throws `ConfigError` on both sides, so a missing setting answers 503 instead of letting requests through. Check the secret first if a missing one should mean "not signed" (for example, a preview that is off in development).
- Signatures are compared with Web Crypto's `verify`, which doesn't leak where they differ.

### Signature format

The default `requestScheme` signs `v1`, the timestamp, the method, the path and query, the subject, and the body's SHA-256 (base64url), joined by newlines. The host is left out, since a service binding and a local `fetch` reach the same app under different hosts. The header is `t=<seconds>,v1=<base64url>`.

Other formats are a `WebhookScheme`: `message` returns what to sign (a string, bytes, or an array of both, joined), `encoding` is `base64url` (default), `base64`, or `hex`, and `header` is `timestamped` (default) or `plain`.

```ts
import type { WebhookScheme } from '@ryusenkei/web/webhook';

// `t=<seconds>,v1=<hex>` over `<timestamp>.<body>`
const dotted: WebhookScheme = { message: ({ timestamp, body }) => [`${timestamp}.`, body], encoding: 'hex' };
// `sha256=<hex>` over the body, with no timestamp
const bodyOnly: WebhookScheme = { message: ({ body }) => body, encoding: 'hex', header: 'plain', prefix: 'sha256=' };
```

A `plain` header carries one signature (the first key's) and no timestamp, so there is no expiry check.

## Analytics (`@ryusenkei/web/analytics`)

Counting page views, clicks, and other events without cookies or personal data. You declare the event's fields; recording goes through one port (Analytics Engine in `@ryusenkei/web/cloudflare`, or memory), and counts come back through another.

```ts
import { defineEventSchema, isBotUserAgent, visitorKey } from '@ryusenkei/web/analytics';
import { analyticsEngineCounts, analyticsEngineRecorder } from '@ryusenkei/web/cloudflare';

// The column order is stored data: add new fields at the end, never reorder
export const events = defineEventSchema({ blobs: ['event', 'page', 'visitor'], doubles: ['price'], index: (e) => e.page ?? '' });

const visitor = visitorKey({ secret: env.VISITOR_SECRET, timeZone: 'Asia/Tokyo' });
const recorder = analyticsEngineRecorder(env.EVENTS, events);

// In the handler that receives events
if (!isBotUserAgent(request.headers.get('user-agent'))) {
  recorder.record({ event: 'view', page: 'top', visitor: await visitor(request.headers.get('cf-connecting-ip'), 'view:top') });
}

// In a scheduled job or an admin API
const counts = analyticsEngineCounts(events, { accountId: env.CF_ACCOUNT_ID, token: env.CF_ANALYTICS_TOKEN, dataset: 'site_events' });
const rows = await counts.count({ from: '2026-11-01', to: '2026-11-14', timeZone: 'Asia/Tokyo', groupBy: ['page'], where: { event: 'view' }, distinct: 'visitor' });
// [{ day: '2026-11-14', keys: { page: 'top' }, count: 120, distinct: 87 }, ...]
```

- `EventRecorder` is `{ record(event) }`. It doesn't wait and never throws into the request.
- `EventCounts` is `{ count(query) }`. Rows come per day (in `timeZone`) and per `groupBy` field, sorted. `where` takes a value or a list of values per field. `distinct` counts the distinct values of a field; with visitor keys, that is the deduplicated count.
- `index` is the sampling key (`index1` in Analytics Engine). Give a field name (`index: 'subject'`) to record that field of the event there and use it in `groupBy`, `where`, and `distinct`; a function computes the value and can't be queried.
- `memoryAnalytics(schema, { now? })` is both ports in memory, for tests and local development. It keeps what was recorded in `events` (`{ at, event }`, with `at` in milliseconds). A query on a field the schema doesn't declare throws `UsageError` (`unknown_field`), as with Analytics Engine.
- `dayIn(timeZone, at?)` gives the `YYYY-MM-DD` date in a time zone.
- `isBotUserAgent(ua)` matches bots, crawlers, link previews, monitors, and headless browsers.

### Visitor keys

`visitorKey({ secret, timeZone, label?, bytes?, now? })` returns `(ip, scope, at?) => Promise<string>`, a key that counts the same person once per day and scope without a cookie. `at` is the time of the event (a `Date` or milliseconds, default `now()`).

- A key for the day (HMAC of `<label>:<date>` with the secret) hashes `<ip>\n<scope>`, and the first `bytes` bytes (default 3, six hex characters) are kept.
- The key changes every day, and keys of different scopes can't be matched, so they can't follow a person around. With 3 bytes, about 256 IPv4 addresses share each value, so even a leaked secret doesn't identify an address.
- The IP address is used only inside the computation. No IP address means an empty key.
- Without a secret, a random key per isolate is used: just as anonymous, but deduplication only works within one isolate.

### Send from the page (`@ryusenkei/web/analytics/client`)

`sendEvent(url, event)` posts the event as JSON with `navigator.sendBeacon` (it survives navigation), falling back to a `keepalive` fetch. The body is `text/plain`, so there is no CORS preflight; parse it as JSON on the server and check it before recording. It sends nothing from automated browsers (`navigator.webdriver`) or on the server, and ignores failures.

## SEO (`@ryusenkei/web/seo`)

The values search engines read: canonical URLs, meta tags, JSON-LD, sitemaps, and `robots.txt`. It returns data and strings (HTML, XML, text); putting them into the page head is your framework's job, and the site name and organization come from you.

```ts
import { breadcrumbJsonLd, canonicalUrl, jsonLdScript, metaTagsHtml, robotsTxt, sitemapXml } from '@ryusenkei/web/seo';

const origin = 'https://example.com';
const head = [
  metaTagsHtml({ title: 'Post | Example', ogTitle: 'Post', description, canonical: canonicalUrl(origin, url.pathname), siteName: 'Example', locale: 'ja_JP', image }),
  jsonLdScript(breadcrumbJsonLd([{ name: 'Top', url: `${origin}/` }, { name: 'Post' }])),
].join('\n');

// pages/sitemap.xml and pages/robots.txt
new Response(sitemapXml([{ loc: '/' }, { loc: '/post', lastmod: '2026-11-14' }], { origin }), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
new Response(robotsTxt({ sitemaps: [`${origin}/sitemap.xml`] }), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
```

| Function | Returns |
| --- | --- |
| `canonicalPath(pathname)` | The path without query, fragment, `.html`, a trailing `/index`, or a trailing slash. The top is `/` |
| `canonicalUrl(origin, pathname, { trailingSlash? })`, `absoluteUrl(origin, path, ...)` | An absolute URL. The top is `https://example.com/`, or `https://example.com` with `trailingSlash: false` |
| `normalizeUrl(url, options)` | The URL without `www.` and without a trailing slash, keeping the query (`/` stays) |
| `canonicalRedirect(request, options)` | A 301 to `normalizeUrl` when the URL differs, otherwise `null`. Only for GET and HEAD |
| `metaTags(input)` | `HeadTag[]` (`{ tag: 'title', text }` or `{ tag: 'meta' \| 'link', attrs }`) for your framework's head component |
| `metaTagsHtml(input)`, `headHtml(tags)` | The same as escaped HTML, one element per line |
| `jsonLdText(data)`, `jsonLdScript(data)` | JSON for a `<script type="application/ld+json">` with `<` escaped, or the whole element |
| `organizationJsonLd`, `websiteJsonLd`, `breadcrumbJsonLd`, `articleJsonLd`, `itemListJsonLd` | schema.org nodes. Undefined fields are left out. Other types are plain objects of type `JsonLd` |
| `jsonLdGraph(nodes)` | One `@graph` from several nodes |
| `sitemapXml(entries, { origin? })`, `sitemapIndexXml(sitemaps)` | A sitemap (duplicates removed; more than 50,000 URLs throws `UsageError` `sitemap_too_large`) or a sitemap index |
| `robotsTxt({ rules?, sitemaps? })` | `robots.txt`. The default rule allows everything |

URL normalization (`www`-less, no trailing slash) as the first step of a handler:

```ts
export default {
  fetch: (request: Request) => canonicalRedirect(request, { exclude: ['/api/'] }) ?? handle(request),
};
```

- `exclude`: path prefixes (or a function) that keep their trailing slash, such as API routes or an app mounted at `/manage/`. The host is still normalized.
- `host`: the canonical host, to send every other host there. Leave it out in development, or `localhost` is sent to production. By default only a leading `www.` is removed.
- `stripTrailingSlash: false` keeps trailing slashes; `status: 308` keeps the method.
- To do this at the edge instead, use `strip_trailing_slash` of the Terraform module `www-redirect`.

`metaTags` input:

- `noindex: true` sets `robots` to `noindex` and drops the canonical link and `og:url`.
- `og:title` defaults to `title`, `og:type` to `website`. `twitter:card` defaults to `summary_large_image` when there is an image.
- `publishedTime` and `modifiedTime` become `article:published_time` and `article:modified_time`.

Keep pages out of search results with the `robots` meta tag, not `Disallow` in `robots.txt`: a crawler that can't fetch the page never sees the tag.

## Cloudflare Workers bindings (`@ryusenkei/web/cloudflare`)

Cloudflare Workers bindings: the rate limiter, mail sender, and D1 stores for once-per-person and daily limits that `@ryusenkei/web/form` uses, file storage on R2 for `@ryusenkei/web/blob`, and the Analytics Engine adapters for `@ryusenkei/web/analytics`. The binding types are structural, so there is no dependency on `@cloudflare/workers-types`.

### Usage

```ts
import { cloudflareMailer, cloudflareRateLimiter, r2BlobStore } from '@ryusenkei/web/cloudflare';

const rateLimiter = cloudflareRateLimiter(env.FORM_LIMITER, { name: 'FORM_LIMITER' });
const mailer = cloudflareMailer(env.EMAIL, { name: 'EMAIL' });
const files = r2BlobStore(env.FILES, { name: 'FILES' });
```

| Function | Returns | Binding |
| --- | --- | --- |
| `cloudflareRateLimiter` | a `RateLimiter` from `@ryusenkei/web/form/server`: `limit(key)` → `rate_limited` over the limit | Rate Limiting (`ratelimits` in wrangler config; limit and period are set there). Counts are per Cloudflare location, not a strict global limit |
| `cloudflareMailer` | a `Mailer` from `@ryusenkei/web/mail` | Email Service (`send_email`). The sender domain must be onboarded to Email Sending |
| `r2BlobStore` | a `BlobStore` from `@ryusenkei/web/blob` | R2 (`r2_buckets`). R2 needs the length of a stream, so read a body of unknown length into an `ArrayBuffer` first |
| `d1SubmissionOnce(binding, { table? })` | a `SubmissionOnce` from `@ryusenkei/web/form/server` | D1 (`d1_databases`). An insert into a `(scope, subject)` primary key, so one of several concurrent claims wins |
| `d1DailyQuota(binding, { timeZone, table? })` | a `DailyQuota` | D1. One upsert per `take`, so concurrent submissions can't pass the limit. One row per key and day; old days are kept |
| `analyticsEngineRecorder(binding, schema)` | an `EventRecorder` | Analytics Engine (`analytics_engine_datasets`). Fields go to `blob1`… and `double1`… in schema order, `index` to `index1` (queried as `index1` when it is a field name) |
| `analyticsEngineCounts(schema, { accountId, token, dataset })` | an `EventCounts` | None: the SQL API over HTTP, with an API token that can read Account Analytics |

Each adapter takes `{ name }`, the binding's name in your wrangler config, which goes into the `key` of the `ConfigError` for a missing binding (default `binding`).

The D1 adapters don't create their tables. Put the SQL from `submissionOnceTableSql()` and `dailyQuotaTableSql()` (table names `submission_once` and `daily_quota`, or the name you pass to both the function and `table`) into a D1 migration:

```sql
CREATE TABLE IF NOT EXISTS submission_once (scope TEXT NOT NULL, subject TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (scope, subject));
CREATE TABLE IF NOT EXISTS daily_quota (key TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, day));
```

### Errors

- A missing binding throws `ConfigError` when the adapter is first used, so a misconfigured deploy answers 503 `not_configured`.
- A Rate Limiting, R2, or D1 binding failure throws `TransientError`. Deleting many R2 keys is split into requests of 1,000 keys (R2's limit).
- A D1 table name other than letters, digits, and `_` throws `UsageError` (`invalid_table`), and a wrong `timeZone` throws `UsageError` (`invalid_time_zone`), both when the adapter is created.
- `analyticsEngineRecorder` never throws into the request: a write failure is logged as `analytics_write_failed` and ignored. A missing number is written as `0` (`missingDouble` changes it).
- `analyticsEngineCounts` corrects for sampling with `SUM(_sample_interval)`. `distinct` is not corrected and reads low once Analytics Engine samples. It reads 10,000 rows per call.
  - A 429 or 5xx throws `TransientError`. A 401 or 403, a missing `accountId` or `token`, or a malformed `dataset` throws `ConfigError`.
  - Mistakes in the query throw `UsageError`: `invalid_date`, `invalid_time_zone`, `invalid_value` (quotes, backslashes, or control characters are rejected rather than escaped), `unknown_field`, `rows_exceeded` (past 200,000 rows), and `query_failed` for any other 4xx.

`whenMissing` decides what a missing binding does where there is a sensible fallback. The two adapters differ on purpose: a missing limit can let requests through, but a missing recorder only loses analytics.

| Adapter | Default | Other value |
| --- | --- | --- |
| `cloudflareRateLimiter` | `error`: throws `ConfigError` | `allow`: lets every request through (local development, or a limit that is optional) |
| `analyticsEngineRecorder` | `ignore`: records nothing | `error`: throws `ConfigError` |
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
| Missing or invalid secret | throws `ConfigError` (`key: 'secret'`) |
| siteverify is unreachable, times out (5 seconds by default, `timeoutMs`), returns non-2xx or an unreadable body, or reports `internal-error` | throws `TransientError` |

### Test keys

`TURNSTILE_TEST_KEYS` has Cloudflare's published test sitekeys, test secrets, and the dummy token. With a test secret, a successful response always carries `example.com` as the hostname and no action, so the adapter accepts `example.com` and skips the action check for test secrets only.

```ts
turnstileBotCheck({ secret: TURNSTILE_TEST_KEYS.secret.pass, hostnames: ['localhost'] });
```

## Cloudflare Access (`@ryusenkei/web/access`)

Authenticates requests behind Cloudflare Access, for example a product's admin pages, and verifies JWTs from any OIDC provider. It uses Web Crypto, so it runs on Workers, Vercel, and Node.

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

- `header`: where the token is read (default `cf-access-jwt-assertion`). An array is tried in order and the first header with a value is used. `authorization` takes the `Bearer <token>` form only.

The result is an `Identity`:

| `kind` | When | `subject` | `email` |
| --- | --- | --- | --- |
| `user` | A person signed in | the `sub` claim | lowercased |
| `service` | An Access service token (machine to machine) | `service:<client id>` | `undefined` |

`groups` is filled only when the JWT carries a `groups` claim. `claims` has every verified claim, for anything the table doesn't cover.

### What is verified

The checks are those of `jwtVerifier` from [`@ryusenkei/web/oidc`](#oidc-ryusenkeiweboidc), with `https://<team>.cloudflareaccess.com` as the issuer and its `/cdn-cgi/access/certs` as the key list. Anything else gives `unauthenticated`:

- The signature is RS256 or ES256 and matches a key with the same `kid`
- `aud` contains one of the configured AUD tags, and `iss` is `https://<team>.cloudflareaccess.com`
- `exp` has not passed and `nbf` has (60 seconds of clock skew allowed)
- A user token has `sub` and an email, and `email_verified` is not `false`

- A missing `team` or `aud` (including an array with no non-empty tag) throws `ConfigError`.
- Key-list fetching, caching, and failures are those of `jwtVerifier` below.

## OIDC (`@ryusenkei/web/oidc`)

`jwtVerifier` checks a JWT from any OIDC provider (ID tokens, access tokens) and returns its claims. `@ryusenkei/web/access` uses it for Cloudflare Access. It uses Web Crypto, so it runs on Workers, Vercel, and Node.

```ts
import { jwtFromRequest, jwtVerifier } from '@ryusenkei/web/oidc';

const verifier = jwtVerifier({ issuer: 'https://login.example.com', audience: env.CLIENT_ID, jwksUrl: 'https://login.example.com/.well-known/jwks.json' });
const claims = await verifier.verify(jwtFromRequest(request, 'authorization'));
if (!claims.ok) return new Response(null, { status: 401 });
```

- `algorithms` limits the accepted signatures (default RS256 and ES256). A key whose type doesn't fit the algorithm, or whose JWK `alg` differs from the token's, is rejected.
- `iss` must equal `issuer`, and `aud` must contain `audience` (or one of an array).
- The JWKS URL is not discovered from the issuer; pass it.

`lineIdTokenVerifier({ channelId })` is `jwtVerifier` set up for LINE ID tokens (from `liff.getIDToken()` or the LINE SDK): issuer `https://access.line.me`, keys from `https://api.line.me/oauth2/v2.1/certs`, ES256 only, and `aud` equal to the LINE Login channel ID. Tokens from LINE Login on the web are signed with the channel secret (HS256) and are not accepted. A missing `channelId` throws `ConfigError` (`key: 'audience'`).

### Keys and failures

- The key list is cached for an hour. A token with an unknown `kid` refetches it, at most once every 30 seconds, since Access rotates keys every six weeks and junk tokens must not trigger a fetch each time.
- Imported keys are cached per `kid` and algorithm.
- A missing `issuer`, `audience`, or `jwksUrl` throws `ConfigError`.
- A key-list fetch that fails, times out (5 seconds by default, `timeoutMs`), or can't be read throws `TransientError`.

## Versioning

While the version is 0.x, a minor bump may break the API. See the [CHANGELOG](CHANGELOG.md) for what changed and how to migrate.

## License

MIT
