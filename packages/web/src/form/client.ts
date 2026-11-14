// 画面から送信するための型と関数（フレームワークに依存しない。Astro でも Vite + React でも使える）
import type { Problem } from '@ryusenkei/core';

/** 受け取りの処理が返すエラーコード（文言は画面側の辞書で引く） */
export type SubmissionErrorCode = 'invalid' | 'too_large' | 'rate_limited' | 'bot_check_failed' | 'unavailable' | 'not_configured' | 'internal' | 'method_not_allowed';

export type SubmitResult =
  | Readonly<{ ok: true; id?: string | null }>
  | Readonly<{
      ok: false;
      /** `network` は応答を受け取れなかった（通信の失敗、想定外の応答） */
      error: SubmissionErrorCode | 'network';
      problems: readonly Problem[];
      retryAfterSec?: number;
    }>;

/** フォームを送信し、結果をコードで返す（例外を投げない） */
export async function submitForm(url: string, body: FormData, options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<SubmitResult> {
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url, { method: 'POST', body, ...(options.signal && { signal: options.signal }) });
  } catch {
    return { ok: false, error: 'network', problems: [] };
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; id?: string | null; error?: SubmissionErrorCode; problems?: Problem[] } | null;
  if (res.ok && data?.ok) return { ok: true, ...(data.id !== undefined && { id: data.id }) };
  const retryAfter = Number(res.headers.get('retry-after'));
  return {
    ok: false,
    error: data?.error ?? 'network',
    problems: data?.problems ?? [],
    ...(Number.isFinite(retryAfter) && retryAfter > 0 && { retryAfterSec: retryAfter }),
  };
}
