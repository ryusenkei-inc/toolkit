# @ryusenkei/scripts

Shared scripts for RYUSENKEI repositories: running child processes on Windows and elsewhere, managing the root `.env` and sending its values to GitHub and Cloudflare Workers, a deploy lock on R2 or GCS, post-deploy URL checks, Search Console verification and sitemap submission, an npm license check, and applying the standard GitHub repository settings.

## Install

```sh
pnpm add -D @ryusenkei/scripts
```

Requires Node.js 24 or later.

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
node scripts/env.ts push [--dry-run] [--only <target prefix>]
node scripts/env.ts tf -chdir=infra/stacks/site init   # Terraform, with `terraform` set
```

| Subcommand | What it does |
| --- | --- |
| `run` | Loads `.env` into the environment and runs the command. Leading `NAME=value` arguments are set as extra variables, since Windows `cmd` can't parse `NAME=value cmd` |
| `push` | Sends each value to its targets. Values go through stdin, never through process arguments. Keys missing from `targets` and empty values are skipped with a warning. `--only github:` limits the run to targets with that prefix |

Targets:

| Target | Sent with |
| --- | --- |
| `github:variable` | `gh variable set <KEY> --repo <current repo>` |
| `github:secret` | `gh secret set <KEY> --repo <current repo>` |
| `wrangler:secret:<worker>` | `pnpm exec wrangler secret put <KEY> --name <worker>` |

A key with an empty list stays local (for example, a token only used by `run`).

## Terraform (`tf`)

With `terraform: { stateBucket, stateKeyPrefix, tokenVar? }`, `tf` runs `terraform` prepared for a partial S3 backend (`backend "s3" {}`) on R2:

- `CLOUDFLARE_API_TOKEN` is set from the Terraform token (`CF_TERRAFORM_TOKEN` by default), kept separate from the deploy token.
- `AWS_ENDPOINT_URL_S3` points at the account's R2 (`CLOUDFLARE_ACCOUNT_ID`).
- The R2 credentials are derived from the token (`AWS_ACCESS_KEY_ID` is the token's ID, `AWS_SECRET_ACCESS_KEY` the SHA-256 of its value), unless `.env` sets them explicitly.
- `init` gets the backend settings: the bucket, the key `<stateKeyPrefix>/<stack directory name>.tfstate` (from `-chdir`), `use_lockfile=true` for state locking, and the S3 checks R2 doesn't support turned off.

`commands` adds repository-specific subcommands. Each one gets `ctx.values()` (the `.env` values) and `ctx.run(args, extra)` (like `run`, with extra variables on top of `.env`).

## Child processes

```ts
import { exec, execOutput, execCapture } from '@ryusenkei/scripts';

exec('pnpm', ['install']); // exit code, stdio shared with the parent
const sha = execOutput('git', ['rev-parse', 'HEAD']); // stdout, or null on failure
const { status, output } = await execCapture('pnpm', ['test']); // stdout and stderr in one string
```

All of them use [cross-spawn](https://github.com/moxystudio/node-cross-spawn), so `.cmd` shims such as `pnpm` and `npx` work on Windows without a shell. Also exported: `execFiltered` (prints only the lines you keep), `startProcess` and `stopProcess` (long-running processes, stopped with their children), and `currentRepo()` (`owner/name` of the working tree, from `gh`).

## Deploy lock

Keeps two deploys (another session, another machine) from changing production at the same time. The lock is a small JSON object (`{ owner, at }`) in a bucket, written with a condition, so only one of two simultaneous deploys gets it.

```ts
import { r2CredentialsOf, r2LockStore, withDeployLock } from '@ryusenkei/scripts';

const credentials = await r2CredentialsOf(env.CF_TERRAFORM_TOKEN, env.CLOUDFLARE_ACCOUNT_ID);
const store = r2LockStore({ accountId: env.CLOUDFLARE_ACCOUNT_ID, bucket: 'company-tfstate', key: 'example/deploy.lock', credentials: { accessKeyId: credentials.AWS_ACCESS_KEY_ID, secretAccessKey: credentials.AWS_SECRET_ACCESS_KEY } });

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
| `r2LockStore({ accountId, bucket, key, credentials })` | An R2 object, through the S3 API (`If-None-Match` / `If-Match` on the ETag) | S3 credentials: `r2CredentialsOf` from the Terraform token, or an R2 API token |
| `gcsLockStore({ bucket, key, accessToken })` | A GCS object, through the JSON API (`ifGenerationMatch`) | An access token function, such as `gcloudAccessToken()` |

A store is `{ name, read, write, remove, removeRequest }` (`LockStore`), so another backend fits in the same way.

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

Put the TXT value into DNS with the Terraform module `search-console-verification`. The same calls are exported as functions: `siteVerificationToken`, `verifyDomain`, `addSite`, `submitSitemap`, `listSitemaps`, and `domainProperty`.

Credentials are yours to provide; nothing here creates keys:

- `GOOGLE_APPLICATION_CREDENTIALS` set to a service account key file: `serviceAccountToken(key, scopes)` signs a JWT and gets a token. Add the service account as an owner of the property (or verify with its own TXT value) before it can submit sitemaps.
- Otherwise, your gcloud login (`gcloudAccessToken()`). Log in once with the Search Console scopes:

  ```sh
  gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/siteverification
  ```

  The quota project of the login needs the Site Verification API and the Search Console API enabled.

## License check

```sh
npx ryusenkei-licenses [--prod] [--allow <SPDX id>]... [--ignore <package>]...
```

Reads `pnpm licenses list --json` and fails on a dependency whose license is not allowed. The default list (`DEFAULT_ALLOWED_LICENSES`) is 0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, CC0-1.0, ISC, MIT, MIT-0, MPL-2.0, Unicode-3.0, Unlicense, and Zlib, which suits a product you sell. SPDX expressions with `OR`, `AND`, and `WITH` are understood. Write down why you allowed a license or ignored a package. `licenseAllowed` and `licenseViolations` are exported for your own scripts.

## Repository settings

```sh
npx ryusenkei-repo-settings [owner/name]
```

Run it once after creating a repository, since settings are not copied from a template. It sets:

- Squash merge only, with the PR title as the commit title and an empty body
- Merge commits and rebase merges off, also with the epic flow (`dev/*` → `main` is squashed too)
- Delete branches after merge

## License

MIT
