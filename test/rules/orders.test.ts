// 注文のルール（testing.md §3：1・2・7〜23）
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALICE, anon, as, BOB, CAROL, createEnv, DAY, dbOf, hoursAgo, orderItems, OWNER, seed, storedOrder } from './helpers';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(() => env.cleanup());

// o1：調理中（1番）。カウンターは1
beforeEach(() =>
  seed(env, async (db) => {
    await setDoc(doc(db, 'events/e1/counters', DAY), { n: 1 });
    await setDoc(doc(db, 'events/e1/orders/o1'), storedOrder());
  }),
);

// 確定で書く注文（data-model.md §3）。QRあり＝調理中、QRなし＝渡し済み
function newOrder(uid: string, number: number, qr = true, patch: Record<string, unknown> = {}) {
  return {
    number,
    day: DAY,
    items: orderItems,
    total: 1000,
    payment: 'cash',
    status: qr ? 'preparing' : 'done',
    cancelledFrom: null,
    qr,
    createdAt: serverTimestamp(),
    readyAt: null,
    doneAt: qr ? null : serverTimestamp(),
    cancelledAt: null,
    createdBy: uid,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...patch,
  };
}

// 確定（order-confirm.md §5.1 と同じ形のトランザクション）。counterN が null なら、カウンターを書かない
function confirm(db: Firestore, orderId: string, order: Record<string, unknown>, counterN: number | null) {
  const day = order.day as string;
  return runTransaction(db, async (tx) => {
    await tx.get(doc(db, 'events/e1/orders', orderId));
    await tx.get(doc(db, 'events/e1/counters', day));
    if (counterN !== null) tx.set(doc(db, 'events/e1/counters', day), { n: counterN });
    tx.set(doc(db, 'events/e1/orders', orderId), order);
  });
}

describe('注文の読み取り', () => {
  it('1：未ログインでも、注文1件は get できる（お客様画面）', async () => {
    await assertSucceeds(getDoc(doc(anon(env), 'events/e1/orders/o1')));
    await assertSucceeds(getDoc(doc(as(env, BOB), 'events/e1/orders/o1')));
  });

  it('2・4・5：未ログイン・非メンバー・別のイベントのメンバーは、注文を list できない', async () => {
    for (const db of [anon(env), as(env, BOB), as(env, CAROL)]) {
      await assertFails(getDocs(collection(db, 'events/e1/orders')));
    }
  });

  it('6：メンバーは、注文を list できる', async () => {
    await assertSucceeds(getDocs(collection(as(env, ALICE), 'events/e1/orders')));
  });
});

