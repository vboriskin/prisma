'use strict';
/* ============================================================
   V17.2 I5 — auto-fill employee identity from Pulse data
   Pure unit test of `_autofillEmployeeIdentities`.
   ============================================================ */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage / showToast / Storage so portfolioPulse.js imports cleanly.
globalThis.localStorage = globalThis.localStorage || {
  _data: new Map(),
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; },
  setItem(k, v) { this._data.set(k, String(v)); },
  removeItem(k) { this._data.delete(k); },
  clear() { this._data.clear(); },
  key(i) { return [...this._data.keys()][i] || null; },
  get length() { return this._data.size; },
};

const { __testing } = await import('../../integrations/portfolioPulse.js');
const { _autofillEmployeeIdentities } = __testing;

describe('V17.2 I5 — _autofillEmployeeIdentities', () => {
  test('заполняет email сотруднику с тем же ФИО что у участника', () => {
    const emp = { fio: 'Иван Иванов', email: '', jiraAccountId: '' };
    const model = { participants: [
      { label: 'Иван Иванов', email: 'ivan@example.com', jiraAccountId: '5b10a2844c20165700ede21g' },
    ]};
    const r = _autofillEmployeeIdentities(model, [emp]);
    assert.equal(r.updated, 1);
    assert.equal(r.ambiguous, 0);
    assert.equal(emp.email, 'ivan@example.com');
    assert.equal(emp.jiraAccountId, '5b10a2844c20165700ede21g');
  });

  test('НЕ перезаписывает уже заполненный email (manual wins)', () => {
    const emp = { fio: 'Иван Иванов', email: 'manual@company.com', jiraAccountId: '' };
    const model = { participants: [
      { label: 'Иван Иванов', email: 'ivan@example.com', jiraAccountId: 'jira-id' },
    ]};
    const r = _autofillEmployeeIdentities(model, [emp]);
    assert.equal(r.updated, 1, 'jiraAccountId всё-таки заполнили');
    assert.equal(emp.email, 'manual@company.com', 'manual email сохранён');
    // F4: normalize() lowercase'ит jiraAccountId.
    assert.equal(emp.jiraAccountId, 'jira-id');
  });

  test('пропускает ambiguous (двое сотрудников с одинаковым ФИО)', () => {
    const emp1 = { fio: 'Иван Иванов', email: '' };
    const emp2 = { fio: 'Иван Иванов', email: '' };
    const model = { participants: [
      { label: 'Иван Иванов', email: 'ivan@example.com', jiraAccountId: 'X' },
    ]};
    const r = _autofillEmployeeIdentities(model, [emp1, emp2]);
    assert.equal(r.updated, 0);
    assert.equal(r.ambiguous, 1);
    assert.equal(emp1.email, '');
    assert.equal(emp2.email, '');
  });

  test('нормализует ФИО: trim + collapse spaces + case-insensitive', () => {
    const emp = { fio: '  ИВАН    Иванов  ', email: '' };
    const model = { participants: [
      { label: 'иван иванов', email: 'ivan@example.com' },
    ]};
    const r = _autofillEmployeeIdentities(model, [emp]);
    assert.equal(r.updated, 1);
    assert.equal(emp.email, 'ivan@example.com');
  });

  test('пропускает участника без email и без accountId', () => {
    const emp = { fio: 'Иван Иванов', email: '' };
    const model = { participants: [
      { label: 'Иван Иванов', email: '', jiraAccountId: '' },
    ]};
    const r = _autofillEmployeeIdentities(model, [emp]);
    assert.equal(r.updated, 0);
    assert.equal(r.ambiguous, 0);
    assert.equal(emp.email, '');
  });

  test('возвращает {0, 0} при пустых входных данных', () => {
    assert.deepEqual(_autofillEmployeeIdentities(null, []), { updated: 0, ambiguous: 0 });
    assert.deepEqual(_autofillEmployeeIdentities({ participants: [] }, []), { updated: 0, ambiguous: 0 });
    assert.deepEqual(_autofillEmployeeIdentities({}, [{ fio: 'X' }]), { updated: 0, ambiguous: 0 });
  });

  test('заполняет только jiraAccountId если email уже стоит', () => {
    const emp = { fio: 'Иван Иванов', email: 'ivan@example.com', jiraAccountId: '' };
    const model = { participants: [
      { label: 'Иван Иванов', email: '', jiraAccountId: 'JIRA-ACC-1' },
    ]};
    const r = _autofillEmployeeIdentities(model, [emp]);
    assert.equal(r.updated, 1);
    // F4: normalize() lowercase'ит jiraAccountId.
    assert.equal(emp.jiraAccountId, 'jira-acc-1');
    assert.equal(emp.email, 'ivan@example.com', 'email не тронут');
  });

  test('пропускает employee без ФИО', () => {
    const emp = { fio: '', email: '' };
    const model = { participants: [
      { label: 'Иван Иванов', email: 'ivan@example.com' },
    ]};
    const r = _autofillEmployeeIdentities(model, [emp]);
    assert.equal(r.updated, 0);
  });
});
