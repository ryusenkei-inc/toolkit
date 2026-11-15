import { describe, expect, it } from 'vitest';
import { sessionStoreContract } from './contract.ts';
import { cookieValue, memorySessionStore, siteSessions, type SiteSessionsOptions } from './index.ts';

sessionStoreContract('memorySessionStore', memorySessionStore);

type Rights = { member: string; courses: string[] };

const setup = (overrides: Partial<SiteSessionsOptions> = {}) => {
  let at = Date.parse('2026-11-15T00:00:00Z');
  const store = memorySessionStore();
  const sessions = siteSessions<Rights>({ store, secret: 'secret-1', now: () => at, ...overrides });
  return { store, sessions, advance: (ms: number) => void (at += ms) };
};

// Set-Cookie の値から、要求の Cookie を作る
const requestWith = (setCookie: string) => new Request('https://example.com/', { headers: { cookie: `other=1; ${setCookie.split(';')[0]}` } });

describe('siteSessions', () => {
  it('issue の Cookie で read でき、照合の結果を返す。置き場所には ID のハッシュだけ', async () => {
    const { store, sessions } = setup();
    const { session, setCookie } = await sessions.issue('m1', { member: 'm1', courses: ['c1'] });
    expect(setCookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
    const id = setCookie.split(';')[0]!.split('=')[1]!.split('.')[0]!;
    expect([...store.sessions.keys()]).toEqual([session.id]);
    expect(session.id).not.toContain(id);
    const read = await sessions.read(requestWith(setCookie));
    expect(read).toEqual({ ok: true, value: { ...session, stale: false } });
    expect(read.ok && read.value.data).toEqual({ member: 'm1', courses: ['c1'] });
  });

  it('Cookie がなければ no_session、署名の誤りと知らない ID は invalid_session', async () => {
    const { sessions } = setup();
    const { setCookie } = await sessions.issue('m1', { member: 'm1', courses: [] });
    expect(await sessions.read(new Request('https://example.com/'))).toEqual({ ok: false, error: 'no_session' });
    const [value] = setCookie.split(';');
    const id = value!.split('=')[1]!.split('.')[0]!;
    const forged = `__Host-session=${id}.AAAA`;
    expect(await sessions.read(requestWith(forged))).toEqual({ ok: false, error: 'invalid_session' });
    expect(await sessions.read(requestWith('__Host-session=garbage'))).toEqual({ ok: false, error: 'invalid_session' });
    // 別の鍵で署名した、形の正しい Cookie
    const other = siteSessions<Rights>({ store: memorySessionStore(), secret: 'secret-2' });
    expect(await sessions.read(requestWith((await other.issue('m1', { member: 'm1', courses: [] })).setCookie))).toEqual({ ok: false, error: 'invalid_session' });
  });

  it('refreshAfterMs を過ぎると stale になり、refresh で照合の結果を替える', async () => {
    const { sessions, advance } = setup();
    const { setCookie } = await sessions.issue('m1', { member: 'm1', courses: ['c1'] });
    advance(10 * 60 * 1000 - 1);
    const fresh = await sessions.read(requestWith(setCookie));
    expect(fresh.ok && fresh.value.stale).toBe(false);
    advance(1);
    const stale = await sessions.read(requestWith(setCookie));
    if (!stale.ok) throw new Error('read failed');
    expect(stale.value.stale).toBe(true);
    const refreshed = await sessions.refresh(stale.value, { member: 'm1', courses: [] });
    expect(refreshed.ok && refreshed.value).toMatchObject({ stale: false, data: { courses: [] } });
    const again = await sessions.read(requestWith(setCookie));
    expect(again.ok && again.value).toMatchObject({ stale: false, data: { courses: [] }, expiresAt: stale.value.expiresAt });
  });

  it('寿命を過ぎると invalid_session で、置き場所から消える。照合し直しても寿命は延びない', async () => {
    const { store, sessions, advance } = setup({ maxAgeMs: 60_000 });
    const { setCookie, session } = await sessions.issue('m1', { member: 'm1', courses: [] });
    expect(setCookie).toContain('Max-Age=60;');
    advance(59_999);
    expect((await sessions.refresh(session, { member: 'm1', courses: [] })).ok).toBe(true);
    advance(1);
    expect(await sessions.refresh(session, { member: 'm1', courses: [] })).toEqual({ ok: false, error: 'invalid_session' });
    expect(await sessions.read(requestWith(setCookie))).toEqual({ ok: false, error: 'invalid_session' });
    expect(store.sessions.size).toBe(0);
  });

  it('revoke は消して Cookie を消す値を返し、revokeSubject は主体のセッションをすべて消す', async () => {
    const { sessions } = setup();
    const a = await sessions.issue('m1', { member: 'm1', courses: [] });
    const b = await sessions.issue('m1', { member: 'm1', courses: [] });
    const c = await sessions.issue('m2', { member: 'm2', courses: [] });
    expect(await sessions.revoke(requestWith(a.setCookie))).toBe('__Host-session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    expect(await sessions.read(requestWith(a.setCookie))).toEqual({ ok: false, error: 'invalid_session' });
    expect(await sessions.revokeSubject('m1')).toBe(1);
    expect(await sessions.read(requestWith(b.setCookie))).toEqual({ ok: false, error: 'invalid_session' });
    expect((await sessions.read(requestWith(c.setCookie))).ok).toBe(true);
    // 失効と同時の照合し直しで、失効したセッションを戻さない
    expect(await sessions.refresh(b.session, { member: 'm1', courses: ['c1'] })).toEqual({ ok: false, error: 'invalid_session' });
  });

  it('issue の replacing は今のセッションを消す', async () => {
    const { store, sessions } = setup();
    const old = await sessions.issue('m1', { member: 'm1', courses: [] });
    const next = await sessions.issue('m1', { member: 'm1', courses: [] }, { replacing: requestWith(old.setCookie) });
    expect([...store.sessions.keys()]).toEqual([next.session.id]);
  });

  it('鍵の入れ替え: 新しい鍵を先に並べても、古い鍵の Cookie を読める', async () => {
    const store = memorySessionStore();
    const before = siteSessions<Rights>({ store, secret: 'old' });
    const { setCookie } = await before.issue('m1', { member: 'm1', courses: [] });
    const after = siteSessions<Rights>({ store, secret: ['new', 'old'] });
    expect((await after.read(requestWith(setCookie))).ok).toBe(true);
    expect((await siteSessions<Rights>({ store, secret: 'new' }).read(requestWith(setCookie))).ok).toBe(false);
  });

  it('purge は期限の過ぎたセッションを消す', async () => {
    const { store, sessions, advance } = setup({ maxAgeMs: 1000 });
    await sessions.issue('m1', { member: 'm1', courses: [] });
    advance(500);
    await sessions.issue('m2', { member: 'm2', courses: [] });
    advance(500);
    expect(await sessions.purge()).toBe(1);
    expect(store.sessions.size).toBe(1);
  });

  it('Cookie の属性を変えられる', async () => {
    const { sessions } = setup({ cookie: { name: 'sid', domain: 'example.com', sameSite: 'Strict' } });
    const { setCookie } = await sessions.issue('m1', { member: 'm1', courses: [] });
    expect(setCookie).toMatch(/^sid=\S+; Path=\/; Max-Age=2592000; Domain=example\.com; HttpOnly; Secure; SameSite=Strict$/);
    expect((await sessions.read(new Request('https://example.com/', { headers: { cookie: setCookie.split(';')[0]! } }))).ok).toBe(true);
  });

  it('鍵がなければ使うときに ConfigError、属性の誤りは作るときに UsageError', async () => {
    const store = memorySessionStore();
    await expect(siteSessions({ store, secret: undefined }).issue('m1', {})).rejects.toMatchObject({ name: 'ConfigError', key: 'secret' });
    await expect(siteSessions({ store, secret: [''] }).read(requestWith('__Host-session=a.b'))).rejects.toMatchObject({ name: 'ConfigError' });
    expect(() => siteSessions({ store, secret: 's', cookie: { domain: 'example.com' } })).toThrow(expect.objectContaining({ code: 'invalid_cookie_options' }));
    expect(() => siteSessions({ store, secret: 's', cookie: { secure: false } })).toThrow(expect.objectContaining({ code: 'invalid_cookie_options' }));
    expect(() => siteSessions({ store, secret: 's', cookie: { name: 'a b' } })).toThrow(expect.objectContaining({ code: 'invalid_cookie_name' }));
    expect(() => siteSessions({ store, secret: 's', maxAgeMs: 401 * 24 * 60 * 60 * 1000 })).toThrow(expect.objectContaining({ code: 'invalid_max_age' }));
    expect(() => siteSessions({ store, secret: 's', cookie: { name: 'sid', secure: false } })).not.toThrow();
  });
});

describe('cookieValue', () => {
  it('名前の値を返し、なければ undefined', () => {
    const request = new Request('https://example.com/', { headers: { cookie: 'a=1; sid=x.y=; b=2; sid=second' } });
    expect(cookieValue(request, 'sid')).toBe('x.y=');
    expect(cookieValue(request, 'none')).toBeUndefined();
    expect(cookieValue(new Request('https://example.com/'), 'sid')).toBeUndefined();
  });
});
