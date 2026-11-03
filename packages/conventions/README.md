# @ryusenkei/conventions

Shared conventions for RYUSENKEI monorepos created from monorepo-template. Rules that a tool can enforce are enforced by hooks and settings. Only the rest are written in `rules.md`.

| Part | What it does |
| --- | --- |
| [`rules.md`](rules.md) | Rules for Claude Code, imported from each repository's `CLAUDE.md` (Japanese) |
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
| Squash merge only | Blocks `gh pr merge --merge` / `--rebase` |
| Merge only after CI passes | Blocks `gh pr merge` unless every check of the PR has passed (`gh pr checks`). Pending, failed, missing, or unreadable checks are blocked, also with `--auto` |
| Epic flow (opt-in) | See [Epic flow](#epic-flow) |
| Do not edit `node_modules` | Blocks Edit and Write under `node_modules` |
| Secrets | `permissions.deny` blocks reading `.env` and `.dev.vars` with Claude's file tools (not Bash) |
| Definition of done (`--stop`) | The Stop hook runs `pnpm lint` and `pnpm test` when the working tree has changes, and sends Claude back once on failure |

Commit messages are checked by `.githooks/commit-msg`, and edited files by prose-lint's PostToolUse hook. `.githooks/pre-push` runs `pnpm run --if-present check`, so a repository that defines a `check` script cannot push until it passes. It applies to people as well as Claude.

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
- Without the opt-in, none of this applies and `dev/*` branch names are rejected.

## Synced files

`sync` writes these files and `check` compares them, ignoring line endings:

- `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitleaks.toml`, `mise.toml`, `.github/dependabot.yaml`, `.githooks/commit-msg`, `.githooks/pre-push`
- `.claude/settings.json`: only the hooks, `attribution`, and `permissions.deny` are managed. Other settings and hooks are kept
- `pnpm-workspace.yaml`: `minimumReleaseAge` and `minimumReleaseAgeExclude`, matching the Dependabot `cooldown`

`check` also reports a missing `rules.md` import in `CLAUDE.md`.

Dependabot runs monthly with `rebase-strategy: disabled` to save GitHub Actions minutes, so rebase a Dependabot PR (`@dependabot rebase`) before merging it. The `cooldown` excludes `@ryusenkei/*`. To pick up a new version sooner, run `pnpm update "@ryusenkei/*"`. After an update, `check` fails until `sync` is run.

## Versioning

- major: a rule is removed or reversed, or a synced file changes incompatibly
- minor: a rule, a hook check, or a synced file is added
- patch: fixes and wording
