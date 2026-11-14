# toolkit

Shared packages for RYUSENKEI repositories, published to npm under `@ryusenkei`.

## Packages

| Package | Description |
| --- | --- |
| [`@ryusenkei/prose-lint`](packages/prose-lint) | Checker for mechanical errors in Japanese technical writing (comments, Markdown, commit messages) |
| [`@ryusenkei/conventions`](packages/conventions) | Shared conventions: Claude Code rules and hooks, and sync of the shared files |
| [`@ryusenkei/scripts`](packages/scripts) | Shared scripts: child processes, the `.env` CLI, and GitHub repository settings |
| [`@ryusenkei/core`](packages/core) | Runtime-independent base: `Result`, infrastructure errors and their classification, structured logging, tracing, error reporting |
| [`@ryusenkei/web`](packages/web) | Runtime libraries for web products on Cloudflare Workers and Vercel: HTTP failure responses, forms, legal documents, mail, webhook signing, analytics, and the Cloudflare, Turnstile, and Access integrations (subpath exports) |
| [`@ryusenkei/company`](packages/company) | RYUSENKEI's company values (operator, legal and contact defaults) to pass to `@ryusenkei/web` |

`@ryusenkei/core` 0.3.0 and `@ryusenkei/web` replace `core` 0.2.x and the deprecated `form`, `legal`, `mail`, `adapter-cloudflare`, `adapter-turnstile`, `adapter-access`, `rate-limit`, `bot-check`, `blob`, and `auth` packages.

## Development

```sh
pnpm install   # also enables the commit-msg hook
pnpm lint      # type check and prose-lint on this repository
pnpm test      # unit tests
pnpm build     # build dist/ for each package
```

## Terraform modules

`terraform/modules/` has small modules for DNS records, Turnstile widgets, Access applications, and www redirects. They are referenced by Git with `terraform-v<version>` tags; see the [Terraform README](terraform/README.md).

## Reusable workflows

`.github/workflows/reusable-ci.yaml` and `reusable-pr-title.yaml` are the CI of the other repositories. The [conventions README](packages/conventions/README.md#ci) shows how to call them.

## Publishing

Publishing runs on GitHub Actions when a tag `<package>@<version>` is pushed. It uses npm trusted publishing with provenance, so no npm token is stored.

1. Bump `version` in `packages/<package>/package.json` and commit it as `chore(release): <package>@<version>`.
2. Tag and push:

   ```sh
   git tag <package>@<version>
   git push origin <package>@<version>
   ```

The workflow runs `pnpm lint` and `pnpm test`, verifies that the tag matches `version`, and publishes the package.

`pnpm lint` also checks that `packages/core` and `packages/web` contain no company-specific values (IDs, email addresses, URLs outside an allowlist, the company name); those belong in `packages/company`.

A new package can't use trusted publishing until it exists on npm. Publish its first version once by hand (`pnpm publish` from the package directory, signed in to npm), then add the trusted publisher on npmjs.com (`ryusenkei-inc` / `toolkit` / `publish.yaml`, with `npm publish` allowed).

## License

MIT
