'use strict';
/* ============================================================
   tests/unit/employeeFactory.test.js
   --
   System tests for EmployeeFactory.create + .normalize. These feed
   into the V14 CSV roundtrip (__Q2EMPLOYEES__ marker), so any drift
   here breaks export/import on the next save.

   Pure-data tests; no DOM, no Storage.
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const { EmployeeFactory } = await import('../../rowFactory.js');

describe('EmployeeFactory.create — defaults', () => {
  test('creates with all required fields', () => {
    const e = EmployeeFactory.create();
    assert.ok(e.id);
    assert.equal(typeof e.id, 'string');
    assert.equal(e.fio, '');
    assert.equal(e.roles, '');
    assert.equal(e.teams, '');
    assert.deepEqual(e.overtimeDays, []);
    assert.equal(e.weekdayReady, false);
    assert.equal(e.weekdayComment, '');
    assert.equal(e.sourceType, 'manual');
    assert.match(e.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(e.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('id has emp_ prefix and is unique across calls', () => {
    const ids = new Set();
    for (let i = 0; i < 200; i++) ids.add(EmployeeFactory.create().id);
    assert.equal(ids.size, 200, 'all 200 ids must be unique');
    for (const id of ids) assert.ok(id.startsWith('emp_'));
  });

  test('overrides via ov-arg take precedence', () => {
    const e = EmployeeFactory.create({ fio: 'Иванов', roles: 'Backend|QA' });
    assert.equal(e.fio, 'Иванов');
    assert.equal(e.roles, 'Backend|QA');
  });
});

describe('EmployeeFactory.normalize — string canonicalisation', () => {
  test('fio is trimmed', () => {
    const e = { fio: '  Сидоров  ' };
    EmployeeFactory.normalize(e);
    assert.equal(e.fio, 'Сидоров');
  });

  test('roles: comma + pipe both work, joined with pipe', () => {
    const e = { roles: 'Backend, QA | Lead' };
    EmployeeFactory.normalize(e);
    assert.equal(e.roles, 'Backend|QA|Lead');
  });

  test('teams: empty tokens dropped', () => {
    const e = { teams: 'Mobile,, |Backend|' };
    EmployeeFactory.normalize(e);
    assert.equal(e.teams, 'Mobile|Backend');
  });

  test('weekdayComment: comma + pipe both work', () => {
    const e = { weekdayComment: 'Только до 19:00, не понедельник' };
    EmployeeFactory.normalize(e);
    assert.equal(e.weekdayComment, 'Только до 19:00|не понедельник');
  });
});

describe('EmployeeFactory.normalize — overtimeDays handling', () => {
  test('array of valid ISO dates is preserved + sorted + de-duped', () => {
    const e = { overtimeDays: ['2026-05-22', '2026-05-15', '2026-05-22'] };
    EmployeeFactory.normalize(e);
    assert.deepEqual(e.overtimeDays, ['2026-05-15', '2026-05-22']);
  });

  test('non-array (string) is parsed via Utils.parseDateList', () => {
    const e = { overtimeDays: '2026-05-15, 2026-05-22' };
    EmployeeFactory.normalize(e);
    assert.ok(Array.isArray(e.overtimeDays));
    assert.equal(e.overtimeDays.length, 2);
  });

  test('empty input → empty array', () => {
    const e = { overtimeDays: '' };
    EmployeeFactory.normalize(e);
    assert.deepEqual(e.overtimeDays, []);
  });
});

describe('EmployeeFactory.normalize — booleans', () => {
  test('weekdayReady "true" / "Yes" / "Да" → true', () => {
    for (const v of [true, 'true', 'Yes', 'Да', 'TRUE', 1, '1']) {
      const e = { weekdayReady: v };
      EmployeeFactory.normalize(e);
      assert.equal(e.weekdayReady, true, `weekdayReady=${JSON.stringify(v)} should be true`);
    }
  });

  test('weekdayReady falsy → false', () => {
    for (const v of [false, '', 'No', 'Нет', 0, null, undefined]) {
      const e = { weekdayReady: v };
      EmployeeFactory.normalize(e);
      assert.equal(e.weekdayReady, false, `weekdayReady=${JSON.stringify(v)} should be false`);
    }
  });
});

describe('EmployeeFactory round-trip (create → normalize idempotent)', () => {
  test('normalize() is idempotent — running twice yields same result', () => {
    const e = EmployeeFactory.create({
      fio: 'Иванов',
      roles: 'Backend, QA',
      teams: 'Mobile|',
      overtimeDays: ['2026-05-22','2026-05-15'],
      weekdayReady: 'Да',
      weekdayComment: 'short, comment',
    });
    const snapshot = JSON.stringify({
      fio: e.fio, roles: e.roles, teams: e.teams,
      overtimeDays: e.overtimeDays, weekdayReady: e.weekdayReady,
      weekdayComment: e.weekdayComment,
    });
    EmployeeFactory.normalize(e);
    EmployeeFactory.normalize(e);
    const after = JSON.stringify({
      fio: e.fio, roles: e.roles, teams: e.teams,
      overtimeDays: e.overtimeDays, weekdayReady: e.weekdayReady,
      weekdayComment: e.weekdayComment,
    });
    assert.equal(snapshot, after, 'normalize must be idempotent');
  });
});
