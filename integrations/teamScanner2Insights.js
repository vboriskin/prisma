'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — INSIGHTS  (V20 S12 PR-F)

   Pure-функции которые превращают raw data → actionable insights.
   Идея: тимлид утром видит «что нового, кому помочь, что закрыть».

   Insights:
     · I1 Daily morning brief — нарратив про команду в 3-5 предложений
     · I2 Action queue Top-5  — ranked list людей-приоритетов
     · I3 Diff vs yesterday   — per-row badge со сменой группы
     · I7 Zombie issue detector — issues open >90д без транзишенов
   ============================================================ */

import { classifyPerson } from './teamScanner2Classifier.js';

const DAY_MS = 24 * 3600 * 1000;

/**
 * I3 — Build a map keyed by participant.key with "yesterday's group" so
 * UI может показать «↑ был moving, стал stop» badge per-row.
 *
 * Ничего не делает если у нас нет prev snapshot с per-person details.
 * Сейчас snapshot хранит только agg counts, не per-person classification.
 * Чтобы closure'ом покрыть PR-F → пока возвращаем пустую Map (data gap),
 * но API уже готов — следующий S12.5 расширит snapshot shape.
 *
 * @param {object} prev — prev daily snapshot
 * @returns {Map<string,string>} key → 'stop'|'watch'|'moving'|'idle'
 */
export function buildYesterdayGroupMap(prev) {
  const map = new Map();
  const personGroups = prev?.personGroups || {};
  for (const k of Object.keys(personGroups)) {
    map.set(k, personGroups[k]);
  }
  return map;
}

/**
 * I3 helper — использовать в snapshot extractor чтобы хранить per-person
 * group для diff-badge на следующий день. Возвращает {[key]: group}.
 */
export function extractPersonGroups(participants) {
  const out = {};
  for (const p of (participants || [])) {
    if (!p?.key) continue;
    out[p.key] = classifyPerson(p);
  }
  return out;
}

/**
 * I7 — Zombie issue detector. Issues открыты >90д И не было транзишенов
 * 30+ дней. Это «висяки» которые тимлид может смело закрыть.
 *
 * Источник: blockers (т.к. blockers уже считают dwellHours по статусу) +
 * issuesNow (текущий WIP). Используем `created` timestamp issue.
 *
 * Возвращает массив `{key, status, dwellHours, summary, owner, daysOpen}`.
 */
export function detectZombies(model) {
  const out = [];
  const now = Date.now();
  const ZOMBIE_OPEN_DAYS  = 90;
  const ZOMBIE_DWELL_DAYS = 30;
  const FRESH_COMMIT_DAYS = 30;

  // AUDIT_SCANNER #25 — multi-source zombie detection.
  // Раньше: «open >30д без транзишенов» (через blockers.dwellHours).
  // Проблема: если по задаче недавно были коммиты (BB) или edits страниц
  // (CF), но без транзишенов в Jira — она помечалась как zombie ложно
  // (живая работа без формального move-status'а).
  // Сейчас: dwell≥30д И нет свежего коммита/edit'а за последние 30д.
  //
  // Источник BB-сигнала: model.participants[].bbItems[] — каждый item
  // имеет `at` (ISO timestamp), `kind` ('commit'/'pr'), `title` (где
  // часто встречается ключ задачи через convention "ABC-123: …"). У items
  // нет explicit jiraKey-ссылки, поэтому строим index по regex на `title`.
  // CF-проверка: если в model есть p.cfItems с tied issueKey — учитываем;
  // если интеграция отсутствует, просто пропускаем (опционально).
  const issueLastCommitTs = new Map(); // jiraKey → max ts of commit/pr
  const KEY_RX = /\b([A-Z][A-Z0-9_]*-\d+)\b/g;
  for (const p of (model?.participants || [])) {
    for (const it of (p.bbItems || [])) {
      const ts = Date.parse(it?.at || '');
      if (!Number.isFinite(ts)) continue;
      // Извлекаем key из title коммита/PR. У одного коммита может быть
      // ссылка на >1 задач — обновляем все.
      const title = String(it?.title || '');
      let m;
      KEY_RX.lastIndex = 0;
      while ((m = KEY_RX.exec(title)) !== null) {
        const k = m[1];
        const prev = issueLastCommitTs.get(k) || 0;
        if (ts > prev) issueLastCommitTs.set(k, ts);
      }
    }
    // Опциональный CF-сигнал: model может содержать p.cfItems[{key, at}]
    // (из confluence-edits). Если структуры нет — просто skip.
    for (const it of (p.cfItems || [])) {
      const ts = Date.parse(it?.at || '');
      if (!Number.isFinite(ts)) continue;
      const k = it?.issueKey || it?.jiraKey || '';
      if (!k) continue;
      const prev = issueLastCommitTs.get(k) || 0;
      if (ts > prev) issueLastCommitTs.set(k, ts);
    }
  }

  const seen = new Set();
  for (const p of (model?.participants || [])) {
    for (const b of (p.blockers || [])) {
      if (!b?.key || seen.has(b.key)) continue;
      const dwellH = Number(b.dwellHours) || 0;
      if (dwellH < ZOMBIE_DWELL_DAYS * 24) continue;
      // AUDIT_SCANNER #25 — multi-source guard: если по задаче есть свежий
      // коммит/PR/CF-edit (≤30д) — НЕ zombie, даже если в Jira нет
      // транзишенов. Команда работает, просто не двигает статус.
      const lastCommitTs = issueLastCommitTs.get(b.key) || 0;
      if (lastCommitTs && (now - lastCommitTs) / (24 * 3600 * 1000) <= FRESH_COMMIT_DAYS) {
        continue;
      }
      seen.add(b.key);
      out.push({
        key:        b.key,
        status:     b.status || '',
        dwellHours: dwellH,
        summary:    (b.summary || '').slice(0, 80),
        owner:      p.label || p.key,
        // daysOpen не доступен из blocker shape (там нет created date),
        // используем dwellHours как proxy. Можно расширить.
      });
    }
  }
  out.sort((a, b) => b.dwellHours - a.dwellHours);
  return out.slice(0, 10);
}

/**
 * I2 — Action queue Top-5: ranked list of people who need attention today.
 *
 * Score: high blocker dwell × group + recent slowdown + WIP overload.
 *
 * Returns `[{key, label, reason, severity, action}]`.
 */
