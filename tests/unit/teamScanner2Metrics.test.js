'use strict';
/* ============================================================
   tests/unit/teamScanner2Metrics.test.js

   V20 S6.2 + S6.3 — contract-tests для:
   · computeRiskSummary (real orphans + OOS ratio by unique keys)
   · computeSprintGoal (pace fallback)
   · computeCodeReviewVelocity
   · computePrThroughput
   · computeCrossTeamDependencies
   · computeSprintGoalSlope
   · computeZScore + computeEmaWoW
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const {
  computeRiskSummary, computeSprintGoal,
  computeCodeReviewVelocity, computePrThroughput,
  computeCrossTeamDependencies, computeSprintGoalSlope,
  computeZScore, computeEmaWoW,
} = await import('../../integrations/teamScanner2Enrichment.js');

/* ── computeRiskSummary — Real Orphans + unique-keys ratio ── */
describe('computeRiskSummary — V20 S6.2', () => {
  test('Real Orphans фильтрует backlog без активности', () => {
    const oldDate = new Date(Date.now() - 90 * 86400000).toISOString();
    const freshDate = new Date(Date.now() - 5 * 86400000).toISOString();
    const model = {
      participants: [],
      spaces: { PRJ: { sprintIssues: [{ key: 'PRJ-1' }] } },
      unassignedByPk: {
        PRJ: [
          // Stale backlog — низкий приоритет, обновлено давно. НЕ real orphan.
          { key: 'PRJ-A', updated: oldDate, priority: 'Low' },
          // High-priority + fresh → real orphan.
          { key: 'PRJ-B', updated: freshDate, priority: 'Critical' },
          // В active sprint — real orphan (in-sprint без assignee).
          { key: 'PRJ-1', updated: oldDate, priority: 'Low' },
        ],
      },
    };
    const r = computeRiskSummary(model);
    assert.equal(r.totalOrphans, 3);
    assert.equal(r.totalRealOrphans, 2);     // только PRJ-B и PRJ-1
  });

  test('outOfSprintRatio считает по unique issue.key, не events', () => {
    const model = {
      spaces: { PRJ: { sprintIssues: [{ key: 'PRJ-IN' }] } },
      unassignedByPk: {},
      participants: [{
        key: 'u-1',
        timelineToday: [
          { issue: { key: 'PRJ-OOS-1' } }, { issue: { key: 'PRJ-OOS-1' } },
          { issue: { key: 'PRJ-OOS-1' } }, { issue: { key: 'PRJ-OOS-1' } },
          // 4 events, но 1 unique OOS key.
        ],
        timelineYesterday: [{ issue: { key: 'PRJ-IN' } }],
      }],
    };
    const r = computeRiskSummary(model);
    // Ratio = unique OOS / unique total = 1/2 = 0.5
    // Раньше было event-based: 4/5 = 0.8.
    assert.equal(r.outOfSprintRatio, 0.5);
    assert.equal(r.outOfSprintRatioBasis, 'unique-keys');
  });

  test('null model → defaults', () => {
    const r = computeRiskSummary(null);
    assert.equal(r.totalOrphans, 0);
    assert.equal(r.totalRealOrphans, 0);
  });
});

/* ── computeSprintGoal — pace fallback ──────────────────── */
describe('computeSprintGoal — V20 S6.2.1 pace fallback', () => {
  test('pace fallback по progress когда все спринты no-data', () => {
    const model = {
      spaces: {
        PK1: { activeSprintName: 'S1', activeSprintInfo: {}, sprintIssues: [
          { status: 'Open', statusCat: 'new' },           // 1 not done
          { status: 'In Progress', statusCat: 'inderway' }, // 1 not done
          { status: 'Done', statusCat: 'done' },          // 1 done
        ] },
      },
    };
    const r = computeSprintGoal(model);
    // 1/3 = 33.3% → меньше 75, больше 25 → on-track (через progress fallback).
    assert.equal(r.aggregateProgress, 33.3);
    assert.equal(r.aggregatePace, 'on-track');
    assert.equal(r.aggregatePaceSource, 'progress-fallback');
  });

  test('pace fallback: behind при progress < 25', () => {
    const model = {
      spaces: { PK1: { activeSprintName: 'S1', activeSprintInfo: {}, sprintIssues: [
        ...Array(8).fill({ status: 'Open', statusCat: 'new' }),
        ...Array(2).fill({ status: 'Done', statusCat: 'done' }),
      ] } },
    };
    const r = computeSprintGoal(model);
    assert.equal(r.aggregateProgress, 20);
    assert.equal(r.aggregatePace, 'behind');
    assert.equal(r.aggregatePaceSource, 'progress-fallback');
  });

  test('pace остаётся date-based если хоть один sprint имеет валидные даты', () => {
    const now = Date.now();
    const start = new Date(now - 5 * 86400000).toISOString();
    const end   = new Date(now + 5 * 86400000).toISOString();
    const model = {
      spaces: {
        PK1: { activeSprintName: 'S1', activeSprintInfo: { startDate: start, endDate: end },
               sprintIssues: [{ status: 'Done', statusCat: 'done' }, { status: 'Open', statusCat: 'new' }] },
      },
    };
    const r = computeSprintGoal(model);
    assert.equal(r.aggregatePaceSource, 'date-based');
  });

  test('sprintMeanProgress считается отдельно от aggregateProgress', () => {
    const model = {
      spaces: {
        BIG: { activeSprintName: 'S1', activeSprintInfo: {}, sprintIssues:
          Array(10).fill({ status: 'Open', statusCat: 'new' }) },     // 0% done
        SMALL: { activeSprintName: 'S2', activeSprintInfo: {}, sprintIssues:
          Array(2).fill({ status: 'Done', statusCat: 'done' }) },     // 100% done
      },
    };
    const r = computeSprintGoal(model);
    // aggregate (issue-weighted): 2/12 = 16.7%
    // mean (sprint-weighted): (0 + 100) / 2 = 50%
    assert.equal(r.aggregateProgress, 16.7);
    assert.equal(r.sprintMeanProgress, 50);
  });
});

