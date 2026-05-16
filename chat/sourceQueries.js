'use strict';
/* ============================================================
   chat/sourceQueries.js — V22+ Week 3 (S-S1..S-S5, S-S7, S-S10, S-S13)

   Per-source queries для коротких периодов (≤14 дней): «Что Иванов
   делал в BB вчера?», «Сколько PR команда PAY смержила за неделю?».

   Использует **Scanner cache** (Services.TeamScanner2.getModel()) —
   без сетевых запросов. Для длинных периодов caller должен
   использовать employeeReport.js (LP-01..LP-08) который через
   historicalFetcher идёт.

   Public API:
     buildSourceQueryResponse(target, opts?) → structured
       · target.sources — какие источники запрошены ([] = все)
       · target.employee — для per-person; target.team — для team-aggregate

   Контракты:
     · НЕ throw'ает на пустую model — возвращает «Сканнер не запускался» fallback.
     · Identity-deterministic match через participant.email/jiraAccountId.
     · `[X]`-уволенные отфильтрованы.
   ============================================================ */

import { state } from '../state.js';
import { Services } from '../app/services.js';
import { linkTo } from './linkTo.js';
import { buildSourceChips, buildTimeChipBar } from './chipBars.js';

/* ─────────────────────────────────────────────────────────────
   Main builder
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} target — resolveTarget output
 * @param {object} opts   — { now?: Date }
 * @returns {object} structured response
 */
export function buildSourceQueryResponse(target, opts = {}) {
  const model = _getScannerModel();
  if (!model) {
    return _fallbackNoModel();
  }

  const period = target?.period || _defaultPeriod(opts.now);
  const sources = (target?.sources && target.sources.length)
    ? target.sources
    : ['jira', 'bb', 'cf']; // default: 3 main sources

  // Person query (S-S1, S-S3, S-S5)
  if (target?.employee) {
    return _buildPersonSourceQuery(target.employee, sources, period, model, target);
  }

  // Team query (S-S2)
  if (target?.team) {
    return _buildTeamSourceQuery(target.team, sources, period, model, target);
  }

  return _fallbackNoTarget();
}

/* ─────────────────────────────────────────────────────────────
   Person query
   ───────────────────────────────────────────────────────────── */

function _buildPersonSourceQuery(employee, sources, period, model, target) {
  const participant = _findParticipant(employee, model);
  if (!participant) {
    return {
      text: `Не нашёл «${employee.label || employee.id}» в Сканнере. Возможно, он не входит в активные команды или Сканнер не запускался.`,
      cards: [], actions: [], drilldown: [],
      responseSource: 'rule',
    };
  }

  const summary = _summarizePersonBySource(participant, sources, period);

  const empLabel = participant.label || employee.label || employee.id;
  const periodLabel = period.label || '';

  const headerParts = [`## ${empLabel}`];
  if (periodLabel) headerParts.push(`_${periodLabel}_`);

  const lines = [headerParts.join(' · '), ''];

  // Inline source-chips (S-S7)
  const sourceChips = buildSourceChips(summary._chips);
  if (sourceChips) lines.push(sourceChips, '');

  // Per-source sections
  if (sources.includes('jira') && summary.jira) {
    lines.push(_renderJiraPersonSection(summary.jira, empLabel));
  }
  if (sources.includes('bb') && summary.bb) {
    lines.push(_renderBBPersonSection(summary.bb, empLabel));
  }
  if (sources.includes('cf') && summary.cf) {
    lines.push(_renderCFPersonSection(summary.cf, empLabel));
  }
  if (sources.includes('zephyr') && summary.zephyr) {
    lines.push(_renderZephyrPersonSection(summary.zephyr, empLabel));
  }

  // Cards для glance-read
  const cards = [];
  if (summary.jira)   cards.push({ title: 'Jira',        value: String(summary.jira.total),   hint: 'задач' });
  if (summary.bb)     cards.push({ title: 'Bitbucket',   value: String(summary.bb.total),     hint: `${summary.bb.commits} коммитов · ${summary.bb.prs} PR` });
  if (summary.cf)     cards.push({ title: 'Confluence',  value: String(summary.cf.total),     hint: 'страниц' });
  if (summary.zephyr) cards.push({ title: 'Zephyr',      value: String(summary.zephyr.total), hint: 'прогонов' });

  // Actions: deep-link в Scanner + time-chip-bar (UX-01)
  const actions = [
    linkTo({ kind: 'employee', id: employee.id, label: empLabel },
      { primary: true, label: `→ Сканнер: ${empLabel}` }),
    ...buildTimeChipBar(target, { currentPeriod: periodLabel, includeCustom: true }).slice(0, 4),
  ].filter(Boolean);

  // Drilldown (S-S13 + cross-context)
  const drilldown = [
    summary.jira?.total > 0 && { text: 'Только Jira',   prompt: `${empLabel} в Jira ${periodLabel}` },
    summary.bb?.total > 0   && { text: 'Только BB',     prompt: `${empLabel} в Bitbucket ${periodLabel}` },
    summary.cf?.total > 0   && { text: 'Только CF',     prompt: `${empLabel} в Confluence ${periodLabel}` },
    { text: 'За другой период', prompt: `${empLabel} за квартал` },
    { text: 'Эпики в Реестре',  prompt: `эпики ${empLabel}` },
  ].filter(Boolean);

  return {
    text: lines.filter(Boolean).join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: {
      kind: 'source_query_person',
      employee: employee.id,
      sources,
      period: { label: periodLabel },
    },
  };
}

