'use strict';
/* ============================================================
   tests/unit/telemetry.test.js — V21 BF (audit-08 critical-zero-coverage)
   --
   Покрывает frontend telemetry helper (emit / time / flush, opt-out,
   batching, name validation).
   Module-level _buffer держит state — каждый test = fresh import.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem:    (k) => (store.has(k) ? store.get(k) : null),
    setItem:    (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear:      () => store.clear(),
  };
}

async function freshTelemetry({ disabled = false, beaconSpy = null, fetchSpy = null } = {}) {
  globalThis.localStorage = makeLocalStorage();
  if (disabled) globalThis.localStorage.setItem('q2_telemetry_disabled', '1');
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // Node 22 has navigator getter — нельзя assign'ить напрямую.
  if (beaconSpy) {
    Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: beaconSpy }, configurable: true, writable: true });
  } else {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  }
  if (fetchSpy) globalThis.fetch = fetchSpy;
  else delete globalThis.fetch;
  globalThis.Blob = function (parts, opts) { this.parts = parts; this.opts = opts; };
  const url = '../../integrations/telemetry.js?t=' + Date.now() + Math.random();
  return await import(url);
}

describe('telemetry.emit — name validation', () => {
  test('valid name proceeds (буфер заполняется)', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push({ ep, blob }); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    tm.emit('scanner2.detail_open', { x: 1 });
    tm.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].ep, '/api/telemetry');
  });

  test('invalid name (no dot) — silently rejected', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push({ ep, blob }); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    tm.emit('invalidname', { x: 1 });
    tm.flush();
    assert.equal(sent.length, 0);
  });

  test('invalid name (uppercase) — rejected', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push({ ep, blob }); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    tm.emit('Scanner.open', { x: 1 });
    tm.flush();
    assert.equal(sent.length, 0);
  });

  test('emit без name (empty string) — rejected', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push({ ep, blob }); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    tm.emit('', {});
    tm.emit(null, {});
    tm.emit(undefined, {});
    tm.flush();
    assert.equal(sent.length, 0);
  });
});

describe('telemetry — opt-out', () => {
  test('localStorage q2_telemetry_disabled=1 → emit is no-op', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push({ ep, blob }); return true; };
    const tm = await freshTelemetry({ disabled: true, beaconSpy: beacon });
    tm.emit('scanner2.x', {});
    tm.flush();
    assert.equal(sent.length, 0);
  });
});

describe('telemetry — batching', () => {
  test('event кладётся в buffer, flush отправляет', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push(blob); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    tm.emit('a.b', { i: 1 });
    tm.emit('a.b', { i: 2 });
    tm.emit('a.b', { i: 3 });
    tm.flush();
    assert.equal(sent.length, 1);
    const parts = sent[0].parts.join('');
    const parsed = JSON.parse(parts);
    assert.equal(parsed.events.length, 3);
  });

  test('30+ events → instant flush (превышен MAX_BATCH)', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push(blob); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    for (let i = 0; i < 35; i++) tm.emit('a.b', { i });
    // 30й emit triggers flush. Остальные 5 — в буфере.
    assert.ok(sent.length >= 1);
  });
});

describe('telemetry.time — measure latency', () => {
  test('sync function — emit ok=true with latencyMs', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push(blob); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    const result = tm.time('test.op', () => 'hello');
    tm.flush();
    assert.equal(result, 'hello');
    const parts = sent[0].parts.join('');
    const parsed = JSON.parse(parts);
    assert.equal(parsed.events[0].event, 'test.op');
    assert.equal(parsed.events[0].data.ok, true);
    assert.ok(typeof parsed.events[0].data.latencyMs === 'number');
  });

  test('sync function throw — emit ok=false + rethrow', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push(blob); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    assert.throws(() => tm.time('test.op', () => { throw new Error('boom'); }), /boom/);
    tm.flush();
    const parts = sent[0].parts.join('');
    const parsed = JSON.parse(parts);
    assert.equal(parsed.events[0].data.ok, false);
    assert.match(parsed.events[0].data.errMsg, /boom/);
  });

  test('async function — awaits + emit с latencyMs', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push(blob); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    const result = await tm.time('test.op', async () => {
      await new Promise(r => setTimeout(r, 5));
      return 42;
    });
    tm.flush();
    assert.equal(result, 42);
    const parts = sent[0].parts.join('');
    const parsed = JSON.parse(parts);
    assert.equal(parsed.events[0].data.ok, true);
    // V21 — Date.now() имеет 1ms resolution, 5ms setTimeout может отдать 4-5ms.
    // Просто проверяем что latencyMs ≥ 0 (поле существует и валидно).
    assert.ok(typeof parsed.events[0].data.latencyMs === 'number');
    assert.ok(parsed.events[0].data.latencyMs >= 0);
  });

  test('async function reject — emit ok=false + rethrow', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push(blob); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    await assert.rejects(
      () => tm.time('test.op', async () => { throw new Error('async boom'); }),
      /async boom/,
    );
    tm.flush();
    const parts = sent[0].parts.join('');
    const parsed = JSON.parse(parts);
    assert.equal(parsed.events[0].data.ok, false);
  });

  test('time() прокидывает extra поля в emit', async () => {
    const sent = [];
    const beacon = (ep, blob) => { sent.push(blob); return true; };
    const tm = await freshTelemetry({ beaconSpy: beacon });
    tm.time('test.op', () => 1, { pk: 'PROJ' });
    tm.flush();
    const parts = sent[0].parts.join('');
    const parsed = JSON.parse(parts);
    assert.equal(parsed.events[0].data.pk, 'PROJ');
  });
});

describe('telemetry — fetch fallback', () => {
  test('если sendBeacon отсутствует — используется fetch с keepalive', async () => {
    const fetchCalls = [];
    const fetchSpy = (url, opts) => {
      fetchCalls.push({ url, opts });
      return Promise.resolve({ ok: true });
    };
    const tm = await freshTelemetry({ fetchSpy });
    tm.emit('a.b', {});
    tm.flush();
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].opts.keepalive, true);
  });
});
