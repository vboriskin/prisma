'use strict';
/* tests/unit/historicalFetcher.test.js — V22+ Week 1 (I-09). */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let _origFetch;
function _setupMockFetch(mockResponses) {
  _origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const handler = mockResponses[url] || mockResponses['*'];
    if (!handler) {
      return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    }
    const body = opts?.body ? JSON.parse(opts.body) : {};
    const data = typeof handler === 'function' ? handler(body) : handler;
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify(data),
      json: async () => data,
    };
  };
}

afterEach(() => {
  if (_origFetch) globalThis.fetch = _origFetch;
});

describe('historicalFetcher', () => {
  test('fetchEmployeeJiraHistory: identity match по fio', async () => {
    _setupMockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [
          { key: 'BIK-1', assignee: 'Иванов Иван', updatedAt: '2026-05-10T12:00:00Z', issuetype: 'Bug',  status: 'Done' },
          { key: 'BIK-2', assignee: 'Петров Пётр', updatedAt: '2026-05-10T12:00:00Z', issuetype: 'Task', status: 'Open' },
          { key: 'BIK-3', assignee: 'Иванов Иван', updatedAt: '2026-05-12T08:00:00Z', issuetype: 'Task', status: 'Done' },
        ],
      },
    });
    const { fetchEmployeeJiraHistory } = await import('../../chat/historicalFetcher.js');
    const period = {
      from: new Date(2026, 4, 1),
      to:   new Date(2026, 4, 31),
      label: 'за месяц',
    };
    const r = await fetchEmployeeJiraHistory(
      { email: 'ivanov@sber.ru', fio: 'Иванов Иван', jiraAccountId: 'jaid-1' },
      period,
    );
    assert.equal(r._source, 'jira');
    assert.equal(r.total, 2);   // BIK-1 и BIK-3 — Иванова
    assert.equal(r.items[0].key, 'BIK-1');
  });

  test('fetchEmployeeJiraHistory: фильтр по периоду', async () => {
    _setupMockFetch({
      '/api/integrations/jira-fetch-all': {
        issues: [
          { key: 'OLD', assignee: 'Иванов Иван', updatedAt: '2025-12-01T00:00:00Z', issuetype: 'Bug', status: 'Done' },
          { key: 'NEW', assignee: 'Иванов Иван', updatedAt: '2026-05-15T00:00:00Z', issuetype: 'Bug', status: 'Done' },
        ],
      },
    });
    const { fetchEmployeeJiraHistory } = await import('../../chat/historicalFetcher.js');
    const period = { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' };
    const r = await fetchEmployeeJiraHistory({ fio: 'Иванов Иван' }, period);
    assert.equal(r.total, 1);
    assert.equal(r.items[0].key, 'NEW');
  });

  test('fetchEmployeeAllSources: parallel + errors aggregation', async () => {
    _setupMockFetch({
      '/api/integrations/jira-fetch-all':    { issues: [{ key: 'A', assignee: 'Иванов Иван', updatedAt: '2026-05-15T00:00:00Z' }] },
      '/api/integrations/bitbucket-prs':     { prs: [] },
      '/api/integrations/confluence-search': { results: [] },
    });
    const { fetchEmployeeAllSources } = await import('../../chat/historicalFetcher.js');
    const r = await fetchEmployeeAllSources(
      { fio: 'Иванов Иван', confluenceAccountId: 'cf-1' },
      { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' },
    );
    assert.ok(r.jira);
    assert.equal(r.jira.total, 1);
    assert.ok(r.bb);
    assert.equal(r.bb.total, 0);
    assert.ok(r.cf);
    assert.equal(r.cf.total, 0);
    assert.equal(r.errors.length, 0);
  });

  test('fetchEmployeeAllSources: partial errors', async () => {
    _setupMockFetch({
      '/api/integrations/jira-fetch-all': { issues: [] },
      '*': () => { throw new Error('fail'); },
    });
    const { fetchEmployeeAllSources } = await import('../../chat/historicalFetcher.js');
    const r = await fetchEmployeeAllSources(
      { fio: 'Иванов Иван' },
      { from: new Date(2026, 4, 1), to: new Date(2026, 5, 1), label: 'май' },
    );
    // Jira ok, BB/CF упали
    assert.ok(r.jira);
    assert.equal(r.errors.length, 2);
    assert.ok(r.errors.some(e => e.source === 'bb'));
    assert.ok(r.errors.some(e => e.source === 'cf'));
  });

  test('summarizeJiraItems', async () => {
    const { summarizeJiraItems } = await import('../../chat/historicalFetcher.js');
    const items = [
      { issuetype: 'Bug',  status: 'Done' },
      { issuetype: 'Bug',  status: 'Open' },
      { issuetype: 'Task', status: 'Done' },
    ];
    const s = summarizeJiraItems(items);
    assert.equal(s.total, 3);
    assert.equal(s.closed, 2);
    assert.equal(s.byType.Bug, 2);
    assert.equal(s.byType.Task, 1);
    assert.equal(s.byStatus.Done, 2);
  });

  test('summarizeBBItems', async () => {
    const { summarizeBBItems } = await import('../../chat/historicalFetcher.js');
    const prs = [
      { state: 'MERGED', repository: { name: 'mobile' } },
      { state: 'MERGED', repository: { name: 'mobile' } },
      { state: 'OPEN',   repository: { name: 'backend' } },
    ];
    const s = summarizeBBItems(prs);
    assert.equal(s.total, 3);
    assert.equal(s.merged, 2);
    assert.equal(s.open, 1);
    assert.equal(s.repos.mobile, 2);
  });
});
