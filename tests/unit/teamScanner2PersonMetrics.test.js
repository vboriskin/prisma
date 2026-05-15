'use strict';
/* ============================================================
   tests/unit/teamScanner2PersonMetrics.test.js
   --
   V20 S11 — Per-person metrics (Z1-Z3, Z6, Z8, Z9, Z10).
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeProductivityScore,
  computeFirstLastActivity,
  computeContextSwitchRate,
  computeLocDelta,
  computeHoursLogged,
  computeFirstResponseTime,
  computeBurnoutFlag,
  applyPersonMetrics,
} from '../../integrations/teamScanner2PersonMetrics.js';

/* ── Helpers ──────────────────────────────────────────────── */

function mkP(over = {}) {
  return {
    key: 'u1',
    timelineToday: [],
    timelineYesterday: [],
    timelinePrev: [],
    bbItems: [],
    cfItems: [],
    zephyrTestsCreatedRecent: [],
    zephyrTestsExecutedRecent: [],
    issuesNow: [],
    blockers: [],
    badges: {},
    contextSwitches: {},
    ...over,
  };
}

/* ── Z1 productivity ──────────────────────────────────────── */

describe('Z1 — computeProductivityScore', () => {
  test('пустой participant → score=0', () => {
    const r = computeProductivityScore(mkP());
    assert.equal(r.score, 0);
    assert.deepEqual(r.breakdown.commits, 0);
  });

  test('взвешенная сумма: 5 commits + 2 PR + 1 closed = 5×1 + 2×3 + 1×5 = 16', () => {
    const p = mkP({
      badges: { commits48h: 5, pr48h: 2 },
      timelineToday: [{ kind: 'transition', text: 'к статусу Done' }],
    });
    const r = computeProductivityScore(p);
    assert.equal(r.score, 5 + 6 + 5); // 16
    assert.equal(r.breakdown.closedToday, 1);
  });

  test('не-Done транзишены не считаются как закрытие', () => {
    const p = mkP({ timelineToday: [{ kind: 'transition', text: 'In Progress' }] });
    const r = computeProductivityScore(p);
    assert.equal(r.breakdown.closedToday, 0);
  });
});

/* ── Z2 first/last activity ───────────────────────────────── */

describe('Z2 — computeFirstLastActivity', () => {
  test('пустой participant → null', () => {
    const r = computeFirstLastActivity(mkP());
    assert.equal(r.first, null);
    assert.equal(r.last, null);
  });

  test('берёт min/max из bbItems за rolling 24h', () => {
    const now = Date.now();
    const p = mkP({
      bbItems: [
        { at: new Date(now - 8 * 3600 * 1000).toISOString() }, // 8ч назад
        { at: new Date(now - 1 * 3600 * 1000).toISOString() }, // 1ч назад
      ],
    });
    const r = computeFirstLastActivity(p);
    assert.ok(r.first instanceof Date);
    assert.ok(r.last instanceof Date);
    assert.ok(r.last.getTime() > r.first.getTime());
    assert.equal(r.count, 2);
    assert.ok(Math.abs(r.span - 7) < 0.2, `span ~7h, got ${r.span}`);
  });

  test('события старше 24h игнорируются', () => {
    const now = Date.now();
    const p = mkP({
      bbItems: [{ at: new Date(now - 30 * 3600 * 1000).toISOString() }],
    });
    const r = computeFirstLastActivity(p);
    assert.equal(r.first, null);
  });
});

/* ── Z3 context switch ────────────────────────────────────── */

describe('Z3 — computeContextSwitchRate', () => {
  test('пустой → 0', () => {
    const r = computeContextSwitchRate(mkP());
    assert.equal(r.perHour, 0);
    assert.equal(r.total, 0);
  });

  test('72 events → 1/час', () => {
    const p = mkP({
      contextSwitches: {
        switchEvents: new Array(72).fill({}),
        distinctIssueKeys: new Set(['A', 'B', 'C']),
        switchScore: 0.9,
      },
    });
    const r = computeContextSwitchRate(p);
    assert.equal(r.perHour, 1);
    assert.equal(r.distinctIssueKeys, 3);
  });
});

/* ── Z6 LOC ───────────────────────────────────────────────── */

describe('Z6 — computeLocDelta', () => {
  test('estimated при отсутствии diff stats: 4 commits × 50', () => {
    const p = mkP({ badges: { commits48h: 4 } });
    const r = computeLocDelta(p);
    assert.equal(r.estimated, true);
    assert.equal(r.added, 200);
    assert.equal(r.net, 200);
  });

  test('real stats при наличии linesAdded/linesRemoved', () => {
    const p = mkP({
      bbItems: [
        { linesAdded: 30, linesRemoved: 5 },
        { linesAdded: 100, linesRemoved: 50 },
      ],
    });
    const r = computeLocDelta(p);
    assert.equal(r.estimated, false);
    assert.equal(r.added, 130);
    assert.equal(r.removed, 55);
    assert.equal(r.net, 75);
  });
});

/* ── Z8 hours logged ──────────────────────────────────────── */

