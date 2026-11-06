import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drifts, IMPORT, sync } from './files.ts';

const LANG_IMPORTS = ['ts', 'go', 'rust', 'ui'].map((l) => IMPORT.replace('rules.md', `rules-${l}.md`));
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conventions-test-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  writeFileSync(join(root, 'CLAUDE.md'), ['# CLAUDE.md', IMPORT, ...LANG_IMPORTS].join('\n'));
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

  it('go.mod があるリポのみ Dependabot に gomod を追加', () => {
    const dependabot = join(root, '.github/dependabot.yaml');
    sync(root);
    expect(readFileSync(dependabot, 'utf8')).not.toMatch(/gomod/);
    writeFileSync(join(root, 'go.mod'), 'module example.com/x\n');
    expect(drifts(root).map((d) => d.path)).toEqual(['.github/dependabot.yaml']);
    sync(root);
    expect(readFileSync(dependabot, 'utf8')).toMatch(/\n {2}- package-ecosystem: gomod\n/);
    expect(drifts(root)).toEqual([]);
  });

  it('Cargo.toml があるリポのみ Dependabot に cargo・.gitignore に target/ を追加', () => {
    const dependabot = join(root, '.github/dependabot.yaml');
    const gitignore = join(root, '.gitignore');
    sync(root);
    expect(readFileSync(dependabot, 'utf8')).not.toMatch(/cargo/);
    expect(readFileSync(gitignore, 'utf8')).not.toMatch(/^target\/$/m);
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\n');
    expect(drifts(root).map((d) => d.path)).toEqual(['.gitignore', '.github/dependabot.yaml']);
    sync(root);
    expect(readFileSync(dependabot, 'utf8')).toMatch(/\n {2}- package-ecosystem: cargo\n/);
    expect(readFileSync(gitignore, 'utf8')).toMatch(/\ntarget\/\n$/);
    expect(drifts(root)).toEqual([]);
  });

  it('条件のファイルが複数あるリポは記載の順に追加', () => {
    writeFileSync(join(root, 'go.mod'), 'module example.com/x\n');
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\n');
    sync(root);
    const dependabot = readFileSync(join(root, '.github/dependabot.yaml'), 'utf8');
    expect(dependabot.indexOf('package-ecosystem: gomod')).toBeLessThan(dependabot.indexOf('package-ecosystem: cargo'));
    expect(drifts(root)).toEqual([]);
  });

  it('自動で修正できない差分', () => {
    writeFileSync(join(root, 'CLAUDE.md'), '# CLAUDE.md\n');
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 60\n');
    expect(sync(root).map((d) => d.path)).toEqual(['pnpm-workspace.yaml', 'CLAUDE.md']);
  });

  it('言語・UI の規約の import は条件に合うリポだけ求める', () => {
    writeFileSync(join(root, 'CLAUDE.md'), `# CLAUDE.md\n\n${IMPORT}\n`);
    sync(root);
    const missing = () => drifts(root).flatMap((d) => d.message.match(/rules-[a-z]+\.md/) ?? []);
    expect(missing()).toEqual([]);
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    writeFileSync(join(root, 'go.mod'), 'module example.com/x\n');
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ryusenkei: { ui: true } }));
    expect(missing()).toEqual(['rules-ts.md']);
    // 核の import の直後に追加
    sync(root);
    expect(missing()).toEqual([]);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe(['# CLAUDE.md', '', IMPORT, ...LANG_IMPORTS, ''].join('\n'));
  });
});
