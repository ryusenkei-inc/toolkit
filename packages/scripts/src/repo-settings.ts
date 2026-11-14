#!/usr/bin/env node
// GitHub のリポの設定（テンプレートから作ったリポには引き継がれないので、作成後に1回実行）
//   ryusenkei-repo-settings [owner/name]  省略時は作業ツリーのリポ
// - squash のコミットのタイトルは PR のタイトル、本文は空（コミットに body を書かない規約）
// - merge commit は epic のフローでも許可しない（dev から main へも squash）
// - 終了の状態: `gh` の終了の状態。使い方の誤りは2（`--help` は0）
import { execSync } from './exec.ts';
import { currentRepo } from './repo.ts';

const SETTINGS: Record<string, string | boolean> = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'BLANK',
  delete_branch_on_merge: true,
};

const USAGE = 'usage: ryusenkei-repo-settings [owner/name]';
const args = process.argv.slice(2);
if (args[0] === '--help' || args[0] === '-h') {
  console.log(USAGE);
  process.exit(0);
}
if (args.length > 1 || (args[0] !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(args[0]))) {
  console.error(USAGE);
  process.exit(2);
}
const repo = args[0] ?? currentRepo();
// 真偽値は `-F`（型付き）、文字列は `-f`
const fields = Object.entries(SETTINGS).flatMap(([key, value]) => [typeof value === 'boolean' ? '-F' : '-f', `${key}=${value}`]);
process.exitCode = execSync('gh', ['api', '-X', 'PATCH', `repos/${repo}`, ...fields, '--jq', `{name, ${Object.keys(SETTINGS).join(', ')}}`]);
