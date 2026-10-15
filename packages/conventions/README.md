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
| Branch names `<type>/<name>` | Checks `git switch -c`, `git checkout -b`, `git branch`, `git worktree add -b` |
| No skipped Git hooks | Blocks `git commit --no-verify` / `-n` and `git push --no-verify` |
| PR title = squash commit message | Checks `gh pr create` / `gh pr edit` titles with prose-lint's commit rules |
| No AI signature | `attribution` is empty, and the hook blocks PR bodies with an AI signature |
| Squash merge only | Blocks `gh pr merge --merge` / `--rebase` |
| Do not edit `node_modules` | Blocks Edit and Write under `node_modules` |
| Secrets | `permissions.deny` blocks reading `.env` and `.dev.vars` with Claude's file tools (not Bash) |
| Definition of done (`--stop`) | The Stop hook runs `pnpm lint` and `pnpm test` when the working tree has changes, and sends Claude back once on failure |

Commit messages are checked by `.githooks/commit-msg`, and edited files by prose-lint's PostToolUse hook.

## Synced files

`sync` writes these files and `check` compares them, ignoring line endings:

- `.editorconfig`, `.gitattributes`, `.gitignore`, `.gitleaks.toml`, `mise.toml`, `.github/dependabot.yaml`, `.githooks/commit-msg`
- `.claude/settings.json`: only the hooks, `attribution`, and `permissions.deny` are managed. Other settings and hooks are kept
- `pnpm-workspace.yaml`: `minimumReleaseAge` and `minimumReleaseAgeExclude`, matching the Dependabot `cooldown`

`check` also reports a missing `rules.md` import in `CLAUDE.md`.

Updates arrive as Dependabot PRs. The repository's `cooldown` excludes `@ryusenkei/*`, so new versions are picked up the next day. After an update, `check` fails until `sync` is run.

## Versioning

- major: a rule is removed or reversed, or a synced file changes incompatibly
- minor: a rule, a hook check, or a synced file is added
- patch: fixes and wording
