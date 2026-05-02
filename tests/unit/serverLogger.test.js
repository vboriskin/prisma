'use strict';
/* ============================================================
   tests/unit/serverLogger.test.js
   --
   V19 E4 — unit tests для server/logger.js.
   Capture stdout/stderr через override process.stdout.write.
   ============================================================ */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Logger — CommonJS module. Используем createRequire.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const logger = require('../../server/logger.js');

let _stdoutCapture = [];
let _stderrCapture = [];
let _origStdout;
let _origStderr;

beforeEach(() => {
  _stdoutCapture = [];
  _stderrCapture = [];
  _origStdout = process.stdout.write.bind(process.stdout);
  _origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { _stdoutCapture.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { _stderrCapture.push(String(chunk)); return true; };
  // Reset config к defaults для каждого теста.
  logger.configure({ minLevel: 20, format: 'json', tsFormat: 'iso' });   // info
});
afterEach(() => {
  process.stdout.write = _origStdout;
  process.stderr.write = _origStderr;
});

function _parsedStdout() {
  return _stdoutCapture
    .join('')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch (_) { return { _raw: line }; } });
}
function _parsedStderr() {
  return _stderrCapture
    .join('')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch (_) { return { _raw: line }; } });
}

describe('logger — basic levels', () => {
  test('info → stdout', () => {
    logger.info('hello');
    const out = _parsedStdout();
    assert.equal(out.length, 1);
    assert.equal(out[0].level, 'info');
    assert.equal(out[0].msg, 'hello');
    assert.ok(out[0].ts);
  });

  test('error → stderr (отделено от stdout)', () => {
    logger.error('boom');
    assert.equal(_parsedStdout().length, 0);
    const err = _parsedStderr();
    assert.equal(err.length, 1);
    assert.equal(err[0].level, 'error');
  });

  test('warn → stdout (только error в stderr)', () => {
    logger.warn('disk');
    assert.equal(_parsedStdout()[0].level, 'warn');
    assert.equal(_parsedStderr().length, 0);
  });

  test('debug по умолчанию НЕ output (default level=info)', () => {
    logger.debug('details');
    assert.equal(_parsedStdout().length, 0);
  });

  test('LOG_LEVEL=debug → debug emit-ится', () => {
    logger.configure({ minLevel: 10 });   // debug
    logger.debug('details', { x: 1 });
    const out = _parsedStdout();
    assert.equal(out.length, 1);
    assert.equal(out[0].level, 'debug');
    assert.equal(out[0].x, 1);
  });
});

describe('logger — data merge', () => {
  test('info с extra-полями → JSON merged', () => {
    logger.info('jira-fetch ok', { pks: ['A', 'B'], ms: 234 });
    const e = _parsedStdout()[0];
    assert.deepEqual(e.pks, ['A', 'B']);
    assert.equal(e.ms, 234);
  });

  test('null/undefined data → no crash', () => {
    assert.doesNotThrow(() => logger.info('plain'));
    assert.doesNotThrow(() => logger.info('with null', null));
    assert.doesNotThrow(() => logger.info('with undefined', undefined));
    assert.equal(_parsedStdout().length, 3);
  });
});

describe('logger — withReqId / withFields child', () => {
  test('withReqId child добавляет reqId в каждую запись', () => {
    const child = logger.withReqId('r-42');
    child.info('handling /foo');
    child.warn('slow');
    const out = _parsedStdout();
    const err = _parsedStderr();
    assert.equal(out.length, 2);
    assert.equal(out[0].reqId, 'r-42');
    assert.equal(out[1].reqId, 'r-42');
  });

  test('child + per-call data merged', () => {
    const child = logger.withFields({ pid: 1234 });
    child.info('ready', { port: 8080 });
    const e = _parsedStdout()[0];
    assert.equal(e.pid, 1234);
    assert.equal(e.port, 8080);
  });
});

describe('logger — telemetry events (V19 C4 prep)', () => {
  test('event() emits info-level с event-полем', () => {
    logger.event('scanner2.detail_open', { employeeKey: 'u1', latencyMs: 234 });
    const e = _parsedStdout()[0];
    assert.equal(e.level, 'info');
    assert.equal(e.event, 'scanner2.detail_open');
    assert.equal(e.employeeKey, 'u1');
    assert.equal(e.latencyMs, 234);
    assert.match(e.msg, /\[event\]/);
  });
});

describe('logger — timeStart / timeEnd', () => {
  test('timeEnd emit info с latencyMs (sync sleep loop)', () => {
    logger.timeStart('test-op');
    // Busy-wait 20ms — async setTimeout с stdout.write override
    // ведёт себя странно в node:test (beforeEach restore'ит rep raw
    // process.stdout до того как timeEnd emit'нет). Sync version
    // обходит race.
    const start = Date.now();
    while (Date.now() - start < 20) { /* busy wait */ }
    const ms = logger.timeEnd('test-op', { hint: 'foo' });
    assert.ok(ms >= 15, `expected ≥15 ms, got ${ms}`);
    const e = _parsedStdout()[0];
    assert.ok(e, 'expected at least 1 emit, got empty stdout');
    assert.match(e.msg, /test-op/);
    assert.ok(e.latencyMs >= 15);
    assert.equal(e.hint, 'foo');
  });

  test('timeEnd без timeStart → null, no emit', () => {
    const ms = logger.timeEnd('never-started');
    assert.equal(ms, null);
    assert.equal(_parsedStdout().length, 0);
  });
});

describe('logger — pretty format', () => {
  test('format=pretty → human-readable строка', () => {
    logger.configure({ format: 'pretty' });
    logger.info('startup', { port: 8080 });
    const raw = _stdoutCapture.join('');
    assert.match(raw, /\[INFO\] startup/);
    assert.match(raw, /port=8080/);
    // Pretty не должен быть JSON-parseable.
    const lines = raw.trim().split('\n');
    assert.throws(() => JSON.parse(lines[0]));
  });
});
