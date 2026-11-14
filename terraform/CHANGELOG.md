# Changelog

Terraform modules, tagged `terraform-v<version>`.

## terraform-v0.3.0

None of these changes alter the plan of an existing configuration.

- `dns-records`: an optional `key` per record. With a `key`, changing the content updates the record in place instead of recreating it. To give an existing record a `key`, add a `moved` block from its current key (`"<type>:<name>:<first 8 hex digits of sha1(content)>"`, shown in `record_ids`) to the new one.
- `www-redirect`: the `ruleset_id` output, and a check that each `trailing_slash_exclude` entry starts with `/`.
- `access-app`: the `aud` output's description points to `@ryusenkei/web/access` (the deprecated `@ryusenkei/adapter-access` was named before).

## terraform-v0.2.0

- `www-redirect`: `strip_trailing_slash`, `trailing_slash_exclude`, `extra_rules`, and `ruleset_name`.
- `search-console-verification`.

## terraform-v0.1.0

- `dns-records`, `turnstile-widget`, `access-app`, `www-redirect`.
