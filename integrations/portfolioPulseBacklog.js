'use strict';
/* ============================================================
   PORTFOLIO PULSE — BACKLOG analyser
   Backlog = not in active sprint AND not terminal.
   ============================================================ */

import { isTerminalStatus, ts, daysAgo, typeBucket } from './portfolioPulseUtils.js';

export function buildBacklogModel(model) {
  // Combine across spaces
  const out = {
    issuesByPk: {}, total: 0, totalsByPk: {},
    topOldest: [], topHighPriority: [],
    noAssignee: 0, noDescription: 0, bugs: 0, orphanSubs: 0,
    overdue: 0, older90d: 0, noPriority: 0,
  };
  for (const [pk, sp] of Object.entries(model.spaces)) {
    if (sp.hasError) continue;
    out.issuesByPk[pk] = sp.backlogIssues || [];
    out.totalsByPk[pk] = (sp.backlogIssues || []).length;
    out.total += (sp.backlogIssues || []).length;
  }
  const all = Object.values(out.issuesByPk).flat();

  out.topOldest = all.slice().sort((a,b) => ts(a.created) - ts(b.created)).slice(0, 30);
  out.topHighPriority = all.filter(i => /(blocker|highest|critical|high|критич|высок)/i.test(i.priority||''))
    .sort((a,b) => ts(a.created) - ts(b.created)).slice(0, 30);

  for (const i of all) {
    if (!i.assignee) out.noAssignee++;
    if (!i.description) out.noDescription++;
    if (typeBucket(i) === 'bug') out.bugs++;
    if (typeBucket(i) === 'subtask' && !i.parentKey) out.orphanSubs++;
    if (i.duedate && ts(i.duedate) < Date.now()) out.overdue++;
    if (i.created && ts(i.created) < daysAgo(90)) out.older90d++;
    if (!i.priority) out.noPriority++;
  }
  return out;
}

export function buildBacklogInsights(bl, model) {
  const out = [];
  const add = (sev, title, explanation, items = [], target=null) => out.push({
    severity: sev, title, explanation, count: (items||[]).length, items: items || [], target, scope: target || 'all',
  });
  if (bl.total >= 200) add('warning', `Бэклог ≥ ${bl.total}`, 'Слишком большой backlog — нужен groomming.', []);
  if (bl.older90d) add('info', `Старше 90 дней: ${bl.older90d}`, 'Задачи висят больше 3 месяцев — возможно их можно закрыть.', []);
  if (bl.noPriority > 5) add('info', `Без приоритета: ${bl.noPriority}`, 'Назначьте priority — иначе backlog не ранжируется.', []);
  if (bl.topHighPriority.length) add('warning', `High priority в backlog: ${bl.topHighPriority.length}`,
      'Эти задачи помечены high/critical/blocker, но в backlog — не запланированы.', bl.topHighPriority);
  if (bl.overdue) add('warning', `Просроченных в backlog: ${bl.overdue}`, 'Дата завершения уже прошла, задачи не закрыты.', []);
  if (bl.orphanSubs) add('warning', `Sub-task без parent: ${bl.orphanSubs}`, 'Подзадачи в backlog без родительских задач.', []);
  if (bl.bugs / Math.max(1, bl.total) > 0.4 && bl.total >= 10)
    add('warning', `Высокая доля bugs в backlog (${bl.bugs}/${bl.total})`, '40% bugs в очереди — копится технический долг.', []);
  if (bl.noDescription / Math.max(1, bl.total) > 0.5 && bl.total >= 10)
    add('info', `Без description: ${bl.noDescription}`, 'Половина backlog без описания — теряется контекст.', []);
  if (bl.noAssignee > 5)
    add('info', `Без assignee: ${bl.noAssignee}`, 'Стоит назначить владельцев или явно оставить unassigned по правилу.', []);

  // Skew between spaces
  const vals = Object.values(bl.totalsByPk);
  if (vals.length >= 2) {
    const max = Math.max(...vals), min = Math.min(...vals);
    if (max > 0 && max >= min * 3 && (max - min) >= 20) {
      const maxPk = Object.keys(bl.totalsByPk).find(k => bl.totalsByPk[k] === max);
      add('info', `Перекос backlog между пространствами`,
          `Лидер: ${maxPk} (${max}). Разница ≥ 3× от наименьшего.`);
    }
  }

  return out;
}