describe('注文の作成', () => {
  it('7：QRありの注文（調理中）を、カウンターの更新と同時に作れる（R9・R11 トランザクション）', async () => {
    await assertSucceeds(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2), 2));
  });

  it('7：QRなしの注文（渡し済み・doneAt = 今）を作れる', async () => {
    await assertSucceeds(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, false), 2));
  });

  it('7：その日の最初の注文は、カウンターを n = 1 で作り、1番になる（R9 三項演算子の 0）', async () => {
    await assertSucceeds(confirm(as(env, OWNER), 'o2', newOrder(OWNER, 1, true, { day: '2026-08-02' }), 1));
  });

  it('7：バッチでも作れる（R9 getAfter）', async () => {
    const db = as(env, ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'events/e1/counters', DAY), { n: 2 });
    batch.set(doc(db, 'events/e1/orders/o2'), newOrder(ALICE, 2));
    await assertSucceeds(batch.commit());
  });

  it('8：余計な項目（staffEmail など）は拒否', async () => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, true, { staffEmail: 'alice@example.com' }), 2));
  });

  it('必須の項目が欠けていると拒否', async () => {
    const order: Record<string, unknown> = newOrder(ALICE, 2);
    delete order.cancelledAt;
    await assertFails(confirm(as(env, ALICE), 'o2', order, 2));
  });

  it.each([
    ['payment: card', { payment: 'card' }],
    ['total: 0', { total: 0 }],
    ['total が負', { total: -100 }],
    ['total が小数', { total: 100.5 }],
    ['items が0行', { items: [] }],
    ['items が51行', { items: Array.from({ length: 51 }, () => orderItems[0]) }],
    ['items がリストでない', { items: orderItems[0] }],
    ['qr が真偽値でない', { qr: 'yes' }],
  ])('9：%s は拒否', async (_label, patch) => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, true, patch), 2));
  });

  describe('メモ（#40）の作成', () => {
    it('メモなし・メモが空・メモあり（100文字ちょうど）は作れる', async () => {
      await assertSucceeds(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2), 2)); // note の項目なし（古い形）
      await assertSucceeds(confirm(as(env, ALICE), 'o3', newOrder(ALICE, 3, true, { note: '' }), 3));
      await assertSucceeds(confirm(as(env, ALICE), 'o4', newOrder(ALICE, 4, true, { note: '辛さ抜き' }), 4));
      await assertSucceeds(confirm(as(env, ALICE), 'o5', newOrder(ALICE, 5, true, { note: 'あ'.repeat(100) }), 5));
    });

    it.each([
      ['101文字', { note: 'あ'.repeat(101) }],
      ['絵文字は2文字と数える（51個で102）', { note: '🍜'.repeat(51) }],
      ['数値', { note: 123 }],
      ['真偽値', { note: true }],
      ['null', { note: null }],
      ['リスト', { note: ['辛さ抜き'] }],
    ])('拒否：%s', async (_label, patch) => {
      await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, true, patch), 2));
    });
  });

  it('9：items が50行なら許可（境界）', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ ...orderItems[0], menuId: `m${i}` }));
    await assertSucceeds(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, true, { items }), 2));
  });

  it('9：number: 0 は拒否（カウンターを 0 にもできない）', async () => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 0, true, { day: '2026-08-02' }), 0));
  });

  it('9：day の形式が違うと拒否', async () => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 1, true, { day: '20260802' }), 1));
  });

  it.each([
    ['status: ready', { status: 'ready' }],
    ['status: cancelled', { status: 'cancelled', cancelledFrom: 'preparing' }],
    ['QRあり × done', { status: 'done', doneAt: serverTimestamp() }],
    ['QRなし × preparing', { qr: false }],
    ['cancelledFrom が null でない', { cancelledFrom: 'preparing' }],
    ['readyAt が null でない', { readyAt: serverTimestamp() }],
    ['cancelledAt が null でない', { cancelledAt: serverTimestamp() }],
    ['QRありで doneAt が null でない', { doneAt: serverTimestamp() }],
  ])('10：%s は拒否', async (_label, patch) => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, true, patch), 2));
  });

  it('10：QRなしで doneAt がクライアントの時刻なら拒否', async () => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, false, { doneAt: new Date() }), 2));
  });

  it.each([
    ['createdAt', { createdAt: new Date() }],
    ['updatedAt', { updatedAt: new Date() }],
  ])('11：%s がクライアントの時刻なら拒否（R11）', async (_label, patch) => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, true, patch), 2));
  });

  it.each([
    ['createdBy', { createdBy: OWNER }],
    ['updatedBy', { updatedBy: OWNER }],
  ])('12：%s が自分の uid でなければ拒否', async (_label, patch) => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2, true, patch), 2));
  });

  it('13：カウンターを進めずに作ると拒否（R9）', async () => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 2), null));
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 1), null));
  });

  it('13：その日の最初の注文で、カウンターを作らないと拒否（R9）', async () => {
    await assertFails(confirm(as(env, ALICE), 'o2', newOrder(ALICE, 1, true, { day: '2026-08-02' }), null));
  });

  it('14：カウンターを2つ進める、number とカウンターが一致しない、は拒否（R9）', async () => {
    const db = as(env, ALICE);
    await assertFails(confirm(db, 'o2', newOrder(ALICE, 3), 3));
    await assertFails(confirm(db, 'o2', newOrder(ALICE, 3), 2));
    await assertFails(confirm(db, 'o2', newOrder(ALICE, 2), 3));
  });

  it('15：同じ番号の2件目は拒否（R9）', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(confirm(db, 'o2', newOrder(ALICE, 2), 2));
    await assertFails(confirm(db, 'o3', newOrder(ALICE, 2), 2));
    await assertFails(confirm(db, 'o3', newOrder(ALICE, 2), null));
  });

  it('既にある注文IDに、作成で上書きはできない（作成でなく更新として評価され、拒否）', async () => {
    await assertFails(confirm(as(env, ALICE), 'o1', newOrder(ALICE, 2), 2));
  });

  it('4・5・3：非メンバー・別のイベントのメンバー・未ログインは、注文を作れない', async () => {
    await assertFails(confirm(as(env, BOB), 'o2', newOrder(BOB, 2), 2));
    await assertFails(confirm(as(env, CAROL), 'o2', newOrder(CAROL, 2), 2));
    await assertFails(confirm(anon(env), 'o2', newOrder('x', 2), 2));
  });
});

