// 予約のお渡しの目安を直す（#70）。調理画面の予約のカードから開く。時刻を入れて保存、または「目安を消す」（未定。iPhone は、時刻の欄を空にできないため、ボタンで消す）。
// 保存は、待たずに閉じる（オフラインでも受け付ける）。お客様の画面にも、すぐ反映される
import type { TargetedEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { etaError, etaToTimeInput, parseEta } from '../../lib/domain/eta';
import styles from './NoteDialog.module.css';

type Props = {
  /** 直す注文。null なら閉じている */
  order: { id: string; number: number; etaAt: Date | null } | null;
  /** etaAt：ミリ秒。null で消す */
  onSave: (orderId: string, etaAt: number | null) => void;
  onClose: () => void;
};

export function EtaDialog({ order, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const open = order !== null;

  // 開くたびに、いまの目安を入れる
  const etaRef = useRef<Date | null>(null);
  useEffect(() => {
    etaRef.current = order?.etaAt ?? null;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setText(etaRef.current ? etaToTimeInput(etaRef.current.getTime()) : '');
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, order?.id]);

  const error = etaError(text, new Date());

  function submit(e: Event) {
    e.preventDefault();
    if (!order || error !== null) return;
    if (text === '') return onSave(order.id, null);
    const r = parseEta(text, new Date());
    if (r.ok) onSave(order.id, r.etaAt);
  }

  return (
    <dialog ref={ref} class={styles.dialog} aria-labelledby="eta-dialog-title" onCancel={(e) => (e.preventDefault(), onClose())}>
      {order && (
        <form class={styles.form} onSubmit={submit} noValidate>
          <h2 id="eta-dialog-title" class={styles.title}>
            {order.number}番のお渡しの目安
          </h2>
          <TextField
            kind="time"
            label="お渡しの目安（時刻）"
            hint="今日の、いまより後の時刻。お客様の画面に「◯時◯分ごろ」と出ます"
            value={text}
            error={error}
            onInput={(e: TargetedEvent<HTMLInputElement>) => setText(e.currentTarget.value)}
          />
          {order.etaAt && (
            <Button variant="secondary" block onClick={() => onSave(order.id, null)}>
              目安を消す（未定にする）
            </Button>
          )}
          <div class={styles.actions}>
            <Button variant="secondary" onClick={onClose}>
              やめる
            </Button>
            <Button type="submit" variant="primary" disabled={error !== null}>
              保存する
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
