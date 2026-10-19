// お渡しの目安（#70）。時刻は日本時間
import { describe, expect, it } from 'vitest';
import { etaFromTime, etaToTimeInput, formatEta } from '../../src/lib/domain/eta';

// 2026-10-19 13:05（日本時間）＝ 04:05Z
const now = new Date('2026-10-19T04:05:00Z');

describe('etaFromTime', () => {
  it('その日の時刻（日本時間）', () => {
    expect(new Date(etaFromTime('14:30', now)!).toISOString()).toBe('2026-10-19T05:30:00.000Z');
    expect(new Date(etaFromTime('9:05', new Date('2026-10-18T23:00:00Z'))!).toISOString()).toBe('2026-10-19T00:05:00.000Z'); // 日本時間 8:00 に入れた 9:05
  });
  it('いまより前（同じ分も）なら、翌日', () => {
    expect(new Date(etaFromTime('09:00', now)!).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(new Date(etaFromTime('13:05', now)!).toISOString()).toBe('2026-10-20T04:05:00.000Z');
  });
  it('日本時間の日付の境目（UTC では前の日）でも、日本時間の日付で考える', () => {
    // 日本時間 2026-10-20 00:30 ＝ 2026-10-19T15:30Z。「01:00」は、日本時間 10/20 の 1:00
    expect(new Date(etaFromTime('01:00', new Date('2026-10-19T15:30:00Z'))!).toISOString()).toBe('2026-10-19T16:00:00.000Z');
  });
  it('空・不正なら null', () => {
    for (const s of ['', 'abc', '24:00', '12:60', '1230', '12:3']) expect(etaFromTime(s, now)).toBeNull();
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
