# Changelog

## 0.9.0

- `TEST_EXCLUDE` (`.claude/**`, `**/.terraform/**`): patterns to add to Vitest's default `exclude`.
- `check` reports a root Vitest config without them, or a repository that depends on `vitest` without a root config. Add `exclude: [...configDefaults.exclude, ...TEST_EXCLUDE]` to the root `vitest.config.ts`.
- The shared `.gitignore` ignores `.terraform/`. Run `ryusenkei-conventions sync`.
- `rules-ts.md` names `execSync` from `@ryusenkei/scripts` 0.4 (`exec` was renamed) and the Vitest exclude.
- The CLI exits with 2 for an unknown option (it crashed with 1) and takes `--help`.

## 0.8.2 and earlier

See the git history of `packages/conventions`.
