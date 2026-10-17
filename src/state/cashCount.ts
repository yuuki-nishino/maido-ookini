// レジ締めの、お金の種類ごとの枚数（#64、screens.md §3.7）。数えている途中に、ほかのタブを見に行っても消えないよう、
// メモリ上の共有の状態に置く（イベントと日付ごと。再読み込みでは消える）。内訳は保存しない（数えた現金の合計だけを締めに残す）
import { signal } from '@preact/signals';
import type { CashCounts, Denomination } from '../lib/domain/closing';

const store = signal<Record<string, CashCounts>>({});
const keyOf = (eventId: string, day: string) => `${eventId}/${day}`;

export function countsFor(eventId: string, day: string): CashCounts {
  return store.value[keyOf(eventId, day)] ?? {};
}

export function setCount(eventId: string, day: string, denomination: Denomination, text: string): void {
  const key = keyOf(eventId, day);
  store.value = { ...store.value, [key]: { ...store.value[key], [denomination]: text } };
}

export function clearCounts(eventId: string, day: string): void {
  const next = { ...store.value };
  delete next[keyOf(eventId, day)];
  store.value = next;
}
