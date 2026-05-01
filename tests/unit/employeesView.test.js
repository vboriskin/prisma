'use strict';
/* ============================================================
   tests/unit/employeesView.test.js
   --
   System tests for V14 EmployeesView pure helpers:
     · _applyFilters(employees) — team / role / OT-date-range / only-with-OT
     · _applySort(list)         — ФИО / role / team / otDays + asc/desc
     · _splitTags(raw)          — pipe + comma tokenisation

   These are deliberately data-only tests — no DOM, no Storage. Catches
   filter/sort drift early without needing a full browser stub.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// EmployeesView imports state.js + filters.js + dataStore.js + components.
// The stubs below just need to be present — internal calls during tests
// hit static helpers only, not stateful methods.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
globalThis.window       = { addEventListener: () => {}, App: {} };
globalThis.document     = { getElementById: () => null, createElement: () => ({ appendChild() {}, addEventListener() {}, classList:{add(){},remove(){},toggle(){}}, querySelector(){return null;}, querySelectorAll(){return [];}, style:{} }), querySelector: () => null, querySelectorAll: () => [], body: { appendChild() {} } };

const { EmployeesView } = await import('../../views/employees.js');

const mkEmp = (over = {}) => ({
  id: 'e' + Math.random().toString(36).slice(2,8),
  fio: 'Иванов Иван',
  roles: '',
  teams: '',
  overtimeDays: [],
  weekdayReady: false,
  weekdayComment: '',
  ...over,
});

beforeEach(() => {
  EmployeesView._sort   = { field: 'fio', dir: 'asc' };
  EmployeesView._filter = { team: '', role: '', otFrom: '', otTo: '', onlyWithOt: false };
});

describe('EmployeesView._splitTags', () => {
  test('splits on pipe', () => {
    assert.deepEqual(EmployeesView._splitTags('a|b|c'), ['a','b','c']);
  });
  test('splits on comma', () => {
    assert.deepEqual(EmployeesView._splitTags('a, b, c'), ['a','b','c']);
  });
  test('mixed pipe + comma', () => {
    assert.deepEqual(EmployeesView._splitTags('a|b, c'), ['a','b','c']);
  });
  test('empty / null returns []', () => {
    assert.deepEqual(EmployeesView._splitTags(''), []);
    assert.deepEqual(EmployeesView._splitTags(null), []);
    assert.deepEqual(EmployeesView._splitTags(undefined), []);
  });
  test('trims whitespace tokens', () => {
    assert.deepEqual(EmployeesView._splitTags('  a  |  b  '), ['a','b']);
  });
});

describe('EmployeesView._applyFilters', () => {
  test('empty filter passes everything', () => {
    const emps = [mkEmp(), mkEmp(), mkEmp()];
    assert.equal(EmployeesView._applyFilters(emps).length, 3);
  });

  test('team filter is case-insensitive', () => {
    const emps = [
      mkEmp({ teams: 'Mobile|Backend' }),
      mkEmp({ teams: 'Frontend' }),
    ];
    EmployeesView._filter.team = 'mobile';
    const r = EmployeesView._applyFilters(emps);
    assert.equal(r.length, 1);
    assert.equal(r[0].teams, 'Mobile|Backend');
  });

  test('role filter — case-insensitive, single match', () => {
    const emps = [
      mkEmp({ roles: 'Backend' }),
      mkEmp({ roles: 'QA' }),
      mkEmp({ roles: 'BACKEND|Lead' }),
    ];
    EmployeesView._filter.role = 'backend';
    const r = EmployeesView._applyFilters(emps);
    assert.equal(r.length, 2);
  });

  test('onlyWithOt drops empty overtimeDays', () => {
    const emps = [
      mkEmp({ overtimeDays: ['2026-05-15'] }),
      mkEmp({ overtimeDays: [] }),
      mkEmp({ overtimeDays: ['2026-05-22','2026-06-10'] }),
    ];
    EmployeesView._filter.onlyWithOt = true;
    const r = EmployeesView._applyFilters(emps);
    assert.equal(r.length, 2);
  });

  test('OT date range — returns only employees with at least one matching day', () => {
    const emps = [
      mkEmp({ fio: 'A', overtimeDays: ['2026-04-15'] }),     // out
      mkEmp({ fio: 'B', overtimeDays: ['2026-05-10'] }),     // in (range starts 2026-05-01)
      mkEmp({ fio: 'C', overtimeDays: ['2026-05-25','2026-06-25'] }),
      mkEmp({ fio: 'D', overtimeDays: [] }),                 // out (empty)
    ];
    EmployeesView._filter.otFrom = '2026-05-01';
    EmployeesView._filter.otTo   = '2026-05-31';
    const r = EmployeesView._applyFilters(emps);
    const fios = r.map(e => e.fio).sort();
    assert.deepEqual(fios, ['B','C']);
  });

  test('combination — team AND role both filter', () => {
    const emps = [
      mkEmp({ teams: 'Mobile', roles: 'Backend' }),
      mkEmp({ teams: 'Mobile', roles: 'QA' }),
      mkEmp({ teams: 'Backend', roles: 'Backend' }),
    ];
    EmployeesView._filter.team = 'Mobile';
    EmployeesView._filter.role = 'Backend';
    const r = EmployeesView._applyFilters(emps);
    assert.equal(r.length, 1);
  });
});

describe('EmployeesView._applySort', () => {
  test('default — ФИО asc', () => {
    EmployeesView._sort = { field: 'fio', dir: 'asc' };
    const emps = [
      mkEmp({ fio: 'Сидоров' }),
      mkEmp({ fio: 'Иванов' }),
      mkEmp({ fio: 'Петров' }),
    ];
    const r = EmployeesView._applySort(emps).map(e => e.fio);
    assert.deepEqual(r, ['Иванов', 'Петров', 'Сидоров']);
  });

  test('ФИО desc reverses order', () => {
    EmployeesView._sort = { field: 'fio', dir: 'desc' };
    const emps = [
      mkEmp({ fio: 'Иванов' }),
      mkEmp({ fio: 'Петров' }),
    ];
    const r = EmployeesView._applySort(emps).map(e => e.fio);
    assert.deepEqual(r, ['Петров', 'Иванов']);
  });

  test('otDays sort uses count, not array contents', () => {
    EmployeesView._sort = { field: 'otDays', dir: 'desc' };
    const emps = [
      mkEmp({ fio: 'A', overtimeDays: ['2026-05-15'] }),
      mkEmp({ fio: 'B', overtimeDays: [] }),
      mkEmp({ fio: 'C', overtimeDays: ['2026-05-15','2026-06-10','2026-07-12'] }),
    ];
    const r = EmployeesView._applySort(emps).map(e => e.fio);
    assert.deepEqual(r, ['C', 'A', 'B']);
  });

  test('role sort — uses FIRST role from pipe-list', () => {
    EmployeesView._sort = { field: 'role', dir: 'asc' };
    const emps = [
      mkEmp({ fio: 'A', roles: 'QA|Lead' }),
      mkEmp({ fio: 'B', roles: 'Backend' }),
      mkEmp({ fio: 'C', roles: 'Frontend' }),
    ];
    const r = EmployeesView._applySort(emps).map(e => e.fio);
    assert.deepEqual(r, ['B', 'C', 'A']);
  });

  test('tie-break by ФИО asc keeps order stable', () => {
    EmployeesView._sort = { field: 'team', dir: 'asc' };
    const emps = [
      mkEmp({ fio: 'Сидоров', teams: 'X' }),
      mkEmp({ fio: 'Иванов',  teams: 'X' }),
      mkEmp({ fio: 'Петров',  teams: 'X' }),
    ];
    const r = EmployeesView._applySort(emps).map(e => e.fio);
    // All same team → fall back to ФИО asc
    assert.deepEqual(r, ['Иванов', 'Петров', 'Сидоров']);
  });

  test('does not mutate input array', () => {
    const emps = [
      mkEmp({ fio: 'B' }),
      mkEmp({ fio: 'A' }),
    ];
    const orig = emps.map(e => e.fio);
    EmployeesView._applySort(emps);
    assert.deepEqual(emps.map(e => e.fio), orig, 'input array must remain in original order');
  });
});
