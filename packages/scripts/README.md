# @ryusenkei/scripts

Shared scripts for RYUSENKEI repositories: running child processes on Windows and elsewhere, managing the root `.env` and sending its values to GitHub and Cloudflare Workers, and applying the standard GitHub repository settings.

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
