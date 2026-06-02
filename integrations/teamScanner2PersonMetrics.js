'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — PER-PERSON METRICS  (V20 S11)

   Per-employee метрики, которые user явно запросил после S10.
   Каждая — pure-функция от participant'а, без новых server endpoints.

   ВАЖНО: все эти метрики намеренно показываются ТОЛЬКО тимлиду в режиме
   «Сканнер команд» (нет self-view сотрудника). Если в будущем добавят
   self-view — burnout flag (Z10) и productivity score (Z1) ОБЯЗАНЫ
   быть скрыты в self-view.

   Метрики:
     · Z1 productivity score   — composite throughput (коммиты+PR+ревью+закрытия)
     · Z2 first/last activity  — min/max timestamp событий за сегодня
     · Z3 context-switch rate  — переключений в час за 72ч (existing data)
     · Z6 LOC delta            — приближение из bbItems.size / commits
     · Z8 hours logged         — agg loggedTodaySec / loggedYesterdaySec
     · Z9 first-response-time  — медиана FRT для issues где человек assignee
     · Z10 burnout flag        — composite: weekend + late-night + WIP overload
   ============================================================ */

const HOUR_MS = 3600 * 1000;
const DAY_MS  = 24 * HOUR_MS;

/**
 * Z1 — Productivity score per person (composite throughput).
 *
 * Формула (взвешенная сумма дешёвых сигналов из existing badges):
 *   score = commits48h × 1.0  +  pr48h × 3.0  +  conf48h × 1.5
 *         + reviewsDone × 2.0 + testsCreated48h × 2.0 + testsExecuted48h × 1.0
 *         + closedToday × 5.0
 *
 * Веса подобраны эмпирически: PR-merge дороже коммита (review-effort),
 * закрытая задача — самый «верхний» сигнал.
 *
 * Возвращает {score, breakdown} где breakdown — для tooltip'а.
 */
export function computeProductivityScore(p) {
  const b = p?.badges || {};
  const commits      = Number(b.commits48h)         || 0;
  const prs          = Number(b.pr48h)              || 0;
  const conf         = Number(b.conf48h)            || 0;
  const reviewsDone  = Number(b.prReviews48h)       || 0;
  const testsCreated = Number(b.testsCreated48h)    || 0;
  const testsExecuted= Number(b.testsExecuted48h)   || 0;
  // closedToday — issues, перешедшие в terminal status сегодня.
  // 2026-06-02 audit fix #7 — приоритетно используем event.kind === 'closed'
  // (выставляется в portfolioPulseModel._changelogItemToEvent при
  // isTerminalStatus(to)). Это работает на русских/английских/exotic
  // статусах и не ловит false-positive «Готов к QA».
  // Fallback на regex по text — для legacy событий или если pulse не
  // прокинул `kind:'closed'` (defensive).
  const TERM_FALLBACK_RX = /^(перевели в |→ |status: )?\s*(done|closed|resolved|готово|закрыт|закрыто|выполнен|выполнено|завершен|завершено|решен|решено)/i;
  const closedToday = (p?.timelineToday || []).filter(e => {
    if (!e) return false;
    if (e.kind === 'closed') return true;
    if (e.kind !== 'transition') return false;
    return TERM_FALLBACK_RX.test(e.text || '');
  }).length;
  const score = Math.round(
    commits * 1.0 + prs * 3.0 + conf * 1.5
    + reviewsDone * 2.0 + testsCreated * 2.0 + testsExecuted * 1.0
    + closedToday * 5.0
  );
  return {
    score,
    breakdown: { commits, prs, conf, reviewsDone, testsCreated, testsExecuted, closedToday },
  };
}

/**
 * Z2 — First/last activity per person.
 *
 * Возвращает {first, last, span} где first/last — Date или null,
 * span — длительность в часах (или null если <2 events). Источник: все
 * timelineToday + bbItems + cfItems + zephyr events с .at полем.
 *
 * NB: используется browser-local TZ. Если события приходят в UTC ISO,
 * Date.parse → UTC ms → toLocaleTimeString рендерит в TZ юзера.
 */
