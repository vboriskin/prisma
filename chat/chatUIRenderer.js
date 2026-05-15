'use strict';
/* ============================================================
   CHAT UI RENDERER — v10_0
   Converts structured response objects into HTML.

   Structured response shape:
   {
     text:      string,         // markdown text (always shown first)
     cards:     Card[],         // info cards
     actions:   Action[],       // clickable action buttons
     drilldown: DrillItem[],    // follow-up questions
     plan:      PlanItem[],     // action plan steps
     reviewMode:{ role, badge } // review mode indicator
   }

   Card    = { title, body, badge, badgeColor, icon }
   Action  = { label, type, payload, primary }
   DrillItem = { text, prompt }
   PlanItem  = { step, title, detail, done }
   ============================================================ */

import { Utils } from '../utils.js';
import { Icons } from '../app/icons.js';
import { applyDefaultLint } from './toneOfVoiceLint.js';

/* ── Helpers ─────────────────────────────────────────────── */

function esc(s) { return Utils.escapeHtml(String(s ?? '')); }

function badgeColor(color) {
  const map = {
    green: '#16a34a', red: '#dc2626', orange: '#ea580c',
    yellow: '#ca8a04', blue: '#2563eb', purple: '#7c3aed',
    gray: '#6b7280',
  };
  return map[color] || color || '#6b7280';
}

/* ── Cards ───────────────────────────────────────────────── */

function renderCard(card) {
  // V21 Wave-3 — карты теперь принимают `iconKey` (имя из Icons.get); legacy
  // `icon` (emoji-строка) больше не рендерится. Если iconKey не задан —
  // карточка без иконки (по брендбуку допустимо).
  const icon  = card.iconKey ? `<span class="chat-card-icon">${Icons.get(card.iconKey, { size: 14 })}</span>` : '';
  const badge = card.badge ? `<span class="chat-card-badge" style="background:${badgeColor(card.badgeColor)}">${esc(card.badge)}</span>` : '';
  return `<div class="chat-card">
    <div class="chat-card-header">${icon}<span class="chat-card-title">${esc(card.title)}</span>${badge}</div>
    <div class="chat-card-body">${esc(card.body)}</div>
  </div>`;
}

function renderCards(cards) {
  if (!Array.isArray(cards) || !cards.length) return '';
  return `<div class="chat-cards">${cards.map(renderCard).join('')}</div>`;
}

/* ── Action buttons ──────────────────────────────────────── */

function renderActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return '';
  const btns = actions.map(a => {
    const cls   = a.primary ? 'chat-action-btn chat-action-btn-primary' : 'chat-action-btn';
    const data  = esc(JSON.stringify(a.payload || {}));
    const atype = esc(a.type || 'generic');
    // L4 fix: для `send_prompt` префиксуем label явной пометкой «AI предлагает»
    // чтобы LLM не мог подменить лейбл на манипулятивный («Применить» вместо
    // «Спросить ещё раз»). Sub-pill не позволяет «спрятать» что это re-ask.
    const label = atype === 'send_prompt'
      ? `<span class="chat-action-prefix">↻ Спросить:</span> ${esc(a.label)}`
      : esc(a.label);
    return `<button class="${cls}" data-action-type="${atype}" data-action-payload='${data}'>${label}</button>`;
  });
  return `<div class="chat-actions">${btns.join('')}</div>`;
}

/* ── Plan ────────────────────────────────────────────────── */

function renderPlan(plan) {
  if (!Array.isArray(plan) || !plan.length) return '';
  const items = plan.map((p, i) => {
    const doneCls = p.done ? ' chat-plan-done' : '';
    const icon    = p.done ? '' : String(p.step ?? i + 1);
    return `<div class="chat-plan-item${doneCls}">
      <span class="chat-plan-num">${esc(icon)}</span>
      <div class="chat-plan-content">
        <div class="chat-plan-title">${esc(p.title)}</div>
        ${p.detail ? `<div class="chat-plan-detail">${esc(p.detail)}</div>` : ''}
      </div>
    </div>`;
  });
  return `<div class="chat-plan">${items.join('')}</div>`;
}

