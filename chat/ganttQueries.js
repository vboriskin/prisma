'use strict';
/* ============================================================
   chat/ganttQueries.js — V22+ Week 3 (G-Q1..G-Q5, G-Q9, G-Q10, G-Q13)

   Queries по Гант operations:
     · G-Q1: «Сколько переносов в PAY в 1.21?»          — transfers count
     · G-Q2: «Сколько переносов всего за 1.21?»         — aggregate
     · G-Q3: «Сколько завершено в 1.21?»                — completion
     · G-Q4: «Сколько в овертайме?» / «Кто овертаймил?» — overtime
     · G-Q5: «Какие эпики перенесли в 1.22?»            — recent transfers

   Data:
     · state.rows[].ganttArrows[]    — массив переносов { wt, srcCol, dstCol, at }
     · state.rows[].transferComments[] — комментарии к переносам
     · state.rows[].hasOvertime / hasRelease120/121/122 — release flags
     · state.rows[].isDone           — completion

   Контракты:
     · Per-team filter через target.team
     · Per-release filter через target.release.id ('1.20'|'1.21'|'1.22'|'overtime')
     · Period filter через target.period (по `at` arrows)
     · Per-person ranking разрешён (этика снята)
   ============================================================ */

import { state } from '../state.js';
import { linkTo } from './linkTo.js';
import { buildTimeChipBar } from './chipBars.js';

/* ─────────────────────────────────────────────────────────────
   Main router
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} target — resolveTarget output
 * @param {object} opts   — { intent?: 'transfers'|'overtime'|'completion' }
 * @returns {object} structured
 */
export function buildGanttQueryResponse(target, opts = {}) {
  const text = String(target?.raw?.text || target?.raw?.lc || '').toLowerCase();

  // Intent detection
  if (/(?:овертайм|overtime|внепланов)/.test(text)) {
    return _buildOvertimeQuery(target);
  }
  if (/(?:заверш|готов|закрыт|complet|done|сделан)/.test(text) && !/перенос|move|переезжа/.test(text)) {
    return _buildCompletionQuery(target);
  }
  if (/(?:план.*зафикс|кто.*заблок.*план|plan.*lock)/.test(text)) {
    return _buildPlanLockQuery(target);
  }
  // Default — transfers
  return _buildTransfersQuery(target);
}

/* ─────────────────────────────────────────────────────────────
   G-Q1, G-Q2, G-Q5: Transfers
   ───────────────────────────────────────────────────────────── */

// V22+ Week 3 — mapping между UI release-id ('1.21') и
// internal arrow col-id ('r121') которые хранятся в state.rows[].ganttArrows.
const RELEASE_TO_COL = {
  '1.20': 'r120', '1.21': 'r121', '1.22': 'r122',
  'overtime': 'overtime', 'backlog': 'backlog',
};

