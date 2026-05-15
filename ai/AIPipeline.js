'use strict';
/* ============================================================
   AI PIPELINE — единый orchestrator для AI-блоков (AUDIT_HOLISTIC O6)
   ------------------------------------------------------------
   До этого было 3 параллельных AI-«движка» с дублированной
   fallback-логикой (`aiView` 13 блоков, `aiCeoView` + `aiCeoFallback`,
   `views/exec` агрегатор). Этот файл — единая точка регистрации
   и запуска любого AI-блока.

   Архитектура:
     · `register({ id, kind, llmPrompt, fallback, transforms? })`
       регистрирует блок в реестре. `kind` = 'analysis' | 'ceo' | 'exec'.
     · `run(blockId, context, opts?)` сначала пробует LLM, на ошибку →
       выполняет `fallback(context)`. Возвращает
       `{ id, kind, data, source: 'ai' | 'rule-based', error? }`.
     · `runAll(kind, context, opts?)` запускает все блоки выбранного
       kind'а параллельно (с CONCURRENCY-окном) и возвращает массив.
     · `getRegisteredBlocks(kind?)` — список зарегистрированных блоков.

   Контракты:
     · Никаких прямых вызовов Storage.save() — pipeline read-only.
     · Identity-deterministic: вход pipeline'а — `{ rows, ... }`,
       output — pure data; никакой fuzzy-логики над employees.
     · Reactive-safe: pipeline не мутирует state; вызывающий код
       (view) сам решает, оборачивать ли batch-update в Reactive.silent.

   Размер: ~150 LOC, нет внешних зависимостей кроме llmClient.
   ============================================================ */

import { callLLM, parseLLMJsonResponse } from './llmClient.js';
import { Services } from '../app/services.js';

/**
 * @typedef {'analysis'|'ceo'|'exec'} BlockKind
 * @typedef {Object} BlockDescriptor
 * @property {string}   id            — уникальный id блока
 * @property {BlockKind} kind         — категория блока
 * @property {string}   [llmPrompt]   — текст user-промпта для LLM (опц.)
 * @property {string}   [llmSystem]   — системный промпт (опц.)
 * @property {string}   [llmSchema]   — JSON-схема ожидаемого ответа (опц.)
 * @property {(parsed:any)=>boolean} [llmValidate] — валидатор JSON-shape
 * @property {(ctx:any)=>any|Promise<any>} fallback — rule-based функция
 * @property {(fallbackData:any, llmData:any)=>any} [merge] — merge-стратегия
 * @property {{system?:string,timeoutMs?:number,temperature?:number,maxTokens?:number}} [llmOpts]
 */

const _registry = new Map(); // id -> BlockDescriptor

/* ── helpers ──────────────────────────────────────────────── */

function _markSource(data, source) {
  if (!data || typeof data !== 'object') return data;
  // Не перезаписываем source, если уже задан LLM-merge'ом.
  return { ...data, source: data.source || source };
}

function _defaultMerge(fallbackData, llmData) {
  if (!llmData || typeof llmData !== 'object') return fallbackData;
  return { ...fallbackData, ...llmData, aiEnhanced: true, source: 'ai' };
}

/* ── registry API ─────────────────────────────────────────── */

/**
 * Зарегистрировать блок. Если id уже есть — overwrite (для hot-reload в тестах).
 * @param {BlockDescriptor} desc
 */
export function register(desc) {
  if (!desc || typeof desc !== 'object' || !desc.id) {
    throw new Error('AIPipeline.register: missing id');
  }
  if (typeof desc.fallback !== 'function') {
    throw new Error(`AIPipeline.register(${desc.id}): fallback must be a function`);
  }
  if (!desc.kind) desc.kind = 'analysis';
  _registry.set(desc.id, { ...desc });
}

/**
 * Получить список блоков.
 * @param {BlockKind} [kind]
 * @returns {BlockDescriptor[]}
 */
export function getRegisteredBlocks(kind) {
  const arr = [..._registry.values()];
  return kind ? arr.filter(b => b.kind === kind) : arr;
}

export function clearRegistry() { _registry.clear(); }

/* ── core runner ─────────────────────────────────────────── */

