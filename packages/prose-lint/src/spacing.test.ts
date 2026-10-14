import { describe, expect, it } from 'vitest';
import { autoSpace } from './spacing.ts';

describe('autoSpace', () => {
  it.each([
    ['AIによって', 'AI\u00a0によって'],
    ['Cloudflare Workersで動かす', 'Cloudflare Workers\u00a0で動かす'],
    ['GPT-5の登場', 'GPT-5\u00a0の登場'],
    // 単位・日付・章番号は詰める
    ['2026 年 9 月', '2026年9月'],
    ['開発者 16 人', '開発者16人'],
    ['約 30% のタスク', '約30%のタスク'],
    ['第 1 章', '第1章'],
    // 約物の前後は空けない
    ['METR・2025年前半', 'METR・2025年前半'],
    ['「AI」を使う', '「AI」を使う'],
  ])('%s → %s', (input, expected) => {
    expect(autoSpace(input)).toBe(expected);
  });

  it('二度通しても変わらない', () => {
    const once = autoSpace('AIによって2026年9月に Notion の API を使う');
    expect(autoSpace(once)).toBe(once);
  });
  it('バージョン番号は空け、小数は詰める', () => {
    expect(autoSpace('0.2.0にする')).toBe('0.2.0 にする');
    expect(autoSpace('バージョン1.2.3を公開')).toBe('バージョン 1.2.3 を公開');
    expect(autoSpace('33.7%増')).toBe('33.7%増');
  });
  it('日付は詰め、記号の _ も語の一部', () => {
    expect(autoSpace('2026.10.03に公開')).toBe('2026.10.03に公開');
    expect(autoSpace('x86_64の環境')).toBe('x86_64 の環境');
  });
});
