// お客様画面の状態の判定（testing.md §2 の customerView。screens.md §4.1 の表）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chimeButton,
  shouldRecall,
  showLeaveNote,
  showReservedNote,
  showRecallNotice,
  nextPendingAlert,
  CUSTOMER_STATUS_TEXT,
  customerView,
  formatClock,
  isWaiting,
  parseOrderLink,
  shouldAlert,
  shouldKeepAwake,
  SLOW_AFTER_MS,
  startWaitTicker,
  type CustomerSnapshot,
  type CustomerOrder,
} from '../../src/lib/domain/customerView';

const order: CustomerOrder = { number: 7, status: 'preparing', items: [{ name: '焼きそば', price: 500, qty: 2 }], total: 1000, calls: 0, reserved: false, etaAt: null };

describe('customerView', () => {
  it('まだ何も届いていない → loading。8秒続いたら slow（「通信が不安定です」を添える）', () => {
    expect(customerView(null, 0)).toEqual({ state: 'loading', slow: false });
    expect(customerView(null, SLOW_AFTER_MS - 1)).toEqual({ state: 'loading', slow: false });
    expect(customerView(null, SLOW_AFTER_MS)).toEqual({ state: 'loading', slow: true });
  });

  it('文書が無く、サーバーの結果（fromCache = false）→ notFound', () => {
    expect(customerView({ kind: 'doc', order: null, fromCache: false }, 0)).toEqual({ state: 'notFound' });
  });

  it('文書が無く、キャッシュの結果（fromCache = true。オフライン）→ notFound にしない。loading（8秒続いたら slow）', () => {
    expect(customerView({ kind: 'doc', order: null, fromCache: true }, 0)).toEqual({ state: 'loading', slow: false });
    expect(customerView({ kind: 'doc', order: null, fromCache: true }, SLOW_AFTER_MS)).toEqual({ state: 'loading', slow: true });
  });

  it('エラー → error', () => {
    expect(customerView({ kind: 'error' }, 0)).toEqual({ state: 'error' });
  });

  it('文書がある → active。fromCache は、そのまま渡す（「通信が不安定です」を出すため）', () => {
    expect(customerView({ kind: 'doc', order, fromCache: false }, 0)).toEqual({ state: 'active', order, fromCache: false });
    expect(customerView({ kind: 'doc', order, fromCache: true }, 99999)).toEqual({ state: 'active', order, fromCache: true });
  });

  it('エラーでも、表示していた注文があれば、カードを残す（fromCache ＝「通信が不安定です」）。無ければ error（PR #44 のレビュー V2）', () => {
    expect(customerView({ kind: 'error' }, 0, order)).toEqual({ state: 'active', order, fromCache: true });
    expect(customerView({ kind: 'error' }, 0, null)).toEqual({ state: 'error' });
  });

  it('お客様に渡す注文の型には、支払い方法・メモ・スタッフの情報が無い', () => {
    const keys = Object.keys(order).sort();
    expect(keys).toEqual(['calls', 'etaAt', 'items', 'number', 'reserved', 'status', 'total']);
  });
});

describe('shouldAlert', () => {
  it('調理中 → できあがり、のときだけ知らせる（音・振動）', () => {
    expect(shouldAlert('preparing', 'ready')).toBe(true);
  });
  it('最初の表示では、知らせない（できあがりの注文を、あとから開いたとき）', () => {
    expect(shouldAlert(null, 'ready')).toBe(false);
  });
  it('ほかの変化では、知らせない', () => {
    expect(shouldAlert('ready', 'ready')).toBe(false);
    expect(shouldAlert('ready', 'done')).toBe(false);
    expect(shouldAlert('ready', 'preparing')).toBe(false);
    expect(shouldAlert('done', 'ready')).toBe(false);
    expect(shouldAlert('cancelled', 'ready')).toBe(false);
    expect(shouldAlert('preparing', 'cancelled')).toBe(false);
  });
});

describe('chimeButton（音のお知らせのボタン。#57）', () => {
  it('調理中で、まだタップされていない → arm（「できあがりを音で知らせる」）', () => {
    expect(chimeButton('preparing', false, false)).toBe('arm');
  });
  it('タップのあと、鳴らせる → armed（ボタンではなく、表示だけ）', () => {
    expect(chimeButton('preparing', true, true)).toBe('armed');
  });
  it('タップのあと、鳴らせない状態に戻った（ホームから戻ったあとなど）→ retry（「音をオンにし直す」）', () => {
    expect(chimeButton('preparing', true, false)).toBe('retry');
  });
  it('できあがりで、まだ鳴らせていない知らせがあり、鳴らせない状態 → retry（タップで、すぐ鳴らす）', () => {
    expect(chimeButton('ready', true, false, true)).toBe('retry');
  });
  it('できあがりでも、知らせを鳴らせた・鳴らせる・タップしていないときは、出さない', () => {
    expect(chimeButton('ready', true, false, false)).toBeNull();
    expect(chimeButton('ready', true, true, true)).toBeNull();
    expect(chimeButton('ready', false, false, true)).toBeNull();
  });
  it('お渡し済み・取り消しでは、出さない（もう鳴らすことがない）', () => {
    for (const status of ['done', 'cancelled'] as const) {
      for (const pending of [false, true]) {
        expect(chimeButton(status, false, false, pending)).toBeNull();
        expect(chimeButton(status, true, true, pending)).toBeNull();
        expect(chimeButton(status, true, false, pending)).toBeNull();
      }
    }
  });
});

