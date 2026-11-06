import type { Result } from '@ryusenkei/core';

/** 保存したファイル。本文は1回だけ読める（ストリームのため） */
export type BlobObject = {
  size: number;
  contentType: string | undefined;
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};

export type BlobBody = string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;

/** ファイルの保存の業務の失敗。基盤の失敗は `TransientError`、binding の不足は `ConfigError` を投げる */
export type BlobError = 'not_found';

/** キーでファイルを保存・取得する */
export interface BlobStore {
  put(key: string, body: BlobBody, options?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<Result<BlobObject, BlobError>>;
  /** ないキーの削除は成功として扱う */
  delete(key: string): Promise<void>;
  /** `prefix` で始まるキー（辞書順） */
  list(prefix?: string): Promise<string[]>;
}
