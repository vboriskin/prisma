'use strict';
/* tests/unit/ceoUpdate.test.js — V22+ Phase 4 (K-K1). */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('buildCEOUpdate', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('пустой state → headline о недостатке данных', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ rows: [], actionLog: [], integrations: {} });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ raw: { text: 'CEO update' } });
    assert.equal(r._meta.kind, 'ceo_update');
    assert.match(r.text, /CEO Update/);
    assert.match(r.text, /Недостаточно данных|Запустите/i);
  });

  test('release health: 50% donePct, переносы, overtime', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', hasRelease121: true, isDone: true,  ganttArrows: [] },
        { team: 'PAY', hasRelease121: true, isDone: true,  ganttArrows: [] },
        { team: 'PAY', hasRelease121: true, isDone: false, hasOvertime: true,
          ganttArrows: [{ srcCol: 'r121', dstCol: 'r122', at: '2026-04-20' }] },
        { team: 'PAY', hasRelease121: true, isDone: false,
          ganttArrows: [{ srcCol: 'r120', dstCol: 'r121', at: '2026-03-10' }] },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ release: { id: '1.21' }, raw: { text: 'CEO update 1.21' } }, { releaseId: '1.21' });
    assert.equal(r._meta.donePct, 50);
    assert.match(r.text, /50%/);
    assert.match(r.text, /Переносов: 2/);
    assert.match(r.text, /овертайме: 1/);
  });

  test('merged blockers: Registry + Scanner', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', epic: 'A', blockingDependency: true, isDone: false },
        { team: 'PAY', epic: 'B', blockingDependency: true, isDone: false },
      ],
      actionLog: [],
      integrations: {},
    });
    await mockServices({
      TeamScanner2: {
        getModel: () => ({
          participants: [
            {
              email: 'iv@sber.ru', label: 'Иванов Иван', deactivated: false,
              projects: ['PAY'],
              blockers: [
                { issueKey: 'PAY-10', blockerKey: 'EXT-1', dwellHours: 48 },
                { issueKey: 'PAY-11', blockerKey: 'EXT-2', dwellHours: 72 },
              ],
            },
          ],
        }),
      },
    });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ raw: { text: 'CEO update' } });
    assert.equal(r._meta.blockerCount, 4);
    assert.match(r.text, /Registry: 2/);
    assert.match(r.text, /Scanner: 2/);
  });

  test('Sigma coverage: добавляется секция', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({ rows: [], actionLog: [], integrations: {} });
    await mockServices({
      BlackDashboard: {
        _model: {
          summary: { totalGoals: 10, linkedCount: 7, unlinkedCount: 3, coveragePct: 70 },
          coverageByTeam: [
            { name: 'PAY', pct: 50 },
            { name: 'CORE', pct: 100 },
          ],
        },
      },
    });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ raw: { text: 'CEO update' } });
    assert.equal(r._meta.coveragePct, 70);
    assert.match(r.text, /Sigma/);
    assert.match(r.text, /70% покрытия/);
    assert.match(r.text, /PAY \(50%\)/);
  });

  test('team distribution: top-N', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', isDone: false },
        { team: 'PAY', isDone: false },
        { team: 'PAY', isDone: false },
        { team: 'CORE', isDone: false },
        { team: 'KYC', isDone: false },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ raw: { text: 'CEO update' } });
    assert.match(r.text, /Загрузка по командам/);
    assert.match(r.text, /\*\*PAY\*\*: 3/);
  });

  test('risk signals: noAssignee + scope=Требует подтверждения', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', hasRelease121: true, isDone: false, assignee: '', scope: 'Требует подтверждения' },
        { team: 'PAY', hasRelease121: true, isDone: false, assignee: '', scope: 'Да' },
        { team: 'PAY', hasRelease121: true, isDone: false, assignee: '', scope: 'Требует подтверждения' },
        { team: 'PAY', hasRelease121: true, isDone: false, assignee: 'X', scope: 'Да' },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ release: { id: '1.21' }, raw: { text: 'CEO update 1.21' } }, { releaseId: '1.21' });
    assert.equal(r._meta.riskCount >= 1, true);
    assert.match(r.text, /Риски/);
    assert.match(r.text, /без исполнителя/i);
    assert.match(r.text, /Требует подтверждения/i);
  });

  test('actions: deep-links в Гант / Чёрный / Реестр', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', epic: 'A', blockingDependency: true, isDone: false, hasRelease121: true },
      ],
      actionLog: [],
      integrations: {},
    });
    await mockServices({
      BlackDashboard: { _model: { summary: { totalGoals: 5, coveragePct: 60 } } },
    });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ release: { id: '1.21' }, raw: { text: 'CEO 1.21' } }, { releaseId: '1.21' });
    assert.ok(r.actions.some(a => a.type === 'set_focus' && a.payload?.kind === 'release'));
    assert.ok(r.actions.some(a => a.payload?.section === 'black-dashboard'));
    assert.ok(r.actions.some(a => a.type === 'apply_filter' && a.payload?.onlyBlocking));
  });

  test('headline: содержит ключевые числа', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [
        { team: 'PAY', hasRelease121: true, isDone: true },
        { team: 'PAY', hasRelease121: true, isDone: false, blockingDependency: true },
      ],
      actionLog: [],
      integrations: {},
    });
    const { buildCEOUpdate } = await import('../../chat/ceoUpdate.js');
    const r = buildCEOUpdate({ release: { id: '1.21' }, raw: { text: 'CEO 1.21' } }, { releaseId: '1.21' });
    // Headline должен быть в формате blockquote
    assert.match(r.text, /^> /m);
    assert.match(r.text, /50%/);
  });
});
