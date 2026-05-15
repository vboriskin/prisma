'use strict';
/* ============================================================
   METRICS ENGINE — v8_0 ES module
   ============================================================ */

import { RELEASE_FIELDS } from './constants.js';

export function computeProgress(rows) {
  const releases = ['120','121','122','ot'];
  const result = {};
  releases.forEach(rel => {
    const key = rel === 'ot' ? 'hasOvertime' : `hasRelease${rel}`;
    const inRel = rows.filter(r => r[key]);
    const done = inRel.filter(r => r.isDone).length;
    result[rel] = { total: inRel.length, done, pct: inRel.length ? Math.round(done/inRel.length*100) : 0 };
  });
  const total = rows.length;
  const done = rows.filter(r => r.isDone).length;
  result.all = { total, done, pct: total ? Math.round(done/total*100) : 0 };
  return result;
}

/**
 * V21 audit 3.1 — единый single-pass агрегатор для дашборда. Раньше
 * `dashboard.js` делал ~20 проходов `rows.filter()` за один render — на
 * портфеле 1k строк = ощутимый latency. Теперь один проход reduce.
 *
 * Возвращает {
 *   total, done, doneRecent7d,
 *   scopeYes, scopeNo, needsConfirm,
 *   byRelease: { r120:{total,done}, r121, r122, overtime, backlog, unassigned },
 *   blocking, blockingNear7d, blockingFarQuarter,
 *   risky, byRiskFlag: { 'flag-key': count, ... },
 *   otNoPeriod, otAssignees: Set,
 *   overloadEngineers: [{ fio, ot, r122 }, ...]
 * }
 *
 * V21 audit 4.5 — `backlog` и `unassigned` разделены:
 *   backlog    = `release === 'Бэклог'` ИЛИ row.tags содержит 'backlog'
 *   unassigned = `isUnassigned` (нет ни одного релиза, ни бэклога)
 */
export function computeDashboardCounters(rows) {
  const SEVEN_DAYS = 7 * 86400 * 1000;
  const now = Date.now();
  const sevenAgo = now - SEVEN_DAYS;
  const out = {
    total: rows.length,
    done: 0,
    doneRecent7d: 0,
    scopeYes: 0,
    scopeNo: 0,
    needsConfirm: 0,
    byRelease: { r120: {total:0, done:0}, r121: {total:0, done:0}, r122: {total:0, done:0}, overtime: {total:0, done:0}, backlog: 0, unassigned: 0 },
    blocking: 0,
    blockingNear7d: 0,
    blockingFarQuarter: 0,
    risky: 0,
    byRiskFlag: {},
    otNoPeriod: 0,
    otAssignees: new Set(),
    _r122AssigneesByName: new Map(),
    _otAssigneesByName: new Map(),
  };
  for (const r of rows) {
    if (r.isDone) {
      out.done++;
      const closedAt = r.closedAt || r.actualDoneDate || r.doneDate;
      if (closedAt) {
        const ts = Date.parse(closedAt);
        if (!Number.isNaN(ts) && ts >= sevenAgo) out.doneRecent7d++;
      }
    }
    if (r.scopeStatus === 'Да')                       out.scopeYes++;
    else if (r.scopeStatus === 'Нет')                 out.scopeNo++;
    else if (r.scopeStatus === 'Требует подтверждения') out.needsConfirm++;
    for (const R of RELEASE_FIELDS) {
      const inRel = !!r[R.has];
      if (inRel) {
        out.byRelease[R.key].total++;
        if (r.isDone) out.byRelease[R.key].done++;
      }
    }
    const isExplicitBacklog = /бэклог|backlog/i.test(String(r.release || r.tags || ''));
    if (isExplicitBacklog)            out.byRelease.backlog++;
    else if (r.isUnassigned)          out.byRelease.unassigned++;
    if (r.blockingDependency) {
      out.blocking++;
      if (!r.blockingDeadline) {
        out.blockingNear7d++;        // нет дедлайна — обрабатываем как срочное
      } else {
        const ts = Date.parse(r.blockingDeadline);
        if (!Number.isNaN(ts)) {
          if ((ts - now) <= SEVEN_DAYS) out.blockingNear7d++;
          else                          out.blockingFarQuarter++;
        }
      }
    }
    if (r.riskFlags && r.riskFlags.length) {
      out.risky++;
      for (const flag of r.riskFlags) {
        out.byRiskFlag[flag] = (out.byRiskFlag[flag] || 0) + 1;
      }
    }
    if (r.hasOvertime) {
      const noPeriod = !r.workPeriodStart || !r.workPeriodEnd;
      if (noPeriod) out.otNoPeriod++;
      const assignees = String(r.assignee || '').split(/[|,]/).map(s => s.trim()).filter(Boolean);
      for (const a of assignees) {
        out.otAssignees.add(a);
        const cur = out._otAssigneesByName.get(a) || 0;
        out._otAssigneesByName.set(a, cur + 1);
      }
    }
    if (r.hasRelease122 && !r.isDone) {
      const assignees = String(r.assignee || '').split(/[|,]/).map(s => s.trim()).filter(Boolean);
      for (const a of assignees) {
        const cur = out._r122AssigneesByName.get(a) || 0;
        out._r122AssigneesByName.set(a, cur + 1);
      }
    }
  }
  // V21 audit 4.2 — overload: люди с открытыми 1.22-задачами + OT-задачами.
  // Это и есть «капасити-перегрузка» — индикатор на дашборде.
  const overload = [];
  for (const [fio, otCount] of out._otAssigneesByName) {
    const r122Count = out._r122AssigneesByName.get(fio) || 0;
    if (r122Count > 0) overload.push({ fio, ot: otCount, r122: r122Count });
  }
  overload.sort((a, b) => (b.ot + b.r122) - (a.ot + a.r122));
  out.overloadEngineers = overload;
  // private помощники не нужны наружу — удалить
  delete out._r122AssigneesByName;
  delete out._otAssigneesByName;
  return out;
}

