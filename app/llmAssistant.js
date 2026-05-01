'use strict';
/* ============================================================
   LLMAssistant — chat assistant module.
   --
   Owns: settings (provider / model / token / system prompt), context
   builders (summary / currentView / fullRegistry / custom), endpoint
   construction, streaming SSE handling, intent-based prompt routing,
   alert bar.

   Cross-module deps:
     Direct imports from constants/state/filters/utils/dataStore/chat/*
     plus historyLog (added in V13 — line 715 was using a bare `HistoryLog.ai`
     reference without import, throwing ReferenceError when the chat input
     handler fired).
     Window globals (avoid cycles with App):
       - window.showToast       — UI toast
       - window.executeAction   — chat-side action executor
   ============================================================ */

import { state } from '../state.js';
import { LLM_SETTINGS_KEY, DEFAULT_LLM_SYSTEM_PROMPT } from '../constants.js';
import { FilterEngine } from '../filters.js';
import { Utils } from '../utils.js';
import { HistoryLog } from '../historyLog.js';

import { process as chatProcess, parseLLMResponse } from '../chat/chatEngine.js';
import { renderStructuredResponse, renderUserMessage, renderThinking, renderError } from '../chat/chatUIRenderer.js';
import { executeAction, bindActionClicks } from '../chat/chatActions.js';
import { getQuickPrompts, renderQuickPromptsHTML } from '../chat/chatTemplates.js';
import { buildAlerts, renderAlertBar, refreshAlerts, saveAlertBaseline } from '../chat/chatAlerts.js';
import { getAllPrompts, savePromptOverrides, resetPromptOverride, getDefaultPrompt, CATEGORIES as PROMPT_CATEGORIES } from '../chat/chatPrompts.js';

const getFilteredRows = () => FilterEngine.getFiltered();

const showToast = (...args) => window.showToast?.(...args);

