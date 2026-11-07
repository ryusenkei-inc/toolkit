// binding の偽物で、差し込み口の契約とエラーの変換を検査（Workers の実行環境での検査は別）
import { blobStoreContract } from '@ryusenkei/blob/contract';
import { ConfigError, TransientError } from '@ryusenkei/core';
import { mailerContract } from '@ryusenkei/mail/contract';
import { rateLimiterContract } from '@ryusenkei/rate-limit/contract';
import { describe, expect, it } from 'vitest';
import { cloudflareMailer, cloudflareRateLimiter, r2BlobStore, type R2BucketBinding, type SendEmailBinding } from './index.ts';

const fakeRateLimit = (limit: number) => {
  const counts = new Map<string, number>();
  return { limit: async ({ key }: { key: string }) => ({ success: (counts.set(key, (counts.get(key) ?? 0) + 1).get(key) ?? 0) <= limit }) };
};

// R2 の偽物: 1ページ2件で cursor を返す（続きの取得の検査）
const fakeR2 = (): R2BucketBinding => {
  const files = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    async put(key, value, options) {
      files.set(key, { bytes: new Uint8Array(await new Response(value as BodyInit).arrayBuffer()), contentType: options?.httpMetadata?.contentType });
    },
    async get(key) {
      const f = files.get(key);
      if (!f) return null;
      const res = new Response(f.bytes.slice());
      return { size: f.bytes.byteLength, httpMetadata: { contentType: f.contentType }, body: res.body!, arrayBuffer: () => res.arrayBuffer(), text: () => res.text() };
    },
    async delete(key) {
      files.delete(key);
    },
    async list(options = {}) {
      const all = [...files.keys()].filter((k) => k.startsWith(options.prefix ?? '')).sort();
      const start = Number(options.cursor ?? 0);
      const objects = all.slice(start, start + 2).map((key) => ({ key }));
      return start + 2 < all.length ? { objects, truncated: true, cursor: String(start + 2) } : { objects, truncated: false };
    },
  };
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

rateLimiterContract('cloudflareRateLimiter', () => cloudflareRateLimiter(fakeRateLimit(2)), { limit: 2 });
blobStoreContract('r2BlobStore', () => r2BlobStore(fakeR2()));
mailerContract('cloudflareMailer', () => cloudflareMailer(fakeEmail()), mail);

describe('binding の不足・失敗', () => {
  it('binding がなければ ConfigError', async () => {
    await expect(cloudflareRateLimiter(undefined).limit('a')).rejects.toBeInstanceOf(ConfigError);
    await expect(r2BlobStore(undefined).get('a')).rejects.toBeInstanceOf(ConfigError);
    await expect(cloudflareMailer(undefined).send(mail)).rejects.toBeInstanceOf(ConfigError);
  });

  it('binding の例外は TransientError', async () => {
    await expect(cloudflareRateLimiter({ limit: () => Promise.reject(new Error('x')) }).limit('a')).rejects.toBeInstanceOf(TransientError);
    await expect(r2BlobStore({ ...fakeR2(), get: () => Promise.reject(new Error('x')) }).get('a')).rejects.toBeInstanceOf(TransientError);
  });
});

describe('cloudflareMailer', () => {
  it('messageId を返す', async () => {
    expect(await cloudflareMailer(fakeEmail()).send(mail)).toEqual({ ok: true, value: { id: 'm-1' } });
  });

  it('エラーコードを分類', async () => {
    const send = (code: string) => cloudflareMailer(fakeEmail(code)).send(mail);
    await expect(send('E_RATE_LIMIT_EXCEEDED')).rejects.toBeInstanceOf(TransientError);
    await expect(send('E_SENDER_NOT_VERIFIED')).rejects.toBeInstanceOf(ConfigError);
    expect(await send('E_RECIPIENT_SUPPRESSED')).toEqual({ ok: false, error: 'rejected' });
    expect(await send('E_HEADER_VALUE_INVALID')).toEqual({ ok: false, error: 'invalid_input' });
    await expect(send('E_SOMETHING_NEW')).rejects.toThrow('E_SOMETHING_NEW');
  });
});
