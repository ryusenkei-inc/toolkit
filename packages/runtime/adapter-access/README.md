# @ryusenkei/adapter-access

Authenticates requests behind Cloudflare Access, for example a product's admin pages. It verifies the Access JWT with Web Crypto, so it runs on Workers, Vercel, and Node without dependencies.

## Install

```sh
pnpm add @ryusenkei/adapter-access
```

## Usage

```ts
import { accessAuthenticator } from '@ryusenkei/adapter-access';

const auth = accessAuthenticator({ team: env.ACCESS_TEAM, aud: env.ACCESS_AUD });
const user = await auth.authenticate(request);
if (!user.ok) return new Response(null, { status: 401 });
```

- `team`: the Cloudflare One team name (`<team>.cloudflareaccess.com`)
- `aud`: the Application Audience (AUD) tag of the Access application

The result is an `Identity`:

| `kind` | When | `subject` | `email` |
| --- | --- | --- | --- |
| `user` | A person signed in | the `sub` claim | lowercased |
| `service` | An Access service token (machine to machine) | `service:<client id>` | `undefined` |

`groups` is filled only when the JWT carries a `groups` claim.

## What is verified

The token comes from the `Cf-Access-Jwt-Assertion` header. Anything else gives `unauthenticated`:

- The signature is RS256 and matches a key from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with the same `kid`
- `aud` contains the configured AUD tag, and `iss` is `https://<team>.cloudflareaccess.com`
- `exp` has not passed and `nbf` has (60 seconds of clock skew allowed)
- A user token has `sub` and an email, and `email_verified` is not `false`

## Keys and failures

- The key list is cached for an hour. A token with an unknown `kid` refetches it, at most once every 30 seconds, since Access rotates keys every six weeks and junk tokens must not trigger a fetch each time.
- Imported keys are cached per `kid`.
- A missing `team` or `aud` throws `ConfigError`.
- A key-list fetch that fails, times out (5 seconds by default, `timeoutMs`), or can't be read throws `TransientError`.

## License

MIT
