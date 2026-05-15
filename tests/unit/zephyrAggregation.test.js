'use strict';
/* ============================================================
   tests/unit/zephyrAggregation.test.js

   D2 (2026-05-11) — pure-function tests для Zephyr aggregation.
   После production'а где `summary.testCasesScanned: 3487` но
   `sources.zephyr.testsCreated: 0`, добавили:
     · server: `summary.testsCreated/Executed/authorsCount` (sum across authors)
     · client (portfolioPulseModel): synthesize placeholder items когда
       `zEntry.testsCreated > 0` но `items.length === 0` (counter/items mismatch)

   Этот файл проверяет contract на ОБОИХ концах:
     1. _zephyrFetchScale: sum aggregates корректны после fetch
     2. portfolioPulseModel: `participant.zephyrTestsCreatedRecent.length` ===
        max(items в zEntry, zEntry.testsCreated). Это критично для diagnostic
        потому что `sources.zephyr.testsCreated` считается как длина массива.
   ============================================================ */

const { test } = require('node:test');
const assert  = require('node:assert/strict');

const zephyrFactory = require('../../server/zephyr.js');

/* ── Fixture: stub jiraForward returning канонические Scale-API responses ─── */
function makeStubFactory({ testCases = [], testRuns = [], testResults = {} }) {
  // Stub _jiraForward dispatch'ит по URL pattern.
  const jiraForward = async (opts) => {
    const url = String(opts.targetUrl || '');
    if (/\/rest\/atm\/1\.0\/testcase\/search/.test(url)) {
      return { status: 200, text: JSON.stringify(testCases) };
    }
    if (/\/rest\/atm\/1\.0\/testrun\/search/.test(url)) {
      return { status: 200, text: JSON.stringify(testRuns) };
    }
    const trMatch = url.match(/\/rest\/atm\/1\.0\/testrun\/([^/]+)\/testresults/);
    if (trMatch) {
      const key = decodeURIComponent(trMatch[1]);
      return { status: 200, text: JSON.stringify(testResults[key] || []) };
    }
    return { status: 404, text: '' };
  };
  // Sequential pLimit (concurrency не важна в тестах).
  const jiraPLimit = async (_concurrency, tasks) => {
    const out = [];
    for (const t of tasks) out.push(await t());
    return out;
  };
  return zephyrFactory.create({
    jiraRequest: async () => null,
    jiraForward,
    jiraPLimit,
    jiraResolveProjectId: async () => null,
    ppMakeAuthHeader: () => 'Basic stub',
  });
}

/* ─────────────────────────────────────────────────────────────────────── */

test('Scale fetcher — summary.testsCreated === sum(authors[*].testsCreated)', async () => {
  const inWindow = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const z = makeStubFactory({
    testCases: [
      { key: 'TC-1', name: 'Login OK',     createdBy: 'JIRAUSER1001', updatedBy: 'JIRAUSER1001', createdOn: inWindow, updatedOn: inWindow },
      { key: 'TC-2', name: 'Logout OK',    createdBy: 'JIRAUSER1001', updatedBy: 'JIRAUSER1001', createdOn: inWindow, updatedOn: inWindow },
      { key: 'TC-3', name: 'Forgot pass',  createdBy: 'JIRAUSER1001', updatedBy: 'JIRAUSER1001', createdOn: inWindow, updatedOn: inWindow },
      { key: 'TC-4', name: 'Settings',     createdBy: 'JIRAUSER1001', updatedBy: 'JIRAUSER1001', createdOn: inWindow, updatedOn: inWindow },
      { key: 'TC-5', name: 'Profile',      createdBy: 'JIRAUSER1001', updatedBy: 'JIRAUSER1001', createdOn: inWindow, updatedOn: inWindow },
    ],
    testRuns: [],
    testResults: {},
  });
  const cutoffTs = Date.now() - 72 * 3600 * 1000;
  const out = await z._zephyrFetchScale(
    { jiraBaseUrl: 'http://j', jiraToken: 't' },
    false, cutoffTs, ['PROJ'],
  );
  assert.equal(out.summary.testCasesScanned, 5, '5 raw testcases scanned');
  assert.equal(out.summary.testsCreated, 5, 'aggregate testsCreated === 5');
  assert.equal(out.summary.authorsCount, 1, 'one author');
  const authorKey = 'JIRAUSER1001'.toLowerCase(); // _zephyrNormalizeUserKey: только-буквы → lowercase. Цифры → префикс
  // _zephyrNormalizeUserKey возвращает 'JIRAUSER1001' as-is (matches /^[A-Z]+\d+$/ → goes to lowercase branch).
  // Берём фактический ключ из authors:
  const onlyKey = Object.keys(out.authors)[0];
  assert.equal(out.authors[onlyKey].testsCreated, 5);
  assert.equal(out.authors[onlyKey].items.filter(i => i.kind === 'test-case').length, 5);
  assert.equal(authorKey, onlyKey, 'normalize JIRAUSER1001 → lowercase');
});

