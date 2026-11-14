// 項目の宣言・整形・検査（フレームワークとホストに依存しない）
import type { Problem } from '@ryusenkei/core';
import { isEmailAddress } from '../mail/index.ts';

/** 項目の種類。長さは HTML の `maxlength` と同じ UTF-16 の単位で数える */
export type FieldSpec =
  | Readonly<{ kind: 'text' | 'multiline'; maxLength: number }>
  | Readonly<{ kind: 'email'; maxLength?: number }>
  | Readonly<{ kind: 'url'; maxLength: number; hosts?: readonly string[] }>
  | Readonly<{ kind: 'choice'; choices: readonly string[] }>;

export type FieldEntry = FieldSpec & Readonly<{ required?: boolean }>;

export type FormValues<F extends string = string> = Partial<Record<F, string>>;

/**
 * フォームの宣言
 * - `fields` の順が、表示・検査・通知の本文の順
 * - `refine`: 項目をまたぐ規則（例: 種別が訂正なら URL が必須）。各項目の検査を通った値を受け取る
 */
export type Form<F extends string = string> = Readonly<{
  fields: Readonly<Record<F, FieldEntry>>;
  refine?: (values: FormValues<F>) => readonly Problem[];
}>;

/** 型の推論のための恒等関数（項目の名前がリテラル型になる） */
export const defineForm = <F extends string>(form: Form<F>): Form<F> => form;

/**
 * 検査のエラーコード（文言は画面側の辞書で引く）
 * - `too_long` は `params.max` に上限
 */
export type FieldErrorCode = 'required' | 'too_long' | 'invalid_email' | 'invalid_url' | 'url_host' | 'invalid_choice';

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

const read = (input: FormData | Readonly<Record<string, unknown>>, name: string): string => {
  const value = input instanceof FormData ? input.get(name) : Object.hasOwn(input, name) ? input[name] : undefined;
  return typeof value === 'string' ? value : '';
};

const normalize = (spec: FieldSpec, raw: string) => (spec.kind === 'multiline' ? multiLine(raw) : spec.kind === 'choice' ? raw : oneLine(raw));

function check(name: string, spec: FieldSpec, value: string): Problem | undefined {
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
      return value.length > spec.maxLength ? { path: name, code: 'too_long', params: { max: spec.maxLength } } : undefined;
  }
}

/**
 * 送信された値を整形して検査する
 * - 宣言にない項目は無視する
 * - 未入力の任意の項目は値に含めない
 */
export function parseForm<F extends string>(form: Form<F>, input: FormData | Readonly<Record<string, unknown>>): ParseResult<F> {
  const problems: Problem[] = [];
  const values: FormValues<F> = {};
  for (const name of Object.keys(form.fields) as F[]) {
    const entry = form.fields[name];
    const value = normalize(entry, read(input, name));
    if (!value) {
      if (entry.required) problems.push({ path: name, code: 'required' });
      continue;
    }
    const problem = check(name, entry, value);
    if (problem) problems.push(problem);
    else values[name] = value;
  }
  if (problems.length === 0 && form.refine) problems.push(...form.refine(values));
  return problems.length ? { ok: false, problems } : { ok: true, values };
}
