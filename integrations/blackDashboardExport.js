'use strict';
/* ============================================================
   blackDashboardExport.js — V22 fix #16 (2026-05-09 UX)
   --
   Standalone HTML-выгрузка из Чёрного дашборда. Два режима:
     · 'goals'    — все цели + привязанные задачи, с фильтром по команде/цели
     · 'coverage' — таблица «Покрытие по командам», с фильтром по команде

   Файл self-contained: внутри inline CSS (брендбук-aligned: tone-on-tone,
   Mono-tabular nums, CAPS sub-headers) и vanilla JS для фильтрации
   через `<select>` без зависимостей — открывается в любом браузере без
   сети.

   Пользовательский поток: клик «Выгрузить HTML» в bd-header → меню «Цели /
   Покрытие» → blob-download `bd-{kind}-{ts}.html`.
   ============================================================ */

const _esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const _BASE_CSS = `
:root {
  --bg-1:#fafaf9; --bg-2:#f5f4f1; --card:#ffffff; --border:#e7e5e1;
  --text-1:#1c1917; --text-2:#44403c; --text-3:#78716c;
  --info:#3b82f6; --success:#22c55e; --warning:#f59e0b; --danger:#ef4444; --drift:#a78bfa;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text-1);
  background: var(--bg-1);
  padding: 32px;
  font-feature-settings: "tnum" 1, "lnum" 1;
}
header { max-width: 1280px; margin: 0 auto 24px; }
.h1 { font-size: 24px; font-weight: 700; margin: 0 0 4px; }
.eyebrow { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: var(--text-3); }
.meta { font-size: 12px; color: var(--text-3); margin-top: 6px; }
main { max-width: 1280px; margin: 0 auto; }
.toolbar { display: flex; gap: 12px; align-items: center; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; }
.toolbar label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--text-2); }
.toolbar select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; font: inherit; background: var(--card); color: var(--text-1); min-width: 200px; }
.toolbar .stats { margin-left: auto; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font-size: 13px; }
thead th { background: var(--bg-2); padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; color: var(--text-2); border-bottom: 1px solid var(--border); }
tbody td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr.hidden { display: none; }
.num { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums lining-nums; text-align: right; }
.pk { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; font-weight: 700; padding: 1px 6px; background: var(--bg-2); border-radius: 3px; color: var(--text-3); }
.bar { display: inline-block; height: 12px; background: var(--bg-2); border-radius: 6px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
.bar-fill { height: 100%; background: var(--info); }
.bar-fill.low  { opacity: .35; }
.bar-fill.mid  { opacity: .65; }
.bar-fill.high { opacity: 1.0; }
.signal-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
.signal-dot.high { background: var(--success); }
.signal-dot.mid  { background: var(--warning); }
.signal-dot.low  { background: var(--danger); }
.subitem { display: block; padding: 6px 0; border-top: 1px dashed var(--border); margin-top: 6px; font-size: 12px; color: var(--text-2); }
.subitem:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
.subitem .key { font-family: ui-monospace, monospace; font-weight: 700; color: var(--text-1); margin-right: 8px; }
.subitem .status { display: inline-block; padding: 1px 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; border-radius: 3px; margin-left: 6px; }
.status-Done { background: color-mix(in srgb, var(--success) 18%, var(--card)); color: var(--success); }
.status-In  { background: color-mix(in srgb, var(--info) 18%, var(--card)); color: var(--info); }
.status-To  { background: color-mix(in srgb, var(--text-3) 18%, var(--card)); color: var(--text-3); }
/* 2026-05-11 — per-team unlinked details (collapsible). Brandbook:
   3px stripe-left для активных <details[open]>, tone-on-tone hover,
   Mono-tabular nums для счётчиков. */
.team-block { margin-top: 8px; }
.team-block-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: var(--text-2); margin: 24px 0 8px; }
details.team-unlinked { background: var(--card); border: 1px solid var(--border); border-left: 3px solid transparent; border-radius: 6px; margin-bottom: 6px; transition: border-left-color .15s; }
details.team-unlinked[open] { border-left-color: var(--warning); }
details.team-unlinked summary { padding: 10px 14px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-1); display: flex; align-items: center; gap: 8px; list-style: none; }
details.team-unlinked summary::-webkit-details-marker { display: none; }
details.team-unlinked summary::before { content: '▸'; font-size: 10px; color: var(--text-3); transition: transform .15s; display: inline-block; }
details.team-unlinked[open] summary::before { transform: rotate(90deg); }
.team-unlinked-count { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; padding: 1px 8px; background: color-mix(in srgb, var(--warning) 18%, var(--card)); color: var(--warning); border-radius: 10px; margin-left: auto; }
.team-issues { padding: 0 14px 14px; border-top: 1px solid var(--border); }
.issue-row { display: grid; grid-template-columns: 100px 1fr 90px 90px; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px dashed var(--border); font-size: 12px; }
.issue-row:last-child { border-bottom: none; }
.issue-key { font-family: ui-monospace, monospace; font-weight: 700; color: var(--info); text-decoration: none; }
.issue-key:hover { text-decoration: underline; }
.issue-sum { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.issue-type { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: .4px; }
.more-line { font-size: 11px; color: var(--text-3); padding: 6px 0; font-style: italic; }
footer { margin: 24px auto 0; max-width: 1280px; font-size: 11px; color: var(--text-3); text-align: center; }
`;

