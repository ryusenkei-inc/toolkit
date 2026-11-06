import { describe, expect, it } from 'vitest';
import { commands, option } from './shell.ts';

describe('commands', () => {
  it('区切りでコマンドに分割', () => {
    expect(commands('cd a && git status; npm i || yarn | cat')).toEqual([['cd', 'a'], ['git', 'status'], ['npm', 'i'], ['yarn'], ['cat']]);
  });
  it('引用符・エスケープを解釈', () => {
    expect(commands(`gh pr create --title "feat: a && b" --body 'x; y' a\\ b ""`)).toEqual([['gh', 'pr', 'create', '--title', 'feat: a && b', '--body', 'x; y', 'a b', '']]);
  });
  it('先頭の環境変数の指定を除去', () => {
    expect(commands('CI=true FOO=1 pnpm install')).toEqual([['pnpm', 'install']]);
  });
  it('heredoc の本文は分割しない', () => {
    expect(commands("cat > a.md <<'EOF'\ngit add -A; x\n  EOF\nEOF\ngit status")).toEqual([['cat', '>', 'a.md'], ['git', 'status']]);
    expect(commands('cat <<-END\n\tgit push -f\n\tEND\nls')).toEqual([['cat'], ['ls']]);
    expect(commands(`gh pr create --body "$(cat <<'EOF'\na "b" c\nEOF\n)" --fill`)).toEqual([['gh', 'pr', 'create', '--body', `$(cat <<'EOF'\na "b" c\n)`, '--fill']]);
    expect(commands('cat <<< "x" && ls')).toEqual([['cat', '<<<', 'x'], ['ls']]);
  });
  it('引用符の中の改行は分割しない', () => {
    expect(commands('gh pr create --body "a\nb"\ngit status')).toEqual([['gh', 'pr', 'create', '--body', 'a\nb'], ['git', 'status']]);
  });
});

describe('option', () => {
  it('値の指定の形式', () => {
    expect(option(['-t', 'a'], ['--title', '-t'])).toBe('a');
    expect(option(['--title=b'], ['--title', '-t'])).toBe('b');
    expect(option(['--body', 'x'], ['--title', '-t'])).toBeUndefined();
  });
});