export function buildActionQueue(model) {
  const queue = [];
  for (const p of (model?.participants || [])) {
    const grp = classifyPerson(p);
    if (grp === 'idle') continue; // idle = тихо, может быть отпуск
    const blockers = p.blockers || [];
    const maxDwell = Math.max(0, ...blockers.map(b => Number(b?.dwellHours) || 0));
    const wip = (p.issuesNow || []).length;
    const burnoutLevel = p.personMetrics?.burnout?.level || 'none';

    let reason = '';
    let action = '';
    let severity = 0;

    if (grp === 'stop') {
      severity = 100;
      reason = `Стоп · ${blockers.length} ${blockers.length === 1 ? 'блокер' : 'блокеров'} · макс ${Math.round(maxDwell)}ч`;
      action = '1:1 разговор — что мешает';
    } else if (burnoutLevel === 'high') {
      severity = 90;
      reason = 'Высокий burnout-сигнал';
      action = 'Проверь нагрузку на 1:1';
    } else if (wip >= 4) {
      severity = 70;
      reason = `Перегружен · ${wip} WIP`;
      action = 'Помоги приоритизировать';
    } else if (grp === 'watch' && maxDwell >= 24) {
      severity = 60;
      reason = `Наблюдение · максимальный dwell ${Math.round(maxDwell)}ч`;
      action = 'Спроси на stand-up — что зависло';
    } else if (burnoutLevel === 'medium') {
      severity = 40;
      reason = 'Средний burnout-сигнал';
      action = 'Понаблюдать неделю';
    } else {
      continue; // moving/clean → не в очереди
    }

    queue.push({
      key: p.key,
      label: p.label || p.key,
      reason,
      action,
      severity,
    });
  }
  queue.sort((a, b) => b.severity - a.severity);
  return queue.slice(0, 5);
}

/**
 * I1 — Daily morning brief. Возвращает {sentences: string[]}.
 *
 * Не использует LLM — pure rule-based. 3-5 предложений в зависимости от
 * того что есть в данных. Каждое предложение — одна мысль.
 *
 * Включает:
 *   1. «4 в стопе, 2 наблюдают, 12 движутся, 3 без активности»
 *   2. (опционально) «Sprint goal CORE-26: 64% (отстаём 9pp)»
 *   3. «Кому помочь сегодня: Иванов, Петров, Сидорова»
 *   4. (опционально) «Сценарий-zombies: 3 задачи висят >30 дней»
 *   5. (опционально) «Scope churn в среду: +3 / -1»
 */
export function buildDailyBrief(model, history) {
  const sentences = [];
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  for (const p of (model?.participants || [])) {
    counts[classifyPerson(p)]++;
  }
  const total = counts.stop + counts.watch + counts.moving + counts.idle;
  if (total === 0) {
    return { sentences: ['Команда пустая (нет identity-mapping или никого не вернуло Jira).'] };
  }

  // Sentence 1: counts с дельтой
  const prev = history?.[history.length - 1];
  const dStop = prev ? counts.stop - (prev.counts?.stop || 0) : 0;
  const dMoving = prev ? counts.moving - (prev.counts?.moving || 0) : 0;
  let s1 = `${counts.stop} в стопе`;
  if (dStop !== 0) s1 += ` (${dStop > 0 ? '+' : ''}${dStop} к вчера)`;
  s1 += `, ${counts.watch} наблюдают, ${counts.moving} движутся`;
  if (dMoving !== 0) s1 += ` (${dMoving > 0 ? '+' : ''}${dMoving})`;
  if (counts.idle > 0) s1 += `, ${counts.idle} без активности`;
  s1 += '.';
  sentences.push(s1);

  // Sentence 2: sprint goal aggregate
  const sg = model?.scannerV2?.sprintGoal;
  if (sg && sg.aggregateTotal > 0) {
    const pct = sg.aggregateProgress;
    const pace = sg.aggregatePace;
    const paceText = pace === 'behind' ? 'отстаём' : pace === 'ahead' ? 'опережаем' : 'идём по плану';
    sentences.push(`Спринт: ${sg.aggregateDone}/${sg.aggregateTotal} (${pct}%) — ${paceText}.`);
  }

  // Sentence 3: top stuck people
  const queue = buildActionQueue(model);
  if (queue.length > 0) {
    const names = queue.slice(0, 3).map(q => q.label).join(', ');
    sentences.push(`Внимания требуют: ${names}.`);
  }

  // Sentence 4: zombies
  const zombies = detectZombies(model);
  if (zombies.length >= 3) {
    sentences.push(`${zombies.length} ${zombies.length === 1 ? 'задача висит' : 'задач висят'} >30 дней без движения — кандидаты на закрытие.`);
  }

  // Sentence 5: scope churn (если history есть и >=2 sprintsByPk сравнения)
  if (history && history.length >= 2) {
    const firstSprintsByPk = history[0]?.sprintGoal?.sprintsByPk || {};
    let totalAdded = 0, totalRemoved = 0;
    for (const s of (sg?.sprints || [])) {
      const initialKeys = firstSprintsByPk[s.pk]?.keys || [];
      if (!initialKeys.length || !Array.isArray(s.sprintIssueKeys)) continue;
      const initialSet = new Set(initialKeys);
      const currentSet = new Set(s.sprintIssueKeys);
      totalAdded   += s.sprintIssueKeys.filter(k => !initialSet.has(k)).length;
      totalRemoved += initialKeys.filter(k => !currentSet.has(k)).length;
    }
    if (totalAdded + totalRemoved >= 3) {
      sentences.push(`Scope спринта изменился: +${totalAdded} / -${totalRemoved} с начала.`);
    }
  }

  return { sentences };
}

/**
 * V20 S13 S5 — Build burnup data: scope/done/ideal series for one sprint.
 *
 * Возвращает {pk, points: [{day, scope, done, ideal}], status}.
 * Источник: history snapshots с sprintsByPk[pk].
 */
export function buildBurnupData(history, pk, currentSprint) {
  if (!Array.isArray(history) || history.length === 0 || !currentSprint) {
    return { pk, points: [], status: 'no-data' };
  }
  // Filter snapshots где есть этот pk + matching sprint name.
  const matching = history.filter(h =>
    h?.sprintGoal?.sprintsByPk?.[pk]?.name === currentSprint.name
  );
  if (matching.length < 2) return { pk, points: [], status: 'too-short' };
  const points = matching.map(h => {
    const s = h.sprintGoal.sprintsByPk[pk];
    return { day: h.day, scope: s.total || 0, done: s.done || 0 };
  });
  // Add ideal: linear from 0 to first scope at start, до last scope at end.
  const totalDays = currentSprint.daysTotal || points.length;
  const finalScope = points[points.length - 1].scope;
  for (let i = 0; i < points.length; i++) {
    points[i].ideal = Math.round((i / Math.max(1, totalDays - 1)) * finalScope);
  }
  return { pk, points, status: 'ok' };
}

