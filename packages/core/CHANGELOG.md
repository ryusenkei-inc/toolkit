# Changelog

## 0.5.0

Arguments now follow one rule: required arguments are positional, optional settings go in a trailing options object, clocks are `now: () => number`, and `fetch` replacements are named `fetch`.

### Added

- `UsageError` (`code`, snake_case) and `isUsageError` for mistakes by the caller. It is classified as `unknown`.
- `StartSpanOptions`, `WithSpanOptions` (types).

### Migration

| Before (0.4) | After (0.5) |
| --- | --- |
| `tracer.startSpan(name, attributes, parent)` | `tracer.startSpan(name, { attributes, parent })`. A custom `Tracer` implements the new signature |
| `withSpan(name, fn, attributes)` | `withSpan(name, fn, { attributes })` |
| `tracedFetch(url, init, { fetcher })` | `tracedFetch(url, init, { fetch })` |
| `serializeError(e, depth)` | `serializeError(e)` (the depth was internal) |

## 0.4.0 and earlier

0.4.0 added `@ryusenkei/core/trace`. 0.3.0 moved the HTTP parts (`failureResponse`, `withRequestId`) to `@ryusenkei/web`.
