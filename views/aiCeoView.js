'use strict';
/* ============================================================
   AI CEO VIEW — v10_0
   Orchestrates the AI CEO tab: fallback → LLM enhance → render.
   Read-only: NEVER mutates state.rows directly.
   All changes go through preview modal + explicit confirm.
   ============================================================ */

import { state }               from '../state.js';
// V17 P8 (QA B-2 consensus) — respect global filters.
import { FilterEngine }        from '../filters.js';
import { runAllCeoBlocks }     from '../ai/aiCeoFallback.js';
import {
  renderCeoPage, renderCeoEmpty, renderCeoLoading,
  renderPreviewModal, renderExplainPanel,
} from '../ai/aiCeoRenderer.js';

/* ── LLM schema for CEO structured output ─────────────────── */
const CEO_SCHEMA = `{
  "health": {
    "score": number,
    "status": "ok|risk|critical",
    "label": "string",
    "causes": [{"text":"string","severity":"critical|warning|info","filter":object|null}],
    "summary": "string",
    "critRelText": "string|null"
  },
  "ifNothingChanges": {
    "headline": "string",
    "consequences": [{"severity":"critical|warning|info","text":"string","filter":object|null}],
    "projectedRisk": number,
    "currentRisk": number,
    "projectedDays": number
  },
  "hardTruths": {
    "hardTruths": [{"icon":"string","text":"string","filter":object|null}],
    "suspicious":  [{"icon":"string","text":"string","filter":object|null}],
    "weakSignals": [{"icon":"string","text":"string","filter":object|null}]
  },
  "actionFeed": [
    {"id":"string","severity":"critical|warning|info","icon":"string","title":"string",
     "explanation":"string","impact":"string","affectedCount":number,"filter":object|null}
  ]
}`;

const LLM_SYSTEM = 'Ты — жёсткий AI-советник CEO. Анализируй только реальные данные. Отвечай ТОЛЬКО валидным JSON. Не придумывай факты.';

/* ── build compact context for LLM ────────────────────────── */
function buildCeoContext(data) {
  const m = data.metrics;
  const slim = r => ({
    id: r.id,
    task: String(r.tasks||r.epic||'').slice(0,70),
    team: r.team||'',
    rel: [r.hasRelease120&&'1.20',r.hasRelease121&&'1.21',r.hasRelease122&&'1.22',r.hasOvertime&&'OT'].filter(Boolean).join('/'),
    scope: r.scopeStatus||'',
    done: r.isDone,
    blocked: !!r.blockingDependency,
    risks: r.riskFlags||[],
    score: r.riskScore||0,
    assignee: String(r.assignee||'').slice(0,30),
  });

  const ctx = {
    summary: {
      total:m.total, done:m.done, active:m.active, donePct:m.donePct,
      blockers:m.blockers.length, blockingNear:m.blockingNear.length,
      noRelease:m.noRelease.length, unconfirmed:m.unconfirmed.length,
      noAssignee:m.noAssignee.length, overtime:m.overtime.length,
      health:m.health, overloadedCount:m.overloaded.length,
    },
    releases: Object.entries(m.releaseProblems).reduce((acc,[k,v])=>{
      acc[k]={pct:v.progress.pct,total:v.progress.total,done:v.progress.done,blockers:v.blockers,unconfirmed:v.unconfirmed};
      return acc;
    },{}),
    topBlockers:    m.topBlockers.slice(0,8).map(slim),
    topRisky:       m.topRisky.slice(0,8).map(slim),
    noReleaseTasks: m.noRelease.slice(0,6).map(slim),
    unconfirmed:    m.unconfirmed.slice(0,6).map(slim),
    overloaded:     m.overloaded.slice(0,5).map(a=>({name:a.name,total:a.total})),
    deps:           Object.entries(state.epicDeps||{}).slice(0,15),
    worstRelease:   m.worstRelease ? m.worstRelease.label : null,
  };

  const raw = JSON.stringify(ctx);
  return raw.length > 45000 ? JSON.stringify({...ctx, noReleaseTasks:[], unconfirmed:[]}) : raw;
}

