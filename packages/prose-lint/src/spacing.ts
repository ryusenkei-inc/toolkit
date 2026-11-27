// 和欧間のスペースの判定
//   コメント = `autoSpace`（英字を含む語の前後は空け、数字だけの語は詰める）
//     ノーブレークスペースで挿入（caller で通常のスペースに置換）
//   文書・コミットメッセージ = `removeSpacing`（すべて詰める。表示上の間隔は CSS の `text-autospace`）

// 和文 = ひらがな・カタカナ・漢字・々ー
// 約物（句読点・括弧・中黒）は詰めたまま
export const CJK = '\\u3005\\u3006\\u30fc\\u3041-\\u3096\\u30a1-\\u30fa\\u3400-\\u9fff\\uf900-\\ufaff';
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

// 文書・コミットメッセージ: 和文と英数字の間のスペースを除去
//   英数字の側 = 語と、語に続く記号（`%`・強調の `*` `_`・リンクの `[` `](...)`・コード）
//   URL・メールアドレスの前後は空けたまま（GitHub の自動リンクは前に空白が必要で、後ろの和文まで含めるため）
//   コード・リンク先・URL・メールアドレスの中は変えない
const PROTECTED = /`[^`]*`|\]\([^)\s]*\)|https?:\/\/\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// 退避した範囲の目印: コード・リンク先 = U+E000〜U+E001（前後を詰める）、URL など = U+E002〜U+E003（後ろを空ける）
const LEFT = '[A-Za-z0-9%*_)\\]\\ue001]';
const RIGHT = '[A-Za-z0-9*_[(!\\ue000]';
const JOIN_AFTER_CJK = new RegExp(`([${CJK}])[ \u00a0]+(?=${RIGHT})`, 'g');
const JOIN_BEFORE_CJK = new RegExp(`(${LEFT})[ \u00a0]+(?=[${CJK}])`, 'g');
const RESTORE = /[\ue000\ue002](\d+)[\ue001\ue003]/g;

// 英単語（2字以上）の数がかなの字数より多い文は英語の文とみなし、変えない
//   英語の文の中の日本語の語: `a 特定商取引法 notice`・`tables under 書き方`
//   漢字と数字だけの文（`1 回`）は日本語の文として詰める
const KANA = /[\p{sc=Hiragana}\p{sc=Katakana}]/gu;
export const isEnglish = (text: string) => {
  const prose = text.replace(PROTECTED, '');
  return (prose.match(/[A-Za-z]{2,}/g)?.length ?? 0) > (prose.match(KANA)?.length ?? 0);
};

export function removeSpacing(text: string): string {
  if (isEnglish(text)) return text;
  const saved: string[] = [];
  const masked = text.replace(PROTECTED, (m) => {
    saved.push(m);
    return /^[`\]]/.test(m) ? `\ue000${saved.length - 1}\ue001` : `\ue002${saved.length - 1}\ue003`;
  });
  return masked
    .replace(JOIN_AFTER_CJK, '$1')
    .replace(JOIN_BEFORE_CJK, '$1')
    .replace(RESTORE, (_m, i: string) => saved[Number(i)]!);
}
