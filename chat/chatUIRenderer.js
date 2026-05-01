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
  const icon  = card.icon  ? `<span class="chat-card-icon">${esc(card.icon)}</span>` : '';
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
    return `<button class="${cls}" data-action-type="${atype}" data-action-payload='${data}'>${esc(a.label)}</button>`;
  });
  return `<div class="chat-actions">${btns.join('')}</div>`;
}

/* ── Plan ────────────────────────────────────────────────── */

function renderPlan(plan) {
  if (!Array.isArray(plan) || !plan.length) return '';
  const items = plan.map((p, i) => {
    const doneCls = p.done ? ' chat-plan-done' : '';
    const icon    = p.done ? '✓' : String(p.step ?? i + 1);
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
  return `<div class="chat-review-badge">👁 Режим: <strong>${esc(label)}</strong></div>`;
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
  return `<div class="chat-category-badge chat-category-${esc(category)}">${esc(text)}</div>`;
}

/* ── Main render ─────────────────────────────────────────── */

/**
 * Render a complete structured response to HTML.
 * @param {object} resp - Structured response object
 * @param {number} idx  - Message index (for copy button)
 * @param {boolean} isStreaming
 * @returns {string} HTML string
 */
export function renderStructuredResponse(resp, idx, isStreaming) {
  const parts = [];

  if (resp.reviewMode) parts.push(renderReviewBadge(resp.reviewMode));

  // Intent category badge (e.g. "🔍 Поиск", "💡 Объяснение", "📋 План"…)
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
  const copyBtn = !isStreaming ? `<button class="msg-copy-btn" title="Копировать" data-index="${idx}">⧉</button>` : '';

  return `<div class="assistant-msg assistant-msg-assistant${streamingCls}" data-index="${idx}">
    <div class="msg-body">${parts.join('')}</div>${copyBtn}
  </div>`;
}

/**
 * Render a user message.
 */
export function renderUserMessage(msg, idx) {
  // No inner block div — text sits directly in the flex item so fit-content
  // resolves to actual text width, not the full container width.
  return `<div class="assistant-msg assistant-msg-user" data-index="${idx}">${esc(msg.content)}</div>`;
}

/**
 * Render a thinking/loading indicator.
 */
export function renderThinking(idx) {
  return `<div class="assistant-msg assistant-msg-assistant assistant-msg-streaming" data-index="${idx}">
    <div class="msg-body"><span class="msg-thinking"><span></span><span></span><span></span></span></div>
  </div>`;
}

/**
 * Render an error message.
 */
export function renderError(msg, idx, showRetry) {
  const retryBtn = showRetry ? `<br><button class="msg-retry-btn" data-retry="1">↺ Повторить запрос</button>` : '';
  return `<div class="assistant-msg assistant-msg-assistant" data-index="${idx}">
    <div class="msg-body">${renderMarkdownLite(msg.content || '')}${retryBtn}</div>
  </div>`;
}

/**
 * Parse a structured response JSON block from LLM output.
 * LLM is asked to append: ```json { cards, actions, drilldown, plan } ```
 * @param {string} raw - Full LLM text
 * @returns {{ text: string, cards: [], actions: [], drilldown: [], plan: [] }}
 */
export function parseStructuredFromLLM(raw) {
  const result = { text: raw, cards: [], actions: [], drilldown: [], plan: [] };
  if (!raw) return result;
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```\s*$/);
  if (!jsonMatch) return result;
  try {
    const parsed = JSON.parse(jsonMatch[1]);
    result.text = raw.replace(/```json[\s\S]*?```\s*$/, '').trim();
    if (Array.isArray(parsed.cards))     result.cards     = parsed.cards;
    if (Array.isArray(parsed.actions))   result.actions   = parsed.actions;
    if (Array.isArray(parsed.drilldown)) result.drilldown = parsed.drilldown;
    if (Array.isArray(parsed.plan))      result.plan      = parsed.plan;
  } catch(_) {
    // leave text as raw, drop json attempt
    result.text = raw.replace(/```json[\s\S]*?```\s*$/, '').trim() || raw;
  }
  return result;
}

/* ── Inline markdown renderer (copy from app.js, self-contained) ─ */

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
    for (const line of lines) {
      if (/^###\s/.test(line))      { closeList(); out.push(`<h4 class="md-h">${applyInline(line.replace(/^###\s+/,''))}</h4>`); }
      else if (/^##\s/.test(line))  { closeList(); out.push(`<h3 class="md-h">${applyInline(line.replace(/^##\s+/,''))}</h3>`); }
      else if (/^#\s/.test(line))   { closeList(); out.push(`<h3 class="md-h">${applyInline(line.replace(/^#\s+/,''))}</h3>`); }
      else if (/^\s*[-*]\s/.test(line)) { if (!inUl) { closeList(); out.push('<ul>'); inUl = true; } out.push(`<li>${applyInline(line.replace(/^\s*[-*]\s+/,''))}</li>`); }
      else if (/^\s*\d+[.)]\s/.test(line)) { if (!inOl) { closeList(); out.push('<ol>'); inOl = true; } out.push(`<li>${applyInline(line.replace(/^\s*\d+[.)]\s+/,''))}</li>`); }
      else if (line.trim() === '') { closeList(); if (out.length && out[out.length-1] !== '<br>') out.push('<br>'); }
      else { closeList(); out.push(applyInline(line) + '<br>'); }
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
  return result;
}