/* ── LLM call (non-streaming, expects JSON) ───────────────── */
async function callCeoLLM(contextStr) {
  const settings = window.LLMAssistant?.getSettings?.();
  if (!settings) return null;

  const token   = window.LLMAssistant?.getToken?.() || '';
  const apiBase = String(settings.apiBaseUrl || '').replace(/\/+$/, '');
  const proxy   = String(settings.proxyUrl   || '').replace(/\/+$/, '');
  const model   = settings.model || 'GigaChat-2';

  const userMsg = `Ты CEO-советник. Проанализируй данные и верни JSON строго по схеме:\n${CEO_SCHEMA}\n\nДанные проекта:\n${contextStr}`;

  const body = {
    model, temperature: 0.2, max_tokens: 1800, stream: false,
    messages: [
      { role: 'system', content: LLM_SYSTEM },
      { role: 'user',   content: userMsg },
    ],
  };

  try {
    let res;
    let useDirect = false;
    if (settings.apiMode === 'direct' && apiBase) {
      // Direct mode is only safe when the endpoint is on the same origin (no CORS).
      // For cross-origin endpoints (e.g. gigachat.devices.sberbank.ru) — fall back to proxy.
      try {
        const ep = apiBase.endsWith('/chat/completions') ? apiBase : `${apiBase}/chat/completions`;
        const epUrl = new URL(ep, window.location.origin);
        useDirect = epUrl.origin === window.location.origin;
        if (useDirect) {
          res = await fetch(epUrl.toString(), {
            method: 'POST', signal: AbortSignal.timeout(25000),
            headers: { 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) },
            body: JSON.stringify(body),
          });
        }
      } catch(_) { useDirect = false; }
    }
    if (!useDirect) {
      const ep = proxy ? `${proxy}/api/llm/chat` : '/api/llm/chat';
      res = await fetch(ep, {
        method: 'POST', signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ...body, apiBaseUrl: apiBase, token }),
      });
    }
    if (!res.ok) return null;

    const json = await res.json().catch(() => null);
    if (!json) return null;

    const text = json?.choices?.[0]?.message?.content
               || json?.result?.choices?.[0]?.message?.content
               || json?.content || '';
    if (!text) return null;

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    // Minimal validation
    if (!parsed.health || typeof parsed.health.score !== 'number') return null;
    return parsed;
  } catch(e) {
    console.warn('[AICeoView] LLM call failed:', e?.message || e);
    return null;
  }
}

/* ── merge LLM into fallback data ─────────────────────────── */
function mergeLLMData(fallback, llm) {
  if (!llm) return fallback;

  const merge = (fb, lv) => lv && typeof lv === 'object' && Object.keys(lv).length ? { ...fb, ...lv, aiEnhanced: true } : fb;

  return {
    ...fallback,
    health:           merge(fallback.health, llm.health),
    ifNothingChanges: merge(fallback.ifNothingChanges, llm.ifNothingChanges),
    hardTruths:       merge(fallback.hardTruths, llm.hardTruths),
    actionFeed:       Array.isArray(llm.actionFeed) && llm.actionFeed.length
                        ? llm.actionFeed : fallback.actionFeed,
    aiEnhanced: true,
  };
}

/* ── navigate + apply filter ──────────────────────────────── */
function applyFilterAndGoTo(filterPayload) {
  try {
    if (!filterPayload) { window.App?.goTo?.('registry'); return; }
    const f = state.filters;
    if (filterPayload.team         !== undefined) f.team         = filterPayload.team;
    if (filterPayload.release      !== undefined) f.release      = filterPayload.release;
    if (filterPayload.scope        !== undefined) f.scope        = filterPayload.scope;
    if (filterPayload.scopeStatus  !== undefined) f.scope        = filterPayload.scopeStatus;
    if (filterPayload.search       !== undefined) f.search       = filterPayload.search;
    if (filterPayload.onlyBlocking !== undefined) f.onlyBlocking = !!filterPayload.onlyBlocking;
    if (filterPayload.onlyRisky    !== undefined) f.onlyRisky    = !!filterPayload.onlyRisky;
    if (filterPayload.onlyDone     !== undefined) f.onlyDone     = !!filterPayload.onlyDone;
    if (filterPayload.isUnassigned) { f.scope = 'Да'; }
    window.App?.goTo?.('registry');
    window.notify?.('chat_filter');
    window.showToast?.('Фильтры применены');
  } catch(e) { console.warn('[AICeoView] applyFilter error', e); }
}

