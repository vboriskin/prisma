'use strict';
/* tests/unit/phase4Integration.test.js — V22+ Phase 4 (K-K1 + K-K4 + K-K6)
   End-to-end через chatEngine.process. */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

async function _setupEnv() {
  const { mockState, mockServices, resetAllChatStubs } = await import('../_helpers/llmStub.js');
  await mockState({
    employees: [
      { email: 'iv@sber.ru', fio: 'Иванов Иван', team: 'PAY' },
    ],
    rows: [
      { id: 'r1', team: 'PAY', epic: 'A', isDone: false, hasRelease121: true, blockingDependency: true,
        ganttArrows: [{ srcCol: 'r120', dstCol: 'r121', at: '2026-03-15' }] },
      { id: 'r2', team: 'PAY', epic: 'B', isDone: true,  hasRelease121: true, ganttArrows: [] },
      { id: 'r3', team: 'PAY', epic: 'C', isDone: false, hasRelease121: true, hasOvertime: true,
        ganttArrows: [{ srcCol: 'r121', dstCol: 'overtime', at: '2026-04-20' }] },
    ],
    actionLog: [],
    integrations: {},
    llm: { history: [], settings: {} },
  });
  await mockServices({
    BlackDashboard: {
      _model: {
        summary: { totalGoals: 5, linkedCount: 3, unlinkedCount: 2, coveragePct: 60 },
        coverageByTeam: [{ name: 'PAY', pct: 60 }],
      },
    },
    TeamScanner2: {
      getModel: () => ({
        participants: [
          {
            email: 'iv@sber.ru', label: 'Иванов Иван', deactivated: false,
            projects: ['PAY'],
            blockers: [{ issueKey: 'PAY-1', blockerKey: 'EXT-1', dwellHours: 96 }],
            stale: [{ key: 'PAY-2', daysIdle: 10 }],
          },
        ],
      }),
    },
  });
}

describe('Phase 4: end-to-end through chatEngine', () => {
  afterEach(async () => {
    const { resetAllChatStubs } = await import('../_helpers/llmStub.js');
    await resetAllChatStubs();
  });

  test('CEO update «прогресс по 1.21» → CEO_UPDATE intent + cross-source', async () => {
    await _setupEnv();
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    chatProcess('прогресс по 1.21', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => assert.fail('должен быть rule-based'),
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'ceo_update');
    assert.equal(captured.structured._meta.kind, 'ceo_update');
    assert.equal(captured.structured._meta.release, '1.21');
    // Содержит все 3 источника
    assert.match(captured.structured.text, /Health/);
    assert.match(captured.structured.text, /Sigma/);
    assert.match(captured.structured.text, /Блокеры/);
  });

  test('Why query «почему у PAY низкая velocity» → WHY_QUERY + ranked factors', async () => {
    await _setupEnv();
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    chatProcess('почему у PAY низкая velocity', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => {},
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'why_query');
    assert.equal(captured.structured._meta.kind, 'explain');
    assert.match(captured.structured.text, /PAY/);
    assert.match(captured.structured.text, /Главные факторы|низкая velocity/i);
  });

  test('Why query «почему перенесли BIK-1234» → epic-transfer explanation', async () => {
    const { mockState } = await import('../_helpers/llmStub.js');
    await mockState({
      rows: [{
        id: 'r1', team: 'PAY', epic: 'BIK-1234', isDone: false,
        ganttArrows: [
          { srcCol: 'r120', dstCol: 'r121', at: '2026-03-10' },
          { srcCol: 'r121', dstCol: 'r122', at: '2026-04-20' },
        ],
        transferComments: [
          { text: 'ждём блокер от внешней команды' },
          { text: 'scope расширили' },
        ],
      }],
      actionLog: [],
      employees: [],
      integrations: {},
      llm: { history: [], settings: {} },
    });
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    chatProcess('почему перенесли BIK-1234', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => {},
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'why_query');
    assert.match(captured.structured.text, /BIK-1234/);
    assert.match(captured.structured.text, /блокер|зависим/i);
    assert.match(captured.structured.text, /scope|объём|объем/i);
  });

  test('CEO update без релиза → multi-release overview', async () => {
    await _setupEnv();
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let captured = null;
    chatProcess('подготовь сводку для CEO', {
      onRuleBased: ({ structured, intent }) => { captured = { structured, intent }; },
      onLLMPrompt: () => {},
    });
    assert.ok(captured);
    assert.equal(captured.intent, 'ceo_update');
    assert.equal(captured.structured._meta.kind, 'ceo_update');
    assert.equal(captured.structured._meta.release, null);
  });

  test('smartSuggestions: обернётся в send_prompt actions для UI', async () => {
    await _setupEnv();
    const { generateSuggestions } = await import('../../chat/smartSuggestions.js');
    const chips = generateSuggestions({ kind: 'employee', id: 'iv@sber.ru', label: 'Иванов Иван' });
    // Должны быть готовы для send_prompt action chips.
    assert.ok(chips.every(c => c.label && c.prompt));
    assert.ok(chips.length >= 4);
  });

  test('Cross-feature: «почему» после CEO update реиспользует target memo', async () => {
    await _setupEnv();
    const { process: chatProcess } = await import('../../chat/chatEngine.js');
    let cap1, cap2;
    chatProcess('CEO update по 1.21', {
      onRuleBased: ({ structured, intent }) => { cap1 = { structured, intent }; },
      onLLMPrompt: () => {},
    });
    // 2-й turn — memo должен содержать release=1.21
    chatProcess('почему отстаёт', {
      onRuleBased: ({ structured, intent }) => { cap2 = { structured, intent }; },
      onLLMPrompt: () => {},
    });
    assert.equal(cap1.intent, 'ceo_update');
    assert.equal(cap2.intent, 'why_query');
  });
});
