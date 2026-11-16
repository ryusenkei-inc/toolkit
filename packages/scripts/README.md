# @ryusenkei/scripts

Shared scripts for RYUSENKEI repositories: running child processes on Windows and elsewhere, managing the root `.env` and sending its values to GitHub and Cloudflare Workers, a deploy lock on R2 or GCS, post-deploy URL checks, Search Console verification and sitemap submission, an npm license check, and applying the standard GitHub repository settings.

## Install

```sh
pnpm add -D @ryusenkei/scripts
```

Requires Node.js 24 or later. Failures are thrown as the error types of [`@ryusenkei/core`](../core): a 401 or 403 (credentials, permissions) is `ConfigError`, a connection failure or a 408, 429, or 5xx is `TransientError`, and any other refused request is `UsageError` with a `code` such as `lock_write_failed` or `google_api_failed`.

Required arguments are positional and optional settings go in a trailing options object. Clocks are `now: () => number` (milliseconds), and `fetch` replacements are named `fetch`.

## `.env` CLI

Each repository keeps a short `scripts/env.ts` with its own targets. The shared package provides the rest:

```ts
import { envCli } from '@ryusenkei/scripts';

await envCli({
  root: new URL('..', import.meta.url),
  targets: {
    CLOUDFLARE_ACCOUNT_ID: ['github:variable'],
    CF_DEPLOY_TOKEN: ['github:secret'],
    TURNSTILE_SECRET_KEY: ['wrangler:secret:site'],
    CF_TERRAFORM_TOKEN: [],
  },
  terraform: { stateBucket: 'company-tfstate', stateKeyPrefix: 'example' },
});
```

```sh
node scripts/env.ts run [NAME=value ...] <command> [...args]
node scripts/env.ts push [--dry-run] [--only <NAME | target prefix>]...
node scripts/env.ts check [--only <NAME | target prefix>]...
node scripts/env.ts tf -chdir=infra/stacks/site init   # Terraform, with `terraform` set
```

