'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — ENRICHMENT  (V18.1 P3)

   Pure functions, расширяющие model `analysePulse()` дополнительными
   агрегатами для v2.0 UI:

     · heatmap[3][24]   — 24-часовая активность за today/yesterday/prev
     · contextSwitches  — переключения между задачами (gap < 30 мин)
     · timeline72h      — единая лента 72ч событий (sorted DESC)
     · blockers         — issues с dwell-time > N часов в текущем статусе

   Дизайн: enrichment ОПЦИОНАЛЬНЫЙ (вызывается ТОЛЬКО v2.0 orchestrator'ом).
   v1 не запускает его → нулевой performance impact для v1. Все новые
   поля ДОБАВЛЯЮТСЯ к участнику; старые НЕ переименовываются.

   Open question §G.1 — TZ heatmap. P3 решение: SERVER LOCAL TIME (как
   и весь Pulse pipeline). Browser TZ — будущая enhancement (потребует
   передачи TZ от клиента в /employee-detail запросе в P4+).

   Open question §G.2 — Blocker dwell threshold. P3 решение: единый
   24ч порог. Статус-зависимые пороги (Code Review >8ч, In Progress
   >48ч) — P4+ override через config.
   ============================================================ */

import { isTerminalStatus } from './portfolioPulseUtils.js';

const DEFAULT_DWELL_HOURS = 24;
const SWITCH_GAP_SEC = 30 * 60;            // 30 минут
const SWITCHES_PER_HOUR_FOR_FULL_SCORE = 4; // нормировка switchScore=1.0

/**
 * Apply v2.0 enrichment to a model produced by analysePulse(). MUTATES the
 * model — добавляет per-participant поля + top-level `model.scannerV2` meta.
 *
 * @param {object} model        — output of analysePulse()
 * @param {object} [rawReports] — original raw response (нужен для blockers,
 *                                которым требуется issue.changelog)
 * @param {object} [opts]       — { dwellHours? }
 * @returns {object} the same model (mutated, returned for chaining)
 */
export function enrichForScanner2(model, rawReports = null, opts = {}) {
  if (!model || !Array.isArray(model.participants)) return model;
  const dwellHours = Number(opts.dwellHours || DEFAULT_DWELL_HOURS);

  const assigneeIndex = rawReports ? buildAssigneeIndex(rawReports) : null;

  for (const p of model.participants) {
    p.heatmap         = computeHeatmap(p);
    p.contextSwitches = computeContextSwitches(p);
    p.timeline72h     = computeTimeline72h(p);
    p.blockers        = assigneeIndex ? computeBlockers(p, assigneeIndex, dwellHours) : [];
    // V18.1 P5 — расширенные сигналы для side-panel:
    p.heatmap72x4     = computeHeatmap72x4(p);   // 4 sources × 72 hours
    p.sparkline72h    = computeSparkline72h(p);  // 72 значений events/час
  }

  model.scannerV2 = {
    enrichedAt: Date.now(),
    dwellThresholdHours: dwellHours,
    serverLocalTZ: true,         // P3 fixed; P4+ может стать browser TZ
    switchGapSec: SWITCH_GAP_SEC,
  };
  return model;
}

/* ────────────────────────────────────────────────────────── */
/* Heatmap — 3 days × 24 hours, server local time             */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns { grid: number[3][24], peakHour, peakCount, quietHours[] }
 *   grid[0] = today, grid[1] = yesterday, grid[2] = day-before
 *   Hour bucket = `Date.getHours()` (server local).
 */
export function computeHeatmap(p) {
  const grid = [
    new Array(24).fill(0),
    new Array(24).fill(0),
    new Array(24).fill(0),
  ];
  const buckets = [
    p?.timelineToday    || [],
    p?.timelineYesterday || [],
    p?.timelinePrev      || [],
  ];
  for (let dayIdx = 0; dayIdx < 3; dayIdx++) {
    for (const e of buckets[dayIdx]) {
      const t = new Date(e?.at || '');
      if (isNaN(t.getTime())) continue;
      const h = t.getHours();
      if (h >= 0 && h < 24) grid[dayIdx][h]++;
    }
  }
  // Collapse to 24-vector for peak / quiet computation.
  let peakHour = -1, peakCount = 0;
  const collapsed = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    collapsed[h] = grid[0][h] + grid[1][h] + grid[2][h];
    if (collapsed[h] > peakCount) { peakCount = collapsed[h]; peakHour = h; }
  }
  const quietHours = [];
  for (let h = 0; h < 24; h++) {
    if (collapsed[h] <= 1) quietHours.push(h);
  }
  return { grid, peakHour, peakCount, quietHours };
}

/* ────────────────────────────────────────────────────────── */
/* Context switches — gap < 30 min между разными issue.key    */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns { distinctIssueKeys, switchEvents[], switchScore }
 *   - switchEvents: только пары [a,b] где key(a) ≠ key(b) и gap < 30мин
 *   - switchScore:  switches/hour / 4, capped at 1.0 (4+/hour = 1.0)
 */
