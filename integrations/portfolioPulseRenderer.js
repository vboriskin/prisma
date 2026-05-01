'use strict';
/* ============================================================
   PORTFOLIO PULSE — RENDERER
   Pure rendering — strings only, no side effects.
   ============================================================ */

import {
  esc, trunc, ts, daysAgo, hoursAgo,
  isTerminalStatus, isInitialStatus, statusBucket,
  typeBucket, typeBucketLabel, groupByBucket, formatHrs,
} from './portfolioPulseUtils.js';
import { renderDonut, renderBars, renderAgeHistogram } from './portfolioPulseMetrics.js';

/* ── Generic chips/issue-rows ──────────────────────────── */

// URL-scheme allowlist — only http(s) and mailto links are safe to use
// directly in href; everything else (javascript:, data:, file:) is dropped.
function safeUrl(u) {
  const s = String(u || '').trim();
  return /^(https?:|mailto:)/i.test(s) ? s : '';
}

// Render-time context (set per render pass by the orchestrator). Keeps
// `renderIssueRow` free of model-threading through 12+ nested call sites.
// Currently only carries the Jira base URL for "{base}/browse/{key}" links.
let _renderCtx = { jiraBaseUrl: '' };
export function setRenderContext(ctx) {
  _renderCtx = { jiraBaseUrl: '', ...(ctx || {}) };
  if (_renderCtx.jiraBaseUrl) _renderCtx.jiraBaseUrl = String(_renderCtx.jiraBaseUrl).replace(/\/+$/, '');
}

// Jira-style icons for the four issue type buckets. Emoji rendering matches
// the classic Jira UI conventions: green book = Story, red bug = Bug,
// blue check = Task, sub-task arrow = Sub-task. (#1.6)
const TYPE_ICON = {
  story:   '📗',
  task:    '✅',
  bug:     '🐞',
  subtask: '↳',
  other:   '🧩',
};

// Map of timeline event kinds to inline icons. Used by `renderTimeline` (per-day
// sections) AND `_renderTodaySection` (cross-source today feed) — module-scope
// because both are top-level functions; closure scope wouldn't reach the latter.
// Wave 1: status/comment/worklog/closed
// Wave 2: created
// Wave 4a: assignee-change, attachment, link, field-change
// Wave 4b: mention
const TL_KIND_ICON = (k) => ({
  closed:            '✅',
  transition:        '↪',
  comment:           '💬',
  worklog:           '⏱',
  created:           '➕',
  'assignee-change': '👤',
  attachment:        '📎',
  link:              '🔗',
  'field-change':    '✏️',
  mention:           '📣',
})[k] || '·';

// Priority icons — Jira uses up/down arrows + colour. We mimic with unicode
// arrows; `pp-prio-*` CSS class keeps the colour. (#1.7)
const PRIORITY_ICON = (p) => {
  const s = String(p || '').toLowerCase();
  if (s.includes('blocker') || s.includes('блокер'))         return '⛔';
  if (s.includes('highest') || s.includes('критич'))         return '🔺';
  if (s.includes('high')    || s.includes('высок'))          return '⬆';
  if (s.includes('medium')  || s.includes('средн'))          return '➖';
  if (s.includes('low')     || s.includes('низ'))            return '⬇';
  if (s.includes('lowest') || s.includes('минимал'))         return '🔻';
  return '•';
};

export function renderIssueRow(it, opts = {}) {
  const tooltip = `${it.status || ''}${it.type ? ' · ' + it.type : ''}${it.priority ? ' · ' + it.priority : ''}${it.duedate ? ' · до '+it.duedate : ''}${it.description ? '\n— '+trunc(it.description, 200) : ''}`;
  const parent  = it.parentKey ? `<span class="pp-issue-parent" title="${esc(it.parentKey)}: ${esc(it.parentSum||'')}">↪ ${esc(it.parentKey)}</span>` : '';
  // #1.7: status text — full string, no truncate. CSS handles overflow with no-wrap + max-width.
  const stat    = it.status ? `<span class="pp-issue-status pp-status-${statusBucket(it.status, it.statusCat)}" title="${esc(it.status)}">${esc(it.status)}</span>` : '';
  // #1.7: priority chip with arrow icon + label.
  const prio    = it.priority
    ? `<span class="pp-issue-prio pp-prio-${esc((it.priority||'').toLowerCase())}" title="Приоритет: ${esc(it.priority)}"><span class="pp-prio-icon">${PRIORITY_ICON(it.priority)}</span>${esc(it.priority)}</span>`
    : '';
  const help    = `<span class="pp-issue-help" title="${esc(tooltip)}">?</span>`;
  // #1.2: clickable issue key. If we have jiraBaseUrl in render-context,
  // wrap the key in <a target="_blank">. Click on the key opens Jira; the
  // rest of the row stays non-clickable so the user can still select text /
  // toggle parent <details> without accidentally navigating away.
  // `e.stopPropagation()` on the link prevents <details>/<summary> toggling.
  // Even though jiraBaseUrl comes from server config (trusted), gate it
  // through safeUrl() so a malformed setting can never inject javascript:.
  const baseUrl = safeUrl(_renderCtx.jiraBaseUrl);
  const keyText = esc(it.key||'—');
  const keyHtml = (baseUrl && it.key)
    ? `<a class="pp-issue-key pp-issue-key-link" href="${esc(baseUrl)}/browse/${esc(it.key)}" target="_blank" rel="noopener" title="Открыть в Jira" onclick="event.stopPropagation()">${keyText}</a>`
    : `<span class="pp-issue-key">${keyText}</span>`;
  return `<div class="pp-issue" data-key="${esc(it.key||'')}">
    <span class="pp-issue-pk">${esc(it.pk||'')}</span>
    ${keyHtml}
    <span class="pp-issue-sum">${esc(trunc(it.summary, 80))}</span>
    ${parent}
    ${stat}
    ${prio}
    ${help}
  </div>`;
}

export function renderTypeGroup(label, items, bucketKey) {
  if (!items?.length) return '';
  // #1.6: Jira-like icon prefix on the group title.
  const icon = TYPE_ICON[bucketKey] ?? TYPE_ICON.other;
  return `<div class="pp-group pp-group-${esc(bucketKey || 'other')}">
    <div class="pp-group-title"><span class="pp-group-icon" aria-hidden="true">${icon}</span>${esc(label)} <span class="pp-group-count">${items.length}</span></div>
    <div class="pp-group-list">${items.map(i => renderIssueRow(i)).join('')}</div>
  </div>`;
}

export function renderGroupedByType(issues) {
  const g = groupByBucket(issues);
  return [
    renderTypeGroup('Story',    g.story,   'story'),
    renderTypeGroup('Bug',      g.bug,     'bug'),
    renderTypeGroup('Task',     g.task,    'task'),
    renderTypeGroup('Sub-task', g.subtask, 'subtask'),
    renderTypeGroup('Прочее',   g.other,   'other'),
  ].join('') || '<div class="pp-empty-mini">— нет</div>';
}

/* ── Header (project-keys chips + refresh) ─────────────── */

export function renderTopHeader(model, activePk, fetchedAtLabel) {
  const pks = model.projectKeys || [];
  const errCount = (model.errors||[]).length;

  // Pill totals come from the SAME numbers shown on participant cards
  // (sum over `participants[*].badges.*`) so that "Bitbucket N" / "Confluence N"
  // never disagree with what the user can find in cards. Anything that
  // didn't match a participant (foreign committer, alias mismatch) is
  // surfaced separately as "ещё X от авторов вне команды" in the tooltip.
  const matchedBb = (model.participants || []).reduce(
    (s, p) => s + (p.badges?.commits48h || 0) + (p.badges?.pr48h || 0), 0);
  const matchedCf = (model.participants || []).reduce(
    (s, p) => s + (p.badges?.conf48h || 0), 0);

  // Bitbucket / Confluence connection pills — show why PR/commit/edit badges
  // might be empty. Three states each: not configured / connected (count) / error.
  const sourcePill = (label, info, matched) => {
    if (!info) return '';
    if (info.configured === false) {
      return `<span class="pp-src-pill pp-src-off" title="${esc(label)}: не настроен в Настройки → Интеграции">${esc(label)} —</span>`;
    }
    if (info.error) {
      return `<span class="pp-src-pill pp-src-err" title="${esc(label)}: ${esc(info.error)}">${esc(label)} ⚠</span>`;
    }
    const allTotal = Object.values(info.authors || {}).reduce(
      (s, a) => s + (a.commits||0) + (a.prs||0) + (a.edits||0), 0);
    const orphan = Math.max(0, allTotal - matched);
    const tip = orphan
      ? `${label}: ${matched} событий у участников · ещё ${orphan} от авторов вне команды (см. «Диагностика загрузки»)`
      : `${label}: ${matched} событий за 48ч`;
    if (!matched) {
      return `<span class="pp-src-pill pp-src-empty" title="${esc(tip)}">${esc(label)} 0${orphan?` <span class="pp-src-orphan">+${orphan}</span>`:''}</span>`;
    }
    return `<span class="pp-src-pill pp-src-ok" title="${esc(tip)}">${esc(label)} ${matched}${orphan?` <span class="pp-src-orphan">+${orphan}</span>`:''}</span>`;
  };

  return `<div class="pp-header">
    <div class="pp-header-row">
      <h3 class="pp-title">📡 Сканнер команд</h3>
      <div class="pp-header-meta">
        ${sourcePill('Bitbucket',  model.bitbucket,  matchedBb)}
        ${sourcePill('Confluence', model.confluence, matchedCf)}
        ${errCount ? `<span class="pp-err-pill" title="Сбойных пространств">⚠ ${errCount}</span>` : ''}
        <span class="pp-fetched">обновлено: ${esc(fetchedAtLabel)}</span>
        <button class="int-btn int-btn-primary int-btn-sm" id="pp-refresh-btn" title="Перезагрузить данные с серверов">↻ Обновить данные</button>
      </div>
    </div>
    ${renderDiagnostics(model)}
    <div class="pp-pk-chips" data-role="pk-switcher">
      <button class="pp-pk-chip ${!activePk?'pp-pk-active':''}" data-pk="">Все</button>
      ${pks.map(pk => `<button class="pp-pk-chip ${activePk===pk?'pp-pk-active':''}" data-pk="${esc(pk)}">${esc(pk)}<span class="pp-pk-count">${(model.spaces[pk]?.issues||[]).length}</span></button>`).join('')}
    </div>
  </div>`;
}

