#!/usr/bin/env node
// 日本語の文章（コメント・Markdown）の書式・文体をリポ単位で検査
//   違反 → 終了コード1
//   prose-lint [paths...] [--summary] [--fix] [--config <file>]
//   prose-lint --commit-msg <file>  コミットメッセージの検査（commit-msg フック）
//   prose-lint --hook               編集したファイルの検査（Claude Code の PostToolUse フック）
//   prose-lint --golden             手本（golden/）の表示
//   --fix: コメントの和欧間のスペースと、行末コメントの開始位置だけ自動修正
//     対象外: Markdown・語彙・構造 → 文脈の判断が必要
// 設定 = config.ts
// パスはリポのルートからの相対で判定
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { commitMessageIssues } from './commit.ts';
import { alignTrailing, commentKind, commentTexts, isGenerated, markdownTexts, trailingComment, wrappedLines } from './comments.ts';
import { loadConfig, textOptions } from './config.ts';
import { examplesFor } from './examples.ts';
import { fixSpacing } from './format.ts';
import type { Issue } from './rule.ts';
import { commentIssues, textIssues } from './text.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    summary: { type: 'boolean', default: false },
    fix: { type: 'boolean', default: false },
    hook: { type: 'boolean', default: false },
    golden: { type: 'boolean', default: false },
    'commit-msg': { type: 'string' },
    config: { type: 'string' },
  },
});

// 手本はパッケージに同梱（src・dist の1つ上）
const GOLDEN = ['GUIDE.md', 'comments.ts', 'commit.txt'];
if (values.golden) {
  for (const file of GOLDEN) console.log(`==> golden/${file}\n${readFileSync(new URL(`../golden/${file}`, import.meta.url), 'utf8')}`);
  process.exit(0);
}

// 引数のパスはリポのルートからの相対に変換してから移動（サブディレクトリから実行しても同じ結果）
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const commitMsg = values['commit-msg'] && resolve(values['commit-msg']);
const configFile = values.config && relative(root, resolve(values.config));
const args = positionals.map((p) => relative(root, resolve(p)).replaceAll('\\', '/') || '.');
process.chdir(root);

