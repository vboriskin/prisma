'use strict';
/* ============================================================
   AI CEO FALLBACK ENGINE — v10_0
   Rule-based analytics for the AI CEO tab.
   Works 100% without LLM. All functions receive pre-computed
   metrics and return plain data objects — no DOM, no state mutation.
   ============================================================ */

import { state }                        from '../state.js';
import { computeProgress, computeLoad } from '../metricsEngine.js';
import { computeHealthScore }           from '../chat/chatAlerts.js';

/* ── tiny helpers ─────────────────────────────────────────── */
const pct  = (n, d) => d ? Math.round(n / d * 100) : 0;
const cap  = (s, n) => String(s || '').slice(0, n);

/* ─────────────────────────────────────────────────────────── */
/* SHARED METRICS                                              */
/* ─────────────────────────────────────────────────────────── */
export function computeCeoMetrics(rows) {
  if (!rows || !rows.length) return null;

  const total       = rows.length;
  const done        = rows.filter(r => r.isDone).length;
  const active      = total - done;
  const blockers    = rows.filter(r => r.blockingDependency && !r.isDone);
  const risky       = rows.filter(r => (r.riskFlags||[]).length && !r.isDone);
  const noRelease   = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone);
  const unconfirmed = rows.filter(r => r.scopeStatus === 'Требует подтверждения' && !r.isDone);
  const noAssignee  = rows.filter(r => !r.assignee && !r.isDone);
  const overtime    = rows.filter(r => r.hasOvertime && !r.isDone);
  const inRelease   = rows.filter(r => (r.hasRelease120||r.hasRelease121||r.hasRelease122) && !r.isDone);
  const blockingNear= blockers.filter(r => r.hasRelease120 || r.hasRelease121);

  const progress = computeProgress(rows);
  const load     = computeLoad(rows);
  const health   = computeHealthScore(rows);

  // Team map
  const teams = {};
  rows.forEach(r => {
    const t = r.team || '—';
    if (!teams[t]) teams[t] = { total:0, done:0, active:0, blockers:0, risky:0, noRelease:0, noAssignee:0 };
    teams[t].total++;
    if (r.isDone) { teams[t].done++; } else {
      teams[t].active++;
      if (r.blockingDependency)        teams[t].blockers++;
      if ((r.riskFlags||[]).length)    teams[t].risky++;
      if (r.isUnassigned && r.scopeStatus==='Да') teams[t].noRelease++;
      if (!r.assignee)                 teams[t].noAssignee++;
    }
  });

  // Assignee load — top overloaded
  const loadArr = Object.entries(load)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);
  const maxLoad = loadArr[0]?.total || 1;
  const overloaded = loadArr.filter(a => a.total >= 5).slice(0, 5);

  // Critical release — nearest with most problems
  const releaseProblems = {
    '120': { key:'120', label:'1.20', progress: progress['120'] || {total:0,done:0,pct:0},
      blockers: blockers.filter(r=>r.hasRelease120).length,
      unconfirmed: unconfirmed.filter(r=>r.hasRelease120).length },
    '121': { key:'121', label:'1.21', progress: progress['121'] || {total:0,done:0,pct:0},
      blockers: blockers.filter(r=>r.hasRelease121).length,
      unconfirmed: unconfirmed.filter(r=>r.hasRelease121).length },
    '122': { key:'122', label:'1.22', progress: progress['122'] || {total:0,done:0,pct:0},
      blockers: blockers.filter(r=>r.hasRelease122).length,
      unconfirmed: unconfirmed.filter(r=>r.hasRelease122).length },
  };
  const worstRelease = Object.values(releaseProblems)
    .filter(r => r.progress.total > 0)
    .sort((a,b) => (b.blockers*15 + b.unconfirmed*5 + (100-b.progress.pct)) -
                   (a.blockers*15 + a.unconfirmed*5 + (100-a.progress.pct)))[0] || null;

  return {
    total, done, active, donePct: pct(done, total),
    blockers, risky, noRelease, unconfirmed, noAssignee, overtime, inRelease, blockingNear,
    progress, load, loadArr, maxLoad, overloaded, health,
    teams, releaseProblems, worstRelease,
    topBlockers: [...blockers].sort((a,b)=>(b.riskScore||0)-(a.riskScore||0)).slice(0,10),
    topRisky:    [...risky].sort((a,b)=>(b.riskScore||0)-(a.riskScore||0)).slice(0,8),
  };
}

