import { describe, expect, it } from 'vitest';
import { HOOK_PATH, hasStop, managedSettings } from './settings.ts';

describe('managedSettings', () => {
  const current = {
    model: 'x',
    permissions: { allow: ['Bash(ls:*)'], deny: ['Read(./secret)'] },
    hooks: {
      PostToolUse: [
        { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'npx --no -- prose-lint --hook' }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo own' }] },
      ],
    },
  };

  it('リポ独自の設定・hook を維持', () => {
    const s = managedSettings(current, { stop: false });
    expect(s.model).toBe('x');
    expect(s.permissions?.allow).toEqual(['Bash(ls:*)']);
    expect(s.permissions?.deny).toEqual(['Read(./secret)', 'Read(./**/.env)', 'Read(./**/.dev.vars)']);
    expect(s.hooks?.PostToolUse?.map((g) => g.hooks[0]!.command)).toEqual(['echo own', 'npx --no -- prose-lint --hook']);
    expect(s.attribution).toEqual({ commit: '', pr: '', sessionUrl: false });
  });

  it('文章の見直しのプラグインを有効化し、リポの無効化・独自のプラグインは維持', () => {
    const s = managedSettings(current, { stop: false });
    expect(Object.keys(s.extraKnownMarketplaces as object)).toEqual(['yomiyasu', 'humanizer']);
    expect(s.enabledPlugins).toEqual({ 'yomiyasu@yomiyasu': true, 'humanizer@humanizer': true });
    const own = managedSettings({ ...current, enabledPlugins: { 'humanizer@humanizer': false, 'x@y': true } }, { stop: false });
    expect(own.enabledPlugins).toEqual({ 'yomiyasu@yomiyasu': true, 'humanizer@humanizer': false, 'x@y': true });
  });

  it('再適用で変化しない', () => {
    const once = managedSettings(current, { stop: true });
    expect(managedSettings(once, { stop: true })).toEqual(once);
  });

  it('Stop の hook の登録・解除', () => {
    const on = managedSettings(current, { stop: true });
    expect(hasStop(on)).toBe(true);
    expect(on.hooks?.Stop?.[0]?.hooks[0]?.args).toEqual([HOOK_PATH]);
    expect(hasStop(managedSettings(on, { stop: false }))).toBe(false);
  });
});
