import { describe, expect, it } from 'vitest';
import type { Authenticator, Identity } from './index.ts';

/**
 * 実装が守る契約の試験（Vitest）
 * @param requests `valid` は `identity` として認証される要求、`invalid` は認証されない要求
 */
export function authenticatorContract(name: string, make: () => Authenticator, cases: { valid: () => Request; identity: Identity; invalid: (() => Request)[] }): void {
  describe(`${name}: Authenticator の契約`, () => {
    it('正しい要求は利用者を返す', async () => {
      expect(await make().authenticate(cases.valid())).toEqual({ ok: true, value: cases.identity });
    });

    it('認証できない要求は unauthenticated', async () => {
      for (const request of cases.invalid) expect(await make().authenticate(request())).toEqual({ ok: false, error: 'unauthenticated' });
    });
  });
}
