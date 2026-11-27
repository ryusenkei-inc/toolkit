import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples.ts';
import { commitMessageIssues } from './commit.ts';
import { fixSpacing, removeSpacing } from './format.ts';
import type { Kind } from './rule.ts';
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
    ];
    for (const [text, issue] of cases) expect(textIssues(text)).toContain(issue);
    for (const t of ['サーバーで実行', 'インターフェースの定義', 'ユーザーの設定', '出来事の一覧']) expect(textIssues(t)).toEqual([]);
    for (const [t, w] of [['出来れば', '出来れ'], ['出来ず', '出来ず'], ['次の様だ', 'の様だ']] as const) expect(textIssues(t).some((i) => i.startsWith(`「${w}」`))).toBe(true);
  });

  it('語の選択（版・等）は判定しない', () => {
    for (const t of ['版を上げる', 'README 等の文書']) expect(textIssues(t)).toEqual([]);
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

describe('文の種類ごとの句点', () => {
  const found = (t: string, kind: Kind) => rules(t, { kind }).filter((r) => r === 'format/period');

  it('段落は句点が必要', () => {
    for (const t of ['削除する', '削除には `rm`', '設定する。`a` を使う', '削除する（公開済みを含む）', '詳しくは https://example.com を参照', '注意、次の点: 削除する', '時刻は10:00']) expect(found(t, 'paragraph')).toEqual(['format/period']);
  });

  it('文の終わり（閉じ括弧・強調・改行の指定を含む）', () => {
    for (const t of ['削除する。', '削除する（公開済みを含む。）', '「削除する。」', '**削除する。**', '削除する。  ', '削除する。\\', '削除する。<br>', '削除する？', '次のとおり:', '次のとおり：']) expect(found(t, 'paragraph')).toEqual([]);
  });

  it('注記・HTML・「キー: 値」の行・日本語のない行は対象外', () => {
    for (const t of [':::note[理由]', ':::', '  ::::tip[補足]', '<summary>詳細</summary>', '担当: 運用', '期限: `5m`', '**対象:** 公開の記事', '**対象**: 公開の記事', '`pnpm test`', 'Run the tests']) expect(found(t, 'paragraph')).toEqual([]);
  });

  it('箇条書きは判定しない', () => {
    expect(found('削除する', 'item')).toEqual([]);
    expect(found('削除する。', 'item')).toEqual([]);
  });

  it('コメント・コミット・見出し・表のセルは句点を付けない', () => {
    for (const kind of ['comment', 'commit', 'heading', 'cell'] as const) {
      expect(found('削除する。', kind)).toEqual(['format/period']);
      expect(found('削除する', kind)).toEqual([]);
    }
  });
});

describe('文の種類ごとの和欧間のスペース', () => {
  const found = (t: string, kind: Kind) => issues(t, { kind }).filter((i) => i.rule === 'format/spacing').map((i) => i.message);

  it('コメントは英字を含む語の前後を空ける', () => {
    expect(found('D1の上限', 'comment')).toEqual(['和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）']);
    expect(found('D1 の上限', 'comment')).toEqual([]);
  });

  it('文書・コミットは空けない', () => {
    for (const kind of ['paragraph', 'item', 'heading', 'cell', 'commit'] as const) {
      expect(found('D1 の上限', kind)).toEqual(['英単語と日本語の間に空白を入れない']);
      expect(found('D1の上限', kind)).toEqual([]);
    }
  });

  it('詰める範囲: 語・コード・リンク・強調の前後', () => {
    const cases: [string, string][] = [
      ['D1 の上限は 1 回', 'D1の上限は1回'],
      ['`pnpm check` を通す', '`pnpm check`を通す'],
      ['詳しくは [手順](https://example.com/a) を参照', '詳しくは[手順](https://example.com/a)を参照'],
      ['**D1** の値', '**D1**の値'],
      ['v0.2.0 で直す', 'v0.2.0で直す'],
      ['GPT-5 の登場', 'GPT-5の登場'],
    ];
    for (const [input, expected] of cases) expect(removeSpacing(input)).toBe(expected);
  });

  it('URL・メールアドレスの前後・コードの中・構造の記号は変えない', () => {
    for (const t of ['参照 https://example.com を見る', '宛先 dev@example.com に送る', '`a 日本`', '日本 - 説明', 'キー: 値', '値 -> 結果']) expect(removeSpacing(t)).toBe(t);
  });
});

describe('修正の例', () => {
  const check = (text: string, kind: Kind) => (kind === 'commit' ? commitMessageIssues(text).flatMap((f) => f.issues) : kind === 'comment' ? commentIssues(text) : issues(text, { kind }));
  for (const e of EXAMPLES) {
    it(`${e.rule}（${e.kind}）`, () => {
      expect(check(e.bad, e.kind).some((i) => i.rule === e.rule && (e.message === undefined || i.message === e.message))).toBe(true);
      expect(check(e.good, e.kind)).toEqual([]);
    });
  }
});