function _buildTransfersQuery(target) {
  const rows = (state.rows || []);
  const team = target?.team?.name || target?.team || null;
  const release = target?.release?.id || null;
  const releaseCol = release ? (RELEASE_TO_COL[release] || release) : null;
  const period = target?.period || null;

  const teamFilter = team ? String(team).toLowerCase() : null;
  const filtered = rows.filter(r => !teamFilter || String(r.team || '').toLowerCase() === teamFilter);

  // Collect arrows with metadata
  const allArrows = [];
  for (const r of filtered) {
    for (const a of (r.ganttArrows || [])) {
      allArrows.push({ ...a, row: r });
    }
  }

  // Release filter (G-Q1, G-Q5)
  let scoped = allArrows;
  if (releaseCol) {
    scoped = scoped.filter(a => a.srcCol === releaseCol || a.dstCol === releaseCol);
  }
  // Period filter
  if (period?.from && period?.to) {
    const fromMs = period.from.getTime();
    const toMs   = period.to.getTime();
    scoped = scoped.filter(a => {
      const t = Date.parse(a.at || '');
      return Number.isFinite(t) && t >= fromMs && t < toMs;
    });
  }

  const total = scoped.length;
  const subjectLabel = team ? `команда ${team}` : 'все команды';
  const releaseLabel = release ? ` в релизе ${release}` : '';
  const periodLabel  = period?.label ? ` ${period.label}` : '';

  const lines = [
    `## Переносы: ${subjectLabel}${releaseLabel}${periodLabel}`,
    `**Всего переносов:** ${total}`,
    '',
  ];

  // Breakdown by direction
  const byDirection = {};
  for (const a of scoped) {
    const key = `${a.srcCol} → ${a.dstCol}`;
    byDirection[key] = (byDirection[key] || 0) + 1;
  }
  if (Object.keys(byDirection).length) {
    lines.push('### По направлениям');
    const sorted = Object.entries(byDirection).sort((a, b) => b[1] - a[1]);
    for (const [dir, n] of sorted.slice(0, 8)) {
      lines.push(`- ${dir}: ${n}`);
    }
  }

  // Top moved epics
  const byEpic = {};
  for (const a of scoped) {
    const epicName = a.row?.epic || a.row?.tasks || a.row?.id || '?';
    if (!byEpic[epicName]) byEpic[epicName] = { count: 0, row: a.row, lastAt: 0 };
    byEpic[epicName].count++;
    const t = Date.parse(a.at || '');
    if (Number.isFinite(t) && t > byEpic[epicName].lastAt) byEpic[epicName].lastAt = t;
  }
  const topEpics = Object.entries(byEpic).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  if (topEpics.length) {
    lines.push('', '### Эпики с переносами');
    for (const [name, info] of topEpics) {
      const date = info.lastAt ? new Date(info.lastAt).toLocaleDateString('ru-RU') : '';
      lines.push(`- **${name}** · ${info.count} перенос${_pluralEnd(info.count)}${date ? ` · последний ${date}` : ''}`);
    }
  }

  // Per-team ranking (G-Q12') — only if no team filter
  if (!team) {
    const byTeam = {};
    for (const a of scoped) {
      const t = a.row?.team || '—';
      byTeam[t] = (byTeam[t] || 0) + 1;
    }
    const topTeams = Object.entries(byTeam).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topTeams.length > 1) {
      lines.push('', '### Топ команд по переносам');
      for (const [t, n] of topTeams) {
        lines.push(`- **${t}**: ${n}`);
      }
    }
  }

  const cards = [
    { title: 'Всего',         value: String(total), hint: 'переносов' },
    { title: 'Эпиков',        value: String(topEpics.length), hint: 'затронуто' },
    { title: 'Направлений',   value: String(Object.keys(byDirection).length), hint: 'src→dst' },
  ];

  // Actions: deep-link + time chip
  const actions = [];
  if (team) {
    actions.push(linkTo({ kind: 'team', name: team }, { section: 'gantt', primary: true, label: `→ Гант: ${team}` }));
  } else {
    actions.push({ type: 'navigate', label: '→ Открыть Гант', payload: { section: 'gantt' }, primary: true });
  }
  if (release) {
    actions.push(linkTo({ kind: 'release', id: release }, { label: `→ Гант: ${release}` }));
  }
  actions.push(...buildTimeChipBar(target, { currentPeriod: period?.label || '' }).slice(0, 3));

  const drilldown = [
    !team && { text: 'Только команда PAY', prompt: 'переносы команды PAY' },
    !release && { text: 'Только релиз 1.21', prompt: 'переносы в 1.21' },
    { text: 'Кто переносит чаще',  prompt: 'топ-3 команды по переносам' },
    { text: 'Завершено в релизе',  prompt: release ? `сколько завершено в ${release}` : 'сколько завершено в 1.21' },
    { text: 'Овертаймы',           prompt: 'кто в овертайме' },
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: { kind: 'gantt_transfers', team, release, period: period?.label, total },
  };
}

/* ─────────────────────────────────────────────────────────────
   G-Q3: Completion
   ───────────────────────────────────────────────────────────── */

function _buildCompletionQuery(target) {
  const rows = state.rows || [];
  const team = target?.team?.name || target?.team || null;
  const release = target?.release?.id || null;

  const teamFilter = team ? String(team).toLowerCase() : null;
  let scoped = rows.filter(r => !teamFilter || String(r.team || '').toLowerCase() === teamFilter);

  if (release) {
    // Поддерживаем оба формата: '1.21' (UI) и 'r121' (internal).
    const flagMap = {
      '1.20': 'hasRelease120', '1.21': 'hasRelease121', '1.22': 'hasRelease122',
      'r120': 'hasRelease120', 'r121': 'hasRelease121', 'r122': 'hasRelease122',
      'overtime': 'hasOvertime',
    };
    const flag = flagMap[release];
    if (flag) scoped = scoped.filter(r => r[flag]);
  }

  const done = scoped.filter(r => r.isDone).length;
  const inProgress = scoped.filter(r => !r.isDone && r.inProgress).length;
  const notStarted = scoped.length - done - inProgress;
  const donePct = scoped.length ? Math.round(done / scoped.length * 100) : 0;

  const subjectLabel = team ? `команда ${team}` : 'все команды';
  const releaseLabel = release ? ` в релизе ${release}` : '';

  const lines = [
    `## Готовность: ${subjectLabel}${releaseLabel}`,
    `**Всего эпиков:** ${scoped.length}`,
    `**Завершено:** ${done} (${donePct}%) · **В работе:** ${inProgress} · **Не начато:** ${notStarted}`,
    '',
  ];

  if (done) {
    lines.push('### Закрытые эпики');
    for (const r of scoped.filter(x => x.isDone).slice(0, 10)) {
      lines.push(`- ✓ ${r.epic || r.tasks || '—'}${r.team ? ` _(${r.team})_` : ''}`);
    }
  }

  const cards = [
    { title: 'Всего',     value: String(scoped.length), hint: 'эпиков' },
    { title: 'Завершено', value: String(done),          hint: `${donePct}%` },
    { title: 'В работе',  value: String(inProgress),    hint: 'in progress' },
    { title: 'Не начато', value: String(notStarted),    hint: 'todo' },
  ];

  const actions = [];
  if (team) actions.push(linkTo({ kind: 'team', name: team }, { section: 'gantt', primary: true }));
  else actions.push({ type: 'navigate', label: '→ Открыть Гант', payload: { section: 'gantt' }, primary: true });
  if (release) actions.push(linkTo({ kind: 'release', id: release }));

  const drilldown = [
    { text: 'Сколько переносов', prompt: release ? `переносы в ${release}` : 'переносы в 1.21' },
    { text: 'Овертаймы',         prompt: 'кто в овертайме' },
  ];

  return {
    text: lines.join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: { kind: 'gantt_completion', team, release, total: scoped.length, done, donePct },
  };
}

