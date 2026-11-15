// 項目の宣言・整形・検査（フレームワークとホストに依存しない）
import type { Problem } from '@ryusenkei/core';
import { isEmailAddress } from '../mail/index.ts';

/** 項目の種類。長さは HTML の `maxlength` と同じ UTF-16 の単位で数える */
export type FieldSpec =
  | Readonly<{ kind: 'text' | 'multiline'; maxLength: number; minLength?: number }>
  | Readonly<{ kind: 'email'; maxLength?: number }>
  | Readonly<{ kind: 'url'; maxLength: number; hosts?: readonly string[] }>
  | Readonly<{ kind: 'choice'; choices: readonly string[] }>
  | Readonly<{ kind: 'multiChoice'; choices: readonly string[]; minItems?: number; maxItems?: number }>;

/**
 * 別の項目の値がどれかに一致するときだけ必須にする（項目をまたぐ規則を、関数なしの宣言で書く）
 * - 参照する項目が `multiChoice` なら、選んだ値のどれかが `in` に含まれるとき
 */
export type RequiredWhen = Readonly<{ field: string; in: readonly string[] }>;

export type FieldEntry = FieldSpec & Readonly<{ required?: boolean; requiredWhen?: RequiredWhen }>;

/** 項目の値。`multiChoice` は選んだ値の配列（宣言の `choices` の順）、ほかは文字列 */
export type FieldValue = string | readonly string[];

export type FormValues<F extends string = string> = Partial<Record<F, FieldValue>>;

/**
 * フォームの宣言
 * - `fields` の順が、表示・検査・通知の本文の順
 * - `refine`: 宣言で書けない、項目をまたぐ規則。各項目の検査を通った値を受け取る
 * - `refine` を使わなければ宣言は JSON にできる（サーバーが配り、画面と受け取りの処理が同じ宣言で検査する）
 */
export type Form<F extends string = string> = Readonly<{
  fields: Readonly<Record<F, FieldEntry>>;
  refine?: (values: FormValues<F>) => readonly Problem[];
}>;

/** 型の推論のための恒等関数（項目の名前がリテラル型になる） */
export const defineForm = <F extends string>(form: Form<F>): Form<F> => form;

/**
 * 検査のエラーコード（文言は画面側の辞書で引く）
 * - `too_long`・`too_many` は `params.max`、`too_short`・`too_few` は `params.min` に上限・下限
 */
export type FieldErrorCode = 'required' | 'too_long' | 'too_short' | 'invalid_email' | 'invalid_url' | 'url_host' | 'invalid_choice' | 'too_many' | 'too_few';

export type ParseResult<F extends string = string> = Readonly<{ ok: true; values: FormValues<F> }> | Readonly<{ ok: false; problems: readonly Problem[] }>;

const DEFAULT_EMAIL_MAX = 254;
// 改行として扱われうる文字（C0 の制御文字、DEL、NEL、行・段落の区切り）
const SEPARATORS = String.fromCharCode(0x85, 0x2028, 0x2029);
const ONE_LINE_BREAKS = new RegExp(`[\\u0000-\\u001f\\u007f${SEPARATORS}]+`, 'g');
const LINE_BREAKS = new RegExp(`\\r\\n?|[${SEPARATORS}]`, 'g');

/** 1行の項目: 改行と制御文字を空白にする（メールのヘッダーへの差し込みを防ぐ） */
export const oneLine = (value: string): string => value.replace(ONE_LINE_BREAKS, ' ').trim();

