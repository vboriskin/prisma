'use strict';
/* ============================================================
   PORTFOLIO PULSE — INSIGHTS ENGINE
   Pure rules over the analysed model.
   Each insight: { severity, title, explanation, count, items[], target?, scope }
   ============================================================ */

import { isTerminalStatus, isInitialStatus, ts, daysAgo, hoursAgo, typeBucket } from './portfolioPulseUtils.js';

const STAGNATION_DAYS = 7;
const HIGH_PRIO_RX    = /(blocker|highest|critical|критич|highest|высш)/i;
const BLOCKER_RX      = /(blocker|критич)/i;

/**
 * Build the full set of insights from a pulse model.
 * @param {object} model — analysePulse() output
 * @param {object} opts  — { staleDays, wipMax }
 * @returns {Array<Insight>}
 */
export function buildInsights(model, opts = {}) {
  const wipMax = opts.wipMax || 3;
  const staleDays = opts.staleDays || 7;
  const insights = [];
  const add = (sev, title, explanation, items = [], extra = {}) => {
    const list = items.map(i => i.issue || i).filter(Boolean);
    insights.push({
      severity: sev, title, explanation,
      count: items.length, items: list,
      target: extra.target || null, scope: extra.scope || 'all',
    });
  };

  /* ── Per-project errors ───────────────────────────────── */
  for (const e of model.errors || []) {
    add('critical', `Сбой пространства ${e.projectKey}`, e.error || 'Не удалось получить данные', [], { target: e.projectKey });
  }

  /* ── Per-space empty spaces ───────────────────────────── */
  for (const [pk, sp] of Object.entries(model.spaces)) {
    if (sp.hasError) continue;
    if (!sp.issues.length) {
      add('warning', `Пространство ${pk} пустое`, 'Не вернулись задачи. Проверьте доступ или фильтры.', [], { target: pk });
    } else if (!sp.activeSprintName && sp.sprintIssues.length === 0) {
      add('info', `Пространство ${pk}: нет активного спринта`, 'В JQL для openSprints() ничего не нашлось.', [], { target: pk });
    }
  }

  /* ── Unassigned ───────────────────────────────────────── */
  const allUnassigned = Object.values(model.unassignedByPk).flat();
  if (allUnassigned.length) {
    add('warning', `${allUnassigned.length} активных задач без исполнителя`,
        'Без assignee никто не двигает задачу. Назначьте ответственного.', allUnassigned);
  }

  /* ── Per-participant signals ───────────────────────────── */
  for (const p of model.participants) {
    // WIP > N
    if (p.issuesNow.length > wipMax) {
      add('warning', `${p.label}: WIP > ${wipMax} (${p.issuesNow.length})`,
          'Слишком много параллельных задач — снижает скорость. Сократите фокус.', p.issuesNow, { target: p.key });
    }
    // Silence (no transitions, no comments, no worklog for 48h)
    const noActivity = !p.doneYesterday.length && !p.commentsRecent.length && !p.loggedYesterdaySec && !p.loggedDayBeforeSec;
    if (noActivity && p.issuesNow.length) {
      add('info', `${p.label}: тишина 48ч`,
          'Задачи в работе есть, но за двое суток не было ни переходов, ни комментариев, ни worklog.', p.issuesNow, { target: p.key });
    }
    // Empty WIP — no active issues
    if (p.issuesNow.length === 0 && (p.commentsRecent.length || p.loggedYesterdaySec)) {
      add('info', `${p.label}: пустой WIP`,
          'Активных задач нет, но активность по комментариям/worklog есть. Возможно нужна задача.', [], { target: p.key });
    }
    // Stale / idle 2–3 days
    if (p.stale.length) {
      add('info', `${p.label}: ${p.stale.length} зависших > ${staleDays}д`,
          'Задачи без обновления статуса дольше порога — стагнация.', p.stale, { target: p.key });
    }
  }

  /* ── Per-issue signals (across all spaces) ─────────────── */
  const allIssues = Object.values(model.spaces).flatMap(s => s.issues || []);

  // High priority not in work
  const highPrioNotStarted = allIssues.filter(i =>
    HIGH_PRIO_RX.test(i.priority || '') &&
    !isTerminalStatus(i.status, i.statusCat) &&
    isInitialStatus(i.status, i.statusCat));
  if (highPrioNotStarted.length) {
    add('warning', `Высокий приоритет в очереди: ${highPrioNotStarted.length}`,
        'Эти задачи помечены как high/critical/blocker, но никто их не взял.', highPrioNotStarted);
  }

  // Blockers without recent updates
  const blockerStale = allIssues.filter(i =>
    BLOCKER_RX.test(i.priority || '') &&
    !isTerminalStatus(i.status, i.statusCat) &&
    ts(i.updated) < daysAgo(2));
  if (blockerStale.length) {
    add('critical', `Блокеры без апдейта 48ч: ${blockerStale.length}`,
        'Blocker-задачи не двигались — могут заблокировать релиз.', blockerStale);
  }

  // Overdue (duedate < today, not terminal)
  const overdue = allIssues.filter(i => {
    if (isTerminalStatus(i.status, i.statusCat)) return false;
    if (!i.duedate) return false;
    return ts(i.duedate) < Date.now();
  });
  if (overdue.length) {
    add('warning', `Просроченные: ${overdue.length}`,
        'Дата завершения уже прошла, статус не финальный.', overdue);
  }

  // Deadlines this week
  const weekEnd = Date.now() + 7 * 24 * 3600 * 1000;
  const dueThisWeek = allIssues.filter(i =>
    !isTerminalStatus(i.status, i.statusCat) && i.duedate &&
    ts(i.duedate) >= Date.now() && ts(i.duedate) <= weekEnd);
  if (dueThisWeek.length) {
    add('info', `Дедлайны на этой неделе: ${dueThisWeek.length}`,
        'Контролируйте прогресс этих задач — срок наступает в ближайшие 7 дней.', dueThisWeek);
  }

  // Bugs ratio in active sprint
  for (const [pk, sp] of Object.entries(model.spaces)) {
    if (sp.hasError) continue;
    const sp_total = sp.sprintIssues.length;
    const sp_bugs  = sp.sprintIssues.filter(i => typeBucket(i) === 'bug').length;
    if (sp_total >= 8 && sp_bugs / sp_total > 0.4) {
      add('warning', `${pk}: много багов в спринте (${sp_bugs}/${sp_total})`,
          'Доля Bug превышает 40% — команда тушит пожары.', sp.sprintIssues.filter(i => typeBucket(i) === 'bug'), { target: pk });
    }
  }

  // Orphan sub-tasks (no parent)
  const orphanSubs = allIssues.filter(i => typeBucket(i) === 'subtask' && !i.parentKey);
  if (orphanSubs.length) {
    add('warning', `Sub-task без parent: ${orphanSubs.length}`,
        'Подзадачи без родительской задачи — структура нарушена.', orphanSubs);
  }

  // Parent terminal but sub-task still open
  const subsByParent = new Map();
  for (const i of allIssues) {
    if (typeBucket(i) === 'subtask' && i.parentKey) {
      if (!subsByParent.has(i.parentKey)) subsByParent.set(i.parentKey, []);
      subsByParent.get(i.parentKey).push(i);
    }
  }
  const parentDoneOpenSubs = [];
  for (const i of allIssues) {
    if (typeBucket(i) === 'subtask') continue;
    const subs = subsByParent.get(i.key) || [];
    if (!subs.length) continue;
    if (isTerminalStatus(i.status, i.statusCat)) {
      const open = subs.filter(s => !isTerminalStatus(s.status, s.statusCat));
      if (open.length) parentDoneOpenSubs.push(...open);
    }
  }
  if (parentDoneOpenSubs.length) {
    add('warning', `Parent done, sub-task open: ${parentDoneOpenSubs.length}`,
        'Родительская задача закрыта, но подзадачи ещё открыты — обычно ошибка.', parentDoneOpenSubs);
  }

  // No description
  const noDesc = allIssues.filter(i => !i.description && !isTerminalStatus(i.status, i.statusCat));
  if (noDesc.length > 5) {
    add('info', `Без описания: ${noDesc.length}`,
        'Задачи без description — у исполнителей нет контекста.', noDesc.slice(0, 60));
  }

  // No priority
  const noPrio = allIssues.filter(i => !i.priority && !isTerminalStatus(i.status, i.statusCat));
  if (noPrio.length > 5) {
    add('info', `Без приоритета: ${noPrio.length}`,
        'Задачи без priority — сложно ранжировать backlog.', noPrio.slice(0, 60));
  }

  /* ── Portfolio-level (mode = "all") ───────────────────── */
  const wipBySpace = Object.fromEntries(Object.entries(model.spaces).map(([pk, sp]) => [pk, sp.wipIssues.length]));
  const wipVals = Object.values(wipBySpace);
  if (wipVals.length >= 2) {
    const max = Math.max(...wipVals), min = Math.min(...wipVals);
    if (max > 0 && max >= min * 3 && (max - min) >= 5) {
      add('info', `Перекос WIP между пространствами`,
          `Самое нагруженное: ${Object.keys(wipBySpace).find(k => wipBySpace[k] === max)} (${max}). Разница ≥ 3× от наименьшего.`);
    }
  }

  /* ── Sort by severity (critical → warning → info) ─────── */
  const order = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => (order[a.severity] - order[b.severity]) || (b.count - a.count));

  return insights;
}

/** Filter insights by a given projectKey. Keeps insights that target that PK
 *  OR that have at least one item belonging to it. */
export function filterInsightsByPk(insights, pk) {
  if (!pk) return insights;
  return insights.filter(i => i.target === pk || (i.items || []).some(it => (it?.pk === pk)));
}
