// 予約注文の「お渡しの目安」（#70、screens.md §3.4・§3.5・§4.2）。時刻は日本時間（Asia/Tokyo。夏時間が無いため、+9時間で計算する）。純粋関数
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 時刻の入力（`<input type="time">` の 'HH:MM'）を、目安の時刻（ミリ秒）にする。その日の時刻（日本時間）。
 * いまより前（同じ分も含む）なら、翌日とみなす（「明日の朝 9:00」）。空・不正なら null
 */
export function etaFromTime(hhmm: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const jstNow = now.getTime() + JST_OFFSET_MS;
  const jstMidnight = jstNow - (jstNow % DAY_MS);
  let eta = jstMidnight + (h * 60 + min) * 60 * 1000 - JST_OFFSET_MS;
  if (eta <= now.getTime()) eta += DAY_MS;
  return eta;
}

/** 目安の表示：同じ日（日本時間）なら「14:30」、違えば「10/20 9:00」 */
export function formatEta(etaAt: number, now: Date): string {
  const e = new Date(etaAt + JST_OFFSET_MS);
  const n = new Date(now.getTime() + JST_OFFSET_MS);
  const time = `${e.getUTCHours()}:${pad(e.getUTCMinutes())}`;
  const sameDay = e.getUTCFullYear() === n.getUTCFullYear() && e.getUTCMonth() === n.getUTCMonth() && e.getUTCDate() === n.getUTCDate();
  return sameDay ? time : `${e.getUTCMonth() + 1}/${e.getUTCDate()} ${time}`;
}

/** 目安を、時刻の入力欄の値（'HH:MM'）にする（「目安を直す」で、いまの目安を入れておく） */
export function etaToTimeInput(etaAt: number): string {
  const e = new Date(etaAt + JST_OFFSET_MS);
  return `${pad(e.getUTCHours())}:${pad(e.getUTCMinutes())}`;
}