const _FILTER_JS = `
function applyFilter() {
  var teamSel = document.getElementById('f-team');
  var goalSel = document.getElementById('f-goal');
  var team = teamSel ? teamSel.value : '__all__';
  var goal = goalSel ? goalSel.value : '__all__';
  var rows = document.querySelectorAll('tbody tr[data-team]');
  var visible = 0;
  rows.forEach(function(tr) {
    var tTeam = tr.getAttribute('data-team') || '';
    var tGoal = tr.getAttribute('data-goal') || '';
    var ok = (team === '__all__' || tTeam === team) && (goal === '__all__' || tGoal === goal);
    tr.classList.toggle('hidden', !ok);
    if (ok) visible++;
  });
  // 2026-05-11 — Также фильтруем раскрывашки «Не привязанные задачи» по команде.
  // Goal-фильтр на них не действует (они per-team, не per-goal).
  var details = document.querySelectorAll('details.team-unlinked[data-team]');
  details.forEach(function(d) {
    var dTeam = d.getAttribute('data-team') || '';
    var ok = (team === '__all__' || dTeam === team);
    d.style.display = ok ? '' : 'none';
  });
  var counter = document.getElementById('row-counter');
  if (counter) counter.textContent = 'Видно: ' + visible + ' из ' + rows.length;
}
document.addEventListener('DOMContentLoaded', function() {
  var t = document.getElementById('f-team');
  var g = document.getElementById('f-goal');
  if (t) t.addEventListener('change', applyFilter);
  if (g) g.addEventListener('change', applyFilter);
  applyFilter();
});
`;

function _coverageTier(pct) {
  if (pct >= 80) return { tier: 'high', signal: 'high', label: 'На курсе' };
  if (pct >= 50) return { tier: 'mid',  signal: 'mid',  label: 'Дрейф' };
  return { tier: 'low', signal: 'low', label: 'Сбился с курса' };
}

function _statusClass(statusCat) {
  const c = String(statusCat || '').toLowerCase();
  if (c.includes('done'))                   return 'status-Done';
  if (c.includes('progress') || c === 'in') return 'status-In';
  return 'status-To';
}

