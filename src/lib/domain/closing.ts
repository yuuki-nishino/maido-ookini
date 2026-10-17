// レジ締め（data-model.md §5.3、SPEC 6.4）。純粋関数
import type { Summary } from './summary';

export const CASH_MAX = 10_000_000; // 準備金・数えた現金の上限（events.floatCash のルールと同じ）
export const CLOSING_NOTE_MAX = 200; // firestore.rules の validClosing と同じ（UTF-16 の単位）

/** 保存されているレジ締め */
export interface ClosingRecord {
  floatCash: number;
  expectedCash: number;
  actualCash: number;
  diff: number;
  note: string;
  closedAt: Date | null;
  closedBy: string;
}

/** あるはずの現金：準備金 ＋ 現金売上 */
export function calcExpectedCash(floatCash: number, cashTotal: number): number {
  return floatCash + cashTotal;
}

/** 差額：数えた現金 − あるはずの現金（正＝多い、負＝不足） */
export function calcDiff(actualCash: number, expectedCash: number): number {
  return actualCash - expectedCash;
}

/** 差額の見せ方（0：一致＝緑、それ以外：赤）。色だけでなく、文字でも示す */
export function diffKind(diff: number): 'match' | 'over' | 'short' {
  return diff === 0 ? 'match' : diff > 0 ? 'over' : 'short';
}

export interface ClosingView {
  /** 準備金の初期値：その日の締めがあれば、その準備金。無ければ、イベントの準備金 */
  initialFloat: number;
  /** 締めた後に、現金売上が変わった（注文の追加・取り消し・支払い方法の変更）。締めが無ければ false */
  changedAfterClosing: boolean;
  /** 保存済みの準備金で、いまの現金売上から計算し直した、あるはずの現金（締めがあるとき）。比べる相手は、保存済みの expectedCash */
  recomputedExpected: number | null;
}

/**
 * 「締め後に変更あり」の判定（data-model.md §5.3）：**保存済みの準備金**で、いまの現金売上から計算し直した値が、
 * **保存済みの expectedCash** と違うとき。画面で入力中の準備金は使わない（入力しただけで「変更あり」にならないように）。
 * 既知の制約：現金 → PayPay と、PayPay → 現金が、同額で相殺される変更は、検知できない
 */
export function closingView(summary: Pick<Summary, 'cashTotal'>, closing: Pick<ClosingRecord, 'floatCash' | 'expectedCash'> | null, eventFloat: number): ClosingView {
  if (!closing) return { initialFloat: eventFloat, changedAfterClosing: false, recomputedExpected: null };
  const recomputedExpected = calcExpectedCash(closing.floatCash, summary.cashTotal);
  return { initialFloat: closing.floatCash, changedAfterClosing: recomputedExpected !== closing.expectedCash, recomputedExpected };
}

/** 金額の入力：0以上の整数（全角数字・3桁ごとのカンマ・「円」「¥」を受け付ける）。空・不正・上限超えは null */
export function parseCashAmount(input: string): number | null {
  const text = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/\s/g, '')
    .replace(/^[¥￥]/, '')
    .replace(/円$/, '');
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(text)) return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isSafeInteger(n) && n <= CASH_MAX ? n : null;
}

/** 枚数で数えるお金の種類（#64）。2,000円札は入れない（ほぼ受け取らない。来たら、手で合計を入れる） */
export const DENOMINATIONS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1] as const;
export type Denomination = (typeof DENOMINATIONS)[number];
/** 1種類の枚数の上限（桁の打ち間違いを防ぐ） */
export const COUNT_MAX = 9999;

/** 枚数の入力：0〜9,999 の整数（全角数字を受け付ける）。空は 0。不正なら null */
export function parseCount(input: string): number | null {
  const text = input.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim().replace(/枚$/, '');
  if (text === '') return 0;
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n <= COUNT_MAX ? n : null;
}

/** 枚数の入力（種類 → 文字のまま） */
export type CashCounts = Partial<Record<Denomination, string>>;

export interface CashCountView {
  /** 1つでも枚数が入っている（このときは、数えた現金を、枚数から計算する） */
  used: boolean;
  /** 種類ごとの小計（不正な行は null） */
  lines: { denomination: Denomination; count: number | null; subtotal: number | null }[];
  /** 合計。不正な行がある・上限（CASH_MAX）を超えるときは null */
  total: number | null;
  /** 合計が上限を超えた */
  overMax: boolean;
}

/** 枚数から、小計と合計を計算する（#64。レジ締めで、数えた現金を出す） */
export function cashCountView(counts: CashCounts): CashCountView {
  const lines = DENOMINATIONS.map((denomination) => {
    const count = parseCount(counts[denomination] ?? '');
    return { denomination, count, subtotal: count === null ? null : count * denomination };
  });
  const used = DENOMINATIONS.some((d) => (counts[d] ?? '').trim() !== '');
  const invalid = lines.some((l) => l.subtotal === null);
  const sum = lines.reduce((acc, l) => acc + (l.subtotal ?? 0), 0);
  const overMax = !invalid && sum > CASH_MAX;
  return { used, lines, total: invalid || overMax ? null : sum, overMax };
}

/** メモ：改行は空白に、前後の空白を除く。200文字を超えたら null */
export function normalizeClosingNote(input: string): string | null {
  const note = input.replace(/[\r\n]+/g, ' ').trim();
  return note.length <= CLOSING_NOTE_MAX ? note : null;
}
