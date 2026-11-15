import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { findEnvFile, onlyArgs, parseOnly, pushPlan, selectTargets, splitAssignments, type Target } from './env.ts';

describe('splitAssignments', () => {
  it('先頭の NAME=value だけを環境変数にする', () => {
    expect(splitAssignments(['A=1', 'B=x=y', 'pnpm', 'deploy', 'C=2'])).toEqual({ env: { A: '1', B: 'x=y' }, command: ['pnpm', 'deploy', 'C=2'] });
    expect(splitAssignments(['A=1'])).toEqual({ env: { A: '1' }, command: [] });
    expect(splitAssignments(['terraform', 'plan'])).toEqual({ env: {}, command: ['terraform', 'plan'] });
  });
});

describe('pushPlan', () => {
  const targets: Record<string, Target[]> = { TOKEN: ['github:secret', 'wrangler:secret:api'], ID: ['github:variable'], LOCAL: [] };

  it('配信先ごとに展開し、未定義・未設定の変数は飛ばす', () => {
    const plan = pushPlan({ TOKEN: 't', ID: '', LOCAL: 'x', EXTRA: 'e' }, targets);
    expect(plan.items.map((i) => `${i.key} ${i.target}`)).toEqual(['TOKEN github:secret', 'TOKEN wrangler:secret:api']);
    expect(plan.skips).toEqual(['EXTRA: 配信先が未定義（scripts/env.ts の targets に追加）', 'ID: 値が未設定']);
  });

  it('`only` は配信先の前方一致', () => {
    const plan = pushPlan({ TOKEN: 't', ID: 'i' }, targets, 'wrangler:');
    expect(plan.items.map((i) => i.target)).toEqual(['wrangler:secret:api']);
  });
});

describe('pushPlan の変数名の指定', () => {
  const targets: Record<string, Target[]> = { TOKEN: ['github:secret', 'wrangler:secret:api'], ID: ['github:variable'], LINE: ['wrangler:secret:api'] };

  it('変数名は指定した変数だけ、targets にない .env の変数は警告しない', () => {
    const plan = pushPlan({ TOKEN: 't', ID: 'i', LINE: 'l', EXTRA: 'e' }, targets, ['LINE', 'ID']);
    expect(plan.items.map((i) => `${i.key} ${i.target}`)).toEqual(['ID github:variable', 'LINE wrangler:secret:api']);
    expect(plan.skips).toEqual([]);
  });

  it('変数名と接頭辞は両方に合うもの', () => {
    const plan = pushPlan({ TOKEN: 't' }, targets, ['TOKEN', 'wrangler:']);
    expect(plan.items.map((i) => `${i.key} ${i.target}`)).toEqual(['TOKEN wrangler:secret:api']);
  });
});

describe('parseOnly・onlyArgs', () => {
  it('NAME の形は変数名、ほかは接頭辞', () => {
    expect(parseOnly(['LINE_TOKEN', 'github:', 'cloudflare'])).toEqual({ names: ['LINE_TOKEN'], prefixes: ['github:', 'cloudflare'] });
  });

  it('--only は複数を受け取る', () => {
    expect(onlyArgs(['--only', 'A', '--dry-run', '--only=github:'])).toEqual({ only: ['A', 'github:'], rest: ['--dry-run'] });
  });
});

describe('selectTargets', () => {
  it('値の有無に関係なく組を出す', () => {
    expect(selectTargets({ A: ['github:secret'], B: [] }, 'github:')).toEqual([{ key: 'A', target: 'github:secret' }]);
  });
});

describe('findEnvFile', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  let dir: string;
  let main: string;
  let worktree: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'env-file-')));
    main = join(dir, 'main');
    worktree = join(dir, 'wt');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    git(main, 'worktree', 'add', '-q', worktree);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => {
    rmSync(join(main, '.env'), { force: true });
    rmSync(join(worktree, '.env'), { force: true });
  });

  it('本体のチェックアウトではそのルートの .env', () => {
    writeFileSync(join(main, '.env'), 'A=1\n');
    expect(findEnvFile(main)).toEqual({ path: join(main, '.env'), from: 'worktree' });
  });

  it('worktree に .env がなければ本体のチェックアウトの .env', () => {
    writeFileSync(join(main, '.env'), 'A=1\n');
    expect(findEnvFile(worktree)).toEqual({ path: join(main, '.env'), from: 'main' });
  });

  it('worktree の .env があればそれを優先する', () => {
    writeFileSync(join(main, '.env'), 'A=1\n');
    writeFileSync(join(worktree, '.env'), 'A=2\n');
    expect(findEnvFile(worktree)).toEqual({ path: join(worktree, '.env'), from: 'worktree' });
  });

  it('どちらにもなければ undefined', () => {
    expect(findEnvFile(worktree)).toBeUndefined();
    expect(findEnvFile(main)).toBeUndefined();
  });

  it('git の外や bare のリポでは undefined', () => {
    expect(findEnvFile(dir, () => null)).toBeUndefined();
    expect(findEnvFile(worktree, () => join(dir, 'repo.git'))).toBeUndefined();
  });
});
