# @ryusenkei/form

Contact, feedback, and sign-up forms without writing the plumbing each time: declare the fields, and get sanitizing, validation, rate limiting, bot checks, and delivery by email or webhook. The server side is a standard `(Request) => Response` function, so it runs on Cloudflare Workers, Vercel, Astro endpoints, and Hono. The package renders nothing; the UI is yours.

## Install

```sh
pnpm add @ryusenkei/form
```

## Declare a form

```ts
import { defineForm } from '@ryusenkei/form';

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

## Handle submissions (`@ryusenkei/form/server`)

```ts
import { mailDestination, submissionHandler, webhookDestination } from '@ryusenkei/form/server';
import { cloudflareMailer, cloudflareRateLimiter } from '@ryusenkei/adapter-cloudflare';
import { turnstileBotCheck } from '@ryusenkei/adapter-turnstile';

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
| Infrastructure failure (an outage, a missing setting) | 503 / 500 | from `@ryusenkei/core` `failureResponse` |

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

## Submit from the page (`@ryusenkei/form/client`)

```ts
import { submitForm } from '@ryusenkei/form/client';

const result = await submitForm('/api/form', new FormData(formElement));
if (!result.ok) showErrors(result.error, result.problems); // codes only; 'network' when there was no usable response
```

## Testing (`@ryusenkei/form/testing`)

`fakeBotCheck()` and `fakeRateLimiter()` record calls and switch with `allow(false)`. `memoryDestination()` keeps what it received and fails with `fail('value' | 'throw')`.

## License

MIT