/**
 * V20 S13 S7 — Δ-дайджест «вчера closed/started/blocked».
 *
 * Сравнивает текущий model с самым свежим history snapshot'ом старше 12ч.
 * Возвращает {closedCount, startedCount, newBlockerCount, summary}.
 *
 * NB: для precise работы нужны changelog'и; здесь approximation через
 * counts diff и sprintGoal.aggregateDone diff.
 */
export function buildYesterdayDigest(model, history) {
  if (!Array.isArray(history) || history.length < 1) {
    return { closedCount: 0, startedCount: 0, newBlockerCount: 0, summary: null };
  }
  // Берём snapshot >12ч назад — это «вчера».
  const cutoff = Date.now() - 12 * 3600 * 1000;
  const oldSnap = [...history].reverse().find(h => h?.ts && h.ts < cutoff);
  if (!oldSnap) return { closedCount: 0, startedCount: 0, newBlockerCount: 0, summary: null };
  const sg = model?.scannerV2?.sprintGoal;
  const closedCount = sg && oldSnap.sprintGoal
    ? Math.max(0, (sg.aggregateDone || 0) - (oldSnap.sprintGoal.aggregateProgress ? 0 : 0))
    : 0;
  // Простая оценка через counts и risks
  const oldStop = oldSnap.counts?.stop || 0;
  const newStop = (() => {
    let n = 0;
    for (const p of (model?.participants || [])) {
      if (classifyPerson(p) === 'stop') n++;
    }
    return n;
  })();
  const newBlockerCount = Math.max(0, newStop - oldStop);
  // closed/started — из delta aggregateDone (proxy)
  const oldAggDone = (oldSnap.sprintGoal?.aggregateDone) || 0;
  const newAggDone = sg?.aggregateDone || 0;
  const closedDelta = Math.max(0, newAggDone - oldAggDone);
  const summary = (closedDelta > 0 || newBlockerCount > 0)
    ? `Со вчера: закрыто ${closedDelta} ${closedDelta === 1 ? 'задача' : 'задач'}${newBlockerCount > 0 ? `, +${newBlockerCount} новых в стопе` : ''}.`
    : null;
  return {
    closedCount: closedDelta,
    startedCount: 0, // нет точной отслеживаемости без changelog
    newBlockerCount,
    summary,
  };
}

/**
 * V21 S15 S8 — Carry-over rate (issues moved from previous sprint to current).
 *
 * Если history содержит prev-sprint snapshot — diff между closed-set и
 * current-sprint-set. Если history пуст — null.
 *
 * Возвращает {ratio: 0-1, count, total, sample: 'low'|'medium'|'high'}.
 */
export function computeCarryOverRate(model, history) {
  if (!Array.isArray(history) || history.length < 7) {
    return { ratio: null, count: 0, total: 0, sample: 'low' };
  }
  const sg = model?.scannerV2?.sprintGoal;
  if (!sg?.sprints?.length) return { ratio: null, count: 0, total: 0, sample: 'low' };
  // Найти snapshot >7 дней назад с другим sprint name (предыдущий спринт).
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const oldSnap = [...history].reverse().find(h => h?.ts && h.ts < cutoff && h?.sprintGoal?.sprintsByPk);
  if (!oldSnap) return { ratio: null, count: 0, total: 0, sample: 'low' };
  let totalCarried = 0;
  let totalCurrent = 0;
  for (const s of sg.sprints) {
    const oldSprint = oldSnap.sprintGoal.sprintsByPk[s.pk];
    if (!oldSprint || oldSprint.name === s.name) continue; // тот же спринт = не carry-over
    const oldKeys = new Set(oldSprint.keys || []);
    const carried = (s.sprintIssueKeys || []).filter(k => oldKeys.has(k)).length;
    totalCarried += carried;
    totalCurrent += (s.sprintIssueKeys || []).length;
  }
  if (totalCurrent === 0) return { ratio: null, count: 0, total: 0, sample: 'low' };
  return {
    ratio: Math.round((totalCarried / totalCurrent) * 100) / 100,
    count: totalCarried,
    total: totalCurrent,
    sample: history.length >= 14 ? 'high' : 'medium',
  };
}

/**
 * V21 S15 S9 — Bug injection rate (баги созданные в ходе спринта).
 *
 * Источник: model.spaces[pk].sprintIssues с typeKey='bug' AND created
 * после sprint.startDate. Pure proxy для quality-of-DoD метрики.
 */
export function computeBugInjectionRate(model) {
  const sg = model?.scannerV2?.sprintGoal;
  if (!sg?.sprints?.length || !model?.spaces) return { count: 0, perPk: [] };
  let total = 0;
  const perPk = [];
  for (const s of sg.sprints) {
    if (!s.startDate) continue;
    const startMs = Date.parse(s.startDate);
    if (!Number.isFinite(startMs)) continue;
    const space = model.spaces[s.pk] || {};
    const sprintIssues = space.sprintIssues || [];
    const bugs = sprintIssues.filter(it => {
      if (!/bug/i.test(it.typeKey || it.type || '')) return false;
      const c = it.created ? Date.parse(it.created) : NaN;
      return Number.isFinite(c) && c >= startMs;
    });
    if (bugs.length > 0) {
      total += bugs.length;
      perPk.push({ pk: s.pk, count: bugs.length, sprintTotal: sprintIssues.length });
    }
  }
  return { count: total, perPk };
}

/**
 * V21 S15 S10 — Unplanned work %: issues созданные после старта спринта.
 *
 * Approx: процент sprintIssues где created > sprint.startDate.
 */
export function computeUnplannedWork(model) {
  const sg = model?.scannerV2?.sprintGoal;
  if (!sg?.sprints?.length || !model?.spaces) return { ratio: null, count: 0, total: 0 };
  let unplanned = 0, total = 0;
  for (const s of sg.sprints) {
    if (!s.startDate) continue;
    const startMs = Date.parse(s.startDate);
    if (!Number.isFinite(startMs)) continue;
    const sprintIssues = (model.spaces[s.pk] || {}).sprintIssues || [];
    for (const it of sprintIssues) {
      total++;
      const c = it.created ? Date.parse(it.created) : NaN;
      if (Number.isFinite(c) && c > startMs) unplanned++;
    }
  }
  if (total === 0) return { ratio: null, count: 0, total: 0 };
  return {
    ratio: Math.round((unplanned / total) * 100) / 100,
    count: unplanned,
    total,
  };
}

