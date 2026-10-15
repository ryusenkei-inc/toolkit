import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drifts, IMPORT, sync } from './files.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conventions-test-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  writeFileSync(join(root, 'CLAUDE.md'), `# CLAUDE.md\n\n${IMPORT}\n`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('sync・drifts', () => {
  it('同期後は差分なし', () => {
    expect(drifts(root).length).toBeGreaterThan(0);
    expect(sync(root)).toEqual([]);
    expect(drifts(root)).toEqual([]);
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toMatch(/packages:\n {2}- apps\/\*\n\n# .*\nminimumReleaseAge: 2880\n/);
  });

  it('改行コードの差は無視', () => {
    sync(root);
    const path = join(root, '.editorconfig');
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('\n', '\r\n'));
    expect(drifts(root)).toEqual([]);
  });

  it('Stop の hook の登録を維持', () => {
    sync(root, { stop: true });
    expect(drifts(root)).toEqual([]);
    expect(drifts(root, { stop: false }).map((d) => d.path)).toEqual(['.claude/settings.json']);
  });

  it('自動で修正できない差分', () => {
    writeFileSync(join(root, 'CLAUDE.md'), '# CLAUDE.md\n');
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 60\n');
    expect(sync(root).map((d) => d.path)).toEqual(['pnpm-workspace.yaml', 'CLAUDE.md']);
  });
});
