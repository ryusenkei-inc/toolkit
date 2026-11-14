// BlobStore の契約の試験（メモリの実装と各アダプターで同じ試験を回す）。ビルドに含めない
import { describe, expect, it } from 'vitest';
import type { BlobStore } from './index.ts';

const text = async (store: BlobStore, key: string) => {
  const blob = await store.get(key);
  return blob && { contentType: blob.contentType, size: blob.size, text: await new Response(blob.body).text() };
};

/** `make` は空の置き場所を返す */
export function blobStoreContract(name: string, make: () => BlobStore): void {
  describe(`BlobStore の契約: ${name}`, () => {
    it('文字列、バイト列、ストリームを保存し、本文と Content-Type と大きさを返す', async () => {
      const store = make();
      await store.put('a.txt', 'こんにちは', { contentType: 'text/plain' });
      await store.put('b.bin', new Uint8Array([1, 2, 3]));
      await store.put('c.txt', new Response('stream').body!.pipeThrough(new TransformStream()), { contentType: 'text/plain' });
      expect(await text(store, 'a.txt')).toEqual({ contentType: 'text/plain', size: 15, text: 'こんにちは' });
      expect(await text(store, 'b.bin')).toMatchObject({ contentType: null, size: 3 });
      expect(await text(store, 'c.txt')).toEqual({ contentType: 'text/plain', size: 6, text: 'stream' });
    });

    it('ないキーは null と false、上書きは後の値', async () => {
      const store = make();
      expect(await store.get('none')).toBeNull();
      expect(await store.exists('none')).toBe(false);
      await store.put('k', 'one');
      await store.put('k', 'two');
      expect(await store.exists('k')).toBe(true);
      expect((await text(store, 'k'))?.text).toBe('two');
    });

    it('1つと複数のキーを削除し、ないキーの削除も成功', async () => {
      const store = make();
      await Promise.all(['a', 'b', 'c'].map((k) => store.put(k, k)));
      await store.delete('a');
      await store.delete(['b', 'missing']);
      await store.delete([]);
      expect(await Promise.all(['a', 'b', 'c'].map((k) => store.exists(k)))).toEqual([false, false, true]);
    });
  });
}
