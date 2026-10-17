// できあがりの声と、画面を消えなくする仕組み（screens.md §4.2、#57）。
// ブラウザは、一度もタップされていないページでは、音を鳴らせない。タップの中で unlockChime() を呼んで、AudioContext を作る。
// 音は、録音した「へい、お待ち！」（AAC・約40KB）。最初の読み込みを重くしないよう、タップのあとに読み込む。
// 読み込めなければ、間隔を倍にして（2秒〜30秒）、読み込めるまでやり直す
import voiceUrl from './hei-omachi.m4a?url';

// Safari 17〜。消音スイッチ（マナーモード）がオンでも、鳴らすため。型定義に無いため、ここで宣言する
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/** 同じできあがりで、声が重ならないようにする間（裏で鳴らした分と、戻ったときの分など） */
const REPLAY_GUARD_MS = 5000;
/** 表示に戻ったとき、音の再開を待つ上限。iPhone は、タップしないと、再開が終わらないことがある */
const RESUME_TIMEOUT_MS = 1500;

let ctx: AudioContext | null = null;
let voiceBuf: AudioBuffer | null = null;
let loading = false;
let retryMs = 2000;
let lastPlayedAt = -Infinity;
let notify: () => void = () => {};

// ?debug のときだけ、画面に記録を出す（実機で、原因を確かめるため）
export const chimeDebug = new URLSearchParams(location.search).has('debug');
export const chimeLog: string[] = [];
export function log(msg: string) {
  if (chimeDebug) {
    const t = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    chimeLog.unshift(`${t} ${msg}${ctx ? ` [${ctx.state}]` : ''}`);
    chimeLog.length = Math.min(chimeLog.length, 30);
  }
  notify();
}

/**
 * タップの中で呼ぶ。音を鳴らせる状態にする（聞こえる音は鳴らさない）。onChange は、鳴らせるか・声を読み込めたかが変わったときに呼ばれる。
 * 作れなければ（Web Audio が無い・例外）false
 */
export function unlockChime(onChange: () => void): boolean {
  notify = onChange;
  const nav = navigator as AudioSessionNavigator;
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    // 対応していなければ、そのまま
  }
  try {
    if (!ctx || ctx.state === 'closed') {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      ctx = new Ctor();
      voiceBuf = null; // 声は、作った AudioContext ごとに読み直す
      // iPhone は、裏に回ると 'interrupted'（Safari だけの状態）になる
      ctx.onstatechange = () => log('statechange');
    }
    void ctx.resume().catch(() => {});
    // iPhone は、タップの中で音を出さないと、有効にならないことがある。聞こえない、ごく短い音を出す
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start();
  } catch (e) {
    log(`unlock failed: ${String(e)}`);
    return false;
  }
  log('unlock');
  loadVoice();
  return true;
}

function loadVoice(): void {
  if (!ctx || voiceBuf || loading) return;
  loading = true;
  const c = ctx;
  fetch(voiceUrl)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((buf) => c.decodeAudioData(buf))
    .then((buf) => {
      loading = false;
      if (c !== ctx) return;
      voiceBuf = buf;
      retryMs = 2000;
      log('voice loaded');
    })
    .catch((e) => {
      loading = false;
      log(`voice failed: ${String(e)}（${retryMs / 1000}秒後に再試行）`);
      setTimeout(loadVoice, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    });
}

/** いま鳴らせる状態か（AudioContext が動いている） */
export function isChimeRunning(): boolean {
  return ctx?.state === 'running';
}

/** 声を読み込めたか */
export function isVoiceReady(): boolean {
  return voiceBuf !== null;
}

/** 止まっていれば、再開を試みる（ホームに戻ったあと）。上限の時間までに再開できなければ false（ボタンを、もう一度出す） */
export async function resumeChime(): Promise<boolean> {
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    const resumed = ctx.resume().then(
      () => true,
      () => false,
    );
    const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), RESUME_TIMEOUT_MS));
    await Promise.race([resumed, timeout]);
    log('resume');
  }
  return ctx.state === 'running';
}

/**
 * 声を1回鳴らす。鳴らし始めたら true。声がまだ無い・再開できないときは false（呼んだ側が、あとで、もう一度呼ぶ）。
 * 直前（5秒以内）に鳴らしていれば、重ねずに true
 */
export async function playChime(): Promise<boolean> {
  if (!ctx) return false;
  if (!voiceBuf) {
    loadVoice();
    return false;
  }
  if (!(await resumeChime())) return false;
  return startVoice();
}

/** タップの中で、すぐ鳴らす（待たない。iPhone は、タップの中で鳴らし始めると、確実に鳴る） */
export function playChimeNow(): boolean {
  if (!ctx || !voiceBuf) return false;
  void ctx.resume().catch(() => {});
  return startVoice();
}

function startVoice(): boolean {
  if (!ctx || !voiceBuf) return false;
  const now = performance.now();
  if (now - lastPlayedAt < REPLAY_GUARD_MS) return true;
  lastPlayedAt = now;
  const src = ctx.createBufferSource();
  src.buffer = voiceBuf;
  src.connect(ctx.destination);
  src.start();
  navigator.vibrate?.([200, 100, 200]); // 対応する端末のみ（iPhone は非対応）
  log('play');
  return true;
}

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
