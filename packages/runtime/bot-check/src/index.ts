import type { Result } from '@ryusenkei/core';

/**
 * bot の判定の業務の失敗
 * - 基盤の失敗（判定の API の障害）は `TransientError`、秘密鍵の不足・誤りは `ConfigError` を投げる
 */
export type BotCheckError =
  | 'missing_token' // トークンがない
  | 'rejected' // 判定で拒否（不正・期限切れ・使用済みのトークン）
  | 'hostname_mismatch' // トークンを発行したホスト名が許可の一覧にない
  | 'action_mismatch'; // トークンの action が期待と違う

export type BotCheckInput = {
  /** フォームが送ったトークン */
  token: string | null | undefined;
  /** 送信元の IP アドレス（判定の精度を上げる） */
  remoteIp?: string;
  /** 期待する action（ウィジェットに指定した値） */
  action?: string;
};

/** フォームの送信が人によるものかの判定 */
export interface BotCheck {
  verify(input: BotCheckInput): Promise<Result<void, BotCheckError>>;
}