test('Scale fetcher — out-of-window testcases not counted', async () => {
  const oldDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(); // 30 days ago
  const z = makeStubFactory({
    testCases: [
      { key: 'TC-OLD', name: 'Old', createdBy: 'JIRAUSER1001', updatedBy: 'JIRAUSER1001', createdOn: oldDate, updatedOn: oldDate },
      { key: 'TC-OLD2', name: 'Old2', createdBy: 'JIRAUSER1001', updatedBy: 'JIRAUSER1001', createdOn: oldDate, updatedOn: oldDate },
    ],
    testRuns: [],
    testResults: {},
  });
  const cutoffTs = Date.now() - 72 * 3600 * 1000;
  const out = await z._zephyrFetchScale(
    { jiraBaseUrl: 'http://j', jiraToken: 't' },
    false, cutoffTs, ['PROJ'],
  );
  assert.equal(out.summary.testCasesScanned, 2, '2 raw scanned');
  assert.equal(out.summary.testsCreated, 0, 'aggregate testsCreated === 0 (out of window)');
  assert.equal(Object.keys(out.authors).length, 0, 'no authors registered');
});

test('Scale fetcher — testsExecuted aggregates from /testresults', async () => {
  const inWindow = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const z = makeStubFactory({
    testCases: [],
    testRuns: [{ key: 'TR-1' }, { key: 'TR-2' }],
    testResults: {
      'TR-1': [
        { executedBy: 'JIRAUSER1002', executionDate: inWindow, status: 'Pass' },
        { executedBy: 'JIRAUSER1002', executionDate: inWindow, status: 'Fail' },
      ],
      'TR-2': [
        { executedBy: 'JIRAUSER1003', executionDate: inWindow, status: 'Pass' },
      ],
    },
  });
  const cutoffTs = Date.now() - 72 * 3600 * 1000;
  const out = await z._zephyrFetchScale(
    { jiraBaseUrl: 'http://j', jiraToken: 't' },
    false, cutoffTs, ['PROJ'],
  );
  assert.equal(out.summary.testRunsScanned, 2);
  assert.equal(out.summary.testResultsScanned, 3);
  assert.equal(out.summary.testsExecuted, 3, 'sum(authors.testsExecuted) === 3');
  assert.equal(out.summary.authorsCount, 2);
});

test('Scale fetcher — items.length matches testsCreated for each author', async () => {
  const inWindow = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
  const z = makeStubFactory({
    testCases: [
      { key: 'TC-A', name: 'A', createdBy: 'alice',   updatedBy: 'alice',   createdOn: inWindow, updatedOn: inWindow },
      { key: 'TC-B', name: 'B', createdBy: 'alice',   updatedBy: 'alice',   createdOn: inWindow, updatedOn: inWindow },
      { key: 'TC-C', name: 'C', createdBy: 'bob',     updatedBy: 'bob',     createdOn: inWindow, updatedOn: inWindow },
    ],
    testRuns: [],
    testResults: {},
  });
  const cutoffTs = Date.now() - 72 * 3600 * 1000;
  const out = await z._zephyrFetchScale(
    { jiraBaseUrl: 'http://j', jiraToken: 't' },
    false, cutoffTs, ['PROJ'],
  );
  for (const [k, a] of Object.entries(out.authors)) {
    const itemTcCount = a.items.filter(i => i.kind === 'test-case').length;
    assert.equal(itemTcCount, a.testsCreated, `author ${k}: items === testsCreated`);
  }
  assert.equal(out.summary.testsCreated, 3);
});

/* ─────────────────────────────────────────────────────────────────────── */
/* Client-side: portfolioPulseModel synthesizes items when count > items[].length.
   Чистое тестирование fragment'а логики из integrations/portfolioPulseModel.js
   (lines 988-1006 после D2 fix). Inline-копия чтобы не таскать весь модуль с
   ESM-зависимостями. Логика буквально повторяет production-код.
─────────────────────────────────────────────────────────────────────── */

