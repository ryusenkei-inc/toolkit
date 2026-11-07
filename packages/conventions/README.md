# @ryusenkei/conventions

Shared conventions for RYUSENKEI monorepos created from monorepo-template. Rules that a tool can enforce are enforced by hooks and settings. Only the rest are written in `rules.md`.

| Part | What it does |
| --- | --- |
| [`rules.md`](rules.md) | Rules for Claude Code, imported from each repository's `CLAUDE.md` (Japanese) |
| [`rules-ts.md`](rules-ts.md), [`rules-go.md`](rules-go.md), [`rules-rust.md`](rules-rust.md), [`rules-ui.md`](rules-ui.md) | Rules for one language or for UI code, imported only where they apply |
| `dist/hook.js` | Claude Code hook: blocks tool calls that break the rules, and optionally runs lint and tests before Claude finishes |
| `files/` | Master copies of the shared files, synced into each repository |
| `ryusenkei-conventions` | CLI: `sync` writes the shared files, `check` reports drift |

## Install

```sh
pnpm add -D @ryusenkei/conventions
```

Requires Node.js 24 or later.

## Setup

1. Import the rules at the end of the repository's `CLAUDE.md`:

   ```markdown
   # CLAUDE.md

   One-line summary of the repository.

   ## このリポの規約

   - Repository-specific rules

   @node_modules/@ryusenkei/conventions/rules.md
   @node_modules/@ryusenkei/conventions/rules-ts.md
   ```

2. Write the shared files: `npx ryusenkei-conventions sync` (add `--stop` to run lint and tests before Claude finishes).
3. Add `ryusenkei-conventions check` to the `lint` script.

- Claude Code expands the import when a session starts. Run `pnpm install` first, or the rules are not loaded.
- The import resolves inside the working directory, so Claude Code does not ask for approval of external imports.

## Enforced rules

The PreToolUse hook blocks the call and tells Claude why, so Claude can fix it and retry.

