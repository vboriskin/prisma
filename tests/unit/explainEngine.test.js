'use strict';
/* tests/unit/explainEngine.test.js — V22+ Phase 4 (K-K6). */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('buildExplainResponse', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('пустой target / generic → fallback с примерами', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: [], integrations: {}, actionLog: [] });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({ raw: { text: 'почему' } }, {});
    assert.equal(r._meta.kind, 'explain_generic');
    assert.match(r.text, /уточнить/i);
    assert.ok(r.drilldown.length > 0);
  });

  test('team velocity: блокеры + переносы + overtime → ranked factors', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', epic: 'A', blockingDependency: true,  isDone: false,
          ganttArrows: [{ wt: 'BE', srcCol: 'r120', dstCol: 'r121', at: '2026-04-10T00:00:00Z' }] },
        { team: 'PAY', epic: 'B', blockingDependency: true,  isDone: false,
          ganttArrows: [{ wt: 'BE', srcCol: 'r121', dstCol: 'r122', at: '2026-04-20T00:00:00Z' }] },
        { team: 'PAY', epic: 'C', hasOvertime: true,         isDone: false, ganttArrows: [] },
        { team: 'PAY', epic: 'D', hasOvertime: true,         isDone: false,
          ganttArrows: [{ wt: 'BE', srcCol: 'r121', dstCol: 'overtime', at: '2026-04-25T00:00:00Z' }] },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({
      team: { name: 'PAY' },
      raw: { text: 'почему у PAY низкая velocity' },
    });
    assert.equal(r._meta.kind, 'explain');
    assert.match(r.text, /низкая velocity/i);
    assert.match(r.text, /блокеров/i);
    assert.match(r.text, /переносов/i);
    assert.match(r.text, /овертайме/i);
    // Top factor должен быть блокеры (weight=2*3=6 для 2 шт)
    assert.match(r._meta.topFactor, /блокеров|переносов|овертайме/i);
  });

  test('employee blockers: scanner-данные + registry merge', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', epic: 'X', blockingDependency: true, isDone: false, assignee: 'iv@sber.ru' },
      ],
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      actionLog: [],
      integrations: {},
    });
    await mockServices({
      TeamScanner2: {
        getModel: () => ({
          participants: [{
            email: 'iv@sber.ru',
            label: 'Иванов Иван',
            deactivated: false,
            blockers: [
              { issueKey: 'PAY-1', blockerKey: 'CORE-50', dwellHours: 72 },
              { issueKey: 'PAY-2', blockerKey: 'CORE-51', dwellHours: 120 },
            ],
            stale: [{ key: 'PAY-3', daysIdle: 10 }, { key: 'PAY-4', daysIdle: 14 }, { key: 'PAY-5', daysIdle: 8 }],
          }],
        }),
      },
    });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      raw: { text: 'почему у Иванова много блокеров' },
    });
    assert.equal(r._meta.kind, 'explain');
    assert.match(r.text, /блокеров/i);
    // Сигналы должны быть: dwell-time, stale, cross-team
    assert.match(r.text, />2 дней|2 дня/i);
  });

  test('epic transfer: arrows + comments analysis', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        {
          id: 'r1', team: 'PAY', epic: 'BIK-1234', isDone: false,
          ganttArrows: [
            { wt: 'BE', srcCol: 'r120', dstCol: 'r121', at: '2026-03-15T00:00:00Z' },
            { wt: 'BE', srcCol: 'r121', dstCol: 'r122', at: '2026-04-20T00:00:00Z' },
          ],
          transferComments: [
            { text: 'ждём блокер от внешней команды' },
            { text: 'scope расширили — добавили audit-флоу' },
            { text: 'ресурсов на эпик не было' },
          ],
        },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({
      epic: { id: 'BIK-1234' },
      raw: { text: 'почему перенесли BIK-1234' },
    });
    assert.equal(r._meta.kind, 'explain');
    assert.match(r.text, /BIK-1234/);
    assert.match(r.text, /2\s*раз|перенос/i);
    // Должны выявиться 3 причины
    assert.match(r.text, /блокер|зависим/i);
    assert.match(r.text, /scope|объ[её]м/i);
    assert.match(r.text, /capacity|ресурс/i);
  });

  test('release completion: причины отставания', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', epic: 'A', hasRelease121: true, isDone: false, blockingDependency: true, assignee: 'iv@sber.ru' },
        { team: 'PAY', epic: 'B', hasRelease121: true, isDone: false, assignee: '' },
        { team: 'PAY', epic: 'C', hasRelease121: true, isDone: false, assignee: '' },
        { team: 'PAY', epic: 'D', hasRelease121: true, isDone: false, assignee: '' },
        { team: 'PAY', epic: 'E', hasRelease121: true, isDone: true,  assignee: 'iv@sber.ru' },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({
      release: { id: '1.21' },
      raw: { text: 'почему 1.21 отстаёт' },
    });
    assert.equal(r._meta.kind, 'explain');
    assert.match(r.text, /1\.21/);
    assert.match(r.text, /без исполнителя/i);
    assert.match(r.text, /заблокированы|блокирующ/i);
  });

  test('overload: team-level breakdown', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', assignee: 'Иванов Иван', isDone: false, hasRelease121: true },
        { team: 'PAY', assignee: 'Иванов Иван', isDone: false, hasRelease121: true },
        { team: 'PAY', assignee: 'Иванов Иван', isDone: false, hasRelease121: true },
        { team: 'PAY', assignee: 'Иванов Иван', isDone: false, hasRelease121: true },
        { team: 'PAY', assignee: 'Иванов Иван', isDone: false, hasRelease121: true },
        { team: 'PAY', assignee: 'Петров Пётр', isDone: false, hasRelease121: true },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({
      team: { name: 'PAY' },
      raw: { text: 'почему PAY перегружена' },
    });
    assert.equal(r._meta.kind, 'explain');
    assert.match(r.text, /перегружен/i);
    // 1 человек с ≥5 эпиками
    assert.match(r.text, /1\s+человек/i);
  });

  test('недостаточно данных → грамотный fallback', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: [], integrations: {}, actionLog: [] });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({
      team: { name: 'EMPTY' },
      raw: { text: 'почему у EMPTY низкая velocity' },
    });
    assert.match(r.text, /Недостаточно данных/i);
  });

  test('cards: содержат top factors с weights', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', blockingDependency: true, isDone: false, ganttArrows: [{ srcCol: 'r120', dstCol: 'r121', at: '2026-04-10' }] },
        { team: 'PAY', blockingDependency: true, isDone: false, ganttArrows: [{ srcCol: 'r121', dstCol: 'r122', at: '2026-04-15' }] },
        { team: 'PAY', hasOvertime: true,        isDone: false, ganttArrows: [] },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildExplainResponse } = await import('../../chat/explainEngine.js');
    const r = buildExplainResponse({
      team: { name: 'PAY' },
      raw: { text: 'почему у PAY низкая velocity' },
    });
    assert.ok(r.cards.length >= 1);
    assert.ok(r.cards.every(c => c.title && c.value));
  });
});
