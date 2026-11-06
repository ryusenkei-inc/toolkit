import { err, ok } from '@ryusenkei/core';
import type { BlobBody, BlobObject, BlobStore } from './index.ts';

const toBytes = async (body: BlobBody): Promise<Uint8Array> => {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body.slice();
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  return new Uint8Array(await new Response(body).arrayBuffer());
};

const toObject = (bytes: Uint8Array, contentType: string | undefined): BlobObject => {
  const response = new Response(bytes.slice());
  return {
    size: bytes.byteLength,
    contentType,
    body: response.body!,
    arrayBuffer: () => response.arrayBuffer(),
    text: () => response.text(),
  };
};

/** メモリに保存する実装（テストと dev 用） */
export function memoryBlobStore(): BlobStore {
  const files = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>();
  return {
    async put(key, body, options = {}) {
      files.set(key, { bytes: await toBytes(body), contentType: options.contentType });
    },
    async get(key) {
      const file = files.get(key);
      return file ? ok(toObject(file.bytes, file.contentType)) : err('not_found');
    },
    async delete(key) {
      files.delete(key);
    },
    async list(prefix = '') {
      return [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
  };
}
