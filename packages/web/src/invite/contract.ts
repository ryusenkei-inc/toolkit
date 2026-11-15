// InviteStore の契約の試験（メモリの実装と D1 のアダプターで同じ試験を回す）。ビルドに含めない
import { describe, expect, it } from 'vitest';
import type { InviteRecord, InviteStore } from './index.ts';

const record = (subject: string, expiresAt: number, scope = 'p1'): InviteRecord => ({ scope, subject, createdAt: 1000, expiresAt, usedAt: null });

/** `make` は空の置き場所を返す */
export function inviteStoreContract(name: string, make: () => InviteStore | Promise<InviteStore>): void {
  describe(`InviteStore の契約: ${name}`, () => {
    it('insert した値を find で返し、ないキーは null', async () => {
      const store = await make();
      await store.insert('k1', record('m1', 5000));
      expect(await store.find('k1')).toEqual(record('m1', 5000));
      expect(await store.find('none')).toBeNull();
    });

    it('use は未使用で期限の前なら usedAt を入れて返し、2回目、期限の後、ないキーは null', async () => {
      const store = await make();
      await store.insert('k1', record('m1', 5000));
      await store.insert('k2', record('m1', 5000));
      expect(await store.use('k1', 4999)).toEqual({ ...record('m1', 5000), usedAt: 4999 });
      expect(await store.use('k1', 4999)).toBeNull();
      expect(await store.find('k1')).toEqual({ ...record('m1', 5000), usedAt: 4999 });
      expect(await store.use('k2', 5000)).toBeNull();
      expect(await store.use('none', 0)).toBeNull();
    });

    it('同時の use は1つだけが成功する', async () => {
      const store = await make();
      await store.insert('k1', record('m1', 5000));
      const results = await Promise.all(Array.from({ length: 5 }, () => store.use('k1', 2000)));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('revoke は scope と主体の未使用の招待だけを消して数を返す', async () => {
      const store = await make();
      await store.insert('k1', record('m1', 5000));
      await store.insert('k2', record('m1', 5000));
      await store.insert('k3', record('m1', 5000, 'p2'));
      await store.insert('k4', record('m2', 5000));
      await store.use('k2', 2000);
      expect(await store.revoke('p1', 'm1')).toBe(1);
      expect(await store.find('k1')).toBeNull();
      expect(await store.find('k2')).not.toBeNull();
      expect(await store.find('k3')).not.toBeNull();
      expect(await store.find('k4')).not.toBeNull();
    });

    it('deleteExpired は期限が before 以前のものを使用済みも消して数を返す', async () => {
      const store = await make();
      await store.insert('k1', record('m1', 3000));
      await store.insert('k2', record('m1', 4000));
      await store.insert('k3', record('m1', 4001));
      await store.use('k2', 2000);
      expect(await store.deleteExpired(4000)).toBe(2);
      expect(await store.find('k3')).not.toBeNull();
    });
  });
}
