'use strict';
/* ============================================================
   BLACK DASHBOARD — RENDERER
   Pure rendering — strings only, no side effects. Three tabs:
   Goals · Coverage · Metrics. (V22 Brand pass — без эмодзи в UI.)
   ============================================================ */

import { esc, trunc } from './portfolioPulseUtils.js';
import { renderDonut, renderBars } from './portfolioPulseMetrics.js';
import { Icons } from '../app/icons.js';
import { Utils } from '../utils.js';
import { prizmaLoaderMark } from '../app/prizmaUI.js';

// URL-scheme allowlist — keeps href safe even if config has bad data.
// Also strips trailing slashes so concatenation `${url}/browse/X` doesn't
// produce double-slash URLs (Jira normalises them but it looks broken to
// users and breaks some intermediate proxies).
function safeUrl(u) {
  const s = String(u || '').trim().replace(/\/+$/, '');
  return /^(https?:|mailto:)/i.test(s) ? s : '';
}

function _statusChip(statusCat, statusName) {
  const cls = statusCat === 'done' ? 'bd-chip-done'
            : statusCat === 'indeterminate' ? 'bd-chip-wip'
            : 'bd-chip-todo';
  return `<span class="bd-chip ${cls}" title="${esc(statusName||'')}">${esc(statusName || '—')}</span>`;
}

function _coverageColorClass(pct) {
  if (pct >= 70) return 'bd-kpi-green';
  if (pct >= 40) return 'bd-kpi-yellow';
  return 'bd-kpi-red';
}

/* V22 Brand B5 — coverage-tier (signal-dot + label).
   Брендбук §3 Signal: ≥70 on-course / 40-69 drift / <40 off-course.
   Используется для coverage-row + KPI-плашек. Legacy bd-kpi-* классы
   остаются рядом (для CSS fallback Brand-CSS-агент'а). */
function _coverageTier(pct) {
  if (pct >= 70) return { tier: 'high', signal: 'on-course',  label: 'На курсе' };
  if (pct >= 40) return { tier: 'mid',  signal: 'drift',      label: 'Дрейф' };
  return                  { tier: 'low', signal: 'off-course', label: 'Сбился с курса' };
}

/* ── Diagnostics panel — readable view of summary + diagnostics ────
   Renders a collapsible <details> block adjacent to the error banner.
   Surfaces seedCount/expandedCount/exitReason/etc. so user can see
   exactly WHY coverage came out the way it did when something went
   sideways (rate-limit storm, partial expand, missing tokens, ...).
   ───────────────────────────────────────────────────────────────── */
