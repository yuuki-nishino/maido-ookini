// お渡しの目安（#70）。時刻は日本時間
import { describe, expect, it } from 'vitest';
import { etaError, etaToTimeInput, formatEta, parseEta } from '../../src/lib/domain/eta';

// 2026-10-19 13:05（日本時間）＝ 04:05Z
const now = new Date('2026-10-19T04:05:00Z');

describe('parseEta・etaError（その日だけ。#70）', () => {
  const at = (s: string, n = now) => {
    const r = parseEta(s, n);
    return r.ok ? new Date(r.etaAt).toISOString() : r.reason;
  };
  it('その日の時刻（日本時間）', () => {
    expect(at('14:30')).toBe('2026-10-19T05:30:00.000Z');
    expect(at('9:05', new Date('2026-10-18T23:00:00Z'))).toBe('2026-10-19T00:05:00.000Z'); // 日本時間 8:00 に入れた 9:05
  });
  it('いまより前は past（翌日にしない）。いまと同じ分は受け付ける', () => {
    expect(at('09:00')).toBe('past');
    expect(at('13:04')).toBe('past');
    expect(at('13:05')).toBe('2026-10-19T04:05:00.000Z');
    expect(at('13:05', new Date('2026-10-19T04:05:59Z'))).toBe('2026-10-19T04:05:00.000Z');
    expect(at('13:05', new Date('2026-10-19T04:06:00Z'))).toBe('past');
    expect(etaError('09:00', now)).toBe('いまより後の時刻を入れてください');
  });
  it('日本時間の日付の境目（UTC では前の日）でも、日本時間の日付で考える', () => {
    // 日本時間 2026-10-20 00:30 ＝ 2026-10-19T15:30Z。「01:00」は、日本時間 10/20 の 1:00
    expect(at('01:00', new Date('2026-10-19T15:30:00Z'))).toBe('2026-10-19T16:00:00.000Z');
  });
  it('不正なら invalid。空はエラーにしない（未定）', () => {
    for (const s of ['abc', '24:00', '12:60', '1230', '12:3']) expect(at(s)).toBe('invalid');
    expect(etaError('abc', now)).toBe('時刻を入れてください');
    expect(etaError('', now)).toBeNull();
    expect(etaError('14:30', now)).toBeNull();
  });
});

describe('formatEta', () => {
  it('同じ日（日本時間）なら時刻だけ、違えば日付も', () => {
    expect(formatEta(Date.parse('2026-10-19T05:30:00Z'), now)).toBe('14:30');
    expect(formatEta(Date.parse('2026-10-20T00:00:00Z'), now)).toBe('10/20 9:00');
  });
});

describe('etaToTimeInput', () => {
  it('時刻の入力欄の値（HH:MM。日本時間）', () => {
    expect(etaToTimeInput(Date.parse('2026-10-20T00:05:00Z'))).toBe('09:05');
  });
});
