# @ryusenkei/adapter-access

An [`Authenticator`](../auth) implementation with Cloudflare Access. It verifies the Access JWT with Web Crypto, so it runs on Workers, Vercel, and Node without dependencies.

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

## What is verified

The token comes from the `Cf-Access-Jwt-Assertion` header. It is accepted only when all of these hold; otherwise the result is `unauthenticated`:

- The signature is RS256 and matches a key from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with the same `kid`
- `aud` contains the configured AUD tag
- `iss` is `https://<team>.cloudflareaccess.com`
- `exp` has not passed and `nbf` has (60 seconds of clock skew allowed)
- `sub` is present

Other behavior:

- The key list is cached for an hour and fetched again when a token has an unknown `kid`, since Access rotates keys every six weeks
- The identity is `{ subject: sub, email, groups }`. `groups` is filled only when the JWT carries a `groups` claim
- A missing `team` or `aud` throws `ConfigError`
- A failure to fetch the key list throws `TransientError`

## License

MIT