const pt = (status: CustomerOrder['status'], calls = 0) => ({ status, calls });

describe('shouldRecall（お店の「もう一度呼ぶ」。#58）', () => {
  it('できあがりのまま、calls が増えたら、知らせる', () => {
    expect(shouldRecall(pt('ready', 0), pt('ready', 1))).toBe(true);
    expect(shouldRecall(pt('ready', 2), pt('ready', 3))).toBe(true);
  });
  it('最初の表示（開き直したとき）では、知らせない', () => {
    expect(shouldRecall(null, pt('ready', 3))).toBe(false);
  });
  it('calls が変わらない・できあがりでないときは、知らせない', () => {
    expect(shouldRecall(pt('ready', 1), pt('ready', 1))).toBe(false);
    expect(shouldRecall(pt('preparing', 0), pt('ready', 1))).toBe(false); // 調理中 → できあがりは shouldAlert の側
    expect(shouldRecall(pt('ready', 1), pt('done', 2))).toBe(false);
  });
});

describe('nextPendingAlert（まだ鳴らせていない知らせ。#57・#58）', () => {
  it('調理中 → できあがりで、新しい知らせ（id）にする', () => {
    expect(nextPendingAlert(null, pt('preparing'), pt('ready'), 1)).toBe(1);
  });
  it('「もう一度呼ぶ」で、新しい知らせにする（鳴らせていない知らせがあっても、置き換える）', () => {
    expect(nextPendingAlert(null, pt('ready', 0), pt('ready', 1), 2)).toBe(2);
    expect(nextPendingAlert(1, pt('ready', 0), pt('ready', 1), 2)).toBe(2);
  });
  it('最初の表示（できあがりの注文を、あとから開いた）では、立てない', () => {
    expect(nextPendingAlert(null, null, pt('ready', 2), 1)).toBeNull();
  });
  it('できあがりのままなら、残す。鳴らせて消したあとは、消えたまま', () => {
    expect(nextPendingAlert(1, pt('ready'), pt('ready'), 2)).toBe(1);
    expect(nextPendingAlert(null, pt('ready'), pt('ready'), 2)).toBeNull();
  });
  it('できあがりでなくなったら、消す（お渡し済み・調理中に戻す・取り消し）', () => {
    expect(nextPendingAlert(1, pt('ready'), pt('done'), 2)).toBeNull();
    expect(nextPendingAlert(1, pt('ready'), pt('preparing'), 2)).toBeNull();
    expect(nextPendingAlert(1, pt('ready'), pt('cancelled'), 2)).toBeNull();
  });
});

describe('showReservedNote（予約の案内。#69）', () => {
  it('予約を含み、調理中のときだけ出す', () => {
    expect(showReservedNote({ status: 'preparing', reserved: true })).toBe(true);
    expect(showReservedNote({ status: 'preparing', reserved: false })).toBe(false);
    for (const status of ['ready', 'done', 'cancelled'] as const) expect(showReservedNote({ status, reserved: true })).toBe(false);
  });
});

describe('showLeaveNote（画面を開いているときだけ鳴る、の囲み。#62）', () => {
  it('調理中だけ出す', () => {
    expect(showLeaveNote('preparing')).toBe(true);
  });
  it('できあがり・お渡し済み・取り消しでは、出さない（もう待つ必要が無い）', () => {
    expect(showLeaveNote('ready')).toBe(false);
    expect(showLeaveNote('done')).toBe(false);
    expect(showLeaveNote('cancelled')).toBe(false);
  });
});

describe('showRecallNotice（「お店からお呼びしています」。#58）', () => {
  it('呼ばれていて（30秒は、呼んだ側のタイマーが消す）、できあがりのままなら出す', () => {
    expect(showRecallNotice(1000, 'ready')).toBe(true);
  });
  it('呼ばれていない・できあがりでないときは、出さない', () => {
    expect(showRecallNotice(null, 'ready')).toBe(false);
    expect(showRecallNotice(1000, 'done')).toBe(false);
    expect(showRecallNotice(1000, null)).toBe(false);
  });
});

