import { log } from './log.ts';

/** 報告に添える文脈（相関の ID、処理の段階、要求のメソッドとパス） */
export type ErrorContext = Readonly<{ requestId?: string; stage?: string; method?: string; path?: string; status?: number }>;

/** 想定外の失敗の報告先（ログ、通知の webhook など） */
export type ErrorReporter = Readonly<{ report(error: unknown, context: ErrorContext): void | Promise<void> }>;

/** 報告先の既定: 1行の JSON のログ */
export const jsonLogReporter: ErrorReporter = {
  report: (error, context) => log('error', 'error_report', { ...context, error }),
};

/** 複数の報告先へ送る。1つの失敗はほかに影響しない */
export const combineReporters = (...reporters: ErrorReporter[]): ErrorReporter => ({
  report: async (error, context) => {
    await Promise.all(reporters.map((r) => reportSafely(r, error, context)));
  },
});

/** 報告する。報告先の失敗は飲み込んでログに残す（報告の失敗で応答を壊さないため） */
export async function reportSafely(reporter: ErrorReporter, error: unknown, context: ErrorContext): Promise<void> {
  try {
    await reporter.report(error, context);
  } catch (e) {
    log('warn', 'error_report_failed', { ...context, error: e });
  }
}
