#!/usr/bin/env node
// GitHub のリポの設定（テンプレートから作ったリポには引き継がれないので、作成後に1回実行）
//   ryusenkei-repo-settings [owner/name]  省略時は作業ツリーのリポ
// - squash のコミットのタイトルは PR のタイトル、本文は空（コミットに body を書かない規約）
// - epic のフロー（`package.json` の `"ryusenkei": { "flow": "epic" }`）では merge commit も許可
//   dev から main へのマージに使う
import { existsSync, readFileSync } from 'node:fs';
import { exec } from './exec.ts';
import { currentRepo } from './repo.ts';

const epic = existsSync('package.json') && (JSON.parse(readFileSync('package.json', 'utf8')) as { ryusenkei?: { flow?: unknown } }).ryusenkei?.flow === 'epic';
const SETTINGS: Record<string, string | boolean> = {
  allow_squash_merge: true,
  allow_merge_commit: epic,
  allow_rebase_merge: false,
  squash_merge_commit_title: 'PR_TITLE',
  squash_merge_commit_message: 'BLANK',
  ...(epic ? { merge_commit_title: 'PR_TITLE', merge_commit_message: 'BLANK' } : {}),
  delete_branch_on_merge: true,
};

const repo = process.argv[2] ?? currentRepo();
// 真偽値は `-F`（型付き）、文字列は `-f`
const fields = Object.entries(SETTINGS).flatMap(([key, value]) => [typeof value === 'boolean' ? '-F' : '-f', `${key}=${value}`]);
process.exitCode = exec('gh', ['api', '-X', 'PATCH', `repos/${repo}`, ...fields, '--jq', `{name, ${Object.keys(SETTINGS).join(', ')}}`]);
