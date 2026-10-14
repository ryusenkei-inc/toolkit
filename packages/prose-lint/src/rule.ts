// 規則の共通の型
//   分類: 書式 `format`・文体 `style`・コミット `commit`
//   規則の ID = `<分類>/<名前>` → 設定の `rules` で ID ごとに無効化
export type Issue = { rule: string; message: string };

// `text` = 原文、`prose` = 判定対象外の範囲（コード・許可語）を空白に置換した文
// `sentences` = 1行の文の上限（コメント・コミットは1、Markdown は段落を折り返さない → 2）
export type Rule = { id: string; check: (text: string, prose: string, sentences: number) => string[] };

export type Vocabulary = { re: RegExp; to: string }[];

export const JA = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー]/u;

// 範囲を同じ長さの空白に置換（位置を保ったまま判定対象外にする）
export const mask = (text: string, re: RegExp) => text.replace(re, (m) => ' '.repeat(m.length));