export function computeFirstLastActivity(p) {
  const stamps = [];
  const harvest = (arr, getAt) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      const at = getAt(it);
      if (!at) continue;
      const ms = Date.parse(at);
      if (Number.isFinite(ms)) stamps.push(ms);
    }
  };
  harvest(p?.timelineToday,             e => e?.at);
  harvest(p?.bbItems,                   e => e?.at);
  harvest(p?.cfItems,                   e => e?.at);
  harvest(p?.zephyrTestsCreatedRecent,  e => e?.at);
  harvest(p?.zephyrTestsExecutedRecent, e => e?.at);
  if (stamps.length === 0) return { first: null, last: null, span: null, count: 0 };
  // Filter to "today" only (использует server local time как и весь pulse).
  const now = Date.now();
  const dayStart = now - 24 * HOUR_MS; // rolling 24h, не «с полуночи»
  const todayStamps = stamps.filter(s => s >= dayStart);
  if (todayStamps.length === 0) return { first: null, last: null, span: null, count: 0 };
  const first = Math.min(...todayStamps);
  const last  = Math.max(...todayStamps);
  return {
    first: new Date(first),
    last:  new Date(last),
    span:  Math.round((last - first) / HOUR_MS * 10) / 10, // часы, 1 decimal
    count: todayStamps.length,
  };
}

/**
 * Z3 — Context-switch rate per person (already enriched as
 * `p.contextSwitches.switchEvents`). Считаем switches/hour за 72ч окно.
 *
 * Возвращает {perHour, total, distinctIssueKeys, score}.
 */
export function computeContextSwitchRate(p) {
  const cs = p?.contextSwitches || {};
  const total = Array.isArray(cs.switchEvents) ? cs.switchEvents.length : 0;
  const distinct = (cs.distinctIssueKeys instanceof Set)
    ? cs.distinctIssueKeys.size
    : (Array.isArray(cs.distinctIssueKeys) ? cs.distinctIssueKeys.length : 0);
  // 72-часовое окно = 72 часа активности (грубо). Нормализуем на «часы где
  // вообще была активность» если можно вычислить, иначе 72.
  const perHour = Math.round((total / 72) * 100) / 100;
  return {
    perHour,
    total,
    distinctIssueKeys: distinct,
    score: cs.switchScore || 0,
  };
}

/**
 * Z6 — LOC delta per person (приближение).
 *
 * Идеальный источник: BB diff stats (added/removed lines). Если их нет в
 * bbItems — fallback на commit count × MEAN_LOC_PER_COMMIT (50).
 *
 * NB: LOC — гадкая метрика (поощряет шум, наказывает рефакторинг). Делаем
 * по запросу пользователя; рекомендуется к закрытию через config-flag в
 * production.
 */
const MEAN_LOC_PER_COMMIT = 50; // empirical estimate
export function computeLocDelta(p) {
  const bbItems = Array.isArray(p?.bbItems) ? p.bbItems : [];
  let added = 0, removed = 0, hasRealStats = false;
  for (const it of bbItems) {
    if (typeof it?.linesAdded === 'number' || typeof it?.linesRemoved === 'number') {
      added   += Number(it.linesAdded)   || 0;
      removed += Number(it.linesRemoved) || 0;
      hasRealStats = true;
    }
  }
  if (!hasRealStats) {
    const commits = Number(p?.badges?.commits48h) || 0;
    return {
      added:    commits * MEAN_LOC_PER_COMMIT,
      removed:  0,
      net:      commits * MEAN_LOC_PER_COMMIT,
      estimated: true,
    };
  }
  return { added, removed, net: added - removed, estimated: false };
}

/**
 * Z8 — Hours logged per person (Jira `timetracking.timeSpentSeconds`).
 *
 * Источник: existing `p.loggedTodaySec`. Расширяем через timeline'ы:
 * если в timelineYesterday/Prev есть worklog events, агрегируем.
 *
 * Возвращает {todaySec, yesterdaySec, weekSec}.
 */
export function computeHoursLogged(p) {
  const todaySec = Number(p?.loggedTodaySec) || 0;
  // Yesterday + last week — пытаемся достать из timeline (kind='worklog').
  const sumWorklog = (arr) => (Array.isArray(arr) ? arr : [])
    .filter(e => e?.kind === 'worklog')
    .reduce((s, e) => s + (Number(e?.timeSpentSec) || 0), 0);
  const yesterdaySec = sumWorklog(p?.timelineYesterday);
  const weekSec      = todaySec + yesterdaySec + sumWorklog(p?.timelinePrev);
  return { todaySec, yesterdaySec, weekSec };
}

/**
 * Z9 — First-response-time per person (median for issues where p is assignee).
 *
 * Идеальный источник: per-issue (issueCreated, firstComment, firstStatusChange).
 * Из существующей pipeline доступны blockers (issue + dwellHours) — это
 * proxy на «время первого изменения статуса». Вычисляем медиану из dwellHours
 * для blockers где status === 'Open'/'To Do' (т.е. ещё не двинулся).
 *
 * Возвращает {medianHours, count}. count<3 → low signal, не показывать.
 */
