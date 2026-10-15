import { describe, expect, it } from 'vitest';
import { denyReason, type Context } from './policy.ts';

const ctx: Context = {
  titleIssues: (title) => (/^[a-z]+(\([a-z]+\))?: /.test(title) ? [] : ['Conventional Commits の書式']),
  readFile: (path) => (path.endsWith('body.md') ? '## 背景\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n' : undefined),
};
const bash = (command: string) => denyReason({ tool_name: 'Bash', tool_input: { command }, cwd: '/repo' }, ctx);

describe('パッケージ管理', () => {
  it('npm の変更・yarn を拒否', () => {
    expect(bash('npm install foo')).toMatch('pnpm のみ');
    expect(bash('cd a && npm i')).toMatch('pnpm のみ');
    expect(bash('yarn add foo')).toMatch('pnpm のみ');
  });
  it('npm の参照・npx・pnpm は許可', () => {
    expect(bash('npm view foo versions')).toBeUndefined();
    expect(bash('npx --no -- prose-lint')).toBeUndefined();
    expect(bash('pnpm add -D foo')).toBeUndefined();
  });
});

describe('git', () => {
  it('フックの省略を拒否', () => {
    expect(bash('git commit --no-verify -m "x"')).toMatch('--no-verify');
    expect(bash('git commit -nm "x"')).toMatch('-n');
    expect(bash('git push --no-verify')).toMatch('--no-verify');
  });
  it('git push -n・git commit --amend は許可', () => {
    expect(bash('git push -n')).toBeUndefined();
    expect(bash('git commit --amend -am "feat: x"')).toBeUndefined();
  });
  it('ブランチ名の検査', () => {
    expect(bash('git switch -c feature-x')).toMatch('<type>/<内容>');
    expect(bash('git checkout -b Fix/Bug')).toMatch('<type>/<内容>');
    expect(bash('git -C repo branch tmp')).toMatch('<type>/<内容>');
    expect(bash('git branch -m old wip')).toMatch('<type>/<内容>');
    expect(bash('git worktree add -b x ../x')).toMatch('<type>/<内容>');
    expect(bash('git switch -c feat/tag-filter')).toBeUndefined();
    expect(bash('git branch -D tmp')).toBeUndefined();
    expect(bash('git branch --show-current')).toBeUndefined();
    expect(bash('git switch main')).toBeUndefined();
  });
});

describe('PR', () => {
  it('タイトルの指定・書式', () => {
    expect(bash('gh pr create --fill')).toMatch('--title');
    expect(bash('gh pr create --title "記事の一覧" --body x')).toMatch('PR のタイトル');
    expect(bash('gh pr create --title "feat: 記事の一覧" --body x')).toBeUndefined();
    expect(bash('gh pr edit 3 --body x')).toBeUndefined();
  });
  it('本文の AI の署名を拒否', () => {
    expect(bash('gh pr create -t "feat: x" -b "a\n\nCo-Authored-By: Claude <noreply@anthropic.com>"')).toMatch('AI の署名');
    expect(bash('gh pr create -t "feat: x" --body-file body.md')).toMatch('AI の署名');
    expect(bash('gh pr create -t "feat: x" --body "生成した表を追加"')).toBeUndefined();
  });
  it('squash 以外のマージを拒否', () => {
    expect(bash('gh pr merge 3 --merge')).toMatch('squash');
    expect(bash('gh pr merge 3 --squash --delete-branch')).toBeUndefined();
  });
});

describe('ファイルの編集', () => {
  it('node_modules の編集を拒否', () => {
    const edit = (file_path: string) => denyReason({ tool_name: 'Edit', tool_input: { file_path } }, ctx);
    expect(edit('C:\\repo\\node_modules\\@ryusenkei\\x\\a.js')).toMatch('node_modules');
    expect(edit('/repo/src/node_modules.ts')).toBeUndefined();
  });
  it('対象外のツールは許可', () => {
    expect(denyReason({ tool_name: 'Read', tool_input: { file_path: '/repo/node_modules/a.js' } }, ctx)).toBeUndefined();
  });
});
