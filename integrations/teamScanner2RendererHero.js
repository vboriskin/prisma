'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — RENDERER (HERO BLOCK)
   Extracted 2026-05-12 — Tier 0 Renderer split phase 5.

   Hero/glance block: всё что выше per-person rows.
     · renderTopBar — title + actions
     · renderVelocityComparison — bar/leaderboard/trend
     · renderTeamSwitcher — chips для multi-team
     · renderSprintGauge / renderSprintLagBreakdown — спринт-прогресс
     · renderTeamGlance — single-line summary
     · renderConfluenceSsoBanner / _ensureSsoBannerStyles — banner для CF SSO
     · renderTeamHealthHero — health + sprint-confidence «hero»
     · renderDailyBrief / renderActionQueue / renderBurnupSparkline — daily-brief блок
     · _humanizeAge / _buildSprintNarrative / _composeRoomStoryLine — pure helpers
     · _ensureScannerRoomStyles — inject CSS для room-story

   Dependencies:
     · Common — esc/plural/fmtDuration/renderSparkline/renderDelta/jiraIssueLink/linkifyIssueKeys/getRenderContext
     · Insights — buildDailyBrief/buildActionQueue/buildBurnupData/buildCrossTeamDeps/computePrCycleTime/computeCrQueueDepth/computeCrLoadGini/computeBlockerMTTR/computeTeamHealthScore/composeDailyBriefMarkdown/computeSprintConfidence/computeUnplannedWork/weekdayAdjustedAnomaly
     · Insights tile renderers — renderSleepingDataInsights/_renderDeeperEmptyState (lazy via re-import)
     · Classifier — classifyPerson
     · main renderer — _renderScannerTabBar/renderHygieneView/getScannerTab (cyclic, runtime-resolved)
     · state.js — state.employees/state.llm
     · app/icons.js — Icons.get
     · app/services.js — Services.AutoSummary
   ============================================================ */

import { Icons } from '../app/icons.js';
import { Services } from '../app/services.js';
import { state } from '../state.js';
import {
  esc, plural, fmtDuration,
  renderSparkline, renderDelta,
  jiraIssueLink, linkifyIssueKeys,
  getRenderContext,
} from './teamScanner2RendererCommon.js';
import { classifyPerson } from './teamScanner2Classifier.js';
import {
  buildDailyBrief, buildActionQueue, buildBurnupData,
  buildCrossTeamDeps,
  computePrCycleTime, computeCrQueueDepth, computeCrLoadGini,
  computeBlockerMTTR, computeTeamHealthScore,
  composeDailyBriefMarkdown,
  computeSprintConfidence, computeUnplannedWork,
  weekdayAdjustedAnomaly,
} from './teamScanner2Insights.js';
import {
  renderSleepingDataInsights,
  _renderDeeperEmptyState,
} from './teamScanner2RendererInsights.js';
// Cyclic — main re-exports эти symbols к moment'у вызова уже определены.
import {
  _renderScannerTabBar,
  renderHygieneView,
  getScannerTab,
  renderHistoryTrendRow,
} from './teamScanner2Renderer.js';

/* ── Top bar ─────────────────────────────────────────── */