/* ── Drilldown prompts ───────────────────────────────────── */

function renderDrilldown(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const btns = items.map(item => {
    const prompt = esc(item.prompt || item.text || '');
    return `<button class="chat-drilldown-btn" data-prompt="${prompt}">${esc(item.text || item.prompt)}</button>`;
  });
  return `<div class="chat-drilldown"><span class="chat-drilldown-label">Уточнить:</span>${btns.join('')}</div>`;
}

/* ── Review mode badge ───────────────────────────────────── */

function renderReviewBadge(reviewMode) {
  if (!reviewMode) return '';
  const roleLabels = { ceo: 'CEO', dm: 'Delivery Manager', risk: 'Risk Officer', lead: 'Team Lead' };
  const label = roleLabels[reviewMode.role] || reviewMode.role;
  return `<div class="chat-review-badge">${Icons.get('eye', { size: 14 })} Режим: <strong>${esc(label)}</strong></div>`;
}

/* V17 P3 (CHAT-4) — category-badge без emoji + neutral pill. Earlier 7
   pastel backgrounds + emoji turned every answer into a «детский
   конструктор». Now a single 9px CAPS mono-style label. Audit 2026-05
   (art-director Quick win 4). */
const CATEGORY_LABELS = {
  search: 'поиск', explain: 'объяснение', action: 'действие', analysis: 'анализ',
  planning: 'план', report: 'отчёт', general: 'общее',
};
function renderCategoryBadge(category, label) {
  const text = label || CATEGORY_LABELS[category] || category;
  // V21 audit 08-chatbot §18: <div> → <span role="status"> + aria-label.
  // Скрин-ридер теперь читает «Категория ответа: <text>» вместо «<text>»
  // как отдельный неразмеченный div.
  return `<span class="chat-category-badge chat-category-${esc(category)}" role="status" aria-label="Категория ответа: ${esc(text)}">${esc(text)}</span>`;
}

/* ── Main render ─────────────────────────────────────────── */

/**
 * Render a complete structured response to HTML.
 * @param {object} resp - Structured response object
 * @param {number} idx  - Message index (for copy button)
 * @param {boolean} isStreaming
 * @param {number} [lastIdx] - Index of the last message in history. Используется
 *   для решения, нужно ли вешать `obs--ls-streaming` и спинной caption именно
 *   на это сообщение (medium-3.3, medium-5.2). Если не передан — fallback к
 *   `idx` (т.е. поведение «всегда последнее»).
 * @returns {string} HTML string
 */
