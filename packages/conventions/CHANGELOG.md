# Changelog

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
