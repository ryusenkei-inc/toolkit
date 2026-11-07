import { describe, expect, it } from 'vitest';
import { checkManifest, checkSource, matches, ruleOf, specifiersOf, uncovered, under, type Rule, type Workspace } from './deps.ts';

const rules: Rule[] = [
  { name: 'エンジン', paths: ['packages/model'], allow: ['packages/model'] },
  { name: 'コア', paths: ['packages/cms-core'], allow: ['packages/model'], deny: ['cloudflare:', '@cloudflare/'] },
  { name: 'アダプタ', paths: ['packages/adapter-*'], allow: ['packages/model'] },
  { name: 'アプリ', paths: ['apps/admin'], allow: ['packages/model'] },
  { name: 'アプリの組み立て', paths: ['apps/admin/src/tenant.ts'], allow: ['packages/model', 'tenants'] },
  { name: '導入先', paths: ['tenants'], allow: ['packages/model'] },
];
const workspace: Workspace = new Map([
  ['@x/model', 'packages/model'],
  ['@x/cms-core', 'packages/cms-core'],
  ['@x/admin', 'apps/admin'],
  ['@x/tenant', 'tenants/a/config'],
  ['@x/content', 'tenants/a/content'],
]);
const check = (file: string, text: string) => checkSource(rules, workspace, [], file, text).map((v) => v.specifier);

describe('パスの照合', () => {
  it('区画の境界で一致、`*` は区画内', () => {
    expect(matches('packages/model/src/a.ts', 'packages/model')).toBe(true);
    expect(matches('packages/modeling/a.ts', 'packages/model')).toBe(false);
    expect(matches('packages/adapter-cloudflare/src/a.ts', 'packages/adapter-*')).toBe(true);
  });

  it('規則は最も具体的なパス', () => {
    expect(ruleOf(rules, 'apps/admin/src/tenant.ts')?.name).toBe('アプリの組み立て');
    expect(ruleOf(rules, 'apps/admin/src/main.tsx')?.name).toBe('アプリ');
  });

  it('パターンがディレクトリの下にあるか', () => {
    expect(under('packages/modules/*/src/server', 'packages/modules/contacts')).toBe(true);
    expect(under('packages/modules/*', 'packages/modules/contacts')).toBe(false);
    expect(under('apps/admin/src/tenant.ts', 'apps/admin')).toBe(true);
  });
});

describe('指定子の抽出', () => {
  it('import・export from・動的 import、コメントは対象外', () => {
    const text = "import a from 'a';\nimport type { B } from \"b\";\nexport * from './c.ts';\nimport {\n  d,\n} from 'd';\nconst e = await import('e');\n// import f from 'f';\nconst s = \"import g from 'g'\";";
    expect(specifiersOf(text, 'x.ts')).toEqual(['a', 'b', './c.ts', 'd', 'e']);
  });

  it('Astro はフロントマターと script', () => {
    const text = "---\nimport A from 'a';\n---\n<p>import b from 'b'</p>\n<script>import c from 'c';</script>";
    expect(specifiersOf(text, 'x.astro')).toEqual(['a', 'c']);
  });
});

describe('ソースの import の検査', () => {
  it('許可した先と同じパッケージの中は可', () => {
    expect(check('apps/admin/src/a.ts', "import '@x/model';\nimport './b.ts';\nimport '../../admin/src/c.ts';")).toEqual([]);
  });

  it('導入先は組み立てのファイルだけ', () => {
    expect(check('apps/admin/src/a.ts', "import '@x/tenant/site';")).toEqual(['@x/tenant/site']);
    expect(check('apps/admin/src/tenant.ts', "import '@x/tenant/site';")).toEqual([]);
  });

  it('パッケージの境界を越える相対パス', () => {
    expect(check('packages/model/src/a.ts', "import '../../cms-core/src/b.ts';")).toEqual(['../../cms-core/src/b.ts']);
  });

  it('apps は誰からも不可', () => {
    expect(check('packages/cms-core/src/a.ts', "import '@x/admin';")).toEqual(['@x/admin']);
  });

  it('禁止した外部のモジュール（cloudflare:*・@cloudflare/*）', () => {
    expect(check('packages/cms-core/src/a.ts', "import { env } from 'cloudflare:workers';\nimport type { D1Database } from '@cloudflare/workers-types';\nimport 'zod';")).toEqual(['cloudflare:workers', '@cloudflare/workers-types']);
  });

  it('導入先どうしは可', () => {
    expect(check('tenants/a/config/src/a.ts', "import '@x/content';")).toEqual([]);
  });

  it('例外に挙げた依存は可', () => {
    expect(checkSource(rules, workspace, [{ from: 'apps/admin/src/a.ts', to: 'tenants' }], 'apps/admin/src/a.ts', "import '@x/tenant';")).toEqual([]);
  });
});

describe('package.json の検査', () => {
  it('パッケージの中の組み立てのファイルの依存を含めて許可', () => {
    expect(checkManifest(rules, workspace, [], { dir: 'apps/admin', ruleAt: 'apps/admin', dependencies: ['@x/model', '@x/tenant', 'react'] })).toEqual([]);
  });

  it('許可していないパッケージ・禁止した外部のモジュール', () => {
    const found = checkManifest(rules, workspace, [], { dir: 'packages/cms-core', ruleAt: 'packages/cms-core', dependencies: ['@x/tenant', '@cloudflare/workers-types', 'zod'] });
    expect(found.map((v) => v.specifier)).toEqual(['@x/tenant', '@cloudflare/workers-types']);
  });
});

describe('モジュールの側', () => {
  const moduleRules: Rule[] = [
    { name: 'コア', paths: ['packages/cms-core'], allow: [] },
    { name: 'モジュール', paths: ['packages/modules/*'], allow: [] },
    { name: 'モジュールのサーバー', paths: ['packages/modules/*/src/server'], allow: ['packages/cms-core'] },
    { name: 'アプリ', paths: ['apps/admin'], allow: ['packages/modules/*'] },
    { name: 'サーバーの組み立て', paths: ['apps/server/src/tenant.ts'], allow: ['packages/modules/*', 'packages/modules/*/src/server'] },
  ];
  const ws: Workspace = new Map([['@x/cms-core', 'packages/cms-core'], ['@x/mod', 'packages/modules/m'], ['@x/mod/server', 'packages/modules/m/src/server/index.ts']]);
  const found = (file: string, text: string) => checkSource(moduleRules, ws, [], file, text).map((v) => v.specifier);

  it('許可したパスの下でも、より具体的な規則を持つサブパスの export は不可', () => {
    expect(found('apps/admin/src/a.ts', "import '@x/mod';\nimport '@x/mod/server';")).toEqual(['@x/mod/server']);
    expect(found('apps/server/src/tenant.ts', "import '@x/mod';\nimport '@x/mod/server';")).toEqual([]);
  });

  it('package.json: パッケージの中のワイルドカードの規則の依存を含めて許可', () => {
    expect(checkManifest(moduleRules, ws, [], { dir: 'packages/modules/m', ruleAt: 'packages/modules/m', dependencies: ['@x/cms-core'] })).toEqual([]);
  });

  it('サブパスの export は規則の検出の対象外', () => {
    expect(uncovered(moduleRules, ws)).toEqual([]);
  });
});

