// レジ締めの枚数の状態（#64）。イベントと日付ごとに分かれる
import { describe, expect, it } from 'vitest';
import { clearCounts, countsFor, setCount } from './cashCount';

describe('cashCount', () => {
  it('イベントと日付ごとに分かれる。setCount は、同じ日のほかの種類を消さない', () => {
    setCount('e1', '2026-10-18', 1000, '3');
    setCount('e1', '2026-10-18', 100, '5');
    setCount('e1', '2026-10-19', 1000, '9');
    setCount('e2', '2026-10-18', 1000, '1');
    expect(countsFor('e1', '2026-10-18')).toEqual({ 1000: '3', 100: '5' });
    expect(countsFor('e1', '2026-10-19')).toEqual({ 1000: '9' });
    expect(countsFor('e2', '2026-10-18')).toEqual({ 1000: '1' });
  });
  it('clearCounts は、そのイベントと日付だけを消す', () => {
    clearCounts('e1', '2026-10-18');
    expect(countsFor('e1', '2026-10-18')).toEqual({});
    expect(countsFor('e1', '2026-10-19')).toEqual({ 1000: '9' });
  });
});