/**
 * V21 S15 S11 — Blocked-time aggregate: sum dwellHours всех блокеров команды.
 *
 * Sum reflects total «sunk pain» — больше = команда теряет время на блокировках.
 */
export function computeBlockedTimeAggregate(model) {
  let totalHours = 0, count = 0;
  for (const p of (model?.participants || [])) {
    for (const b of (p.blockers || [])) {
      const dh = Number(b?.dwellHours) || 0;
      if (dh > 0) {
        totalHours += dh;
        count++;
      }
    }
  }
  return {
    totalHours: Math.round(totalHours * 10) / 10,
    count,
    avgHours: count > 0 ? Math.round((totalHours / count) * 10) / 10 : 0,
  };
}

/**
 * V20 S14 I6 — Weekday-adjusted anomaly detection.
 *
 * Заменяет flat Z-score (был 60-70% false positives «понедельник всегда
 * anomaly»). Сравниваем today value с medianом same-weekday за 6 weeks.
 *
 * @param {Array<{ts:number, value:number}>} history — series ASC by ts
 * @param {number} today — today's value
 * @returns {{anomalous:boolean, ratio:number, baseline:number}}
 */
export function weekdayAdjustedAnomaly(history, today) {
  if (!Array.isArray(history) || history.length < 7) {
    return { anomalous: false, ratio: 1, baseline: 0, confidence: 'low' };
  }
  const todayDow = new Date().getDay();
  const sameWeekday = history
    .filter(h => h?.ts && new Date(h.ts).getDay() === todayDow)
    .map(h => Number(h.value) || 0)
    .filter(Number.isFinite);
  if (sameWeekday.length < 4) {
    return { anomalous: false, ratio: 1, baseline: 0, confidence: 'low' };
  }
  sameWeekday.sort((a, b) => a - b);
  const median = sameWeekday[Math.floor(sameWeekday.length / 2)];
  if (median === 0 && today === 0) return { anomalous: false, ratio: 1, baseline: 0, confidence: 'medium' };
  const baseline = median || 0.5;
  const ratio = today / baseline;
  // Anomaly если |ratio - 1| > 0.5 (т.е. 50% deviation).
  return {
    anomalous: Math.abs(ratio - 1) > 0.5,
    ratio: Math.round(ratio * 100) / 100,
    baseline,
    confidence: sameWeekday.length >= 6 ? 'high' : 'medium',
  };
}

/**
 * V20 S14 I9 — Stale PR list (>3д без активности).
 *
 * Источник: bbItems где kind='pr' и age > 3 дней. Сортируем desc.
 */
export function detectStalePrs(model) {
  const out = [];
  const now = Date.now();
  const STALE_DAYS = 3;
  for (const p of (model?.participants || [])) {
    for (const it of (p.bbItems || [])) {
      if (it?.kind !== 'pr') continue;
      const opened = it.at ? Date.parse(it.at) : NaN;
      if (!Number.isFinite(opened)) continue;
      const ageDays = Math.floor((now - opened) / (24 * 3600 * 1000));
      if (ageDays < STALE_DAYS) continue;
      out.push({
        prId:    it.prId || it.key || '?',
        title:   (it.title || '').slice(0, 80),
        author:  p.label || p.key,
        ageDays,
        url:     it.url || '',
      });
    }
  }
  out.sort((a, b) => b.ageDays - a.ageDays);
  return out.slice(0, 10);
}

/**
 * V20 S14 I10 — Estimate accuracy rolling 30d per person.
 *
 * Источник: issuesNow + completed issues с originalEstimate vs actual.
 * Если поля недоступны — возвращает empty array.
 */
export function computeEstimateAccuracy(model) {
  const out = [];
  for (const p of (model?.participants || [])) {
    const samples = [];
    for (const it of (p.issuesNow || [])) {
      const est = Number(it?.originalEstimate || 0);
      const actual = Number(it?.timeSpent || 0);
      if (est > 0 && actual > 0) {
        samples.push({ est, actual, accuracy: actual / est });
      }
    }
    if (samples.length < 3) continue;
    const ratiosSorted = samples.map(s => s.accuracy).sort((a, b) => a - b);
    const median = ratiosSorted[Math.floor(ratiosSorted.length / 2)];
    // AUDIT-ART #29 — последние ratios в порядке появления (issuesNow order)
    // для per-row sparkline в EstimationCalibrationView. До 7 точек,
    // округлены до 2 знаков. Не сортируем — нужна последовательность,
    // не распределение.
    const recentRatios = samples.slice(-7).map(s => Math.round(s.accuracy * 100) / 100);
    out.push({
      key: p.key,
      label: p.label || p.key,
      medianRatio: Math.round(median * 100) / 100,
      sampleSize: samples.length,
      tendency: median > 1.3 ? 'underestimate' : (median < 0.7 ? 'overestimate' : 'good'),
      recentRatios,
    });
  }
  return out;
}

/**
 * V20 S14 I11 — Solo-author files / bus-factor proxy.
 *
 * Source: bbItems где есть `files` array с changed paths. Считаем
 * для каждого файла unique authors за окно. Bus-factor = 1 → solo.
 *
 * Если file-stats недоступны — возвращает empty.
 */
export function detectSoloAuthorFiles(model) {
  const fileAuthors = new Map(); // path → Set<authorKey>
  for (const p of (model?.participants || [])) {
    for (const it of (p.bbItems || [])) {
      const files = Array.isArray(it?.files) ? it.files : [];
      for (const f of files) {
        const path = typeof f === 'string' ? f : f?.path;
        if (!path) continue;
        if (!fileAuthors.has(path)) fileAuthors.set(path, new Set());
        fileAuthors.get(path).add(p.key);
      }
    }
  }
  const solo = [];
  for (const [path, authors] of fileAuthors.entries()) {
    if (authors.size === 1) {
      solo.push({ path, author: [...authors][0] });
    }
  }
  return solo.slice(0, 20);
}

/**
 * V20 S14 I12 — Onboarding ramp (для новичков <90д).
 *
 * Считаем: дни до первого commit / первого merged PR / первого review.
 * Источник: participant.onboardingStartDate (если установлен) + bbItems.
 *
 * Если стартовая дата неизвестна — пропускаем.
 */
