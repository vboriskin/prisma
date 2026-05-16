'use strict';
/* tests/unit/blackDashQueries.test.js — V22+ Week 3 (B-D1..B-D12). */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function _model() {
  return {
    fetchedAt: new Date().toISOString(),
    goals: [
      {
        key: 'GOAL-1', summary: 'Mobile KYC v3', status: 'In progress',
        domainLinks: ['BIK-1', 'BIK-2'],
        linkedIssues: [
          { key: 'BIK-1', summary: 'KYC backend', status: 'Done',        statusCat: 'done',  pk: 'PAY', assignee: 'Иванов Иван' },
          { key: 'BIK-2', summary: 'KYC frontend', status: 'In Progress', statusCat: 'wip',   pk: 'PAY', assignee: 'Петров Пётр' },
        ],
      },
      {
        key: 'GOAL-2', summary: 'Unlinked goal', status: 'To Do',
        domainLinks: [],
        linkedIssues: [],
      },
      {
        key: 'GOAL-3', summary: 'CORE migration', status: 'In progress',
        domainLinks: ['CORE-1'],
        linkedIssues: [
          { key: 'CORE-1', summary: 'Migrate auth', status: 'Done', statusCat: 'done', pk: 'CORE', assignee: 'Иванов Иван' },
        ],
      },
    ],
    summary: { totalGoals: 3, linkedCount: 2, unlinkedCount: 1, coveragePct: 67 },
    coverageByTeam: [
      { name: 'PAY',  pk: 'PAY',  pct: 50 },
      { name: 'CORE', pk: 'CORE', pct: 100 },
    ],
  };
}

describe('buildBlackDashQueryResponse', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('sigma not configured → fallback', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({ integrations: {} });
    const { buildBlackDashQueryResponse } = await import('../../chat/blackDashQueries.js');
    const r = buildBlackDashQueryResponse({ raw: { text: 'sigma coverage' } });
    assert.match(r.text, /Sigma Jira не настроена/);
  });

  test('no model → fallback с CTA «Открыть Чёрный»', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({ integrations: { sigma: { baseUrl: 'https://sigma.sber.ru' } } });
    await mockServices({ BlackDashboard: { _model: null } });
    const { buildBlackDashQueryResponse } = await import('../../chat/blackDashQueries.js');
    const r = buildBlackDashQueryResponse({ raw: { text: 'coverage' } });
    assert.match(r.text, /не загружался/);
    assert.ok(r.actions.some(a => a.payload?.section === 'black-dashboard'));
  });

  test('overall coverage → правильные cards и worst teams', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({ integrations: { sigma: { baseUrl: 'https://sigma.sber.ru' } } });
    await mockServices({ BlackDashboard: { _model: _model() } });
    const { buildBlackDashQueryResponse } = await import('../../chat/blackDashQueries.js');
    const r = buildBlackDashQueryResponse({ raw: { text: 'sigma coverage по командам' } });
    assert.equal(r._meta.kind, 'bd_coverage');
    assert.equal(r._meta.total, 3);
    assert.equal(r._meta.linked, 2);
    assert.equal(r._meta.coverage, 67);
    assert.match(r.text, /PAY/);
    assert.match(r.text, /CORE/);
    // Worst team PAY (50%) should be highlighted с ⚠
    assert.match(r.text, /\*\*PAY\*\*.*50%/);
  });

  test('unmapped goals → подсветка GOAL-2', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({ integrations: { sigma: { baseUrl: 'https://sigma.sber.ru' } } });
    await mockServices({ BlackDashboard: { _model: _model() } });
    const { buildBlackDashQueryResponse } = await import('../../chat/blackDashQueries.js');
    const r = buildBlackDashQueryResponse({ raw: { text: 'какие цели не покрыты задачами' } });
    assert.equal(r._meta.kind, 'bd_unmapped');
    assert.equal(r._meta.unmappedCount, 1);
    assert.match(r.text, /GOAL-2/);
  });

  test('per-goal: GOAL-1 → подробности', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({ integrations: { sigma: { baseUrl: 'https://sigma.sber.ru' } } });
    await mockServices({ BlackDashboard: { _model: _model() } });
    const { buildBlackDashQueryResponse } = await import('../../chat/blackDashQueries.js');
    const r = buildBlackDashQueryResponse({
      raw: { text: 'GOAL-1 прогресс' },
    });
    assert.equal(r._meta.kind, 'bd_per_goal');
    assert.equal(r._meta.goalId, 'GOAL-1');
    assert.equal(r._meta.linkedCount, 2);
    assert.equal(r._meta.donePct, 50);   // 1 closed / 2 linked
    assert.match(r.text, /BIK-1/);
    assert.match(r.text, /BIK-2/);
    // Cross-context: apply_filter с JiraKeys
    const filterAction = r.actions.find(a => a.type === 'apply_filter');
    assert.ok(filterAction);
    assert.deepEqual(filterAction.payload.jiraKeys, ['BIK-1', 'BIK-2']);
  });

  test('per-employee Sigma contribution', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({ integrations: { sigma: { baseUrl: 'https://sigma.sber.ru' } } });
    await mockServices({ BlackDashboard: { _model: _model() } });
    const { buildBlackDashQueryResponse } = await import('../../chat/blackDashQueries.js');
    const r = buildBlackDashQueryResponse({
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      raw: { text: 'Иванов вклад в sigma' },
    });
    assert.equal(r._meta.kind, 'bd_per_employee');
    // Иванов привязан к BIK-1 (GOAL-1) и CORE-1 (GOAL-3) — 2 цели
    assert.equal(r._meta.goalsCount, 2);
    assert.match(r.text, /Иванов/);
    assert.match(r.text, /GOAL-1/);
    assert.match(r.text, /GOAL-3/);
  });

  test('nonexistent goal → грамотный fallback', async () => {
    const { mockState, mockServices } = await import('../_helpers/llmStub.js');
    await mockState({ integrations: { sigma: { baseUrl: 'https://sigma.sber.ru' } } });
    await mockServices({ BlackDashboard: { _model: _model() } });
    const { buildBlackDashQueryResponse } = await import('../../chat/blackDashQueries.js');
    const r = buildBlackDashQueryResponse({
      raw: { text: 'GOAL-99 прогресс' },
    });
    assert.match(r.text, /не найдена/);
  });
});