export function renderStructuredResponse(resp, idx, isStreaming, lastIdx) {
  if (typeof lastIdx !== 'number') lastIdx = idx;
  const parts = [];

  if (resp.reviewMode) parts.push(renderReviewBadge(resp.reviewMode));

  // V22 C-03 (audit-experts-2026-05-15 Zhukova S0-3) — rule-based source
  // badge. Маркируем что ответ собран шаблоном по локальному state, а не
  // LLM-reasoning'ом. Источник: assistantMsg.responseSource === 'rule'
  // (выставляется в llmAssistant.js при onRuleBased callback'е).
  if (resp.responseSource === 'rule') {
    parts.push(`<span class="chat-source-badge chat-source-rule" role="status" aria-label="Ответ построен по правилу из локальных данных">по правилу</span>`);
  }

  // Intent category badge (e.g. "Поиск", "Объяснение", "План"…)
  if (resp.category && resp.categoryLabel) {
    parts.push(renderCategoryBadge(resp.category, resp.categoryLabel));
  }

  // Text (markdown)
  if (resp.text) {
    const mdHtml = renderMarkdownLite(resp.text);
    parts.push(`<div class="msg-text">${mdHtml}</div>`);
  }

  // Cards
  if (resp.cards?.length) parts.push(renderCards(resp.cards));

  // Plan
  if (resp.plan?.length) parts.push(renderPlan(resp.plan));

  // Actions
  if (resp.actions?.length) parts.push(renderActions(resp.actions));

  // Drilldown
  if (resp.drilldown?.length) parts.push(renderDrilldown(resp.drilldown));

  const streamingCls = isStreaming ? ' assistant-msg-streaming' : '';
  // V21 audit 08-chatbot §1: ⧉ → Icons.copy SVG.
  const copyBtn = !isStreaming
    ? `<button class="msg-copy-btn" title="Копировать" aria-label="Копировать ответ" data-index="${idx}">${Icons.get('copy', { size: 12 })}</button>`
    : '';

  // design-01 A — per-message mascot avatar (32×32 → визуально 28).
  // Класс obs--sm включает усиленную physics для small (mM6 fix).
  // medium-3.3 — раньше при streaming ВСЕ ассистент-сообщения получали
  // ls-streaming → 10+ маскотов одновременно «думали» (CPU + cognitive load).
  // Теперь ls-streaming только на ПОСЛЕДНЕМ сообщении, остальные дышат.
  const phaseClass = (isStreaming && idx === lastIdx) ? 'obs--ls-streaming' : 'obs--breathe';
  const avatar = `<span class="msg-avatar obs obs--sm ${phaseClass}" aria-hidden="true">
    <svg viewBox="-60 -60 120 120"><use href="#obs-base"/></svg>
  </span>`;

  // design-01 B — мигающая каретка в конце streaming-bubble.
  const caret = isStreaming ? '<span class="msg-caret" aria-hidden="true"></span>' : '';

  // design-01 C / design-02 M6 — caps-eyebrow «PRIZMA · …» под bubble.
  // medium-5.2 — caption повторялся под каждым assistant-bubble (5+ одинаковых
  // «PRIZMA · СВЕРЯЕТ КУРС» в треде = визуальный шум). Теперь только под
  // ПОСЛЕДНИМ ассистент-сообщением.
  const caption = _categoryToCaption(resp.category);
  const captionHtml = (!isStreaming && caption && idx === lastIdx)
    ? `<div class="msg-spine-caption">${esc(caption)}</div>` : '';

  return `<div class="msg-row msg-row-assistant" data-index="${idx}">
    ${avatar}
    <div class="msg-bubble-wrap">
      <div class="assistant-msg assistant-msg-assistant${streamingCls}" data-index="${idx}">
        <div class="msg-body">${parts.join('')}${caret}</div>${copyBtn}
      </div>
      ${captionHtml}
    </div>
  </div>`;
}

// design-01 C — категория prompt'а → caps-caption под bubble.
// medium-5.1 — раньше default возвращал null, и для unknown-category caption
// не показывался → визуальный glitch. Теперь fallback на «PRIZMA · ОТВЕЧАЕТ»,
// чтобы любой ответ имел spine-caption (consistency со §13.7 Spine-pill).
function _categoryToCaption(category) {
  switch (category) {
    case 'search':   return 'PRIZMA · ИЩЕТ КУРС';
    case 'explain':  return 'PRIZMA · ОБЪЯСНЯЕТ';
    case 'action':   return 'PRIZMA · ПОДТВЕРЖДАЕТ';
    case 'analysis': return 'PRIZMA · АНАЛИЗИРУЕТ';
    case 'planning': return 'PRIZMA · СВЕРЯЕТ КУРС';
    case 'report':   return 'PRIZMA · ОТЧЁТ';
    case 'general':  return 'PRIZMA · СВЕРЯЕТ КУРС';
    default:         return 'PRIZMA · ОТВЕЧАЕТ';
  }
}

/**
 * Render a user message.
 */
// design-01 G — кружок-инициалы справа от user-bubble. Источник инициалов:
// state.currentUser → state.employees lookup → fallback "Я".
function _userInitials() {
  try {
    const cu = window.state?.currentUser || {};
    const fio = String(cu.fio || cu.name || '').trim();
    if (fio) {
      const parts = fio.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return fio.slice(0, 2).toUpperCase();
    }
  } catch (_) {}
  return 'Я';
}
export function renderUserMessage(msg, idx) {
  const initials = esc(_userInitials());
  return `<div class="msg-row msg-row-user" data-index="${idx}">
    <div class="assistant-msg assistant-msg-user">${esc(msg.content)}</div>
    <span class="msg-initials" aria-hidden="true">${initials}</span>
  </div>`;
}

