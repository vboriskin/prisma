'use strict';
/* ============================================================
   tests/unit/historyLog.test.js — V21 BF (audit-08 critical-zero-coverage)
   --
   Покрывает HistoryLog (logAction, loadHistoryLog, clearHistoryLog +
   convenience wrappers). exportHistoryAsCSV — DOM-heavy (Blob/URL/<a>),
   тестируем только pure logic.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

function makeLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem:    (k) => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
    _store: store,
  };
}

// Canonical imports — оба модуля делят single state-объект.
// Test isolation через explicit reset state.actionLog в начале каждого теста.
import { state } from '../../state.js';
import { logAction, loadHistoryLog, clearHistoryLog, HistoryLog, HISTORY_KEY } from '../../historyLog.js';

async function freshHistoryLog(initialStorage = {}) {
  globalThis.localStorage = makeLocalStorage(initialStorage);
  globalThis.window = { addEventListener: () => {}, onerror: null };
  state.actionLog = [];
  state.simMode   = false;
  state.activeSection = '';
  return { state, logAction, loadHistoryLog, clearHistoryLog, HistoryLog, localStorage: globalThis.localStorage };
}

describe('logAction — append entry', () => {
  test('добавляет entry с обязательными полями', async () => {
    const { state, logAction } = await freshHistoryLog();
    logAction({ type: 'test_event', label: 'Test', source: 'test' });
    assert.equal(state.actionLog.length, 1);
    const e = state.actionLog[0];
    assert.equal(e.type, 'test_event');
    assert.equal(e.label, 'Test');
    assert.equal(e.source, 'test');
    assert.equal(e.category, 'data', 'default category');
    assert.equal(e.count, 1, 'default count');
    assert.ok(e.id, 'id assigned');
    assert.ok(e.at, 'at timestamp assigned');
  });

  test('игнорирует entry без type', async () => {
    const { state, logAction } = await freshHistoryLog();
    logAction({ label: 'no-type' });
    logAction({ type: '' });
    logAction({});
    assert.equal(state.actionLog.length, 0);
  });

  test('newest first (unshift order)', async () => {
    const { state, logAction } = await freshHistoryLog();
    logAction({ type: 'a' });
    logAction({ type: 'b' });
    logAction({ type: 'c' });
    assert.equal(state.actionLog[0].type, 'c');
    assert.equal(state.actionLog[2].type, 'a');
  });

  test('truncates long fields per limits', async () => {
    const { state, logAction } = await freshHistoryLog();
    const longType = 'x'.repeat(200);
    const longLabel = 'y'.repeat(500);
    const longDetails = 'z'.repeat(1000);
    logAction({ type: longType, label: longLabel, details: longDetails });
    const e = state.actionLog[0];
    assert.equal(e.type.length, 80);
    assert.equal(e.label.length, 200);
    assert.equal(e.details.length, 500);
  });

  test('persists to localStorage', async () => {
    const { logAction, localStorage } = await freshHistoryLog();
    logAction({ type: 'persist', label: 'Test' });
    const persisted = localStorage.getItem('q2_action_log_v1');
    assert.ok(persisted);
    const parsed = JSON.parse(persisted);
    assert.equal(parsed[0].type, 'persist');
  });

  test('cap at MAX_ENTRIES=1000', async () => {
    const { state, logAction } = await freshHistoryLog();
    for (let i = 0; i < 1100; i++) {
      logAction({ type: `e_${i}` });
    }
    assert.equal(state.actionLog.length, 1000);
    assert.equal(state.actionLog[0].type, 'e_1099', 'newest at top');
  });

  test('simMode flag из state.simMode', async () => {
    const { state, logAction } = await freshHistoryLog();
    state.simMode = true;
    logAction({ type: 'sim' });
    assert.equal(state.actionLog[0].simMode, true);
    state.simMode = false;
    logAction({ type: 'real' });
    assert.equal(state.actionLog[0].simMode, false);
  });
});

describe('HistoryLog wrappers — categories', () => {
  test('data() задаёт category=data', async () => {
    const { state, HistoryLog } = await freshHistoryLog();
    HistoryLog.data('test_data', 'Some label');
    assert.equal(state.actionLog[0].category, 'data');
  });

  test('ai() / integrations() / settings() / view() / system()', async () => {
    const { state, HistoryLog } = await freshHistoryLog();
    HistoryLog.ai('a', 'l');
    HistoryLog.integrations('a', 'l');
    HistoryLog.settings('a', 'l');
    HistoryLog.view('a', 'l');
    HistoryLog.system('a', 'l');
    const cats = state.actionLog.map(e => e.category);
    assert.ok(cats.includes('ai'));
    assert.ok(cats.includes('integrations'));
    assert.ok(cats.includes('settings'));
    assert.ok(cats.includes('view'));
    assert.ok(cats.includes('system'));
  });
});

describe('loadHistoryLog — restore from localStorage', () => {
  test('читает stored array', async () => {
    const stored = [
      { id: '1', type: 't1', at: new Date().toISOString() },
      { id: '2', type: 't2', at: new Date().toISOString() },
    ];
    const { state, loadHistoryLog } = await freshHistoryLog({
      'q2_action_log_v1': JSON.stringify(stored),
    });
    loadHistoryLog();
    assert.equal(state.actionLog.length, 2);
  });

  test('фильтрует entries старше RETENTION_DAYS=90', async () => {
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString();
    const fresh = new Date().toISOString();
    const { state, loadHistoryLog } = await freshHistoryLog({
      'q2_action_log_v1': JSON.stringify([
        { id: '1', type: 'old', at: old },
        { id: '2', type: 'fresh', at: fresh },
      ]),
    });
    loadHistoryLog();
    assert.equal(state.actionLog.length, 1);
    assert.equal(state.actionLog[0].type, 'fresh');
  });

  test('corrupt JSON → state.actionLog = []', async () => {
    const { state, loadHistoryLog } = await freshHistoryLog({
      'q2_action_log_v1': '{not valid',
    });
    loadHistoryLog();
    assert.deepEqual(state.actionLog, []);
  });

  test('non-array stored → no-op (не сбрасывает state)', async () => {
    const { state, loadHistoryLog } = await freshHistoryLog({
      'q2_action_log_v1': '"a string"',
    });
    state.actionLog = [{ id: 'preexisting', type: 'x' }];
    loadHistoryLog();
    // Non-array → early return, state not touched.
    assert.equal(state.actionLog.length, 1);
    assert.equal(state.actionLog[0].id, 'preexisting');
  });

  test('пустой localStorage → no-op', async () => {
    const { state, loadHistoryLog } = await freshHistoryLog();
    state.actionLog = [{ id: 'preexisting' }];
    loadHistoryLog();
    assert.equal(state.actionLog[0].id, 'preexisting');
  });
});

describe('clearHistoryLog', () => {
  test('очищает state.actionLog + удаляет из localStorage', async () => {
    const { state, logAction, clearHistoryLog, localStorage } = await freshHistoryLog();
    logAction({ type: 'a' });
    logAction({ type: 'b' });
    assert.equal(state.actionLog.length, 2);
    clearHistoryLog();
    assert.equal(state.actionLog.length, 0);
    assert.equal(localStorage.getItem('q2_action_log_v1'), null);
  });
});
