'use strict';
/* ============================================================
   tests/unit/toast.test.js — AUDIT_HOLISTIC паттерн 9 / Идея 14
   --
   Покрывает app/toast.js: Toast.success/error/info/warn/loading,
   subText, persist=true → NotifyCenter, mascotPhase, dismiss/update,
   timeoutMs override.

   Стратегия: stub на ToastQueue (через app/uxKit.js) — пишет calls в
   массив, не трогает DOM. NotifyCenter и MascotMood — простые stubs.
   ============================================================ */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- harness --------------------------------------------- */

function installFakeBrowser() {
  globalThis.window = globalThis.window || {};
  // ToastQueue stub.
  const queueCalls = [];
  let _seq = 0;
  globalThis.window.ToastQueue = {
    show(opts) {
      const id = ++_seq;
      queueCalls.push({ id, opts: Object.assign({}, opts) });
      return id;
    },
    dismiss(id) { queueCalls.push({ kind: 'dismiss', id }); },
    dismissAll() { queueCalls.push({ kind: 'dismissAll' }); },
  };
  // MascotMood stub.
  const moodCalls = [];
  globalThis.window.MascotMood = {
    setMood(m)      { moodCalls.push(['setMood', m]); },
    flashSuccess()  { moodCalls.push(['flashSuccess']); },
  };
  // NotifyCenter stub.
  const notifyCalls = [];
  globalThis.window.NotifyCenter = {
    add(opts) { notifyCalls.push(Object.assign({}, opts)); return Object.assign({ id: 'ntf-' + notifyCalls.length }, opts); },
  };
  return { queueCalls, moodCalls, notifyCalls };
}

function uninstallFakeBrowser() {
  if (globalThis.window) {
    delete globalThis.window.ToastQueue;
    delete globalThis.window.MascotMood;
    delete globalThis.window.NotifyCenter;
    delete globalThis.window.Toast;
  }
}

/** Fresh import — Toast module-level closure захватывает ToastQueue из uxKit
 *  на import-time. Чтобы каждый тест получал свежий stub, перечитываем модуль. */
async function freshToast() {
  // Нам нужен НАСТОЯЩИЙ ToastQueue из uxKit — но он зовёт DOM-функции на show().
  // Вариант: monkey-patch ToastQueue.show ПОСЛЕ import чтобы перехватить.
  const url = '../../app/toast.js?t=' + Date.now() + Math.random();
  const mod = await import(url);
  return mod;
}

/** Перехватываем вызовы реального ToastQueue.show на module-level. toast.js
 *  делает `import { ToastQueue } from './uxKit.js'` — Node возвращает один и
 *  тот же singleton-instance при каждом import без cache-bust. Поэтому
 *  патчим _исходный_ ToastQueue object — toast.js увидит spy через ту же
 *  ссылку. Без freshToast — сохраняем module identity. */
async function freshToastWithSpy(spies) {
  const ux = await import('../../app/uxKit.js');
  const orig = {
    show:        ux.ToastQueue.show,
    dismiss:     ux.ToastQueue.dismiss,
    dismissAll:  ux.ToastQueue.dismissAll,
  };
  let _seq = 0;
  ux.ToastQueue.show = (opts) => {
    const id = ++_seq;
    spies.queueCalls.push({ id, opts: Object.assign({}, opts) });
    // simulate persist mirror через NotifyCenter (как в uxKit реализации).
    if (opts && opts.persist && globalThis.window?.NotifyCenter) {
      try {
        const sevMap = { error: 'off-course', warning: 'drift', info: 'info', success: 'info' };
        globalThis.window.NotifyCenter.add({
          kind:        opts.kind || opts.type,
          title:       String(opts.msg || ''),
          body:        String(opts.subText || ''),
          actor:       opts.actor || '',
          severity:    sevMap[opts.type] || 'info',
          actionUrl:   opts.actionUrl || '',
          actionLabel: opts.actionLabel || '',
        });
      } catch (_) {}
    }
    return id;
  };
  ux.ToastQueue.dismiss    = (id) => { spies.queueCalls.push({ kind: 'dismiss', id }); };
  ux.ToastQueue.dismissAll = ()   => { spies.queueCalls.push({ kind: 'dismissAll' }); };

  const t = await import('../../app/toast.js');
  return { Toast: t.Toast, restore() {
    ux.ToastQueue.show       = orig.show;
    ux.ToastQueue.dismiss    = orig.dismiss;
    ux.ToastQueue.dismissAll = orig.dismissAll;
  }};
}

