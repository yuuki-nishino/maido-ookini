// 在庫（いまの残り）の変更（#67、screens.md §3.8）。メニューの行から開く。
// 「＋補充」は足す（increment）、「残りを直す」は数え直した数にする、「在庫を使わない」で外す。保存は、待たずに閉じる（オフラインでも受け付ける）
import type { TargetedEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import type { MenuItem } from '../../lib/data/types';
import { parseStock, STOCK_ERROR } from '../../lib/domain/menu';
import styles from './StockDialog.module.css';

type Props = {
  /** 変える商品。null なら閉じている */
  item: MenuItem | null;
  onAdd: (item: MenuItem, n: number) => void;
  onSet: (item: MenuItem, stock: number | null) => void;
  onClose: () => void;
};

export function StockDialog({ item, onAdd, onSet, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const open = item !== null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setText('');
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open, item?.id]);

  const n = parseStock(text);
  const managed = item?.stock != null;
  const error = text !== '' && n === null ? STOCK_ERROR : null;

  return (
    <dialog ref={ref} class={styles.dialog} aria-labelledby="stock-dialog-title" onCancel={(e) => (e.preventDefault(), onClose())}>
      {item && (
        <form class={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
          <h2 id="stock-dialog-title" class={styles.title}>
            {item.name}の在庫
          </h2>
          <p class={styles.now}>{managed ? <>いまの残り：<strong>{item.stock}</strong></> : '在庫を使っていません（注文で数が減らない・売り切れは手で切り替える）'}</p>
          <TextField
            label={managed ? '数' : 'いまの残り'}
            inputMode="numeric"
            placeholder="例：50"
            hint={managed ? '補充した数を足すか、数え直した数にします' : '入れると、在庫を使い始めます'}
            value={text}
            error={error}
            onInput={(e: TargetedEvent<HTMLInputElement>) => setText(e.currentTarget.value)}
          />
          <div class={styles.actions}>
            {managed && (
              <Button variant="primary" disabled={n === null || n === 0} onClick={() => n !== null && onAdd(item, n)}>
                ＋補充（足す）
              </Button>
            )}
            <Button variant={managed ? 'secondary' : 'primary'} disabled={n === null} onClick={() => n !== null && onSet(item, n)}>
              {managed ? '残りを直す（この数にする）' : '在庫を使う'}
            </Button>
          </div>
          <div class={styles.footer}>
            <Button variant="secondary" onClick={onClose}>
              やめる
            </Button>
            {managed && (
              <Button variant="danger" onClick={() => onSet(item, null)}>
                在庫を使わない
              </Button>
            )}
          </div>
        </form>
      )}
    </dialog>
  );
}
