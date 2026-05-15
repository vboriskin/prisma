'use strict';
/* ============================================================
   tests/unit/permissions.test.js — AUDIT_HOLISTIC P6 + Идея 1
   --
   Покрывает app/permissions.js: can / guard / check / default-allow /
   missing-matrix-fallback / EventBus permission-denied.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

let _state, _Permissions, _EventBus;
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
  if (!_Permissions) {
    const m = await import('../../app/permissions.js');
    _Permissions = m.Permissions;
  }
  // Reset matrix к дефолтам state.js.
  _state.meta.permissions = {
    canBulkEdit:      true,
    canChangeScope:   true,
    canMarkDone:      true,
    canExport:        true,
    canEditEmployees: false,
  };
  _EventBus.clear();
  return { state: _state, Permissions: _Permissions, EventBus: _EventBus };
}

describe('Permissions.can', () => {
  test('true для разрешённого action', async () => {
    const { Permissions } = await fresh();
    assert.equal(Permissions.can('canBulkEdit'),    true);
    assert.equal(Permissions.can('canChangeScope'), true);
    assert.equal(Permissions.can('canMarkDone'),    true);
    assert.equal(Permissions.can('canExport'),      true);
  });

  test('false для запрещённого action', async () => {
    const { state, Permissions } = await fresh();
    assert.equal(Permissions.can('canEditEmployees'), false);
    state.meta.permissions.canBulkEdit = false;
    assert.equal(Permissions.can('canBulkEdit'), false);
  });

  test('default-allow для unknown action', async () => {
    const { Permissions } = await fresh();
    // Контракт: неизвестное имя → true (не ломаем существующий код,
    // ещё не интегрированный с matrix'ей).
    assert.equal(Permissions.can('canDoSomethingNew'), true);
    assert.equal(Permissions.can('totallyMadeUp'),     true);
  });

  test('false для невалидного action-имени', async () => {
    const { Permissions } = await fresh();
    assert.equal(Permissions.can(''),       false);
    assert.equal(Permissions.can(null),     false);
    assert.equal(Permissions.can(undefined),false);
    assert.equal(Permissions.can(123),      false);
  });
});

describe('Permissions.guard', () => {
  test('happy path — fn выполняется, результат возвращается', async () => {
    const { Permissions } = await fresh();
    let called = false;
    const r = Permissions.guard('canBulkEdit', () => { called = true; return 42; });
    assert.equal(called, true);
    assert.equal(r, 42);
  });

  test('refuse — fn не выполняется, undefined', async () => {
    const { Permissions } = await fresh();
    let called = false;
    const r = Permissions.guard('canEditEmployees', () => { called = true; return 'x'; });
    assert.equal(called, false);
    assert.equal(r, undefined);
  });

  test('throws при не-функции fn', async () => {
    const { Permissions } = await fresh();
    assert.throws(() => Permissions.guard('canBulkEdit', null), /must be function/);
  });

  test('refuse эмитит permission-denied в EventBus', async () => {
    const { Permissions, EventBus } = await fresh();
    let denied = null;
    EventBus.on('permission-denied', p => { denied = p; });
    Permissions.guard('canEditEmployees', () => 'never');
    assert.deepEqual(denied, { action: 'canEditEmployees' });
  });
});

describe('Permissions.check', () => {
  test('возвращает can(), эмитит permission-denied при отказе', async () => {
    const { Permissions, EventBus } = await fresh();
    const events = [];
    EventBus.on('permission-denied', p => { events.push(p); });
    assert.equal(Permissions.check('canBulkEdit'),      true);
    assert.equal(Permissions.check('canEditEmployees'), false);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'canEditEmployees');
  });
});
