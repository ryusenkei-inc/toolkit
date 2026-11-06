import { err, ok } from '@ryusenkei/core';
import type { Authenticator, Identity } from './index.ts';

/**
 * ヘッダーの値で利用者を決めるメモリの実装（テストと dev 用）
 * @param identities ヘッダーの値ごとの利用者
 */
export function memoryAuthenticator(identities: Record<string, Identity>, options: { header?: string } = {}): Authenticator {
  const header = options.header ?? 'authorization';
  return {
    async authenticate(request) {
      const identity = identities[request.headers.get(header) ?? ''];
      return identity ? ok(identity) : err('unauthenticated');
    },
  };
}
