import type { BlobBody, BlobObject, BlobStore } from '@ryusenkei/blob';
import { ConfigError, err, ok, TransientError } from '@ryusenkei/core';

type R2Object = { size: number; httpMetadata?: { contentType?: string }; body: ReadableStream<Uint8Array>; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> };

/** R2 の bucket の binding（使う部分だけの型） */
export type R2BucketBinding = {
  put(key: string, value: BlobBody, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
};

/** R2 の bucket によるファイルの保存 */
export function r2BlobStore(bucket: R2BucketBinding | undefined): BlobStore {
  // R2 の失敗は再試行で回復しうるものとして扱う（binding の操作の例外は理由を区別できない）
  const transient = async <T>(op: string, run: (b: R2BucketBinding) => Promise<T>): Promise<T> => {
    if (!bucket) throw new ConfigError('R2 の binding が未設定');
    try {
      return await run(bucket);
    } catch (e) {
      throw new TransientError(`R2 の ${op} の失敗`, { cause: e });
    }
  };
  return {
    async put(key, body, options = {}) {
      await transient('put', (b) => b.put(key, body, options.contentType ? { httpMetadata: { contentType: options.contentType } } : {}));
    },
    async get(key) {
      const object = await transient('get', (b) => b.get(key));
      if (!object) return err('not_found');
      const blob: BlobObject = { size: object.size, contentType: object.httpMetadata?.contentType, body: object.body, arrayBuffer: () => object.arrayBuffer(), text: () => object.text() };
      return ok(blob);
    },
    async delete(key) {
      await transient('delete', (b) => b.delete(key));
    },
    // 1回の応答は最大1,000件なので、cursor で続きを取得
    async list(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await transient('list', (b) => b.list({ ...(prefix ? { prefix } : {}), ...(cursor ? { cursor } : {}) }));
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys.sort();
    },
  };
}
