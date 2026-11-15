// CSV の書き出しと読み取り（RFC 4180。区切り、引用、改行、BOM、表計算で開くための選択肢）
// - 文字列を受けて文字列を返す。Shift_JIS などの文字コードの変換は使う側で行う（`TextDecoder`）
import { UsageError } from '../errors.ts';

/** 1つの値。`null` と `undefined` は空、真偽は `TRUE`・`FALSE`、有限でない数は空 */
export type CsvValue = string | number | boolean | null | undefined;

export type CsvEncodeOptions = Readonly<{
  /** 区切りの文字（既定は `,`）。1文字で、引用符と改行は使えない */
  delimiter?: string;
  /** 行の区切り（既定は `\r\n`） */
  newline?: '\r\n' | '\n';
  /** 引用符で囲む値。`needed`（既定）は区切り・引用符・改行を含む値だけ、`always` はすべて */
  quote?: 'needed' | 'always';
  /** 先頭に BOM を付ける（`encodeCsv` だけ） */
  bom?: boolean;
  /** `=`・`+`・`-`・`@`・タブ・CR で始まる文字列の先頭に `'` を付ける（表計算が式として実行しないように）。数は対象外 */
  formulaGuard?: boolean;
  /**
   * Excel で開く形にする: `bom`、`quote: 'always'`、`formulaGuard` の既定を `true` にし、行の区切りを `\r\n` にする
   * - 個別の選択肢を渡せば、それが勝つ
   */
  excel?: boolean;
}>;

/** 読み取りの失敗。`unterminated_quote` は閉じない引用符、`invalid_quote` は閉じた引用符の後の余分な文字 */
export type CsvParseError = 'unterminated_quote' | 'invalid_quote';

/** 読み取りの結果。失敗は `line` に行の番号（1から、引用の中の改行も数える） */
export type CsvParseResult = Readonly<{ ok: true; value: string[][] }> | Readonly<{ ok: false; error: CsvParseError; line: number }>;

export type CsvParseOptions = Readonly<{
  /** 区切りの文字（既定は `,`） */
  delimiter?: string;
}>;

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

const delimiterOf = (delimiter = ','): string => {
  if (delimiter.length !== 1 || /["\r\n]/.test(delimiter)) throw new UsageError('invalid_delimiter', `CSV の区切りの文字の誤り: ${JSON.stringify(delimiter)}`);
  return delimiter;
};

type Resolved = { delimiter: string; newline: string; quote: 'needed' | 'always'; bom: boolean; formulaGuard: boolean };

const resolve = (options: CsvEncodeOptions): Resolved => ({
  delimiter: delimiterOf(options.delimiter),
  newline: options.newline ?? '\r\n',
  quote: options.quote ?? (options.excel ? 'always' : 'needed'),
  bom: options.bom ?? options.excel === true,
  formulaGuard: options.formulaGuard ?? options.excel === true,
});

function cell(value: CsvValue, o: Resolved): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'boolean') text = value ? 'TRUE' : 'FALSE';
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else text = o.formulaGuard && FORMULA_START.test(value) ? `'${value}` : value;
  const needs = o.quote === 'always' || text.includes(o.delimiter) || /["\r\n]/.test(text);
  return needs ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * 1行の CSV（行の区切りと BOM は付けない）。行ごとに書き出してストリームで返すときに使う
 * - 区切りの文字の誤りは `UsageError`（`invalid_delimiter`）
 */
export function encodeCsvRow(row: readonly CsvValue[], options: CsvEncodeOptions = {}): string {
  const o = resolve(options);
  return row.map((v) => cell(v, o)).join(o.delimiter);
}

/**
 * 行の配列を CSV にする。最後の行にも行の区切りを付ける（行がなければ空、`bom` なら BOM だけ）
 * - 区切りの文字の誤りは `UsageError`（`invalid_delimiter`）
 */
export function encodeCsv(rows: readonly (readonly CsvValue[])[], options: CsvEncodeOptions = {}): string {
  const o = resolve(options);
  const body = rows.map((row) => row.map((v) => cell(v, o)).join(o.delimiter) + o.newline).join('');
  return (o.bom ? BOM : '') + body;
}

/**
 * CSV を行の配列に読む
 * - 先頭の BOM を除く。行の区切りは `\r\n`・`\n`・`\r` のどれでもよい。最後の行の区切りはあってもなくてもよい
 * - 引用の中の区切り、改行、`""` を戻す。引用のない値の中の `"` はそのまま（表計算と同じ）
 * - 空の行は `['']`。値の数は行ごとにそろえない（使う側で確かめる）
 * - 区切りの文字の誤りは `UsageError`（`invalid_delimiter`）
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const delimiter = delimiterOf(options.delimiter);
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let line = 1;
  let i = 0;
  const n = src.length;
  if (n === 0) return { ok: true, value: rows };
  for (;;) {
    let value = '';
    if (src[i] === '"') {
      const start = line;
      i += 1;
      for (;;) {
        if (i >= n) return { ok: false, error: 'unterminated_quote', line: start };
        const c = src[i]!;
        if (c === '"') {
          if (src[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (c === '\n' || (c === '\r' && src[i + 1] !== '\n')) line += 1;
        value += c;
        i += 1;
      }
      if (i < n && src[i] !== delimiter && src[i] !== '\r' && src[i] !== '\n') return { ok: false, error: 'invalid_quote', line };
    } else {
      const start = i;
      while (i < n && src[i] !== delimiter && src[i] !== '\r' && src[i] !== '\n') i += 1;
      value = src.slice(start, i);
    }
    row.push(value);
    if (i >= n) {
      rows.push(row);
      break;
    }
    if (src[i] === delimiter) {
      i += 1;
      continue;
    }
    // 行の区切り
    i += src[i] === '\r' && src[i + 1] === '\n' ? 2 : 1;
    line += 1;
    rows.push(row);
    row = [];
    if (i >= n) break;
  }
  return { ok: true, value: rows };
}