/* ── computeCodeReviewVelocity ──────────────────────────── */
describe('computeCodeReviewVelocity — V20 S6.3.1', () => {
  test('median time-to-first-review per reviewer', () => {
    const t0 = Date.now() - 3 * 86400000;
    const model = {
      participants: [
        // u-1 — автор PR #100, открыл его 3 дня назад.
        {
          key: 'u-1',
          bbItems: [{ kind: 'pr', prId: 100, at: new Date(t0).toISOString(), status: 'OPEN' }],
        },
        // u-2 — ревьюер, ответил через 2 часа.
        {
          key: 'u-2',
          bbItems: [{ kind: 'review', prId: 100, at: new Date(t0 + 2 * 3600000).toISOString() }],
        },
      ],
    };
    const r = computeCodeReviewVelocity(model);
    assert.ok(r['u-2']);
    assert.equal(r['u-2'].medianHours, 2);
    assert.equal(r['u-2'].count, 1);
    assert.equal(r['u-2'].threshold, 'ok');     // < 8h
  });

  test('threshold классификация: slow (>24h) / warn (8-24h) / ok (<8h)', () => {
    const base = Date.now() - 5 * 86400000;
    const make = (deltaH) => ({
      participants: [
        { key: 'a', bbItems: [{ kind: 'pr', prId: 1, at: new Date(base).toISOString() }] },
        { key: 'b', bbItems: [{ kind: 'review', prId: 1, at: new Date(base + deltaH * 3600000).toISOString() }] },
      ],
    });
    assert.equal(computeCodeReviewVelocity(make(2))['b'].threshold, 'ok');
    assert.equal(computeCodeReviewVelocity(make(12))['b'].threshold, 'warn');
    assert.equal(computeCodeReviewVelocity(make(48))['b'].threshold, 'slow');
  });

  test('PR без opened-event пропускается', () => {
    const model = {
      participants: [
        { key: 'b', bbItems: [{ kind: 'review', prId: 999, at: new Date().toISOString() }] },
      ],
    };
    const r = computeCodeReviewVelocity(model);
    assert.deepEqual(r, {});
  });
});

/* ── computePrThroughput ────────────────────────────────── */
describe('computePrThroughput — V20 S6.3.1', () => {
  test('flag=overload если opened>5 и mergeRate<0.4', () => {
    const recent = new Date(Date.now() - 86400000).toISOString();
    const model = {
      participants: [{
        key: 'u-1',
        bbItems: [
          ...Array(6).fill({ kind: 'pr', at: recent, status: 'OPEN' }),
          ...Array(2).fill({ kind: 'pr', at: recent, status: 'MERGED' }),
        ],
      }],
    };
    const r = computePrThroughput(model);
    assert.equal(r['u-1'].opened, 8);
    assert.equal(r['u-1'].merged, 2);
    assert.equal(r['u-1'].mergeRate, 0.25);
    assert.equal(r['u-1'].flag, 'overload');
  });

  test('flag=healthy при mergeRate >= 0.7', () => {
    const recent = new Date(Date.now() - 86400000).toISOString();
    const model = {
      participants: [{
        key: 'u-1',
        bbItems: [
          ...Array(8).fill({ kind: 'pr', at: recent, status: 'MERGED' }),
          ...Array(2).fill({ kind: 'pr', at: recent, status: 'OPEN' }),
        ],
      }],
    };
    const r = computePrThroughput(model);
    assert.equal(r['u-1'].mergeRate, 0.8);
    assert.equal(r['u-1'].flag, 'healthy');
  });

  test('старые PRs (>7 дней) игнорируются', () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString();
    const model = {
      participants: [{
        key: 'u-1',
        bbItems: [{ kind: 'pr', at: old, status: 'MERGED' }],
      }],
    };
    const r = computePrThroughput(model);
    assert.deepEqual(r, {});
  });
});

