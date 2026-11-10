import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK = new URL('../files/pre-push', import.meta.url);
// git がフックに渡しうるリポの環境変数（`git rev-parse --local-env-vars`）
const LOCAL = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_PREFIX'];

let root: string;
let env: NodeJS.ProcessEnv;
const git = (args: string[]) => {
  const r = spawnSync('git', args, { cwd: join(root, 'repo'), env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conventions-pre-push-'));
  // 偽の pnpm: 検査の代わりに環境変数を書き出す
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\nenv > "${join(root, 'env.txt').replaceAll('\\', '/')}"\n`);
  chmodSync(join(bin, 'pnpm'), 0o755);
  // このテスト自体がフックから動く場合に備えて、受け取った git の環境変数を外す
  env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig') })) env[k] = v;

  mkdirSync(join(root, 'repo'));
  git(['init', '-q', '-b', 'main']);
  git(['init', '-q', '--bare', join(root, 'remote.git')]);
  mkdirSync(join(root, 'repo/.githooks'));
  copyFileSync(HOOK, join(root, 'repo/.githooks/pre-push'));
  chmodSync(join(root, 'repo/.githooks/pre-push'), 0o755);
  git(['config', 'core.hooksPath', '.githooks']);
  git(['commit', '-q', '--allow-empty', '-m', 'init']);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('pre-push', () => {
  it('検査に git のリポの環境変数を渡さない', () => {
    const repo = join(root, 'repo');
    // --git-dir・--work-tree の指定で、git はフックに GIT_DIR・GIT_WORK_TREE を渡す
    git([`--git-dir=${join(repo, '.git')}`, `--work-tree=${repo}`, 'push', '-q', join(root, 'remote.git'), 'main']);
    const vars = readFileSync(join(root, 'env.txt'), 'utf8')
      .split('\n')
      .map((l) => l.split('=')[0]);
    expect(vars).toContain('PATH');
    expect(vars.filter((v) => LOCAL.includes(v!))).toEqual([]);
  });
});
