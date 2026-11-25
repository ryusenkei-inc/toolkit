import { describe, expect, it } from 'vitest';
import { spawnTarget } from './affected-check.ts';

describe('spawnTarget', () => {
  it('starts a JavaScript pnpm with node (POSIX path)', () => {
    expect(spawnTarget('pnpm', ['test'], '/usr/lib/pnpm/bin/pnpm.cjs')).toEqual({ file: process.execPath, argv: ['/usr/lib/pnpm/bin/pnpm.cjs', 'test'], shell: false });
    expect(spawnTarget('pnpm', ['test'], '/x/pnpm.mjs').file).toBe(process.execPath);
    expect(spawnTarget('pnpm', ['test'], '/x/pnpm.js').file).toBe(process.execPath);
  });

  it('starts a standalone pnpm.exe directly (Windows path)', () => {
    const exe = String.raw`C:\Users\a\.tools\pnpm-exe\10.28.0\pnpm.exe`;
    expect(spawnTarget('pnpm', ['-r', 'typecheck'], exe)).toEqual({ file: exe, argv: ['-r', 'typecheck'], shell: false });
  });

  it('starts pnpm.cmd through the shell', () => {
    expect(spawnTarget('pnpm', ['test'], String.raw`C:\pnpm\pnpm.CMD`).shell).toBe(true);
  });

  it('leaves other commands and a missing npm_execpath alone', () => {
    expect(spawnTarget('git', ['status'], '/x/pnpm.cjs')).toEqual({ file: 'git', argv: ['status'], shell: false });
    expect(spawnTarget('pnpm', ['test'], '')).toEqual({ file: 'pnpm', argv: ['test'], shell: false });
  });
});