/**
 * AUDIT_ARCHITECTURE #15 — perevedeno iz chat/chatAlerts.js, chtoby zakryt'
 * narushenie border'a `ai/* → chat/*`. Eto chistaya metrika, ne UI; ee
 * mesto v metricsEngine ryadom s computeProgress / computeLoad.
 *
 * `chat/chatAlerts.js` re-eksportiruet etu funkciyu dlya backward-compat,
 * tak chto sushchestvuyushchie callsite'y v chat/* prodolzhayut rabotat'.
 *
 * Health score: 0..100, gde 100 = vse aktivnye zadachi bez problem.
 * Penalty: blockers ×15, risky ×8, scope-bez-relize ×5 (vse na aktivnyy
 * pool, normalizatsiya × 10).
 *
 * @param {Array} rows
 * @returns {number} 0..100
 */
export function computeHealthScore(rows) {
  if (!rows || !rows.length) return 100;
  const total     = rows.length;
  const done      = rows.filter(r => r.isDone).length;
  const blockers  = rows.filter(r => r.blockingDependency && !r.isDone).length;
  const risky     = rows.filter(r => (r.riskFlags||[]).length && !r.isDone).length;
  const noRelease = rows.filter(r => r.isUnassigned && r.scopeStatus === 'Да' && !r.isDone).length;
  const active    = total - done;
  if (active === 0) return 100;
  const penalty = (blockers * 15 + risky * 8 + noRelease * 5) / active;
  return Math.max(0, Math.round(100 - Math.min(100, penalty * 10)));
}

export function computeLoad(rows) {
  const load = {};
  rows.forEach(r => {
    const assignees = String(r.assignee||'').split(/[|,]/).map(s=>s.trim()).filter(Boolean);
    assignees.forEach(name => {
      if (!load[name]) load[name] = { total:0, r120:0, r121:0, r122:0, ot:0 };
      load[name].total++;
      if (r.hasRelease120) load[name].r120++;
      if (r.hasRelease121) load[name].r121++;
      if (r.hasRelease122) load[name].r122++;
      if (r.hasOvertime)   load[name].ot++;
    });
  });
  return load;
}
