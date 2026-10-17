// できあがりの声と、画面を消えなくする仕組み（screens.md §4.2、#57）。
// ブラウザは、一度もタップされていないページでは、音を鳴らせない。タップの中で unlockChime() を呼んで、<audio> を一度、消音で再生する。
// 音は、録音した「へい、お待ち！」（AAC・約40KB）。最初の読み込みを重くしないよう、タップのあとに読み込む。
// Web Audio ではなく <audio> を使う：iPhone は、裏から戻ったあと、AudioContext が 'running' のまま無音になることがあり、
// 気付けない（実機の確認、#57）。<audio> は、鳴らせなければ play() が失敗するので、ボタン「音をオンにし直す」を出せる
import voiceUrl from './hei-omachi.m4a?url';

// Safari 17〜。消音スイッチ（マナーモード）がオンでも、鳴らすため。型定義に無いため、ここで宣言する
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** 同じできあがりで、声が重ならないようにする間（裏で鳴らした分と、戻ったときの分など） */
const REPLAY_GUARD_MS = 5000;

let el: HTMLAudioElement | null = null;
let unlocked = false; // タップした（再生の許しを求めた）
let failed = false; // 直近の再生が、拒否された（タップし直しが必要）
let voiceReady = false;
let retryMs = 2000;
let lastPlayedAt = -Infinity;
let notify: () => void = () => {};

// ?debug のときだけ、画面に記録を出す（実機で、原因を確かめるため）
export const chimeDebug = new URLSearchParams(location.search).has('debug');
export const chimeLog: string[] = [];
export function log(msg: string) {
  if (chimeDebug) {
    const t = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    chimeLog.unshift(`${t} ${msg}`);
    chimeLog.length = Math.min(chimeLog.length, 30);
  }
  notify();
}

function audioEl(): HTMLAudioElement {
  if (el) return el;
  const a = new Audio();
  a.preload = 'auto';
  a.addEventListener('canplaythrough', () => {
    if (voiceReady) return;
    voiceReady = true;
    retryMs = 2000;
    log('voice loaded');
  });
  a.addEventListener('error', () => {
    voiceReady = false;
    log(`voice failed: ${a.error?.code ?? '?'}（${retryMs / 1000}秒後に再試行）`);
    setTimeout(() => a.load(), retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  });
  a.addEventListener('ended', () => log('ended')); // ?debug：最後まで再生されたか
  a.src = voiceUrl;
  el = a;
  return a;
}

/**
 * タップの中で呼ぶ。音を鳴らせる状態にする（聞こえる音は鳴らさない）。onChange は、鳴らせるか・声を読み込めたかが変わったときに呼ばれる。
 * まだ鳴らせていない知らせ（playNow）があれば、消音にせず、そのまま鳴らす
 */
export function unlockChime(onChange: () => void, playNow = false): void {
  notify = onChange;
  const nav = navigator as AudioSessionNavigator;
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    // 対応していなければ、そのまま
  }
  const a = audioEl();
  unlocked = true;
  if (playNow) {
    void startVoice();
    return;
  }
  // 消音で一度再生して、すぐ止める（タップの中で再生すると、以後、タップなしで鳴らせる）
  a.muted = true;
  a.play().then(
    () => {
      a.pause();
      a.currentTime = 0;
      a.muted = false;
      failed = false;
      log('unlock');
    },
    (e: unknown) => {
      a.muted = false;
      failed = true; // ボタン「音をオンにし直す」を出す
      log(`unlock failed: ${errName(e)}`);
    },
  );
}

/** いま鳴らせる状態か（タップのあと、直近の再生が拒否されていない） */
export function isChimeRunning(): boolean {
  return unlocked && !failed;
}

/** 声を読み込めたか */
export function isVoiceReady(): boolean {
  return voiceReady;
}

/**
 * 声を1回鳴らす（振動も）。鳴らし始めたら true。声がまだ無い・拒否されたときは false（呼んだ側が、あとで、もう一度呼ぶ）。
 * 直前（5秒以内）に鳴らしていれば、重ねずに true
 */
export async function playChime(): Promise<boolean> {
  if (!el || !unlocked || !voiceReady) return false;
  return startVoice();
}

async function startVoice(): Promise<boolean> {
  const a = audioEl();
  const now = performance.now();
  if (now - lastPlayedAt < REPLAY_GUARD_MS) return true;
  lastPlayedAt = now;
  a.muted = false;
  a.currentTime = 0;
  try {
    await a.play();
  } catch (e) {
    lastPlayedAt = -Infinity;
    failed = true;
    log(`play failed: ${errName(e)}`);
    return false;
  }
  failed = false;
  navigator.vibrate?.([200, 100, 200]); // 対応する端末のみ（iPhone は非対応）
  log('play');
  return true;
}

const errName = (e: unknown) => (e instanceof Error ? e.name : String(e));

// ---------- 画面を消えなくする（Screen Wake Lock） ----------
let wanted = false;
let lock: WakeLockSentinel | null = null;
let requesting = false;

/** 画面を消えなくするか、を決める。何度呼んでも、取るのは1つだけ。対応していない端末・取れないときは、何もしない */
export function setKeepAwake(want: boolean): void {
  wanted = want;
  syncAwake();
}

/** 表示に戻ったときに呼ぶ（裏に回ると、ブラウザが自動で外すため、取り直す） */
export function syncAwake(): void {
  if (!wanted) {
    void lock?.release().catch(() => {});
    lock = null;
    return;
  }
  if (requesting || (lock && !lock.released) || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  requesting = true;
  navigator.wakeLock
    .request('screen')
    .then((l) => {
      requesting = false;
      lock = l;
      log('wakeLock');
      if (!wanted) syncAwake(); // 取っている間に、外すことになった
    })
    .catch((e) => {
      requesting = false;
      log(`wakeLock failed: ${String(e)}`); // 電池の節約モードなど
    });
}
