import { describe, expect, it } from 'vitest';
import { fixSpacing } from './format.ts';
import { commentIssues, textIssues as issues } from './text.ts';

const textIssues = (t: string) => issues(t).map((i) => i.message);
const comment = (t: string) => commentIssues(t).map((i) => i.message);

describe('文章の書式', () => {
  it('規則に合うコメント', () => {
    expect(textIssues('Notion の日付のみ（YYYY-MM-DD）は UTC 扱い → 更新日時より後にならないよう JST を明示')).toEqual([]);
    expect(textIssues('実装範囲: `prepare().bind().all()` のみ')).toEqual([]);
    expect(textIssues('不足している項目は held')).toEqual([]);
    expect(textIssues('作成日時を使用し、受け渡しは読み込み後')).toEqual([]);
    expect(textIssues('D1 の読み書きと読み取り専用の判定')).toEqual([]);
  });

  it('バージョンの意味の「版」だけを指摘する', () => {
    for (const t of ['版を上げる', '同じ版に上書き', 'タグと版の一致', '最新の版を取得', '版ごとに記録']) expect(textIssues(t)).toContain(`「${t.match(/(同じ|新しい|古い|前の|次の|最新の|各|旧|新)?版(を上げ|が上が|の一致|ごと)?/)![0]}」→ バージョン`);
    for (const t of ['出版社の記事', '初版の発行', 'Web 版と iOS 版', '日本語版のドキュメント', '図版の差し替え']) expect(textIssues(t).filter((i) => i.includes('バージョン'))).toEqual([]);
  });

  it('改名はリネーム', () => {
    expect(textIssues('ファイルを改名する')).toContain('「改名」→ リネーム');
    expect(textIssues('利用者向けの説明')).toContain('「利用者」→ ユーザー');
  });

  it('表記を統一する語', () => {
    const cases: [string, string][] = [
      ['ホワイトリストで照合', '「ホワイトリスト」→ 許可リスト'],
      ['エントリーポイントを指定', '「エントリーポイント」→ エントリポイント'],
      ['マスターのデータ', '「マスター」→ マスタ'],
      ['サーバで実行', '「サーバ」→ サーバー'],
      ['インタフェースの定義', '「インタフェース」→ インターフェース'],
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
    for (const t of ['サーバーで実行', 'インターフェースの定義', '同等の性能', '平等に扱う', '等しい値', '等幅フォント', '許可リストで照合']) expect(textIssues(t)).toEqual([]);
  });

  it('誤検出しない語', () => {
    for (const t of ['補足する', '満足した', '見直す', '素直さ', '取り消し', '解消する', '抹消した', '受け入れる', 'Web 版の違い', '言語版ごと', '出版番号', '最新版を取得', '出来事の一覧']) expect(textIssues(t)).toEqual([]);
  });

  it('見逃さない語', () => {
    for (const [t, w] of [['出来れば', '出来れ'], ['出来ず', '出来ず'], ['次の様だ', 'の様だ'], ['A 等）', '等'], ['A 等と B', '等']] as const) expect(textIssues(t)).toContain(textIssues(t).find((i) => i.startsWith(`「${w}」`)));
    expect(textIssues('出来れば')).toContain('「出来れ」→ できる');
  });

  it('構造の記号・URL・メールアドレスを詰めない', () => {
    for (const t of ['1. 取得の手順', '日本 - 説明', '値 -> 結果', 'https://example.com/?q=x日本', 'dev@example.com宛て']) expect(fixSpacing(t)).toBe(t);
  });

  it('文末の句点の後の空白で文を数えない', () => {
    expect(textIssues('1 行目。 ')).not.toContain('1 行に 1 文（文ごとに行を分割）');
  });

  it('違反を列挙する', () => {
    expect(textIssues('キャッシュを作る。')).toEqual(['末尾に句点を付けない', '「作る」→ 作成']);
    expect(textIssues('上限 (D1) の行')).toEqual(['括弧は全角（コードはバッククォート）']);
    expect(textIssues('A（B（C））')).toEqual(['括弧を入れ子にしない', '括弧の補足は 1 つまで']);
    const spacing = '和欧間のスペース（英字を含む語だけ空け、数字だけの語は詰める）';
    expect(textIssues('ブラウザのUAで再取得')).toEqual([spacing]);
    expect(textIssues('2 段の公開サフィックス')).toEqual([spacing]);
    expect(textIssues('許可リストのホストと 1回だけ再取得')).toEqual([spacing]);
    expect(textIssues('ホワイトリストに追加')).toEqual(['「ホワイトリスト」→ 許可リスト']);
    expect(textIssues('本文を取り出す')).toEqual(['「出す」→ 出力・表示・返却・抽出']);
  });

  it('和欧間のスペースは記事と同じ規則で直す', () => {
    expect(fixSpacing('2 段の上限は D1の上限と同じ（30% 以上・1 回）')).toBe('2段の上限は D1 の上限と同じ（30%以上・1回）');
    expect(fixSpacing('`prepare()`の 1 回')).toBe('`prepare()`の1回');
    expect(textIssues('MCP サーバーを束ねる')).toEqual(['「束ね」→ 集約']);
    expect(textIssues('A。B。C')).toEqual(['1 行の文は 2 つまで（超える場合は行を分割）']);
    expect(comment('A。B')).toEqual(['1 行に 1 文（文ごとに行を分割）']);
  });

  it('行の長さで URL は1字として数える', () => {
    const url = `https://example.com/${'a'.repeat(150)}`;
    expect(comment(`参考: ${url}`)).toEqual([]);
    expect(comment('あ'.repeat(101))).toEqual(['1 行は 100 字まで（101 字。行を分割）']);
  });
});