// ============================================================
function getLLMDefaultSettings() {
  const defaultProxy = (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:')
    ? 'http://127.0.0.1:8080' : '';
  return {
    apiMode: 'direct', apiBaseUrl: 'http://localhost:3000/v1', proxyUrl: defaultProxy,
    model: 'GigaChat-2', token: '', temperature: 0.2, maxTokens: 2000,
    systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT, contextMode: 'currentView',
    rowLimit: 150, payloadLimitBytes: 250000, saveToLocal: true,
    // Token persists in localStorage by default (user-friendly: "не вводить каждый раз").
    // Можно вернуть session-only через чекбокс «Хранить токен только в session memory».
    tokenSessionOnly: false, customPayload: '',
  };
}

function safeJSONParse(raw, fallback) {
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function buildSummaryContextPayload() {
  const rows = state.rows || [];
  const visibleRows = FilterEngine.getFiltered();
  const summary = {
    totalRows: rows.length, visibleRows: visibleRows.length,
    done: rows.filter(r => r.isDone).length,
    blockers: rows.filter(r => r.blockingDependency).length,
    risky: rows.filter(r => (r.riskFlags || []).length > 0).length,
    inScope: rows.filter(r => r.scopeStatus === 'Да').length,
    outScope: rows.filter(r => r.scopeStatus === 'Нет').length,
    needsConfirm: rows.filter(r => r.scopeStatus === 'Требует подтверждения').length,
    noRelease: rows.filter(r => r.isUnassigned).length,
    overtime: rows.filter(r => r.hasOvertime).length,
  };
  const riskCounter = {};
  rows.forEach(r => (r.riskFlags || []).forEach(flag => { riskCounter[flag] = (riskCounter[flag] || 0) + 1; }));
  const releaseDistribution = {
    backlog: rows.filter(r => r.isUnassigned).length,
    '1.20': rows.filter(r => r.hasRelease120).length,
    '1.21': rows.filter(r => r.hasRelease121).length,
    '1.22': rows.filter(r => r.hasRelease122).length,
    overtime: rows.filter(r => r.hasOvertime).length,
  };
  const teamMap = {};
  rows.forEach(r => {
    const t = r.team || '(без команды)';
    if (!teamMap[t]) teamMap[t] = { team: t, total: 0, done: 0, blockers: 0, risky: 0, inScope: 0, noRelease: 0 };
    teamMap[t].total++;
    if (r.isDone) teamMap[t].done++;
    if (r.blockingDependency) teamMap[t].blockers++;
    if ((r.riskFlags || []).length > 0) teamMap[t].risky++;
    if (r.scopeStatus === 'Да') teamMap[t].inScope++;
    if (r.isUnassigned) teamMap[t].noRelease++;
  });
  const teamBreakdown = Object.values(teamMap).sort((a, b) => b.total - a.total);
  const pickRowFields = r => ({
    team: r.team, epic: r.epic, tasks: r.tasks, scopeStatus: r.scopeStatus,
    assignee: r.assignee, release120Types: r.release120Types, release121Types: r.release121Types,
    release122Types: r.release122Types, blockingDeadline: r.blockingDeadline,
    riskFlags: r.riskFlags, workPeriodStart: r.workPeriodStart,
    workPeriodEnd: r.workPeriodEnd, comment: r.comment,
  });
  const topBlockers = rows.filter(r => r.blockingDependency && !r.isDone).slice(0, 20).map(pickRowFields);
  const topRiskyRows = rows.filter(r => (r.riskFlags || []).length > 0 && !r.isDone).slice(0, 20).map(pickRowFields);
  return {
    app: 'SBOF Planner', activeTab: state.activeSection,
    filters: { ...state.filters }, selectedPreset: state.filters.preset || null,
    summary, riskSummary: riskCounter, releaseDistribution,
    teamBreakdown, topBlockers, topRiskyRows, timestamp: new Date().toISOString(),
  };
}

function buildVisibleContextPayload() {
  const base = buildSummaryContextPayload();
  const rows = FilterEngine.getFiltered().map(r => ({
    id: r.id, team: r.team, epic: r.epic, category: r.category, tags: r.tags,
    tasks: r.tasks, scopeStatus: r.scopeStatus,
    release120Types: r.release120Types, release121Types: r.release121Types,
    release122Types: r.release122Types, overtimeTypes: r.overtimeTypes,
    role: r.role, assignee: r.assignee, isDone: r.isDone,
    blockingDependency: r.blockingDependency, riskFlags: r.riskFlags || [],
    workPeriodStart: r.workPeriodStart, workPeriodEnd: r.workPeriodEnd, comment: r.comment,
  }));
  return { ...base, visibleRows: rows };
}

function buildAppContextPayload() {
  const base = buildSummaryContextPayload();
  const rows = state.rows.map(r => ({
    id: r.id, team: r.team, epic: r.epic, category: r.category, tags: r.tags,
    tasks: r.tasks, scopeStatus: r.scopeStatus,
    release120Types: r.release120Types, release121Types: r.release121Types,
    release122Types: r.release122Types, overtimeTypes: r.overtimeTypes,
    role: r.role, assignee: r.assignee, isDone: r.isDone,
    blockingDependency: r.blockingDependency, riskFlags: r.riskFlags || [],
    workPeriodStart: r.workPeriodStart, workPeriodEnd: r.workPeriodEnd, comment: r.comment,
  }));
  return { ...base, rows };
}

function buildCustomContextPayload() {
  const customRaw = String(state.llm?.settings?.customPayload || '').trim();
  if (!customRaw) return { customPayload: null };
  const parsed = safeJSONParse(customRaw, null);
  return parsed ? { customPayload: parsed } : { customPayloadText: customRaw };
}

function truncateForLLM(payload, limits) {
  const rowLimit = Math.max(1, Number(limits?.rowLimit) || 50);
  const payloadLimitBytes = Math.max(1024, Number(limits?.payloadLimitBytes) || 120000);
  const out = safeJSONParse(JSON.stringify(payload || {}), {});
  const trimRows = (key) => { if (Array.isArray(out[key]) && out[key].length > rowLimit) out[key] = out[key].slice(0, rowLimit); };
  trimRows('rows'); trimRows('visibleRows');
  const serialized = JSON.stringify(out);
  if (serialized.length <= payloadLimitBytes) return out;
  const minimize = (row) => ({
    id: row.id, team: row.team, epic: row.epic, tasks: row.tasks,
    scopeStatus: row.scopeStatus, release120Types: row.release120Types,
    release121Types: row.release121Types, release122Types: row.release122Types,
    overtimeTypes: row.overtimeTypes, blockingDependency: row.blockingDependency,
    riskFlags: row.riskFlags, assignee: row.assignee,
  });
  if (Array.isArray(out.rows)) out.rows = out.rows.map(minimize).slice(0, Math.max(10, Math.floor(rowLimit * 0.65)));
  if (Array.isArray(out.visibleRows)) out.visibleRows = out.visibleRows.map(minimize).slice(0, Math.max(10, Math.floor(rowLimit * 0.65)));
  const second = JSON.stringify(out);
  if (second.length <= payloadLimitBytes) return out;
  out.rows = Array.isArray(out.rows) ? out.rows.slice(0, 12) : out.rows;
  out.visibleRows = Array.isArray(out.visibleRows) ? out.visibleRows.slice(0, 12) : out.visibleRows;
  out._truncated = true; out._payloadBytes = second.length; out._payloadLimitBytes = payloadLimitBytes;
  return out;
}

function buildLLMMessages(userMessage, contextOverride) {
  const settings = LLMAssistant.getSettings();
  const contextMode = contextOverride || settings.contextMode || 'currentView';
  let payload;
  if (contextMode === 'none') payload = { contextDisabled: true };
  else if (contextMode === 'summary') payload = buildSummaryContextPayload();
  else if (contextMode === 'currentView') payload = buildVisibleContextPayload();
  else if (contextMode === 'fullRegistry') payload = buildAppContextPayload();
  else payload = buildCustomContextPayload();
  payload = truncateForLLM(payload, { rowLimit: settings.rowLimit, payloadLimitBytes: settings.payloadLimitBytes });
  const systemPrompt = settings.systemPrompt || DEFAULT_LLM_SYSTEM_PROMPT;
  const userBlock = [`Вопрос пользователя: ${userMessage}`, '', `Режим контекста: ${contextMode}`, 'Контекст приложения (JSON):', JSON.stringify(payload, null, 2)].join('\n');
  return [{ role: 'system', content: systemPrompt }, { role: 'user', content: userBlock }];
}

function trimApiHistory(apiHistory, maxMessages) {
  if (!Array.isArray(apiHistory) || apiHistory.length <= maxMessages) return apiHistory;
  const first = apiHistory[0];
  const rest = apiHistory.slice(1);
  return [first, ...rest.slice(-(maxMessages - 1))];
}

function buildApiCallMessages(userMessage, contextOverride) {
  const settings = LLMAssistant.getSettings();
  const systemPrompt = settings.systemPrompt || DEFAULT_LLM_SYSTEM_PROMPT;
  const apiHistory = state.llm?.apiHistory || [];
  const hasHistory = apiHistory.some(m => m.role === 'user');
  if (!hasHistory) return buildLLMMessages(userMessage, contextOverride);
  const MAX_HISTORY = 20;
  const trimmed = trimApiHistory(apiHistory, MAX_HISTORY);
  return [{ role: 'system', content: systemPrompt }, ...trimmed, { role: 'user', content: userMessage }];
}

function extractDeltaFromChunk(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  const c = obj.choices?.[0];
  const v = c?.delta?.content ?? c?.message?.content ?? c?.text ?? obj.delta ?? obj.content ?? obj.output_text ?? obj.result?.choices?.[0]?.delta?.content ?? obj.result?.choices?.[0]?.message?.content ?? '';
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : (x?.text || ''))).join('');
  return typeof v === 'string' ? v : '';
}

