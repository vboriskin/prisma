'use strict';
/* ============================================================
   BLACK DASHBOARD — RENDERER
   Pure rendering — strings only, no side effects. Three tabs:
   🎯 Цели · 🔗 Покрытие · 📈 Метрики.
   ============================================================ */

import { esc, trunc } from './portfolioPulseUtils.js';
import { renderDonut, renderBars } from './portfolioPulseMetrics.js';

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

/* ── Top header (sub-tabs + refresh) ─────────────────────── */
export function renderTopHeader(model, activeTab, fetchedAtLabel) {
  const tabs = [
    { id: 'goals',    label: '🎯 Цели' },
    { id: 'coverage', label: '🔗 Покрытие' },
    { id: 'metrics',  label: '📈 Метрики' },
  ];
  const errBlock = model.errors?.length
    ? `<div class="bd-error-banner">${model.errors.map(e => `<div>⚠ <b>${esc(e.scope || '?')}</b>: ${esc(e.message || '')}</div>`).join('')}</div>`
    : '';
  // Diagnostics block — always rendered (collapsed by default), but
  // auto-expanded when there's an error so user sees context immediately.
  const hasErrors = !!(model.errors?.length);
  const diagBlock = _renderDiagnosticsDetails(model)
    .replace('<details class="bd-diag-details">', `<details class="bd-diag-details${hasErrors ? ' bd-diag-error' : ''}"${hasErrors ? ' open' : ''}>`);
  return `<div class="bd-header">
    <div class="bd-header-row">
      <h3 class="bd-title">⚫ Чёрный дашборд</h3>
      <div class="bd-header-meta">
        <span class="bd-fetched">обновлено: ${esc(fetchedAtLabel)}</span>
        <button class="int-btn int-btn-primary int-btn-sm" id="bd-refresh-btn" title="Перезагрузить данные с серверов">↻ Обновить</button>
      </div>
    </div>
    ${errBlock}
    ${diagBlock}
    <div class="bd-tabs">
      ${tabs.map(t => `<button class="bd-tab ${activeTab===t.id?'bd-tab-active':''}" data-bd-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>
  </div>`;
}

/* ── Tab: 🎯 Цели ─────────────────────────────────────────── */
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
      ? `<a class="bd-goal-key" href="${esc(sigmaUrl)}/browse/${esc(g.key)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(g.key)}</a>`
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
          ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(li.key)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(li.key)}</a>`
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
          <span class="bd-team-mini">✅ ${team.done} · ▶ ${team.wip} · ☐ ${team.todo}</span>
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

/* ── Tab: 🔗 Покрытие ─────────────────────────────────────── */
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
  const maxTotal = model.coverageByTeam.length ? Math.max(...model.coverageByTeam.map(t => t.total)) : 0;
  const coverageBars = model.coverageByTeam.map(t => {
    const friendlyDiffers = t.name && t.name !== t.pk;
    const nameHtml = friendlyDiffers
      ? `<span class="bd-cov-name-text">${esc(t.name)}</span><span class="bd-cov-pk" title="Project key">${esc(t.pk)}</span>`
      : `<span class="bd-cov-name-text">${esc(t.name || t.pk)}</span>`;
    const excludedNote = t.excluded > 0
      ? ` <span class="bd-cov-excl" title="Задач исключено правилами (sub-task / bug / cancelled / done-before-quarter и т.п.)">искл. ${t.excluded}</span>`
      : '';
    const titleAttr = friendlyDiffers ? `${t.name} [${t.pk}]` : (t.name || t.pk);
    return `
    <div class="bd-cov-row${t.total === 0 ? ' bd-cov-row-empty' : ''}">
      <span class="bd-cov-name" title="${esc(titleAttr)}">${nameHtml}</span>
      <div class="bd-cov-track">
        <div class="bd-cov-fill ${_coverageColorClass(t.pct)}" style="width:${maxTotal ? (t.total/maxTotal)*100 : 0}%">
          <div class="bd-cov-fill-inner" style="width:${t.total ? (t.linked/t.total)*100 : 0}%"></div>
        </div>
      </div>
      <span class="bd-cov-stats">${t.linked}/${t.total} <b>(${t.pct}%)</b>${excludedNote}</span>
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
              ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(it.key)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(it.key)}</a>`
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
            ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(r.exampleKey)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(r.exampleKey)}</a>`
            : `<span class="bd-issue-key">${esc(r.exampleKey)}</span>`;
          const linkedBadge = r.exampleLinked
            ? '<span class="bd-chip bd-chip-good" title="Привязано к цели">✓ цель</span>'
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
            <th title="✓ Завершено · ◐ В работе · ○ Не начато">Статусы</th>
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
          ? `<a class="bd-issue-key" href="${esc(deltaUrl)}/browse/${esc(it.key)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(it.key)}</a>`
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
    ${allLinked ? '<div class="bd-empty bd-empty-success">🎉 Все эпики/истории привязаны к целям!</div>' : (unlinkedSection || '<div class="bd-empty">— нет данных</div>')}
    ${excludedSection}
  </div>`;
}

/* ── Tab: 📈 Метрики ──────────────────────────────────────── */
export function renderMetricsTab(model) {
  const m = model.metricBuckets;
  return `<div class="bd-metrics-grid">
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
    <div class="bd-state-icon">⚙</div>
    <div class="bd-state-title">Sigma Jira не настроена</div>
    <div class="bd-state-sub">Откройте настройки и заполните блок «Sigma Jira» (URL + токен + ключи целей).</div>
    <button class="int-btn int-btn-primary" id="bd-open-settings">Открыть настройки</button>
  </div>`;
}
export function renderNotLoaded() {
  return `<div class="bd-state">
    <div class="bd-state-icon">📥</div>
    <div class="bd-state-title">Чёрный дашборд готов к загрузке</div>
    <div class="bd-state-sub">Sigma Jira настроена. Нажмите кнопку, чтобы получить данные.</div>
    <button class="int-btn int-btn-primary" id="bd-load-btn">Загрузить</button>
  </div>`;
}
/* V13 (11th pass): pp-style centered loader with rotating fun phrases.
   V13 (12th pass): Чёрный-дашборд-themed visual — pitch-black background
   with a face emerging from the dark (violet-glowing eyes + toothy grin),
   nodding to the «black guy in the dark» meme that fits the tab's name.
   Pure CSS, no images, fully animated:
     · Eyes blink at ~5s intervals (slightly out of sync — uncanny effect)
     · Whole face sways gently left↔right
     · Fade-in on first paint
   Two text rows below the face:
     #bd-loader-phrase  — humorous phrase (rotated every ~2.6s by orchestrator)
     #bd-loader-status  — functional status (elapsed time / phase, set on each /status poll)
   Plus a cancel button so the user can bail out early instead of staring
   at a frozen tab. */
export function renderLoader() {
  return `<div class="bd-loader bd-loader-meme">
    <div class="bd-meme-face" aria-hidden="true">
      <div class="bd-meme-eye bd-meme-eye-l"></div>
      <div class="bd-meme-eye bd-meme-eye-r"></div>
      <!-- V13 (14th pass) → V13 (16th pass): теперь тонкий Cheshire-cat
           полумесяц БЕЗ внутренних зубов-сепараторов. Глаза + узкая
           ухмылка из темноты — больше попадает в эстетику мема
           «черный в темноте», где издалека рот воспринимается как
           одна светлая дуга, а не сетка зубов. -->
      <svg class="bd-meme-grin" viewBox="0 0 200 50" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="bd-meme-grin-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stop-color="#ffffff"/>
            <stop offset="55%"  stop-color="#e5e7eb"/>
            <stop offset="100%" stop-color="#9ca3af"/>
          </linearGradient>
          <filter id="bd-meme-grin-glow" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="1.6" result="b"/>
            <feMerge>
              <feMergeNode in="b"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <!-- The crescent itself. Slim: top edge slightly bowed down,
             bottom edge bowed deeper. Vertical span ~24px out of 50px
             total viewBox = roughly half the previous height. -->
        <path d="M 22 14 Q 100 14 178 14 Q 100 38 22 14 Z"
              fill="url(#bd-meme-grin-grad)"
              filter="url(#bd-meme-grin-glow)"/>
        <!-- A whisper-thin highlight along the top edge — subtle
             specular reflection that helps the smile read as 3D. -->
        <path d="M 30 14 Q 100 17 170 14"
              stroke="rgba(255,255,255,.6)" stroke-width="0.6" fill="none"/>
      </svg>
    </div>
    <div class="bd-loader-phrase" id="bd-loader-phrase">⏳ Просыпаюсь, потягиваюсь…</div>
    <div class="bd-loader-status" id="bd-loader-status">Идёт запрос к Sigma + Delta…</div>
    <div class="bd-loader-hint">Корп Jira может тормозить — это нормально, не закрывайте вкладку.</div>
    <button class="int-btn int-btn-ghost int-btn-sm" id="bd-loader-cancel" type="button">✕ Отменить</button>
  </div>`;
}
export function renderError(message) {
  return `<div class="bd-state bd-state-error">
    <div class="bd-state-icon">⚠</div>
    <div class="bd-state-title">Ошибка загрузки</div>
    <div class="bd-state-sub">${esc(message || 'Неизвестная ошибка')}</div>
    <button class="int-btn int-btn-primary" id="bd-retry-btn">Повторить</button>
  </div>`;
}
