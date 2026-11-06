import { describe, expect, it } from 'vitest';
import type { BlobStore } from './index.ts';

/**
 * 実装が守る契約の試験（Vitest）
 * @param make 空の状態の実装を返す（実際の保存先なら試験ごとに専用の場所）
 */
export function blobStoreContract(name: string, make: () => BlobStore | Promise<BlobStore>): void {
  describe(`${name}: BlobStore の契約`, () => {
    it('保存した内容と Content-Type を取得できる', async () => {
      const store = await make();
      await store.put('a.txt', 'こんにちは', { contentType: 'text/plain' });
      const got = await store.get('a.txt');
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      expect(got.value.contentType).toBe('text/plain');
      expect(got.value.size).toBe(new TextEncoder().encode('こんにちは').byteLength);
      expect(await got.value.text()).toBe('こんにちは');
    });

    it('バイト列・ストリームも保存できる', async () => {
      const store = await make();
      await store.put('b.bin', new Uint8Array([1, 2, 3]));
      await store.put('c.bin', new Response(new Uint8Array([4, 5])).body!);
      const b = await store.get('b.bin');
      const c = await store.get('c.bin');
      expect(b.ok && [...new Uint8Array(await b.value.arrayBuffer())]).toEqual([1, 2, 3]);
      expect(c.ok && [...new Uint8Array(await c.value.arrayBuffer())]).toEqual([4, 5]);
    });

    it('ないキーは not_found、削除の後も not_found', async () => {
      const store = await make();
      expect(await store.get('none')).toEqual({ ok: false, error: 'not_found' });
      await store.put('d', 'x');
      await store.delete('d');
      await store.delete('d');
      expect(await store.get('d')).toEqual({ ok: false, error: 'not_found' });
    });

    it('prefix で始まるキーを辞書順に列挙', async () => {
      const store = await make();
      for (const key of ['img/b', 'img/a', 'doc/a']) await store.put(key, 'x');
      expect(await store.list('img/')).toEqual(['img/a', 'img/b']);
    });
  });
}