/* ─────────────────────────────────────────────────────────── */
/* SECTION 1: PROJECT HEALTH BRAIN                            */
/* ─────────────────────────────────────────────────────────── */
export function computeCeoHealth(m) {
  const score  = m.health;
  const status = score >= 80 ? 'ok' : score >= 55 ? 'risk' : 'critical';

  // V17.1 K1 — англицизмы PROJECT OK / AT RISK / CRITICAL → русский.
  const label = { ok:'ПРОЕКТ В НОРМЕ', risk:'ПРОЕКТ ПОД РИСКОМ', critical:'ПРОЕКТ В КРИТИЧЕСКОМ СОСТОЯНИИ' }[status];
  const color = { ok:'green', risk:'orange', critical:'red' }[status];

  // Top 3 root causes
  const causes = [
    m.blockingNear.length >= 1 && {
      text: `${m.blockingNear.length} блокер${m.blockingNear.length===1?'':'а/ов'} в ближайших релизах`,
      severity: 'critical',
      filter: { onlyBlocking:true },
    },
    m.blockers.length > 0 && m.blockingNear.length === 0 && {
      text: `${m.blockers.length} активных блокеров`,
      severity: 'warning',
      filter: { onlyBlocking:true },
    },
    m.noRelease.length >= 3 && {
      text: `${m.noRelease.length} задач в scope без релиза`,
      severity: 'warning',
      filter: { isUnassigned:true },
    },
    m.unconfirmed.length >= 2 && {
      text: `${m.unconfirmed.length} задач без подтверждения scope`,
      severity: 'warning',
      filter: { scope:'Требует подтверждения' },
    },
    m.overloaded.length >= 1 && {
      text: `Перегруз: ${m.overloaded.slice(0,2).map(a=>cap(a.name,20)).join(', ')}`,
      severity: 'info',
      filter: null,
    },
    m.noAssignee.length >= 5 && {
      text: `${m.noAssignee.length} задач без исполнителя`,
      severity: 'info',
      filter: {},
    },
  ].filter(Boolean).slice(0, 3);

  const worstRel = m.worstRelease;
  const critRelText = worstRel
    ? `Ближайший проблемный релиз: ${worstRel.label} (${worstRel.progress.pct}% done, ${worstRel.blockers} блокеров)`
    : null;

  const summaryParts = [
    causes.slice(0,2).map(c=>c.text).join(', '),
  ].filter(Boolean);

  return {
    score, status, label, color, causes,
    summary: summaryParts.join('. ') || 'Данных недостаточно для анализа.',
    critRelText,
    donePct: m.donePct,
    worstRelease: worstRel,
    filterPayload: { onlyBlocking: true },
  };
}

