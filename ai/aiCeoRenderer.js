'use strict';
/* ============================================================
   AI CEO RENDERER — v10_0
   Pure HTML-string renderers. No state mutation, no DOM side-effects.
   All functions receive plain data objects from aiCeoFallback.js.
   ============================================================ */

import { Utils } from '../utils.js';
const esc = s => Utils.escapeHtml(String(s ?? ''));
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

/* ── severity helpers ──────────────────────────────────────── */
function sevClass(s) {
  return { critical:'ceo-sev-critical', warning:'ceo-sev-warning', info:'ceo-sev-info', ok:'ceo-sev-ok' }[s] || 'ceo-sev-info';
}
function sevIcon(s) {
  return { critical:'🔴', warning:'🟡', info:'🔵', ok:'🟢' }[s] || '⚪';
}

/* ── empty state ───────────────────────────────────────────── */
export function renderCeoEmpty() {
  return `
  <div class="ceo-empty">
    <div class="ceo-empty-icon">🤖</div>
    <div class="ceo-empty-title">Нет данных для AI CEO</div>
    <div class="ceo-empty-sub">Загрузите файл с задачами — импорт XLSX или CSV через меню «Файлы»</div>
  </div>`;
}

/* ── loading skeleton ──────────────────────────────────────── */
export function renderCeoLoading() {
  return `
  <div class="ceo-page">
    ${[1,2,3].map(() => `
    <div class="ceo-card ceo-skel-card">
      <div class="ceo-skel ceo-skel-h32 w60" style="margin-bottom:12px"></div>
      <div class="ceo-skel ceo-skel-h16 w100" style="margin-bottom:6px"></div>
      <div class="ceo-skel ceo-skel-h16 w80" style="margin-bottom:6px"></div>
      <div class="ceo-skel ceo-skel-h16 w60"></div>
    </div>`).join('')}
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   SECTION 1: HERO — PROJECT HEALTH BRAIN
   ══════════════════════════════════════════════════════════ */
export function renderCeoHero(health) {
  const colorClass = {
    ok:       'ceo-hero-ok',
    risk:     'ceo-hero-risk',
    critical: 'ceo-hero-critical',
  }[health.status] || 'ceo-hero-risk';

  const causesHtml = (health.causes || []).map(c => `
    <div class="ceo-cause ${sevClass(c.severity)}" ${c.filter ? `data-ceo-action="filter" data-filter='${esc(JSON.stringify(c.filter))}'` : ''}>
      <span class="ceo-cause-icon">${sevIcon(c.severity)}</span>
      <span class="ceo-cause-text">${esc(c.text)}</span>
    </div>`).join('');

  const critRel = health.critRelText
    ? `<div class="ceo-hero-crit-rel">📍 ${esc(health.critRelText)}</div>` : '';

  return `
  <div class="ceo-hero ${colorClass}" id="ceo-hero">
    <div class="ceo-hero-left">
      <div class="ceo-hero-score-ring">
        <span class="ceo-score-num">${health.score}</span>
        <span class="ceo-score-pct">%</span>
      </div>
    </div>
    <div class="ceo-hero-center">
      <div class="ceo-hero-label">${esc(health.label)}</div>
      <div class="ceo-hero-causes">${causesHtml || '<div class="ceo-cause ceo-sev-ok"><span class="ceo-cause-icon">✅</span><span class="ceo-cause-text">Критических проблем не обнаружено</span></div>'}</div>
      ${critRel}
    </div>
    <div class="ceo-hero-right">
      <button class="ceo-btn ceo-btn-ghost" data-ceo-action="filter" data-filter='{"onlyBlocking":true}'>Показать проблемы</button>
      <button class="ceo-btn ceo-btn-ghost" data-ceo-action="explain" data-section="health">Объяснить</button>
      <button class="ceo-btn ceo-btn-refresh" id="ceo-refresh-btn" title="Обновить с AI">↺ AI</button>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   SECTION 2: IF NOTHING CHANGES
   ══════════════════════════════════════════════════════════ */
export function renderIfNothingChanges(inc) {
  const consequencesHtml = inc.consequences.map(c => `
    <div class="ceo-consequence ${sevClass(c.severity)}" ${c.filter ? `data-ceo-action="filter" data-filter='${esc(JSON.stringify(c.filter))}'` : ''} style="${c.filter?'cursor:pointer':''}">
      <span class="ceo-consequence-icon">${sevIcon(c.severity)}</span>
      <span class="ceo-consequence-text">${esc(c.text)}</span>
      ${c.filter ? '<span class="ceo-consequence-arrow">→</span>' : ''}
    </div>`).join('');

  // Risk arrow visualization
  const riskW = Math.max(inc.currentRisk, 5);
  const projW = Math.min(inc.projectedRisk, 100);
  const riskGrowthClass = inc.riskGrowth > 15 ? 'ceo-risk-grow-high' : inc.riskGrowth > 5 ? 'ceo-risk-grow-med' : 'ceo-risk-grow-low';

  const firstBreakHtml = inc.firstToBreak.length ? `
    <div class="ceo-section-subtitle">Задачи, которые сломаются первыми</div>
    ${inc.firstToBreak.map(t => `
    <div class="ceo-first-break">
      <span class="ceo-first-break-task" title="${esc(t.task)}">${esc(t.task)}</span>
      <span class="ceo-first-break-meta">${esc(t.team)} · ${esc(t.release)}</span>
      <span class="ceo-risk-chip">${t.riskScore}</span>
    </div>`).join('')}` : '';

  const releasesHtml = inc.affectedReleases.length ? `
    <div class="ceo-section-subtitle">Ухудшатся релизы</div>
    <div class="ceo-rel-chips">
      ${inc.affectedReleases.map(r => `
      <div class="ceo-rel-chip" data-ceo-action="filter" data-filter='{"release":"${esc(r.key)}"}'>
        <span class="ceo-rel-chip-label">${esc(r.label)}</span>
        <span class="ceo-rel-chip-pct">${r.progress.pct}%</span>
        ${r.blockers>0?`<span class="ceo-rel-chip-flag">🚫${r.blockers}</span>`:''}
      </div>`).join('')}
    </div>` : '';

  return `
  <div class="ceo-card" id="ceo-inc">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">⏳</span>
      <span class="ceo-card-title">Если ничего не менять</span>
    </div>
    <div class="ceo-card-body">
      <div class="ceo-inc-headline">${esc(inc.headline)}</div>
      <div class="ceo-risk-timeline">
        <div class="ceo-risk-bar-row">
          <span class="ceo-risk-bar-label">Сейчас</span>
          <div class="ceo-risk-bar"><div class="ceo-risk-bar-fill" style="width:${riskW}%">${riskW}%</div></div>
        </div>
        <div class="ceo-risk-bar-row ${riskGrowthClass}">
          <span class="ceo-risk-bar-label">+${inc.projectedDays}д</span>
          <div class="ceo-risk-bar"><div class="ceo-risk-bar-fill ceo-risk-proj" style="width:${projW}%">${projW}%</div></div>
        </div>
      </div>
      <div class="ceo-consequences">${consequencesHtml}</div>
      ${releasesHtml}
      ${firstBreakHtml}
    </div>
    <div class="ceo-card-actions">
      <button class="ceo-btn ceo-btn-ghost" data-ceo-action="explain" data-section="inc">Почему?</button>
      <button class="ceo-btn ceo-btn-primary" data-ceo-action="filter" data-filter='{"onlyBlocking":true}'>Показать задачи</button>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   SECTION 3: YOU'RE LYING TO YOURSELF
   ══════════════════════════════════════════════════════════ */
export function renderHardTruths(truths) {
  function truthGroup(items, title, emptyText) {
    if (!items.length) return '';
    return `
    <div class="ceo-truth-group">
      <div class="ceo-truth-group-title">${title}</div>
      ${items.map(t => `
      <div class="ceo-truth-item" ${t.filter ? `data-ceo-action="filter" data-filter='${esc(JSON.stringify(t.filter))}'` : ''} style="${t.filter?'cursor:pointer':''}">
        <span class="ceo-truth-icon">${esc(t.icon)}</span>
        <span class="ceo-truth-text">${esc(t.text)}</span>
        ${t.filter ? '<span class="ceo-truth-arrow">→</span>' : ''}
      </div>`).join('')}
    </div>`;
  }

  const hasAnything = truths.hardTruths.length || truths.suspicious.length || truths.weakSignals.length;

  const bodyHtml = hasAnything ? `
    ${truthGroup(truths.hardTruths, '🔴 Жёсткая правда', '')}
    ${truthGroup(truths.suspicious, '🟡 Подозрительные места', '')}
    ${truthGroup(truths.weakSignals, '🔵 Слабые сигналы', '')}
  ` : `<div class="ceo-truth-all-ok">✅ Видимых противоречий не обнаружено. Данные выглядят последовательно.</div>`;

  return `
  <div class="ceo-card ceo-card-dark" id="ceo-truths">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">🪞</span>
      <span class="ceo-card-title">Вы обманываете себя</span>
      ${truths.totalCount ? `<span class="ceo-truth-count-badge">${truths.totalCount}</span>` : ''}
    </div>
    <div class="ceo-card-body">
      ${bodyHtml}
    </div>
    <div class="ceo-card-actions">
      <button class="ceo-btn ceo-btn-ghost" data-ceo-action="explain" data-section="truths">Объяснить</button>
      <button class="ceo-btn ceo-btn-ghost" data-ceo-action="filter" data-filter='{"onlyRisky":true}'>Показать рискованные</button>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   SECTION 4: SAVE THE RELEASE
   ══════════════════════════════════════════════════════════ */
export function renderSaveTheRelease(saveData) {
  const scenarioHtml = saveData.scenarios.map(s => {
    const riskDelta = s.riskBefore - s.riskAfter;
    const probDelta = s.probability.after - s.probability.before;

    return `
    <div class="ceo-scenario" id="ceo-scenario-${esc(s.id)}">
      <div class="ceo-scenario-header">
        <span class="ceo-scenario-icon">${esc(s.icon)}</span>
        <span class="ceo-scenario-label">${esc(s.label)}</span>
      </div>
      <div class="ceo-scenario-desc">${esc(s.description)}</div>
      <div class="ceo-scenario-metrics">
        <div class="ceo-scen-metric">
          <span class="ceo-scen-metric-label">Риск</span>
          <span class="ceo-scen-metric-val">${s.riskBefore}% → <strong>${s.riskAfter}%</strong></span>
          <span class="ceo-scen-delta ceo-delta-good">−${riskDelta}%</span>
        </div>
        <div class="ceo-scen-metric">
          <span class="ceo-scen-metric-label">Вероятность сдачи</span>
          <span class="ceo-scen-metric-val">${s.probability.before}% → <strong>${s.probability.after}%</strong></span>
          <span class="ceo-scen-delta ceo-delta-good">+${probDelta}%</span>
        </div>
        <div class="ceo-scen-metric">
          <span class="ceo-scen-metric-label">Scope</span>
          <span class="ceo-scen-metric-val">${esc(s.scopeImpact)}</span>
        </div>
        <div class="ceo-scen-metric">
          <span class="ceo-scen-metric-label">Задач</span>
          <span class="ceo-scen-metric-val">${s.affectedCount}</span>
        </div>
      </div>
      <div class="ceo-tradeoffs">
        ${s.tradeoffs.map(t => `<div class="ceo-tradeoff-item">· ${esc(t)}</div>`).join('')}
      </div>
      <div class="ceo-scenario-actions">
        <button class="ceo-btn ceo-btn-ghost" data-ceo-action="explain" data-section="scenario-${esc(s.id)}">Подробнее</button>
        <button class="ceo-btn ceo-btn-primary"
          data-ceo-action="preview"
          data-scenario="${esc(s.id)}"
          data-changes='${esc(JSON.stringify(s.changes))}'>
          Предпросмотр
        </button>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="ceo-card" id="ceo-save">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">🚑</span>
      <span class="ceo-card-title">Как спасти ${esc(saveData.relLabel)}</span>
      <span class="ceo-save-note">Предпросмотр не применяет изменения</span>
    </div>
    <div class="ceo-scenarios-grid">
      ${scenarioHtml}
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   SECTION 5: ACTION FEED
   ══════════════════════════════════════════════════════════ */
export function renderActionFeed(feedItems) {
  if (!feedItems.length) {
    return `
    <div class="ceo-card" id="ceo-feed">
      <div class="ceo-card-header"><span class="ceo-card-icon">⚡</span><span class="ceo-card-title">Лента действий</span></div>
      <div class="ceo-card-body"><div class="ceo-feed-empty">Нет рекомендаций — план выглядит хорошо.</div></div>
    </div>`;
  }

  const itemsHtml = feedItems.map(item => `
    <div class="ceo-feed-item ${sevClass(item.severity)}" id="ceo-feed-${esc(item.id)}">
      <div class="ceo-feed-item-left">
        <span class="ceo-feed-icon">${esc(item.icon)}</span>
      </div>
      <div class="ceo-feed-item-body">
        <div class="ceo-feed-title">${esc(item.title)}</div>
        <div class="ceo-feed-explanation">${esc(item.explanation)}</div>
        <div class="ceo-feed-meta">
          <span class="ceo-feed-impact">${esc(item.impact)}</span>
          ${item.affectedCount ? `<span class="ceo-feed-count">${item.affectedCount} задач</span>` : ''}
        </div>
      </div>
      <div class="ceo-feed-item-actions">
        ${item.filter ? `<button class="ceo-btn ceo-btn-xs" data-ceo-action="filter" data-filter='${esc(JSON.stringify(item.filter))}'>Показать</button>` : ''}
        <button class="ceo-btn ceo-btn-xs" data-ceo-action="explain" data-section="${esc(item.id)}">Объяснить</button>
      </div>
    </div>`).join('');

  return `
  <div class="ceo-card" id="ceo-feed">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">⚡</span>
      <span class="ceo-card-title">Лента действий</span>
      <span class="ceo-feed-count-badge">${feedItems.length}</span>
    </div>
    <div class="ceo-feed-list">
      ${itemsHtml}
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   PREVIEW MODAL
   ══════════════════════════════════════════════════════════ */
export function renderPreviewModal(scenarioLabel, changes) {
  const typeLabel = {
    set_scope:        '🔕 Убрать из scope',
    remove_from_scope:'🗑 Снять из scope',
    move_to_overtime: '⏭ В overtime',
    assign_owner:     '👤 Назначить ответственного',
    assign_assignee:  '✍️ Назначить исполнителя',
    confirm_scope:    '✅ Подтвердить scope',
    escalate:         '🆙 Эскалировать',
  };

  const grouped = {};
  (changes || []).forEach(c => {
    const t = c.type || 'other';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(c);
  });

  const groupHtml = Object.entries(grouped).map(([type, items]) => `
    <div class="ceo-preview-group">
      <div class="ceo-preview-group-title">${typeLabel[type] || esc(type)} (${items.length})</div>
      ${items.slice(0, 12).map(c => `
      <div class="ceo-preview-row">
        <span class="ceo-preview-task" title="${esc(c.task)}">${esc(c.task)}</span>
        <span class="ceo-preview-reason">${esc(c.reason || '')}</span>
      </div>`).join('')}
      ${items.length > 12 ? `<div class="ceo-preview-more">...ещё ${items.length-12}</div>` : ''}
    </div>`).join('');

  return `
  <div class="ceo-modal-overlay" id="ceo-preview-modal">
    <div class="ceo-modal-box">
      <div class="ceo-modal-header">
        <div class="ceo-modal-title">Предпросмотр: ${esc(scenarioLabel)}</div>
        <button class="ceo-modal-close" id="ceo-modal-close">✕</button>
      </div>
      <div class="ceo-modal-note">
        ⚠️ Это только предпросмотр — изменения <strong>не применяются</strong> до вашего явного подтверждения.
      </div>
      <div class="ceo-modal-body">
        ${changes.length ? groupHtml : '<div class="ceo-preview-empty">Нет предлагаемых изменений для этого сценария.</div>'}
      </div>
      <div class="ceo-modal-footer">
        <span class="ceo-modal-footer-note">Всего изменений: ${changes.length}</span>
        <button class="ceo-btn ceo-btn-ghost" id="ceo-modal-cancel">Закрыть</button>
        <button class="ceo-btn ceo-btn-danger" id="ceo-modal-confirm" ${!changes.length ? 'disabled' : ''}>
          Применить изменения
        </button>
      </div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   EXPLANATION PANEL
   ══════════════════════════════════════════════════════════ */
export function renderExplainPanel(section, data) {
  const titles = {
    health:    '🧠 Project Health Brain',
    inc:       '⏳ Если ничего не менять',
    truths:    '🪞 Вы обманываете себя',
    feed:      '⚡ Лента действий',
  };
  const title = titles[section] || `📌 ${section}`;

  let lines = [];
  if (section === 'health' && data.health) {
    const h = data.health;
    lines = [
      `**Health Score:** ${h.score}/100`,
      `**Статус:** ${h.label}`,
      '',
      '**Главные причины:**',
      ...(h.causes||[]).map(c=>`• ${c.text}`),
      '',
      h.critRelText ? `**Проблемный релиз:** ${h.critRelText}` : '',
    ].filter(s=>s!==undefined);
  } else if (section === 'inc' && data.ifNothingChanges) {
    const inc = data.ifNothingChanges;
    lines = [
      `**Текущий риск:** ${inc.currentRisk}%`,
      `**Прогноз через ${inc.projectedDays} дней:** ${inc.projectedRisk}%`,
      '',
      '**Последствия:**',
      ...(inc.consequences||[]).map(c=>`• ${c.text}`),
    ];
  } else if (section === 'truths' && data.hardTruths) {
    const t = data.hardTruths;
    lines = [
      '**Жёсткая правда:**',
      ...(t.hardTruths||[]).map(i=>`• ${i.icon} ${i.text}`),
      '',
      '**Подозрительное:**',
      ...(t.suspicious||[]).map(i=>`• ${i.icon} ${i.text}`),
      '',
      '**Слабые сигналы:**',
      ...(t.weakSignals||[]).map(i=>`• ${i.icon} ${i.text}`),
    ];
  } else {
    lines = [
      'Откройте чат для детального объяснения этого блока.',
      'Нажмите кнопку чата внизу справа и задайте вопрос.',
    ];
  }

  const html = lines.filter(Boolean).map(l => {
    if (l.startsWith('**') && l.endsWith('**')) {
      return `<div class="ceo-expl-heading">${esc(l.slice(2,-2))}</div>`;
    }
    if (l.startsWith('•')) {
      return `<div class="ceo-expl-item">${esc(l)}</div>`;
    }
    if (l === '') return '<div style="height:8px"></div>';
    return `<div class="ceo-expl-line">${esc(l)}</div>`;
  }).join('');

  return `
  <div class="ceo-modal-overlay" id="ceo-explain-modal">
    <div class="ceo-modal-box ceo-modal-sm">
      <div class="ceo-modal-header">
        <div class="ceo-modal-title">${title}</div>
        <button class="ceo-modal-close" id="ceo-modal-close">✕</button>
      </div>
      <div class="ceo-modal-body">${html}</div>
      <div class="ceo-modal-footer">
        <button class="ceo-btn ceo-btn-ghost" id="ceo-modal-cancel">Закрыть</button>
        <button class="ceo-btn ceo-btn-primary" id="ceo-expl-chat-btn">Спросить AI в чате</button>
      </div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   FULL PAGE
   ══════════════════════════════════════════════════════════ */
export function renderCeoPage(data) {
  return `
  <div class="ceo-page" id="ceo-page">
    ${renderCeoHero(data.health)}
    ${renderIfNothingChanges(data.ifNothingChanges)}
    ${renderHardTruths(data.hardTruths)}
    ${renderSaveTheRelease(data.saveRelease)}
    ${renderActionFeed(data.actionFeed)}
  </div>`;
}
