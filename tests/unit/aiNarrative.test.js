'use strict';
/* tests/unit/aiNarrative.test.js — V22+ Week 4 (LP-09). */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function _report() {
  return {
    text: '## Сводка по сотруднику: Иванов Иван\n**Период:** Q1 2026 (90 дн.)\n### Кратко\n- **Закрыто задач:** 12\n### Jira\n**Всего:** 15 · **Закрыто:** 12\n**Топ задачи:**\n- `BIK-1` KYC backend\n- `BIK-2` Pay v2\n### Bitbucket\n**PR всего:** 5 · **Merged:** 4\n### Confluence\n**Страниц/правок:** 3',
    cards: [],
    actions: [],
    drilldown: [],
    _meta: {
      kind: 'employee_report',
      employee: 'iv@sber.ru',
      employeeLabel: 'Иванов Иван',
      period: { label: 'Q1 2026', from: '2026-01-01', to: '2026-04-01' },
      sources: ['jira', 'bb', 'cf'],
      totals: { jira: 15, bb: 5, cf: 3 },
    },
  };
}

describe('generateAINarrative', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('null report → null', async () => {
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    assert.equal(await generateAINarrative(null), null);
    assert.equal(await generateAINarrative({}), null);
  });

  test('wrong meta.kind → null', async () => {
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    const result = await generateAINarrative({ _meta: { kind: 'other' } });
    assert.equal(result, null);
  });

  test('dryRun → возвращает prompt (без сети)', async () => {
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    const prompt = await generateAINarrative(_report(), { dryRun: true });
    assert.ok(typeof prompt === 'string');
    assert.match(prompt, /Иванов/);
    assert.match(prompt, /Q1 2026/);
    assert.match(prompt, /Jira задач за период: 15/);
    assert.match(prompt, /BIK-1/);  // top items извлечены
    assert.match(prompt, /BIK-2/);
  });

  test('happy path: LLM вернул narrative → строка', async () => {
    const { createLlmStub } = await import('../_helpers/llmStub.js');
    const stub = createLlmStub();
    stub.setNextResponse(null);  // reset SSE
    const { mockFetch } = await import('../_helpers/llmStub.js');
    mockFetch({
      '/api/llm/chat': {
        choices: [{ message: { content: 'Иван активно работал над KYC backend, закрыл 12 задач из 15 запланированных. Основной вклад — в backend-team. PR-ы шли в репозиторий mobile. Видна стабильная активность.' } }],
      },
    });
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    const narrative = await generateAINarrative(_report());
    assert.ok(typeof narrative === 'string');
    assert.match(narrative, /KYC/);
    assert.ok(narrative.length > 30);
  });

  test('LLM 5xx error → null (soft fallback)', async () => {
    const { mockFetch } = await import('../_helpers/llmStub.js');
    mockFetch({
      '/api/llm/chat': () => ({
        _isMockResponse: true,
        ok: false,
        status: 500,
        text: async () => 'server error',
        json: async () => ({ error: 'server error' }),
        body: null,
      }),
    });
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    const narrative = await generateAINarrative(_report());
    assert.equal(narrative, null);
  });

  test('LLM возвращает empty text → null', async () => {
    const { mockFetch } = await import('../_helpers/llmStub.js');
    mockFetch({
      '/api/llm/chat': {
        choices: [{ message: { content: '' } }],
      },
    });
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    const narrative = await generateAINarrative(_report());
    assert.equal(narrative, null);
  });

  test('LLM возвращает < 30 chars → null', async () => {
    const { mockFetch } = await import('../_helpers/llmStub.js');
    mockFetch({
      '/api/llm/chat': {
        choices: [{ message: { content: 'короткий ответ' } }],
      },
    });
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    const narrative = await generateAINarrative(_report());
    assert.equal(narrative, null);
  });

  test('injectNarrative: добавляет badge + текст', async () => {
    const { injectNarrative } = await import('../../chat/aiNarrative.js');
    const report = _report();
    const result = injectNarrative(report, 'Тестовый narrative-обзор работы сотрудника за период.');
    assert.match(result.text, /AI-обзор/);
    assert.match(result.text, /Тестовый narrative-обзор/);
    assert.equal(result._meta.hasNarrative, true);
    // Header сохранён
    assert.match(result.text, /## Сводка по сотруднику: Иванов Иван/);
  });

  test('injectNarrative: null narrative → не меняет structured', async () => {
    const { injectNarrative } = await import('../../chat/aiNarrative.js');
    const report = _report();
    const result = injectNarrative(report, null);
    assert.equal(result, report);
  });

  test('AbortSignal abort → null', async () => {
    const { mockFetch } = await import('../_helpers/llmStub.js');
    // Slow response simulation
    mockFetch({
      '/api/llm/chat': () => new Promise((resolve) => {
        setTimeout(() => resolve({ choices: [{ message: { content: 'late' } }] }), 1000);
      }),
    });
    const ctrl = new AbortController();
    const { generateAINarrative } = await import('../../chat/aiNarrative.js');
    setTimeout(() => ctrl.abort(), 20);
    const narrative = await generateAINarrative(_report(), { signal: ctrl.signal });
    assert.equal(narrative, null);
  });
});