/* ─────────────────────────────────────────────────────────── */
/* SECTION 2: IF NOTHING CHANGES                              */
/* ─────────────────────────────────────────────────────────── */
export function computeIfNothingChanges(m) {
  const consequences = [];

  // Calc projected risk growth
  const currentRisk = 100 - m.health;
  const growthRate  = (m.blockers.length * 3 + m.unconfirmed.length * 1.5 + m.noRelease.length) / Math.max(m.active, 1);
  const projectedRisk = Math.min(100, Math.round(currentRisk + growthRate * 14)); // 2-week projection
  const projectedDays = 14;

  if (m.blockingNear.length > 0) {
    consequences.push({
      severity: 'critical',
      text: `${m.blockingNear.length} блокер${m.blockingNear.length===1?'':'ов'} ближайших релизов — задачи не завершатся вовремя`,
      filter: { onlyBlocking: true },
    });
  }

  if (m.worstRelease && m.worstRelease.progress.pct < 60) {
    consequences.push({
      severity: 'critical',
      text: `Релиз ${m.worstRelease.label} завершён на ${m.worstRelease.progress.pct}% — риск срыва без активных действий`,
      filter: { release: m.worstRelease.key },
    });
  }

  if (m.noRelease.length >= 3) {
    consequences.push({
      severity: 'warning',
      text: `${m.noRelease.length} задач в scope "повиснут" — они не попадут ни в один релиз`,
      filter: { isUnassigned: true },
    });
  }

  if (m.unconfirmed.length >= 2) {
    consequences.push({
      severity: 'warning',
      text: `${m.unconfirmed.length} неподтверждённых задач войдут в релиз по умолчанию — scope станет непредсказуемым`,
      filter: { scope: 'Требует подтверждения' },
    });
  }

  if (m.overloaded.length >= 1) {
    const names = m.overloaded.slice(0,2).map(a=>cap(a.name,18)).join(', ');
    consequences.push({
      severity: 'warning',
      text: `Перегруз у ${names} — задачи будут выполняться медленнее или зависнут`,
      filter: null,
    });
  }

  if (m.noAssignee.length >= 5) {
    consequences.push({
      severity: 'info',
      text: `${m.noAssignee.length} задач без исполнителя — некому их взять в работу`,
      filter: {},
    });
  }

  if (consequences.length === 0) {
    consequences.push({
      severity: 'info',
      text: 'При текущем темпе план будет выполнен. Продолжайте мониторинг.',
      filter: null,
    });
  }

  // First-to-break tasks
  const firstToBreak = m.topBlockers.slice(0, 4).map(r => ({
    id: r.id,
    task: cap(r.tasks || r.epic || '—', 60),
    team: r.team || '—',
    release: [r.hasRelease120&&'1.20',r.hasRelease121&&'1.21',r.hasRelease122&&'1.22'].filter(Boolean).join('/') || '—',
    riskScore: r.riskScore || 0,
  }));

  // Releases that will worsen
  const affectedReleases = Object.values(m.releaseProblems)
    .filter(r => r.progress.total > 0 && (r.blockers > 0 || r.unconfirmed > 0))
    .sort((a,b) => b.blockers - a.blockers);

  return {
    currentRisk,
    projectedRisk,
    projectedDays,
    riskGrowth: projectedRisk - currentRisk,
    consequences,
    firstToBreak,
    affectedReleases,
    headline: consequences.length > 1
      ? `Если ничего не менять — риск вырастет с ${currentRisk}% до ${projectedRisk}% за ${projectedDays} дней`
      : 'Ситуация стабильная, но требует наблюдения',
  };
}

/* ─────────────────────────────────────────────────────────── */
/* SECTION 3: YOU'RE LYING TO YOURSELF                        */
/* ─────────────────────────────────────────────────────────── */
export function computeHardTruths(m) {
  const hardTruths = [];
  const suspicious = [];
  const weakSignals = [];

  // === Hard Truths ===

  // Capacity vs planned
  const activePeople = Object.keys(m.load).length;
  const planned = m.active;
  if (activePeople > 0 && planned > activePeople * 6) {
    hardTruths.push({
      icon: '⚠️',
      text: `Запланировано ${planned} задач, но capacity хватает примерно на ${activePeople * 6} — в ${Math.round(planned / (activePeople*6) * 10)/10}× больше чем можно реально взять`,
      filter: {},
    });
  }

  // Scope in release but unconfirmed
  const inRelUnconfirmed = m.unconfirmed.filter(r => r.hasRelease120||r.hasRelease121||r.hasRelease122);
  if (inRelUnconfirmed.length >= 2) {
    hardTruths.push({
      icon: '🤥',
      text: `${inRelUnconfirmed.length} задач в релизах со статусом "Требует подтверждения" — scope не подтверждён, но уже стоит в релизе`,
      filter: { scope:'Требует подтверждения' },
    });
  }

  // Blockers ignored
  if (m.blockers.length >= 3 && m.blockingNear.length === 0) {
    hardTruths.push({
      icon: '🚫',
      text: `${m.blockers.length} блокеров существуют, но ни один не помечен как критичный для ближайшего релиза — риски занижены`,
      filter: { onlyBlocking: true },
    });
  }

  if (m.blockingNear.length >= 2) {
    hardTruths.push({
      icon: '🔴',
      text: `${m.blockingNear.length} блокеров прямо в ближайших релизах — они не будут сданы без разблокировки`,
      filter: { onlyBlocking: true },
    });
  }

  // Worst release looks healthy on pct but has problems
  const wr = m.worstRelease;
  if (wr && wr.progress.pct >= 40 && (wr.blockers > 0 || wr.unconfirmed >= 3)) {
    hardTruths.push({
      icon: '🪞',
      text: `Релиз ${wr.label} выглядит нормальным (${wr.progress.pct}% done), но содержит ${wr.blockers} блокеров и ${wr.unconfirmed} неподтверждённых задач`,
      filter: { release: wr.key },
    });
  }

  // === Suspicious Areas ===

  // Teams with all tasks unassigned
  Object.entries(m.teams).forEach(([team, t]) => {
    if (team === '—') return;
    if (t.active > 3 && t.noAssignee / t.active > 0.5) {
      suspicious.push({
        icon: '👤',
        text: `Команда "${cap(team,25)}": ${t.noAssignee} из ${t.active} активных задач без исполнителя`,
        filter: { team },
      });
    }
  });

  // Overtime is growing
  if (m.overtime.length >= 5) {
    suspicious.push({
      icon: '⏰',
      text: `${m.overtime.length} задач уже в overtime — это означает, что основной план не реалистичен`,
      filter: { release: 'ot' },
    });
  }

  // No-release in-scope tasks pile
  if (m.noRelease.length >= 10) {
    suspicious.push({
      icon: '📦',
      text: `${m.noRelease.length} in-scope задач без релиза — скрытый scope, который нужно либо планировать, либо убирать`,
      filter: { isUnassigned: true },
    });
  }

  // Epic dependency loops or missing
  const depCount = Object.keys(state.epicDeps || {}).length;
  if (depCount === 0 && m.blockers.length > 0) {
    suspicious.push({
      icon: '🔗',
      text: `${m.blockers.length} блокеров, но зависимости эпиков не описаны — критический путь неизвестен`,
      filter: { onlyBlocking: true },
    });
  }

  // === Weak Signals ===

  // Low donePct on any release
  Object.values(m.releaseProblems).forEach(r => {
    if (r.progress.total >= 5 && r.progress.pct < 30) {
      weakSignals.push({
        icon: '📉',
        text: `Релиз ${r.label}: всего ${r.progress.pct}% done (${r.progress.done}/${r.progress.total}) — темп недостаточный`,
        filter: { release: r.key },
      });
    }
  });

  // No team assigned
  const noTeamCount = Object.values(m.teams)['—']?.active || 0;
  if (noTeamCount >= 3) {
    weakSignals.push({
      icon: '🏷',
      text: `${noTeamCount} активных задач без команды — ответственность размыта`,
      filter: {},
    });
  }

  // Risky tasks not in any release
  const riskyNoRelease = m.risky.filter(r => r.isUnassigned);
  if (riskyNoRelease.length >= 2) {
    weakSignals.push({
      icon: '⚡',
      text: `${riskyNoRelease.length} рискованных задач без назначенного релиза — их риск не контролируется`,
      filter: { onlyRisky: true },
    });
  }

  return {
    hardTruths: hardTruths.slice(0, 5),
    suspicious: suspicious.slice(0, 4),
    weakSignals: weakSignals.slice(0, 4),
    totalCount: hardTruths.length + suspicious.length + weakSignals.length,
  };
}