export function computeOnboardingRamp(model) {
  const out = [];
  const now = Date.now();
  for (const p of (model?.participants || [])) {
    const start = p.onboardingStartDate || p.hireDate;
    if (!start) continue;
    const startMs = Date.parse(start);
    if (!Number.isFinite(startMs)) continue;
    const tenureDays = Math.floor((now - startMs) / (24 * 3600 * 1000));
    if (tenureDays > 90) continue; // только онбординг-период
    const bb = p.bbItems || [];
    const firstCommit = bb.filter(it => !it.kind || it.kind === 'commit').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    const firstPr     = bb.filter(it => it.kind === 'pr').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    const firstReview = bb.filter(it => it.kind === 'review').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    out.push({
      key: p.key,
      label: p.label || p.key,
      tenureDays,
      daysToFirstCommit: firstCommit ? Math.floor((Date.parse(firstCommit.at) - startMs) / (24 * 3600 * 1000)) : null,
      daysToFirstPr:     firstPr     ? Math.floor((Date.parse(firstPr.at)     - startMs) / (24 * 3600 * 1000)) : null,
      daysToFirstReview: firstReview ? Math.floor((Date.parse(firstReview.at) - startMs) / (24 * 3600 * 1000)) : null,
    });
  }
  return out;
}

/**
 * V20 S14 I13 — Blocker MTTR (Mean Time To Resolution).
 *
 * Идеальный source: closed blockers с created+resolved timestamps.
 * Approximation: для open blockers — текущий dwellHours; для closed —
 * нет данных в model.
 *
 * Возвращает {mttrHours, count, openCount}.
 */
export function computeBlockerMTTR(model) {
  const dwells = [];
  let openCount = 0;
  for (const p of (model?.participants || [])) {
    for (const b of (p.blockers || [])) {
      const dh = Number(b?.dwellHours) || 0;
      if (dh > 0) {
        dwells.push(dh);
        openCount++;
      }
    }
  }
  if (dwells.length === 0) return { mttrHours: null, count: 0, openCount: 0 };
  // Mean — не median, потому что нас интересует общая «инвестированная боль».
  const mean = dwells.reduce((s, d) => s + d, 0) / dwells.length;
  return {
    mttrHours: Math.round(mean * 10) / 10,
    count: dwells.length,
    openCount,
  };
}

/**
 * V20 S14 I14 — Team Health Score (0-100, weighted).
 *
 * Components (each normalized to 0-100):
 *   · sprintProgress (15%)        — sprint goal aggregate progress
 *   · blockerHealth  (15%)        — 100 - min(100, totalBlockers × 5)
 *   · stopRatio      (15%)        — 100 - (stop / total) × 100
 *   · activitySpread (10%)        — % команды с >0 events за 48ч
 *   · prHealth       (10%)        — PR mergeRate × 100
 *   · zombieFreshness(10%)        — 100 - min(100, zombieCount × 10)
 *   · churnHealth    (10%)        — 100 - min(100, totalChurn × 5)
 *   · noBurnout      (15%)        — 100 - (burnoutCount / total) × 100
 *
 * Validates only own team over time (per benchmark warning от data analyst).
 */
export function computeTeamHealthScore(model, history) {
  const parts = model?.participants || [];
  if (parts.length === 0) return { score: null, components: [] };
  const counts = { stop: 0, watch: 0, moving: 0, idle: 0 };
  let totalBlockers = 0, activeCount = 0, burnoutCount = 0;
  for (const p of parts) {
    counts[classifyPerson(p)]++;
    totalBlockers += (p.blockers || []).length;
    const hasActivity = (p.timelineToday || []).length + (p.timelineYesterday || []).length > 0;
    if (hasActivity) activeCount++;
    const bo = p.personMetrics?.burnout?.level;
    if (bo === 'high') burnoutCount++;
  }
  const total = counts.stop + counts.watch + counts.moving + counts.idle;
  const sg = model?.scannerV2?.sprintGoal;
  const sprintProgress = sg?.aggregateProgress || 0;
  const blockerHealth  = Math.max(0, 100 - Math.min(100, totalBlockers * 5));
  const stopRatio      = total > 0 ? Math.max(0, 100 - (counts.stop / total) * 100) : 100;
  const activitySpread = total > 0 ? (activeCount / total) * 100 : 0;
  // PR mergeRate — из scannerV2.prThroughput.
  const prT = model?.scannerV2?.prThroughput || {};
  let prOpened = 0, prMerged = 0;
  for (const k of Object.keys(prT)) {
    prOpened += prT[k].opened || 0;
    prMerged += prT[k].merged || 0;
  }
  const prHealth = prOpened > 0 ? (prMerged / prOpened) * 100 : 50; // default if no data
  const zombies = detectZombies(model);
  const zombieFreshness = Math.max(0, 100 - Math.min(100, zombies.length * 10));
  const churns = buildScopeChurnDetail(model, history);
  const totalChurn = churns.reduce((s, c) => s + c.added.length + c.removed.length, 0);
  const churnHealth = Math.max(0, 100 - Math.min(100, totalChurn * 5));
  const noBurnout = total > 0 ? Math.max(0, 100 - (burnoutCount / total) * 100) : 100;

  const components = [
    { key: 'sprint',   label: 'Спринт',         value: sprintProgress, weight: 15 },
    { key: 'blockers', label: 'Блокеры',        value: blockerHealth,  weight: 15 },
    { key: 'stop',     label: 'Не в стопе',     value: stopRatio,      weight: 15 },
    { key: 'activity', label: 'Активность',     value: activitySpread, weight: 10 },
    { key: 'pr',       label: 'PR-flow',        value: prHealth,       weight: 10 },
    { key: 'zombies',  label: 'Без зомби',      value: zombieFreshness,weight: 10 },
    { key: 'churn',    label: 'Стабильность',   value: churnHealth,    weight: 10 },
    { key: 'burnout',  label: 'Без burnout',    value: noBurnout,      weight: 15 },
  ];
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(
    components.reduce((s, c) => s + (c.value * c.weight), 0) / totalWeight
  );
  return { score, components };
}

/**
 * V20 S14 I15 — Daily brief copy-to-TG (markdown).
 */
export function composeDailyBriefMarkdown(model, history) {
  const brief = buildDailyBrief(model, history);
  const digest = buildYesterdayDigest(model, history);
  const queue = buildActionQueue(model);
  const lines = [
    `*Сводка дня*`,
    ...brief.sentences.map(s => `• ${s}`),
  ];
  if (digest.summary) lines.push(`• ${digest.summary}`);
  if (queue.length > 0) {
    lines.push('', '*Кому помочь:*');
    queue.slice(0, 5).forEach((q, i) => {
      lines.push(`${i + 1}. ${q.label} — ${q.reason}. → ${q.action}`);
    });
  }
  return lines.join('\n');
}

