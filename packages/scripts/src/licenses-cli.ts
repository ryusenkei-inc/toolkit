#!/usr/bin/env node
// npm の依存のライセンスの検査
//   ryusenkei-licenses [--prod] [--allow <SPDX の ID>]... [--ignore <パッケージ名>]...
// - 許可の一覧は既定に `--allow` を足したもの。`--ignore` は確かめたパッケージ（理由をリポに書く）
import { parseArgs } from 'node:util';
import { execOutput } from './exec.ts';
import { DEFAULT_ALLOWED_LICENSES, licenseViolations, type LicenseListing } from './licenses.ts';

const { values } = parseArgs({ options: { prod: { type: 'boolean' }, allow: { type: 'string', multiple: true }, ignore: { type: 'string', multiple: true } } });
// 失敗は null（標準エラーは execOutput がそのまま表示）
const stdout = execOutput('pnpm', ['licenses', 'list', '--json', ...(values.prod ? ['--prod'] : [])]);
if (stdout === null) process.exit(1);
const found = licenseViolations(JSON.parse(stdout || '{}') as LicenseListing, { allowed: [...DEFAULT_ALLOWED_LICENSES, ...(values.allow ?? [])], ignore: values.ignore ?? [] });
for (const line of found) console.error(line);
if (found.length > 0) {
  console.error('許可されないライセンスの依存 → 依存を変えるか、問題がなければ --allow か --ignore に足す（理由をリポに書く）');
  process.exit(1);
}
console.log('ライセンスの検査: 問題なし');
