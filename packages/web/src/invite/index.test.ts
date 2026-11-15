import { describe, expect, it } from 'vitest';
import { inviteStoreContract } from './contract.ts';
import { invites, memoryInviteStore, type InvitesOptions } from './index.ts';

inviteStoreContract('memoryInviteStore', memoryInviteStore);

const DAY = 24 * 60 * 60 * 1000;

const setup = (overrides: Partial<InvitesOptions> = {}) => {
  let at = Date.parse('2026-11-15T00:00:00Z');
  const store = memoryInviteStore();
  return { store, invite: invites({ store, now: () => at, ...overrides }), start: at, advance: (ms: number) => void (at += ms) };
};

describe('invites', () => {
  it('発行したコードを1回だけ使える。置き場所にコードは残らない', async () => {
    const { store, invite, start } = setup();
    const { code, expiresAt } = await invite.issue('p1', 'm1');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(start + 7 * DAY);
    expect(JSON.stringify([...store.records])).not.toContain(code);
    expect(await invite.check('p1', code)).toEqual({ ok: true, value: { scope: 'p1', subject: 'm1', expiresAt } });
    expect(await invite.redeem('p1', code)).toEqual({ ok: true, value: { scope: 'p1', subject: 'm1', expiresAt } });
    expect(await invite.redeem('p1', code)).toEqual({ ok: false, error: 'used' });
    expect(await invite.check('p1', code)).toEqual({ ok: false, error: 'used' });
  });

  it('期限を過ぎると expired。発行ごとに期間を変えられる', async () => {
    const { invite, advance } = setup({ ttlMs: DAY });
    const short = await invite.issue('p1', 'm1', { ttlMs: 1000 });
    const normal = await invite.issue('p1', 'm2');
    advance(1000);
    expect(await invite.redeem('p1', short.code)).toEqual({ ok: false, error: 'expired' });
    expect((await invite.check('p1', normal.code)).ok).toBe(true);
    advance(DAY);
    expect(await invite.check('p1', normal.code)).toEqual({ ok: false, error: 'expired' });
  });

  it('別の scope、知らないコード、形の誤りは not_found', async () => {
    const { invite } = setup();
    const { code } = await invite.issue('p1', 'm1');
    expect(await invite.redeem('p2', code)).toEqual({ ok: false, error: 'not_found' });
    expect(await invite.redeem('p1', 'A'.repeat(43))).toEqual({ ok: false, error: 'not_found' });
    expect(await invite.redeem('p1', 'short')).toEqual({ ok: false, error: 'not_found' });
    expect(await invite.check('p1', `${code}!`)).toEqual({ ok: false, error: 'not_found' });
    expect((await invite.redeem('p1', code)).ok).toBe(true);
  });

  it('同時の redeem は1つだけが成功する', async () => {
    const { invite } = setup();
    const { code } = await invite.issue('p1', 'm1');
    const results = await Promise.all(Array.from({ length: 5 }, () => invite.redeem('p1', code)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error)).toEqual(['used', 'used', 'used', 'used']);
  });

  it('revoke は未使用の招待を取り消し、purge は期限の過ぎた招待を消す', async () => {
    const { store, invite, advance } = setup({ ttlMs: 1000 });
    const a = await invite.issue('p1', 'm1');
    await invite.issue('p1', 'm2');
    expect(await invite.revoke('p1', 'm1')).toBe(1);
    expect(await invite.check('p1', a.code)).toEqual({ ok: false, error: 'not_found' });
    advance(1000);
    expect(await invite.purge()).toBe(1);
    expect(store.records.size).toBe(0);
  });

  it('bytes でコードの長さを変えられ、範囲の外と期間の誤りは UsageError', async () => {
    const { invite } = setup({ bytes: 16 });
    const { code } = await invite.issue('p1', 'm1');
    expect(code).toHaveLength(22);
    expect((await invite.redeem('p1', code)).ok).toBe(true);
    const store = memoryInviteStore();
    expect(() => invites({ store, bytes: 8 })).toThrow(expect.objectContaining({ name: 'UsageError', code: 'invalid_bytes' }));
    expect(() => invites({ store, ttlMs: 0 })).toThrow(expect.objectContaining({ code: 'invalid_ttl' }));
    await expect(invites({ store }).issue('p1', 'm1', { ttlMs: -1 })).rejects.toMatchObject({ code: 'invalid_ttl' });
  });
});
