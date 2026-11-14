import { describe, expect, it } from 'vitest';
import { blobStoreContract } from './contract.ts';
import { memoryBlobStore } from './index.ts';

blobStoreContract('memoryBlobStore', memoryBlobStore);

describe('memoryBlobStore', () => {
  it('保存した実体を objects に持ち、取得した本文を書き換えても保存した値は変わらない', async () => {
    const store = memoryBlobStore();
    const bytes = new Uint8Array([1, 2]);
    await store.put('k', bytes);
    bytes[0] = 9;
    expect([...store.objects.get('k')!.bytes]).toEqual([1, 2]);
  });
});