function _renderDiagnosticsDetails(model) {
  const s = model.summary || {};
  const d = model.diagnostics || {};
  const ex = d.expand || {};
  const ch = d.childlessSeeds || {};
  // Compact KV row helper. Skips falsy values where it would be noise
  // (zero counters surface as "0" because zero is informative here).
  const row = (label, value, hint) => {
    if (value === undefined || value === null || value === '') return '';
    const valStr = (value === true) ? 'да' : (value === false) ? 'нет' : esc(String(value));
    const hintHtml = hint ? `<span class="bd-diag-hint" title="${esc(hint)}">ⓘ</span>` : '';
    return `<div class="bd-diag-row"><span class="bd-diag-key">${esc(label)}${hintHtml}</span><span class="bd-diag-val">${valStr}</span></div>`;
  };
  const totalSec = d.totalMs != null ? `${(d.totalMs/1000).toFixed(1)} с` : '';
  // Childless seeds — surface up to 8 keys inline; rest hide behind a count.
  const childlessKeys = ch.childless || [];
  const childlessLine = childlessKeys.length
    ? `${childlessKeys.length} (${childlessKeys.slice(0,8).join(', ')}${childlessKeys.length > 8 ? ', …' : ''})`
    : '0';

  const summaryBlock = `
    <div class="bd-diag-section">
      <div class="bd-diag-section-title">Summary</div>
      ${row('Целей', s.totalGoals)}
      ${row('Привязано задач', s.linkedCount)}
      ${row('Не привязано', s.unlinkedCount)}
      ${row('Покрытие, %', s.coveragePct)}
    </div>`;

  // Chunk-error log — show first 3 distinct errors with their level.
  const chunkErrs = ex.chunkErrors || [];
  const errLines = chunkErrs.slice(0, 3)
    .map(e => `<div class="bd-diag-err-line"><span class="bd-diag-err-lev">L${e.level}</span> ${esc(e.error || '')}</div>`)
    .join('');
  const errMore = chunkErrs.length > 3 ? `<div class="bd-diag-err-more">…и ещё ${chunkErrs.length - 3}</div>` : '';
  const errBlock = chunkErrs.length ? `
    <div class="bd-diag-section bd-diag-section-wide">
      <div class="bd-diag-section-title">Ошибки чанков (root-cause)</div>
      <div class="bd-diag-err-list">${errLines}${errMore}</div>
    </div>` : '';

  const expandBlock = ex && Object.keys(ex).length ? `
    <div class="bd-diag-section">
      <div class="bd-diag-section-title">Раскрытие дерева (expand)</div>
      ${row('Всего ключей в Domain link', ex.seedCountTotal, 'Сырое количество ключей из поля Domain link на всех целях')}
      ${row('Отсеяно при intake', ex.seedDroppedAtIntake, 'Ключи вне настроенных Delta-проектов')}
      ${row('Seeds после фильтра', ex.seedCount)}
      ${row('Раскрыто всего', ex.expandedCount, 'Ключи в финальном дереве (seeds + дети)')}
      ${row('Отсеяно после раскрытия', ex.droppedOutOfDelta, 'Дочерние задачи вне Delta-проектов')}
      ${row('Уровней пройдено', ex.levelsReached)}
      ${row('JQL-батчей', ex.batches)}
      ${ex.parallelProjects > 1 ? row('Проектов параллельно', ex.parallelProjects, 'Раскрытие выполнено по проектам параллельно для скорости') : ''}
      ${row('followCloners', ex.followCloners, 'Включено следование [Cloners] issue-link')}
      ${ex.clonersProbeStatus && ex.clonersProbeStatus !== 'skipped' ? row('Cloners probe', ex.clonersProbeStatus, 'supported = поддерживается | unsupported = не поддерживается на этой Jira (отключено) | probe-error = неоднозначно') : ''}
      ${ex.clonersAutoDisabled ? row('Cloners auto-disabled', true, 'После первой неудачи cloners-клоза автоматически отключена для остатка прогона') : ''}
      ${ex.fellBackNoCloners ? row('Чанков без cloners', ex.fellBackNoCloners, 'Чанки, у которых cloners-JQL упал и сработал fallback без cloners-клозы') : ''}
      ${row('truncated', ex.truncated, 'Раскрытие было прервано до завершения')}
      ${row('exitReason', ex.exitReason, 'completed | time-budget | failures | thrown | no-expand | no-seed | project-error')}
    </div>` : '';

  // Per-project summary table — only shown when parallel BFS ran and we have
  // per-project rows. Helpful for spotting which project's expand was slow
  // or got truncated while others completed.
  const pp = Array.isArray(ex.perProjectSummary) ? ex.perProjectSummary : null;
  const perProjectBlock = pp && pp.length > 0 ? `
    <div class="bd-diag-section bd-diag-section-wide">
      <div class="bd-diag-section-title">Раскрытие по проектам (параллельно)</div>
      <table class="bd-diag-pp-table">
        <thead><tr><th>Проект</th><th>Seeds</th><th>Раскрыто</th><th>Уровни</th><th>Батчи</th><th>Status</th></tr></thead>
        <tbody>
          ${pp.map(p => p.error
            ? `<tr><td colspan="6" class="bd-diag-pp-err">${esc(p.pk || '?')}: ${esc(p.error)}</td></tr>`
            : `<tr>
                <td>${esc(p.pk)}</td>
                <td>${esc(String(p.seedCount ?? 0))}</td>
                <td>${esc(String(p.expandedCount ?? 0))}</td>
                <td>${esc(String(p.levels ?? 0))}</td>
                <td>${esc(String(p.batches ?? 0))}</td>
                <td>${p.truncated ? `<span class="bd-diag-pp-trunc" title="${esc(p.exitReason || '')}">${esc(p.exitReason || 'truncated')}</span>` : '<span class="bd-diag-pp-ok">completed</span>'}</td>
              </tr>`
          ).join('')}
        </tbody>
      </table>
    </div>` : '';

  const childlessBlock = ch ? `
    <div class="bd-diag-section">
      <div class="bd-diag-section-title">Childless seeds (epic-aggregators)</div>
      ${row('Childless ключей', childlessLine, 'Seeds без структурных детей — флаг isAggregator в UI')}
      ${row('Probed', ch.probed)}
      ${row('Partial result', ch.partialResult, 'Бюджет на проверку был исчерпан — часть seeds не проверены')}
    </div>` : '';

  // Coverage exclusion diagnostics — shows how many epics dropped via each
  // V13 (7th/10th-pass) rule. Only rendered if the section actually has data
  // (server populates `diagnostics.coverage` only on a successful run).
  const cov = d.coverage || null;
  // V13 (10th pass): surface per-rule typed-exclusion counts.
  const ruleCounts = cov?.excludedByRule ? Object.entries(cov.excludedByRule) : [];
  const ruleCountsBlock = ruleCounts.length ? `
    <div class="bd-diag-rule-list">
      ${ruleCounts.map(([k, v]) => `<div class="bd-diag-rule-row"><span class="bd-diag-rule-name">${esc(k)}</span><span class="bd-diag-rule-num">${v}</span></div>`).join('')}
    </div>` : '';
  const coverageBlock = cov ? `
    <div class="bd-diag-section bd-diag-section-wide">
      <div class="bd-diag-section-title">Покрытие — исключения</div>
      ${row('Всего задач сканировано', cov.totalIssuesScanned)}
      ${row('Эпиков сканировано', cov.totalEpicsScanned)}
      ${row('Исключено эпиков: без детей', cov.excludedEpicsNoChildren, 'Эпики без структурных детей вообще')}
      ${row('Исключено эпиков: все дети в new', cov.excludedEpicsAllNewStatus, 'Эпики, у которых ВСЕ дочерние задачи в начальном статусе (To Do)')}
      ${cov.excludedEpicsAllChildrenExcluded ? row('Исключено эпиков: все дети по правилам', cov.excludedEpicsAllChildrenExcluded, 'Эпики, у которых все дети попали под type/status-правила (баги, отменённые и т.п.)') : ''}
      ${row('Epic Link field id', cov.deltaEpicLinkFieldId, 'Custom field id, найденный для классических Epic Link связей')}
      ${cov.quarterCutoff ? row('Cutoff квартала', cov.quarterCutoff, 'Минимальная дата начала квартала среди Fix Version/s целей. Story/Task в Done с resolutiondate раньше этой даты — исключаются') : ''}
      ${ruleCounts.length ? `<div class="bd-diag-rule-title">Исключено правилами (по типу / статусу):</div>${ruleCountsBlock}` : ''}
    </div>` : '';

  const totalBlock = totalSec ? `
    <div class="bd-diag-section">
      <div class="bd-diag-section-title">Время</div>
      ${row('Общее время запроса', totalSec)}
    </div>` : '';

  return `<details class="bd-diag-details">
    <summary class="bd-diag-summary">
      <span class="bd-diag-chev">▸</span>
      <span class="bd-diag-label">Подробности и диагностика</span>
      <span class="bd-diag-hint-meta">${esc(`${s.linkedCount ?? 0}/${(s.linkedCount ?? 0) + (s.unlinkedCount ?? 0)} • ${ex.expandedCount ?? 0} ключей • ${ex.exitReason || '—'}${totalSec ? ` • ${totalSec}` : ''}`)}</span>
    </summary>
    <div class="bd-diag-body">
      ${summaryBlock}
      ${expandBlock}
      ${perProjectBlock}
      ${coverageBlock}
      ${childlessBlock}
      ${totalBlock}
      ${errBlock}
    </div>
  </details>`;
}

/* ── Diagnostic Modal ─────────────────────────────────────── */

/**
 * Build a safe (scrubbed) JSON for BD diagnostics export.
 * Tokens never leave the payload; summaries truncated; errors scrubbed.
 */
