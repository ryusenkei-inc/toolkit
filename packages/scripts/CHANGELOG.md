# Changelog

## 0.4.0

Depends on `@ryusenkei/core` 0.5 for its error types. Arguments now follow one rule: required arguments are positional, optional settings go in a trailing options object, clocks are `now: () => number`, and `fetch` replacements are named `fetch`. A function name ending in `Sync` blocks; the others return a `Promise`.

### Added

- `s3CredentialsEnv(credentials)`: S3 credentials as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
- `execFiltered` takes spawn options as its fourth argument.
- `--help` on every CLI.

### Migration

Renamed:

| Before (0.3) | After (0.4) |
| --- | --- |
| `exec(command, args, options)` | `execSync(command, args, options)` |
| `execOutput(command, args, options)` | `execOutputSync(command, args, options)` |

Arguments and return values:

| Before (0.3) | After (0.4) |
| --- | --- |
| `r2CredentialsOf(token, accountId, fetcher)` returned `{ AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY }` | `r2CredentialsOf(token, accountId, { fetch })` returns `{ accessKeyId, secretAccessKey }`, which `r2LockStore` takes as `credentials`. For environment variables, use `s3CredentialsEnv(credentials)` |
| `lockStateOf(content, now, staleMs)` | `lockStateOf(content, { now: () => now, staleMs })` |
| `signS3Request({ now: new Date() })` | `signS3Request({ now: () => Date.now() })` |
| `googleAccessToken(scopes, env)` | `googleAccessToken(scopes, { env })` |
| `licenseAllowed(expression, allowed)` | `licenseAllowed(expression, { allowed })` |
| `currentRepo(cwd)` | `currentRepo({ cwd })` |

Errors (these were plain `Error`s with the code at the start of the message):

| Before (0.3) | After (0.4) |
| --- | --- |
| `lock_read_failed`, `lock_write_failed`, `lock_remove_failed` | a 401 or 403 is `ConfigError`; a connection failure or a 408, 429, or 5xx is `TransientError`; anything else is `UsageError` with the same `code` |
| `google_api_failed`, `google_token_failed` | as above. A token request rejected with 400 (a wrong key) is `ConfigError` (`key: 'GOOGLE_APPLICATION_CREDENTIALS'`) |
| `gcloud_token_failed` | `ConfigError` (`key: 'gcloud'`) |

Exit status:

| CLI | Before (0.3) | After (0.4) |
| --- | --- | --- |
| `envCli` (`node scripts/env.ts`) | 1 for an unknown subcommand and for `run` without a command | 2. `--help` exits with 0 |
| `ryusenkei-licenses` | an unknown option crashed with 1 | 2. `--help` exits with 0 |
| `ryusenkei-repo-settings` | extra arguments were passed to `gh` | 2. `--help` exits with 0 |
| `ryusenkei-search-console` | 2 for a usage error | unchanged. `--help` exits with 0 |

## 0.3.0 and earlier

0.3.0 added the deploy lock, post-deploy checks, Search Console, and the npm license check.
