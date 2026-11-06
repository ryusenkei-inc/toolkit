import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples.ts';
import { commitMessageIssues } from './commit.ts';
import { fixSpacing } from './format.ts';
import { commentIssues, textIssues as issues } from './text.ts';

const textIssues = (t: string) => issues(t).map((i) => i.message);
const rules = (t: string, options: Parameters<typeof issues>[1] = {}) => issues(t, options).map((i) => i.rule);
const comment = (t: string) => commentIssues(t).map((i) => i.message);

describe('文章の書式', () => {
  it('規則に合うコメント', () => {
    expect(textIssues('Notion の日付のみ（YYYY-MM-DD）は UTC 扱い → 更新日時より後にならないよう JST を明示')).toEqual([]);
    expect(textIssues('実装範囲: `prepare().bind().all()` のみ')).toEqual([]);
    expect(textIssues('不足している項目は held')).toEqual([]);
  });

  it('語の選択・文体は判定しない', () => {
    for (const t of ['キャッシュを作る', '原因を調べる', '確認を行う', '記事の取得の結果の型', '原因はキャッシュだと思う', 'キャッシュを削除します', 'ファイルを改名する', '呼び出し側で選ぶ', 'A。B。C', '対象（記事（公開済み））の日付（JST）']) expect(textIssues(t)).toEqual([]);
  });

  it('表記の揺れ', () => {
    const cases: [string, string][] = [
      ['エントリーポイントを指定', '「エントリーポイント」→ エントリポイント'],
      ['マスターのデータ', '「マスター」→ マスタ'],
      ['サーバで実行', '「サーバ」→ サーバー'],
      ['インタフェースの定義', '「インタフェース」→ インターフェース'],
      ['ユーザの設定', '「ユーザ」→ ユーザー'],
      ['設定出来る', '「出来る」→ できる'],
      ['全てのファイル', '「全て」→ すべて'],
      ['A 又は B', '「又は」→ または'],
      ['A 及び B', '「及び」→ および'],
      ['次の様に書く', '「の様に」→ のように・のような'],
      ['確認して下さい', '「下さい」→ ください'],
      ['予め設定', '「予め」→ あらかじめ'],
      ['殆どの場合', '「殆ど」→ ほとんど'],
      ['既に登録済み', '「既に」→ すでに'],
      ['README 等の文書', '「等」→ など'],
    ];
    for (const [text, issue] of cases) expect(textIssues(text)).toContain(issue);
    for (const t of ['サーバーで実行', 'インターフェースの定義', 'ユーザーの設定', '同等の性能', '平等に扱う', '等しい値', '等幅フォント', '出来事の一覧']) expect(textIssues(t)).toEqual([]);
    for (const [t, w] of [['出来れば', '出来れ'], ['出来ず', '出来ず'], ['次の様だ', 'の様だ'], ['A 等）', '等'], ['A 等と B', '等']] as const) expect(textIssues(t).some((i) => i.startsWith(`「${w}」`))).toBe(true);
  });

  it('構造の記号・URL・メールアドレスを詰めない', () => {
    for (const t of ['1. 取得の手順', '日本 - 説明', '値 -> 結果', 'https://example.com/?q=x日本', 'dev@example.com宛て']) expect(fixSpacing(t)).toBe(t);
  });

  it('違反を列挙する', () => {
    expect(textIssues('全て削除する。')).toEqual(['末尾に句点を付けない', '「全て」→ すべて']);
    expect(textIssues('上限 (D1) の行')).toEqual(['括弧は全角（コードはバッククォート）']);
    expect(textIssues('期限：5分')).toEqual(['コロンは半角（キー: 値）']);
    const spacing = '和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）';
    expect(textIssues('ブラウザのUAで再取得')).toEqual([spacing]);
    expect(textIssues('2 段の公開サフィックス')).toEqual([spacing]);
    expect(textIssues('許可リストのホストと 1回だけ再取得')).toEqual([spacing]);
  });

  it('規則の無効化・許可語', () => {
    expect(rules('全て削除する。', { disabled: new Set(['format/period']) })).toEqual(['format/notation']);
    expect(rules('サーバ管理の画面')).toEqual(['format/notation']);
    expect(rules('サーバ管理の画面', { allow: [/サーバ管理/] })).toEqual([]);
    // 許可語の対象は表記だけ・書式は判定
    expect(rules('サーバ管理 (仮)', { allow: [/サーバ管理/] })).toEqual(['format/paren-width']);
  });

  it('和欧間のスペースは記事と同じ規則で直す', () => {
    expect(fixSpacing('2 段の上限は D1の上限と同じ（30% 以上・1 回）')).toBe('2段の上限は D1 の上限と同じ（30%以上・1回）');
    expect(fixSpacing('`prepare()`の 1 回')).toBe('`prepare()`の1回');
  });

  it('行の長さで URL は1字として数える', () => {
    const url = `https://example.com/${'a'.repeat(150)}`;
    expect(comment(`参考: ${url}`)).toEqual([]);
    expect(comment('あ'.repeat(101))).toEqual(['1 行は 100 字まで（101 字。行を分割）']);
  });
});

describe('修正の例', () => {
  for (const [id, [bad, good]] of Object.entries(EXAMPLES)) {
    it(id, () => {
      const found = id.startsWith('commit/') ? commitMessageIssues(bad).flatMap((f) => f.issues) : commentIssues(bad);
      expect(found.map((i) => i.rule)).toContain(id);
      expect(id.startsWith('commit/') ? commitMessageIssues(good) : commentIssues(good)).toEqual([]);
    });
  }
});
