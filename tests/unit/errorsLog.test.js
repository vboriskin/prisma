'use strict';
/* ============================================================
   tests/unit/errorsLog.test.js
   --
   System tests for ErrorsLog (introduced in V13, persists to
   localStorage). Covers: add() shape, level counts, clear,
   listener subscriptions, MAX_ENTRIES cap, persistence round-trip.

   Browser env shims: localStorage + window so the module can mount
   its window.onerror / unhandledrejection handlers without crashing.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory localStorage shim — `setItem` records, `getItem` reads back.
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem:    (k) => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
    _store: store,
  };
}

// Reset module-level state by re-importing with a fresh URL each time.
// Node 22+ supports this via cache-busting query strings.
async function freshErrorsLog() {
  globalThis.localStorage = makeLocalStorage();
  // Minimal window stub for init() — onerror, addEventListener.
  globalThis.window = {
    addEventListener: () => {},
    onerror:          null,
  };
  const url = '../../errorsLog.js?t=' + Date.now() + Math.random();
  const mod = await import(url);
  return mod.ErrorsLog;
}

describe('ErrorsLog.add', () => {
  test('appends an entry with id, ts, level, source, message', async () => {
    const ErrorsLog = await freshErrorsLog();
    const e = ErrorsLog.add({ level: 'error', source: 'test', message: 'boom' });
    assert.ok(e.id > 0);
    assert.ok(typeof e.ts === 'number');
    assert.equal(e.level, 'error');
    assert.equal(e.source, 'test');
    assert.equal(e.message, 'boom');
    assert.equal(e.details, '');
    assert.equal(e.stack, '');
  });

  test('default level is "error" if not specified', async () => {
    const ErrorsLog = await freshErrorsLog();
    const e = ErrorsLog.add({ source: 'x', message: 'y' });
    assert.equal(e.level, 'error');
  });

  test('newest entries are first (unshift order)', async () => {
    const ErrorsLog = await freshErrorsLog();
    ErrorsLog.add({ source: 'a', message: 'first' });
    ErrorsLog.add({ source: 'b', message: 'second' });
    const all = ErrorsLog.getAll();
    assert.equal(all[0].message, 'second');
    assert.equal(all[1].message, 'first');
  });

  test('details object is serialised to JSON string', async () => {
    const ErrorsLog = await freshErrorsLog();
    const e = ErrorsLog.add({ source: 'x', message: 'y', details: { foo: 1, bar: 'z' } });
    const parsed = JSON.parse(e.details);
    assert.deepEqual(parsed, { foo: 1, bar: 'z' });
  });

  test('long message is truncated to 2000 chars', async () => {
    const ErrorsLog = await freshErrorsLog();
    const huge = 'x'.repeat(5000);
    const e = ErrorsLog.add({ source: 'x', message: huge });
    assert.equal(e.message.length, 2000);
  });
});

describe('ErrorsLog.counts', () => {
  test('counts by level + total', async () => {
    const ErrorsLog = await freshErrorsLog();
    ErrorsLog.add({ level: 'error', source: 'x', message: '1' });
    ErrorsLog.add({ level: 'error', source: 'x', message: '2' });
    ErrorsLog.add({ level: 'warn',  source: 'x', message: '3' });
    ErrorsLog.add({ level: 'info',  source: 'x', message: '4' });
    const c = ErrorsLog.counts();
    assert.equal(c.total, 4);
    assert.equal(c.error, 2);
    assert.equal(c.warn,  1);
    assert.equal(c.info,  1);
  });
});

describe('ErrorsLog.clear', () => {
  test('drops everything', async () => {
    const ErrorsLog = await freshErrorsLog();
    ErrorsLog.add({ source: 'x', message: 'a' });
    ErrorsLog.add({ source: 'x', message: 'b' });
    ErrorsLog.clear();
    assert.equal(ErrorsLog.getAll().length, 0);
    assert.equal(ErrorsLog.counts().total, 0);
  });
});

describe('ErrorsLog.onChange', () => {
  test('listener fires on add and clear; unsubscribe stops calls', async () => {
    const ErrorsLog = await freshErrorsLog();
    let calls = 0;
    const unsubscribe = ErrorsLog.onChange(() => { calls++; });
    ErrorsLog.add({ source: 'x', message: '1' });
    ErrorsLog.add({ source: 'x', message: '2' });
    ErrorsLog.clear();
    assert.equal(calls, 3);
    unsubscribe();
    ErrorsLog.add({ source: 'x', message: '3' });
    assert.equal(calls, 3, 'no more calls after unsubscribe');
  });

  test('listener crash does not crash add()', async () => {
    const ErrorsLog = await freshErrorsLog();
    ErrorsLog.onChange(() => { throw new Error('listener boom'); });
    // Must not throw.
    const e = ErrorsLog.add({ source: 'x', message: 'still works' });
    assert.equal(e.message, 'still works');
  });
});

describe('ErrorsLog.persistence', () => {
  test('add() writes to localStorage', async () => {
    const ErrorsLog = await freshErrorsLog();
    ErrorsLog.add({ source: 'x', message: 'persisted' });
    const raw = globalThis.localStorage.getItem('q2_errors_v1');
    assert.ok(raw);
    const arr = JSON.parse(raw);
    assert.equal(arr.length, 1);
    assert.equal(arr[0].message, 'persisted');
  });
});

describe('ErrorsLog cap', () => {
  test('total entries are bounded (MAX_ENTRIES = 500)', async () => {
    const ErrorsLog = await freshErrorsLog();
    for (let i = 0; i < 600; i++) {
      ErrorsLog.add({ source: 'x', message: `msg-${i}` });
    }
    const all = ErrorsLog.getAll();
    assert.equal(all.length, 500);
    // Newest first → newest message should be msg-599; oldest retained → msg-100.
    assert.equal(all[0].message, 'msg-599');
    assert.equal(all[all.length - 1].message, 'msg-100');
  });
});
