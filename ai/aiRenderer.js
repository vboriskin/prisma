'use strict';
/* ============================================================
   AI RENDERER — v10_0
   Pure rendering — no state mutation, no side effects.
   Returns HTML strings from block data objects.
   ============================================================ */

import { Utils } from '../utils.js';
import { prizmaEmptyGlyph, prizmaLoaderMark, renderEmptyState as renderEmptyStateBase } from '../app/prizmaUI.js';
import { Icons } from '../app/icons.js';
const esc = s => Utils.escapeHtml(String(s ?? ''));

/* ── severity helpers ───────────────────────────────────────── */
// V17.1 J2 — англицизмы убраны из видимых badges (HIGH / MEDIUM / LOW /
//   CRITICAL / OK / Risk / Info). Классы остаются прежними (CSS-цвета),
//   менее зависимые места поправлены через словари ниже.
const STATUS_CLASS  = { ok:'ai-status-ok', risk:'ai-status-risk', critical:'ai-status-critical', info:'ai-status-info' };
const STATUS_LABEL  = { ok:'норма', risk:'риск', critical:'критично', info:'инфо' };
const IMPACT_CLASS  = { high:'ai-imp-high', medium:'ai-imp-med', low:'ai-imp-low' };
const IMPACT_LABEL  = { high:'высокий', medium:'средний', low:'низкий' };
const SEV_CLASS     = { critical:'ai-sev-critical', warning:'ai-sev-warning', info:'ai-sev-info', ok:'ai-sev-ok' };
const SEV_LABEL     = { critical:'критично', warning:'внимание', info:'инфо', ok:'норма', high:'высокий', medium:'средний', low:'низкий' };
const CONF_LABEL    = { high:'высокая', medium:'средняя', low:'низкая' };

function statusBadge(status) {
  return `<span class="ai-status-badge ${STATUS_CLASS[status]||'ai-status-info'}">${STATUS_LABEL[status]||status}</span>`;
}
function impactBadge(impact) {
  return `<span class="ai-impact-badge ${IMPACT_CLASS[impact]||'ai-imp-low'}">${esc(IMPACT_LABEL[impact] || impact)}</span>`;
}
function scoreRing(score, status) {
  if (score === null || score === undefined) return '';
  const cls = STATUS_CLASS[status] || 'ai-status-info';
  return `<div class="ai-score-ring ${cls}"><span class="ai-score-val">${score}</span><span class="ai-score-pct">%</span></div>`;
}

/* ── block header ───────────────────────────────────────────── */
// AUDIT_ARTDIRECTION #21+#28 — block.icon теперь iconKey-строка (Lucide-имя),
// а не emoji-литерал. Renderer вызывает Icons.get(iconKey). Если block.icon
// — старый emoji (legacy saved-state), оставляем raw esc(...) как safety-net.
function _renderBlockIcon(iconKey) {
  if (!iconKey) return '';
  const v = String(iconKey).trim();
  if (/^[a-z][a-z0-9-]+$/.test(v)) {
    return Icons.get(v, { size: 16 });
  }
  // Legacy emoji — экранируем как raw (для старых saved-states).
  return esc(v);
}
function blockHeader(block) {
  // V21 audit 07-ai-analysis §2: ✨ AI emoji-badge заменён на SVG sparkles
  // (CLAUDE.md §«без эмодзи в production UI»).
  const aiBadge = block.aiEnhanced
    ? `<span class="ai-enhanced-badge"><span class="ai-enhanced-sparkle" aria-hidden="true">${Icons.get('sparkles', { size: 10 })}</span>AI</span>`
    : '';
  return `
  <div class="ai-block-header">
    <span class="ai-block-icon" aria-hidden="true">${_renderBlockIcon(block.icon)}</span>
    <div class="ai-block-meta">
      <h3 class="ai-block-title">${esc(block.title)}</h3>
      <div class="ai-block-badges">
        ${statusBadge(block.status)}
        ${aiBadge}
        ${block.confidence ? `<span class="ai-conf-badge">уверенность: ${esc(CONF_LABEL[String(block.confidence||'').toLowerCase()] || block.confidence)}</span>` : ''}
      </div>
    </div>
    ${scoreRing(block.score, block.status)}
  </div>`;
}

