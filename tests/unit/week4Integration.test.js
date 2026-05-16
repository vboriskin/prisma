'use strict';
/* tests/unit/week4Integration.test.js — V22+ Week 4 (LP-08 + LP-09)
   End-to-end: preset='review' + AI narrative через employeeReport + chatEngine. */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

async function _setupEnv() {
  const { mockState, mockFetch, resetAllChatStubs } = await import('../_helpers/llmStub.js');
  await mockState({
    employees: [
      { email: 'iv@sber.ru', fio: 'Иванов Иван', team: 'PAY', jiraAccountId: 'jaid-iv' },
    ],
    rows: [],
    integrations: { jira: { hasToken: true }, bitbucket: { hasToken: true }, confluence: { hasToken: true } },
    llm: { history: [], settings: {} },
  });
  return { mockFetch, resetAllChatStubs };
}

describe('Week 4: review preset + AI narrative', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('intent parser: «review для Иванова» → preset=review + aiNarrative=false', async () => {
    const { parseIntent } = await import('../../chat/chatIntentParser.js');
    const r = parseIntent('review для Иванова');
    assert.equal(r.intent, 'employee_report');
    assert.equal(r.params.preset, 'review');
  });

  test('intent parser: «AI обзор Иванова» → preset=narrative + aiNarrative=true', async () => {
    const { parseIntent } = await import('../../chat/chatIntentParser.js');
    const r = parseIntent('AI обзор Иванова');
    assert.equal(r.intent, 'employee_report');
    assert.equal(r.params.aiNarrative, true);
  });

  test('buildEmployeeReport preset=review: добавлены Achievements/Growth/Recs', async () => {
    const { mockFetch } = await _setupEnv();
    mockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [
          { key: 'BIK-1', assignee: 'Иванов Иван', updatedAt: '2026-04-15T00:00:00Z', issuetype: 'Bug', status: 'Done', summary: 'KYC' },
          { key: 'BIK-2', assignee: 'Иванов Иван', updatedAt: '2026-04-20T00:00:00Z', issuetype: 'Task', status: 'Done', summary: 'Pay' },
        ],
      },
      '*': { results: [], prs: [] },
      // LLM не настроен → narrative не вставится
      '/api/llm/chat': () => ({ _isMockResponse: true, ok: false, status: 500, text: async () => '', json: async () => ({}) }),
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const r = await buildEmployeeReport(
      {
        employee: { id: 'iv@sber.ru', label: 'Иванов Иван', email: 'iv@sber.ru' },
        period: { from: new Date(2026, 0, 1), to: new Date(2026, 3, 1), label: 'Q1 2026' },
        sources: ['jira'],
      },
      null,
      { preset: 'review', aiNarrative: false }
    );
    assert.equal(r._meta.preset, 'review');
    assert.match(r.text, /Achievements/);
    assert.match(r.text, /Growth Areas/);
    assert.match(r.text, /Recommendations/);
    // Download MD как primary action
    const exportAction = r.actions.find(a => a.type === 'export_md' && a.primary);
    assert.ok(exportAction);
    assert.match(exportAction.label, /review/i);
  });

  test('AI narrative: успешный — вставляется в текст с badge', async () => {
    const { mockFetch } = await _setupEnv();
    mockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [{ key: 'BIK-1', assignee: 'Иванов Иван', updatedAt: '2026-04-15T00:00:00Z', issuetype: 'Bug', status: 'Done' }],
      },
      '/api/integrations/bitbucket-prs': { prs: [] },
      '/api/integrations/confluence-search': { results: [] },
      '/api/llm/chat': {
        choices: [{ message: { content: 'Иван активно работал над задачами KYC. Закрыл основные эпики бэкенда за квартал, поддерживал стабильный темп.' } }],
      },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const r = await buildEmployeeReport(
      {
        employee: { id: 'iv@sber.ru', label: 'Иванов Иван', email: 'iv@sber.ru' },
        period: { from: new Date(2026, 0, 1), to: new Date(2026, 3, 1), label: 'Q1 2026' },
        sources: ['jira'],
      },
      null,
      { preset: 'full', aiNarrative: true }
    );
    assert.match(r.text, /AI-обзор/);
    assert.match(r.text, /Иван активно работал над задачами KYC/);
    assert.equal(r._meta.hasNarrative, true);
  });

  test('AI narrative: LLM unavailable → отчёт БЕЗ narrative, не падает', async () => {
    const { mockFetch } = await _setupEnv();
    mockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [{ key: 'BIK-1', assignee: 'Иванов Иван', updatedAt: '2026-04-15T00:00:00Z', issuetype: 'Bug', status: 'Done' }],
      },
      '/api/integrations/bitbucket-prs': { prs: [] },
      '/api/integrations/confluence-search': { results: [] },
      '/api/llm/chat': () => ({ _isMockResponse: true, ok: false, status: 500, text: async () => '', json: async () => ({}) }),
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const r = await buildEmployeeReport(
      {
        employee: { id: 'iv@sber.ru', label: 'Иванов Иван', email: 'iv@sber.ru' },
        period: { from: new Date(2026, 0, 1), to: new Date(2026, 3, 1), label: 'Q1 2026' },
        sources: ['jira'],
      },
      null,
      { aiNarrative: true }
    );
    assert.doesNotMatch(r.text, /AI-обзор/);
    assert.notEqual(r._meta.hasNarrative, true);
  });

  test('chatEngine.process: «performance review для Иванова за квартал»', async () => {
    const { mockFetch } = await _setupEnv();
    mockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [{ key: 'BIK-1', assignee: 'Иванов Иван', updatedAt: '2026-02-15T00:00:00Z', issuetype: 'Bug', status: 'Done', summary: 'KYC fix' }],
      },
      '/api/integrations/bitbucket-prs': { prs: [{ author: { email: 'iv@sber.ru' }, state: 'MERGED', repository: { name: 'mobile' }, updatedAt: '2026-02-20T00:00:00Z' }] },
      '/api/integrations/confluence-search': { results: [] },
      '/api/llm/chat': {
        choices: [{ message: { content: 'За первый квартал 2026 Иван сосредоточился на KYC и платёжной интеграции, закрыл основные задачи бэкенда. Видна стабильная work-через-deliveries активность по всему циклу.' } }],
      },
    });
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    const captures = [];
    chatProcess('performance review для Иванова за квартал', {
      onRuleBased: ({ structured, intent }) => captures.push({ structured, intent }),
      onLLMPrompt: () => {},
    });
    // EMPLOYEE_REPORT — async, ждём.
    await new Promise(r => setTimeout(r, 250));
    assert.ok(captures.length >= 1, `expected ≥1 callback, got ${captures.length}`);
    const cap = captures[0];
    assert.equal(cap.intent, 'employee_report');
    assert.equal(cap.structured._meta.preset, 'review');
    assert.match(cap.structured.text, /Performance Review/);
    assert.match(cap.structured.text, /Achievements/);
    // AI narrative должен быть включён авто для preset=review
    assert.match(cap.structured.text, /AI-обзор/);
  });
});
