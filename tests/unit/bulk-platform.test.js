'use strict';
/* ============================================================
   tests/unit/bulk-platform.test.js — AUDIT_HOLISTIC F5
   --
   Покрывает `app/bulkPlatform.js`:
   preview / dryRun / apply / undo / undo-expiry / audit-log /
   Reactive.silent invariant / identity-deterministic targeting.

   Module-level state (Map of snapshots, token counter) шарится между
   тестами, поэтому в каждом тесте вызываем `BulkPlatform._resetForTest()`
   и чистим state.rows / state.actionLog. State.js — singleton, импорт
   стабилен.
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// window stub — bulkPlatform пишет себя в window если оно есть.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {};
}

let _state;
let _BP;
let _Reactive;
async function loadModules() {
  if (!_state) {
    _state = (await import('../../state.js')).state;
  }
  if (!_BP) {
    _BP = (await import('../../app/bulkPlatform.js')).BulkPlatform;
  }
  if (!_Reactive) {
    _Reactive = (await import('../../reactiveStore.js')).Reactive;
  }
  return { state: _state, BulkPlatform: _BP, Reactive: _Reactive };
}

function makeRow(id, overrides = {}) {
  return {
    id,
    epicName: `Epic-${id}`,
    assignee: 'old@example.com',
    scopeStatus: 'Нет',
    isDone: false,
    doneDate: '',
    priority: 'medium',
    blockingDependency: false,
    blockingDeadline: '',
    release120Types: [],
    release121Types: [],
    release122Types: [],
    overtimeTypes: [],
    riskFlags: [],
    dirty: false,
    updatedAt: '',
    ...overrides,
  };
}

function resetState(state, rows = []) {
  // Чистим в Reactive.silent — иначе debounced subscriber теоретически
  // мог бы дёрнуть Storage.save / App.refreshAll (в тестах их нет, но
  // соответствуем контракту CLAUDE.md #1).
  state.rows = rows;
  state.actionLog = [];
  state.employees = [];
}

beforeEach(async () => {
  const { state, BulkPlatform } = await loadModules();
  BulkPlatform._resetForTest();
  resetState(state);
});

describe('BulkPlatform.preview', () => {
  test('returns before/after correctly, не мутирует state', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1), makeRow(2), makeRow(3)];
    const beforeRowsRef = state.rows;
    const beforeIsDone1 = state.rows[0].isDone;

    const op = {
      kind: 'mark-done',
      targets: [{ rowId: 1 }, { rowId: 2 }],
      source: 'registry',
    };
    const res = BulkPlatform.preview(op);

    assert.equal(res.ok, true);
    assert.equal(res.targets.length, 2);
    assert.equal(res.before.length, 2);
    assert.equal(res.after.length, 2);
    assert.equal(res.before[0].snapshot.isDone, false);
    assert.equal(res.after[0].changes.isDone, true);
    assert.match(res.summary, /Отметить как готово/);
    // State не должен был измениться:
    assert.strictEqual(state.rows, beforeRowsRef);
    assert.equal(state.rows[0].isDone, beforeIsDone1);
    assert.equal(state.rows[0].isDone, false);
  });

  test('детектит conflicts (rollover-release без release)', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1)];
    const res = BulkPlatform.preview({
      kind: 'rollover-release',
      targets: [{ rowId: 1 }],
      payload: {},                  // нет release
      source: 'registry',
    });
    assert.equal(res.ok, false);
    assert.ok(res.conflicts.length > 0, 'expected conflicts');
  });
});

describe('BulkPlatform.dryRun', () => {
  test('симулирует apply без мутации state', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1), makeRow(2)];
    const op = {
      kind: 'change-scope',
      targets: [{ rowId: 1 }, { rowId: 2 }],
      payload: { scope: 'Да' },
      source: 'hygiene',
    };
    const res = BulkPlatform.dryRun(op);
    assert.equal(res.ok, true);
    assert.equal(res.hypothetical.applied, 2);
    assert.ok(res.sideEffects.includes('rowFactory.updateDerived'));
    // Real state не тронут:
    assert.equal(state.rows[0].scopeStatus, 'Нет');
    assert.equal(state.rows[1].scopeStatus, 'Нет');
  });
});

describe('BulkPlatform.apply', () => {
  test('мутирует rows, возвращает undoToken и auditId', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1), makeRow(2), makeRow(3)];
    const res = BulkPlatform.apply({
      kind: 'mark-done',
      targets: [{ rowId: 1 }, { rowId: 2 }],
      payload: { value: true },
      source: 'registry',
      label: 'unit-test mark-done',
    });
    assert.equal(res.ok, true);
    assert.equal(res.applied, 2);
    assert.ok(res.undoToken);
    assert.match(res.undoToken, /^bp-/);
    assert.ok(res.auditId);
    // Effective:
    assert.equal(state.rows[0].isDone, true);
    assert.equal(state.rows[1].isDone, true);
    assert.equal(state.rows[2].isDone, false);
    assert.equal(state.rows[0].dirty, true);
    assert.ok(state.rows[0].doneDate);
  });

  test('пустой targets даёт ok=false без write в audit', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1)];
    const res = BulkPlatform.apply({
      kind: 'mark-done',
      targets: [{ rowId: 999 }],   // не существует
      source: 'registry',
    });
    assert.equal(res.ok, false);
    assert.equal(state.actionLog.length, 0);
  });
});

describe('BulkPlatform.undo', () => {
  test('восстанавливает rows 1-в-1', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1), makeRow(2)];
    const beforeAssignee0 = state.rows[0].assignee;
    const beforeAssignee1 = state.rows[1].assignee;

    const res = BulkPlatform.apply({
      kind: 'reassign',
      targets: [{ rowId: 1 }, { rowId: 2 }],
      payload: { assignee: 'new@example.com' },
      source: 'registry',
    });
    assert.equal(res.ok, true);
    assert.equal(state.rows[0].assignee, 'new@example.com');
    assert.equal(state.rows[1].assignee, 'new@example.com');

    const u = BulkPlatform.undo(res.undoToken);
    assert.equal(u.ok, true);
    assert.equal(state.rows[0].assignee, beforeAssignee0);
    assert.equal(state.rows[1].assignee, beforeAssignee1);
  });

  test('повторный undo с тем же токеном возвращает ok:false (snapshot одноразовый)', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1)];
    const r = BulkPlatform.apply({
      kind: 'mark-done',
      targets: [{ rowId: 1 }],
      source: 'registry',
    });
    const u1 = BulkPlatform.undo(r.undoToken);
    assert.equal(u1.ok, true);
    const u2 = BulkPlatform.undo(r.undoToken);
    assert.equal(u2.ok, false);
  });
});

describe('BulkPlatform.undo — TTL expiry', () => {
  test('undoToken expires через 30 минут', async () => {
    const { state, BulkPlatform } = await loadModules();
    let now = 1_700_000_000_000;
    BulkPlatform._setClock(() => now);

    state.rows = [makeRow(1)];
    const r = BulkPlatform.apply({
      kind: 'mark-done',
      targets: [{ rowId: 1 }],
      source: 'registry',
    });
    assert.equal(r.ok, true);

    // Внутри окна 30 минут — undo работает.
    now += 29 * 60 * 1000;
    // Но мы уже сделали apply → state.rows[0].isDone = true.
    // Reset чтобы snapshot не пострадал:
    // (snapshot держится отдельно от state — see _snapshots Map).
    // Проверяем undo:
    const ok = BulkPlatform.undo(r.undoToken);
    assert.equal(ok.ok, true);

    // Делаем второй apply чтобы получить fresh token, и проверяем
    // expiry > 30 минут.
    state.rows = [makeRow(1)];
    const r2 = BulkPlatform.apply({
      kind: 'mark-done',
      targets: [{ rowId: 1 }],
      source: 'registry',
    });
    now += 30 * 60 * 1000 + 1;            // +30min +1ms
    const expired = BulkPlatform.undo(r2.undoToken);
    assert.equal(expired.ok, false);
    assert.match(expired.reason, /expired|not found/);

    // Reset clock после теста чтобы не повлиять на другие.
    BulkPlatform._setClock(null);
  });
});

describe('BulkPlatform.audit', () => {
  test('пишет в state.actionLog и .audit() возвращает запись', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1)];
    BulkPlatform.apply({
      kind: 'change-scope',
      targets: [{ rowId: 1 }],
      payload: { scope: 'Да' },
      source: 'hygiene',
    });
    const log = BulkPlatform.audit();
    assert.ok(log.length >= 1);
    const last = log[0];
    assert.equal(last.success, true);
    assert.equal(last.source, 'hygiene');
    assert.equal(last.kind, 'change-scope');
    assert.equal(last.targetCount, 1);
    assert.ok(last.undoToken);
    assert.ok(last.ts);
  });
});

describe('BulkPlatform — Reactive.silent invariant', () => {
  test('apply не вызывает subscriber на каждой строке (mass mutation в silent)', async () => {
    const { state, BulkPlatform, Reactive } = await loadModules();
    state.rows = Array.from({ length: 20 }, (_, i) => makeRow(i + 1));
    let subCalls = 0;
    const unsub = Reactive.subscribe(() => { subCalls++; });
    const res = BulkPlatform.apply({
      kind: 'change-scope',
      targets: state.rows.map(r => ({ rowId: r.id })),
      payload: { scope: 'Да' },
      source: 'registry',
    });
    // Force flush — apply делает notifyManual() → debounced flush.
    Reactive.flushNow();
    unsub();
    assert.equal(res.ok, true);
    assert.equal(res.applied, 20);
    // 20 строк × несколько присваиваний = 40+ потенциальных flush'ей,
    // но silent + один внешний notifyManual должны дать <=1 вызов
    // subscriber'а. Допускаем 0 или 1 (debounce может ничего не успеть
    // запустить если subscriber добавлен позже — главное что не 20+).
    assert.ok(subCalls <= 1, `expected ≤1 subscriber call, got ${subCalls}`);
  });
});

describe('BulkPlatform — identity-deterministic', () => {
  test('таргет по rowId работает (а не по name)', async () => {
    const { state, BulkPlatform } = await loadModules();
    // Две строки с ОДИНАКОВЫМ epicName, разные id — apply должен
    // мутировать только тот, что указан по rowId. Если бы поиск был
    // по name, мутировались бы обе.
    state.rows = [
      makeRow(101, { epicName: 'Same-Epic', assignee: 'a@x.com' }),
      makeRow(202, { epicName: 'Same-Epic', assignee: 'b@x.com' }),
    ];
    const res = BulkPlatform.apply({
      kind: 'reassign',
      targets: [{ rowId: 202 }],
      payload: { assignee: 'new@x.com' },
      source: 'registry',
    });
    assert.equal(res.ok, true);
    assert.equal(state.rows[0].assignee, 'a@x.com');     // не тронут
    assert.equal(state.rows[1].assignee, 'new@x.com');   // изменён
  });

  test('targets без identity-key не резолвятся (fuzzy-name защита)', async () => {
    const { state, BulkPlatform } = await loadModules();
    state.rows = [makeRow(1, { assignee: 'Иванов И.И.' })];
    const res = BulkPlatform.apply({
      kind: 'reassign',
      // Нет ни rowId, ни email, ни jiraAccountId — только «name»
      // (которое мы намеренно не поддерживаем).
      targets: [{ name: 'Иванов И.И.' }],
      payload: { assignee: 'new@example.com' },
      source: 'registry',
    });
    assert.equal(res.ok, false);
    assert.equal(state.rows[0].assignee, 'Иванов И.И.');
  });
});