/* ── block actions ──────────────────────────────────────────── */
function blockActions(block) {
  // V21 audit 07-ai-analysis §11: ↺ unicode заменён на Icons.rotate-cw
  // (screen-reader читал «counterclockwise» по-английски).
  const refreshIcon = `<span class="ai-btn-icon" aria-hidden="true">${Icons.get('rotate-cw', { size: 12 })}</span>`;
  const showBtn = block.filterPayload || (block.recommendations||[]).some(r=>r.filter)
    ? `<button class="ai-btn ai-btn-show" data-ai-action="show" data-block-id="${esc(block.id)}" aria-label="Показать задачи блока ${esc(block.title || '')}">Показать задачи</button>` : '';
  return `
  <div class="ai-block-actions">
    ${showBtn}
    <button class="ai-btn ai-btn-explain"  data-ai-action="explain"  data-block-id="${esc(block.id)}" aria-label="Объяснить ${esc(block.title || '')}">Объяснить</button>
    <button class="ai-btn ai-btn-refresh"  data-ai-action="refresh"  data-block-id="${esc(block.id)}" aria-label="Обновить AI-анализ блока ${esc(block.title || '')}">${refreshIcon}Обновить AI-анализ</button>
  </div>`;
}

/* ── insights list ──────────────────────────────────────────── */
function insightsList(insights) {
  if (!insights || !insights.length) return '';
  return `<ul class="ai-insights">${insights.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`;
}

/* ── recommendations list ───────────────────────────────────── */
function recsList(recs, blockId) {
  if (!recs || !recs.length) return '';
  return `<div class="ai-recs">
    <div class="ai-recs-title">Рекомендации</div>
    ${recs.slice(0,4).map(r => `
    <div class="ai-rec-item">
      ${impactBadge(r.impact)}
      <div class="ai-rec-body">
        <div class="ai-rec-title">${esc(r.title)}</div>
        ${r.action ? `<div class="ai-rec-action">${esc(r.action)}</div>` : ''}
      </div>
      ${r.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(blockId)}" data-filter="${esc(JSON.stringify(r.filter))}">→ Показать</button>` : ''}
    </div>`).join('')}
  </div>`;
}

/* ══════════════════════════════════════════════════════════════
   Specialised sub-renderers per block type
   ════════════════════════════════════════════════════════════ */

