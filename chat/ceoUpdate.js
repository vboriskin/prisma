'use strict';
/* ============================================================
   chat/ceoUpdate.js — V22+ Phase 4 (K-K1)

   Cross-source executive summary. Один запрос → 3 источника +
   Гант + Чёрный объединены в один читаемый отчёт «для CEO».

     · «Подготовь CEO-update по 1.21»
     · «Сводка для CEO»
     · «Executive summary за квартал»
     · «Прогресс по 1.21»

   Содержит:
     1. Headline (1 строка statement)
     2. Release Health (per-release completion %, transfers, overtime)
     3. Sigma Coverage (если Чёрный загружен)
     4. Top Blockers (merged Registry + Scanner)
     5. Team Distribution (загрузка по командам)
     6. Risks (новые риски, scope changes)

   Public API:
     buildCEOUpdate(target, opts?) → structured response

   Контракты:
     · НЕ зовёт LLM (rule-based) — для скорости и predictability.
     · Использует существующие builders/data:
       state.rows / actionLog (Registry/Gantt)
       Services.TeamScanner2.getModel() (Scanner)
       Services.BlackDashboard._model (Sigma)
     · Если target.release задан → фокус на этом релизе.
       Иначе → multi-release overview.
   ============================================================ */

import { state } from '../state.js';
import { Services } from '../app/services.js';
import { linkTo } from './linkTo.js';

const RELEASE_FLAGS = { '1.20': 'hasRelease120', '1.21': 'hasRelease121', '1.22': 'hasRelease122' };
const RELEASE_COLS  = { '1.20': 'r120',         '1.21': 'r121',         '1.22': 'r122' };

/* ─────────────────────────────────────────────────────────────
   Main builder
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} target — resolveTarget output (опц. release/team)
 * @param {object} opts — { releaseId?: string, includeNarrative?: bool }
 * @returns {object} structured
 */