function _renderJiraPersonSection(jira, empLabel) {
  const lines = ['### Jira', `**Всего:** ${jira.total} · **Закрыто:** ${jira.done} · **В работе:** ${jira.inProgress} · **Блокеры:** ${jira.blockers}`];
  if (jira.top?.length) {
    lines.push('**Топ задачи:**');
    for (const it of jira.top.slice(0, 5)) {
      const key = it.key || '?';
      const sum = (it.summary || '').slice(0, 60);
      const status = it.status || '';
      lines.push(`- \`${key}\` ${sum}${status ? ` _(${status})_` : ''}`);
    }
  }
  return lines.join('\n') + '\n';
}

function _renderBBPersonSection(bb, empLabel) {
  const lines = ['### Bitbucket', `**Коммитов:** ${bb.commits} · **PR:** ${bb.prs} · **Merged:** ${bb.merged}`];
  if (bb.top?.length) {
    lines.push('**Топ:**');
    for (const it of bb.top.slice(0, 5)) {
      const repo = it.repo || it.repoName || '?';
      const kind = it.kind === 'pr' ? 'PR' : 'коммит';
      const title = (it.title || it.message || '').slice(0, 50);
      lines.push(`- ${kind} в ${repo}: ${title}`);
    }
  }
  return lines.join('\n') + '\n';
}

function _renderCFPersonSection(cf, empLabel) {
  const lines = ['### Confluence', `**Страниц/правок:** ${cf.total}`];
  if (cf.top?.length) {
    lines.push('**Топ страницы:**');
    for (const it of cf.top.slice(0, 5)) {
      const title = (it.title || '').slice(0, 60);
      const space = it.space?.key || it.spaceKey || '';
      lines.push(`- ${title}${space ? ` _(${space})_` : ''}`);
    }
  }
  return lines.join('\n') + '\n';
}

function _renderZephyrPersonSection(z, empLabel) {
  return `### Zephyr\n**Прогонов:** ${z.total}\n`;
}

/* ─────────────────────────────────────────────────────────────
   Team query
   ───────────────────────────────────────────────────────────── */

