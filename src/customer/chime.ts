// できあがりの音と、画面を消えなくする仕組み（screens.md §4.2、#57）。
// ブラウザは、一度もタップされていないページでは、音を鳴らせない。タップの中で unlock() を呼んで、AudioContext を作る。
// 音は、Web Audio で作る（音声ファイルを持たない。お客様画面の軽さのため）

// Safari 17〜。消音スイッチ（マナーモード）がオンでも、鳴らすため（★実機で確認）。型定義に無いため、ここで宣言する
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

let ctx: AudioContext | null = null;

/** タップの中で呼ぶ。音を鳴らせる状態にし、確かめのため、一度鳴らす。onState は、鳴らせるかが変わったときに呼ばれる */
export function unlockChime(onState: (running: boolean) => void): void {
  const nav = navigator as AudioSessionNavigator;
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      // 対応していなければ、そのまま
    }
  }
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // Web Audio が無い端末では、音は鳴らさない（色・振動で知らせる）
    ctx = new Ctor();
    // iPhone は、裏に回ると 'interrupted'（Safari だけの状態）になる
    ctx.onstatechange = () => onState(isChimeRunning());
  }
  void playChime();
}

/** 鳴らせる状態か。Web Audio が無い端末では、true（ボタンで、何度もタップを求めないため） */
export function isChimeRunning(): boolean {
  if (!ctx) return !window.AudioContext && !('webkitAudioContext' in window);
  return ctx.state === 'running';
}

/** タップのあとなら、止まっていても、再開を試みる（ホームに戻ったあと）。タップなしで再開できるかは、端末による（★実機で確認） */
export async function resumeChime(): Promise<boolean> {
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      // 再開できなければ、ボタンを、もう一度出す
    }
  }
  return ctx.state === 'running';
}

/** 「ピンポン」を2回。再開できなければ、何もしない */
export async function playChime(): Promise<void> {
  if (!ctx || !(await resumeChime())) return;
  const t0 = ctx.currentTime + 0.05;
  for (let rep = 0; rep < 2; rep++) {
    tone(ctx, 880, t0 + rep * 1.2); // ピン（ラ）
    tone(ctx, 698.46, t0 + rep * 1.2 + 0.45); // ポン（ファ）
  }
}

function tone(c: AudioContext, freq: number, at: number) {
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.8, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
  gain.connect(c.destination);
  // 小さなスピーカーでも聞こえやすいよう、1オクターブ上の音を少し重ねる
  const partials: [number, number][] = [
    [freq, 1],
    [freq * 2, 0.25],
  ];
  for (const [f, level] of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.frequency.value = f;
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(at);
    osc.stop(at + 0.95);
  }
}

let lock: WakeLockSentinel | null = null;

/** 画面を消えなくする（Screen Wake Lock）。対応していない端末・取れないときは、何もしない。裏に回ると自動で外れるため、表示に戻ったら、また呼ぶ */
export async function keepAwake(): Promise<void> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  if (lock && !lock.released) return;
  try {
    lock = await navigator.wakeLock.request('screen');
  } catch {
    lock = null; // 電池の節約モードなど
  }
}

export function releaseAwake(): void {
  void lock?.release().catch(() => {});
  lock = null;
}