/**
 * Render a thinking/loading indicator.
 */
// C6 fix (chat-03 audit §11 signal feedback) — long-thinking hint после 15s.
// Без этого пользователь не понимал, ждать или бросать.
export function renderThinking(idx) {
  // V22 C-02 (audit-experts-2026-05-15 Zhukova S0-2) — раньше единственным
  // индикатором был «дышащий» маскот, а 3 точки .msg-thinking были скрыты
  // через display:none. На медленной сети (4-8 сек до первого токена)
  // пользователь воспринимал чат как «зависший». Теперь:
  //   · 3 точки видимы сразу (clear «работает» signal);
  //   · маскот идёт ls-thinking phase (он живёт в фоне как brand-signal);
  //   · long-hint показывается через 5-7 сек, а не 15 (психологически
  //     к 5-й секунде уже пора объяснить что происходит — см. также
  //     timer в app/llmAssistant.js).
  return `<div class="msg-row msg-row-assistant" data-index="${idx}" data-thinking-since="${Date.now()}">
    <span class="msg-avatar obs obs--sm obs--ls-thinking" aria-hidden="true">
      <svg viewBox="-60 -60 120 120"><use href="#obs-base"/></svg>
    </span>
    <div class="msg-bubble-wrap">
      <div class="assistant-msg assistant-msg-assistant assistant-msg-streaming">
        <div class="msg-body">
          <span class="msg-thinking" aria-label="Запрос обрабатывается" role="status"><span></span><span></span><span></span></span>
          <span class="msg-thinking-longhint" hidden>Запрос длится дольше обычного — модель может быть перегружена. Можно нажать «Стоп» и повторить.</span>
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * Render an error message.
 */
// C7 fix (chat-03 audit §11 off-course palette) — error-bubble визуально
// отличим: stripe-left + alert-triangle icon. Раньше был неотличим от
// обычного assistant-bubble.
export function renderError(msg, idx, showRetry) {
  const retryBtn = showRetry ? `<br><button class="msg-retry-btn" data-retry="1">${Icons.get('rotate-cw', { size: 12 })} Повторить запрос</button>` : '';
  const errIcon = Icons.get('alert-triangle', { size: 14 });
  // IxD-3 — initial state = breathe; setMessageAvatarPhase('error') играет
  // ls-error 2400ms → breathe → потом стакает concerned+alive (см.
  // obsidianMascot.js setChatPhase case 'error'). Раньше тут был сразу
  // финальный кадр Concerned без переходной фазы «надлома потока».
  return `<div class="msg-row msg-row-assistant" data-index="${idx}">
    <span class="msg-avatar obs obs--sm obs--breathe" aria-hidden="true">
      <svg viewBox="-60 -60 120 120"><use href="#obs-base"/></svg>
    </span>
    <div class="msg-bubble-wrap">
      <div class="assistant-msg assistant-msg-assistant assistant-msg-error">
        <div class="msg-body"><span class="msg-error-icon" aria-hidden="true">${errIcon}</span>${renderMarkdownLite(msg.content || '')}${retryBtn}</div>
      </div>
    </div>
  </div>`;
}

/**
 * Parse a structured response JSON block from LLM output.
 * LLM is asked to append: ```json { cards, actions, drilldown, plan } ```
 * @param {string} raw - Full LLM text
 * @returns {{ text: string, cards: [], actions: [], drilldown: [], plan: [] }}
 */
// V21 BH (audit-04 §G #5) — schema-validated structured response.
// LLM может вернуть string вместо array (например `"actions": "go to gantt"`)
// — раньше UI падал. Теперь strict-validate: ожидаем array на каждом из
// `cards/actions/drilldown/plan`. Невалидное поле — silent drop, остальные
// сохраняются. Item-level — каждая карточка должна быть object с обязательными
// полями, иначе фильтруется.
// F12 fix (chat-04 audit) — whitelist синхронизирован с executeAction
// в chatActions.js. Раньше тут был 'preview' без обработчика — LLM мог
// вернуть type:"preview", validate его пропускал, executeAction делал
// silent ignore. Сейчас оставляем только реально обрабатываемые типы;
// неизвестное → 'show' (no-op chip).
const _VALID_ACTION_TYPES = new Set([
  'navigate', 'apply_filter', 'clear_filters', 'preview_release',
  'send_prompt', 'set_review_mode', 'copy_text', 'export_summary',
  'confirm_batch', 'cancel_batch', 'take_snapshot', 'open_settings',
  // V22 X-02 / K-03 (audit-experts-2026-05-15 Selvadurai #2) — set_focus
  // делает чат meta-навигатором: action-chip может открыть Сканнер на
  // сотруднике, Гант на эпике, фильтр на команде/релизе. Подписчики
  // focus-changed (Сканнер, Гант, Реестр, Employees) сами реагируют.
  'set_focus',
  'show',
]);
function _isPlainObject(x) { return x != null && typeof x === 'object' && !Array.isArray(x); }
function _validateCards(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(c => _isPlainObject(c) && typeof c.title === 'string')
    .map(c => ({ title: String(c.title), value: c.value, hint: typeof c.hint === 'string' ? c.hint : '', confidence: c.confidence }));
}
function _validateActions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(a => _isPlainObject(a) && typeof a.label === 'string')
    .map(a => ({ label: String(a.label), type: _VALID_ACTION_TYPES.has(a.type) ? a.type : 'show', payload: _isPlainObject(a.payload) ? a.payload : {} }));
}
function _validateDrilldown(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(d => _isPlainObject(d) && typeof d.text === 'string');
}
function _validatePlan(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(p => _isPlainObject(p) || typeof p === 'string')
    .map(p => typeof p === 'string' ? { step: p } : p);
}

export function parseStructuredFromLLM(raw) {
  const result = { text: raw, cards: [], actions: [], drilldown: [], plan: [], _validationErrors: [] };
  if (!raw) return result;
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```\s*$/);
  if (!jsonMatch) {
    // AU5 (AUDIT_HOLISTIC) — tone-of-voice middleware. Pass даже когда
    // JSON-блока нет: ответ может быть plain markdown, и его всё равно
    // нужно лентить.
    result.text = _applyToneOfVoiceLint(result.text);
    return result;
  }
  try {
    const parsed = JSON.parse(jsonMatch[1]);
    result.text = raw.replace(/```json[\s\S]*?```\s*$/, '').trim();
    if (!_isPlainObject(parsed)) {
      result._validationErrors.push('top-level JSON not an object');
      return result;
    }
    // Валидация per-field. Невалидные поля логируются.
    if ('cards'     in parsed) {
      const v = _validateCards(parsed.cards);
      if (v.length !== (Array.isArray(parsed.cards) ? parsed.cards.length : 0)) result._validationErrors.push('cards filtered');
      result.cards = v;
    }
    if ('actions'   in parsed) {
      const v = _validateActions(parsed.actions);
      if (v.length !== (Array.isArray(parsed.actions) ? parsed.actions.length : 0)) result._validationErrors.push('actions filtered');
      result.actions = v;
    }
    if ('drilldown' in parsed) result.drilldown = _validateDrilldown(parsed.drilldown);
    if ('plan'      in parsed) result.plan      = _validatePlan(parsed.plan);
  } catch (e) {
    // leave text as raw, drop json attempt
    result.text = raw.replace(/```json[\s\S]*?```\s*$/, '').trim() || raw;
    result._validationErrors.push('JSON parse error: ' + (e?.message || ''));
  }
  // AU5 (AUDIT_HOLISTIC AU5) — tone-of-voice lint pass.
  // Применяется ПОСЛЕ split'а JSON-блока, чтобы не задеть payload.
  result.text = _applyToneOfVoiceLint(result.text);
  return result;
}

