// binding の偽物で、結果とエラーの変換を検査（Workers の実行環境での検査は別）
import { ConfigError, TransientError } from '@ryusenkei/core';
import { describe, expect, it } from 'vitest';
import { cloudflareMailer, cloudflareRateLimiter, r2BlobStore, type R2BucketBinding, type SendEmailBinding } from './index.ts';

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

  it('whenMissing: allow なら binding がなくても通す', async () => {
    expect(await cloudflareRateLimiter(undefined, { whenMissing: 'allow' }).limit('a')).toEqual({ ok: true, value: undefined });
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

// R2 の bucket の偽物（delete の呼び出しを記録する）
const fakeBucket = () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const deletes: string[][] = [];
  const bucket: R2BucketBinding = {
    async put(key, value, options) {
      const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
      objects.set(key, { bytes, ...(options?.httpMetadata?.contentType && { contentType: options.httpMetadata.contentType }) });
      return {};
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { size: o.bytes.byteLength, httpMetadata: o.contentType ? { contentType: o.contentType } : {}, body: new Response(o.bytes as BodyInit).body! } : null;
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { size: o.bytes.byteLength } : null;
    },
    async delete(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      deletes.push(list);
      for (const k of list) objects.delete(k);
    },
  };
  return Object.assign(bucket, { deletes, objects });
};

describe('r2BlobStore', () => {
  it('保存した本文と Content-Type を取得し、ないキーは null', async () => {
    const store = r2BlobStore(fakeBucket());
    await store.put('a.txt', 'こんにちは', { contentType: 'text/plain' });
    await store.put('b.bin', new Uint8Array([1, 2]));
    const a = await store.get('a.txt');
    expect(a && { contentType: a.contentType, size: a.size, text: await new Response(a.body).text() }).toEqual({ contentType: 'text/plain', size: 15, text: 'こんにちは' });
    expect((await store.get('b.bin'))?.contentType).toBeNull();
    expect(await store.get('none')).toBeNull();
  });

  it('exists は本文を取得せずに確かめる', async () => {
    const store = r2BlobStore(fakeBucket());
    await store.put('a', 'x');
    expect([await store.exists('a'), await store.exists('b')]).toEqual([true, false]);
  });

  it('複数のキーの削除は1,000キーずつに分ける', async () => {
    const bucket = fakeBucket();
    const store = r2BlobStore(bucket);
    await store.delete('one');
    await store.delete(Array.from({ length: 2001 }, (_, i) => `k${i}`));
    await store.delete([]);
    expect(bucket.deletes.map((d) => d.length)).toEqual([1, 1000, 1000, 1]);
  });

  it('binding がなければ ConfigError、binding の例外は TransientError', async () => {
    await expect(r2BlobStore(undefined).exists('a')).rejects.toBeInstanceOf(ConfigError);
    const broken = { ...fakeBucket(), head: () => Promise.reject(new Error('x')) };
    await expect(r2BlobStore(broken).exists('a')).rejects.toBeInstanceOf(TransientError);
  });
});