/* Diagnostics panel — collapsed by default. Shows per-PK timing + Bitbucket
   per-repo attempts + Confluence status. Explicitly answers "почему не
   тянется": HTTP code per attempt + first 80 chars of any error. */
function renderDiagnostics(model) {
  const d = model.diagnostics || {};
  const perPk = Array.isArray(d.perPk) ? d.perPk : [];
  const bb = model.bitbucket  || {};
  const cf = model.confluence || {};
  if (!perPk.length && !(d.log || []).length && !bb.tried && !cf.tried && !cf.error) return '';

  const slowCount = perPk.filter(p => p.ms > 15000).length;
  const failCount = perPk.filter(p => !p.ok).length;
  const summary = `${perPk.length} проект${perPk.length === 1 ? '' : 'ов'} · ${d.totalMs || 0}мс · `
    + (failCount ? `<span class="pp-diag-fail">${failCount} ошибок</span>` : '<span class="pp-diag-ok">без ошибок</span>')
    + (slowCount ? ` · <span class="pp-diag-slow">${slowCount} медленных (&gt;15с)</span>` : '');

  const pkRows = perPk.map(p => `
    <div class="pp-diag-row ${p.ok ? 'pp-diag-row-ok' : 'pp-diag-row-fail'}">
      <span class="pp-diag-mark">${p.ok ? '✓' : '⚠'}</span>
      <span class="pp-diag-pk">${esc(p.pk)}</span>
      <span class="pp-diag-ms">${p.ms || 0}мс</span>
      <span class="pp-diag-issues">${p.issues || 0} задач</span>
      ${p.error ? `<span class="pp-diag-err" title="${esc(p.error)}">${esc(String(p.error).slice(0,80))}</span>` : ''}
    </div>`).join('');

  const bbAuthorsList = Object.values(bb.authors || {});
  const bbTotalEvents = bbAuthorsList.reduce((s, a) => s + (a.commits || 0) + (a.prs || 0), 0);
  const bbTopAuthors  = bbAuthorsList
    .map(a => ({ name: a.displayName || '?', commits: a.commits || 0, prs: a.prs || 0 }))
    .filter(a => a.commits + a.prs > 0)
    .sort((a, b) => (b.commits + b.prs) - (a.commits + a.prs))
    .slice(0, 8);
  // Dev-status (Phase 1) — separate diagnostic line so the user sees how
  // many extra PRs/commits Jira's panel found that the repo-walk missed.
  const ds = bb.devStatus || {};
  const devStatusLine = (ds.scanned || ds.prs || ds.commits) ? `
    <div class="pp-diag-log-line">📡 <b>Dev-status Jira</b>: ${ds.scanned||0} вызовов · ${ds.prs||0} PR · ${ds.commits||0} commits ${ds.scanned===0?'(нет hot issues)':''}</div>` : '';

  const bbBlock = (bb.tried || bb.error || bbAuthorsList.length) ? `
    <div class="pp-diag-section">
      <div class="pp-diag-log-title">Bitbucket ${bb.error ? '⚠' : (bb.configured === false ? '— не настроен' : '✓')}${bb.configured !== false ? ` · ${bbTotalEvents} событий · ${bbAuthorsList.length} авторов` : ''}</div>
      ${bb.error ? `<div class="pp-diag-err">${esc(bb.error)}</div>` : ''}
      ${devStatusLine}
      ${(bb.tried || []).slice(0, 80).map(t => `
        <div class="pp-diag-log-line">${esc(t.entry || '')} · ${esc(t.type || '')} · HTTP ${t.status ?? '—'}${t.skipped ? ` · ${esc(t.skipped)}` : ''}</div>`).join('')}
      ${(bb.tried || []).length > 80 ? `<div class="pp-diag-log-line">… ещё ${(bb.tried||[]).length - 80} попыток</div>` : ''}
      ${bbTopAuthors.length ? `<div class="pp-diag-log-line"><b>Авторы:</b> ${bbTopAuthors.map(a => `${esc(a.name)} (${a.commits}c/${a.prs}pr)`).join(', ')}${bbAuthorsList.length > bbTopAuthors.length ? ` …+${bbAuthorsList.length - bbTopAuthors.length}` : ''}</div>` : ''}
    </div>` : '';

  // Authors that didn't get matched to any participant (alias mismatch / outside-team
  // contributors). Helps explain why pill totals are larger than per-card sums.
  const cfAuthors = Object.values(cf.authors || {});
  const cfTotal   = cfAuthors.reduce((s, a) => s + (a.edits || 0), 0);
  const cfStatus  = cf.error ? '⚠' : (cf.configured === false ? '— не настроен' : '✓');
  const cfTopAuthors = cfAuthors
    .map(a => ({ name: a.displayName || '?', n: a.edits || 0 }))
    .filter(a => a.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const cfBlock = (cf.tried || cf.error || cf.configured === false || cfAuthors.length) ? `
    <div class="pp-diag-section">
      <div class="pp-diag-log-title">Confluence ${cfStatus}${cf.configured !== false ? ` · ${cfTotal} правок · ${cfAuthors.length} авторов` : ''}</div>
      ${cf.error ? `<div class="pp-diag-err">${esc(cf.error)}</div>` : ''}
      ${(cf.tried || []).map(t => `
        <div class="pp-diag-log-line">${esc(t.type || 'cql')} · HTTP ${t.status ?? '—'}${t.results !== undefined ? ` · ${t.results} результатов` : ''}${t.url ? ` · <code>${esc(String(t.url).replace(/^https?:\/\/[^/]+/, ''))}</code>` : ''}${t.error ? ` · ${esc(String(t.error).slice(0,80))}` : ''}${t.cql ? ` · CQL: ${esc(String(t.cql).slice(0,80))}` : ''}</div>`).join('')}
      ${cfTopAuthors.length ? `<div class="pp-diag-log-line"><b>Авторы:</b> ${cfTopAuthors.map(a => `${esc(a.name)} (${a.n})`).join(', ')}${cfAuthors.length > cfTopAuthors.length ? ` …+${cfAuthors.length - cfTopAuthors.length}` : ''}</div>` : ''}
    </div>` : '';

  const logLines = (d.log || []).slice(-25).map(l => `<div class="pp-diag-log-line">${esc(l)}</div>`).join('');
  return `<details class="pp-diag">
    <summary class="pp-diag-summary">📋 Диагностика загрузки — ${summary}</summary>
    <div class="pp-diag-body">
      <div class="pp-diag-rows">${pkRows}</div>
      ${bbBlock}
      ${cfBlock}
      ${logLines ? `<div class="pp-diag-log"><div class="pp-diag-log-title">Лог</div>${logLines}</div>` : ''}
    </div>
  </details>`;
}

export function renderMainTabs(active) {
  const tabs = [
    { id:'teams',    label:'Сотрудники' },
    { id:'summary',  label:'Сводка' },
    { id:'sprints',  label:'Спринты' },
    { id:'insights', label:'Инсайты' },
    { id:'metrics',  label:'Метрики' },
    { id:'backlog',  label:'Бэклог' },
  ];
  return `<div class="pp-tabs" role="tablist">
    ${tabs.map(t =>
      // V12 audit #24 — role=tab + aria-selected + roving tabindex (only the
      // active tab is in the document tab order; arrow-key nav between tabs
      // is implemented in the orchestrator as needed).
      `<button class="pp-tab ${active===t.id?'pp-tab-active':''}" data-pp-tab="${t.id}" role="tab" aria-selected="${active===t.id}" tabindex="${active===t.id?'0':'-1'}">${esc(t.label)}</button>`
    ).join('')}
    <button class="pp-tab pp-tab-help" id="pp-help-btn" title="Как считаются значения на этой вкладке" type="button">📋 Как считается</button>
    <button class="pp-tab pp-tab-help" id="pp-tech-info-btn" title="Версии, проекты, поля, статусы — для отладки запросов" type="button">🔧 Техническая информация</button>
  </div>`;
}

/* ────────────────────────────────────────────────────────────
   "Как считается" — per-tab explainer modal
   --
   Plain-language description of what each metric means and where its
   value comes from in the code. Each section below maps to one tab so
   the user always sees the explanation relevant to what's on screen.

   The strings reference real fields and JQL — keep them in sync with
   the model code in portfolioPulseModel.js / metric / insight files.
   ──────────────────────────────────────────────────────────── */

const HOW_DATA = {
  teams: {
    title: 'Как считаются карточки команд (вкладка «Все команды»)',
    sections: [
      {
        head: 'Кто попадает в карточку',
        body: 'Любой человек, у которого за последние 48 часов было хотя бы одно действие в Jira: смена статуса (transition), worklog, комментарий, либо у которого сейчас есть active-WIP issue с собой в assignee. Идентификация — по нормализованному `displayName`/`emailAddress` из Jira.',
      },
      {
        head: 'Сейчас N',
        body: 'Issues, где `assignee = этот человек` и `isWipActive(issue)` = true. WIP-active = (statusCategory === "indeterminate") OR (есть worklog/комментарии/transitions в changelog) OR (status НЕ в списке initial-статусов «Open / To Do / Backlog / New …»). Done-issues исключаются.',
      },
      {
        head: 'Вчера N / Позавчера N',
        body: 'Считаются события автора во временных окнах [сегодня−1, сегодня) и [сегодня−2, сегодня−1). Источники: changelog (transitions с этим автором), worklog (с автором), комментарии (с автором). Каждое событие — одна строка timeline\'а. Время дедуплицируется per-issue.',
      },
      {
        head: 'Коммент N',
        body: 'Комментарии этого автора за последние 48ч (`comment.author.displayName == person`).',
      },
      {
        head: 'Stale N',
        body: 'Open-issues человека, у которых `lastMovement` (max от updated/changelog/worklog/comment timestamps) старше `pulseStaleDays` дней. Дефолт 7 дней. Меняется в ⚙ Настройки → Интеграции → Jira.',
      },
      {
        head: 'Logged вчера',
        body: 'Сумма `worklog.timeSpentSeconds` за вчерашнее окно, форматированная в часы/минуты.',
      },
      {
        head: 'Commits 48ч / PR 48ч / Confluence',
        body: 'Берутся из Bitbucket-агрегата (PR.author.displayName == this person за 48ч; commits.author за 48ч) и Confluence (version.by.displayName за 48ч). Match по lowercase displayName, fallback по 2+ совпадающим токенам имени (учёт «Иван Иванов» vs «Ivanov Ivan»).',
      },
      {
        head: 'Без исполнителя',
        body: 'Отдельный блок внизу — все active-WIP issues без assignee. Группировка по project key + типу (story/task/bug/subtask).',
      },
    ],
  },
  summary: {
    title: 'Как считается «Сводка»',
    sections: [
      {
        head: 'Активные спринты',
        body: 'Все спринты, у которых `state === "active"` хотя бы у одной issue. Имя берётся из sprint customfield (ID находится автоматически через /rest/api/2/field).',
      },
      {
        head: 'Всего задач',
        body: 'Уникальные issues по всем PK. Считается как union из 4 запросов: `sprint in openSprints()`, `updated >= -3d`, `statusCategory = "In Progress"`, `статусCategory != Done AND sprint NOT IN openSprints()` (backlog). Дедуп по issue.key.',
      },
      {
        head: 'В работе (WIP)',
        body: 'Issues, прошедшие фильтр `isWipActive`. Логика: statusCategory = indeterminate, или есть changelog/worklog/comments, или статус явно не initial.',
      },
      {
        head: 'Done / Terminal',
        body: '`statusCategory === "done"` ИЛИ `status.name` содержит одно из: done, closed, resolved, completed, cancel, rejected, готово, закрыт, выполн, отмен, отклон.',
      },
      {
        head: 'Не приступали',
        body: 'НЕ WIP И НЕ Done. То есть статус — initial («Open», «To Do», «Backlog», «New», «Создан», «Открыт» …).',
      },
      {
        head: 'Без assignee',
        body: 'Issues с пустым `fields.assignee` И не Done. Done-issues без assignee пропускаются — они уже не требуют действий.',
      },
      {
        head: 'Блокеры / Bugs',
        body: 'Блокер = priority в (Blocker, Highest, Critical, High, Критич, Высок). Bug = issuetype.name содержит «bug» / «баг» / «дефект».',
      },
      {
        head: 'Commits 48ч',
        body: 'Сумма commits всех авторов из Bitbucket-агрегата (см. секцию Bitbucket в диагностике).',
      },
      {
        head: 'План на сегодня (фокус)',
        body: 'Эвристика: `assignee != null` И НЕ Done И (`issue.key in sprintKeys` ИЛИ `isWipActive`). То есть «у этого человека в работе сейчас или назначено на текущий спринт» — список того, что разумно делать сегодня.',
      },
      {
        head: 'Что делали вчера',
        body: 'Все события вчерашнего окна по всем участникам (transitions с описанием перехода, worklog с временем, комментарии). Сортировка — по времени убывания.',
      },
    ],
  },
  sprints: {
    title: 'Как считаются «Спринты»',
    sections: [
      {
        head: 'Источник данных',
        body: 'JQL `project = "PK" AND sprint in openSprints()` — Jira возвращает issues, входящие в активные спринты. Имя спринта — из customfield Sprint, у которого `state === "active"`.',
      },
      {
        head: 'Фильтр «Все / PK»',
        body: 'В шапке Pulse чипы PK — клик переключает между всеми проектами и одним. Активный фильтр применяется ко всем вкладкам.',
      },
      {
        head: 'Детализация по типу',
        body: 'Issues спринта группируются по `typeBucket(issue)`: story, task, bug, subtask. Для каждого — счёт done/wip/todo (ровно те же определения что в «Сводке»).',
      },
      {
        head: 'Sprint-cap',
        body: 'Server возвращает максимум 500 issues спринта на PK (per-stage cap). На больших командах вы увидите partial-результат — точнее, чем 0, но не полное перечисление. Видно в «📋 Диагностика загрузки» → строка `sprint: ✓ N issues`.',
      },
    ],
  },
  insights: {
    title: 'Как считаются «Инсайты»',
    sections: [
      {
        head: 'Что это',
        body: 'Rule-based signals — простые проверки данных, поднимающие проблемы, которые легко пропустить глазами. Все правила в `portfolioPulseInsights.js`.',
      },
      {
        head: 'Severity',
        body: 'high / warning / medium / low / info / success — определяется правилом. high и warning подсвечиваются красным/жёлтым, остальные — нейтрально.',
      },
      {
        head: 'Примеры правил',
        body: '• «WIP > N»: исполнитель ведёт более `pulseWipMax` (дефолт 3) одновременных issue. ' +
              '• «Silence»: команда без активности > 48ч. ' +
              '• «High priority not started»: blocker/critical issues в initial-статусе. ' +
              '• «Blocker stale»: blocker без движения > N дней. ' +
              '• «Overdue»: issue с `duedate < now` и не Done. ' +
              '• «Deadlines this week»: due до конца недели. ' +
              '• «Bug ratio»: процент bugs в backlog > 40%. ' +
              '• «Orphan subtasks»: подзадачи с parent в статусе Done. ' +
              '• «No description / No priority»: качество данных. ' +
              '• «WIP skew»: одна команда тащит >50% всего WIP.',
      },
      {
        head: 'Клик по «target chip»',
        body: 'Если у инсайта есть target (PK или человек), клик на чипе фильтрует Pulse по этому target — переключается на «Все команды» с активным фильтром.',
      },
    ],
  },
  metrics: {
    title: 'Как считаются «Метрики»',
    sections: [
      {
        head: 'Donut: типы / приоритеты / статусы',
        body: 'Все issues (по всем PK) группируются по `issuetype.name`, `priority.name`, `status.name`. Сортировка — по убыванию count. Топ-10 на donut + легенда; остальные сворачиваются в «Прочее».',
      },
      {
        head: 'WIP by person / space / type',
        body: '`wipIssues` (issues, прошедшие `isWipActive`) группируются: по assignee.displayName, по project key, по `typeBucket`. Bars — top 12 по убыванию.',
      },
      {
        head: 'Logged hours by person',
        body: 'Сумма `worklog.timeSpentSeconds / 3600` за вчерашнее окно по автору. Только люди с >0 часов.',
      },
      {
        head: 'Bugs by space',
        body: 'Issues с `typeBucket === "bug"`, группированные по project key.',
      },
      {
        head: 'Unassigned by space',
        body: 'Issues с `assignee == null` И не Done, по PK.',
      },
      {
        head: 'High priority not started',
        body: 'Issues с blocker/critical priority И initial-статусом. Список с возможностью клика.',
      },
      {
        head: 'Stale by person',
        body: 'Сумма stale-issues по каждому участнику (см. определение в Teams-вкладке).',
      },
      {
        head: 'Backlog by space',
        body: '`backlogIssues.length` по PK. Backlog = `statusCategory != Done AND sprint NOT IN openSprints()`. На больших командах cap 200 issues — partial-результат.',
      },
    ],
  },
  backlog: {
    title: 'Как считается «Бэклог»',
    sections: [
      {
        head: 'Что такое backlog',
        body: 'Issues, у которых `statusCategory != Done` И `sprint is EMPTY OR sprint not in openSprints()` — то есть НЕ закрытые И НЕ в активном спринте.',
      },
      {
        head: 'Top oldest',
        body: 'Топ-30 backlog issues, отсортированных по `created` ASC (самые старые первыми).',
      },
      {
        head: 'Top high priority',
        body: 'Backlog issues с priority в (blocker, highest, critical, high, критич, высок), отсортированные по `created` ASC. Топ-30.',
      },
      {
        head: 'Категории качества данных',
        body: '• Без assignee: `assignee == null`. ' +
              '• Без description: `description == ""`. ' +
              '• Bugs: `typeBucket === "bug"`. ' +
              '• Orphan subs: `typeBucket === "subtask" && parentKey == null`. ' +
              '• Overdue: `duedate < now`. ' +
              '• Older 90d: `created < (now - 90d)`. ' +
              '• No priority: `priority == null`.',
      },
      {
        head: 'Инсайты по backlog',
        body: '• Backlog ≥ 200 — большой, нужен grooming. ' +
              '• Старше 90 дней — кандидаты на закрытие. ' +
              '• Без приоритета >5 — нельзя ранжировать. ' +
              '• High priority в backlog — почему не запланированы? ' +
              '• Высокая доля bugs (≥40% при backlog ≥10) — копится тех. долг. ' +
              '• Перекос между PK (max ≥ 3× от min И разница ≥20) — у одной команды непропорциональный бэклог.',
      },
      {
        head: 'Cap',
        body: 'Server cap для backlog query — 200 issues на PK. На больших backlog видны partial-результаты (видно в диагностике: `backlog: ✓ N issues`).',
      },
    ],
  },
};

export function renderHowModal(activeTab) {
  const data = HOW_DATA[activeTab] || HOW_DATA.summary;
  const body = data.sections.map(s => `
    <div class="pp-how-section">
      <div class="pp-how-section-head">${esc(s.head)}</div>
      <div class="pp-how-section-body">${esc(s.body)}</div>
    </div>`).join('');
  return `<div class="pp-how-modal-overlay" id="pp-how-modal-overlay">
    <div class="pp-how-modal" role="dialog" aria-modal="true" aria-labelledby="pp-how-title">
      <div class="pp-how-header">
        <h3 class="pp-how-title" id="pp-how-title">${esc(data.title)}</h3>
        <button class="pp-how-close" id="pp-how-close" aria-label="Закрыть" type="button">✕</button>
      </div>
      <div class="pp-how-body">
        ${body}
        <div class="pp-how-footnote">Видны спорные / неочевидные значения? Нажмите «📋 Диагностика загрузки» в шапке — там per-PK timing и per-source диагностика.</div>
      </div>
    </div>
  </div>`;
}

/* ── Tab: ALL TEAMS (participant cards) ─────────────────── */

function _badge(label, value, kind='neutral') {
  return `<span class="pp-badge pp-badge-${kind}" title="${esc(label)}">${esc(label)}: <b>${esc(String(value))}</b></span>`;
}

export function renderParticipantCard(p) {
  const groups = groupByBucket(p.issuesNow);
  const projectChips = p.projects.map(pk => `<span class="pp-mini-pk">${esc(pk)}</span>`).join('');
  // #1.5: "logged вчера" → "Списано времени"
  const headerBadges = [
    p.loggedYesterdaySec ? _badge('Списано времени', formatHrs(p.loggedYesterdaySec), 'ok') : '',
    p.badges?.commits48h ? _badge('commits 48ч',     p.badges.commits48h)            : '',
    p.badges?.pr48h      ? _badge('PR 48ч',          p.badges.pr48h)                 : '',
    p.badges?.conf48h    ? _badge('Confluence',      p.badges.conf48h)               : '',
  ].filter(Boolean).join('');

  // Summary chips for the (collapsed) header — show non-zero counters at a glance.
  const summaryChip = (label, count, kind='neutral') => count
    ? `<span class="pp-sumchip pp-sumchip-${kind}" title="${esc(label)}"><span class="pp-sumchip-n">${count}</span><span class="pp-sumchip-l">${esc(label)}</span></span>`
    : '';
  // #1.1: "stale" → "висит долго"
  const summaryStrip = [
    summaryChip('сейчас',     (p.issuesNow||[]).length,            'now'),
    summaryChip('вчера',      (p.timelineYesterday||[]).length,    'ok'),
    summaryChip('позавчера',  (p.timelinePrev||[]).length,         'neutral'),
    summaryChip('коммент',    (p.commentsRecent||[]).length,       'info'),
    summaryChip('висит долго',(p.stale||[]).length,                'warn'),
  ].filter(Boolean).join('');

  // sectionActions has TWO opening modes: `openIf(items)` is the conditional
  // (open if any items) — used for blocks like "В работе сейчас". A new
  // `forcedClosed: true` flag forces the section to start collapsed regardless
  // of item count — used for "Долго висят" (#1.4).
  const sectionActions = (label, items, opts = {}) => {
    const isOpen = !opts.forcedClosed && opts.openIf && opts.openIf(items);
    return `
    <details class="pp-section" ${isOpen ? 'open' : ''}>
      <summary>${esc(label)} <span class="pp-sect-count">${items.length}</span></summary>
      <div class="pp-sect-body">${items.length ? (opts.render ? opts.render(items) : items.map(renderIssueRow).join('')) : '<div class="pp-empty-mini">— нет</div>'}</div>
    </details>`;
  };

  const renderTimeline = (items) => items.map(e => `
    <div class="pp-timeline-row">
      <span class="pp-timeline-icon">${TL_KIND_ICON(e.kind)}</span>
      <div class="pp-timeline-body">
        <div class="pp-timeline-text">${esc(e.text||'')}</div>
        <div class="pp-timeline-issue">${renderIssueRow(e.issue)}</div>
      </div>
      <span class="pp-timeline-at" title="${esc(e.at||'')}">${esc((e.at||'').slice(11,16))}</span>
    </div>`).join('');

  const renderComments = (items) => items.map(c => `
    <div class="pp-comment">
      ${renderIssueRow(c.issue)}
      <div class="pp-comment-text">${esc(trunc(c.text||'', 240))}</div>
      <div class="pp-comment-at">${esc((c.at||'').slice(0,10))} ${esc((c.at||'').slice(11,16))}</div>
    </div>`).join('');

  // #1.3: PR/commit list per author. Items come from server's bbAuthors[*].items
  // (max 50 per author, sorted newest-first by `at`). External links open in
  // a new tab — `rel="noopener"` is mandatory for any user-supplied URL.
  const renderBbItems = (items) => items.map(it => {
    const isPr     = it.kind === 'pr';
    const isReview = it.kind === 'review';
    // Wave 4d — review icons by action: ✓ approved, ⚠ needs-work, ✗ declined, 💬 commented.
    const reviewIcon = (action) => {
      const a = String(action || '').toUpperCase();
      if (a === 'APPROVED')  return '✓';
      if (a === 'REVIEWED')  return '⚠';
      if (a === 'DECLINED')  return '✗';
      if (a === 'COMMENTED') return '💬';
      return '👁';
    };
    const icon = isReview ? reviewIcon(it.action) : (isPr ? '🔀' : '⬢');
    const titleEsc = esc(trunc(it.title || (isPr ? 'Pull Request' : isReview ? 'PR review' : 'commit'), 100));
    const repoEsc  = esc(it.repo || '');
    const dt       = it.at ? `${(it.at).slice(0,10)} ${(it.at).slice(11,16)}` : '';
    const stat     = isPr && it.status ? `<span class="pp-bb-status pp-bb-status-${esc(it.status)}">${esc(it.status)}</span>` : '';
    const link     = it.url ? safeUrl(it.url) : '';
    const linkAttrs = link ? ` href="${esc(link)}" target="_blank" rel="noopener"` : '';
    const wrap = link ? 'a' : 'span';
    return `<${wrap} class="pp-bb-item pp-bb-item-${esc(it.kind || 'commit')}"${linkAttrs}>
      <span class="pp-bb-icon" aria-hidden="true">${icon}</span>
      <span class="pp-bb-title" title="${titleEsc}">${titleEsc}</span>
      ${stat}
      <span class="pp-bb-repo">${repoEsc}</span>
      <span class="pp-bb-at">${esc(dt)}</span>
    </${wrap}>`;
  }).join('');

  const bbItems = Array.isArray(p.bbItems) ? p.bbItems : [];
  const cfItems = Array.isArray(p.cfItems) ? p.cfItems : [];

  // ── Wave 2: «Делает сегодня» — счётчики, текущая активность, лента ──
  const todaySection = _renderTodaySection(p, bbItems, cfItems);
  // ── Wave 3: enriched «Делал вчера» / «Делал позавчера» ──
  const yesterdaySection = _renderDaySection(p, 'yesterday', bbItems, cfItems);
  const dayBeforeSection = _renderDaySection(p, 'dayBefore', bbItems, cfItems);

  // The whole card is a <details> — collapsed by default. <summary> carries
  // identity + summary chips so the user sees "who and what" without expanding.
  return `<details class="pp-card pp-card-user" data-user-key="${esc(p.key)}">
    <summary class="pp-card-header">
      <span class="pp-card-chev" aria-hidden="true">▸</span>
      <div class="pp-card-id">
        ${p.avatar ? `<img class="pp-avatar" src="${esc(p.avatar)}" alt="" loading="lazy">` : '<span class="pp-avatar pp-avatar-fallback">👤</span>'}
        <div>
          <div class="pp-card-name">${esc(p.label)}</div>
          <div class="pp-card-projects">${projectChips}</div>
        </div>
      </div>
      <div class="pp-card-summary">${summaryStrip}</div>
      <div class="pp-card-badges">${headerBadges}</div>
    </summary>
    <div class="pp-card-body">
      ${sectionActions('Назначенные задачи',  p.issuesNow,         { render: renderGroupedByType })}
      ${todaySection}
      ${yesterdaySection}
      ${dayBeforeSection}
      ${sectionActions('Оставил комментарии', p.commentsRecent,    { render: renderComments })}
      ${/* #1.3 — PR / Commits 48ч (только если есть данные). */ ''}
      ${bbItems.length ? sectionActions('PR / Commits 48ч', bbItems, { render: renderBbItems }) : ''}
      ${sectionActions('Изменения в Confluence', p.confluenceEdits || [])}
      ${/* #1.4: «Долго висят», свернуто по умолчанию. */ ''}
      ${sectionActions(`Долго висят`,         p.stale,             { forcedClosed: true })}
    </div>
  </details>`;
}

/* ────────────────────────────────────────────────────────────
   Wave 2: «Делает сегодня» — counters + current-activity card +
   chronological today timeline merged from Jira / Bitbucket /
   Confluence. Returns a complete <details> section (collapsed by
   default) ready to drop into the participant card body. If the
   user has zero today-events across all sources, returns ''.
   ──────────────────────────────────────────────────────────── */
function _renderTodaySection(p, bbItems, cfItems) {
  // Local-time start of today, ISO. Comparing ISO strings works because
  // Jira / Bitbucket / Confluence all return UTC ISO timestamps.
  const today00 = new Date(); today00.setHours(0, 0, 0, 0);
  const todayIso = today00.toISOString();
  const isToday = (atIso) => String(atIso || '') >= todayIso;

  const tlToday  = (p.timelineToday || []).filter(e => isToday(e.at));
  const bbToday  = bbItems.filter(it => isToday(it.at));
  const cfToday  = cfItems.filter(it => isToday(it.at));
  const commentsToday = (p.commentsToday || []).filter(c => isToday(c.at));
  const createdToday  = (p.issuesCreatedToday || []).filter(i => isToday(i.created));

  // If absolutely nothing happened today, hide the section entirely.
  const hasAnything = tlToday.length || bbToday.length || cfToday.length || createdToday.length;
  if (!hasAnything) return '';

  // ── Counters ──
  const commitsN = bbToday.filter(it => it.kind === 'commit').length;
  const prsAll   = bbToday.filter(it => it.kind === 'pr');
  const prOpenN  = prsAll.filter(it => !['merged', 'declined'].includes(String(it.status || '').toLowerCase())).length;
  const prMergeN = prsAll.filter(it => String(it.status || '').toLowerCase() === 'merged').length;
  // Wave 4d — reviewed PRs from activity-stream items[].
  const prReviewItems = bbToday.filter(it => it.kind === 'review');
  const prReviewN = prReviewItems.length;
  const statusChN = tlToday.filter(e => e.kind === 'transition' || e.kind === 'closed').length;
  const cfPagesN  = cfToday.length;
  const bugsN     = createdToday.filter(i => typeBucket(i) === 'bug').length;
  const commentsN = commentsToday.length;

  // Counter tile renderer — shows zero values too so the user gets a
  // complete picture (consistent with the spec "блок счётчиков").
  const tile = (label, value, tone='neutral', placeholder=false) => `
    <div class="pp-today-tile pp-today-tile-${tone}${placeholder?' pp-today-tile-placeholder':''}" title="${esc(label)}">
      <div class="pp-today-tile-val">${esc(String(value))}</div>
      <div class="pp-today-tile-lab">${esc(label)}</div>
    </div>`;

  // Wave 4c — Zephyr counters from per-user buckets, filtered to today.
  const todayIso2 = todayIso;   // alias for clarity
  const zCreatedToday = (p.zephyrTestsCreatedRecent || []).filter(it => String(it.at||'') >= todayIso2).length;
  const zExecToday    = (p.zephyrTestsExecutedRecent || []).filter(it => String(it.at||'') >= todayIso2);
  const zPassToday    = zExecToday.filter(it => it.result === 'PASS').length;
  const zFailToday    = zExecToday.filter(it => it.result === 'FAIL').length;
  const zephyrLabel   = zExecToday.length
    ? `Тестов: создано ${zCreatedToday}, прогнано ${zExecToday.length} (✓${zPassToday}/✗${zFailToday})`
    : `Тестов создано ${zCreatedToday}`;
  const zephyrValue   = zCreatedToday + zExecToday.length;

  const counters = `
    <div class="pp-today-tiles">
      ${tile('Коммитов', commitsN, 'commit')}
      ${tile('PR открыто', prOpenN, 'pr')}
      ${tile('PR смёржено', prMergeN, 'pr-merged')}
      ${tile('PR отревьюено', prReviewN, 'pr-review', !prReviewN)}
      ${tile('Статусов изменено', statusChN, 'status')}
      ${tile('Confluence страниц', cfPagesN, 'cf')}
      ${tile(zephyrLabel, zephyrValue, 'zephyr', !zephyrValue)}
      ${tile('Багов заведено', bugsN, 'bug')}
      ${tile('Jira комментариев', commentsN, 'comment')}
    </div>`;

  // ── Current activity card ──
  // Take the latest event across all today sources. tlToday is already
  // sorted newest-first by analysePulse, but we re-pick max from all 4.
  const allEvents = [
    ...tlToday.map(e => ({ src: 'jira', at: e.at, key: e.issue?.key, text: e.text || '', issue: e.issue })),
    ...bbToday.map(it => ({ src: 'bb',   at: it.at, key: '', text: `${it.kind === 'pr' ? 'PR' : 'commit'}: ${it.title || ''}`, repo: it.repo, url: it.url, kind: it.kind, status: it.status })),
    ...cfToday.map(it => ({ src: 'cf',   at: it.at, key: '', text: `${it.kind === 'create' ? 'Создал' : 'Обновил'} страницу: ${it.title || ''}`, url: it.url })),
  ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const last = allEvents[0];
  const currentCard = last ? (() => {
    const minsAgo = Math.max(0, Math.round((Date.now() - Date.parse(last.at || 0)) / 60000));
    const ago = minsAgo < 1 ? 'только что'
              : minsAgo < 60 ? `${minsAgo} мин назад`
              : minsAgo < 1440 ? `${Math.round(minsAgo / 60)} ч назад`
              : `${Math.round(minsAgo / 1440)} д назад`;
    const subject = last.key
      ? `<a class="pp-issue-key-link" href="${esc(safeUrl(_renderCtx.jiraBaseUrl))}/browse/${esc(last.key)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(last.key)}</a>`
      : `<span class="pp-today-current-subject">${esc(trunc(last.text || '—', 80))}</span>`;
    return `<div class="pp-today-current">
      <span class="pp-today-current-icon">${last.src === 'jira' ? '🔷' : last.src === 'bb' ? '🔀' : '📘'}</span>
      <span class="pp-today-current-text">Работает над ${subject}, последняя активность <b>${esc(ago)}</b></span>
    </div>`;
  })() : '';

  // ── Today timeline (chronological merge, source icons) ──
  const SRC_ICON = { jira: '🔷', bb: '🔀', cf: '📘', zephyr: '🧪' };
  const renderEvtRow = (e) => {
    const time = (e.at || '').slice(11, 16);
    if (e.src === 'jira') {
      return `<div class="pp-timeline-row pp-timeline-row-jira">
        <span class="pp-timeline-src" title="Jira">${SRC_ICON.jira}</span>
        <span class="pp-timeline-icon">${TL_KIND_ICON(e.kind)}</span>
        <div class="pp-timeline-body">
          <div class="pp-timeline-text">${esc(e.text || '')}</div>
          ${e.issue ? `<div class="pp-timeline-issue">${renderIssueRow(e.issue)}</div>` : ''}
        </div>
        <span class="pp-timeline-at" title="${esc(e.at || '')}">${esc(time)}</span>
      </div>`;
    }
    if (e.src === 'bb') {
      const isPr = e.kind === 'pr';
      const linkSafe = e.url ? safeUrl(e.url) : '';
      const titleEsc = esc(trunc(e.text || (isPr ? 'PR' : 'commit'), 100));
      const linkAttrs = linkSafe ? ` href="${esc(linkSafe)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"` : '';
      const wrap = linkSafe ? 'a' : 'span';
      return `<div class="pp-timeline-row pp-timeline-row-bb">
        <span class="pp-timeline-src" title="Bitbucket">${SRC_ICON.bb}</span>
        <span class="pp-timeline-icon">${isPr ? '🔀' : '⬢'}</span>
        <div class="pp-timeline-body">
          <${wrap} class="pp-timeline-text"${linkAttrs}>${titleEsc}</${wrap}>
          ${e.repo ? `<div class="pp-timeline-meta">${esc(e.repo)}${e.status ? ` · ${esc(e.status)}` : ''}</div>` : ''}
        </div>
        <span class="pp-timeline-at" title="${esc(e.at || '')}">${esc(time)}</span>
      </div>`;
    }
    // cf
    const linkSafe = e.url ? safeUrl(e.url) : '';
    const linkAttrs = linkSafe ? ` href="${esc(linkSafe)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"` : '';
    const wrap = linkSafe ? 'a' : 'span';
    return `<div class="pp-timeline-row pp-timeline-row-cf">
      <span class="pp-timeline-src" title="Confluence">${SRC_ICON.cf}</span>
      <span class="pp-timeline-icon">${e.kind === 'create' ? '➕' : '✎'}</span>
      <div class="pp-timeline-body">
        <${wrap} class="pp-timeline-text"${linkAttrs}>${esc(trunc(e.text || '—', 120))}</${wrap}>
      </div>
      <span class="pp-timeline-at" title="${esc(e.at || '')}">${esc(time)}</span>
    </div>`;
  };
  const timelineHtml = allEvents.length
    ? allEvents.map(renderEvtRow).join('')
    : '<div class="pp-empty-mini">— нет событий за сегодня</div>';

  return `<details class="pp-section pp-section-today" open>
    <summary>Делает сегодня <span class="pp-sect-count">${allEvents.length}</span></summary>
    <div class="pp-sect-body">
      ${currentCard}
      ${counters}
      <div class="pp-section-block-title">Лента сегодня</div>
      <div class="pp-today-timeline">${timelineHtml}</div>
    </div>
  </details>`;
}

/* ────────────────────────────────────────────────────────────
   Wave 3: enriched per-day section («Делал вчера» / «Делал позавчера»).
   Pure render-only over data the model already produces — no model
   changes needed. Each section shows:
     · Сводка дня: окно активности (first→last event), число задач,
       основной фокус (issue с max доли событий), залогировано
     · Завершено за день: doneXxx + PR merged за день + Confluence published
     · Прогресс по in-progress: для каждой touched-issue, не done —
       первый/последний статус из ленты + счётчики коммитов/комментов
     · Свёрнутая полная лента дня
   `day` ∈ 'yesterday' | 'dayBefore'.
   Returns '' when nothing happened that day to keep the card compact.
   ──────────────────────────────────────────────────────────── */
function _renderDaySection(p, day, bbItems, cfItems) {
  const isYesterday = day === 'yesterday';
  const label    = isYesterday ? 'Делал вчера' : 'Делал позавчера';
  const timeline = isYesterday ? (p.timelineYesterday || []) : (p.timelinePrev || []);
  const doneList = isYesterday ? (p.doneYesterday || [])    : (p.doneDayBefore || []);
  const loggedSec= isYesterday ? (p.loggedYesterdaySec||0) : (p.loggedDayBeforeSec||0);

  // Day window: ISO string boundaries [fromIso, toIso) — used to filter
  // bbItems/cfItems by `at` lexicographically (works because ISO sorts by time).
  const today00 = new Date(); today00.setHours(0, 0, 0, 0);
  const yIso = new Date(today00.getTime() - 24*3600*1000).toISOString();   // 00:00 вчера
  const dbIso= new Date(today00.getTime() - 48*3600*1000).toISOString();   // 00:00 позавчера
  const fromIso = isYesterday ? yIso : dbIso;
  const toIso   = isYesterday ? today00.toISOString() : yIso;
  const inDay = (atIso) => { const s = String(atIso || ''); return s >= fromIso && s < toIso; };

  const bbDay = bbItems.filter(it => inDay(it.at));
  const cfDay = cfItems.filter(it => inDay(it.at));

  // Hide the whole section if nothing happened that day.
  if (!timeline.length && !bbDay.length && !cfDay.length) return '';

  // ── 1. Сводка дня ──
  // First/last event timestamps across timeline + bb + cf — gives "X:XX → Y:YY".
  const allDayTs = [
    ...timeline.map(e => e.at),
    ...bbDay.map(it => it.at),
    ...cfDay.map(it => it.at),
  ].filter(Boolean).sort();
  const firstAt = allDayTs[0] || '';
  const lastAt  = allDayTs[allDayTs.length - 1] || '';
  const durationMs = (firstAt && lastAt) ? Math.max(0, Date.parse(lastAt) - Date.parse(firstAt)) : 0;
  const durationStr = (() => {
    if (!durationMs) return '—';
    const mins = Math.round(durationMs / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? `${h}ч ${m}м` : `${m}м`;
  })();

  // Touched issues — unique keys + their event count for "main focus" %.
  const eventsByKey = {};
  for (const e of timeline) {
    const k = e?.issue?.key;
    if (!k) continue;
    eventsByKey[k] = (eventsByKey[k] || 0) + 1;
  }
  const touchedKeys = Object.keys(eventsByKey);
  const totalEvents = Object.values(eventsByKey).reduce((s, n) => s + n, 0);
  const focusKey = touchedKeys.reduce((best, k) =>
    eventsByKey[k] > (eventsByKey[best] || 0) ? k : best, '');
  const focusPct = (focusKey && totalEvents)
    ? Math.round(eventsByKey[focusKey] / totalEvents * 100)
    : 0;

  const focusLine = focusKey
    ? `<b>${esc(focusKey)}</b> — ${focusPct}% активности (${eventsByKey[focusKey]} из ${totalEvents} событий)`
    : '— нет основной задачи';

  const summary = `
    <div class="pp-day-summary">
      <div class="pp-day-summary-row">
        <span class="pp-day-icon">⏱</span>
        <span><b>${esc(firstAt.slice(11,16) || '—')}</b> → <b>${esc(lastAt.slice(11,16) || '—')}</b> · активность ${esc(durationStr)}</span>
      </div>
      <div class="pp-day-summary-row">
        <span class="pp-day-icon">🎯</span>
        <span>Фокус: ${focusLine}</span>
      </div>
      <div class="pp-day-summary-row">
        <span class="pp-day-icon">📋</span>
        <span>Касался <b>${touchedKeys.length}</b> задач${touchedKeys.length === 1 ? 'и' : touchedKeys.length < 5 ? '' : ''}: ${touchedKeys.slice(0,8).map(k => `<span class="pp-day-key">${esc(k)}</span>`).join(' ')}${touchedKeys.length > 8 ? ` <span class="pp-more">…+${touchedKeys.length - 8}</span>` : ''}</span>
      </div>
      ${loggedSec ? `<div class="pp-day-summary-row">
        <span class="pp-day-icon">💼</span>
        <span>Залогировано: <b>${esc(formatHrs(loggedSec))}</b></span>
      </div>` : ''}
    </div>`;

  // ── 2. Завершено за день ──
  const prMerged = bbDay.filter(it => it.kind === 'pr' && String(it.status||'').toLowerCase() === 'merged');
  const cfPublished = cfDay.filter(it => it.kind === 'create' || it.kind === 'edit');

  const doneRows = doneList.length ? doneList.map(renderIssueRow).join('') : '';
  const prRows = prMerged.length ? prMerged.map(it => {
    const link = safeUrl(it.url);
    const a = link ? `<a href="${esc(link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(trunc(it.title || 'PR', 80))}</a>`
                   : esc(trunc(it.title || 'PR', 80));
    return `<div class="pp-day-doneitem"><span class="pp-day-doneicon">🔀</span>${a}<span class="pp-bb-repo">${esc(it.repo || '')}</span></div>`;
  }).join('') : '';
  const cfRows = cfPublished.length ? cfPublished.map(it => {
    const link = safeUrl(it.url);
    const a = link ? `<a href="${esc(link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(trunc(it.title || 'страница', 80))}</a>`
                   : esc(trunc(it.title || 'страница', 80));
    return `<div class="pp-day-doneitem"><span class="pp-day-doneicon">${it.kind === 'create' ? '➕' : '✎'}</span>${a}</div>`;
  }).join('') : '';

  const totalDone = doneList.length + prMerged.length + cfPublished.length;
  const doneBlock = totalDone ? `
    <details class="pp-day-block">
      <summary>✅ Завершено за день <span class="pp-sect-count">${totalDone}</span></summary>
      <div class="pp-sect-body">
        ${doneRows ? `<div class="pp-day-subblock"><div class="pp-day-sublabel">Задачи в Done</div>${doneRows}</div>` : ''}
        ${prRows   ? `<div class="pp-day-subblock"><div class="pp-day-sublabel">PR смёржены</div>${prRows}</div>`     : ''}
        ${cfRows   ? `<div class="pp-day-subblock"><div class="pp-day-sublabel">Confluence</div>${cfRows}</div>`      : ''}
      </div>
    </details>` : '';

  // ── 3. Прогресс по in-progress (touched issues, не Done) ──
  // Group timeline events by issue.key. For each non-done issue, determine:
  //   · first / last status name from transition events
  //   · number of comments in this day
  //   · number of PR/commits attached (from bbDay matched by issue key in title)
  const doneKeys = new Set(doneList.map(i => i.key));
  const progressByIssue = {};
  for (const e of timeline) {
    const k = e?.issue?.key;
    if (!k || doneKeys.has(k)) continue;
    if (!progressByIssue[k]) progressByIssue[k] = {
      issue: e.issue, first: '', last: '', comments: 0, transitions: 0, worklogs: 0,
    };
    if (e.kind === 'comment')   progressByIssue[k].comments++;
    if (e.kind === 'worklog')   progressByIssue[k].worklogs++;
    if (e.kind === 'transition' || e.kind === 'closed') {
      progressByIssue[k].transitions++;
      // text format: "Перевели в <Status>" — pick the status name
      const m = String(e.text || '').match(/Перевели в (.+)$/);
      const toName = m ? m[1] : '';
      if (!progressByIssue[k].first) progressByIssue[k].first = toName;
      progressByIssue[k].last = toName;
    }
  }
  const progressEntries = Object.entries(progressByIssue);
  const progressBlock = progressEntries.length ? `
    <details class="pp-day-block">
      <summary>▶ Прогресс по WIP <span class="pp-sect-count">${progressEntries.length}</span></summary>
      <div class="pp-sect-body">
        ${progressEntries.map(([k, info]) => {
          // Match BB items to this issue by key in title (Jira branch convention).
          const bbForIssue = bbDay.filter(it => String(it.title || '').includes(k));
          const commitsN = bbForIssue.filter(it => it.kind === 'commit').length;
          const prsN     = bbForIssue.filter(it => it.kind === 'pr').length;
          const transitionStr = (info.first && info.last && info.first !== info.last)
            ? `было <b>${esc(info.first)}</b> → стало <b>${esc(info.last)}</b>`
            : info.last ? `статус <b>${esc(info.last)}</b>` : '';
          const counters = [
            commitsN ? `+${commitsN} коммит${commitsN === 1 ? '' : commitsN < 5 ? 'а' : 'ов'}` : '',
            prsN     ? `${prsN} PR` : '',
            info.comments ? `${info.comments} коммент${info.comments === 1 ? '' : info.comments < 5 ? 'а' : 'ов'}` : '',
            info.worklogs ? `${info.worklogs} worklog` : '',
          ].filter(Boolean).join(' · ');
          return `<div class="pp-day-progress-row">
            ${renderIssueRow(info.issue)}
            <div class="pp-day-progress-meta">${transitionStr}${transitionStr && counters ? ' · ' : ''}${counters}</div>
          </div>`;
        }).join('')}
      </div>
    </details>` : '';

  // ── 4. Свёрнутая полная лента дня ──
  const fullTimelineBlock = timeline.length ? `
    <details class="pp-day-block">
      <summary>📜 Полная лента дня <span class="pp-sect-count">${timeline.length}</span></summary>
      <div class="pp-sect-body">
        ${timeline.map(e => `
          <div class="pp-timeline-row">
            <span class="pp-timeline-icon">${TL_KIND_ICON(e.kind)}</span>
            <div class="pp-timeline-body">
              <div class="pp-timeline-text">${esc(e.text || '')}</div>
              <div class="pp-timeline-issue">${renderIssueRow(e.issue)}</div>
            </div>
            <span class="pp-timeline-at" title="${esc(e.at || '')}">${esc((e.at || '').slice(11,16))}</span>
          </div>`).join('')}
      </div>
    </details>` : '';

  return `<details class="pp-section pp-section-day pp-section-day-${day}">
    <summary>${esc(label)} <span class="pp-sect-count">${timeline.length + bbDay.length + cfDay.length}</span></summary>
    <div class="pp-sect-body">
      ${summary}
      ${doneBlock}
      ${progressBlock}
      ${fullTimelineBlock}
    </div>
  </details>`;
}

export function renderUnassignedBlock(model, activePk) {
  const entries = activePk
    ? [[activePk, model.unassignedByPk[activePk] || []]]
    : Object.entries(model.unassignedByPk).filter(([_, list]) => list.length);
  if (!entries.length || !entries.some(([_, l]) => l.length)) {
    return '<div class="pp-card pp-card-unassigned"><div class="pp-card-header">' +
      '<div class="pp-card-id"><span class="pp-avatar pp-avatar-empty">∅</span>' +
      '<div><div class="pp-card-name">Без исполнителя</div><div class="pp-card-projects"><span class="pp-mini-pk">все задачи назначены</span></div></div></div></div></div>';
  }
  const total = entries.reduce((s, [_, l]) => s + l.length, 0);
  const groups = entries.map(([pk, list]) => {
    const g = groupByBucket(list);
    return `<details class="pp-section" open>
      <summary>${esc(pk)} <span class="pp-sect-count">${list.length}</span></summary>
      <div class="pp-sect-body">${[
        renderTypeGroup('Story', g.story),
        renderTypeGroup('Bug',   g.bug),
        renderTypeGroup('Task',  g.task),
        renderTypeGroup('Sub-task', g.subtask),
        renderTypeGroup('Прочее',   g.other),
      ].join('') || '<div class="pp-empty-mini">— нет</div>'}</div>
    </details>`;
  }).join('');

  return `<div class="pp-card pp-card-unassigned">
    <div class="pp-card-header">
      <div class="pp-card-id">
        <span class="pp-avatar pp-avatar-empty">∅</span>
        <div>
          <div class="pp-card-name">Без исполнителя</div>
          <div class="pp-card-projects"><span class="pp-mini-pk">${total} задач</span></div>
        </div>
      </div>
    </div>
    ${groups}
  </div>`;
}

export function renderTeamsTab(model, activePk) {
  const cards = (model.participants || []).map(renderParticipantCard).join('');
  const total = (model.participants || []).length;
  const toolbar = total > 1 ? `
    <div class="pp-cards-toolbar">
      <button class="int-btn int-btn-ghost int-btn-xs" id="pp-cards-expand-all" type="button">▾ Развернуть все</button>
      <button class="int-btn int-btn-ghost int-btn-xs" id="pp-cards-collapse-all" type="button">▸ Свернуть все</button>
    </div>` : '';
  return `<div class="pp-cards">
    ${toolbar}
    ${cards || '<div class="pp-empty-mini" style="text-align:center;padding:20px">— нет участников за окно 48ч</div>'}
    ${renderUnassignedBlock(model, activePk)}
  </div>`;
}

/* ── Tab: SUMMARY ─────────────────────────────────────── */

export function renderSummaryTab(model, activePk) {
  const s = model.summary;
  const todoToday = (activePk ? model.todoToday.filter(i => i.pk === activePk) : model.todoToday).slice(0, 50);
  const yest = (activePk ? model.yesterdayActivity.filter(a => a.issue?.pk === activePk) : model.yesterdayActivity).slice(0, 80);

  const sprintsLine = s.activeSprints.length
    ? s.activeSprints.map(a => `<span class="pp-mini-pk">${esc(a.pk)}: ${esc(a.name)}</span>`).join(' ')
    : '<span class="pp-empty-mini">— нет активных спринтов</span>';

  const stats = `
    <div class="pp-stat-grid">
      <div class="pp-stat"><div class="pp-stat-val">${s.totalIssues}</div><div class="pp-stat-label">Всего задач</div></div>
      <div class="pp-stat"><div class="pp-stat-val">${s.wip}</div><div class="pp-stat-label">В работе</div></div>
      <div class="pp-stat"><div class="pp-stat-val">${s.done}</div><div class="pp-stat-label">Done / Terminal</div></div>
      <div class="pp-stat"><div class="pp-stat-val">${s.notStarted}</div><div class="pp-stat-label">Не приступали</div></div>
      <div class="pp-stat"><div class="pp-stat-val">${s.unassigned}</div><div class="pp-stat-label">Без assignee</div></div>
      <div class="pp-stat"><div class="pp-stat-val">${s.blockers}</div><div class="pp-stat-label">Блокеры</div></div>
      <div class="pp-stat"><div class="pp-stat-val">${s.bugs}</div><div class="pp-stat-label">Bugs</div></div>
      <div class="pp-stat"><div class="pp-stat-val">${s.commits48h||0}</div><div class="pp-stat-label">Commits 48ч</div></div>
    </div>`;

  // Wave 4c — Zephyr block on the Summary tab. Hidden if no test artefacts found
  // in this PK / portfolio (avoids visual noise for non-QA teams).
  const zephyrBlock = (s.testCases || s.testExecs || s.testSets || s.testsCreated48h || s.testsExecuted48h) ? `
    <div class="pp-section-block">
      <div class="pp-section-block-title">🧪 Тестирование (Zephyr)</div>
      <div class="pp-stat-grid">
        <div class="pp-stat"><div class="pp-stat-val">${s.testCases||0}</div><div class="pp-stat-label">Тест-кейсов</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${s.testExecs||0}</div><div class="pp-stat-label">Прогонов</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${s.testSets||0}</div><div class="pp-stat-label">Test Sets / Cycles</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${s.testsCreated48h||0}</div><div class="pp-stat-label">Создано за 48ч</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${s.testsExecuted48h||0}</div><div class="pp-stat-label">Прогнано за 48ч</div></div>
        <div class="pp-stat pp-stat-pass"><div class="pp-stat-val">${s.testsPassed48h||0}</div><div class="pp-stat-label">PASS</div></div>
        <div class="pp-stat pp-stat-fail"><div class="pp-stat-val">${s.testsFailed48h||0}</div><div class="pp-stat-label">FAIL</div></div>
      </div>
    </div>` : '';

  // Detail by bucket (8.4)
  const allIssues = Object.values(model.spaces).flatMap(sp => sp.issues || []);
  const byBucket = { story: { todo:0, wip:0, done:0 }, task: { todo:0, wip:0, done:0 }, bug: { todo:0, wip:0, done:0 }, subtask: { todo:0, wip:0, done:0 } };
  for (const it of allIssues) {
    const b = typeBucket(it);
    if (byBucket[b]) byBucket[b][statusBucket(it.status, it.statusCat)]++;
  }
  const detailRows = ['story','task','bug','subtask'].map(b => `
    <tr>
      <td class="pp-detail-bucket">${esc(typeBucketLabel(b))}</td>
      <td>${byBucket[b].done}</td>
      <td>${byBucket[b].wip}</td>
      <td>${byBucket[b].todo}</td>
    </tr>`).join('');

  return `<div class="pp-summary">
    <div class="pp-section-block">
      <div class="pp-section-block-title">Активные спринты</div>
      <div>${sprintsLine}</div>
    </div>
    ${stats}
    ${zephyrBlock}
    <div class="pp-section-block">
      <div class="pp-section-block-title">Детализация по типам</div>
      <table class="pp-detail-table">
        <thead><tr><th>Тип</th><th>Сделано</th><th>В работе</th><th>Не приступали</th></tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
    </div>
    <div class="pp-section-block">
      <div class="pp-section-block-title">План на сегодня (фокус) <span class="pp-section-block-sub">${todoToday.length} задач</span></div>
      <div class="pp-group-list">${todoToday.map(renderIssueRow).join('') || '<div class="pp-empty-mini">— нет задач в фокусе</div>'}</div>
    </div>
    <div class="pp-section-block">
      <div class="pp-section-block-title">Что делали вчера <span class="pp-section-block-sub">${yest.length} активностей</span></div>
      <div class="pp-yesterday-list">${
        yest.map(a => `
          <div class="pp-timeline-row">
            <span class="pp-timeline-icon">${a.kind==='closed'?'✅':a.kind==='transition'?'↪':a.kind==='comment'?'💬':a.kind==='worklog'?'⏱':'·'}</span>
            <div class="pp-timeline-body">
              <div class="pp-timeline-text"><b>${esc(a.who||'')}</b>${a.text ? ' — '+esc(trunc(a.text, 140)) : ''}</div>
              <div>${renderIssueRow(a.issue)}</div>
            </div>
            <span class="pp-timeline-at">${esc((a.at||'').slice(11,16))}</span>
          </div>`).join('') || '<div class="pp-empty-mini">— нет активности</div>'
      }</div>
    </div>
  </div>`;
}

/* ── Tab: SPRINTS ──────────────────────────────────────── */

export function renderSprintsTab(model, activePk) {
  const pks = activePk ? [activePk] : model.projectKeys;
  if (!pks.length) return '<div class="pp-empty-mini">— нет проектов</div>';
  const sections = pks.map(pk => {
    const sp = model.spaces[pk];
    if (!sp) return `<div class="pp-card"><div class="pp-card-header"><div class="pp-card-name">${esc(pk)}</div></div><div class="pp-empty-mini" style="padding:12px">— нет данных</div></div>`;
    if (sp.hasError) return `<div class="pp-card pp-card-error"><div class="pp-card-header"><div class="pp-card-name">⚠ ${esc(pk)}</div></div><div class="pp-card-body"><div class="pp-err-msg">${esc(sp.errorMsg)}</div></div></div>`;

    const sprint = sp.sprintIssues || [];
    const stats = sp.stats || { byBucket:{}, byStatus:{} };
    const byBucketDetail = ['story','task','bug','subtask'].map(b => {
      const list = sprint.filter(i => typeBucket(i) === b);
      const done = list.filter(i => isTerminalStatus(i.status, i.statusCat)).length;
      const todo = list.filter(i => isInitialStatus(i.status, i.statusCat)).length;
      const wip  = list.length - done - todo;
      return `<tr><td>${esc(typeBucketLabel(b))}</td><td>${done}</td><td>${wip}</td><td>${todo}</td><td>${list.length}</td></tr>`;
    }).join('');

    const sprintName = sp.activeSprintName || '— активный спринт не определён';

    return `<div class="pp-card">
      <div class="pp-card-header">
        <div class="pp-card-id">
          <span class="pp-avatar pp-avatar-fallback">🏁</span>
          <div>
            <div class="pp-card-name">${esc(pk)} · ${esc(sprintName)}</div>
            <div class="pp-card-projects"><span class="pp-mini-pk">${sprint.length} задач</span></div>
          </div>
        </div>
      </div>
      <div class="pp-card-body">
        <div class="pp-section-block-title">Статистика по типам и статусам</div>
        <table class="pp-detail-table">
          <thead><tr><th>Тип</th><th>Сделано</th><th>В работе</th><th>Не приступали</th><th>Всего</th></tr></thead>
          <tbody>${byBucketDetail || '<tr><td colspan="5">—</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  return `<div class="pp-cards">${sections}</div>`;
}

/* ── Tab: INSIGHTS ─────────────────────────────────────── */

export function renderInsightsTab(insights, activePk) {
  if (!insights || !insights.length) {
    return `<div class="pp-empty"><div class="pp-empty-icon">✓</div>
      <div class="pp-empty-title">Сигналов нет</div>
      <div class="pp-empty-sub">Портфель ${activePk?'пространства '+activePk:''} в норме.</div></div>`;
  }
  return `<div class="pp-insights-grid">${insights.map(ins => `
    <div class="pp-ins-card pp-ins-${esc(ins.severity)}">
      <div class="pp-ins-card-head">
        <span class="pp-ins-icon">${ins.severity==='critical'?'🔴':ins.severity==='warning'?'🟡':'🔵'}</span>
        <span class="pp-ins-card-title">${esc(ins.title)}</span>
        ${ins.target ? `<span class="pp-ins-target" data-pk="${esc(ins.target)}">${esc(ins.target)}</span>` : ''}
      </div>
      <div class="pp-ins-card-exp">${esc(ins.explanation||'')}</div>
      ${ins.items && ins.items.length ? `
        <details class="pp-ins-items">
          <summary>Показать задачи (${ins.items.length})</summary>
          <div class="pp-ins-items-body">${ins.items.slice(0,40).map(renderIssueRow).join('')}${ins.items.length>40?`<div class="pp-more">…ещё ${ins.items.length-40}</div>`:''}</div>
        </details>` : ''}
    </div>`).join('')}</div>`;
}

/* ── Tab: METRICS ──────────────────────────────────────── */

export function renderMetricsTab(metrics) {
  return `<div class="pp-metrics-grid">
    ${renderDonut('Распределение типов',     metrics.donutTypes)}
    ${renderDonut('Распределение приоритетов', metrics.donutPriorities)}
    ${renderDonut('Распределение статусов',   metrics.donutStatuses)}
    ${renderBars('WIP по людям',              metrics.wipByPerson, { limit: 12 })}
    ${renderBars('WIP по пространствам',      metrics.wipBySpace,  { limit: 12 })}
    ${renderBars('WIP по типам задач',        metrics.wipByType)}
    ${renderBars('Логирование вчера (ч)',     metrics.loggedByPerson, { limit: 12, suffix:'ч' })}
    ${renderBars('Bugs по пространствам',     metrics.bugsBySpace)}
    ${renderBars('Без assignee по пространствам', metrics.unassignedBySpace)}
    ${renderBars('Stale-задачи по людям',     metrics.staleByPerson)}
    ${renderBars('Backlog size по пространствам', metrics.backlogBySpace)}
    ${renderAgeHistogram('Возраст задач (от created)', metrics.allIssues, 'created')}
  </div>`;
}

/* ── Tab: BACKLOG ──────────────────────────────────────── */

export function renderBacklogTab(bl, blInsights, activePk, subTab='summary') {
  const sub = (id, label) => `<button class="pp-subtab ${subTab===id?'pp-subtab-active':''}" data-pp-subtab="${id}">${esc(label)}</button>`;
  const tabs = `<div class="pp-subtabs">${sub('summary','Сводка')}${sub('metrics','Метрики')}${sub('boards','Дашборды')}${sub('insights','Инсайты')}</div>`;

  const totalsLine = `Всего: <b>${bl.total}</b> · ${Object.entries(bl.totalsByPk).map(([pk,n])=>`${esc(pk)}=${n}`).join(', ') || '—'}`;
  let body = '';

  if (subTab === 'summary') {
    body = `
      <div class="pp-section-block-title">Итого по бэклогу</div>
      <div>${totalsLine}</div>
      <div class="pp-stat-grid" style="margin-top:8px">
        <div class="pp-stat"><div class="pp-stat-val">${bl.total}</div><div class="pp-stat-label">Всего</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${bl.older90d}</div><div class="pp-stat-label">Старше 90д</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${bl.noAssignee}</div><div class="pp-stat-label">Без assignee</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${bl.noDescription}</div><div class="pp-stat-label">Без description</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${bl.bugs}</div><div class="pp-stat-label">Bugs</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${bl.orphanSubs}</div><div class="pp-stat-label">Orphan sub-task</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${bl.overdue}</div><div class="pp-stat-label">Просрочены</div></div>
        <div class="pp-stat"><div class="pp-stat-val">${bl.noPriority}</div><div class="pp-stat-label">Без приоритета</div></div>
      </div>
      <div class="pp-section-block">
        <div class="pp-section-block-title">Top oldest</div>
        ${bl.topOldest.slice(0,15).map(renderIssueRow).join('') || '<div class="pp-empty-mini">— нет</div>'}
      </div>
      <div class="pp-section-block">
        <div class="pp-section-block-title">Top high-priority</div>
        ${bl.topHighPriority.slice(0,15).map(renderIssueRow).join('') || '<div class="pp-empty-mini">— нет</div>'}
      </div>`;
  } else if (subTab === 'metrics') {
    const all = Object.values(bl.issuesByPk).flat();
    const donutTypes      = Object.create(null);
    const donutPriorities = Object.create(null);
    const donutStatuses   = Object.create(null);
    const byPk            = Object.create(null);
    for (const i of all) {
      donutTypes[i.type||'—'] = (donutTypes[i.type||'—']||0)+1;
      donutPriorities[i.priority||'—'] = (donutPriorities[i.priority||'—']||0)+1;
      donutStatuses[i.status||'—'] = (donutStatuses[i.status||'—']||0)+1;
      byPk[i.pk||'—'] = (byPk[i.pk||'—']||0)+1;
    }
    body = `<div class="pp-metrics-grid">
      ${renderAgeHistogram('Возраст задач в backlog',  all, 'created')}
      ${renderDonut('Приоритеты',  donutPriorities)}
      ${renderDonut('Статусы',     donutStatuses)}
      ${renderDonut('Типы',        donutTypes)}
      ${renderBars('По пространствам', byPk)}
    </div>`;
  } else if (subTab === 'boards') {
    body = `<div class="pp-cards">${
      Object.entries(bl.issuesByPk).map(([pk, list]) => {
        const oldest = list.slice().sort((a,b)=>ts(a.created)-ts(b.created))[0];
        const oldestAge = oldest ? Math.floor((Date.now()-ts(oldest.created))/(24*3600*1000)) : 0;
        const high = list.filter(i => /(blocker|highest|critical|high|критич|высок)/i.test(i.priority||'')).length;
        const bugs = list.filter(i => typeBucket(i)==='bug').length;
        const noA  = list.filter(i => !i.assignee).length;
        const noD  = list.filter(i => !i.description).length;
        return `<div class="pp-card">
          <div class="pp-card-header">
            <div class="pp-card-id"><span class="pp-avatar pp-avatar-fallback">📂</span>
            <div><div class="pp-card-name">${esc(pk)}</div><div class="pp-card-projects"><span class="pp-mini-pk">${list.length} в backlog</span></div></div></div>
          </div>
          <div class="pp-card-body">
            <div class="pp-stat-grid">
              <div class="pp-stat"><div class="pp-stat-val">${list.length}</div><div class="pp-stat-label">Всего</div></div>
              <div class="pp-stat"><div class="pp-stat-val">${oldestAge}д</div><div class="pp-stat-label">Самой старой</div></div>
              <div class="pp-stat"><div class="pp-stat-val">${high}</div><div class="pp-stat-label">High prio</div></div>
              <div class="pp-stat"><div class="pp-stat-val">${bugs}</div><div class="pp-stat-label">Bugs</div></div>
              <div class="pp-stat"><div class="pp-stat-val">${noA}</div><div class="pp-stat-label">Без assignee</div></div>
              <div class="pp-stat"><div class="pp-stat-val">${noD}</div><div class="pp-stat-label">Без description</div></div>
            </div>
          </div>
        </div>`;
      }).join('') || '<div class="pp-empty-mini" style="text-align:center;padding:14px">— backlog пуст</div>'
    }</div>`;
  } else if (subTab === 'insights') {
    body = renderInsightsTab(blInsights || [], activePk);
  }

  return `<div class="pp-backlog">${tabs}<div class="pp-backlog-body">${body}</div></div>`;
}

/* ── Top-level errors banner ───────────────────────────── */

export function renderErrorBanner(model) {
  if (!model.errors || !model.errors.length) return '';
  return `<div class="pp-errors">${model.errors.map(e => `
    <div class="pp-err-card">
      <div class="pp-err-pk">⚠ ${esc(e.projectKey)}</div>
      <div class="pp-err-msg">${esc(e.error||'')}</div>
    </div>`).join('')}</div>`;
}

/* ── Skeleton / empty / error states ───────────────────── */

export function renderSkeleton(message) {
  // Full-area centered loader (no skeleton bars). Fills the tab content
  // vertically so the spinner sits in the middle of where the dashboard
  // would be — better visual feedback than stacked grey rectangles.
  // V13 (11th pass): adds a separate rotating fun-phrase line above the
  // functional status — so the user sees both "we're alive" AND what
  // phase we're on. The orchestrator manages a setInterval that updates
  // #pp-skel-phrase every ~2.6s.
  return `<div class="pp-loader">
    <div class="pp-loader-spinner" aria-hidden="true"></div>
    <div class="pp-loader-phrase" id="pp-skel-phrase">⏳ Просыпаюсь, потягиваюсь…</div>
    <div class="pp-loader-title" id="pp-skel-text">${esc(message||'Запрашиваю задачи из Jira…')}</div>
    <div class="pp-loader-hint">Обычно занимает 5–30 секунд. При большом количестве проектов — до 1–1.5 мин.</div>
    <button class="int-btn int-btn-ghost int-btn-sm" id="pp-skel-cancel" type="button">✕ Отменить</button>
  </div>`;
}

export function renderEmpty(reason) {
  return `<div class="pp-empty">
    <div class="pp-empty-icon">📡</div>
    <div class="pp-empty-title">Нет данных Сканнера команд</div>
    <div class="pp-empty-sub">${esc(reason || 'Укажите ключи проектных пространств: ⚙ Настройки → Интеграции → Jira → «Ключи проектных пространств».')}</div>
  </div>`;
}

export function renderError(message, retry=true) {
  return `<div class="pp-empty">
    <div class="pp-empty-icon">⚠</div>
    <div class="pp-empty-title">Не удалось получить данные</div>
    <div class="pp-empty-sub">${esc(message||'Ошибка запроса')}</div>
    ${retry ? `<div style="margin-top:14px"><button class="int-btn int-btn-primary" id="pp-retry-btn">↺ Повторить</button></div>` : ''}
  </div>`;
}
