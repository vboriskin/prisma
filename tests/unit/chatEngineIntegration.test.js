'use strict';
/* tests/unit/chatEngineIntegration.test.js — V22+ end-to-end.

   Тесты dispatcher'а chatEngine с замоканными источниками — проверяем
   что user-message правильно роутится через intent-parser → builder.
*/

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

async function _setupEnv() {
  const { mockState, mockServices, mockFetch, resetAllChatStubs } =
    await import('../_helpers/llmStub.js');
  await mockState({
    employees: [
      { email: 'iv@sber.ru', fio: 'Иванов Иван', team: 'PAY', jiraAccountId: 'jaid-iv' },
      { email: 'pe@sber.ru', fio: 'Петров Пётр', team: 'PAY' },
    ],
    rows: [
      { id: 'r1', team: 'PAY', epic: 'KYC', isDone: false, hasRelease121: true,
        assignee: 'Иванов Иван',
        ganttArrows: [{ wt: 'BE', srcCol: 'r121', dstCol: 'r122', at: '2026-04-10T00:00:00Z' }],
      },
      { id: 'r2', team: 'PAY', epic: 'Pay v2', isDone: true, hasRelease121: true, assignee: 'Петров Пётр', ganttArrows: [] },
    ],
    integrations: {
      jira: { hasToken: true, baseUrl: 'https://jira.sber.ru' },
      bitbucket: { hasToken: true },
      confluence: { hasToken: true },
      sigma: { baseUrl: 'https://sigma.sber.ru', hasToken: true },
    },
    planLocked: false,
    actionLog: [],
    llm: { history: [], settings: {} },
  });
  return { mockServices, mockFetch, resetAllChatStubs };
}

describe('chatEngine.process — dispatcher integration', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('GANTT_QUERY: «сколько переносов в PAY» → gantt_transfers structured', async () => {
    await _setupEnv();
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    chatProcess('сколько переносов в PAY', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => assert.fail('should not go LLM path'),
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'gantt_query');
    assert.equal(captured.structured._meta.kind, 'gantt_transfers');
    assert.equal(captured.structured._meta.total, 1);
  });

  test('BD_QUERY: «sigma coverage» → bd_coverage', async () => {
    const { mockServices } = await _setupEnv();
    await mockServices({ BlackDashboard: { _model: {
      goals: [{ key: 'GOAL-1', linkedIssues: [{ key: 'A' }] }, { key: 'GOAL-2', linkedIssues: [] }],
      summary: { totalGoals: 2, linkedCount: 1, unlinkedCount: 1, coveragePct: 50 },
      coverageByTeam: [{ name: 'PAY', pct: 50 }],
    }}});
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    chatProcess('sigma coverage по командам', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => assert.fail('should not go LLM path'),
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'bd_query');
    assert.match(captured.structured.text, /Coverage Sigma-целей/);
  });

  test('SOURCE_QUERY: «сколько PR у Иванова в Bitbucket» → source_query_person', async () => {
    const { mockServices } = await _setupEnv();
    await mockServices({ TeamScanner2: { getModel: () => ({
      fetchedAt: new Date().toISOString(),
      participants: [{
        key: 'иванов иван', email: 'iv@sber.ru', label: 'Иванов Иван',
        deactivated: false, projects: ['PAY'],
        issuesNow: [], doneToday: [], doneYesterday: [],
        bbItems: [{ kind: 'pr', state: 'MERGED', repo: 'mobile', at: new Date().toISOString() }],
        cfItems: [],
      }],
    }) } });
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    // Prompt должен быть source-focused, без «делал» (это activity intent).
    chatProcess('сколько PR у Иванова в Bitbucket', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => {},
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'source_query');
    assert.equal(captured.structured._meta?.kind, 'source_query_person');
  });

  test('EMPLOYEE_REPORT: «Иванов за квартал» → async builder', async () => {
    const { mockFetch } = await _setupEnv();
    mockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [{ key: 'BIK-1', assignee: 'Иванов Иван', updatedAt: '2026-04-15T00:00:00Z', issuetype: 'Bug', status: 'Done' }],
      },
      '*': { results: [], prs: [] },
    });
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    const captures = [];
    chatProcess('Иванов за квартал', {
      onRuleBased: ({ structured, intent }) => captures.push({ structured, intent }),
      onLLMPrompt: () => {},
    });
    // EMPLOYEE_REPORT — async, ждём микротасков.
    await new Promise(r => setTimeout(r, 200));
    assert.ok(captures.length >= 1, `expected ≥1 callback, got ${captures.length}`);
    assert.equal(captures[0].intent, 'employee_report');
  });

  test('STAND_UP: rule-based быстрый', async () => {
    await _setupEnv();
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    chatProcess('стендап', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => {},
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'stand_up');
  });

  test('intent fallback: unknown → LLM path', async () => {
    await _setupEnv();
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let llmCalled = false;
    chatProcess('напиши стихотворение про море', {
      onRuleBased: () => {},
      onLLMPrompt: () => { llmCalled = true; },
    });
    assert.equal(llmCalled, true);
  });
});