/**
 * V20 S14 T3 — Cross-team dependencies aggregate.
 *
 * Источник: model.scannerV2.crossTeamDeps (если уже посчитано) или
 * approximation через issuesNow.parentKey, который из другой pk.
 *
 * Возвращает {incoming: [{pk, count}], outgoing: [{pk, count}]}.
 */
export function buildCrossTeamDeps(model) {
  // Если уже есть computed в scannerV2 — используем.
  const existing = model?.scannerV2?.crossTeamDeps;
  if (existing && (existing.incoming || existing.outgoing)) return existing;
  return { incoming: [], outgoing: [] };
}

/**
 * V20 S14 T4 — Sprint Confidence % (linear projection).
 *
 * Если в спринте: actual_progress + slope × days_left ≥ 100% → 100%.
 * Если actual + slope × days_left = X% → confidence = (X / 100) × 100.
 *
 * Возвращает {confidence: 0-100, projected: number, actual: number}.
 */
export function computeSprintConfidence(model) {
  const sg = model?.scannerV2?.sprintGoal;
  if (!sg?.sprints?.length) return { confidence: null, projected: null, actual: null };
  // Aggregate
  const actual = sg.aggregateProgress || 0;
  // Slope from sprintGoalSlope (если посчитано в orchestrator → ctx.sprintGoalSlope)
  // Здесь approximation: используем avg pace из sprints.
  let avgDaysLeft = 0, withDays = 0;
  for (const s of sg.sprints) {
    if (Number.isFinite(s.daysLeft) && Number.isFinite(s.daysTotal)) {
      avgDaysLeft += s.daysLeft;
      withDays++;
    }
  }
  if (withDays === 0) return { confidence: null, projected: actual, actual };
  avgDaysLeft = avgDaysLeft / withDays;
  // Projected: linear extrapolation (current + (daysElapsed_rate × daysLeft))
  // Simplified: if pace=on-track, projected=100. If behind, projected<100.
  const pace = sg.aggregatePace;
  let projected = actual;
  if (pace === 'ahead')      projected = Math.min(110, actual + (avgDaysLeft / 14) * 100);
  else if (pace === 'on-track') projected = Math.min(100, actual + (avgDaysLeft * (actual / Math.max(1, 14 - avgDaysLeft))));
  else if (pace === 'behind') projected = actual + (avgDaysLeft * (actual / Math.max(1, 14 - avgDaysLeft)) * 0.7);
  projected = Math.round(projected);
  // Confidence: 100% если projected ≥ 100, иначе projected/100.
  const confidence = projected >= 100 ? 100 : Math.max(0, Math.round(projected));
  return { confidence, projected, actual };
}

/**
 * V20 S13 I4 — Sprint scope churn detail per pk.
 *
 * Возвращает массив `[{pk, added: [keys], removed: [keys], ratio}]` для
 * каждого pk где есть changes. Источник: первый snapshot спринта vs
 * текущий sprintIssueKeys.
 */
export function buildScopeChurnDetail(model, history) {
  const sg = model?.scannerV2?.sprintGoal;
  if (!sg?.sprints?.length || !Array.isArray(history) || history.length < 2) return [];
  const out = [];
  for (const s of sg.sprints) {
    if (!Array.isArray(s.sprintIssueKeys)) continue;
    // Первый snapshot этого спринта (с тем же name).
    const firstSnap = history.find(h =>
      h?.sprintGoal?.sprintsByPk?.[s.pk]?.name === s.name
    );
    const initialKeys = firstSnap?.sprintGoal?.sprintsByPk?.[s.pk]?.keys || [];
    if (initialKeys.length === 0) continue;
    const initialSet = new Set(initialKeys);
    const currentSet = new Set(s.sprintIssueKeys);
    const added   = s.sprintIssueKeys.filter(k => !initialSet.has(k));
    const removed = initialKeys.filter(k => !currentSet.has(k));
    if (added.length === 0 && removed.length === 0) continue;
    out.push({
      pk: s.pk,
      sprintName: s.name,
      added,
      removed,
      ratio: Math.round(((added.length + removed.length) / initialKeys.length) * 100),
      initialSize: initialKeys.length,
    });
  }
  return out;
}

/**
 * V20 S13 I5 — PR cycle time p50/p90 (open → merged) за окно.
 *
 * Источник: `p.bbItems` items с kind='pr' и поля `at` (open) + `closedAt`
 * (если есть). Если closedAt отсутствует — пропускаем (PR ещё открыт).
 *
 * Возвращает {p50Hours, p90Hours, count}.
 */
export function computePrCycleTime(model) {
  const cycles = [];
  for (const p of (model?.participants || [])) {
    for (const it of (p.bbItems || [])) {
      if (it?.kind !== 'pr') continue;
      const opened = it.at ? Date.parse(it.at) : NaN;
      const closed = it.closedAt ? Date.parse(it.closedAt)
                   : (it.mergedAt ? Date.parse(it.mergedAt) : NaN);
      if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed <= opened) continue;
      const hours = (closed - opened) / (3600 * 1000);
      if (hours > 0 && hours < 24 * 30) cycles.push(hours); // cap 30d
    }
  }
  if (cycles.length === 0) return { p50Hours: null, p90Hours: null, count: 0 };
  cycles.sort((a, b) => a - b);
  const p50 = cycles[Math.floor(cycles.length * 0.5)];
  const p90 = cycles[Math.floor(cycles.length * 0.9)];
  return {
    p50Hours: Math.round(p50 * 10) / 10,
    p90Hours: Math.round(p90 * 10) / 10,
    count: cycles.length,
  };
}

/**
 * V20 S13 I8 — CR queue depth per reviewer (кто перегружен ревью).
 *
 * Источник: `p.bbItems` items с kind='pr' где user — reviewer (т.е.
 * добавлен в reviewers list но автор — другой). Считаем open-PRs на каждом
 * reviewer'е, флагуем тех у кого ≥4.
 *
 * Возвращает массив `[{key, label, openPrCount, flag}]` sorted desc.
 */
export function computeCrQueueDepth(model) {
  const out = [];
  for (const p of (model?.participants || [])) {
    // Approximation: bbItems с kind='review' (если есть в shape) или
    // считаем "кому я ревьюю" из p.badges.prReviews48h.
    const reviewsOpen = (p.bbItems || []).filter(it =>
      it?.kind === 'review' && (it.state === 'OPEN' || !it.state)
    ).length;
    // Fallback: используем prReviews48h как proxy «загрузка ревью».
    const proxyLoad = Number(p.badges?.prReviews48h) || 0;
    const load = reviewsOpen > 0 ? reviewsOpen : proxyLoad;
    if (load >= 2) {
      out.push({
        key: p.key,
        label: p.label || p.key,
        openPrCount: load,
        flag: load >= 4 ? 'overload' : (load >= 2 ? 'warn' : 'ok'),
      });
    }
  }
  out.sort((a, b) => b.openPrCount - a.openPrCount);
  return out.slice(0, 5);
}

