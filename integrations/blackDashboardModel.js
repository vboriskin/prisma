'use strict';
/* ============================================================
   BLACK DASHBOARD — MODEL
   Pure functions over the raw server payload. Tested independently
   in tests/blackDashboardModel.test (run via testRunner.js).

   Input shape (from server):
     { fetchedAt, sigmaConfigured, sigmaBaseUrl, deltaBaseUrl,
       goals: [{key, summary, status, statusCat, error?, domainLinks, linkedIssues:[{key,summary,status,statusCat,type,pk,projectName,notFound?}]}],
       teamIssues: [{pk, name, total, linked, issues:[{key,summary,status,statusCat,type,pk,linkedToGoal}]}],
       summary: {totalGoals, linkedCount, unlinkedCount, coveragePct},
       errors, diagnostics }

   Output adds:
     · per-goal `linkedByPk` for the «🎯 Цели» tab grouping
     · per-team `unlinkedIssues` derived list (issues with linkedToGoal===false)
     · `coverageByTeam` ready-to-render array for the bars
     · `metricBuckets` precomputed donut/bar inputs

   ============================================================ */

/** Build the analysed model. Returns a NEW object — `raw` is left untouched. */
export function analyseBlackDashboard(raw) {
  const out = {
    fetchedAt:       raw?.fetchedAt || new Date().toISOString(),
    sigmaConfigured: !!raw?.sigmaConfigured,
    sigmaBaseUrl:    String(raw?.sigmaBaseUrl || ''),
    deltaBaseUrl:    String(raw?.deltaBaseUrl || ''),
    goals:           Array.isArray(raw?.goals) ? raw.goals.map(_normaliseGoal) : [],
    teamIssues:      Array.isArray(raw?.teamIssues) ? raw.teamIssues.map(_normaliseTeam) : [],
    errors:          Array.isArray(raw?.errors) ? raw.errors.slice() : [],
    diagnostics:     raw?.diagnostics || { totalMs: 0 },
    summary:         { totalGoals: 0, linkedCount: 0, unlinkedCount: 0, coveragePct: 0, ...(raw?.summary || {}) },
    coverageByTeam:  [],
    metricBuckets:   {},
  };

  // Coverage bars per team — sorted by pct desc, total desc as tiebreak.
  // V13 (15th pass): pass `excluded` through so the renderer can show why
  // some teams are 0/0 (everything got excluded by typed rules).
  //
  // Supplement each team with `linkedFromGoals` — count of issues that appear
  // in goals[].linkedIssues with matching pk (Sigma-side path, independent of
  // Delta scan). When total=0 (Delta scan missed the team) but goals show tasks
  // from it, `linkedFromGoals > 0` lets the renderer explain the discrepancy
  // instead of showing a misleading bare "0/0".
  const _linkedFromGoalsByPk = {};
  for (const g of out.goals) {
    for (const li of (g.linkedIssues || [])) {
      if (li.notFound) continue;
      const pk = li.pk || ((li.key || '').split('-')[0] || '—');
      _linkedFromGoalsByPk[pk] = (_linkedFromGoalsByPk[pk] || 0) + 1;
    }
  }
  out.coverageByTeam = out.teamIssues.map(t => ({
    pk:             t.pk,
    name:           t.name,
    total:          t.total,
    linked:         t.linked,
    excluded:       t.excluded || 0,
    pct:            t.total ? Math.round((t.linked / t.total) * 100) : 0,
    linkedFromGoals: _linkedFromGoalsByPk[t.pk] || 0,
  })).sort((a, b) => (b.pct - a.pct) || (b.total - a.total));

  // Metrics buckets for the «📈 Метрики» tab.
  const linkedTotal   = out.summary.linkedCount;
  const unlinkedTotal = out.summary.unlinkedCount;
  // Donut #1 — coverage (linked vs unlinked)
  const donutCoverage = {
    'Привязано к цели': linkedTotal,
    'Без цели':         unlinkedTotal,
  };
  // Donut #2 — статусы привязанных задач (по statusCat)
  const linkedStatuses = { 'Done': 0, 'In Progress': 0, 'To Do': 0 };
  for (const g of out.goals) {
    for (const li of (g.linkedIssues || [])) {
      if (li.notFound) continue;
      if (li.statusCat === 'done') linkedStatuses.Done++;
      else if (li.statusCat === 'indeterminate') linkedStatuses['In Progress']++;
      else linkedStatuses['To Do']++;
    }
  }
  // Bars: % покрытия по командам / привязанных задач по командам
  const coveragePctBars = {};
  const linkedPerTeam   = {};
  for (const cb of out.coverageByTeam) {
    coveragePctBars[cb.name || cb.pk] = cb.pct;
    linkedPerTeam[cb.name || cb.pk]   = cb.linked;
  }
  // Bars: «Готовность по целям, %» (done/total среди привязанных задач цели)
  const readinessByGoal = {};
  for (const g of out.goals) {
    if (g.error) continue;
    const lis = (g.linkedIssues || []).filter(i => !i.notFound);
    if (!lis.length) continue;
    const done = lis.filter(i => i.statusCat === 'done').length;
    readinessByGoal[g.key] = Math.round(done / lis.length * 100);
  }
  // Donut: типы привязанных vs без цели
  const donutTypesLinked   = {};
  const donutTypesUnlinked = {};
  // Bars: задач на цель
  const issuesPerGoal = {};
  for (const g of out.goals) {
    if (g.error) continue;
    issuesPerGoal[g.key] = (g.linkedIssues || []).length;
    for (const li of (g.linkedIssues || [])) {
      if (li.notFound || !li.type) continue;
      donutTypesLinked[li.type] = (donutTypesLinked[li.type] || 0) + 1;
    }
  }
  for (const t of out.teamIssues) {
    for (const it of (t.issues || [])) {
      if (it.linkedToGoal) continue;
      const ty = it.type || '—';
      donutTypesUnlinked[ty] = (donutTypesUnlinked[ty] || 0) + 1;
    }
  }
  out.metricBuckets = {
    donutCoverage,
    donutLinkedStatuses: linkedStatuses,
    barsCoveragePct:     coveragePctBars,
    barsLinkedPerTeam:   linkedPerTeam,
    barsReadinessByGoal: readinessByGoal,
    donutTypesLinked,
    donutTypesUnlinked,
    barsIssuesPerGoal:   issuesPerGoal,
  };

  return out;
}