/* ─────────────────────────────────────────────────────────────
   G-Q4: Overtime
   ───────────────────────────────────────────────────────────── */

function _buildOvertimeQuery(target) {
  const rows = state.rows || [];
  const team = target?.team?.name || target?.team || null;
  const teamFilter = team ? String(team).toLowerCase() : null;
  const overtime = rows
    .filter(r => r.hasOvertime)
    .filter(r => !teamFilter || String(r.team || '').toLowerCase() === teamFilter);

  const lines = [
    `## Овертайм${team ? `: команда ${team}` : ''}`,
    `**Эпиков в овертайме:** ${overtime.length}`,
    '',
  ];

  if (overtime.length) {
    // Per-team breakdown (G-Q4)
    if (!team) {
      const byTeam = {};
      for (const r of overtime) {
        const t = r.team || '—';
        byTeam[t] = (byTeam[t] || 0) + 1;
      }
      const sorted = Object.entries(byTeam).sort((a, b) => b[1] - a[1]);
      lines.push('### По командам');
      for (const [t, n] of sorted.slice(0, 10)) {
        lines.push(`- **${t}**: ${n}`);
      }
    }

    // Per-assignee breakdown (G-Q12' — этика снята)
    const byAssignee = {};
    for (const r of overtime) {
      const assignees = String(r.assignee || '').split(/[|,]/).map(s => s.trim()).filter(Boolean);
      for (const a of assignees) {
        byAssignee[a] = (byAssignee[a] || 0) + 1;
      }
    }
    const topAssignees = Object.entries(byAssignee).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (topAssignees.length) {
      lines.push('', '### По исполнителям');
      for (const [a, n] of topAssignees) {
        lines.push(`- **${a}**: ${n}`);
      }
    }

    // Top epics
    lines.push('', '### Эпики');
    for (const r of overtime.slice(0, 12)) {
      lines.push(`- **${r.epic || r.tasks || '—'}** _(${r.team || '—'})_${r.assignee ? ` · ${r.assignee}` : ''}`);
    }
    if (overtime.length > 12) {
      lines.push(`_…и ещё ${overtime.length - 12}_`);
    }
  } else {
    lines.push('_Нет эпиков в овертайме._');
  }

  const cards = [
    { title: 'В овертайме',  value: String(overtime.length), hint: 'эпиков' },
    { title: 'Исполнителей', value: String(new Set(overtime.flatMap(r => String(r.assignee || '').split(/[|,]/).map(s => s.trim()).filter(Boolean))).size), hint: 'затронуто' },
  ];

  const actions = [
    { type: 'apply_filter', label: '→ Реестр: только овертайм', payload: { onlyOvertime: true }, primary: true },
    linkTo({ kind: 'release', id: 'overtime' }, { label: '→ Гант: овертайм' }),
  ];

  const drilldown = [
    !team && { text: 'Только команда PAY',     prompt: 'овертайм в PAY' },
    { text: 'Сколько переносов в OT',  prompt: 'переносы в овертайм' },
    { text: 'Что планируем закрыть',   prompt: 'завершено в 1.21' },
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: { kind: 'gantt_overtime', team, total: overtime.length },
  };
}

/* ─────────────────────────────────────────────────────────────
   Plan-lock query (G-Q8)
   ───────────────────────────────────────────────────────────── */

function _buildPlanLockQuery(target) {
  const isLocked = !!state.planLocked;
  const lockEvents = (state.actionLog || []).filter(e => /plan.*lock|lock.*plan|зафикс/i.test(e.label || e.type || '')).slice(-5);

  const lines = [
    '## План зафиксирован?',
    isLocked ? '✓ **Да** — план зафиксирован.' : '✗ **Нет** — план не зафиксирован.',
  ];
  if (lockEvents.length) {
    lines.push('', '### Последние события');
    for (const e of lockEvents) {
      const date = e.at ? new Date(e.at).toLocaleString('ru-RU') : '';
      const who = e.who || e.user || 'unknown';
      lines.push(`- ${date} · ${e.label || e.type} · ${who}`);
    }
  }
  return {
    text: lines.join('\n'),
    cards: [{ title: 'Статус', value: isLocked ? 'Зафиксирован' : 'Открыт', hint: '' }],
    actions: [{ type: 'navigate', label: '→ Открыть Гант', payload: { section: 'gantt' }, primary: true }],
    drilldown: [],
    responseSource: 'rule',
    _meta: { kind: 'gantt_planlock', isLocked },
  };
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _pluralEnd(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'ов';
  if (b === 1) return '';
  if (b > 1 && b < 5) return 'а';
  return 'ов';
}
