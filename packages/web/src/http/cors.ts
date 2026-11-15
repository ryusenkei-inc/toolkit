// 別のオリジンの画面からの要求の許可（CORS）。処理の外側に重ねる
import { REQUEST_ID_HEADER } from './http.ts';

export type CorsOptions = {
  /** 許可するオリジン（`https://app.example.com` の形。末尾の `/` なし）。要求の URL と同じオリジンは常に許可する */
  origins: readonly string[];
  /** 許可するメソッド（既定は `POST`） */
  methods?: readonly string[];
  /** 許可する要求のヘッダー（既定は `content-type`） */
  headers?: readonly string[];
  /** 画面から読める応答のヘッダー（既定は `x-request-id` と `retry-after`） */
  exposeHeaders?: readonly string[];
  /** 事前の確認（preflight）の結果を保つ秒（既定は `600`） */
  maxAgeSec?: number;
};

const DEFAULT_MAX_AGE_SEC = 600;

const forbidden = () => new Response(JSON.stringify({ ok: false, error: 'forbidden_origin' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' } });

/**
 * 処理に CORS を重ねる（`submissionHandler` など、Web 標準の Request → Response の関数）
 * - `OPTIONS`: 許可したオリジンには204と許可のヘッダー、ほかは403の `forbidden_origin`（処理を呼ばない）
 * - ほかのメソッド: `Origin` が許可の外なら、処理を呼ばずに403の `forbidden_origin`
 * - 許可したオリジンなら、処理の応答に `access-control-allow-origin` を足す
 * - `Origin` のない要求（サーバーからの呼び出し）はそのまま処理へ渡す
 * - Cookie などの資格情報は許可しない（`access-control-allow-credentials` を付けない）
 */
export function withCors<A extends unknown[]>(handler: (request: Request, ...rest: A) => Response | Promise<Response>, options: CorsOptions): (request: Request, ...rest: A) => Promise<Response> {
  const allowed = new Set(options.origins);
  const methods = (options.methods ?? ['POST']).join(', ');
  const headers = (options.headers ?? ['content-type']).join(', ');
  const expose = (options.exposeHeaders ?? [REQUEST_ID_HEADER, 'retry-after']).join(', ');
  const maxAge = String(options.maxAgeSec ?? DEFAULT_MAX_AGE_SEC);
  return async (request, ...rest) => {
    const origin = request.headers.get('origin');
    const permitted = origin !== null && (allowed.has(origin) || origin === new URL(request.url).origin);
    if (request.method === 'OPTIONS') {
      if (!permitted) return forbidden();
      return new Response(null, {
        status: 204,
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': methods, 'access-control-allow-headers': headers, 'access-control-max-age': maxAge, vary: 'Origin' },
      });
    }
    if (origin === null) return handler(request, ...rest);
    if (!permitted) return forbidden();
    const res = await handler(request, ...rest);
    const out = new Response(res.body, res);
    out.headers.set('access-control-allow-origin', origin);
    if (expose) out.headers.set('access-control-expose-headers', expose);
    out.headers.append('vary', 'Origin');
    return out;
  };
}
