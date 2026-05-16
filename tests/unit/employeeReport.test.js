'use strict';
/* tests/unit/employeeReport.test.js — V22+ Week 2 (LP-01..LP-08). */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

async function _setup() {
  const { mockState, mockServices, mockFetch, resetAllChatStubs } =
    await import('../_helpers/llmStub.js');
  return { mockState, mockServices, mockFetch, resetAllChatStubs };
}

describe('buildEmployeeReport', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('пустой employee → error response', async () => {
    const { mockState } = await _setup();
    await mockState({
      employees: [],
      rows: [],
      integrations: { jira: { hasToken: true } },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const r = await buildEmployeeReport({ employee: null }, null);
    assert.match(r.text, /Не указан сотрудник/);
    assert.equal(r._meta.kind, 'employee_report_error');
  });

  test('пустой period → error response', async () => {
    const { mockState } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      rows: [],
      integrations: { jira: { hasToken: true } },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const target = { employee: { id: 'iv@sber.ru', label: 'Иванов Иван' } };
    const r = await buildEmployeeReport(target, null);
    assert.match(r.text, /Не указан период/);
  });

  test('нет настроенных источников → error', async () => {
    const { mockState } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      rows: [],
      integrations: {},   // нет токенов
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      period: { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' },
      sources: ['jira', 'bb', 'cf'],
    };
    const r = await buildEmployeeReport(target, null);
    assert.match(r.text, /не настроены/);
  });

  test('happy path с замоканными данными → полный отчёт', async () => {
    const { mockState, mockFetch } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван', jiraAccountId: 'jaid-1' }],
      rows: [],
      integrations: { jira: { hasToken: true }, bitbucket: { hasToken: true }, confluence: { hasToken: true } },
    });
    mockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [
          { key: 'BIK-1', assignee: 'Иванов Иван', updatedAt: '2026-05-10T12:00:00Z', issuetype: 'Bug',  status: 'Done' },
          { key: 'BIK-2', assignee: 'Иванов Иван', updatedAt: '2026-05-15T08:00:00Z', issuetype: 'Task', status: 'Done' },
        ],
      },
      '/api/integrations/bitbucket-prs': {
        prs: [
          { author: { email: 'iv@sber.ru' }, state: 'MERGED', repository: { name: 'mobile' }, updatedAt: '2026-05-12T10:00:00Z' },
        ],
      },
      '/api/integrations/confluence-search': {
        results: [
          { title: 'KYC requirements', space: { key: 'PAY' }, lastModified: '2026-05-14T09:00:00Z' },
        ],
      },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван', email: 'iv@sber.ru' },
      period: { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май 2026' },
      sources: ['jira', 'bb', 'cf'],
    };
    const r = await buildEmployeeReport(target, null);
    assert.equal(r._meta.kind, 'employee_report');
    assert.equal(r._meta.totals.jira, 2);
    assert.equal(r._meta.totals.bb, 1);
    assert.equal(r._meta.totals.cf, 1);
    assert.match(r.text, /Иванов/);
    assert.match(r.text, /май 2026/);
    assert.match(r.text, /Закрыто задач:\*\*\s*2/);
    assert.ok(r.cards.length >= 4);
    assert.ok(r.actions.length >= 1);
  });

  test('preset=review → drilldown БЕЗ "подготовить review"', async () => {
    const { mockState, mockFetch } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      rows: [],
      integrations: { jira: { hasToken: true } },
    });
    mockFetch({
      '/api/integrations/jira-fetch-all': { issues: [{ key: 'A', assignee: 'Иванов Иван', updatedAt: '2026-05-15T00:00:00Z', issuetype: 'Bug', status: 'Done' }] },
      '*': { results: [], prs: [] },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      period: { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' },
      sources: ['jira'],
    };
    const r = await buildEmployeeReport(target, null, { preset: 'review' });
    assert.equal(r._meta.preset, 'review');
    const reviewSuggestion = r.drilldown.find(d => /review/i.test(d.text));
    assert.equal(reviewSuggestion, undefined);
  });

  test('comparison: includeComparison=true делает 2-й fetch', async () => {
    const { mockState, mockFetch } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      rows: [],
      integrations: { jira: { hasToken: true } },
    });
    let fetchCount = 0;
    mockFetch({
      '/api/integrations/jira-fetch-all': () => {
        fetchCount++;
        return { issues: [{ key: 'A', assignee: 'Иванов Иван', updatedAt: '2026-04-15T00:00:00Z', issuetype: 'Bug', status: 'Done' }] };
      },
      '*': { results: [], prs: [] },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      period: { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' },
      sources: ['jira'],
    };
    const r = await buildEmployeeReport(target, null, { includeComparison: true });
    assert.ok(fetchCount >= 2, `expected ≥2 jira fetches (current + previous), got ${fetchCount}`);
    assert.match(r.text, /Сравнение с предыдущим/);
  });

  test('пустые items → нет crash, грамотный fallback', async () => {
    const { mockState, mockFetch } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      rows: [],
      integrations: { jira: { hasToken: true }, bitbucket: { hasToken: true }, confluence: { hasToken: true } },
    });
    mockFetch({
      '/api/integrations/jira-fetch-all': { issues: [] },
      '/api/integrations/bitbucket-prs':  { prs: [] },
      '/api/integrations/confluence-search': { results: [] },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      period: { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' },
      sources: ['jira', 'bb', 'cf'],
    };
    const r = await buildEmployeeReport(target, null);
    assert.equal(r._meta.totals.jira, 0);
    assert.match(r.text, /Активность за период не зафиксирована|Сводка/);
  });

  test('action chips: deep-link в Сканнер + comparison-toggle', async () => {
    const { mockState, mockFetch } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      rows: [],
      integrations: { jira: { hasToken: true } },
    });
    mockFetch({
      '/api/integrations/jira-fetch-all': { issues: [] },
      '*': { results: [], prs: [] },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    const target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      period: { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' },
      sources: ['jira'],
    };
    const r = await buildEmployeeReport(target, null);
    const focusAction = r.actions.find(a => a.type === 'set_focus' && a.payload?.kind === 'employee');
    assert.ok(focusAction, 'expected set_focus action for employee');
    const cmpAction = r.actions.find(a => a.type === 'send_prompt');
    assert.ok(cmpAction, 'expected comparison-toggle send_prompt action');
  });

  test('trend section появляется только для периодов >14 дней', async () => {
    const { mockState, mockFetch } = await _setup();
    await mockState({
      employees: [{ email: 'iv@sber.ru', fio: 'Иванов Иван' }],
      rows: [],
      integrations: { jira: { hasToken: true } },
    });
    mockFetch({
      '/api/integrations/jira-fetch-all': { issues: [] },
      '*': { results: [], prs: [] },
    });
    const { buildEmployeeReport } = await import('../../chat/employeeReport.js');
    // Короткий период — БЕЗ trend
    let target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      period: { from: new Date(2026, 4, 10), to: new Date(2026, 4, 17), label: 'неделя' },
      sources: ['jira'],
    };
    let r = await buildEmployeeReport(target, null);
    assert.doesNotMatch(r.text, /Тренд по неделям/);
    // Длинный период — С trend
    target = {
      employee: { id: 'iv@sber.ru', label: 'Иванов Иван' },
      period: { from: new Date(2026, 0, 1), to: new Date(2026, 5, 1), label: 'полугодие' },
      sources: ['jira'],
    };
    r = await buildEmployeeReport(target, null);
    assert.match(r.text, /Тренд по неделям/);
  });
});