export function renderTopBar(model, ctx = {}) {
  const pkCount = (model?.projectKeys || []).length;
  const sg = model?.scannerV2?.sprintGoal;
  const prevSprint = ctx.prev?.sprintGoal;
  const sprintSlope = ctx.sprintGoalSlope || null;
  const sprintGauge = sg && sg.aggregateTotal > 0 ? renderSprintGauge(sg, prevSprint, sprintSlope) : '';
  // V21 π5 — banner для demo-режима. Показывает что данные синтетические,
  // даёт CTA «Выйти из демо». Banner всегда виден поверх sprint-gauge,
  // чтобы пользователь не путал demo с реальной картиной.
  const demoBanner = (model?.isDemo || ctx.isDemo) ? `
    <div class="ts2-demo-banner" role="status" aria-live="polite">
      <span class="ts2-demo-banner-dot" aria-hidden="true"></span>
      <span class="ts2-demo-banner-text">Демо-режим: данные синтетические, в Jira / Bitbucket / Confluence ничего не отправляется.</span>
      <button class="ts2-btn ts2-btn-ghost ts2-btn-sm" id="ts2-demo-exit" type="button" title="Выйти из демо-режима — вернуться к настоящему Сканнеру">Выйти из демо</button>
    </div>
  ` : '';
  // V22 — stale-banner удалён по UX-фидбеку: повторял meta из refresh-кнопки.
  // ctx.isStale / ctx.cacheAgeMs продолжают доставляться orchestrator'ом
  // (используются в diagnostic-modal); inline-баннер не показываем.
  return `
    ${demoBanner}
    <div class="ts2-topbar">
      <div class="ts2-topbar-title">
        ${/* v22 — `<h2>Сканнер команд</h2>` убран: дублировал название
             подвкладки в integrationsView. DEMO-tag сохранён как отдельный
             chip когда применим, sprintGauge остаётся главным left-elem. */ ''}
        ${(model?.isDemo || ctx.isDemo) ? '<span class="ts2-demo-tag">DEMO</span>' : ''}
        ${sprintGauge}
      </div>
      <div class="ts2-topbar-meta">
        <button class="ts2-btn ts2-btn-ghost ts2-diag-btn-with-badge" id="ts2-diag-btn" type="button" title="Диагностика: почему по BB / Conf / Jira нет данных + JSON-экспорт для разработчика" aria-label="Диагностика">${Icons.get('clipboard', { cls: 'btn-icon', size: 14 })} Диагностика${ctx.knownIssuesCount > 0 ? `<span class="ts2-diag-btn-badge" title="${ctx.knownIssuesCount} известных проблем требуют внимания">${ctx.knownIssuesCount}</span>` : ''}</button>
        <button class="ts2-btn ts2-btn-ghost ts2-btn-print" id="ts2-print-btn" type="button" title="Сохранить как PDF (откроется print-dialog → выберите Save as PDF)" aria-label="Сохранить как PDF" onclick="window._ts2PrintScanner && window._ts2PrintScanner()">${Icons.get('printer', { cls: 'btn-icon', size: 14 })}</button>
        <button class="ts2-btn ts2-btn-primary" id="ts2-refresh-btn" type="button" title="Перезагрузить данные с серверов">${Icons.get('rotate-cw', { cls: 'btn-icon', size: 14 })} Обновить</button>
        <div class="ts2-kebab-wrap">
          <button class="ts2-btn ts2-btn-ghost ts2-kebab-btn" id="ts2-kebab-btn" type="button"
                  title="Дополнительные действия" aria-label="Меню" aria-haspopup="menu" aria-expanded="false">⋯</button>
          <div class="ts2-kebab-menu" id="ts2-kebab-menu" role="menu" hidden>
            <!-- 2026-05-12 — IA group: Filters (4) / Actions (2). Уменьшает
                 cognitive load от plain list 6 items. CAPS sub-headers по brandbook. -->
            <div class="ts2-kebab-group-title">Фильтры</div>
            ${pkCount >= 2 ? `<button class="ts2-kebab-item ${ctx.activeView === 'multi' ? 'ts2-kebab-item-active' : ''}" id="ts2-view-toggle" type="button" role="menuitem">${Icons.get('users', { cls: 'btn-icon', size: 14 })} ${ctx.activeView === 'multi' ? 'Одна команда' : 'По командам'}</button>` : ''}
            <button class="ts2-kebab-item ${ctx.showBlocked ? 'ts2-kebab-item-active' : ''}" id="ts2-show-blocked-toggle" type="button" role="menuitem" aria-pressed="${ctx.showBlocked ? 'true' : 'false'}" title="Показывать пользователей с суффиксом [X] в имени (заблокированные учётные записи Jira/Bitbucket)">${ctx.showBlocked ? Icons.get('check', { cls: 'btn-icon', size: 12 }) + ' ' : ''}Показать заблокированных${(ctx.deactivatedCount > 0 && !ctx.showBlocked) ? ` (${ctx.deactivatedCount})` : ''}</button>
            <button class="ts2-kebab-item ${ctx.activeSprintOnly ? 'ts2-kebab-item-active' : ''}" id="ts2-active-sprint-toggle" type="button" role="menuitem" aria-pressed="${ctx.activeSprintOnly ? 'true' : 'false'}" title="Показывать только задачи из активного спринта (без бэклога и закрытых спринтов). Влияет на классификатор стоп/наблюдение/движется.">${ctx.activeSprintOnly ? Icons.get('check', { cls: 'btn-icon', size: 12 }) + ' ' : ''}Только активный спринт</button>
            <button class="ts2-kebab-item ${ctx.velocityCompareOn ? 'ts2-kebab-item-active' : ''}" id="ts2-velocity-compare-toggle" type="button" role="menuitem" aria-pressed="${ctx.velocityCompareOn ? 'true' : 'false'}" title="Показать блок «Сравнение команд» с переключателем гистограмма / лидерборд / тренд.">${ctx.velocityCompareOn ? Icons.get('check', { cls: 'btn-icon', size: 12 }) + ' ' : ''}Сравнение команд</button>
            <div class="ts2-kebab-divider" role="separator"></div>
            <div class="ts2-kebab-group-title">Действия</div>
            ${ctx.activeView !== 'multi' ? `<button class="ts2-kebab-item" id="ts2-brief-export-btn" type="button" role="menuitem" title="Сохранить standalone HTML-бриф команды: список сотрудников 1-в-1 как здесь, каждая строка разворачивается в полную карточку.">${Icons.get('download', { cls: 'btn-icon', size: 14 })} Выгрузить бриф</button>` : ''}
            <button class="ts2-kebab-item" id="ts2-how-btn" type="button" role="menuitem">${Icons.get('help-circle', { cls: 'btn-icon', size: 14 })} Как считается</button>
            <button class="ts2-kebab-item" id="ts2-config-btn" type="button" role="menuitem">${Icons.get('settings', { cls: 'btn-icon', size: 14 })} Настройка команд</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * V20 S11 Z7 — Velocity comparison между командами (3 view: bar / leaderboard / trend).
 *
 * Источник: `model.scannerV2.sprintGoal.sprints[]` — per-pk done/total/progressPct
 * для активных спринтов. Для тренда: `history` с per-pk-aggregated snapshot'ами
 * (если pk-detail не сохранён, тренд показывает aggregate slope вместо per-pk).
 *
 * @param {object} model
 * @param {Array<object>} history — snapshots за 14 дней
 * @param {object} ctx — { viewMode: 'bar'|'leaderboard'|'trend' }
 */
export function renderVelocityComparison(model, history = [], ctx = {}) {
  const sg = model?.scannerV2?.sprintGoal;
  const sprints = sg?.sprints || [];
  if (sprints.length < 2) return ''; // нужны минимум 2 команды
  const viewMode = ctx.viewMode || 'bar';

  // Sort by done desc для leaderboard и bar.
  const sorted = [...sprints].sort((a, b) => (b.done || 0) - (a.done || 0));
  const maxDone = Math.max(1, ...sorted.map(s => s.done || 0));
  const totalDoneAll = sorted.reduce((s, sp) => s + (sp.done || 0), 0);

  // Tabs для переключения view-mode.
  const tabBtn = (mode, label) =>
    `<button type="button" class="ts2-vc-tab ${viewMode === mode ? 'ts2-vc-tab-active' : ''}"
             data-velocity-view="${esc(mode)}" role="tab" aria-selected="${viewMode === mode}">${esc(label)}</button>`;
  const tabs = `
    <div class="ts2-vc-tabs" role="tablist" aria-label="Режим сравнения команд">
      ${tabBtn('bar', '▆ Гистограмма')}
      ${tabBtn('leaderboard', '#1 Лидерборд')}
      ${tabBtn('trend', '/\\ Тренд')}
    </div>
  `;

  let body = '';
  if (viewMode === 'bar') {
    body = `
      <div class="ts2-vc-bars">
        ${sorted.map(s => {
          const done = s.done || 0;
          const total = s.total || 0;
          const w = Math.round((done / maxDone) * 100);
          const pace = s.pace || 'no-data';
          return `
            <div class="ts2-vc-bar-row">
              <span class="ts2-vc-bar-pk">${esc(s.pk)}</span>
              <span class="ts2-vc-bar-track">
                <span class="ts2-vc-bar-fill ts2-sprint-pace-${pace}" style="width:${w}%"></span>
                <span class="ts2-vc-bar-num">${done}/${total}</span>
              </span>
              <span class="ts2-vc-bar-pct">${s.progressPct}%</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="ts2-vc-hint">Горизонтальный bar = задач закрыто. Длина — пропорция к лидеру (${maxDone}). Цвет — pace спринта.</div>
    `;
  } else if (viewMode === 'leaderboard') {
    body = `
      <ol class="ts2-vc-leader">
        ${sorted.map((s, i) => `
          <li class="ts2-vc-leader-row">
            <span class="ts2-vc-leader-rank">#${i + 1}</span>
            <span class="ts2-vc-leader-pk">${esc(s.pk)}</span>
            <span class="ts2-vc-leader-name" title="${esc(s.name || '')}">${esc(s.name || '—')}</span>
            <span class="ts2-vc-leader-stat">
              <span class="ts2-lag-num">${s.done}/${s.total}</span>
              <span class="ts2-lag-lab">закрыто</span>
              <span class="ts2-lag-sep">·</span>
              <span class="ts2-lag-num">${s.progressPct}%</span>
            </span>
            <span class="ts2-vc-leader-pace ts2-sprint-pace-${s.pace || 'no-data'}">${esc(PACE_LABEL[s.pace] || '—')}</span>
          </li>
        `).join('')}
      </ol>
      <div class="ts2-vc-hint">Ранжирование по числу закрытых задач в активном спринте. Для бенчмарка между командами — учитывайте разный размер команд (см. ${sorted.length} команд).</div>
    `;
  } else if (viewMode === 'trend') {
    // Тренд: для каждого pk пытаемся выжать историю из history snapshots.
    // Если history содержит только aggregate — показываем aggregate тренд +
    // current snapshot per pk.
    const days = history.length;
    if (days < 2) {
      body = `<div class="ts2-empty-text">Недостаточно истории для тренда (нужно минимум 2 дня снапшотов). Сейчас: ${days}. Тренд появится через сутки после S10 deploy.</div>`;
    } else {
      // Aggregate trend (то что у нас точно есть).
      const series = history.map(h => h?.sprintGoal?.aggregateProgress || 0);
      const seriesSpark = renderSparkline(series, { width: 220, height: 36 });
      // Per-pk current vs first snapshot delta (если history содержит per-pk).
      const rows = sorted.map(s => {
        const firstPct = s.progressPct; // если в history нет per-pk — не считаем delta
        return `
          <div class="ts2-vc-trend-row">
            <span class="ts2-vc-trend-pk">${esc(s.pk)}</span>
            <span class="ts2-vc-trend-now">${s.progressPct}%</span>
            <span class="ts2-lag-lab">сейчас</span>
            <span class="ts2-lag-sep">·</span>
            <span class="ts2-vc-trend-pace ts2-sprint-pace-${s.pace || 'no-data'}">${esc(PACE_LABEL[s.pace] || '—')}</span>
          </div>
        `;
      }).join('');
      body = `
        <div class="ts2-vc-trend-aggregate">
          <span class="ts2-vc-trend-lab">Aggregate за ${days} ${plural(days, ['день', 'дня', 'дней'])}:</span>
          ${seriesSpark}
        </div>
        <div class="ts2-vc-trend-rows">${rows}</div>
        <div class="ts2-vc-hint">Aggregate sparkline = sprint progress всех команд вместе (history snapshot'ы). Per-pk история требует расширения snapshot-shape (S12 work).</div>
      `;
    }
  }

  return `
    <div class="ts2-velocity-comparison" role="region" aria-label="Сравнение команд по velocity">
      <div class="ts2-vc-header">
        <span class="ts2-vc-title">Сравнение команд</span>
        ${tabs}
      </div>
      <div class="ts2-vc-body">${body}</div>
    </div>
  `;
}

/**
 * V20 S10.5 — Persistent team-switcher (segmented tabs).
 *
 * Pilot finding (Dmitry, руководитель отдела с 4 командами): «сейчас scanner
 * однокомандный, я меняю project keys в настройках каждый раз. Срывает
 * 1-2 минуты visit в 4-минутный quest».
 *
 * Решение: segmented tabs над team-glance. Сохраняется в localStorage
 * (`q2_scanner2_selectedTeam`). При >1 проекте — рендерим, иначе скрываем.
 * Активный таб — stripe-left 2px (отличается от 3px на row, чтобы не
 * конкурировать с row-selection accent в Spine-pill системе).
 *
 * `+ ВСЕ` режим = `_activeView='multi'` (table сводок).
 *
 * @param {object} model — { projectKeys: string[] }
 * @param {object} ctx — { activeView: 'team'|'multi', activePkFilter: string }
 */
export function renderTeamSwitcher(model, ctx = {}) {
  const pks = (model?.projectKeys || []).slice().sort();
  // V20 S12 U2 — даже если 1 команда, рендерим контейнер чтобы sprint-filter
  // badge имел место. Если 0 команд — ничего не показываем.
  if (pks.length === 0) return '';
  const activeView = ctx.activeView || 'team';
  const activePk = ctx.activePkFilter || '';
  const tabs = pks.length >= 2 ? pks.map(pk => {
    const isActive = activeView === 'team' && activePk === pk;
    const isDefault = activeView === 'team' && !activePk && pk === pks[0];
    const cls = (isActive || isDefault) ? 'ts2-team-tab ts2-team-tab-active' : 'ts2-team-tab';
    const ariaSelected = (isActive || isDefault) ? 'true' : 'false';
    return `<button type="button" class="${cls}" data-switch-team="${esc(pk)}"
              role="tab" aria-selected="${ariaSelected}"
              title="Переключиться на команду ${esc(pk)}">${esc(pk)}</button>`;
  }).join('') : '';
  const allActive = activeView === 'multi';
  const allCls = allActive ? 'ts2-team-tab ts2-team-tab-all ts2-team-tab-active' : 'ts2-team-tab ts2-team-tab-all';
  const tabsBlock = pks.length >= 2
    ? `<div class="ts2-team-switcher-tabs" role="tablist" aria-label="Переключатель команд">
         ${tabs}
         <span class="ts2-team-switcher-sep">·</span>
         <button type="button" class="${allCls}" data-switch-team="__all__"
                 role="tab" aria-selected="${allActive ? 'true' : 'false'}"
                 title="Сводка по всем командам в одной таблице">+ Все</button>
       </div>`
    : '';
  // V20 S12 U2 — sprint-filter chip рядом с tabs (state-modifier, навигация).
  const sf = ctx.sprintFilter || {};
  let sprintFilterChip = '';
  if (sf.requested) {
    if (sf.applied) {
      sprintFilterChip = `<span class="ts2-sprint-filter-chip ts2-sprint-filter-on" role="status" title="Фильтр активирован через ⋯ → «Только активный спринт». Это label-индикатор (не кнопка) — клик не переключает. Изменить через kebab-меню.">${Icons.get('settings', { cls: 'btn-icon', size: 10 })} только активный спринт${sf.sprintIssueKeyCount > 0 ? ` <span class="ts2-sprint-filter-num">${sf.sprintIssueKeyCount}</span>` : ''}</span>`;
    } else if (sf.failOpenReason === 'api-error') {
      sprintFilterChip = `<span class="ts2-sprint-filter-chip ts2-sprint-filter-error" role="alert" title="Sprint API упал — фильтр не применён. Открой Диагностику.">ошибка sprint-API</span>`;
    } else {
      sprintFilterChip = `<span class="ts2-sprint-filter-chip ts2-sprint-filter-warn" role="status" title="Активного спринта нет ни у одной команды. Показаны все задачи.">нет активного спринта</span>`;
    }
  }
  // V20 S12 — search by name (U9). Sticky input в header.
  const searchInput = `<input type="search" class="ts2-team-search" id="ts2-search-input"
    placeholder="/ найти" aria-label="Поиск по имени сотрудника" autocomplete="off"
    value="${esc(ctx.searchQuery || '')}">`;
  return `
    <div class="ts2-team-switcher">
      ${tabsBlock}
      <div class="ts2-team-switcher-meta">
        ${searchInput}
        ${sprintFilterChip}
      </div>
    </div>
  `;
}

/** V20 S1.5 — humanize cache age для stale-banner: «3 мин», «12 мин», «1 ч». */
function _humanizeAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} сек`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  const hr = Math.round(min / 60);
  return `${hr} ч`;
}

/* Phase 3 D1 — словарь Призмы. «Курс / дрейф» вместо «pace / отстаёт».
   Брендбук §1 — концепция компас/курс/ориентир, §7 ToV — без жаргона. */
const PACE_LABEL = {
  'ahead':    'Опережение',
  'on-track': 'По курсу',
  'behind':   'Дрейф',
  'no-data':  'нет дат',
};

/** V18.1 P7-S2.1 + S4.4 — Sprint Goal gauge: aggregate + per-pk pills.
 *  Anna PO pilot finding: «aggregate скрывает асимметрию, если Backend
 *  behind а Platform ahead — aggregatePace='behind' и я не понимаю кого
 *  тянуть. Per-pk breakdown в gauge'е нет — приходится открывать
 *  tooltip и копать sg.sprints[]».
 *
 *  S4.4 fix: если несколько спринтов → показываем per-pk пилюли рядом
 *  с aggregate. Если один — старое поведение (одиночный gauge).
 */
/**
 * V20 S8 #10 — Narrative builder для PO/CTO meeting. Возвращает 1-2 предложения
 * «say-this-string» которое PO может скопировать в Slack/слайды.
 */
function _buildSprintNarrative(sg, slope) {
  if (!sg || !sg.sprints?.length) return '';
  const pct = sg.aggregateProgress;
  const pace = sg.aggregatePace;
  const lines = [];
  // Pace claim.
  // Phase 3 D1 — нарратив на «курсе/дрейфе», без «отстаёт от плана».
  if (pace === 'behind')   lines.push(`Команда в дрейфе от курса (${pct}% сделано).`);
  else if (pace === 'ahead')   lines.push(`Команда опережает курс (${pct}%).`);
  else if (pace === 'on-track') lines.push(`Команда идёт по курсу (${pct}%).`);
  else                          lines.push(`Прогресс ${pct}% (даты спринтов не настроены).`);
  // Asymmetry: most-behind sprint pulls down.
  if (sg.sprints.length > 1) {
    const sorted = [...sg.sprints].sort((a, b) => (a.progressPct || 0) - (b.progressPct || 0));
    const worst = sorted[0];
    const best  = sorted[sorted.length - 1];
    if (worst && best && (best.progressPct - worst.progressPct) >= 25) {
      lines.push(`${worst.pk} тянет вниз (${worst.progressPct}%), ${best.pk} впереди (${best.progressPct}%).`);
    }
  }
  // Slope.
  if (slope && slope.trend === 'up')   lines.push(`Тренд за ${slope.days} дней — ускорение (+${slope.slope}%/день).`);
  else if (slope && slope.trend === 'down') lines.push(`Тренд за ${slope.days} дней — замедление (${slope.slope}%/день).`);
  return lines.join(' ');
}

function renderSprintGauge(sg, prevSg, slope) {
  const pct = sg.aggregateProgress;
  const pace = sg.aggregatePace;
  const paceLabel = PACE_LABEL[pace] || '—';
  // V20 S8 #10 — narrative for PO. Передаётся в title gauge'а — hover открывает.
  const narrative = _buildSprintNarrative(sg, slope);
  const firstSprint = sg.sprints[0];
  const daysLeft    = firstSprint?.daysLeft;
  const daysSuffix  = (typeof daysLeft === 'number')
    ? ` · ${daysLeft} ${plural(daysLeft, ['день', 'дня', 'дней'])}`
    : '';
  // V18.1 P7-S4.2 — sprint progress delta vs previous snapshot.
  const dProgress = prevSg ? renderDelta(pct, prevSg.aggregateProgress) : '';
  // V20 S7 A4 — slope arrow если есть данные за ≥3 дня.
  // V20 S8 #8 — слово «стагнация» зарезервировано для flat. Падение → «падение».
  // V20 S8.5 #9 — единое слово «→ ровно» для flat (раньше было «стагнация» здесь
  // и «flat» в slopeMini — пилот заметил несогласованность).
  // 2026-05-11 — R² confidence indicator visibly. Раньше R² только в title,
  // тимлид не различал «реальный тренд (R²=0.85)» от «шум (R²=0.3)».
  // Если R²<0.5 — добавляем `?` маркер + grayed-out class (low confidence).
  const r2Num = Number(slope?.r2 || 0);
  const lowConfidence = r2Num > 0 && r2Num < 0.5;
  const r2Interp = r2Num >= 0.85 ? 'высокая уверенность'
                 : r2Num >= 0.5 ? 'средняя уверенность'
                 : r2Num > 0    ? 'низкая уверенность — возможно шум'
                 : 'нет данных';
  const slopeChip = (slope && slope.trend !== 'no-data')
    ? `<span class="ts2-sprint-slope ts2-sprint-slope-${slope.trend}${lowConfidence ? ' ts2-sprint-slope-noisy' : ''}" title="Тренд за ${slope.days} ${plural(slope.days, ['день', 'дня', 'дней'])} · R²=${slope.r2} (${r2Interp})">${
        slope.trend === 'up'   ? `↗ +${slope.slope}%/день` :
        slope.trend === 'down' ? `↘ ${slope.slope}%/день — падение` :
                                  '→ ровно'
      }${lowConfidence ? ` <small class="ts2-slope-r2-hint" title="Низкая статистическая уверенность: R²=${slope.r2} < 0.5 (${r2Interp}). Тренд может быть шумом, а не настоящим направлением. Нужно больше дней наблюдения." aria-label="низкая статистическая уверенность">?</small>` : ''}</span>`
    : '';
  // V20 S7 A4 — sprint-mean (sprint-weighted) рядом с aggregate (issue-weighted).
  // Раскрывает асимметрию: spring-200/10% vs sprint-20/90% → mean=50% vs aggregate=18%.
  const meanChip = (sg.sprintMeanProgress != null && sg.sprintMeanProgress !== sg.aggregateProgress && sg.sprints.length > 1)
    ? `<span class="ts2-sprint-mean" title="Sprint-weighted mean (без issue-weighting) — раскрывает асимметрию между большими и малыми спринтами">~${sg.sprintMeanProgress}%</span>`
    : '';

  // Один sprint — без перегрузки UI, оставляем legacy single-gauge.
  if (sg.sprints.length <= 1) {
    const sprintName  = firstSprint?.name ? esc(firstSprint.name) : '';
    const tipShort = narrative
      ? `${narrative}\n— — —\n${sg.aggregateDone}/${sg.aggregateTotal} done · pace: ${paceLabel}${daysSuffix}`
      : `Sprint Goal: ${sg.aggregateDone}/${sg.aggregateTotal} done · pace: ${paceLabel}${daysSuffix}`;
    return `
      <div class="ts2-sprint-gauge ts2-sprint-pace-${pace}" title="${esc(tipShort)}">
        <span class="ts2-sprint-label" title="спринт Jira (отличается от релиза 1.20–1.22)">Спринт</span>
        <span class="ts2-sprint-name">${sprintName}</span>
        <span class="ts2-sprint-bar">
          <span class="ts2-sprint-bar-fill" style="width:${Math.min(100, pct)}%"></span>
        </span>
        <span class="ts2-sprint-pct">${pct}%</span>${dProgress}${slopeChip}
        <span class="ts2-sprint-pace">${paceLabel}${daysSuffix}</span>
      </div>
    `;
  }

  // V22+ Sprint C4 — pk-pills → bullet-graphs:
  // current progress (filled) + expected line (target tick).
  // По Tufte: asymmetry читается без чтения цифр.
  // Target pct = elapsed (по dayssLeft / sprintLength) если данные есть; иначе 50%.
  const pkPills = sg.sprints.map(s => {
    const sPace = s.pace || 'no-data';
    const sPaceLabel = PACE_LABEL[sPace] || '—';
    const sDays = (typeof s.daysLeft === 'number') ? ` · ${s.daysLeft}д` : '';
    const current = Math.max(0, Math.min(100, s.progressPct || 0));
    // Expected — где должны быть «в норме». Если есть sprintLength/elapsed — используем.
    let expected = 50;
    if (typeof s.daysLeft === 'number' && typeof s.daysTotal === 'number' && s.daysTotal > 0) {
      expected = Math.max(0, Math.min(100, Math.round((s.daysTotal - s.daysLeft) / s.daysTotal * 100)));
    } else if (typeof s.elapsedPct === 'number') {
      expected = Math.max(0, Math.min(100, s.elapsedPct));
    }
    const tooltipText = `${esc(s.pk)} «${esc(s.name || '')}» · ${s.done}/${s.total} done (${current}%) · ожидается ${expected}% · ${sPaceLabel}${sDays}`;
    return `
      <span class="ts2-sprint-pk-pill ts2-sprint-pk-bullet ts2-sprint-pace-${sPace}" title="${tooltipText}">
        <span class="ts2-sprint-pk-pill-key">${esc(s.pk)}</span>
        <span class="ts2-pk-bullet-track">
          <span class="ts2-pk-bullet-fill" style="width:${current}%"></span>
          <span class="ts2-pk-bullet-target" style="left:${expected}%"></span>
        </span>
        <span class="ts2-sprint-pk-pill-pct">${current}%</span>
      </span>
    `;
  }).join('');

  return `
    <div class="ts2-sprint-gauge ts2-sprint-gauge-multi-inline ts2-sprint-pace-${pace}" title="${esc(narrative ? narrative + '\n— — —\n' + 'Aggregate: ' + sg.aggregateDone + '/' + sg.aggregateTotal + ' · ' + paceLabel : 'Aggregate Sprint Goal: ' + sg.aggregateDone + '/' + sg.aggregateTotal + ' done · pace: ' + paceLabel + daysSuffix)}">
      <span class="ts2-sprint-label" title="спринты Jira (отличаются от релизов 1.20–1.22)">Спринты</span>
      <span class="ts2-sprint-name" title="${sg.sprints.length} параллельных спринтов в выбранных проектах">${sg.sprints.length}×</span>
      <span class="ts2-sprint-bar">
        <span class="ts2-sprint-bar-fill" style="width:${Math.min(100, pct)}%"></span>
      </span>
      <span class="ts2-sprint-pct">${pct}%</span>${meanChip}${dProgress}${slopeChip}
      <span class="ts2-sprint-pace">${paceLabel}</span>
      <span class="ts2-sprint-pk-pills">${pkPills}</span>
    </div>
  `;
}

/**
 * V20 S10.7 — Sprint lag breakdown ("9.5% отстаёт — куда копать").
 *
 * Pilot finding: «Спринт CORE 26 9.5% отстаёт — непонятно по детализации».
 * 9.5% = progressPct из computeSprintGoal. Тимлид видит число, видит pace
 * 'отстаёт', но не понимает: что НЕ закрыто, кто завис, почему.
 *
 * Решение: inline-блок под team-glance. Раскрывается через <details>
 * (collapsed by default — не давим основной экран). Внутри:
 *   · «Сделано 14/22 (63.6%) · ожидалось 73.1% · отстаём на 9.5pp»
 *   · Top-3 at-risk issues — те у которых dwellHours наибольший И issue
 *     в sprintIssues. Источник — model.participants[].blockers.
 *   · Top-3 человека в 'stop' в этой команде.
 *
 * Данные:
 *   sg          — model.scannerV2.sprintGoal
 *   model       — нужен для participants → top-stuck-people + sprintIssues
 *                 (для фильтрации at-risk).
 *
 * Возвращает '' если sg отсутствует или sprints[] пуст.
 */
export function renderSprintLagBreakdown(sg, model) {
  if (!sg?.sprints?.length) return '';
  const sprints = sg.sprints;
  const parts = model?.participants || [];
  // Множество active-sprint-issue-keys для фильтрации блокеров. Если
  // фильтр «активный спринт» уже применён в enrichment'е — в blockers
  // могут быть только sprint-keys, но проверка не повредит.
  const sprintKeySet = new Set();
  for (const pk of Object.keys(model?.spaces || {})) {
    for (const it of (model.spaces[pk]?.sprintIssues || [])) {
      if (it?.key) sprintKeySet.add(it.key);
    }
  }
  // Собираем at-risk блокеры по всем людям, дедуплицируем по issue.key,
  // сортируем по dwellHours desc.
  const blockersByKey = new Map();
  for (const p of parts) {
    for (const b of (p.blockers || [])) {
      if (!b?.key) continue;
      // Если sprint-keys пуст → не фильтруем (fail-open).
      if (sprintKeySet.size > 0 && !sprintKeySet.has(b.key)) continue;
      const prev = blockersByKey.get(b.key);
      if (!prev || (Number(b.dwellHours) || 0) > (Number(prev.dwellHours) || 0)) {
        blockersByKey.set(b.key, { ...b, _owner: p.label || p.key });
      }
    }
  }
  const topAtRisk = Array.from(blockersByKey.values())
    .sort((a, b) => (Number(b.dwellHours) || 0) - (Number(a.dwellHours) || 0))
    .slice(0, 3);
  // Top stuck — люди в группе 'stop' в этой команде. Сортируем по числу
  // блокеров desc. Только в случае single-team selection: при multi
  // blockers смешиваются — даём общий список, но без team-context.
  const stuckPeople = parts
    .filter(p => classifyPerson(p) === 'stop')
    .map(p => ({
      key:   p.key,
      label: p.label || p.key,
      blockerCount: (p.blockers || []).length,
      maxDwell: Math.max(0, ...(p.blockers || []).map(b => Number(b?.dwellHours) || 0)),
    }))
    .sort((a, b) => b.maxDwell - a.maxDwell)
    .slice(0, 3);

  // Per-sprint metrics rows.
  const sprintRows = sprints.map(s => {
    const lagPp = (Number.isFinite(s.idealPct) && Number.isFinite(s.progressPct))
      ? Math.round((s.idealPct - s.progressPct) * 10) / 10
      : null;
    const expectedTxt = Number.isFinite(s.idealPct) ? `${s.idealPct}%` : '—';
    // V20 S11.1 BUG-7 — корректные edge cases:
    //  · idealPct=0 (спринт начался <1ч назад) → не показываем «опережаем
    //    на N%» (false-positive). Скрываем lag-text, оставляем «—».
    //  · progressPct===idealPct → «идём по плану» (а не пустота).
    //  · |lagPp| < 0.5 → склеиваем в «идём по плану» (rounding noise).
    const sprintTooYoung = Number.isFinite(s.idealPct) && s.idealPct < 1.0; // <1% = практически 0
    const lagTxt = sprintTooYoung
      ? 'спринт только начался'
      : (lagPp == null) ? '—'
        : (lagPp >= 0.5 ? `отстаём на ${lagPp}pp`
        : (lagPp <= -0.5 ? `опережаем на ${Math.abs(lagPp)}pp`
        : 'идём по плану'));
    const daysTxt = (typeof s.daysLeft === 'number')
      ? `${s.daysLeft} ${plural(s.daysLeft, ['день', 'дня', 'дней'])} осталось`
      : 'даты не заданы';
    return `
      <div class="ts2-lag-sprint-row">
        <span class="ts2-lag-sprint-pk">${esc(s.pk)}</span>
        <span class="ts2-lag-sprint-name" title="${esc(s.name || '')}">${esc(s.name || '—')}</span>
        <span class="ts2-lag-sprint-stat">
          <span class="ts2-lag-num">${s.done}/${s.total}</span>
          <span class="ts2-lag-lab">сделано</span>
          <span class="ts2-lag-sep">·</span>
          <span class="ts2-lag-num">${s.progressPct}%</span>
          <span class="ts2-lag-lab">факт</span>
          <span class="ts2-lag-sep">·</span>
          <span class="ts2-lag-num">${expectedTxt}</span>
          <span class="ts2-lag-lab">ожидалось</span>
        </span>
        <span class="ts2-lag-sprint-pace ts2-sprint-pace-${s.pace || 'no-data'}">${esc(lagTxt)}</span>
        <span class="ts2-lag-sprint-days">${esc(daysTxt)}</span>
      </div>
    `;
  }).join('');

  const atRiskHtml = topAtRisk.length > 0
    ? `<div class="ts2-lag-section">
         <div class="ts2-lag-section-head">Топ задач в риске <span class="ts2-lag-section-hint">(дольше всего висят, входят в активный спринт)</span></div>
         <ul class="ts2-lag-list">${topAtRisk.map(b => `
           <li class="ts2-lag-list-item">
             <span class="ts2-lag-key">${jiraIssueLink(b.key)}</span>
             <span class="ts2-lag-status">${esc(b.status || '')}</span>
             <span class="ts2-lag-dwell" aria-label="время в текущем статусе" title="dwell-time = время в текущем статусе"><span aria-hidden="true">▌</span>${fmtDuration(Number(b.dwellHours) || 0)}</span>
             <span class="ts2-lag-owner">${esc(b._owner || '')}</span>
             <span class="ts2-lag-summary">${esc((b.summary || '').slice(0, 80))}</span>
           </li>`).join('')}</ul>
       </div>`
    : '';

  const stuckHtml = stuckPeople.length > 0
    ? `<div class="ts2-lag-section">
         <div class="ts2-lag-section-head">Кто завис <span class="ts2-lag-section-hint">(group=стоп, по убыванию dwell)</span></div>
         <ul class="ts2-lag-list">${stuckPeople.map(p => `
           <li class="ts2-lag-list-item">
             <button type="button" class="ts2-lag-person-link" data-jump-key="${esc(p.key)}" title="Открыть карточку">${esc(p.label)}</button>
             <span class="ts2-lag-dwell">▌${fmtDuration(p.maxDwell)}</span>
             <span class="ts2-lag-blockers">${p.blockerCount} ${plural(p.blockerCount, ['блокер', 'блокера', 'блокеров'])}</span>
           </li>`).join('')}</ul>
       </div>`
    : '';

  if (!sprintRows && !atRiskHtml && !stuckHtml) return '';
  return `
    <details class="ts2-lag-breakdown">
      <summary class="ts2-lag-summary-toggle">
        <span class="ts2-lag-toggle-label">Где дрейф? <span class="ts2-lag-toggle-hint">— разбор по спринтам, рискам и людям</span></span>
        <span class="ts2-lag-toggle-chev">▾</span>
      </summary>
      <div class="ts2-lag-body">
        <div class="ts2-lag-formula" title="Формула: progressPct = задачи_done / задачи_всего · 100. expected = (прошедшие_дни / всего_дней) · 100. Pace 'отстаём' = progressPct < expected − 10pp.">
          <span class="ts2-lag-formula-key">Как считается:</span>
          progressPct = задачи Done ÷ всего · 100 · ожидалось = (прошло дней ÷ всего дней) · 100
        </div>
        <div class="ts2-lag-sprints">${sprintRows}</div>
        ${atRiskHtml}
        ${stuckHtml}
      </div>
    </details>
  `;
}

/* ── Team glance — single-line summary ─────────────── */

export function renderTeamGlance(model, ctx = {}) {
  const parts = model?.participants || [];
  // V18.1 P2 — counts per classified group. Дают prevailing read'у тимлида
  // за 1 секунду: «куда смотреть в первую очередь?»
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  // V20 S10.4 — расширенный aggregate: все 4 источника + блокеры.
  // Pилот feedback: «вижу commits/PR/CF, но Zephyr и block-count прячутся
  // в side-panel — нужны в шапке как первый сигнал».
  let commits48h = 0, prs48h = 0, conf48h = 0;
  let testsCreated48h = 0, testsExecuted48h = 0;
  let blockerTotal = 0, dwellMaxTeam = 0;
  for (const p of parts) {
    counts[classifyPerson(p)]++;
    commits48h       += p.badges?.commits48h       || 0;
    prs48h           += p.badges?.pr48h            || 0;
    // V18.1 P6.2 — Confluence info теперь видна в team-glance.
    conf48h          += p.badges?.conf48h          || 0;
    // V20 S10.4 — Zephyr (testsCreated48h / testsExecuted48h уже считается
    // в portfolioPulseModel при hydrate из Zephyr API, S9 deploy).
    testsCreated48h  += p.badges?.testsCreated48h  || 0;
    testsExecuted48h += p.badges?.testsExecuted48h || 0;
    // V20 S10.4 — total блокеров команды (>= dwell threshold). dwellMaxTeam
    // — самый большой dwell-time в команде (worst-case sentinel для шапки).
    // V20 S11.1 BUG-6 — НЕ использовать Math.max(...arr): при пустом
    // blockers даст -Infinity. for...of цикл устойчив к пустому массиву.
    const bl = Array.isArray(p.blockers) ? p.blockers : [];
    blockerTotal += bl.length;
    for (const b of bl) {
      const dh = Number(b?.dwellHours) || 0;
      if (Number.isFinite(dh) && dh > dwellMaxTeam) dwellMaxTeam = dh;
    }
  }
  // V20 S11.1 BUG-6 — defensive cap: иногда Jira возвращает гигантские
  // dwellHours (e.g. 50000ч ≈ 5.7 года) для archived issues. В шапке такая
  // строка ломает узкую колонку. Capping на 99999ч (~11 лет) сохраняет
  // sentinel-семантику «очень давно» без overflow.
  if (dwellMaxTeam > 99999) dwellMaxTeam = 99999;
  // V18.1 P7-S4.2 — trend-deltas из prev snapshot (если есть).
  const prev = ctx.prev || null;
  const dMoving = prev ? renderDelta(counts.moving, prev.counts?.moving) : '';
  const dWatch  = prev ? renderDelta(counts.watch,  prev.counts?.watch,  { positiveIsBad: true }) : '';
  const dStop   = prev ? renderDelta(counts.stop,   prev.counts?.stop,   { positiveIsBad: true }) : '';
  // V20 S12 T1 — добавляем delta и для idle (раньше не было).
  const dIdle   = prev ? renderDelta(counts.idle,   prev.counts?.idle,   { positiveIsBad: true }) : '';
  // V20 S7 A5 — anomaly badges (Z-score). Если today сильно отличается от
  // среднего за 14 дней (|z| > 2) — подсвечиваем counter с иконкой ⚠.
  const zStop   = ctx.anomalies?.stop;
  const zWatch  = ctx.anomalies?.watch;
  const zMoving = ctx.anomalies?.moving;
  const zIdle   = ctx.anomalies?.idle;
  // V20 S8 #1 — human-language anomaly. «×4 от нормы» вместо «z=+4.2».
  // Z-score сохраняем в title для гиков. Pилот: «не до статистики в 9:30».
  // 2026-05-11 — short-form для quick scan: «4×» / «-30%» / «0» вместо
  // длинных фраз. Полный текст в title-attr (на hover). Cтало возможно
  // прочитать badge за <1 сек вместо 3 сек.
  const anomalyBadge = (z) => {
    if (!z?.anomalous) return '';
    const ratio = z.mean > 0 ? (z.today / z.mean) : 0;
    let label;
    let longLabel;
    if (z.today === 0)               { label = '0';                          longLabel = 'упало до 0'; }
    else if (ratio >= 1.5)           { label = `${ratio.toFixed(1)}×`;       longLabel = `×${ratio.toFixed(1)} от нормы`; }
    else if (ratio > 0 && ratio < 0.7) { label = `−${Math.round((1 - ratio) * 100)}%`; longLabel = `−${Math.round((1 - ratio) * 100)}% от нормы`; }
    else                              { label = z.z > 0 ? '↑↑' : '↓↓';        longLabel = `аномально ${z.z > 0 ? 'много' : 'мало'}`; }
    // V20 S8.5 #7 + #20 — расширенный tooltip + clickable для mini-chart sparkline.
    // 2026-05-11 — short visual `label`, full `longLabel` в title.
    // 2026-05-12 — Z-score value (σ) виден inline как superscript для quick
    // assessment: 2σ = warning, 3σ+ = extreme. Помогает отличить «случайность»
    // от «systematic outlier».
    const zSigma = Math.abs(Number(z.z) || 0).toFixed(1);
    const zCls = Math.abs(z.z) >= 3 ? 'ts2-z-extreme' : 'ts2-z-warn';
    return `<button type="button" class="ts2-glance-anomaly ts2-glance-anomaly-${z.z > 0 ? 'up' : 'down'}" data-anomaly-metric="${esc(longLabel)}" title="${esc(longLabel)} · сегодня: ${z.today} · среднее 14д: ${z.mean} ± ${z.std} · z-score: ${z.z}. Клик → мини-график.">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 11 })} ${esc(label)}<sup class="ts2-z-sup ${zCls}">${zSigma}σ</sup></button>`;
  };

  // V18.3 A5a — group-counts кликабельны → scroll-jump к соответствующей
  // группе. Anna PO finding: «Я вижу «1 требует разговора», но чтобы
  // найти кого — скроллю. Anchor-jump к ts2-group-stop напрашивается».
  const jumpBtn = (groupKey, content) =>
    `<button type="button" class="ts2-glance-jump" data-jump-group="${groupKey}" title="Прыгнуть к группе">${content}</button>`;
  const segs = [];
  if (counts.moving > 0) segs.push(jumpBtn('moving', `<span class="ts2-glance-num">${counts.moving}</span>${dMoving}${anomalyBadge(zMoving)}<span class="ts2-glance-lab">движется</span>`));
  if (counts.watch  > 0) segs.push(jumpBtn('watch',  `<span class="ts2-glance-num ts2-glance-num-watch">${counts.watch}</span>${dWatch}${anomalyBadge(zWatch)}<span class="ts2-glance-lab">наблюдение</span>`));
  if (counts.stop   > 0) segs.push(jumpBtn('stop',   `<span class="ts2-glance-stuck">▌<span class="ts2-glance-num-stop">${counts.stop}</span>${dStop}${anomalyBadge(zStop)} ${plural(counts.stop, ['стоп', 'стоп', 'стоп'])}</span>`));
  if (counts.idle   > 0) segs.push(jumpBtn('idle',   `<span class="ts2-glance-num ts2-glance-num-muted">${counts.idle}</span>${dIdle}${anomalyBadge(zIdle)}<span class="ts2-glance-lab">без активности</span>`));
  const groupLine = segs.length ? segs.join(`<span class="ts2-glance-sep">·</span>`) : `<span class="ts2-glance-lab">Нет данных</span>`;
  // V18.1 P7-S2.1.5 — risk shelf: orphans + out-of-sprint.
  // Закрывает сигналы #6 + #7 из synthesis-плана для PO/SM.
  const risks = model?.scannerV2?.risks;
  const orphans  = risks?.totalOrphans     || 0;
  const oos      = risks?.totalOutOfSprint || 0;
  const oosRatio = risks?.outOfSprintRatio || 0;
  // V18.1 P7-S4.2 — risk-deltas: orphans/oos increasing = bad.
  const dOrphans = prev ? renderDelta(orphans, prev.risks?.totalOrphans, { positiveIsBad: true }) : '';
  const dOos     = prev ? renderDelta(oos,     prev.risks?.totalOutOfSprint, { positiveIsBad: true }) : '';
  const riskBlocks = [];
  if (orphans > 0) {
    // Sprint B (Birman): «без assignee» → «без исполнителя» + denominator из participants
    const totalIssues = (risks?.totalOrphans || 0) + (model?.scannerV2?.assignedIssuesCount || 0);
    const denom = totalIssues > orphans ? `/${totalIssues}` : '';
    const pct = totalIssues > 0 ? ` (${Math.round(orphans / totalIssues * 100)}%)` : '';
    riskBlocks.push(`<span class="ts2-glance-risk" title="Задачи в scope без исполнителя. Чем больше — тем больше работы без owner'а"><span class="ts2-glance-num-stop">${orphans}</span><span class="ts2-glance-num-denom">${denom}</span>${dOrphans} без исполнителя${pct}</span>`);
  }
  if (oos > 0) {
    const pct = Math.round(oosRatio * 100);
    // 2026-05-11 — interpretation tooltip: 5-10% = норма, >15% = warning,
    // research-team может быть 25% (норма). Helps тимлид understand context.
    const oosNorm = pct <= 10 ? 'норма (5-10%)' :
                    pct <= 20 ? 'выше нормы — возможна process issue' :
                                 'высокое — research-команда или scope-breach';
    riskBlocks.push(`<span class="ts2-glance-risk" title="Out-of-sprint: задачи которые тронуты но не входят в активный спринт. ${pct}% — ${oosNorm}"><span class="ts2-glance-num-watch">${oos}</span>${dOos} out-of-sprint ${pct > 0 ? `(${pct}%)` : ''}</span>`);
  }
  const riskLine = riskBlocks.length ? riskBlocks.join(`<span class="ts2-glance-sep">·</span>`) : '';

  const filterBadge = '';
  // V19 C2 — history sparklines (PO ask «какие новости?»).
  // Показываем только если у нас ≥ 2 daily snapshots; иначе скрыто.
  const history = Array.isArray(ctx.history) ? ctx.history : [];
  const trendRow = history.length >= 2 ? renderHistoryTrendRow(history) : '';
  // V20 S7 A1 — CRV aggregate. Median по всем reviewers — даёт «общую скорость
  // ревью команды». Если нет данных (CRV пустой) — не отображаем.
  const crv = model?.scannerV2?.codeReviewVelocity || {};
  const crvKeys = Object.keys(crv);
  const crvMedians = crvKeys.map(k => crv[k].medianHours).filter(Number.isFinite);
  crvMedians.sort((a, b) => a - b);
  const crvMedian = crvMedians.length ? crvMedians[Math.floor(crvMedians.length / 2)] : null;
  // V20 S8 #4 — compact-полоска: «команда: ↗ · CR 6ч · 80% PR»
  // Pилот feedback: «три элемента конкурируют за внимание». Объединяем.
  // CR-badge кликабельный (S8 #2) → drill-down в slow-reviewers.
  const crvBadge = crvMedian != null
    ? `<button type="button" class="ts2-glance-crv ts2-glance-crv-${crvMedian > 24 ? 'slow' : crvMedian > 8 ? 'warn' : 'ok'}" id="ts2-glance-crv-drilldown" title="Медиана времени до первого ревью (Code Review). Клик — список самых долгих ревью.">До первого ревью: ~${crvMedian}ч</button>`
    : '';
  // V20 S7 A1 — PR throughput aggregate. Подсчитываем sum opened/merged за 7 дней.
  const prT = model?.scannerV2?.prThroughput || {};
  let prOpened = 0, prMerged = 0, prOverloadCount = 0;
  for (const k of Object.keys(prT)) {
    prOpened += prT[k].opened || 0;
    prMerged += prT[k].merged || 0;
    if (prT[k].flag === 'overload') prOverloadCount++;
  }
  const prRate = prOpened > 0 ? Math.round(prMerged / prOpened * 100) : 0;
  // 2026-05-11 — PR merge-rate color-coding. Threshold 70% есть в
  // METRIC_THRESHOLDS.prHealthyRateThreshold, но раньше UI не использовал —
  // показывал просто `30%` без сигнала. Теперь rate < 70 = warning class,
  // < 40 = danger class. На быстром скане сразу видно «поток заблокирован».
  const prRateClass = prRate < 40 ? 'ts2-glance-pr-throughput-bad'
                    : prRate < 70 ? 'ts2-glance-pr-throughput-warn'
                    : 'ts2-glance-pr-throughput-good';
  // Sprint B: human-readable «PR за неделю: 18 из 32 (56%)», unicode-emoji убраны из tooltip
  const prBadge = prOpened > 0
    ? `<span class="ts2-glance-pr-throughput ${prRateClass}" title="${prMerged} merged из ${prOpened} opened за 7 дней (${prRate}%). Норма ≥70%. ${prRate < 70 ? 'Ниже нормы — возможна задержка в потоке' : 'В норме'}.${prOverloadCount > 0 ? ' ' + prOverloadCount + ' человек(а) перегружены (>5 PR, mergeRate <0.4)' : ''}">PR за неделю: <strong>${prMerged}</strong> из ${prOpened} (${prRate}%)${prOverloadCount ? ` · ${Icons.get('alert-triangle', { cls: 'btn-icon', size: 12 })} ${prOverloadCount}` : ''}</span>`
    : '';
  // V20 S13 I5 — PR cycle time p50/p90 (open → merged).
  const prCycle = computePrCycleTime(model);
  const prCycleBadge = (prCycle.count >= 3)
    ? `<span class="ts2-glance-pr-cycle" title="PR cycle time (open→merged) за окно. P50/P90 на ${prCycle.count} PR.">PR cycle: ${fmtDuration(prCycle.p50Hours)} / P90 ${fmtDuration(prCycle.p90Hours)}</span>`
    : '';
  // V20 S13 I8 — CR queue depth per reviewer (top overloaded).
  const crQueue = computeCrQueueDepth(model);
  // 2026-05-11 — CR Load Gini добавлен для visibility распределения нагрузки.
  // Gini > 0.5 → unfair distribution (один-два ревьюера на всё).
  const crGini = computeCrLoadGini(model);
  // Sprint B (Birman): убрали Gini-индикатор как «инженерная гордость» —
  // оставили только human-фразу про top-reviewer load.
  const crGiniBadge = crGini.totalReviewers >= 3 && crGini.gini > 0.5
    ? `<span class="ts2-glance-cr-gini ts2-glance-cr-gini-warn" title="Top ревьюер делает ${crGini.topReviewerPct}% всей нагрузки. Рекомендуется перераспределить.">Top ревьюер: ${crGini.topReviewerPct}% нагрузки</span>`
    : '';
  // Sprint B: «CR-queue: Рзаев (10) +4» → «Очередь к ревьюерам: у Рзаева 10 PR, +4 коллег»
  const crQueueBadge = crQueue.length > 0
    ? `<span class="ts2-glance-cr-queue" title="Топ ревьюеров с большой очередью PR на ревью: ${crQueue.map(r => `${r.label} (${r.openPrCount})`).join(', ')}.">Очередь к ревьюерам: у ${crQueue[0].label} ${crQueue[0].openPrCount} PR${crQueue.length > 1 ? `, +${crQueue.length - 1} коллег` : ''}${crGiniBadge}</span>`
    : crGiniBadge;
  // V20 S14 I13 — Blocker MTTR. Sprint B: «MTTR» → «Блокеры висят» (PM-friendly)
  const mttr = computeBlockerMTTR(model);
  const mttrBadge = mttr.mttrHours != null && mttr.count >= 3
    ? `<span class="ts2-glance-mttr" title="Среднее время жизни блокера (mean time to resolution): ${mttr.count} штук. Текущая аппроксимация — mean(dwellHours) на open.">Блокеры висят: ~${fmtDuration(mttr.mttrHours)}</span>`
    : '';
  // V20 S8 #4 — slope из ctx (передаётся orchestrator'ом из history).
  const slope = ctx.sprintGoalSlope;
  const slopeMini = (slope && slope.trend !== 'no-data')
    ? `<span class="ts2-glance-slope ts2-glance-slope-${slope.trend}" title="Sprint goal тренд за ${slope.days} дней · R²=${slope.r2}. Клик «Как считается» → секция «Тренды».">${
        slope.trend === 'up'   ? `${Icons.get('arrow-up-right',   { cls: 'btn-icon', size: 10 })} +${slope.slope}%/день` :
        slope.trend === 'down' ? `${Icons.get('arrow-down-right', { cls: 'btn-icon', size: 10 })} ${slope.slope}%/день` :
                                 `${Icons.get('arrow-right',       { cls: 'btn-icon', size: 10 })} ровно`
      }</span>`
    : '';

  // V20 S10.4 — sources line с domain-prefix'ами + Zephyr + блокеры.
  // Pilot finding: «остальные метрики (Zephyr, блок-count) спрятаны в side-panel
  // или per-row badges». Designer: группировка `git: ... · cf: ... · zephyr: ...`
  // для читаемости. Zephyr-секция и блок-count рендерятся только при N>0.
  const zephyrSec = (testsCreated48h > 0 || testsExecuted48h > 0)
    ? `<span class="ts2-glance-sep">··</span>
       <span class="ts2-glance-domain">zephyr:</span>
       ${testsCreated48h > 0 ? `<span class="ts2-glance-num">${testsCreated48h}</span><span class="ts2-glance-lab">${plural(testsCreated48h, ['тест', 'теста', 'тестов'])} (48ч)</span>` : ''}
       ${testsCreated48h > 0 && testsExecuted48h > 0 ? '<span class="ts2-glance-sep">·</span>' : ''}
       ${testsExecuted48h > 0 ? `<span class="ts2-glance-num">${testsExecuted48h}</span><span class="ts2-glance-lab">${plural(testsExecuted48h, ['прогон', 'прогона', 'прогонов'])} (48ч)</span>` : ''}`
    : '';
  // V20 S10.4 — block-count: сколько активных блокеров у команды +
  // worst-case dwell. Сигнал: «есть ли что-то критическое прямо сейчас».
  // 2026-05-11 — blocker count rate (per-team-size context). «3 блокера»
  // для team из 5 = crisis (60%), для team из 50 = норма (6%).
  const teamSize = Math.max(1, (model?.participants || []).length);
  const blockRate = (blockerTotal / teamSize);
  const blockRateCls = blockRate > 0.20 ? 'ts2-glance-num-stop'
                     : blockRate > 0.10 ? 'ts2-glance-num-watch'
                     : 'ts2-glance-num';
  const blockerSec = blockerTotal > 0
    ? `<span class="ts2-glance-sep">··</span>
       <span class="ts2-glance-domain">блок:</span>
       <span class="ts2-glance-num ${blockRateCls}" title="${blockerTotal} блокеров на команду ${teamSize}. ${blockRate > 0.20 ? 'высокая концентрация' : blockRate > 0.10 ? 'умеренно' : 'в норме'} (rate ${Math.round(blockRate * 100)}%)">${blockerTotal}</span>
       <span class="ts2-glance-lab">${plural(blockerTotal, ['блокер', 'блокера', 'блокеров'])}</span>
       ${dwellMaxTeam >= 24 ? `<span class="ts2-glance-sep">·</span><span class="ts2-glance-lab" title="Худший dwell-time блокера в команде">макс ${fmtDuration(dwellMaxTeam)}</span>` : ''}`
    : '';
  // V20 S12 U2 — sprint-filter badge переехал в renderTeamSwitcher (chip
  // рядом с табами); тут больше не рендерим. Это state-modifier, должен
  // жить в зоне навигации, не в data flow.
  // V20 S12 U3 — порядок строк изменён: counts → velocity (важнее всего) →
  // sources → risks → trends. Velocity больше не «4-я строка», тимлид видит
  // sprint-slope сразу под group-counts.
  // Phase 3 C2 — Inverted pyramid:
  //   L1 Hero (всегда виден): groupLine + velocity + sources + risks + healthHero
  //   L2 Сегодня (открыто): Daily brief + Action queue
  //   L3 Люди — рендерится снаружи (renderPersonRows)
  //   L4 Операции — <details> с sprint health, churn, stale PRs, accuracy, …
  //   L5 Тренды — <details> с history-trend row
  //   Sub-tab «Глубже» — только sleeping data insights (renderSleepingDataInsights).
  // 2026-05-12 — Dwell-threshold mode label. Показывает active config:
  // default (24ч) / research (48ч) / hotfix (8ч). Помогает тимлиду
  // понять «почему 24h code-review не warning» — потому что mode=research.
  const dwellCfg = model?.scannerV2?.dwellThresholds;
  const dwellMode = (() => {
    if (!dwellCfg) return '';
    const def = Number(dwellCfg.default) || 24;
    if (def <= 12) return 'hotfix';
    if (def >= 36) return 'research';
    return 'default';
  })();
  const dwellModeLabel = dwellMode && dwellMode !== 'default'
    ? `<span class="ts2-glance-mode" title="Active dwell-threshold mode: ${dwellMode}. Code-review threshold: ${dwellCfg?.codeReview || '?'}ч, в работе: ${dwellCfg?.inProgress || '?'}ч, default: ${dwellCfg?.default || '?'}ч. Сменить через Настройки → Sensitivity.">mode: ${dwellMode}</span>`
    : '';
  const heroBlock = `
    ${filterBadge}
    ${dwellModeLabel}
    <div class="ts2-glance-line">
      ${groupLine}
    </div>
    ${(() => {
      const velocityRow = (crvBadge || prBadge || slopeMini || prCycleBadge || crQueueBadge || mttrBadge) ? `<div class="ts2-glance-line ts2-glance-velocity-row">
        <span class="ts2-glance-velocity-label">Команда:</span>
        ${slopeMini}
        ${slopeMini && crvBadge ? '<span class="ts2-glance-sep">·</span>' : ''}
        ${crvBadge}
        ${crvBadge && prBadge ? '<span class="ts2-glance-sep">·</span>' : ''}
        ${prBadge}
        ${(prBadge || crvBadge) && prCycleBadge ? '<span class="ts2-glance-sep">·</span>' : ''}
        ${prCycleBadge}
        ${(prCycleBadge || prBadge) && crQueueBadge ? '<span class="ts2-glance-sep">·</span>' : ''}
        ${crQueueBadge}
        ${(crQueueBadge || prCycleBadge) && mttrBadge ? '<span class="ts2-glance-sep">·</span>' : ''}
        ${mttrBadge}
      </div>` : '';
      const healthHero = renderTeamHealthHero(model, ctx.history || []);
      // PR-CO — Health-блок пристёгнут справа к строке «Команда: ↗ · CR · PR · …».
      // Если есть оба блока — заворачиваем в flex-контейнер. Если нет велосити-строки —
      // Health всё равно нужен, рендерим отдельно (ниже sources-row).
      if (velocityRow && healthHero) {
        return `<div class="ts2-glance-velocity-with-health">${velocityRow}${healthHero}</div>`;
      }
      return velocityRow;
    })()}
    <div class="ts2-glance-line ts2-glance-sources-row">
      <span class="ts2-glance-domain">git:</span>
      <span class="ts2-glance-num">${commits48h}</span>
      <span class="ts2-glance-lab">${plural(commits48h, ['коммит', 'коммита', 'коммитов'])} (48ч)</span>
      <span class="ts2-glance-sep">·</span>
      <span class="ts2-glance-num">${prs48h}</span>
      <span class="ts2-glance-lab">PR (48ч)</span>
      <span class="ts2-glance-sep">··</span>
      <span class="ts2-glance-domain">cf:</span>
      <span class="ts2-glance-num">${conf48h}</span>
      <span class="ts2-glance-lab">${plural(conf48h, ['правка', 'правки', 'правок'])} (48ч)</span>
      ${zephyrSec}
      ${blockerSec}
    </div>
    ${riskLine ? `<div class="ts2-glance-line ts2-glance-risk-row">${riskLine}</div>` : ''}
    ${(() => {
      // Если велосити-строки нет — рендерим Health отдельно (стандартный путь).
      const hasVelocity = (crvBadge || prBadge || slopeMini || prCycleBadge || crQueueBadge || mttrBadge);
      return hasVelocity ? '' : renderTeamHealthHero(model, ctx.history || []);
    })()}
  `;

  // Phase 3 C2 — «Глубже» tab: только sleeping data. Hero и tab-bar сохраняем —
  // пользователь не теряет ориентацию, переключение возвращает обратно.
  if (getScannerTab() === 'deeper') {
    // V22 fix #11 (2026-05-09 UX) — в team-view рендерим только PK-aware tile'ы
    // (sub-task by epic, per-author worklog по членам команды). Cross-team
    // плитки переехали в multi-view (+Все) — см. renderMultiTeamView.
    const pkFilter = ctx.pkFilter || '';
    const sleepingHtml = renderSleepingDataInsights(model, { scope: 'team', pkFilter });
    const paneBody = sleepingHtml || _renderDeeperEmptyState(model, { scope: 'team', pkFilter });
    const howto = `
      <div class="ts2-deeper-howto" role="note">
        <div class="ts2-deeper-howto-title">Что здесь:</div>
        <div class="ts2-deeper-howto-text">
          Только плитки относящиеся к выбранной команде${pkFilter ? ` <b>${esc(pkFilter)}</b>` : ''}: закрытие подзадач по эпикам команды + логи времени её участников.
          Cross-team метрики (Resolution split, Готовность релизов, Метрики PR, DORA, Big-metrics) переехали в подвкладку «+&nbsp;Все».
        </div>
      </div>`;
    return `
      <div class="ts2-glance ts2-glance--deeper" data-scanner-tab="deeper">
        ${heroBlock}
        ${_renderScannerTabBar()}
        <div class="ts2-deeper-pane">
          ${howto}
          ${paneBody}
        </div>
      </div>
    `;
  }

  // V21 — «Тренды» tab: ECharts dashboard (Phase 1 — 2 demo charts; Phase 2 — 60 charts).
  // Visible-label «Тренды» (AUDIT_HOLISTIC O7); internal data-scanner-tab остался "metrics".
  // Тот же modifier-class паттерн, что у deeper — скрывает person-rows ниже.
  if (getScannerTab() === 'metrics') {
    return `
      <div class="ts2-glance ts2-glance--deeper ts2-glance--metrics" data-scanner-tab="metrics">
        ${heroBlock}
        ${_renderScannerTabBar()}
        <div class="ts2-metrics-howto" role="note">
          <div class="ts2-metrics-howto-title">Что здесь:</div>
          <div class="ts2-metrics-howto-text">
            Графики динамики метрик за последние недели — спринт-velocity, сроки PR, темп закрытия задач, переоткрытия.
            Восходящие линии по PR-cycle и stale-задачам = команда замедляется. Часть графиков агрегирует все команды —
            для cross-team картины переключитесь на «+&nbsp;Все».
          </div>
        </div>
        <div class="ts2-metrics-pane" id="ts2-metrics-mount"></div>
      </div>
    `;
  }

  // V22+ (2026-05-17) — hygiene-tab переехал в подвкладку Интеграции → Гигиена.
  // Engine `integrations/jiraHygiene.js` остаётся, теперь используется
  // `integrations/hygiene/hygiene.js` orchestrator'ом отдельной подвкладки.

  // Phase 3 C2 — «Сегодня» (default) tab: L2 «Сегодня» + collapsible L4 «Операции» + L5 «Тренды».
  // L4 объединяет sprint health, scope churn, stale PRs, estimate accuracy, onboarding ramp,
  // solo author, zombie issues, sprint lag breakdown — всё это data «для разбора», не для
  // утреннего beat. Открывается одним кликом по `<details>`.
  // L5 = trendRow — sparklines, история. Открывается отдельно.
  // AUDIT_ARTDIRECTION #33 (Phase 1) — room-headers (CAPS eyebrow + 32px space)
  // вокруг «Операции» и «Тренды». Стили инжектятся через `_ensureScannerRoomStyles()`.
  // Today (daily-brief / action-queue) — без eyebrow, это primary context экрана.
  _ensureScannerRoomStyles();
  // V22 (2026-05-09 UX) — секция «Операции» перенесена в multi-view (+Все),
  // потому что её tile'ы агрегируют по всем командам и в team-view путали
  // («выбрана команда — а данные не отфильтрованы»). См. renderMultiTeamView.
  const operationsSection = '';
  // V22 (2026-05-09 UX) — переименовано из «Тренды» (дублировал название
  // подвкладки) в «История за 14 дней» с явным hint'ом «как читать».
  const trendsSection = trendRow
    ? `<section class="ts2-room ts2-room-trends" aria-labelledby="ts2-room-trends-eyebrow">
         <div class="ts2-room-eyebrow" id="ts2-room-trends-eyebrow">История за 14 дней</div>
         <details class="ts2-section-trends" data-key="ts2-l5-trends">
           <summary class="ts2-section-trends-summary">
             Раскрыть
             <span class="ts2-section-trends-hint">— спарклайны: «Требует внимания», «Out-of-sprint», прогресс по спринту</span>
           </summary>
           <div class="ts2-section-trends-howto" role="note">
             <strong>Как читать:</strong> каждая мини-диаграмма — изменение метрики по дням.
             Левый край — 14 дней назад, правый — сегодня. Высота столбика — значение в этот день.
             Восходящий тренд по «Требует внимания» = команда дрейфует, нисходящий — стабилизация.
             По «Прогрессу спринта» — наоборот: восходящий = идём по плану.
           </div>
           ${trendRow}
         </details>
       </section>`
    : '';
  // V22 — story-line («Замечен дрейф / Команда работает в норме») убрана
  // по UX-фидбеку 2026-05-09: дублировала group-counts-стрипу.
  const storyLine = '';

  // V22 — identity-coverage banner удалён по UX-фидбеку (2026-05-09):
  // confluence/bb-coverage метрики остаются доступны в Diagnostic-modal,
  // inline-баннер мешал основному контенту команды.
  //
  // 2026-05-17 (D2/D3 fix) — возвращён banner ТОЛЬКО для критично-низкого
  // coverage (<30% CF или <50% BB на команде ≥30 человек). Это сигнал что
  // основная часть BB/CF активности теряется, и без bulk Auto-Resolve
  // Scanner показывает ~15% реальной картины. Banner можно скрыть на
  // 7 дней через × — флаг в localStorage `q2_id_banner_dismissed_at`.
  const identityBanner = _renderIdentityCoverageBanner(model);
  // 2026-05-11 — SSO-redirect баннер убран из Сканнера (банер мешал основному
  // контенту и часто давал false-positive на инсталляциях типа Сбер DC где
  // `/wiki/rest/...` редиректит 302, но `/rest/...` работает). В Чёрном
  // дашборде баннер остаётся (renderConfluenceSsoBanner экспорт сохранён).
  return `
    <div class="ts2-glance">
      ${identityBanner}
      ${storyLine}
      ${heroBlock}
      ${_renderScannerTabBar()}
      <div class="ts2-today-pane">
        ${renderDailyBrief(model, ctx.history || [])}
        ${renderActionQueue(model)}
        ${operationsSection}
        ${trendsSection}
      </div>
    </div>
  `;
}

/* ── 2026-05-17 (D2/D3 fix) — Identity coverage critical banner ──
   Показывается только при критически низком coverage cfAccountId / bbLogin —
   когда основная часть BB/CF активности теряется в Scanner'е. Click →
   открывает Diagnostic-modal и запускает Auto-Resolve (handler сидит на
   `#ts2-glance-resolve-btn` в teamScanner2.js L2107). Dismiss × сохраняет
   timestamp в localStorage на 7 дней — чтобы не спамить тимлида. */