function _normaliseGoal(g) {
  // Linked issues — group by pk for the «Цели» tab's per-team mini-summary.
  const linkedIssues = Array.isArray(g.linkedIssues) ? g.linkedIssues.slice() : [];
  const linkedByPk = {};
  for (const li of linkedIssues) {
    // Always derive pk from issue key when missing — notFound items still
    // belong to their team's bucket so the user sees "<team>: 1 не найдена"
    // rather than a generic "—" group.
    const pk = li.pk || ((li.key || '').split('-')[0] || '—');
    if (!linkedByPk[pk]) linkedByPk[pk] = { pk, projectName: li.projectName || pk, issues: [], done: 0, wip: 0, todo: 0 };
    linkedByPk[pk].issues.push(li);
    if (li.notFound) continue;
    if (li.statusCat === 'done') linkedByPk[pk].done++;
    else if (li.statusCat === 'indeterminate') linkedByPk[pk].wip++;
    else linkedByPk[pk].todo++;
  }
  return {
    key:          g.key || '',
    summary:      g.summary || '',
    status:       g.status || '',
    statusCat:    g.statusCat || 'new',
    error:        g.error || '',
    domainLinks:  Array.isArray(g.domainLinks) ? g.domainLinks.slice() : [],
    linkedIssues,
    linkedByPk:   Object.values(linkedByPk).sort((a, b) => b.issues.length - a.issues.length),
  };
}

function _normaliseTeam(t) {
  const issues = Array.isArray(t.issues) ? t.issues.slice() : [];
  return {
    pk:             t.pk || '',
    name:           t.name || t.pk || '',
    total:          Number(t.total || 0),
    linked:         Number(t.linked || 0),
    // V13 (7th pass): excluded counter + per-type breakdown surfaced from
    // the server. `byType: { 'Epic': {total, linked, excluded}, ... }`.
    excluded:       Number(t.excluded || 0),
    byType:         (t.byType && typeof t.byType === 'object') ? { ...t.byType } : {},
    issues,
    // unlinkedIssues drops excluded epics/children — they're not "unlinked",
    // they're "outside scope". Renderer can show them in a separate section
    // if needed via the .excluded flag.
    unlinkedIssues: issues.filter(i => !i.linkedToGoal && !i.excluded),
  };
}
