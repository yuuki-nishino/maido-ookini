// 「もう一度呼ぶ」（#58、screens.md §3.5）。調理画面の「できあがり」のカードから、お客様の画面で、声を鳴らし直す
import type { OrderStatus } from './orderStatus';

/** 押したあと、次に押せるまでの間。声（約4.5秒）が鳴っている途中に、重ねないため。ほかのスタッフの端末とは、合わせない */
export const RECALL_COOLDOWN_MS = 10_000;

/**
 * ボタンの状態
 * - hidden：出さない（できあがりでない・QR なし〔お客様画面が無い〕）
 * - held：「完成」の猶予の間（まだサーバーに、できあがりが書かれていないため、押せない）
 * - offline：通信が無い（溜めても、届いたときには遅い）
 * - wait：押したばかり（残り秒数を出す）
 * - ready：押せる
 */
export type RecallState = { kind: 'hidden' | 'held' | 'offline' | 'ready' } | { kind: 'wait'; seconds: number };

export function recallState(p: { status: OrderStatus; qr: boolean; held: boolean; online: boolean; lastAt: number | null; now: number }): RecallState {
  if (p.status !== 'ready' || !p.qr) return { kind: 'hidden' };
  if (p.held) return { kind: 'held' };
  if (!p.online) return { kind: 'offline' };
  const left = p.lastAt === null ? 0 : p.lastAt + RECALL_COOLDOWN_MS - p.now;
  return left > 0 ? { kind: 'wait', seconds: Math.ceil(left / 1000) } : { kind: 'ready' };
}
