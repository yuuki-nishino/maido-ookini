// 「もう一度呼ぶ」のボタンの状態（#58）
import { describe, expect, it } from 'vitest';
import { RECALL_COOLDOWN_MS, recallState } from '../../src/lib/domain/recall';

const base = { status: 'ready' as const, qr: true, held: false, online: true, lastAt: null, now: 100_000 };

describe('recallState', () => {
  it('できあがり・QR あり・オンライン・押していない → ready', () => {
    expect(recallState(base)).toEqual({ kind: 'ready' });
  });
  it('できあがりでない・QR なし（お客様画面が無い）→ hidden', () => {
    for (const status of ['preparing', 'done', 'cancelled'] as const) expect(recallState({ ...base, status })).toEqual({ kind: 'hidden' });
    expect(recallState({ ...base, qr: false })).toEqual({ kind: 'hidden' });
  });
  it('「完成」の猶予の間 → held（オフラインより先）', () => {
    expect(recallState({ ...base, held: true, online: false })).toEqual({ kind: 'held' });
  });
  it('オフライン → offline', () => {
    expect(recallState({ ...base, online: false })).toEqual({ kind: 'offline' });
  });
  it('押してから10秒の間 → wait（残り秒数を切り上げ）。10秒たてば ready', () => {
    expect(recallState({ ...base, lastAt: base.now })).toEqual({ kind: 'wait', seconds: 10 });
    expect(recallState({ ...base, lastAt: base.now - 9_001 })).toEqual({ kind: 'wait', seconds: 1 });
    expect(recallState({ ...base, lastAt: base.now - RECALL_COOLDOWN_MS })).toEqual({ kind: 'ready' });
  });
});
