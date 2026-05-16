'use strict';
/* tests/unit/release2Api.test.js — V22+ Phase 5 API client. */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const FIXTURE = '/Users/vaceslavboriskin/PycharmProjects/n8n/work/IDP/release_2_0.json';

describe('release2Api', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('fetchRelease2List: happy path — нормализует и группирует', async () => {
    const { mockFetch } = await import('../_helpers/llmStub.js');
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    mockFetch({
      '/api/integrations/release2-fetch': {
        issues: [raw],
        jql: 'issuetype = "Release 2.0" ...',
        count: 1,
        projectKeys: ['SMECM'],
        statusesExcluded: ['Установлен на ПРОМ', 'Отменено'],
        since: '2025-05-20',
        fetchedAt: new Date().toISOString(),
      },
    });
    const { fetchRelease2List } = await import('../../integrations/release2/release2Api.js');
    const r = await fetchRelease2List();
    assert.equal(r.releases.length, 1);
    assert.equal(r.releases[0].key, 'SMECM-22526');
    assert.equal(r.stats.total, 1);
    assert.equal(r.jql, 'issuetype = "Release 2.0" ...');
    assert.ok(r.byProject instanceof Map);
  });

  test('fetchRelease2List: 4xx error → throws', async () => {
    const { mockFetch } = await import('../_helpers/llmStub.js');
    mockFetch({
      '/api/integrations/release2-fetch': () => ({
        _isMockResponse: true,
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: 'Jira не настроена' }),
        json: async () => ({ error: 'Jira не настроена' }),
        body: null,
      }),
    });
    const { fetchRelease2List } = await import('../../integrations/release2/release2Api.js');
    await assert.rejects(() => fetchRelease2List(), /Jira не настроена/);
  });

  test('fetchRelease2List: передаёт фильтры в body', async () => {
    let capturedBody = null;
    const { mockFetch } = await import('../_helpers/llmStub.js');
    mockFetch({
      '/api/integrations/release2-fetch': (body) => {
        capturedBody = body;
        return { issues: [], jql: '', count: 0, fetchedAt: new Date().toISOString() };
      },
    });
    const { fetchRelease2List } = await import('../../integrations/release2/release2Api.js');
    await fetchRelease2List({
      projectKeys: ['PAY', 'CORE'],
      sinceDate: '2026-01-01',
      includeAllStatuses: false,
      statusesToExclude: ['Отменено'],
    });
    assert.deepEqual(capturedBody.projectKeys, ['PAY', 'CORE']);
    assert.equal(capturedBody.sinceDate, '2026-01-01');
    assert.deepEqual(capturedBody.statuses, ['Отменено']);
    assert.ok(Array.isArray(capturedBody.fields));
    assert.ok(capturedBody.fields.length > 50);
  });

  test('fetchRelease2Related: пустые keys → []', async () => {
    const { fetchRelease2Related } = await import('../../integrations/release2/release2Api.js');
    assert.deepEqual(await fetchRelease2Related([]), []);
    assert.deepEqual(await fetchRelease2Related(null), []);
  });

  test('fetchRelease2Related: возвращает issues array', async () => {
    const { mockFetch } = await import('../_helpers/llmStub.js');
    mockFetch({
      '/api/integrations/release2-related': {
        issues: [
          { key: 'X-1', fields: { summary: 'test', status: { name: 'In Progress' } } },
        ],
        count: 1,
      },
    });
    const { fetchRelease2Related } = await import('../../integrations/release2/release2Api.js');
    const r = await fetchRelease2Related(['X-1']);
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'X-1');
  });
});

describe('release2Renderer', () => {
  test('escapeHtml: основные сущности', async () => {
    const { escapeHtml } = await import('../../integrations/release2/release2Renderer.js');
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.equal(escapeHtml('"&\''), '&quot;&amp;&#39;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  test('renderRelease2View: пустой список → empty state', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const { release2State } = await import('../../integrations/release2/release2State.js');
    const html = renderRelease2View(
      { releases: [], byProject: new Map(), byStatus: new Map(), byOwner: new Map(), stats: { total: 0, byPhase: {} } },
      release2State
    );
    assert.match(html, /Нет релизов под текущие фильтры|Release 2\.0/);
  });

  test('renderRelease2View: с релизом → корректная разметка', async () => {
    const { renderRelease2View } = await import('../../integrations/release2/release2Renderer.js');
    const { analyseRelease2List } = await import('../../integrations/release2/release2Model.js');
    const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const analysed = analyseRelease2List([raw]);
    const state = {
      groupBy: 'project',
      sort: 'priority',
      filters: { projectKeys: [], statuses: [], types: [], risks: [], searchText: '', smartPreset: '' },
      expandedKeys: new Set(),
      getExpandedTab: () => 'attrs',
      getRelated: () => null,
    };
    const html = renderRelease2View(analysed, state, { jiraBaseUrl: 'https://jira.sber.ru' });
    assert.match(html, /SMECM-22526/);
    assert.match(html, /Release 2\.0/);
    assert.match(html, /КАР\..*Релиз 1\.21|SMECM-22526/);
    assert.match(html, /Credit process \(KAR\)/);
  });
});
