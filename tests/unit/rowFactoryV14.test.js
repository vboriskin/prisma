'use strict';
/* ============================================================
   tests/unit/rowFactoryV14.test.js
   --
   V15 system tests for V14 row schema additions:
     · transferComments[] — pristine empty array
     · workStartDate / workEndDate — empty strings
     · actualDoneDate / doneComment — empty strings
     · assignedAt — empty string
   Plus regression checks that pre-V14 fields didn't drift.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// state.js / utils.js touch localStorage during module init.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const { RowFactory } = await import('../../rowFactory.js');

describe('RowFactory.create — V14 schema additions', () => {
  test('transferComments defaults to empty array (not null/undefined)', () => {
    const row = RowFactory.create();
    assert.ok(Array.isArray(row.transferComments), 'transferComments must be an array');
    assert.equal(row.transferComments.length, 0);
  });

  test('workStartDate / workEndDate default to empty strings', () => {
    const row = RowFactory.create();
    assert.equal(row.workStartDate, '');
    assert.equal(row.workEndDate, '');
  });

  test('actualDoneDate / doneComment default to empty strings', () => {
    const row = RowFactory.create();
    assert.equal(row.actualDoneDate, '');
    assert.equal(row.doneComment, '');
  });

  test('assignedAt defaults to empty string', () => {
    const row = RowFactory.create();
    assert.equal(row.assignedAt, '');
  });

  test('overrides via ov-arg take precedence over defaults', () => {
    const row = RowFactory.create({
      transferComments: [{ at: '2026-04-30T00:00:00Z', wt: 'BE', from: 'r120', to: 'r121', text: 'risk' }],
      workStartDate:    '2026-05-01',
      workEndDate:      '2026-05-15',
      actualDoneDate:   '2026-04-30',
      doneComment:      'closed early',
      assignedAt:       '2026-04-29T10:00:00Z',
    });
    assert.equal(row.transferComments.length, 1);
    assert.equal(row.workStartDate, '2026-05-01');
    assert.equal(row.workEndDate,   '2026-05-15');
    assert.equal(row.actualDoneDate,'2026-04-30');
    assert.equal(row.doneComment,   'closed early');
    assert.equal(row.assignedAt,    '2026-04-29T10:00:00Z');
  });

  test('two rows have independent transferComments arrays (no shared reference)', () => {
    // Critical: a defaults-leak via shared array reference would mean pushing
    // a comment on row A appears on row B. Catches that drift early.
    const a = RowFactory.create();
    const b = RowFactory.create();
    a.transferComments.push({ wt: 'X' });
    assert.equal(b.transferComments.length, 0, 'row B must NOT see row A\'s pushed comment');
  });
});

describe('RowFactory.create — pre-V14 defaults still present', () => {
  test('canonical legacy fields exist with correct defaults', () => {
    const row = RowFactory.create();
    assert.equal(row.team, '');
    assert.equal(row.epic, '');
    assert.equal(row.isDone, false);
    assert.equal(row.scopeStatus, '');
    assert.ok(Array.isArray(row.release120Types));
    assert.ok(Array.isArray(row.release121Types));
    assert.ok(Array.isArray(row.release122Types));
    assert.ok(Array.isArray(row.overtimeTypes));
    assert.ok(Array.isArray(row.backlogTypes));
    assert.ok(Array.isArray(row.ganttArrows));
    assert.equal(typeof row.donePills, 'object');
    // V15 Spine — per-pill flag maps must all be objects so renderer/exporter
    // never touch undefined and per-pill writes are safe out of the box.
    assert.equal(typeof row.unplannedPills, 'object');
    assert.equal(typeof row.assigneePills,  'object');
    assert.notEqual(row.id, undefined);
  });

  test('createdAt / updatedAt are valid ISO strings', () => {
    const row = RowFactory.create();
    assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('V15 Spine: assigneePills survives create() override + updateDerived', () => {
    const row = RowFactory.create({
      assigneePills: { 'r120__BE': 'Иванов', 'r121__FE': 'Петров' },
      release120Types: ['BE'],
      release121Types: ['FE'],
    });
    assert.equal(row.assigneePills['r120__BE'], 'Иванов');
    assert.equal(row.assigneePills['r121__FE'], 'Петров');
    // Per-pill assignment must not mutate the row-level assignee field
    // (which is the legacy fallback for rows pre-Spine).
    assert.equal(row.assignee, '');
  });
});
