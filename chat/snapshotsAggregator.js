'use strict';
/* ============================================================
   chat/snapshotsAggregator.js — V22+ Week 1 (I-10)

   Lightweight аггрегатор поверх существующего `teamScanner2History`.
   Читает daily-snapshots из localStorage и строит per-employee /
   per-team / per-team-overall сводки за период.

   Зачем:
     · Direct API-fetch (I-09) тяжёлый — год = тысячи items.
     · Snapshots уже накапливаются (V19 C2, retention 30 дней).
     · Из snapshot'а доступны:
         · personGroups[key] → 'stop'|'watch'|'moving'|'idle' (per-day)
         · counts (агрегат по группам)
         · risks (orphans, outOfSprint)
         · sprintGoal (aggregateProgress)
         · teamSize
     · Этого хватает для тренда «менялась ли группа сотрудника» и
       «росли/падали блокеры/orphans» за период до 30 дней.
     · За пределы 30 дней — fallback на historicalFetcher (I-09).

   Public API:
     aggregatePersonFromSnapshots(employeeKey, period, projectKeys)
       → { days, groupDistribution, trend, fromSnapshots, _coverage }
     aggregateTeamFromSnapshots(period, projectKeys)
       → { days, countsByDay, risksByDay, sprintProgressByDay, trend }
     coverageForPeriod(period, projectKeys)
       → { snapshotDays, periodDays, coverage, from, to } — % покрытия

   Контракты:
     · НЕ throw'ает на отсутствие snapshots → возвращает empty result.
     · Per-employee key = `participant.key` (lowercased ФИО или email).
     · НЕ зависит от Reactive proxy — читает localStorage напрямую.
   ============================================================ */

import { loadHistory } from '../integrations/teamScanner2History.js';

/* ─────────────────────────────────────────────────────────────
   Per-employee aggregation
   ───────────────────────────────────────────────────────────── */

/**
 * @param {string} empKey — participant.key (lowercased ФИО или email)
 * @param {object} period — { from: Date, to: Date }
 * @param {string[]} projectKeys
 * @returns {object} aggregated
 */
export function aggregatePersonFromSnapshots(empKey, period, projectKeys) {
  if (!empKey || !period?.from || !period?.to) {
    return _emptyPersonAgg(empKey, period);
  }
  const allHistory = _safeLoadHistory(projectKeys, 31);
  if (!allHistory.length) return _emptyPersonAgg(empKey, period);

  const fromMs = period.from.getTime();
  const toMs   = period.to.getTime();
  const inPeriod = allHistory.filter(s => {
    const ts = Number(s.ts || 0);
    return ts >= fromMs && ts < toMs;
  });

  const groupCounts = { stop: 0, watch: 0, moving: 0, idle: 0, missing: 0 };
  const trend = []; // [{day, group}]
  for (const s of inPeriod) {
    const personGroups = s.personGroups || {};
    const group = personGroups[empKey];
    if (group && groupCounts[group] !== undefined) {
      groupCounts[group]++;
      trend.push({ day: s.day || '', group });
    } else {
      groupCounts.missing++;
      trend.push({ day: s.day || '', group: 'missing' });
    }
  }

  const total = inPeriod.length;
  return {
    empKey,
    period,
    days: total,
    groupDistribution: groupCounts,
    trend,
    fromSnapshots: true,
    _coverage: total > 0 ? total / _periodDays(period) : 0,
  };
}

function _emptyPersonAgg(empKey, period) {
  return {
    empKey, period,
    days: 0,
    groupDistribution: { stop: 0, watch: 0, moving: 0, idle: 0, missing: 0 },
    trend: [],
    fromSnapshots: false,
    _coverage: 0,
  };
}

/* ─────────────────────────────────────────────────────────────
   Team-wide aggregation (счёт по группам, risks, sprint-goal)
   ───────────────────────────────────────────────────────────── */

/**
 * @param {object} period
 * @param {string[]} projectKeys
 * @returns {object}
 */