| Subcommand | What it does |
| --- | --- |
| `run` | Loads `.env` into the environment and runs the command. Leading `NAME=value` arguments are set as extra variables, since Windows `cmd` can't parse `NAME=value cmd` |
| `push` | Sends each value to its targets. Values go through stdin, never through process arguments. Keys missing from `targets` and empty values are skipped with a warning. Without `--only`, every key in `targets` is sent |
| `check` | Compares `.env` with production without printing any value (see [Drift check](#drift-check-check)). Exits with 1 when something differs |

`--only` narrows `push` and `check`, and can be repeated. A value shaped like a variable name (`LINE_TOKEN`) selects that key; anything else (`github:`, `wrangler:secret:api`) is a target prefix. Several names or several prefixes select any of them; names and prefixes together select what matches both. A name that isn't in `targets` is a usage error, so a typo doesn't end in sending nothing.

```sh
node scripts/env.ts push --only LINE_TOKEN       # this key only, to all its targets
node scripts/env.ts push --only A_KEY --only B_KEY --dry-run
node scripts/env.ts check                        # before a full push
```

When you change one value, send that key with `--only`. A full `push` overwrites every secret with the value in your `.env`, so a stale `.env` breaks production. Run `check` first.

### Running from a git worktree

A git worktree usually has no `.env`; only the main checkout does. The CLI looks for `.env` in this order:

1. `.env` at `root` (the worktree root)
2. `.env` at the root of the main checkout, found with `git rev-parse --git-common-dir`
3. Neither: exits with 1, as before

It prints which file it read to stderr (`env  <path>（作業ツリー）` or `（本体のチェックアウト）`), never the values. It doesn't copy `.env` into the worktree.

`findEnvFile(root)` returns the same choice (`{ path, from: 'worktree' | 'main' }`, or `undefined`) for repository scripts that read `.env` without `envCli`.

The main checkout's `.env` may be newer or older than what the worktree's branch expects. Run `check` before deploying or pushing from a worktree.

Targets:

| Target | Sent with |
| --- | --- |
| `github:variable` | `gh variable set <KEY> --repo <current repo>` |
| `github:secret` | `gh secret set <KEY> --repo <current repo>` |
| `wrangler:secret:<worker>` | `pnpm exec wrangler secret put <KEY> --name <worker>` |

A key with an empty list stays local (for example, a token only used by `run`).

`wrangler secret put` (in `push`) and `wrangler secret list` (in `check`) run with `CF_DEPLOY_TOKEN` from `.env` as `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` from `.env`, so they don't need `wrangler login`. Name another variable with `wranglerTokenVar`. Without the variable in `.env`, wrangler uses its login or the environment as before.

### Drift check (`check`)

Secrets can't be read back from GitHub or Workers. So `push` leaves a fingerprint of each secret it sends in a GitHub repository variable (`ENV_FINGERPRINTS`), and `check` compares it with the fingerprint of the value in `.env`:

| Output | Meaning |
| --- | --- |
| `一致` | Same as production |
| `本番と違う` | Differs from production |
| `本番にない` | In `.env`, not in production |
| `.env にない` | In production, empty or missing in `.env` |
| `記録なし` | In production, but not sent by a version that records fingerprints, so only its presence is known. A `push` of that key records it |
| `取得できない` | The list of names couldn't be fetched (login, permissions, a missing Worker) |

`check` exits with 1 for `本番と違う`, `本番にない`, `.env にない`, and `取得できない`. `github:variable` values are readable, so they are compared directly. Secrets are listed by name (`gh secret list`, `wrangler secret list`) to tell whether they exist.

The fingerprint is 12 characters of scrypt over the value, the key name, and a random salt kept in the same record. Neither the value nor the fingerprint is printed. Limits:

- A secret changed outside `push` (the dashboard, `wrangler secret put` by hand) keeps the old fingerprint. `check` then reports a difference until the key is pushed again.
- Anyone who can read the repository's variables can read the record. A long random token can't be recovered from it, but a short or guessable value (an email address) can be confirmed by guessing. scrypt makes each guess slow, not impossible.
- Recording needs `gh` logged in with permission to set variables. Without it, `push` still sends the values and warns that nothing was recorded.

`fingerprints: { variable: 'NAME' }` changes the variable, and `fingerprints: false` turns recording off (`check` then reports secrets as `記録なし`).

## Terraform (`tf`)

With `terraform: { stateBucket, stateKeyPrefix, tokenVar? }`, `tf` runs `terraform` prepared for a partial S3 backend (`backend "s3" {}`) on R2:

- `CLOUDFLARE_API_TOKEN` is set from the Terraform token (`CF_TERRAFORM_TOKEN` by default), kept separate from the deploy token.
- `AWS_ENDPOINT_URL_S3` points at the account's R2 (`CLOUDFLARE_ACCOUNT_ID`).
- The R2 credentials are derived from the token with `r2CredentialsOf` (`AWS_ACCESS_KEY_ID` is the token's ID, `AWS_SECRET_ACCESS_KEY` the SHA-256 of its value), unless `.env` sets them explicitly.
- `init` gets the backend settings: the bucket, the key `<stateKeyPrefix>/<stack directory name>.tfstate` (from `-chdir`), `use_lockfile=true` for state locking, and the S3 checks R2 doesn't support turned off.

Exit status: 0 on success, 1 when a subcommand fails or `check` finds a difference, and 2 for a usage error (an unknown subcommand, `run` without a command, or an `--only` name not in `targets`). `--help` prints the usage and exits with 0.

`commands` adds repository-specific subcommands. Each one gets `ctx.values()` (the `.env` values) and `ctx.run(args, extra)` (like `run`, with extra variables on top of `.env`).

## Child processes

```ts
import { execCapture, execOutputSync, execSync } from '@ryusenkei/scripts';

execSync('pnpm', ['install']); // exit code, stdio shared with the parent
const sha = execOutputSync('git', ['rev-parse', 'HEAD']); // stdout, or null on failure
const { status, output } = await execCapture('pnpm', ['test']); // stdout and stderr in one string
```

A name ending in `Sync` blocks until the process ends; the others return a `Promise`.

| Function | Returns | Output |
| --- | --- | --- |
| `execSync(command, args, options?)` | the exit code | shared with the parent |
| `execOutputSync(command, args, options?)` | stdout, or `null` on failure | stderr shared with the parent |
| `execCapture(command, args, options?)` | `Promise<{ status, output }>` | stdout and stderr in one string, so parallel runs don't mix |
| `execFiltered(command, args, keep, options?)` | `Promise<number>` (exit code) | prints only the stdout lines `keep` accepts, for output that contains secrets |
| `startProcess(command, args, options?)` / `stopProcess(child)` | a `ChildProcess` | long-running processes, stopped with their children |

All of them use [cross-spawn](https://github.com/moxystudio/node-cross-spawn), so `.cmd` shims such as `pnpm` and `npx` work on Windows without a shell. `currentRepo({ cwd? })` gives `owner/name` of the working tree, from `gh`.

## Deploy lock

Keeps two deploys (another session, another machine) from changing production at the same time. The lock is a small JSON object (`{ owner, at }`) in a bucket, written with a condition, so only one of two simultaneous deploys gets it.

```ts
import { r2CredentialsOf, r2LockStore, withDeployLock } from '@ryusenkei/scripts';

const credentials = await r2CredentialsOf(env.CF_TERRAFORM_TOKEN, env.CLOUDFLARE_ACCOUNT_ID);
if (!credentials) throw new Error('R2 の認証をトークンから導出できない');
const store = r2LockStore({ accountId: env.CLOUDFLARE_ACCOUNT_ID, bucket: 'company-tfstate', key: 'example/deploy.lock', credentials });

await withDeployLock(store, async () => {
  // terraform apply, wrangler deploy, ...
}, { owner: `${hostname()}:${process.pid}:${head}`, staleMs: 30 * 60_000 });
```

- `withDeployLock(store, fn, options)` throws `DeployLockHeldError` (with the holder and since when) while another deploy holds the lock, and removes the lock when `fn` ends.
- `acquireDeployLock(store, options)` gives `{ kind: 'acquired', lock }` or `{ kind: 'held', lock }`, for scripts that release by hand (`lock.release()`).
- A lock older than `staleMs` (60 minutes by default; about twice your longest deploy) is the remains of a stopped deploy and is overwritten; `lock.stale` tells you whose it was.
- With `releaseOnExit` (the default), the lock is also removed when the process exits, including `process.exit` and Ctrl+C.
- `release()` only removes the lock if it is still yours.

| Store | Where | Credentials |
| --- | --- | --- |
| `r2LockStore({ accountId, bucket, key, credentials })` | An R2 object, through the S3 API (`If-None-Match` / `If-Match` on the ETag) | S3 credentials (`{ accessKeyId, secretAccessKey }`): `r2CredentialsOf(token, accountId)` from the Terraform token, or an R2 API token. `s3CredentialsEnv(credentials)` turns them into `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |
| `gcsLockStore({ bucket, key, accessToken })` | A GCS object, through the JSON API (`ifGenerationMatch`) | An access token function, such as `gcloudAccessToken()` |

A store is `{ name, read, write, remove, removeRequest }` (`LockStore`), so another backend fits in the same way. `lockStateOf(content, { now?, staleMs? })` reads a stored lock without a store.

## Post-deploy checks

`checkUrls(checks, options)` fetches each URL and compares it with what you expect, retrying the failed ones while the deploy propagates.

```ts
import { checkUrls, formatCheckResults } from '@ryusenkei/scripts';

const results = await checkUrls(
  [
    { url: 'https://example.com/', includes: ['<h1>'], excludes: ['mock'], headers: { 'content-type': 'text/html' } },
    { url: 'https://example.com/healthz', includes: [commit] },
    { url: 'https://www.example.com/a', location: 'https://example.com/a' },
  ],
  { attempts: 6, intervalMs: 10_000 },
);
for (const line of formatCheckResults(results)) console.log(line);
if (results.some((r) => !r.ok)) process.exit(1);
```

- `status`: the expected status (200 by default; any of 301, 302, 307, 308 with `location`). A list allows several.
- `includes` / `excludes`: text the body must or must not contain.
- `headers`: lowercase header names whose values must contain the given text.
- `location`: the expected redirect target, resolved against `url`. The redirect is not followed.
- `requestHeaders`: headers to send. Every request sends `cache-control: no-cache`.

## Search Console

```sh
npx ryusenkei-search-console token example.com            # the TXT value for the Domain property
npx ryusenkei-search-console verify example.com           # verify by TXT and add sc-domain:example.com
npx ryusenkei-search-console submit sc-domain:example.com https://example.com/sitemap.xml
npx ryusenkei-search-console sitemaps sc-domain:example.com
```

Exit status: 0 on success, 1 when an API call fails, and 2 for a usage error. `--help` prints the usage and exits with 0.

Put the TXT value into DNS with the Terraform module `search-console-verification`. The same calls are exported as functions: `siteVerificationToken`, `verifyDomain`, `addSite`, `submitSitemap`, `listSitemaps`, and `domainProperty`.

Credentials are yours to provide; nothing here creates keys:

- `GOOGLE_APPLICATION_CREDENTIALS` set to a service account key file: `serviceAccountToken(key, scopes)` signs a JWT and gets a token. Add the service account as an owner of the property (or verify with its own TXT value) before it can submit sitemaps.
- `googleAccessToken(scopes, { env? })` picks between the two from `GOOGLE_APPLICATION_CREDENTIALS`. A rejected key (400) or a missing gcloud login throws `ConfigError`.
- Otherwise, your gcloud login (`gcloudAccessToken()`). Log in once with the Search Console scopes:

  ```sh
  gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/siteverification
  ```

  The quota project of the login needs the Site Verification API and the Search Console API enabled.

## License check

```sh
npx ryusenkei-licenses [--prod] [--allow <SPDX id>]... [--ignore <package>]...
```

Reads `pnpm licenses list --json` and fails on a dependency whose license is not allowed. The default list (`DEFAULT_ALLOWED_LICENSES`) is 0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC0-1.0, ISC, MIT, MIT-0, MPL-2.0, Unicode-3.0, Unlicense, and Zlib, which suits a product you sell. SPDX expressions with `OR`, `AND`, and `WITH` are understood. Write down why you allowed a license or ignored a package. Exit status: 0 when every license is allowed, 1 for a disallowed license or a failed `pnpm licenses list`, and 2 for a usage error; `--help` exits with 0. `licenseAllowed(expression, { allowed? })` and `licenseViolations(listing, { allowed?, ignore? })` are exported for your own scripts.

## Repository settings

```sh
npx ryusenkei-repo-settings [owner/name]
```

Run it once after creating a repository, since settings are not copied from a template. It exits with the status of `gh`, or 2 for a usage error. It sets:

- Squash merge only, with the PR title as the commit title and an empty body
- Merge commits and rebase merges off, also with the epic flow (`dev/*` → `main` is squashed too)
- Delete branches after merge

## Versioning

While the version is 0.x, a minor bump may break the API. See the [CHANGELOG](CHANGELOG.md) for what changed and how to migrate.

## License

MIT
