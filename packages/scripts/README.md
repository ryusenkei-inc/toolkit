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
  commands: {
    // Terraform gets its own token, separate from the deploy token
    tf: (args, ctx) => ctx.run(['terraform', ...args], { CLOUDFLARE_API_TOKEN: ctx.values().CF_TERRAFORM_TOKEN }),
  },
});
```

```sh
node scripts/env.ts run [NAME=value ...] <command> [...args]
node scripts/env.ts push [--dry-run] [--only <target prefix>]
node scripts/env.ts tf plan    # a command from `commands`
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
- With the epic flow (`"ryusenkei": { "flow": "epic" }` in `package.json`), merge commits are also allowed for `dev/*` → `main`, with the same title and body settings
- Delete branches after merge

## License

MIT
