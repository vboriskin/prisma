'use strict';
/* ============================================================
   tests/unit/teamScanner2Enrichment.test.js
   --
   V18.1 P3 — unit-tests для enrichment-функций v2.0 Сканнера.

   Покрытие:
     · computeHeatmap         — 3×24 grid, peak/quiet hours
     · computeContextSwitches — gap-based switches, distinctKeys, score
     · computeTimeline72h     — DESC merge, dayOffset+hourBucket теги
     · findLastStatusChange   — fallback на issue.created
     · computeBlockers        — dwell-threshold, terminal status filter,
                                dedup по issue.key (matches accountId+email)
     · enrichForScanner2      — integration, mutates model + adds meta
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichForScanner2,
  computeHeatmap,
  computeContextSwitches,
  computeTimeline72h,
  findLastStatusChange,
  buildAssigneeIndex,
  computeBlockers,
  computeHeatmap72x4,
  computeSparkline72h,
} from '../../integrations/teamScanner2Enrichment.js';

/* ── Helpers — конструируем event'ы и participant'ов ──────── */

function ev(at, key) {
  return { at, kind: 'transition', issue: key ? { key } : null, text: 'm' };
}
function mk(over = {}) {
  return {
    timelineToday:     [],
    timelineYesterday: [],
    timelinePrev:      [],
    ...over,
  };
}

/* ── computeHeatmap ──────────────────────────────────────── */

describe('computeHeatmap', () => {
  test('пустой participant → нулевая grid 3×24, peakHour=-1', () => {
    const h = computeHeatmap(mk());
    assert.equal(h.grid.length, 3);
    assert.equal(h.grid[0].length, 24);
    assert.deepEqual(h.grid[0], new Array(24).fill(0));
    assert.equal(h.peakHour, -1);
    assert.equal(h.peakCount, 0);
    // Все 24 часа считаются «тихими» (≤1) — это OK для empty case.
    assert.equal(h.quietHours.length, 24);
  });

  test('один event сегодня в 14:00 → grid[0][14]=1, peakHour=14', () => {
    // ISO с явной TZ может «съехать» по часам — используем локальное время:
    const d = new Date(); d.setHours(14, 30, 0, 0);
    const h = computeHeatmap(mk({ timelineToday: [ev(d.toISOString())] }));
    assert.equal(h.grid[0][14], 1);
    assert.equal(h.peakHour, 14);
    assert.equal(h.peakCount, 1);
  });

  test('peak агрегирует по 3 дням; quietHours = часы где collapsed≤1', () => {
    const make = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    const p = mk({
      timelineToday:     [ev(make(10)), ev(make(10)), ev(make(15))],
      timelineYesterday: [ev(make(10))],
      timelinePrev:      [ev(make(15))],
    });
    const h = computeHeatmap(p);
    // 10:00 → 2+1+0 = 3; 15:00 → 1+0+1 = 2 → peak = 10
    assert.equal(h.peakHour, 10);
    assert.equal(h.peakCount, 3);
    assert.ok(h.quietHours.includes(0));
    assert.ok(!h.quietHours.includes(10));
  });
});

/* ── computeContextSwitches ──────────────────────────────── */