describe('注文の更新', () => {
  const upd = (uid: string, patch: Record<string, unknown>) => ({
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...patch,
  });

  async function seedOrder(id: string, patch: Record<string, unknown>) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(dbOf(ctx), 'events/e1/orders', id), storedOrder(patch));
    });
  }

  it.each([
    ['items', { items: [{ ...orderItems[0], qty: 3 }] }],
    ['total', { total: 1 }],
    ['number', { number: 99 }],
    ['day', { day: '2026-08-02' }],
    ['qr', { qr: false }],
    ['createdBy', { createdBy: ALICE + 'x' }],
    ['createdAt', { createdAt: new Date() }],
  ])('16：%s は変更できない（R7）', async (_label, patch) => {
    await assertFails(updateDoc(doc(as(env, ALICE), 'events/e1/orders/o1'), upd(ALICE, patch)));
  });

  it('R7：値が変わらない項目（total・readyAt = null のまま）を書いても、変更に数えない', async () => {
    await assertSucceeds(
      updateDoc(
        doc(as(env, ALICE), 'events/e1/orders/o1'),
        upd(ALICE, { total: 1000, readyAt: null, createdBy: ALICE, status: 'preparing' }),
      ),
    );
  });

  it('17：支払い方法を変更できる。cash・paypay 以外は拒否', async () => {
    const db = as(env, ALICE);
    await assertSucceeds(updateDoc(doc(db, 'events/e1/orders/o1'), upd(ALICE, { payment: 'paypay' })));
    await assertFails(updateDoc(doc(db, 'events/e1/orders/o1'), upd(ALICE, { payment: 'card' })));
  });

  describe('メモ（#40）の更新：確定後も、メンバーが変更できる', () => {
    it('メモを足す・変える・空にする（支払い方法の変更と同じく、updatedBy・updatedAt と一緒に）', async () => {
      const ref = doc(as(env, ALICE), 'events/e1/orders/o1');
      await assertSucceeds(updateDoc(ref, upd(ALICE, { note: '辛さ抜き' })));
      await assertSucceeds(updateDoc(ref, upd(ALICE, { note: 'ネギ抜き' })));
      await assertSucceeds(updateDoc(ref, upd(ALICE, { note: '' })));
      await assertSucceeds(updateDoc(ref, upd(ALICE, { note: 'あ'.repeat(100) })));
    });

    it('お渡し済み・取り消しの注文のメモも変えられる。状態の変更と同時でもよい', async () => {
      await seedOrder('d', { status: 'done', doneAt: new Date(0), qr: false });
      await assertSucceeds(updateDoc(doc(as(env, ALICE), 'events/e1/orders/d'), upd(ALICE, { note: '渡し済み' })));
      await seedOrder('c', { status: 'cancelled', cancelledFrom: 'ready', cancelledAt: new Date(0) });
      await assertSucceeds(updateDoc(doc(as(env, ALICE), 'events/e1/orders/c'), upd(ALICE, { note: '取り消し済み' })));
      await assertSucceeds(updateDoc(doc(as(env, ALICE), 'events/e1/orders/o1'), upd(ALICE, { note: '完成と同時', status: 'ready', readyAt: serverTimestamp() })));
    });

    it.each([
      ['101文字', { note: 'あ'.repeat(101) }],
      ['絵文字は2文字と数える', { note: '🍜'.repeat(51) }],
      ['数値', { note: 5 }],
      ['null', { note: null }],
      ['リスト', { note: ['a'] }],
    ])('拒否：%s', async (_label, patch) => {
      await assertFails(updateDoc(doc(as(env, ALICE), 'events/e1/orders/o1'), upd(ALICE, patch)));
    });

    it('メモと一緒に、品目・合計・番号を書き換えるのは拒否（メモだけが、新しく変えられる）', async () => {
      const ref = doc(as(env, ALICE), 'events/e1/orders/o1');
      await assertFails(updateDoc(ref, upd(ALICE, { note: 'x', total: 1 })));
      await assertFails(updateDoc(ref, upd(ALICE, { note: 'x', items: [{ ...orderItems[0], qty: 3 }] })));
      await assertFails(updateDoc(ref, upd(ALICE, { note: 'x', number: 99 })));
    });

    it('updatedBy が自分でない・updatedAt がクライアントの時刻なら、メモの更新も拒否（R11）', async () => {
      const ref = doc(as(env, ALICE), 'events/e1/orders/o1');
      await assertFails(updateDoc(ref, { note: 'x', updatedBy: OWNER, updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(ref, { note: 'x', updatedBy: ALICE, updatedAt: new Date() }));
    });

    it('非メンバー・別のイベントのメンバー・未ログインは、メモを変えられない', async () => {
      for (const db of [as(env, BOB), as(env, CAROL), anon(env)]) {
        await assertFails(updateDoc(doc(db, 'events/e1/orders/o1'), upd(ALICE, { note: 'x' })));
      }
    });

    it('メモの無い古い注文に、メモを足せる。古い注文（メモなし）の、ほかの更新は、これまでどおり', async () => {
      const ref = doc(as(env, ALICE), 'events/e1/orders/o1'); // storedOrder は、メモの項目なし
      await assertSucceeds(updateDoc(ref, upd(ALICE, { payment: 'paypay' })));
      await assertSucceeds(updateDoc(ref, upd(ALICE, { note: '後から足したメモ' })));
    });
  });

  // 遷移表（data-model.md §3）。表にないもの以外は、すべて許可
  const statuses = ['preparing', 'ready', 'done', 'cancelled'] as const;
  const allowed: Record<(typeof statuses)[number], string[]> = {
    preparing: ['preparing', 'ready', 'cancelled'],
    ready: ['ready', 'done', 'preparing', 'cancelled'],
    done: ['done', 'ready', 'cancelled'],
    cancelled: ['cancelled', 'preparing', 'ready', 'done'],
  };
  const cases = statuses.flatMap((from) => statuses.map((to) => [from, to, allowed[from].includes(to)] as const));

  it.each(cases)('18：%s → %s（許可＝%s）', async (from, to, ok) => {
    // 取り消し中の注文は、戻し先（to）を cancelledFrom に持たせる（遷移表そのものを試すため）
    const cancelledFrom = from === 'cancelled' ? (to === 'cancelled' ? 'ready' : to) : null;
    await seedOrder('t', { status: from, cancelledFrom, cancelledAt: from === 'cancelled' ? new Date(0) : null });

    const patch: Record<string, unknown> = { status: to };
    if (from !== 'cancelled' && to === 'cancelled') Object.assign(patch, { cancelledFrom: from, cancelledAt: serverTimestamp() });
    if (from === 'cancelled' && to !== 'cancelled') Object.assign(patch, { cancelledFrom: null, cancelledAt: null });
    if (from === 'preparing' && to === 'ready') patch.readyAt = serverTimestamp();
    if (from === 'ready' && to === 'preparing') patch.readyAt = null;
    if (from !== 'cancelled' && to === 'done') patch.doneAt = serverTimestamp();
    if (from === 'done' && to === 'ready') patch.doneAt = null;

    const write = updateDoc(doc(as(env, ALICE), 'events/e1/orders/t'), upd(ALICE, patch));
    await (ok ? assertSucceeds(write) : assertFails(write));
  });

  it('19：取り消すとき、cancelledFrom が直前の状態でなければ拒否（R6）', async () => {
    const db = as(env, ALICE);
    for (const cancelledFrom of ['ready', 'done', null]) {
      await assertFails(
        updateDoc(
          doc(db, 'events/e1/orders/o1'),
          upd(ALICE, { status: 'cancelled', cancelledFrom, cancelledAt: serverTimestamp() }),
        ),
      );
    }
  });

  it('20：取り消しを戻すとき、cancelledFrom と違う状態へは拒否（R6）', async () => {
    await seedOrder('c', { status: 'cancelled', cancelledFrom: 'ready', cancelledAt: new Date(0) });
    const db = as(env, ALICE);
    for (const status of ['preparing', 'done']) {
      await assertFails(
        updateDoc(doc(db, 'events/e1/orders/c'), upd(ALICE, { status, cancelledFrom: null, cancelledAt: null })),
      );
    }
    await assertSucceeds(
      updateDoc(doc(db, 'events/e1/orders/c'), upd(ALICE, { status: 'ready', cancelledFrom: null, cancelledAt: null })),
    );
  });

  it('21：取り消し中のまま、cancelledFrom を書き換えると拒否。支払い方法の変更は許可（R6）', async () => {
    await seedOrder('c', { status: 'cancelled', cancelledFrom: 'ready', cancelledAt: new Date(0) });
    const db = as(env, ALICE);
    await assertFails(updateDoc(doc(db, 'events/e1/orders/c'), upd(ALICE, { cancelledFrom: 'done' })));
    await assertFails(updateDoc(doc(db, 'events/e1/orders/c'), upd(ALICE, { cancelledFrom: null })));
    await assertSucceeds(updateDoc(doc(db, 'events/e1/orders/c'), upd(ALICE, { payment: 'paypay' })));
  });

  it('取り消し以外の状態で、cancelledFrom に値を入れると拒否（R6）', async () => {
    await assertFails(
      updateDoc(doc(as(env, ALICE), 'events/e1/orders/o1'), upd(ALICE, { status: 'ready', readyAt: serverTimestamp(), cancelledFrom: 'preparing' })),
    );
  });

  it('時刻（readyAt・doneAt・cancelledAt）は、null・今・変更なし のいずれか。クライアントの時刻は拒否', async () => {
    const db = as(env, ALICE);
    await assertFails(updateDoc(doc(db, 'events/e1/orders/o1'), upd(ALICE, { status: 'ready', readyAt: new Date() })));
    await assertFails(updateDoc(doc(db, 'events/e1/orders/o1'), upd(ALICE, { doneAt: new Date() })));
    await assertFails(updateDoc(doc(db, 'events/e1/orders/o1'), upd(ALICE, { cancelledAt: new Date() })));
  });

  it('22：updatedBy が自分の uid でない、updatedAt がクライアントの時刻なら拒否（R11）', async () => {
    const db = as(env, ALICE);
    await assertFails(updateDoc(doc(db, 'events/e1/orders/o1'), upd(OWNER, { payment: 'paypay' })));
    await assertFails(updateDoc(doc(db, 'events/e1/orders/o1'), { payment: 'paypay', updatedBy: ALICE, updatedAt: new Date() }));
  });

  it('4・5・3：非メンバー・別のイベントのメンバー・未ログインは、注文を更新できない', async () => {
    await assertFails(updateDoc(doc(as(env, BOB), 'events/e1/orders/o1'), upd(BOB, { payment: 'paypay' })));
    await assertFails(updateDoc(doc(as(env, CAROL), 'events/e1/orders/o1'), upd(CAROL, { payment: 'paypay' })));
    await assertFails(updateDoc(doc(anon(env), 'events/e1/orders/o1'), { payment: 'paypay' }));
  });
});