/* ── open chat with a message ─────────────────────────────── */
function openChatWithMessage(msg) {
  try {
    const input = document.getElementById('assistant-input');
    if (input && state.llm?.panelOpen) {
      input.value = msg;
      input.dispatchEvent(new Event('input'));
      document.getElementById('assistant-btn-send')?.click();
    } else {
      const fab = document.getElementById('assistant-fab');
      if (fab) { fab.click(); }
      setTimeout(() => {
        const inp = document.getElementById('assistant-input');
        if (inp) {
          inp.value = msg;
          inp.dispatchEvent(new Event('input'));
          document.getElementById('assistant-btn-send')?.click();
        }
      }, 400);
    }
  } catch(e) {}
}

/* ── explanation section → chat prompt ───────────────────── */
const EXPLAIN_PROMPTS = {
  health:   'Объясни подробно health score проекта — причины, что нужно исправить в первую очередь.',
  inc:      'Что конкретно произойдёт если мы ничего не делаем с текущими блокерами и нераспределёнными задачами?',
  truths:   'Назови главные противоречия и завышенные ожидания в текущем плане проекта.',
  'scenario-conservative': 'Опиши подробно conservative сценарий спасения релиза — что именно убрать, почему.',
  'scenario-balanced':     'Опиши подробно balanced сценарий спасения релиза — как расставить приоритеты.',
  'scenario-aggressive':   'Опиши подробно aggressive сценарий спасения релиза — какой scope срезать, как эскалировать.',
};

/* ── show explain modal or chat ──────────────────────────── */
function showExplain(section, data) {
  const prompt = EXPLAIN_PROMPTS[section];
  if (prompt && (state.llm?.panelOpen || document.getElementById('assistant-fab'))) {
    openChatWithMessage(prompt);
    return;
  }
  // Fallback: show a quick modal
  const existing = document.getElementById('ceo-explain-modal');
  if (existing) existing.remove();
  const html = renderExplainPanel(section, data);
  document.body.insertAdjacentHTML('beforeend', html);
  bindModalClose('#ceo-explain-modal');

  const chatBtn = document.getElementById('ceo-expl-chat-btn');
  if (chatBtn && prompt) {
    chatBtn.onclick = () => {
      document.getElementById('ceo-explain-modal')?.remove();
      openChatWithMessage(prompt);
    };
  }
}

/* ── preview modal helpers ────────────────────────────────── */
function bindModalClose(selector) {
  const modal = document.querySelector(selector);
  if (!modal) return;
  const close = () => modal.remove();
  modal.querySelector('#ceo-modal-close')?.addEventListener('click', close);
  modal.querySelector('#ceo-modal-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
}

function showPreviewModal(scenarioLabel, changesRaw) {
  let changes = [];
  try { changes = typeof changesRaw === 'string' ? JSON.parse(changesRaw) : changesRaw; } catch(_) {}

  const existing = document.getElementById('ceo-preview-modal');
  if (existing) existing.remove();

  const html = renderPreviewModal(scenarioLabel, changes);
  document.body.insertAdjacentHTML('beforeend', html);

  const modal = document.getElementById('ceo-preview-modal');
  const close = () => modal?.remove();
  modal?.querySelector('#ceo-modal-close')?.addEventListener('click', close);
  modal?.querySelector('#ceo-modal-cancel')?.addEventListener('click', close);
  modal?.addEventListener('click', e => { if (e.target === modal) close(); });

  const confirmBtn = modal?.querySelector('#ceo-modal-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      // Show a warning — changes are not actually applied here
      // To really apply: wire to applyBulkAction via a proper batch flow
      window.showToast?.('Функция прямого применения требует ревью и подтверждения через Action Layer', 'info');
      close();
      window.App?.goTo?.('actions');
    });
  }
}

