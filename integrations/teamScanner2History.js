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

// V20 S8 #15 — single source of truth для классификации.
// Раньше тут была inline-копия (`_extractMinimalSnapshot` дублировал правила).
// Tech Lead audit: «когда S8 добавит сигнал в classifier, history будет
//   отставать → drift между real model и snapshot day N».
import { classifyPerson } from './teamScanner2Classifier.js';

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
  // V20 S8 #15 — единственный source of truth для класификации (был inline copy).
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  for (const p of (model.participants || [])) {
    counts[classifyPerson(p)]++;
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
      // V20 S12 S4 — per-pk sprint-issue keys для scope churn diff. Compact:
      // массив строк (Jira keys), легко разворачивается в Set при сравнении.
      // Размер: ~50 ключей × 10 chars × 5 pk = 2.5KB на snapshot, ОК.
      sprintsByPk: (model.scannerV2?.sprintGoal?.sprints || []).reduce((acc, s) => {
        if (s.pk) acc[s.pk] = {
          name:   s.name || '',
          keys:   Array.isArray(s.sprintIssueKeys) ? s.sprintIssueKeys : [],
          done:   s.done || 0,
          total:  s.total || 0,
        };
        return acc;
      }, {}),
    },
    // V19 C2 — total participants для sparkline «команда росла/уменьшалась».
    teamSize: (model.participants || []).length,
    // V20 S12 I3 — per-person group для diff-badge «↑ был moving, стал stop».
    // Compact: только key→group, без блокеров/timeline. ~109 × 12 chars = ~1.5KB.
    // НЕ включает label/email/PII — только jiraAccountId как key + 4-state group.
    personGroups: (() => {
      const out = {};
      for (const p of (model.participants || [])) {
        if (!p?.key) continue;
        out[p.key] = classifyPerson(p);
      }
      return out;
    })(),
  };
}

/* 2026-05-12 — defense-in-depth: CRC32 checksum для snapshot integrity.
   Если злоумышленник через DevTools / XSS подменил entry в localStorage —
   integrity не пройдёт, и mы treat snapshot as missing (не загрузим
   poisoned data). Lightweight (no HMAC — мы в browser, нет секретов
   для shared key; CRC32 = tamper-detection, не authentication). */
function _crc32(str) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i);
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ((~crc) >>> 0).toString(16);
}
function _withChecksum(snap) {
  const copy = { ...snap };
  delete copy._crc;
  return { ...snap, _crc: _crc32(JSON.stringify(copy)) };
}
function _verifyChecksum(snap) {
  if (!snap || typeof snap !== 'object' || !snap._crc) return true;  // legacy snapshot — pass
  const copy = { ...snap };
  delete copy._crc;
  return _crc32(JSON.stringify(copy)) === snap._crc;
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

    const snapWithCrc = _withChecksum(snap);
    const existingIdx = history.findIndex(h => h.day === snap.day);
    if (existingIdx >= 0) {
      history[existingIdx] = snapWithCrc;     // last-wins за день
    } else {
      history.push(snapWithCrc);
    }
    // Sort ASC by ts → stable array order.
    history.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    // Prune: keep only last MAX_ENTRIES.
    if (history.length > MAX_ENTRIES) {
      history = history.slice(history.length - MAX_ENTRIES);
    }
    localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {
    // V20 S8 #16 — quota-exceeded больше не silent. Минимальный console.warn —
    // не тащим зависимость на telemetry, History — pure module без orchestrator.
    try { console.warn('[scanner2History] saveDailySnapshot failed:', e.message || e); } catch (_) {}
  }
}

/** Load history for given projectKeys. Returns ASC by ts. */
export function loadHistory(projectKeys, daysBack = 14) {
  try {
    const key = LS_KEY_PREFIX + _hash(projectKeys);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 2026-05-12 — filter out tampered entries (CRC mismatch). Legacy snapshots
    // без _crc проходят (back-compat).
    const verified = arr.filter(_verifyChecksum);
    if (verified.length !== arr.length) {
      try { console.warn('[scanner2History] dropped', arr.length - verified.length, 'tampered snapshots'); } catch (_) {}
    }
    if (typeof daysBack === 'number' && daysBack > 0) {
      const cutoff = Date.now() - daysBack * MS_PER_DAY;
      return verified.filter(h => (h.ts || 0) >= cutoff);
    }
    return verified;
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

/** 2026-05-11 — load snapshot at a specific date (или ближайший до неё).
 *  Используется date-picker'ом в UI для просмотра "что было на 2026-05-05".
 *  Returns null если нет данных на эту или предыдущую дату.
 *  @param {string} isoDate — формат `YYYY-MM-DD`. */
export function loadHistoryAtDate(projectKeys, isoDate) {
  try {
    if (!isoDate || typeof isoDate !== 'string') return null;
    const arr = loadHistory(projectKeys, 365);    // ищем до года назад
    if (!arr.length) return null;
    // Сортированный ASC. Ищем последний snapshot до или на дату isoDate.
    let match = null;
    for (const snap of arr) {
      if (snap.day && snap.day <= isoDate) match = snap;
      else break;
    }
    return match;
  } catch (_) { return null; }
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
