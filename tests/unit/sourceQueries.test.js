'use strict';
/* tests/unit/sourceQueries.test.js — V22+ Week 3 (S-S1..S-S5). */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

async function _setup() {
  const { mockState, mockServices, resetAllChatStubs } = await import('../_helpers/llmStub.js');
  return { mockState, mockServices, resetAllChatStubs };
}

function _scannerModelWithIvanov() {
  return {
    fetchedAt: new Date().toISOString(),
    projectKeys: ['PAY'],
    participants: [
      {
        key: 'иванов иван',
        email: 'iv@sber.ru',
        jiraAccountId: 'jaid-iv',
        label: 'Иванов Иван',
        deactivated: false,
        projects: ['PAY'],
        issuesNow: [
          { key: 'BIK-1', summary: 'KYC v3', status: 'In Progress', updated: new Date().toISOString() },
          { key: 'BIK-2', summary: 'Pay gateway', status: 'To Do', updated: new Date().toISOString() },
        ],
        doneToday: [{ key: 'BIK-3', summary: 'Auth fix', at: new Date().toISOString() }],
        doneYesterday: [],
        blockers: [{ issueKey: 'BIK-1', blockerKey: 'EXT-99', dwellHours: 72, at: new Date().toISOString() }],
        bbItems: [
          { kind: 'pr', state: 'MERGED', repo: 'mobile', title: 'KYC PR', at: new Date().toISOString() },
          { kind: 'commit', repo: 'mobile', message: 'fix bug', at: new Date().toISOString() },
        ],
        cfItems: [{ title: 'KYC requirements', space: { key: 'PAY' }, at: new Date().toISOString() }],
      },
      {
        key: 'петров пётр',
        email: 'pe@sber.ru',
        label: 'Петров Пётр',
        deactivated: false,
        projects: ['PAY'],
        issuesNow: [{ key: 'BIK-10', updated: new Date().toISOString() }],
        bbItems: [{ kind: 'pr', state: 'OPEN', repo: 'mobile', at: new Date().toISOString() }],
        cfItems: [],
      },
    ],
  };
}

describe('buildSourceQueryResponse', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('hasModel=false → soft-fallback с refresh CTA', async () => {
    const { mockServices } = await _setup();
    await mockServices({ TeamScanner2: { getModel: () => null } });
    const { buildSourceQueryResponse } = await import('../../chat/sourceQueries.js');
    const r = buildSourceQueryResponse({ employee: { id: 'iv@sber.ru' } });
    assert.match(r.text, /Сканнер ещё не запускался/);
    assert.ok(r.actions.some(a => a.payload?.section === 'scanner2'));
  });

  test('per-person query: Иванов вчера', async () => {
    const { mockServices, mockState } = await _setup();
    await mockServices({ TeamScanner2: { getModel: () => _scannerModelWithIvanov() } });
    await mockState({ employees: [], rows: [], integrations: {} });
    const { buildSourceQueryResponse } = await import('../../chat/sourceQueries.js');
    const t = {
      employee: { id: 'iv@sber.ru', email: 'iv@sber.ru', label: 'Иванов Иван' },
      sources: ['jira', 'bb', 'cf'],
      period: { from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 86400_000), label: 'вчера' },
      raw: { text: 'Иванов вчера' },
    };
    const r = buildSourceQueryResponse(t);
    assert.equal(r._meta.kind, 'source_query_person');
    assert.match(r.text, /Иванов/);
    // Cards expected ≥3
    assert.ok(r.cards.length >= 3);
    // Should have deep-link to Scanner
    assert.ok(r.actions.some(a => a.type === 'set_focus'));
  });

  test('per-team query: PAY за неделю', async () => {
    const { mockServices, mockState } = await _setup();
    await mockServices({ TeamScanner2: { getModel: () => _scannerModelWithIvanov() } });
    await mockState({
      employees: [
        { email: 'iv@sber.ru', fio: 'Иванов Иван', team: 'PAY', jiraAccountId: 'jaid-iv' },
        { email: 'pe@sber.ru', fio: 'Петров Пётр', team: 'PAY' },
      ],
      rows: [{ team: 'PAY' }],
      integrations: {},
    });
    const { buildSourceQueryResponse } = await import('../../chat/sourceQueries.js');
    const t = {
      team: { name: 'PAY' },
      sources: ['jira', 'bb', 'cf'],
      period: { from: new Date(Date.now() - 7 * 86400_000), to: new Date(Date.now() + 86400_000), label: 'неделя' },
      raw: { text: 'команда PAY за неделю' },
    };
    const r = buildSourceQueryResponse(t);
    assert.equal(r._meta.kind, 'source_query_team');
    assert.equal(r._meta.participantsCount, 2);
    assert.match(r.text, /Команда PAY/);
    assert.match(r.text, /Топ участники/);
  });

  test('unknown employee → понятный fallback', async () => {
    const { mockServices, mockState } = await _setup();
    await mockServices({ TeamScanner2: { getModel: () => _scannerModelWithIvanov() } });
    await mockState({ employees: [], rows: [], integrations: {} });
    const { buildSourceQueryResponse } = await import('../../chat/sourceQueries.js');
    const t = {
      employee: { id: 'unknown@sber.ru', label: 'Несуществующий', email: 'unknown@sber.ru' },
      sources: ['jira'],
      period: { from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 86400_000), label: 'вчера' },
      raw: { text: 'unknown' },
    };
    const r = buildSourceQueryResponse(t);
    assert.match(r.text, /Не нашёл/);
  });

  test('filter по source: только BB', async () => {
    const { mockServices, mockState } = await _setup();
    await mockServices({ TeamScanner2: { getModel: () => _scannerModelWithIvanov() } });
    await mockState({ employees: [], rows: [], integrations: {} });
    const { buildSourceQueryResponse } = await import('../../chat/sourceQueries.js');
    const t = {
      employee: { id: 'iv@sber.ru', email: 'iv@sber.ru', label: 'Иванов Иван' },
      sources: ['bb'],
      period: { from: new Date(Date.now() - 7 * 86400_000), to: new Date(Date.now() + 86400_000), label: 'неделя' },
      raw: { text: 'BB у Иванова' },
    };
    const r = buildSourceQueryResponse(t);
    assert.match(r.text, /Bitbucket/);
    assert.doesNotMatch(r.text, /### Jira/);
    assert.doesNotMatch(r.text, /### Confluence/);
  });

  test('time chip-bar (UX-01) присутствует в actions', async () => {
    const { mockServices } = await _setup();
    await mockServices({ TeamScanner2: { getModel: () => _scannerModelWithIvanov() } });
    const { buildSourceQueryResponse } = await import('../../chat/sourceQueries.js');
    const t = {
      employee: { id: 'iv@sber.ru', email: 'iv@sber.ru', label: 'Иванов Иван' },
      sources: ['jira'],
      period: { from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 86400_000), label: 'вчера' },
      raw: { text: 'Иванов вчера' },
    };
    const r = buildSourceQueryResponse(t);
    // Должен быть хотя бы один send_prompt — это time-chip-bar.
    const promptChips = r.actions.filter(a => a.type === 'send_prompt');
    assert.ok(promptChips.length >= 2);
  });
});
