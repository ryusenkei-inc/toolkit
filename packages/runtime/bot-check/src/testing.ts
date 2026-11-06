import { err, ok } from '@ryusenkei/core';
import type { BotCheck } from './index.ts';

/** 決まったトークンだけを通すメモリの実装（テストと dev 用） */
export function memoryBotCheck(options: { accept: string[]; action?: string } = { accept: ['pass'] }): BotCheck {
  return {
    async verify({ token, action }) {
      if (!token) return err('missing_token');
      if (!options.accept.includes(token)) return err('rejected');
      if (action !== undefined && options.action !== undefined && action !== options.action) return err('action_mismatch');
      return ok();
    },
  };
}
