'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — PERSISTENT HISTORY  (V19 C2)

   Pilot finding (Anna PO + Dmitry руководитель):
   «Какие новости? — не закрыто. Нет тренда «спринт N vs N-1»».
   «8 out-of-sprint без anchor'а 24%»  — нужна базовая линия.

   S4.2 (V18.1 P7) — single 24h snapshot для day-on-day delta.
   C2 (this) — multi-day история (N=30 snapshots, 1/день, deduped),
   позволяет показать sparkline 14 дней + готовит почву для quarter
   cycle-time analytics в V19 C1.

   Storage: localStorage (per-browser, no server). Key per pk-hash.
   Snapshot ~200B × 30 = ~6KB max — well within localStorage 5MB.

   Public API:
     saveDailySnapshot(model, projectKeys)  — auto-dedupes per-day
     loadHistory(projectKeys, daysBack=14)  — array of snapshots, sorted ASC
     extractTrendSeries(history, metricKey) — array<number>, для sparkline
     pruneHistory(projectKeys, maxEntries=30)
   ============================================================ */

const LS_KEY_PREFIX = 'q2_scanner2_history:';
const MAX_ENTRIES = 30;
const MS_PER_DAY = 86400000;

/** Stable hash из projectKeys. Sorted-join. */
function _hash(projectKeys) {
  return [...(projectKeys || [])].sort().join(',');
}

/** YYYY-MM-DD из timestamp (server local или browser local — both ok). */
function _dayKey(ts) {
  const d = new Date(ts || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Extract minimal snapshot из model. Same shape as S4.2 + day-key. */
function _extractMinimalSnapshot(model) {
  if (!model) return null;
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  for (const p of (model.participants || [])) {
    // Inline classification (без import classifyPerson чтобы избежать
    // циклических зависимостей — это OK потому что minimal subset
    // используется только для history-агрегата, не для UI grouping).
    const today = (p.timelineToday || []).length;
    const yest  = (p.timelineYesterday || []).length;
    const wip   = (p.issuesNow || []).length;
    const stuck = (p.blockers?.length ?? p.stale?.length ?? 0);
    const reviewSig = (p.badges?.reviews || 0) + (p.badges?.approves || 0);
    const cfN = (p.cfItems || []).length;
    const bbN = (p.bbItems || []).length;
    const prs = p.badges?.pr48h || 0;
    const com = p.badges?.commits48h || 0;
    const zN = (p.zephyrTestsCreatedRecent || []).length + (p.zephyrTestsExecutedRecent || []).length;
    const anyOther = reviewSig > 0 || cfN > 0 || bbN > 0 || zN > 0;
    let cls;
    if (today === 0 && yest === 0 && wip === 0 && stuck === 0 && prs === 0 && com === 0 && !anyOther) cls = 'idle';
    else if (stuck > 0 && today === 0) cls = 'stop';
    else if (wip >= 3 || (stuck > 0 && today > 0) || (today === 0 && yest > 0)) cls = 'watch';
    else cls = 'moving';
    counts[cls]++;
  }
  return {
    ts: Date.now(),
    day: _dayKey(),
    counts,
    risks: {
      totalOrphans:     model.scannerV2?.risks?.totalOrphans     || 0,
      totalOutOfSprint: model.scannerV2?.risks?.totalOutOfSprint || 0,
      outOfSprintRatio: model.scannerV2?.risks?.outOfSprintRatio || 0,
    },
    sprintGoal: {
      aggregateProgress: model.scannerV2?.sprintGoal?.aggregateProgress || 0,
      aggregatePace:     model.scannerV2?.sprintGoal?.aggregatePace     || 'no-data',
    },
    // V19 C2 — total participants для sparkline «команда росла/уменьшалась».
    teamSize: (model.participants || []).length,
  };
}

/**
 * Save daily snapshot. Dedupes по day-key — если для текущего дня
 * уже есть snapshot, обновляет его (last-wins). Иначе — append + prune.
 */
export function saveDailySnapshot(model, projectKeys) {
  if (!model) return;
  const snap = _extractMinimalSnapshot(model);
  if (!snap) return;
  try {
    const key = LS_KEY_PREFIX + _hash(projectKeys);
    const raw = localStorage.getItem(key);
    let history = [];
    try { history = raw ? JSON.parse(raw) : []; } catch (_) { history = []; }
    if (!Array.isArray(history)) history = [];

    const existingIdx = history.findIndex(h => h.day === snap.day);
    if (existingIdx >= 0) {
      history[existingIdx] = snap;     // last-wins за день
    } else {
      history.push(snap);
    }
    // Sort ASC by ts → stable array order.
    history.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    // Prune: keep only last MAX_ENTRIES.
    if (history.length > MAX_ENTRIES) {
      history = history.slice(history.length - MAX_ENTRIES);
    }
    localStorage.setItem(key, JSON.stringify(history));
  } catch (_) { /* quota exceeded / corrupt — silent skip */ }
}

/** Load history for given projectKeys. Returns ASC by ts. */
export function loadHistory(projectKeys, daysBack = 14) {
  try {
    const key = LS_KEY_PREFIX + _hash(projectKeys);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    if (typeof daysBack === 'number' && daysBack > 0) {
      const cutoff = Date.now() - daysBack * MS_PER_DAY;
      return arr.filter(h => (h.ts || 0) >= cutoff);
    }
    return arr;
  } catch (_) { return []; }
}

/**
 * Extract a numeric series по metric из history. Используется для
 * sparkline rendering. metricKey — dotted-path («counts.stop»).
 */
export function extractTrendSeries(history, metricKey) {
  if (!Array.isArray(history) || !metricKey) return [];
  const path = metricKey.split('.');
  return history.map(snap => {
    let v = snap;
    for (const part of path) {
      if (v == null) return 0;
      v = v[part];
    }
    return Number.isFinite(v) ? v : 0;
  });
}

/** Manual prune (test/diagnostic). */
export function pruneHistory(projectKeys, maxEntries = MAX_ENTRIES) {
  try {
    const key = LS_KEY_PREFIX + _hash(projectKeys);
    const raw = localStorage.getItem(key);
    if (!raw) return;
    let arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    if (arr.length <= maxEntries) return;
    arr = arr.slice(arr.length - maxEntries);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (_) { /* skip */ }
}

/** Diagnostics: история как human-readable summary (для DevTools console). */
export function diagnostics(projectKeys) {
  const h = loadHistory(projectKeys, 60);   // up to 60 days
  if (!h.length) return { entries: 0 };
  return {
    entries: h.length,
    earliest: h[0].day,
    latest:   h[h.length - 1].day,
    latestCounts: h[h.length - 1].counts,
    storageBytes: JSON.stringify(h).length,
  };
}