function _applyZephyrEntryToParticipant(p, zEntry) {
  p.badges  = p.badges || {};
  p.zephyrTestsCreatedRecent  = p.zephyrTestsCreatedRecent  || [];
  p.zephyrTestsExecutedRecent = p.zephyrTestsExecutedRecent || [];
  p.badges.testsCreated48h  = zEntry.testsCreated || 0;
  p.badges.testsExecuted48h = (p.badges.testsExecuted48h || 0) + (zEntry.testsExecuted || 0);
  let pushedCreated = 0, pushedExecuted = 0;
  for (const it of (zEntry.items || [])) {
    const slimItem = { key: it.key, type: it.kind === 'test-run' ? 'TestExecution' : 'Test', summary: it.name || '' };
    if (it.kind === 'test-run') {
      const result = it.status === 'Done' ? 'PASS' : 'EXECUTED';
      p.zephyrTestsExecutedRecent.push({ slim: slimItem, result, at: it.at, source: 'zephyr-api' });
      pushedExecuted++;
    } else {
      p.zephyrTestsCreatedRecent.push({ slim: slimItem, kind: 'test', at: it.at, source: 'zephyr-api' });
      pushedCreated++;
    }
  }
  const declaredCreated  = Number(zEntry.testsCreated)  || 0;
  const declaredExecuted = Number(zEntry.testsExecuted) || 0;
  for (let i = pushedCreated; i < declaredCreated; i++) {
    p.zephyrTestsCreatedRecent.push({
      slim: { key: '', type: 'Test', summary: '' },
      kind: 'test', at: '', source: 'zephyr-api-counter',
    });
  }
  for (let i = pushedExecuted; i < declaredExecuted; i++) {
    p.zephyrTestsExecutedRecent.push({
      slim: { key: '', type: 'TestExecution', summary: '' },
      result: 'EXECUTED', at: '', source: 'zephyr-api-counter',
    });
  }
}

test('Client model — synthesizes placeholder items when counter > items.length', () => {
  const p = {};
  // Симулируем ситуацию когда server'у пришлось сообщить counter, но items
  // пусты (например identity-mismatch на per-item check, или server cap=50
  // hit, или legacy fetcher без items).
  _applyZephyrEntryToParticipant(p, { testsCreated: 7, testsExecuted: 0, items: [] });
  assert.equal(p.zephyrTestsCreatedRecent.length, 7, 'synthesized 7 placeholder items');
  assert.equal(p.zephyrTestsExecutedRecent.length, 0);
  assert.equal(p.badges.testsCreated48h, 7);
  // All synthesized items have source='zephyr-api-counter'.
  for (const it of p.zephyrTestsCreatedRecent) {
    assert.equal(it.source, 'zephyr-api-counter');
    assert.equal(it.kind, 'test');
  }
});

test('Client model — preserves real items + synthesizes only the missing tail', () => {
  const p = {};
  _applyZephyrEntryToParticipant(p, {
    testsCreated: 5, testsExecuted: 0,
    items: [
      { kind: 'test-case', key: 'TC-1', name: 'Real 1', at: 'ts1' },
      { kind: 'test-case', key: 'TC-2', name: 'Real 2', at: 'ts2' },
    ],
  });
  assert.equal(p.zephyrTestsCreatedRecent.length, 5);
  // First 2 are real (with key + source='zephyr-api'), last 3 are synthesized.
  assert.equal(p.zephyrTestsCreatedRecent[0].source, 'zephyr-api');
  assert.equal(p.zephyrTestsCreatedRecent[0].slim.key, 'TC-1');
  assert.equal(p.zephyrTestsCreatedRecent[2].source, 'zephyr-api-counter');
  assert.equal(p.zephyrTestsCreatedRecent[4].source, 'zephyr-api-counter');
});

test('Client model — testsExecuted synthesis works the same way', () => {
  const p = {};
  _applyZephyrEntryToParticipant(p, { testsCreated: 0, testsExecuted: 4, items: [] });
  assert.equal(p.zephyrTestsExecutedRecent.length, 4);
  for (const it of p.zephyrTestsExecutedRecent) {
    assert.equal(it.source, 'zephyr-api-counter');
    assert.equal(it.result, 'EXECUTED');
  }
});

test('Client model — counter < items.length (impossible normally) — no negative loop', () => {
  // Defence: server.testsCreated=2 but items has 5 entries (e.g., test-case-edit
  // items also pushed). Не должно вызывать infinite loop / negative count.
  const p = {};
  _applyZephyrEntryToParticipant(p, {
    testsCreated: 2, testsExecuted: 0,
    items: [
      { kind: 'test-case',      key: 'TC-1', name: '1', at: '' },
      { kind: 'test-case',      key: 'TC-2', name: '2', at: '' },
      { kind: 'test-case',      key: 'TC-3', name: '3', at: '' },
      { kind: 'test-case-edit', key: 'TC-4', name: '4', at: '' },
      { kind: 'test-case-edit', key: 'TC-5', name: '5', at: '' },
    ],
  });
  // Все 5 items пушатся (loop pushes regardless), нет synthesis (5 >= 2).
  assert.equal(p.zephyrTestsCreatedRecent.length, 5);
});