export function computeContextSwitches(p) {
  const events = [];
  const sources = [p?.timelineToday || [], p?.timelineYesterday || [], p?.timelinePrev || []];
  for (const arr of sources) {
    for (const e of arr) {
      const key = e?.issue?.key;
      const at  = e?.at;
      if (!key || !at) continue;
      const ms = new Date(at).getTime();
      if (isNaN(ms)) continue;
      events.push({ at: ms, key });
    }
  }
  events.sort((a, b) => a.at - b.at);

  const keys = new Set();
  const switches = [];
  for (let i = 0; i < events.length; i++) {
    keys.add(events[i].key);
    if (i === 0) continue;
    const a = events[i - 1];
    const b = events[i];
    if (a.key === b.key) continue;
    const gapSec = Math.floor((b.at - a.at) / 1000);
    if (gapSec < SWITCH_GAP_SEC) {
      switches.push({
        atIso:   new Date(b.at).toISOString(),
        fromKey: a.key,
        toKey:   b.key,
        gapSec,
      });
    }
  }

  const totalSpanMs = events.length > 1 ? events[events.length - 1].at - events[0].at : 0;
  const totalHours  = Math.max(1, totalSpanMs / 3600 / 1000);
  const switchScore = Math.min(1, switches.length / totalHours / SWITCHES_PER_HOUR_FOR_FULL_SCORE);

  return {
    distinctIssueKeys: keys.size,
    switchEvents: switches,
    switchScore,
  };
}

/* ────────────────────────────────────────────────────────── */
/* Timeline72h — merged DESC лента событий с dayOffset/hourBucket */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns array of events с дополненными полями `dayOffset` (0|1|2) и
 * `hourBucket` (0..23). Sorted DESC by `at`.
 */
export function computeTimeline72h(p) {
  const out = [];
  const tag = (events, dayOffset) => {
    for (const e of events) {
      if (!e?.at) continue;
      const d = new Date(e.at);
      if (isNaN(d.getTime())) continue;
      out.push({ ...e, dayOffset, hourBucket: d.getHours() });
    }
  };
  tag(p?.timelineToday    || [], 0);
  tag(p?.timelineYesterday || [], 1);
  tag(p?.timelinePrev      || [], 2);
  out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return out;
}

/* ────────────────────────────────────────────────────────── */
/* Heatmap 72×4 — 4 sources × 72 rolling hours (V18.1 P5)     */
/* ────────────────────────────────────────────────────────── */

/**
 * Returns:
 *   {
 *     grid: [J[72], B[72], C[72], Z[72]],   // chronological: [0]=oldest, [71]=now-1h
 *     rowTotals: [j, b, c, z],
 *     colTotals: number[72],
 *     peakCell: { srcIdx, hourIndex, count } | null,
 *   }
 * Sources:
 *   J = jira (timeline events, kind ∈ {transition, comment, worklog, ...})
 *   B = bitbucket (p.bbItems[])
 *   C = confluence (p.cfItems[])
 *   Z = zephyr (p.zephyrTestsCreatedRecent + p.zephyrTestsExecutedRecent)
 *
 * Bucketing — rolling 72-hour window от Date.now() назад. Каждый bucket =
 * 1 час. hourIndex 71 = последний завершённый час, hourIndex 0 = час 72ч
 * назад. События старше 72ч игнорируются.
 */
export function computeHeatmap72x4(p) {
  const grid = [
    new Array(72).fill(0),  // 0 = jira
    new Array(72).fill(0),  // 1 = bb
    new Array(72).fill(0),  // 2 = cf
    new Array(72).fill(0),  // 3 = zephyr
  ];
  const HOUR_MS = 3600 * 1000;
  const nowMs = Date.now();

  const drop = (srcIdx, atIso) => {
    if (!atIso) return;
    const ms = new Date(atIso).getTime();
    if (isNaN(ms)) return;
    const hoursAgo = Math.floor((nowMs - ms) / HOUR_MS);
    if (hoursAgo < 0 || hoursAgo >= 72) return;
    const idx = 71 - hoursAgo;   // 0=oldest, 71=newest
    grid[srcIdx][idx]++;
  };

  // Jira — все timeline events с issue (исключаем bb/cf/zephyr-источники
  // если они вдруг попали в timelineToday — у нас kind === 'transition' и т.п.)
  for (const arr of [p?.timelineToday || [], p?.timelineYesterday || [], p?.timelinePrev || []]) {
    for (const e of arr) drop(0, e?.at);
  }
  // Bitbucket
  for (const it of (p?.bbItems || [])) drop(1, it?.at);
  // Confluence
  for (const it of (p?.cfItems || [])) drop(2, it?.at);
  // Zephyr
  for (const it of (p?.zephyrTestsCreatedRecent  || [])) drop(3, it?.at);
  for (const it of (p?.zephyrTestsExecutedRecent || [])) drop(3, it?.at);

  const rowTotals = grid.map(row => row.reduce((s, n) => s + n, 0));
  const colTotals = new Array(72).fill(0);
  for (let h = 0; h < 72; h++) {
    for (let s = 0; s < 4; s++) colTotals[h] += grid[s][h];
  }
  let peakCell = null;
  for (let s = 0; s < 4; s++) {
    for (let h = 0; h < 72; h++) {
      if (grid[s][h] > 0 && (!peakCell || grid[s][h] > peakCell.count)) {
        peakCell = { srcIdx: s, hourIndex: h, count: grid[s][h] };
      }
    }
  }
  return { grid, rowTotals, colTotals, peakCell };
}

