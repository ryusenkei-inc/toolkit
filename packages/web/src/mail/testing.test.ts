import { describe, expect, it } from 'vitest';
import { isEmailAddress, validateMail } from './index.ts';
import { memoryMailer } from './testing.ts';

const mail = { from: { email: 'noreply@example.com', name: 'Site' }, to: [{ email: 'owner@example.com' }], subject: '問い合わせ', text: '本文' };

describe('validateMail', () => {
  it('ヘッダーの改行（CR・LF・NEL・行の区切り）、宛先の形の誤り、宛先なしは invalid_input', () => {
    expect(validateMail(mail)).toEqual({ ok: true, value: undefined });
    for (const ch of ['\r\n', '\n', String.fromCharCode(0x85), String.fromCharCode(0x2028)]) {
      expect(validateMail({ ...mail, subject: `a${ch}Bcc: x@example.com` })).toEqual({ ok: false, error: 'invalid_input' });
      expect(validateMail({ ...mail, to: [{ email: 'x@example.com', name: `a${ch}b` }] })).toEqual({ ok: false, error: 'invalid_input' });
    }
    expect(validateMail({ ...mail, to: [{ email: 'not-an-address' }] })).toEqual({ ok: false, error: 'invalid_input' });
    expect(validateMail({ ...mail, to: [] })).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('isEmailAddress は山括弧や空白を含む値を拒否', () => {
    expect(isEmailAddress('taro@example.com')).toBe(true);
    for (const v of ['a<b>@example.com', 'a b@example.com', 'a@b', '@example.com']) expect(isEmailAddress(v)).toBe(false);
  });
});

describe('memoryMailer', () => {
  it('検査を通ったメールだけを outbox に溜める', async () => {
    const mailer = memoryMailer();
    expect(await mailer.send(mail)).toEqual({ ok: true, value: { id: 'memory-1' } });
    expect(await mailer.send({ ...mail, subject: 'a\nb' })).toEqual({ ok: false, error: 'invalid_input' });
    expect(mailer.outbox).toEqual([mail]);
  });
});
