// 配信した値と `.env` のずれの検出。秘密値は読み出せないので、配信したときの値の指紋を GitHub の variable に残して比べる
import { randomBytes, scryptSync } from 'node:crypto';

/** 指紋の記録（GitHub の variable に JSON で置く）。`targets` は配信先 → 変数名 → 指紋 */
export type FingerprintRecord = { salt: string; targets: Record<string, Record<string, string>> };

/**
 * 値の指紋（scrypt、塩と変数名つき、base64url の12文字）
 * - 値を推測で当てる試行を遅くするため scrypt にする。短い値（メールアドレスなど）は推測で確かめられうる
 */
export function fingerprintOf(key: string, value: string, salt: string): string {
  return scryptSync(value, `${salt}:${key}`, 9, { N: 2 ** 14 }).toString('base64url');
}

export const newFingerprintRecord = (): FingerprintRecord => ({ salt: randomBytes(16).toString('base64url'), targets: {} });

/** 記録の JSON を読む。形が違うものは null */
export function parseFingerprintRecord(text: string | undefined): FingerprintRecord | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { salt, targets } = parsed as Partial<FingerprintRecord>;
    return typeof salt === 'string' && typeof targets === 'object' && targets !== null ? { salt, targets } : null;
  } catch {
    return null;
  }
}

/**
 * ずれの状態
 * - `same`: 一致
 * - `differs`: 本番と違う
 * - `missing`: 本番にない
 * - `not-in-env`: 本番にあって `.env` にない
 * - `unrecorded`: 本番にあるが指紋の記録がない（比べられない）
 * - `absent`: どちらにもない
 */
export type DriftState = 'same' | 'differs' | 'missing' | 'not-in-env' | 'unrecorded' | 'absent';

/** 本番の側で分かること。`value` は読める値（GitHub の variable）、`fingerprint` は記録した指紋 */
export type RemoteState = { exists: boolean; value?: string; fingerprint?: string };

export function driftStateOf(key: string, local: string | undefined, remote: RemoteState, salt: string): DriftState {
  if (!local) return remote.exists ? 'not-in-env' : 'absent';
  if (!remote.exists) return 'missing';
  if (remote.value !== undefined) return remote.value === local ? 'same' : 'differs';
  if (remote.fingerprint === undefined) return 'unrecorded';
  return remote.fingerprint === fingerprintOf(key, local, salt) ? 'same' : 'differs';
}

export const DRIFT_LABELS: Record<DriftState, string> = {
  same: '一致',
  differs: '本番と違う',
  missing: '本番にない',
  'not-in-env': '.env にない',
  unrecorded: '記録なし（本番にあることだけ確認。push で記録）',
  absent: 'どちらにもない',
};

/** 終了コードを1にする状態 */
export const isDrift = (state: DriftState): boolean => state === 'differs' || state === 'missing' || state === 'not-in-env';
