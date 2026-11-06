# toolkit

Shared packages for RYUSENKEI repositories, published to npm under `@ryusenkei`.

## Packages

| Package | Description |
| --- | --- |
| [`@ryusenkei/prose-lint`](packages/prose-lint) | Checker for mechanical errors in Japanese technical writing (comments, Markdown, commit messages) |
| [`@ryusenkei/conventions`](packages/conventions) | Shared conventions: Claude Code rules and hooks, and sync of the shared files |
| [`@ryusenkei/scripts`](packages/scripts) | Shared scripts: child processes, the `.env` CLI, and GitHub repository settings |

## Development

```sh
pnpm install   # also enables the commit-msg hook
pnpm lint      # type check and prose-lint on this repository
pnpm test      # unit tests
pnpm build     # build dist/ for each package
```

## Publishing

Publishing runs on GitHub Actions when a tag `<package>@<version>` is pushed. It uses npm trusted publishing with provenance, so no npm token is stored.

1. Bump `version` in `packages/<package>/package.json` and commit it as `chore(release): <package>@<version>`.
2. Tag and push:

   ```sh
   git tag <package>@<version>
   git push origin <package>@<version>
   ```

The workflow runs `pnpm lint` and `pnpm test`, verifies that the tag matches `version`, and publishes the package.

## License

MIT