| Rule | Enforcement |
| --- | --- |
| pnpm only | Blocks `npm install` (and other npm changes) and `yarn` |
| Branch names `<type>/<name>` | Checks `git switch -c`, `git checkout -b`, `git branch`, `git worktree add -b` (also allows `dev/<issue>-<name>` with the epic flow) |
| No skipped Git hooks | Blocks `git commit --no-verify` / `-n` and `git push --no-verify` |
| Stage files by path | Blocks `git add -A` / `--all` / `.` / `-u` / `--update` and `git commit -a` / `--all` |
| No force push to `main` / `master` | Blocks `git push --force` / `-f` / `--force-with-lease` and `+<refspec>` targeting `main` or `master` (also the current branch when no refspec is given) |
| PR title = squash commit message | Checks `gh pr create` / `gh pr edit` titles with prose-lint's commit rules |
| No AI signature | `attribution` is empty, and the hook blocks PR bodies with an AI signature |
| Squash merge | Blocks `gh pr merge --rebase`, and `--merge` except for a `dev/*` → `main` PR with the epic flow, which must use `--merge` |
| Merge only after CI passes | Blocks `gh pr merge` unless every check of the PR has passed (`gh pr checks`). Pending, failed, missing, or unreadable checks are blocked, also with `--auto`. A PR may have no checks only when the repository has no workflow that runs on `pull_request` (the pre-push `pnpm check` is the gate), or with the epic flow when it targets `dev/*`. Right after a push, the checks may not be registered yet, so the hook points to `gh pr checks --watch` |
| Epic flow (opt-in) | See [Epic flow](#epic-flow) |
| Do not edit `node_modules` | Blocks Edit and Write under `node_modules` |
| Secrets | `permissions.deny` blocks reading `.env` and `.dev.vars` with Claude's file tools (not Bash) |
| Definition of done (`--stop`) | The Stop hook runs `pnpm lint` and `pnpm test` when the working tree has changes, and sends Claude back once on failure |

The hook works out the target from the command itself. After `cd` or `git -C`, it checks against that repository (including its epic opt-in and `prose-lint.json`). After `git switch` or `git checkout`, it uses the new branch. Heredoc bodies are not parsed as commands.

Commit messages are checked by `.githooks/commit-msg`, and edited files by prose-lint's PostToolUse hook. `.githooks/pre-push` runs `pnpm run --if-present check`, so a repository that defines a `check` script cannot push until it passes. It applies to people as well as Claude. When [Hostslot](https://github.com/ryusenkei-inc/hostslot) (`hostslot`) is on the `PATH` and the repository has a `check` script, the check runs through `hostslot run`, so pushes from parallel agents and repositories wait for free memory instead of exhausting it.

### Epic flow

Opt in per repository in the root `package.json`:

```json
{
  "ryusenkei": { "flow": "epic" }
}
```

- Each epic gets an integration branch `dev/<issue>-<name>` (e.g. `dev/12-search`). Sub-issue PRs target it, and only a `dev/*` branch is merged into `main` (on deploy).
- `gh pr create` to `main` (`--base main`, or no `--base`) is blocked unless the head (`--head`, or the current branch) is `dev/*`.
- A PR from any other branch must target a `dev/*` base. `gh pr edit` is checked only when it changes `--base`.
- A `dev/*` → `main` PR is merged with a merge commit (`gh pr merge --merge`), not squashed. This keeps one commit per sub-issue on `main`, and keeps `dev/*` and `main` from diverging when work continues on the epic after a deploy. Turn on "Allow merge commits" in the repository settings.
- A PR into `dev/*` runs no CI; the pre-push `pnpm check` is the gate. `gh pr merge` allows such a PR with no checks, but any checks it has must still pass.
- Without the opt-in, none of this applies and `dev/*` branch names are rejected.

## Synced files

`sync` writes these files and `check` compares them, ignoring line endings:

- `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitleaks.toml`, `mise.toml`, `.github/dependabot.yaml`, `.githooks/commit-msg`, `.githooks/pre-push`
- Skills in `.claude/skills/`: `stacked-pr` (cleaning up a stacked PR after its parent is squash-merged). Only these names are managed; other skills in the repository are kept
- `.github/dependabot.yaml` updates npm and GitHub Actions. When the repository has a `go.mod` at the root, a `gomod` entry is appended (same schedule, rebase strategy and cooldown, minor and patch grouped). Without one it is left out, because Dependabot fails on a missing `go.mod`
- When the repository has a `Cargo.toml` at the root, a `cargo` entry is appended to `.github/dependabot.yaml` after any `gomod` entry (same settings as `gomod`, covering workspace members), and `target/` is appended to `.gitignore`. `Cargo.lock` stays tracked
- `.claude/settings.json`: only the hooks, `attribution`, `permissions.deny`, and the writing plugins are managed. Other settings, hooks, and plugins are kept
  - The writing plugins are [yomiyasu](https://github.com/nanaism/yomiyasu) (Japanese) and [humanizer](https://github.com/blader/humanizer) (English). `extraKnownMarketplaces` registers their marketplaces and `enabledPlugins` turns them on. They load after you trust the folder, with no separate install. They are not bundled, and they do not auto-update; run `/plugin` to update them. To turn one off in a repository, set it to `false` in `enabledPlugins`
- `pnpm-workspace.yaml`: `minimumReleaseAge` and `minimumReleaseAgeExclude`, matching the Dependabot `cooldown`

`check` also reports a missing `rules.md` import in `CLAUDE.md`, and the imports of the language and UI rules a repository needs:

| Rules | Required when |
| --- | --- |
| `rules-ts.md` | `tsconfig.json` at the root |
| `rules-go.md` | `go.mod` at the root |
| `rules-rust.md` | `Cargo.toml` at the root |
| `rules-ui.md` | `"ryusenkei": { "ui": true }` in the root `package.json` |

When the `rules.md` import is present, `sync` adds the missing ones right after it.

Dependabot runs monthly with `rebase-strategy: disabled` to save GitHub Actions minutes, so rebase a Dependabot PR (`@dependabot rebase`) before merging it. The `cooldown` excludes `@ryusenkei/*`. To pick up a new version sooner, run `pnpm update "@ryusenkei/*"`. After an update, `check` fails until `sync` is run.

## Dependency direction

`runDepsCheck` checks imports in the sources and the dependencies in each `package.json` against the layer rules of the repository. Each repository keeps only its rules:

```ts
// scripts/deps.ts
import { runDepsCheck } from '@ryusenkei/conventions';
import { EXCEPTIONS, RULES } from './lib/deps-rules.ts';

runDepsCheck({ rules: RULES, exceptions: EXCEPTIONS });
```

```ts
// scripts/lib/deps-rules.ts
import type { Exception, Rule } from '@ryusenkei/conventions';

export const RULES: Rule[] = [
  { name: 'core', paths: ['packages/core'], allow: [], deny: ['cloudflare:', 'node:', '@vercel/'] },
  { name: 'adapters', paths: ['packages/adapter-*'], allow: ['packages/core'] },
  { name: 'app', paths: ['apps/*'], allow: ['packages/core', 'packages/adapter-*'] },
];
export const EXCEPTIONS: Exception[] = [];
```

| Field | Meaning |
| --- | --- |
| `paths` | Paths the rule covers, from the repository root. `*` matches within one path segment. The most specific match wins |
| `allow` | Paths the covered files may import. The same rule and the same package are always allowed |
| `deny` | Prefixes of external modules the covered files may not import |
| `EXCEPTIONS` | `{ from, to }` pairs allowed despite the rules |

It reads tracked and unignored files, `.ts`/`.js` variants and `.astro` (front matter and `<script>`), and fails when a workspace package has no rule. It needs `typescript` (a peer dependency), which only this check loads.

## CI

The CI lives in toolkit as reusable workflows, so each repository only keeps the triggers:

```yaml
# .github/workflows/ci.yaml
name: CI
on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  ci:
    uses: ryusenkei-inc/toolkit/.github/workflows/reusable-ci.yaml@main
    with:
      checks: |
        pnpm lint:deps
```

```yaml
# .github/workflows/pr-title.yaml
name: PR title
on:
  pull_request:
    branches: [main]
    types: [edited]
concurrency:
  group: pr-title-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  title:
    uses: ryusenkei-inc/toolkit/.github/workflows/reusable-pr-title.yaml@main
```

| Workflow | Steps |
| --- | --- |
| `reusable-ci.yaml` | Checkout (full history), mise, pnpm, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm lint:prose`, the `checks` input, the PR title with prose-lint's commit rules (not for Dependabot), and a gitleaks scan with `.gitleaks.toml` |
| `reusable-pr-title.yaml` | Re-checks the PR title when it is edited, with the `@ryusenkei/prose-lint` version from `package.json` and no install |

- Language jobs (Go, Rust) stay in the calling workflow as extra jobs.
- PR title edits run in their own workflow. In the same workflow, the later `edited` run would overwrite the `ci` job's result with "skipped" and hide a failure.
- `@main` follows toolkit's `main`, so fixes reach every repository at once. A breaking change gets a new file name instead of changing these.

## Versioning

- major: a rule is removed or reversed, or a synced file changes incompatibly
- minor: a rule, a hook check, or a synced file is added
- patch: fixes and wording
