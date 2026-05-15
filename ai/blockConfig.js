'use strict';
/* ============================================================
   AI BLOCK CONFIG — AUDIT_HOLISTIC O6
   ------------------------------------------------------------
   Единая конфигурация всех AI-блоков (AI Анализ + AI CEO).
   Описывает: id, kind, заголовок (для UI), llmPrompt и fallback.
   AIPipeline.register() читает эти descriptor'ы при bootstrap.

   Структура descriptor'а:
     { id, kind:'analysis'|'ceo'|'exec',
       title:'string',          // для UI / тестов
       llmPrompt:'string',      // user-промпт; null → блок только rule-based
       fallback:(ctx)=>data,    // (ctx.rows) → плоский data-объект
       llmValidate?:(p)=>bool   // опц. валидатор JSON-shape
     }

   Контракты:
     · descriptor — статический объект, без замыканий на state.
     · fallback читает только ctx.rows (или ctx.* extras), не state.rows.
     · LLM-промпты на английском намеренно: модель лучше держит формат
       JSON на en-prompt'е (V17.1 J2 audit-decision).
   ============================================================ */

import * as U from './UnifiedFallbackEngine.js';

/* ── shared LLM-schema strings ─────────────────────────────── */
const ANALYSIS_BLOCK_SCHEMA = `{
  "summary": "string (1-2 sentences)",
  "insights": ["string", "string", "..."],
  "recommendations": [{"title":"string","impact":"high|medium|low","action":"string"}],
  "confidence": "high|medium|low"
}`;

