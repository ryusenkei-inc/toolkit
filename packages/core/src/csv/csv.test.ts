import { describe, expect, it } from 'vitest';
import { encodeCsv, encodeCsvRow, parseCsv } from './index.ts';

describe('encodeCsv', () => {
  it('既定は RFC 4180: CRLF、区切り・引用符・改行を含む値だけを引用し、" を2つにする', () => {
    expect(encodeCsv([['id', '名前', 'メモ'], ['1', '山田, 太郎', '「"引用"」\n2行目']])).toBe('id,名前,メモ\r\n1,"山田, 太郎","「""引用""」\n2行目"\r\n');
  });

  it('値の種類: null と undefined は空、真偽は TRUE・FALSE、有限でない数は空', () => {
    expect(encodeCsvRow([null, undefined, true, false, 0, -1.5, Number.NaN, Number.POSITIVE_INFINITY, ''])).toBe(',,TRUE,FALSE,0,-1.5,,,');
  });

  it('行がなければ空。最後の行にも行の区切りを付ける', () => {
    expect(encodeCsv([])).toBe('');
    expect(encodeCsv([], { bom: true })).toBe('﻿');
    expect(encodeCsv([['a']], { newline: '\n' })).toBe('a\n');
  });

  it('区切りの文字を変えられ、その文字を含む値を引用する。誤りは UsageError', () => {
    expect(encodeCsv([['a\tb', 'c,d']], { delimiter: '\t' })).toBe('"a\tb"\tc,d\r\n');
    expect(encodeCsvRow(['a;b', 'c'], { delimiter: ';' })).toBe('"a;b";c');
    expect(() => encodeCsv([], { delimiter: '"' })).toThrow(expect.objectContaining({ name: 'UsageError', code: 'invalid_delimiter' }));
    expect(() => encodeCsvRow([], { delimiter: ',,' })).toThrow(expect.objectContaining({ code: 'invalid_delimiter' }));
  });

  it('excel は BOM、すべてを引用、式の先頭に \' を付ける。数は対象外', () => {
    expect(encodeCsv([['=SUM(A1)', '+1', '-1', '@x', '\tx', 'ok', -1]], { excel: true })).toBe(`﻿"'=SUM(A1)","'+1","'-1","'@x","'\tx","ok","-1"\r\n`);
  });

  it('excel の既定を個別の選択肢で変えられる', () => {
    expect(encodeCsv([['=a', 'b']], { excel: true, bom: false, quote: 'needed', formulaGuard: false })).toBe('=a,b\r\n');
    expect(encodeCsv([['a']], { excel: true, newline: '\n' })).toBe('﻿"a"\n');
  });
});

describe('parseCsv', () => {
  it('引用の中の区切り、改行、"" を戻し、BOM を除く', () => {
    expect(parseCsv('﻿id,名前,メモ\r\n1,"山田, 太郎","「""引用""」\r\n2行目"\r\n')).toEqual({ ok: true, value: [['id', '名前', 'メモ'], ['1', '山田, 太郎', '「"引用"」\r\n2行目']] });
  });

  it('行の区切りは CRLF・LF・CR のどれでもよく、最後の区切りはなくてもよい', () => {
    expect(parseCsv('a,b\nc,d\re,f\r\ng,h')).toEqual({ ok: true, value: [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']] });
    expect(parseCsv('a\n')).toEqual({ ok: true, value: [['a']] });
  });

  it('空の値、空の行、空の文字列', () => {
    expect(parseCsv('a,,\n\n"",b\n')).toEqual({ ok: true, value: [['a', '', ''], [''], ['', 'b']] });
    expect(parseCsv('')).toEqual({ ok: true, value: [] });
    expect(parseCsv('﻿')).toEqual({ ok: true, value: [] });
  });

  it('引用のない値の中の " はそのまま', () => {
    expect(parseCsv('a"b,c')).toEqual({ ok: true, value: [['a"b', 'c']] });
  });

  it('閉じない引用符と、閉じた後の余分な文字は失敗で、行の番号を返す', () => {
    expect(parseCsv('a\nb,"c\nd')).toEqual({ ok: false, error: 'unterminated_quote', line: 2 });
    expect(parseCsv('a\n"x\ny"z,b')).toEqual({ ok: false, error: 'invalid_quote', line: 3 });
  });

  it('区切りの文字を変えられる', () => {
    expect(parseCsv('a\t"b\tc"\n', { delimiter: '\t' })).toEqual({ ok: true, value: [['a', 'b\tc']] });
  });

  it('書き出しと読み取りで値が戻る', () => {
    const rows = [['id', 'text'], ['1', 'a,b\r\n"c"'], ['2', ''], ['3', ' 前後の空白 ']];
    for (const options of [{}, { excel: true, formulaGuard: false }, { delimiter: '\t', newline: '\n' as const }]) {
      expect(parseCsv(encodeCsv(rows, options), options)).toEqual({ ok: true, value: rows });
    }
  });
});
