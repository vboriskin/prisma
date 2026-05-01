'use strict';
/* ============================================================
   AI VIEW — v10_0
   Orchestrates the AI tab: fallback → LLM → render.
   Read-only: never mutates state.rows directly.
   ============================================================ */

import { state }                                  from '../state.js';
// V17 P8 (QA B-2 consensus) — was reading state.rows directly, ignoring
// global filters. Now obeys FilterEngine.getFiltered() like the other 4
// non-AI dashboard tabs do.
import { FilterEngine }                           from '../filters.js';
import { runAllBlocks }                           from '../ai/aiFallbackEngine.js';
import { buildAIContext, serializeContext }       from '../ai/aiContextBuilder.js';
import { renderBlock, renderPageShell,
         renderBlockLoading, renderEmptyState }   from '../ai/aiRenderer.js';

/* ── LLM schema for structured block results ────────────────── */
const BLOCK_SCHEMA = `{
  "summary": "string (1-2 sentences)",
  "insights": ["string", "string", "..."],
  "recommendations": [{"title":"string","impact":"high|medium|low","action":"string"}],
  "confidence": "high|medium|low"
}`;

/* ── block metadata (title + prompt per block) ──────────────── */
// V17.1 J2 + K1 — англоязычные заголовки заменены на русские.
//   Промпты на английском намеренно: модель лучше держит формат JSON
//   на английском prompt-tuning'е, RU-перевод промптов даёт деградацию.
const BLOCK_META = {
  health:          { title:'Здоровье проекта',            prompt:'Analyze overall project health. Focus on blockers, risks, and no-release tasks. Output JSON.' },
  forecast:        { title:'Прогноз релизов',             prompt:'Forecast release success probability for each release window based on blockers, risks and done%. Output JSON.' },
  if_nothing_changes:{ title:'Если ничего не менять',     prompt:'Simulate consequences if nothing changes in the next sprint. List 3-5 concrete outcomes. Output JSON.' },
  dependency:      { title:'Анализ зависимостей',         prompt:'Analyze dependency chains and identify critical path risks. Output JSON.' },
  replanning:      { title:'Сценарии перепланирования',   prompt:'Propose 3 replanning scenarios (conservative, balanced, aggressive) with trade-offs. Output JSON.' },
  bottlenecks:     { title:'Узкие места',                 prompt:'Identify top bottlenecks by team, assignee, and release. Explain why each is a bottleneck. Output JSON.' },
  risk_narrative:  { title:'Описание рисков',             prompt:'Write a short human-readable narrative for each risk pattern. Explain impact and mitigation. Output JSON.' },
  prioritization:  { title:'Приоритизация задач',         prompt:'Prioritize top 10 tasks that need immediate attention. Explain each reason. Output JSON.' },
  dashboard:       { title:'Сгенерированный дашборд',     prompt:'Select 6-8 most critical metrics to highlight right now. Output JSON.' },
  anomalies:       { title:'Поиск аномалий',              prompt:'Detect statistical anomalies in task distribution and scope. Output JSON.' },
  quality:         { title:'Качество плана',              prompt:'Score the plan quality 0-100. Break down penalties by factor. Output JSON.' },
  second_opinion:  { title:'Второе мнение',               prompt:'Act as a strict plan reviewer. Identify weak spots and overly optimistic assumptions. Output JSON.' },
  recommendations: { title:'Рекомендации',                prompt:'Generate a prioritized list of concrete actionable recommendations. Output JSON.' },
};

