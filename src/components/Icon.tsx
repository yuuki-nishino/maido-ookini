// アイコン（visual.md §3）。絵文字の代わりに、線で描く小さな SVG。文字の色（currentColor）と大きさ（1em）に合わせる。
// 外部のアイコン集は使わない（お客様画面の軽さのため。必要な形だけを、ここに描く）。飾りなので、読み上げない（aria-hidden）
import type { ComponentChildren } from 'preact';
import styles from './Icon.module.css';

const PATHS = {
  // ベル：音のお知らせ
  bell: ['M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6z', 'M10.2 18.6h3.6a1.8 1.8 0 0 1-3.6 0z'],
  // 注意：三角に「!」
  alert: ['M12 3.5 2.5 20h19L12 3.5z', 'M12 10v4.5', 'M12 17.2v.1'],
  // メガホン：お店からの呼び出し
  megaphone: ['M3 10a1 1 0 0 1 1-1h3l9-4.5v15L7 15H4a1 1 0 0 1-1-1z', 'M6.5 15 7.5 19.5h2.5l-.6-3.1', 'M19.5 9.5a3.5 3.5 0 0 1 0 5'],
} as const;

export type IconName = keyof typeof PATHS;

/** 塗りつぶす形（黄色）。ベルは、線だけだと細く見えるため、塗る（#62 の実機の確認） */
const FILLED: ReadonlySet<IconName> = new Set(['bell']);

/** アイコン＋文字。行の真ん中にそろえて並べる */
export function IconLabel({ icon, children }: { icon: IconName; children: ComponentChildren }) {
  return (
    <span class={styles.label}>
      <Icon name={icon} />
      <span>{children}</span>
    </span>
  );
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg class={`${styles.icon} ${styles[name]} ${FILLED.has(name) ? styles.filled : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