/* ── computeCrossTeamDependencies ───────────────────────── */
describe('computeCrossTeamDependencies — V20 S6.3.4', () => {
  test('PR в чужой репозиторий считается cross-team', () => {
    const model = {
      participants: [{
        key: 'u-1',
        projects: ['SBOFPLCORE'],
        bbItems: [
          { kind: 'pr', repo: 'SBOFPL/foo' },           // same team (matches via SBOFPL prefix)
          { kind: 'pr', repo: 'OTHERTEAM/bar' },        // cross-team
          { kind: 'pr', repo: 'OTHERTEAM/baz' },        // cross-team
        ],
      }],
    };
    const r = computeCrossTeamDependencies(model);
    assert.equal(r['u-1'].totalPRs, 3);
    assert.equal(r['u-1'].crossTeamPRs, 2);
    assert.equal(r['u-1'].ratio, 0.67);
  });

  test('пустой projects → не считается (insufficient data)', () => {
    const model = {
      participants: [{ key: 'u-1', projects: [], bbItems: [{ kind: 'pr', repo: 'X/y' }] }],
    };
    const r = computeCrossTeamDependencies(model);
    // Если my pks пустые — все PR считаются cross. Это ОК для baseline,
    // но НЕ должно паниковать. Проверим что хотя бы числа есть.
    assert.equal(r['u-1'].crossTeamPRs, 1);
  });
});

/* ── computeSprintGoalSlope ──────────────────────────── */
describe('computeSprintGoalSlope — V20 S6.3.3', () => {
  test('растущий progress → trend=up', () => {
    const day = 86400000;
    const now = Date.now();
    const history = [];
    for (let i = 0; i < 14; i++) {
      history.push({
        ts: now - (13 - i) * day,
        sprintGoal: { aggregateProgress: 10 + i * 5 },     // 10 → 75% за 14 дней
      });
    }
    const r = computeSprintGoalSlope(history);
    assert.equal(r.trend, 'up');
    assert.ok(r.slope > 0);
    assert.ok(r.r2 > 0.95);     // линейная по построению
  });

  test('падающий progress → trend=down', () => {
    const day = 86400000;
    const now = Date.now();
    const history = Array.from({ length: 10 }, (_, i) => ({
      ts: now - (9 - i) * day,
      sprintGoal: { aggregateProgress: 80 - i * 3 },
    }));
    const r = computeSprintGoalSlope(history);
    assert.equal(r.trend, 'down');
    assert.ok(r.slope < 0);
  });

  test('стагнация (|slope| < 0.5) → flat', () => {
    const day = 86400000;
    const now = Date.now();
    const history = Array.from({ length: 10 }, (_, i) => ({
      ts: now - (9 - i) * day,
      sprintGoal: { aggregateProgress: 50 + (i % 2) * 0.2 },     // micro-jitter
    }));
    const r = computeSprintGoalSlope(history);
    assert.equal(r.trend, 'flat');
  });

  test('< 3 точек → no-data', () => {
    assert.equal(computeSprintGoalSlope([]).trend, 'no-data');
    assert.equal(computeSprintGoalSlope([{ ts: 1, sprintGoal: { aggregateProgress: 5 } }]).trend, 'no-data');
  });
});

/* ── computeZScore + computeEmaWoW ──────────────────── */
describe('computeZScore — V20 S6.3.2', () => {
  test('Z > 2 → anomalous', () => {
    const series = [10, 11, 12, 11, 10, 11, 12, 50];     // последний — выброс
    const r = computeZScore(series);
    assert.ok(r.z > 2);
    assert.equal(r.anomalous, true);
  });

  test('стабильная серия → не anomalous', () => {
    const series = [10, 11, 12, 11, 10, 11, 12, 11];
    const r = computeZScore(series);
    assert.equal(r.anomalous, false);
    assert.ok(Math.abs(r.z) < 2);
  });

  test('< 4 точек → defaults', () => {
    const r = computeZScore([1, 2, 3]);
    assert.equal(r.anomalous, false);
    assert.equal(r.z, 0);
  });
});

describe('computeEmaWoW — V20 S6.3.2', () => {
  test('растущая серия → wowDelta > 0', () => {
    const series = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
    const r = computeEmaWoW(series);
    assert.ok(r.wowDelta > 0);
    assert.ok(r.emaToday > r.emaLastWeek);
  });

  test('плоская серия → wowDelta ≈ 0', () => {
    const series = Array(10).fill(50);
    const r = computeEmaWoW(series);
    assert.equal(r.wowDelta, 0);
    assert.equal(r.emaToday, 50);
  });

  test('< 8 точек → emaToday только последнее', () => {
    const r = computeEmaWoW([1, 2, 3]);
    assert.equal(r.emaToday, 3);
    assert.equal(r.emaLastWeek, 0);
    assert.equal(r.wowDelta, 0);
  });
});
