import { describe, expect, it } from 'vitest';
import { commitMessageIssues } from './commit.ts';

const rules = (message: string, disabled: string[] = []) => commitMessageIssues(message, { disabled: new Set(disabled) }).flatMap((f) => f.issues.map((i) => `${f.line}:${i.rule}`));

describe('コミットメッセージ', () => {
  it('type・scope を除いた subject を検査する', () => {
    expect(commitMessageIssues('feat(site): OG 画像に和欧間のアキを追加する\n')).toEqual([]);
    expect(commitMessageIssues('fix: ファイルを改名する。')).toEqual([
      {
        line: 1,
        text: 'ファイルを改名する。',
        issues: [
          { rule: 'format/period', message: '末尾に句点を付けない' },
          { rule: 'style/vocabulary', message: '「改名」→ リネーム' },
        ],
      },
    ]);
  });

  it('Conventional Commits の書式', () => {
    expect(rules('OG 画像を更新する')).toEqual(['1:commit/format']);
    expect(rules('feature: OG 画像を更新する')).toEqual(['1:commit/format']);
    expect(rules('feat(Site): OG 画像を更新する')).toEqual(['1:commit/format']);
    expect(rules('feat(site,mcp)!: OG 画像を更新する')).toEqual([]);
  });

  it('subject は日本語。バージョンを上げるだけのコミットは英語の定型', () => {
    expect(rules('fix: update OG image')).toEqual(['1:commit/subject-ja']);
    expect(rules('chore(release): prose-lint@0.6.0')).toEqual([]);
  });

  it('body・AI の署名を禁止', () => {
    expect(rules('fix: 更新する\n\n背景の説明\n')).toEqual(['3:commit/body']);
    expect(rules('fix: 更新する\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n')).toEqual(['3:commit/trailer', '3:commit/body']);
    expect(rules('fix: 更新する\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n', ['commit/body'])).toEqual(['3:commit/trailer']);
    expect(rules('fix: 更新する\n\n🤖 Generated with Claude Code\n', ['commit/body'])).toEqual(['3:commit/trailer']);
  });

  it('body を許可したリポでは body の文を検査する', () => {
    expect(rules('fix: 更新する\n\nファイルを改名する。\n', ['commit/body'])).toEqual(['3:format/period', '3:style/vocabulary']);
  });

  it('git が除去する行・git が生成するメッセージは対象外', () => {
    expect(rules('chore: 依存を更新する\n\n# 変更をコミットするには…。\n# ------------------------ >8 ------------------------\n- 版を上げる。\n')).toEqual([]);
    expect(rules("Merge branch 'main' into feat/x\n")).toEqual([]);
    expect(rules('fixup! fix: 更新する\n')).toEqual([]);
  });
});
