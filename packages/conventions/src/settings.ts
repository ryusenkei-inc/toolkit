// `.claude/settings.json` の管理する項目
// - hook の登録・`attribution`・`permissions.deny`
// - リポ独自の設定・hook は維持

type Hook = { type: string; command: string; args?: string[] };
type Group = { matcher?: string; hooks: Hook[] };
/** `.claude/settings.json`（使用する項目のみ型付け） */
export type Settings = {
  hooks?: Record<string, Group[]>;
  permissions?: { deny?: string[]; [key: string]: unknown };
  [key: string]: unknown;
};

/** hook の本体のパス（`node` で直接実行 → Windows でもシェルを経由しない） */
export const HOOK_PATH = '${CLAUDE_PROJECT_DIR}/node_modules/@ryusenkei/conventions/dist/hook.js';
const HOOK: Hook = { type: 'command', command: 'node', args: [HOOK_PATH] };
const PROSE_LINT: Hook = { type: 'command', command: 'npx --no -- prose-lint --hook' };
// 秘密値のファイル（`.env.example` は対象外 → `.env.*` の指定は不可）
const DENY = ['Read(./**/.env)', 'Read(./**/.dev.vars)'];

const owned = (h: Hook) => (h.command === 'node' && h.args?.[0] === HOOK_PATH) || h.command.includes('prose-lint --hook');

/** Stop の hook（完了前の lint・test）が登録済みか */
export const hasStop = (s: Settings) => (s.hooks?.Stop ?? []).some((g) => g.hooks.some(owned));

/** 管理する項目を適用した設定 */
export function managedSettings(current: Settings, options: { stop: boolean }): Settings {
  const hooks: Record<string, Group[]> = {};
  for (const [event, groups] of Object.entries(current.hooks ?? {})) {
    const kept = groups.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !owned(h)) })).filter((g) => g.hooks.length);
    if (kept.length) hooks[event] = kept;
  }
  hooks.PreToolUse = [...(hooks.PreToolUse ?? []), { matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hooks: [HOOK] }];
  hooks.PostToolUse = [...(hooks.PostToolUse ?? []), { matcher: 'Edit|Write|MultiEdit', hooks: [PROSE_LINT] }];
  if (options.stop) hooks.Stop = [...(hooks.Stop ?? []), { hooks: [HOOK] }];
  const deny = [...new Set([...(current.permissions?.deny ?? []), ...DENY])];
  return {
    ...current,
    attribution: { commit: '', pr: '', sessionUrl: false },
    permissions: { ...current.permissions, deny },
    hooks,
  };
}