export function prepareBdDiagSafeJson(model) {
  const d = model.diagnostics || {};
  const ex = d.expand || {};
  const cov = d.coverage || null;

  const safeErrors = (model.errors || []).map(e => ({
    scope:   e.scope || '',
    message: Utils.redactSecretsInText(e.message || '', 300),
  }));

  const safeGoals = (model.goals || []).map(g => ({
    key:           g.error ? '(error)' : g.key,
    statusCat:     g.statusCat || '',
    linkedCount:   (g.linkedIssues || []).filter(li => !li.notFound).length,
    notFoundCount: (g.linkedIssues || []).filter(li => li.notFound).length,
    hasError:      !!g.error,
  }));

  const out = {
    _exportMode: 'safe',
    _note: 'Безопасный экспорт: токены скрыты, имена/emails не включены',
    generatedAt:  new Date().toISOString(),
    fetchedAt:    model.fetchedAt || null,
    summary:      model.summary || {},
    coverageByTeam: (model.coverageByTeam || []).map(t => ({
      pk:              t.pk,
      name:            t.name,
      total:           t.total,
      linked:          t.linked,
      excluded:        t.excluded || 0,
      pct:             t.pct,
      linkedFromGoals: t.linkedFromGoals || 0,
    })),
    goals:        safeGoals,
    errors:       safeErrors,
    diagnostics: {
      totalMs:       d.totalMs || 0,
      expand: {
        seedCountTotal:     ex.seedCountTotal,
        seedDroppedAtIntake: ex.seedDroppedAtIntake,
        seedCount:          ex.seedCount,
        expandedCount:      ex.expandedCount,
        droppedOutOfDelta:  ex.droppedOutOfDelta,
        levelsReached:      ex.levelsReached,
        batches:            ex.batches,
        exitReason:         ex.exitReason,
        truncated:          ex.truncated,
        followCloners:      ex.followCloners,
        clonersProbeStatus: ex.clonersProbeStatus,
        parallelProjects:   ex.parallelProjects,
        chunkErrorCount:    (ex.chunkErrors || []).length,
        chunkErrors:        (ex.chunkErrors || []).slice(0, 5).map(e => ({
          level: e.level,
          error: Utils.redactSecretsInText(e.error || '', 200),
        })),
        perProjectSummary: (ex.perProjectSummary || []).map(p => ({
          pk: p.pk, seedCount: p.seedCount, expandedCount: p.expandedCount,
          levels: p.levels, batches: p.batches, truncated: p.truncated,
          exitReason: p.exitReason, error: p.error ? Utils.redactSecretsInText(p.error, 200) : null,
        })),
      },
      coverage: cov ? {
        totalIssuesScanned:              cov.totalIssuesScanned,
        totalEpicsScanned:               cov.totalEpicsScanned,
        excludedEpicsNoChildren:         cov.excludedEpicsNoChildren,
        excludedEpicsAllNewStatus:       cov.excludedEpicsAllNewStatus,
        excludedEpicsAllChildrenExcluded: cov.excludedEpicsAllChildrenExcluded,
        excludedByRule:                  cov.excludedByRule || {},
        quarterCutoff:                   cov.quarterCutoff || null,
      } : null,
    },
  };
  return JSON.stringify(out, null, 2);
}

/** Render the diagnostics modal HTML (injected into <body>). */
export function renderBdDiagModal(model) {
  const diagBody = _renderDiagnosticsDetails(model);
  return `
  <div class="bd-diag-modal-overlay" id="bd-diag-modal-overlay" role="dialog" aria-modal="true" aria-label="Диагностика Чёрного дашборда">
    <div class="bd-diag-modal">
      <div class="bd-diag-modal-head">
        <span class="bd-diag-modal-title">${Icons.get('activity', { cls: 'btn-icon', size: 15 })} Диагностика — Чёрный дашборд</span>
        <button class="bd-diag-modal-close" id="bd-diag-modal-close" title="Закрыть" aria-label="Закрыть">${Icons.get('x', { cls: 'btn-icon', size: 16 })}</button>
      </div>
      <div class="bd-diag-modal-body">
        ${diagBody}
      </div>
      <div class="bd-diag-modal-foot">
        <button class="int-btn int-btn-secondary int-btn-sm" id="bd-diag-export-btn">
          ${Icons.get('download', { cls: 'btn-icon', size: 14 })} Безопасный JSON
        </button>
        <span class="bd-diag-modal-foot-hint">Токены скрыты. Отправь файл разработчику для диагностики.</span>
      </div>
    </div>
  </div>`;
}

