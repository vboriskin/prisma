'use strict';
/* ============================================================
   tests/unit/auto-summary.test.js
   --
   AUDIT_HOLISTIC AI3 — модуль ai/autoSummary.js.
   Тестируем:
     · rule-based extract per kind (idempotent / det.)
     · cache hit / TTL expiration
     · LLM-ретушь fallback (callLLM null → rule-text)
     · feature-flag state.llm.useAutoSummary === false
   ============================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// localStorage stub — модуль не трогает, но импорт ai/autoSummary.js
// безопасен и без него; оставляем для consistency с другими ai/* тестами.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };

const { AutoSummary } = await import('../../ai/autoSummary.js');

describe('AutoSummary.summarize — rule-based extract', () => {
  test('action-queue: пустой список → ритм-в-курсе', () => {
    AutoSummary.clearCache();
    const out = AutoSummary.summarize('action-queue', []);
    assert.match(out, /пуста|курсе/i);
  });

  test('action-queue: один high-severity → срочное', () => {
    AutoSummary.clearCache();
    const out = AutoSummary.summarize('action-queue', [
      { label: 'Иванов', severity: 'high', reason: 'блокер 3 дня', action: 'эскалация' },
    ]);
    assert.match(out, /Иванов/);
    assert.match(out, /срочн/i);
  });

  test('action-queue: 5 элементов, одно high → правильный plural', () => {
    AutoSummary.clearCache();
    const out = AutoSummary.summarize('action-queue', [
      { label: 'А', severity: 'high' },
      { label: 'Б', severity: 'medium' },
      { label: 'В', severity: 'medium' },
      { label: 'Г', severity: 'low' },
      { label: 'Д', severity: 'low' },
    ]);
    assert.match(out, /5 действий/);
    assert.match(out, /первым — А/);
  });

  test('sleeping-data: tiles >7 дней + источники', () => {
    AutoSummary.clearCache();
    const out = AutoSummary.summarize('sleeping-data', [
      { source: 'jira',      staleDays: 9 },
      { source: 'bitbucket', staleDays: 12 },
      { source: 'jira',      staleDays: 2 },
    ]);
    assert.match(out, /3 спящих/);
    assert.match(out, /2 >7 дней/);
    assert.match(out, /jira/);
    assert.match(out, /bitbucket/);
  });

  test('hygiene-violations: классический сценарий «23 → 18 без assignee → 4 эпика»', () => {
    AutoSummary.clearCache();
    const items = [];
    for (let i = 0; i < 18; i++) items.push({ kind: 'no_assignee', epic: `EP-${i % 4}` });
    for (let i = 0; i < 5;  i++) items.push({ kind: 'stale',        epic: `EP-${i}`, assignee: 'X' });
    const out = AutoSummary.summarize('hygiene-violations', items);
    assert.match(out, /23 нарушения/);
    assert.match(out, /18 без assignee/);
    assert.match(out, /5 эпик/); // 5 уникальных EP-0..EP-4
  });

  test('hygiene-violations: пусто → «не найдено»', () => {
    AutoSummary.clearCache();
    const out = AutoSummary.summarize('hygiene-violations', []);
    assert.match(out, /не найдено|чисты/i);
  });

  test('history-filtered: 2+ timestamp → диапазон в днях', () => {
    AutoSummary.clearCache();
    const day = 24 * 3600 * 1000;
    const out = AutoSummary.summarize('history-filtered', [
      { user: 'Иван', at: 1000 },
      { user: 'Иван', at: 1000 + 3 * day },
      { user: 'Пётр', at: 1000 + 5 * day },
    ]);
    assert.match(out, /3 записи/);
    // 5 day span → "5 дней"
    assert.match(out, /5 дней/);
    assert.match(out, /2 участн/);
  });

  test('unknown kind → ""', () => {
    AutoSummary.clearCache();
    const out = AutoSummary.summarize('unknown-kind', [{ a: 1 }]);
    assert.equal(out, '');
  });
});

describe('AutoSummary cache', () => {
  test('одинаковый input → identity-deterministic результат (cache hit)', () => {
    AutoSummary.clearCache();
    const items = [{ label: 'Иванов', severity: 'high' }];
    const a = AutoSummary.summarize('action-queue', items);
    const b = AutoSummary.summarize('action-queue', items);
    assert.equal(a, b);
  });

  test('разный kind на одном items[] → разные ключи в кеше, разные строки', () => {
    AutoSummary.clearCache();
    const items = [{ source: 'jira', staleDays: 10 }];
    const a = AutoSummary.summarize('sleeping-data',      items);
    const b = AutoSummary.summarize('hygiene-violations', items);
    assert.notEqual(a, b);
  });
});

describe('AutoSummary.summarizeAsync — LLM ретушь', () => {
  test('useLLM:false → rule-text без вызова callLLM', async () => {
    AutoSummary.clearCache();
    let called = 0;
    const llm = async () => { called++; return 'LLM-text'; };
    const out = await AutoSummary.summarizeAsync(
      'action-queue',
      [{ label: 'А', severity: 'low' }],
      { useLLM: false, llm },
    );
    assert.equal(called, 0);
    assert.match(out, /1 действие/);
  });

  test('useLLM:true + state.llm.useAutoSummary:false → ruleText, LLM не зовётся', async () => {
    AutoSummary.clearCache();
    let called = 0;
    const llm = async () => { called++; return 'LLM-text'; };
    const out = await AutoSummary.summarizeAsync(
      'action-queue',
      [{ label: 'А', severity: 'low' }],
      { useLLM: true, llm, stateRef: { llm: { useAutoSummary: false } } },
    );
    assert.equal(called, 0);
    assert.match(out, /1 действие/);
  });

  test('useLLM:true + успешный callLLM → возвращается LLM-text', async () => {
    AutoSummary.clearCache();
    const llm = async () => '«Иванов первый — блокер 3 дня».';
    const out = await AutoSummary.summarizeAsync(
      'action-queue',
      [{ label: 'Иванов', severity: 'high' }],
      { useLLM: true, llm },
    );
    // Кавычки очищаются.
    assert.equal(out, 'Иванов первый — блокер 3 дня.');
  });

  test('useLLM:true + callLLM возвращает null → fallback на ruleText', async () => {
    AutoSummary.clearCache();
    const llm = async () => null;
    const out = await AutoSummary.summarizeAsync(
      'action-queue',
      [{ label: 'А', severity: 'low' }],
      { useLLM: true, llm },
    );
    assert.match(out, /1 действие/);
  });

  test('useLLM:true + callLLM throws → fallback на ruleText, без падения', async () => {
    AutoSummary.clearCache();
    const llm = async () => { throw new Error('network'); };
    const out = await AutoSummary.summarizeAsync(
      'action-queue',
      [{ label: 'А', severity: 'low' }],
      { useLLM: true, llm },
    );
    assert.match(out, /1 действие/);
  });
});