/** Build «Цели» export — list of goals with linked issues, filterable by team/goal. */
function _buildGoalsHtml(model) {
  const goals = (model.goals || []).filter(g => !g.error);
  const teams = new Set();
  for (const g of goals) {
    for (const it of (g.linkedIssues || [])) {
      if (it.pk) teams.add(it.pk);
    }
  }
  const teamOptions = ['<option value="__all__">— Все команды —</option>']
    .concat(Array.from(teams).sort().map(pk => `<option value="${_esc(pk)}">${_esc(pk)}</option>`))
    .join('');
  const goalOptions = ['<option value="__all__">— Все цели —</option>']
    .concat(goals.map(g => `<option value="${_esc(g.key)}">${_esc(g.key)} · ${_esc((g.summary || '').slice(0, 60))}</option>`))
    .join('');

  const rows = goals.flatMap(g => {
    const issues = g.linkedIssues || [];
    if (!issues.length) {
      return `<tr data-team="" data-goal="${_esc(g.key)}">
        <td><span class="pk">—</span></td>
        <td><b>${_esc(g.key)}</b> — ${_esc(g.summary || '—')}</td>
        <td>—</td>
        <td>—</td>
        <td><span class="status status-To">Нет задач</span></td>
      </tr>`;
    }
    return issues.map(it => `<tr data-team="${_esc(it.pk || '')}" data-goal="${_esc(g.key)}">
      <td><span class="pk">${_esc(it.pk || '—')}</span></td>
      <td><b>${_esc(g.key)}</b> — ${_esc((g.summary || '').slice(0, 80))}</td>
      <td><b>${_esc(it.key || '')}</b> ${_esc((it.summary || '').slice(0, 80))}</td>
      <td>${_esc(it.type || '—')}</td>
      <td><span class="status ${_statusClass(it.statusCat)}">${_esc(it.status || '—')}</span></td>
    </tr>`).join('');
  }).join('');

  return `
    <div class="toolbar">
      <label for="f-team">Команда:</label>
      <select id="f-team">${teamOptions}</select>
      <label for="f-goal">Цель (Sment):</label>
      <select id="f-goal">${goalOptions}</select>
      <span class="stats" id="row-counter">—</span>
    </div>
    <table>
      <thead>
        <tr><th>PK</th><th>Цель</th><th>Задача</th><th>Тип</th><th>Статус</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Build «Покрытие» export — coverage by team table, filterable. */
function _buildCoverageHtml(model) {
  const teams = (model.coverageByTeam || []).slice().sort((a, b) => (b.total || 0) - (a.total || 0));
  const teamOptions = ['<option value="__all__">— Все команды —</option>']
    .concat(teams.map(t => `<option value="${_esc(t.pk)}">${_esc(t.pk)} (${_esc(t.name || t.pk)})</option>`))
    .join('');
  const maxTotal = teams.length ? Math.max(...teams.map(t => t.total || 0)) : 0;

  const rows = teams.map(t => {
    const tier = _coverageTier(t.pct || 0);
    const widthOuter = maxTotal ? Math.round((t.total || 0) / maxTotal * 100) : 0;
    const widthInner = (t.total ? Math.round((t.linked || 0) / t.total * 100) : 0);
    return `<tr data-team="${_esc(t.pk)}" data-goal="">
      <td>${_esc(t.name || t.pk)}</td>
      <td><span class="pk">${_esc(t.pk)}</span></td>
      <td>
        <span class="bar" style="width:${widthOuter}%"><span class="bar-fill ${_esc(tier.tier)}" style="width:${widthInner}%; display:block; height:100%"></span></span>
      </td>
      <td class="num"><b>${t.linked || 0}/${t.total || 0}</b></td>
      <td class="num">${t.pct || 0}%</td>
      <td class="num">${t.excluded ? `искл. ${t.excluded}` : '—'}</td>
      <td><span class="signal-dot ${_esc(tier.signal)}"></span>${_esc(tier.label)}</td>
    </tr>`;
  }).join('');

  // 2026-05-11 — per-team unlinked details. Mirror main-dashboard renderer
  // (blackDashboardRenderer.js:581-606). Каждая team — раскрывашка <details>
  // со списком всех задач не привязанных к Sigma-цели. Cap 80 issues per team
  // (consistent с UI), остальное в виде «…ещё N». Issue-key — ссылка в Delta
  // если model.deltaBaseUrl выставлен.
  const unlinkedDetails = _buildTeamUnlinkedDetails(model);

  return `
    <div class="toolbar">
      <label for="f-team">Команда:</label>
      <select id="f-team">${teamOptions}</select>
      <span class="stats" id="row-counter">—</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Команда</th><th>PK</th><th>Прогресс</th><th>Привязано</th><th>%</th><th>Исключено</th><th>Курс</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${unlinkedDetails}`;
}

/* 2026-05-11 — Build per-team collapsible <details> blocks listing all
   unlinked issues (без привязки к Sigma-цели). Cap 80 per team. Mirror of
   blackDashboardRenderer.js:581-606 logic — same fields, same filter
   (`unlinkedIssues` уже отфильтрован в model normalizer: !linkedToGoal
   && !excluded). Status pills используют классы .status-Done/In/To
   (existing CSS). Self-contained — без зависимостей. */
function _buildTeamUnlinkedDetails(model) {
  const teams = Array.isArray(model?.teamIssues) ? model.teamIssues : [];
  const deltaBase = String(model?.deltaBaseUrl || '').replace(/\/+$/, '');
  // Safety: URL injection guard — accept только http(s) baseUrl.
  const deltaOk = /^https?:\/\//.test(deltaBase);
  const teamsWithUnlinked = teams
    .map(t => ({ ...t, unCount: (t.unlinkedIssues || []).length }))
    .filter(t => t.unCount > 0)
    .sort((a, b) => b.unCount - a.unCount);

  if (!teamsWithUnlinked.length) {
    return `<div class="team-block">
      <div class="team-block-title">Не привязанные задачи по командам</div>
      <div class="more-line">У всех команд задачи привязаны к целям ✓</div>
    </div>`;
  }

  const _statusClass = (cat) => {
    const s = String(cat || '').toLowerCase();
    if (s.includes('done') || s === 'done') return 'Done';
    if (s.includes('progress') || s === 'in_progress' || s === 'inprogress') return 'In';
    return 'To';
  };

  const blocks = teamsWithUnlinked.map(t => {
    const list = (t.unlinkedIssues || []).slice(0, 80);
    const more = t.unlinkedIssues.length > 80
      ? `<div class="more-line">…ещё ${t.unlinkedIssues.length - 80} задач не показано</div>` : '';
    const issueRows = list.map(it => {
      const keyEsc = _esc(it.key || '');
      const keyHtml = (deltaOk && it.key)
        ? `<a class="issue-key" href="${_esc(deltaBase)}/browse/${keyEsc}" target="_blank" rel="noopener noreferrer">${keyEsc}</a>`
        : `<span class="issue-key">${keyEsc}</span>`;
      const statusCls = _statusClass(it.statusCat);
      const statusLabel = _esc(it.status || it.statusCat || '');
      return `<div class="issue-row">
        ${keyHtml}
        <span class="issue-sum" title="${_esc(it.summary || '')}">${_esc((it.summary || '').slice(0, 90))}</span>
        <span class="issue-type">${_esc(it.type || '')}</span>
        <span class="status status-${statusCls}">${statusLabel}</span>
      </div>`;
    }).join('');
    return `<details class="team-unlinked" data-team="${_esc(t.pk || '')}">
      <summary>
        ${_esc(t.name || t.pk || '')}
        <span class="team-unlinked-count">${t.unCount}</span>
      </summary>
      <div class="team-issues">${issueRows}${more}</div>
    </details>`;
  }).join('');

  const totalUnlinked = teamsWithUnlinked.reduce((s, t) => s + t.unCount, 0);
  return `<div class="team-block">
    <div class="team-block-title">Не привязанные задачи — ${totalUnlinked} в ${teamsWithUnlinked.length} команд${teamsWithUnlinked.length === 1 ? 'е' : (teamsWithUnlinked.length < 5 ? 'ах' : 'ах')}</div>
    ${blocks}
  </div>`;
}

/**
 * Build self-contained HTML document for a Чёрный дашборд export.
 * @param {object} model     - bd model (must contain goals|coverageByTeam)
 * @param {'goals'|'coverage'} kind
 * @returns {string} HTML doc
 */
export function buildBlackDashboardExportHtml(model, kind) {
  const isGoals = kind === 'goals';
  const title = isGoals ? 'Чёрный дашборд — Цели' : 'Чёрный дашборд — Покрытие';
  const body = isGoals ? _buildGoalsHtml(model) : _buildCoverageHtml(model);
  const ts = new Date().toLocaleString('ru-RU');
  const totalGoals = (model.goals || []).length;
  const totalTeams = (model.coverageByTeam || []).length;
  const coveragePct = model.summary?.coveragePct ?? '—';
  const subtitle = isGoals
    ? `${totalGoals} целей · ${totalTeams} команд · покрытие ${coveragePct}%`
    : `${totalTeams} команд · покрытие ${coveragePct}%`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_esc(title)} · ${_esc(ts)}</title>
  <style>${_BASE_CSS}</style>
</head>
<body>
  <header>
    <div class="eyebrow">Призма · Чёрный дашборд</div>
    <h1 class="h1">${_esc(title)}</h1>
    <div class="meta">${_esc(subtitle)} · выгружено ${_esc(ts)}</div>
  </header>
  <main>${body}</main>
  <footer>Self-contained HTML · фильтры работают без сети · Призма Чёрный дашборд</footer>
  <script>${_FILTER_JS}</script>
</body>
</html>`;
}

/** Trigger browser download for the export blob. */
export function downloadBlackDashboardExport(model, kind) {
  const html = buildBlackDashboardExportHtml(model, kind);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  a.href     = url;
  a.download = `bd-${kind}-${ts}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