/* ── Top header (sub-tabs + refresh) ─────────────────────── */
export function renderTopHeader(model, activeTab, fetchedAtLabel) {
  const tabs = [
    { id: 'goals',    label: 'Цели',     icon: 'target' },
    { id: 'coverage', label: 'Покрытие', icon: 'link-2' },
    { id: 'metrics',  label: 'Метрики',  icon: 'bar-chart-3' },
  ];
  const errBlock = model.errors?.length
    ? `<div class="bd-error-banner">${model.errors.map(e => `<div>${Icons.get('alert-triangle', { cls: 'btn-icon', size: 14 })} <b>${esc(e.scope || '?')}</b>: ${esc(e.message || '')}</div>`).join('')}</div>`
    : '';
  // V22 C1 — SSO-redirect баннер. BD сам не дёргает Confluence, но Сканнер
  // пишет последний `cfTriedSummary` в `window.TeamScanner2._lastRawDiag`
  // (см. integrations/teamScanner2.js, V20 S7 B13). Читаем оттуда — если
  // тимлид только что прогонял Сканнер и заметил 302-flag, то и в BD сразу
  // увидит баннер (cross-feature visibility). Если данных нет (ни Сканнер
  // не запускался, ни prepared diag) — баннер не показывается. graceful.
  _ensureBdSsoBannerStyles();
  let cfTried = null;
  try { cfTried = (typeof window !== 'undefined' && window.TeamScanner2?._lastRawDiag?.cfTriedSummary) || null; }
  catch (_) { cfTried = null; }
  const ssoBanner = _renderBdSsoBanner(cfTried);
  // Diagnostics block — always rendered (collapsed by default), but
  // auto-expanded when there's an error so user sees context immediately.
  const hasErrors = !!(model.errors?.length);
  const diagBlock = _renderDiagnosticsDetails(model)
    .replace('<details class="bd-diag-details">', `<details class="bd-diag-details${hasErrors ? ' bd-diag-error' : ''}"${hasErrors ? ' open' : ''}>`);
  return `<div class="bd-header">
    <div class="bd-header-row">
      <h2 class="bd-title">${Icons.get('circle-dot', { cls: 'btn-icon', size: 16 })} Чёрный дашборд</h2>
      <div class="bd-header-meta">
        <span class="bd-fetched">обновлено: ${esc(fetchedAtLabel)}</span>
        <button class="int-btn int-btn-ghost int-btn-sm" id="bd-diag-btn" title="Диагностика — почему данные такие, выгрузить JSON">${Icons.get('activity', { cls: 'btn-icon', size: 14 })} Диагностика</button>
        <div class="bd-export-wrap">
          <button class="int-btn int-btn-ghost int-btn-sm" id="bd-export-btn" title="Сохранить выгрузку HTML — выберите «Цели» или «Покрытие». Внутри файла можно фильтровать по команде / цели.">${Icons.get('download', { cls: 'btn-icon', size: 14 })} Выгрузить HTML</button>
          <div class="bd-export-menu" id="bd-export-menu" hidden>
            <button class="bd-export-item" type="button" data-bd-export="goals">${Icons.get('target', { cls: 'btn-icon', size: 14 })} Цели</button>
            <button class="bd-export-item" type="button" data-bd-export="coverage">${Icons.get('link-2', { cls: 'btn-icon', size: 14 })} Покрытие</button>
          </div>
        </div>
        <button class="int-btn int-btn-primary int-btn-sm" id="bd-refresh-btn" title="Перезагрузить данные с серверов">${Icons.get('rotate-cw', { cls: 'btn-icon', size: 14 })} Обновить</button>
      </div>
    </div>
    ${errBlock}
    ${ssoBanner}
    ${diagBlock}
    <div class="bd-tabs">
      ${tabs.map(t => `<button class="bd-tab ${activeTab===t.id?'bd-tab-active':''}" data-bd-tab="${t.id}">${Icons.get(t.icon, { cls: 'btn-icon', size: 14 })} ${esc(t.label)}</button>`).join('')}
    </div>
  </div>`;
}

/* ── V22 C1 — SSO-redirect inline banner (BD side) ──────────────────
   Аналог `renderConfluenceSsoBanner` из teamScanner2Renderer.js — копия
   разметки, чтобы BD не зависел от Сканнера. Брендбук Spine-pill:
   3px stripe-left, accent `--prizma-warning`, без gradients. */
function _renderBdSsoBanner(cf) {
  if (!cf || cf.suspectedSso !== true) return '';
  const signal = cf.ssoSignal || 'redirect';
  const redirCount = (cf.byStatus?.['302'] || 0) + (cf.byStatus?.['301'] || 0);
  const subline = signal === 'redirect' && redirCount > 0
    ? `${redirCount} из ${cf.total || '?'} запросов получили 302/301`
    : (signal === 'html-200' ? 'Confluence отдаёт HTML вместо JSON (silent SSO interception)'
      : 'Confluence отдаёт пустые ответы при 200 OK');
  return `
    <div class="bd-sso-banner" role="status" aria-live="polite">
      <div class="bd-sso-banner-icon" aria-hidden="true">${Icons.get('alert-triangle', { cls: 'btn-icon', size: 16 })}</div>
      <div class="bd-sso-banner-body">
        <div class="bd-sso-banner-title"><b>Confluence отвечает 302 redirect</b> — ваш токен возможно SSO-cookie, а не Personal Access Token (PAT).</div>
        <div class="bd-sso-banner-sub">${esc(subline)}. Confluence → Profile → Personal Access Tokens → Create new → заменить в настройках.</div>
      </div>
      <button type="button" class="bd-sso-banner-cta" data-bd-open-settings="confluence" title="Открыть настройки интеграций → Confluence">Открыть настройки</button>
    </div>
  `;
}

