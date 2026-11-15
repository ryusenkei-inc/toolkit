import { describe, expect, it } from 'vitest';
import { withCors } from './cors.ts';

const URL_ = 'https://api.example.com/survey';
const APP = 'https://app.example.com';

const setup = () => {
  const calls: Request[] = [];
  const handle = withCors(
    async (request: Request, ctx?: { id: number }) => {
      calls.push(request);
      return new Response(JSON.stringify({ ok: true, id: ctx?.id }), { status: 200, headers: { 'content-type': 'application/json', vary: 'Accept' } });
    },
    { origins: [APP] },
  );
  return { calls, handle };
};
const req = (method: string, origin?: string) => new Request(URL_, { method, headers: origin ? { origin } : {}, ...(method === 'POST' && { body: '{}' }) });

describe('withCors', () => {
  it('許可したオリジンの事前の確認は 204 と許可のヘッダーで、処理を呼ばない', async () => {
    const t = setup();
    const res = await t.handle(req('OPTIONS', APP));
    expect(res.status).toBe(204);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'access-control-allow-origin': APP,
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    });
    expect(t.calls).toHaveLength(0);
  });

  it('許可したオリジンの要求は処理へ渡し、応答に許可のヘッダーを足す', async () => {
    const t = setup();
    const res = await t.handle(req('POST', APP), { id: 7 });
    expect(await res.json()).toEqual({ ok: true, id: 7 });
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('access-control-expose-headers')).toBe('x-request-id, retry-after');
    expect(res.headers.get('vary')).toBe('Accept, Origin');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('許可の外のオリジンは、事前の確認も要求も 403 forbidden_origin で、処理を呼ばない', async () => {
    const t = setup();
    for (const origin of ['https://evil.example.com', 'null', `${APP}/`]) {
      const res = await t.handle(req('POST', origin));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: 'forbidden_origin' });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect((await t.handle(req('OPTIONS', origin))).status).toBe(403);
    }
    expect(t.calls).toHaveLength(0);
  });

  it('同じオリジンと Origin のない要求は通す', async () => {
    const t = setup();
    expect((await t.handle(req('POST', 'https://api.example.com'))).status).toBe(200);
    expect((await t.handle(req('POST'))).status).toBe(200);
    expect(t.calls).toHaveLength(2);
  });

  it('メソッドとヘッダーと秒を変えられる', async () => {
    const handle = withCors(() => new Response(null), { origins: [APP], methods: ['GET', 'POST'], headers: ['content-type', 'authorization'], maxAgeSec: 60 });
    const res = await handle(req('OPTIONS', APP));
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type, authorization');
    expect(res.headers.get('access-control-max-age')).toBe('60');
  });
});
