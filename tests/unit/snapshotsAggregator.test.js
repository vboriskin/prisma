'use strict';
/* tests/unit/snapshotsAggregator.test.js — V22+ Week 1 (I-10). */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function _setupMockLS() {
  const store = {};
  globalThis.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; },
    key(i) { return Object.keys(store)[i] || null; },
    get length() { return Object.keys(store).length; },
  };
  return store;
}

/** Создать snapshot для определённого дня и projectKeys. Имитирует teamScanner2History. */
function _seedHistory(projectKeys, days) {
  // Hash-key calculated same way as teamScanner2History._hash.
  // Здесь упрощённо — caller передаёт ключ напрямую через тест.
  const list = days.map(d => ({
    ts:   d.ts,
    day:  d.day,
    counts: d.counts || { stop: 0, watch: 0, moving: 0, idle: 0 },
    risks: d.risks  || { totalOrphans: 0, totalOutOfSprint: 0, outOfSprintRatio: 0 },
    sprintGoal: d.sprintGoal || { aggregateProgress: 0, aggregatePace: 'no-data', sprintsByPk: {} },
    teamSize: d.teamSize || 0,
    personGroups: d.personGroups || {},
  }));
  return list;
}

describe('snapshotsAggregator', () => {
  beforeEach(() => _setupMockLS());

  test('coverageForPeriod: пустой history → coverage=0', async () => {
    _setupMockLS();
    const { coverageForPeriod } = await import('../../chat/snapshotsAggregator.js');
    const period = { from: new Date(2026, 4, 1), to: new Date(2026, 4, 15), label: 'first half' };
    const c = coverageForPeriod(period, ['PAY']);
    assert.equal(c.snapshotDays, 0);
    assert.equal(c.coverage, 0);
    assert.ok(c.periodDays > 0);
  });

  test('aggregatePersonFromSnapshots: пустая история → пустой результат', async () => {
    _setupMockLS();
    const { aggregatePersonFromSnapshots } = await import('../../chat/snapshotsAggregator.js');
    const r = aggregatePersonFromSnapshots('ivanov-key',
      { from: new Date(2026, 4, 1), to: new Date(2026, 4, 30) },
      ['PAY']);
    assert.equal(r.fromSnapshots, false);
    assert.equal(r.days, 0);
    assert.equal(r.groupDistribution.stop, 0);
  });

  test('aggregateTeamFromSnapshots: пустой history → empty', async () => {
    _setupMockLS();
    const { aggregateTeamFromSnapshots } = await import('../../chat/snapshotsAggregator.js');
    const r = aggregateTeamFromSnapshots(
      { from: new Date(2026, 4, 1), to: new Date(2026, 4, 30) },
      ['PAY']);
    assert.equal(r.fromSnapshots, false);
    assert.equal(r.days, 0);
  });

  // Note: для полноценного integration test нужно прокинуть данные через
  // saveDailySnapshot. Здесь упрощённо — проверяем структуру empty.
  // Detail test с реальной историей можно добавить позже когда mock LS
  // будет integration-tested.
  test('структура empty aggregation корректна', async () => {
    _setupMockLS();
    const { aggregatePersonFromSnapshots, aggregateTeamFromSnapshots } =
      await import('../../chat/snapshotsAggregator.js');
    const period = { from: new Date(2026, 4, 1), to: new Date(2026, 4, 15), label: 'mid-May' };

    const p = aggregatePersonFromSnapshots('foo', period, ['PAY']);
    assert.ok('groupDistribution' in p);
    assert.ok('trend' in p);
    assert.ok(Array.isArray(p.trend));

    const t = aggregateTeamFromSnapshots(period, ['PAY']);
    assert.ok(Array.isArray(t.countsByDay));
    assert.ok(Array.isArray(t.risksByDay));
    assert.ok(Array.isArray(t.sprintProgressByDay));
  });
});