// V17.1 J2 — словарь severity / forecast labels: HIGH / MEDIUM / LOW / CRITICAL
//   и confidence / scenario labels приходят от модели в нижнем регистре EN;
//   рендерим всегда через этот мап для русифицированного UI.
const SEVERITY_RU = {
  critical: 'критично',
  high:     'высокий',
  medium:   'средний',
  low:      'низкий',
  info:     'инфо',
};
const CONFIDENCE_RU = {
  high:   'высокая',
  medium: 'средняя',
  low:    'низкая',
};
const SCENARIO_RU = {
  worst:    'худший',
  expected: 'ожидаемый',
  best:     'лучший',
  conservative: 'консервативный',
  balanced:     'сбалансированный',
  aggressive:   'агрессивный',
};
function ruSeverity(s) { return SEVERITY_RU[String(s||'').toLowerCase()] || s || ''; }
function ruConfidence(s) { return CONFIDENCE_RU[String(s||'').toLowerCase()] || s || ''; }
function ruScenario(s) { return SCENARIO_RU[String(s||'').toLowerCase()] || s || ''; }

/* ── LLM call (non-streaming, expects JSON back) ────────────── */
async function callLLM(blockId, ctx) {
  const settings = window.LLMAssistant?.getSettings?.();
  if (!settings) return null;

  const token   = window.LLMAssistant?.getToken?.() || '';
  const apiBase = String(settings.apiBaseUrl || '').replace(/\/+$/, '');
  const proxy   = String(settings.proxyUrl   || '').replace(/\/+$/, '');
  const model   = settings.model || 'GigaChat-2';
  const meta    = BLOCK_META[blockId] || BLOCK_META.health;

  const systemMsg = 'Ты — AI-аналитик проектных планов. Отвечай ТОЛЬКО валидным JSON. Используй ТОЛЬКО данные из предоставленного контекста. Не выдумывай факты.';
  const userMsg   = `${meta.prompt}\n\nTrebovaniia: vernis\' tol\'ko JSON po skeme:\n${BLOCK_SCHEMA}\n\nDannye proekta (JSON):\n${serializeContext(ctx)}`;

  const messages = [
    { role:'system', content:systemMsg },
    { role:'user',   content:userMsg   },
  ];
  const body = { model, temperature:0.25, max_tokens:900, stream:false, messages };

  try {
    let res;
    let useDirect = false;
    if (settings.apiMode === 'direct' && apiBase) {
      // Direct only when same-origin (avoid CORS for cross-origin GigaChat endpoints)
      try {
        const ep = apiBase.endsWith('/chat/completions') ? apiBase : `${apiBase}/chat/completions`;
        const epUrl = new URL(ep, window.location.origin);
        useDirect = epUrl.origin === window.location.origin;
        if (useDirect) {
          res = await fetch(epUrl.toString(), { method:'POST', signal:AbortSignal.timeout(20000),
            headers:{'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})},
            body:JSON.stringify(body) });
        }
      } catch(_) { useDirect = false; }
    }
    if (!useDirect) {
      const ep = proxy ? `${proxy}/api/llm/chat` : '/api/llm/chat';
      res = await fetch(ep, { method:'POST', signal:AbortSignal.timeout(20000),
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...body, apiBaseUrl:apiBase, token}) });
    }
    if (!res.ok) return null;

    const data = await res.json().catch(()=>null);
    if (!data) return null;

    // Extract text content from response
    const text = data?.choices?.[0]?.message?.content
               || data?.result?.choices?.[0]?.message?.content
               || data?.content || '';
    if (!text) return null;

    // Extract JSON object from text
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);

    // Validate required keys
    if (typeof parsed.summary !== 'string') return null;
    return parsed;
  } catch(e) {
    console.warn('[AIView] LLM call failed for block', blockId, e?.message || e);
    return null;
  }
}

/* ── merge LLM result into block data ──────────────────────── */
function applyLLMResult(block, llmResult) {
  if (!llmResult) return block;
  return {
    ...block,
    summary:     llmResult.summary     || block.summary,
    insights:    Array.isArray(llmResult.insights) && llmResult.insights.length ? llmResult.insights : block.insights,
    recommendations: Array.isArray(llmResult.recommendations) && llmResult.recommendations.length
      ? llmResult.recommendations.map(r => ({ ...r, filter: null })) // LLM recs are read-only hints, no filter
      : block.recommendations,
    confidence:  llmResult.confidence  || block.confidence,
    aiEnhanced:  true,
  };
}

