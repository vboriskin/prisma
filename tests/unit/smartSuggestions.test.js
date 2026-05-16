'use strict';
/* tests/unit/smartSuggestions.test.js — V22+ Phase 4 (K-K4). */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('smartSuggestions', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('null/empty focus → []', async () => {
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    assert.deepEqual(generateSuggestions(null), []);
    assert.deepEqual(generateSuggestions({}), []);
    assert.deepEqual(generateSuggestions({ kind: 'employee' }), []);
  });

  test('employee focus → 6 chips про сотрудника', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван', jiraAccountId: 'jaid-1' }],
    });
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    const chips = generateSuggestions({ kind: 'employee', id: 'iv@sber.ru' });
    assert.equal(chips.length, 6);
    assert.ok(chips.some(c => /Bitbucket|BB/.test(c.label)));
    assert.ok(chips.some(c => /Блокеры/.test(c.label)));
    assert.ok(chips.some(c => /квартал/i.test(c.label)));
    assert.ok(chips.some(c => /Review/i.test(c.label)));
    // ФИО подставляется в prompt
    assert.ok(chips.every(c => /Иванов/.test(c.prompt) || /iv@sber\.ru/i.test(c.prompt)));
  });

  test('team focus → chips про команду', async () => {
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    const chips = generateSuggestions({ kind: 'team', id: 'PAY' });
    assert.equal(chips.length, 6);
    assert.ok(chips.some(c => /перегружен/i.test(c.label)));
    assert.ok(chips.some(c => /Топ/i.test(c.label)));
    assert.ok(chips.some(c => /coverage/i.test(c.label) || /Sigma/i.test(c.label)));
    assert.ok(chips.every(c => /PAY/.test(c.prompt)));
  });

  test('epic focus → chips про эпик', async () => {
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    const chips = generateSuggestions({ kind: 'epic', id: 'BIK-1234' });
    assert.ok(chips.length >= 3);
    assert.ok(chips.some(c => /BIK-1234/.test(c.label)));
    assert.ok(chips.every(c => /BIK-1234/.test(c.prompt)));
  });

  test('GOAL-id epic → добавляется Sigma chip', async () => {
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    const chips = generateSuggestions({ kind: 'epic', id: 'GOAL-1' });
    assert.ok(chips.some(c => /Sigma|sigma/i.test(c.label) || /Sigma|cover/i.test(c.label)));
  });

  test('release focus → release chips', async () => {
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    const chips = generateSuggestions({ kind: 'release', id: '1.21' });
    assert.ok(chips.length >= 4);
    assert.ok(chips.some(c => /1\.21/.test(c.label) || /Готовн/i.test(c.label)));
    assert.ok(chips.some(c => /Перенос/i.test(c.label)));
  });

  test('limit option работает', async () => {
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    const chips = generateSuggestions({ kind: 'team', id: 'PAY' }, { limit: 3 });
    assert.equal(chips.length, 3);
  });

  test('bindFocusListener: no EventBus → graceful no-op', async () => {
    delete globalThis.EventBus;
    const { bindFocusListener } = await import('../../chat/smartSuggestions.js');
    let called = false;
    const unsub = bindFocusListener(() => { called = true; });
    assert.equal(typeof unsub, 'function');
    assert.equal(called, false);
  });

  test('bindFocusListener: EventBus → handler called on focus-changed', async () => {
    const listeners = [];
    globalThis.EventBus = {
      on: (event, h) => { listeners.push({ event, h }); },
      off: (event, h) => { /* noop */ },
      emit: (event, payload) => { listeners.filter(l => l.event === event).forEach(l => l.h(payload)); },
    };
    const { bindFocusListener } = await import('../../chat/smartSuggestions.js');
    let received;
    const unsub = bindFocusListener((chips, focus) => { received = { chips, focus }; });
    globalThis.EventBus.emit('focus-changed', { kind: 'team', id: 'PAY' });
    assert.ok(received);
    assert.equal(received.focus.kind, 'team');
    assert.ok(received.chips.length > 0);
    unsub();
    delete globalThis.EventBus;
  });

  test('identity-resolve через state.employees', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван', jiraAccountId: 'jaid-iv' }],
    });
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    // Передали только email — должен подставиться fio в prompt'ы.
    const chips = generateSuggestions({ kind: 'employee', id: 'iv@sber.ru' });
    assert.ok(chips.some(c => /Иванов Иван/.test(c.prompt)));
  });
});
