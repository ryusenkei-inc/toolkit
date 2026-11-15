// 1回だけと日ごとの上限の契約の試験（メモリの実装と D1 のアダプターで同じ試験を回す）。ビルドに含めない
import { describe, expect, it } from 'vitest';
import type { DailyQuota, SubmissionOnce } from './server.ts';

/** `make` は空の置き場所を返す */
export function submissionOnceContract(name: string, make: () => SubmissionOnce | Promise<SubmissionOnce>): void {
  describe(`SubmissionOnce の契約: ${name}`, () => {
    it('最初の claim だけが成功し、has が true になる', async () => {
      const once = await make();
      expect(await once.has('survey', 'u1')).toBe(false);
      expect(await once.claim('survey', 'u1')).toEqual({ ok: true, value: undefined });
      expect(await once.claim('survey', 'u1')).toEqual({ ok: false, error: 'duplicate' });
      expect(await once.has('survey', 'u1')).toBe(true);
    });

    it('scope と subject の組ごとに数える', async () => {
      const once = await make();
      await once.claim('survey', 'u1');
      expect((await once.claim('survey', 'u2')).ok).toBe(true);
      expect((await once.claim('other', 'u1')).ok).toBe(true);
      // 区切りの文字を含む値が、別の組と重ならない
      expect((await once.claim('a:b', 'c')).ok).toBe(true);
      expect((await once.claim('a', 'b:c')).ok).toBe(true);
    });

    it('同時の claim は1つだけが成功する', async () => {
      const once = await make();
      const results = await Promise.all(Array.from({ length: 5 }, () => once.claim('survey', 'u1')));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it('release の後はもう一度 claim でき、ない組の release も成功する', async () => {
      const once = await make();
      await once.claim('survey', 'u1');
      await once.release('survey', 'u1');
      await once.release('survey', 'none');
      expect(await once.has('survey', 'u1')).toBe(false);
      expect((await once.claim('survey', 'u1')).ok).toBe(true);
    });
  });
}

/** `make(now)` は、時間帯 `Asia/Tokyo` で `now` を時計にする空の置き場所を返す */
export function dailyQuotaContract(name: string, make: (now: () => number) => DailyQuota | Promise<DailyQuota>): void {
  describe(`DailyQuota の契約: ${name}`, () => {
    it('上限までは成功し、超えたら quota_exceeded。キーごとに数える', async () => {
      const quota = await make(() => Date.parse('2026-11-15T03:00:00Z'));
      expect(await quota.take('a', 2)).toEqual({ ok: true, value: undefined });
      expect((await quota.take('a', 2)).ok).toBe(true);
      expect(await quota.take('a', 2)).toEqual({ ok: false, error: 'quota_exceeded' });
      expect((await quota.take('b', 2)).ok).toBe(true);
    });

    it('上限が0なら数えずに quota_exceeded', async () => {
      const quota = await make(() => Date.parse('2026-11-15T03:00:00Z'));
      expect(await quota.take('a', 0)).toEqual({ ok: false, error: 'quota_exceeded' });
      expect((await quota.take('a', 1)).ok).toBe(true);
    });

    it('日の区切りは時間帯で決まる（UTC の 15:00 が東京の 0:00）', async () => {
      let at = Date.parse('2026-11-15T14:59:59Z');
      const quota = await make(() => at);
      expect((await quota.take('a', 1)).ok).toBe(true);
      expect((await quota.take('a', 1)).ok).toBe(false);
      at = Date.parse('2026-11-15T15:00:00Z');
      expect((await quota.take('a', 1)).ok).toBe(true);
    });

    it('同時の take は上限の数だけが成功する', async () => {
      const quota = await make(() => Date.parse('2026-11-15T03:00:00Z'));
      const results = await Promise.all(Array.from({ length: 6 }, () => quota.take('a', 3)));
      expect(results.filter((r) => r.ok)).toHaveLength(3);
    });
  });
}
