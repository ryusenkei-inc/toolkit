#!/usr/bin/env node
// 共通の規約の CLI（リポのルートで実行）
//   ryusenkei-conventions check         マスタとの差分の検査（差分あり → 終了コード1）
//   ryusenkei-conventions sync [--stop]  マスタに合わせて書き込み
//   --stop: 完了前の `pnpm lint`・`pnpm test` を Stop の hook に登録（省略時は現在の登録を維持）
// - 終了の状態: 差分なしは0、差分ありは1、使い方の誤りは2（`--help` は0）
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { drifts, sync } from './files.ts';

const USAGE = 'usage: ryusenkei-conventions <check|sync> [--stop]';
let parsed: { values: { stop?: boolean; help?: boolean }; positionals: string[] };
try {
  parsed = parseArgs({ allowPositionals: true, options: { stop: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
  process.exit(2);
}
const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const options = values.stop === undefined ? {} : { stop: values.stop };

switch (positionals[0]) {
  case 'check': {
    const found = drifts(root, options);
    for (const d of found) console.log(`${d.path}: ${d.message}`);
    if (found.some((d) => d.expected !== undefined)) console.log('→ `ryusenkei-conventions sync` で修正');
    process.exitCode = found.length ? 1 : 0;
    break;
  }
  case 'sync': {
    const rest = sync(root, options);
    for (const d of rest) console.log(`${d.path}: ${d.message}`);
    process.exitCode = rest.length ? 1 : 0;
    break;
  }
  default:
    console.error(USAGE);
    process.exitCode = 2;
}