/* ─────────────────────────────────────────────────────────── */
/* SECTION 4: SAVE THE RELEASE                                */
/* ─────────────────────────────────────────────────────────── */
export function computeSaveTheRelease(m) {
  const wr     = m.worstRelease;
  const health = m.health;
  const riskBefore = 100 - health;

  // If everything's fine, scenarios are still informative
  const relLabel = wr?.label || 'ближайшего релиза';
  const relKey   = wr?.key || '121';

  // ── Conservative ────────────────────────────────────────────
  const conservativeChanges = [
    m.unconfirmed.filter(r => r[`hasRelease${relKey}`] || (!wr)).slice(0, 8).map(r => ({
      type: 'set_scope', label: 'Убрать из релиза (scope "Нет")',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Неподтверждённый scope — риск неготовности',
    })),
    m.noRelease.slice(0, 5).map(r => ({
      type: 'remove_from_scope', label: 'Снять из scope',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'In-scope без релиза — создаёт неопределённость',
    })),
  ].flat();

  const conservativeRiskAfter = Math.max(10, riskBefore - 15);
  const conservativeProb = { before: Math.max(10, 100 - riskBefore - 20), after: Math.min(90, 100 - conservativeRiskAfter) };

  // ── Balanced ─────────────────────────────────────────────────
  const balancedChanges = [
    m.topBlockers.slice(0, 6).map(r => ({
      type: 'assign_owner', label: 'Назначить ответственного за разблокировку',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Блокер без явного ответственного',
    })),
    m.noAssignee.filter(r => r[`hasRelease${relKey}`] || (!wr)).slice(0, 5).map(r => ({
      type: 'assign_assignee', label: 'Назначить исполнителя',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Задача в релизе без исполнителя',
    })),
    m.unconfirmed.filter(r => r[`hasRelease${relKey}`]).slice(0, 4).map(r => ({
      type: 'confirm_scope', label: 'Подтвердить scope',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Нужно подтвердить до начала работы',
    })),
  ].flat();

  const balancedRiskAfter = Math.max(8, riskBefore - 25);
  const balancedProb = { before: Math.max(10, 100 - riskBefore - 20), after: Math.min(92, 100 - balancedRiskAfter) };

  // ── Aggressive ───────────────────────────────────────────────
  const aggressiveChanges = [
    m.unconfirmed.slice(0, 10).map(r => ({
      type: 'move_to_overtime', label: 'Перенести в overtime',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Неподтверждённый scope — перенос безопаснее',
    })),
    m.topRisky.slice(0, 5).map(r => ({
      type: 'move_to_overtime', label: 'Перенести в overtime (высокий риск)',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: `riskScore: ${r.riskScore}`,
    })),
    m.topBlockers.slice(0, 5).map(r => ({
      type: 'escalate', label: 'Эскалировать блокер',
      task: cap(r.tasks||r.epic||'—', 60), id: r.id,
      reason: 'Блокер не снимается — нужна эскалация',
    })),
  ].flat();

  const aggressiveRiskAfter = Math.max(5, riskBefore - 38);
  const aggressiveProb = { before: Math.max(10, 100 - riskBefore - 20), after: Math.min(95, 100 - aggressiveRiskAfter) };

  return {
    relLabel,
    riskBefore,
    scenarios: [
      {
        id: 'conservative',
        label: 'Консервативный',
        icon: '🛡',
        description: `Убрать неподтверждённый и "висящий" scope. Минимальные изменения, максимальная предсказуемость.`,
        riskBefore, riskAfter: conservativeRiskAfter,
        probability: conservativeProb,
        scopeImpact: `−${conservativeChanges.length} задач`,
        affectedCount: conservativeChanges.length,
        tradeoffs: ['Меньший scope → меньше функционала', 'Освобождает ресурсы для приоритетных задач', 'Наименее рискованный сценарий'],
        changes: conservativeChanges,
      },
      {
        id: 'balanced',
        label: 'Сбалансированный',
        icon: '⚖️',
        description: `Назначить ответственных, разблокировать ключевые задачи, подтвердить scope. Баланс между изменениями и стабильностью.`,
        riskBefore, riskAfter: balancedRiskAfter,
        probability: balancedProb,
        scopeImpact: `${balancedChanges.filter(c=>c.type==='confirm_scope').length} подтвердить`,
        affectedCount: balancedChanges.length,
        tradeoffs: ['Требует ресурсов команды на разблокировку', 'Наибольший эффект при наличии ответственных', 'Scope не меняется — функционал сохраняется'],
        changes: balancedChanges,
      },
      {
        id: 'aggressive',
        label: 'Агрессивный',
        icon: '🚀',
        description: `Срезать всё рискованное, эскалировать блокеры, перевести в overtime. Максимальная вероятность сдачи минимального ядра.`,
        riskBefore, riskAfter: aggressiveRiskAfter,
        probability: aggressiveProb,
        scopeImpact: `−${aggressiveChanges.length} задач / overtime`,
        affectedCount: aggressiveChanges.length,
        tradeoffs: ['Существенное сокращение scope', 'Конфликты с бизнес-ожиданиями', 'Гарантирует сдачу ядра продукта'],
        changes: aggressiveChanges,
      },
    ],
  };
}