/* ── ANALYSIS BLOCKS — 13 штук ─────────────────────────────── */
export const ANALYSIS_BLOCKS = [
  { id:'health', kind:'analysis', title:'Здоровье проекта',
    llmPrompt:'Analyze overall project health. Focus on blockers, risks, and no-release tasks. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeProjectHealth(ctx?.rows || []) },
  { id:'forecast', kind:'analysis', title:'Прогноз релизов',
    llmPrompt:'Forecast release success probability for each release window based on blockers, risks and done%. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeForecast(ctx?.rows || []) },
  { id:'if_nothing_changes', kind:'analysis', title:'Если ничего не менять',
    llmPrompt:'Simulate consequences if nothing changes in the next sprint. List 3-5 concrete outcomes. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeIfNothingChangesAnalysis(ctx?.rows || []) },
  { id:'dependency', kind:'analysis', title:'Анализ зависимостей',
    llmPrompt:'Analyze dependency chains and identify critical path risks. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeDependencyAnalysis(ctx?.rows || []) },
  { id:'replanning', kind:'analysis', title:'Сценарии перепланирования',
    llmPrompt:'Propose 3 replanning scenarios (conservative, balanced, aggressive) with trade-offs. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeSmartReplanning(ctx?.rows || []) },
  { id:'bottlenecks', kind:'analysis', title:'Узкие места',
    llmPrompt:'Identify top bottlenecks by team, assignee, and release. Explain why each is a bottleneck. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeBottlenecks(ctx?.rows || []) },
  { id:'risk_narrative', kind:'analysis', title:'Описание рисков',
    llmPrompt:'Write a short human-readable narrative for each risk pattern. Explain impact and mitigation. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeRiskNarrative(ctx?.rows || []) },
  { id:'prioritization', kind:'analysis', title:'Приоритизация задач',
    llmPrompt:'Prioritize top 10 tasks that need immediate attention. Explain each reason. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computePrioritization(ctx?.rows || []) },
  { id:'dashboard', kind:'analysis', title:'Сгенерированный дашборд',
    llmPrompt:'Select 6-8 most critical metrics to highlight right now. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeDynamicDashboard(ctx?.rows || []) },
  { id:'anomalies', kind:'analysis', title:'Поиск аномалий',
    llmPrompt:'Detect statistical anomalies in task distribution and scope. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeAnomalies(ctx?.rows || []) },
  { id:'quality', kind:'analysis', title:'Качество плана',
    llmPrompt:'Score the plan quality 0-100. Break down penalties by factor. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computePlanQuality(ctx?.rows || []) },
  { id:'second_opinion', kind:'analysis', title:'Второе мнение',
    llmPrompt:'Act as a strict plan reviewer. Identify weak spots and overly optimistic assumptions. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeSecondOpinion(ctx?.rows || []) },
  { id:'recommendations', kind:'analysis', title:'Рекомендации',
    llmPrompt:'Generate a prioritized list of concrete actionable recommendations. Output JSON.',
    llmSchema: ANALYSIS_BLOCK_SCHEMA,
    fallback: ctx => U.computeRecommendations(ctx?.rows || []) },
];

/* ── CEO BLOCKS — 5 штук ──────────────────────────────────── */
const CEO_HEALTH_SCHEMA = `{
  "score": number, "status":"ok|risk|critical", "label":"string",
  "causes": [{"text":"string","severity":"critical|warning|info","filter":object|null}],
  "summary":"string", "critRelText":"string|null"
}`;

export const CEO_BLOCKS = [
  { id:'ceo_health', kind:'ceo', title:'CEO Health',
    llmPrompt:'You are a CEO advisor. Analyze project health for executive readout. Focus on near-release blockers and overall risk. Output JSON.',
    llmSchema: CEO_HEALTH_SCHEMA,
    llmValidate: p => p && typeof p.score === 'number' && p.score >= 0 && p.score <= 100,
    fallback: ctx => U.computeCeoHealth(ctx?.rows || []) },
  { id:'ceo_if_nothing_changes', kind:'ceo', title:'CEO Если ничего не менять',
    llmPrompt:'You are a CEO advisor. Project the consequences of inaction over 14 days. Output JSON.',
    fallback: ctx => U.computeCeoIfNothingChanges(ctx?.rows || []) },
  { id:'ceo_hard_truths', kind:'ceo', title:'CEO Жёсткие правды',
    llmPrompt:'You are a strict CEO advisor. List up to 5 hard truths, 4 suspicious areas, and 4 weak signals. Output JSON.',
    fallback: ctx => U.computeCeoHardTruths(ctx?.rows || []) },
  { id:'ceo_save_release', kind:'ceo', title:'Спасти релиз',
    llmPrompt:'Propose 3 release-saving scenarios (conservative, balanced, aggressive) with explicit task changes. Output JSON.',
    fallback: ctx => U.computeCeoSaveTheRelease(ctx?.rows || []) },
  { id:'ceo_action_feed', kind:'ceo', title:'Лента действий CEO',
    llmPrompt:'Produce an executive action feed: 6-9 prioritized items with severity. Output JSON.',
    fallback: ctx => U.computeCeoActionFeed(ctx?.rows || []) },
];

/* ── EXEC AGGREGATOR — 1 виртуальный блок ─────────────────── */
// Exec view сейчас агрегирует выходы AI Анализ + AI CEO в reading-layout.
// Регистрируем виртуальный блок без LLM-промпта — он просто переиспользует
// fallback'и других блоков. (TODO в exec.js: подписаться на этот блок.)
export const EXEC_BLOCKS = [
  { id:'exec_aggregate', kind:'exec', title:'CEO-сводка (агрегатор)',
    // Без llmPrompt → AIPipeline сразу вернёт rule-based.
    fallback: ctx => {
      const rows = ctx?.rows || [];
      return {
        id:'exec_aggregate',
        analysis: U.runAllAnalysisBlocks(rows),
        ceo:      U.runAllCeoBlocks(rows),
        source:   'rule-based',
      };
    } },
];

/* ── all-in-one bootstrap ─────────────────────────────────── */
/** Регистрирует все блоки в переданном AIPipeline-instance.
 *  Удобно вызвать один раз из app/init.js. */
export function registerAllBlocks(pipeline) {
  if (!pipeline || typeof pipeline.register !== 'function') {
    throw new Error('registerAllBlocks: invalid pipeline');
  }
  [...ANALYSIS_BLOCKS, ...CEO_BLOCKS, ...EXEC_BLOCKS].forEach(b => pipeline.register(b));
}

export default { ANALYSIS_BLOCKS, CEO_BLOCKS, EXEC_BLOCKS, registerAllBlocks };
