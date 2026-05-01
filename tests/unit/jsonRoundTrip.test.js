'use strict';
/* ============================================================
   tests/unit/jsonRoundTrip.test.js
   --
   System tests for V15 JSON export / import path.
   Covers: schema shape, allowlist enforcement on bundle, parse
   guards, and the actual round-trip (state → JSON → state).

   Browser env shims: localStorage + minimal `state` proxy + window.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeLS() {
  const m = new Map();
  return {
    getItem:    (k) => (m.has(k) ? m.get(k) : null),
    setItem:    (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear:      () => m.clear(),
    _store:     m,
  };
}

globalThis.localStorage = makeLS();
globalThis.window       = { addEventListener: () => {}, App: { applyPresetsCollapsed: () => {} }, ThemeUI: { apply: () => {} } };

const { state }                     = await import('../../state.js');
const { CSV, JSONExport, JSONImport, Storage } = await import('../../dataStore.js');

describe('JSONExport.buildSnapshot', () => {
  beforeEach(() => {
    state.rows = [
      { id: 'r1', team: 'A', epic: 'E1', tasks: 'T1', isDone: false, release120Types: [], release121Types: [], release122Types: [], overtimeTypes: [], backlogTypes: [], donePills: {}, ganttArrows: [], riskFlags: [] },
      { id: 'r2', team: 'B', epic: 'E2', tasks: 'T2', isDone: true,  release120Types: [], release121Types: [], release122Types: [], overtimeTypes: [], backlogTypes: [], donePills: {}, ganttArrows: [], riskFlags: [] },
    ];
    state.employees = [
      { id: 'e1', fio: 'Иванов', roles: 'Backend', teams: 'A', overtimeDays: [], weekdayReady: true, weekdayComment: '' },
    ];
    globalThis.localStorage = makeLS();
  });

  test('contains required top-level keys', () => {
    const s = JSONExport.buildSnapshot();
    assert.equal(s.$schema, 'q2-plan/v1');
    assert.ok(s.appVersion);
    assert.match(s.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(s.data);
    assert.ok(s.settings);
    assert.ok(s.bundle);
  });

  test('data contains rows + employees verbatim', () => {
    const s = JSONExport.buildSnapshot();
    assert.equal(s.data.rows.length, 2);
    assert.equal(s.data.rows[0].team, 'A');
    assert.equal(s.data.employees.length, 1);
    assert.equal(s.data.employees[0].fio, 'Иванов');
  });

  test('settings includes V14 plan-lock keys', () => {
    state.planLocked    = { at: '2026-04-30T00:00:00Z', by: 'user' };
    state.ganttEditMode = true;
    const s = JSONExport.buildSnapshot();
    assert.deepEqual(s.settings.planLocked, { at: '2026-04-30T00:00:00Z', by: 'user' });
    assert.equal(s.settings.ganttEditMode, true);
  });

  test('V17.1 F1: integrations key IS exported but tokens are scrubbed', () => {
    localStorage.setItem('q2_settings_v3', '{"foo":1}');
    localStorage.setItem('q2_integrations_v1', JSON.stringify({
      jiraToken: 'SECRET',
      jiraProjectKeys: 'PROJ',
    }));
    const s = JSONExport.buildSnapshot();
    // V17.1 F1 — integrations key теперь round-trip'ится через JSON
    //   (project keys, base URLs, feature toggles), но _scrubSecrets вырезает
    //   token-shaped поля. Старая политика «омит ключа целиком» снята.
    assert.ok(s.bundle.q2_settings_v3, 'normal settings key still exported');
    assert.ok(s.bundle.q2_integrations_v1, 'integrations key is now present (V17.1 F1)');
    assert.equal(s.bundle.q2_integrations_v1.jiraToken, undefined, 'jiraToken stripped');
    assert.equal(s.bundle.q2_integrations_v1.jiraProjectKeys, 'PROJ', 'non-secret survives');
    // Defence-in-depth: token never appears anywhere in serialised snapshot.
    const stringified = JSON.stringify(s);
    assert.ok(!stringified.includes('SECRET'), 'token value must NOT appear anywhere in the export');
  });
});

describe('JSONImport.parse', () => {
  test('rejects non-JSON', () => {
    assert.throws(() => JSONImport.parse('not json'), /валидным JSON/);
  });
  test('rejects empty object', () => {
    assert.throws(() => JSONImport.parse('{}'), /Отсутствует поле data/);
  });
  test('rejects missing rows array', () => {
    assert.throws(() => JSONImport.parse(JSON.stringify({ data: { } })), /data.rows должен быть массивом/);
  });
  test('accepts minimal valid snapshot', () => {
    const out = JSONImport.parse(JSON.stringify({ $schema: 'q2-plan/v1', data: { rows: [] } }));
    assert.equal(out.$schema, 'q2-plan/v1');
    assert.equal(out.data.rows.length, 0);
  });
});

describe('JSONImport.apply — round-trip', () => {
  beforeEach(() => {
    state.rows = [];
    state.employees = [];
    state.planLocked = null;
    state.ganttEditMode = false;
    globalThis.localStorage = makeLS();
    // confirm() — auto-yes for tests; alert() — silent.
    globalThis.confirm = () => true;
    globalThis.alert   = () => {};
    // Storage.save is a no-op effectively in this env; flushNow may try to
    // touch localStorage, that's fine since we have a shim.
  });

  test('round-trip preserves rows + employees + plan-lock', () => {
    state.rows = [
      { id: 'r-aaa', team: 'X', epic: 'EX', tasks: 'TX', isDone: false, release120Types: ['BE'], release121Types: [], release122Types: [], overtimeTypes: [], backlogTypes: [], donePills: {}, ganttArrows: [], riskFlags: [] },
    ];
    state.employees = [
      { id: 'e-aaa', fio: 'Петров', roles: 'QA|Lead', teams: 'X', overtimeDays: ['2026-05-01'], weekdayReady: false, weekdayComment: '' },
    ];
    state.planLocked    = { at: '2026-04-30T12:00:00Z', by: 'user' };
    state.ganttEditMode = false;

    const snapshot = JSONExport.buildSnapshot();
    const json = JSON.stringify(snapshot);

    // Reset state to simulate a fresh app
    state.rows = [];
    state.employees = [];
    state.planLocked = null;
    state.ganttEditMode = true;     // verify import overwrites this

    const parsed = JSONImport.parse(json);
    JSONImport.apply(parsed);

    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0].team, 'X');
    assert.equal(state.rows[0].epic, 'EX');
    assert.deepEqual(state.rows[0].release120Types, ['BE']);
    assert.equal(state.employees.length, 1);
    assert.equal(state.employees[0].fio, 'Петров');
    assert.deepEqual(state.planLocked, { at: '2026-04-30T12:00:00Z', by: 'user' });
    assert.equal(state.ganttEditMode, false);
  });

  test('bundle import respects allowlist (V17.1 F1: integrations + LLM теперь allowed, но без токенов)', () => {
    const snapshot = {
      $schema: 'q2-plan/v1',
      appVersion: '15.0.0',
      exportedAt: '2026-04-30T00:00:00Z',
      data: { rows: [], employees: [] },
      settings: {},
      bundle: {
        // V17.1 F1 — integrations + llm теперь в allowlist (round-trip
        //   project keys / base URLs); токены вычищены _scrubSecrets'ом
        //   ещё на этапе экспорта, поэтому здесь приходят без них.
        'q2_settings_v3':       { foo: 1 },                         // allowed
        'q2_integrations_v1':   { jiraProjectKeys: 'PROJ' },         // allowed (no token)
        'q2_llm_settings_v1':   { model: 'GigaChat-2', temp: 0.2 },  // allowed (no token)
        '__proto__':            { polluted: true },                  // disallowed
      },
    };
    JSONImport.apply(snapshot);
    assert.ok(localStorage.getItem('q2_settings_v3'));
    assert.ok(localStorage.getItem('q2_integrations_v1'), 'integrations restored (V17.1 F1)');
    assert.ok(localStorage.getItem('q2_llm_settings_v1'), 'LLM settings restored (V17.1 F1)');
    // Object.prototype must not be polluted — ferret out via direct check.
    assert.equal({}.polluted, undefined, 'Object.prototype must not be polluted by import');
  });

  test('bad data passes parse() but apply() handles row factory normalisation', () => {
    const snapshot = {
      $schema: 'q2-plan/v1',
      data: { rows: [{ team: 'X' }, { team: 'Y' }], employees: [] },
    };
    const parsed = JSONImport.parse(JSON.stringify(snapshot));
    JSONImport.apply(parsed);
    assert.equal(state.rows.length, 2);
    // Row factory assigns ids
    assert.ok(state.rows[0].id);
    assert.ok(state.rows[1].id);
  });
});