function _ensureBdSsoBannerStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('bd-sso-banner-styles')) return;
  const s = document.createElement('style');
  s.id = 'bd-sso-banner-styles';
  s.textContent = `
    .bd-sso-banner {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin: 8px 0 0 0;
      padding: 10px 14px;
      background: var(--prizma-surface, var(--surf-1, #FFFFFF));
      border: 1px solid var(--border-2, rgba(0,0,0,.08));
      border-left: 3px solid var(--prizma-warning, #C97A1A);
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.4;
      color: var(--prizma-text, var(--text-1, #1B1B1F));
    }
    .bd-sso-banner-icon {
      flex: 0 0 auto;
      color: var(--prizma-warning, #C97A1A);
      padding-top: 1px;
    }
    .bd-sso-banner-body { flex: 1 1 auto; min-width: 0; }
    .bd-sso-banner-sub {
      margin-top: 4px;
      font-size: 12px;
      color: var(--prizma-text-secondary, var(--text-2, #4A4A52));
    }
    .bd-sso-banner-cta {
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
    .bd-sso-banner-cta:hover {
      background: var(--prizma-warning, #C97A1A);
      color: #FFFFFF;
    }
    .bd-sso-banner-cta:focus-visible {
      outline: 2px solid var(--prizma-warning, #C97A1A);
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(s);
}

/* ── Tab: Цели ─────────────────────────────────────────── */
export function renderGoalsTab(model) {
  const s = model.summary;
  const sigmaUrl = safeUrl(model.sigmaBaseUrl);
  const deltaUrl = safeUrl(model.deltaBaseUrl);
  const kpiCov = `<div class="bd-kpi ${_coverageColorClass(s.coveragePct)}">
    <div class="bd-kpi-val">${s.coveragePct}%</div>
    <div class="bd-kpi-lab">Покрытие</div>
  </div>`;
  const kpis = `<div class="bd-kpis">
    <div class="bd-kpi"><div class="bd-kpi-val">${s.totalGoals}</div><div class="bd-kpi-lab">Целей</div></div>
    <div class="bd-kpi bd-kpi-blue"><div class="bd-kpi-val">${s.linkedCount}</div><div class="bd-kpi-lab">Привязано задач</div></div>
    <div class="bd-kpi bd-kpi-grey"><div class="bd-kpi-val">${s.unlinkedCount}</div><div class="bd-kpi-lab">Не привязано</div></div>
    ${kpiCov}
  </div>`;

  const goals = model.goals.map(g => {
    const goalLink = sigmaUrl
      ? `<a class="bd-goal-key" href="${esc(sigmaUrl)}/browse/${esc(g.key)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(g.key)}</a>`
      : `<span class="bd-goal-key">${esc(g.key)}</span>`;
    if (g.error) {
      return `<details class="bd-goal bd-goal-error">
        <summary>
          <span class="bd-goal-chev">▸</span>
          ${goalLink}
          <span class="bd-goal-summary">${esc(g.summary || '—')}</span>
          <span class="bd-chip bd-chip-error">ошибка</span>
        </summary>
        <div class="bd-goal-body"><div class="bd-error-msg">${esc(g.error)}</div></div>
      </details>`;
    }
    const linkedCount = (g.linkedIssues || []).length;
    if (!linkedCount) {
      return `<details class="bd-goal">
        <summary>
          <span class="bd-goal-chev">▸</span>
          ${goalLink}
          <span class="bd-goal-summary">${esc(g.summary || '—')}</span>
          ${_statusChip(g.statusCat, g.status)}
          <span class="bd-chip bd-chip-empty">0 привязано</span>
        </summary>
        <div class="bd-goal-body"><div class="bd-empty">Нет привязанных задач (поле «Domain link» пусто или не настроено)</div></div>
      </details>`;
    }
    const teamBlocks = (g.linkedByPk || []).map(team => {
      const rows = team.issues.map(li => {
        const issueLink = (!li.notFound && deltaUrl)
          ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(li.key)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(li.key)}</a>`
          : `<span class="bd-issue-key${li.notFound?' bd-issue-key-missing':''}">${esc(li.key)}</span>`;
        const statusBit = li.notFound
          ? '<span class="bd-chip bd-chip-missing">не найдена</span>'
          : _statusChip(li.statusCat, li.status);
        return `<div class="bd-issue-row">
          ${issueLink}
          <span class="bd-issue-sum">${esc(trunc(li.summary || '', 90))}</span>
          ${statusBit}
        </div>`;
      }).join('');
      return `<div class="bd-team-block">
        <div class="bd-team-head">
          <b>${esc(team.projectName || team.pk)}</b>
          <span class="bd-team-mini"><span class="signal-dot signal-on-course" title="Завершено"></span>${team.done} · <span class="signal-dot signal-information" title="В работе"></span>${team.wip} · <span class="signal-dot signal-information signal-dot-pulse" style="opacity:.4" title="Не начато"></span>${team.todo}</span>
        </div>
        <div class="bd-team-issues">${rows}</div>
      </div>`;
    }).join('');
    return `<details class="bd-goal">
      <summary>
        <span class="bd-goal-chev">▸</span>
        ${goalLink}
        <span class="bd-goal-summary">${esc(g.summary || '—')}</span>
        ${_statusChip(g.statusCat, g.status)}
        <span class="bd-chip bd-chip-count">${linkedCount} привязано</span>
      </summary>
      <div class="bd-goal-body">${teamBlocks}</div>
    </details>`;
  }).join('');

  return `<div class="bd-goals">
    ${kpis}
    <div class="bd-goals-list">${goals || '<div class="bd-empty">— нет целей</div>'}</div>
  </div>`;
}

/* ── Tab: Покрытие ─────────────────────────────────────── */
export function renderCoverageTab(model) {
  const s = model.summary;
  const deltaUrl = safeUrl(model.deltaBaseUrl);
  // Total excluded count (epics + their children) across teams — surfaces
  // the V13 (7th-pass) exclusion rules: childless epics + epics with all-
  // new-status children. Keeps the user honest about what's NOT in the
  // denominator.
  const totalExcluded = (model.teamIssues || []).reduce((acc, t) => acc + (t.excluded || 0), 0);
  const kpiCov = `<div class="bd-kpi ${_coverageColorClass(s.coveragePct)}">
    <div class="bd-kpi-val">${s.coveragePct}%</div>
    <div class="bd-kpi-lab">Покрытие</div>
  </div>`;
  const kpiExcluded = totalExcluded > 0 ? `
    <div class="bd-kpi bd-kpi-excluded" title="Эпики без детей или с детьми только в начальном статусе исключены из расчёта покрытия">
      <div class="bd-kpi-val">${totalExcluded}</div>
      <div class="bd-kpi-lab">Исключено</div>
    </div>` : '';
  const kpis = `<div class="bd-kpis">
    <div class="bd-kpi bd-kpi-blue"><div class="bd-kpi-val">${s.linkedCount}</div><div class="bd-kpi-lab">Привязано</div></div>
    <div class="bd-kpi bd-kpi-grey"><div class="bd-kpi-val">${s.unlinkedCount}</div><div class="bd-kpi-lab">Без цели</div></div>
    ${kpiExcluded}
    ${kpiCov}
  </div>`;

  // Coverage bars per team — manual render to add absolute counts in the bar label.
  // V13 (15th pass): show project key alongside friendly name (Jira's
  // project.name often differs from the key — e.g., key SMEND maps to
  // "Credit process (KAR)" — without showing both, the user can't match
  // settings entries to the dashboard rows). For "all-excluded" teams
  // (total=0 but excluded>0), we surface the excluded count in the stats
  // column so 0/0 doesn't look like "team did nothing".
  // V22 fix #13/#14 (2026-05-09 UX) — coverage-row перестроен в grid:
  // name | progress-bar | PK (right-align ↦ к bar) | linked/total | (pct%) |
  // excluded | signal. Все колонки фиксированной ширины ⇒ значения стоят
  // ровными столбцами через все строки.
  const maxTotal = model.coverageByTeam.length ? Math.max(...model.coverageByTeam.map(t => t.total)) : 0;
  const coverageBars = model.coverageByTeam.map(t => {
    const friendlyDiffers = t.name && t.name !== t.pk;
    const nameText = friendlyDiffers ? t.name : (t.name || t.pk);
    const pkBadge = friendlyDiffers
      ? `<span class="bd-cov-pk" title="Project key">${esc(t.pk)}</span>`
      : '';
    const excludedHtml = t.excluded > 0
      ? `<span class="bd-cov-excl" title="Задач исключено правилами (sub-task / bug / cancelled / done-before-quarter и т.п.)">искл. ${t.excluded}</span>`
      : `<span class="bd-cov-excl bd-cov-excl-empty">—</span>`;
    const fromGoalsNote = (t.total === 0 && (t.linkedFromGoals || 0) > 0)
      ? `<span class="bd-cov-from-goals" title="Delta не вернула задачи этой команды, но ${t.linkedFromGoals} задач привязаны к целям через Sigma (видны во вкладке «Цели»)">привязано через цели: ${t.linkedFromGoals}</span>`
      : '';
    const titleAttr = friendlyDiffers ? `${t.name} [${t.pk}]` : (t.name || t.pk);
    const tier = _coverageTier(t.pct);
    return `
    <div class="bd-cov-row${t.total === 0 ? ' bd-cov-row-empty' : ''}">
      <span class="bd-cov-name" title="${esc(titleAttr)}">${esc(nameText)}</span>
      <div class="bd-cov-track">
        <div class="bd-cov-fill ${_coverageColorClass(t.pct)}" data-pct-tier="${tier.tier}" style="width:${maxTotal ? (t.total/maxTotal)*100 : 0}%">
          <div class="bd-cov-fill-inner" style="width:${t.total ? (t.linked/t.total)*100 : 0}%"></div>
        </div>
      </div>
      ${pkBadge || '<span class="bd-cov-pk-empty"></span>'}
      <span class="bd-cov-stats-num"><b class="num-tnum">${t.linked}/${t.total}</b></span>
      <span class="bd-cov-stats-pct num-tnum">(${t.pct}%)</span>
      ${excludedHtml}
      <span class="bd-cov-signal" title="${esc(tier.label)}">
        <span class="signal-dot signal-${tier.signal}" aria-hidden="true"></span>${esc(tier.label)}
      </span>
      ${fromGoalsNote ? `<div class="bd-cov-from-goals-line">${fromGoalsNote}</div>` : ''}
    </div>`;
  }).join('');

  // Per-team unlinked lists — sorted by unlinked count desc, capped 80 per team.
  const unlinkedSection = model.teamIssues.length
    ? model.teamIssues
        .map(t => ({ ...t, unCount: t.unlinkedIssues.length }))
        .filter(t => t.unCount > 0)
        .sort((a, b) => b.unCount - a.unCount)
        .map(t => {
          const list = t.unlinkedIssues.slice(0, 80);
          const more = t.unlinkedIssues.length > 80 ? `<div class="bd-more">…ещё ${t.unlinkedIssues.length - 80}</div>` : '';
          const rows = list.map(it => {
            const link = deltaUrl
              ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(it.key)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(it.key)}</a>`
              : `<span class="bd-issue-key">${esc(it.key)}</span>`;
            return `<div class="bd-issue-row">
              ${link}
              <span class="bd-issue-sum">${esc(trunc(it.summary || '', 90))}</span>
              <span class="bd-issue-type">${esc(it.type || '')}</span>
              ${_statusChip(it.statusCat, it.status)}
            </div>`;
          }).join('');
          return `<details class="bd-team-unlinked">
            <summary>${esc(t.name)} <span class="bd-chip bd-chip-grey">${t.unCount} без цели</span></summary>
            <div class="bd-team-issues">${rows}${more}</div>
          </details>`;
        }).join('')
    : '';

  // V13 (7th pass) — per-team type breakdown. For each team that has
  // a non-empty `byType`, render a small table: type | total | linked |
  // pct | excluded. Helps the user see WHERE coverage gaps live (e.g.,
  // "stories are 90% linked but bugs are 10%").
  const typeBreakdownSection = (model.teamIssues || [])
    .filter(t => t.byType && Object.keys(t.byType).length > 0)
    .map(t => {
      // Stable column order: Epic, Story, Task, Bug, Sub-task, then anything else alpha.
      const KNOWN_ORDER = ['Epic', 'Story', 'Task', 'Bug', 'Sub-task'];
      const allTypes = Object.keys(t.byType || {});
      const known    = KNOWN_ORDER.filter(k => allTypes.includes(k));
      const unknown  = allTypes.filter(k => !KNOWN_ORDER.includes(k)).sort();
      const types    = [...known, ...unknown];

      const rows = types.map(typeName => {
        const r = t.byType[typeName] || { total: 0, linked: 0, excluded: 0, statuses: { done: 0, wip: 0, todo: 0 }, statusDetail: {} };
        const pct = r.total ? Math.round(r.linked / r.total * 100) : 0;
        const excludedCell = r.excluded > 0
          ? `<span class="bd-type-excl" title="Исключено из покрытия (правила «без детей» / «все дети в начальном статусе»)">${r.excluded}</span>`
          : '<span class="bd-type-excl-empty">—</span>';
        // High-level bucketed pills (done / wip / todo) — kept for at-a-glance.
        const sts = r.statuses || { done: 0, wip: 0, todo: 0 };
        const statusCell = `<span class="bd-type-st">
          <span class="bd-type-st-pill bd-chip-done"  title="Завершено (statusCategory=done)">${sts.done}</span>
          <span class="bd-type-st-pill bd-chip-wip"   title="В работе (statusCategory=indeterminate)">${sts.wip}</span>
          <span class="bd-type-st-pill bd-chip-todo"  title="Не начато (statusCategory=new)">${sts.todo}</span>
        </span>`;

        // V13 (9th pass): detailed per-status-NAME breakdown sub-row.
        // Sorted DESC by count, then by category (done first, then wip, then todo)
        // so the most-impactful statuses lead. Each pill colour-coded by category.
        const detail = r.statusDetail || {};
        const detailEntries = Object.entries(detail)
          .map(([name, v]) => ({ name, count: v?.count || 0, cat: v?.cat || 'new' }))
          .filter(e => e.count > 0)
          .sort((a, b) => b.count - a.count);
        let statusDetailRow = '';
        if (detailEntries.length) {
          const pillCls = (cat) => cat === 'done' ? 'bd-chip-done'
                                : cat === 'indeterminate' ? 'bd-chip-wip'
                                : 'bd-chip-todo';
          const pills = detailEntries.map(e =>
            `<span class="bd-type-stdet-pill ${pillCls(e.cat)}" title="${esc(e.name)}: ${e.count}">${esc(e.name)}<span class="bd-type-stdet-num">${e.count}</span></span>`
          ).join('');
          statusDetailRow = `<tr class="bd-type-stdet-row">
            <td colspan="6">
              <span class="bd-type-example-label">статусы:</span>
              ${pills}
            </td>
          </tr>`;
        }

        // Example sub-row — only if we have an exampleKey.
        let exampleRow = '';
        if (r.exampleKey) {
          const link = deltaUrl
            ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(r.exampleKey)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(r.exampleKey)}</a>`
            : `<span class="bd-issue-key">${esc(r.exampleKey)}</span>`;
          const linkedBadge = r.exampleLinked
            ? `<span class="bd-chip bd-chip-good" title="Привязано к цели">${Icons.get('check', { cls: 'btn-icon', size: 12 })} цель</span>`
            : '<span class="bd-chip bd-chip-grey" title="Без цели">без цели</span>';
          exampleRow = `<tr class="bd-type-example-row">
            <td colspan="6">
              <span class="bd-type-example-label">пример:</span>
              ${link}
              <span class="bd-type-example-sum">${esc(trunc(r.exampleSummary || '', 100))}</span>
              ${_statusChip(r.exampleStatusCat || 'new', r.exampleStatus || '')}
              ${linkedBadge}
            </td>
          </tr>`;
        }
        return `<tr>
          <td class="bd-type-name">${esc(typeName)}</td>
          <td class="bd-type-num">${r.total}</td>
          <td class="bd-type-num">${r.linked}</td>
          <td class="bd-type-num bd-type-pct ${_coverageColorClass(pct)}">${pct}%</td>
          <td class="bd-type-num">${excludedCell}</td>
          <td class="bd-type-num bd-type-statuses">${statusCell}</td>
        </tr>${statusDetailRow}${exampleRow}`;
      }).join('');

      return `<details class="bd-type-team">
        <summary class="bd-type-team-summary">
          ${esc(t.name)}
          <span class="bd-type-team-meta">${t.linked}/${t.total} (${t.total ? Math.round(t.linked/t.total*100) : 0}%)</span>
        </summary>
        <table class="bd-type-table">
          <thead><tr>
            <th>Тип</th>
            <th>Всего</th>
            <th>Привязано</th>
            <th>%</th>
            <th title="Исключено правилами">Искл.</th>
            <th title="Завершено · В работе · Не начато">Статусы</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>`;
    }).join('');

  // Excluded items — informational section so the user can audit which
  // issues dropped from coverage and why. V13 (10th pass): broadened from
  // "epics only" to ALL excluded items, grouped by reason. Each group is
  // its own collapsible details. Capped 80 items per group.
  const excludedSection = (() => {
    const items = [];
    for (const t of (model.teamIssues || [])) {
      for (const it of (t.issues || [])) {
        if (!it.excluded) continue;
        items.push({ ...it, teamName: t.name });
      }
    }
    if (!items.length) return '';

    // Human-readable label for each reason. Typed-rule reasons keep the
    // raw rule name (e.g. "Bug" / "Cancelled") so the user sees exactly
    // what fired. Format from server: 'rule:type:Bug' / 'rule:status:X' /
    // 'rule:cancelled:Story' / 'no-children' / 'all-new-status' /
    // 'all-children-excluded' / 'parent-epic-<reason>'.
    const labelOfReason = (reason) => {
      if (!reason) return '—';
      if (reason.startsWith('rule:type:'))     return `тип: ${reason.slice('rule:type:'.length)}`;
      if (reason.startsWith('rule:status:'))   return `статус: ${reason.slice('rule:status:'.length)}`;
      if (reason.startsWith('rule:cancelled:')) {
        const t = reason.slice('rule:cancelled:'.length);
        // Special-case the Task+To Do pair separately for clearer label —
        // server still emits `rule:cancelled:Task` for the To Do pair due
        // to the shared reason-key convention; check raw status if needed.
        return `${t} в Cancelled`;
      }
      if (reason === 'rule:done-before-quarter')        return 'Done до начала квартала';
      if (reason.startsWith('rule:done-before-quarter:')) {
        const date = reason.slice('rule:done-before-quarter:'.length);
        return `Done до начала квартала (resolved ${date})`;
      }
      if (reason === 'no-children')            return 'нет детей';
      if (reason === 'all-new-status')         return 'все дети в начальном статусе';
      if (reason === 'all-children-excluded')  return 'все дети исключены правилами';
      if (reason.startsWith('parent-epic-no-children'))            return 'родитель — эпик без детей';
      if (reason.startsWith('parent-epic-all-new-status'))         return 'родитель — эпик с детьми в new';
      if (reason.startsWith('parent-epic-all-children-excluded'))  return 'родитель — эпик где все дети исключены';
      if (reason.startsWith('parent-epic-'))   return 'наследовано от эпика';
      return reason;
    };

    // Group by reason. To avoid fragmenting `rule:done-before-quarter:<date>`
    // into one bucket per resolution-date, canonicalise by chopping the
    // trailing payload after the third `:` for that specific reason.
    const canonReason = (reason) => {
      if (!reason) return '—';
      if (reason.startsWith('rule:done-before-quarter:')) return 'rule:done-before-quarter';
      return reason;
    };
    const byReason = new Map();
    for (const it of items) {
      const r = canonReason(it.excludedReason);
      if (!byReason.has(r)) byReason.set(r, []);
      byReason.get(r).push(it);
    }
    const groups = [...byReason.entries()]
      .sort((a, b) => b[1].length - a[1].length);

    const renderGroup = (reason, groupItems) => {
      const list = groupItems
        .slice()
        .sort((a, b) => (a.teamName || '').localeCompare(b.teamName || '') || a.key.localeCompare(b.key))
        .slice(0, 80);
      const more = groupItems.length > 80 ? `<div class="bd-more">…ещё ${groupItems.length - 80}</div>` : '';
      const rows = list.map(it => {
        const link = deltaUrl
          ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(it.key)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(it.key)}</a>`
          : `<span class="bd-issue-key">${esc(it.key)}</span>`;
        return `<div class="bd-issue-row bd-issue-row-excluded">
          ${link}
          <span class="bd-issue-type">${esc(it.type || '')}</span>
          <span class="bd-issue-sum">${esc(trunc(it.summary || '', 90))}</span>
          <span class="bd-issue-team">${esc(it.teamName || '')}</span>
          ${_statusChip(it.statusCat || 'new', it.status || '')}
          ${typeof it.childCount === 'number' ? `<span class="bd-issue-meta">${it.childCount} детей</span>` : ''}
        </div>`;
      }).join('');
      return `<details class="bd-excl-group">
        <summary class="bd-excl-group-summary">
          <span class="bd-excl-group-label">${esc(labelOfReason(reason))}</span>
          <span class="bd-chip bd-chip-grey">${groupItems.length}</span>
        </summary>
        <div class="bd-team-issues">${rows}${more}</div>
      </details>`;
    };

    const total = items.length;
    return `<details class="bd-team-unlinked bd-team-excluded" open>
      <summary>Исключено из покрытия <span class="bd-chip bd-chip-grey">${total}</span></summary>
      <div class="bd-excl-groups">
        ${groups.map(([r, g]) => renderGroup(r, g)).join('')}
      </div>
    </details>`;
  })();

  const allLinked = s.unlinkedCount === 0 && s.linkedCount > 0;
  return `<div class="bd-coverage">
    ${kpis}
    <div class="bd-section-title">Покрытие по командам</div>
    <div class="bd-cov-list">${coverageBars || '<div class="bd-empty">— нет команд</div>'}</div>
    ${typeBreakdownSection ? `<div class="bd-section-title">Детализация по типам задач</div><div class="bd-type-list">${typeBreakdownSection}</div>` : ''}
    <div class="bd-section-title">Не привязано к целям</div>
    ${allLinked ? `<div class="bd-empty bd-empty-success">${Icons.get('check-circle', { cls: 'btn-icon', size: 14 })} Все эпики/истории привязаны к целям!</div>` : (unlinkedSection || '<div class="bd-empty">— нет данных</div>')}
    ${excludedSection}
  </div>`;
}