describe('shouldKeepAwake（画面を消えなくするか。#57）', () => {
  it('タップのあと、調理中・できあがりの間だけ', () => {
    expect(shouldKeepAwake('preparing', true)).toBe(true);
    expect(shouldKeepAwake('ready', true)).toBe(true);
  });
  it('タップの前は、しない（取れない端末があるうえ、お客様が求めていない）', () => {
    expect(shouldKeepAwake('preparing', false)).toBe(false);
  });
  it('お渡し済み・取り消し・まだ表示していないときは、しない（電池のため）', () => {
    expect(shouldKeepAwake('done', true)).toBe(false);
    expect(shouldKeepAwake('cancelled', true)).toBe(false);
    expect(shouldKeepAwake(null, true)).toBe(false);
  });
});

describe('CUSTOMER_STATUS_TEXT（SPEC 6.7）', () => {
  it('バッジと案内文', () => {
    expect(CUSTOMER_STATUS_TEXT.preparing).toEqual({ badge: '調理中', message: 'ただいま調理中です。できあがったら、この画面でお知らせします' });
    expect(CUSTOMER_STATUS_TEXT.ready).toEqual({ badge: 'へい、お待ち！', message: '受け渡し口までお越しください' });
    expect(CUSTOMER_STATUS_TEXT.done).toEqual({ badge: 'お渡し済み', message: '毎度おおきに！' });
    expect(CUSTOMER_STATUS_TEXT.cancelled.badge).toBe('取り消し');
  });
});

describe('parseOrderLink', () => {
  const id = 'AbCdEfGhIjKlMnOpQrSt'; // 20文字
  it('e・o が英数字20文字なら、取り出す', () => {
    expect(parseOrderLink(`?e=${id}&o=${id.toLowerCase()}`)).toEqual({ eventId: id, orderId: id.toLowerCase() });
  });
  it.each(['', '?e=abc&o=def', `?e=${id}`, `?o=${id}`, `?e=${id}&o=${id}x`, `?e=${id}&o=${id.slice(1)}`, `?e=${id}&o=${id.slice(0, 19)}-`, `?e=${id}&o=${'あ'.repeat(20)}`])(
    '%s は不正（null）',
    (search) => {
      expect(parseOrderLink(search)).toBeNull();
    },
  );
});

describe('formatClock', () => {
  it('Asia/Tokyo の時刻（24時間制）', () => {
    expect(formatClock(new Date('2026-08-01T05:05:09Z'))).toBe('14:05:09');
  });
});

describe('isWaiting（読み込み中か。待ちの時間を数える条件。PR #44 のレビュー V1・V4）', () => {
  it.each<[string, CustomerSnapshot | null, boolean]>([
    ['何も届いていない', null, true],
    ['文書なし・キャッシュの結果（オフライン）', { kind: 'doc', order: null, fromCache: true }, true],
    ['文書なし・サーバーの結果（notFound）', { kind: 'doc', order: null, fromCache: false }, false],
    ['エラー', { kind: 'error' }, false],
    ['注文あり', { kind: 'doc', order, fromCache: false }, false],
  ])('%s', (_label, snapshot, expected) => {
    expect(isWaiting(snapshot)).toBe(expected);
  });
});

describe('startWaitTicker と customerView の組み合わせ（偽のタイマー）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('オフラインで、キャッシュだけの結果（文書なし）が届いても、待ちの時間を数え続け、8秒で slow になる（V1）', () => {
    const snapshot: CustomerSnapshot = { kind: 'doc', order: null, fromCache: true };
    let waited = 0;
    const startedAt = Date.now();
    // 画面と同じ：読み込み中と判定されている間、数える（結果が届いたかではなく、判定で決める）
    const stop = isWaiting(snapshot) ? startWaitTicker(startedAt, (ms) => (waited = ms)) : () => {};
    vi.advanceTimersByTime(1000); // 1秒後に、キャッシュの結果が届いたあとも、判定は loading のまま → 数え続ける
    expect(customerView(snapshot, waited)).toEqual({ state: 'loading', slow: false });
    vi.advanceTimersByTime(SLOW_AFTER_MS - 1000);
    expect(waited).toBe(SLOW_AFTER_MS);
    expect(customerView(snapshot, waited)).toEqual({ state: 'loading', slow: true });
    stop();
  });

  it('止めると、それ以上、数えない', () => {
    let ticks = 0;
    const stop = startWaitTicker(Date.now(), () => ticks++);
    vi.advanceTimersByTime(3000);
    stop();
    vi.advanceTimersByTime(5000);
    expect(ticks).toBe(3);
  });
});
