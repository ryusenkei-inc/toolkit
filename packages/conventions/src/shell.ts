// シェルのコマンド文字列の簡易な分解（hook の判定用）
// - 区切り: `&&`・`||`・`;`・`|`・`&`・改行 → コマンドごとの語の配列
// - 解釈: 引用符（`'`・`"`）とバックスラッシュ → 変数・コマンド置換は展開しない
// - 先頭の `NAME=value`（環境変数の指定）は除去

/** コマンド文字列をコマンドごとの語の配列に分解 */
export function commands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = '';
  // 空の引用符（`""`）も1語
  let has = false;
  let quote: '"' | "'" | undefined;
  const endWord = () => {
    if (has) words.push(word);
    word = '';
    has = false;
  };
  const endCommand = () => {
    endWord();
    const start = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    if (start !== -1) out.push(words.slice(start));
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && '"\\$`'.includes(line[i + 1] ?? '')) word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < line.length) {
      const next = line[++i]!;
      if (next !== '\n') {
        word += next;
        has = true;
      }
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else if (c === '\n' || c === ';' || c === '&' || c === '|') {
      endCommand();
      if ((c === '&' || c === '|') && line[i + 1] === c) i++;
    } else {
      word += c;
      has = true;
    }
  }
  endCommand();
  return out;
}

/** オプションの値（`--name value`・`--name=value`・`-n value`）→ 指定がなければ `undefined` */
export function option(words: string[], names: string[]): string | undefined {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (names.includes(w)) return words[i + 1];
    const long = names.find((n) => n.startsWith('--') && w.startsWith(`${n}=`));
    if (long) return w.slice(long.length + 1);
  }
  return undefined;
}
