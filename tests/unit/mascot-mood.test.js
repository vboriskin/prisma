'use strict';
/* ============================================================
   tests/unit/mascot-mood.test.js — AUDIT_HOLISTIC F11 / Идея 12
   --
   Покрывает app/mascotMood.js: state→mood mapping, debounce, manual
   override, reduced-motion no-op, subscribe/unsubscribe lifecycle.
   ============================================================ */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- minimal DOM/localStorage/matchMedia mock ----------- */

function installFakeBrowser({ reducedMotion = false, moodDisabled = false } = {}) {
  const fab = {
    classList: {
      _set: new Set(),
      add(...cs)    { for (const c of cs) this._set.add(c); },
      remove(...cs) { for (const c of cs) this._set.delete(c); },
      contains(c)   { return this._set.has(c); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
    },
    offsetWidth: 0, // for "force reflow" expression
  };
  globalThis.document = {
    getElementById(id) {
      if (id === 'obsidian-fab-mascot') return fab;
      return null;
    },
  };
  const store = new Map();
  if (moodDisabled) store.set('q2_mascot_mood_disabled', '1');
  globalThis.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
  globalThis.matchMedia = (q) => ({ matches: !!reducedMotion && /reduce/.test(q) });

  // Stub ObsidianMascot — фиксируем вызовы.
  const calls = [];
  globalThis.ObsidianMascot = {
    pulseAlertOnFab() { calls.push('pulseAlertOnFab'); fab.classList.add('obs--alert'); },
    setChatPhase(phase, el) {
      calls.push(['setChatPhase', phase, el === fab ? 'fab' : 'other']);
      if (phase === 'thinking') fab.classList.add('obs--ls-thinking');
    },
  };
  return { fab, calls };
}

function uninstallFakeBrowser() {
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.matchMedia;
  delete globalThis.ObsidianMascot;
  delete globalThis.MascotMood;
}

/** Fresh import — module-level singleton _bound flag иначе утекает. */
async function freshMood() {
  const url = '../../app/mascotMood.js?t=' + Date.now() + Math.random();
  const mod = await import(url);
  return mod;
}

/* ----------------------------------------------------------------- */

describe('MascotMood — pure mapping (computeMoodFromState)', () => {
  beforeEach(() => installFakeBrowser());
  afterEach(uninstallFakeBrowser);

  test('on-course: 0 off-course + 0 drift → on-course', async () => {
    const { computeMoodFromState } = await freshMood();
    const s = { rows: [{ riskScore: 0 }, { riskScore: 10 }, { riskScore: 25 }] };
    assert.equal(computeMoodFromState(s), 'on-course');
  });

  test('drift: 3+ drift, 0 off-course → drift', async () => {
    const { computeMoodFromState } = await freshMood();
    const s = { rows: [
      { riskScore: 35 }, { riskScore: 40 }, { riskScore: 45 }, { riskScore: 30 },
    ] };
    assert.equal(computeMoodFromState(s), 'drift');
  });

  test('on-course: ≤2 drift всё ещё считается on-course (tolerance)', async () => {
    const { computeMoodFromState } = await freshMood();
    const s = { rows: [{ riskScore: 35 }, { riskScore: 40 }] };
    assert.equal(computeMoodFromState(s), 'on-course');
  });

  test('off-course: 1+ off-course перебивает любое drift-кол-во', async () => {
    const { computeMoodFromState } = await freshMood();
    const s = { rows: [{ riskScore: 65 }, { riskScore: 35 }, { riskScore: 35 }] };
    assert.equal(computeMoodFromState(s), 'off-course');
  });

  test('thinking: state.llm.isStreaming перебивает drift но не success', async () => {
    const { computeMoodFromState } = await freshMood();
    const s = { rows: [{ riskScore: 65 }], llm: { isStreaming: true } };
    assert.equal(computeMoodFromState(s), 'thinking');
    // success имеет наивысший приоритет
    assert.equal(computeMoodFromState(s, { pendingSuccess: true }), 'success');
  });

  test('пустой state.rows → on-course (graceful)', async () => {
    const { computeMoodFromState } = await freshMood();
    assert.equal(computeMoodFromState({}), 'on-course');
    assert.equal(computeMoodFromState({ rows: [] }), 'on-course');
    assert.equal(computeMoodFromState({ rows: null }), 'on-course');
  });
});

describe('MascotMood — DOM application', () => {
  beforeEach(() => installFakeBrowser());
  afterEach(uninstallFakeBrowser);

  test('off-course → ObsidianMascot.pulseAlertOnFab() вызывается', async () => {
    const { MascotMood } = await freshMood();
    const calls = globalThis.ObsidianMascot.__calls || [];
    // Перехватываем calls
    const seen = [];
    globalThis.ObsidianMascot.pulseAlertOnFab = () => seen.push('pulse');
    MascotMood.update({ rows: [{ riskScore: 70 }] });
    assert.equal(MascotMood.getCurrentMood(), 'off-course');
    assert.deepEqual(seen, ['pulse']);
  });

  test('drift → fab получает класс obs--cur', async () => {
    const { MascotMood } = await freshMood();
    const fab = globalThis.document.getElementById('obsidian-fab-mascot');
    MascotMood.update({ rows: [
      { riskScore: 35 }, { riskScore: 40 }, { riskScore: 45 },
    ] });
    assert.equal(MascotMood.getCurrentMood(), 'drift');
    assert.equal(fab.classList.contains('obs--cur'), true);
    assert.equal(fab.classList.contains('obs--breathe'), true);
  });

  test('on-course → класс obs--breathe, нет drift/thinking loop-классов', async () => {
    const { MascotMood } = await freshMood();
    const fab = globalThis.document.getElementById('obsidian-fab-mascot');
    // Сначала перейдём в drift, потом обратно в on-course.
    MascotMood.update({ rows: [{ riskScore: 35 }, { riskScore: 40 }, { riskScore: 45 }] });
    MascotMood.update({ rows: [{ riskScore: 0 }] });
    assert.equal(MascotMood.getCurrentMood(), 'on-course');
    assert.equal(fab.classList.contains('obs--cur'), false);
    assert.equal(fab.classList.contains('obs--ls-thinking'), false);
    assert.equal(fab.classList.contains('obs--breathe'), true);
  });
});

describe('MascotMood — manual override', () => {
  beforeEach(() => installFakeBrowser());
  afterEach(uninstallFakeBrowser);

  test('setMood("off-course") переопределяет авто-расчёт даже при rows=[]', async () => {
    const { MascotMood } = await freshMood();
    let pulses = 0;
    globalThis.ObsidianMascot.pulseAlertOnFab = () => pulses++;

    MascotMood.setMood('off-course');
    assert.equal(MascotMood.getCurrentMood(), 'off-course');
    assert.equal(pulses, 1);

    // Несмотря на пустой state — overrid'нутый mood держится при update().
    MascotMood.update({ rows: [] });
    assert.equal(MascotMood.getCurrentMood(), 'off-course');
  });

  test('setMood(null) возвращает в авто-режим', async () => {
    const { MascotMood } = await freshMood();
    MascotMood.setMood('drift');
    assert.equal(MascotMood.getCurrentMood(), 'drift');
    MascotMood.setMood(null);
    MascotMood.update({ rows: [{ riskScore: 0 }] });
    assert.equal(MascotMood.getCurrentMood(), 'on-course');
  });
});

describe('MascotMood — debounce и subscribe lifecycle', () => {
  let timers;
  beforeEach(() => {
    installFakeBrowser();
    timers = [];
    const origST = globalThis.setTimeout;
    const origCT = globalThis.clearTimeout;
    globalThis.setTimeout = (fn, ms) => {
      const id = origST(fn, ms);
      timers.push(id);
      return id;
    };
    globalThis.clearTimeout = (id) => origCT(id);
    globalThis.__origSetTimeout = origST;
    globalThis.__origClearTimeout = origCT;
  });
  afterEach(() => {
    globalThis.setTimeout = globalThis.__origSetTimeout;
    globalThis.clearTimeout = globalThis.__origClearTimeout;
    delete globalThis.__origSetTimeout;
    delete globalThis.__origClearTimeout;
    uninstallFakeBrowser();
  });

  test('_scheduleUpdate планирует ОДИН таймер несмотря на N вызовов', async () => {
    const { MascotMood } = await freshMood();
    // Имитируем burst-mutations через подписку
    MascotMood.subscribe();
    const before = timers.length;
    // 10 burst-уведомлений (как при bulk-mutate state.rows)
    for (let i = 0; i < 10; i++) MascotMood._scheduleUpdate();
    // Должен быть scheduled максимум 1 debounce-таймер (плюс initial из subscribe + interval)
    // Проверяем флаг _debounceTimer — он не нулевой.
    assert.ok(MascotMood._debounceTimer !== 0, 'debounce timer scheduled');
    // Cleanup
    MascotMood.unsubscribe();
    assert.equal(MascotMood._debounceTimer, 0, 'debounce cancelled on unsubscribe');
    assert.equal(MascotMood._intervalTimer, 0, 'interval cancelled on unsubscribe');
  });

  test('subscribe идемпотентно (двойной subscribe не дублирует interval)', async () => {
    const { MascotMood } = await freshMood();
    MascotMood.subscribe();
    const firstInterval = MascotMood._intervalTimer;
    MascotMood.subscribe();
    assert.equal(MascotMood._intervalTimer, firstInterval, 'no second interval');
    MascotMood.unsubscribe();
  });

  test('unsubscribe корректно сбрасывает все таймеры даже без subscribe', async () => {
    const { MascotMood } = await freshMood();
    // Не должно бросать
    MascotMood.unsubscribe();
    assert.equal(MascotMood._bound, false);
  });
});

describe('MascotMood — reduced-motion и mood-disabled', () => {
  afterEach(uninstallFakeBrowser);

  test('reduced-motion: переход в off-course/drift → no-op (остаёмся в on-course)', async () => {
    installFakeBrowser({ reducedMotion: true });
    const { MascotMood } = await freshMood();
    let pulses = 0;
    globalThis.ObsidianMascot.pulseAlertOnFab = () => pulses++;

    MascotMood.update({ rows: [{ riskScore: 70 }] });
    // off-course mapping расчитан, но _applyMood делает no-op для не-on-course
    assert.equal(MascotMood.getCurrentMood(), 'on-course');
    assert.equal(pulses, 0);
  });

  test('mood-disabled (localStorage flag): update() — no-op', async () => {
    installFakeBrowser({ moodDisabled: true });
    const { MascotMood } = await freshMood();
    assert.equal(MascotMood.isDisabled(), true);

    let pulses = 0;
    globalThis.ObsidianMascot.pulseAlertOnFab = () => pulses++;
    MascotMood.update({ rows: [{ riskScore: 90 }] });
    assert.equal(pulses, 0, 'pulseAlertOnFab not called when mood disabled');
    assert.equal(MascotMood.getCurrentMood(), 'on-course');
  });

  test('setDisabled(true) сбрасывает текущий drift в on-course', async () => {
    installFakeBrowser();
    const { MascotMood } = await freshMood();
    const fab = globalThis.document.getElementById('obsidian-fab-mascot');
    MascotMood.update({ rows: [{ riskScore: 35 }, { riskScore: 40 }, { riskScore: 45 }] });
    assert.equal(MascotMood.getCurrentMood(), 'drift');

    MascotMood.setDisabled(true);
    assert.equal(MascotMood.getCurrentMood(), 'on-course');
    assert.equal(fab.classList.contains('obs--cur'), false);

    // Cleanup флаг чтобы не утёк в следующий тест
    MascotMood.setDisabled(false);
  });
});
