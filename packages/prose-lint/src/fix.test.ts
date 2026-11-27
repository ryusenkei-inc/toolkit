import { describe, expect, it } from 'vitest';
import { fixMarkdown } from './fix.ts';

describe('Markdown の自動修正', () => {
  it('和欧間のスペースを詰め、段落に句点を付ける', () => {
    const source = ['# D1 の上限', '', 'D1 の上限は `pnpm check` で検査する', '', '- D1 の上限', '| D1 の値 | 1 回 |', '```', 'D1 の上限', '```'].join('\n');
    expect(fixMarkdown(source)).toBe(['# D1の上限', '', 'D1の上限は`pnpm check`で検査する。', '', '- D1の上限', '| D1の値 | 1回 |', '```', 'D1 の上限', '```'].join('\n'));
  });

  it('句点は末尾の空白・改行の指定の前', () => {
    expect(fixMarkdown('削除する  \n次の行\\')).toBe('削除する。  \n次の行。\\');
  });

  it('引用・番号付きの箇条書きの記号を保つ', () => {
    expect(fixMarkdown('> D1 の値\n1. D1 の値')).toBe('> D1の値。\n1. D1の値');
  });

  it('改行の種類を保つ', () => {
    expect(fixMarkdown('D1 の値\r\n')).toBe('D1の値。\r\n');
  });

  it('改行の種類が混在しても、修正しない行は変えない', () => {
    expect(fixMarkdown('Title\r\nBody\nD1 の値\r\n')).toBe('Title\r\nBody\nD1の値。\r\n');
  });

  it('英語の文の中の日本語の語は変えない（表はセルごと）', () => {
    const source = ['Builds a 特定商取引法 notice', 'Moved to コード in `rules.md`, unchanged', '| Privacy, 特定商取引法 notice | D1 の値 |', 'Cloudflare Workers で動かす'].join('\n');
    expect(fixMarkdown(source)).toBe(['Builds a 特定商取引法 notice', 'Moved to コード in `rules.md`, unchanged', '| Privacy, 特定商取引法 notice | D1の値 |', 'Cloudflare Workersで動かす。'].join('\n'));
  });

  it('無効の規則は直さない', () => {
    expect(fixMarkdown('D1 の値', { spacing: false, period: true })).toBe('D1 の値。');
    expect(fixMarkdown('D1 の値', { spacing: true, period: false })).toBe('D1の値');
  });

  it('二度通しても変わらない', () => {
    const once = fixMarkdown('D1 の値\n\n- 手順 A');
    expect(fixMarkdown(once)).toBe(once);
  });
});
