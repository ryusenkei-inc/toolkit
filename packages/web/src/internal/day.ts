// 時間帯での日付（日ごとの集計と上限で共通）
import { UsageError } from '@ryusenkei/core';

/** 時間帯 `timeZone` での日付（`YYYY-MM-DD`） */
export const dayIn = (timeZone: string, at: Date | number = Date.now()): string => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** 時間帯の名前を確かめる。誤りは `UsageError`（`invalid_time_zone`） */
export function assertTimeZone(timeZone: string): void {
  try {
    dayIn(timeZone, 0);
  } catch (e) {
    throw new UsageError('invalid_time_zone', `時間帯の名前の誤り: ${timeZone}`, { cause: e });
  }
}
