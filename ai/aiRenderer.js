'use strict';
/* ============================================================
   AI RENDERER — v10_0
   Pure rendering — no state mutation, no side effects.
   Returns HTML strings from block data objects.
   ============================================================ */

import { Utils } from '../utils.js';
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
function blockHeader(block) {
  return `
  <div class="ai-block-header">
    <span class="ai-block-icon">${esc(block.icon)}</span>
    <div class="ai-block-meta">
      <h3 class="ai-block-title">${esc(block.title)}</h3>
      <div class="ai-block-badges">
        ${statusBadge(block.status)}
        ${block.aiEnhanced ? '<span class="ai-enhanced-badge">✨ AI</span>' : ''}
        ${block.confidence ? `<span class="ai-conf-badge">уверенность: ${esc(CONF_LABEL[String(block.confidence||'').toLowerCase()] || block.confidence)}</span>` : ''}
      </div>
    </div>
    ${scoreRing(block.score, block.status)}
  </div>`;
}

/* ── block actions ──────────────────────────────────────────── */
function blockActions(block) {
  const showBtn = block.filterPayload || (block.recommendations||[]).some(r=>r.filter)
    ? `<button class="ai-btn ai-btn-show" data-ai-action="show" data-block-id="${esc(block.id)}">Показать задачи</button>` : '';
  return `
  <div class="ai-block-actions">
    ${showBtn}
    <button class="ai-btn ai-btn-explain"  data-ai-action="explain"  data-block-id="${esc(block.id)}">Объяснить</button>
    <button class="ai-btn ai-btn-refresh"  data-ai-action="refresh"  data-block-id="${esc(block.id)}">↺ Обновить AI-анализ</button>
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
      ${r.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(blockId)}" data-filter='${JSON.stringify(r.filter)}'>→ Показать</button>` : ''}
    </div>`).join('')}
  </div>`;
}

/* ══════════════════════════════════════════════════════════════
   Specialised sub-renderers per block type
   ════════════════════════════════════════════════════════════ */

function renderHealth(b) {
  const probItems = (b.problems||[]).map(p => `
  <div class="ai-problem-item ai-sev-${p.severity}">
    <span class="ai-problem-icon">${p.severity==='critical'?'🔴':p.severity==='warning'?'🟡':'🔵'}</span>
    <span>${esc(p.title)}</span>
    ${p.filter ? `<button class="ai-btn ai-btn-xs" data-ai-action="filter" data-block-id="${esc(b.id)}" data-filter='${JSON.stringify(p.filter)}'>→</button>` : ''}
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
  const cards = (b.scenarios||[]).map(s => `
  <div class="ai-scenario ai-scenario-${esc(s.color)}">
    <div class="ai-scenario-header">${esc(s.icon)} <strong>${esc(s.label)}</strong> <span class="ai-scenario-risk">Риск: ${esc(s.risk)}</span></div>
    <ul class="ai-scenario-what">${s.what.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>
    <div class="ai-scenario-tradeoff">⚖ ${esc(s.tradeoff)}</div>
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
  const cards = (b.narratives||[]).map(n => `
  <div class="ai-narrative-card">
    <div class="ai-narrative-title">${esc(n.title)}</div>
    <p class="ai-narrative-story">${esc(n.story)}</p>
    <div class="ai-narrative-fix">💡 ${esc(n.howToFix)}</div>
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
  const cards = (b.dashboardCards||[]).map(c => `
  <div class="ai-dash-card ai-dash-${c.severity}">
    <div class="ai-dash-icon">${esc(c.icon)}</div>
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
  const items = (b.anomalies||[]).map(a => `
  <div class="ai-anomaly-item ${SEV_CLASS[a.severity]||''}">
    <div class="ai-anomaly-title">${esc(a.title)}</div>
    <div class="ai-anomaly-detail">${esc(a.detail)}</div>
    ${a.check ? `<div class="ai-anomaly-check">✓ ${esc(a.check)}</div>` : ''}
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
  const sItems = (b.safeSpots||[]).map(s=>`<li class="ai-safe-spot">✓ ${esc(s)}</li>`).join('');
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
    <div class="ai-feed-icon">${r.severity==='critical'?'🔴':r.severity==='warning'?'🟡':r.severity==='ok'?'✅':'🔵'}</div>
    <div class="ai-feed-body">
      <div class="ai-feed-title">${esc(r.title)}</div>
      <div class="ai-feed-exp">${esc(r.explanation)}</div>
      ${r.impact ? `<div class="ai-feed-impact">📈 ${esc(r.impact)}</div>` : ''}
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
  return `<div class="ai-block" id="ai-block-${esc(block.id)}" data-status="${esc(block.status)}">${inner}</div>`;
}

/* ── loading skeleton ───────────────────────────────────────── */
export function renderBlockLoading(blockId, title) {
  return `<div class="ai-block ai-block-loading" id="ai-block-${esc(blockId)}">
    <div class="ai-block-header">
      <span class="ai-block-icon">⏳</span>
      <div class="ai-block-meta"><h3 class="ai-block-title">${esc(title||'AI-анализ')}</h3></div>
    </div>
    <div class="ai-loading-bar"><div class="ai-loading-fill"></div></div>
    <p class="ai-summary ai-loading-text">Запрос к AI…</p>
  </div>`;
}

/* ── empty state (no data) ──────────────────────────────────── */
export function renderEmptyState() {
  return `<div class="ai-empty-state">
    <div class="ai-empty-icon">🤖</div>
    <h3>Нет данных для анализа</h3>
    <p>Загрузите данные плана (CSV или XLSX) чтобы включить AI-аналитику.</p>
  </div>`;
}

/* ── full page shell (static layout only, blocks injected) ─── */
export function renderPageShell(blocks) {
  const blockHtml = (ids) => ids.map(id => {
    const b = blocks[id];
    return b ? renderBlock(b) : `<div class="ai-block" id="ai-block-${id}"></div>`;
  }).join('');

  return `
  <div class="ai-page">
    <div class="ai-page-header">
      <div class="ai-page-title-row">
        <h2 class="ai-page-title">🤖 Центр AI-аналитики</h2>
        <button class="ai-btn ai-btn-primary" id="ai-refresh-all">↺ Обновить всё</button>
      </div>
      <p class="ai-page-subtitle">AI-аналитика текущего плана только для чтения. Данные не изменяются автоматически.</p>
    </div>

    <div class="ai-layout-hero">
      ${blockHtml(['health'])}
    </div>

    <div class="ai-layout-2col">
      ${blockHtml(['forecast', 'if_nothing_changes'])}
    </div>

    <div class="ai-layout-2col">
      ${blockHtml(['dashboard', 'quality'])}
    </div>

    <div class="ai-layout-2col">
      ${blockHtml(['bottlenecks', 'anomalies'])}
    </div>

    <div class="ai-layout-2col">
      ${blockHtml(['risk_narrative', 'second_opinion'])}
    </div>

    <div class="ai-layout-2col">
      ${blockHtml(['prioritization', 'dependency'])}
    </div>

    <div class="ai-layout-2col">
      ${blockHtml(['replanning', 'recommendations'])}
    </div>
  </div>`;
}
