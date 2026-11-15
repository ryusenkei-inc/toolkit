# Changelog

## 0.10.0

Forms can take multiple-choice answers, sign the submitter in, accept one submission per person, and cap submissions per day. A handler can be called from pages on other origins.

### Added

- `multiChoice` fields (`choices`, `minItems?`, `maxItems?`; codes `too_few` and `too_many`). The value is a `string[]` in `choices` order. `requiredWhen` on a `multiChoice` field applies when any picked value is listed.
- `submissionHandler({ authenticator })` with the `Authenticator` port (401 `unauthenticated`). The subject reaches destinations as `Submission.subject`. `jwtAuthenticator(verifier, { field?, header?, subject? })` reads a JWT from the `idToken` body field or a header.
- `lineIdTokenVerifier({ channelId })` in `@ryusenkei/web/oidc`: `jwtVerifier` set up for LINE ID tokens (ES256).
- `submissionHandler({ once: { store, scope? } })` with the `SubmissionOnce` port (`has`, `claim`, `release`; 409 `already_submitted`). The claim is released when the daily limit refuses or every destination fails.
- `submissionHandler({ quota: { store, limit, key? } })` with the `DailyQuota` port (`take`; 429 `quota_exceeded`).
- `d1SubmissionOnce`, `d1DailyQuota`, `submissionOnceTableSql`, and `dailyQuotaTableSql` in `@ryusenkei/web/cloudflare`.
- `memorySubmissionOnce`, `memoryDailyQuota`, and `fakeAuthenticator` in `@ryusenkei/web/form/testing`.
- `withCors(handler, { origins })` in `@ryusenkei/web`: answers preflights, adds `access-control-allow-origin`, and refuses other origins with 403 `forbidden_origin`.
- `submitForm` sends a plain object as JSON.
- `rateLimitKey` receives `subject` as well as `ip` and `form`.
- `notificationText` joins `multiChoice` values with `copy.separator` (default `、`).
- Standard messages for `too_few`, `too_many`, `unauthenticated`, `already_submitted`, `quota_exceeded`, and `forbidden_origin`.

### Migration

| Before (0.9) | After (0.10) |
| --- | --- |
| `FormValues` and `Submission.values` were `Partial<Record<F, string>>` | `Partial<Record<F, string \| readonly string[]>>` (`FieldValue`). Where a value is passed on as a string, narrow it with `typeof value === 'string'` |
| `SubmissionErrorCode` and `FormMessageCode` without the new codes | add cases for `unauthenticated`, `already_submitted`, `quota_exceeded`, `forbidden_origin` (and `too_few`, `too_many` for `FormMessageCode`) in exhaustive switches and full message tables |

## 0.9.0

Requires `@ryusenkei/core` 0.5. Arguments now follow one rule: required arguments are positional, optional settings go in a trailing options object, clocks are `now: () => number` (milliseconds), and `fetch` replacements are named `fetch`. Errors from wrong input are `UsageError` with a `code` instead of a plain `Error`.

### Added

- `@ryusenkei/web/blob`: the `BlobStore` port (moved from `cloudflare`) and `memoryBlobStore()`.
- `@ryusenkei/web/oidc`: `jwtVerifier` and `jwtFromRequest` (moved from `access`).
- `mailDestination({ name })`, so a form can have several mail destinations.
- `submissionHandler({ rateLimitKey })` to change the rate-limit key (default `form:<IP>`).
- `{ name }` on `cloudflareMailer`, `cloudflareRateLimiter`, `r2BlobStore`, and `analyticsEngineRecorder`: the binding's name, put into the `key` of the `ConfigError` for a missing binding (default `binding`).
- `visitorKey({ now })`.
- The tests also run in an Edge runtime (Web-standard globals only).

### Migration

Renamed and moved:

| Before (0.8) | After (0.9) |
| --- | --- |
| `jwtVerifier`, `jwtFromRequest`, `JwtVerifier`, `JwtVerifierOptions`, `JwtAlgorithm`, `JwtClaims` from `@ryusenkei/web/access` | the same names from `@ryusenkei/web/oidc` |
| `BlobStore`, `StoredBlob`, `BlobBody` from `@ryusenkei/web/cloudflare` | the same names from `@ryusenkei/web/blob` |
| `RateLimiter` from `@ryusenkei/web/cloudflare` | `RateLimiter` from `@ryusenkei/web/form/server` |
| `BotCheck` from `@ryusenkei/web/turnstile` | `BotCheck` from `@ryusenkei/web/form/server` (`BotCheckError` stays in `turnstile`) |
| `RateLimiterLike`, `BotCheckLike` from `@ryusenkei/web/form/server` | `RateLimiter`, `BotCheck` (same module) |
| `webhookDestination({ signatureHeader, signatureScheme })` | `webhookDestination({ header, scheme })` |

Arguments:

| Before (0.8) | After (0.9) |
| --- | --- |
| `signWebhook(…, { now: Date.now() })`, likewise `verifyWebhook`, `webhookHeaders`, `verifyWebhookRequest` | `{ now: () => Date.now() }` |
| `submissionHandler({ now: () => new Date() })` | `{ now: () => Date.now() }` |
| `memoryAnalytics(schema, { now: () => new Date() })` | `{ now: () => Date.now() }`. `events[].at` is milliseconds instead of a `Date` |
| `analyticsEngineCounts({ accountId, token, dataset, schema })` | `analyticsEngineCounts(schema, { accountId, token, dataset })` |
| `formMessage(code, params, messages)` | `formMessage(code, { params, messages })` |
| `problemMessage(problem, messages)` | `problemMessage(problem, { messages })` |

Behavior:

| Before (0.8) | After (0.9) |
| --- | --- |
| `webhookDestination({ secret: '' })` (or an unset variable) sent the webhook unsigned | throws `ConfigError` (`key: 'secret'`). Leave `secret` out to send unsigned |
| `analyticsEngineCounts` threw `Error('invalid_date: …')`, `invalid_time_zone`, `invalid_value`, `unknown_field`, `analytics_rows_exceeded`, and `analytics_query_failed` | `UsageError` with `code` `invalid_date`, `invalid_time_zone`, `invalid_value`, `unknown_field`, `rows_exceeded`, `query_failed`. A 401 or 403 is `ConfigError` (`key: 'token'`), and a response without `data` is `TransientError` |
| `analyticsEngineCounts` threw `ConfigError` for a malformed `dataset` when created | throws it on `count`, along with a missing `accountId` or `token` (both now accept `undefined`) |
| `memoryAnalytics` threw `Error('unknown_field: …')` | `UsageError` (`unknown_field`) |
| `sitemapXml` threw `Error('sitemap_too_large: …')` | `UsageError` (`sitemap_too_large`) |
| `sendEvent` sent when `window` existed | sends when `document` exists (some Edge runtimes alias `window` to the global object) |

Catch `UsageError` with `isUsageError` from `@ryusenkei/core`, or match on `code`.

## 0.8.0 and earlier

- 0.7.0 moved `signWebhook` from `@ryusenkei/web/form/server` to `@ryusenkei/web/webhook`. Its third argument became `{ now?, scheme? }` instead of the time in milliseconds.
- 0.6.0 was never published (its publish build failed); 0.6.1 is the first 0.6 release, with the same contents. From 0.6, errors, `Result`, and logging come from `@ryusenkei/core`.