function _renderIdentityCoverageBanner(model) {
  if (!model) return '';
  const parts = Array.isArray(model.participants) ? model.participants : [];
  // Берём команду через model.totalEmployeeCount если есть, иначе оцениваем
  // через participants. Реальный teamSize живёт в state.employees, но без
  // import'а здесь — используем proxy.
  const teamSize = parts.length;
  if (teamSize < 30) return '';  // мелкие команды — coverage colebеется
  // Считаем сколько участников имеют атрибутированный BB/CF.
  let bbCount = 0;
  let cfCount = 0;
  for (const p of parts) {
    if (p.bbItems && p.bbItems.length) bbCount++;
    if (p.cfItems && p.cfItems.length) cfCount++;
  }
  // Используем coverage из diagnostic если есть (более точно).
  // Если нет — оцениваем через items (грубо: «есть ли вообще BB/CF активность»).
  const cfPct = Math.round(cfCount / teamSize * 100);
  const bbPct = Math.round(bbCount / teamSize * 100);
  const cfCritical = cfPct < 30;
  const bbCritical = bbPct < 50;
  if (!cfCritical && !bbCritical) return '';
  // Dismiss check.
  try {
    const dismissedAt = Number(localStorage.getItem('q2_id_banner_dismissed_at') || 0);
    if (dismissedAt > Date.now() - 7 * 24 * 60 * 60 * 1000) return '';
  } catch (_) { /* ignore */ }
  const issues = [];
  if (cfCritical) issues.push(`Confluence: ${cfPct}% (${teamSize - cfCount} из ${teamSize} без cfAccountId)`);
  if (bbCritical) issues.push(`Bitbucket: ${bbPct}% (${teamSize - bbCount} из ${teamSize} без bbLogin)`);
  return `
    <div class="ts2-sso-banner ts2-id-banner" role="status" aria-live="polite">
      <div class="ts2-sso-banner-icon" aria-hidden="true">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 16 })}</div>
      <div class="ts2-sso-banner-body">
        <div class="ts2-sso-banner-title"><b>Identity coverage критически низкий</b> — Scanner показывает неполную картину.</div>
        <div class="ts2-sso-banner-sub">${esc(issues.join(' · '))}. Запустите Auto-Resolve — bulk-lookup в API заполнит недостающие поля.</div>
      </div>
      <button type="button" class="ts2-sso-banner-cta" id="ts2-glance-resolve-btn" title="Открыть Диагностику и запустить bulk Auto-Resolve">Запустить Auto-Resolve</button>
      <button type="button" class="ts2-sso-banner-dismiss" id="ts2-id-banner-dismiss" title="Скрыть на 7 дней" aria-label="Скрыть">×</button>
    </div>
  `;
}

