// Mailer の契約の試験（メモリの実装と各アダプターで同じ試験を回す）。ビルドに含めない
import { describe, expect, it } from 'vitest';
import type { Mail, Mailer } from './index.ts';

const mail: Mail = { from: { email: 'noreply@example.com', name: 'Site' }, to: [{ email: 'owner@example.com' }], replyTo: { email: 'user@example.com' }, subject: '件名', text: '本文' };

/** `make` は送信の実装と、実際に送った件数を返す関数を返す */
export function mailerContract(name: string, make: () => { mailer: Mailer; sentCount(): number }): void {
  describe(`Mailer の契約: ${name}`, () => {
    it('正しいメールは送り、id を返す', async () => {
      const { mailer, sentCount } = make();
      const result = await mailer.send(mail);
      expect(result.ok).toBe(true);
      if (result.ok) expect(['string', 'undefined']).toContain(typeof result.value.id);
      expect(sentCount()).toBe(1);
    });

    it('ヘッダーの改行、宛先の形の誤り、宛先なしは送らずに invalid_input', async () => {
      const { mailer, sentCount } = make();
      for (const bad of [{ ...mail, subject: '件名\r\nBcc: x@example.com' }, { ...mail, to: [{ email: 'not-an-address' }] }, { ...mail, to: [] }, { ...mail, from: { email: 'a@example.com', name: 'A\nB' } }]) {
        expect(await mailer.send(bad)).toEqual({ ok: false, error: 'invalid_input' });
      }
      expect(sentCount()).toBe(0);
    });
  });
}
