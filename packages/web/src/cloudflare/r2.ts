import { ConfigError, TransientError } from '@ryusenkei/core';

/** 保存した実体。本文は1回だけ読める（ストリームのため）。`contentType` は保存のときの種類で、なければ `null` */
export type StoredBlob = Readonly<{ body: ReadableStream<Uint8Array>; contentType: string | null; size: number }>;

export type BlobBody = string | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>;

/** キーで実体を保存・取得する */
export type BlobStore = Readonly<{
  put(key: string, body: BlobBody, options?: Readonly<{ contentType?: string }>): Promise<void>;
  /** 実体（なければ `null`） */
  get(key: string): Promise<StoredBlob | null>;
  /** 実体があるか（本文を取得せずに確かめる） */
  exists(key: string): Promise<boolean>;
  /** 1つか複数のキーを削除する。ないキーの削除は成功として扱う */
  delete(keys: string | readonly string[]): Promise<void>;
}>;

type R2ObjectLike = { size: number; httpMetadata?: { contentType?: string } };

/** R2 の bucket の binding（使う部分だけの型。`@cloudflare/workers-types` に依存しない） */
export type R2BucketBinding = {
  put(key: string, value: BlobBody, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<(R2ObjectLike & { body: ReadableStream<Uint8Array> }) | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  delete(keys: string | string[]): Promise<void>;
};

// R2 の delete は1回に1,000キーまで
const DELETE_MAX = 1000;

/**
 * R2 の bucket による実体の保存
 * - binding がなければ `ConfigError`、binding の操作の例外は `TransientError`（理由を区別できないため、再試行で回復しうるものとして扱う）
 * - 複数のキーの削除は1,000キーずつに分ける
 * - ストリームを保存するには長さが要る（R2 の制約）。長さの分からない本文は `ArrayBuffer` にしてから渡す
 */
export function r2BlobStore(bucket: R2BucketBinding | undefined): BlobStore {
  const call = async <T>(op: string, run: (b: R2BucketBinding) => Promise<T>): Promise<T> => {
    if (!bucket) throw new ConfigError('R2 の binding が未設定');
    try {
      return await run(bucket);
    } catch (e) {
      throw new TransientError(`R2 の ${op} の失敗`, { cause: e });
    }
  };
  return {
    async put(key, body, options = {}) {
      await call('put', (b) => b.put(key, body, options.contentType ? { httpMetadata: { contentType: options.contentType } } : {}));
    },
    async get(key) {
      const object = await call('get', (b) => b.get(key));
      return object ? { body: object.body, contentType: object.httpMetadata?.contentType ?? null, size: object.size } : null;
    },
    async exists(key) {
      return (await call('head', (b) => b.head(key))) !== null;
    },
    async delete(keys) {
      if (typeof keys === 'string') return call('delete', (b) => b.delete(keys));
      for (let i = 0; i < keys.length; i += DELETE_MAX) {
        const chunk = keys.slice(i, i + DELETE_MAX);
        await call('delete', (b) => b.delete(chunk));
      }
    },
  };
}