/** 複数行の項目: 改行を `\n` にそろえ、それ以外の制御文字を消す */
export const multiLine = (value: string): string =>
  value
    .replace(LINE_BREAKS, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim();

type Input = FormData | Readonly<Record<string, unknown>>;

const read = (input: Input, name: string): string => {
  const value = input instanceof FormData ? input.get(name) : Object.hasOwn(input, name) ? input[name] : undefined;
  return typeof value === 'string' ? value : '';
};

// 複数選択は、フォームの同じ名前の値の全部か、JSON の文字列の配列（1つの文字列は1件）。文字列でない値は `null`（選択肢にない値として扱う）
const readAll = (input: Input, name: string): (string | null)[] => {
  const value = input instanceof FormData ? input.getAll(name) : Object.hasOwn(input, name) ? input[name] : undefined;
  const items: unknown[] = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  return items.filter((v) => v !== '').map((v) => (typeof v === 'string' ? v : null));
};

const normalize = (spec: FieldSpec, raw: string) => (spec.kind === 'multiline' ? multiLine(raw) : spec.kind === 'choice' ? raw : oneLine(raw));

function check(name: string, spec: Exclude<FieldSpec, { kind: 'multiChoice' }>, value: string): Problem | undefined {
  switch (spec.kind) {
    case 'choice':
      return spec.choices.includes(value) ? undefined : { path: name, code: 'invalid_choice' };
    case 'email': {
      const max = spec.maxLength ?? DEFAULT_EMAIL_MAX;
      if (value.length > max) return { path: name, code: 'too_long', params: { max } };
      return isEmailAddress(value) ? undefined : { path: name, code: 'invalid_email' };
    }
    case 'url': {
      if (value.length > spec.maxLength) return { path: name, code: 'too_long', params: { max: spec.maxLength } };
      const url = /^https?:\/\//i.test(value) ? URL.parse(value) : null;
      if (!url) return { path: name, code: 'invalid_url' };
      return spec.hosts && !spec.hosts.includes(url.hostname) ? { path: name, code: 'url_host' } : undefined;
    }
    default:
      if (value.length > spec.maxLength) return { path: name, code: 'too_long', params: { max: spec.maxLength } };
      return spec.minLength !== undefined && value.length < spec.minLength ? { path: name, code: 'too_short', params: { min: spec.minLength } } : undefined;
  }
}

function checkMany(name: string, spec: Extract<FieldSpec, { kind: 'multiChoice' }>, items: readonly (string | null)[]): Problem | readonly string[] {
  if (items.some((v) => v === null || !spec.choices.includes(v))) return { path: name, code: 'invalid_choice' };
  const picked = spec.choices.filter((c) => items.includes(c));
  if (spec.maxItems !== undefined && picked.length > spec.maxItems) return { path: name, code: 'too_many', params: { max: spec.maxItems } };
  if (spec.minItems !== undefined && picked.length < spec.minItems) return { path: name, code: 'too_few', params: { min: spec.minItems } };
  return picked;
}

/**
 * 送信された値を整形して検査する
 * - 宣言にない項目は無視する
 * - 未入力の任意の項目は値に含めない
 * - `requiredWhen` は、参照する項目の整形した値で判定する
 * - `multiChoice` の重複は1つにし、宣言の `choices` の順に並べる。1つも選ばなければ未入力
 */
export function parseForm<F extends string>(form: Form<F>, input: Input): ParseResult<F> {
  const problems: Problem[] = [];
  const values: FormValues<F> = {};
  const names = Object.keys(form.fields) as F[];
  const normalized = new Map<string, string | (string | null)[]>(names.map((name) => {
    const spec = form.fields[name];
    return [name, spec.kind === 'multiChoice' ? readAll(input, name) : normalize(spec, read(input, name))];
  }));
  const matches = (when: RequiredWhen) => {
    const value = normalized.get(when.field) ?? '';
    return typeof value === 'string' ? when.in.includes(value) : value.some((v) => v !== null && when.in.includes(v));
  };
  const required = (entry: FieldEntry) => entry.required === true || (entry.requiredWhen !== undefined && matches(entry.requiredWhen));
  for (const name of names) {
    const entry = form.fields[name];
    const value = normalized.get(name) ?? '';
    if (value.length === 0) {
      if (required(entry)) problems.push({ path: name, code: 'required' });
      continue;
    }
    if (entry.kind === 'multiChoice') {
      const result = checkMany(name, entry, value as (string | null)[]);
      if ('code' in result) problems.push(result);
      else values[name] = result;
      continue;
    }
    const problem = check(name, entry, value as string);
    if (problem) problems.push(problem);
    else values[name] = value as string;
  }
  if (problems.length === 0 && form.refine) problems.push(...form.refine(values));
  return problems.length ? { ok: false, problems } : { ok: true, values };
}

export { FORM_MESSAGES_JA, formMessage, problemMessage, type FormMessageCode, type FormMessageOptions, type FormMessages } from './messages.ts';
