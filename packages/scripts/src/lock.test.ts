import { describe, expect, it } from 'vitest';
import { acquireDeployLock, DEFAULT_STALE_MS, DeployLockHeldError, lockStateOf, withDeployLock, type LockStore, type StoredLock } from './lock.ts';
import { gcsLockStore, r2LockStore, signS3Request } from './lock-stores.ts';

/** メモリのロックの置き場所（版は書くたびに増える数） */
function memoryStore(initial?: string): LockStore & { stored: StoredLock | null; writes: number } {
  let n = 0;
  const store = {
    name: 'memory://deploy.lock',
    stored: initial === undefined ? null : ({ content: initial, version: String(++n) } as StoredLock | null),
    writes: 0,
    async read() {
      return store.stored;
    },
    async write(content: string, ifVersion: string | null) {
      if ((store.stored?.version ?? null) !== ifVersion) return null;
      store.writes++;
      store.stored = { content, version: String(++n) };
      return store.stored.version;
    },
    async remove() {
      store.stored = null;
    },
    removeRequest: () => ({ url: 'memory://deploy.lock', method: 'DELETE', headers: {} }),
  };
  return store;
}

describe('lockStateOf', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const lock = (at: string) => JSON.stringify({ owner: 'host:1', at });

  it('なし・空・壊れた内容は空き、期限内は実行中、古いロックは空き（持ち主を返す）', () => {
    expect(lockStateOf(null, now)).toEqual({ kind: 'free' });
    expect(lockStateOf('  ', now)).toEqual({ kind: 'free' });
    expect(lockStateOf('{', now)).toEqual({ kind: 'free' });
    expect(lockStateOf(JSON.stringify({ owner: 'x' }), now)).toEqual({ kind: 'free' });
    expect(lockStateOf(lock('2026-11-15T11:50:00Z'), now)).toEqual({ kind: 'held', lock: { owner: 'host:1', at: '2026-11-15T11:50:00Z' } });
    const old = new Date(now - DEFAULT_STALE_MS - 1).toISOString();
    expect(lockStateOf(lock(old), now)).toEqual({ kind: 'free', stale: { owner: 'host:1', at: old } });
    expect(lockStateOf(lock('2026-11-15T11:50:00Z'), now, 5 * 60_000)).toMatchObject({ kind: 'free' });
  });
});

describe('acquireDeployLock', () => {
  const now = () => Date.parse('2026-11-15T12:00:00Z');

  it('空きなら取り、release で消す。実行中なら held', async () => {
    const store = memoryStore();
    const first = await acquireDeployLock(store, { owner: 'a', now, releaseOnExit: false });
    expect(first).toMatchObject({ kind: 'acquired', lock: { owner: 'a', at: '2026-11-15T12:00:00.000Z' } });
    expect(await acquireDeployLock(store, { owner: 'b', now, releaseOnExit: false })).toEqual({ kind: 'held', lock: { owner: 'a', at: '2026-11-15T12:00:00.000Z' } });
    if (first.kind === 'acquired') await first.lock.release();
    expect(store.stored).toBeNull();
  });

  it('古いロックは上書きし、ほかに上書きされたロックは release で消さない', async () => {
    const store = memoryStore(JSON.stringify({ owner: 'old', at: '2026-11-15T10:00:00Z' }));
    const got = await acquireDeployLock(store, { owner: 'a', now, releaseOnExit: false });
    expect(got).toMatchObject({ kind: 'acquired', lock: { stale: { owner: 'old' } } });
    store.stored = { content: JSON.stringify({ owner: 'other', at: '2026-11-15T12:00:00Z' }), version: '99' };
    if (got.kind === 'acquired') await got.lock.release();
    expect(store.stored?.version).toBe('99');
  });

  it('同時に書かれて条件が合わなければ読み直し、相手のロックを held で返す', async () => {
    const store = memoryStore();
    const write = store.write;
    let raced = false;
    const racing: LockStore = {
      ...store,
      read: () => store.read(),
      async write(content, ifVersion) {
        if (!raced) {
          raced = true;
          await write(JSON.stringify({ owner: 'rival', at: '2026-11-15T12:00:00Z' }), null);
        }
        return write(content, ifVersion);
      },
    };
    expect(await acquireDeployLock(racing, { owner: 'a', now, releaseOnExit: false })).toEqual({ kind: 'held', lock: { owner: 'rival', at: '2026-11-15T12:00:00Z' } });
  });

  it('withDeployLock は終わったら消し、実行中なら DeployLockHeldError', async () => {
    const store = memoryStore();
    expect(await withDeployLock(store, (lock) => lock.owner, { owner: 'a', now, releaseOnExit: false })).toBe('a');
    expect(store.stored).toBeNull();
    await expect(withDeployLock(store, () => Promise.reject(new Error('x')), { owner: 'a', now, releaseOnExit: false })).rejects.toThrow('x');
    expect(store.stored).toBeNull();
    store.stored = { content: JSON.stringify({ owner: 'b', at: '2026-11-15T11:59:00Z' }), version: '1' };
    await expect(withDeployLock(store, () => 1, { now, releaseOnExit: false })).rejects.toBeInstanceOf(DeployLockHeldError);
  });
});