async function parseStreamResponse(response, onDelta, abortSignal) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  console.log('[LLM] parseStreamResponse start | status:', response.status, '| content-type:', contentType, '| hasBody:', !!response.body);

  if (!response.ok) {
    const errTxt = await response.text().catch(() => '');
    console.error('[LLM] HTTP error:', response.status, response.statusText, '| body:', errTxt.slice(0, 500));
    throw new Error(errTxt || `HTTP ${response.status}`);
  }

  if (!response.body) {
    const data = await response.json().catch(e => { console.warn('[LLM] json parse failed (no body):', e); return {}; });
    const full = extractDeltaFromChunk(data) || data?.choices?.[0]?.message?.content || '';
    console.log('[LLM] no-body path → extracted:', JSON.stringify(full).slice(0, 200));
    if (full) onDelta(full); return;
  }

  if (contentType.includes('application/json')) {
    const raw = await response.text().catch(e => { console.warn('[LLM] text() failed:', e); return ''; });
    console.log('[LLM] json content-type → raw:', raw.slice(0, 500));
    const data = safeJSONParse(raw, {});
    const full = extractDeltaFromChunk(data) || data?.choices?.[0]?.message?.content || '';
    console.log('[LLM] json path → extracted:', JSON.stringify(full).slice(0, 200));
    if (full) onDelta(full); return;
  }

  // SSE stream path
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let totalChunks = 0;
  let totalDelta = 0;
  while (true) {
    if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { value, done } = await reader.read();
    if (done) {
      console.log('[LLM] stream done | chunks emitted:', totalChunks, '| total delta chars:', totalDelta);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 1);
      if (!line) continue;
      // Skip SSE non-data fields
      if (line.startsWith('event:') || line.startsWith('id:') || line.startsWith('retry:') || line.startsWith(':')) {
        console.log('[LLM] SSE field (skipped):', line.slice(0, 80));
        continue;
      }
      let dataLine = line;
      if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      if (!dataLine || dataLine === '[DONE]') { if (dataLine === '[DONE]') console.log('[LLM] [DONE] received'); continue; }
      const parsed = safeJSONParse(dataLine, null);
      if (parsed) {
        const chunk = extractDeltaFromChunk(parsed);
        if (chunk) { onDelta(chunk); totalChunks++; totalDelta += chunk.length; }
        else console.log('[LLM] parsed chunk but extractDelta=empty | keys:', Object.keys(parsed).join(','));
        continue;
      }
      console.warn('[LLM] unparseable line (not JSON, not SSE field):', dataLine.slice(0, 120));
    }
  }
  const tail = buffer.trim();
  if (tail && tail !== '[DONE]' && !tail.startsWith('event:') && !tail.startsWith('id:') && !tail.startsWith('retry:') && !tail.startsWith(':')) {
    console.log('[LLM] tail buffer:', tail.slice(0, 200));
    const parsed = safeJSONParse(tail.startsWith('data:') ? tail.slice(5).trim() : tail, null);
    if (parsed) { const chunk = extractDeltaFromChunk(parsed); if (chunk) onDelta(chunk); }
  }
  if (totalDelta === 0) {
    console.warn('[LLM] ⚠ stream finished but NO delta text was emitted. Possible causes: empty choices[], wrong model response format, or all lines were skipped.');
  }
}

