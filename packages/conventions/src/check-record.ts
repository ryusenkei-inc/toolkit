// 手元の検査の記録（CI が走らない・止まったときに、gh pr merge の関門を手元の検査で通すため）
// - pnpm check が成功し、作業ツリーに変更がないときに HEAD のコミットごとに書く。中身は検査した範囲（基準の ref、すべてなら `all`）
// - 置き場は git の共通のディレクトリ（worktree をまたいで1つ、追跡しない）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dirOf = (commonDir: string): string => join(commonDir, 'ryusenkei-check');

export function writeCheckRecord(commonDir: string, sha: string, covered: string): void {
  mkdirSync(dirOf(commonDir), { recursive: true });
  writeFileSync(join(dirOf(commonDir), sha), `${covered}\n`);
}

export function readCheckRecord(commonDir: string, sha: string): string | undefined {
  try {
    return readFileSync(join(dirOf(commonDir), sha), 'utf8').trim();
  } catch {
    return undefined;
  }
}

/** PR の base に向けた検査として足りるか（`origin/<base>` を基準にした検査か、すべての検査） */
export const coversBase = (covered: string | undefined, base: string): boolean => covered === 'all' || covered === `origin/${base}`;
