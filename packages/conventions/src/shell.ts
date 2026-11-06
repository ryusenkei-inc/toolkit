// シェルのコマンド文字列の簡易な分解（hook の判定用）
// - 区切り: `&&`・`||`・`;`・`|`・`&`・改行 → コマンドごとの語の配列
// - 解釈: 引用符（`'`・`"`）とバックスラッシュ → 変数・コマンド置換は展開しない
// - 先頭の `NAME=value`（環境変数の指定）は除去
// - heredoc の本文はコマンドとして分割しない。`"$(cat <<'EOF' ... EOF)"` のように引用符の中なら語の一部、外なら除去

const HEREDOC = /^<<(-?)[ \t]*(['"]?)([A-Za-z0-9_]+)\2/;

/** コマンド文字列をコマンドごとの語の配列に分解 */
export function commands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = '';
  // 空の引用符（`""`）も1語
  let has = false;
  let quote: '"' | "'" | undefined;
  // 次の改行の後に本文を読む heredoc の終端の語（`<<-` は行頭のタブを除いて照合）
  let heredocs: { end: string; tabs: boolean }[] = [];
  // 本文を読み、終端の行の後の改行の位置を返す
  const readHeredocs = (from: number) => {
    let at = from;
    const bodies: string[] = [];
    for (const { end, tabs } of heredocs) {
      const body: string[] = [];
      while (at < line.length) {
        const next = line.indexOf('\n', at);
        const stop = next === -1 ? line.length : next;
        const text = line.slice(at, stop);
        at = stop + 1;
        if ((tabs ? text.replace(/^\t+/, '') : text) === end) break;
        body.push(text);
      }
      bodies.push(body.join('\n'));
    }
    if (quote) word += bodies.join('\n');
    heredocs = [];
    return at - 1;
  };
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
    const heredoc = quote !== "'" && line.startsWith('<<', i) && line[i - 1] !== '<' && line[i + 2] !== '<' ? line.slice(i).match(HEREDOC) : null;
    if (heredoc) {
      heredocs.push({ end: heredoc[3]!, tabs: heredoc[1] === '-' });
      if (quote) word += heredoc[0];
      else endWord();
      i += heredoc[0].length - 1;
      continue;
    }
    if (c === '\n' && heredocs.length) {
      if (quote) word += c;
      else endCommand();
      // 終端の行の後の改行は通常の区切りとして次の周回で処理
      i = readHeredocs(i + 1) - 1;
      continue;
    }
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
