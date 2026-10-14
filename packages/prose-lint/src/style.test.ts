import { describe, expect, it } from 'vitest';
import { textIssues } from './text.ts';

const rules = (t: string, options: Parameters<typeof textIssues>[1] = {}) => textIssues(t, options).map((i) => i.rule);
const messages = (t: string) => textIssues(t).map((i) => i.message);

describe('文体', () => {
  it('追加した語彙', () => {
    const cases: [string, string][] = [
      ['原因を調べる', '「調べる」→ 調査・検査'],
      ['形式を決める', '「決める」→ 決定・指定'],
      ['処理を止める', '「止める」→ 停止'],
      ['候補を選ぶ', '「選ぶ」→ 選択'],
      ['ユーザの設定', '「ユーザ」→ ユーザー'],
    ];
    for (const [text, issue] of cases) expect(messages(text)).toContain(issue);
    for (const t of ['取り決める', '受け止める', '形の使い分け', 'ユーザーの設定', '戻り値']) expect(textIssues(t)).toEqual([]);
  });

  it('冗長な言い回し', () => {
    expect(messages('変更することができる')).toContain('「することができ」→ できる');
    expect(messages('確認を行う')).toContain('「を行う」→ 「〜する」（例: 確認を行う → 確認する）');
    expect(messages('本番においては無効')).toContain('「において」→ で');
    expect(textIssues('行の数を数える')).toEqual([]);
  });

  it('「の」の連続', () => {
    expect(messages('記事の取得の結果の型')).toEqual(['「記事の取得の結果の型」→ 「の」の連続は 2 つまで（複合語・語順で解消）']);
    // 除外の語（のみ・その）・括弧の外と中は別の句
    for (const t of ['Notion の日付のみの値', 'その中の実績の順', '記事の取得（API の呼び出しの結果）']) expect(rules(t)).toEqual([]);
    // 指摘はコードを含む原文で表示
    expect(messages('事業者の行（`a` の形）の書き込みの手順')).toEqual(['「事業者の行（`a` の形）の書き込みの手順」→ 「の」の連続は 2 つまで（複合語・語順で解消）']);
  });

  it('推量・敬体', () => {
    expect(rules('原因はキャッシュだと思う')).toEqual(['style/hedge']);
    expect(rules('キャッシュを無効化します')).toEqual(['style/polite']);
    expect(rules('ますます増加')).toEqual([]);
  });

  it('書式と文体の規則を ID で区別する', () => {
    expect(rules('キャッシュを作る。')).toEqual(['format/period', 'style/vocabulary']);
  });

  it('規則の無効化・許可語', () => {
    expect(rules('キャッシュを作る。', { disabled: new Set(['format/period']) })).toEqual(['style/vocabulary']);
    expect(rules('読み物のカテゴリー')).toEqual(['style/vocabulary']);
    expect(rules('読み物のカテゴリー', { allow: [/読み物/] })).toEqual([]);
    // 許可語の対象は文体だけ・書式は判定
    expect(rules('読み物 (仮)', { allow: [/読み物/] })).toEqual(['format/paren-width']);
  });
});
