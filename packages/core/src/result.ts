/**
 * 業務の失敗（存在しない、重複、入力の誤りなど）を例外にせず返す値
 * - `E` はエラーコードの文字列リテラルの合併型（例: `'not_found' | 'conflict'`）
 */
export type Result<T, E extends string = string> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export function ok(): Result<void, never>;
export function ok<T>(value: T): Result<T, never>;
export function ok<T>(value?: T): Result<T | undefined, never> {
  return { ok: true, value };
}

export const err = <E extends string>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * 入力の検査で見つかった問題。文言は持たず、コードを画面側の辞書で引く
 * - `path`: 項目の名前（フォーム全体は `''`）
 * - `params`: 文言に差し込む値（上限の文字数など）
 */
export type Problem = Readonly<{ path: string; code: string; params?: Readonly<Record<string, string | number>> }>;
