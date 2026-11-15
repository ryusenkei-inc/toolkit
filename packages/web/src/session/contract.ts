// SessionStore の契約の試験（メモリの実装と D1 のアダプターで同じ試験を回す）。ビルドに含めない
import { describe, expect, it } from 'vitest';
import type { SessionStore, StoredSession } from './index.ts';

const session = (subject: string, expiresAt: number): StoredSession => ({ subject, data: '{"a":1}', createdAt: 1000, refreshedAt: 1000, expiresAt });

/** `make` は空の置き場所を返す */
export function sessionStoreContract(name: string, make: () => SessionStore | Promise<SessionStore>): void {
  describe(`SessionStore の契約: ${name}`, () => {
    it('insert した値を get で返し、ないキーは null', async () => {
      const store = await make();
      await store.insert('k1', session('m1', 5000));
      expect(await store.get('k1')).toEqual(session('m1', 5000));
      expect(await store.get('none')).toBeNull();
    });

    it('update は data と refreshedAt だけを替え、ないキーは false', async () => {
      const store = await make();
      await store.insert('k1', session('m1', 5000));
      expect(await store.update('k1', { data: '{"a":2}', refreshedAt: 2000 })).toBe(true);
      expect(await store.get('k1')).toEqual({ ...session('m1', 5000), data: '{"a":2}', refreshedAt: 2000 });
      expect(await store.update('none', { data: '{}', refreshedAt: 2000 })).toBe(false);
    });

    it('delete の後は null。ないキーの delete も成功する', async () => {
      const store = await make();
      await store.insert('k1', session('m1', 5000));
      await store.delete('k1');
      await store.delete('none');
      expect(await store.get('k1')).toBeNull();
      expect(await store.update('k1', { data: '{}', refreshedAt: 2000 })).toBe(false);
    });

    it('deleteBySubject は主体のセッションだけを消して数を返す', async () => {
      const store = await make();
      await store.insert('k1', session('m1', 5000));
      await store.insert('k2', session('m1', 5000));
      await store.insert('k3', session('m2', 5000));
      expect(await store.deleteBySubject('m1')).toBe(2);
      expect(await store.deleteBySubject('m1')).toBe(0);
      expect(await store.get('k1')).toBeNull();
      expect(await store.get('k3')).not.toBeNull();
    });

    it('deleteExpired は期限が before 以前のものを消して数を返す', async () => {
      const store = await make();
      await store.insert('k1', session('m1', 3000));
      await store.insert('k2', session('m1', 4000));
      await store.insert('k3', session('m1', 4001));
      expect(await store.deleteExpired(4000)).toBe(2);
      expect(await store.get('k3')).not.toBeNull();
    });
  });
}
