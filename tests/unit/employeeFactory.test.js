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

/* ──────────────────────────────────────────────────────────
   V20 S4 — Service-account auto-detect (pattern-based)
   ────────────────────────────────────────────────────────── */

describe('EmployeeFactory.detectServiceAccount — pattern detection', () => {
  test('cab-sa- prefix → service account', () => {
    const e = EmployeeFactory.create({ jiraKey: 'cab-sa-jira0008' });
    assert.equal(e.isServiceAccount, true);
  });

  test('sbt- prefix → service account', () => {
    assert.equal(EmployeeFactory.create({ jiraKey: 'sbt-issue-managment-user' }).isServiceAccount, true);
    assert.equal(EmployeeFactory.create({ jiraKey: 'sbt-sbbol' }).isServiceAccount, true);
  });

  test('out- prefix → service account', () => {
    assert.equal(EmployeeFactory.create({ jiraKey: 'out-dinov-rk' }).isServiceAccount, true);
  });

  test('svc- / bot- / system- prefixes', () => {
    assert.equal(EmployeeFactory.create({ jiraKey: 'svc-deploy-bot' }).isServiceAccount, true);
    assert.equal(EmployeeFactory.create({ jiraKey: 'bot-jenkins' }).isServiceAccount, true);
    assert.equal(EmployeeFactory.create({ jiraKey: 'system-monitoring' }).isServiceAccount, true);
  });

  test('обычные jirauserNNNN — НЕ service account', () => {
    assert.equal(EmployeeFactory.create({ jiraKey: 'jirauser1675763' }).isServiceAccount, false);
    assert.equal(EmployeeFactory.create({ jiraKey: 'ivanov-ii' }).isServiceAccount, false);
    assert.equal(EmployeeFactory.create({ jiraKey: 'medvedev-vg' }).isServiceAccount, false);
  });

  test('пустой jiraKey → false (не паникуем)', () => {
    assert.equal(EmployeeFactory.create({}).isServiceAccount, false);
  });

  test('явный override true сохраняется (не перезаписываем)', () => {
    const e = EmployeeFactory.create({ jiraKey: 'ivanov-ii', isServiceAccount: true });
    assert.equal(e.isServiceAccount, true);
  });

  test('явный override false сохраняется на bot-pattern', () => {
    // Если автодетект ошибся — пользователь может вручную убрать флаг.
    const e = EmployeeFactory.create({ jiraKey: 'sbt-real-person', isServiceAccount: false });
    assert.equal(e.isServiceAccount, false);
  });

  test('infix patterns: -bot- / -svc- / -api-', () => {
    assert.equal(EmployeeFactory.create({ jiraKey: 'team-bot-jira1' }).isServiceAccount, true);
    assert.equal(EmployeeFactory.create({ jiraKey: 'foo-api-bar' }).isServiceAccount, true);
  });

  test('detectServiceAccount как чистая функция', () => {
    assert.equal(EmployeeFactory.detectServiceAccount({ jiraKey: 'sbt-bot' }), true);
    assert.equal(EmployeeFactory.detectServiceAccount({ jiraKey: 'normal-user' }), false);
    assert.equal(EmployeeFactory.detectServiceAccount({}), false);
  });
});
