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
  });

  it('規則の無効化と許可語', () => {
    const { config } = loadConfig(repo({ 'prose-lint.json': { rules: { 'style/hedge': false, 'format/period': true }, allow: ['読み物'] } }));
    const options = textOptions(config);
    expect([...options.disabled]).toEqual(['style/hedge']);
    expect(options.allow?.[0]?.test('読み物')).toBe(true);
  });
});
