# @ryusenkei/conventions

Shared Claude Code conventions for RYUSENKEI monorepos created from monorepo-template: code layout, dependencies, secrets, writing style, Git, and the definition of done.

The rules live in [`rules.md`](rules.md), written in Japanese. The file is not named `CLAUDE.md`, so Claude Code does not load it as a nested `CLAUDE.md` while working in this repository.

## Install

```sh
pnpm add -D @ryusenkei/conventions
```

## Usage

Import the shared file from the repository's `CLAUDE.md`, after the repository-specific rules:

```markdown
# CLAUDE.md

One-line summary of the repository.

## このリポの規約

- Repository-specific rules

@node_modules/@ryusenkei/conventions/rules.md
```

- Claude Code expands the import when a session starts. Run `pnpm install` first, or the shared rules are not loaded.
- The import resolves inside the working directory, so Claude Code does not ask for approval of external imports.
- Updates arrive as Dependabot PRs. The repository's `cooldown` excludes `@ryusenkei/*`, so new versions are picked up the next day.

## Versioning

- major: a rule is removed or reversed
- minor: a rule is added
- patch: wording only