/* ── V22 C1 — Confluence SSO-redirect inline banner ─────────────────
   Показывается в Сканнере (поверх hero) и в Чёрном дашборде (под header)
   когда server зафиксировал >0 редиректов на CQL/audit запросах. Брендбук:
   3px stripe-left, без gradients, accent — `--prizma-warning`. CTA дёргает
   `window.openIntegrationsSettings('confluence')`. Без данных — пустая строка.
   Экспортирован чтобы blackDashboardRenderer мог переиспользовать ту же разметку. */
export function renderConfluenceSsoBanner(cf) {
  if (!cf || cf.suspectedSso !== true) return '';
  // Сигнал «redirect» — самый явный (есть 302/301). Остальные сигналы
  // (html-200 / empty-200) тоже используют этот баннер — они тоже указывают
  // на SSO-перехват, просто менее детерминированно.
  const signal = cf.ssoSignal || 'redirect';
  const redirCount = (cf.byStatus?.['302'] || 0) + (cf.byStatus?.['301'] || 0);
  const subline = signal === 'redirect' && redirCount > 0
    ? `${redirCount} из ${cf.total || '?'} запросов получили 302/301`
    : (signal === 'html-200' ? 'Confluence отдаёт HTML вместо JSON (silent SSO interception)'
      : 'Confluence отдаёт пустые ответы при 200 OK');
  return `
    <div class="ts2-sso-banner" role="status" aria-live="polite">
      <div class="ts2-sso-banner-icon" aria-hidden="true">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 16 })}</div>
      <div class="ts2-sso-banner-body">
        <div class="ts2-sso-banner-title"><b>Confluence отвечает 302 redirect</b> — ваш токен возможно SSO-cookie, а не Personal Access Token (PAT).</div>
        <div class="ts2-sso-banner-sub">${esc(subline)}. Confluence → Profile → Personal Access Tokens → Create new → заменить в настройках.</div>
      </div>
      <button type="button" class="ts2-sso-banner-cta" data-ts2-open-settings="confluence" title="Открыть настройки интеграций → Confluence">Открыть настройки</button>
    </div>
  `;
}

