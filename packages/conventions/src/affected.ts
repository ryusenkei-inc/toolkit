// push の前の検査の範囲の決定（純粋な関数、実行は affected-check.ts）

/** 変更されたらすべてを検査するルートのファイル（依存の解決・テスト・TypeScript の設定など、影響の範囲を辿れないもの） */
export const GLOBAL_FILES = ['package.json', 'pnpm-workspace.yaml', 'mise.toml', '.npmrc', /^vitest\.config\.[cm]?[jt]s$/, /^tsconfig(\.[\w-]+)?\.json$/];

export type Candidate = { ref: string; mergeBase: string; ahead: number };

/**
 * 基準: PR の向き先として最も近いもの（分岐点から HEAD までのコミットが最も少ない候補、同数なら先の候補）
 * 候補は origin/main と epic の origin/dev/*。sub-issue のブランチは dev のブランチが、dev のブランチ自体は main が基準になる
 */
export function nearestBase(candidates: Candidate[]): Candidate | undefined {
  return candidates.reduce<Candidate | undefined>((best, c) => (best === undefined || c.ahead < best.ahead ? c : best), undefined);
}

export type Scope = { full: true; reason: string } | { full: false; dirs: string[]; root: boolean; tests: boolean };

/**
 * 変更から検査の範囲を決定
 * @param dirs ワークスペースのパッケージのディレクトリ
 * @param importers ルートの scripts/ を import するファイル（scripts/ の変更で型の検査の結果が変わる）
 * - pnpm-lock.yaml: package.json を変えたパッケージの依存の追加として扱い、どのパッケージの package.json も変わっていなければすべて
 * - root: パッケージの外の .ts の変更（ルートの tsc の対象）
 * - Markdown の変更は型検査・テストの対象にしない
 */
export function scopeOf(changed: string[], dirs: string[], importers: string[], globalFiles: (string | RegExp)[]): Scope {
  const hit = changed.find((f) => globalFiles.some((g) => (typeof g === 'string' ? f === g : g.test(f))));
  if (hit !== undefined) return { full: true, reason: `${hit} changed` };
  const manifests = changed.filter((f) => dirs.some((d) => f === `${d}/package.json`));
  if (changed.includes('pnpm-lock.yaml') && manifests.length === 0) return { full: true, reason: 'pnpm-lock.yaml changed without a package.json' };
  const code = changed.filter((f) => !f.endsWith('.md'));
  const affected = [...code, ...importers].map((f) => packageDirOf(dirs, f)).filter((d) => d !== undefined);
  return {
    full: false,
    dirs: [...new Set(affected)].sort(),
    root: code.some((f) => packageDirOf(dirs, f) === undefined && /\.[cm]?tsx?$/.test(f)),
    tests: code.length > 0,
  };
}

/** ファイルを含むワークスペースのパッケージ（最も深いディレクトリ、どれにも含まれなければ undefined） */
export function packageDirOf(dirs: string[], file: string): string | undefined {
  return dirs.filter((dir) => file.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0];
}
