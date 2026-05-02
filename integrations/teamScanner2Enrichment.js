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
 * V18.1 P7-S2.2 — differential dwell-thresholds (status-aware).
 *
 * SM/PO panel: единый 24ч порог для blocker'ов смешивает семантики.
 * Code Review > 8ч уже горит для команды, In Progress 30ч — норма.
 * Семантика «blocker» становится действенной только когда threshold
 * привязан к статусу.
 *
 * Lookup — fuzzy lowercase match по statusName. Override через opts.thresholds.
 */
export const DEFAULT_DWELL_THRESHOLDS = {
  codeReview:  8,   // Code Review > 8ч = блокер (зависает на ревьюерах)
  qa:         16,   // QA / Testing > 16ч = блокер
  inProgress: 48,   // In Progress > 48ч = блокер (давно начали, не закончили)
  todo:       72,   // To Do > 72ч в спринте = подвис
  default:    24,   // Все остальные non-terminal — fallback
};

/**
 * V18.1 P7-S2.3 — TZ-aware hour extraction.
 *
 * Контекст: enrichment запускается и на КЛИЕНТЕ (browser TZ), и на
 * СЕРВЕРЕ (server TZ, обычно UTC в k8s-deployment). Без offset'а
 * heatmap «съезжает»: пик 14:00 МСК показывается в часе 11:00 при
 * server-side drill-down /employee-detail.
 *
 * Решение: client передаёт `Date.getTimezoneOffset()` (минуты WEST of
 * UTC; для МСК = -180) в /employee-detail body, server использует.
 *
 * @param {string} iso ISO timestamp («2026-05-02T11:00:00Z»)
 * @param {number} [tzOffsetMin] минуты WEST of UTC (как от Date.getTimezoneOffset()).
 *   undefined → используется environment-local Date.getHours() (для in-browser fetch).
 * @returns {number} 0..23 hour-of-day в нужной TZ
 */
export function getLocalHour(iso, tzOffsetMin) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return -1;
  if (typeof tzOffsetMin !== 'number') return d.getHours();
  // utcMs - offsetMin*60000 → adjusted to user's TZ when read as UTC.
  // tzOffsetMin = -180 (МСК) → utcMs - (-180)*60000 = utcMs + 180min = correctly +3h.
  const adjustedMs = d.getTime() - tzOffsetMin * 60 * 1000;
  return new Date(adjustedMs).getUTCHours();
}

/** Pick dwell-threshold for a status name. Fuzzy lowercase match.
 *  V18.3 A3 — добавлен «Ready for QA» / «Готов к QA» в QA-категорию.
 *  Pilot finding (Ilia QA): «"Ready for QA" — это PR с UI-изменениями
 *  ждёт smoke-pass; default=24 даёт false-negative, надо 16ч как другой QA».
 */
