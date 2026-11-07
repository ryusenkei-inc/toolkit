import { ConfigError, err, ok, TransientError, type Result } from '@ryusenkei/core';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// トークンの上限の長さ（これを超えるものは判定の API に送らずに拒否）
const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * bot の判定の業務の失敗
 * - 判定の API の障害は `TransientError`、秘密鍵の不足・誤りは `ConfigError` を投げる
 */
export type BotCheckError =
  | 'missing_token' // トークンがない
  | 'rejected' // 判定で拒否（不正・期限切れ・使用済みのトークン）
  | 'hostname_mismatch' // トークンを発行したホスト名が許可の一覧にない
  | 'action_mismatch'; // トークンの action が期待と違う

/** フォームの送信が人によるものかの判定（`@ryusenkei/form/server` の `botCheck` に渡せる） */
export type BotCheck = Readonly<{ verify(input: { token: string | null | undefined; remoteIp?: string; action?: string }): Promise<Result<void, BotCheckError>> }>;

/** Turnstile のテスト用の鍵（Cloudflare が公開している値） */
export const TURNSTILE_TEST_KEYS = {
  sitekey: { pass: '1x00000000000000000000AA', fail: '2x00000000000000000000AB', invisiblePass: '1x00000000000000000000BB', invisibleFail: '2x00000000000000000000BB', interactive: '3x00000000000000000000FF' },
  secret: { pass: '1x0000000000000000000000000000000AA', fail: '2x0000000000000000000000000000000AA', spent: '3x0000000000000000000000000000000AA' },
  /** テスト用の sitekey のウィジェットが返すトークン */
  token: 'XXXX.DUMMY.TOKEN.XXXX',
} as const;

const TEST_SECRETS: readonly string[] = Object.values(TURNSTILE_TEST_KEYS.secret);
// テスト用の秘密鍵の成功の応答: ホスト名は常に `example.com`、action は返らない
const TEST_HOSTNAME = 'example.com';

type SiteverifyResponse = { success: boolean; 'error-codes'?: string[]; hostname?: string; action?: string };

export type TurnstileOptions = {
  /** 秘密鍵。テスト用の鍵は `TURNSTILE_TEST_KEYS.secret` */
  secret: string | undefined;
  /** ウィジェットを置くページのホスト名（トークンを発行したホスト名をこの一覧と照合） */
  hostnames: string[];
  /** 判定の API の時間切れ（ミリ秒、既定は5秒） */
  timeoutMs?: number;
  /** テストで差し替える `fetch` */
  fetch?: typeof fetch;
};

/** Turnstile の siteverify による bot の判定 */
export function turnstileBotCheck(options: TurnstileOptions): BotCheck {
  const fetcher = options.fetch ?? fetch;
  return {
    async verify({ token, remoteIp, action }) {
      if (!options.secret) throw new ConfigError('Turnstile の秘密鍵が未設定', { key: 'secret' });
      if (!token) return err('missing_token');
      if (token.length > MAX_TOKEN_LENGTH) return err('rejected');
      const body = new FormData();
      body.set('secret', options.secret);
      body.set('response', token);
      if (remoteIp) body.set('remoteip', remoteIp);
      let res: Response;
      try {
        res = await fetcher(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
      } catch (e) {
        throw new TransientError('siteverify に接続できない', { cause: e });
      }
      if (!res.ok) throw new TransientError(`siteverify が ${res.status} を返した`);
      const result = (await res.json().catch(() => null)) as SiteverifyResponse | null;
      if (!result) throw new TransientError('siteverify の応答を読めない');
      const codes = result['error-codes'] ?? [];
      if (codes.some((c) => c === 'missing-input-secret' || c === 'invalid-input-secret')) throw new ConfigError('Turnstile の秘密鍵が不正', { key: 'secret' });
      if (codes.includes('internal-error')) throw new TransientError('siteverify の内部エラー');
      if (!result.success) return err('rejected');
      const test = TEST_SECRETS.includes(options.secret);
      if (!(options.hostnames.includes(result.hostname ?? '') || (test && result.hostname === TEST_HOSTNAME))) return err('hostname_mismatch');
      if (action !== undefined && !test && result.action !== action) return err('action_mismatch');
      return ok();
    },
  };
}
