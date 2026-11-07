/** 再試行で回復しうる基盤の失敗（外部の API の一時的な障害、回数の上限など） */
export declare class TransientError extends Error {
    readonly name = "TransientError";
    /** 再試行までの秒数（不明なら `undefined`） */
    readonly retryAfterSec: number | undefined;
    constructor(message: string, options?: {
        retryAfterSec?: number;
        cause?: unknown;
    });
}
/** 設定の不足・誤り（環境変数、binding）。直すまで回復しない */
export declare class ConfigError extends Error {
    readonly name = "ConfigError";
    /** 不足・誤りのある設定の名前 */
    readonly key: string | undefined;
    constructor(message: string, options?: {
        key?: string;
        cause?: unknown;
    });
}
/** 境界で分類した基盤の失敗 */
export type Failure = {
    status: 503;
    code: 'unavailable';
    retryAfterSec: number | undefined;
} | {
    status: 503;
    code: 'not_configured';
} | {
    status: 500;
    code: 'internal';
};
export declare function classifyFailure(e: unknown): Failure;
/**
 * 例外を分類してログに出し、JSON の応答（`{ "error": <code> }`）に変える
 * - 一時的な失敗は `Retry-After` を付ける
 * - 想定外の例外は `error` で報告し、設定の不足は `warn`
 */
export declare function failureResponse(e: unknown, init?: {
    headers?: HeadersInit;
}): Response;
