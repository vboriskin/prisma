'use strict';
/* ============================================================
   tests/unit/aiContextBuilder.test.js
   --
   Tests for buildAIContext / serializeContext. Both are pure
   functions over rows[]. We don't mock metricsEngine etc — they're
   internal helpers the production code already exercises.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage before importing state-touching modules.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const { buildAIContext, serializeContext } = await import('../../ai/aiContextBuilder.js');

function makeRow(over = {}) {
  return {
    id: 'r1', team: 'Pay', epic: 'Test', tasks: 'subtask',
    isDone: false, blockingDependency: false, isUnassigned: false,
    scopeStatus: 'Да', riskFlags: [], assignee: 'Иван',
    hasRelease120: false, hasRelease121: false, hasRelease122: false, hasOvertime: false,
    riskScore: 0,
    ...over,
  };
}

describe('buildAIContext — empty input', () => {
  test('null / undefined / [] returns {empty:true, blockId}', () => {
    assert.deepEqual(buildAIContext(null),     { empty: true, blockId: null });
    assert.deepEqual(buildAIContext(undefined), { empty: true, blockId: null });
    assert.deepEqual(buildAIContext([]),       { empty: true, blockId: null });
  });

  test('opts.blockId echoed back to empty payload', () => {
    const ctx = buildAIContext([], { blockId: 'health' });
    assert.equal(ctx.blockId, 'health');
  });
});

describe('buildAIContext — summary aggregation', () => {
  test('total / done / active / donePct correct', () => {
    const rows = [makeRow({ isDone: true }), makeRow({ isDone: false }), makeRow({ isDone: false })];
    const ctx = buildAIContext(rows);
    assert.equal(ctx.summary.total, 3);
    assert.equal(ctx.summary.done, 1);
    assert.equal(ctx.summary.active, 2);
    assert.ok(ctx.summary.donePct === 33 || ctx.summary.donePct === 34);
  });

  test('blockers / risky / noRelease / unconfirmed counts', () => {
    const ctx = buildAIContext([
      makeRow({ blockingDependency: true }),
      makeRow({ riskFlags: ['x'] }),
      makeRow({ isUnassigned: true,  scopeStatus: 'Да' }),
      makeRow({ scopeStatus: 'Требует подтверждения' }),
    ]);
    assert.equal(ctx.summary.blockers, 1);
    assert.equal(ctx.summary.risky, 1);
    assert.equal(ctx.summary.noRelease, 1);
    assert.equal(ctx.summary.unconfirmed, 1);
  });

  test('done items NOT counted as risky/blockers', () => {
    const ctx = buildAIContext([
      makeRow({ isDone: true, blockingDependency: true, riskFlags: ['x'] }),
    ]);
    assert.equal(ctx.summary.blockers, 0);
    assert.equal(ctx.summary.risky, 0);
  });
});

describe('buildAIContext — slim row shape', () => {
  test('row.tasks → task field, truncated to 80', () => {
    const rows = [makeRow({ tasks: 'A'.repeat(200), riskScore: 99 })];
    const ctx = buildAIContext(rows);
    assert.ok(ctx.topRows.length >= 1);
    assert.equal(ctx.topRows[0].task.length, 80);
  });

  test('release composed from hasRelease* flags', () => {
    const ctx = buildAIContext([
      makeRow({ id: 'a', hasRelease120: true, hasRelease121: true, riskScore: 1 }),
      makeRow({ id: 'b', hasOvertime: true, riskScore: 0 }),
    ]);
    const a = ctx.topRows.find(r => r.id === 'a');
    const b = ctx.topRows.find(r => r.id === 'b');
    assert.equal(a.release, '1.20/1.21');
    assert.equal(b.release, 'OT');
  });

  test('release fallback "none" when no flags', () => {
    const ctx = buildAIContext([makeRow({ id: 'x' })]);
    assert.equal(ctx.topRows[0].release, 'none');
  });

  test('topRows limited by opts.maxRows', () => {
    const rows = Array.from({ length: 80 }, (_, i) => makeRow({ id: `r${i}`, riskScore: 80 - i }));
    const ctx = buildAIContext(rows, { maxRows: 5 });
    assert.equal(ctx.topRows.length, 5);
    // Sorted by riskScore desc — first row has riskScore 80.
    assert.equal(ctx.topRows[0].riskScore, 80);
  });
});

describe('buildAIContext — releases / topX lists', () => {
  test('topBlockers limited to 8', () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeRow({ id: `b${i}`, blockingDependency: true, isDone: false, riskScore: i }));
    const ctx = buildAIContext(rows);
    assert.equal(ctx.topBlockers.length, 8);
  });

  test('load aggregated per assignee, top-10 only', () => {
    const rows = Array.from({ length: 15 }, (_, i) => makeRow({ id: `r${i}`, assignee: `User${i}` }));
    const ctx = buildAIContext(rows);
    assert.ok(ctx.load.length <= 10);
    // Each entry has {name, total, ...}.
    for (const l of ctx.load) {
      assert.ok(typeof l.name === 'string');
      assert.ok(typeof l.total === 'number');
    }
  });
});

describe('serializeContext', () => {
  test('returns plain JSON when ≤ maxBytes', () => {
    const out = serializeContext({ a: 1 }, 100);
    assert.equal(JSON.parse(out).a, 1);
  });

  test('over-budget context trims topRows to 15', () => {
    const big = { topRows: Array.from({ length: 200 }, (_, i) => ({ task: 'X'.repeat(500), id: i })) };
    const out = serializeContext(big, 5000);
    const reparsed = (() => { try { return JSON.parse(out); } catch { return null; } })();
    if (reparsed) {
      // If it parsed, topRows must be trimmed.
      assert.ok(reparsed.topRows.length <= 15);
    } else {
      // Otherwise the function did a hard slice, so output is non-JSON text under budget.
      assert.ok(out.length <= 5000);
    }
  });

  test('extreme over-budget falls through to hard slice', () => {
    // Make a context that's huge even after trimming topRows.
    const big = { huge: 'X'.repeat(20000), topRows: [] };
    const out = serializeContext(big, 1000);
    assert.ok(out.length <= 1000);
  });
});
