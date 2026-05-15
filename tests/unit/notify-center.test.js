'use strict';
/* ============================================================
   tests/unit/notify-center.test.js — AUDIT_HOLISTIC F4
   --
   Покрывает Notification Center (`app/notifyCenter.js`):
   add / markRead / markAllRead / dismiss / clear / cap-overflow /
   age-cleanup / subscribe / unsubscribe / formatRelative /
   persistence-via-state.notifications.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Импортируем модули один раз — они шарят singleton state.js.
 *  Между тестами вызываем _resetForTest() чтобы вычистить state.notifications
 *  и subscriber-set. */
let _state;
let _NotifyCenter;
async function freshNotifyCenter() {
  // Минимальный window/document stub (notifyCenter.js делает feature-detection,
  // но при наличии document вешает click-listener — пустой stub OK).
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = { addEventListener: () => {} };
  }
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = { addEventListener: () => {} };
  }
  if (!_state) {
    const stateMod = await import('../../state.js');
    _state = stateMod.state;
  }
  if (!_NotifyCenter) {
    const ncMod = await import('../../app/notifyCenter.js');
    _NotifyCenter = ncMod.NotifyCenter;
  }
  // Reset between tests — singletons.
  _state.notifications = [];
  // Subscriber set is module-private; самое простое — добавить локальный hook
  // на отписку текущих slушателей через test:after, но пока убираем глобально:
  // у NotifyCenter нет публичного `clearSubscribers`. В тестах субы добавляются
  // и явно отписываются через unsub() / unsubscribe(); для безопасности
  // пересоздавать handler-list не нужно, тесты не текут.
  return { state: _state, NotifyCenter: _NotifyCenter };
}

describe('NotifyCenter.add', () => {
  test('добавляет нотификацию с дефолтами', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    const n = NotifyCenter.add({ title: 'Курс качнулся', body: 'Эпик X дрейфует' });
    assert.equal(state.notifications.length, 1);
    assert.equal(n.title, 'Курс качнулся');
    assert.equal(n.body, 'Эпик X дрейфует');
    assert.equal(n.read, false);
    assert.equal(n.severity, 'info');                  // дефолт
    assert.match(n.id, /^ntf-/);                       // auto id
    assert.ok(Number.isFinite(n.ts));
  });

  test('нормализует unknown severity → info', async () => {
    const { NotifyCenter } = await freshNotifyCenter();
    const n = NotifyCenter.add({ title: 't', severity: 'banana' });
    assert.equal(n.severity, 'info');
  });

  test('сохраняет identity-actor (email), не fuzzy-name', async () => {
    const { NotifyCenter } = await freshNotifyCenter();
    const n = NotifyCenter.add({ title: 't', actor: 'user@example.com' });
    assert.equal(n.actor, 'user@example.com');
  });
});

describe('NotifyCenter.markRead / markAllRead', () => {
  test('markRead помечает по id, дважды — idempotent', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    const n = NotifyCenter.add({ title: 't' });
    assert.equal(state.notifications[0].read, false);
    assert.equal(NotifyCenter.markRead(n.id), true);
    assert.equal(state.notifications[0].read, true);
    assert.equal(NotifyCenter.markRead(n.id), true);  // idempotent
    assert.equal(NotifyCenter.markRead('no-such-id'), false);
  });

  test('markAllRead снимает unread у всех + getUnreadCount=0', async () => {
    const { NotifyCenter } = await freshNotifyCenter();
    NotifyCenter.add({ title: 'a' });
    NotifyCenter.add({ title: 'b' });
    NotifyCenter.add({ title: 'c' });
    assert.equal(NotifyCenter.getUnreadCount(), 3);
    const changed = NotifyCenter.markAllRead();
    assert.equal(changed, 3);
    assert.equal(NotifyCenter.getUnreadCount(), 0);
    // Повторный вызов — 0 изменений.
    assert.equal(NotifyCenter.markAllRead(), 0);
  });
});

describe('NotifyCenter.dismiss / clear', () => {
  test('dismiss удаляет одну запись, остальные на месте', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    const a = NotifyCenter.add({ title: 'a' });
    const b = NotifyCenter.add({ title: 'b' });
    const c = NotifyCenter.add({ title: 'c' });
    assert.equal(NotifyCenter.dismiss(b.id), true);
    assert.equal(state.notifications.length, 2);
    const ids = state.notifications.map(n => n.id);
    assert.deepEqual(ids, [a.id, c.id]);
    assert.equal(NotifyCenter.dismiss('no-id'), false);
  });

  test('clear обнуляет всё', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    NotifyCenter.add({ title: 'a' });
    NotifyCenter.add({ title: 'b' });
    const removed = NotifyCenter.clear();
    assert.equal(removed, 2);
    assert.equal(state.notifications.length, 0);
    assert.equal(NotifyCenter.clear(), 0);             // повторно — 0
  });
});