function _buildTeamSourceQuery(team, sources, period, model, target) {
  const teamName = team.name || team;
  const participants = (model.participants || [])
    .filter(p => !p.deactivated)
    .filter(p => _participantInTeam(p, teamName));

  if (!participants.length) {
    return {
      text: `В команде «${teamName}» нет участников в Сканнере (или Сканнер не запускался для её проектов).`,
      cards: [], actions: [], drilldown: [],
      responseSource: 'rule',
    };
  }

  const teamSummary = _summarizeTeamBySource(participants, sources, period);
  const periodLabel = period.label || '';

  const lines = [
    `## Команда ${teamName}`,
    periodLabel ? `_${periodLabel}_` : '',
    '',
  ];

  const sourceChips = buildSourceChips(teamSummary._chips);
  if (sourceChips) lines.push(sourceChips, '');

  // Per-source aggregates
  if (sources.includes('jira') && teamSummary.jira) {
    lines.push(`### Jira\n**Всего:** ${teamSummary.jira.total} · **Закрыто:** ${teamSummary.jira.done} · **Блокеры:** ${teamSummary.jira.blockers}\n`);
  }
  if (sources.includes('bb') && teamSummary.bb) {
    lines.push(`### Bitbucket\n**Коммитов:** ${teamSummary.bb.commits} · **PR:** ${teamSummary.bb.prs} · **Merged:** ${teamSummary.bb.merged}\n`);
  }
  if (sources.includes('cf') && teamSummary.cf) {
    lines.push(`### Confluence\n**Страниц:** ${teamSummary.cf.total}\n`);
  }

  // Top contributors (ranking разрешён — этика снята)
  if (participants.length > 1) {
    const top = participants
      .map(p => ({ p, total: _participantTotalForSources(p, sources) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    if (top.length) {
      lines.push('### Топ участники');
      for (const { p, total } of top) {
        lines.push(`- ${p.label || p.email}: ${total}`);
      }
    }
  }

  const cards = [];
  if (teamSummary.jira) cards.push({ title: 'Jira',       value: String(teamSummary.jira.total),  hint: 'задач' });
  if (teamSummary.bb)   cards.push({ title: 'Bitbucket',  value: String(teamSummary.bb.total),    hint: 'активность' });
  if (teamSummary.cf)   cards.push({ title: 'Confluence', value: String(teamSummary.cf.total),    hint: 'страниц' });
  cards.push({ title: 'Участников', value: String(participants.length), hint: 'в команде' });

  const actions = [
    linkTo({ kind: 'team', name: teamName }, { primary: true, section: 'scanner2', label: `→ Сканнер: ${teamName}` }),
    linkTo({ kind: 'team', name: teamName }, { section: 'gantt', label: `→ Гант: ${teamName}` }),
    ...buildTimeChipBar(target, { currentPeriod: periodLabel, includeCustom: true }).slice(0, 3),
  ].filter(Boolean);

  const drilldown = [
    { text: 'Топ контрибьюторы', prompt: `топ контрибьюторы ${teamName} ${periodLabel}` },
    { text: 'Только блокеры',    prompt: `блокеры команды ${teamName}` },
    { text: 'За квартал',        prompt: `${teamName} за квартал` },
  ];

  return {
    text: lines.filter(Boolean).join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: {
      kind: 'source_query_team',
      team: teamName,
      sources,
      period: { label: periodLabel },
      participantsCount: participants.length,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   Per-source summarizers
   ───────────────────────────────────────────────────────────── */

function _summarizePersonBySource(p, sources, period) {
  const fromMs = period.from ? period.from.getTime() : 0;
  const toMs   = period.to ? period.to.getTime() : Date.now();
  const inPeriod = (ts) => {
    const t = typeof ts === 'string' ? Date.parse(ts) : ts;
    return Number.isFinite(t) && t >= fromMs && t < toMs;
  };

  const out = { _chips: {} };

  if (sources.includes('jira')) {
    const issues = (p.issuesNow || []).filter(i => inPeriod(i.updated || i.updatedAt));
    const done   = (p.doneToday || []).concat(p.doneYesterday || []).filter(i => inPeriod(i.at || i.updated || i.updatedAt));
    const blockers = (p.blockers || []).filter(b => inPeriod(b.at || b.lastSeen) || true);
    out.jira = {
      total:      issues.length + done.length,
      done:       done.length,
      inProgress: issues.length,
      blockers:   blockers.length,
      top:        issues.slice(0, 8),
    };
    out._chips.jira = { total: out.jira.total };
  }

  if (sources.includes('bb')) {
    const items = (p.bbItems || []).filter(i => inPeriod(i.at || i.updated));
    const commits = items.filter(i => i.kind === 'commit');
    const prs     = items.filter(i => i.kind === 'pr');
    const merged  = items.filter(i => /merged|merge/i.test(i.state || i.status || ''));
    out.bb = { total: items.length, commits: commits.length, prs: prs.length, merged: merged.length, top: items };
    out._chips.bb = { total: out.bb.total };
  }

  if (sources.includes('cf')) {
    const items = (p.cfItems || []).filter(i => inPeriod(i.at || i.updated || i.lastModified));
    out.cf = { total: items.length, top: items };
    out._chips.cf = { total: out.cf.total };
  }

  if (sources.includes('zephyr')) {
    const items = (p.zephyrItems || []).filter(i => inPeriod(i.at || i.updated));
    out.zephyr = { total: items.length };
    out._chips.zephyr = { total: out.zephyr.total };
  }

  return out;
}

function _summarizeTeamBySource(participants, sources, period) {
  const out = { _chips: {} };
  if (sources.includes('jira')) {
    let total = 0, done = 0, blockers = 0;
    for (const p of participants) {
      total += (p.issuesNow?.length || 0) + (p.doneToday?.length || 0) + (p.doneYesterday?.length || 0);
      done  += (p.doneToday?.length || 0) + (p.doneYesterday?.length || 0);
      blockers += (p.blockers?.length || 0);
    }
    out.jira = { total, done, blockers };
    out._chips.jira = { total };
  }
  if (sources.includes('bb')) {
    let commits = 0, prs = 0, merged = 0;
    for (const p of participants) {
      const items = p.bbItems || [];
      commits += items.filter(i => i.kind === 'commit').length;
      prs     += items.filter(i => i.kind === 'pr').length;
      merged  += items.filter(i => /merged|merge/i.test(i.state || i.status || '')).length;
    }
    out.bb = { total: commits + prs, commits, prs, merged };
    out._chips.bb = { total: out.bb.total };
  }
  if (sources.includes('cf')) {
    let total = 0;
    for (const p of participants) total += p.cfItems?.length || 0;
    out.cf = { total };
    out._chips.cf = { total };
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _getScannerModel() {
  try {
    return Services.TeamScanner2?.getModel?.() || null;
  } catch (_) { return null; }
}

function _findParticipant(employee, model) {
  if (!employee || !model?.participants) return null;
  const empEmail = String(employee.email || employee.id || '').toLowerCase();
  const empJaid  = String(employee.jiraAccountId || '').trim();
  const empFio   = String(employee.label || '').trim();
  for (const p of model.participants) {
    if (p.deactivated) continue;
    if (empEmail && String(p.email || '').toLowerCase() === empEmail) return p;
    if (empJaid && String(p.jiraAccountId || '') === empJaid) return p;
    if (empFio && String(p.label || p.fio || '') === empFio) return p;
  }
  return null;
}

function _participantInTeam(p, teamName) {
  if (!p) return false;
  const lc = String(teamName).toLowerCase();
  // Match по projects[] (PK или name)
  if (Array.isArray(p.projects) && p.projects.some(pk => String(pk).toLowerCase().includes(lc))) {
    return true;
  }
  // Fallback по team field
  if (p.team && String(p.team).toLowerCase() === lc) return true;
  // Совсем fallback — через state.employees identity → team
  try {
    const all = (state.employees || []).filter(e => !e.deactivated);
    for (const e of all) {
      const lcTeam = String(e.team || '').toLowerCase();
      if (lcTeam !== lc) continue;
      if (p.email && String(p.email).toLowerCase() === String(e.email || '').toLowerCase()) return true;
      if (p.jiraAccountId && p.jiraAccountId === e.jiraAccountId) return true;
    }
  } catch (_) {}
  return false;
}

function _participantTotalForSources(p, sources) {
  let total = 0;
  if (sources.includes('jira')) {
    total += (p.issuesNow?.length || 0) + (p.doneToday?.length || 0) + (p.doneYesterday?.length || 0);
  }
  if (sources.includes('bb')) total += p.bbItems?.length || 0;
  if (sources.includes('cf')) total += p.cfItems?.length || 0;
  if (sources.includes('zephyr')) total += p.zephyrItems?.length || 0;
  return total;
}

function _defaultPeriod(now) {
  const today = now || new Date();
  const yest = new Date(today.getTime() - 86400_000);
  yest.setHours(0, 0, 0, 0);
  const endOfYest = new Date(yest.getTime() + 86400_000);
  return { from: yest, to: endOfYest, label: 'вчера' };
}

function _fallbackNoModel() {
  return {
    text: 'Сканнер ещё не запускался. Откройте «Сканнер команд» и нажмите «↻ Обновить», потом задайте вопрос снова.',
    cards: [],
    actions: [{ type: 'navigate', label: '→ Открыть Сканнер', payload: { section: 'scanner2' }, primary: true }],
    drilldown: [],
    responseSource: 'rule',
  };
}

function _fallbackNoTarget() {
  return {
    text: 'Не указан сотрудник или команда. Попробуйте: «Иванов за неделю», «команда PAY за вчера», «что в BB у PAY?».',
    cards: [], actions: [], drilldown: [],
    responseSource: 'rule',
  };
}
