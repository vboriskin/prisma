'use strict';
/* ============================================================
   tests/unit/feature-flags.test.js — AUDIT_HOLISTIC P5 + Идея 1
   --
   Покрывает app/featureFlags.js: isEnabled / subscribe / set / default-on /
   disable / EventBus 'flags-changed' bridge.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

let _state, _Flags, _EventBus;
async function fresh() {
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  if (!_state) {
    const m = await import('../../state.js');
    _state = m.state;
  }
  if (!_EventBus) {
    const m = await import('../../app/eventBus.js');
    _EventBus = m.EventBus;
  }
  if (!_Flags) {
    const m = await import('../../app/featureFlags.js');
    _Flags = m.Flags;
  }
  _state.meta.featureFlags = {
    ai:            true,
    mascotMood:    true,
    notifications: true,
    explainScreen: true,
  };
  _Flags._resetForTest();
  _EventBus.clear();
  return { state: _state, Flags: _Flags, EventBus: _EventBus };
}

describe('Flags.isEnabled', () => {
  test('true для включённого, false для выключенного', async () => {
    const { state, Flags } = await fresh();
    assert.equal(Flags.isEnabled('ai'),         true);
    assert.equal(Flags.isEnabled('mascotMood'), true);
    state.meta.featureFlags.ai = false;
    assert.equal(Flags.isEnabled('ai'),         false);
    assert.equal(Flags.isEnabled('mascotMood'), true);
  });

  test('default-on для неизвестного флага', async () => {
    const { Flags } = await fresh();
    // Контракт: добавление новой фичи не требует одновременного флага в state.
    assert.equal(Flags.isEnabled('brandNewFeature'), true);
  });

  test('false для невалидного имени', async () => {
    const { Flags } = await fresh();
    assert.equal(Flags.isEnabled(''),        false);
    assert.equal(Flags.isEnabled(null),      false);
    assert.equal(Flags.isEnabled(undefined), false);
  });
});

describe('Flags.set', () => {
  test('меняет значение в state.meta.featureFlags', async () => {
    const { state, Flags } = await fresh();
    Flags.set('ai', false);
    assert.equal(state.meta.featureFlags.ai, false);
    assert.equal(Flags.isEnabled('ai'),      false);
    Flags.set('ai', true);
    assert.equal(Flags.isEnabled('ai'),      true);
  });

  test('coerce non-bool → boolean', async () => {
    const { state, Flags } = await fresh();
    Flags.set('ai', 0);     assert.equal(state.meta.featureFlags.ai, true);  // 0 !== false → true
    Flags.set('ai', false); assert.equal(state.meta.featureFlags.ai, false);
    Flags.set('ai', '');    assert.equal(state.meta.featureFlags.ai, true);
  });
});

describe('Flags.subscribe', () => {
  test('handler вызывается при .set() с новым значением', async () => {
    const { Flags } = await fresh();
    const calls = [];
    Flags.subscribe('ai', v => calls.push(v));
    Flags.set('ai', false);
    Flags.set('ai', true);
    assert.deepEqual(calls, [false, true]);
  });

  test('subscribe возвращает unsubscribe', async () => {
    const { Flags } = await fresh();
    const calls = [];
    const unsub = Flags.subscribe('ai', v => calls.push(v));
    Flags.set('ai', false);
    unsub();
    Flags.set('ai', true);
    assert.deepEqual(calls, [false]);
    assert.equal(Flags._subscriberCount('ai'), 0);
  });

  test('handler не вызывается на set с тем же значением', async () => {
    const { Flags } = await fresh();
    const calls = [];
    Flags.subscribe('ai', v => calls.push(v));
    Flags.set('ai', true); // уже true
    assert.deepEqual(calls, []);
  });
});

describe('Flags ↔ EventBus bridge', () => {
  test('set() эмитит flags-changed', async () => {
    const { Flags, EventBus } = await fresh();
    const evts = [];
    EventBus.on('flags-changed', p => evts.push(p));
    Flags.set('ai', false);
    Flags.set('mascotMood', false);
    assert.equal(evts.length, 2);
    assert.deepEqual(evts[0], { name: 'ai', value: false });
    assert.deepEqual(evts[1], { name: 'mascotMood', value: false });
  });
});
