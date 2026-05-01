'use strict';
/* ============================================================
   tests/unit/ganttHtmlExport.test.js
   --
   System tests for V15 Gantt HTML export pure helpers:
     · _buildLegend() — legend strip (icons / statuses / buckets)
     · _buildAssigneeSummary() — per-FIO grouping + aggregates
     · _splitTags() — pipe/comma assignee tokenizer
   The DOM-touching `build()` is exercised end-to-end by e2e; here
   we lock down the pure string output so a render-time regression
   (missing icon, broken bucket label, prototype pollution) trips
   `npm test` instead of slipping into the shared HTML file.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// `ganttHtmlExport.js` imports `../state.js` at module-eval. State touches
// localStorage on init — shim before the import resolves.
function makeLS() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeLS();
globalThis.window = { addEventListener: () => {}, App: {}, ThemeUI: { apply: () => {} } };

const { __testing } = await import('../../views/ganttHtmlExport.js');
const { _buildLegend, _buildAssigneeSummary, _buildUnassignedSummary, _splitTags } = __testing;

describe('_splitTags', () => {
  test('splits on pipe and comma, trims, drops empties', () => {
    assert.deepEqual(_splitTags('Иванов|Петров,  Сидоров '), ['Иванов', 'Петров', 'Сидоров']);
    assert.deepEqual(_splitTags(''), []);
    assert.deepEqual(_splitTags(null), []);
    assert.deepEqual(_splitTags(undefined), []);
  });
});

describe('_buildLegend (V15 Spine redesign)', () => {
  const html = _buildLegend();

  test('returns a non-empty html string with the four sections', () => {
    assert.ok(html.length > 200, 'legend should be substantial');
    assert.match(html, /Пилюля задачи/);
    assert.match(html, /Колодцы/);
    assert.match(html, /Состояния/);
    assert.match(html, /Переносы/);
  });

  test('shows the anatomy demo pill (stripe + name + state + meta)', () => {
    assert.match(html, /class="gex-legend-pill-demo"/);
    assert.match(html, /class="gex-legend-stripe"/);
    assert.match(html, /class="gex-legend-pill-name"/);
    assert.match(html, /class="gex-legend-pill-state-active"/);
    assert.match(html, /class="gex-legend-pill-row2">Иванов · 01.05—15.05/);
  });

  test('lists every bucket as coloured stripe sample', () => {
    assert.match(html, /background:#4f46e5/);
    assert.match(html, /background:#059669/);
    assert.match(html, /background:#d97706/);
    assert.match(html, /background:#dc2626/);
  });

  test('describes all three pill states', () => {
    assert.match(html, /gex-legend-state-active/);
    assert.match(html, /gex-legend-state-done/);
    assert.match(html, /gex-legend-state-unplanned/);
    assert.match(html, /Завершено/);
    assert.match(html, /Не запланирована/);
  });

  test('describes the comment markers (transfer = amber, add = blue)', () => {
    assert.match(html, /gex-legend-cmt-transfer/);
    assert.match(html, /gex-legend-cmt-add/);
  });

  test('does NOT reference retired emoji (📬 ⚐ 📅 avatar circle)', () => {
    assert.ok(!html.includes('📬'), 'comment emoji retired from legend');
    assert.ok(!html.includes('⚐'),  'unplanned flag emoji retired from legend');
    assert.ok(!html.includes('📅'), 'calendar emoji retired from legend');
    assert.ok(!/gex-legend-avatar\b/.test(html), 'avatar circle retired from legend');
  });

  test('keeps trail markers ↗ and ↘', () => {
    assert.match(html, /↗/);
    assert.match(html, /↘/);
  });

  test('uses the gex-legend* class namespace', () => {
    assert.match(html, /class="gex-legend"/);
    assert.match(html, /class="gex-legend-section/);
    assert.match(html, /class="gex-legend-items"/);
    assert.match(html, /class="gex-legend-title"/);
  });
});

describe('_buildAssigneeSummary', () => {
  test('returns empty string for empty / no-bucket rows', () => {
    assert.equal(_buildAssigneeSummary([]), '');
    assert.equal(_buildAssigneeSummary([{ assignee: 'X', release120Types: [], release121Types: [], release122Types: [], overtimeTypes: [] }]), '');
  });

  test('groups rows by assignee with per-bucket aggregates', () => {
    const rows = [
      {
        assignee: 'Иванов',
        team: 'A', epic: 'Эпик 1',
        release120Types: ['BE', 'FE'],
        release121Types: [], release122Types: [], overtimeTypes: [],
        donePills: {}, unplannedPills: {},
      },
      {
        assignee: 'Иванов|Петров',
        team: 'B', epic: 'Эпик 2',
        release120Types: [], release121Types: ['BE'],
        release122Types: [], overtimeTypes: [],
        donePills: { 'r121__BE': true },
        unplannedPills: {},
      },
    ];
    const html = _buildAssigneeSummary(rows);
    assert.match(html, /Сводка по исполнителям/);
    assert.match(html, /Иванов/);
    assert.match(html, /Петров/);
    // Ivanov has 3 assignments (2× r120 + 1× r121); Petrov has 1.
    assert.match(html, /3 задач/);
    assert.match(html, /1 завершено/);
    // Bucket pills used inside summary share class with legend.
    assert.match(html, /gex-bucket-pill gex-bucket-120/);
    assert.match(html, /gex-bucket-pill gex-bucket-121/);
  });

  test('V15: rows without assignee are EXCLUDED from the per-FIO summary', () => {
    const rows = [{
      assignee: '', team: 'A', epic: 'E',
      release120Types: ['BE'],
      release121Types: [], release122Types: [], overtimeTypes: [],
      donePills: {}, unplannedPills: {},
    }];
    // Per user request 2026-04-30 — only assigned pills show up under the
    // per-FIO summary; unassigned ones go into the companion block below.
    assert.equal(_buildAssigneeSummary(rows), '');
  });

  test('V15: per-pill assignee overrides row-level fallback', () => {
    const rows = [{
      assignee: 'Иванов',                                 // row-level default
      team: 'A', epic: 'E',
      release120Types: ['BE', 'FE'],
      release121Types: [], release122Types: [], overtimeTypes: [],
      assigneePills: { 'r120__BE': 'Петров' },            // per-pill override
      donePills: {}, unplannedPills: {},
    }];
    const html = _buildAssigneeSummary(rows);
    assert.match(html, /Петров/, 'per-pill assignee must win over row-level');
    assert.match(html, /Иванов/, 'fallback row-level still wins for FE pill');
  });

  test('escapes HTML in user-supplied epic/team strings', () => {
    const rows = [{
      assignee: 'X',
      team: '<script>alert(1)</script>',
      epic: 'Эпик & "опасный"',
      release120Types: ['BE'],
      release121Types: [], release122Types: [], overtimeTypes: [],
      donePills: {}, unplannedPills: {},
    }];
    const html = _buildAssigneeSummary(rows);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'must not inline a raw <script> tag');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&amp;/);
    assert.match(html, /&quot;/);
  });
});

describe('_buildUnassignedSummary (V15 Spine)', () => {
  test('returns empty string when every pill is assigned', () => {
    const rows = [{
      assignee: 'Иванов', team: 'A', epic: 'E',
      release120Types: ['BE'], release121Types: [], release122Types: [], overtimeTypes: [],
      donePills: {}, unplannedPills: {},
    }];
    assert.equal(_buildUnassignedSummary(rows), '');
  });

  test('lists pills with no assignee under «Без исполнителя» card', () => {
    const rows = [
      { assignee: 'Иванов', team: 'A', epic: 'E1',
        release120Types: ['BE'], release121Types: [], release122Types: [], overtimeTypes: [],
        donePills: {}, unplannedPills: {} },
      { assignee: '', team: 'B', epic: 'E2',
        release120Types: ['BE', 'QA'], release121Types: [], release122Types: [], overtimeTypes: [],
        donePills: {}, unplannedPills: {} },
    ];
    const html = _buildUnassignedSummary(rows);
    assert.match(html, /Без исполнителя/);
    assert.match(html, /E2/);
    assert.ok(!html.includes('E1'), 'assigned rows must not appear in unassigned card');
    // Two orphan pills (BE + QA) on E2.
    assert.match(html, /2 задач/);
  });

  test('per-pill assignee removes a pill from the unassigned card even when row.assignee is empty', () => {
    const rows = [{
      assignee: '',
      team: 'A', epic: 'E',
      release120Types: ['BE', 'FE'],
      release121Types: [], release122Types: [], overtimeTypes: [],
      assigneePills: { 'r120__BE': 'Иванов' },
      donePills: {}, unplannedPills: {},
    }];
    const html = _buildUnassignedSummary(rows);
    // Only FE remains orphaned.
    assert.match(html, /1 задач/);
    assert.match(html, /<td class="gex-cell-wt">FE<\/td>/);
    assert.ok(!/<td class="gex-cell-wt">BE<\/td>/.test(html), 'BE was per-pill-assigned; must NOT show as orphan');
  });
});
