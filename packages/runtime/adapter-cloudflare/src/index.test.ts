// binding の偽物で、結果とエラーの変換を検査（Workers の実行環境での検査は別）
import { ConfigError, TransientError } from '@ryusenkei/core';
import { describe, expect, it } from 'vitest';
import { cloudflareMailer, cloudflareRateLimiter, type SendEmailBinding } from './index.ts';

const fakeRateLimit = (limit: number) => {
  const counts = new Map<string, number>();
  return { limit: async ({ key }: { key: string }) => ({ success: (counts.set(key, (counts.get(key) ?? 0) + 1).get(key) ?? 0) <= limit }) };
};

const fakeEmail = (fail?: string): SendEmailBinding & { sent: unknown[] } => {
  const sent: unknown[] = [];
  return {
    sent,
    async send(message) {
      if (fail) throw Object.assign(new Error(fail), { code: fail });
      sent.push(message);
      return { messageId: `m-${sent.length}` };
    },
  };
};

const mail = { from: { email: 'noreply@example.com' }, to: [{ email: 'owner@example.com' }], subject: '件名', text: '本文' };

describe('cloudflareRateLimiter', () => {
  it('上限までは通し、超えたら rate_limited。キーごとに数える', async () => {
    const limiter = cloudflareRateLimiter(fakeRateLimit(2));
    expect(await limiter.limit('a')).toEqual({ ok: true, value: undefined });
    await limiter.limit('a');
    expect(await limiter.limit('a')).toEqual({ ok: false, error: 'rate_limited' });
    expect((await limiter.limit('b')).ok).toBe(true);
  });

  it('binding がなければ ConfigError、binding の例外は TransientError', async () => {
    await expect(cloudflareRateLimiter(undefined).limit('a')).rejects.toBeInstanceOf(ConfigError);
    await expect(cloudflareRateLimiter({ limit: () => Promise.reject(new Error('x')) }).limit('a')).rejects.toBeInstanceOf(TransientError);
  });
});

describe('cloudflareMailer', () => {
  it('messageId を返し、binding に宛先と本文を渡す', async () => {
    const binding = fakeEmail();
    expect(await cloudflareMailer(binding).send(mail)).toEqual({ ok: true, value: { id: 'm-1' } });
    expect(binding.sent).toEqual([{ from: mail.from, to: mail.to, subject: '件名', text: '本文' }]);
  });

  it('送る前に検査し、ヘッダーの改行は送らずに invalid_input', async () => {
    const binding = fakeEmail();
    expect(await cloudflareMailer(binding).send({ ...mail, subject: `a${String.fromCharCode(0x2028)}Bcc: x@example.com` })).toEqual({ ok: false, error: 'invalid_input' });
    expect(binding.sent).toEqual([]);
  });

  it('binding がなければ ConfigError、エラーコードを分類', async () => {
    await expect(cloudflareMailer(undefined).send(mail)).rejects.toBeInstanceOf(ConfigError);
    const send = (code: string) => cloudflareMailer(fakeEmail(code)).send(mail);
    await expect(send('E_RATE_LIMIT_EXCEEDED')).rejects.toBeInstanceOf(TransientError);
    await expect(send('E_SENDER_NOT_VERIFIED')).rejects.toBeInstanceOf(ConfigError);
    expect(await send('E_RECIPIENT_SUPPRESSED')).toEqual({ ok: false, error: 'rejected' });
    expect(await send('E_HEADER_VALUE_INVALID')).toEqual({ ok: false, error: 'invalid_input' });
    await expect(send('E_SOMETHING_NEW')).rejects.toThrow('E_SOMETHING_NEW');
  });
});