export function _ensureSsoBannerStyles() {
  // 2026-05-11 — granular guard: shim'ы в Node-тестах могут иметь `document`
  // только с `createElement` (без getElementById/head). Раньше падало TypeError.
  if (typeof document === 'undefined'
      || typeof document.getElementById !== 'function'
      || !document.head) return;
  if (document.getElementById('ts2-sso-banner-styles')) return;
  const s = document.createElement('style');
  s.id = 'ts2-sso-banner-styles';
  s.textContent = `
    .ts2-sso-banner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin: 0 0 16px 0;
      padding: 10px 14px;
      background: var(--prizma-surface, var(--surf-1, #FFFFFF));
      border: 1px solid var(--border-2, rgba(0,0,0,.08));
      border-left: 3px solid var(--prizma-warning, #C97A1A);
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.4;
      color: var(--prizma-text, var(--text-1, #1B1B1F));
    }
    .ts2-sso-banner-icon {
      flex: 0 0 auto;
      color: var(--prizma-warning, #C97A1A);
      padding-top: 1px;
    }
    .ts2-sso-banner-body { flex: 1 1 auto; min-width: 0; }
    .ts2-sso-banner-title { font-size: 13px; }
    .ts2-sso-banner-sub {
      margin-top: 4px;
      font-size: 12px;
      color: var(--prizma-text-secondary, var(--text-2, #4A4A52));
    }
    .ts2-sso-banner-cta {
      flex: 0 0 auto;
      align-self: center;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      background: transparent;
      color: var(--prizma-warning, #C97A1A);
      border: 1px solid var(--prizma-warning, #C97A1A);
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
    }
    .ts2-sso-banner-cta:hover {
      background: var(--prizma-warning, #C97A1A);
      color: #FFFFFF;
    }
    .ts2-sso-banner-cta:focus-visible {
      outline: 2px solid var(--prizma-warning, #C97A1A);
      outline-offset: 2px;
    }
    /* 2026-05-17 (D2/D3 fix) — dismiss-button для identity-coverage banner. */
    .ts2-sso-banner-dismiss {
      flex: 0 0 auto;
      align-self: flex-start;
      width: 24px;
      height: 24px;
      padding: 0;
      font-size: 16px;
      line-height: 1;
      background: transparent;
      color: var(--prizma-text-secondary, var(--text-3, #6A6A72));
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .ts2-sso-banner-dismiss:hover {
      background: var(--bg-2, #f1f5f9);
      color: var(--prizma-text, var(--text-1, #1B1B1F));
    }
    .ts2-id-banner { border-left-color: var(--prizma-off-course, #C84B4B); }
    .ts2-id-banner .ts2-sso-banner-icon { color: var(--prizma-off-course, #C84B4B); }
    .ts2-id-banner .ts2-sso-banner-cta {
      color: var(--prizma-off-course, #C84B4B);
      border-color: var(--prizma-off-course, #C84B4B);
    }
    .ts2-id-banner .ts2-sso-banner-cta:hover {
      background: var(--prizma-off-course, #C84B4B);
      color: #FFFFFF;
    }
  `;
  document.head.appendChild(s);
}