/* AU5 (AUDIT_HOLISTIC) — tone-of-voice lint middleware.
   Default mode `warn-only` — текст не меняется, только лог в console.debug.
   Mode `on` — strip эмодзи (R1). Mode `off` — no-op.
   Переключается через `localStorage['prizma.llm.lint']`.
   Warnings агрегируются по правилу для лаконичного лога.

   TODO: ai/aiCeoRenderer.js, ai/aiRenderer.js — те же middleware-точки;
   импортировать `applyDefaultLint` из `chat/toneOfVoiceLint.js` и
   применять перед DOM-вставкой final text. */
function _applyToneOfVoiceLint(text) {
  if (!text || typeof text !== 'string') return text;
  try {
    const { text: outText, warnings, mode } = applyDefaultLint(text);
    if (warnings && warnings.length) {
      // Группируем по rule: { R1: 3, R2: 1, ... } — лаконично для console.
      const grouped = warnings.reduce((acc, w) => { acc[w.rule] = (acc[w.rule] || 0) + 1; return acc; }, {});
      // Telemetry hook (если уже подключена в проекте — V19 E4 logger.event).
      // Используем typeof guard, чтобы модуль работал в node-test (нет window).
      if (typeof window !== 'undefined' && window.Telem && typeof window.Telem.track === 'function') {
        try { window.Telem.track('llm.tov_violation', { mode, grouped, total: warnings.length }); } catch (_) {}
      }
      // Дублируем в console.debug для разработки. Не console.warn — это не баг,
      // а сигнал для копирайтера / промпт-инженера.
      if (typeof console !== 'undefined' && console.debug) {
        try { console.debug('[tov-lint]', mode, grouped, warnings.slice(0, 5)); } catch (_) {}
      }
    }
    return outText;
  } catch (_) {
    // Любая ошибка lint'а не должна ломать рендер.
    return text;
  }
}

