import { describe, expect, it } from 'vitest';
import { GLOBAL_FILES, nearestBase, scopeOf } from './affected.ts';

const dirs = ['packages/core', 'packages/modules/art', 'apps/admin'];
const scope = (changed: string[], importers: string[] = []) => scopeOf(changed, dirs, importers, GLOBAL_FILES);

describe('基準', () => {
  it('分岐点から HEAD までが最も少ない候補、同数なら先の候補', () => {
    const main = { ref: 'origin/main', mergeBase: 'a', ahead: 30 };
    const dev = { ref: 'origin/dev/1-x', mergeBase: 'b', ahead: 2 };
    expect(nearestBase([main, dev])).toBe(dev);
    expect(nearestBase([main, { ...dev, ahead: 30 }])).toBe(main);
    expect(nearestBase([])).toBeUndefined();
  });
});

describe('範囲', () => {
  it('変更を含むパッケージ（最も深いディレクトリ）', () => {
    expect(scope(['packages/modules/art/src/a.ts', 'apps/admin/src/b.tsx', 'apps/admin/README.md'])).toEqual({ full: false, dirs: ['apps/admin', 'packages/modules/art'], root: false, tests: true });
  });

  it('ルートの設定の変更はすべて', () => {
    expect(scope(['package.json'])).toEqual({ full: true, reason: 'package.json changed' });
    expect(scope(['vitest.config.ts']).full).toBe(true);
    expect(scope(['tsconfig.base.json']).full).toBe(true);
    expect(scope(['apps/admin/tsconfig.json']).full).toBe(false);
  });

  it('pnpm-lock.yaml はパッケージの package.json の変更があればそのパッケージ、なければすべて', () => {
    expect(scope(['pnpm-lock.yaml', 'apps/admin/package.json'])).toMatchObject({ full: false, dirs: ['apps/admin'] });
    expect(scope(['pnpm-lock.yaml']).full).toBe(true);
  });

  it('パッケージの外の .ts はルートの型検査、scripts/ を import するパッケージも対象', () => {
    expect(scope(['scripts/lib/a.ts'], ['apps/admin/scripts/b.ts'])).toEqual({ full: false, dirs: ['apps/admin'], root: true, tests: true });
  });

  it('Markdown だけなら型検査・テストなし', () => {
    expect(scope(['README.md', 'packages/core/README.md'])).toEqual({ full: false, dirs: [], root: false, tests: false });
  });
});