describe('signS3Request', () => {
  it('AWS の文書の例（GET Object）と同じ署名', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html の例
    const r = signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      extra: { range: 'bytes=0-9' },
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(r.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

describe('アダプター', () => {
  type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
  const recorder = (reply: (call: Call) => Response) => {
    const calls: Call[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      const call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, ...(init.body !== undefined && { body: String(init.body) }) };
      calls.push(call);
      return reply(call);
    }) as unknown as typeof fetch;
    return { calls, fetcher };
  };

  it('R2: 読み、条件つきで書き、412 は null', async () => {
    const { calls, fetcher } = recorder((c) =>
      c.method === 'GET' ? new Response('{"owner":"a"}', { headers: { etag: '"e1"' } }) : c.method === 'PUT' && c.headers['if-match'] ? new Response(null, { status: 412 }) : new Response(null, { headers: { etag: '"e2"' } }),
    );
    const store = r2LockStore({ accountId: 'acc', bucket: 'state', key: 'site/deploy.lock', credentials: { accessKeyId: 'id', secretAccessKey: 'secret' }, fetch: fetcher });
    expect(store.name).toBe('r2://state/site/deploy.lock');
    expect(await store.read()).toEqual({ content: '{"owner":"a"}', version: '"e1"' });
    expect(calls[0]!.url).toBe('https://acc.r2.cloudflarestorage.com/state/site/deploy.lock');
    expect(calls[0]!.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, /);
    expect(await store.write('{}', null)).toBe('"e2"');
    expect(calls[1]!.headers['if-none-match']).toBe('*');
    expect(calls[1]!.headers.authorization).toContain('SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date');
    expect(await store.write('{}', '"e1"')).toBeNull();
    expect(store.removeRequest()).toMatchObject({ method: 'DELETE', url: 'https://acc.r2.cloudflarestorage.com/state/site/deploy.lock' });
  });

  it('GCS: generation を版にし、作るときは ifGenerationMatch=0', async () => {
    const { calls, fetcher } = recorder((c) =>
      c.method === 'GET' ? new Response(null, { status: 404 }) : c.method === 'POST' ? Response.json({ generation: '17' }) : new Response(null, { status: 204 }),
    );
    const store = gcsLockStore({ bucket: 'state', key: 'deploy.lock', accessToken: () => 'tok', fetch: fetcher });
    expect(await store.read()).toBeNull();
    expect(calls[0]!.url).toBe('https://storage.googleapis.com/storage/v1/b/state/o/deploy.lock?alt=media');
    expect(await store.write('{}', null)).toBe('17');
    expect(calls[1]!.url).toBe('https://storage.googleapis.com/upload/storage/v1/b/state/o?uploadType=media&name=deploy.lock&ifGenerationMatch=0');
    expect(calls[1]!.headers.authorization).toBe('Bearer tok');
    await store.remove();
    expect(store.removeRequest()).toEqual({ url: 'https://storage.googleapis.com/storage/v1/b/state/o/deploy.lock', method: 'DELETE', headers: { authorization: 'Bearer tok' } });
  });
});