describe('Z8 — computeHoursLogged', () => {
  test('берёт loggedTodaySec', () => {
    const p = mkP({ loggedTodaySec: 5 * 3600 });
    const r = computeHoursLogged(p);
    assert.equal(r.todaySec, 5 * 3600);
  });

  test('агрегирует worklog events из вчера/prev', () => {
    const p = mkP({
      loggedTodaySec: 4 * 3600,
      timelineYesterday: [{ kind: 'worklog', timeSpentSec: 6 * 3600 }],
      timelinePrev:      [{ kind: 'worklog', timeSpentSec: 8 * 3600 }],
    });
    const r = computeHoursLogged(p);
    assert.equal(r.todaySec,     4 * 3600);
    assert.equal(r.yesterdaySec, 6 * 3600);
    assert.equal(r.weekSec,      18 * 3600);
  });
});

/* ── Z9 first-response time ───────────────────────────────── */

describe('Z9 — computeFirstResponseTime', () => {
  test('count<3 → low signal, medianHours=null', () => {
    const p = mkP({ blockers: [{ status: 'Open', dwellHours: 10 }] });
    const r = computeFirstResponseTime(p);
    assert.equal(r.medianHours, null);
    assert.equal(r.count, 1);
  });

  test('3+ initial-status blockers → median', () => {
    const p = mkP({
      blockers: [
        { status: 'Open', dwellHours: 10 },
        { status: 'To Do', dwellHours: 20 },
        { status: 'New',   dwellHours: 30 },
        { status: 'Open',  dwellHours: 40 },
        { status: 'Open',  dwellHours: 50 },
      ],
    });
    const r = computeFirstResponseTime(p);
    assert.equal(r.medianHours, 30);
    assert.equal(r.count, 5);
  });

  test('фильтрует non-initial статусы (Code Review не считаем)', () => {
    const p = mkP({
      blockers: [
        { status: 'Open',        dwellHours: 10 },
        { status: 'Code Review', dwellHours: 1000 },
        { status: 'In Progress', dwellHours: 5000 },
      ],
    });
    const r = computeFirstResponseTime(p);
    assert.equal(r.count, 1, 'только Open считается, остальные filter out');
  });
});

/* ── Z10 burnout ──────────────────────────────────────────── */

describe('Z10 — computeBurnoutFlag', () => {
  test('мало данных → none / low confidence', () => {
    const r = computeBurnoutFlag(mkP());
    assert.equal(r.level, 'none');
    assert.equal(r.confidence, 'low');
  });

  test('high weekend ratio → сигнал weekend', () => {
    const now = Date.now();
    // Создаём 10 событий, 5 в субботу (weekend)
    const sat = new Date('2026-04-25T12:00:00Z'); // суббота
    const wed = new Date('2026-04-22T12:00:00Z'); // среда
    const events = [
      ...Array(5).fill(null).map(() => ({ at: sat.toISOString() })),
      ...Array(5).fill(null).map(() => ({ at: wed.toISOString() })),
    ];
    const p = mkP({ bbItems: events });
    const r = computeBurnoutFlag(p);
    const weekendSig = r.signals.find(s => s.kind === 'weekend');
    assert.ok(weekendSig, 'weekend signal должен сработать (50% > 25%)');
  });

  test('WIP>=4 → wip-overload signal', () => {
    const events = Array(6).fill(null).map((_, i) => ({
      at: new Date(Date.now() - i * 3600 * 1000).toISOString(),
    }));
    const p = mkP({
      bbItems: events,
      issuesNow: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }],
    });
    const r = computeBurnoutFlag(p);
    const wipSig = r.signals.find(s => s.kind === 'wip-overload');
    assert.ok(wipSig);
    assert.equal(wipSig.value, 4);
  });

  test('2+ red signals → level=high', () => {
    const sat = new Date('2026-04-25T23:00:00Z'); // суббота + late-night
    const events = Array(10).fill(null).map(() => ({ at: sat.toISOString() }));
    const p = mkP({ bbItems: events, issuesNow: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }] });
    const r = computeBurnoutFlag(p);
    assert.ok(r.signals.length >= 2, `expected ≥2 signals, got ${r.signals.length}`);
    assert.equal(r.level, 'high');
  });
});

/* ── applyPersonMetrics integration ───────────────────────── */

describe('applyPersonMetrics', () => {
  test('навешивает personMetrics на каждого participant', () => {
    const model = { participants: [mkP({ key: 'a' }), mkP({ key: 'b' })] };
    applyPersonMetrics(model);
    assert.ok(model.participants[0].personMetrics);
    assert.ok(model.participants[1].personMetrics);
    const m = model.participants[0].personMetrics;
    assert.ok('productivity' in m);
    assert.ok('firstLast' in m);
    assert.ok('contextSwitches' in m);
    assert.ok('loc' in m);
    assert.ok('hoursLogged' in m);
    assert.ok('firstResponse' in m);
    assert.ok('burnout' in m);
  });

  test('null/малые входы не падают', () => {
    assert.doesNotThrow(() => applyPersonMetrics(null));
    assert.doesNotThrow(() => applyPersonMetrics({}));
    assert.doesNotThrow(() => applyPersonMetrics({ participants: 'not-array' }));
  });
});
