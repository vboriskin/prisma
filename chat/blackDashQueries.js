'use strict';
/* ============================================================
   chat/blackDashQueries.js — V22+ Week 3 (B-D1..B-D3, B-D6..B-D10)

   Queries по Чёрному дашборду (Sigma-цели coverage).

   Главные use-cases:
     · «Какие команды не привязали 100% задач?» (B-D1)
     · «Какие цели не покрыты задачами?»        (B-D2)
     · «Прогресс по GOAL-1»                      (B-D3)

   Data: Services.BlackDashboard.getModel() → analyseBlackDashboard
   shape: { goals[], teamIssues[], coverageByTeam[], summary, ... }

   Контракты:
     · Soft-fallback при !hasModel → CTA «Обновить Чёрный»
     · Sigma config check — если sigmaJiraBaseUrl пустой → fallback
     · Identity check для per-employee coverage (B-D12)
   ============================================================ */

import { state } from '../state.js';
import { Services } from '../app/services.js';
import { linkTo } from './linkTo.js';
import { loadSettings as _loadIntegrationsSettings } from '../integrations/integrationsStore.js';

/* ─────────────────────────────────────────────────────────────
   Main router
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} target — resolveTarget output. Может содержать:
 *   · target.epic.id с GOAL-NNN pattern → per-goal status
 *   · target.team               → team coverage
 *   · target.employee           → per-employee Sigma-contribution (B-D12)
 *   · ничего                    → overall coverage report
 * @param {object} opts — { intent?: 'coverage'|'unmapped'|'goal'|'team' }
 * @returns {object} structured
 */
export function buildBlackDashQueryResponse(target, opts = {}) {
  // Config check (B-D8)
  if (!_isSigmaConfigured()) {
    return _fallbackNotConfigured();
  }

  const model = _getModel();
  if (!model) return _fallbackNoModel();

  // Per-goal query (B-D3)
  const goalId = _detectGoalId(target);
  if (goalId) {
    return _buildPerGoalResponse(goalId, model, target);
  }

  // Per-employee Sigma contribution (B-D12)
  if (target?.employee) {
    return _buildPerEmployeeResponse(target.employee, model, target);
  }

  // Detect intent from text
  const text = String(target?.raw?.text || target?.raw?.lc || '').toLowerCase();
  if (/(?:не\s+привязан|без\s+цел|без\s+goal|без\s+sigma)/.test(text)
   || /(?:не\s+покрыт)/.test(text)
   || /(?:привязан\w*\s+\d+%|100%\s+задач)/.test(text)) {
    // B-D1 + B-D2 — combined report
    return _buildUnmappedReport(model, target);
  }

  // Default — overall coverage (B-D1)
  return _buildCoverageReport(model, target);
}

/* ─────────────────────────────────────────────────────────────
   B-D1: Overall coverage report
   ───────────────────────────────────────────────────────────── */

function _buildCoverageReport(model, target) {
  const total = model.summary?.totalGoals || (model.goals?.length || 0);
  const linked = model.summary?.linkedCount || 0;
  const unlinked = model.summary?.unlinkedCount || (total - linked);
  const coverage = model.summary?.coveragePct ?? (total ? Math.round(linked / total * 100) : 0);

  const lines = [
    '## Coverage Sigma-целей',
    `**Всего целей:** ${total} · **Привязано:** ${linked} · **Без задач:** ${unlinked} · **Покрытие:** ${coverage}%`,
    '',
  ];

  // Per-team coverage
  if (Array.isArray(model.coverageByTeam) && model.coverageByTeam.length) {
    lines.push('### По командам');
    const sorted = [...model.coverageByTeam].sort((a, b) => (a.pct || 0) - (b.pct || 0));
    for (const t of sorted.slice(0, 10)) {
      const pct = t.pct != null ? `${t.pct}%` : '—';
      const flag = (t.pct ?? 0) < 100 ? ' ⚠' : '';
      lines.push(`- **${t.name || t.pk}**: ${pct}${flag}`);
    }
  }

  const worst3 = (model.coverageByTeam || [])
    .filter(t => (t.pct ?? 100) < 100)
    .sort((a, b) => (a.pct || 0) - (b.pct || 0))
    .slice(0, 3);

  const cards = [
    { title: 'Целей',     value: String(total),    hint: 'всего' },
    { title: 'Привязано', value: String(linked),   hint: 'к задачам' },
    { title: 'Без задач', value: String(unlinked), hint: 'требуют внимания' },
    { title: 'Покрытие',  value: `${coverage}%`,   hint: 'к-во привязок' },
  ];

  const actions = [
    { type: 'navigate', label: '→ Чёрный дашборд', payload: { section: 'black-dashboard' }, primary: true },
  ];

  const drilldown = [
    unlinked > 0 && { text: 'Цели без задач', prompt: 'какие цели не покрыты задачами' },
    worst3.length && { text: `Худшие команды: ${worst3.map(t => t.name || t.pk).join(', ')}`, prompt: `команды с низким coverage` },
    { text: 'Список всех целей', prompt: 'покажи все sigma-цели' },
  ].filter(Boolean);

  return {
    text: lines.join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: { kind: 'bd_coverage', total, linked, unlinked, coverage },
  };
}

