'use strict';
/* ============================================================
   AI CEO RENDERER — v10_0
   Pure HTML-string renderers. No state mutation, no DOM side-effects.
   All functions receive plain data objects from aiCeoFallback.js.
   ============================================================ */

import { Utils } from '../utils.js';
import { prizmaEmptyGlyph } from '../app/prizmaUI.js';
import { Icons } from '../app/icons.js';
const esc = s => Utils.escapeHtml(String(s ?? ''));
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

/* ── severity helpers ──────────────────────────────────────── */
// V21 P11.12 — 3 severity → 3 colors. Без gray-fallback. Если severity не из
// списка (`critical|warning|info`) → схлопываем в `info` (не `ok`,
// чтобы не присваивать «зелёный» сигнал неопределённой записи).
function sevClass(s) {
  if (s === 'critical') return 'ceo-sev-critical';
  if (s === 'warning')  return 'ceo-sev-warning';
  if (s === 'ok')       return 'ceo-sev-ok';
  return 'ceo-sev-info';
}
// V21 π3 Ф4 — sevIcon выдаёт signal-dot вместо emoji-traffic-light.
// Брендбук §3 Signal: critical→off-course, warning→drift, info→information,
// ok→on-course. Default (`unknown`) — нейтральная серая точка через
// `var(--prizma-text-secondary)`.
// V21 P11.12 — 3 severity → 3 цвета. Никакого gray-fallback: unknown
// severity → information (синий), как и в `sevClass`.
function sevIcon(s) {
  const cls = { critical: 'signal-off-course', warning: 'signal-drift',
                info: 'signal-information', ok: 'signal-on-course' }[s] || 'signal-information';
  return `<span class="signal-dot ${cls}" aria-hidden="true"></span>`;
}

/* AUDIT_ARTDIRECTION #21+#22 — теперь data-источники (aiCeoFallback,
 * aiFallbackEngine) кладут iconKey-строки (Lucide-имена), а НЕ emoji.
 * Renderer вызывает Icons.get(iconKey).
 *
 * Эта функция остаётся как **safety-net**: legacy saved-states (e.g.
 * сохранённый state.aiCeo до миграции) могут содержать старые emoji.
 * Принимает либо iconKey ('alert-triangle'), либо emoji ('⚠️').
 *   · iconKey — прямой проброс в Icons.get; missing → empty placeholder.
 *   · emoji   — old mapping (signal-dot для traffic-light, SVG для
 *     семантики). Unknown → пустая строка.
 *
 * Унаследованное имя `emojiToBrandIcon` сохранено для совместимости.
 */
function iconKeyOrEmojiToBrandIcon(value) {
  if (!value) return '';
  const v = String(value).trim();
  // Heuristic: iconKey — это lower-case latin-and-hyphens.
  if (/^[a-z][a-z0-9-]+$/.test(v)) {
    return Icons.get(v, { size: 14 });
  }
  // Legacy emoji mapping — оставлен для backward-compat.
  // Traffic-light → signal-dot
  if (v === '🔴') return '<span class="signal-dot signal-off-course" aria-hidden="true"></span>';
  if (v === '🟡' || v === '🟠') return '<span class="signal-dot signal-drift" aria-hidden="true"></span>';
  if (v === '🟢' || v === '✅') return '<span class="signal-dot signal-on-course" aria-hidden="true"></span>';
  if (v === '🔵' || v === 'ℹ') return '<span class="signal-dot signal-information" aria-hidden="true"></span>';
  if (v === '🟣') return '<span class="signal-dot signal-insight" aria-hidden="true"></span>';
  if (v === '⚫' || v === '⚪') return '<span class="signal-dot" style="background:var(--prizma-text-secondary)" aria-hidden="true"></span>';
  // Семантические — SVG-иконка
  if (v === '🚫') return Icons.get('no-symbol', { size: 14 });
  if (v === '🪞') return Icons.get('search',    { size: 14 });
  if (v === '🚑') return Icons.get('alert-triangle', { size: 14 });
  if (v === '🤥') return Icons.get('alert-circle',   { size: 14 });
  if (v === '🔗') return Icons.get('crosshair',  { size: 14 });
  if (v === '📉') return Icons.get('trending-down', { size: 14 });
  if (v === '📈') return Icons.get('trending-up',   { size: 14 });
  if (v === '⏳') return Icons.get('hourglass',  { size: 14 });
  if (v === '⚡') return Icons.get('zap',        { size: 14 });
  if (v === '🔥') return Icons.get('flame',      { size: 14 });
  if (v === '👁') return Icons.get('eye',        { size: 14 });
  if (v === '📍') return Icons.get('crosshair',  { size: 14 });
  // Unknown → пустая строка (decorator silently drops).
  return '';
}
// Legacy alias — старые callsites продолжают работать без правок.
const emojiToBrandIcon = iconKeyOrEmojiToBrandIcon;