export function pickDwellThreshold(statusName, thresholds = DEFAULT_DWELL_THRESHOLDS) {
  const s = String(statusName || '').toLowerCase();
  if (/code\s*review|peer\s*review|на\s+ревью|ревью\s+кода/.test(s)) return thresholds.codeReview;
  // QA-bucket: covers Ready for QA / Готов к QA / Testing / Тестирование / QA
  if (/\bqa\b|\btest(ing)?\b|тестирован|ready\s+for\s+qa|готов(а|о)?\s+к\s+qa/.test(s)) return thresholds.qa;
  if (/in\s*progress|\bworking\b|\bdoing\b|в\s+работе|разработ/.test(s)) return thresholds.inProgress;
  if (/\btodo\b|to\s*do|\bopen\b|\bnew\b|открыт|новая/.test(s))      return thresholds.todo;
  return thresholds.default;
}

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
  // V18.1 P7-S2.2 — каждое статус-зависимое значение можно override'нуть
  // через opts.thresholds. Bare scalar `dwellHours` остался как
  // backward-compat для default-fallback.
  const thresholds = {
    ...DEFAULT_DWELL_THRESHOLDS,
    default: dwellHours,
    ...(opts.thresholds || {}),
  };

  const assigneeIndex = rawReports ? buildAssigneeIndex(rawReports) : null;

  // V18.1 P7-S2.3 — tzOffsetMin прокидывается во все TZ-зависимые
  // computations. Если не передан — используется environment-local Date.
  const tz = (typeof opts.tzOffsetMin === 'number') ? opts.tzOffsetMin : null;

  for (const p of model.participants) {
    p.heatmap         = computeHeatmap(p, tz);
    p.contextSwitches = computeContextSwitches(p);
    p.timeline72h     = computeTimeline72h(p, tz);
    p.blockers        = assigneeIndex ? computeBlockers(p, assigneeIndex, thresholds) : [];
    // V18.1 P5 — расширенные сигналы для side-panel:
    p.heatmap72x4     = computeHeatmap72x4(p, tz);   // 4 sources × 72 hours
    p.sparkline72h    = computeSparkline72h(p);      // 72 значений events/час (deprecated в S2.5)
  }

  // V18.1 P7-S2.1.5 — risk summary (orphans + out-of-sprint).
  const risks = computeRiskSummary(model);
  // V18.1 P7-S2.1 — sprint goal progress.
  const sprintGoal = computeSprintGoal(model);

  model.scannerV2 = {
    enrichedAt: Date.now(),
    dwellThresholdHours: dwellHours,    // backward-compat (default fallback)
    dwellThresholds: thresholds,        // V18.1 P7-S2.2 — full map
    tzOffsetMin: tz,                    // V18.1 P7-S2.3 — null = environment-local
    serverLocalTZ: tz === null,         // если null → server local; иначе TZ-aware
    switchGapSec: SWITCH_GAP_SEC,
    risks,                              // V18.1 P7-S2.1.5
    sprintGoal,                         // V18.1 P7-S2.1
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
export function computeHeatmap(p, tzOffsetMin) {
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
      const h = getLocalHour(e?.at, tzOffsetMin);
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
 * Returns array of events с дополненными полями `src` (jira/bb/cf/zephyr),
 * `dayOffset` (0|1|2|null) и `hourBucket` (0..23). Sorted DESC by `at`.
 *
 * V18.1 P6.2 — расширено с jira-only до unified лента всех 4 источников:
 *  - jira:   timelineToday/Yesterday/Prev (events с issue + kind)
 *  - bb:     bbItems (PR/commit/review с repo/url/status)
 *  - cf:     cfItems (page edit/create/comment с title/spaceName)
 *  - zephyr: zephyrTestsCreatedRecent + zephyrTestsExecutedRecent
 *
 * Это закрывает gap «инфа о Confluence не показывается в events feed» —
 * до этого фикса P3 timeline72h был jira-only, и в detail-panel
 * Confluence-активность считалась в heatmap row C, но не отображалась.
 */
export function computeTimeline72h(p, tzOffsetMin) {
  const out = [];
  // Jira — из 3 day-buckets с dayOffset для совместимости с существующим UI.
  const tagJira = (events, dayOffset) => {
    for (const e of events) {
      if (!e?.at) continue;
      const d = new Date(e.at);
      if (isNaN(d.getTime())) continue;
      out.push({ ...e, src: 'jira', dayOffset, hourBucket: getLocalHour(e.at, tzOffsetMin) });
    }
  };
  tagJira(p?.timelineToday    || [], 0);
  tagJira(p?.timelineYesterday || [], 1);
  tagJira(p?.timelinePrev      || [], 2);

  // BB / CF / Zephyr — тегируем `src`, dayOffset вычисляем по at.
  const today00 = new Date(); today00.setHours(0, 0, 0, 0);
  const yest00  = new Date(today00); yest00.setDate(today00.getDate() - 1);
  const prev00  = new Date(today00); prev00.setDate(today00.getDate() - 2);
  const dayOffsetOf = (at) => {
    const t = new Date(at).getTime();
    if (isNaN(t)) return null;
    if (t >= today00.getTime()) return 0;
    if (t >= yest00.getTime())  return 1;
    if (t >= prev00.getTime())  return 2;
    return null;   // events older than 72h end up here, но они отфильтрованы 72h-окном на сервере
  };
  const tagOther = (items, src) => {
    for (const it of items) {
      if (!it?.at) continue;
      const d = new Date(it.at);
      if (isNaN(d.getTime())) continue;
      out.push({ ...it, src, dayOffset: dayOffsetOf(it.at), hourBucket: getLocalHour(it.at, tzOffsetMin) });
    }
  };
  tagOther(p?.bbItems                     || [], 'bb');
  tagOther(p?.cfItems                     || [], 'cf');
  tagOther(p?.zephyrTestsCreatedRecent    || [], 'zephyr');
  tagOther(p?.zephyrTestsExecutedRecent   || [], 'zephyr');

  out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return out;
}

/* ────────────────────────────────────────────────────────── */
/* Sprint Goal Progress (V18.1 P7-S2.1) — #1 в карте 7        */
/* сигналов synthesis-плана. Без этого PO не имеет ROI-метрики */
/* для defend'a у CTO.                                        */
/* ────────────────────────────────────────────────────────── */

const SPRINT_PACE_TOLERANCE_PCT = 10;   // ±10% вокруг ideal линии

/**
 * Считает Sprint Goal Progress per active-sprint:
 *   { pk, name, startDate, endDate, daysLeft, daysTotal,
 *     total, done, progressPct, idealPct, pace }
 *
 * pace ∈ {'ahead', 'on-track', 'behind', 'no-data'}.
 *
 * - progressPct = done / total * 100
 * - idealPct    = elapsed/total of sprint duration
 * - 'ahead'   если progress >= ideal + 10%
 * - 'behind'  если progress <= ideal - 10%
 * - 'on-track' иначе
 * - 'no-data'  если sprint без startDate/endDate (ничего не считаем)
 *
 * Source: model.spaces[pk].sprintIssues + activeSprintName + activeSprintInfo.
 * Done detection — через isTerminalStatus.
 *
 * Without SP-fields fallback: count(done) / count(total) — приемлемо для
 * MVP, упоминается в open question §G.4 synthesis-плана.
 */
export function computeSprintGoal(model) {
  if (!model?.spaces) return { sprints: [], aggregateProgress: 0, aggregateDone: 0, aggregateTotal: 0, aggregatePace: 'no-data' };
  const now = Date.now();
  const sprints = [];
  for (const [pk, space] of Object.entries(model.spaces)) {
    if (!space?.activeSprintName) continue;
    const sprintIssues = space.sprintIssues || [];
    if (sprintIssues.length === 0) continue;

    const total = sprintIssues.length;
    const done  = sprintIssues.filter(it => isTerminalStatus(it.status || '', it.statusCat || '')).length;
    const progressPct = total > 0 ? Math.round((done / total) * 1000) / 10 : 0;

    const sInfo = space.activeSprintInfo || {};
    // Jira возвращает либо `startDate` / `endDate` (object), либо
    // `startDate` строкой при serialize'е sprint custom-field. Поддерживаем оба.
    const startDate = sInfo.startDate || sInfo.startDateLocal || null;
    const endDate   = sInfo.endDate   || sInfo.endDateLocal   || null;
    const startMs = startDate ? Date.parse(startDate) : NaN;
    const endMs   = endDate   ? Date.parse(endDate)   : NaN;

    let daysLeft = null, daysTotal = null, idealPct = null, pace = 'no-data';
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      daysTotal = Math.round((endMs - startMs) / 86400000);
      daysLeft  = Math.max(0, Math.round((endMs - now) / 86400000));
      const elapsed = endMs - now < 0 ? daysTotal : (daysTotal - daysLeft);
      idealPct = Math.round((elapsed / daysTotal) * 1000) / 10;
      if      (progressPct >= idealPct + SPRINT_PACE_TOLERANCE_PCT) pace = 'ahead';
      else if (progressPct <= idealPct - SPRINT_PACE_TOLERANCE_PCT) pace = 'behind';
      else                                                          pace = 'on-track';
    }

    sprints.push({
      pk,
      name: space.activeSprintName,
      startDate,
      endDate,
      daysLeft,
      daysTotal,
      total,
      done,
      progressPct,
      idealPct,
      pace,
    });
  }
  const totalAll = sprints.reduce((s, sp) => s + sp.total, 0);
  const doneAll  = sprints.reduce((s, sp) => s + sp.done,  0);
  let aggregatePace = 'no-data';
  if (sprints.length > 0) {
    if (sprints.some(s => s.pace === 'behind'))   aggregatePace = 'behind';
    else if (sprints.every(s => s.pace === 'ahead')) aggregatePace = 'ahead';
    else if (sprints.every(s => s.pace === 'no-data')) aggregatePace = 'no-data';
    else aggregatePace = 'on-track';
  }
  return {
    sprints,
    aggregateProgress: totalAll > 0 ? Math.round(doneAll / totalAll * 1000) / 10 : 0,
    aggregateDone: doneAll,
    aggregateTotal: totalAll,
    aggregatePace,
  };
}

/* ────────────────────────────────────────────────────────── */
/* Risk summary — Orphans + Out-of-sprint (V18.1 P7-S2.1.5)   */
/* ────────────────────────────────────────────────────────── */

/**
 * Считает ключевые риск-сигналы для PO/SM из synthesis-плана:
 *   - Orphan-задачи (без assignee) per project key
 *   - Out-of-sprint Work — events на issues ВНЕ активного спринта,
 *     per participant + total
 *
 * Закрывает сигналы #6 (Out-of-sprint) и #7 (Orphan Risks) из synthesis
 * 7-сигналов плана.
 *
 * Returns:
 *   {
 *     orphansByPk: { [pk]: count },
 *     totalOrphans: number,
 *     outOfSprintByPerson: { [participantKey]: count },
 *     totalOutOfSprint: number,
 *     outOfSprintRatio: 0..1   // share of all events that are out-of-sprint
 *   }
 *
 * Также SET'ит `p.outOfSprintEvents` на каждого participant'а (для UI).
 */
export function computeRiskSummary(model) {
  if (!model) return { orphansByPk: {}, totalOrphans: 0, outOfSprintByPerson: {}, totalOutOfSprint: 0, outOfSprintRatio: 0 };
  const orphansByPk = {};
  let totalOrphans = 0;
  for (const [pk, list] of Object.entries(model.unassignedByPk || {})) {
    const n = (list || []).length;
    if (n > 0) orphansByPk[pk] = n;
    totalOrphans += n;
  }
  // Build set of sprint-issue keys across ALL projects.
  const sprintKeysSet = new Set();
  for (const space of Object.values(model.spaces || {})) {
    for (const it of (space?.sprintIssues || [])) {
      if (it?.key) sprintKeysSet.add(it.key);
    }
  }
  const outOfSprintByPerson = {};
  let totalOutOfSprint = 0;
  let totalEvents       = 0;
  for (const p of (model.participants || [])) {
    let count = 0;
    let myTotal = 0;
    const events = []
      .concat(p.timelineToday    || [])
      .concat(p.timelineYesterday || [])
      .concat(p.timelinePrev      || []);
    for (const e of events) {
      const key = e?.issue?.key;
      if (!key) continue;
      myTotal++;
      // Если sprint pool пустой (нет активных спринтов) — все events
      // считаются in-scope (нет «out» для сравнения).
      if (sprintKeysSet.size > 0 && !sprintKeysSet.has(key)) count++;
    }
    p.outOfSprintEvents = count;
    if (count > 0) outOfSprintByPerson[p.key] = count;
    totalOutOfSprint += count;
    totalEvents      += myTotal;
  }
  return {
    orphansByPk,
    totalOrphans,
    outOfSprintByPerson,
    totalOutOfSprint,
    outOfSprintRatio: totalEvents > 0 ? totalOutOfSprint / totalEvents : 0,
  };
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
export function computeHeatmap72x4(p, _tzOffsetMin) {
  // Note: heatmap72x4 строится через rolling 72-hour window (now backwards),
  // не через "hour-of-day", поэтому tzOffsetMin тут не нужен — `hoursAgo`
  // вычисляется через absolute timestamp diff. Принимаем параметр для
  // signature-симметрии с computeHeatmap (чтобы enrichForScanner2 мог
  // прокидывать единообразно), но не используем.
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
 *   { key, summary, status, sinceIso, dwellHours, thresholdHours }
 * Sorted by dwellHours DESC. Только non-terminal статусы. Dedup'ит по
 * issue.key.
 *
 * V18.1 P7-S2.2 — `thresholds` теперь map (DEFAULT_DWELL_THRESHOLDS).
 * Backward-compat: если передан number — используется как default только.
 */
export function computeBlockers(p, assigneeIndex, thresholds) {
  if (!assigneeIndex || !p) return [];
  // Accept either map (P7+) or scalar number (legacy P3-P6).
  const tmap = (typeof thresholds === 'number')
    ? { ...DEFAULT_DWELL_THRESHOLDS, default: thresholds }
    : (thresholds || DEFAULT_DWELL_THRESHOLDS);
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
    // V18.1 P7-S2.2 — порог теперь зависит от статуса.
    const thresholdHours = pickDwellThreshold(c.statusName, tmap);
    const dwellMs = thresholdHours * 3600 * 1000;
    if (dwellMsActual < dwellMs) continue;
    out.push({
      key,
      summary:    c.issue?.fields?.summary || '',
      status:     c.statusName,
      sinceIso:   c.lastStatusChangeIso,
      dwellHours: Math.round(dwellMsActual / 3600 / 1000),
      thresholdHours,            // P7-S2.2 — для UI: «42ч (порог 8ч)»
    });
  }
  out.sort((a, b) => b.dwellHours - a.dwellHours);
  return out;
}