describe('computeContextSwitches', () => {
  test('пустой → distinct=0, switches=[], score=0', () => {
    const cs = computeContextSwitches(mk());
    assert.equal(cs.distinctIssueKeys, 0);
    assert.deepEqual(cs.switchEvents, []);
    assert.equal(cs.switchScore, 0);
  });

  test('A→B с gap 10 мин (< 30мин) → switch регистрируется', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const t1 = new Date('2026-05-01T10:10:00Z').toISOString();
    const cs = computeContextSwitches(mk({
      timelineToday: [ev(t0, 'A-1'), ev(t1, 'B-2')],
    }));
    assert.equal(cs.distinctIssueKeys, 2);
    assert.equal(cs.switchEvents.length, 1);
    assert.equal(cs.switchEvents[0].fromKey, 'A-1');
    assert.equal(cs.switchEvents[0].toKey,   'B-2');
    assert.equal(cs.switchEvents[0].gapSec, 600);
  });

  test('A→B с gap 45 мин (>= 30мин) → switch НЕ регистрируется', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const t1 = new Date('2026-05-01T10:45:00Z').toISOString();
    const cs = computeContextSwitches(mk({
      timelineToday: [ev(t0, 'A-1'), ev(t1, 'B-2')],
    }));
    assert.equal(cs.distinctIssueKeys, 2);
    assert.equal(cs.switchEvents.length, 0);
  });

  test('A→A (один и тот же ключ) gap 10 мин → НЕ switch', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const t1 = new Date('2026-05-01T10:10:00Z').toISOString();
    const cs = computeContextSwitches(mk({
      timelineToday: [ev(t0, 'A-1'), ev(t1, 'A-1')],
    }));
    assert.equal(cs.distinctIssueKeys, 1);
    assert.equal(cs.switchEvents.length, 0);
  });

  test('event без issue.key игнорируется', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const cs = computeContextSwitches(mk({
      timelineToday: [{ at: t0, kind: 'comment' }, ev(t0, 'A-1')],
    }));
    assert.equal(cs.distinctIssueKeys, 1);
  });
});

/* ── computeTimeline72h ──────────────────────────────────── */

describe('computeTimeline72h', () => {
  test('merge 3 buckets, sorted DESC, добавлены dayOffset+hourBucket', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const t1 = new Date('2026-04-30T15:00:00Z').toISOString();
    const t2 = new Date('2026-04-29T12:00:00Z').toISOString();
    const tl = computeTimeline72h(mk({
      timelineToday:     [ev(t0, 'A')],
      timelineYesterday: [ev(t1, 'B')],
      timelinePrev:      [ev(t2, 'C')],
    }));
    assert.equal(tl.length, 3);
    assert.equal(tl[0].dayOffset, 0);
    assert.equal(tl[1].dayOffset, 1);
    assert.equal(tl[2].dayOffset, 2);
    assert.ok(tl[0].at > tl[1].at);   // DESC
    // hourBucket валиден.
    for (const e of tl) {
      assert.ok(e.hourBucket >= 0 && e.hourBucket < 24);
    }
  });

  test('event без at игнорируется, не падает', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const tl = computeTimeline72h(mk({
      timelineToday: [ev(t0, 'A'), { kind: 'noop' }],
    }));
    assert.equal(tl.length, 1);
  });

  // V18.1 P6.2 — unified timeline объединяет 4 источника с src-тегом.
  test('merge: jira + bb + cf + zephyr → src tags корректные', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const tl = computeTimeline72h(mk({
      timelineToday:               [ev(t0, 'A')],
      bbItems:                     [{ at: t0, kind: 'pr',     title: 'Fix auth', repo: 'r1' }],
      cfItems:                     [{ at: t0, kind: 'edit',   title: 'Page',     spaceName: 'TEAM' }],
      zephyrTestsCreatedRecent:    [{ at: t0, kind: 'test',   slim: { summary: 'Login test' } }],
      zephyrTestsExecutedRecent:   [{ at: t0, kind: 'testExec', result: 'PASS' }],
    }));
    assert.equal(tl.length, 5, '4 источника объединены в один лента');
    const srcs = tl.map(e => e.src).sort();
    assert.deepEqual(srcs, ['bb', 'cf', 'jira', 'zephyr', 'zephyr']);
  });

  test('jira events сохраняют src=jira + dayOffset', () => {
    const t0 = new Date('2026-05-01T10:00:00Z').toISOString();
    const tl = computeTimeline72h(mk({ timelineToday: [ev(t0, 'A')] }));
    assert.equal(tl.length, 1);
    assert.equal(tl[0].src, 'jira');
  });

  test('bb/cf items получают dayOffset вычисленный от at', () => {
    const today = new Date(); today.setHours(10, 0, 0, 0);
    const yest  = new Date(today); yest.setDate(today.getDate() - 1);
    const tl = computeTimeline72h(mk({
      bbItems: [{ at: today.toISOString(), kind: 'pr',  title: 'a' }],
      cfItems: [{ at: yest.toISOString(),  kind: 'edit', title: 'b' }],
    }));
    const bb = tl.find(e => e.src === 'bb');
    const cf = tl.find(e => e.src === 'cf');
    assert.equal(bb?.dayOffset, 0, 'bb сегодняшний → 0');
    assert.equal(cf?.dayOffset, 1, 'cf вчерашний → 1');
  });
});

