# Changelog

## 0.11.0

- `style.md`: the style guide for Japanese technical writing (vocabulary, tone, format, and notation). `rules.md` imports it, so repositories that import `rules.md` need no change.
- Depends on `@ryusenkei/prose-lint` 0.4. The PR title check in the hook now rejects a space between Japanese and alphanumeric words, as commit messages do.

| Before | After |
| --- | --- |
| Vocabulary, tone, and tables under 書き方 in `rules.md` | Moved to `style.md`. 体言止め is allowed in list items and table cells |
| The rule on errors, logs, and standard output under 書き方 | Moved to コード in `rules.md`, unchanged |
| PR titles with a space between Japanese and alphanumeric words (`OG 画像`) | No space (`OG画像`) |

## 0.10.3

- Depends on `@ryusenkei/prose-lint` 0.3. The PR title check in the hook reads the repository's `prose-lint.json` with this copy, and 0.2 rejects the new `overrides` key.

## 0.10.2

- `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` and the Dependabot `cooldown` and own-package group also cover `@tunasand/*`, the SDK of the product. `check` asks to update `minimumReleaseAgeExclude` until `sync` is run.

## 0.10.1

- `runAffectedCheck` failed every step on Windows when `npm_execpath` pointed at a standalone `pnpm.exe` (it was started with `node`). It now starts `.js`, `.cjs`, and `.mjs` with `node`, and `.exe` directly.

## 0.10.0

- `runAffectedCheck`: the pre-push `pnpm check` from `scripts/check.ts`. It type checks the changed packages and their dependents and runs the tests that import a changed file, against the nearest of `origin/main` and `origin/dev/*`; `--all` checks everything. The type check and the tests run one after the other to keep the peak memory low. See [Pre-push check](README.md#pre-push-check).
- The `check` script that `check` asks for is now `node scripts/check.ts` with `runAffectedCheck`. Repositories with their own `scripts/check.ts` (zrgn, pcpalette.com) can replace the shared part with it.
- `pnpm check` records each passing commit in the common git directory, and the hook lets `gh pr merge` through without passing checks when the PR's head passed `pnpm check --base origin/<base>` (or `--all`). A PR doesn't get stuck when CI doesn't run.
- `reusable-ci.yaml` skips draft PRs, caches the pnpm store, and takes `affected: true` to run `pnpm check --base origin/<base>` instead of the full check. Add `ready_for_review` to the caller's `types` so a PR is checked when it's marked ready.
- `rules.md`: open PRs to `main` as drafts and mark them ready before merging; run `pnpm check --all` locally before deploying.

## 0.9.0

- `TEST_EXCLUDE` (`.claude/**`, `**/.terraform/**`): patterns to add to Vitest's default `exclude`.
- `check` reports a root Vitest config without them, or a repository that depends on `vitest` without a root config. Add `exclude: [...configDefaults.exclude, ...TEST_EXCLUDE]` to the root `vitest.config.ts`.
- The shared `.gitignore` ignores `.terraform/`. Run `ryusenkei-conventions sync`.
- `rules-ts.md` names `execSync` from `@ryusenkei/scripts` 0.4 (`exec` was renamed) and the Vitest exclude.
- The CLI exits with 2 for an unknown option (it crashed with 1) and takes `--help`.

## 0.8.2 and earlier

See the git history of `packages/conventions`.