/* ---------- tests ----------------------------------------------- */

describe('Toast — semantic API', () => {
  let spies, harness;
  beforeEach(() => { spies = installFakeBrowser(); });
  afterEach(() => { if (harness?.restore) harness.restore(); uninstallFakeBrowser(); });

  test('Toast.success → type=success, default ms=3000, mascot=flashSuccess', async () => {
    harness = await freshToastWithSpy(spies);
    const handle = harness.Toast.success('Курс сверен');
    assert.equal(spies.queueCalls.length, 1);
    const c = spies.queueCalls[0];
    assert.equal(c.opts.type, 'success');
    assert.equal(c.opts.ms, 3000);
    assert.equal(c.opts.mascot, 'success');
    assert.ok(handle.id);
    assert.equal(typeof handle.dismiss, 'function');
    assert.equal(typeof handle.update, 'function');
    // mascot — flashSuccess (а не setMood, т.к. kind='success').
    assert.deepEqual(spies.moodCalls, [['flashSuccess']]);
  });

  test('Toast.error → type=error, default ms=5000, БЕЗ mascot-нагнетания', async () => {
    harness = await freshToastWithSpy(spies);
    harness.Toast.error('Курс не сверен');
    const c = spies.queueCalls[0];
    assert.equal(c.opts.type, 'error');
    assert.equal(c.opts.ms, 5000);
    assert.equal(c.opts.mascot, 'concerned');
    // mascot — пусто (избегаем нагнетания).
    assert.deepEqual(spies.moodCalls, []);
  });

  test('Toast.info → type=info, default ms=3000, нейтрально', async () => {
    harness = await freshToastWithSpy(spies);
    harness.Toast.info('Подсказка');
    const c = spies.queueCalls[0];
    assert.equal(c.opts.type, 'info');
    assert.equal(c.opts.ms, 3000);
    assert.equal(c.opts.mascot, 'info');
    assert.deepEqual(spies.moodCalls, []);
  });

  test('Toast.warn → type=warning (canonical), default ms=4000, mascot=alert', async () => {
    harness = await freshToastWithSpy(spies);
    harness.Toast.warn('Дрейф');
    const c = spies.queueCalls[0];
    // Закрывает legacy 'warn' vs 'warning' — clean API всегда отдаёт 'warning'.
    assert.equal(c.opts.type, 'warning');
    assert.equal(c.opts.ms, 4000);
    assert.equal(c.opts.mascot, 'alert');
    assert.deepEqual(spies.moodCalls, [['setMood', 'alert']]);
  });

  test('Toast.loading → ms=0 (sticky), mascot=thinking, MascotMood.setMood(thinking)', async () => {
    harness = await freshToastWithSpy(spies);
    const handle = harness.Toast.loading('Загружаю…');
    const c = spies.queueCalls[0];
    assert.equal(c.opts.ms, 0);                    // persistent
    assert.equal(c.opts.mascot, 'loading');
    assert.deepEqual(spies.moodCalls, [['setMood', 'thinking']]);
    // dismiss работает.
    handle.dismiss();
    const last = spies.queueCalls[spies.queueCalls.length - 1];
    assert.equal(last.kind, 'dismiss');
    assert.equal(last.id, handle.id);
  });

  test('subText опция → попадает в payload для второго rendering-line', async () => {
    harness = await freshToastWithSpy(spies);
    harness.Toast.info('Главная строка', { subText: 'CAPTION-LINE' });
    const c = spies.queueCalls[0];
    assert.equal(c.opts.subText, 'CAPTION-LINE');
  });

  test('persist:true → зеркалирует в NotifyCenter.add (F4 integration)', async () => {
    harness = await freshToastWithSpy(spies);
    harness.Toast.error('Сборка упала', {
      persist:     true,
      subText:     'CI #4521',
      actor:       'i.petrov@sber.ru',
      actionLabel: 'Открыть',
      actionUrl:   '#section-history',
      kind:        'ci',
    });
    assert.equal(spies.notifyCalls.length, 1);
    const n = spies.notifyCalls[0];
    assert.equal(n.title, 'Сборка упала');
    assert.equal(n.body,  'CI #4521');
    assert.equal(n.actor, 'i.petrov@sber.ru');
    assert.equal(n.severity, 'off-course');         // error → off-course
    assert.equal(n.actionUrl, '#section-history');
    assert.equal(n.actionLabel, 'Открыть');
    assert.equal(n.kind, 'ci');
  });

  test('mascotPhase override → передаётся в payload (вместо auto)', async () => {
    harness = await freshToastWithSpy(spies);
    // override: error без mascot-нагнетания → можно ЯВНО потребовать success-маскот.
    harness.Toast.error('Странный path', { mascotPhase: 'success' });
    const c = spies.queueCalls[0];
    // mascot в queue payload — это override.
    assert.equal(c.opts.mascot, 'success');
    // MascotMood — тоже override (kind='error' но override='success' → flashSuccess).
    assert.deepEqual(spies.moodCalls, [['flashSuccess']]);
  });

  test('timeoutMs override → перекрывает дефолт', async () => {
    harness = await freshToastWithSpy(spies);
    harness.Toast.success('Быстрый toast', { timeoutMs: 500 });
    const c = spies.queueCalls[0];
    assert.equal(c.opts.ms, 500);
  });

  test('actionLabel + onAction → CTA-кнопка через undo-cluster', async () => {
    harness = await freshToastWithSpy(spies);
    let actionFired = 0;
    harness.Toast.error('Ошибка сети', {
      actionLabel: 'Повторить',
      onAction:    () => { actionFired++; },
    });
    const c = spies.queueCalls[0];
    assert.equal(c.opts.undo, 'Повторить');
    assert.equal(typeof c.opts.onUndo, 'function');
    c.opts.onUndo();
    assert.equal(actionFired, 1);
  });

  test('Toast.dismiss / Toast.dismissAll → проксируют в ToastQueue', async () => {
    harness = await freshToastWithSpy(spies);
    const h = harness.Toast.info('A');
    harness.Toast.dismiss(h.id);
    harness.Toast.dismissAll();
    const dismissed = spies.queueCalls.find(c => c.kind === 'dismiss');
    const all       = spies.queueCalls.find(c => c.kind === 'dismissAll');
    assert.ok(dismissed, 'dismiss called');
    assert.equal(dismissed.id, h.id);
    assert.ok(all, 'dismissAll called');
  });

  test('Toast.warning alias → одинаково с Toast.warn (закрывает 75-callsite legacy split)', async () => {
    harness = await freshToastWithSpy(spies);
    harness.Toast.warning('legacy form');
    const c = spies.queueCalls[0];
    assert.equal(c.opts.type, 'warning');
    assert.equal(c.opts.mascot, 'alert');
  });

  test('handle.update() → dismisses + re-shows с новым msg/opts', async () => {
    harness = await freshToastWithSpy(spies);
    const h = harness.Toast.loading('Шаг 1/3');
    const firstId = h.id;
    const h2 = h.update({ msg: 'Шаг 2/3' });
    // Первый: show (loading). Второй: dismiss(loading-id). Третий: show(второй).
    const dismissCall = spies.queueCalls.find(c => c.kind === 'dismiss' && c.id === firstId);
    assert.ok(dismissCall, 'first toast dismissed');
    const reshown = spies.queueCalls.filter(c => !c.kind);
    assert.equal(reshown.length, 2);
    assert.equal(reshown[1].opts.msg, 'Шаг 2/3');
    assert.ok(h2.id);
  });

  test('_legacyTypeMap: warn/warning → warn, ok→success, err→error (audit таблица §1#9)', async () => {
    harness = await freshToastWithSpy(spies);
    const m = harness.Toast._legacyTypeMap;
    assert.equal(m.warn,    'warn');
    assert.equal(m.warning, 'warn');
    assert.equal(m.ok,      'success');
    assert.equal(m.success, 'success');
    assert.equal(m.err,     'error');
    assert.equal(m.error,   'error');
    assert.equal(m.info,    'info');
    assert.equal(m.loading, 'loading');
  });
});
