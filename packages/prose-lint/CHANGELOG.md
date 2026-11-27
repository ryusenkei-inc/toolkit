# Changelog

## 0.4.0

The period and spacing rules now follow the style guide in `@ryusenkei/conventions`: no space between Japanese and alphanumeric words in documents, and `。` at the end of sentences in paragraphs. Code comments keep the old rules. Run `prose-lint --fix` after updating, and check the diff.

| Before | After |
| --- | --- |
| `format/spacing` puts a space around words with letters everywhere | The same in code comments. No space in Markdown and commit messages (including PR titles) |
| `format/period`: no `。` at the end of any line | `。` at the end of Markdown paragraphs and block quotes. List items aren't checked. No `。` in code comments, commit messages, headings, and table cells |
| `format/period-required` (off by default) | Removed. Delete it from `rules` and `overrides`; an unknown rule ID is an error |
| `format/notation` flags `版` and `等` | Removed. Word choice is in the style guide. Add them to `vocabulary` to keep the check |
| `--fix` fixes code comments only | Also removes the spaces and adds the periods in Markdown |
| `markdownTexts` returns `block` (`heading` or `cell`) | Returns `kind`: `paragraph`, `item`, `heading`, or `cell` |
| `textIssues` and `commentIssues` take `enabled` | Removed. They take `kind` instead (default `comment`) |

`removeSpacing` and `fixMarkdown` are exported.

## 0.3.0

- `overrides` in the configuration: `{ files, rules }` entries that change rules for the files matching the globs. Later entries win. See [Overrides](README.md#overrides).
- `format/period-required`: a Japanese line must end with `。`. It is off by default, so nothing changes without configuration. See [Requiring periods](README.md#requiring-periods).
- `markdownTexts` marks headings and table cells with `block`. `textIssues` and `commentIssues` take `enabled` for rules that are off by default.

## 0.2.0 and earlier

See the git history of `packages/prose-lint`.
