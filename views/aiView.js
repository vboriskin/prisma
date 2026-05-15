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
// AUDIT_HOLISTIC O6 — миграция на единый AIPipeline.
//   `runAllBlocks` (старый rule-based fallback) больше не вызывается
//   напрямую: используем `AIPipeline.runAll('analysis', ctx)` →
//   получаем массив { id, data, source }. Старый импорт сохранён
//   в `_legacyRunAllBlocks` ниже как safety-net на случай, если
//   pipeline не bootstrap'нут (напр. ранний render до init.js).
import AIPipeline                                 from '../ai/AIPipeline.js';
import { ANALYSIS_BLOCKS }                        from '../ai/blockConfig.js';
import { runAllBlocks as _legacyRunAllBlocks }    from '../ai/aiFallbackEngine.js';
import { buildAIContext, serializeContext }       from '../ai/aiContextBuilder.js';
import { renderBlock, renderPageShell,
         renderBlockLoading, renderEmptyState }   from '../ai/aiRenderer.js';
// V18 P7 (audit-2026-05-04 §7) — общий LLM-клиент / парсер / applyFilter
// извлечён в ai/llmClient.js, чтобы не дублировать с aiCeoView.
import { callLLM, parseLLMJsonResponse, applyFilterPayload } from '../ai/llmClient.js';
import { renderPageHeader, showPageLoader, inlinePulseLoader } from '../app/prizmaUI.js';
// AUDIT_ARTDIRECTION #20+#26 — AI-frame primitive.
import { applyAiFrame, triggerInsightGlow, setMascotState, syncAiOnlyMarkers } from '../app/aiFramePrimitive.js';
import { Services } from '../app/services.js';

/* AUDIT_ARTDIRECTION #26 — runtime CSS для hero «×1.4 padding/font» +
   collapsed library + insight-stripe на hero. Не трогаем styles.css. */
function _ensureAiViewStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-aiView-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-aiView-style';
  style.textContent = `
    /* Hero — крупнее остальных карт. */
    .ai-layout-hero-prime { margin-bottom: 24px; }
    .ai-layout-hero-prime .ai-hero-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
      color: var(--text-3, #7A7A82);
      margin-bottom: 8px;
    }
    .ai-block-hero {
      padding: 32px;
      border-left: 3px solid var(--prizma-insight, #B084CC);
    }
    .ai-block-hero .ai-block-title {
      font-size: 20px;
    }
    .ai-block-hero .ai-summary {
      font-size: 15px;
      line-height: 1.55;
    }

    /* Library — collapsed details cards. */
    .ai-library {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ai-library-eyebrow-row {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
      color: var(--text-3, #7A7A82);
      margin: 8px 0 4px;
    }
    details.ai-library-item {
      border: 1px solid var(--border-light, rgba(120,120,120,0.18));
      border-radius: 6px;
      background: var(--card, transparent);
      overflow: hidden;
    }
    details.ai-library-item > summary.ai-library-summary {
      list-style: none;
      cursor: pointer;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      user-select: none;
    }
    details.ai-library-item > summary.ai-library-summary::-webkit-details-marker {
      display: none;
    }
    details.ai-library-item > summary.ai-library-summary::before {
      content: "›";
      font-size: 14px;
      color: var(--text-3, #7A7A82);
      transition: transform 140ms ease;
      display: inline-block;
      width: 12px;
    }
    details.ai-library-item[open] > summary.ai-library-summary::before {
      transform: rotate(90deg);
    }
    details.ai-library-item .ai-library-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
      color: var(--text-2, #5A5A64);
      flex: 1;
    }
    details.ai-library-item .ai-library-body {
      padding: 0 16px 16px;
    }
    details.ai-library-item .ai-library-body .ai-block {
      box-shadow: none;
      border: none;
      padding: 0;
    }
  `;
  document.head.appendChild(style);
}

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

/* AUDIT_HOLISTIC O6 — bootstrap: register analysis-блоки в pipeline один раз.
   Идемпотентно: AIPipeline.register() с тем же id просто overwrite'ит. */
