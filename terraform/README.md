# Terraform modules

Small modules for putting a product on Cloudflare: DNS records, a Turnstile widget, an Access application, a www redirect for a product with its own domain, and the Search Console verification record. They need Terraform 1.10 or later and the `cloudflare/cloudflare` provider 5.28 or later (5.x).

## Use

Reference a module by Git with a tag, so updates are deliberate:

```hcl
module "turnstile" {
  source     = "git::https://github.com/ryusenkei-inc/toolkit.git//terraform/modules/turnstile-widget?ref=terraform-v0.1.0"
  account_id = var.account_id
  name       = "example contact"
  domains    = ["example.ryusenkei.co.jp"]
}
```

Tags for the modules are `terraform-v<version>`. They don't contain `@`, so the npm publish workflow ignores them.

| Module | Creates | Outputs |
| --- | --- | --- |
| `dns-records` | DNS records from a list. Each key is the type, name, and a hash of the content, so several records can share a name and type and reordering never recreates them. Changing a record's content recreates that record | `record_ids` |
| `turnstile-widget` | A Turnstile widget for the listed hostnames (`managed` by default) | `sitekey`, `secret` (sensitive) |
| `access-app` | An Access application that admits the listed emails with a one-time code, plus bypass applications for paths such as `/healthz` | `aud` (for `@ryusenkei/adapter-access`), `application_id` |
| `www-redirect` | `www` → apex with a 301, keeping the path and query. With `strip_trailing_slash = true`, also `/path/` → `/path` with a 301 (`/` stays; `trailing_slash_exclude` lists path prefixes to leave alone), and `www` drops the slash in the same hop. `extra_rules` adds your own redirects to the same ruleset, since the phase allows one ruleset per zone. Without these arguments, the plan is the same as in `terraform-v0.1.0` | — |
| `search-console-verification` | The `google-site-verification=...` TXT records for a Search Console Domain property (`tokens`, one per verifying account; the prefix is optional) | `record_ids` |

## How responsibilities are split

- **Worker custom domains and routes:** wrangler (`routes: [{ pattern, custom_domain: true }]`), not Terraform. Terraform would have to wait for the Worker to exist, and keeping them in wrangler keeps the Worker's config in one place.
- **Shared zone settings** (`always_use_https`, Email Sending, DMARC on the company zone): set once in the company's zone stack. A product under `<code>.<company domain>` must not change them.
- **`www-redirect`:** only for a product's own zone. Its ruleset phase allows one ruleset per zone, so it would collide on a shared zone.
- **Turnstile secret:** pass `secret` from the output straight into the Worker's secrets during deploy instead of copying it into `.env`.
- **State:** use a partial backend (`backend "s3" {}`) and let `node scripts/env.ts tf` from `@ryusenkei/scripts` fill in the bucket, key, and R2 credentials. It also turns on state locking.

## Search Console

1. Get the verification value from Search Console (Domain property) or with `npx ryusenkei-search-console token example.com` from `@ryusenkei/scripts`.
2. Apply `search-console-verification` with that value.
3. Run `npx ryusenkei-search-console verify example.com` to verify and add `sc-domain:example.com`, then `npx ryusenkei-search-console submit sc-domain:example.com https://example.com/sitemap.xml`.

The [scripts README](../packages/scripts/README.md#search-console) covers the credentials.
