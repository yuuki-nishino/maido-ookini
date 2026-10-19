// 在庫の確定・取り消し（#68）
import { describe, expect, it } from 'vitest';
import { decrementsStock, findShortages, reservationsOf, reservedQty, stockAdjustments } from '../../src/lib/domain/stock';

const lines = [
  { menuId: 'y', name: '焼きそば', qty: 3 },
  { menuId: 't', name: 'Tシャツ', qty: 1 },
  { menuId: 'r', name: 'ラムネ', qty: 2 },
];

describe('findShortages', () => {
  it('在庫を使う商品で、注文の数が残りを超えるものを返す', () => {
    const stocks = new Map<string, number | null>([
      ['y', 2],
      ['t', 1],
      ['r', null],
    ]);
    expect(findShortages(lines, stocks)).toEqual([{ menuId: 'y', name: '焼きそば', stock: 2, qty: 3 }]);
  });
  it('ちょうど足りる・在庫を使わない・メニューに無い商品は、足りないとしない', () => {
    expect(findShortages(lines, new Map([['y', 3]]))).toEqual([]);
    expect(findShortages(lines, new Map([['y', null]]))).toEqual([]);
    expect(findShortages(lines, new Map())).toEqual([]);
  });
  it('残りがマイナス（取り消しを戻したあと）なら、残り 0 として知らせる', () => {
    expect(findShortages([{ menuId: 'y', name: '焼きそば', qty: 1 }], new Map([['y', -2]]))).toEqual([{ menuId: 'y', name: '焼きそば', stock: 0, qty: 1 }]);
  });
});

describe('decrementsStock', () => {
  it('在庫を使う商品（残りが数）だけ', () => {
    const stocks = new Map<string, number | null>([
      ['y', 5],
      ['r', null],
    ]);
    expect(decrementsStock('y', stocks)).toBe(true);
    expect(decrementsStock('r', stocks)).toBe(false);
    expect(decrementsStock('x', stocks)).toBe(false);
  });
});

describe('stockAdjustments', () => {
  const order = [
    { menuId: 'y', qty: 3, stock: true },
    { menuId: 't', qty: 1, stock: true },
    { menuId: 'r', qty: 2 }, // 確定のとき、在庫を使っていなかった
  ];
  const menu = [
    { id: 'y', stock: 10 },
    { id: 't', stock: null }, // あとで、在庫を使うのをやめた
    { id: 'r', stock: 5 }, // あとで、在庫を使い始めた
  ];
  it('取り消しは +qty、取り消しを戻すは −qty。確定で減らした行で、いまも在庫を使っている商品だけ', () => {
    expect(stockAdjustments(order, 'cancel', menu)).toEqual([{ menuId: 'y', delta: 3 }]);
    expect(stockAdjustments(order, 'restore', menu)).toEqual([{ menuId: 'y', delta: -3 }]);
  });
  it('メニューから消えた商品は、戻さない', () => {
    expect(stockAdjustments(order, 'cancel', [])).toEqual([]);
  });
  it('ほかの操作（完成・渡したなど）では、変えない', () => {
    for (const action of ['ready', 'backToPreparing', 'done', 'backToReady'] as const) expect(stockAdjustments(order, action, menu)).toEqual([]);
  });
});

describe('reservationsOf・reservedQty（予約。#69）', () => {
  it('予約の数は、在庫のマイナスの分。0以上・在庫を使わないなら 0', () => {
    expect(reservationsOf(-3)).toBe(3);
    expect(reservationsOf(0)).toBe(0);
    expect(reservationsOf(5)).toBe(0);
    expect(reservationsOf(null)).toBe(0);
  });
  it('行の予約の数は、注文の数のうち、残り（0未満は0）を超える分', () => {
    expect(reservedQty(3, 2)).toBe(1);
    expect(reservedQty(3, 3)).toBe(0);
    expect(reservedQty(3, 0)).toBe(3);
    expect(reservedQty(3, -5)).toBe(3);
    expect(reservedQty(3, null)).toBe(0);
    expect(reservedQty(3, undefined)).toBe(0);
  });
});
