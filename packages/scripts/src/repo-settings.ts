#!/usr/bin/env node
// GitHub のリポの設定（テンプレートから作ったリポには引き継がれないので、作成後に1回実行）
//   ryusenkei-repo-settings [owner/name]  省略時は作業ツリーのリポ
// - squash のコミットのタイトルは PR のタイトル、本文は空（コミットに body を書かない規約）
// - merge commit は epic のフローでも許可しない（dev から main へも squash）
import { exec } from './exec.ts';
import { currentRepo } from './repo.ts';

const SETTINGS: Record<string, string | boolean> = {
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: false,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'BLANK',
  delete_branch_on_merge: true,
};

const repo = process.argv[2] ?? currentRepo();
// 真偽値は `-F`（型付き）、文字列は `-f`
const fields = Object.entries(SETTINGS).flatMap(([key, value]) => [typeof value === 'boolean' ? '-F' : '-f', `${key}=${value}`]);
process.exitCode = exec('gh', ['api', '-X', 'PATCH', `repos/${repo}`, ...fields, '--jq', `{name, ${Object.keys(SETTINGS).join(', ')}}`]);
