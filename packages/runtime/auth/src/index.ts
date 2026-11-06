import type { Result } from '@ryusenkei/core';

/** 認証した利用者 */
export type Identity = {
  /** 提供元での一意の ID */
  subject: string;
  email: string | undefined;
  /** 所属するグループ（提供元が返す場合） */
  groups: string[];
};

/**
 * 認証の業務の失敗
 * - 基盤の失敗（鍵の取得の失敗）は `TransientError`、チームのドメインなどの不足は `ConfigError` を投げる
 */
export type AuthError = 'unauthenticated';

/** 要求から利用者を認証する */
export interface Authenticator {
  authenticate(request: Request): Promise<Result<Identity, AuthError>>;
}