export function aggregateTeamFromSnapshots(period, projectKeys) {
  if (!period?.from || !period?.to) return _emptyTeamAgg(period);
  const allHistory = _safeLoadHistory(projectKeys, 31);
  if (!allHistory.length) return _emptyTeamAgg(period);

  const fromMs = period.from.getTime();
  const toMs   = period.to.getTime();
  const inPeriod = allHistory.filter(s => {
    const ts = Number(s.ts || 0);
    return ts >= fromMs && ts < toMs;
  });

  if (!inPeriod.length) return _emptyTeamAgg(period);

  const countsByDay = []; // [{day, counts:{stop,watch,moving,idle}}]
  const risksByDay  = []; // [{day, totalOrphans, totalOutOfSprint, outOfSprintRatio}]
  const sprintProgressByDay = []; // [{day, aggregateProgress, aggregatePace}]
  const teamSizeByDay = [];

  for (const s of inPeriod) {
    countsByDay.push({ day: s.day || '', counts: s.counts || {} });
    risksByDay.push({ day: s.day || '', ...(s.risks || {}) });
    sprintProgressByDay.push({
      day: s.day || '',
      aggregateProgress: s.sprintGoal?.aggregateProgress || 0,
      aggregatePace:     s.sprintGoal?.aggregatePace     || 'no-data',
    });
    teamSizeByDay.push({ day: s.day || '', teamSize: s.teamSize || 0 });
  }

  // Trends: first vs last для quick-glance.
  const first = inPeriod[0];
  const last  = inPeriod[inPeriod.length - 1];
  const trend = {
    teamSizeDelta: (last.teamSize || 0) - (first.teamSize || 0),
    stopDelta:     (last.counts?.stop  || 0) - (first.counts?.stop  || 0),
    movingDelta:   (last.counts?.moving|| 0) - (first.counts?.moving|| 0),
    orphansDelta:  (last.risks?.totalOrphans || 0) - (first.risks?.totalOrphans || 0),
    sprintProgressDelta:
      (last.sprintGoal?.aggregateProgress || 0) - (first.sprintGoal?.aggregateProgress || 0),
  };

  return {
    period,
    days: inPeriod.length,
    countsByDay,
    risksByDay,
    sprintProgressByDay,
    teamSizeByDay,
    trend,
    fromSnapshots: true,
    _coverage: inPeriod.length / _periodDays(period),
  };
}

function _emptyTeamAgg(period) {
  return {
    period, days: 0,
    countsByDay: [], risksByDay: [], sprintProgressByDay: [], teamSizeByDay: [],
    trend: null, fromSnapshots: false, _coverage: 0,
  };
}

/* ─────────────────────────────────────────────────────────────
   Coverage helper — % покрытия периода snapshot'ами
   ───────────────────────────────────────────────────────────── */

/**
 * Возвращает coverage info для текста типа «доступно 14 из 30 дней».
 * Caller может решить — fall back на historicalFetcher если coverage низкий.
 */
export function coverageForPeriod(period, projectKeys) {
  if (!period?.from || !period?.to) {
    return { snapshotDays: 0, periodDays: 0, coverage: 0, from: null, to: null };
  }
  const allHistory = _safeLoadHistory(projectKeys, 31);
  const fromMs = period.from.getTime();
  const toMs   = period.to.getTime();
  const inPeriod = allHistory.filter(s => {
    const ts = Number(s.ts || 0);
    return ts >= fromMs && ts < toMs;
  });
  const days = _periodDays(period);
  return {
    snapshotDays: inPeriod.length,
    periodDays:   days,
    coverage:     days > 0 ? inPeriod.length / days : 0,
    from:         period.from,
    to:           period.to,
  };
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function _safeLoadHistory(projectKeys, daysBack) {
  try {
    return loadHistory(projectKeys, daysBack) || [];
  } catch (e) {
    console.warn('[snapshotsAggregator] loadHistory failed:', e);
    return [];
  }
}

function _periodDays(period) {
  if (!period?.from || !period?.to) return 0;
  return Math.max(1, Math.round((period.to.getTime() - period.from.getTime()) / 86400_000));
}
