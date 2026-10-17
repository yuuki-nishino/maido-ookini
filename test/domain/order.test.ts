// カートと金額（screens.md §3.4、testing.md §2 の calcTotal / calcChange）
import { describe, expect, it } from 'vitest';
import {
  addToCart,
  applyCurrentPrice,
  calcChange,
  calcTotal,
  changeQty,
  defaultQr,
  formatYen,
  lineNotice,
  needsCooking,
  addTendered,
  parseTendered,
  removeLine,
  TENDERED_MAX,
  type CartLine,
} from '../../src/lib/domain';

const yakisoba = { id: 'y', name: '焼きそば', price: 500, soldOut: false };
const ramune = { id: 'r', name: 'ラムネ', price: 200, soldOut: false };

describe('calcTotal / calcChange', () => {
  it('合計は Σ price × qty。空は0', () => {
    expect(calcTotal([])).toBe(0);
    expect(calcTotal([{ price: 500, qty: 2 }, { price: 200, qty: 3 }])).toBe(1600);
  });
  it('お釣り：ちょうどは0、不足は負', () => {
    expect(calcChange(1200, 2000)).toBe(800);
    expect(calcChange(1200, 1200)).toBe(0);
    expect(calcChange(1200, 1000)).toBe(-200);
  });
  it('合計は、カートの価格で計算する（メニューの価格が変わっても、カートの価格のまま）', () => {
    let lines: CartLine[] = [];
    lines = (addToCart(lines, yakisoba) as { lines: CartLine[] }).lines;
    // メニューの価格が 600 に変わった後で、もう1つ足す
    lines = (addToCart(lines, { ...yakisoba, price: 600 }) as { lines: CartLine[] }).lines;
    expect(lines).toEqual([{ menuId: 'y', name: '焼きそば', price: 500, qty: 2 }]);
    expect(calcTotal(lines)).toBe(1000);
  });
});

describe('addToCart', () => {
  it('新しい行は末尾に、同じ品は数量 +1', () => {
    let r = addToCart([], yakisoba);
    r = addToCart((r as { lines: CartLine[] }).lines, ramune);
    r = addToCart((r as { lines: CartLine[] }).lines, yakisoba);
    expect(r).toEqual({
      ok: true,
      lines: [
        { menuId: 'y', name: '焼きそば', price: 500, qty: 2 },
        { menuId: 'r', name: 'ラムネ', price: 200, qty: 1 },
      ],
    });
  });
  it('売り切れは追加しない', () => {
    expect(addToCart([], { ...yakisoba, soldOut: true })).toEqual({ ok: false, reason: 'soldOut' });
  });
  it('数量は99まで、行は50まで', () => {
    expect(addToCart([{ menuId: 'y', name: '焼きそば', price: 500, qty: 99 }], yakisoba)).toEqual({ ok: false, reason: 'qtyMax' });
    const fifty = Array.from({ length: 50 }, (_, k) => ({ menuId: `m${k}`, name: 'x', price: 1, qty: 1 }));
    expect(addToCart(fifty, yakisoba)).toEqual({ ok: false, reason: 'linesMax' });
  });
});

describe('調理の有無（#52）', () => {
  const goods = { id: 'g', name: 'Tシャツ', price: 3000, soldOut: false, cook: false };
  it('調理なしの商品は、行に cook: false を持つ。調理ありは持たない（古い行と同じ形）', () => {
    const r = addToCart([], goods);
    expect(r).toEqual({ ok: true, lines: [{ menuId: 'g', name: 'Tシャツ', price: 3000, qty: 1, cook: false }] });
    expect(addToCart([], { ...yakisoba, cook: true })).toEqual({ ok: true, lines: [{ menuId: 'y', name: '焼きそば', price: 500, qty: 1 }] });
  });
  it('needsCooking：cook が false のときだけ不要。無い行は調理あり', () => {
    expect(needsCooking({})).toBe(true);
    expect(needsCooking({ cook: true })).toBe(true);
    expect(needsCooking({ cook: false })).toBe(false);
  });
  it('defaultQr：調理ありが1つでもあればオン。調理なしだけならオフ。空はオン', () => {
    expect(defaultQr([])).toBe(true);
    expect(defaultQr([{ cook: false }])).toBe(false);
    expect(defaultQr([{ cook: false }, { cook: false }])).toBe(false);
    expect(defaultQr([{ cook: false }, {}])).toBe(true);
    expect(defaultQr([{ cook: true }])).toBe(true);
  });
  it('現在の価格にしたとき、調理の要否もメニューに合わせる。数量は保つ', () => {
    const lines: CartLine[] = [{ menuId: 'g', name: 'Tシャツ', price: 2500, qty: 2 }];
    expect(applyCurrentPrice(lines, 'g', [goods])).toEqual([{ menuId: 'g', name: 'Tシャツ', price: 3000, qty: 2, cook: false }]);
  });
});

