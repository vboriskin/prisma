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
// AUDIT_HOLISTIC O6 — TODO: мигрировать на AIPipeline.runAll('ceo', ctx),
//   аналогично тому как это сделано в `views/aiView.js`. Сейчас идёт через
//   thin wrapper `aiCeoFallback.js` → `UnifiedFallbackEngine.runAllCeoBlocks`.
//   Логика fallback'а уже унифицирована, остался только bootstrap registry.
import { runAllCeoBlocks }     from '../ai/aiCeoFallback.js';
import {
  renderCeoPage, renderCeoEmpty, renderCeoLoading,
  renderPreviewModal, renderExplainPanel,
} from '../ai/aiCeoRenderer.js';
// V18 P7 (audit-2026-05-04 §7) — общий LLM-клиент / парсер / applyFilter
// извлечён в ai/llmClient.js, чтобы не дублировать с aiView.
import { callLLM, parseLLMJsonResponse, applyFilterPayload } from '../ai/llmClient.js';
import { renderPageHeader, showPageLoader, inlinePulseLoader } from '../app/prizmaUI.js';
// AUDIT_ARTDIRECTION #20 — AI-frame primitive (insight-glow + mascot state +
// AI-only stripe). См. app/aiFramePrimitive.js.
import { applyAiFrame, triggerInsightGlow, setMascotState, syncAiOnlyMarkers } from '../app/aiFramePrimitive.js';
import { Services } from '../app/services.js';

/* AUDIT_ARTDIRECTION #20 — runtime CSS для AI CEO (не трогаем styles.css).
   Дополняет AI-frame primitive стилем для card data-source="ai" + hero
   data-source-визуальной разметкой. */
function _ensureAiCeoStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('audit-art-aiCeo-style')) return;
  const style = document.createElement('style');
  style.id = 'audit-art-aiCeo-style';
  style.textContent = `
    /* AI-frame на ceo-root — отступ под hero чтобы insight-glow не обрезался. */
    #ceo-root.prizma-ai-frame { padding-top: 4px; }
    /* AI-only stripe для ceo-card / ceo-hero (override default border). */
    #ceo-root [data-source="ai"] {
      border-left: 3px solid var(--prizma-insight, #B084CC);
    }
    body.theme-light #ceo-root [data-source="ai"] {
      border-left-color: var(--prizma-insight, #6B4488);
    }
  `;
  document.head.appendChild(style);
}

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

/* ── validate LLM CEO response shape ─────────────────────── */
// V21 audit 05-ai-ceo §8: schema validation — LLM иногда возвращает
// actionFeed без severity или ifNothingChanges без firstToBreak.
// При провале → возвращаем null → fallback остаётся.
const VALID_SEV = new Set(['critical','warning','info','ok']);
function validateCeoSchema(p) {
  if (!p || typeof p !== 'object') return false;
  if (!p.health || typeof p.health.score !== 'number') return false;
  if (p.health.score < 0 || p.health.score > 100) return false;
  if (p.ifNothingChanges) {
    const inc = p.ifNothingChanges;
    if (inc.projectedDays !== undefined && (typeof inc.projectedDays !== 'number' || inc.projectedDays <= 0)) return false;
    // Normalize missing arrays
    inc.firstToBreak    = Array.isArray(inc.firstToBreak)    ? inc.firstToBreak    : [];
    inc.affectedReleases = Array.isArray(inc.affectedReleases) ? inc.affectedReleases : [];
    inc.consequences    = Array.isArray(inc.consequences)    ? inc.consequences    : [];
  }
  if (p.hardTruths) {
    p.hardTruths.hardTruths  = Array.isArray(p.hardTruths.hardTruths)  ? p.hardTruths.hardTruths  : [];
    p.hardTruths.suspicious  = Array.isArray(p.hardTruths.suspicious)  ? p.hardTruths.suspicious  : [];
    p.hardTruths.weakSignals = Array.isArray(p.hardTruths.weakSignals) ? p.hardTruths.weakSignals : [];
  }
  if (Array.isArray(p.actionFeed)) {
    p.actionFeed = p.actionFeed.map(item => ({
      ...item,
      severity:     VALID_SEV.has(item.severity)          ? item.severity     : 'info',
      affectedCount: typeof item.affectedCount === 'number' ? item.affectedCount : 0,
    }));
  }
  return true;
}

/* ── LLM call (non-streaming, expects JSON) ───────────────── */
async function callCeoLLM(contextStr) {
  if (!Services.LLMAssistant?.getSettings?.()) return null;

  const userMsg = `Ты CEO-советник. Проанализируй данные и верни JSON строго по схеме:\n${CEO_SCHEMA}\n\nДанные проекта:\n${contextStr}`;

  const text = await callLLM({
    system: LLM_SYSTEM,
    user:   userMsg,
    timeoutMs:  25000,
    temperature: 0.2,
    maxTokens:  1800,
  });
  const { ok, data } = parseLLMJsonResponse(text, p => p?.health && typeof p.health.score === 'number');
  if (!ok) return null;
  // V21 audit 05-ai-ceo §8: reject structurally invalid LLM output
  if (!validateCeoSchema(data)) return null;
  return data;
}