/* ── AUDIT_ARTDIRECTION #33 — room-headers + story-line ──────────────
   Phase 1: «room»-обёртки для «Операции» / «Тренды» секций — eyebrow CAPS
   + 32px gap. Phase 2: одна story-line вверху перед hero — короткая фраза
   о состоянии команды на основе агрегата сигналов. */
export function _ensureScannerRoomStyles() {
  // 2026-05-11 — granular guard: shim'ы в Node-тестах могут иметь `document`
  // только с `createElement` (без getElementById/head). Раньше падало TypeError.
  if (typeof document === 'undefined'
      || typeof document.getElementById !== 'function'
      || !document.head) return;
  if (document.getElementById('ts2-room-styles')) return;
  const style = document.createElement('style');
  style.id = 'ts2-room-styles';
  style.textContent = `
    .ts2-room {
      margin-top: 32px;
      display: block;
    }
    .ts2-room:first-of-type { margin-top: 24px; }
    .ts2-room-eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .7px;
      text-transform: uppercase;
      color: var(--prizma-text-tertiary, var(--text-3, #7A7A82));
      margin: 0 0 10px 0;
      padding: 0;
    }
    .ts2-room > .ts2-section-ops,
    .ts2-room > .ts2-section-trends {
      margin-top: 0;
    }
    .ts2-story-line {
      margin: 4px 0 18px 0;
      padding: 10px 14px;
      border-left: 3px solid var(--prizma-on-course, #0F8A5F);
      background: transparent;
      font-size: 13px;
      line-height: 1.4;
      color: var(--prizma-text-secondary, var(--text-2));
      letter-spacing: .15px;
    }
    .ts2-story-line.ts2-story-drift   { border-left-color: var(--prizma-drift,    #B5670A); }
    .ts2-story-line.ts2-story-stop    { border-left-color: var(--prizma-off-course, #C13838); }
    .ts2-story-line.ts2-story-info    { border-left-color: var(--prizma-information, #1F6B96); }
    .ts2-story-line strong { color: var(--prizma-text-primary, var(--text-1)); font-weight: 600; }
  `;
  document.head.appendChild(style);
}