export function computeFirstResponseTime(p) {
  const blockers = Array.isArray(p?.blockers) ? p.blockers : [];
  // Filter: только issues которые ещё в initial-статусе → dwellHours = FRT proxy.
  const initialBlockers = blockers.filter(b => /open|todo|to\s*do|\bnew\b|новая|новый|открыт/i.test(b?.status || ''));
  if (initialBlockers.length < 3) return { medianHours: null, count: initialBlockers.length };
  const sorted = initialBlockers.map(b => Number(b.dwellHours) || 0).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { medianHours: Math.round(median * 10) / 10, count: sorted.length };
}

/**
 * Z10 — Burnout flag per person.
 *
 * Composite signals (видит ТОЛЬКО тимлид):
 *   1. weekendRatio — % events в сб/вс / total events за окно
 *   2. lateNightRatio — % events после 22:00 + до 06:00
 *   3. wipOverload — issuesNow.length >= 4 (overcommitted)
 *   4. recentSlowdown — нет коммитов 5+ дней после регулярной активности
 *
 * Score:
 *   2+ red signals → 'high'
 *   1 red signal   → 'medium'
 *   0 red signals  → 'none'
 *
 * Threshold per signal: weekend > 25%, lateNight > 15%, wipOverload >=4,
 * slowdown — отдельный proxy.
 */
export function computeBurnoutFlag(p) {
  // Собираем все события с timestamp за последние 28 дней.
  const all = [];
  const harvest = (arr, getAt) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      const at = getAt(it);
      const ms = at ? Date.parse(at) : NaN;
      if (Number.isFinite(ms)) all.push(ms);
    }
  };
  harvest(p?.timelineToday,             e => e?.at);
  harvest(p?.timelineYesterday,         e => e?.at);
  harvest(p?.timelinePrev,              e => e?.at);
  harvest(p?.bbItems,                   e => e?.at);
  harvest(p?.cfItems,                   e => e?.at);
  if (all.length < 5) return { level: 'none', signals: [], confidence: 'low' };

  // Signal 1: weekend ratio
  let weekendCount = 0;
  for (const ms of all) {
    const dow = new Date(ms).getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) weekendCount++;
  }
  const weekendRatio = weekendCount / all.length;

  // Signal 2: late-night ratio (>=22 OR <6, server local TZ)
  let lateCount = 0;
  for (const ms of all) {
    const h = new Date(ms).getHours();
    if (h >= 22 || h < 6) lateCount++;
  }
  const lateRatio = lateCount / all.length;

  // Signal 3: WIP overload (instantaneous)
  const wipNow = (p?.issuesNow || []).length;

  // Signal 4: recent slowdown — last commit timestamp.
  const lastBb = (p?.bbItems || []).reduce((max, it) => {
    const ms = it?.at ? Date.parse(it.at) : NaN;
    return (Number.isFinite(ms) && ms > max) ? ms : max;
  }, 0);
  const daysSinceLastCommit = lastBb > 0
    ? Math.floor((Date.now() - lastBb) / DAY_MS)
    : null;

  const signals = [];
  if (weekendRatio > 0.25) signals.push({ kind: 'weekend',   value: Math.round(weekendRatio * 100) + '%' });
  if (lateRatio    > 0.15) signals.push({ kind: 'late-night',value: Math.round(lateRatio    * 100) + '%' });
  if (wipNow       >= 4)   signals.push({ kind: 'wip-overload', value: wipNow });
  if (daysSinceLastCommit != null && daysSinceLastCommit >= 5 && all.length >= 10) {
    signals.push({ kind: 'recent-slowdown', value: `${daysSinceLastCommit}д без коммитов` });
  }

  let level = 'none';
  if (signals.length >= 2) level = 'high';
  else if (signals.length === 1) level = 'medium';

  return {
    level,
    signals,
    confidence: all.length >= 30 ? 'high' : (all.length >= 10 ? 'medium' : 'low'),
  };
}

/**
 * Apply all per-person metrics to participants in-place.
 * Pipeline-friendly: вызывается из enrichForScanner2 после остальных
 * compute-функций. Каждый participant получает `p.personMetrics` объект.
 */
export function applyPersonMetrics(model) {
  if (!model || !Array.isArray(model.participants)) return model;
  for (const p of model.participants) {
    p.personMetrics = {
      productivity:    computeProductivityScore(p),
      firstLast:       computeFirstLastActivity(p),
      contextSwitches: computeContextSwitchRate(p),
      loc:             computeLocDelta(p),
      hoursLogged:     computeHoursLogged(p),
      firstResponse:   computeFirstResponseTime(p),
      burnout:         computeBurnoutFlag(p),
    };
  }
  return model;
}
