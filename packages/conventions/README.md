# @ryusenkei/conventions

Shared conventions for RYUSENKEI monorepos created from monorepo-template. Rules that a tool can enforce are enforced by hooks and settings. Only the rest are written in `rules.md`.

| Part | What it does |
| --- | --- |
| [`rules.md`](rules.md) | Rules for Claude Code, imported from each repository's `CLAUDE.md` (Japanese) |
| [`rules-ts.md`](rules-ts.md), [`rules-go.md`](rules-go.md), [`rules-rust.md`](rules-rust.md), [`rules-ui.md`](rules-ui.md) | Rules for one language or for UI code, imported only where they apply |
| `dist/hook.js` | Claude Code hook: blocks tool calls that break the rules, and optionally runs lint and tests before Claude finishes |
| `files/` | Master copies of the shared files, synced into each repository |
| `ryusenkei-conventions` | CLI: `sync` writes the shared files, `check` reports drift |
| `TEST_EXCLUDE` | Patterns to add to Vitest's default `exclude` |
| `runAffectedCheck` | The pre-push `pnpm check`: type checks and tests only what the change affects |

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
4. With Vitest, exclude `TEST_EXCLUDE` in the root `vitest.config.ts` (see [Vitest](#vitest)).

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
| Squash merge | Blocks `gh pr merge --rebase` and `--merge`, also for a `dev/*` → `main` PR with the epic flow |
| Merge only after CI passes | Blocks `gh pr merge` unless every check of the PR has passed (`gh pr checks`), or the PR's head commit passed the local `pnpm check` against the PR's base (see [Pre-push check](#pre-push-check)). Pending, failed, missing, or unreadable checks are blocked, also with `--auto`. A PR may have no checks only when the repository has no enabled workflow that runs on `pull_request` (workflows disabled on GitHub with `gh workflow disable` don't count; the pre-push `pnpm check` is the gate), or with the epic flow when it targets `dev/*`. Right after a push, the checks may not be registered yet, so the hook points to `gh pr checks --watch` |
| Epic flow (opt-in) | See [Epic flow](#epic-flow) |
| Do not edit `node_modules` | Blocks Edit and Write under `node_modules` |
| Secrets | `permissions.deny` blocks reading `.env` and `.dev.vars` with Claude's file tools (not Bash) |
| Definition of done (`--stop`) | The Stop hook runs `pnpm lint` and `pnpm test` when the working tree has changes, and sends Claude back once on failure |

The hook works out the target from the command itself. After `cd` or `git -C`, it checks against that repository (including its epic opt-in and `prose-lint.json`). After `git switch` or `git checkout`, it uses the new branch. Heredoc bodies are not parsed as commands.

Commit messages are checked by `.githooks/commit-msg`, and edited files by prose-lint's PostToolUse hook. `.githooks/pre-push` runs `pnpm run --if-present check` without the repository variables git passes to hooks (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, and the rest of `git rev-parse --local-env-vars`), so git commands in tests cannot write to the pushing repository. A repository that defines a `check` script cannot push until it passes. It applies to people as well as Claude. When [Hostslot](https://github.com/ryusenkei-inc/hostslot) (`hostslot`) is on the `PATH` and the repository has a `check` script, the check runs through `hostslot run`, so pushes from parallel agents and repositories wait for free memory instead of exhausting it.

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
- A `dev/*` → `main` PR is squashed like any other PR, so each deploy becomes one commit on `main`. The sub-issue commits stay in the merged sub-issue PRs. If the epic continues after a deploy, recreate `dev/*` from `main` and rebase the open sub-issue PRs onto it, as described in the `stacked-pr` skill.
- A PR into `dev/*` runs no CI; the pre-push `pnpm check` is the gate. `gh pr merge` allows such a PR with no checks, but any checks it has must still pass.
- Without the opt-in, none of this applies and `dev/*` branch names are rejected.

## Synced files

`sync` writes these files and `check` compares them, ignoring line endings:

- `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitleaks.toml`, `mise.toml`, `.github/dependabot.yaml`, `.githooks/commit-msg`, `.githooks/pre-push`
- Skills in `.claude/skills/`: `stacked-pr` (cleaning up a stacked PR after its parent is squash-merged, including sub-issue PRs after an epic's `dev/*` is squash-merged into `main`). Only these names are managed; other skills in the repository are kept
- `.github/dependabot.yaml` updates npm and GitHub Actions. When the repository has a `go.mod` at the root, a `gomod` entry is appended (same schedule, rebase strategy and cooldown, minor and patch grouped). Without one it is left out, because Dependabot fails on a missing `go.mod`
- With `"ryusenkei": { "dependabot": false }` in the root `package.json`, `.github/dependabot.yaml` is not synced; `check` reports it if present and `sync` deletes it. Use this in private repositories to save GitHub Actions minutes, and update dependencies locally with `pnpm update`. Dependabot security updates are a separate repository setting
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

`check` also reports a missing or incomplete root Vitest config when the root `package.json` depends on `vitest` (see [Vitest](#vitest)), and a root `package.json` without a `check` script, since the pre-push hook runs `pnpm check` and pushes unchecked without one. Add it by hand, as `node scripts/check.ts` with [`runAffectedCheck`](#pre-push-check).

Dependabot runs monthly with `rebase-strategy: disabled` to save GitHub Actions minutes, so rebase a Dependabot PR (`@dependabot rebase`) before merging it. The `cooldown` excludes `@ryusenkei/*`. To pick up a new version sooner, run `pnpm update "@ryusenkei/*"`. After an update, `check` fails until `sync` is run.

## Vitest

`TEST_EXCLUDE` is what every repository adds to Vitest's default `exclude`:

```ts
// vitest.config.ts
import { TEST_EXCLUDE } from '@ryusenkei/conventions';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ...TEST_EXCLUDE],
  },
});
```

| Pattern | Why |
| --- | --- |
| `.claude/**` | Agents' worktrees inside the repository would run the same tests twice |
| `**/.terraform/**` | `terraform init` downloads a Git module source as the whole repository (toolkit's tests included) into `.terraform/modules/` |

`check` reports a root `vitest.config.*` that neither uses `TEST_EXCLUDE` nor lists every pattern, and a repository that depends on `vitest` without one. It can't fix this by itself, since each repository's config differs. The shared `.gitignore` ignores `.terraform/` as well (`.terraform.lock.hcl` stays tracked).

`ryusenkei-conventions` exits with 0 when nothing drifts, 1 when something does, and 2 for a usage error; `--help` exits with 0.

## Pre-push check

`runAffectedCheck` runs the type checks and tests a change affects, so a push doesn't wait for the whole repository. Each repository passes its own fast checks:

```ts
// scripts/check.ts (package.json: "check": "node scripts/check.ts")
import { runAffectedCheck } from '@ryusenkei/conventions';

const results = await runAffectedCheck({
  steps: () => [
    { name: 'prose-lint', command: 'pnpm', args: ['exec', 'prose-lint'] },
    { name: 'conventions', command: 'pnpm', args: ['exec', 'ryusenkei-conventions', 'check'] },
    { name: 'deps', command: 'node', args: ['scripts/deps.ts'] },
  ],
});
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
```

| Scope | What runs |
| --- | --- |
| Base | The merge base with the nearest of `origin/main` and `origin/dev/*` (fewest commits to `HEAD`), excluding the branch's own remote. A sub-issue branch is checked against its epic's `dev/*`, and a `dev/*` branch against `main` |
| Changes | Committed, uncommitted and untracked files since the base. Markdown doesn't count |
| Type check | `typecheck` of the changed packages and their dependents (`pnpm -r --filter ...<name>`), and the root `tsc` when a `.ts` file outside the packages changed. Packages that import the root `scripts/` count as changed with it |
| Tests | `vitest run --changed <base>` (tests that import a changed file) |
| Everything | `pnpm typecheck` and all tests, with `--all`, without a base, or when a root config changed (`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vitest.config.*`, `mise.toml`, `.npmrc`, or `pnpm-lock.yaml` without a package's `package.json`) |

- The type check and the tests run one after the other, and `steps` run beside them. This keeps the peak memory to one heavy process tree, so parallel pushes from other worktrees fit (`concurrency` sets how many packages `tsc` checks at once, default 2).
- `--base <ref>` sets the base. `globalFiles` adds files that mean everything, and `testArgs` adds Vitest arguments such as reporters.
- Run it through `pnpm` (`pnpm check`). It starts `pnpm` from `npm_execpath` (`.js` with `node`, `.exe` directly).

The whole repository is checked with `pnpm check --all` locally before deploying.

When `pnpm check` passes with a clean working tree, it records the commit and the base it checked in the common git directory (`ryusenkei-check/<sha>`). `gh pr merge` accepts a PR without passing checks when its head commit has a record for the PR's base (`origin/<base>`) or for `--all`. So when CI doesn't run (the free minutes ran out, or the workflow is disabled), run `pnpm check --base origin/main` on the PR's head and merge. A push of a `dev/*` branch is checked against `origin/main`, so it records that already.

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
    types: [opened, synchronize, reopened, ready_for_review]
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

- The job is skipped while the PR is a draft and runs when it is marked ready (`ready_for_review`), to save the free minutes.
- `affected: true` runs `pnpm check --base origin/<base>` ([Pre-push check](#pre-push-check)) instead of the full type check, tests and prose-lint. Use it where the full check takes too long for the free minutes; the full check then runs locally before deploying.

Go, with releases on `v*` tags:

```yaml
# in .github/workflows/ci.yaml, next to the ci job
  go:
    uses: ryusenkei-inc/toolkit/.github/workflows/reusable-go.yaml@main
```

```yaml
# .github/workflows/release.yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    uses: ryusenkei-inc/toolkit/.github/workflows/reusable-go-release.yaml@main
    with:
      checks: test "v$(node -p "require('./package.json').version")" = "$GITHUB_REF_NAME"
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
| `reusable-go.yaml` | `go vet` and `go test` on each OS in `os` (Ubuntu, macOS, Windows by default), then `go build` for each `GOOS/GOARCH` in `targets` on Ubuntu. The Go version comes from `go.mod` |
| `reusable-go-release.yaml` | For a `v*` tag: `go test`, the `checks` input, then GoReleaser with the caller's `.goreleaser.yaml`. The caller grants `contents: write` |

- `terraform`: space-separated directories to check with `terraform fmt -check` and `validate` (no backend, so no credentials). Terraform comes from the caller's `mise.toml`.
- Go uses `reusable-go.yaml` as a second job next to `ci`; on a private repository, set `os: '["ubuntu-latest"]'`, since macOS and Windows minutes count several times. Rust jobs stay in the calling workflow.
- npm license checks: add `pnpm exec ryusenkei-licenses` from `@ryusenkei/scripts` to `checks` (see its README).
- PR title edits run in their own workflow. In the same workflow, the later `edited` run would overwrite the `ci` job's result with "skipped" and hide a failure.
- `@main` follows toolkit's `main`, so fixes reach every repository at once. A breaking change gets a new file name instead of changing these.

## Versioning

- major: a rule is removed or reversed, or a synced file changes incompatibly
- minor: a rule, a hook check, or a synced file is added
- patch: fixes and wording

See the [CHANGELOG](CHANGELOG.md) for what each version changed.
