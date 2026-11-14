#!/usr/bin/env node
// npm の依存のライセンスの検査
//   ryusenkei-licenses [--prod] [--allow <SPDX の ID>]... [--ignore <パッケージ名>]...
// - 許可の一覧は既定に `--allow` を足したもの。`--ignore` は確かめたパッケージ（理由をリポに書く）
// - 終了の状態: 問題なしは0、許可されない依存や pnpm の失敗は1、使い方の誤りは2（`--help` は0）
import { parseArgs } from 'node:util';
import { execOutputSync } from './exec.ts';
import { DEFAULT_ALLOWED_LICENSES, licenseViolations, type LicenseListing } from './licenses.ts';

const USAGE = 'usage: ryusenkei-licenses [--prod] [--allow <SPDX id>]... [--ignore <package>]...';
let values: { prod?: boolean; allow?: string[]; ignore?: string[]; help?: boolean };
try {
  ({ values } = parseArgs({ options: { prod: { type: 'boolean' }, allow: { type: 'string', multiple: true }, ignore: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } } }));
} catch (e) {
  console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
  process.exit(2);
}
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
// 失敗は null（標準エラーは execOutputSync がそのまま表示）
const stdout = execOutputSync('pnpm', ['licenses', 'list', '--json', ...(values.prod ? ['--prod'] : [])]);
if (stdout === null) process.exit(1);
const found = licenseViolations(JSON.parse(stdout || '{}') as LicenseListing, { allowed: [...DEFAULT_ALLOWED_LICENSES, ...(values.allow ?? [])], ignore: values.ignore ?? [] });
for (const line of found) console.error(line);
if (found.length > 0) {
  console.error('許可されないライセンスの依存 → 依存を変えるか、問題がなければ --allow か --ignore に足す（理由をリポに書く）');
  process.exit(1);
}
console.log('ライセンスの検査: 問題なし');