describe('在庫（#68）：確定で減らし、取り消しで戻す', () => {
  // 上の beforeEach（カウンター・o1）に、メニューを足す（seed は全体を消すため、使わない）
  beforeEach(() =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(dbOf(ctx), 'events/e1/menu/y'), { name: '焼きそば', price: 500, order: 10, soldOut: false, stock: 5 });
    }),
  );

  it('注文の作成（減らした行に stock: true）と、在庫を減らす書き込みを、同時にできる', async () => {
    const db = as(env, ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'events/e1/counters', DAY), { n: 2 });
    batch.set(doc(db, 'events/e1/orders/o2'), newOrder(ALICE, 2, true, { items: [{ ...orderItems[0], stock: true }] }));
    batch.update(doc(db, 'events/e1/menu/y'), { stock: increment(-2) });
    await assertSucceeds(batch.commit());
  });

  it('取り消し（状態の変更）と、在庫を戻す書き込みを、同時にできる。取り消しを戻すで減らし、マイナスになってもよい', async () => {
    const db = as(env, ALICE);
    const cancel = writeBatch(db);
    cancel.update(doc(db, 'events/e1/orders/o1'), {
      status: 'cancelled',
      cancelledFrom: 'preparing',
      cancelledAt: serverTimestamp(),
      updatedBy: ALICE,
      updatedAt: serverTimestamp(),
    });
    cancel.update(doc(db, 'events/e1/menu/y'), { stock: increment(2) });
    await assertSucceeds(cancel.commit());
    const restore = writeBatch(db);
    restore.update(doc(db, 'events/e1/orders/o1'), {
      status: 'preparing',
      cancelledFrom: null,
      cancelledAt: null,
      updatedBy: ALICE,
      updatedAt: serverTimestamp(),
    });
    restore.update(doc(db, 'events/e1/menu/y'), { stock: increment(-10) });
    await assertSucceeds(restore.commit());
  });

  it('予約を含む注文（reserved: true。#69）を作れる。reserved が真偽値でなければ拒否。作成のあとは変えられない', async () => {
    const db = as(env, ALICE);
    const ok = writeBatch(db);
    ok.set(doc(db, 'events/e1/counters', DAY), { n: 2 });
    ok.set(doc(db, 'events/e1/orders/o2'), newOrder(ALICE, 2, true, { reserved: true, items: [{ ...orderItems[0], stock: true, reserved: 1 }] }));
    ok.update(doc(db, 'events/e1/menu/y'), { stock: increment(-6) });
    await assertSucceeds(ok.commit());
    const bad = writeBatch(db);
    bad.set(doc(db, 'events/e1/counters', DAY), { n: 3 });
    bad.set(doc(db, 'events/e1/orders/o3'), newOrder(ALICE, 3, true, { reserved: 'yes' }));
    await assertFails(bad.commit());
    await assertFails(updateDoc(doc(db, 'events/e1/orders/o2'), { reserved: false, updatedBy: ALICE, updatedAt: serverTimestamp() }));
  });

  it('在庫が範囲（-99,999）を超えるバッチは、取り消しごと拒否される', async () => {
    const db = as(env, ALICE);
    const b = writeBatch(db);
    b.update(doc(db, 'events/e1/orders/o1'), {
      status: 'cancelled',
      cancelledFrom: 'preparing',
      cancelledAt: serverTimestamp(),
      updatedBy: ALICE,
      updatedAt: serverTimestamp(),
    });
    b.update(doc(db, 'events/e1/menu/y'), { stock: increment(-100010) });
    await assertFails(b.commit());
  });

  it('メンバーでない人は、在庫を変えられない', async () => {
    await assertFails(updateDoc(doc(as(env, BOB), 'events/e1/menu/y'), { stock: increment(-1) }));
  });
});

