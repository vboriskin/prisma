'use strict';
/* ============================================================
   tests/unit/legacy/riskEngine.test.js
   --
   V18 P12 (AUDIT_HOLISTIC O1, phase-1) — pilot pass миграции
   `testRunner.js` → `node:test`.

   Source: testRunner.js groups «RiskEngine — computeFlags» (9 tests) +
   «RiskEngine — computeRiskScore» (6 tests). Всего 15 тестов 1:1.

   Отличие от testRunner.js: импортируем РЕАЛЬНЫЙ `RiskEngine` из
   `riskEngine.js` вместо inline-mirror. Если поведение разойдётся
   с inline-mirror — это сигнал что mirror в testRunner устарел;
   фиксируем как drift в migration-doc и оставляем тесты против
   реального модуля как source of truth.

   testRunner.js НЕ удаляется в этой фазе — миграция параллельная.
   План retire: см. `audit-2026-05-V18/holistic-O1-test-migration.md`.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// state.js touches localStorage during module init via constants/Reactive
// chain — tests/unit/utils.test.js использует тот же приём.
globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
};

const { RiskEngine } = await import('../../../riskEngine.js');
const { state } = await import('../../../state.js');

function makeRow(overrides = {}) {
  return {
    id: 'r_' + Math.random().toString(36).slice(2),
    scopeStatus: '',
    blockingDependency: false,
    hasRelease120: false,
    hasRelease121: false,
    hasRelease122: false,
    hasOvertime: false,
    isUnassigned: true,
    riskFlags: [],
    riskScore: 0,
    isDone: false,
    release120Types: [],
    release121Types: [],
    release122Types: [],
    overtimeTypes: [],
    team: '',
    assignee: '',
    ...overrides,
  };
}

describe('RiskEngine.computeFlags (migrated from testRunner.js)', () => {
  test('no flags on empty row', () => {
    const r = makeRow();
    RiskEngine.computeFlags(r);
    assert.deepEqual(r.riskFlags, []);
  });

  test('BLOCKING_NEAR_RELEASE when blocker in 1.20', () => {
    const r = makeRow({ blockingDependency: true, hasRelease120: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });

  test('BLOCKING_NEAR_RELEASE when blocker in 1.21', () => {
    const r = makeRow({ blockingDependency: true, hasRelease121: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });

  test('no BLOCKING_NEAR_RELEASE for 1.22 blocker (not near)', () => {
    const r = makeRow({ blockingDependency: true, hasRelease122: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(!r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });

  test('IN_SCOPE_WITHOUT_RELEASE when scope=Да and unassigned', () => {
    const r = makeRow({ scopeStatus: 'Да', isUnassigned: true });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('IN_SCOPE_WITHOUT_RELEASE'));
  });

  test('no IN_SCOPE_WITHOUT_RELEASE when scope=Да but has release', () => {
    const r = makeRow({ scopeStatus: 'Да', isUnassigned: false, hasRelease120: true });
    RiskEngine.computeFlags(r);
    assert.ok(!r.riskFlags.includes('IN_SCOPE_WITHOUT_RELEASE'));
  });

  test('CONFIRMATION_IN_RELEASE when needs confirm and in release', () => {
    const r = makeRow({ scopeStatus: 'Требует подтверждения', hasRelease121: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('CONFIRMATION_IN_RELEASE'));
  });

  test('no CONFIRMATION_IN_RELEASE when not in any release', () => {
    // testRunner.js называет это «when unassigned», но реальная семантика:
    // CONFIRMATION_IN_RELEASE требует scope='Требует подтверждения' AND
    // (hasRelease120||121||122||hasOvertime). Без релиза — флага не должно быть.
    const r = makeRow({ scopeStatus: 'Требует подтверждения', isUnassigned: true });
    RiskEngine.computeFlags(r);
    assert.ok(!r.riskFlags.includes('CONFIRMATION_IN_RELEASE'));
  });

  test('multiple flags can coexist', () => {
    const r = makeRow({
      scopeStatus: 'Требует подтверждения',
      blockingDependency: true,
      hasRelease120: true,
      isUnassigned: false,
    });
    RiskEngine.computeFlags(r);
    assert.ok(r.riskFlags.includes('CONFIRMATION_IN_RELEASE'));
    assert.ok(r.riskFlags.includes('BLOCKING_NEAR_RELEASE'));
  });
});

describe('RiskEngine.computeRiskScore (migrated from testRunner.js)', () => {
  test('score 0 for clean row', () => {
    const r = makeRow();
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.equal(r.riskScore, 0);
  });

  test('blocking adds 30 points', () => {
    const r = makeRow({ blockingDependency: true, hasRelease122: true, isUnassigned: false });
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.ok(r.riskScore >= 30, `expected >= 30, got ${r.riskScore}`);
  });

  test('IN_SCOPE_WITHOUT_RELEASE adds 25 points', () => {
    const r = makeRow({ scopeStatus: 'Да', isUnassigned: true });
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.ok(r.riskScore >= 25, `expected >= 25, got ${r.riskScore}`);
  });

  test('score capped at 100', () => {
    const r = makeRow({
      blockingDependency: true,
      scopeStatus: 'Да',
      isUnassigned: true,
      hasRelease120: true,
    });
    RiskEngine.computeFlags(r);
    RiskEngine.computeRiskScore(r);
    assert.ok(r.riskScore <= 100, `expected <= 100, got ${r.riskScore}`);
  });

  test('hasRelease120 adds 15 to score', () => {
    const r = makeRow({ hasRelease120: true, isUnassigned: false, scopeStatus: 'Нет' });
    RiskEngine.computeFlags(r);
    const score = RiskEngine.computeRiskScore(r);
    assert.ok(score >= 15, `expected >= 15, got ${score}`);
  });

  test('computeAll processes every row in state.rows', () => {
    // testRunner.js передавал rows как параметр (RiskEngine.computeAll(rows)),
    // реальный API: RiskEngine.computeAll() читает state.rows. Адаптировано.
    const before = state.rows;
    try {
      const r1 = makeRow({ blockingDependency: true, hasRelease120: true, isUnassigned: false });
      const r2 = makeRow({ scopeStatus: 'Да', isUnassigned: true });
      const r3 = makeRow();
      state.rows = [r1, r2, r3];
      RiskEngine.computeAll();
      assert.ok(state.rows[0].riskScore > 0, 'row[0] (blocker+1.20) should have score > 0');
      assert.ok(state.rows[1].riskScore > 0, 'row[1] (scope=Да unassigned) should have score > 0');
      assert.equal(state.rows[2].riskScore, 0, 'row[2] (clean) should have score 0');
    } finally {
      state.rows = before;
    }
  });
});
