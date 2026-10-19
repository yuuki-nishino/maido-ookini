// データアクセス層の型（data-access.md §2）。Firestore の型を UI に漏らさない
import type { Day } from '../domain/day';

export interface EventDoc {
  id: string;
  name: string;
  startDate: Day;
  endDate: Day;
  floatCash: number;
  ownerUid: string;
  deleting: boolean;
}

export interface Member {
  uid: string;
  role: 'owner' | 'member';
  displayName: string;
  email: string;
}

export type { OrderStatus, Payment } from '../domain/orderStatus';
import type { OrderStatus, Payment } from '../domain/orderStatus';

export interface OrderLine {
  menuId: string;
  name: string;
  price: number;
  qty: number;
  /** 調理が必要か（#52）。無い（古い）行は、調理あり */
  cook?: boolean;
  /** 確定で、在庫を減らした行（#68）。取り消しで戻すのは、この行だけ。無い行は、減らしていない */
  stock?: boolean;
  /** この行のうち、予約になった数（#69。在庫が足りなかった分）。無い行は 0 */
  reserved?: number;
}

/** 注文（data-model.md §2.6）。時刻は、書き込み直後（サーバー時刻の確定前）に null になり得る */
export interface Order {
  id: string;
  number: number;
  day: string;
  items: OrderLine[];
  total: number;
  payment: Payment;
  /** メモ（無い注文は、空） */
  note: string;
  status: OrderStatus;
  /** 「もう一度呼ぶ」を押した回数（#58。無い注文は 0） */
  calls: number;
  /** 予約を含む注文（#69。在庫が足りない分を予約として確定した）。無い注文は false */
  reserved: boolean;
  /** 予約のお渡しの目安（#70）。未定・予約でない注文は null */
  etaAt: Date | null;
  cancelledFrom: Exclude<OrderStatus, 'cancelled'> | null;
  qr: boolean;
  createdAt: Date | null;
  readyAt: Date | null;
  doneAt: Date | null;
  cancelledAt: Date | null;
  createdBy: string;
  updatedBy: string;
  updatedAt: Date | null;
  /** この注文に、未送信の書き込みがある（metadata.hasPendingWrites） */
  pending: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  order: number;
  soldOut: boolean;
  /** 調理が必要か（#52）。グッズなどは false。無い（古い）商品は true */
  cook: boolean;
  /** 在庫（いまの残り。#67）。null＝在庫を使わない（無い〔古い〕商品も null） */
  stock: number | null;
}

/** レジ締め（data-model.md §2.8。closings/{day}） */
export interface Closing {
  day: string;
  floatCash: number;
  expectedCash: number;
  actualCash: number;
  diff: number;
  note: string;
  closedAt: Date | null;
  closedBy: string;
}

/** 招待。期限（発行の1日後）は、画面で inviteExpiresAt で計算する。createdAt は、書き込み直後は見積もりの時刻 */
export interface Invite {
  email: string;
  createdAt: Date | null;
}

/** watchMyEvents の補足。memberOf：自分の members があるイベントのID（表示できないものも含む） */
export interface MyEventsMeta {
  fromCache: boolean;
  memberOf: string[];
}

export type Unsubscribe = () => void;
