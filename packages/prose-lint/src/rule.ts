// 規則の共通の型
//   分類: 書式 `format`・コミット `commit`
//   規則の ID = `<分類>/<名前>` → 設定の `rules` で ID ごとに無効化
export type Issue = { rule: string; message: string };

// 文の種類（句点と和欧間のスペースの規則が種類で変わる）
//   comment = コードのコメント、commit = コミットメッセージ
//   paragraph = Markdown の段落・引用、item = 箇条書き、heading = 見出し、cell = 表のセル
export type Kind = 'comment' | 'commit' | 'paragraph' | 'item' | 'heading' | 'cell';

// `text` = 原文、`prose` = 判定対象外の範囲（コード・許可語）を空白に置換した文
export type Rule = { id: string; check: (text: string, prose: string, kind: Kind) => string[] };

export type Vocabulary = { re: RegExp; to: string }[];

export const JA = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ー]/u;

// 範囲を同じ長さの空白に置換（位置を保ったまま判定対象外にする）
export const mask = (text: string, re: RegExp) => text.replace(re, (m) => ' '.repeat(m.length));