/* ── findLastStatusChange ────────────────────────────────── */

describe('findLastStatusChange', () => {
  test('две status-transitions → возвращает позднюю', () => {
    const issue = {
      changelog: { histories: [
        { created: '2026-04-29T10:00:00Z', items: [{ field: 'status' }] },
        { created: '2026-04-30T15:00:00Z', items: [{ field: 'status' }] },
        { created: '2026-04-30T16:00:00Z', items: [{ field: 'priority' }] },  // not status
      ]},
      fields: { created: '2026-04-01T00:00:00Z' },
    };
    assert.equal(findLastStatusChange(issue), '2026-04-30T15:00:00Z');
  });

  test('нет status-transitions → fallback на fields.created', () => {
    const issue = {
      changelog: { histories: [{ created: '2026-04-30T15:00:00Z', items: [{ field: 'priority' }] }] },
      fields:    { created: '2026-04-01T00:00:00Z' },
    };
    assert.equal(findLastStatusChange(issue), '2026-04-01T00:00:00Z');
  });

  test('нет changelog и нет created → пустая строка', () => {
    assert.equal(findLastStatusChange({}), '');
    assert.equal(findLastStatusChange({ fields: {} }), '');
  });
});

/* ── computeBlockers ─────────────────────────────────────── */

describe('computeBlockers', () => {
  function makeRaw(...issues) {
    return { reports: [{ issues }] };
  }
  function issue(opts) {
    return {
      key: opts.key,
      fields: {
        summary: opts.summary || '',
        status: { name: opts.status || 'In Progress', statusCategory: { key: opts.cat || 'indeterminate' } },
        assignee: opts.assignee || { accountId: 'u1', emailAddress: 'u1@e.com' },
        created: opts.created || '2026-04-01T00:00:00Z',
      },
      changelog: { histories: opts.histories || [] },
    };
  }

  test('issue в non-terminal status старше 24ч → blocker', () => {
    const oldIso = new Date(Date.now() - 30 * 3600 * 1000).toISOString();   // 30 часов назад
    const raw = makeRaw(issue({
      key: 'X-1', status: 'In Progress', cat: 'indeterminate',
      histories: [{ created: oldIso, items: [{ field: 'status' }] }],
    }));
    const idx = buildAssigneeIndex(raw);
    const p = { jiraAccountId: 'u1', email: 'u1@e.com' };
    const out = computeBlockers(p, idx, 24);
    assert.equal(out.length, 1);
    assert.equal(out[0].key, 'X-1');
    assert.ok(out[0].dwellHours >= 24, `expected dwell >= 24, got ${out[0].dwellHours}`);
  });

  test('issue в terminal status (Done) → НЕ blocker даже если старый', () => {
    const oldIso = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
    const raw = makeRaw(issue({
      key: 'X-1', status: 'Done', cat: 'done',
      histories: [{ created: oldIso, items: [{ field: 'status' }] }],
    }));
    const idx = buildAssigneeIndex(raw);
    const p = { jiraAccountId: 'u1', email: 'u1@e.com' };
    const out = computeBlockers(p, idx, 24);
    assert.equal(out.length, 0);
  });

  test('issue в non-terminal но dwell < 24ч → НЕ blocker', () => {
    const recentIso = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    const raw = makeRaw(issue({
      key: 'X-1', status: 'In Progress', cat: 'indeterminate',
      histories: [{ created: recentIso, items: [{ field: 'status' }] }],
    }));
    const idx = buildAssigneeIndex(raw);
    const p = { jiraAccountId: 'u1', email: 'u1@e.com' };
    const out = computeBlockers(p, idx, 24);
    assert.equal(out.length, 0);
  });

  test('один issue матчится и по accountId, и по email — dedup', () => {
    const oldIso = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const raw = makeRaw(issue({
      key: 'X-1', status: 'In Progress',
      assignee: { accountId: 'u1', emailAddress: 'u1@e.com' },
      histories: [{ created: oldIso, items: [{ field: 'status' }] }],
    }));
    const idx = buildAssigneeIndex(raw);
    const p = { jiraAccountId: 'u1', email: 'u1@e.com' };
    const out = computeBlockers(p, idx, 24);
    assert.equal(out.length, 1);   // не 2!
  });

  test('сортировка blockers по dwellHours DESC', () => {
    const t100h = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
    const t30h  = new Date(Date.now() -  30 * 3600 * 1000).toISOString();
    const raw = makeRaw(
      issue({ key: 'X-1', histories: [{ created: t30h,  items: [{ field: 'status' }] }] }),
      issue({ key: 'X-2', histories: [{ created: t100h, items: [{ field: 'status' }] }] }),
    );
    const idx = buildAssigneeIndex(raw);
    const p = { jiraAccountId: 'u1', email: 'u1@e.com' };
    const out = computeBlockers(p, idx, 24);
    assert.equal(out.length, 2);
    assert.equal(out[0].key, 'X-2');   // 100ч старше → выше
    assert.equal(out[1].key, 'X-1');
  });
});