/**
 * 2026-05-11 — CR Load Gini coefficient.
 * Распределение нагрузки ревью по команде. 0 = равномерно
 * (хорошо, никто не перегружен), 1 = вся нагрузка на одном человеке (плохо).
 * Threshold: >0.5 = неравномерно (нужно перераспределение).
 *
 * Algorithm: classical Gini on sorted reviewer loads.
 * Возвращает: { gini, topReviewerPct, totalReviewers }
 */
export function computeCrLoadGini(model) {
  const loads = [];
  for (const p of (model?.participants || [])) {
    const reviewsOpen = (p.bbItems || []).filter(it =>
      it?.kind === 'review' && (it.state === 'OPEN' || !it.state)
    ).length;
    const proxyLoad = Number(p.badges?.prReviews48h) || 0;
    const load = reviewsOpen > 0 ? reviewsOpen : proxyLoad;
    if (load > 0) loads.push(load);
  }
  if (loads.length === 0) return { gini: 0, topReviewerPct: 0, totalReviewers: 0 };
  if (loads.length === 1) return { gini: 0, topReviewerPct: 100, totalReviewers: 1 };
  loads.sort((a, b) => a - b);
  const n = loads.length;
  const total = loads.reduce((s, x) => s + x, 0);
  if (total === 0) return { gini: 0, topReviewerPct: 0, totalReviewers: n };
  // Gini = sum((2*i - n - 1) * x_i) / (n * sum(x_i))
  let weightedSum = 0;
  for (let i = 0; i < n; i++) weightedSum += (2 * (i + 1) - n - 1) * loads[i];
  const gini = weightedSum / (n * total);
  const topLoad = loads[n - 1];
  return {
    gini: Math.round(gini * 100) / 100,
    topReviewerPct: Math.round((topLoad / total) * 100),
    totalReviewers: n,
  };
}

/**
 * V20 S13 N1-N5 — Per-employee narrative.
 *
 * Pилот: «5 минут утра — нужны 3-5 предложений «что человек делает / делал»
 * без таблиц и графиков». Это краткий status-summary для 1:1 prep.
 *
 * Принципы (HR-safe):
 *   N5: фокус на задачах, а не на человеке («по REL-456 нет движения»,
 *       а не «Иванов был неактивен»).
 *   N3: rolling 24h по умолчанию (не «вчера» — пн утром = воскресенье).
 *   N4: empty-state с гипотезой, не «—».
 *
 * Возвращает {sentences:[], hypothesis: '', isStaleData: false}.
 */
export function composePersonNarrative(p) {
  if (!p) return { sentences: [], hypothesis: '', isStaleData: false };

  // Собираем все события за rolling 24h (today + yesterday если ≤24h назад).
  const now = Date.now();
  const HOUR_MS = 3600 * 1000;
  const cutoff24h = now - 24 * HOUR_MS;

  const todayEvents = (p.timelineToday || []).filter(e => {
    const ms = e?.at ? Date.parse(e.at) : NaN;
    return Number.isFinite(ms) && ms >= cutoff24h;
  });
  // Yesterday window: events 24-48h назад
  const cutoff48h = now - 48 * HOUR_MS;
  const yestEvents = [...(p.timelineYesterday || []), ...(p.timelinePrev || [])]
    .filter(e => {
      const ms = e?.at ? Date.parse(e.at) : NaN;
      return Number.isFinite(ms) && ms >= cutoff48h && ms < cutoff24h;
    });

  const wip = (p.issuesNow || []);
  const blockers = (p.blockers || []);
  const bbItems = (p.bbItems || []);
  const cfItems = (p.cfItems || []);

  // Empty case detection (N4): различаем кейсы.
  const totalActivity = todayEvents.length + yestEvents.length + bbItems.length + cfItems.length;
  if (totalActivity === 0 && wip.length === 0 && blockers.length === 0) {
    // Полная тишина — empty state с гипотезой.
    const hasIdentity = !!(p.email || p.jiraAccountId || p.bitbucketLogin);
    let hypothesis = '';
    if (!hasIdentity) {
      hypothesis = 'Нет identity-mapping: настрой в реестре сотрудников (jiraAccountId / email / bbLogin).';
    } else {
      hypothesis = 'Возможно отпуск, больничный или вне рабочих часов. Проверь календарь.';
    }
    return {
      sentences: ['За последние 48 часов активности не зафиксировано.'],
      hypothesis,
      isStaleData: false,
    };
  }

  const sentences = [];

  // Sentence 1 (Сегодня): WIP + последний event
  // N5: фокус на задачах. «Сегодня по PROJ-X: ...» а не «Иванов сегодня делал...»
  if (todayEvents.length > 0 || wip.length > 0) {
    const wipKeys = wip.slice(0, 2).map(it => it.key).filter(Boolean);
    const todayKeys = [...new Set(todayEvents.map(e => e?.issue?.key).filter(Boolean))].slice(0, 3);
    const parts = [];
    if (wipKeys.length > 0) {
      parts.push(`в работе ${wipKeys.join(', ')}`);
    }
    if (todayKeys.length > 0) {
      const verb = todayEvents.length > 5 ? 'активно работает над' : 'трогал';
      parts.push(`${verb} ${todayKeys.join(', ')}`);
    }
    if (bbItems.length > 0) {
      const commitsCount = bbItems.filter(it => it.kind === 'commit' || !it.kind).length;
      if (commitsCount > 0) parts.push(`${commitsCount} ${commitsCount === 1 ? 'коммит' : (commitsCount < 5 ? 'коммита' : 'коммитов')}`);
      const prCount = bbItems.filter(it => it.kind === 'pr').length;
      if (prCount > 0) parts.push(`${prCount} PR`);
    }
    if (parts.length > 0) {
      sentences.push(`Сегодня: ${parts.join(', ')}.`);
    }
  } else {
    sentences.push('Сегодня тишина в Jira/BB.');
  }

  // Sentence 2 (Блокеры): сдвиг с человека на задачу.
  if (blockers.length > 0) {
    const top = blockers[0];
    const dwellH = Math.round(Number(top.dwellHours) || 0);
    const stuckPart = `по ${top.key} нет движения ${dwellH < 24 ? `${dwellH}ч` : `${Math.floor(dwellH / 24)}д`} (статус «${top.status || '—'}»)`;
    if (blockers.length === 1) {
      sentences.push(`Блокер: ${stuckPart}.`);
    } else {
      sentences.push(`${blockers.length} ${blockers.length < 5 ? 'блокера' : 'блокеров'}: ${stuckPart}.`);
    }
  }

  // Sentence 3 (Вчера): краткий summary.
  if (yestEvents.length > 0) {
    const yestKeys = [...new Set(yestEvents.map(e => e?.issue?.key).filter(Boolean))].slice(0, 3);
    if (yestKeys.length > 0) {
      sentences.push(`Вчера: ${yestKeys.join(', ')} (${yestEvents.length} ${yestEvents.length === 1 ? 'событие' : 'событий'}).`);
    }
  }

  // Sentence 4 (CF): edits в Confluence
  if (cfItems.length > 0) {
    sentences.push(`В Confluence ${cfItems.length} ${cfItems.length === 1 ? 'правка' : (cfItems.length < 5 ? 'правки' : 'правок')} за 48ч.`);
  }

  // Detect stale data
  const fetchedAtMs = p._fetchedAtMs || 0;
  const isStaleData = fetchedAtMs > 0 && (now - fetchedAtMs) > 24 * HOUR_MS;

  return { sentences, hypothesis: '', isStaleData };
}

