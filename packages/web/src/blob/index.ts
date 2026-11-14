// キーで実体を保存するポートと、メモリの実装（試験と手元の開発用）
// - R2 のアダプターは `@ryusenkei/web/cloudflare` の `r2BlobStore`

/** 保存した実体。本文は1回だけ読める（ストリームのため）。`contentType` は保存のときの種類で、なければ `null` */
export type StoredBlob = Readonly<{ body: ReadableStream<Uint8Array>; contentType: string | null; size: number }>;

export type BlobBody = string | ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>;

/**
 * キーで実体を保存・取得する
 * - 置き場所の障害は `TransientError`、設定の不足は `ConfigError` を投げる
 */
export type BlobStore = Readonly<{
  put(key: string, body: BlobBody, options?: Readonly<{ contentType?: string }>): Promise<void>;
  /** 実体（なければ `null`） */
  get(key: string): Promise<StoredBlob | null>;
  /** 実体があるか（本文を取得せずに確かめる） */
  exists(key: string): Promise<boolean>;
  /** 1つか複数のキーを削除する。ないキーの削除は成功として扱う */
  delete(keys: string | readonly string[]): Promise<void>;
}>;

async function bytesOf(body: BlobBody): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** メモリの `BlobStore`。`objects` に保存した実体を持つ */
export function memoryBlobStore(): BlobStore & { readonly objects: ReadonlyMap<string, Readonly<{ bytes: Uint8Array; contentType: string | null }>> } {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string | null }>();
  return {
    objects,
    async put(key, body, options = {}) {
      objects.set(key, { bytes: await bytesOf(body), contentType: options.contentType ?? null });
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { body: new Response(object.bytes.slice()).body!, contentType: object.contentType, size: object.bytes.byteLength } : null;
    },
    async exists(key) {
      return objects.has(key);
    },
    async delete(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) objects.delete(key);
    },
  };
}
