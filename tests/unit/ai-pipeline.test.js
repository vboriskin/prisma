'use strict';
/* ============================================================
   tests/unit/ai-pipeline.test.js
   --
   Tests for the AIPipeline orchestrator (AUDIT_HOLISTIC O6) and
   the UnifiedFallbackEngine that backs it. Covers:
     1. register / getRegisteredBlocks по kind
     2. run() с LLM mock — source='ai', merge корректный
     3. run() с падением LLM (mock throws / null) — fallback,
        source='rule-based'
     4. runAll() → массив, source-маркеры на каждом
     5. блок без llmPrompt → всегда rule-based
     6. UnifiedFallbackEngine output идентичен старому
        aiFallbackEngine.runAllBlocks (regression-guard)
   ============================================================ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import AIPipeline, {
  register, run, runAll, getRegisteredBlocks, clearRegistry,
} from '../../ai/AIPipeline.js';
import {
  ANALYSIS_BLOCKS, CEO_BLOCKS, registerAllBlocks,
} from '../../ai/blockConfig.js';
import {
  buildBlockData, runAllAnalysisBlocks, runAllCeoBlocks,
  computeProjectHealth as U_computeProjectHealth,
} from '../../ai/UnifiedFallbackEngine.js';
import {
  computeProjectHealth, computeForecast, computeBaseMetrics, runAllBlocks,
} from '../../ai/aiFallbackEngine.js';

function makeRow(over = {}) {
  return {
    id: 'r1', team: 'Pay', epic: 'Test', tasks: 'demo',
    isDone: false, blockingDependency: false, isUnassigned: false,
    scopeStatus: 'Да', riskFlags: [], assignee: 'Иван',
    hasRelease120: false, hasRelease121: false, hasRelease122: false, hasOvertime: false,
    riskScore: 0,
    ...over,
  };
}

describe('AIPipeline.register / getRegisteredBlocks', () => {
  beforeEach(() => clearRegistry());

  test('register stores descriptor and getRegisteredBlocks returns it', () => {
    register({ id: 'demo', kind: 'analysis', fallback: () => ({ ok: 1 }) });
    const all = getRegisteredBlocks();
    assert.equal(all.length, 1);
    assert.equal(all[0].id, 'demo');
  });

  test('getRegisteredBlocks(kind) фильтрует по kind', () => {
    register({ id: 'a', kind: 'analysis', fallback: () => ({}) });
    register({ id: 'c', kind: 'ceo',      fallback: () => ({}) });
    register({ id: 'e', kind: 'exec',     fallback: () => ({}) });
    assert.equal(getRegisteredBlocks('analysis').length, 1);
    assert.equal(getRegisteredBlocks('ceo').length, 1);
    assert.equal(getRegisteredBlocks('exec').length, 1);
  });

  test('register без id или fallback бросает', () => {
    assert.throws(() => register({ kind: 'analysis', fallback: () => ({}) }));
    assert.throws(() => register({ id: 'x', kind: 'analysis' }));
  });

  test('registerAllBlocks() из blockConfig регистрирует 13+5+1', () => {
    registerAllBlocks(AIPipeline);
    assert.equal(getRegisteredBlocks('analysis').length, ANALYSIS_BLOCKS.length);
    assert.equal(getRegisteredBlocks('ceo').length,      CEO_BLOCKS.length);
    assert.equal(getRegisteredBlocks('exec').length,     1);
  });
});

describe('AIPipeline.run — LLM mock path', () => {
  beforeEach(() => clearRegistry());

  test('LLM возвращает данные → result.source = "ai", merge сработал', async () => {
    register({
      id: 'health', kind: 'analysis',
      llmPrompt: 'analyze',
      fallback: ctx => ({ id:'health', summary:'fb', score: 50, source:'rule-based' }),
    });
    const llmCaller = async () => ({ summary: 'AI says hi', score: 88 });
    const res = await run('health', { rows: [] }, { llmCaller });
    assert.equal(res.source, 'ai');
    assert.equal(res.data.summary, 'AI says hi');
    assert.equal(res.data.score, 88);
    assert.equal(res.data.aiEnhanced, true);
  });

  test('LLM возвращает null → fallback используется, source = "rule-based"', async () => {
    register({
      id: 'forecast', kind: 'analysis',
      llmPrompt: 'forecast',
      fallback: () => ({ id:'forecast', summary:'rb', source:'rule-based' }),
    });
    const llmCaller = async () => null;
    const res = await run('forecast', { rows: [] }, { llmCaller });
    assert.equal(res.source, 'rule-based');
    assert.equal(res.data.summary, 'rb');
  });

  test('LLM throws → не падаем, fallback + error', async () => {
    register({
      id: 'x', kind: 'analysis',
      llmPrompt: 'p',
      fallback: () => ({ id:'x', source:'rule-based' }),
    });
    const llmCaller = async () => { throw new Error('boom'); };
    const res = await run('x', { rows: [] }, { llmCaller });
    assert.equal(res.source, 'rule-based');
    assert.match(res.error || '', /llm-throw|llm-empty/);
  });

  test('блок без llmPrompt → всегда rule-based, LLM не зовётся', async () => {
    let called = 0;
    register({
      id: 'r', kind: 'analysis',
      // no llmPrompt
      fallback: () => ({ id:'r', source:'rule-based' }),
    });
    const llmCaller = async () => { called++; return { x: 1 }; };
    const res = await run('r', { rows: [] }, { llmCaller });
    assert.equal(res.source, 'rule-based');
    assert.equal(called, 0);
  });

  test('skipLLM=true → fallback напрямую', async () => {
    register({
      id: 'sl', kind: 'analysis',
      llmPrompt: 'p',
      fallback: () => ({ id:'sl', summary:'rb', source:'rule-based' }),
    });
    let called = 0;
    const llmCaller = async () => { called++; return { summary:'ai' }; };
    const res = await run('sl', { rows: [] }, { skipLLM: true, llmCaller });
    assert.equal(res.source, 'rule-based');
    assert.equal(called, 0);
  });

  test('неизвестный blockId → error: "not-registered"', async () => {
    const res = await run('nope', { rows: [] });
    assert.equal(res.error, 'not-registered');
    assert.equal(res.data, null);
  });
});

describe('AIPipeline.runAll — kind dispatch', () => {
  beforeEach(() => clearRegistry());

  test('runAll возвращает массив с source-маркерами для каждого блока', async () => {
    register({ id:'a1', kind:'analysis', llmPrompt:'p', fallback: () => ({ id:'a1' }) });
    register({ id:'a2', kind:'analysis',                fallback: () => ({ id:'a2' }) });
    register({ id:'c1', kind:'ceo',      llmPrompt:'p', fallback: () => ({ id:'c1' }) });
    // a1: LLM ok; a2: no prompt; c1 не должен попасть в kind='analysis'.
    const llmCaller = async (desc) => desc.id === 'a1' ? { x: 1 } : null;
    const res = await runAll('analysis', { rows: [] }, { llmCaller, concurrency: 2 });
    assert.equal(res.length, 2);
    const byId = Object.fromEntries(res.map(r => [r.id, r]));
    assert.equal(byId.a1.source, 'ai');
    assert.equal(byId.a2.source, 'rule-based');
    assert.equal(byId.c1, undefined);
  });

  test('runAll(ceo) не задевает analysis-блоки', async () => {
    register({ id:'a', kind:'analysis', fallback: () => ({ id:'a' }) });
    register({ id:'c', kind:'ceo',      fallback: () => ({ id:'c' }) });
    const res = await runAll('ceo', { rows: [] });
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'c');
  });
});

describe('UnifiedFallbackEngine — regression vs legacy aiFallbackEngine', () => {
  test('runAllAnalysisBlocks output идентичен runAllBlocks (legacy)', () => {
    const rows = [
      makeRow({ id:'a', hasRelease120: true, blockingDependency: true }),
      makeRow({ id:'b', hasRelease121: true, isDone: true }),
      makeRow({ id:'c', isUnassigned: true, scopeStatus: 'Да' }),
      makeRow({ id:'d', riskFlags: ['BLOCKING_NEAR_RELEASE'], hasRelease120: true }),
    ];
    const newRun = runAllAnalysisBlocks(rows);
    const legacy = runAllBlocks(rows);
    // Старый и новый код должны давать ту же data-shape по 13 ключам.
    assert.deepEqual(Object.keys(newRun).sort(), Object.keys(legacy).sort());
    // Health-блок: id/title/score/status совпадают.
    assert.equal(newRun.health.id,     legacy.health.id);
    assert.equal(newRun.health.title,  legacy.health.title);
    assert.equal(newRun.health.score,  legacy.health.score);
    assert.equal(newRun.health.status, legacy.health.status);
    // Forecast: список релизов и expected.
    assert.equal(newRun.forecast.forecasts.length, legacy.forecast.forecasts.length);
    assert.equal(newRun.forecast.score, legacy.forecast.score);
  });

  test('computeBaseMetrics (legacy alias) = buildBlockData(kind:analysis)', () => {
    const rows = [makeRow({ blockingDependency: true }), makeRow({ isDone: true })];
    const a = computeBaseMetrics(rows);
    const b = buildBlockData({ rows, kind: 'analysis' });
    assert.equal(a.total, b.total);
    assert.equal(a.done, b.done);
    assert.equal(a.blockers.length, b.blockers.length);
    assert.deepEqual(a.teams, b.teams);
  });

  test('computeProjectHealth: identical fields between legacy и Unified', () => {
    const rows = [makeRow({ blockingDependency: true })];
    const legacy = computeProjectHealth(rows);
    const newOne = U_computeProjectHealth(rows);
    assert.equal(legacy.id, newOne.id);
    assert.equal(legacy.title, newOne.title);
    assert.equal(legacy.score, newOne.score);
    assert.equal(legacy.status, newOne.status);
    assert.equal(legacy.source, 'rule-based');
    assert.equal(newOne.source, 'rule-based');
  });

  test('runAllCeoBlocks возвращает 5 секций + metrics', () => {
    const rows = [
      makeRow({ id:'a', blockingDependency: true, hasRelease120: true }),
      makeRow({ id:'b', scopeStatus: 'Требует подтверждения', hasRelease121: true }),
    ];
    const out = runAllCeoBlocks(rows);
    assert.ok(out, 'expected non-null');
    assert.ok(out.metrics);
    assert.ok(out.health);
    assert.ok(out.ifNothingChanges);
    assert.ok(out.hardTruths);
    assert.ok(out.saveRelease);
    assert.ok(Array.isArray(out.actionFeed));
  });
});

describe('AIPipeline + blockConfig — integration', () => {
  beforeEach(() => clearRegistry());

  test('run("health") с зарегистрированными блоками отдаёт rule-based health', async () => {
    registerAllBlocks(AIPipeline);
    const res = await run('health', { rows: [makeRow()] }, { skipLLM: true });
    assert.equal(res.id, 'health');
    assert.equal(res.kind, 'analysis');
    assert.equal(res.source, 'rule-based');
    assert.equal(res.data.id, 'health');
    assert.equal(res.data.title, 'Здоровье проекта');
  });

  test('run("ceo_health") даёт ceo-блок с ожидаемыми полями', async () => {
    registerAllBlocks(AIPipeline);
    const rows = [makeRow({ blockingDependency: true, hasRelease120: true })];
    const res = await run('ceo_health', { rows }, { skipLLM: true });
    assert.equal(res.kind, 'ceo');
    assert.equal(res.source, 'rule-based');
    assert.ok(res.data, 'data should be defined');
    assert.ok(typeof res.data.score === 'number');
  });
});