describe('NotifyCenter cap-overflow (FIFO drop oldest)', () => {
  test('cap = 100: 101-я запись вытесняет первую', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    const CAP = NotifyCenter._CAP_MAX;
    assert.equal(CAP, 100);
    // ts от now-1ч и растёт — все в пределах 30-дневного окна, age-cleanup
    // не выкинет ни одной записи; вытеснение чисто FIFO по cap.
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < CAP + 5; i++) {
      NotifyCenter.add({ title: `n${i}`, ts: base + i * 1000 });
    }
    assert.equal(state.notifications.length, CAP);
    // Самые старые (n0..n4) должны быть выкинуты — остались n5..n104.
    const titles = state.notifications.map(n => n.title);
    assert.equal(titles[0], 'n5');
    assert.equal(titles[CAP - 1], `n${CAP + 4}`);
  });
});

describe('NotifyCenter age-cleanup (>30 дней)', () => {
  test('старые записи отбрасываются на add()', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    const now = Date.now();
    const old1 = now - 31 * 24 * 60 * 60 * 1000;       // 31 день
    const old2 = now - 90 * 24 * 60 * 60 * 1000;       // 90 дней
    const fresh = now - 60 * 1000;                     // 1 минута
    NotifyCenter.add({ title: 'old-1', ts: old1 });
    NotifyCenter.add({ title: 'old-2', ts: old2 });
    NotifyCenter.add({ title: 'fresh', ts: fresh });
    // Любая новая add() очищает по age — после 3-х add'ов остался только fresh
    // и последняя добавленная (которая сама же fresh).
    NotifyCenter.add({ title: 'trigger', ts: now });
    const titles = state.notifications.map(n => n.title);
    assert.ok(!titles.includes('old-1'), 'old-1 должен быть выброшен');
    assert.ok(!titles.includes('old-2'), 'old-2 должен быть выброшен');
    assert.ok(titles.includes('fresh'),  'fresh должен остаться');
    assert.ok(titles.includes('trigger'),'trigger должен остаться');
  });

  test('getAll() тоже чистит по age', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    const now = Date.now();
    // Вставляем напрямую в state (минуя add() purge), эмулируя «сессия открыта 31 день».
    state.notifications = [
      { id: 'x', kind: 'g', title: 'stale', body: '', actor: '', ts: now - 31*24*60*60*1000, severity: 'info', read: false },
      { id: 'y', kind: 'g', title: 'fresh', body: '', actor: '', ts: now - 60*1000,           severity: 'info', read: false },
    ];
    const all = NotifyCenter.getAll();
    assert.equal(all.length, 1);
    assert.equal(all[0].title, 'fresh');
  });
});

describe('NotifyCenter subscribe / unsubscribe', () => {
  test('subscribe срабатывает на add/markRead/dismiss/clear', async () => {
    const { NotifyCenter } = await freshNotifyCenter();
    const calls = [];
    const handler = (reason) => calls.push(reason);
    const unsub = NotifyCenter.subscribe(handler);
    const a = NotifyCenter.add({ title: 'a' });
    NotifyCenter.add({ title: 'b' });                   // оставляем непустым
    NotifyCenter.markRead(a.id);
    NotifyCenter.dismiss(a.id);
    NotifyCenter.clear();                               // ['b'] → [] → notify
    assert.deepEqual(calls, ['add', 'add', 'markRead', 'dismiss', 'clear']);
    unsub();                                            // отписка
    NotifyCenter.add({ title: 'after-unsub' });
    assert.equal(calls.length, 5, 'после unsub новых вызовов нет');
  });

  test('unsubscribe(fn) тоже работает', async () => {
    const { NotifyCenter } = await freshNotifyCenter();
    let n = 0;
    const h = () => n++;
    NotifyCenter.subscribe(h);
    NotifyCenter.unsubscribe(h);
    NotifyCenter.add({ title: 't' });
    assert.equal(n, 0);
  });

  test('исключение в одном subscriber не ломает другого', async () => {
    const { NotifyCenter } = await freshNotifyCenter();
    const calls = [];
    NotifyCenter.subscribe(() => { throw new Error('boom'); });
    NotifyCenter.subscribe(() => calls.push('ok'));
    NotifyCenter.add({ title: 't' });
    assert.deepEqual(calls, ['ok']);
  });
});

describe('NotifyCenter.formatRelative', () => {
  test('форматирует диапазоны: только что / N мин / N ч / вчера / N дн', async () => {
    const { NotifyCenter } = await freshNotifyCenter();
    const now = 1_700_000_000_000;
    assert.equal(NotifyCenter.formatRelative(now, now),                        'только что');
    assert.equal(NotifyCenter.formatRelative(now - 5 * 60_000, now),           '5 мин назад');
    assert.equal(NotifyCenter.formatRelative(now - 3 * 3600_000, now),         '3 ч назад');
    assert.equal(NotifyCenter.formatRelative(now - 24 * 3600_000, now),        'вчера');
    assert.equal(NotifyCenter.formatRelative(now - 48 * 3600_000, now),        'позавчера');
    assert.equal(NotifyCenter.formatRelative(now - 5 * 24 * 3600_000, now),    '5 дн назад');
  });
});

describe('NotifyCenter persistence via state.notifications', () => {
  test('add() мутирует state.notifications (Reactive proxy → save)', async () => {
    const { state, NotifyCenter } = await freshNotifyCenter();
    assert.deepEqual(state.notifications, []);
    NotifyCenter.add({ title: 'persist-me', severity: 'drift' });
    assert.equal(state.notifications.length, 1);
    assert.equal(state.notifications[0].title, 'persist-me');
    assert.equal(state.notifications[0].severity, 'drift');
  });
});