/**
 * Запустить один блок. Сначала LLM (если настроено), потом fallback.
 * @param {string} blockId
 * @param {any}    context     — произвольный контекст, прокидывается в fallback и в LLM
 * @param {{ skipLLM?:boolean, llmCaller?:Function }} [opts]
 * @returns {Promise<{id:string, kind:string, data:any, source:'ai'|'rule-based', error?:string}>}
 */
export async function run(blockId, context, opts = {}) {
  const desc = _registry.get(blockId);
  if (!desc) {
    return { id: blockId, kind: 'unknown', data: null, source: 'rule-based', error: 'not-registered' };
  }
  const skipLLM   = opts.skipLLM === true;
  const llmCaller = typeof opts.llmCaller === 'function' ? opts.llmCaller : _callBlockLLM;

  let fallbackData = null;
  try {
    fallbackData = await desc.fallback(context);
  } catch(e) {
    return { id: blockId, kind: desc.kind, data: null, source: 'rule-based', error: 'fallback-failed:' + (e?.message || e) };
  }

  if (skipLLM || !desc.llmPrompt) {
    return { id: blockId, kind: desc.kind, data: _markSource(fallbackData, 'rule-based'), source: 'rule-based' };
  }

  let llmData = null;
  let llmError = null;
  try {
    llmData = await llmCaller(desc, context);
  } catch(e) {
    llmError = 'llm-throw:' + (e?.message || e);
  }

  if (!llmData) {
    return { id: blockId, kind: desc.kind, data: _markSource(fallbackData, 'rule-based'), source: 'rule-based', error: llmError || 'llm-empty' };
  }

  const merged = (desc.merge || _defaultMerge)(fallbackData, llmData);
  return { id: blockId, kind: desc.kind, data: _markSource(merged, 'ai'), source: 'ai' };
}

/**
 * Запустить все блоки выбранного kind с ограниченной параллельностью.
 * @param {BlockKind} kind
 * @param {any} context
 * @param {{ skipLLM?:boolean, concurrency?:number, llmCaller?:Function }} [opts]
 * @returns {Promise<Array>}
 */
export async function runAll(kind, context, opts = {}) {
  const blocks = getRegisteredBlocks(kind);
  const concurrency = Math.max(1, opts.concurrency || 3);
  const out = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i += concurrency) {
    const slice = blocks.slice(i, i + concurrency);
    const results = await Promise.allSettled(slice.map(b => run(b.id, context, opts)));
    results.forEach((r, j) => {
      out[i + j] = r.status === 'fulfilled'
        ? r.value
        : { id: slice[j].id, kind: slice[j].kind, data: null, source: 'rule-based', error: 'settle-' + (r.reason?.message || 'fail') };
    });
  }
  return out;
}

/* ── default LLM caller (использует общий llmClient) ─────── */

async function _callBlockLLM(desc, context) {
  // Браузерная инфраструктура (window.LLMAssistant) — единственный gating
  // для прод-вызова. В Node-тестах llmCaller подменяется через opts.
  if (typeof window === 'undefined' || !Services.LLMAssistant?.getSettings?.()) return null;

  const llmOpts = desc.llmOpts || {};
  const system  = llmOpts.system || desc.llmSystem ||
    'Ты — AI-аналитик проектных планов. Отвечай ТОЛЬКО валидным JSON. Используй ТОЛЬКО данные из контекста. Не выдумывай факты.';
  const userMsg = `${desc.llmPrompt}\n\n${desc.llmSchema ? 'Схема ответа:\n' + desc.llmSchema + '\n\n' : ''}Контекст:\n${
    typeof context === 'string' ? context : JSON.stringify(context).slice(0, 45000)
  }`;

  const text = await callLLM({
    system,
    user: userMsg,
    timeoutMs:   llmOpts.timeoutMs   ?? 20000,
    temperature: llmOpts.temperature ?? 0.25,
    maxTokens:   llmOpts.maxTokens   ?? 900,
  });
  const { ok, data } = parseLLMJsonResponse(text, desc.llmValidate);
  return ok ? data : null;
}

/* ── default export для удобства импорта ─────────────────── */

export const AIPipeline = {
  register,
  run,
  runAll,
  getRegisteredBlocks,
  clearRegistry,
};

export default AIPipeline;
