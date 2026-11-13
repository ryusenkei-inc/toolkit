// AsyncLocalStorage の型だけを `@types/node` から読む（出力の型定義には残らない）
/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks';
import { setLogContext } from '../core/index.ts';

type Fields = Readonly<Record<string, unknown>>;

let storage: AsyncLocalStorage<Fields> | undefined;

/**
 * 文脈の項目を付けて実行する。`fn` の中（待ち合わせの後も含む）で書くログのすべての行に `fields` が付く
 * - 入れ子では外の項目に足し、同じ名前は内側が優先する
 * - `node:async_hooks` の AsyncLocalStorage を使う。Workers は互換のフラグ `nodejs_als` か `nodejs_compat` が要る
 * - 初めて呼んだときに `setLogContext` へ登録する（ほかの登録を置き換える）
 */
export function withLogContext<R>(fields: Fields, fn: () => R): R {
  if (!storage) {
    const created = new AsyncLocalStorage<Fields>();
    storage = created;
    setLogContext(() => created.getStore());
  }
  return storage.run({ ...storage.getStore(), ...fields }, fn);
}
