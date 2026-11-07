// 依存の向きの検査の本体（規則は各リポの scripts/lib/deps-rules.ts）
import { createRequire } from 'node:module';
import { posix } from 'node:path';

// typescript は peerDependency。依存の向きの検査を使うときだけ読み込む（sync・check は typescript なしで動かす）
let tsModule: typeof import('typescript') | undefined;
const typescript = () => (tsModule ??= createRequire(import.meta.url)('typescript') as typeof import('typescript'));

/** 依存の向きの規則: paths のファイル・パッケージが依存してよい先 */
export type Rule = {
  /** 表示名（層） */
  name: string;
  /** 対象のパス（リポのルートから、`*` は区画内の任意の文字列） */
  paths: string[];
  /** 依存してよい先のパス（その下で別の規則を持つ、より具体的なパスは含まない） */
  allow: string[];
  /** 依存を禁止する外部のモジュールの接頭辞 */
  deny?: string[];
};

/** 規則の例外: from のファイルから to のパスへの依存を許可 */
export type Exception = { from: string; to: string };

/** 規則に反する依存 */
export type Violation = { file: string; specifier: string; rule: string; reason: string };

/** ワークスペースのパッケージ（名前 → ディレクトリ、`名前/サブパス` の export → ファイル） */
export type Workspace = Map<string, string>;

/** package.json の依存（dependencies・devDependencies・peerDependencies の名前） */
export type Manifest = {
  /** パッケージのディレクトリ（ルートは空文字列） */
  dir: string;
  /** 規則を引くパス（ルートの package.json はスクリプトの依存のため scripts） */
  ruleAt: string;
  dependencies: string[];
};

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|astro)$/;

function patternRegExp(pattern: string): RegExp {
  const body = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${body}(?:/|$)`);
}

/** パスがパターン（またはその下）に該当するか */
export function matches(path: string, pattern: string): boolean {
  return patternRegExp(pattern).test(path);
}

function bestRuleOf(rules: Rule[], path: string): { rule: Rule; pattern: string } | undefined {
  let best: { rule: Rule; pattern: string } | undefined;
  for (const rule of rules) {
    for (const p of rule.paths) {
      if (matches(path, p) && (!best || p.length > best.pattern.length)) best = { rule, pattern: p };
    }
  }
  return best;
}

/** パスに該当する規則（最も具体的なパターン、なければ undefined） */
export function ruleOf(rules: Rule[], path: string): Rule | undefined {
  return bestRuleOf(rules, path)?.rule;
}

/** パターンがディレクトリの下にあるか（`*` は区画内の任意の文字列） */
export function under(pattern: string, dir: string): boolean {
  const ps = pattern.split('/');
  const ds = dir.split('/');
  return ps.length > ds.length && ds.every((d, i) => patternRegExp(ps[i]!).test(d));
}

const packageNameOf = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
};

const packageDirs = (workspace: Workspace): string[] => [...workspace].filter(([name]) => packageNameOf(name) === name).map(([, dir]) => dir);

function packageDirOf(workspace: Workspace, path: string): string | undefined {
  let best: string | undefined;
  for (const dir of packageDirs(workspace)) {
    if (matches(path, dir) && (!best || dir.length > best.length)) best = dir;
  }
  return best;
}

function astroScripts(text: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return [frontmatter, ...scripts].join('\n');
}

/** ソースの import・export from・動的 import・require の指定子（コメントと文字列の中は対象外） */
export function specifiersOf(text: string, file: string): string[] {
  const code = file.endsWith('.astro') ? astroScripts(text) : text;
  const info = typescript().preProcessFile(code, true, true);
  return [...info.importedFiles, ...info.typeReferenceDirectives].map((f) => f.fileName);
}

type Target = { kind: 'path'; path: string } | { kind: 'external'; name: string };

function targetOf(workspace: Workspace, file: string, specifier: string): Target {
  if (specifier.startsWith('.')) {
    return { kind: 'path', path: posix.normalize(posix.join(posix.dirname(file), specifier.replace(/\?.*$/, ''))) };
  }
  const dir = workspace.get(specifier) ?? workspace.get(packageNameOf(specifier));
  return dir ? { kind: 'path', path: dir } : { kind: 'external', name: specifier };
}

function verdict(rules: Rule[], workspace: Workspace, exceptions: Exception[], from: string, fromRules: Rule[], target: Target): string | undefined {
  const deny = fromRules.flatMap((r) => r.deny ?? []);
  if (target.kind === 'external') {
    const hit = deny.find((d) => target.name.startsWith(d));
    return hit ? `${hit} は依存不可` : undefined;
  }
  const fromPackage = packageDirOf(workspace, from);
  if (fromPackage && fromPackage === packageDirOf(workspace, target.path)) return undefined;
  const to = bestRuleOf(rules, target.path);
  if (!to) return undefined;
  const toRule = to.rule;
  if (fromRules.includes(toRule)) return undefined;
  if (fromRules.some((r) => r.allow.some((a) => matches(target.path, a) && a.length >= to.pattern.length))) return undefined;
  if (exceptions.some((e) => matches(from, e.from) && matches(target.path, e.to))) return undefined;
  return `${toRule.name}（${target.path}）は依存不可`;
}

/** ソースの import の検査 */
export function checkSource(rules: Rule[], workspace: Workspace, exceptions: Exception[], file: string, text: string): Violation[] {
  if (!SOURCE_EXT.test(file)) return [];
  const rule = ruleOf(rules, file);
  if (!rule) return [];
  return specifiersOf(text, file).flatMap((specifier) => {
    const reason = verdict(rules, workspace, exceptions, file, [rule], targetOf(workspace, file, specifier));
    return reason ? [{ file, specifier, rule: rule.name, reason }] : [];
  });
}

/** package.json の依存の検査（規則: パッケージ自体と、中にある組み立てのファイルの和） */
export function checkManifest(rules: Rule[], workspace: Workspace, exceptions: Exception[], manifest: Manifest): Violation[] {
  const own = ruleOf(rules, manifest.ruleAt);
  if (!own) return [];
  const inner = manifest.dir === '' ? [] : rules.filter((r) => r !== own && r.paths.some((p) => matches(p, manifest.dir) || under(p, manifest.dir)));
  const file = posix.join(manifest.dir, 'package.json');
  return manifest.dependencies.flatMap((name) => {
    const reason = verdict(rules, workspace, exceptions, file, [own, ...inner], targetOf(workspace, file, name));
    return reason ? [{ file, specifier: name, rule: own.name, reason }] : [];
  });
}

/** 規則に該当しないワークスペースのパッケージ（新しいパッケージは規則の追加が必要） */
export function uncovered(rules: Rule[], workspace: Workspace): string[] {
  return packageDirs(workspace).filter((dir) => !ruleOf(rules, dir));
}
