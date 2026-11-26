# Changelog

## 0.3.0

- `overrides` in the configuration: `{ files, rules }` entries that change rules for the files matching the globs. Later entries win. See [Overrides](README.md#overrides).
- `format/period-required`: a Japanese line must end with `。`. It is off by default, so nothing changes without configuration. See [Requiring periods](README.md#requiring-periods).
- `markdownTexts` marks headings and table cells with `block`. `textIssues` and `commentIssues` take `enabled` for rules that are off by default.

## 0.2.0 and earlier

See the git history of `packages/prose-lint`.
