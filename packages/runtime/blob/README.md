# @ryusenkei/blob

The port for storing files by key (R2, local disk): the `BlobStore` interface, its error codes, an in-memory implementation, and a contract test. No runtime dependencies besides `@ryusenkei/core`. Implementations for a provider live in the `adapter-*` packages.

## Install

```sh
pnpm add @ryusenkei/blob
```

## Interface

`put(key, body, { contentType? })`, `get(key)`, `delete(key)` (deleting a missing key succeeds), `list(prefix?)` (sorted).

- Business failures come back as `Result` with these codes: `not_found`
- Infrastructure failures are thrown as `TransientError` (may succeed on retry) or `ConfigError` (a missing setting), from `@ryusenkei/core`

```ts
const file = await services.blob.get(key);
if (!file.ok) return new Response(null, { status: 404 });
return new Response(file.value.body, { headers: { 'content-type': file.value.contentType ?? 'application/octet-stream' } });
```

## Testing

| Entry | Contents |
| --- | --- |
| `@ryusenkei/blob/testing` | `memoryBlobStore()`. For tests and local development; keep it out of production code |
| `@ryusenkei/blob/contract` | `blobStoreContract(name, make)`: the behavior every implementation must have, as Vitest tests. Run it against each adapter |

The contract imports `vitest`, so it is a separate entry from the in-memory implementation, which local development can use without Vitest.

## License

MIT