/**
 * V20 S13 N2 — Build markdown text для копирования в TG/Slack.
 * Используется как clipboard payload в кнопке «скопировать для 1:1».
 */
export function composeNarrativeMarkdown(p, narrative) {
  if (!p || !narrative) return '';
  const lines = [
    `*${p.label || p.key}*`,
    ...narrative.sentences.map(s => `• ${s}`),
  ];
  if (narrative.hypothesis) lines.push(`_${narrative.hypothesis}_`);
  if (narrative.isStaleData) lines.push('_(данные старше суток, перезапусти Сканнер)_');
  return lines.join('\n');
}

/**
 * 2026-05-12 — Detect stale long-living branches (BB). Uses bbItems
 * (commits/PR's) per participant: branch считается stale если последний
 * commit в неё > 14 дней назад И PR не closed/merged.
 *
 * Возвращает: [{ author, branch, daysStale, repo, lastCommitAt }] (top 10).
 */
export function detectStaleBranches(model, staleThresholdDays = 14) {
  const out = [];
  const cutoffMs = Date.now() - staleThresholdDays * 24 * 3600 * 1000;
  for (const p of (model?.participants || [])) {
    for (const it of (p.bbItems || [])) {
      if (it?.kind !== 'commit' && it?.kind !== 'pr') continue;
      const lastTs = Date.parse(it.at || '') || 0;
      if (!lastTs || lastTs > cutoffMs) continue;
      // PR state filter: только OPEN (если есть). Commits — берём все old.
      if (it.kind === 'pr' && it.state && it.state !== 'OPEN') continue;
      const branch = String(it.branch || it.refName || it.fromBranch || '').trim();
      if (!branch || /^(main|master|develop|dev|release\/)/.test(branch)) continue;
      const daysStale = Math.floor((Date.now() - lastTs) / (24 * 3600 * 1000));
      out.push({
        author: p.label || p.key,
        branch,
        daysStale,
        repo: String(it.repo || '').slice(0, 40),
        lastCommitAt: it.at,
      });
    }
  }
  out.sort((a, b) => b.daysStale - a.daysStale);
  // Dedup by author+branch (multiple commits to same branch).
  const seen = new Set();
  return out.filter(x => {
    const k = `${x.author}|${x.branch}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);
}

/**
 * 2026-05-12 — Jira changelog patterns analyzer. Surface unusual signals:
 *   · churn-frequent-reassign: задача меняла assignee ≥3 раз
 *   · severity-downgrade: бага severity была понижена без resolution
 *   · sprint-hopping: задача переходила между ≥3 спринтами
 *   · scope-flip: scope='Да' → 'Нет' (выкинута из плана)
 *
 * Источник: model.participants[].issuesNow[].changelog (если есть в shape).
 * Альтернативно: model.spaces[pk].issues[i].changelog.
 *
 * Возвращает массив: [{ key, pattern, severity, evidence }] sorted by severity.
 */
export function analyzeChangelogPatterns(model) {
  const out = [];
  const seen = new Set();

  const scanIssue = (issue) => {
    if (!issue?.key || seen.has(issue.key)) return;
    const cl = issue.changelog;
    if (!Array.isArray(cl) || cl.length < 2) return;
    seen.add(issue.key);

    // Pattern 1: frequent reassignment.
    const assigneeChanges = cl.filter(e => /assignee/i.test(e.field || '')).length;
    if (assigneeChanges >= 3) {
      out.push({
        key: issue.key,
        pattern: 'churn-frequent-reassign',
        severity: 60,
        evidence: `${assigneeChanges} смен assignee`,
      });
    }

    // Pattern 2: severity downgrade без resolution.
    const sevHistory = cl.filter(e => /severity|priority/i.test(e.field || ''));
    if (sevHistory.length >= 2 && !issue.resolution) {
      const last = sevHistory[sevHistory.length - 1];
      if (last && /low|minor|trivial/i.test(String(last.toString || ''))) {
        out.push({
          key: issue.key,
          pattern: 'severity-downgrade',
          severity: 40,
          evidence: `priority/severity → ${last.toString}`,
        });
      }
    }

    // Pattern 3: sprint-hopping.
    const sprintHops = cl.filter(e => /sprint/i.test(e.field || '')).length;
    if (sprintHops >= 3) {
      out.push({
        key: issue.key,
        pattern: 'sprint-hopping',
        severity: 50,
        evidence: `${sprintHops} переходов между спринтами`,
      });
    }

    // Pattern 4: scope-flip (scope=Да → Нет).
    const scopeFlip = cl.find(e => /scope/i.test(e.field || '') &&
      /yes|да/i.test(e.fromString || '') && /no|нет/i.test(e.toString || ''));
    if (scopeFlip) {
      out.push({
        key: issue.key,
        pattern: 'scope-flip',
        severity: 70,
        evidence: 'выкинута из scope',
      });
    }
  };

  for (const p of (model?.participants || [])) {
    for (const it of (p.issuesNow || [])) scanIssue(it);
  }
  for (const space of Object.values(model?.spaces || {})) {
    for (const it of (space?.issues || [])) scanIssue(it);
  }
  out.sort((a, b) => b.severity - a.severity);
  return out.slice(0, 15);
}