/* ─────────────────────────────────────────────────────────────
   B-D2: Unmapped goals report
   ───────────────────────────────────────────────────────────── */

function _buildUnmappedReport(model, target) {
  const goals = model.goals || [];
  const unmapped = goals.filter(g => !g.linkedIssues || g.linkedIssues.length === 0);

  const lines = [
    '## Цели без привязки к задачам',
    `**Найдено:** ${unmapped.length} из ${goals.length}`,
    '',
  ];

  if (!unmapped.length) {
    lines.push('_Все цели покрыты как минимум одной задачей._');
  } else {
    lines.push('### Список');
    for (const g of unmapped.slice(0, 20)) {
      const k = g.key || '?';
      const s = (g.summary || '').slice(0, 70);
      const owner = g.owner || g.team || '';
      lines.push(`- \`${k}\` ${s}${owner ? ` _(${owner})_` : ''}`);
    }
    if (unmapped.length > 20) {
      lines.push(`_…и ещё ${unmapped.length - 20}_`);
    }
  }

  // Worst teams (B-D1 inline)
  const worstTeams = (model.coverageByTeam || [])
    .filter(t => (t.pct ?? 100) < 100)
    .sort((a, b) => (a.pct || 0) - (b.pct || 0))
    .slice(0, 5);
  if (worstTeams.length) {
    lines.push('', '### Команды с неполным coverage');
    for (const t of worstTeams) {
      lines.push(`- **${t.name || t.pk}**: ${t.pct}%`);
    }
  }

  const cards = [
    { title: 'Без задач',  value: String(unmapped.length), hint: 'требует внимания' },
    { title: 'Всего',      value: String(goals.length),    hint: 'целей' },
    { title: 'Команд',     value: String(worstTeams.length), hint: 'с неполным coverage' },
  ];

  const actions = [
    { type: 'navigate', label: '→ Чёрный дашборд', payload: { section: 'black-dashboard' }, primary: true },
  ];

  const drilldown = [
    { text: 'Coverage по командам',  prompt: 'покрытие sigma по командам' },
    { text: 'Подробно по конкретной цели', prompt: `прогресс по GOAL-1` },
  ];

  return {
    text: lines.join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: { kind: 'bd_unmapped', unmappedCount: unmapped.length, totalGoals: goals.length },
  };
}

/* ─────────────────────────────────────────────────────────────
   B-D3: Per-goal status
   ───────────────────────────────────────────────────────────── */