describe('changeQty / removeLine', () => {
  const lines = [
    { menuId: 'y', name: '焼きそば', price: 500, qty: 2 },
    { menuId: 'r', name: 'ラムネ', price: 200, qty: 1 },
  ];
  it('増減。0になったら行を消す。99を超えない', () => {
    expect(changeQty(lines, 'y', -1)[0]!.qty).toBe(1);
    expect(changeQty(lines, 'r', -1).map((l) => l.menuId)).toEqual(['y']);
    expect(changeQty([{ ...lines[0]!, qty: 99 }], 'y', 1)[0]!.qty).toBe(99);
  });
  it('削除', () => {
    expect(removeLine(lines, 'y').map((l) => l.menuId)).toEqual(['r']);
  });
});

describe('lineNotice / applyCurrentPrice', () => {
  const line = { menuId: 'y', name: '焼きそば', price: 500, qty: 2 };
  it('価格の変更・売り切れ・削除を知らせる', () => {
    expect(lineNotice(line, [yakisoba])).toEqual({ currentPrice: null, soldOut: false, deleted: false });
    expect(lineNotice(line, [{ ...yakisoba, price: 600, soldOut: true }])).toEqual({ currentPrice: 600, soldOut: true, deleted: false });
    expect(lineNotice(line, [])).toEqual({ currentPrice: null, soldOut: false, deleted: true });
  });
  it('「現在の価格にする」で、その行の名前・価格をいまのメニューに合わせる。数量はそのまま', () => {
    expect(applyCurrentPrice([line], 'y', [{ ...yakisoba, name: '焼きそば大', price: 600 }])).toEqual([
      { menuId: 'y', name: '焼きそば大', price: 600, qty: 2 },
    ]);
    expect(applyCurrentPrice([line], 'y', [])).toEqual([line]); // 削除された品は変えない
  });
});

describe('addTendered（お金のボタンで足す。#61）', () => {
  it('いまのお預りに足す。空は 0 から', () => {
    let t = '';
    for (const v of [1000, 1000, 100, 100, 100, 50, 10]) t = addTendered(t, v);
    expect(t).toBe('2360');
  });
  it('手で打った値（全角・カンマ・円つきも）に足す。結果は、カンマなしの数字', () => {
    expect(addTendered('500', 1000)).toBe('1500');
    expect(addTendered('１，２００円', 100)).toBe('1300');
  });
  it('入力が不正なら、足さずにそのまま', () => {
    expect(addTendered('abc', 100)).toBe('abc');
    expect(addTendered('1.5', 100)).toBe('1.5');
  });
  it('上限を超えるなら、足さずにそのまま。ちょうど上限までは足せる', () => {
    expect(addTendered(String(TENDERED_MAX), 10)).toBe(String(TENDERED_MAX));
    expect(addTendered(String(TENDERED_MAX - 10), 10)).toBe(String(TENDERED_MAX));
  });
});

describe('parseTendered / formatYen', () => {
  it.each([
    ['', 0],
    ['1000', 1000],
    ['１０，０００円', 10000],
    ['¥5,000', 5000],
    ['1100000', 1100000],
  ])('%s → %d', (s, v) => expect(parseTendered(s)).toBe(v));
  it.each(['-1', '1.5', 'abc', '1,00'])('%s は拒否', (s) => expect(parseTendered(s)).toBeNull());
  it('上限は、ありうる合計の最大（100,000円 × 99個 × 50品）。「ちょうど」が、どの合計でも入る（レビュー C1）', () => {
    expect(TENDERED_MAX).toBe(495_000_000);
    expect(parseTendered(String(TENDERED_MAX))).toBe(TENDERED_MAX);
    expect(parseTendered(String(TENDERED_MAX + 1))).toBeNull();
  });
  it('¥1,200', () => {
    expect(formatYen(1200)).toBe('¥1,200');
  });
});
