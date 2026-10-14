// 和欧間のスペースの判定（ドキュメント・コメントの規則）
//   英字を含む語の前後は空け、数字だけの語は詰める
// - ノーブレークスペースで挿入（caller で通常のスペースに置換）
// - 対象外: コード・URL・メールアドレス

// 和文 = ひらがな・カタカナ・漢字・々ー
// 約物（句読点・括弧・中黒）は詰めたまま
const CJK = '\\u3005\\u3006\\u30fc\\u3041-\\u3096\\u30a1-\\u30fa\\u3400-\\u9fff\\uf900-\\ufaff';
// 欧文の語 = 英数字と、語中に現れる記号（2026-02-24・13,866・33.7%・GPT-5 など）
const WORD = 'A-Za-z0-9_%.,:\\-';

// 数字だけの語（単位・日付・章番号）は詰め、英字を含む語だけ空ける
// - 例: `16人`・`2026年2月`・`第1章`・`30%`
// バージョン番号も空け、小数・日付は詰める
//   例: `0.2.0` は空け、`2026.10.03` は詰める
const isVersion = (word: string) => /^\d+(\.\d+){2,}$/.test(word) && !/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(word);
const hasLetter = (word: string) => /[A-Za-z]/.test(word) || isVersion(word);
const trim = (word: string) => word.replace(/[.,:\-]+$/, '');

// 原稿に手で入ったスペースも対象（入力の有無によらず同じ結果にするため、空けるか詰めるかを再判定）
const BEFORE_RE = new RegExp(`([${CJK}])[ \u00a0]?([${WORD}]+)`, 'g');
const AFTER_RE = new RegExp(`([${WORD}]+)[ \u00a0]?([${CJK}])`, 'g');

export const autoSpace = (text: string): string =>
  text
    .replace(BEFORE_RE, (_m, cjk: string, word: string) => (hasLetter(word) ? `${cjk}\u00a0${word}` : `${cjk}${word}`))
    .replace(AFTER_RE, (_m, word: string, cjk: string) => (hasLetter(trim(word)) ? `${word}\u00a0${cjk}` : `${word}${cjk}`));
