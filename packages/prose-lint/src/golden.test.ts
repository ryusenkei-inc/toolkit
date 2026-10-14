import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alignTrailing, commentTexts, markdownTexts, trailingComment } from './comments.ts';
import { commitMessageIssues } from './commit.ts';
import { EXAMPLES } from './examples.ts';
import { commentIssues, textIssues } from './text.ts';

const golden = (file: string) => readFileSync(new URL(`../golden/${file}`, import.meta.url), 'utf8');

describe('手本', () => {
  it('コメントの手本はすべての規則を通る（行末コメントの位置を含む）', () => {
    const source = golden('comments.ts');
    const lines = source.split(/\r?\n/);
    const texts = [...commentTexts(source, 'slash').map((s) => s.text), ...lines.flatMap((l) => trailingComment(l)?.text ?? [])];
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) expect([t, commentIssues(t)]).toEqual([t, []]);
    expect(alignTrailing(lines)).toEqual(lines);
  });

  it('Markdown の手本はすべての規則を通る', () => {
    for (const { text } of markdownTexts(golden('GUIDE.md'))) expect([text, textIssues(text)]).toEqual([text, []]);
  });

  it('コミットメッセージの手本はすべての規則を通る', () => {
    for (const message of golden('commit.txt').split(/\r?\n/).filter(Boolean)) expect([message, commitMessageIssues(message)]).toEqual([message, []]);
  });
});

describe('修正の例', () => {
  for (const [id, [bad, good]] of Object.entries(EXAMPLES)) {
    it(id, () => {
      const issues = id.startsWith('commit/') ? commitMessageIssues(bad).flatMap((f) => f.issues) : commentIssues(bad);
      expect(issues.map((i) => i.rule)).toContain(id);
      expect(id.startsWith('commit/') ? commitMessageIssues(good) : commentIssues(good)).toEqual([]);
    });
  }
});