function renderHealth(b) {
  // V21 audit 07-ai-analysis §3: 🔴/🟡/🔵 emoji удалены — severity уже
  // выражена через 3px stripe-left на `.ai-sev-*` (CLAUDE.md §«без эмодзи»).
  // §13: data-filter теперь HTML-escape'нут.
  const probItems = (b.problems||[]).map(p => `
  <div class="ai-problem-item ai-sev-${esc(p.severity)}">
    <span>${esc(p.title)}</span>
    ${p.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(b.id)}" data-filter="${esc(JSON.stringify(p.filter))}">→</button>` : ''}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  ${b.problems&&b.problems.length ? `<div class="ai-problems">${probItems}</div>` : ''}
  ${recsList(b.recommendations, b.id)}
  ${blockActions(b)}`;
}

function renderForecast(b) {
  const bars = (b.forecasts||[]).map(f => `
  <div class="ai-forecast-row">
    <div class="ai-forecast-label">${esc(f.label)}</div>
    <div class="ai-forecast-bars">
      <div class="ai-fbar ai-fbar-worst"  style="width:${f.worst}%"  title="Худший: ${f.worst}%"></div>
      <div class="ai-fbar ai-fbar-expect" style="width:${f.expected}%" title="Ожидаемый: ${f.expected}%"></div>
      <div class="ai-fbar ai-fbar-best"   style="width:${f.best}%"  title="Лучший: ${f.best}%"></div>
    </div>
    <div class="ai-forecast-pcts"><span class="ai-fc-worst">${f.worst}%</span>/<span class="ai-fc-exp">${f.expected}%</span>/<span class="ai-fc-best">${f.best}%</span></div>
    ${statusBadge(f.status)}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  ${bars ? `<div class="ai-forecast-grid"><div class="ai-forecast-legend"><span class="ai-leg worst">Худший</span><span class="ai-leg exp">Ожидаемый</span><span class="ai-leg best">Лучший</span></div>${bars}</div>` : ''}
  ${recsList(b.recommendations, b.id)}
  ${blockActions(b)}`;
}

function renderScenarios(b) {
  // AUDIT_ARTDIRECTION #28 — s.icon теперь iconKey, не emoji.
  // ⚖ tradeoff-glyph заменён на «·» — semantically нейтрален.
  const cards = (b.scenarios||[]).map(s => `
  <div class="ai-scenario ai-scenario-${esc(s.color)}">
    <div class="ai-scenario-header"><span class="ai-scenario-icon" aria-hidden="true">${_renderBlockIcon(s.icon)}</span> <strong>${esc(s.label)}</strong> <span class="ai-scenario-risk">Риск: ${esc(s.risk)}</span></div>
    <ul class="ai-scenario-what">${s.what.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>
    <div class="ai-scenario-tradeoff">${esc(s.tradeoff)}</div>
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-scenarios">${cards}</div>
  ${blockActions(b)}`;
}

function renderBottlenecks(b) {
  const items = (b.bottlenecks||[]).map(bt => `
  <div class="ai-bn-item ${SEV_CLASS[bt.severity]||''}">
    <div class="ai-bn-label"><strong>${esc(bt.label)}</strong></div>
    <div class="ai-bn-reason">${esc(bt.reason)}</div>
    ${bt.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(b.id)}" data-filter='${JSON.stringify(bt.filter)}'>→ Показать</button>` : ''}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-bn-list">${items}</div>
  ${recsList(b.recommendations, b.id)}
  ${blockActions(b)}`;
}

function renderNarratives(b) {
  // AUDIT_ARTDIRECTION #28 — 💡 emoji glyph заменён на SVG lightbulb-icon.
  const lightbulb = Icons.get('lightbulb', { size: 12 });
  const cards = (b.narratives||[]).map(n => `
  <div class="ai-narrative-card">
    <div class="ai-narrative-title">${esc(n.title)}</div>
    <p class="ai-narrative-story">${esc(n.story)}</p>
    <div class="ai-narrative-fix"><span aria-hidden="true">${lightbulb}</span> ${esc(n.howToFix)}</div>
    ${n.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(b.id)}" data-filter='${JSON.stringify(n.filter)}'>→ Показать задачи</button>` : ''}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-narratives">${cards}</div>
  ${blockActions(b)}`;
}

function renderPrioritization(b) {
  const rows = (b.topRows||[]).slice(0,10).map((r,i) => `
  <div class="ai-prio-row">
    <span class="ai-prio-num">${i+1}</span>
    <div class="ai-prio-body">
      <div class="ai-prio-title">${esc(r.epic||r.tasks||'—')}</div>
      <div class="ai-prio-meta">${esc((r._reasons||[]).join(' · '))} <span class="ai-prio-score">score ${r._sc||0}</span></div>
    </div>
    ${r.team ? `<span class="ai-prio-team">${esc(r.team)}</span>` : ''}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-prio-list">${rows}</div>
  ${blockActions(b)}`;
}

function renderDashboard(b) {
  // AUDIT_ARTDIRECTION #28 — c.icon теперь iconKey-строка.
  const cards = (b.dashboardCards||[]).map(c => `
  <div class="ai-dash-card ai-dash-${c.severity}">
    <div class="ai-dash-icon" aria-hidden="true">${_renderBlockIcon(c.icon)}</div>
    <div class="ai-dash-value">${esc(String(c.value))}</div>
    <div class="ai-dash-label">${esc(c.label)}</div>
    <div class="ai-dash-title">${esc(c.title)}</div>
    ${c.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(b.id)}" data-filter='${JSON.stringify(c.filter)}'>→</button>` : ''}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-dash-grid">${cards}</div>
  ${blockActions(b)}`;
}

function renderAnomalies(b) {
  // AUDIT_ARTDIRECTION #28 — ✓ glyph заменён на SVG check-icon.
  const checkIcon = Icons.get('check', { size: 12 });
  const items = (b.anomalies||[]).map(a => `
  <div class="ai-anomaly-item ${SEV_CLASS[a.severity]||''}">
    <div class="ai-anomaly-title">${esc(a.title)}</div>
    <div class="ai-anomaly-detail">${esc(a.detail)}</div>
    ${a.check ? `<div class="ai-anomaly-check"><span aria-hidden="true">${checkIcon}</span> ${esc(a.check)}</div>` : ''}
    ${a.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(b.id)}" data-filter='${JSON.stringify(a.filter)}'>→ Показать</button>` : ''}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-anomaly-list">${items}</div>
  ${recsList(b.recommendations, b.id)}
  ${blockActions(b)}`;
}

function renderQuality(b) {
  const bars = (b.breakdown||[]).map(br => `
  <div class="ai-qual-row">
    <div class="ai-qual-label">${esc(br.factor)}</div>
    <div class="ai-qual-penalty">${br.penalty}</div>
    <div class="ai-qual-fix">${esc(br.fix)}</div>
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  ${bars ? `<div class="ai-qual-table"><div class="ai-qual-head"><span>Фактор</span><span>Штраф</span><span>Как улучшить</span></div>${bars}</div>` : '<p class="ai-summary">Нет штрафных факторов — план отличный!</p>'}
  ${recsList(b.recommendations, b.id)}
  ${blockActions(b)}`;
}

function renderSecondOpinion(b) {
  const fItems = (b.findings||[]).map(f => `
  <div class="ai-finding ${f.canIgnore?'ai-finding-minor':'ai-finding-major'}">
    <span class="ai-finding-risk ai-imp-${f.risk==='high'?'high':f.risk==='medium'?'med':'low'}">${esc(f.risk)}</span>
    <div><strong>${esc(f.issue)}</strong><br><span class="ai-finding-detail">${esc(f.detail)}</span></div>
  </div>`).join('');
  // AUDIT_ARTDIRECTION #28 — ✓ glyph заменён на SVG check-icon.
  const safeIcon = Icons.get('check', { size: 12 });
  const sItems = (b.safeSpots||[]).map(s=>`<li class="ai-safe-spot"><span aria-hidden="true">${safeIcon}</span> ${esc(s)}</li>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-findings">${fItems}</div>
  ${sItems ? `<ul class="ai-safe-list">${sItems}</ul>` : ''}
  ${recsList(b.recommendations, b.id)}
  ${blockActions(b)}`;
}

function renderRecommendations(b) {
  const items = (b.recs||[]).map(r => `
  <div class="ai-feed-item ai-feed-${r.severity}">
    <div class="ai-feed-icon"><span class="signal-dot ${r.severity==='critical'?'signal-off-course':r.severity==='warning'?'signal-drift':r.severity==='ok'?'signal-on-course':'signal-information'}" aria-hidden="true"></span></div>
    <div class="ai-feed-body">
      <div class="ai-feed-title">${esc(r.title)}</div>
      <div class="ai-feed-exp">${esc(r.explanation)}</div>
      ${r.impact ? `<div class="ai-feed-impact">${Icons.get('trending-up', { size: 12 })} ${esc(r.impact)}</div>` : ''}
      ${r.nextStep ? `<div class="ai-feed-next">→ ${esc(r.nextStep)}</div>` : ''}
    </div>
    ${r.filter ? `<button class="ai-btn ai-btn-show" data-ai-action="filter" data-block-id="${esc(b.id)}" data-filter='${JSON.stringify(r.filter)}'>Показать</button>` : ''}
  </div>`).join('');
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  <div class="ai-feed">${items}</div>
  ${blockActions(b)}`;
}

function renderGeneric(b) {
  return `${blockHeader(b)}
  <p class="ai-summary">${esc(b.summary)}</p>
  ${insightsList(b.insights)}
  ${recsList(b.recommendations, b.id)}
  ${blockActions(b)}`;
}

/* ── dispatcher ─────────────────────────────────────────────── */
const RENDERERS = {
  health:           renderHealth,
  forecast:         renderForecast,
  replanning:       renderScenarios,
  bottlenecks:      renderBottlenecks,
  risk_narrative:   renderNarratives,
  prioritization:   renderPrioritization,
  dashboard:        renderDashboard,
  anomalies:        renderAnomalies,
  quality:          renderQuality,
  second_opinion:   renderSecondOpinion,
  recommendations:  renderRecommendations,
};

/* Wrap body content in .ai-block-body so the existing CSS
   (padding, gap, border between body and actions) applies.
   Depth-aware <div> walker — works regardless of indentation. */
function _wrapBody(html) {
  const headerStart = html.indexOf('<div class="ai-block-header"');
  if (headerStart === -1) return html; // no header — give up, render as-is

  // Walk forward from headerStart, tracking <div> depth, to find header's closing </div>.
  let depth = 0;
  let i = headerStart;
  let headerEnd = -1; // index AFTER the closing </div>
  while (i < html.length) {
    const openIdx  = html.indexOf('<div',   i);
    const closeIdx = html.indexOf('</div>', i);
    if (closeIdx === -1) break;
    if (openIdx !== -1 && openIdx < closeIdx) {
      depth++;
      i = openIdx + 4;
    } else {
      depth--;
      if (depth === 0) { headerEnd = closeIdx + '</div>'.length; break; }
      i = closeIdx + 6;
    }
  }
  if (headerEnd === -1) return html;

  const actionsIdx = html.indexOf('<div class="ai-block-actions"', headerEnd);
  const bodyEnd    = (actionsIdx === -1) ? html.length : actionsIdx;
  const headerHtml  = html.slice(0, headerEnd);
  const bodyHtml    = html.slice(headerEnd, bodyEnd).trim();
  const actionsHtml = (actionsIdx === -1) ? '' : html.slice(bodyEnd);
  if (!bodyHtml) return headerHtml + actionsHtml; // empty body — skip wrapper
  return `${headerHtml}\n  <div class="ai-block-body">${bodyHtml}</div>\n  ${actionsHtml}`;
}

export function renderBlock(block) {
  const fn = RENDERERS[block.id] || renderGeneric;
  const inner = _wrapBody(fn(block));
  // AUDIT_ARTDIRECTION #20 — data-source маркирует AI vs rule-based для
  // AI-frame primitive (insight-stripe).
  const source = esc(block.aiEnhanced ? 'ai' : (block.source || 'rule-based'));
  return `<div class="ai-block" id="ai-block-${esc(block.id)}" data-status="${esc(block.status)}" data-source="${source}">${inner}</div>`;
}

/* ── loading state ──────────────────────────────────────────── */
// V21 — legacy ⏳ emoji + custom progress-bar заменены на brand L2 loader
// (звезда + breathe + ring) per BRAND_BOOK §11.
export function renderBlockLoading(blockId, title) {
  return `<div class="ai-block ai-block-loading" id="ai-block-${esc(blockId)}">
    <div class="ai-block-header">
      <div class="ai-block-meta"><h3 class="ai-block-title">${esc(title||'AI-анализ')}</h3></div>
    </div>
    <div class="ai-block-loading-body">
      ${prizmaLoaderMark()}
      <p class="ai-summary ai-loading-text">Запрос к AI…</p>
    </div>
  </div>`;
}

/* ── empty state (no data) ──────────────────────────────────── */
// V21 audit 07-ai-analysis §12/§25: добавлен role="status" + aria-live.
// AUDIT_ARTDIRECTION #27 — для AI-empty-state используем маскот-hibernate
// (а не star-breathe). Caption «Призма пока не видит курс» — брендбук
// continuity (маскот спит, а не error-state).
export function renderEmptyState() {
  const action = `
    <button class="ai-btn ai-btn-primary" data-ai-empty-action="import-xlsx">Импортировать XLSX</button>
    <button class="ai-btn" data-ai-empty-action="demo-template">Шаблон демо</button>`;
  return `<div class="ai-empty-state" role="status" aria-live="polite">${
    renderEmptyStateBase({
      title: 'Призма пока не видит курс',
      hint: 'Загрузите данные плана (CSV или XLSX) — Призма проснётся и начнёт смотреть.',
      illustration: 'mascot-hibernate',
      action,
    })
  }</div>`;
}

/* ── hero block selection (AUDIT_ARTDIRECTION #26) ───────────── */
// Приоритет «Главное за 30 секунд»: критическое здоровье → критические
// рекомендации → критические аномалии → health (как fallback).
// AI может прислать explicit hero hint в `state.aiAnalysis.heroBlockId`,
// но rule-based selector — текущий вариант «AI ещё не подсказал».
function _pickHeroBlockId(blocks) {
  // 1. Если есть LLM hint — используем его.
  try {
    const hint = window.state?.aiAnalysis?.heroBlockId;
    if (hint && blocks[hint]) return hint;
  } catch (_) {}
  // 2. Severity-based: первый блок с status='critical' среди приоритетных.
  const PRIORITY = ['health', 'recommendations', 'anomalies'];
  for (const id of PRIORITY) {
    const b = blocks[id];
    if (b && b.status === 'critical') return id;
  }
  // 3. risk-tier — то же.
  for (const id of PRIORITY) {
    const b = blocks[id];
    if (b && b.status === 'risk') return id;
  }
  // 4. Default — health (всегда в наборе).
  return 'health';
}

// AUDIT_ARTDIRECTION #26 — persistence открытого/закрытого state.
const COLLAPSE_LS_PREFIX = 'prizma.ai.expanded.';
function _isBlockExpanded(blockId) {
  try {
    const v = localStorage.getItem(COLLAPSE_LS_PREFIX + blockId);
    return v === '1';
  } catch (_) { return false; }
}

// Wrapper «collapsed library» — каждая карта в `<details>`.
function _renderLibraryItem(b) {
  if (!b) return '';
  const expanded = _isBlockExpanded(b.id);
  // AUDIT_ARTDIRECTION #26 — eyebrow CAPS 10px (Spine-pill §5).
  // Title и status-badge в summary, contents — renderBlock внутри <details>.
  return `
  <details class="ai-library-item" data-block-id="${esc(b.id)}" ${expanded?'open':''}>
    <summary class="ai-library-summary">
      <span class="ai-library-eyebrow">${esc((b.title||'').toUpperCase())}</span>
      ${statusBadge(b.status)}
      ${b.aiEnhanced ? `<span class="ai-enhanced-badge"><span class="ai-enhanced-sparkle" aria-hidden="true">${Icons.get('sparkles', { size: 10 })}</span>AI</span>` : ''}
    </summary>
    <div class="ai-library-body">${renderBlock(b)}</div>
  </details>`;
}

/* ── full page shell (static layout only, blocks injected) ─── */
export function renderPageShell(blocks) {
  // AUDIT_ARTDIRECTION #26 — hero «Главное за 30 секунд» + collapsed library.
  const heroId = _pickHeroBlockId(blocks);
  const heroBlock = blocks[heroId];
  // Все остальные блоки — в collapsed library. Порядок выбран по
  // «значимости для решения» (recommendations / forecast / quality сверху,
  // dependency / replanning внизу).
  const LIBRARY_ORDER = [
    'recommendations', 'forecast', 'if_nothing_changes', 'quality',
    'bottlenecks', 'anomalies', 'risk_narrative', 'second_opinion',
    'prioritization', 'dashboard', 'dependency', 'replanning', 'health',
  ];
  const libraryHtml = LIBRARY_ORDER
    .filter(id => id !== heroId && blocks[id])
    .map(id => _renderLibraryItem(blocks[id]))
    .join('');
  const heroHtml = heroBlock
    ? `<div class="ai-block ai-block-hero" id="ai-block-${esc(heroBlock.id)}" data-status="${esc(heroBlock.status)}" data-source="${esc(heroBlock.aiEnhanced ? 'ai' : (heroBlock.source || 'rule-based'))}">${_wrapBody((RENDERERS[heroBlock.id] || renderGeneric)(heroBlock))}</div>`
    : '';

  // V21 audit 07-ai-analysis §1/§10: 🤖 emoji + h2 → SVG ai-star + h1.
  return `
  <div class="ai-page">
    <div class="ai-page-header">
      <div class="ai-page-title-row">
        <h1 class="ai-page-title">
          <span class="ai-page-title-icon" aria-hidden="true">${Icons.get('sparkles', { size: 20 })}</span>
          Центр AI-аналитики
        </h1>
        <button class="ai-btn ai-btn-primary ai-btn-with-icon" id="ai-refresh-all" aria-label="Обновить весь AI-анализ"><span class="ai-btn-icon" aria-hidden="true">${Icons.get('rotate-cw', { size: 12 })}</span>Обновить всё</button>
      </div>
      <p class="ai-page-subtitle">AI-аналитика текущего плана только для чтения. Данные не изменяются автоматически.</p>
    </div>

    <!-- AUDIT_ARTDIRECTION #26 — hero «Главное за 30 секунд» -->
    <div class="ai-layout-hero ai-layout-hero-prime">
      <div class="ai-hero-eyebrow">ГЛАВНОЕ ЗА 30 СЕКУНД</div>
      ${heroHtml}
    </div>

    <!-- AUDIT_ARTDIRECTION #26 — collapsed library: остальные 12 блоков -->
    <div class="ai-library">
      <div class="ai-library-eyebrow-row">БИБЛИОТЕКА AI-АНАЛИЗА · ${LIBRARY_ORDER.filter(id => id !== heroId && blocks[id]).length} БЛОКОВ</div>
      ${libraryHtml}
    </div>
  </div>`;
}
