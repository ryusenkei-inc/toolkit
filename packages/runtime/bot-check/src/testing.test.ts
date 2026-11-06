import { expect, it } from 'vitest';
import { botCheckContract } from './contract.ts';
import { memoryBotCheck } from './testing.ts';

botCheckContract('memoryBotCheck', () => memoryBotCheck(), { valid: 'pass', invalid: 'fail' });

it('action が期待と違えば action_mismatch', async () => {
  const check = memoryBotCheck({ accept: ['pass'], action: 'inquiry' });
  expect(await check.verify({ token: 'pass', action: 'login' })).toEqual({ ok: false, error: 'action_mismatch' });
  expect((await check.verify({ token: 'pass', action: 'inquiry' })).ok).toBe(true);
});