function _buildPerGoalResponse(goalId, model, target) {
  const goal = (model.goals || []).find(g => g.key === goalId);
  if (!goal) {
    return {
      text: `Цель \`${goalId}\` не найдена в Чёрном дашборде.`,
      cards: [], actions: [
        { type: 'navigate', label: '→ Открыть Чёрный', payload: { section: 'black-dashboard' } },
      ],
      drilldown: [], responseSource: 'rule',
    };
  }

  const linkedIssues = goal.linkedIssues || [];
  const closed = linkedIssues.filter(i => /done|закрыт|complete|closed/i.test(i.status || i.statusCat || '')).length;
  const inProgress = linkedIssues.filter(i => /progress|работ/i.test(i.status || '')).length;
  const todo = linkedIssues.length - closed - inProgress;
  const donePct = linkedIssues.length ? Math.round(closed / linkedIssues.length * 100) : 0;

  const lines = [
    `## ${goal.key}: ${goal.summary || ''}`,
    `**Статус:** ${goal.status || '—'} · **Готово:** ${donePct}%`,
    `**Привязано задач:** ${linkedIssues.length} (закрыто ${closed} · в работе ${inProgress} · в очереди ${todo})`,
    '',
  ];

  if (linkedIssues.length) {
    lines.push('### Задачи');
    for (const i of linkedIssues.slice(0, 12)) {
      const k = i.key || '?';
      const s = (i.summary || '').slice(0, 60);
      const status = i.status || '';
      const project = i.pk || i.projectName || '';
      lines.push(`- \`${k}\` ${s}${status ? ` _(${status})_` : ''}${project ? ` · ${project}` : ''}`);
    }
    if (linkedIssues.length > 12) {
      lines.push(`_…и ещё ${linkedIssues.length - 12}_`);
    }
  } else {
    lines.push('_Цель не имеет привязанных задач._');
  }

  const cards = [
    { title: 'Задач',  value: String(linkedIssues.length), hint: 'привязано' },
    { title: 'Готово', value: `${donePct}%`,               hint: `${closed} закрыто` },
    { title: 'В работе', value: String(inProgress),        hint: 'in progress' },
    { title: 'В очереди', value: String(todo),             hint: 'todo' },
  ];

  const actions = [
    linkTo({ kind: 'goal', id: goal.key }, { primary: true, label: `→ Чёрный: ${goal.key}` }),
  ];
  // Open in Sigma (external)
  const sigmaUrl = _sigmaUrlFor(goal.key);
  if (sigmaUrl) {
    actions.push({ type: 'open_url', label: `↗ ${goal.key} в Sigma`, payload: { url: sigmaUrl } });
  }

  // Cross-context: эти задачи в Реестре
  if (linkedIssues.length) {
    actions.push({
      type: 'apply_filter',
      label: `→ Реестр: эти задачи (${linkedIssues.length})`,
      payload: { jiraKeys: linkedIssues.map(i => i.key) },
    });
  }

  const drilldown = [
    { text: 'Какие задачи в работе', prompt: `${goal.key} что в работе` },
    { text: 'Что не закрыто',         prompt: `${goal.key} что не закрыто` },
    { text: 'Coverage по командам',   prompt: 'sigma coverage по командам' },
  ];

  return {
    text: lines.join('\n'),
    cards, actions, drilldown,
    responseSource: 'rule',
    _meta: { kind: 'bd_per_goal', goalId, linkedCount: linkedIssues.length, donePct },
  };
}

/* ─────────────────────────────────────────────────────────────
   B-D12: Per-employee Sigma-contribution
   ───────────────────────────────────────────────────────────── */