/* ── Tab: Метрики ──────────────────────────────────────── */
export function renderMetricsTab(model) {
  const m = model.metricBuckets;
  // V22 fix #15 (2026-05-09 UX) — howto-блок + унифицированные подзаголовки
  // в духе брендбука (CAPS-eyebrow + 32px space, как в Сканнере).
  const howto = `
    <div class="bd-metrics-howto" role="note">
      <div class="bd-metrics-howto-title">Что здесь:</div>
      <div class="bd-metrics-howto-text">
        Восемь визуализаций по покрытию целей. <b>Покрытие целями</b> — какая доля задач квартала привязана к Sigma-целям;
        чем больше — тем больше работы команды отображается в Чёрном дашборде. <b>% покрытия по командам</b> — кто из команд
        отстаёт по привязке. <b>Готовность по целям</b> — насколько каждая цель близка к финишу (по соотношению Done/всего).
        Tone-on-tone заливка по брендбуку §11: насыщенный синий = on track (≥80%), приглушённый = drift, бледный = off course.
      </div>
    </div>`;
  return `${howto}<div class="bd-metrics-grid">
    ${renderDonut('Покрытие целями',          m.donutCoverage)}
    ${renderDonut('Статусы привязанных задач', m.donutLinkedStatuses)}
    ${renderBars('% покрытия по командам',     m.barsCoveragePct, { suffix: '%' })}
    ${renderBars('Привязанных задач по командам', m.barsLinkedPerTeam)}
    ${renderBars('Готовность по целям, %',     m.barsReadinessByGoal, { suffix: '%' })}
    ${renderDonut('Типы привязанных задач',    m.donutTypesLinked)}
    ${renderDonut('Типы задач без цели',       m.donutTypesUnlinked)}
    ${renderBars('Задач на цель',              m.barsIssuesPerGoal)}
  </div>`;
}

