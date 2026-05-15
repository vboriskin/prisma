'use strict';
/* ============================================================
   tests/unit/focus-manager.test.js — AUDIT_HOLISTIC §5.1
   --
   Покрывает app/focusManager.js: set / clear / get, history push /
   back / forward / clamp, hotkey bind detection, EventBus emit,
   period validation.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* ── Минимальный browser-mock для focusManager (document.activeElement
   и addEventListener для bindHotkeys). Window не обязателен — мы тестируем
   pure logic + side-effects на state.meta.focus. ─────────────────── */
function setupBrowserGlobals() {
  const listeners = [];
  globalThis.document = {
    activeElement: null,
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture) {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  // ToastQueue mock — set() пытается дёрнуть toast; должен silent-skip
  // если ToastQueue нет. Здесь явно НЕ объявляем window — пусть skip'ит.
  return { listeners };
}

function makeKeyEvent({ key, code, metaKey = false, ctrlKey = false, shiftKey = false, altKey = false }) {
  let prevented = false;
  return {
    key, code, metaKey, ctrlKey, shiftKey, altKey,
    preventDefault() { prevented = true; },
    get _prevented() { return prevented; },
  };
}

let _focusMod, _stateMod, _eventBusMod;
async function freshFocus() {
  setupBrowserGlobals();
  if (!_stateMod) _stateMod = await import('../../state.js');
  if (!_eventBusMod) _eventBusMod = await import('../../app/eventBus.js');
  // Cache-bust только focusManager — нам нужны свежие module-level _history / hotkeys flags.
  const mod = await import('../../app/focusManager.js?t=' + Math.random());
  // Reset focus + history.
  mod.Focus._resetForTest();
  // Очистить всех подписчиков focus-changed на bus.
  _eventBusMod.EventBus.clear('focus-changed');
  return { Focus: mod.Focus, state: _stateMod.state, EventBus: _eventBusMod.EventBus };
}

/* ── Tests ───────────────────────────────────────────────── */

describe('Focus.set / get / clear', () => {
  test('set записывает focus в state.meta.focus + возвращает normalized', async () => {
    const { Focus, state } = await freshFocus();
    const r = Focus.set({ kind: 'employee', id: 'ivanov@example.com', period: '7d' });
    assert.deepEqual(r, { kind: 'employee', id: 'ivanov@example.com', period: '7d' });
    assert.equal(state.meta.focus.kind, 'employee');
    assert.equal(state.meta.focus.id, 'ivanov@example.com');
    assert.equal(state.meta.focus.period, '7d');
  });

  test('set валидирует kind — invalid → null + state не меняется', async () => {
    const { Focus, state } = await freshFocus();
    const r = Focus.set({ kind: 'cosmic-ray', id: 'x', period: '7d' });
    assert.equal(r, null);
    assert.equal(state.meta.focus, null);
  });

  test('set валидирует period — invalid → fallback "7d"', async () => {
    const { Focus, state } = await freshFocus();
    const r = Focus.set({ kind: 'employee', id: 'x@y', period: 'forever' });
    assert.equal(r.period, '7d');
    assert.equal(state.meta.focus.period, '7d');
  });

  test('set требует не-пустой id', async () => {
    const { Focus } = await freshFocus();
    assert.equal(Focus.set({ kind: 'employee', id: '', period: '7d' }), null);
    assert.equal(Focus.set({ kind: 'employee', id: '   ', period: '7d' }), null);
  });

  test('clear очищает state.meta.focus', async () => {
    const { Focus, state } = await freshFocus();
    Focus.set({ kind: 'team', id: 'alpha', period: '14d' });
    Focus.clear();
    assert.equal(state.meta.focus, null);
  });

  test('get возвращает snapshot (не proxy alias)', async () => {
    const { Focus } = await freshFocus();
    Focus.set({ kind: 'epic', id: 'EPIC-1', period: '30d' });
    const snap = Focus.get();
    assert.equal(snap.id, 'EPIC-1');
    snap.id = 'mutated';
    // Снимок не должен мутировать state
    assert.equal(Focus.get().id, 'EPIC-1');
  });
});

describe('Focus.history (ring buffer)', () => {
  test('set push\'ит в history; back возвращает предыдущий', async () => {
    const { Focus, state } = await freshFocus();
    Focus.set({ kind: 'employee', id: 'a@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'b@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'c@x', period: '7d' });
    assert.equal(state.meta.focus.id, 'c@x');
    Focus.back();
    assert.equal(state.meta.focus.id, 'b@x');
    Focus.back();
    assert.equal(state.meta.focus.id, 'a@x');
    // дальше — clamp (нет более ранних)
    const more = Focus.back();
    assert.equal(more, null);
    assert.equal(state.meta.focus.id, 'a@x');
  });

  test('forward после back восстанавливает следующий focus', async () => {
    const { Focus, state } = await freshFocus();
    Focus.set({ kind: 'employee', id: 'a@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'b@x', period: '7d' });
    Focus.back();
    assert.equal(state.meta.focus.id, 'a@x');
    Focus.forward();
    assert.equal(state.meta.focus.id, 'b@x');
    // forward за пределами — clamp
    assert.equal(Focus.forward(), null);
  });

  test('history clamp: больше HISTORY_CAP записей → старые вытесняются', async () => {
    const { Focus } = await freshFocus();
    const cap = Focus.history.cap;
    for (let i = 0; i < cap + 5; i++) {
      Focus.set({ kind: 'employee', id: `id${i}@x`, period: '7d' });
    }
    const entries = Focus.history._entries();
    assert.equal(entries.length, cap, `history length должна быть ровно cap (=${cap})`);
    // Самая старая запись — id5 (первые 5 вытеснены).
    assert.equal(entries[0].id, 'id5@x');
  });

  test('дедупликация: повторный set с теми же {kind,id,period} не дублирует head', async () => {
    const { Focus } = await freshFocus();
    Focus.set({ kind: 'employee', id: 'a@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'a@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'a@x', period: '7d' });
    assert.equal(Focus.history._entries().length, 1);
  });

  test('set после back обрезает forward-хвост (как браузер)', async () => {
    const { Focus, state } = await freshFocus();
    Focus.set({ kind: 'employee', id: 'a@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'b@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'c@x', period: '7d' });
    Focus.back();                         // идём в b
    Focus.set({ kind: 'employee', id: 'd@x', period: '7d' });
    // c должен быть сброшен (как branching history в браузере)
    assert.equal(state.meta.focus.id, 'd@x');
    assert.equal(Focus.forward(), null);  // нет «вперёд» — c обрезан
    const ids = Focus.history._entries().map(e => e.id);
    assert.deepEqual(ids, ['a@x', 'b@x', 'd@x']);
  });
});

describe('Focus.bindHotkeys', () => {
  test('bindHotkeys идемпотентен; устанавливает keydown listener', async () => {
    const { Focus } = await freshFocus();
    assert.equal(Focus._isHotkeysBound(), false);
    Focus.bindHotkeys();
    assert.equal(Focus._isHotkeysBound(), true);
    // Повторный вызов — no-op (флаг уже true).
    Focus.bindHotkeys();
    assert.equal(Focus._isHotkeysBound(), true);
    Focus.unbindHotkeys();
    assert.equal(Focus._isHotkeysBound(), false);
  });
});

describe('Focus EventBus emit', () => {
  test('set эмитит \'focus-changed\' с payload focus', async () => {
    const { Focus, EventBus } = await freshFocus();
    let received = null;
    EventBus.on('focus-changed', (f) => { received = f; });
    Focus.set({ kind: 'release', id: '1.21', period: 'q' });
    assert.deepEqual(received, { kind: 'release', id: '1.21', period: 'q' });
  });

  test('clear эмитит \'focus-changed\' с null', async () => {
    const { Focus, EventBus } = await freshFocus();
    let received = 'untouched';
    EventBus.on('focus-changed', (f) => { received = f; });
    Focus.set({ kind: 'team', id: 'alpha', period: '7d' });
    received = 'untouched';
    Focus.clear();
    assert.equal(received, null);
  });

  test('back / forward тоже эмитят \'focus-changed\'', async () => {
    const { Focus, EventBus } = await freshFocus();
    Focus.set({ kind: 'employee', id: 'a@x', period: '7d' });
    Focus.set({ kind: 'employee', id: 'b@x', period: '7d' });
    let received = null;
    EventBus.on('focus-changed', (f) => { received = f; });
    Focus.back();
    assert.equal(received.id, 'a@x');
    Focus.forward();
    assert.equal(received.id, 'b@x');
  });
});

describe('Focus period validation', () => {
  test('все валидные periods принимаются 1:1', async () => {
    const { Focus } = await freshFocus();
    for (const p of Focus.PERIODS) {
      const r = Focus.set({ kind: 'employee', id: 'x@y', period: p });
      assert.equal(r.period, p, `period "${p}" должен пройти as-is`);
    }
  });

  test('default period = "7d" если не передан', async () => {
    const { Focus } = await freshFocus();
    const r = Focus.set({ kind: 'employee', id: 'x@y' });
    assert.equal(r.period, '7d');
  });

  test('PERIODS / KINDS — frozen', async () => {
    const { Focus } = await freshFocus();
    assert.equal(Object.isFrozen(Focus.PERIODS), true);
    assert.equal(Object.isFrozen(Focus.KINDS), true);
  });
});