/* ── navigate + filter via existing app infrastructure ──────── */
function applyFilter(filterPayload) {
  try {
    const f = state.filters;
    if (!filterPayload) return;
    if (filterPayload.team         !== undefined) f.team         = filterPayload.team;
    if (filterPayload.release      !== undefined) f.release      = filterPayload.release;
    if (filterPayload.scope        !== undefined) f.scope        = filterPayload.scope;
    if (filterPayload.search       !== undefined) f.search       = filterPayload.search;
    if (filterPayload.scopeStatus  !== undefined) f.scope        = filterPayload.scopeStatus;
    if (filterPayload.onlyBlocking !== undefined) f.onlyBlocking = !!filterPayload.onlyBlocking;
    if (filterPayload.onlyRisky    !== undefined) f.onlyRisky    = !!filterPayload.onlyRisky;
    if (filterPayload.onlyDone     !== undefined) f.onlyDone     = !!filterPayload.onlyDone;
    if (filterPayload.isUnassigned) { f.scope = 'Да'; f.release = ''; }
    window.App?.goTo?.('registry');
    window.notify?.('chat_filter');
    window.showToast?.('Фильтры применены');
  } catch(e) { console.warn('[AIView] applyFilter error', e); }
}

function showExplain(block) {
  const lines = [
    `# ${block.icon} ${block.title}`,
    `Статус: ${ruSeverity(block.status) || block.status || ''}${block.score != null ? ` · Балл: ${block.score}` : ''}`,
    '',
    block.summary,
    '',
    '## Детали',
    ...(block.insights || []).map(i => `- ${i}`),
  ].join('\n');

  // If chat panel is open, send as message; otherwise show alert
  const input = document.getElementById('assistant-input');
  if (input && state.llm?.panelOpen) {
    input.value = `Объясни подробнее: ${block.title}`;
    input.dispatchEvent(new Event('input'));
    document.getElementById('assistant-btn-send')?.click();
  } else {
    const modal = document.getElementById('modal-kpi');
    if (modal) {
      document.getElementById('modal-kpi-title').textContent = block.title;
      document.getElementById('modal-kpi-body').innerHTML =
        `<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px">${lines.replace(/</g,'&lt;')}</pre>`;
      modal.classList.remove('hidden');
    } else {
      alert(lines);
    }
  }
}