/* ── merge LLM into fallback data ─────────────────────────── */
function mergeLLMData(fallback, llm) {
  if (!llm) return fallback;

  // AUDIT_ARTDIRECTION #20 — поле `source` помечает блок как AI-driven.
  // Renderer вешает data-source="ai" → AI-frame primitive стрипит карточку
  // 3px insight-цветом. Если LLM не вернул блок — оставляем 'rule-based'
  // из fallback'а (source уже задан там).
  const merge = (fb, lv) => lv && typeof lv === 'object' && Object.keys(lv).length
    ? { ...fb, ...lv, aiEnhanced: true, source: 'ai' } : fb;

  return {
    ...fallback,
    health:           merge(fallback.health, llm.health),
    ifNothingChanges: merge(fallback.ifNothingChanges, llm.ifNothingChanges),
    hardTruths:       merge(fallback.hardTruths, llm.hardTruths),
    actionFeed:       Array.isArray(llm.actionFeed) && llm.actionFeed.length
                        ? llm.actionFeed : fallback.actionFeed,
    saveRelease:      fallback.saveRelease,  // saveRelease остаётся rule-based
    aiEnhanced: true,
  };
}

/* ── navigate + apply filter ──────────────────────────────── */
// V18 P7 — извлечено в ai/llmClient.js#applyFilterPayload (см. import).
// CEO-версия исторически переходила на 'registry' даже при пустом payload —
// это поведение восстанавливается через navigateOnEmpty:true.
function applyFilterAndGoTo(filterPayload) {
  return applyFilterPayload(filterPayload, { navigateOnEmpty: true });
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
  document.getElementById('ceo-explain-modal')?.remove();
  const html = renderExplainPanel(section, data);
  document.body.insertAdjacentHTML('beforeend', html);
  attachModalClose(document.getElementById('ceo-explain-modal'));

  const chatBtn = document.getElementById('ceo-expl-chat-btn');
  if (chatBtn && prompt) {
    chatBtn.onclick = () => {
      document.getElementById('ceo-explain-modal')?.remove();
      openChatWithMessage(prompt);
    };
  }
}

/* ── modal close helper (V21 audit 05-ai-ceo §15: deduplicated) ─── */
// V21 audit 05-ai-ceo §15: единая функция вместо двух копий.
// Поддерживает Esc — раньше закрытие было только кликом.
function attachModalClose(modal) {
  if (!modal) return () => {};
  const close = () => modal.remove();
  modal.querySelector('#ceo-modal-close')?.addEventListener('click', close);
  modal.querySelector('#ceo-modal-cancel')?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  const onEsc = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
  return close;
}