let _pipelineReady = false;
function _ensurePipelineRegistered() {
  if (_pipelineReady) return;
  try {
    ANALYSIS_BLOCKS.forEach(b => AIPipeline.register(b));
    _pipelineReady = true;
  } catch (e) {
    console.warn('[aiView] AIPipeline registration failed, will fall back to legacy', e);
  }
}

/* AUDIT_HOLISTIC O6 — синхронный rule-based-only прогон через pipeline.
   Возвращает старую map-форму { health:..., forecast:..., ... } для
   совместимости с renderPageShell. Если pipeline по какой-то причине не
   bootstrap'нут — fallback'имся на legacy runAllBlocks(rows). */
function _runAllRuleBased(rows) {
  _ensurePipelineRegistered();
  if (!_pipelineReady) return _legacyRunAllBlocks(rows);
  // Все analysis-блоки на этом этапе sync-only (fallback не возвращает
  // Promise). Mapping id → ключ старого API:
  const idToKey = {
    health:'health', forecast:'forecast', if_nothing_changes:'ifNothingChanges',
    dependency:'dependency', replanning:'replanning', bottlenecks:'bottlenecks',
    risk_narrative:'riskNarrative', prioritization:'prioritization',
    dashboard:'dashboard', anomalies:'anomalies', quality:'quality',
    second_opinion:'secondOpinion', recommendations:'recommendations',
  };
  const out = {};
  AIPipeline.getRegisteredBlocks('analysis').forEach(b => {
    try {
      const data = b.fallback({ rows });
      const key = idToKey[b.id] || b.id;
      out[key] = data;
    } catch (e) { /* keep going */ }
  });
  return out;
}