export function buildCEOUpdate(target, opts = {}) {
  const releaseId = opts.releaseId || target?.release?.id || null;
  const team = target?.team?.name || null;

  const sections = [];
  const cards = [];
  const actions = [];

  // 1. Release health (Gantt-side)
  const releaseHealth = _computeReleaseHealth(releaseId, team);
  if (releaseHealth.scoped > 0) {
    sections.push(_renderReleaseHealthSection(releaseHealth));
    cards.push({ title: 'Готовность', value: `${releaseHealth.donePct}%`, hint: `${releaseHealth.done}/${releaseHealth.scoped} эпиков` });
    cards.push({ title: 'Переносы',   value: String(releaseHealth.transfers), hint: 'за период' });
    cards.push({ title: 'Овертайм',   value: String(releaseHealth.overtime),  hint: 'эпиков' });
  }

  // 2. Sigma coverage
  const sigmaCov = _computeSigmaCoverage();
  if (sigmaCov.totalGoals > 0) {
    sections.push(_renderSigmaSection(sigmaCov));
    cards.push({ title: 'Sigma cover', value: `${sigmaCov.coveragePct}%`, hint: `${sigmaCov.linked}/${sigmaCov.totalGoals} целей` });
  }

  // 3. Top blockers (merged)
  const blockers = _computeMergedBlockers(team);
  if (blockers.total > 0) {
    sections.push(_renderBlockersSection(blockers));
    cards.push({ title: 'Блокеры', value: String(blockers.total), hint: `${blockers.registry} Registry + ${blockers.scanner} Scanner` });
  }

  // 4. Team distribution (load)
  const teamDistribution = _computeTeamDistribution(releaseId);
  if (teamDistribution.teamCount > 1) {
    sections.push(_renderTeamDistributionSection(teamDistribution));
  }

  // 5. Risk signals
  const risks = _computeRiskSignals(releaseId, team);
  if (risks.length) {
    sections.push(_renderRisksSection(risks));
  }

  // Headline
  const headline = _buildHeadline(releaseHealth, sigmaCov, blockers, risks, releaseId, team);

  // Actions: cross-tab deep-links
  if (releaseId) {
    actions.push(linkTo({ kind: 'release', id: releaseId }, { primary: true, label: `→ Гант: ${releaseId}` }));
  } else {
    actions.push({ type: 'navigate', label: '→ Гант', payload: { section: 'gantt' }, primary: true });
  }
  if (sigmaCov.totalGoals > 0) {
    actions.push({ type: 'navigate', label: '→ Чёрный дашборд', payload: { section: 'black-dashboard' } });
  }
  if (blockers.total > 0) {
    actions.push({ type: 'apply_filter', label: `→ Реестр: блокеры (${blockers.total})`,
      payload: team ? { team, onlyBlocking: true } : { onlyBlocking: true } });
  }

  const drilldown = [
    releaseId ? null : { text: 'Сводка по 1.21', prompt: 'CEO update по 1.21' },
    blockers.total > 0 ? { text: 'Разбор блокеров', prompt: 'почему столько блокеров' } : null,
    risks.length ? { text: 'Откуда риски?', prompt: 'почему 1.21 отстаёт' } : null,
    { text: 'Топ команд по переносам', prompt: 'топ команд по переносам' },
    teamDistribution.teamCount > 1 ? { text: 'Кто перегружен', prompt: 'кто перегружен' } : null,
  ].filter(Boolean);

  const text = [
    `## CEO Update${releaseId ? ` · ${releaseId}` : ''}${team ? ` · ${team}` : ''}`,
    '',
    `> ${headline}`,
    '',
    ...sections,
  ].filter(Boolean).join('\n');

  return {
    text,
    cards: cards.slice(0, 6),
    actions,
    drilldown,
    responseSource: 'rule',
    _meta: {
      kind: 'ceo_update',
      release: releaseId,
      team,
      donePct: releaseHealth.donePct,
      coveragePct: sigmaCov.coveragePct,
      blockerCount: blockers.total,
      riskCount: risks.length,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
   Section builders
   ───────────────────────────────────────────────────────────── */

function _computeReleaseHealth(releaseId, team) {
  const rows = state.rows || [];
  let scoped = team ? rows.filter(r => String(r.team || '') === String(team)) : rows;

  if (releaseId) {
    const flag = RELEASE_FLAGS[releaseId];
    if (flag) scoped = scoped.filter(r => r[flag]);
  }

  const done = scoped.filter(r => r.isDone).length;
  const total = scoped.length;
  const inProgress = scoped.filter(r => !r.isDone && r.inProgress).length;
  const overtime = scoped.filter(r => r.hasOvertime).length;
  const donePct = total ? Math.round(done / total * 100) : 0;

  // Transfers — для конкретного releaseId или suma по всем.
  const col = releaseId ? RELEASE_COLS[releaseId] : null;
  let transfers = 0;
  for (const r of scoped) {
    const arrows = r.ganttArrows || [];
    if (col) transfers += arrows.filter(a => a.srcCol === col || a.dstCol === col).length;
    else transfers += arrows.length;
  }

  return { releaseId, team, scoped: total, done, inProgress, overtime, donePct, transfers };
}

function _renderReleaseHealthSection(rh) {
  const lines = ['### Health'];
  const releaseTag = rh.releaseId ? `**${rh.releaseId}**` : 'Все релизы';
  lines.push(`${releaseTag}: **${rh.donePct}% завершено** (${rh.done} из ${rh.scoped} эпиков).`);
  if (rh.inProgress) lines.push(`В работе: ${rh.inProgress}`);
  if (rh.transfers) lines.push(`Переносов: ${rh.transfers}`);
  if (rh.overtime)  lines.push(`В овертайме: ${rh.overtime}`);
  return lines.join('\n') + '\n';
}

function _computeSigmaCoverage() {
  const model = (Services.BlackDashboard?._model) || null;
  if (!model || !model.summary) return { totalGoals: 0, linked: 0, coveragePct: 0 };
  return {
    totalGoals:  model.summary.totalGoals || 0,
    linked:      model.summary.linkedCount || 0,
    coveragePct: model.summary.coveragePct || 0,
    worstTeams:  (model.coverageByTeam || [])
      .filter(t => (t.pct ?? 100) < 100)
      .sort((a, b) => (a.pct || 0) - (b.pct || 0))
      .slice(0, 3),
  };
}

function _renderSigmaSection(s) {
  const lines = ['### Sigma'];
  lines.push(`**${s.coveragePct}% покрытия** (${s.linked} из ${s.totalGoals} целей привязано к задачам).`);
  if (s.worstTeams?.length) {
    const worst = s.worstTeams.map(t => `${t.name || t.pk} (${t.pct}%)`).join(', ');
    lines.push(`Команды с пробелами: ${worst}.`);
  }
  return lines.join('\n') + '\n';
}

function _computeMergedBlockers(team) {
  const rows = state.rows || [];
  const teamFilter = team ? String(team).toLowerCase() : null;
  const registry = rows
    .filter(r => r.blockingDependency && !r.isDone)
    .filter(r => !teamFilter || String(r.team || '').toLowerCase() === teamFilter);

  const scanner = [];
  try {
    const model = Services.TeamScanner2?.getModel?.();
    if (model?.participants) {
      for (const p of model.participants) {
        if (p.deactivated) continue;
        if (teamFilter && !(p.projects || []).some(pk => String(pk).toLowerCase().includes(teamFilter))) continue;
        for (const b of (p.blockers || [])) {
          scanner.push({ ...b, owner: p.label || p.email });
        }
      }
    }
  } catch (_) {}

  return {
    registry: registry.length,
    scanner: scanner.length,
    total: registry.length + scanner.length,
    topRegistry: registry.slice(0, 5),
    topScanner: scanner.slice(0, 5),
  };
}

function _renderBlockersSection(b) {
  const lines = ['### Блокеры'];
  lines.push(`Всего активных: **${b.total}** (Registry: ${b.registry}, Scanner: ${b.scanner}).`);
  if (b.topRegistry.length) {
    lines.push('**Из Реестра:**');
    for (const r of b.topRegistry.slice(0, 3)) {
      lines.push(`- ${r.epic || r.tasks || '(без названия)'} _(${r.team || '—'})_`);
    }
  }
  if (b.topScanner.length) {
    lines.push('**Из Сканнера (по Jira-ссылкам):**');
    for (const s of b.topScanner.slice(0, 3)) {
      lines.push(`- \`${s.issueKey}\` ⇠ \`${s.blockerKey}\`${s.dwellHours ? ` (${s.dwellHours}ч)` : ''}${s.owner ? ` · ${s.owner}` : ''}`);
    }
  }
  return lines.join('\n') + '\n';
}

function _computeTeamDistribution(releaseId) {
  const rows = state.rows || [];
  let scoped = rows;
  if (releaseId) {
    const flag = RELEASE_FLAGS[releaseId];
    if (flag) scoped = rows.filter(r => r[flag]);
  }
  const byTeam = {};
  for (const r of scoped) {
    if (r.isDone) continue;
    const t = r.team || '—';
    byTeam[t] = (byTeam[t] || 0) + 1;
  }
  const sorted = Object.entries(byTeam).sort((a, b) => b[1] - a[1]);
  return {
    teamCount: sorted.length,
    top: sorted.slice(0, 5),
    total: sorted.reduce((s, [, n]) => s + n, 0),
  };
}

function _renderTeamDistributionSection(td) {
  const lines = ['### Загрузка по командам'];
  for (const [team, n] of td.top) {
    lines.push(`- **${team}**: ${n} активных эпика`);
  }
  return lines.join('\n') + '\n';
}

function _computeRiskSignals(releaseId, team) {
  const rows = state.rows || [];
  const risks = [];
  const teamFilter = team ? String(team).toLowerCase() : null;

  // Risk 1: эпики без assignee в активном релизе
  const flag = releaseId ? RELEASE_FLAGS[releaseId] : null;
  const inRelease = flag ? rows.filter(r => r[flag] && !r.isDone) : rows.filter(r => !r.isDone);
  const noAssignee = inRelease
    .filter(r => !r.assignee || !String(r.assignee).trim())
    .filter(r => !teamFilter || String(r.team || '').toLowerCase() === teamFilter);
  if (noAssignee.length >= 3) {
    risks.push({ title: `${noAssignee.length} эпиков без исполнителя`, severity: 'high' });
  }

  // Risk 2: scope=«Требует подтверждения»
  const scopeUnclear = inRelease
    .filter(r => /требует/i.test(String(r.scope || '')))
    .filter(r => !teamFilter || String(r.team || '').toLowerCase() === teamFilter);
  if (scopeUnclear.length >= 2) {
    risks.push({ title: `${scopeUnclear.length} эпиков с scope «Требует подтверждения»`, severity: 'medium' });
  }

  // Risk 3: riskFlags из RiskEngine
  const flagged = inRelease
    .filter(r => Array.isArray(r.riskFlags) && r.riskFlags.length)
    .filter(r => !teamFilter || String(r.team || '').toLowerCase() === teamFilter);
  if (flagged.length) {
    risks.push({ title: `${flagged.length} эпиков с risk-flags`, severity: 'medium' });
  }

  return risks;
}

function _renderRisksSection(risks) {
  const lines = ['### Риски'];
  for (const r of risks) {
    const ico = r.severity === 'high' ? '🔴' : '🟡';
    lines.push(`- ${ico} ${r.title}`);
  }
  return lines.join('\n') + '\n';
}

/* ─────────────────────────────────────────────────────────────
   Headline
   ───────────────────────────────────────────────────────────── */

function _buildHeadline(rh, sigma, blockers, risks, releaseId, team) {
  const parts = [];
  const subj = releaseId ? `${releaseId}` : (team ? `команда ${team}` : 'Портфель');

  // Statement о done %
  if (rh.scoped > 0) {
    parts.push(`${subj}: **${rh.donePct}% эпиков закрыто**`);
  }
  // Sigma
  if (sigma.totalGoals > 0) {
    if (sigma.coveragePct >= 80) parts.push(`Sigma coverage ${sigma.coveragePct}% (норма)`);
    else parts.push(`**Sigma coverage всего ${sigma.coveragePct}%**`);
  }
  // Blockers
  if (blockers.total > 5) {
    parts.push(`${blockers.total} блокеров требуют внимания`);
  } else if (blockers.total > 0) {
    parts.push(`${blockers.total} блокеров`);
  }
  // Risks
  if (risks.length) {
    parts.push(`${risks.length} risk-сигнала`);
  }

  return parts.join(' · ') || 'Недостаточно данных для headline — запустите Сканнер и Чёрный.';
}