function showPreviewModal(scenarioLabel, changesRaw) {
  let changes = [];
  try { changes = typeof changesRaw === 'string' ? JSON.parse(changesRaw) : changesRaw; } catch(_) {}

  document.getElementById('ceo-preview-modal')?.remove();

  const html = renderPreviewModal(scenarioLabel, changes);
  document.body.insertAdjacentHTML('beforeend', html);

  const modal = document.getElementById('ceo-preview-modal');
  const close = attachModalClose(modal);

  const confirmBtn = modal?.querySelector('#ceo-modal-confirm');
  if (confirmBtn) {
    // V21 audit 05-ai-ceo §11: кнопка переименована — честный deeplink в Action Layer
    // (раньше называлась «Применить изменения» — вводила в заблуждение).
    confirmBtn.textContent = 'Перейти к Action Layer';
    confirmBtn.addEventListener('click', () => {
      window.showToast?.('Предпросмотр закрыт — переходим к Action Layer для детального ревью', 'info');
      close();
      Services.App?.goTo?.('actions');
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
    // AUDIT_ARTDIRECTION #20 — runtime CSS (не трогаем styles.css).
    _ensureAiCeoStyle();

    const headerHtml = renderPageHeader('ai-ceo', {
      sub: 'Управленческий нарратив: где команда сейчас и что важно знать.',
    });
    // V17 P8 (QA B-2) — respect global filters.
    const rows = FilterEngine.getFiltered();
    if (!rows || !rows.length) {
      root.innerHTML = `${headerHtml}<div id="ceo-root" class="view-root">${renderCeoEmpty()}</div>`;
      return;
    }

    // Rule-based fallback (instant)
    this._data = runAllCeoBlocks(rows);
    if (!this._data) {
      root.innerHTML = `${headerHtml}<div id="ceo-root" class="view-root">${renderCeoEmpty()}</div>`;
      return;
    }

    root.innerHTML = `${headerHtml}<div id="ceo-root" class="view-root">${renderCeoPage(this._data)}</div>`;
    this._bindEvents(root);
    // AUDIT_ARTDIRECTION #20 — AI-frame: маркируем page как AI-area,
    // синхронизируем data-ai-only stripes на cards с data-source="ai".
    const ceoRoot = root.querySelector('#ceo-root');
    if (ceoRoot) {
      applyAiFrame(ceoRoot, { source: this._data?.aiEnhanced ? 'ai' : 'rule-based' });
      syncAiOnlyMarkers(ceoRoot);
    }
  },

  /* ── event delegation ──────────────────────────────────── */
  _bindEvents(root) {
    // V17 P8 (full-stack memleak) — `onclick=` overwrite-pattern.
    // V21 audit 05-ai-ceo §16: handler вешается на #ceo-page (внутренний
    // рендер-root), а не на #section-ai-ceo (section-контейнер), чтобы не
    // конфликтовать со scroll/nav обвязкой секции.
    const page = root.querySelector('#ceo-page') || root;
    page.onclick = async e => {
      // AI refresh button
      if (e.target.id === 'ceo-refresh-btn' || e.target.closest('#ceo-refresh-btn')) {
        const btn = e.target.closest('#ceo-refresh-btn') || e.target;
        btn.disabled = true;
        btn.innerHTML = inlinePulseLoader('Обновляем CEO-сводку');
        const loader = showPageLoader('Сверяем курс по CEO-сводке…');
        try {
          await this._refreshWithLLM();
          window.HistoryLog?.ai?.('refresh_ceo', 'AI CEO: обновлена сводка');
        }
        finally {
          loader?.close();
          btn.disabled = false;
          // V21 P11.12 — восстанавливаем иконку rotate-cw + label «AI»
          // (см. renderCeoHero — рендерится через Icons.get('rotate-cw');
          // имя `refresh-cw` отсутствует в registry, синоним rotate-cw).
          btn.innerHTML = `${Services.Icons?.get?.('rotate-cw', { size: 14 }) || ''}<span class="aiceo-refresh-label">AI</span>`;
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

    // V21 audit 05-ai-ceo §6: пометить карточки как «обновляются»,
    // чтобы пользователь видел что данные скоро изменятся.
    const cards = root.querySelectorAll('.ceo-card, .ceo-hero');
    cards.forEach(c => { c.classList.add('aiceo-refreshing'); c.setAttribute('aria-busy', 'true'); });

    // AUDIT_ARTDIRECTION #20 — переключаем маскота в thinking-state на время
    // AI-запроса (визуальный сигнал «второй мозг думает»).
    setMascotState(root, 'thinking');

    try {
      const ctxStr    = buildCeoContext(this._data);
      const llmResult = await callCeoLLM(ctxStr);

      if (!llmResult) {
        // V21 audit 05-ai-ceo §7: показываем fallback-статус в hero
        this._markAIStatus(root, false);
        window.showToast?.('AI недоступен — показан rule-based анализ', 'info');
        // AI-frame: вернуть маскота в idle (без success — данные не обновились).
        setMascotState(root, 'idle');
        return;
      }

      this._data = mergeLLMData(this._data, llmResult);
      root.innerHTML = renderCeoPage(this._data);
      // V21 audit 05-ai-ceo §7: показываем AI-статус
      this._markAIStatus(root, true);
      this._bindEvents(this._root);
      // AUDIT_ARTDIRECTION #20 — после успешного AI-merge:
      //   1) insight-glow на hero (одноразовый 800ms pulse).
      //   2) sync data-ai-only stripes на новых cards.
      //   3) маскот в success → idle через 1.5s.
      const heroEl = root.querySelector('#ceo-hero');
      if (heroEl) triggerInsightGlow(heroEl);
      syncAiOnlyMarkers(root);
      setMascotState(root, 'success');
      window.showToast?.('AI CEO обновлён', 'success');
    } catch(e) {
      this._markAIStatus(root, false);
      window.showToast?.('AI дрейфует — показан rule-based анализ', 'info');
      setMascotState(root, 'idle');
    } finally {
      // Снять skeleton-состояние (если рендер не перезаписал)
      root.querySelectorAll('.aiceo-refreshing').forEach(c => {
        c.classList.remove('aiceo-refreshing');
        c.removeAttribute('aria-busy');
      });
    }
  },

  /* ── show AI/fallback status chip in hero ──────────────── */
  // V21 audit 05-ai-ceo §7: чип показывает откуда данные — AI или rule-based.
  _markAIStatus(root, isAI) {
    const hero = root.querySelector('#ceo-hero');
    if (!hero) return;
    hero.querySelector('.ceo-ai-status-chip')?.remove();
    const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const chip = document.createElement('div');
    chip.className = `ceo-ai-status-chip ${isAI ? 'ceo-ai-chip-enhanced' : 'ceo-ai-chip-fallback'}`;
    chip.textContent = isAI ? `AI · ${now}` : `Rule-based · AI недоступен`;
    const heroRight = hero.querySelector('.ceo-hero-right');
    heroRight ? heroRight.prepend(chip) : hero.append(chip);
  },
};