/* ── LLM call (non-streaming, expects JSON back) ────────────── */
async function callBlockLLM(blockId, ctx) {
  if (!Services.LLMAssistant?.getSettings?.()) return null;
  const meta = BLOCK_META[blockId] || BLOCK_META.health;

  const systemMsg = 'Ты — AI-аналитик проектных планов. Отвечай ТОЛЬКО валидным JSON. Используй ТОЛЬКО данные из предоставленного контекста. Не выдумывай факты.';
  const userMsg   = `${meta.prompt}\n\nTrebovaniia: vernis\' tol\'ko JSON po skeme:\n${BLOCK_SCHEMA}\n\nDannye proekta (JSON):\n${serializeContext(ctx)}`;

  const text = await callLLM({
    system: systemMsg,
    user:   userMsg,
    timeoutMs: 20000,
    temperature: 0.25,
    maxTokens: 900,
  });
  const { ok, data } = parseLLMJsonResponse(text, p => typeof p?.summary === 'string');
  if (!ok) return null;
  return data;
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
// V18 P7 — извлечено в ai/llmClient.js#applyFilterPayload (см. import).
// Параметр resetReleaseOnUnassigned:true сохраняет легаси-поведение AIView
// (сброс f.release='' при isUnassigned).
function applyFilter(filterPayload) {
  return applyFilterPayload(filterPayload, { resetReleaseOnUnassigned: true });
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

  // If chat panel is open, send as message; otherwise open shared kpi modal.
  const input = document.getElementById('assistant-input');
  if (input && state.llm?.panelOpen) {
    input.value = `Объясни подробнее: ${block.title}`;
    input.dispatchEvent(new Event('input'));
    document.getElementById('assistant-btn-send')?.click();
    return;
  }
  // V18 P7 — inline `<pre style=...>` заменено на `.modal-pre` (styles.css).
  // Native `alert(lines)` fallback убран в пользу toast-нотификации.
  const modal = document.getElementById('modal-kpi');
  if (modal) {
    document.getElementById('modal-kpi-title').textContent = block.title;
    document.getElementById('modal-kpi-body').innerHTML =
      `<pre class="modal-pre">${lines.replace(/</g,'&lt;')}</pre>`;
    modal.classList.remove('hidden');
    return;
  }
  window.showToast?.(`${block.title}: см. подробности в чат-панели`, 'info');
}

/* ── main view object ───────────────────────────────────────── */
export const AIView = {
  _blocks: {},     // current block data keyed by blockId
  _root:   null,

  /** AUDIT_HOLISTIC §5.1 — построить human-readable sub для hero
   *  «Анализ для <id> за <period>». Identity-deterministic: если id email,
   *  отрезаем local-part для display. Не используется в LLM-prompt напрямую,
   *  только для отображения. */
  _buildFocusSub(focus) {
    if (!focus || !focus.id) return '';
    const id = String(focus.id);
    const display = (focus.kind === 'employee' && id.includes('@'))
      ? id.split('@')[0]
      : id;
    const periodMap = {
      '7d':  'за последнюю неделю',
      '14d': 'за последние две недели',
      '30d': 'за последний месяц',
      'q':   'за квартал',
      'all': 'за весь период',
    };
    const period = periodMap[focus.period] || '';
    return `Анализ для ${display}${period ? ' ' + period : ''}.`;
  },

  render() {
    const root = document.getElementById('section-ai');
    if (!root) return;
    this._root = root;
    // AUDIT_ARTDIRECTION #26 — runtime CSS (не трогаем styles.css).
    _ensureAiViewStyle();

    // V17 P8 (QA B-2) — respect global filters.
    const rows = FilterEngine.getFiltered();
    // AUDIT_HOLISTIC §5.1 — если активен focus-якорь, hero/header читает его
    // и показывает «Анализ для X за период Y». Если focus null — общий анализ.
    const focus = state?.meta?.focus || null;
    const focusSub = focus ? AIView._buildFocusSub(focus) : '';
    const headerHtml = renderPageHeader('ai', {
      sub: focusSub || 'Прогноз курса: «Если ничего не менять».',
    });
    // V21 audit 07-ai-analysis §16: дублирующий <div id="ai-root"> убран —
    // index.html уже содержит #ai-root внутри #section-ai, мы пишем содержимое
    // напрямую в #ai-root, не создавая второй элемент с тем же id.
    const inner = document.getElementById('ai-root') || root;
    if (!rows || !rows.length) {
      // В пустом state не пушим header в #ai-root: header — на уровне секции.
      root.querySelector('#section-ai-prizma-header')?.remove();
      const headerHost = document.createElement('div');
      headerHost.innerHTML = headerHtml;
      while (headerHost.firstChild && headerHost.firstChild !== inner) {
        root.insertBefore(headerHost.firstChild, inner);
      }
      inner.innerHTML = renderEmptyState();
      this._bindEmptyState(inner);
      return;
    }

    // AUDIT_HOLISTIC O6 — single AIPipeline orchestrator вместо прямого
    // runAllBlocks(). Возвращает map ту же что и раньше (renderPageShell
    // ожидает { health:..., forecast:..., ... } по ключам).
    this._blocks = _runAllRuleBased(rows);

    // Map to indexed obj for renderPageShell
    const blocksById = {};
    Object.values(this._blocks).forEach(b => { blocksById[b.id] = b; });

    // Insert/replace prizma-header перед #ai-root (один раз, идемпотентно).
    let headerHost = root.querySelector('#section-ai-prizma-header');
    if (!headerHost) {
      headerHost = document.createElement('div');
      headerHost.id = 'section-ai-prizma-header';
      root.insertBefore(headerHost, inner);
    }
    headerHost.innerHTML = headerHtml;
    inner.innerHTML = renderPageShell(blocksById);
    this._bindEvents(root);
    // AUDIT_ARTDIRECTION #20 — AI-frame на корне inner (.ai-page).
    applyAiFrame(inner, { source: 'rule-based' });
    syncAiOnlyMarkers(inner);
    // AUDIT_ARTDIRECTION #26 — persistence collapsed-state в localStorage.
    this._bindLibraryPersistence(inner);
  },

  // AUDIT_ARTDIRECTION #26 — persist открытых/закрытых details в localStorage.
  // Ключ `prizma.ai.expanded.<blockId>` ('1'|'0').
  _bindLibraryPersistence(host) {
    if (!host) return;
    const items = host.querySelectorAll('details.ai-library-item[data-block-id]');
    items.forEach(d => {
      d.addEventListener('toggle', () => {
        try {
          const id = d.dataset.blockId;
          if (!id) return;
          localStorage.setItem('prizma.ai.expanded.' + id, d.open ? '1' : '0');
        } catch (_) {}
      });
    });
  },

  // V21 audit 07-ai-analysis §25: empty-state CTA wiring.
  _bindEmptyState(host) {
    host.querySelector('[data-ai-empty-action="import-xlsx"]')?.addEventListener('click', () => {
      document.getElementById('btn-import-xlsx')?.click();
    });
    host.querySelector('[data-ai-empty-action="demo-template"]')?.addEventListener('click', () => {
      document.getElementById('ob-btn-back-demo')?.click();
    });
  },

  /* ── event delegation ────────────────────────────────────── */
  _bindEvents(root) {
    // V17 P8 (full-stack memleak + designer #5.1) — `addEventListener`
    // accumulated handlers on every render() since `#section-ai`
    // container is not recreated, only its innerHTML. Switching to
    // `onclick=` overwrite-pattern keeps exactly one handler at any time.
    root.onclick = async (e) => {
      // V21 audit 07-ai-analysis §14: использован closest(), иначе клик по
      // вложенному <span class="ai-btn-icon"><svg>…</svg></span> делал
      // e.target = <svg> и условие промахивалось.
      const refreshAllBtn = e.target.closest('#ai-refresh-all');
      if (refreshAllBtn) {
        refreshAllBtn.disabled = true;
        refreshAllBtn.innerHTML = inlinePulseLoader('Обновляем') + ' Обновляем…';
        const loader = showPageLoader('Сверяем курс по AI-аналитике…');
        try {
          await this._refreshAll();
          window.HistoryLog?.ai?.('refresh_all', 'AI Анализ: обновлены все блоки');
        }
        finally {
          loader?.close();
          refreshAllBtn.disabled = false;
          refreshAllBtn.textContent = 'Обновить всё';
          refreshAllBtn.dataset.icon = 'rotate-cw'; refreshAllBtn.dataset.iconSize = '14';
          Services.Icons?.hydrate?.(refreshAllBtn.parentElement);
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
        else Services.App?.goTo?.('registry');
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
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.innerHTML = inlinePulseLoader('Обновляем блок'); }
    blockEl.innerHTML = renderBlockLoading(blockId, meta.title).replace(/^<div[^>]*>|<\/div>$/, '');

    // Get fallback block
    let block = Object.values(this._blocks).find(b => b.id === blockId);
    if (!block) {
      // AUDIT_HOLISTIC O6 — через AIPipeline.
      const fresh = _runAllRuleBased(FilterEngine.getFiltered());
      this._blocks = { ...this._blocks, ...Object.fromEntries(Object.values(fresh).map(b=>[b.id,b])) };
      block = Object.values(this._blocks).find(b => b.id === blockId);
    }

    // AUDIT_ARTDIRECTION #20 — маскот в thinking на время LLM-запроса.
    setMascotState(this._root, 'thinking');

    // Try LLM enhancement
    const ctx       = buildAIContext(FilterEngine.getFiltered(), { blockId, maxRows:35 });
    const llmResult = await callBlockLLM(blockId, ctx);
    const enhanced  = applyLLMResult(block, llmResult);

    // Update stored block
    this._blocks[blockId] = enhanced;

    // Re-render this block
    blockEl.outerHTML = renderBlock(enhanced);

    // Re-bind events (new DOM)
    const newEl = document.getElementById(`ai-block-${blockId}`);
    if (newEl && triggerBtn) {
      const newBtn = newEl.querySelector(`[data-ai-action="refresh"][data-block-id="${blockId}"]`);
      if (newBtn) {
        newBtn.disabled = false; newBtn.textContent = 'Обновить AI-анализ';
        newBtn.dataset.icon = 'rotate-cw'; newBtn.dataset.iconSize = '14'; delete newBtn.dataset.iconHydrated; Services.Icons?.hydrate?.(newBtn.parentElement);
      }
    }
    if (!llmResult) {
      window.showToast?.('AI недоступен — показан rule-based анализ', 'info');
      setMascotState(this._root, 'idle');
    } else {
      // AUDIT_ARTDIRECTION #20 — insight-glow на обновлённой карточке + sync
      // ai-only stripes + mascot success → idle.
      if (newEl) triggerInsightGlow(newEl);
      const inner = document.getElementById('ai-root');
      if (inner) syncAiOnlyMarkers(inner);
      setMascotState(this._root, 'success');
      window.showToast?.(`AI-анализ обновлён: ${meta.title}`, 'success');
    }
  },

  /* ── refresh all blocks with LLM ────────────────────────── */
  async _refreshAll() {
    // AUDIT_HOLISTIC O6 — pipeline-driven rule-based refresh.
    // TODO(O6 follow-up): можно перевести этот цикл на AIPipeline.runAll
    //   ('analysis', ctx) с llmCaller=callBlockLLM, чтобы fallback+LLM merge
    //   делался прямо внутри pipeline'а. Пока оставлено raw для минимальной
    //   диффузии — `callBlockLLM` ниже использует тот же llmClient.
    const fresh = _runAllRuleBased(FilterEngine.getFiltered());
    Object.values(fresh).forEach(b => { this._blocks[b.id] = b; });

    // AUDIT_ARTDIRECTION #20 — маскот в thinking-state на весь refresh.
    setMascotState(this._root, 'thinking');

    const ctx = buildAIContext(FilterEngine.getFiltered(), { maxRows:40 });

    // V21 audit 07-ai-analysis §20: progressive parallel refresh.
    // Раньше sequential `for await` блокировал UI на 1.5–2 минуты при 13
    // блоках. Теперь — окна по 3 параллельных запроса (баланс между
    // нагрузкой на LLM-proxy и временем ожидания), результат каждого
    // блока рендерится сразу как готов (progressive-fill).
    const ids = Object.keys(BLOCK_META).filter(id => {
      const el = document.getElementById(`ai-block-${id}`);
      const block = Object.values(this._blocks).find(b => b.id === id);
      return el && block;
    });
    const CONCURRENCY = 3;
    const refreshOne = async (id) => {
      const blockEl = document.getElementById(`ai-block-${id}`);
      if (!blockEl) return;
      const block = Object.values(this._blocks).find(b => b.id === id);
      if (!block) return;
      try {
        const llmResult = await callBlockLLM(id, { ...ctx, blockId: id });
        const enhanced = applyLLMResult(block, llmResult);
        this._blocks[id] = enhanced;
        const liveEl = document.getElementById(`ai-block-${id}`);
        if (liveEl) liveEl.outerHTML = renderBlock(enhanced);
      } catch (_) { /* one failure shouldn't kill the whole refresh */ }
    };
    // Окна по CONCURRENCY: ждём завершения текущего окна перед стартом
    // следующего, чтобы LLM-proxy не получил все 13 за раз.
    // QA A13.1 — Promise.allSettled: даже если refreshOne синхронно throws
    // ДО внутреннего try (опечатка, ReferenceError), Promise.all отверг бы
    // окно и пропустил оставшиеся. allSettled гарантирует, что весь slice
    // завершится перед переходом к следующему.
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const slice = ids.slice(i, i + CONCURRENCY);
      await Promise.allSettled(slice.map(refreshOne));
    }

    // AUDIT_ARTDIRECTION #20 — после refreshAll: insight-glow на hero-блоке +
    // sync data-ai-only stripes + mascot success → idle.
    const inner = document.getElementById('ai-root');
    if (inner) {
      const hero = inner.querySelector('.ai-block-hero, .ai-layout-hero-prime .ai-block');
      if (hero) triggerInsightGlow(hero);
      syncAiOnlyMarkers(inner);
      // Re-bind library persistence after rerender (если refreshOne пере-рендерил
      // блок hero — details mounted заново).
      this._bindLibraryPersistence(inner);
    }
    setMascotState(this._root, 'success');

    window.showToast?.('AI-анализ обновлён', 'success');
  },
};
