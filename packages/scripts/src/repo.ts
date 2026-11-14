import { execFileSync } from 'node:child_process';

/**
 * 作業ツリーの GitHub のリポ（`owner/name`）
 * - `gh` が git の remote から解決するので、リポ名をコードに持たない
 */
export const currentRepo = (options: Readonly<{ cwd?: string }> = {}): string =>
  execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { encoding: 'utf8', ...(options.cwd && { cwd: options.cwd }) }).trim();
