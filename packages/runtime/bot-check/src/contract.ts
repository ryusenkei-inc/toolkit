import { describe, expect, it } from 'vitest';
import type { BotCheck } from './index.ts';

/**
 * 実装が守る契約の試験（Vitest）
 * @param tokens `valid` を通し `invalid` を拒否する実装の、それぞれのトークン
 */
export function botCheckContract(name: string, make: () => BotCheck, tokens: { valid: string; invalid: string }): void {
  describe(`${name}: BotCheck の契約`, () => {
    it('正しいトークンを通す', async () => {
      expect(await make().verify({ token: tokens.valid })).toEqual({ ok: true, value: undefined });
    });

    it('トークンがなければ missing_token', async () => {
      for (const token of [undefined, null, '']) expect(await make().verify({ token })).toEqual({ ok: false, error: 'missing_token' });
    });

    it('不正なトークンは rejected', async () => {
      expect(await make().verify({ token: tokens.invalid })).toEqual({ ok: false, error: 'rejected' });
    });
  });
}
