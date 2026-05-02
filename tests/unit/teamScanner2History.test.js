'use strict';
/* ============================================================
   tests/unit/teamScanner2History.test.js
   --
   V19 C2 — multi-day snapshot retention для тренд-визуализации.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim
const _store = new Map();
globalThis.localStorage = {
  getItem(k)   { return _store.has(k) ? _store.get(k) : null; },
  setItem(k,v) { _store.set(k, String(v)); },
  removeItem(k){ _store.delete(k); },
  clear()      { _store.clear(); },
};

const {
  saveDailySnapshot, loadHistory, extractTrendSeries,
  pruneHistory, diagnostics,
} = await import('../../integrations/teamScanner2History.js');

function makeModel(over = {}) {
  return {
    participants: [],
    scannerV2: {
      sprintGoal: { aggregateProgress: 0, aggregatePace: 'no-data' },
      risks: { totalOrphans: 0, totalOutOfSprint: 0, outOfSprintRatio: 0 },
    },
    ...over,
  };
}

describe('saveDailySnapshot — basic dedup', () => {
  beforeEach(() => _store.clear());

  test('первый save → 1 entry', () => {
    saveDailySnapshot(makeModel(), ['PRJ']);
    const h = loadHistory(['PRJ']);
    assert.equal(h.length, 1);
    assert.ok(h[0].day);
    assert.ok(h[0].ts);
  });

  test('второй save в тот же день → dedupe (last-wins)', () => {
    saveDailySnapshot(makeModel({ participants: [{ key: 'a' }] }), ['PRJ']);
    saveDailySnapshot(makeModel({ participants: [{ key: 'a' }, { key: 'b' }] }), ['PRJ']);
    const h = loadHistory(['PRJ']);
    assert.equal(h.length, 1, 'один snapshot per day');
    assert.equal(h[0].teamSize, 2, 'last-wins (2 participants)');
  });

  test('разные projectKeys → разные history-keys', () => {
    saveDailySnapshot(makeModel(), ['A']);
    saveDailySnapshot(makeModel(), ['B']);
    assert.equal(loadHistory(['A']).length, 1);
    assert.equal(loadHistory(['B']).length, 1);
    assert.equal(loadHistory(['C']).length, 0);
  });

  test('null model → no save (no error)', () => {
    assert.doesNotThrow(() => saveDailySnapshot(null, ['PRJ']));
    assert.equal(loadHistory(['PRJ']).length, 0);
  });
});

describe('snapshot shape', () => {
  beforeEach(() => _store.clear());

  test('counts классификации сохраняются', () => {
    const model = makeModel({
      participants: [
        // stop: stale + 0 today
        { stale: [{ key: 'X-1' }], timelineToday: [], timelineYesterday: [] },
        // moving: today > 0
        { timelineToday: [{ at: '2026-05-02T10:00:00Z' }], badges: { commits48h: 1 } },
        // idle: ничего
        {},
      ],
    });
    saveDailySnapshot(model, ['PRJ']);
    const snap = loadHistory(['PRJ'])[0];
    assert.equal(snap.counts.stop, 1);
    assert.equal(snap.counts.moving, 1);
    assert.equal(snap.counts.idle, 1);
  });

  test('risks + sprintGoal сохраняются', () => {
    const model = makeModel({
      scannerV2: {
        risks: { totalOrphans: 3, totalOutOfSprint: 7, outOfSprintRatio: 0.21 },
        sprintGoal: { aggregateProgress: 65, aggregatePace: 'on-track' },
      },
    });
    saveDailySnapshot(model, ['PRJ']);
    const snap = loadHistory(['PRJ'])[0];
    assert.equal(snap.risks.totalOrphans, 3);
    assert.equal(snap.risks.totalOutOfSprint, 7);
    assert.equal(snap.sprintGoal.aggregateProgress, 65);
    assert.equal(snap.sprintGoal.aggregatePace, 'on-track');
  });
});

describe('loadHistory — daysBack filter', () => {
  beforeEach(() => _store.clear());

  test('daysBack=1 фильтрует старые записи', () => {
    // Вручную пишем 2 snapshot'а: один сегодня, один 2 дня назад.
    const oldSnap = { ts: Date.now() - 2 * 86400000, day: '2026-04-30', counts: {}, risks: {}, sprintGoal: {} };
    const newSnap = { ts: Date.now(),                day: '2026-05-02', counts: {}, risks: {}, sprintGoal: {} };
    localStorage.setItem('q2_scanner2_history:PRJ', JSON.stringify([oldSnap, newSnap]));
    assert.equal(loadHistory(['PRJ'], 1).length, 1, 'daysBack=1 — только последний');
    assert.equal(loadHistory(['PRJ'], 7).length, 2, 'daysBack=7 — оба');
    assert.equal(loadHistory(['PRJ'], 0).length, 2, 'daysBack=0 → all (special)');
  });
});

describe('extractTrendSeries', () => {
  test('счёт по dotted path', () => {
    const history = [
      { counts: { stop: 1 } },
      { counts: { stop: 3 } },
      { counts: { stop: 0 } },
    ];
    assert.deepEqual(extractTrendSeries(history, 'counts.stop'), [1, 3, 0]);
  });

  test('missing path → 0', () => {
    const history = [{ counts: {} }, { counts: { stop: 5 } }];
    assert.deepEqual(extractTrendSeries(history, 'counts.stop'), [0, 5]);
  });

  test('пустая history → []', () => {
    assert.deepEqual(extractTrendSeries([], 'counts.stop'), []);
  });
});

describe('MAX_ENTRIES pruning (=30)', () => {
  beforeEach(() => _store.clear());

  test('saves > 30 → keep last 30', () => {
    const arr = [];
    for (let i = 0; i < 35; i++) {
      arr.push({
        ts: Date.now() - (35 - i) * 86400000,
        day: `2026-04-${String(i + 1).padStart(2, '0')}`,
        counts: { stop: i }, risks: {}, sprintGoal: {},
      });
    }
    localStorage.setItem('q2_scanner2_history:PRJ', JSON.stringify(arr));
    pruneHistory(['PRJ'], 30);
    const h = loadHistory(['PRJ'], 999);
    assert.equal(h.length, 30);
    assert.equal(h[0].counts.stop, 5, 'first 5 dropped');
    assert.equal(h[h.length - 1].counts.stop, 34, 'last preserved');
  });
});

describe('diagnostics', () => {
  beforeEach(() => _store.clear());

  test('пустой → entries=0', () => {
    assert.deepEqual(diagnostics(['PRJ']), { entries: 0 });
  });

  test('заполненный → counts визуализирует', () => {
    saveDailySnapshot(makeModel({
      participants: [{ stale: [{ key: 'X' }], timelineToday: [], timelineYesterday: [] }],
    }), ['PRJ']);
    const d = diagnostics(['PRJ']);
    assert.equal(d.entries, 1);
    assert.ok(d.earliest);
    assert.ok(d.latest);
    assert.ok(d.storageBytes > 0);
    assert.equal(d.latestCounts.stop, 1);
  });
});