/* ─────────────────────────────────────────────────────────── */
/* SECTION 5: ACTION FEED                                     */
/* ─────────────────────────────────────────────────────────── */
export function computeActionFeed(m) {
  const items = [];

  // Critical: blockers in near releases
  if (m.blockingNear.length > 0) {
    items.push({
      id: 'feed_blockers_near',
      severity: 'critical',
      icon: '🚫',
      title: `Разобрать ${m.blockingNear.length} блокеров в ближайших релизах`,
      explanation: 'Блокеры прямо в 1.20/1.21 — задачи не завершатся без разблокировки. Критический приоритет.',
      impact: 'Без действий релиз сорвётся',
      affectedCount: m.blockingNear.length,
      filter: { onlyBlocking: true },
      actionType: 'show',
    });
  }

  // Critical: unconfirmed in releases
  const inRelUnconfirmed = m.unconfirmed.filter(r => r.hasRelease120||r.hasRelease121||r.hasRelease122);
  if (inRelUnconfirmed.length >= 2) {
    items.push({
      id: 'feed_unconfirmed_in_rel',
      severity: 'critical',
      icon: '❓',
      title: `Подтвердить scope у ${inRelUnconfirmed.length} задач в релизах`,
      explanation: 'Неподтверждённый scope в релизе — непредсказуемый объём работ. Нужно либо подтвердить, либо вынести.',
      impact: `Риск неготовности ${inRelUnconfirmed.length} задач`,
      affectedCount: inRelUnconfirmed.length,
      filter: { scope: 'Требует подтверждения' },
      actionType: 'show',
    });
  }

  // Warning: no-release in-scope
  if (m.noRelease.length >= 3) {
    items.push({
      id: 'feed_no_release',
      severity: 'warning',
      icon: '📋',
      title: `Распределить ${m.noRelease.length} задач по релизам`,
      explanation: 'Задачи in-scope без релиза — они не войдут ни в какой релиз, накопятся долгом.',
      impact: 'Скрытый backlog растёт',
      affectedCount: m.noRelease.length,
      filter: { isUnassigned: true },
      actionType: 'show',
    });
  }

  // Warning: all blockers
  if (m.blockers.length > m.blockingNear.length) {
    const extra = m.blockers.length - m.blockingNear.length;
    items.push({
      id: 'feed_all_blockers',
      severity: 'warning',
      icon: '⚡',
      title: `Ещё ${extra} блокеров вне ближайших релизов`,
      explanation: 'Блокеры в 1.22 и overtime — они также требуют внимания и могут задержать последующие релизы.',
      impact: 'Риск задержки следующих релизов',
      affectedCount: extra,
      filter: { onlyBlocking: true },
      actionType: 'show',
    });
  }

  // Warning: overloaded assignees
  if (m.overloaded.length >= 1) {
    const names = m.overloaded.slice(0,3).map(a => cap(a.name, 20)).join(', ');
    items.push({
      id: 'feed_overload',
      severity: 'warning',
      icon: '🔥',
      title: `Перегруз: ${names}`,
      explanation: `Исполнители с 5+ задачами — скорость выполнения упадёт, задачи будут тормозить друг друга.`,
      impact: 'Задержки из-за перегруза команды',
      affectedCount: m.overloaded.reduce((s,a)=>s+a.total,0),
      filter: null,
      actionType: 'explain',
    });
  }

  // Info: no assignee
  if (m.noAssignee.length >= 5) {
    items.push({
      id: 'feed_no_assignee',
      severity: 'info',
      icon: '👤',
      title: `Назначить владельцев ${m.noAssignee.length} задачам`,
      explanation: 'Задачи без исполнителя никто не возьмёт в работу. Нужно назначить или убрать из scope.',
      impact: 'Задачи зависнут без движения',
      affectedCount: m.noAssignee.length,
      filter: {},
      actionType: 'show',
    });
  }

  // Info: overtime pile
  if (m.overtime.length >= 5) {
    items.push({
      id: 'feed_overtime',
      severity: 'info',
      icon: '⏰',
      title: `Снизить overtime: ${m.overtime.length} задач`,
      explanation: 'Overtime — признак нереалистичного плана. Нужно пересмотреть приоритеты или расширить ресурсы.',
      impact: 'Команда выгорает, качество падает',
      affectedCount: m.overtime.length,
      filter: { release: 'ot' },
      actionType: 'show',
    });
  }

  // Info: dependencies missing
  if (Object.keys(state.epicDeps || {}).length === 0 && m.total > 10) {
    items.push({
      id: 'feed_no_deps',
      severity: 'info',
      icon: '🔗',
      title: 'Добавить зависимости между эпиками',
      explanation: 'Без карты зависимостей критический путь неизвестен. AI не может предупредить о cascade-рисках.',
      impact: 'Скрытые зависимости = скрытые риски',
      affectedCount: 0,
      filter: null,
      actionType: 'explain',
    });
  }

  return items;
}

/* ─────────────────────────────────────────────────────────── */
/* MASTER FUNCTION                                            */
/* ─────────────────────────────────────────────────────────── */
export function runAllCeoBlocks(rows) {
  if (!rows || !rows.length) return null;
  const m = computeCeoMetrics(rows);
  if (!m) return null;
  return {
    metrics:         m,
    health:          computeCeoHealth(m),
    ifNothingChanges:computeIfNothingChanges(m),
    hardTruths:      computeHardTruths(m),
    saveRelease:     computeSaveTheRelease(m),
    actionFeed:      computeActionFeed(m),
  };
}
