// 在庫（#67・#68、data-model.md §2.5・§3）。注文の確定で減らし、取り消しで戻す。純粋関数
import type { OrderAction } from './orderStatus';

/** 確定で足りなかった商品（「焼きそばの残りが 2 です（注文は 3）」） */
export interface StockShortage {
  menuId: string;
  name: string;
  stock: number;
  qty: number;
}

/**
 * 確定の前に、在庫が足りるかを確かめる（確定のトランザクションの中で、サーバーから読んだ残りで）。
 * stocks：商品ごとのいまの残り（null・無い＝在庫を使わない〔減らさない〕。メニューから消えた商品は、入れない）
 */
export function findShortages(lines: readonly { menuId: string; name: string; qty: number }[], stocks: ReadonlyMap<string, number | null>): StockShortage[] {
  return lines.flatMap((l) => {
    const stock = stocks.get(l.menuId);
    return stock != null && l.qty > stock ? [{ menuId: l.menuId, name: l.name, stock: Math.max(0, stock), qty: l.qty }] : [];
  });
}

/** 予約の数（#69）：在庫のマイナスの分（残り −3 ＝ 予約 3）。在庫を使わない・0以上なら 0 */
export function reservationsOf(stock: number | null): number {
  return stock != null && stock < 0 ? -stock : 0;
}

/** その行の、予約になる数（#69）：注文の数のうち、いまの残り（0未満は0）を超える分。在庫を使わない商品は 0 */
export function reservedQty(qty: number, stock: number | null | undefined): number {
  return stock == null ? 0 : Math.max(0, qty - Math.max(0, stock));
}

/** 確定で、在庫を減らす行か（在庫を使う商品。足りることは、findShortages で確かめたあと） */
export function decrementsStock(menuId: string, stocks: ReadonlyMap<string, number | null>): boolean {
  return stocks.get(menuId) != null;
}

/**
 * 取り消し・取り消しを戻すで、在庫を増やす・減らす数（#68）。
 * - 対象は、確定で在庫を減らした行（stock: true）だけ
 * - いまメニューにあり、在庫を使っている商品だけ（消えた商品・使うのをやめた商品は、戻さない。
 *   消えた商品に書くと、取り消しの書き込みごと失敗するため。使っていない商品に足すと、在庫を使い始めてしまうため）
 * - 取り消し：+qty。取り消しを戻す：−qty（残りがマイナスになってもよい。オフラインでも受け付けるため、確かめられない）
 */
export function stockAdjustments(
  lines: readonly { menuId: string; qty: number; stock?: boolean }[],
  action: OrderAction,
  menu: readonly { id: string; stock: number | null }[],
): { menuId: string; delta: number }[] {
  const sign = action === 'cancel' ? 1 : action === 'restore' ? -1 : 0;
  if (sign === 0) return [];
  return lines.flatMap((l) => {
    const m = menu.find((x) => x.id === l.menuId);
    return l.stock === true && m && m.stock !== null ? [{ menuId: l.menuId, delta: sign * l.qty }] : [];
  });
}
