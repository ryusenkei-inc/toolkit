import { describe, expect, it } from 'vitest';
import { defineForm, FORM_MESSAGES_JA, formMessage, multiLine, oneLine, parseForm, problemMessage } from './index.ts';

const LS = String.fromCharCode(0x2028);
const NEL = String.fromCharCode(0x85);

const inquiry = defineForm({
  fields: {
    company: { kind: 'text', maxLength: 100 },
    name: { kind: 'text', maxLength: 100, required: true },
    email: { kind: 'email', required: true },
    category: { kind: 'choice', choices: ['product', 'other'], required: true },
    url: { kind: 'url', maxLength: 500 },
    message: { kind: 'multiline', maxLength: 2000, required: true },
  },
});
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
};
const valid = { name: '山田', email: 'taro@example.com', category: 'product', message: '本文' };

describe('整形', () => {
  it('1行の項目は改行と制御文字を空白に（ヘッダーへの差し込みを防ぐ）', () => {
    expect(oneLine('担当者\r\nBcc: x@example.com')).toBe('担当者 Bcc: x@example.com');
    expect(oneLine(`a${LS}b${NEL}c\u0000d`)).toBe('a b c d');
  });

  it('複数行の項目は改行を \\n にそろえ、ほかの制御文字を消す', () => {
    expect(multiLine(`1行目\r\n2行目\r3行目${LS}4行目\u0007`)).toBe('1行目\n2行目\n3行目\n4行目');
  });
});

describe('parseForm', () => {
  it('正しい送信は整形した値を返し、未入力の任意の項目と宣言にない項目は含めない', () => {
    expect(parseForm(inquiry, form({ ...valid, company: '', extra: 'x', message: '  本文\r\n続き  ' }))).toEqual({
      ok: true,
      values: { name: '山田', email: 'taro@example.com', category: 'product', message: '本文\n続き' },
    });
  });

  it('項目ごとのコード（文言は持たない）', () => {
    const result = parseForm(inquiry, form({ name: 'x'.repeat(101), email: 'not-mail', category: 'evil', url: 'javascript:alert(1)', message: '' }));
    expect(result).toEqual({
      ok: false,
      problems: [
        { path: 'name', code: 'too_long', params: { max: 100 } },
        { path: 'email', code: 'invalid_email' },
        { path: 'category', code: 'invalid_choice' },
        { path: 'url', code: 'invalid_url' },
        { path: 'message', code: 'required' },
      ],
    });
  });

  it('メールアドレスは送信で弾かれる形（山括弧など）も拒否', () => {
    expect(parseForm(inquiry, form({ ...valid, email: 'a<b>@example.com' }))).toMatchObject({ ok: false, problems: [{ path: 'email', code: 'invalid_email' }] });
  });

  it('URL のホスト名の制約', () => {
    const f = defineForm({ fields: { url: { kind: 'url', maxLength: 500, hosts: ['example.com'] } } });
    expect(parseForm(f, { url: 'https://example.com/a' })).toEqual({ ok: true, values: { url: 'https://example.com/a' } });
    expect(parseForm(f, { url: 'https://evil.example.net/' })).toEqual({ ok: false, problems: [{ path: 'url', code: 'url_host' }] });
  });

  it('項目をまたぐ規則は、各項目の検査が通ったときだけ', () => {
    const f = defineForm({
      fields: { type: { kind: 'choice', choices: ['correction', 'other'], required: true }, url: { kind: 'url', maxLength: 500 } },
      refine: (v) => (v.type === 'correction' && !v.url ? [{ path: 'url', code: 'required' }] : []),
    });
    expect(parseForm(f, { type: 'correction' })).toEqual({ ok: false, problems: [{ path: 'url', code: 'required' }] });
    expect(parseForm(f, { type: 'other' }).ok).toBe(true);
    expect(parseForm(f, { type: 'bad' })).toEqual({ ok: false, problems: [{ path: 'type', code: 'invalid_choice' }] });
  });

  it('JSON のオブジェクトも受け取り、継承した値（__proto__ など）は読まない', () => {
    expect(parseForm(inquiry, { ...valid }).ok).toBe(true);
    expect(parseForm(defineForm({ fields: { toString: { kind: 'text', maxLength: 10, required: true } } }), {})).toEqual({ ok: false, problems: [{ path: 'toString', code: 'required' }] });
  });
});

describe('minLength と requiredWhen', () => {
  const contact = defineForm({
    fields: {
      type: { kind: 'choice', choices: ['correction', 'other'], required: true },
      url: { kind: 'url', maxLength: 2000, requiredWhen: { field: 'type', in: ['correction'] } },
      message: { kind: 'multiline', maxLength: 4000, minLength: 10, required: true },
    },
  });

  it('下限より短い値は too_short、参照する項目の値が一致すれば必須', () => {
    expect(parseForm(contact, { type: 'correction', message: '短い' })).toEqual({
      ok: false,
      problems: [
        { path: 'url', code: 'required' },
        { path: 'message', code: 'too_short', params: { min: 10 } },
      ],
    });
    expect(parseForm(contact, { type: 'other', message: 'じゅうぶんな長さの本文' })).toEqual({ ok: true, values: { type: 'other', message: 'じゅうぶんな長さの本文' } });
  });

  it('refine のない宣言は JSON にしても同じに検査できる', () => {
    const copied = JSON.parse(JSON.stringify(contact)) as typeof contact;
    expect(parseForm(copied, { type: 'correction', message: '短い' })).toEqual(parseForm(contact, { type: 'correction', message: '短い' }));
  });
});

describe('文言の辞書', () => {
  it('標準の文言に params を差し込み、上書きを優先し、知らないコードはそのまま', () => {
    expect(problemMessage({ path: 'message', code: 'too_short', params: { min: 10 } })).toBe('10文字以上で入力してください');
    expect(problemMessage({ path: 'url', code: 'url_host' }, { url_host: 'サイトの記事の URL を入力してください' })).toBe('サイトの記事の URL を入力してください');
    expect(formMessage('custom_rule')).toBe('custom_rule');
    expect(formMessage('rate_limited')).toBe(FORM_MESSAGES_JA.rate_limited);
  });
});
