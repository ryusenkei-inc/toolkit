import { describe, expect, it } from 'vitest';
import type { Mail, Mailer } from './index.ts';

/**
 * 実装が守る契約の試験（Vitest）
 * @param mail 実装が送れる正しいメール（送信元は実装で使える値）
 */
export function mailerContract(name: string, make: () => Mailer, mail: Mail): void {
  describe(`${name}: Mailer の契約`, () => {
    it('正しいメールを送る', async () => {
      expect((await make().send(mail)).ok).toBe(true);
    });

    it('ヘッダーに改行を含むメールは送らずに invalid_input', async () => {
      const mailer = make();
      expect(await mailer.send({ ...mail, subject: 'a\r\nBcc: x@example.com' })).toEqual({ ok: false, error: 'invalid_input' });
      expect(await mailer.send({ ...mail, to: [{ email: 'x@example.com', name: 'a\nb' }] })).toEqual({ ok: false, error: 'invalid_input' });
    });

    it('宛先の形式の誤り・宛先なしは invalid_input', async () => {
      const mailer = make();
      expect(await mailer.send({ ...mail, to: [{ email: 'not-an-address' }] })).toEqual({ ok: false, error: 'invalid_input' });
      expect(await mailer.send({ ...mail, to: [] })).toEqual({ ok: false, error: 'invalid_input' });
    });
  });
}
