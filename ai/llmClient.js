'use strict';
/* ============================================================
   AI LLM CLIENT — shared utilities (V18 P7)
   ------------------------------------------------------------
   Выделено из views/aiView.js + views/aiCeoView.js по аудиту
   audit-2026-05-04/07-tech-views.md §7.
   Содержит общий fetch-путь (direct vs proxy), JSON-парсинг
   ответа модели и единый applyFilterPayload для FiltersUI.
   ============================================================ */

import { state } from '../state.js';
import { Services } from '../app/services.js';

/**
 * @typedef {Object} CallLLMOptions
 * @property {string}  system        — системное сообщение
 * @property {string}  user          — user-сообщение
 * @property {string}  [model]       — model id (default 'GigaChat-2')
 * @property {string}  [token]       — Bearer token; если не задан — берётся из LLMAssistant
 * @property {string}  [apiBaseUrl]  — base url прямого endpoint'а
 * @property {string}  [proxyUrl]    — base url локального proxy
 * @property {string}  [apiMode]     — 'direct' | 'proxy'
 * @property {number}  [timeoutMs]   — таймаут запроса (default 20000)
 * @property {number}  [temperature] — default 0.25
 * @property {number}  [maxTokens]   — default 900
 * @property {AbortSignal} [signal]  — внешний AbortSignal (опционально)
 */

/**
 * Выполняет non-streaming chat-completion запрос к LLM.
 * Совмещает direct (если same-origin) и proxy режимы.
 * @param {CallLLMOptions} opts
 * @returns {Promise<string|null>} text content (raw) либо null на ошибке
 */
export async function callLLM(opts) {
  const settings = Services.LLMAssistant?.getSettings?.() || {};
  const apiMode  = opts.apiMode    || settings.apiMode || '';
  const apiBase  = String(opts.apiBaseUrl ?? settings.apiBaseUrl ?? '').replace(/\/+$/, '');
  const proxy    = String(opts.proxyUrl   ?? settings.proxyUrl   ?? '').replace(/\/+$/, '');
  const model    = opts.model || settings.model || 'GigaChat-2';
  const token    = opts.token != null ? opts.token : (Services.LLMAssistant?.getToken?.() || '');
  const timeout  = opts.timeoutMs   ?? 20000;
  const temp     = opts.temperature ?? 0.25;
  const maxTok   = opts.maxTokens   ?? 900;

  const body = {
    model, temperature: temp, max_tokens: maxTok, stream: false,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user',   content: opts.user   },
    ],
  };

  const signal = opts.signal || AbortSignal.timeout(timeout);

  try {
    let res;
    let useDirect = false;
    if (apiMode === 'direct' && apiBase) {
      // Direct only when same-origin (avoid CORS for cross-origin endpoints)
      try {
        const ep    = apiBase.endsWith('/chat/completions') ? apiBase : `${apiBase}/chat/completions`;
        const epUrl = new URL(ep, window.location.origin);
        useDirect = epUrl.origin === window.location.origin;
        if (useDirect) {
          res = await fetch(epUrl.toString(), {
            method: 'POST', signal,
            headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
          });
        }
      } catch(_) { useDirect = false; }
    }
    if (!useDirect) {
      const ep = proxy ? `${proxy}/api/llm/chat` : '/api/llm/chat';
      res = await fetch(ep, {
        method: 'POST', signal,
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ...body, apiBaseUrl: apiBase, token }),
      });
    }
    if (!res || !res.ok) return null;

    const json = await res.json().catch(() => null);
    if (!json) return null;

    const text = json?.choices?.[0]?.message?.content
              || json?.result?.choices?.[0]?.message?.content
              || json?.content || '';
    return text || null;
  } catch(e) {
    console.warn('[llmClient] LLM call failed:', e?.message || e);
    return null;
  }
}

/**
 * Парсит ответ LLM: вытягивает первый JSON-объект (`/\{[\s\S]*\}/`)
 * и валидирует shape через переданный validator.
 * @param {string|null} text
 * @param {(parsed:any)=>boolean} [validate]
 * @returns {{ ok:boolean, data:any|null, error:string|null }}
 */
export function parseLLMJsonResponse(text, validate) {
  if (!text || typeof text !== 'string') {
    return { ok:false, data:null, error:'empty-response' };
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok:false, data:null, error:'no-json-object' };
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch(e) { return { ok:false, data:null, error:'json-parse:' + (e?.message || 'fail') }; }
  if (typeof validate === 'function') {
    let valid = false;
    try { valid = !!validate(parsed); } catch(_) { valid = false; }
    if (!valid) return { ok:false, data:null, error:'shape-mismatch' };
  }
  return { ok:true, data:parsed, error:null };
}

/**
 * Применяет filter-payload к state.filters и переходит на Реестр.
 * Используется AI-блоками и CEO-блоками для drill-down.
 * @param {Object|null|undefined} filterPayload
 * @param {{
 *   navigate?: boolean,             // default true — перейти на 'registry'
 *   navigateOnEmpty?: boolean,      // default false — переходить ли при null/undefined payload
 *   resetReleaseOnUnassigned?: boolean, // default false — сбрасывать f.release при isUnassigned
 * }} [opts]
 */
export function applyFilterPayload(filterPayload, opts = {}) {
  const navigate                 = opts.navigate !== false;
  const navigateOnEmpty          = opts.navigateOnEmpty === true;
  const resetReleaseOnUnassigned = opts.resetReleaseOnUnassigned === true;
  try {
    if (!filterPayload) {
      if (navigate && navigateOnEmpty) Services.App?.goTo?.('registry');
      return;
    }
    const f = state.filters;
    if (filterPayload.team         !== undefined) f.team         = filterPayload.team;
    if (filterPayload.release      !== undefined) f.release      = filterPayload.release;
    if (filterPayload.scope        !== undefined) f.scope        = filterPayload.scope;
    if (filterPayload.search       !== undefined) f.search       = filterPayload.search;
    if (filterPayload.scopeStatus  !== undefined) f.scope        = filterPayload.scopeStatus;
    if (filterPayload.onlyBlocking !== undefined) f.onlyBlocking = !!filterPayload.onlyBlocking;
    if (filterPayload.onlyRisky    !== undefined) f.onlyRisky    = !!filterPayload.onlyRisky;
    if (filterPayload.onlyDone     !== undefined) f.onlyDone     = !!filterPayload.onlyDone;
    if (filterPayload.isUnassigned) {
      f.scope = 'Да';
      if (resetReleaseOnUnassigned) f.release = '';
    }
    if (navigate) Services.App?.goTo?.('registry');
    window.notify?.('chat_filter');
    window.showToast?.('Фильтры применены');
  } catch(e) {
    console.warn('[llmClient] applyFilterPayload error', e);
  }
}
