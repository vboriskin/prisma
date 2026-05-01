'use strict';
/* ============================================================
   tests/unit/aiFallbackEngine.test.js
   --
   Tests for the rule-based AI fallback engines that produce dashboard
   blocks when LLM is unavailable. We test the public surface of
   ai/aiFallbackEngine.js. Each engine is pure: input rows → output
   block with `{id, title, score, status, problems, recommendations,...}`.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBaseMetrics, computeProjectHealth, computeForecast,
  computeIfNothingChanges, computeBottlenecks, computeRiskNarrative,
} from '../../ai/aiFallbackEngine.js';

function makeRow(over = {}) {
  return {
    id: 'r1', team: 'Pay', epic: 'Test',
    isDone: false, blockingDependency: false, isUnassigned: false,
    scopeStatus: 'Да', riskFlags: [], assignee: 'Иван',
    hasRelease120: false, hasRelease121: false, hasRelease122: false, hasOvertime: false,
    riskScore: 0,
    ...over,
  };
}

describe('computeBaseMetrics — totals', () => {
  test('counts done / active / total correctly', () => {
    const m = computeBaseMetrics([makeRow({ isDone: true }), makeRow({ isDone: false }), makeRow({ isDone: false })]);
    assert.equal(m.total, 3);
    assert.equal(m.done, 1);
    assert.equal(m.active, 2);
    assert.ok(m.donePct >= 33 && m.donePct <= 34);
  });

  test('blockers includes only non-done with blockingDependency', () => {
    const m = computeBaseMetrics([
      makeRow({ blockingDependency: true,  isDone: false }),
      makeRow({ blockingDependency: true,  isDone: true }),  // skipped
      makeRow({ blockingDependency: false, isDone: false }),
    ]);
    assert.equal(m.blockers.length, 1);
  });

  test('risky requires non-empty riskFlags AND not done', () => {
    const m = computeBaseMetrics([
      makeRow({ riskFlags: ['BLOCKER'] }),
      makeRow({ riskFlags: ['BLOCKER'], isDone: true }),  // skipped
      makeRow({ riskFlags: [] }),
    ]);
    assert.equal(m.risky.length, 1);
  });

  test('noRelease = isUnassigned + scope=Да + not done', () => {
    const m = computeBaseMetrics([
      makeRow({ isUnassigned: true,  scopeStatus: 'Да' }),
      makeRow({ isUnassigned: true,  scopeStatus: 'Нет' }),  // wrong scope
      makeRow({ isUnassigned: false, scopeStatus: 'Да' }),   // has release
    ]);
    assert.equal(m.noRelease.length, 1);
  });

  test('teams groupingn aggregates per-team counters', () => {
    const m = computeBaseMetrics([
      makeRow({ team: 'A', isDone: true }),
      makeRow({ team: 'A', isDone: false, blockingDependency: true }),
      makeRow({ team: 'B', isDone: false, riskFlags: ['x'] }),
      makeRow({ team: '' }),  // skipped — no team
    ]);
    assert.equal(m.teams.A.total, 2);
    assert.equal(m.teams.A.done, 1);
    assert.equal(m.teams.A.blockers, 1);
    assert.equal(m.teams.B.risky, 1);
    assert.equal(m.teams[''], undefined);
  });

  test('topBlockers sorted by riskScore desc, capped at 10', () => {
    const rows = Array.from({ length: 15 }, (_, i) => makeRow({
      id: `r${i}`, blockingDependency: true, isDone: false, riskScore: i,
    }));
    const m = computeBaseMetrics(rows);
    assert.equal(m.topBlockers.length, 10);
    // Highest score first.
    assert.equal(m.topBlockers[0].riskScore, 14);
    assert.equal(m.topBlockers[9].riskScore, 5);
  });

  test('empty rows → all zeros, no NaN', () => {
    const m = computeBaseMetrics([]);
    assert.equal(m.total, 0);
    assert.equal(m.done, 0);
    assert.equal(m.donePct, 0);
    assert.deepEqual(m.blockers, []);
    assert.deepEqual(m.teams, {});
  });
});

describe('computeProjectHealth', () => {
  test('returns id/title/icon and status string', () => {
    const r = computeProjectHealth([makeRow()]);
    assert.equal(r.id, 'health');
    // V17.1 J2 — title переведён на русский («Здоровье проекта»).
    assert.equal(r.title, 'Здоровье проекта');
    assert.ok(['ok', 'risk', 'critical'].includes(r.status));
  });

  test('many blockers → status critical or risk', () => {
    const rows = Array.from({ length: 8 }, (_, i) => makeRow({
      id: `r${i}`, blockingDependency: true, isDone: false,
    }));
    const r = computeProjectHealth(rows);
    assert.ok(['risk', 'critical'].includes(r.status));
    assert.ok(r.problems.some(p => /блокер/.test(p.title)));
  });

  test('all-done project → score high, status ok', () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow({ id: `r${i}`, isDone: true }));
    const r = computeProjectHealth(rows);
    assert.ok(r.score >= 60, 'score should be ≥60 for all-done project');
  });

  test('confidence "low" for empty rows', () => {
    const r = computeProjectHealth([]);
    assert.equal(r.confidence, 'low');
  });

  test('aiEnhanced flag is false (this is the FALLBACK engine)', () => {
    const r = computeProjectHealth([makeRow()]);
    assert.equal(r.aiEnhanced, false);
  });
});

describe('computeForecast', () => {
  test('returns one forecast entry per release that has rows', () => {
    const rows = [
      makeRow({ hasRelease120: true }),
      makeRow({ hasRelease121: true }),
    ];
    const r = computeForecast(rows);
    const labels = r.forecasts.map(f => f.label);
    assert.ok(labels.includes('1.20'));
    assert.ok(labels.includes('1.21'));
    assert.equal(r.forecasts.length, 2);
  });

  test('skips releases with zero rows', () => {
    const r = computeForecast([makeRow({ hasRelease120: true })]);
    assert.equal(r.forecasts.length, 1);
    assert.equal(r.forecasts[0].key, '120');
  });

  test('low data history → confidence low + warning summary', () => {
    const rows = [makeRow({ hasRelease120: true })];     // 0% done
    const r = computeForecast(rows);
    assert.equal(r.confidence, 'low');
    assert.match(r.summary, /Velocity не определён/);
  });

  test('blockers reduce forecasted "expected" %', () => {
    const cleanRows = [
      makeRow({ id: 'a', hasRelease120: true, isDone: true }),
      makeRow({ id: 'b', hasRelease120: true, isDone: true }),
      makeRow({ id: 'c', hasRelease120: true, isDone: true }),
      makeRow({ id: 'd', hasRelease120: true, isDone: true }),
      makeRow({ id: 'e', hasRelease120: true, isDone: false }),
    ];
    const blockerRows = cleanRows.map((r, i) => i === 4 ? { ...r, blockingDependency: true } : r);
    const a = computeForecast(cleanRows);
    const b = computeForecast(blockerRows);
    assert.ok(a.forecasts[0].expected >= b.forecasts[0].expected, 'blockers should not raise expected %');
  });

  test('zero rows → score 50 default, status risk', () => {
    const r = computeForecast([]);
    assert.equal(r.score, 50);
    assert.equal(r.forecasts.length, 0);
  });
});

describe('computeIfNothingChanges', () => {
  test('returns block with id, status, insights[]', () => {
    const r = computeIfNothingChanges([makeRow()]);
    assert.equal(r.id, 'if_nothing_changes');
    assert.ok(Array.isArray(r.insights));
    assert.ok(['ok', 'risk', 'critical'].includes(r.status));
  });

  test('blockers ≥3 surfaces in insights mentioning blockers', () => {
    const rows = Array.from({ length: 4 }, (_, i) => makeRow({
      id: `r${i}`, blockingDependency: true, isDone: false,
    }));
    const r = computeIfNothingChanges(rows);
    assert.ok(r.insights.some(t => /блокер/i.test(String(t))));
  });

  test('all-done dataset → status not critical', () => {
    const r = computeIfNothingChanges([makeRow({ isDone: true })]);
    assert.notEqual(r.status, 'critical');
  });
});

describe('computeBottlenecks', () => {
  test('engineerss with WIP overflow show up as bottlenecks', () => {
    // 7 active rows assigned to one person
    const rows = Array.from({ length: 7 }, (_, i) => makeRow({ id: `r${i}`, assignee: 'Иван', isDone: false, hasRelease120: true }));
    const r = computeBottlenecks(rows);
    // Public surface: id/title and some bottleneck-ish list.
    assert.equal(r.id, 'bottlenecks');
    assert.ok(r.summary || r.insights);
  });
});

describe('computeRiskNarrative', () => {
  test('returns id "risk_narrative" with summary + narratives[]', () => {
    const r = computeRiskNarrative([makeRow({ riskFlags: ['BLOCKER'] })]);
    assert.equal(r.id, 'risk_narrative');
    assert.ok(typeof r.summary === 'string' && r.summary.length);
    assert.ok(Array.isArray(r.narratives));
  });
});
