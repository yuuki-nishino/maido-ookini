// お客様画面の状態の判定（screens.md §4.1・§4.2、SPEC 6.7）。純粋関数
// お客様に見せるのは、番号・状況・明細・合計だけ。支払い方法・メモ・スタッフの情報は、型にも持たない

export type CustomerStatus = 'preparing' | 'ready' | 'done' | 'cancelled';

export interface CustomerOrder {
  number: number;
  status: CustomerStatus;
  items: { name: string; price: number; qty: number }[];
  total: number;
}

/** 購読から届いたもの。まだ何も届いていなければ、判定の入力には、null を渡す */
export type CustomerSnapshot =
  | { kind: 'doc'; order: CustomerOrder | null; fromCache: boolean } // order が null ＝ 文書が無い
  | { kind: 'error' };

export type CustomerView =
  | { state: 'loading'; slow: boolean }
  | { state: 'notFound' }
  | { state: 'error' }
  | { state: 'active'; order: CustomerOrder; fromCache: boolean };

/** 読み込み中が、この時間続いたら、「通信が不安定です」を添える（screens.md §4.1） */
export const SLOW_AFTER_MS = 8000;

/** 読み込み中か（待ちの時間を数えるかの判定）。送られてきた結果の有無ではなく、判定の結果で決める（PR #44 のレビュー V1） */
export function isWaiting(snapshot: CustomerSnapshot | null): boolean {
  return customerView(snapshot, 0).state === 'loading';
}

/** 待ちの時間を、intervalMs ごとに知らせる（開始時刻からの経過）。止める関数を返す */
export function startWaitTicker(startedAt: number, onTick: (waitedMs: number) => void, intervalMs = 1000): () => void {
  const id = setInterval(() => onTick(Date.now() - startedAt), intervalMs);
  return () => clearInterval(id);
}

/**
 * - まだ何も届いていない → loading
 * - 文書が無く、サーバーの結果（fromCache = false）→ notFound
 * - 文書が無く、キャッシュの結果（fromCache = true。オフライン）→ **notFound にしない**。loading（8秒続いたら slow）
 * - エラー → error（表示していた注文があれば、それを残して active ＝「通信が不安定です」）
 * - 文書がある → active（fromCache が続くときは、「通信が不安定です」を出す）
 */
export function customerView(snapshot: CustomerSnapshot | null, waitedMs: number, last: CustomerOrder | null = null): CustomerView {
  if (!snapshot) return { state: 'loading', slow: waitedMs >= SLOW_AFTER_MS };
  // 表示していた注文があるときは、エラーでもカードを残し、「通信が不安定です」を出す（購読は、つなぎ直す。PR #44 のレビュー V2）
  if (snapshot.kind === 'error') return last ? { state: 'active', order: last, fromCache: true } : { state: 'error' };
  if (snapshot.order) return { state: 'active', order: snapshot.order, fromCache: snapshot.fromCache };
  return snapshot.fromCache ? { state: 'loading', slow: waitedMs >= SLOW_AFTER_MS } : { state: 'notFound' };
}

/** 「できあがり」へ変わった瞬間だけ、知らせる（音・振動。直前が調理中で、新しいのができあがり）。最初の表示（prev が null）では、しない */
export function shouldAlert(prev: CustomerStatus | null, next: CustomerStatus): boolean {
  return prev === 'preparing' && next === 'ready';
}

/**
 * まだ鳴らせていない、できあがりの知らせがあるか（#57）。調理中 → できあがりで立て、鳴らせたら（呼んだ側で）消す。
 * できあがりでなくなったら（お渡し済み・調理中に戻す）、消す。声の読み込み待ち・裏に回っている間・拒否からの、タップのし直し待ちのあいだ、残る
 */
export function nextPendingAlert(pending: boolean, prev: CustomerStatus | null, next: CustomerStatus): boolean {
  if (shouldAlert(prev, next)) return true;
  return next === 'ready' && pending;
}

/**
 * 音のお知らせのボタン（screens.md §4.2、#57）。ブラウザは、一度もタップされていないページでは、音を鳴らせないため、タップしてもらう
 * - arm：調理中で、まだタップされていない →「できあがりを音で知らせる」
 * - retry：タップのあと、音を鳴らせない状態に戻った（直近の再生が拒否された〔NotAllowedError〕など）→「音をオンにし直す」。
 *   調理中のときと、できあがりで、まだ鳴らせていない知らせ（pending）があるとき（タップで、すぐ鳴らす）
 * - armed：調理中で、鳴らせる →「音でお知らせします」（ボタンではなく、表示だけ）
 * - null：出さない
 */
export type ChimeButton = 'arm' | 'retry' | 'armed' | null;

export function chimeButton(status: CustomerStatus, armed: boolean, audioRunning: boolean, pending = false): ChimeButton {
  if (status === 'preparing') {
    if (!armed) return 'arm';
    return audioRunning ? 'armed' : 'retry';
  }
  return status === 'ready' && armed && !audioRunning && pending ? 'retry' : null;
}

/** 画面を消えないようにしておくか（Screen Wake Lock）。タップのあと、調理中・できあがりの間だけ（お渡し済み・取り消しでは、電池のため、外す） */
export function shouldKeepAwake(status: CustomerStatus | null, armed: boolean): boolean {
  return armed && (status === 'preparing' || status === 'ready');
}

/** 状況ごとの、バッジと案内文（SPEC 6.7） */
export const CUSTOMER_STATUS_TEXT: Record<CustomerStatus, { badge: string; message: string }> = {
  preparing: { badge: '調理中', message: 'ただいま調理中です。できあがるまで、この画面を開いたままお待ちください' },
  ready: { badge: 'へい、お待ち！', message: '受け渡し口までお越しください' },
  done: { badge: 'お渡し済み', message: '毎度おおきに！' },
  cancelled: { badge: '取り消し', message: 'この注文は取り消されました。お近くのスタッフへお声がけください' },
};

// Firestore の自動ID（英数字20文字）
const ID_PATTERN = /^[A-Za-z0-9]{20}$/;

/** URL の ?e=&o= を検査する。不正なら null（「このQRは正しくありません」） */
export function parseOrderLink(search: string): { eventId: string; orderId: string } | null {
  const params = new URLSearchParams(search);
  const eventId = params.get('e') ?? '';
  const orderId = params.get('o') ?? '';
  return ID_PATTERN.test(eventId) && ID_PATTERN.test(orderId) ? { eventId, orderId } : null;
}

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** 最終更新時刻（'14:05:12'）。スナップショットを受け取った時刻 */
export function formatClock(date: Date): string {
  return clock.format(date);
}