/* ── computeHeatmap72x4 (P5) ─────────────────────────────── */

describe('computeHeatmap72x4', () => {
  test('пустой → grid 4×72 нулей, peakCell=null', () => {
    const h = computeHeatmap72x4(mk());
    assert.equal(h.grid.length, 4);
    assert.equal(h.grid[0].length, 72);
    assert.equal(h.grid[0][0], 0);
    assert.deepEqual(h.rowTotals, [0, 0, 0, 0]);
    assert.equal(h.peakCell, null);
  });

  test('jira event 2ч назад → grid[0][69] = 1', () => {
    const ago2hIso = new Date(Date.now() - 2 * 3600 * 1000 - 60_000).toISOString();
    const h = computeHeatmap72x4(mk({ timelineToday: [ev(ago2hIso, 'A')] }));
    // hoursAgo = 2 → idx = 71 - 2 = 69
    assert.equal(h.grid[0][69], 1);
    assert.equal(h.rowTotals[0], 1);
    assert.equal(h.peakCell.srcIdx, 0);
    assert.equal(h.peakCell.hourIndex, 69);
  });

  test('event > 72ч → игнорируется', () => {
    const ago100h = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
    const h = computeHeatmap72x4(mk({ timelineToday: [ev(ago100h, 'A')] }));
    assert.deepEqual(h.rowTotals, [0, 0, 0, 0]);
  });

  test('источники J/B/C/Z разводятся по строкам', () => {
    const ago1h = new Date(Date.now() - 1 * 3600 * 1000 - 60_000).toISOString();
    const p = mk({
      timelineToday:               [ev(ago1h, 'A')],
      bbItems:                     [{ at: ago1h, kind: 'pr' }],
      cfItems:                     [{ at: ago1h, kind: 'edit' }],
      zephyrTestsCreatedRecent:    [{ at: ago1h, kind: 'test' }],
      zephyrTestsExecutedRecent:   [{ at: ago1h, kind: 'test', result: 'PASS' }],
    });
    const h = computeHeatmap72x4(p);
    assert.equal(h.rowTotals[0], 1, 'jira');
    assert.equal(h.rowTotals[1], 1, 'bb');
    assert.equal(h.rowTotals[2], 1, 'cf');
    assert.equal(h.rowTotals[3], 2, 'zephyr (created + executed)');
  });

  test('colTotals = sum по 4 источникам в колонке', () => {
    const ago2h = new Date(Date.now() - 2 * 3600 * 1000 - 60_000).toISOString();
    const p = mk({
      timelineToday: [ev(ago2h, 'A')],
      bbItems:       [{ at: ago2h, kind: 'pr' }],
    });
    const h = computeHeatmap72x4(p);
    assert.equal(h.colTotals[69], 2, 'jira+bb в часе -2 = 2');
  });
});

