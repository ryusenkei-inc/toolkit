import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, textOptions } from './config.ts';

const repo = (files: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), 'prose-lint-'));
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(value));
  }
  return dir;
};

describe('設定', () => {
  it('なければ既定値', () => {
    expect(loadConfig(repo({})).source).toBeUndefined();
  });

  it('ルート・`.config/`・`package.json` のいずれか', () => {
    expect(loadConfig(repo({ 'prose-lint.json': { paths: ['src'] } })).config.paths).toEqual(['src']);
    expect(loadConfig(repo({ '.config/prose-lint.json': { paths: ['src'] } })).source).toBe('.config/prose-lint.json');
    expect(loadConfig(repo({ 'package.json': { name: 'x', 'prose-lint': { paths: ['src'] } } })).source).toBe('package.json#prose-lint');
    expect(loadConfig(repo({ 'package.json': { name: 'x' } })).source).toBeUndefined();
  });

  it('`--config` の指定を優先', () => {
    expect(loadConfig(repo({ 'prose-lint.json': {}, 'tools/lint.json': { paths: ['a'] } }), 'tools/lint.json').config.paths).toEqual(['a']);
  });

  it('複数・未知のキー・未知の規則は失敗', () => {
    expect(() => loadConfig(repo({ 'prose-lint.json': {}, '.config/prose-lint.json': {} }))).toThrow('設定が複数');
    expect(() => loadConfig(repo({ 'prose-lint.json': { path: ['src'] } }))).toThrow('未知のキー path');
    expect(() => loadConfig(repo({ 'prose-lint.json': { rules: { 'style/foo': false } } }))).toThrow('未知の規則 style/foo');
    // 0.2.0 で削除した文体の規則
    expect(() => loadConfig(repo({ 'prose-lint.json': { rules: { 'style/hedge': false } } }))).toThrow('未知の規則 style/hedge');
  });

  it('上書きは一致するファイルだけに順に適用', () => {
    const overrides = [
      { files: ['docs/**/*.md'], rules: { 'format/period': false, 'format/period-required': true } },
      { files: ['docs/brand/**'], rules: { 'format/period': true, 'format/period-required': false } },
    ];
    const { config } = loadConfig(repo({ 'prose-lint.json': { rules: { 'format/length': false }, overrides } }));
    const of = (file?: string) => {
      const { disabled, enabled } = textOptions(config, file);
      return { disabled: [...disabled].sort(), enabled: [...enabled] };
    };
    const base = { disabled: ['format/length'], enabled: [] };
    expect(of('docs/a.md')).toEqual({ disabled: ['format/length', 'format/period'], enabled: ['format/period-required'] });
    expect(of('docs/guide/b.md').enabled).toEqual(['format/period-required']);
    expect(of('docs/brand/c.md')).toEqual({ disabled: ['format/length', 'format/period-required'], enabled: [] });
    expect(of('README.md')).toEqual(base);
    expect(of('apps/docs/a.md')).toEqual(base);
    expect(of()).toEqual(base);
  });

  it('上書きの誤りは失敗', () => {
    const load = (overrides: unknown) => () => loadConfig(repo({ 'prose-lint.json': { overrides } }));
    expect(load({})).toThrow('配列');
    expect(load([{ rules: {} }])).toThrow('`files`');
    expect(load([{ files: 'docs/**', rules: {} }])).toThrow('`files`');
    expect(load([{ files: ['docs/**'] }])).toThrow('`rules`');
    expect(load([{ files: ['docs/**'], rules: {}, ignores: [] }])).toThrow('未知のキー ignores');
    expect(load([{ files: ['docs/**'], rules: { 'format/foo': true } }])).toThrow('overrides[0]: 未知の規則 format/foo');
  });

  it('規則の無効化と許可語', () => {
    const { config } = loadConfig(repo({ 'prose-lint.json': { rules: { 'format/notation': false, 'format/period': true }, allow: ['読み物'] } }));
    const options = textOptions(config);
    expect([...options.disabled]).toEqual(['format/notation']);
    expect(options.allow?.[0]?.test('読み物')).toBe(true);
  });
});
