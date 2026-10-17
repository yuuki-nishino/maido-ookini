// レジ締め（testing.md §2 の closingView、data-model.md §5.3）
import { describe, expect, it } from 'vitest';
import { calcDiff, calcExpectedCash, CASH_MAX, cashCountView, closingView, COUNT_MAX, diffKind, normalizeClosingNote, parseCashAmount, parseCount } from '../../src/lib/domain';

describe('calcExpectedCash / calcDiff / diffKind', () => {
  it('あるはずの現金 ＝ 準備金 ＋ 現金売上。差額 ＝ 数えた現金 − あるはずの現金', () => {
    expect(calcExpectedCash(10000, 15000)).toBe(25000);
    expect(calcDiff(24900, 25000)).toBe(-100);
    expect(calcDiff(25000, 25000)).toBe(0);
    expect(calcDiff(25100, 25000)).toBe(100);
  });
  it('差額の符号：0 は一致、正は多い、負は不足', () => {
    expect(diffKind(0)).toBe('match');
    expect(diffKind(100)).toBe('over');
    expect(diffKind(-100)).toBe('short');
  });
});

describe('closingView', () => {
  const saved = { floatCash: 10000, expectedCash: 25000 };

  it('締めが無い：準備金の初期値は、イベントの準備金。「締め後に変更あり」は出ない', () => {
    expect(closingView({ cashTotal: 15000 }, null, 8000)).toEqual({ initialFloat: 8000, changedAfterClosing: false, recomputedExpected: null });
  });

  it('締めがある：準備金の初期値は、保存された準備金（イベントの値より優先）', () => {
    expect(closingView({ cashTotal: 15000 }, saved, 8000).initialFloat).toBe(10000);
  });

  it('現金売上が、締めたときと同じなら、変更なし', () => {
    expect(closingView({ cashTotal: 15000 }, saved, 8000)).toMatchObject({ changedAfterClosing: false, recomputedExpected: 25000 });
  });

  it('締めた後に、現金売上が変わった（注文の追加・取り消し・支払い方法の変更）→ 変更あり', () => {
    expect(closingView({ cashTotal: 15500 }, saved, 8000).changedAfterClosing).toBe(true); // 追加
    expect(closingView({ cashTotal: 14500 }, saved, 8000).changedAfterClosing).toBe(true); // 取り消し・支払い方法の変更
  });

  it('保存済みの準備金で再計算する（イベントの準備金や、画面で入力中の準備金では、変更ありにならない）', () => {
    // イベントの準備金が 8000 に変わっていても、保存済み（10000）で比べる
    expect(closingView({ cashTotal: 15000 }, saved, 99999).changedAfterClosing).toBe(false);
  });

  it('現金売上の合計だけで判定する（現金 → PayPay と PayPay → 現金が同額で相殺され、合計が同じなら、区別できない）', () => {
    // 合計が同じなら変更なし。区別するには、注文ごとの記録が必要（設計上の既知の制約）
    expect(closingView({ cashTotal: saved.expectedCash - saved.floatCash }, saved, 8000).changedAfterClosing).toBe(false);
  });
});

describe('parseCashAmount', () => {
  it.each([
    ['0', 0],
    ['10000', 10000],
    ['１０，０００円', 10000],
    ['¥5,000', 5000],
    ['10000000', 10_000_000],
  ])('%s → %d', (s, v) => expect(parseCashAmount(s)).toBe(v));
  it.each(['', '  ', '-1', '1.5', 'abc', '1,00', '10000001'])('%s は拒否（null）', (s) => expect(parseCashAmount(s)).toBeNull());
});

describe('normalizeClosingNote', () => {
  it('前後の空白を除く。改行は空白に。200文字まで（絵文字は2文字）', () => {
    expect(normalizeClosingNote('  5番 現金→PayPay ¥500 ')).toBe('5番 現金→PayPay ¥500');
    expect(normalizeClosingNote('a\nb')).toBe('a b');
    expect(normalizeClosingNote('あ'.repeat(200))).toHaveLength(200);
    expect(normalizeClosingNote('あ'.repeat(201))).toBeNull();
    expect(normalizeClosingNote('🍜'.repeat(101))).toBeNull();
  });
});

describe('parseCount（枚数。#64）', () => {
  it.each([
    ['', 0],
    ['0', 0],
    ['12', 12],
    ['１２', 12],
    [' 3 ', 3],
    ['5枚', 5],
    [String(COUNT_MAX), COUNT_MAX],
  ])('%s → %d', (s, v) => expect(parseCount(s)).toBe(v));
  it.each(['-1', '1.5', 'abc', '1,000', '1 2', String(COUNT_MAX + 1)])('%s は拒否', (s) => expect(parseCount(s)).toBeNull());
  it('前後の空白（全角も）は、消す', () => {
    expect(parseCount('\u3000７\u3000')).toBe(7);
  });
});

describe('cashCountView（枚数から、数えた現金を出す。#64）', () => {
  it('種類ごとの小計と、合計', () => {
    const v = cashCountView({ 10000: '2', 1000: '12', 500: '3', 100: '7', 10: '4', 1: '9' });
    expect(v.used).toBe(true);
    expect(v.total).toBe(20000 + 12000 + 1500 + 700 + 40 + 9);
    expect(v.lines.find((l) => l.denomination === 1000)).toEqual({ denomination: 1000, count: 12, subtotal: 12000 });
    expect(v.lines.find((l) => l.denomination === 5000)).toEqual({ denomination: 5000, count: 0, subtotal: 0 });
  });
  it('何も入れていない（空白だけも）→ 使っていない（数えた現金は、手で入れる）', () => {
    expect(cashCountView({}).used).toBe(false);
    expect(cashCountView({ 100: ' ' }).used).toBe(false);
    expect(cashCountView({}).total).toBe(0);
  });
  it('0枚だけでも、使っている（合計 0）', () => {
    expect(cashCountView({ 100: '0' })).toMatchObject({ used: true, total: 0 });
  });
  it('空白だけの行と、不正な行が混ざる → 使っている・合計は null', () => {
    expect(cashCountView({ 100: ' ', 1000: 'x' })).toMatchObject({ used: true, total: null });
  });
  it('不正な行があれば、合計は null（その行の小計も null）', () => {
    const v = cashCountView({ 1000: '3', 100: 'x' });
    expect(v.total).toBeNull();
    expect(v.overMax).toBe(false);
    expect(v.lines.find((l) => l.denomination === 100)?.subtotal).toBeNull();
  });
  it('合計が上限（CASH_MAX）を超えたら、null（overMax）', () => {
    const v = cashCountView({ 10000: String(COUNT_MAX), 5000: String(COUNT_MAX) });
    expect(v.total).toBeNull();
    expect(v.overMax).toBe(true);
    expect(cashCountView({ 10000: '1000' }).total).toBe(CASH_MAX);
  });
});
