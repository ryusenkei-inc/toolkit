import { describe, expect, it } from 'vitest';
import { denyReason, type Checks, type Context } from './policy.ts';

const context = (o: { branch?: string; checks?: Checks; epic?: boolean; base?: string } = {}): Context => ({
  root: '/repo',
  titleIssues: (title) => (/^[a-z]+(\([a-z]+\))?: /.test(title) ? [] : ['Conventional Commits の書式']),
  readFile: (path) => {
    if (path.endsWith('body.md')) return '## 背景\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n';
    if (o.epic && path.replaceAll('\\', '/') === '/repo/package.json') return JSON.stringify({ ryusenkei: { flow: 'epic' } });
    return undefined;
  },
  currentBranch: () => o.branch ?? 'feat/x',
  prHead: (pr) => (pr === '7' ? 'dev/12-search' : (o.branch ?? 'feat/x')),
  prBase: () => o.base ?? 'main',
  prChecks: () => o.checks ?? 'pass',
});
const ctx = context();
const bash = (command: string, c = ctx) => denyReason({ tool_name: 'Bash', tool_input: { command }, cwd: '/repo' }, c);

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
    expect(bash('git commit --amend -m "feat: x"')).toBeUndefined();
  });
  it('一括の add を拒否', () => {
    for (const c of ['git add -A', 'git add --all', 'git add .', 'git add -- .', 'git add -u', 'git add --update', 'git add -Av', 'git commit -a -m "feat: x"', 'git commit -am "feat: x"', 'git commit --all -m x']) {
      expect(bash(c), c).toMatch('パスで指定して add');
    }
  });
  it('パスを指定した add・メッセージ中の -a は許可', () => {
    expect(bash('git add src/a.ts README.md')).toBeUndefined();
    expect(bash('git add -p src/a.ts')).toBeUndefined();
    expect(bash('git commit -m "-a"')).toBeUndefined();
    expect(bash('git commit -F msg.txt')).toBeUndefined();
  });
  it('main・master への force push を拒否', () => {
    expect(bash('git push --force origin main')).toMatch('force push');
    expect(bash('git push -f origin HEAD:master')).toMatch('force push');
    expect(bash('git push --force-with-lease origin main')).toMatch('ユーザーに');
    expect(bash('git push origin +main')).toMatch('force push');
    expect(bash('git push -fu origin refs/heads/main')).toMatch('force push');
    expect(bash('git push --force --all')).toMatch('force push');
    expect(bash('git push -f', context({ branch: 'main' }))).toMatch('force push');
  });
  it('作業ブランチへの force push・main への通常の push は許可', () => {
    expect(bash('git push --force-with-lease origin feat/x')).toBeUndefined();
    expect(bash('git push -f')).toBeUndefined();
    expect(bash('git push origin main')).toBeUndefined();
    expect(bash('git push -u origin HEAD')).toBeUndefined();
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
  it('CI の成功を確認できない PR のマージを拒否', () => {
    expect(bash('gh pr merge 3 --squash', context({ checks: 'fail' }))).toMatch('失敗');
    expect(bash('gh pr merge --squash --auto', context({ checks: 'pending' }))).toMatch('実行中');
    expect(bash('gh pr merge 3 --squash', context({ checks: 'none' }))).toMatch('チェックがない');
    expect(bash('gh pr merge 3 --squash', context({ checks: 'unknown' }))).toMatch('取得できない');
  });
  it('マージの対象の PR を判定に渡す', () => {
    const seen: (string | undefined)[] = [];
    const c = { ...ctx, prChecks: (pr: string | undefined) => (seen.push(pr), 'pass' as const) };
    bash('gh pr merge -t "feat: x" 12 --squash', c);
    bash('gh pr merge --squash', c);
    expect(seen).toEqual(['12', undefined]);
  });
});

describe('epic のフロー', () => {
  const epic = (branch = 'feat/x') => context({ epic: true, branch });
  it('opt-in なしは従来どおり', () => {
    expect(bash('git switch -c dev/12-search')).toMatch('<type>/<内容>');
    expect(bash('gh pr create -t "feat: x" -b y')).toBeUndefined();
  });
  it('dev/<issue>-<内容> のブランチを許可', () => {
    expect(bash('git switch -c dev/12-search', epic())).toBeUndefined();
    expect(bash('git switch -c dev/search', epic())).toMatch('dev/<issue の番号>-<内容>');
  });
  it('main への PR は dev/* からのみ', () => {
    expect(bash('gh pr create -t "feat: x" -b y', epic())).toMatch('`main` への PR');
    expect(bash('gh pr create -t "feat: x" -b y --base main', epic())).toMatch('`main` への PR');
    expect(bash('gh pr create -t "feat: x" -b y', epic('dev/12-search'))).toBeUndefined();
    expect(bash('gh pr create -t "feat: x" -b y -B main -H dev/12-search', epic())).toBeUndefined();
  });
  it('dev/* 以外のブランチの PR は dev/* へ', () => {
    expect(bash('gh pr create -t "feat: x" -b y -B dev/12-search', epic())).toBeUndefined();
    expect(bash('gh pr create -t "feat: x" -b y -B release', epic())).toMatch('PR の base');
  });
  it('dev/* への PR はチェックなしでマージを許可', () => {
    expect(bash('gh pr merge 3 --squash', context({ epic: true, checks: 'none', base: 'dev/12-search' }))).toBeUndefined();
    expect(bash('gh pr merge --squash --auto', context({ epic: true, checks: 'none', base: 'dev/12-search' }))).toBeUndefined();
  });
  it('dev/* への PR もチェックがあれば成功が必要', () => {
    expect(bash('gh pr merge 3 --squash', context({ epic: true, checks: 'pending', base: 'dev/12-search' }))).toMatch('実行中');
    expect(bash('gh pr merge 3 --squash', context({ epic: true, checks: 'fail', base: 'dev/12-search' }))).toMatch('失敗');
    expect(bash('gh pr merge 3 --squash', context({ epic: true, checks: 'unknown', base: 'dev/12-search' }))).toMatch('取得できない');
  });
  it('main への PR・opt-in なし・base の取得の失敗はチェックなしを拒否', () => {
    expect(bash('gh pr merge 3 --squash', context({ epic: true, checks: 'none', base: 'main' }))).toMatch('チェックがない');
    expect(bash('gh pr merge 3 --squash', context({ checks: 'none', base: 'dev/12-search' }))).toMatch('チェックがない');
    const unknownBase = { ...context({ epic: true, checks: 'none' }), prBase: () => undefined };
    expect(bash('gh pr merge 3 --squash', unknownBase)).toMatch('チェックがない');
  });
  it('base の判定にマージの対象の PR を渡す', () => {
    const seen: (string | undefined)[] = [];
    const c = { ...context({ epic: true, checks: 'none' }), prBase: (pr: string | undefined) => (seen.push(pr), 'dev/12-search') };
    expect(bash('gh pr merge 12 --squash', c)).toBeUndefined();
    expect(seen).toEqual(['12']);
  });
  it('gh pr edit は base の変更のみ検査', () => {
    expect(bash('gh pr edit 3 --body x', epic())).toBeUndefined();
    expect(bash('gh pr edit 3 --base main', epic())).toMatch('`main` への PR');
    expect(bash('gh pr edit 7 --base main', epic())).toBeUndefined();
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