/* ── main view object ───────────────────────────────────────── */
export const AIView = {
  _blocks: {},     // current block data keyed by blockId
  _root:   null,

  render() {
    const root = document.getElementById('section-ai');
    if (!root) return;
    this._root = root;

    // V17 P8 (QA B-2) — respect global filters.
    const rows = FilterEngine.getFiltered();
    if (!rows || !rows.length) {
      root.innerHTML = `<div id="ai-root" class="view-root">${renderEmptyState()}</div>`;
      return;
    }

    // Compute all blocks rule-based (instant)
    this._blocks = runAllBlocks(rows);

    // Map to indexed obj for renderPageShell
    const blocksById = {};
    Object.values(this._blocks).forEach(b => { blocksById[b.id] = b; });

    root.innerHTML = `<div id="ai-root" class="view-root">${renderPageShell(blocksById)}</div>`;
    this._bindEvents(root);
  },

  /* ── event delegation ────────────────────────────────────── */
  _bindEvents(root) {
    // V17 P8 (full-stack memleak + designer #5.1) — `addEventListener`
    // accumulated handlers on every render() since `#section-ai`
    // container is not recreated, only its innerHTML. Switching to
    // `onclick=` overwrite-pattern keeps exactly one handler at any time.
    root.onclick = async (e) => {
      // Refresh all
      if (e.target.id === 'ai-refresh-all') {
        e.target.disabled = true;
        e.target.textContent = '⏳ Обновляем…';
        const loader = window.showFunnyLoader?.('Обновляю AI-аналитику');
        try {
          await this._refreshAll();
          window.HistoryLog?.ai?.('refresh_all', 'AI Анализ: обновлены все блоки');
        }
        finally {
          loader?.close();
          e.target.disabled = false;
          e.target.textContent = '↺ Обновить всё';
        }
        return;
      }

      const btn = e.target.closest('[data-ai-action]');
      if (!btn) return;

      const action  = btn.dataset.aiAction;
      const blockId = btn.dataset.blockId;
      const block   = Object.values(this._blocks).find(b => b.id === blockId);

      if (action === 'refresh') {
        await this._refreshBlock(blockId, btn);
        return;
      }
      if (action === 'explain') {
        if (block) showExplain(block);
        return;
      }
      if (action === 'show') {
        // Use first available filter from recommendations
        const firstFilter = block?.recommendations?.find(r => r.filter)?.filter || block?.filterPayload;
        if (firstFilter) applyFilter(firstFilter);
        else window.App?.goTo?.('registry');
        return;
      }
      if (action === 'filter') {
        try { applyFilter(JSON.parse(btn.dataset.filter || '{}')); } catch(_) {}
        return;
      }
    };
  },

  /* ── refresh a single block ──────────────────────────────── */
  async _refreshBlock(blockId, triggerBtn) {
    const blockEl = document.getElementById(`ai-block-${blockId}`);
    const meta    = BLOCK_META[blockId];
    if (!blockEl || !meta) return;

    // Show loading
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = '⏳'; }
    blockEl.innerHTML = renderBlockLoading(blockId, meta.title).replace(/^<div[^>]*>|<\/div>$/, '');

    // Get fallback block
    let block = Object.values(this._blocks).find(b => b.id === blockId);
    if (!block) {
      const fresh = runAllBlocks(FilterEngine.getFiltered());
      this._blocks = { ...this._blocks, ...Object.fromEntries(Object.values(fresh).map(b=>[b.id,b])) };
      block = Object.values(this._blocks).find(b => b.id === blockId);
    }

    // Try LLM enhancement
    const ctx       = buildAIContext(FilterEngine.getFiltered(), { blockId, maxRows:35 });
    const llmResult = await callLLM(blockId, ctx);
    const enhanced  = applyLLMResult(block, llmResult);

    // Update stored block
    this._blocks[blockId] = enhanced;

    // Re-render this block
    blockEl.outerHTML = renderBlock(enhanced);

    // Re-bind events (new DOM)
    const newEl = document.getElementById(`ai-block-${blockId}`);
    if (newEl && triggerBtn) {
      const newBtn = newEl.querySelector(`[data-ai-action="refresh"][data-block-id="${blockId}"]`);
      if (newBtn) { newBtn.disabled = false; newBtn.textContent = '↺ Обновить AI-анализ'; }
    }
    if (!llmResult) window.showToast?.('AI недоступен — показан rule-based анализ', 'info');
    else            window.showToast?.(`✨ AI-анализ обновлён: ${meta.title}`, 'success');
  },

  /* ── refresh all blocks with LLM ────────────────────────── */
  async _refreshAll() {
    // Re-compute fallback first
    const fresh = runAllBlocks(FilterEngine.getFiltered());
    Object.values(fresh).forEach(b => { this._blocks[b.id] = b; });

    const ctx = buildAIContext(FilterEngine.getFiltered(), { maxRows:40 });

    // Refresh sequentially to avoid flooding the LLM proxy
    const ids = Object.keys(BLOCK_META);
    for (const id of ids) {
      const blockEl = document.getElementById(`ai-block-${id}`);
      if (!blockEl) continue;
      const block     = Object.values(this._blocks).find(b=>b.id===id);
      if (!block) continue;
      const llmResult = await callLLM(id, { ...ctx, blockId:id });
      const enhanced  = applyLLMResult(block, llmResult);
      this._blocks[id] = enhanced;
      blockEl.outerHTML = renderBlock(enhanced);
    }

    window.showToast?.('✨ AI-анализ обновлён', 'success');
  },
};