/* ── Inline markdown renderer (copy from app.js, self-contained) ─ */

// V21 BN (audit-04 §G #15) — Hallucination guard.
// Post-render walk через .cite-pill chips: проверяем что упомянутый
// epic-id (PROJ-123) реально есть в state.rows. Несуществующий →
// добавляем класс cite-pill-invalid + tooltip с warning'ом.
//
// Side-effect: ставит data-validated="1" чтобы повторный render не
// удалял предыдущий validation.
function _validateCitationsInHtml(html) {
  if (typeof window === 'undefined' || !window.state?.rows) return html;
  const validKeys = new Set();
  for (const r of (window.state.rows || [])) {
    if (r.tasks) {
      // tasks может быть строка с pipe-separated ID'шников ("PROJ-1|PROJ-2").
      String(r.tasks).split(/[|,;\s]+/).forEach(k => {
        if (/^[A-Z]{2,6}-\d{1,6}$/.test(k)) validKeys.add(k);
      });
    }
    if (r.epic && /^[A-Z]{2,6}-\d{1,6}$/.test(r.epic)) validKeys.add(r.epic);
  }
  if (!validKeys.size) return html;   // нечем проверять
  return html.replace(
    /<span class="cite-pill" data-cite="([A-Z]{2,6}-\d{1,6})">([A-Z]{2,6}-\d{1,6})<\/span>/g,
    (full, key) => {
      if (validKeys.has(key)) return full;
      // V22 C-07 (audit-experts-2026-05-15 Zhukova S1-7) — title переписан
      // на язык PM-а: «галлюцинация модели» — технический термин. Теперь
      // конкретное действие: «проверьте ключ задачи».
      return `<span class="cite-pill cite-pill-invalid" data-cite="${key}" title="Задача ${key} не найдена в реестре — проверьте ключ или обновите данные">${key}<span class="cite-pill-warning"> ${Icons.get('alert-triangle',{size:10})}</span></span>`;
    },
  );
}