/* ── empty state ───────────────────────────────────────────── */
export function renderCeoEmpty() {
  return `
  <div class="ceo-empty">
    ${prizmaEmptyGlyph()}
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

  // П4 Sec 3 — статус → brandbook signal-токен. Добавляем
  // `prizma-hero-signal-*` рядом с legacy `ceo-hero-*`, чтобы
  // CSS-shim применил единую hero-типографику (caption CAPS 11px/1.5px,
  // KPI 48px JetBrains Mono) поверх существующей структуры. Score-ring,
  // causes-list, action-buttons — не трогаются (структурный рефактор
  // отложен).
  const signalClass = {
    ok:       'prizma-hero-signal-on-course',
    risk:     'prizma-hero-signal-drift',
    critical: 'prizma-hero-signal-off-course',
  }[health.status] || 'prizma-hero-signal-drift';

  const causesHtml = (health.causes || []).map(c => `
    <div class="ceo-cause ${sevClass(c.severity)}" ${c.filter ? `data-ceo-action="filter" data-filter='${esc(JSON.stringify(c.filter))}'` : ''}>
      <span class="ceo-cause-icon">${sevIcon(c.severity)}</span>
      <span class="ceo-cause-text">${esc(c.text)}</span>
    </div>`).join('');

  const critRel = health.critRelText
    ? `<div class="ceo-hero-crit-rel">${Icons.get('crosshair', { size: 14 })} ${esc(health.critRelText)}</div>` : '';

  // AUDIT_ARTDIRECTION #20 — data-source маркирует hero как AI-driven или
  // rule-based. AI-frame primitive (`app/aiFramePrimitive.js`) подхватывает
  // селектор `[data-source="ai"]` и вешает 3px insight-stripe.
  const dataSource = esc(health.source || 'rule-based');
  return `
  <div class="ceo-hero ${colorClass} ${signalClass}" id="ceo-hero" data-source="${dataSource}">
    <div class="ceo-hero-left">
      <div class="ceo-hero-score-ring">
        <span class="ceo-score-num">${health.score}</span>
        <span class="ceo-score-pct">%</span>
      </div>
    </div>
    <div class="ceo-hero-center">
      <div class="ceo-hero-label">${esc(health.label)}</div>
      <div class="ceo-hero-causes">${causesHtml || `<div class="ceo-cause ceo-sev-ok"><span class="ceo-cause-icon"><span class="signal-dot signal-on-course" aria-hidden="true"></span></span><span class="ceo-cause-text">Критических проблем не обнаружено</span></div>`}</div>
      ${critRel}
    </div>
    <div class="ceo-hero-right">
      <button class="ceo-btn ceo-btn-ghost" data-ceo-action="filter" data-filter='{"onlyBlocking":true}'>Показать проблемы</button>
      <button class="ceo-btn ceo-btn-ghost" data-ceo-action="explain" data-section="health">Объяснить</button>
      <button class="ceo-btn ceo-btn-refresh aiceo-refresh-btn" id="ceo-refresh-btn" title="Обновить с AI">${Icons.get('rotate-cw', { size: 14 })}<span class="aiceo-refresh-label">AI</span></button>
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

  // V21 audit 05-ai-ceo §12: optional chaining — LLM может не вернуть эти поля
  const firstBreakHtml = (inc.firstToBreak||[]).length ? `
    <div class="ceo-section-subtitle">Задачи, которые сломаются первыми</div>
    ${inc.firstToBreak.map(t => `
    <div class="ceo-first-break">
      <span class="ceo-first-break-task" title="${esc(t.task)}">${esc(t.task)}</span>
      <span class="ceo-first-break-meta">${esc(t.team)} · ${esc(t.release)}</span>
      <span class="ceo-risk-chip">${t.riskScore}</span>
    </div>`).join('')}` : '';

  const releasesHtml = (inc.affectedReleases||[]).length ? `
    <div class="ceo-section-subtitle">Ухудшатся релизы</div>
    <div class="ceo-rel-chips">
      ${inc.affectedReleases.map(r => `
      <div class="ceo-rel-chip" data-ceo-action="filter" data-filter='{"release":"${esc(r.key)}"}'>
        <span class="ceo-rel-chip-label">${esc(r.label)}</span>
        <span class="ceo-rel-chip-pct">${r.progress.pct}%</span>
        ${r.blockers>0?`<span class="ceo-rel-chip-flag">${Icons.get('no-symbol',{size:12})}${r.blockers}</span>`:''}
      </div>`).join('')}
    </div>` : '';

  // AUDIT_ARTDIRECTION #20 — data-source: AI-frame primitive подхватит stripe.
  const incSource = esc(inc.source || 'rule-based');
  return `
  <div class="ceo-card" id="ceo-inc" data-source="${incSource}">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">${Icons.get('hourglass',{size:14})}</span>
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
  // V21 P11.12 — иерархия по силе сигнала:
  //   hardTruths (critical) → weight 600, основной размер
  //   suspicious (warning)  → weight 500, -1px
  //   weakSignals (info)    → weight 400, -1px, secondary color
  // Реализовано через severity-tier классы `aiceo-hard-truth` /
  // `aiceo-suspicious` / `aiceo-weak-signal`.
  // V21 audit 05-ai-ceo §10: items теперь <ul role="list">/<li>;
  // кликабельные — <button> вместо div[style=cursor:pointer] (a11y).
  function truthGroup(items, title, tierClass) {
    if (!items.length) return '';
    return `
    <div class="ceo-truth-group">
      <div class="ceo-truth-group-title">${title}</div>
      <ul role="list" class="ceo-truth-list">
        ${items.map(t => `
        <li class="ceo-truth-item ${tierClass}">
          ${t.filter
            ? `<button class="ceo-truth-btn" data-ceo-action="filter" data-filter='${esc(JSON.stringify(t.filter))}'>
                 <span class="ceo-truth-icon" aria-hidden="true">${emojiToBrandIcon(t.icon)}</span>
                 <span class="ceo-truth-text">${esc(t.text)}</span>
                 <span class="ceo-truth-arrow" aria-hidden="true">→</span>
               </button>`
            : `<span class="ceo-truth-icon" aria-hidden="true">${emojiToBrandIcon(t.icon)}</span>
               <span class="ceo-truth-text">${esc(t.text)}</span>`
          }
        </li>`).join('')}
      </ul>
    </div>`;
  }

  const hasAnything = truths.hardTruths.length || truths.suspicious.length || truths.weakSignals.length;
  // V21 P11.12 — «всё в порядке»: critical+warning пусто. weakSignals
  // допустимы — они не red-flag, могут остаться без жёсткой реакции.
  const allGood = !truths.hardTruths.length && !truths.suspicious.length;

  let bodyHtml;
  if (allGood) {
    bodyHtml = `
    <div class="aiceo-empty-good">
      ${prizmaEmptyGlyph()}
      <div class="aiceo-empty-good-title">Курс держится — критики нет</div>
      <div class="aiceo-empty-good-sub">AI-CEO не нашёл red-flag'ов в этом цикле.</div>
    </div>`;
  } else if (hasAnything) {
    bodyHtml = `
    ${truthGroup(truths.hardTruths, '<span class="signal-dot signal-off-course" aria-hidden="true"></span> Жёсткая правда', 'aiceo-hard-truth')}
    ${truthGroup(truths.suspicious, '<span class="signal-dot signal-drift" aria-hidden="true"></span> Подозрительные места', 'aiceo-suspicious')}
    ${truthGroup(truths.weakSignals, '<span class="signal-dot signal-information" aria-hidden="true"></span> Слабые сигналы', 'aiceo-weak-signal')}`;
  } else {
    bodyHtml = `<div class="ceo-truth-all-ok"><span class="signal-dot signal-on-course" aria-hidden="true"></span> Видимых противоречий не обнаружено. Данные выглядят последовательно.</div>`;
  }

  // AUDIT_ARTDIRECTION #20 — data-source: AI vs rule-based.
  const truthsSource = esc(truths.source || 'rule-based');
  return `
  <div class="ceo-card ceo-card-dark" id="ceo-truths" data-source="${truthsSource}">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">${Icons.get('search',{size:14})}</span>
      <span class="ceo-card-title">Что мы себе не говорим</span>
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
        <span class="ceo-scenario-icon">${emojiToBrandIcon(s.icon)}</span>
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

  // AUDIT_ARTDIRECTION #20 — data-source: AI vs rule-based.
  const saveSource = esc(saveData.source || 'rule-based');
  return `
  <div class="ceo-card" id="ceo-save" data-source="${saveSource}">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">${Icons.get('alert-triangle',{size:14})}</span>
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
export function renderActionFeed(feedItems, opts = {}) {
  // AUDIT_ARTDIRECTION #20 — opts.source: 'ai' | 'rule-based' (по умолчанию rule-based).
  const feedSource = esc(opts.source || 'rule-based');
  if (!feedItems.length) {
    return `
    <div class="ceo-card" id="ceo-feed" data-source="${feedSource}">
      <div class="ceo-card-header"><span class="ceo-card-icon">${Icons.get('zap',{size:14})}</span><span class="ceo-card-title">Лента действий</span></div>
      <div class="ceo-card-body"><div class="ceo-feed-empty">Нет рекомендаций — план выглядит хорошо.</div></div>
    </div>`;
  }

  // V21 audit 05-ai-ceo §17: убран role="button" tabindex="0" с обёртки —
  // WAI-ARIA запрещает interactive внутри interactive (вложены два <button>).
  // Карточка — просто структурный контейнер; focus идёт на кнопки внутри.
  const itemsHtml = feedItems.map(item => `
    <div class="ceo-feed-item aiceo-action-feed-item ${sevClass(item.severity)}" id="ceo-feed-${esc(item.id)}">
      <div class="ceo-feed-item-left">
        <span class="ceo-feed-icon">${emojiToBrandIcon(item.icon)}</span>
      </div>
      <div class="ceo-feed-item-body">
        <div class="ceo-feed-title">${esc(item.title)}</div>
        <div class="ceo-feed-explanation">${esc(item.explanation)}</div>
        <div class="ceo-feed-meta">
          <span class="ceo-feed-impact">${esc(item.impact)}</span>
          ${item.affectedCount ? `<span class="ceo-feed-count aiceo-num">${item.affectedCount} задач</span>` : ''}
        </div>
      </div>
      <div class="ceo-feed-item-actions">
        ${item.filter ? `<button class="ceo-btn ceo-btn-xs" data-ceo-action="filter" data-filter='${esc(JSON.stringify(item.filter))}'>Показать</button>` : ''}
        <button class="ceo-btn ceo-btn-xs" data-ceo-action="explain" data-section="${esc(item.id)}">Объяснить</button>
      </div>
    </div>`).join('');

  return `
  <div class="ceo-card" id="ceo-feed" data-source="${feedSource}">
    <div class="ceo-card-header">
      <span class="ceo-card-icon">${Icons.get('zap',{size:14})}</span>
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
  // V21 audit 05-ai-ceo §4: emoji → Icons.get (CLAUDE.md «без эмодзи в production UI»)
  const typeIcon = {
    set_scope:         Icons.get('archive-x',       { size: 12 }),
    remove_from_scope: Icons.get('trash-2',         { size: 12 }),
    move_to_overtime:  Icons.get('fast-forward',    { size: 12 }),
    assign_owner:      Icons.get('user-plus',       { size: 12 }),
    assign_assignee:   Icons.get('edit-3',          { size: 12 }),
    confirm_scope:     Icons.get('check-circle',    { size: 12 }),
    escalate:          Icons.get('arrow-up-right',  { size: 12 }),
  };
  const typeText = {
    set_scope:         'Убрать из scope',
    remove_from_scope: 'Снять из scope',
    move_to_overtime:  'В overtime',
    assign_owner:      'Назначить ответственного',
    assign_assignee:   'Назначить исполнителя',
    confirm_scope:     'Подтвердить scope',
    escalate:          'Эскалировать',
  };
  function typeLabelHtml(type) {
    const icon = typeIcon[type] ? `<span class="ceo-preview-type-icon" aria-hidden="true">${typeIcon[type]}</span>` : '';
    return `${icon}${typeText[type] || esc(type)}`;
  }

  const grouped = {};
  (changes || []).forEach(c => {
    const t = c.type || 'other';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(c);
  });

  const groupHtml = Object.entries(grouped).map(([type, items]) => `
    <div class="ceo-preview-group">
      <div class="ceo-preview-group-title">${typeLabelHtml(type)} (${items.length})</div>
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
        <button class="ceo-modal-close" id="ceo-modal-close" aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
      </div>
      <div class="ceo-modal-note">
        Это только предпросмотр — изменения <strong>не применяются</strong> до вашего явного подтверждения.
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
  // V21 audit 05-ai-ceo §4: emoji → Icons.get (CLAUDE.md «без эмодзи»)
  const titleMap = {
    health: { icon: Icons.get('activity',  { size: 14 }), text: 'Состояние проекта' },
    inc:    { icon: Icons.get('hourglass', { size: 14 }), text: 'Если ничего не менять' },
    truths: { icon: Icons.get('search',    { size: 14 }), text: 'Вы обманываете себя' },
    feed:   { icon: Icons.get('zap',       { size: 14 }), text: 'Лента действий' },
  };
  const t = titleMap[section] || { icon: Icons.get('crosshair', { size: 14 }), text: esc(section) };
  const title = `<span aria-hidden="true">${t.icon}</span> ${t.text}`;

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
        <button class="ceo-modal-close" id="ceo-modal-close" aria-label="Закрыть">${Icons.get('x', { size: 14 })}</button>
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
  // AUDIT_ARTDIRECTION #20 — actionFeed это массив, source хранится на data
  // (data.aiEnhanced=true → 'ai', иначе 'rule-based').
  const actionFeedSource = data.aiEnhanced ? 'ai' : 'rule-based';
  return `
  <div class="ceo-page" id="ceo-page">
    ${renderCeoHero(data.health)}
    ${renderIfNothingChanges(data.ifNothingChanges)}
    ${renderHardTruths(data.hardTruths)}
    ${renderSaveTheRelease(data.saveRelease)}
    ${renderActionFeed(data.actionFeed, { source: actionFeedSource })}
  </div>`;
}
