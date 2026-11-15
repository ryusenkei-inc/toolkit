import { describe, expect, it } from 'vitest';
import { dailyQuotaContract, submissionOnceContract } from './contract.ts';
import { memoryDailyQuota, memorySubmissionOnce } from './testing.ts';

submissionOnceContract('memory', () => memorySubmissionOnce());
dailyQuotaContract('memory', (now) => memoryDailyQuota({ timeZone: 'Asia/Tokyo', now }));

describe('memoryDailyQuota', () => {
  it('時間帯の名前の誤りは UsageError', () => {
    expect(() => memoryDailyQuota({ timeZone: 'Mars/Base' })).toThrow(expect.objectContaining({ name: 'UsageError', code: 'invalid_time_zone' }));
  });
});