let loaded: ReturnType<typeof loadConfig>;
try {
  loaded = loadConfig('.', configFile);
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
const { config } = loaded;
const options = textOptions(config);
const format = (issues: Issue[]) => issues.map((i) => `${i.message} [${i.rule}]`).join(' / ');
// 修正の例（指摘のあった規則の分だけ）と手本の案内
const guide = (rules: Iterable<string>) => {
  const examples = examplesFor(rules);
  return [...(examples.length ? ['修正の例:', ...examples.map((e) => `  ${e}`)] : []), '手本: npx prose-lint --golden'].join('\n');
};

if (commitMsg) {
  const found = commitMessageIssues(readFileSync(commitMsg, 'utf8'), options);
  for (const f of found) console.log(`コミットメッセージ ${f.line} 行目: ${format(f.issues)}\n  ${f.text}`);
  if (found.length) console.log(guide(found.flatMap((f) => f.issues.map((i) => i.rule))));
  process.exit(found.length ? 1 : 0);
}

const never = /(?!)/;
const skip = config.skip ? new RegExp(config.skip) : never;
const trailingFiles = config.trailingFiles ? new RegExp(config.trailingFiles) : never;
const extension = new RegExp(`\\.(${config.extensions.join('|')})$`);
const alignOn = !options.disabled.has('format/trailing-align');

type Found = { where: string; text: string; issues: Issue[] };

// 1ファイルの検査（コメント・行末コメント・Markdown）
function check(file: string, source: string): Found[] {
  const out: Found[] = [];
  const add = (line: number, text: string, issues: Issue[]) => void (issues.length && out.push({ where: `${file}:${line}`, text, issues }));
  if (file.endsWith('.md')) {
    for (const { line, text } of markdownTexts(source)) add(line, text, textIssues(text, options));
    return out;
  }
  if (isGenerated(source)) return out;
  const spans = commentTexts(source, commentKind(file));
  const wrapped = new Set(options.disabled.has('format/wrap') ? [] : wrappedLines(spans));
  const wrap = { rule: 'format/wrap', message: '文を行の途中で改行しない（1行1文に分割・箇条書き）' };
  for (const s of spans) add(s.line, s.text, [...commentIssues(s.text, options), ...(wrapped.has(s.line) ? [wrap] : [])]);
  if (!trailingFiles.test(file)) return out;
  const lines = source.split(/\r?\n/);
  const aligned = alignTrailing(lines);
  lines.forEach((line, i) => {
    const text = trailingComment(line)?.text;
    if (text) add(i + 1, text, [...commentIssues(text, options), ...(alignOn && aligned[i] !== line ? [{ rule: 'format/trailing-align', message: '行末コメントの開始位置を統一' }] : [])]);
  });
  return out;
}

// フック: 標準入力の JSON（`tool_input.file_path`）のファイルだけ検査
//   未追跡のファイルも対象
//   対象外のファイル・違反なし → 終了コード0・出力なし
//   違反 → stderr に出力して終了コード2（Claude に返却）
if (values.hook) {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}') as { tool_input?: { file_path?: string } };
  const path = input.tool_input?.file_path;
  const file = path && relative(root, resolve(path)).replaceAll('\\', '/');
  const inPaths = (f: string) => config.paths.some((p) => p === '.' || f === p || f.startsWith(`${p.replace(/\/$/, '')}/`));
  if (!file || file.startsWith('..') || skip.test(file) || !existsSync(file) || !(file.endsWith('.md') || (extension.test(file) && inPaths(file)))) process.exit(0);
  const found = check(file, readFileSync(file, 'utf8'));
  if (!found.length) process.exit(0);
  console.error([...found.map((f) => `${f.where}: ${format(f.issues)}\n  ${f.text}`), guide(found.flatMap((f) => f.issues.map((i) => i.rule)))].join('\n'));
  process.exit(2);
}

// 追跡しているファイル
//   NUL 区切り → 日本語のパスをエスケープさせないため
// 作業ツリーで削除済み（未コミット）のファイルは対象外
const tracked = (pathspec: string[]) =>
  execFileSync('git', ['ls-files', '-z', '--', ...pathspec], { encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && !skip.test(f) && existsSync(f));
const files = tracked(args.length ? args : config.paths).filter((f) => extension.test(f));
// 引数があれば、その範囲の Markdown だけ
const docs = tracked(args.length ? args : config.docs).filter((f) => f.endsWith('.md'));

const found: Found[] = [];
for (const file of files) {
  let source = readFileSync(file, 'utf8');
  if (values.fix && !isGenerated(source)) {
    const lines = source.split(/\r?\n/);
    const fixed = [...lines];
    // 同じ行の範囲は後ろから置換（前の範囲の位置を保つ）
    for (const s of commentTexts(source, commentKind(file)).reverse()) fixed[s.line - 1] = fixed[s.line - 1]!.slice(0, s.start) + fixSpacing(s.text) + fixed[s.line - 1]!.slice(s.end);
    const result = trailingFiles.test(file) && alignOn ? alignTrailing(fixed, fixSpacing) : fixed;
    if (result.some((x, i) => x !== lines[i])) {
      source = result.join(source.includes('\r\n') ? '\r\n' : '\n');
      writeFileSync(file, source);
    }
  }
  found.push(...check(file, source));
}
for (const file of docs) found.push(...check(file, readFileSync(file, 'utf8')));

if (values.summary) {
  const counts = new Map<string, number>();
  for (const issue of found.flatMap((f) => f.issues)) {
    const key = `${issue.rule} ${issue.message.replace(/「.*」/, '「…」')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [issue, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${issue}`);
} else {
  for (const f of found) console.log(`${f.where}: ${format(f.issues)}\n  ${f.text}`);
  if (found.length) console.log(guide(found.flatMap((f) => f.issues.map((i) => i.rule))));
}
console.log(found.length ? `${found.length} 行` : '問題なし');
process.exitCode = found.length ? 1 : 0;
