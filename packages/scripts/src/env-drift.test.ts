import { describe, expect, it } from 'vitest';
import { driftStateOf, fingerprintOf, parseFingerprintRecord } from './env-drift.ts';

describe('fingerprintOf', () => {
  it('同じ値・塩・変数名で同じ、どれかが違えば違う。値を含まない', () => {
    const fp = fingerprintOf('TOKEN', 'secret-value', 'salt');
    expect(fp).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(fingerprintOf('TOKEN', 'secret-value', 'salt')).toBe(fp);
    expect(fingerprintOf('TOKEN', 'secret-valuf', 'salt')).not.toBe(fp);
    expect(fingerprintOf('TOKEN', 'secret-value', 'salt2')).not.toBe(fp);
    expect(fingerprintOf('OTHER', 'secret-value', 'salt')).not.toBe(fp);
  });
});

describe('driftStateOf', () => {
  const salt = 's';
  const fp = fingerprintOf('K', 'v', salt);

  it('秘密値は指紋で比べる', () => {
    expect(driftStateOf('K', 'v', { exists: true, fingerprint: fp }, salt)).toBe('same');
    expect(driftStateOf('K', 'w', { exists: true, fingerprint: fp }, salt)).toBe('differs');
    expect(driftStateOf('K', 'v', { exists: true }, salt)).toBe('unrecorded');
    expect(driftStateOf('K', 'v', { exists: false, fingerprint: fp }, salt)).toBe('missing');
  });

  it('読める値はそのまま比べる', () => {
    expect(driftStateOf('K', 'v', { exists: true, value: 'v' }, salt)).toBe('same');
    expect(driftStateOf('K', 'v', { exists: true, value: 'x' }, salt)).toBe('differs');
  });

  it('.env にない', () => {
    expect(driftStateOf('K', undefined, { exists: true }, salt)).toBe('not-in-env');
    expect(driftStateOf('K', '', { exists: false }, salt)).toBe('absent');
  });
});

describe('parseFingerprintRecord', () => {
  it('形が違うものは null', () => {
    expect(parseFingerprintRecord('{"salt":"a","targets":{}}')).toEqual({ salt: 'a', targets: {} });
    expect(parseFingerprintRecord('not json')).toBeNull();
    expect(parseFingerprintRecord('{"targets":{}}')).toBeNull();
    expect(parseFingerprintRecord(undefined)).toBeNull();
  });
});
