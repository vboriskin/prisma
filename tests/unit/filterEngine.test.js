'use strict';
/* ============================================================
   tests/unit/filterEngine.test.js — V21 BF (audit-08 critical-zero-coverage)
   --
   Покрывает FilterEngine.getFiltered + getActiveCount + getTeams/Roles/Assignees.
   FilterEngine читает state.rows + state.filters глобально, поэтому каждый test
   получает fresh import + reset state. Cache invalidation тоже проверяется.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Canonical imports (без cache-busting) — оба модуля делят один state-объект.
// Test isolation через resetFilters + state.rows = [...] на старте каждого теста.
import { state } from '../../state.js';
import { FilterEngine } from '../../filters.js';

function makeRow(overrides = {}) {
  return {
    id: 'r1', team: 'Team A', category: '', tags: '',
    epic: 'Test epic', tasks: 'TASK-1', taskComment: '', comment: '',
    role: '', assignee: '',
    scopeStatus: 'Да',
    hasRelease120: false, hasRelease121: false, hasRelease122: false, hasOvertime: false,
    isUnassigned: false,
    release120Types: [], release121Types: [], release122Types: [], overtimeTypes: [],
    blockingDependency: false, riskFlags: [], isDone: false,
    ...overrides,
  };
}

function resetFilters(state) {
  state.filters = {
    search: '', team: '', scope: '', release: '', workType: '',
    role: '', assignee: '', tag: '',
    onlyBlocking: false, onlyRisky: false, onlyDone: false,
  };
}

describe('FilterEngine.getFiltered — single-dim filters', () => {
  test('search matches text in epic, team, tasks (case-insensitive)', () => {
    state.rows = [
      makeRow({ id: '1', epic: 'Login flow' }),
      makeRow({ id: '2', epic: 'Search bar' }),
      makeRow({ id: '3', epic: 'Profile page' }),
    ];
    resetFilters(state);
    state.filters.search = 'LOGIN';
    state._dataVersion = 1;
    FilterEngine.invalidate();
    const out = FilterEngine.getFiltered();
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '1');
  });

  test('team filter exact-match', () => {
    state.rows = [
      makeRow({ id: '1', team: 'A' }),
      makeRow({ id: '2', team: 'B' }),
      makeRow({ id: '3', team: 'A' }),
    ];
    resetFilters(state);
    state.filters.team = 'A';
    state._dataVersion = 2;
    FilterEngine.invalidate();
    assert.equal(FilterEngine.getFiltered().length, 2);
  });

  test('release="1.21" фильтрует только hasRelease121=true', () => {
    state.rows = [
      makeRow({ id: '1', hasRelease121: true }),
      makeRow({ id: '2', hasRelease120: true }),
      makeRow({ id: '3', hasRelease121: true, hasRelease122: true }),
    ];
    resetFilters(state);
    state.filters.release = '1.21';
    state._dataVersion = 3;
    FilterEngine.invalidate();
    const out = FilterEngine.getFiltered();
    assert.equal(out.length, 2);
  });

  test('release="none" — только isUnassigned', () => {
    state.rows = [
      makeRow({ id: '1', isUnassigned: true }),
      makeRow({ id: '2', hasRelease120: true }),
    ];
    resetFilters(state);
    state.filters.release = 'none';
    state._dataVersion = 4;
    FilterEngine.invalidate();
    assert.equal(FilterEngine.getFiltered().length, 1);
  });

  test('onlyBlocking фильтрует blockingDependency', () => {
    state.rows = [
      makeRow({ id: '1', blockingDependency: true }),
      makeRow({ id: '2', blockingDependency: false }),
    ];
    resetFilters(state);
    state.filters.onlyBlocking = true;
    state._dataVersion = 5;
    FilterEngine.invalidate();
    assert.equal(FilterEngine.getFiltered().length, 1);
  });

  test('onlyRisky фильтрует riskFlags.length > 0', () => {
    state.rows = [
      makeRow({ id: '1', riskFlags: ['no-estimate'] }),
      makeRow({ id: '2', riskFlags: [] }),
    ];
    resetFilters(state);
    state.filters.onlyRisky = true;
    state._dataVersion = 6;
    FilterEngine.invalidate();
    assert.equal(FilterEngine.getFiltered().length, 1);
  });

  test('role multi-value (array) — OR semantics', () => {
    state.rows = [
      makeRow({ id: '1', role: 'BE' }),
      makeRow({ id: '2', role: 'FE' }),
      makeRow({ id: '3', role: 'QA' }),
    ];
    resetFilters(state);
    state.filters.role = ['BE', 'FE'];
    state._dataVersion = 7;
    FilterEngine.invalidate();
    assert.equal(FilterEngine.getFiltered().length, 2);
  });

  test('tag with comma-separated row tags split on [|,]', () => {
    state.rows = [
      makeRow({ id: '1', tags: 'BE, FE' }),    // comma-separated
      makeRow({ id: '2', tags: 'QA|Auto' }),   // pipe-separated
      makeRow({ id: '3', tags: 'Other' }),
    ];
    resetFilters(state);
    state.filters.tag = ['FE'];
    state._dataVersion = 8;
    FilterEngine.invalidate();
    const out = FilterEngine.getFiltered();
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '1');
  });
});

describe('FilterEngine.getFiltered — multi-dim AND', () => {
  test('team + onlyDone комбинируются как AND', () => {
    state.rows = [
      makeRow({ id: '1', team: 'A', isDone: true }),
      makeRow({ id: '2', team: 'A', isDone: false }),
      makeRow({ id: '3', team: 'B', isDone: true }),
    ];
    resetFilters(state);
    state.filters.team = 'A';
    state.filters.onlyDone = true;
    state._dataVersion = 9;
    FilterEngine.invalidate();
    assert.equal(FilterEngine.getFiltered().length, 1);
  });
});

describe('FilterEngine.getFiltered — cache', () => {
  test('повторный вызов с тем же state возвращает тот же array (cache hit)', () => {
    state.rows = [makeRow({ id: '1' })];
    resetFilters(state);
    state._dataVersion = 10;
    FilterEngine.invalidate();
    const a = FilterEngine.getFiltered();
    const b = FilterEngine.getFiltered();
    assert.strictEqual(a, b, 'cache returns same array reference');
  });

  test('изменение _dataVersion инвалидирует cache', () => {
    state.rows = [makeRow({ id: '1' })];
    resetFilters(state);
    state._dataVersion = 11;
    FilterEngine.invalidate();
    const a = FilterEngine.getFiltered();
    state._dataVersion = 12;
    const b = FilterEngine.getFiltered();
    assert.notStrictEqual(a, b);
  });

  test('invalidate() сбрасывает cache', () => {
    state.rows = [makeRow({ id: '1' })];
    resetFilters(state);
    state._dataVersion = 13;
    const a = FilterEngine.getFiltered();
    FilterEngine.invalidate();
    const b = FilterEngine.getFiltered();
    assert.notStrictEqual(a, b);
  });
});

describe('FilterEngine.getActiveCount', () => {
  test('пустые фильтры → 0', () => {
    resetFilters(state);
    assert.equal(FilterEngine.getActiveCount(), 0);
  });

  test('один фильтр → 1', () => {
    resetFilters(state);
    state.filters.team = 'A';
    assert.equal(FilterEngine.getActiveCount(), 1);
  });

  test('multi-value role array счёт = 1 (a not N)', () => {
    resetFilters(state);
    state.filters.role = ['BE', 'FE', 'QA'];
    assert.equal(FilterEngine.getActiveCount(), 1, 'array filter counts as 1 dimension');
  });

  test('пустой array role не считается', () => {
    resetFilters(state);
    state.filters.role = [];
    assert.equal(FilterEngine.getActiveCount(), 0);
  });

  test('все 11 dimensions — counts 11', () => {
    state.filters = {
      search: 'x', team: 'A', scope: 'Да', release: '1.21', workType: 'BE',
      role: ['BE'], assignee: ['Иван'], tag: ['fe'],
      onlyBlocking: true, onlyRisky: true, onlyDone: true,
    };
    assert.equal(FilterEngine.getActiveCount(), 11);
  });
});

describe('FilterEngine.getTeams / getRoles / getAssignees', () => {
  test('getTeams unique + sorted', () => {
    state.rows = [
      makeRow({ team: 'B' }),
      makeRow({ team: 'A' }),
      makeRow({ team: 'A' }),
      makeRow({ team: 'C' }),
    ];
    state.employees = [];
    const teams = FilterEngine.getTeams();
    assert.deepEqual(teams, ['A', 'B', 'C']);
  });

  test('getRoles splits on pipe + sorted', () => {
    state.rows = [
      makeRow({ role: 'BE|FE' }),
      makeRow({ role: 'QA' }),
      makeRow({ role: 'BE' }),
    ];
    state.employees = [];
    const roles = FilterEngine.getRoles();
    assert.ok(roles.includes('BE'));
    assert.ok(roles.includes('FE'));
    assert.ok(roles.includes('QA'));
  });

  test('getAssignees добавляет fio из employees', () => {
    state.rows = [makeRow({ assignee: 'Anna' })];
    state.employees = [{ fio: 'Boris' }, { fio: 'Anna' }];
    const list = FilterEngine.getAssignees();
    assert.ok(list.includes('Anna'));
    assert.ok(list.includes('Boris'));
  });
});
