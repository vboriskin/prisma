'use strict';
/* ============================================================
   tests/unit/reactiveStore.test.js — V21 BF (audit-08 critical-zero-coverage)
   --
   Покрывает Reactive proxy layer: wrap, silent, subscribe, flushNow,
   notifyManual. Module-level state (debounce timer, subscribers list)
   шарится между тестами, поэтому каждый test получает fresh import.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

async function freshReactive() {
  const url = '../../reactiveStore.js?t=' + Date.now() + Math.random();
  const mod = await import(url);
  return mod.Reactive;
}

describe('Reactive.wrap — Proxy semantics', () => {
  test('returns proxy that quacks like original object', async () => {
    const R = await freshReactive();
    const obj = { a: 1, b: { c: 2 } };
    const p = R.wrap(obj);
    assert.equal(p.a, 1);
    assert.equal(p.b.c, 2);
  });

  test('wrap is idempotent — re-wrapping returns same proxy', async () => {
    const R = await freshReactive();
    const obj = { a: 1 };
    const p1 = R.wrap(obj);
    const p2 = R.wrap(obj);
    assert.strictEqual(p1, p2);
  });

  test('isReactive returns true for wrapped, false for raw', async () => {
    const R = await freshReactive();
    const obj = { a: 1 };
    const p = R.wrap(obj);
    assert.equal(R.isReactive(p), true);
    assert.equal(R.isReactive(obj), false);
    assert.equal(R.isReactive(null), false);
    assert.equal(R.isReactive(42), false);
  });

  test('nested objects are auto-proxied', async () => {
    const R = await freshReactive();
    const obj = { nested: { x: 1 } };
    const p = R.wrap(obj);
    assert.equal(R.isReactive(p.nested), true);
  });

  test('arrays preserve identity via WeakMap cache', async () => {
    const R = await freshReactive();
    const obj = { rows: [{ id: 1 }, { id: 2 }] };
    const p = R.wrap(obj);
    const r1a = p.rows[0];
    const r1b = p.rows[0];
    assert.strictEqual(r1a, r1b, 'same array index returns same proxy');
  });
});

describe('Reactive.silent — re-entrant guard', () => {
  test('mutations inside silent do not trigger subscriber', async () => {
    const R = await freshReactive();
    let fired = 0;
    R.subscribe(() => fired++);
    const p = R.wrap({ a: 1 });
    R.silent(() => { p.a = 2; p.a = 3; });
    R.flushNow();
    assert.equal(fired, 0, 'silent() must skip notifications');
  });

  test('mutations outside silent DO trigger subscriber on flushNow', async () => {
    const R = await freshReactive();
    let fired = 0;
    R.subscribe(() => fired++);
    const p = R.wrap({ a: 1 });
    p.a = 99;
    R.flushNow();
    assert.equal(fired, 1);
  });

  test('silent() can be re-entrant (nested silent blocks)', async () => {
    const R = await freshReactive();
    let fired = 0;
    R.subscribe(() => fired++);
    const p = R.wrap({ a: 1 });
    R.silent(() => {
      R.silent(() => {
        p.a = 2;
      });
      // After inner silent returns, depth = 1, still silent.
      p.a = 3;
    });
    // After outer silent returns, depth = 0.
    R.flushNow();
    assert.equal(fired, 0, 'all mutations were inside silent');
  });

  test('silent returns the function result', async () => {
    const R = await freshReactive();
    const v = R.silent(() => 42);
    assert.equal(v, 42);
  });

  test('silent restores depth even on throw', async () => {
    const R = await freshReactive();
    let fired = 0;
    R.subscribe(() => fired++);
    const p = R.wrap({ a: 1 });
    assert.throws(() => R.silent(() => { throw new Error('boom'); }), /boom/);
    // After throw, silentDepth must be back to 0 — the next mutation triggers.
    p.a = 5;
    R.flushNow();
    assert.equal(fired, 1, 'depth restored after throw');
  });

  test('async silent() awaits Promise before decrementing depth', async () => {
    const R = await freshReactive();
    let fired = 0;
    R.subscribe(() => fired++);
    const p = R.wrap({ a: 1 });
    await R.silent(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      p.a = 9; // mutation inside async still under silent guard
    });
    R.flushNow();
    assert.equal(fired, 0, 'async mutation must remain silent');
  });
});

describe('Reactive.subscribe / unsubscribe', () => {
  test('subscribe returns unsubscribe function', async () => {
    const R = await freshReactive();
    let fired = 0;
    const unsub = R.subscribe(() => fired++);
    const p = R.wrap({ a: 1 });
    p.a = 2;
    R.flushNow();
    assert.equal(fired, 1);
    unsub();
    p.a = 3;
    R.flushNow();
    assert.equal(fired, 1, 'after unsub callback не вызывается');
  });

  test('multiple subscribers all fire', async () => {
    const R = await freshReactive();
    let a = 0, b = 0;
    R.subscribe(() => a++);
    R.subscribe(() => b++);
    const p = R.wrap({ x: 0 });
    p.x = 1;
    R.flushNow();
    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  test('subscriber that throws не ломает остальных', async () => {
    const R = await freshReactive();
    let b = 0;
    R.subscribe(() => { throw new Error('subscriber failure'); });
    R.subscribe(() => b++);
    const p = R.wrap({ x: 0 });
    p.x = 1;
    R.flushNow();
    assert.equal(b, 1, 'second subscriber fires despite first throwing');
  });
});

describe('Reactive.flushNow + notifyManual', () => {
  test('flushNow без dirty mutations — no-op', async () => {
    const R = await freshReactive();
    let fired = 0;
    R.subscribe(() => fired++);
    R.flushNow();
    R.flushNow();
    assert.equal(fired, 0);
  });

  test('notifyManual триггерит flush для Set/Map ops которые Proxy не видит', async () => {
    const R = await freshReactive();
    let fired = 0;
    R.subscribe(() => fired++);
    R.notifyManual();
    R.flushNow();
    assert.equal(fired, 1);
  });
});