describe('もう一度呼ぶ（#58）：できあがりの注文の calls を、1だけ増やす', () => {
  const recall = (uid: string, calls: unknown, patch: Record<string, unknown> = {}) => ({
    calls,
    updatedBy: uid,
    updatedAt: serverTimestamp(),
    ...patch,
  });
  async function seedOrder(id: string, patch: Record<string, unknown>) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(dbOf(ctx), 'events/e1/orders', id), storedOrder(patch));
    });
  }
  beforeEach(() => seedOrder('r1', { status: 'ready', readyAt: hoursAgo(0.1) }));
  const r1 = (uid: string) => doc(as(env, uid), 'events/e1/orders/r1');

  it('calls の無い注文を、increment(1) で 1 にでき、続けて 2 にできる', async () => {
    await assertSucceeds(updateDoc(r1(ALICE), recall(ALICE, increment(1))));
    await assertSucceeds(updateDoc(r1(ALICE), recall(ALICE, increment(1))));
    let calls: unknown;
    await env.withSecurityRulesDisabled(async (ctx) => {
      calls = (await getDoc(doc(dbOf(ctx), 'events/e1/orders/r1'))).data()?.calls;
    });
    expect(calls).toBe(2);
  });

  it('値で書いても、ちょうど +1 なら許可。+2・減らす・数でない値は拒否', async () => {
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, 2)));
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, 0)));
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, '1')));
    await assertSucceeds(updateDoc(r1(ALICE), recall(ALICE, 1)));
    // 同じ値（1 → 1）は、calls が変わらないため、ふつうの更新（updatedAt だけ）として通る（害は無い）
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, 0)));
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, 3)));
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, increment(2))));
  });

  it.each(['preparing', 'done', 'cancelled'])('できあがりでない（%s）注文は、呼べない', async (status) => {
    await seedOrder('r2', { status, cancelledFrom: status === 'cancelled' ? 'ready' : null });
    await assertFails(updateDoc(doc(as(env, ALICE), 'events/e1/orders/r2'), recall(ALICE, increment(1))));
  });

  it('状態・支払い方法・メモと同時には、変えられない', async () => {
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, increment(1), { status: 'done', doneAt: serverTimestamp() })));
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, increment(1), { payment: 'paypay' })));
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, increment(1), { note: 'x' })));
  });

  it('updatedBy が自分でない・updatedAt がクライアントの時刻なら拒否（R11）', async () => {
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, increment(1), { updatedBy: BOB })));
    await assertFails(updateDoc(r1(ALICE), recall(ALICE, increment(1), { updatedAt: new Date() })));
  });

  it('非メンバー・別のイベントのメンバー・未ログインは、呼べない', async () => {
    await assertFails(updateDoc(r1(BOB), recall(BOB, increment(1))));
    await assertFails(updateDoc(r1(CAROL), recall(CAROL, increment(1))));
    await assertFails(updateDoc(doc(anon(env), 'events/e1/orders/r1'), { calls: increment(1) }));
  });

  it('calls のある注文も、これまでどおり状態を変えられる。状態の変更と一緒に calls を変えるのは拒否', async () => {
    await seedOrder('r3', { status: 'ready', readyAt: hoursAgo(0.1), calls: 2 });
    const r3 = doc(as(env, ALICE), 'events/e1/orders/r3');
    await assertFails(updateDoc(r3, { status: 'done', doneAt: serverTimestamp(), calls: 0, updatedBy: ALICE, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(r3, { status: 'done', doneAt: serverTimestamp(), updatedBy: ALICE, updatedAt: serverTimestamp() }));
  });

  it('確定（作成）のときに、calls は書けない（無い＝ 0 として読む）', async () => {
    await assertFails(confirm(as(env, ALICE), 'n1', newOrder(ALICE, 2, true, { calls: 0 }), 2));
    await assertSucceeds(confirm(as(env, ALICE), 'n2', newOrder(ALICE, 2), 2));
  });
});

describe('注文の削除', () => {
  it('23：メンバー・オーナー（deleting = false）は削除できない', async () => {
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/orders/o1')));
    await assertFails(deleteDoc(doc(as(env, OWNER), 'events/e1/orders/o1')));
  });

  it('23：deleting = true なら、オーナーは削除できる。メンバーはできない', async () => {
    await updateDoc(doc(as(env, OWNER), 'events/e1'), { deleting: true });
    await assertFails(deleteDoc(doc(as(env, ALICE), 'events/e1/orders/o1')));
    await assertSucceeds(deleteDoc(doc(as(env, OWNER), 'events/e1/orders/o1')));
    expect((await getDoc(doc(anon(env), 'events/e1/orders/o1'))).exists()).toBe(false);
  });
});