/**
 * Строит однофразовую story-line по агрегату счётчиков и sprint-confidence.
 * Pure rule-based:
 *   stop ≥ 3                                → «замечен дрейф в N секциях» (off-course)
 *   stop ≥ 1 OR watch ≥ 5                   → «команда работает, есть точки внимания» (drift)
 *   stop=0 AND watch=0 AND moving > 0       → «команда работает в норме» (on-course)
 *   participants < 3                        → '' (мало данных, не флудим)
 */
function _composeRoomStoryLine(model) {
  if (!model || !Array.isArray(model.participants)) return '';
  const parts = model.participants;
  if (parts.length < 3) return '';
  let stop = 0, watch = 0, moving = 0;
  for (const p of parts) {
    const cls = classifyPerson(p);
    if      (cls === 'stop')   stop++;
    else if (cls === 'watch')  watch++;
    else if (cls === 'moving') moving++;
  }
  // TODO Phase 3 — расширить до использования `_aggregateHealth`-like data
  // (sprint confidence, blocker MTTR) когда появится единый агрегатор.
  let cls = 'ts2-story-info';
  let text = '';
  if (stop >= 3) {
    cls  = 'ts2-story-stop';
    text = `Замечен дрейф: <strong>${stop}</strong> ${plural(stop, ['человек', 'человека', 'человек'])} требуют разговора, ${watch} в наблюдении.`;
  } else if (stop >= 1) {
    cls  = 'ts2-story-drift';
    text = `Команда работает, точки внимания: <strong>${stop}</strong> в стопе, ${watch} в наблюдении.`;
  } else if (watch >= 5) {
    cls  = 'ts2-story-drift';
    text = `Команда работает, <strong>${watch}</strong> ${plural(watch, ['человек', 'человека', 'человек'])} в наблюдении.`;
  } else if (moving > 0) {
    cls  = 'ts2-story-info';
    text = `Команда работает в норме: <strong>${moving}</strong> ${plural(moving, ['человек', 'человека', 'человек'])} в активной работе.`;
  } else {
    return '';
  }
  return `<div class="ts2-story-line ${cls}" role="status">${text}</div>`;
}