function buildOpenAIChatEndpoint(baseUrlRaw) {
  const baseUrl = String(baseUrlRaw || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return '/v1/chat/completions';
  if (baseUrl.endsWith('/chat/completions')) return baseUrl;
  if (baseUrl.endsWith('/v1')) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/chat/completions`;
}

function buildProxyEndpoint(settings) {
  const customProxyOrigin = String(settings.proxyUrl || '').trim().replace(/\/+$/, '');
  if (customProxyOrigin) return `${customProxyOrigin}/api/llm/chat`;
  if (window.location.protocol === 'file:') throw new Error('Режим file:// не поддерживает /api/llm/chat. Запусти node server.js.');
  return '/api/llm/chat';
}

async function callGigaChatStream(messages, settings, onDelta, abortSignal) {
  const mode = settings.apiMode || 'proxy';
  const baseUrl = String(settings.apiBaseUrl || '').replace(/\/+$/, '');
  const token = LLMAssistant.getToken();
  const payload = { model: settings.model || 'GigaChat-2', temperature: Number(settings.temperature), max_tokens: Math.max(64, Number(settings.maxTokens) || 900), stream: true, messages };

  console.group('[LLM] callGigaChatStream');
  console.log('mode:', mode);
  console.log('model:', payload.model);
  console.log('apiBaseUrl:', baseUrl || '(not set)');
  // V15 (audit#2, fullstack Critical 3): don't log token length — was
  // a side-channel observable in shared screenshots / DevTools recordings.
  console.log('token present:', !!token);
  console.log('messages count:', messages.length);
  console.log('messages:', messages.map(m => ({ role: m.role, len: m.content?.length })));
  console.groupEnd();

  if (mode === 'direct') {
    const endpoint = buildOpenAIChatEndpoint(baseUrl || 'http://localhost:3000/v1');
    const endpointUrl = new URL(endpoint, window.location.origin);
    const sameOrigin = endpointUrl.origin === window.location.origin;
    console.log('[LLM] direct mode → endpoint:', endpointUrl.toString(), '| sameOrigin:', sameOrigin);
    if (sameOrigin) {
      const res = await fetch(endpointUrl.toString(), { method:'POST', signal:abortSignal, headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}, body:JSON.stringify(payload) });
      console.log('[LLM] direct response:', res.status, res.statusText, 'content-type:', res.headers.get('content-type'));
      return parseStreamResponse(res, onDelta, abortSignal);
    }
    const proxyEndpoint = buildProxyEndpoint(settings);
    console.log('[LLM] direct→proxy endpoint:', proxyEndpoint);
    const res = await fetch(proxyEndpoint, { method:'POST', signal:abortSignal, headers:{'Content-Type':'application/json'}, body:JSON.stringify({ apiBaseUrl:`${endpointUrl.origin}${endpointUrl.pathname.replace(/\/chat\/completions$/,'')}`, model:payload.model, temperature:payload.temperature, max_tokens:payload.max_tokens, stream:true, messages:payload.messages, token }) });
    console.log('[LLM] proxy response:', res.status, res.statusText, 'content-type:', res.headers.get('content-type'));
    return parseStreamResponse(res, onDelta, abortSignal);
  }
  const proxyEndpoint = buildProxyEndpoint(settings);
  console.log('[LLM] proxy mode → endpoint:', proxyEndpoint);
  const res = await fetch(proxyEndpoint, { method:'POST', signal:abortSignal, headers:{'Content-Type':'application/json'}, body:JSON.stringify({ apiBaseUrl:baseUrl, model:payload.model, temperature:payload.temperature, max_tokens:payload.max_tokens, stream:true, messages:payload.messages, token }) });
  console.log('[LLM] proxy response:', res.status, res.statusText, 'content-type:', res.headers.get('content-type'));
  return parseStreamResponse(res, onDelta, abortSignal);
}

function renderMarkdownLite(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  function applyInline(s) {
    return s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/__(.+?)__/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>').replace(/_([^_\n]+)_/g,'<em>$1</em>').replace(/`([^`\n]+)`/g,'<code>$1</code>');
  }
  function processSegment(seg) {
    const lines = Utils.escapeHtml(seg).split('\n');
    const out = []; let inUl=false,inOl=false;
    const closeList=()=>{ if(inUl){out.push('</ul>');inUl=false;} if(inOl){out.push('</ol>');inOl=false;} };
    for (const line of lines) {
      if (/^###\s/.test(line)) { closeList(); out.push(`<h4 class="md-h">${applyInline(line.replace(/^###\s+/,''))}</h4>`); }
      else if (/^##\s/.test(line)) { closeList(); out.push(`<h3 class="md-h">${applyInline(line.replace(/^##\s+/,''))}</h3>`); }
      else if (/^#\s/.test(line)) { closeList(); out.push(`<h3 class="md-h">${applyInline(line.replace(/^#\s+/,''))}</h3>`); }
      else if (/^\s*[-*]\s/.test(line)) { if(!inUl){closeList();out.push('<ul>');inUl=true;} out.push(`<li>${applyInline(line.replace(/^\s*[-*]\s+/,''))}</li>`); }
      else if (/^\s*\d+[.)]\s/.test(line)) { if(!inOl){closeList();out.push('<ol>');inOl=true;} out.push(`<li>${applyInline(line.replace(/^\s*\d+[.)]\s+/,''))}</li>`); }
      else if (line.trim()==='') { closeList(); if(out.length&&out[out.length-1]!=='<br>')out.push('<br>'); }
      else { closeList(); out.push(applyInline(line)+'<br>'); }
    }
    closeList(); return out.join('');
  }
  const segments = text.split(/(```[\w]*\n?[\s\S]*?```)/g);
  const parts = [];
  for (let i=0;i<segments.length;i++) {
    if (i%2===1) { const code=segments[i].replace(/^```[\w]*\n?/,'').replace(/```$/,'').trimEnd(); parts.push(`<pre><code>${Utils.escapeHtml(code)}</code></pre>`); }
    else parts.push(processSegment(segments[i]));
  }
  let result = parts.join('');
  result = result.replace(/(<br>){3,}/g,'<br><br>').replace(/^<br>+/,'').replace(/<br>+$/,'');
  return result;
}


// ============================================================
// LLM ASSISTANT
// ============================================================
export const LLMAssistant = {
  CONV_KEY: 'q2_llm_conv_v1',
  init() {
    const defaults = getLLMDefaultSettings();
    const saved = safeJSONParse(localStorage.getItem(LLM_SETTINGS_KEY) || 'null', null);
    const settings = { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
    if (String(settings.apiBaseUrl || '').includes('gigachat.devices.sberbank.ru')) {
      settings.apiBaseUrl = 'http://localhost:3000/v1';
      if (!saved || saved.apiMode === 'proxy') settings.apiMode = 'direct';
    }
    // V15 (audit#2, AI dev Critical 1): we no longer force-disable
    // tokenSessionOnly. Respect the user's choice — if they enable
    // session-only, the token must NOT survive page reload.
    state.llm = { settings, history: [], apiHistory: [], panelOpen: false, panelMinimized: false, isStreaming: false, abortController: null, sessionToken: '', lastUserText: '' };
    LLMAssistant.loadConversation();
    LLMAssistant.bindUI();
    LLMAssistant.syncSettingsUI();
    LLMAssistant.updateContextModeIndicator();
    LLMAssistant.updateQuickPrompts();
    LLMAssistant.renderMessages();
  },
  saveConversation() {
    try {
      const s = LLMAssistant.getSettings();
      if (!s.saveToLocal) { localStorage.removeItem(LLMAssistant.CONV_KEY); return; }
      const data = { history: state.llm.history.filter(m => !m.streaming && !m.thinking), apiHistory: state.llm.apiHistory, savedAt: Date.now() };
      localStorage.setItem(LLMAssistant.CONV_KEY, JSON.stringify(data));
    } catch (e) {
      // V15 (audit#2, QA Critical 4 + fullstack High 1): surface
      // QuotaExceeded — used to swallow silently → user lost chat
      // history on F5 with no warning.
      if (e && e.name === 'QuotaExceededError') {
        try { window.showToast?.('Не удалось сохранить переписку — переполнен localStorage. Очистите чат или старые данные.', 'error', 4500); } catch(_){}
        try { window.ErrorsLog?.add?.({ level:'error', source:'LLMAssistant.saveConversation', message:'localStorage quota exceeded for chat history' }); } catch(_){}
      } else {
        try { window.ErrorsLog?.add?.({ level:'warn', source:'LLMAssistant.saveConversation', message: e?.message || String(e) }); } catch(_){}
      }
    }
  },
  loadConversation() {
    try {
      const raw = localStorage.getItem(LLMAssistant.CONV_KEY); if (!raw) return;
      const data = safeJSONParse(raw, null); if (!data || !Array.isArray(data.history)) return;
      if (Date.now() - (data.savedAt || 0) > 86400000) { localStorage.removeItem(LLMAssistant.CONV_KEY); return; }
      state.llm.history = data.history;
      state.llm.apiHistory = Array.isArray(data.apiHistory) ? data.apiHistory : [];
    } catch(_) {}
  },
  getSettings() { return state.llm.settings || getLLMDefaultSettings(); },
  getToken() {
    const settings = LLMAssistant.getSettings();
    return settings.token || state.llm.sessionToken || '';
  },
  saveSettingsFromUI() {
    const s = LLMAssistant.getSettings();
    s.apiMode = document.getElementById('llm-api-mode').value || 'proxy';
    s.apiBaseUrl = (document.getElementById('llm-api-base').value || '').trim();
    s.proxyUrl = (document.getElementById('llm-proxy-url').value || '').trim();
    const selVal = document.getElementById('llm-model-select')?.value || '';
    s.model = (selVal === '__custom__'
      ? (document.getElementById('llm-model-custom')?.value || '').trim()
      : selVal
    ) || 'GigaChat-2';
    s.temperature = Math.max(0, Math.min(2, Number(document.getElementById('llm-temperature').value) || 0.2));
    s.maxTokens = Math.max(64, Number(document.getElementById('llm-max-tokens').value) || 900);
    s.systemPrompt = (document.getElementById('llm-system-prompt').value || '').trim() || DEFAULT_LLM_SYSTEM_PROMPT;
    s.contextMode = document.getElementById('llm-context-mode').value || 'summary';
    s.rowLimit = Math.max(1, Number(document.getElementById('llm-row-limit').value) || 80);
    s.payloadLimitBytes = Math.max(1024, Number(document.getElementById('llm-payload-limit').value) || 120000);
    s.customPayload = document.getElementById('llm-custom-payload').value || '';
    s.saveToLocal = !!document.getElementById('llm-save-local')?.checked;
    // V15 (audit#2, AI dev Critical 1): respect user's token-session-only
    // preference. The previous force-pin to `false` defeated the privacy
    // intent of the checkbox and silently persisted tokens to localStorage
    // even when the user explicitly disabled "saveToLocal".
    s.tokenSessionOnly = !!document.getElementById('llm-token-session')?.checked;
    const inputToken = (document.getElementById('llm-token')?.value || '').trim();
    state.llm.sessionToken = inputToken; // always in RAM for immediate use
    if (s.tokenSessionOnly) {
      // Session-only mode: do NOT write the token into the persisted settings.
      s.token = '';
    } else {
      s.token = inputToken;
    }
    if (s.saveToLocal) {
      localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(s));
    }
    else localStorage.removeItem(LLM_SETTINGS_KEY);
    LLMAssistant.updateContextModeIndicator();
    showToast('LLM settings сохранены');
  },
  clearSavedSettings() {
    localStorage.removeItem(LLM_SETTINGS_KEY);
    state.llm.settings = getLLMDefaultSettings();
    state.llm.sessionToken = '';
    LLMAssistant.syncSettingsUI();
    LLMAssistant.updateContextModeIndicator();
    showToast('LLM settings очищены');
  },
  syncSettingsUI() {
    const s = LLMAssistant.getSettings();
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('llm-api-mode', s.apiMode); setVal('llm-api-base', s.apiBaseUrl);
    setVal('llm-proxy-url', s.proxyUrl || '');
    // Model: match against select options, otherwise show custom input
    const modelSel = document.getElementById('llm-model-select');
    const modelCustom = document.getElementById('llm-model-custom');
    if (modelSel && modelCustom) {
      const knownOpt = [...modelSel.options].find(o => o.value === s.model && o.value !== '__custom__');
      if (knownOpt) {
        modelSel.value = s.model;
        modelCustom.classList.add('hidden');
        modelCustom.value = '';
      } else {
        modelSel.value = '__custom__';
        modelCustom.classList.remove('hidden');
        modelCustom.value = s.model || '';
      }
    }
    setVal('llm-temperature', s.temperature); setVal('llm-max-tokens', s.maxTokens);
    setVal('llm-system-prompt', s.systemPrompt || DEFAULT_LLM_SYSTEM_PROMPT);
    setVal('llm-context-mode', s.contextMode); setVal('llm-row-limit', s.rowLimit);
    setVal('llm-payload-limit', s.payloadLimitBytes); setVal('llm-custom-payload', s.customPayload || '');
    const tokenInput = document.getElementById('llm-token');
    if (tokenInput) tokenInput.value = s.token || state.llm.sessionToken || '';
    const saveLocal = document.getElementById('llm-save-local');
    if (saveLocal) saveLocal.checked = !!s.saveToLocal;
  },
  updateContextModeIndicator() {
    // V17.1 A5 — англицизмы убраны (none/summary only/current view/...).
    const map = {
      none: 'без контекста',
      summary: 'только сводка',
      currentView: 'текущий вид',
      fullRegistry: 'полный реестр (ограниченно)',
      custom: 'свой payload',
    };
    const el = document.getElementById('assistant-context-mode-label');
    if (el) el.textContent = `Контекст: ${map[LLMAssistant.getSettings().contextMode] || 'только сводка'}`;
  },
  bindUI() {
    const fab = document.getElementById('assistant-fab');
    const panel = document.getElementById('assistant-panel');
    const input = document.getElementById('assistant-input');
    const sendBtn = document.getElementById('assistant-btn-send');
    const stopBtn = document.getElementById('assistant-btn-stop');
    const errorEl = document.getElementById('assistant-error');
    // V17 P3 (CHAT-7) — reveal `payload` button only when debug flag set.
    try {
      if (localStorage.getItem('q2_chat_debug') === '1') {
        document.getElementById('assistant-btn-preview')?.classList.remove('hidden');
      }
    } catch (_) {}
    // Open the unified Settings modal and switch to the LLM tab (LLM form is rendered inline there)
    const openSettingsModal = () => {
      LLMAssistant.syncSettingsUI();
      const appModal = document.getElementById('app-settings-modal');
      if (!appModal) return;
      appModal.classList.remove('hidden');
      appModal.querySelectorAll('.app-settings-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'llm'));
      appModal.querySelectorAll('.app-settings-tab-content').forEach(c => c.classList.toggle('hidden', c.dataset.tabContent !== 'llm'));
    };
    // Backwards-compat: a few handlers below still reference the old standalone modal element.
    const settingsModal = document.getElementById('app-settings-modal');
    if (fab) fab.addEventListener('click', () => {
      const willOpen = panel.classList.contains('hidden');
      state.llm.panelOpen = willOpen;
      if (willOpen) { state.llm.panelMinimized = false; panel.classList.remove('hidden','minimized'); fab.classList.add('hidden'); input.focus(); }
      else { panel.classList.add('hidden'); fab.classList.remove('hidden'); errorEl.classList.add('hidden'); }
    });
    document.getElementById('assistant-btn-close').addEventListener('click', () => {
      // V15 (audit#2, QA Critical 3): abort in-flight SSE on close, otherwise
      // fetch keeps running, partial output silently appears next open, and
      // we leak a socket per close-during-stream.
      try { state.llm.abortController?.abort?.(); } catch(_) {}
      state.llm.isStreaming = false;
      state.llm.panelOpen = false; panel.classList.add('hidden');
      if (fab) fab.classList.remove('hidden'); errorEl.classList.add('hidden');
    });
    // V17.1 A4 — click outside chat panel → close. Skips clicks inside the
    // settings/preview modals (they live outside the panel but are owned by
    // chat). Idempotent guard prevents double-bind on re-init.
    if (!document._q2ChatOutsideBound) {
      document._q2ChatOutsideBound = true;
      document.addEventListener('mousedown', (e) => {
        const p = document.getElementById('assistant-panel');
        const f = document.getElementById('assistant-fab');
        if (!p || p.classList.contains('hidden')) return;
        if (state.llm?.isStreaming) return;        // don't kill panel mid-stream
        const t = e.target;
        if (!t || !(t instanceof Node)) return;
        if (p.contains(t)) return;                  // inside panel
        if (f && f.contains(t)) return;             // FAB itself (toggle)
        if (t.closest?.('.modal-overlay, .modal, .toast, .tag-suggest-drop, .ms-dropdown, .ctx-menu')) return;
        try { state.llm.abortController?.abort?.(); } catch(_) {}
        state.llm.isStreaming = false;
        state.llm.panelOpen = false;
        p.classList.add('hidden');
        if (f) f.classList.remove('hidden');
        const err = document.getElementById('assistant-error');
        if (err) err.classList.add('hidden');
      });
    }
    document.getElementById('assistant-btn-minimize').addEventListener('click', () => {
      state.llm.panelMinimized = !state.llm.panelMinimized;
      panel.classList.toggle('minimized', state.llm.panelMinimized);
    });
    document.getElementById('assistant-btn-settings')?.addEventListener('click', openSettingsModal);
    document.getElementById('assistant-btn-clear')?.addEventListener('click', () => LLMAssistant.clearConversation());
    document.getElementById('btn-llm-settings')?.addEventListener('click', openSettingsModal);
    // The Save button in the LLM form (now embedded in the unified Settings modal)
    document.getElementById('llm-save-settings')?.addEventListener('click', () => {
      LLMAssistant.saveSettingsFromUI();
      // V15 (audit#2, QA Critical 1): use window.closeModal — `closeModal`
      // is module-private to app.js and ReferenceError'd here otherwise.
      const appModal = document.getElementById('app-settings-modal');
      if (appModal) window.closeModal?.(appModal);
    });
    document.getElementById('llm-clear-saved').addEventListener('click', () => LLMAssistant.clearSavedSettings());
    // Render & wire the editable prompt registry (system + user templates per category).
    // PromptsEditor lives in app.js (module-scope const, exposed as window.PromptsEditor).
    // Defensive optional-chaining keeps init() from throwing if the global isn't ready
    // yet — without this guard, the ReferenceError aborted the whole App.init chain
    // and prevented Storage.load() from running on F5.
    window.PromptsEditor?.init?.();
    document.getElementById('llm-model-select')?.addEventListener('change', e => {
      const custom = document.getElementById('llm-model-custom');
      if (!custom) return;
      if (e.target.value === '__custom__') { custom.classList.remove('hidden'); custom.focus(); }
      else custom.classList.add('hidden');
    });
    sendBtn.addEventListener('click', () => LLMAssistant.sendFromInput());
    stopBtn.addEventListener('click', () => LLMAssistant.stopGeneration());
    input.addEventListener('keydown', (e) => {
      // V17 P3 (CHAT-1) — Cmd+Enter / Ctrl+Enter as alias for Enter (mac
      // muscle memory from Slack / Linear). Plain Enter still sends.
      // V17 P3 (CHAT-9) — Up-arrow on EMPTY input recalls last prompt
      // (CLI / Raycast / ChatGPT pattern). Skipped if input has any text.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        LLMAssistant.sendFromInput();
        return;
      }
      if (e.key === 'ArrowUp' && !e.shiftKey && !input.value) {
        const last = state.llm?.lastUserText;
        if (last) {
          e.preventDefault();
          input.value = last;
          // Resize to fit + place caret at end.
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 180) + 'px';
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
    });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; });

    // V17 P3 (CHAT-1) — global hotkey ⌘/ and ⌘J to toggle the panel.
    // Both designers flagged this independently. Skipped when focus is in
    // an editable element (so it doesn't hijack legit `/` typing).
    document.addEventListener('keydown', (e) => {
      const isToggle = (e.metaKey || e.ctrlKey) && (
        e.key === '/' || e.key === '.' || e.key === 'j' || e.key === 'J' ||
        e.key === 'о' || e.key === 'О'   // Russian layout for J
      );
      if (!isToggle) return;
      const t = e.target;
      const editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      // We DO toggle even when focus is in our own input — that's the
      // expected close-shortcut. Otherwise skip.
      if (editable && !t.closest?.('#assistant-panel')) return;
      e.preventDefault();
      const isHidden = panel.classList.contains('hidden');
      state.llm.panelOpen = isHidden;
      if (isHidden) {
        state.llm.panelMinimized = false;
        panel.classList.remove('hidden', 'minimized');
        if (fab) fab.classList.add('hidden');
        input.focus();
      } else {
        panel.classList.add('hidden');
        if (fab) fab.classList.remove('hidden');
        errorEl.classList.add('hidden');
      }
    });
    // V15 (audit#2, QA Critical 1+2): use window.closeModal so the ESC
    // handler doesn't ReferenceError. Also, ESC for the settings modal
    // should NOT depend on `state.llm?.panelOpen` — the settings modal
    // can be opened from outside the chat panel via App Settings.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (settingsModal && !settingsModal.classList.contains('hidden')) {
        window.closeModal?.(settingsModal);
        return;
      }
      if (state.llm?.panelOpen) {
        state.llm.panelOpen = false;
        panel.classList.add('hidden');
        if (fab) fab.classList.remove('hidden');
        errorEl.classList.add('hidden');
      }
    });
    const messagesWrap = document.getElementById('assistant-messages');
    if (messagesWrap) {
      // Bind action buttons & drilldown from chatActions module
      bindActionClicks(messagesWrap);

      messagesWrap.addEventListener('click', (e) => {
        // Retry button
        if (e.target.closest('[data-retry]') && state.llm.lastUserText && !state.llm.isStreaming) {
          const lastMsg = state.llm.history[state.llm.history.length - 1];
          if (lastMsg?.isError) state.llm.history.pop();
          const prevMsg = state.llm.history[state.llm.history.length - 1];
          if (prevMsg?.role === 'user' && prevMsg.content === state.llm.lastUserText) state.llm.history.pop();
          input.value = state.llm.lastUserText; input.dispatchEvent(new Event('input')); LLMAssistant.sendFromInput(); return;
        }
        // Copy button
        const copyBtn = e.target.closest('.msg-copy-btn'); if (!copyBtn) return;
        const idx = parseInt(copyBtn.dataset.index ?? '-1', 10);
        const msg = state.llm.history[idx]; if (!msg) return;
        const textToCopy = msg.content || '';
        navigator.clipboard.writeText(textToCopy).then(() => showToast('Скопировано'), () => {
          const ta = document.createElement('textarea'); ta.value = textToCopy; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('Скопировано');
        });
      });
    }
    // Review mode selector
    const reviewSel = document.getElementById('chat-review-mode-select');
    if (reviewSel) {
      reviewSel.addEventListener('change', () => {
        const role = reviewSel.value;
        if (role) {
          input.value = `Посмотри на данные как ${role === 'ceo' ? 'CEO' : role === 'dm' ? 'Delivery Manager' : role === 'risk' ? 'Risk Officer' : 'Team Lead'}.`;
          input.dispatchEvent(new Event('input'));
          LLMAssistant.sendFromInput();
          reviewSel.value = '';
        }
      });
    }
    const contextLabel = document.getElementById('assistant-context-mode-label');
    if (contextLabel) {
      contextLabel.addEventListener('click', () => {
        const modes = ['currentView','fullRegistry','summary','none'];
        const s = LLMAssistant.getSettings();
        const next = modes[(modes.indexOf(s.contextMode) + 1) % modes.length];
        s.contextMode = next;
        if (s.saveToLocal) localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(s));
        LLMAssistant.updateContextModeIndicator(); showToast(`Режим контекста: ${next}`);
      });
    }
    document.getElementById('assistant-btn-preview').addEventListener('click', () => {
      const s = LLMAssistant.getSettings();
      const payload = LLMAssistant.buildContextPayloadByMode(s.contextMode);
      const clipped = truncateForLLM(payload, { rowLimit: s.rowLimit, payloadLimitBytes: s.payloadLimitBytes });
      const bytes = JSON.stringify(clipped).length;
      const modal = document.getElementById('modal-kpi');
      document.getElementById('modal-kpi-title').textContent = `LLM payload preview (~${Math.round(bytes/1024)}KB)`;
      document.getElementById('modal-kpi-body').innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word">${Utils.escapeHtml(JSON.stringify(clipped, null, 2))}</pre>`;
      modal.classList.remove('hidden');
    });
    document.getElementById('assistant-btn-insert-context').addEventListener('click', () => {
      const s = LLMAssistant.getSettings();
      const clipped = truncateForLLM(LLMAssistant.buildContextPayloadByMode(s.contextMode), { rowLimit: s.rowLimit, payloadLimitBytes: s.payloadLimitBytes });
      const txt = JSON.stringify(clipped, null, 2);
      input.value = input.value ? `${input.value}\n\n${txt}` : txt;
      input.dispatchEvent(new Event('input')); input.focus();
    });
    const quickWrap = document.getElementById('assistant-quick-prompts');
    if (quickWrap) {
      quickWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.assistant-quick-btn'); if (!btn) return;
        const prompt = btn.dataset.prompt || ''; if (!prompt) return;
        const contextOverride = btn.dataset.context || null;
        input.value = prompt; input.dispatchEvent(new Event('input')); input.focus();
        LLMAssistant.sendFromInput(contextOverride);
      });
    }
    // Quick prompts collapse toggle
    const quickToggle = document.getElementById('assistant-quick-toggle');
    const quickSection = document.getElementById('assistant-quick-wrap');
    const QUICK_COLLAPSED_KEY = 'q2_quick_prompts_collapsed';
    if (quickToggle && quickSection) {
      // Restore saved state
      if (localStorage.getItem(QUICK_COLLAPSED_KEY) === '1') {
        quickSection.classList.add('collapsed');
      }
      quickToggle.addEventListener('click', () => {
        const isNowCollapsed = quickSection.classList.toggle('collapsed');
        localStorage.setItem(QUICK_COLLAPSED_KEY, isNowCollapsed ? '1' : '0');
      });
    }
  },
  getQuickPrompts() {
    // Delegated to chatTemplates module
    return getQuickPrompts();
  },
  updateQuickPrompts() {
    const wrap = document.getElementById('assistant-quick-prompts'); if (!wrap) return;
    const prompts = LLMAssistant.getQuickPrompts();
    wrap.innerHTML = renderQuickPromptsHTML(prompts);
  },
  buildContextPayloadByMode(mode) {
    if (mode === 'none') return { contextDisabled: true };
    if (mode === 'summary') return buildSummaryContextPayload();
    if (mode === 'currentView') return buildVisibleContextPayload();
    if (mode === 'fullRegistry') return buildAppContextPayload();
    return buildCustomContextPayload();
  },
  renderMessages(streamingUpdate) {
    const wrap = document.getElementById('assistant-messages'); if (!wrap) return;
    if (!state.llm.history.length) {
      wrap.innerHTML = `<div class="assistant-msg assistant-msg-assistant">Готов помочь с анализом данных.<br>Выберите типовой вопрос выше или задайте свой.</div>`;
      return;
    }
    // Fast streaming update — patch only last message
    if (streamingUpdate) {
      const lastMsg = state.llm.history[state.llm.history.length - 1];
      const msgEls = wrap.querySelectorAll('.assistant-msg');
      const lastEl = msgEls[msgEls.length - 1];
      if (lastEl && lastMsg && msgEls.length === state.llm.history.length) {
        lastEl.classList.toggle('assistant-msg-streaming', !!lastMsg.streaming);
        const bodyEl = lastEl.querySelector('.msg-body');
        if (bodyEl) {
          if (lastMsg.thinking) {
            bodyEl.innerHTML = '<span class="msg-thinking"><span></span><span></span><span></span></span>';
          } else {
            // Parse partial structured content during streaming
            const partial = parseLLMResponse(lastMsg.content || '');
            const tmpHtml = renderStructuredResponse({ ...partial, streaming: true }, -1, true);
            bodyEl.innerHTML = tmpHtml.match(/<div class="msg-body">([\s\S]*)<\/div>\s*<\/div>/)?.[1] || '';
          }
        }
        wrap.scrollTop = wrap.scrollHeight;
        return;
      }
    }
    // Full re-render
    wrap.innerHTML = state.llm.history.map((msg, idx) => {
      if (msg.role === 'user') return renderUserMessage(msg, idx);
      if (msg.thinking) return renderThinking(idx);
      if (msg.isError) return renderError(msg, idx, !!state.llm.lastUserText);
      // Assistant message — may have structured content
      const structured = msg.structured || parseLLMResponse(msg.content || '');
      return renderStructuredResponse(structured, idx, !!msg.streaming);
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
  },
  setError(message) {
    const el = document.getElementById('assistant-error'); if (!el) return;
    if (!message) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = message; el.classList.remove('hidden');
  },
  clearConversation() {
    if (state.llm.isStreaming) return;
    state.llm.history = []; state.llm.apiHistory = []; state.llm.lastUserText = '';
    localStorage.removeItem(LLMAssistant.CONV_KEY);
    LLMAssistant.renderMessages(); LLMAssistant.setPayloadStatus('');
  },
  setPayloadStatus(text) {
    const el = document.getElementById('assistant-payload-status');
    if (el) { el.textContent = text; el.classList.toggle('hidden', !text); }
  },
  async sendFromInput(contextOverride) {
    const input   = document.getElementById('assistant-input');
    const sendBtn = document.getElementById('assistant-btn-send');
    const stopBtn = document.getElementById('assistant-btn-stop');
    const text    = String(input.value || '').trim();
    if (!text || state.llm.isStreaming) return;
    LLMAssistant.setError(''); LLMAssistant.setPayloadStatus('');
    state.llm.lastUserText = text;
    state.llm.history.push({ role: 'user', content: text });
    try { HistoryLog.ai('chat_message', `Чат: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`, { details: text.slice(0, 400), source: 'chat' }); } catch(_) {}
    const assistantMsg = { role: 'assistant', content: '', streaming: true, thinking: true, structured: null };
    state.llm.history.push(assistantMsg);
    input.value = ''; input.style.height = 'auto';
    state.llm.isStreaming = true; sendBtn.disabled = true; stopBtn.classList.remove('hidden');
    LLMAssistant.renderMessages();
    const abortController = new AbortController();
    state.llm.abortController = abortController;

    // ── Step 1: run chat engine intent detection ──────────────
    let handled = false;
    chatProcess(text, {
      onRuleBased: ({ structured }) => {
        handled = true;
        assistantMsg.thinking = false;
        assistantMsg.streaming = false;
        assistantMsg.structured = structured;
        assistantMsg.content = structured.text || '';
        state.llm.apiHistory.push({ role: 'user', content: text });
        state.llm.apiHistory.push({ role: 'assistant', content: assistantMsg.content });
        LLMAssistant.saveConversation();
        state.llm.isStreaming = false;
        sendBtn.disabled = false; stopBtn.classList.add('hidden');
        LLMAssistant.renderMessages();
        LLMAssistant.setPayloadStatus('rule-based · мгновенно');
        // V15 (audit#2, fullstack Critical 1 + 2): NEVER auto-execute LLM-
        // supplied actions. The previous code took `autoAction = actions.find
        // (a => a.autoExecute)` and ran it without user confirmation — which
        // contradicts the explicit "NEVER auto-execute" rule in chatPrompts
        // AND is a forge-able authorization vector (the LLM controls both the
        // action `type` and the `autoExecute` flag). Mutations require an
        // explicit user click on a preview chip. The flag is now ignored.
        const flaggedAuto = (structured.actions || []).find(a => a.autoExecute);
        if (flaggedAuto) {
          // eslint-disable-next-line no-console
          console.warn('[llm] autoExecute flag from LLM ignored — user click required');
          try { window.ErrorsLog?.add?.({ level:'warn', source:'LLMAssistant', message:'LLM-flagged autoExecute action was rejected (security policy)', details: { type: flaggedAuto.type } }); } catch(_) {}
        }
      },
      onLLMPrompt: async ({ llmPrompt, system, user, category, label }) => {
        // LLM path — build messages with intent-based prompt
        // If chatEngine provided system + user (new prompt-architecture path),
        // use them directly. Otherwise fall back to the legacy buildApiCallMessages.
        try {
          const useIntentPrompts = !!(system && user);
          let messages;
          if (useIntentPrompts) {
            const apiHistory = state.llm?.apiHistory || [];
            const hasHistory = apiHistory.some(m => m.role === 'user');
            if (hasHistory) {
              const trimmed = trimApiHistory(apiHistory, 20);
              messages = [{ role: 'system', content: system }, ...trimmed, { role: 'user', content: user }];
            } else {
              messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
            }
            // Tag the assistant message with the prompt category for UI badge
            assistantMsg.category = category;
            assistantMsg.categoryLabel = label;
          } else {
            messages = buildApiCallMessages(llmPrompt, contextOverride || null);
          }
          const sentUserContent = messages[messages.length - 1].content;
          const payloadBytes = JSON.stringify(messages).length;
          LLMAssistant.setPayloadStatus(`${label || 'LLM'} · payload ~${Math.round(payloadBytes / 1024)}KB`);
          await callGigaChatStream(messages, LLMAssistant.getSettings(), (delta) => {
            if (assistantMsg.thinking) assistantMsg.thinking = false;
            assistantMsg.content += delta;
            LLMAssistant.renderMessages(true);
          }, abortController.signal);
          assistantMsg.streaming = false; assistantMsg.thinking = false;
          if (!assistantMsg.content.trim()) {
            console.warn('[LLM] ⚠ assistantMsg.content is empty after stream. Settings snapshot:', {
              apiMode: LLMAssistant.getSettings().apiMode,
              apiBaseUrl: LLMAssistant.getSettings().apiBaseUrl,
              model: LLMAssistant.getSettings().model,
              tokenPresent: !!LLMAssistant.getToken(),
              messagesCount: messages.length,
              category,
            });
            // V17 P3 (CHAT-12) — concrete user-facing message instead of
            // a flat «Ответ пустой». Sets isError so the retry-button
            // appears (chatUIRenderer reads `msg.isError` for that).
            // Audit 2026-05 (designer Top-3 #3).
            assistantMsg.content = '⚠ Ответ пустой — стрим завершился без текста. Возможные причины: истёк токен, неверная модель, перегруз сети. Нажми «Повторить» или открой настройки.';
            assistantMsg.isError = true;
          } else {
            // Parse structured JSON block from LLM response
            assistantMsg.structured = parseLLMResponse(assistantMsg.content);
            // Bubble the category label down to the structured response so UI can render it
            if (category && assistantMsg.structured) {
              assistantMsg.structured.category = category;
              assistantMsg.structured.categoryLabel = label;
            }
            state.llm.apiHistory.push({ role: 'user', content: sentUserContent });
            state.llm.apiHistory.push({ role: 'assistant', content: assistantMsg.content });
            LLMAssistant.saveConversation();
          }
        } catch (err) {
          assistantMsg.streaming = false; assistantMsg.thinking = false;
          if (err && err.name === 'AbortError') { assistantMsg.content = assistantMsg.content || 'Генерация остановлена.'; }
          else {
            assistantMsg.isError = true; assistantMsg.content = assistantMsg.content || 'Не удалось получить ответ от LLM.';
            const errStr = String(err?.message || err || 'Ошибка LLM');
            const hint = errStr.includes('token') || errStr.includes('401') ? ' — проверь API-токен в настройках ⚙'
              : (errStr.includes('fetch') || errStr.includes('network') || errStr.includes('Failed')) ? ' — сервер недоступен, проверь URL и запущен ли node server.js' : '';
            LLMAssistant.setError(errStr + hint);
          }
        } finally {
          state.llm.isStreaming = false; state.llm.abortController = null;
          sendBtn.disabled = false; stopBtn.classList.add('hidden');
          LLMAssistant.renderMessages();
        }
      },
    });

    // chatProcess is sync for rule-based; for LLM path onLLMPrompt is async —
    // the `handled` flag lets us know if we need to handle final state.
    if (!handled) {
      // onLLMPrompt took over — nothing more to do here synchronously
    }
  },
  stopGeneration() { if (state.llm.abortController) state.llm.abortController.abort(); },
};



if (typeof window !== "undefined") window.LLMAssistant = LLMAssistant;
