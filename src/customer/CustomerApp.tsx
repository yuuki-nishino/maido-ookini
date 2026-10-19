// お客様画面（/s?e=&o=）。注文1件の状況を表示する（screens.md §4、SPEC 6.7）。
// Auth・Service Worker・永続キャッシュを使わない（DESIGN.md §4）。ホーム画面への追加は求めない
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { IconLabel } from '../components/Icon';
import { Noren } from '../components/Noren';
import { watchOrder } from '../lib/data/customerOrder';
import {
  chimeButton,
  CUSTOMER_STATUS_TEXT,
  customerView,
  formatClock,
  isWaiting,
  nextPendingAlert,
  parseOrderLink,
  RECALL_NOTICE_MS,
  shouldAlert,
  shouldKeepAwake,
  shouldRecall,
  showLeaveNote,
  showReservedNote,
  showRecallNotice,
  type AlertPoint,
  startWaitTicker,
  type ChimeButton,
  type CustomerOrder,
  type CustomerSnapshot,
} from '../lib/domain/customerView';
import { chimeDebug, chimeLog, getVoiceVersion, isChimeRunning, log, playChime, setKeepAwake, syncAwake, unlockChime } from './chime';
import styles from './CustomerApp.module.css';

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

export function CustomerApp() {
  // 不正なリンク（QRの読み違い・URLの改変）は、購読しない
  const link = useMemo(() => parseOrderLink(location.search), []);
  const [snapshot, setSnapshot] = useState<CustomerSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [startedAt] = useState(Date.now); // 開いた時刻（読み込みの待ちの起点）
  const [lastOrder, setLastOrder] = useState<CustomerOrder | null>(null);
  // 音のお知らせ（#57）：armed ＝ このページで、ボタンをタップした。audioRunning ＝ 鳴らせる（直近の再生が拒否されていない）。voiceVersion ＝ 声の読み込みの版
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false); // 購読のコールバックから読むため
  const [audioRunning, setAudioRunning] = useState(false);
  const [voiceVersion, setVoiceVersion] = useState(0);
  // まだ鳴らせていない知らせの番号（声の読み込み待ち・裏に回っている間・拒否からの、タップのし直し待ち）。鳴らせたら null
  const [pending, setPending] = useState<number | null>(null);
  // お店が「もう一度呼ぶ」を押した時刻（#58。「お店からお呼びしています」を出す）
  const [recalledAt, setRecalledAt] = useState<number | null>(null);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [, setLogTick] = useState(0); // ?debug の記録を、描き直すため

  useEffect(() => {
    if (!link) return;
    let prev: AlertPoint | null = null; // 最初の表示では、知らせない
    let alertId = 0;
    return watchOrder(link.eventId, link.orderId, (s) => {
      setSnapshot(s);
      setUpdatedAt(new Date());
      if (s.kind === 'doc' && s.order) {
        const next: AlertPoint = { status: s.order.status, calls: s.order.calls };
        const recall = shouldRecall(prev, next);
        // 「できあがり」に変わった瞬間と、お店の「もう一度呼ぶ」で知らせる：振動は、その場で（対応する端末のみ。iPhone は非対応）。
        // 声は、下の effect が鳴らす（タップのあとだけ）
        if (recall || shouldAlert(prev?.status ?? null, next.status)) navigator.vibrate?.([200, 100, 200]);
        if (recall) setRecalledAt(Date.now());
        const from = prev;
        const id = ++alertId;
        setPending((p) => nextPendingAlert(p, from, next, id));
        prev = next;
        setLastOrder(s.order); // エラーのあとも、カードを残すため
      }
    });
  }, [link]);

  // 読み込み中が続く時間を数える（8秒で「通信が不安定です」を添える）。
  // 条件は、結果が届いたかではなく、「読み込み中と判定されているか」（オフラインで、キャッシュだけの結果が届いても、数え続ける。PR #44 のレビュー V1）
  const waiting = link !== null && isWaiting(snapshot);
  useEffect(() => {
    if (!waiting) return;
    return startWaitTicker(startedAt, setWaitedMs);
  }, [waiting, startedAt]);

  const view = link ? customerView(snapshot, waitedMs, lastOrder) : null;
  const status = view?.state === 'active' ? view.order.status : null;

  // 画面を消えなくする（タップのあと、調理中・できあがりの間だけ）。対応していない端末では、何もしない
  const awake = shouldKeepAwake(status, armed);
  useEffect(() => setKeepAwake(awake), [awake]);

  // 音の状態が変わったとき（chime.ts から）
  const onChimeChange = () => {
    setAudioRunning(isChimeRunning());
    setVoiceVersion(getVoiceVersion());
    setLogTick((n) => n + 1);
  };

  // まだ鳴らせていない知らせがあれば、鳴らす。鳴らせなければ、声の読み込み・拒否からの回復（タップ）・表示に戻る、のどれかが変わったときに、もう一度
  useEffect(() => {
    if (pending === null || !armed) return;
    void playChime(pending).then((played) => played && setPending((p) => (p === pending ? null : p)));
  }, [pending, armed, audioRunning, voiceVersion, visible]);

  // 「お店からお呼びしています」は、呼ばれてから30秒で消す（呼ばれ直したら、数え直す）
  const recallNotice = showRecallNotice(recalledAt, status);
  useEffect(() => {
    if (recalledAt === null) return;
    const id = setTimeout(() => setRecalledAt(null), RECALL_NOTICE_MS);
    return () => clearTimeout(id);
  }, [recalledAt]);

  // ホームに戻って、また開いたとき：画面を消えなくするのを取り直す。声は、上の effect が鳴らす（拒否されたら、ボタン「音をオンにし直す」）
  useEffect(() => {
    const onVisibility = () => {
      const isVisible = document.visibilityState === 'visible';
      setVisible(isVisible);
      if (!armedRef.current) return;
      log(isVisible ? 'visible' : 'hidden');
      if (!isVisible) return;
      syncAwake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // ボタンのタップ：音を鳴らせる状態にする（聞こえる音は鳴らさない）。まだ鳴らせていない知らせがあれば、その場で鳴らす。
  // 画面を消えなくする。Android の振動も、このタップで効くようになる
  const onArm = () => {
    unlockChime(onChimeChange, pending);
    armedRef.current = true;
    setArmed(true);
    setKeepAwake(shouldKeepAwake(status, true));
    onChimeChange();
  };

  // タブの題名にも、番号と状況を出す（ほかのアプリに切り替えても、分かるように）
  const activeNumber = view?.state === 'active' ? view.order.number : null;
  useEffect(() => {
    document.title = activeNumber !== null && status ? `${activeNumber}番 ${CUSTOMER_STATUS_TEXT[status].badge}｜毎度おおきに` : 'ご注文の状況｜毎度おおきに';
  }, [activeNumber, status]);

  return (
    <>
      <Noren title="ご注文の状況" sub="毎度おおきに" />
      <main class={styles.main}>
        {!link ? (
          <Notice title="このQRは正しくありません" error>
            お手数ですが、お近くのスタッフへお声がけください
          </Notice>
        ) : view?.state === 'loading' ? (
          <Notice title="読み込み中…">
            {view.slow && <p class={styles.hint}>通信が不安定です。電波の良い場所で、お待ちください</p>}
          </Notice>
        ) : view?.state === 'notFound' ? (
          <Notice title="注文が見つかりません" error>
            お近くのスタッフへお声がけください
          </Notice>
        ) : view?.state === 'error' ? (
          <Notice title="通信できません" error>
            電波の良い場所で、もう一度開いてください
          </Notice>
        ) : view?.state === 'active' ? (
          <Active order={view.order} fromCache={view.fromCache} updatedAt={updatedAt} chime={chimeButton(view.order.status, armed, audioRunning, pending !== null)} recallNotice={recallNotice} onArm={onArm} />
        ) : null}
        {chimeDebug && (
          <pre class={styles.debug}>
            {`armed=${armed} running=${audioRunning} voice=${voiceVersion} pending=${pending} visible=${visible}\n${chimeLog.join('\n')}`}
          </pre>
        )}
      </main>
    </>
  );
}

function Notice({ title, error = false, children }: { title: string; error?: boolean; children?: ComponentChildren }) {
  return (
    <div class={styles.notice} role={error ? 'alert' : 'status'}>
      <p class={`${styles.noticeTitle} ${error ? styles.noticeError : ''}`}>{title}</p>
      {typeof children === 'string' ? <p class={styles.hint}>{children}</p> : children}
    </div>
  );
}

type ActiveProps = { order: CustomerOrder; fromCache: boolean; updatedAt: Date | null; chime: ChimeButton; recallNotice: boolean; onArm: () => void };

function Active({ order, fromCache, updatedAt, chime, recallNotice, onArm }: ActiveProps) {
  const text = CUSTOMER_STATUS_TEXT[order.status];
  return (
    <>
      {/* 状況が変わったら、読み上げる（色だけに頼らず、文字でも示す） */}
      <section class={`${styles.card} ${styles[order.status]}`} aria-live="polite" aria-label={`${order.number}番 ${text.badge}`}>
        <span class={styles.label}>あなたの番号</span>
        <h2 class={styles.number}>
          {order.number}
          <span class={styles.numberUnit}>番</span>
        </h2>
        <span class={styles.badge}>{text.badge}</span>
        <p class={styles.message}>{text.message}</p>
        {/* 予約を含む（#69）：待ちが長くなることを伝える */}
        {showReservedNote(order) && <p class={styles.reservedNote}>在庫を用意しています。用意でき次第、調理します</p>}
        {/* お店の「もう一度呼ぶ」（#58）。音を鳴らせないお客様にも、文字で分かるように */}
        {recallNotice && (
          <p class={styles.recall} role="alert">
            <IconLabel icon="megaphone">お店からお呼びしています</IconLabel>
          </p>
        )}
      </section>

      {chime === 'armed' ? (
        <p class={styles.chimeOn} role="status">
          <IconLabel icon="bell">できあがりを、音でお知らせします</IconLabel>
        </p>
      ) : chime ? (
        <button type="button" class={styles.chimeButton} onClick={onArm}>
          <IconLabel icon="bell">{chime === 'arm' ? 'できあがりを音で知らせる' : '音をオンにし直す'}</IconLabel>
          <span class={styles.chimeSub}>タップしてください（音量を上げておいてください）</span>
        </button>
      ) : null}

      {/* 画面を離れると、音は鳴らない（iPhone。screens.md §4.2）。音で知らせてもらえると思って、気づけないことがないように（#62）。
          読みそびれないよう、囲みにする。音のボタンの下（ボタン → 注意事項、の順に読む） */}
      {showLeaveNote(order.status) && (
        <div class={styles.leaveNote}>
          <p class={styles.leaveNoteTitle}>
            <IconLabel icon="alert">音でお知らせできるのは、この画面を開いているときだけです</IconLabel>
          </p>
          <p class={styles.leaveNoteText}>ときどきこの画面に戻ってきてください。できあがっていれば、そのときお知らせします</p>
        </div>
      )}

      <section class={styles.detail} aria-label="ご注文の内容">
        <ul class={styles.items}>
          {order.items.map((i, k) => (
            <li key={k} class={styles.item}>
              <span class={styles.itemName}>
                {i.name} × {i.qty}
              </span>
              <span>{yen(i.price * i.qty)}</span>
            </li>
          ))}
        </ul>
        <div class={styles.total}>
          <span>合計</span>
          <span>{yen(order.total)}</span>
        </div>
      </section>

      <p class={styles.meta}>
        {updatedAt && <span>最終更新 {formatClock(updatedAt)}</span>}
        {fromCache && <span class={styles.unstable}>通信が不安定です</span>}
      </p>
    </>
  );
}