/**
 * V20 S12 I1 — Daily morning brief: нарратив про команду в 3-5 предложений.
 *
 * Pилот feedback: «5 минут утра — нужен сухой текст что произошло, кому
 * помочь, что закрыть. Не 10 виджетов».
 *
 * Pure rule-based, без LLM. Источник — buildDailyBrief() из Insights.
 */
function renderDailyBrief(/* model, history */) {
  // V21 — карточка «Сверка курса · Копировать» удалена по запросу пользователя.
  // Содержимое (нарратив + Δ-дайджест + copy-to-TG) убрано целиком.
  // Тимлид видит то же самое в team-glance + person-rows; отдельная сводка
  // воспринималась как дублирование.
  return '';
}

/**
 * V20 S13 S5 — Burnup sparkline (3 линии: scope/done/ideal).
 *
 * Pure inline-SVG. Линии:
 *   · scope (растёт когда добавляются issues)
 *   · done  (актуальный прогресс)
 *   · ideal (target — линейно от 0 до scope_final)
 *
 * Если history < 2 точек — возвращает small empty-state «недостаточно истории».
 */
export function renderBurnupSparkline(burnup) {
  if (!burnup || burnup.status !== 'ok' || burnup.points.length < 2) {
    return `<span class="ts2-burnup-empty" title="Burnup появится через 2+ дня после старта sprint snapshot'ов">—</span>`;
  }
  const pts = burnup.points;
  const W = 120, H = 32;
  const max = Math.max(1, ...pts.map(p => Math.max(p.scope, p.done, p.ideal || 0)));
  const stepX = W / (pts.length - 1);
  const proj = (val, i) => {
    const x = Math.round(i * stepX);
    const y = Math.round(H - (val / max) * (H - 4) - 2);
    return `${x},${y}`;
  };
  const scopeLine = pts.map((p, i) => proj(p.scope, i)).join(' ');
  const doneLine  = pts.map((p, i) => proj(p.done,  i)).join(' ');
  const idealLine = pts.map((p, i) => proj(p.ideal, i)).join(' ');
  return `
    <svg class="ts2-burnup-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-label="Burnup за ${pts.length} дней">
      <polyline class="ts2-burnup-ideal" fill="none" points="${idealLine}"/>
      <polyline class="ts2-burnup-scope" fill="none" points="${scopeLine}"/>
      <polyline class="ts2-burnup-done"  fill="none" points="${doneLine}"/>
    </svg>
  `;
}

/**
 * V20 S12 I2 — Action queue Top-5: ranked list людей-приоритетов.
 *
 * Каждая строка — observation + suggested next action. Click → открывает
 * карточку. Единственная цель: «5 минут утра → 5 имён → действие на каждого».
 */
function renderActionQueue(model) {
  const queue = buildActionQueue(model);
  if (queue.length === 0) return '';
  // AUDIT_HOLISTIC AI3 — minimum example callsite. Пробрасываем
  // короткое rule-based summary в aria-label секции (screen-reader
  // получает «суть и приоритет» без чтения всех 5 строк подряд).
  // Phase-2 TODO: рендерить summary visible-под-headline и
  // обновлять через AutoSummary.summarizeAsync(...) с feature-flag
  // state.llm.useAutoSummary.
  let _autoSummary = '';
  try {
    const AS = (typeof window !== 'undefined' && Services.AutoSummary) || null;
    if (AS) _autoSummary = AS.summarize('action-queue', queue);
  } catch (_) { /* silent — graceful degrade */ }
  const ariaSuffix = _autoSummary ? ` — ${_autoSummary}` : '';
  return `
    <div class="ts2-action-queue" role="region" aria-label="Очередь действий на сегодня${esc(ariaSuffix)}">
      <div class="ts2-action-queue-head">
        <span class="ts2-action-queue-key">Кто отклонился от курса</span>
        <span class="ts2-action-queue-hint">— ranked по серьёзности · click → карточка</span>
      </div>
      <ol class="ts2-action-queue-list">
        ${queue.map((q, i) => `
          <li class="ts2-action-queue-row" data-severity="${q.severity}">
            <span class="ts2-action-queue-rank">#${i + 1}</span>
            <button type="button" class="ts2-action-queue-name" data-jump-key="${esc(q.key)}">${esc(q.label)}</button>
            <span class="ts2-action-queue-reason">${esc(q.reason)}</span>
            <span class="ts2-action-queue-arrow">→</span>
            <span class="ts2-action-queue-action">${esc(q.action)}</span>
          </li>
        `).join('')}
      </ol>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════
   ║  SECTION: INSIGHTS RENDERERS (V20 S12-S14)
   ║
   ║  Pure HTML-string functions. Inputs: model + history + ctx.
   ║  Outputs: <div>/<details>/<ul> blocks. No DOM mutation.
   ║
   ║  V21 V2 todo: extract into teamScanner2RenderInsights.js when
   ║  helpers (esc, fmtDuration, jiraIssueLink) are also exported.
   ║  Sections in this group:
   ║    · renderTeamHealthHero (I14 + T4 + T3)
   ║    · renderDailyBrief     (I1 + S7 + I15)
   ║    · renderActionQueue    (I2)
   ║    · renderWhoNeedsHelp   (T2)
   ║    · renderSprintHealth   (S1, S3, S6 + goal-critical S2 + burnup S5)
   ║    · renderScopeChurnDetail (I4)
   ║    · renderStalePrs       (I9)
   ║    · renderEstimateAccuracy (I10)
   ║    · renderOnboardingRamp (I12)
   ║    · renderSoloAuthorFiles (I11)
   ║    · renderZombieIssues   (I7)
   ║    · renderBurnupSparkline (S5 helper)
   ╚═══════════════════════════════════════════════════════════════ */

/**
 * V20 S14 I14 + T4 — Team Health Score + Sprint Confidence «hero»-блок.
 * Один номер 0-100% (или dual: health + confidence). Самый top экрана.
 *
 * TODO AUDIT_SCANNER #37 — добавить «Активные за 14д» counter с glossary tooltip:
 *   <span class="ts2-participant-count" title="participant = сотрудник с
 *   identity (jiraAccountId / bitbucketLogin / confluenceAccountId), активный
 *   за 14 дней. employee = строка из реестра Сотрудники, может не иметь
 *   identity и в Сканнере не отображается.">
 *     Активные за 14д (${activeCount} из ${totalEmployees} по реестру)
 *   </span>
 *   Источник: model.participants (active=14d window) + state.employees.length.
 *   Сейчас hero-row показывает только Health/Confidence/cross-deps; добавлять
 *   counter надо вместе с «participants vs employees» glossary block.
 */
function renderTeamHealthHero(model, history) {
  const health = computeTeamHealthScore(model, history);
  const conf = computeSprintConfidence(model);
  if (health.score == null && conf.confidence == null) return '';
  const cross = buildCrossTeamDeps(model);
  const incomingTotal = (cross.incoming || []).reduce((s, x) => s + (x.count || 0), 0);
  const outgoingTotal = (cross.outgoing || []).reduce((s, x) => s + (x.count || 0), 0);
  const crossLine = (incomingTotal > 0 || outgoingTotal > 0)
    ? `<span class="ts2-hero-cross" title="Cross-team зависимости: incoming = задачи которые мы ждём, outgoing = задачи которые ждут нас.">↪ ${incomingTotal} нам · ${outgoingTotal} от нас</span>`
    : '';
  const healthBlock = (health.score != null)
    ? `<div class="ts2-hero-block">
         <span class="ts2-hero-num">${health.score}</span>
         <span class="ts2-hero-lab">Health</span>
       </div>`
    : '';
  const confBlock = (conf.confidence != null)
    ? `<div class="ts2-hero-block">
         <span class="ts2-hero-num">${conf.confidence}%</span>
         <span class="ts2-hero-lab">Sprint Confidence</span>
       </div>`
    : '';
  // Components breakdown (raskl). Tooltip с компонентами.
  const componentsTip = (health.components || [])
    .map(c => `${c.label}: ${Math.round(c.value)}/100 (${c.weight}%)`)
    .join(' · ');
  return `
    <div class="ts2-hero" role="region" aria-label="Health и Sprint Confidence" title="${esc(componentsTip)}">
      ${healthBlock}
      ${confBlock}
      ${crossLine}
    </div>
  `;
}