/* ── computeSparkline72h (P5) ────────────────────────────── */

describe('computeSparkline72h', () => {
  test('пустой → 72 нулей', () => {
    const s = computeSparkline72h(mk());
    assert.equal(s.length, 72);
    assert.deepEqual(s, new Array(72).fill(0));
  });

  test('переиспользует heatmap72x4.colTotals если есть', () => {
    const p = mk();
    p.heatmap72x4 = { colTotals: new Array(72).fill(0).map((_, i) => i) };
    const s = computeSparkline72h(p);
    assert.equal(s[5], 5);
    assert.equal(s[71], 71);
    // Должна вернуть КОПИЮ, не ссылку.
    s[0] = 999;
    assert.equal(p.heatmap72x4.colTotals[0], 0);
  });

  test('считает с нуля если heatmap72x4 нет', () => {
    const ago1h = new Date(Date.now() - 1 * 3600 * 1000 - 60_000).toISOString();
    const p = mk({ timelineToday: [ev(ago1h, 'A'), ev(ago1h, 'B')] });
    const s = computeSparkline72h(p);
    assert.equal(s[70], 2);
  });
});

/* ── enrichForScanner2 — integration ─────────────────────── */

describe('enrichForScanner2', () => {
  test('добавляет per-participant поля + top-level meta', () => {
    const model = { participants: [mk()] };
    const out = enrichForScanner2(model);
    assert.strictEqual(out, model, 'should return same object (mutated)');
    assert.ok('heatmap' in out.participants[0]);
    assert.ok('contextSwitches' in out.participants[0]);
    assert.ok('timeline72h' in out.participants[0]);
    assert.ok(Array.isArray(out.participants[0].blockers));
    // P5 поля
    assert.ok('heatmap72x4' in out.participants[0]);
    assert.ok(Array.isArray(out.participants[0].sparkline72h));
    assert.equal(out.participants[0].sparkline72h.length, 72);
    assert.ok(out.scannerV2);
    assert.equal(out.scannerV2.dwellThresholdHours, 24);
    assert.equal(out.scannerV2.serverLocalTZ, true);
  });

  test('кастомный dwellHours прокидывается в blockers', () => {
    const model = { participants: [{ jiraAccountId: 'u1' }] };
    enrichForScanner2(model, null, { dwellHours: 48 });
    assert.equal(model.scannerV2.dwellThresholdHours, 48);
  });

  test('null/малые входы не падают', () => {
    assert.doesNotThrow(() => enrichForScanner2(null));
    assert.doesNotThrow(() => enrichForScanner2({}));
    assert.doesNotThrow(() => enrichForScanner2({ participants: 'not-array' }));
  });
});

/* ── classifyPerson + blockers field — regression ────────── */

describe('classifyPerson — V18.1 P3 blocker integration', () => {
  test('blockers field вместо stale → stop работает по blockers', async () => {
    const mod = await import('../../integrations/teamScanner2Renderer.js');
    const p = {
      timelineToday: [],
      blockers: [{ key: 'X-1', dwellHours: 30 }],
    };
    assert.equal(mod.classifyPerson(p), 'stop');
  });

  test('пустой blockers + есть stale → stale используется как fallback', async () => {
    const mod = await import('../../integrations/teamScanner2Renderer.js');
    const p = {
      timelineToday: [],
      blockers: [],         // P3 enriched, но пусто
      stale:    [{ key: 'X-1' }],   // fallback не должен срабатывать (blockers взят как авторитет)
    };
    // Фактическое поведение: blockers пуст → stuckListOf вернёт stale. → stop.
    // Это сознательное решение: blockers быть может ещё не вычислены полностью.
    assert.equal(mod.classifyPerson(p), 'stop');
  });

  test('blockers > 0 + есть today → watch (тянет старое + новое)', async () => {
    const mod = await import('../../integrations/teamScanner2Renderer.js');
    const p = {
      timelineToday: [ev('2026-05-01T10:00:00Z', 'A')],
      blockers: [{ key: 'X-1', dwellHours: 30 }],
    };
    assert.equal(mod.classifyPerson(p), 'watch');
  });
});
