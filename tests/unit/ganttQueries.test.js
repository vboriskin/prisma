'use strict';
/* tests/unit/ganttQueries.test.js — V22+ Week 3 (G-Q1..G-Q14). */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function _rows() {
  return [
    {
      id: 'r1', team: 'PAY', epic: 'KYC v3', isDone: false, hasRelease121: true,
      assignee: 'Иванов Иван',
      ganttArrows: [
        { wt: 'BE', srcCol: 'r120', dstCol: 'r121', at: '2026-03-15T10:00:00Z' },
        { wt: 'BE', srcCol: 'r121', dstCol: 'r122', at: '2026-04-10T11:00:00Z' },
      ],
    },
    {
      id: 'r2', team: 'PAY', epic: 'Pay v2', isDone: true, hasRelease121: true,
      assignee: 'Петров Пётр',
      ganttArrows: [],
    },
    {
      id: 'r3', team: 'CORE', epic: 'Auth migration', isDone: false, hasRelease122: true, hasOvertime: true,
      assignee: 'Сидоров Сергей',
      ganttArrows: [
        { wt: 'BE', srcCol: 'r121', dstCol: 'r122', at: '2026-04-20T12:00:00Z' },
      ],
    },
    {
      id: 'r4', team: 'CORE', epic: 'Logging', isDone: false, hasOvertime: true,
      assignee: 'Иванов Иван',
      ganttArrows: [],
    },
  ];
}

describe('buildGanttQueryResponse', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('transfers per team (PAY)', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: _rows(), planLocked: false, actionLog: [] });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({
      team: { name: 'PAY' },
      raw: { text: 'сколько переносов в PAY' },
    });
    assert.equal(r._meta.kind, 'gantt_transfers');
    assert.equal(r._meta.total, 2);   // PAY: r1 имеет 2 arrows
    assert.match(r.text, /команда PAY/);
  });

  test('transfers per release', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: _rows() });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({
      release: { id: '1.21' },
      raw: { text: 'переносы в 1.21' },
    });
    assert.equal(r._meta.kind, 'gantt_transfers');
    // arrows where src='r121' OR dst='r121':
    //   r1: BE r120→r121 (dst) ✓, BE r121→r122 (src) ✓
    //   r3: BE r121→r122 (src) ✓
    // = 3
    assert.equal(r._meta.total, 3);
  });

  test('completion per release', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: _rows() });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({
      release: { id: '1.21' },
      raw: { text: 'сколько завершено в 1.21' },
    });
    assert.equal(r._meta.kind, 'gantt_completion');
    assert.equal(r._meta.total, 2);   // r1, r2 имеют hasRelease121
    assert.equal(r._meta.done, 1);    // только r2 isDone
    assert.equal(r._meta.donePct, 50);
  });

  test('overtime: список + per-team breakdown', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: _rows() });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({ raw: { text: 'кто овертаймил' } });
    assert.equal(r._meta.kind, 'gantt_overtime');
    assert.equal(r._meta.total, 2);   // r3, r4 hasOvertime
    assert.match(r.text, /Auth migration/);
    assert.match(r.text, /Logging/);
    // По командам — обе CORE
    assert.match(r.text, /\*\*CORE\*\*: 2/);
    // По исполнителям ranking (Иванов 1 + Сидоров 1)
    assert.match(r.text, /Сидоров/);
  });

  test('overtime per team filter', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: _rows() });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({
      team: { name: 'PAY' },
      raw: { text: 'овертайм в PAY' },
    });
    assert.equal(r._meta.total, 0);   // PAY не имеет overtime
    assert.match(r.text, /Нет эпиков в овертайме/);
  });

  test('plan-lock query', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [],
      planLocked: true,
      actionLog: [
        { at: '2026-05-01T10:00:00Z', label: 'Plan locked', who: 'pm@sber.ru' },
      ],
    });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({ raw: { text: 'план зафиксирован' } });
    assert.equal(r._meta.kind, 'gantt_planlock');
    assert.equal(r._meta.isLocked, true);
  });

  test('transfers без team filter → top-команды', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: _rows() });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({ raw: { text: 'сколько переносов всего' } });
    // 3 arrow всего: r1 (2) + r3 (1)
    assert.equal(r._meta.total, 3);
    assert.match(r.text, /Топ команд/);
    assert.match(r.text, /\*\*PAY\*\*: 2/);
    assert.match(r.text, /\*\*CORE\*\*: 1/);
  });

  test('action chips: deep-link в Гант + time chip-bar', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: _rows() });
    const { buildGanttQueryResponse } = await import('../../chat/ganttQueries.js');
    const r = buildGanttQueryResponse({
      team: { name: 'PAY' },
      raw: { text: 'переносы PAY' },
    });
    assert.ok(r.actions.some(a => a.type === 'apply_filter' && a.payload?.team === 'PAY'));
  });
});