function renderMarkdownLite(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  function applyInline(s) {
    return s
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      // V17 P3 (CHAT-5) — inline-citations v0. Recognises Jira-style
      // task IDs (BIK-1234, WT-42, ABC-2025) and wraps them in mono
      // `cite-pill` chips so the answer visually rhymes with the
      // Spine-pill app language. Hover-to-locate pin can be added in
      // a follow-up. Audit 2026-05 (art-director Quick win 6).
      .replace(/\b([A-Z]{2,6}-\d{1,6})\b/g,
        '<span class="cite-pill" data-cite="$1">$1</span>');
  }
  function processSegment(seg) {
    const lines = Utils.escapeHtml(seg).split('\n');
    const out = []; let inUl = false, inOl = false;
    const closeList = () => {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // V21 BL (audit-04 §G #12) — markdown tables (GFM-style).
      // | a | b |        ← header
      // |---|---|        ← separator line
      // | 1 | 2 |        ← rows
      if (/^\s*\|.*\|\s*$/.test(line) &&
          i + 1 < lines.length &&
          /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeList();
        const headerCells = line.trim().slice(1, -1).split('|').map(c => c.trim());
        const sepCells = lines[i + 1].trim().slice(1, -1).split('|').map(c => c.trim());
        const aligns = sepCells.map(s => {
          if (/^:.*:$/.test(s)) return 'center';
          if (/:$/.test(s))     return 'right';
          if (/^:/.test(s))     return 'left';
          return null;
        });
        const rows = [];
        let j = i + 2;
        while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
          rows.push(lines[j].trim().slice(1, -1).split('|').map(c => c.trim()));
          j++;
        }
        const renderRow = (cells, isHeader) => {
          const tag = isHeader ? 'th' : 'td';
          return '<tr>' + cells.map((c, k) => {
            const a = aligns[k] ? ` style="text-align:${aligns[k]}"` : '';
            return `<${tag}${a}>${applyInline(c)}</${tag}>`;
          }).join('') + '</tr>';
        };
        // C12 fix (chat-03 audit §15 mobile) — широкая таблица растягивала
        // bubble и ломала 92% max-width. Оборачиваем в overflow-wrapper.
        out.push(`<div class="md-table-wrap"><table class="md-table"><thead>${renderRow(headerCells, true)}</thead><tbody>${rows.map(r => renderRow(r, false)).join('')}</tbody></table></div>`);
        i = j;
        continue;
      }
      if (/^###\s/.test(line))      { closeList(); out.push(`<h4 class="md-h">${applyInline(line.replace(/^###\s+/,''))}</h4>`); }
      else if (/^##\s/.test(line))  { closeList(); out.push(`<h3 class="md-h">${applyInline(line.replace(/^##\s+/,''))}</h3>`); }
      else if (/^#\s/.test(line))   { closeList(); out.push(`<h3 class="md-h">${applyInline(line.replace(/^#\s+/,''))}</h3>`); }
      else if (/^\s*[-*]\s/.test(line)) { if (!inUl) { closeList(); out.push('<ul>'); inUl = true; } out.push(`<li>${applyInline(line.replace(/^\s*[-*]\s+/,''))}</li>`); }
      else if (/^\s*\d+[.)]\s/.test(line)) { if (!inOl) { closeList(); out.push('<ol>'); inOl = true; } out.push(`<li>${applyInline(line.replace(/^\s*\d+[.)]\s+/,''))}</li>`); }
      else if (line.trim() === '') { closeList(); if (out.length && out[out.length-1] !== '<br>') out.push('<br>'); }
      else { closeList(); out.push(applyInline(line) + '<br>'); }
      i++;
    }
    closeList();
    return out.join('');
  }
  const segments = text.split(/(```[\w]*\n?[\s\S]*?```)/g);
  const parts = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 1) {
      const code = segments[i].replace(/^```[\w]*\n?/,'').replace(/```$/,'').trimEnd();
      parts.push(`<pre><code>${Utils.escapeHtml(code)}</code></pre>`);
    } else {
      parts.push(processSegment(segments[i]));
    }
  }
  let result = parts.join('');
  result = result.replace(/(<br>){3,}/g, '<br><br>').replace(/^<br>+/,'').replace(/<br>+$/,'');
  // V21 BN — pass-through cite-pill validation.
  result = _validateCitationsInHtml(result);
  return result;
}