/**
 * 72-длинный массив events/hour (sum across sources). Для UI sparkline.
 * Reuses heatmap72x4.colTotals если уже посчитан, иначе пересчитывает.
 */
export function computeSparkline72h(p) {
  // Если P5 enrichment уже посчитал heatmap72x4 — переиспользуем colTotals.
  // Иначе считаем напрямую (cheap).
  if (p?.heatmap72x4?.colTotals) return p.heatmap72x4.colTotals.slice();
  const HOUR_MS = 3600 * 1000;
  const nowMs = Date.now();
  const out = new Array(72).fill(0);
  const drop = (atIso) => {
    if (!atIso) return;
    const ms = new Date(atIso).getTime();
    if (isNaN(ms)) return;
    const hoursAgo = Math.floor((nowMs - ms) / HOUR_MS);
    if (hoursAgo < 0 || hoursAgo >= 72) return;
    out[71 - hoursAgo]++;
  };
  for (const arr of [p?.timelineToday || [], p?.timelineYesterday || [], p?.timelinePrev || []]) {
    for (const e of arr) drop(e?.at);
  }
  for (const it of (p?.bbItems || []))                      drop(it?.at);
  for (const it of (p?.cfItems || []))                      drop(it?.at);
  for (const it of (p?.zephyrTestsCreatedRecent  || []))    drop(it?.at);
  for (const it of (p?.zephyrTestsExecutedRecent || []))    drop(it?.at);
  return out;
}

/* ────────────────────────────────────────────────────────── */
/* Blockers — issues с dwell-time > threshold в текущем статусе */
/* ────────────────────────────────────────────────────────── */

/**
 * Build index { jiraAccountId | email → [{issue, statusName, statusCat,
 * lastStatusChangeIso}] }. Walks rawReports, не делает ничего else.
 */
export function buildAssigneeIndex(rawReports) {
  const m = new Map();
  if (!rawReports?.reports) return m;
  for (const rep of rawReports.reports) {
    for (const issue of (rep.issues || [])) {
      const a = issue?.fields?.assignee;
      if (!a) continue;
      const ak = String(a.accountId || a.key || a.name || '').trim();
      const ae = String(a.emailAddress || a.email || '').toLowerCase().trim();
      const meta = {
        issue,
        statusName: issue?.fields?.status?.name || '',
        statusCat:  issue?.fields?.status?.statusCategory?.key || '',
        lastStatusChangeIso: findLastStatusChange(issue),
      };
      if (ak) {
        const arr = m.get(ak) || [];
        arr.push(meta);
        m.set(ak, arr);
      }
      if (ae) {
        const arr = m.get(ae) || [];
        arr.push(meta);
        m.set(ae, arr);
      }
    }
  }
  return m;
}

/** Latest changelog history with field=status item; fallback issue.created. */
export function findLastStatusChange(issue) {
  const histories = issue?.changelog?.histories || [];
  let lastIso = '';
  for (const h of histories) {
    const items = Array.isArray(h.items) ? h.items : [];
    let hasStatus = false;
    for (const it of items) {
      if (it?.field === 'status') { hasStatus = true; break; }
    }
    if (hasStatus && h.created && (!lastIso || h.created > lastIso)) {
      lastIso = h.created;
    }
  }
  if (!lastIso) lastIso = issue?.fields?.created || '';
  return lastIso;
}

/**
 * Returns array of blocker objects:
 *   { key, summary, status, sinceIso, dwellHours }
 * Sorted by dwellHours DESC. Только non-terminal статусы. Dedup'ит по
 * issue.key (один issue может прийти и по accountId, и по email).
 */
export function computeBlockers(p, assigneeIndex, dwellHours) {
  if (!assigneeIndex || !p) return [];
  const dwellMs = dwellHours * 3600 * 1000;
  const now = Date.now();
  const candidates = []
    .concat(assigneeIndex.get(p.jiraAccountId) || [])
    .concat(assigneeIndex.get(p.email) || []);
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = c?.issue?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isTerminalStatus(c.statusName, c.statusCat)) continue;
    if (!c.lastStatusChangeIso) continue;
    const since = new Date(c.lastStatusChangeIso).getTime();
    if (isNaN(since)) continue;
    const dwellMsActual = now - since;
    if (dwellMsActual < dwellMs) continue;
    out.push({
      key,
      summary:    c.issue?.fields?.summary || '',
      status:     c.statusName,
      sinceIso:   c.lastStatusChangeIso,
      dwellHours: Math.round(dwellMsActual / 3600 / 1000),
    });
  }
  out.sort((a, b) => b.dwellHours - a.dwellHours);
  return out;
}