/* ── Empty / loader / error states ────────────────────────── */
export function renderNotConfigured() {
  return `<div class="bd-state">
    <div class="bd-state-icon">${Icons.get('settings', { size: 32 })}</div>
    <div class="bd-state-title">Sigma Jira не настроена</div>
    <div class="bd-state-sub">Откройте настройки и заполните блок «Sigma Jira» (URL + токен + ключи целей).</div>
    <button class="int-btn int-btn-primary" id="bd-open-settings">Открыть настройки</button>
  </div>`;
}
export function renderNotLoaded() {
  return `<div class="bd-state">
    <div class="bd-state-icon">${Icons.get('inbox', { size: 32 })}</div>
    <div class="bd-state-title">Чёрный дашборд готов к загрузке</div>
    <div class="bd-state-sub">Sigma Jira настроена. Нажмите кнопку, чтобы получить данные.</div>
    <button class="int-btn int-btn-primary" id="bd-load-btn">Загрузить</button>
  </div>`;
}
/* V22 Brand B2 — PrismaLoader L2 (page-level).
   Заменяет «бывший» meme-grin (мерцающие глаза + светящаяся ухмылка
   с feGaussianBlur-glow) на единый brand-glyph: 8-лучевая Призма-звезда
   + крутящееся ring-кольцо + статичный caption. Брендбук §11 запрещает
   круговой spinner и feGaussianBlur-свечение; §12 запрещает эмодзи.
   #bd-loader-status — функциональный статус (elapsed-time, обновляется
   через onProgress). Phrase-rotator в blackDashboard.js удалён. */
export function renderLoader() {
  return `<div class="bd-loader">
    ${prizmaLoaderMark()}
    <div class="bd-loader-phrase phrase-in" id="bd-loader-phrase"></div>
    <div class="bd-loader-status" id="bd-loader-status">Идёт запрос к Sigma + Delta…</div>
    <div class="bd-loader-hint">Корп Jira может тормозить — это нормально, не закрывайте вкладку.</div>
    <button class="int-btn int-btn-ghost int-btn-sm" id="bd-loader-cancel" type="button">${Icons.get('x', { cls: 'btn-icon', size: 14 })} Отменить</button>
  </div>`;
}
export function renderError(message) {
  return `<div class="bd-state bd-state-error">
    <div class="bd-state-icon">${Icons.get('alert-triangle', { size: 32 })}</div>
    <div class="bd-state-title">Ошибка загрузки</div>
    <div class="bd-state-sub">${esc(message || 'Неизвестная ошибка')}</div>
    <button class="int-btn int-btn-primary" id="bd-retry-btn">Повторить</button>
  </div>`;
}