/* ═══════════════════════════════════════════════════════════
   MAIN VIEW OBJECT
   ═══════════════════════════════════════════════════════════ */
export const AICeoView = {
  _data:   null,   // last computed data
  _root:   null,

  render() {
    const root = document.getElementById('section-ai-ceo');
    if (!root) return;
    this._root = root;

    // V17 P8 (QA B-2) — respect global filters.
    const rows = FilterEngine.getFiltered();
    if (!rows || !rows.length) {
      root.innerHTML = `<div id="ceo-root" class="view-root">${renderCeoEmpty()}</div>`;
      return;
    }

    // Rule-based fallback (instant)
    this._data = runAllCeoBlocks(rows);
    if (!this._data) {
      root.innerHTML = `<div id="ceo-root" class="view-root">${renderCeoEmpty()}</div>`;
      return;
    }

    root.innerHTML = `<div id="ceo-root" class="view-root">${renderCeoPage(this._data)}</div>`;
    this._bindEvents(root);
  },

  /* ── event delegation ──────────────────────────────────── */
  _bindEvents(root) {
    // V17 P8 (full-stack memleak) — `onclick=` overwrite-pattern,
    // see aiView._bindEvents for rationale (root not recreated).
    root.onclick = async e => {
      // AI refresh button
      if (e.target.id === 'ceo-refresh-btn' || e.target.closest('#ceo-refresh-btn')) {
        const btn = e.target.closest('#ceo-refresh-btn') || e.target;
        btn.disabled = true;
        btn.textContent = '⏳';
        const loader = window.showFunnyLoader?.('Обновляю CEO-сводку');
        try {
          await this._refreshWithLLM();
          window.HistoryLog?.ai?.('refresh_ceo', 'AI CEO: обновлена сводка');
        }
        finally {
          loader?.close();
          btn.disabled = false;
          btn.textContent = '↺ AI';
        }
        return;
      }

      const el = e.target.closest('[data-ceo-action]');
      if (!el) return;

      const action = el.dataset.ceoAction;

      if (action === 'filter') {
        try {
          const f = JSON.parse(el.dataset.filter || '{}');
          applyFilterAndGoTo(f);
        } catch(_) {}
        return;
      }

      if (action === 'explain') {
        const section = el.dataset.section || 'health';
        showExplain(section, this._data);
        return;
      }

      if (action === 'preview') {
        const scenarioId    = el.dataset.scenario || '';
        // V17.1 K1 — англицизмы → русский в preview-modal.
        const scenarioLabel = { conservative:'Консервативный', balanced:'Сбалансированный', aggressive:'Агрессивный' }[scenarioId] || scenarioId;
        const changesRaw    = el.dataset.changes || '[]';
        showPreviewModal(scenarioLabel, changesRaw);
        return;
      }
    };
  },

  /* ── LLM enhancement ───────────────────────────────────── */
  async _refreshWithLLM() {
    if (!this._data) return;

    const root = document.getElementById('ceo-root');
    if (!root) return;

    try {
      const ctxStr    = buildCeoContext(this._data);
      const llmResult = await callCeoLLM(ctxStr);

      if (!llmResult) {
        window.showToast?.('AI недоступен — показан rule-based анализ', 'info');
        return;
      }

      this._data = mergeLLMData(this._data, llmResult);
      root.innerHTML = renderCeoPage(this._data);
      this._bindEvents(this._root);
      window.showToast?.('✨ AI CEO обновлён', 'success');
    } catch(e) {
      console.warn('[AICeoView] LLM refresh error:', e);
      window.showToast?.('Ошибка AI — показан rule-based анализ', 'info');
    }
  },
};
