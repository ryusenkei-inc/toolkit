import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { execCapture, execFiltered, execOutputSync, execSync } from './exec.ts';

const node = process.execPath;

describe('子プロセスの実行', () => {
  it('同期の実行は終了の状態と標準出力を返す', () => {
    expect(execSync(node, ['-e', 'process.exit(3)'], { stdio: 'ignore' })).toBe(3);
    expect(execOutputSync(node, ['-e', 'console.log(" out ")'])).toBe('out');
    expect(execOutputSync(node, ['-e', 'process.exit(1)'])).toBeNull();
  });

  it('非同期の実行は出力をまとめ、execFiltered は options を渡せる', async () => {
    expect(await execCapture(node, ['-e', 'console.log("a"); console.error("b")'])).toMatchObject({ status: 0, output: expect.stringContaining('a') });
    expect(await execFiltered(node, ['-e', 'process.exit(Number(process.env.CODE))'], () => false, { env: { ...process.env, CODE: '4' } })).toBe(4);
  });
});

describe('CLI の終了の状態', () => {
  const cli = (file: string, args: string[]) => spawnSync(node, [fileURLToPath(new URL(file, import.meta.url)), ...args], { encoding: 'utf8' });

  it('--help は0、使い方の誤りは2', () => {
    for (const file of ['./licenses-cli.ts', './repo-settings.ts', './search-console-cli.ts']) {
      const help = cli(file, ['--help']);
      expect([file, help.status, help.stdout]).toEqual([file, 0, expect.stringContaining('usage:')]);
    }
    expect(cli('./licenses-cli.ts', ['--nope']).status).toBe(2);
    expect(cli('./repo-settings.ts', ['a', 'b']).status).toBe(2);
    expect(cli('./search-console-cli.ts', ['nope']).status).toBe(2);
  });
});
