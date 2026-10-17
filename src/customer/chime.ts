// できあがりの声と、画面を消えなくする仕組み（screens.md §4.2、#57）。
// ブラウザは、一度もタップされていないページでは、音を鳴らせない。タップの中で unlockChime() を呼んで、<audio> を一度、消音で再生する。
// 音は、録音した「へい、お待ち！」（AAC・約48KB）。最初の読み込みを重くしないよう、タップのあとに読み込む。
// Web Audio ではなく <audio> を使う：iPhone は、裏から戻ったあと、AudioContext が 'running' のまま無音になることがあり、
// 気付けない（実機の確認、#57）。<audio> は、鳴らせなければ play() が失敗するので、ボタン「音をオンにし直す」を出せる
import voiceUrl from './hei-omachi.m4a?url';

// Safari 17〜。消音スイッチ（マナーモード）がオンでも、鳴らすため。型定義に無いため、ここで宣言する
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * タップの消音の再生を止めてから、消音を解くまでの間。止めてすぐ解くと、iPhone で、声の頭が一瞬聞こえた。
 * 鳴らす直前まで解かないと、iPhone の裏で鳴らなかった（#57）。間をあけて解き、両方を避ける（#58 の調査。★A1）
 */
const UNMUTE_DELAY_MS = 500;

let el: HTMLAudioElement | null = null;
let unlocked = false; // タップした（再生の許しを求めた）
let denied = false; // 直近の再生が、拒否された（NotAllowedError。タップし直しが必要）
let voiceVersion = 0; // 読み込めた・読み込み直した、たびに増やす（呼んだ側が、鳴らし直すきっかけにする）
let retryMs = 2000;
let lastPlayedId: number | null = null; // 鳴らし始められた知らせの番号（同じ知らせは、二度鳴らさない）
let playing: { id: number; p: Promise<boolean> } | null = null; // 鳴らし始める途中の play()
let playGen = 0; // 本当の再生を始めるたびに増やす（消音の unlock が、あとから声を止めないように）
let notify: () => void = () => {};

// ?debug のときだけ、画面に記録を出す（実機で、原因を確かめるため）
export const chimeDebug = new URLSearchParams(location.search).has('debug');
export const chimeLog: string[] = [];
/** 記録する（?debug のときだけ）。あわせて、状態が変わったことを、呼んだ側に知らせる */
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
    retryMs = 2000;
    voiceVersion++;
    log('voice loaded');
  });
  // 読み込みの失敗：間隔を倍にして（2秒〜30秒）、読み込み直す。iPhone は、タップの外の load() では、データまで読まないことがあるため、
  // 読み込み直すたびに知らせ、呼んだ側が play() を試す（play() は、自分で読み込みを待つ）
  a.addEventListener('error', () => {
    log(`voice failed: ${a.error?.code ?? '?'}（${retryMs / 1000}秒後に再試行）`);
    setTimeout(() => {
      a.load();
      voiceVersion++;
      log('voice reload');
    }, retryMs);
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
export function unlockChime(onChange: () => void, playNow: number | null = null): void {
  notify = onChange;
  const nav = navigator as AudioSessionNavigator;
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    // 対応していなければ、そのまま
  }
  const a = audioEl();
  unlocked = true;
  if (playNow !== null) {
    void startVoice(playNow);
    return;
  }
  // 消音で一度再生して、すぐ止める（タップの中で再生すると、以後、タップなしで鳴らせる）。
  // 消音は、ここでは解かない（本当に鳴らすとき、startVoice で解く）。止めてすぐ解くと、iPhone で、声の頭が一瞬聞こえることがあった（実機の確認）
  const gen = playGen;
  a.muted = true;
  a.play().then(
    () => {
      denied = false;
      log('unlock');
      if (gen !== playGen) return; // 間に、本当の再生が始まった（止めない）
      a.pause();
      a.currentTime = 0;
      setTimeout(() => {
        if (gen === playGen && a.paused) a.muted = false;
      }, UNMUTE_DELAY_MS);
    },
    (e: unknown) => {
      if (errName(e) === 'NotAllowedError') denied = true; // ボタン「音をオンにし直す」を出す
      log(`unlock failed: ${errName(e)}`);
    },
  );
}

/** いま鳴らせる状態か（タップのあと、直近の再生が拒否されていない） */
export function isChimeRunning(): boolean {
  return unlocked && !denied;
}

/** 声の読み込みの版（読み込めた・読み込み直したたびに増える） */
export function getVoiceVersion(): number {
  return voiceVersion;
}

/**
 * 知らせ（id）の声を1回鳴らす。鳴らし始められたら true。タップの前・拒否された・読み込めないときは false（呼んだ側が、あとで、もう一度呼ぶ）。
 * 同じ知らせを、もう鳴らし始めていれば、重ねずに true。鳴らし始める途中なら、その結果を待つ
 */
export function playChime(id: number): Promise<boolean> {
  if (!unlocked) return Promise.resolve(false);
  return startVoice(id);
}

function startVoice(id: number): Promise<boolean> {
  if (lastPlayedId === id) return Promise.resolve(true);
  if (playing) return playing.id === id ? playing.p : playing.p.then(() => startVoice(id));
  const a = audioEl();
  playGen++;
  a.muted = false;
  a.currentTime = 0;
  // play() は、タップの中で呼ぶ（unlockChime の playNow）ために、await の前に呼ぶ
  const p = a.play().then(
    () => {
      playing = null;
      lastPlayedId = id;
      denied = false;
      log(`play #${id}`);
      return true;
    },
    (e: unknown) => {
      playing = null;
      if (errName(e) === 'NotAllowedError') denied = true;
      log(`play failed #${id}: ${errName(e)}`);
      return false;
    },
  );
  playing = { id, p };
  return p;
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