function _buildPerEmployeeResponse(employee, model, target) {
  const empLabel = employee.label || employee.id;
  const goals = model.goals || [];
  const empContribs = [];

  // Сопоставляем — какие задачи (linkedIssues across goals) assigned to this employee
  const empEmail = String(employee.email || employee.id || '').toLowerCase();
  const empFio   = String(employee.label || '').trim();

  for (const goal of goals) {
    const myIssues = (goal.linkedIssues || []).filter(i => {
      // Linked Issues обычно содержат assignee = ФИО или email
      const a = String(i.assignee || '').toLowerCase();
      if (empEmail && a === empEmail) return true;
      if (empFio && i.assignee === empFio) return true;
      return false;
    });
    if (myIssues.length) {
      empContribs.push({ goal, myIssues });
    }
  }

  const lines = [
    `## Вклад в Sigma-цели: ${empLabel}`,
    `**Целей с задачами:** ${empContribs.length} из ${goals.length}`,
    '',
  ];

  if (!empContribs.length) {
    lines.push('_Нет задач этого сотрудника, привязанных к Sigma-целям._');
  } else {
    for (const { goal, myIssues } of empContribs.slice(0, 10)) {
      lines.push(`### ${goal.key}: ${(goal.summary || '').slice(0, 60)}`);
      lines.push(`Задач: ${myIssues.length}`);
      for (const i of myIssues.slice(0, 5)) {
        lines.push(`- \`${i.key}\` ${(i.summary || '').slice(0, 50)}`);
      }
    }
  }

  const cards = [
    { title: 'Целей', value: String(empContribs.length), hint: 'с вкладом' },
    { title: 'Задач', value: String(empContribs.reduce((s, c) => s + c.myIssues.length, 0)), hint: 'привязано к Sigma' },
  ];

  const actions = [
    linkTo({ kind: 'employee', id: employee.id, label: empLabel }, { primary: true }),
    { type: 'navigate', label: '→ Чёрный дашборд', payload: { section: 'black-dashboard' } },
  ];

  return {
    text: lines.join('\n'),
    cards, actions, drilldown: [],
    responseSource: 'rule',
    _meta: { kind: 'bd_per_employee', employee: employee.id, goalsCount: empContribs.length },
  };
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _getModel() {
  try { return Services.BlackDashboard?._model || null; }
  catch (_) { return null; }
}

// V22+ Phase 5.2 fix — dual-read: state.integrations.sigma (test-mocks)
// OR integrationsStore (production source-of-truth).
function _isSigmaConfigured() {
  try {
    const testCfg = state?.integrations?.sigma;
    if (testCfg) {
      return !!(testCfg.baseUrl || testCfg.sigmaJiraBaseUrl || testCfg.hasToken);
    }
    const cfg = _loadIntegrationsSettings() || {};
    return !!(cfg.sigmaJiraBaseUrl && cfg.hasSigmaJiraToken);
  } catch (_) { return false; }
}

function _sigmaUrlFor(goalKey) {
  try {
    if (!goalKey) return null;
    const testCfg = state?.integrations?.sigma;
    let base = '';
    if (testCfg) {
      base = testCfg.baseUrl || testCfg.sigmaJiraBaseUrl || '';
    }
    if (!base) {
      const cfg = _loadIntegrationsSettings() || {};
      base = cfg.sigmaJiraBaseUrl || '';
    }
    if (!base) return null;
    return `${String(base).replace(/\/$/, '')}/browse/${encodeURIComponent(goalKey)}`;
  } catch (_) { return null; }
}

function _detectGoalId(target) {
  // Pattern GOAL-NNN, KPI-NNN, SIGMA-NNN
  const text = String(target?.raw?.text || '');
  const m = text.match(/\b(GOAL|KPI|SIGMA|GOAT)-(\d+)\b/i);
  if (m) return `${m[1].toUpperCase()}-${m[2]}`;
  // Если в target.epic есть GOAL-pattern — оно
  if (target?.epic?.id && /^(GOAL|KPI|SIGMA)-\d+$/i.test(target.epic.id)) {
    return target.epic.id.toUpperCase();
  }
  return null;
}

function _fallbackNotConfigured() {
  return {
    text: 'Sigma Jira не настроена. Откройте «Настройки → Интеграции → Sigma» и укажите baseUrl + токен.',
    cards: [],
    actions: [{ type: 'open_settings', label: '🔧 Настроить Sigma', payload: { tab: 'integrations' }, primary: true }],
    drilldown: [],
    responseSource: 'rule',
  };
}

function _fallbackNoModel() {
  return {
    text: 'Чёрный дашборд ещё не загружался. Откройте вкладку «Чёрный» и нажмите «↻ Обновить».',
    cards: [],
    actions: [{ type: 'navigate', label: '→ Открыть Чёрный', payload: { section: 'black-dashboard' }, primary: true }],
    drilldown: [],
    responseSource: 'rule',
  };
}
