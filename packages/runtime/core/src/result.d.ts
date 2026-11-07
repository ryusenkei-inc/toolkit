/**
 * 業務の失敗（存在しない、重複、入力の誤りなど）を例外にせず返す値
 * - `E` はエラーコードの文字列リテラルの合併型（例: `'not_found' | 'conflict'`）
 */
export type Result<T, E extends string = string> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
export declare function ok(): Result<void, never>;
export declare function ok<T>(value: T): Result<T, never>;
export declare const err: <E extends string>(error: E) => Result<never, E>;
