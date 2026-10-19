// 在庫が足りないときの選択（#69、order-confirm.md §6）。画面の中央に出す（下に出る知らせでは、気づかなかった。実機の確認）。
// 「予約として確定する」：同じカートで、足りない分を予約にして確定し直す。「数を減らす」：確定せず、カートに戻る
import { useEffect, useRef } from 'preact/hooks';
import { Button } from '../../components/Button';
import type { StockShortage } from '../../lib/domain/stock';
import styles from './StockShortDialog.module.css';

type Props = {
  /** 足りなかった商品。null なら閉じている */
  shortages: StockShortage[] | null;
  onReserve: () => void;
  onReduce: () => void;
};

export function StockShortDialog({ shortages, onReserve, onReduce }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = shortages !== null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} class={styles.dialog} aria-labelledby="stock-short-title" onCancel={(e) => (e.preventDefault(), onReduce())}>
      {shortages && (
        <div class={styles.body}>
          <h2 id="stock-short-title" class={styles.title}>
            在庫が足りません
          </h2>
          <p class={styles.lead}>まだ確定していません。</p>
          <ul class={styles.list}>
            {shortages.map((s) => (
              <li key={s.menuId} class={styles.row}>
                <span class={styles.name}>{s.name}</span>
                <span class={styles.nums}>
                  残り <strong>{s.stock}</strong>（注文 {s.qty}・予約になる {s.qty - s.stock}）
                </span>
              </li>
            ))}
          </ul>
          <p class={styles.hint}>予約にすると、在庫を用意してから作ります。お客様の画面にも、予約であることが出ます。</p>
          {/* 数を減らす（安全な方）を左、予約として確定する（主の操作）を右に、離して置く */}
          <div class={styles.actions}>
            <Button variant="secondary" onClick={onReduce}>
              数を減らす
            </Button>
            <Button variant="primary" onClick={onReserve}>
              予約として確定する
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
