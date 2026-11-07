# toolkit

Shared packages for RYUSENKEI repositories, published to npm under `@ryusenkei`.

## Packages

| Package | Description |
| --- | --- |
| [`@ryusenkei/prose-lint`](packages/prose-lint) | Checker for mechanical errors in Japanese technical writing (comments, Markdown, commit messages) |
| [`@ryusenkei/conventions`](packages/conventions) | Shared conventions: Claude Code rules and hooks, and sync of the shared files |
| [`@ryusenkei/scripts`](packages/scripts) | Shared scripts: child processes, the `.env` CLI, and GitHub repository settings |

Runtime libraries for apps on Cloudflare Workers and Vercel live in `packages/runtime/` and are released together with one version:

| Package | Description |
| --- | --- |
| [`@ryusenkei/core`](packages/runtime/core) | `Result`, typed infrastructure errors and their responses, structured logging |
| [`@ryusenkei/form`](packages/runtime/form) | Forms (contact, feedback): field declarations, sanitizing, validation, and a standard `Request => Response` handler with delivery by email or webhook |
| [`@ryusenkei/legal`](packages/runtime/legal) | Privacy policy, 特定商取引法 notice, and operator details built from a declaration, as structured data |
| [`@ryusenkei/mail`](packages/runtime/mail) | The shape of an email, the `Mailer` interface, and the checks every sender runs |
| [`@ryusenkei/adapter-cloudflare`](packages/runtime/adapter-cloudflare) | Workers bindings: Rate Limiting and Email Service |
| [`@ryusenkei/adapter-turnstile`](packages/runtime/adapter-turnstile) | Turnstile's server-side check |
| [`@ryusenkei/adapter-access`](packages/runtime/adapter-access) | Cloudflare Access JWT verification, for admin pages and service tokens |

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

The runtime libraries share one version. Bump `version` in every `packages/runtime/*/package.json` and push a `runtime@<version>` tag; the workflow checks that all of them match and publishes each one that is not on npm yet. `pnpm lint` checks that the versions match and that the sources contain no company-specific values (IDs, email addresses, URLs outside an allowlist, the company name).

A new package can't use trusted publishing until it exists on npm. Publish its first version once by hand (`pnpm publish` from the package directory, signed in to npm), then add the trusted publisher on npmjs.com (`ryusenkei-inc` / `toolkit` / `publish.yaml`, with `npm publish` allowed).

## License

MIT
