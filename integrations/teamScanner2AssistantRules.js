'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — ASSISTANT RULE-ENGINE
   --
   Детерминистичная логика для секции «Сводка ассистента».
   Не лезет в LLM. Производит structured JSON с rationale-цепочкой
   для каждой задачи/активности, который потом LLM (опц.) обогащает
   языком и доп-причинами.

   Главные принципы:
     • Календарный день по МСК (UTC+3) — не скользящие окна.
     • Volume classification (много/норм/мало) — z-score vs
       персональная EMA-14d с fallback на team median.
     • Attribution Jira ↔ activity — по issueKey, branch name,
       commit message, PR title (regex /[A-Z]+-\d+/).
     • Verdict (В плане / Отстаёт / Перевыполнил) — большинство
       по 5 сигналам: velocity, touched, closed, stops, blockers.

   Public API:
     • computeMoscowDayBoundaries(now) → { yesterday/today bounds }
     • buildPlanToday(person, snapshot, opts) → planArtifact
     • buildFactYesterday(person, snapshot, opts) → factArtifact
     • build72hSummary(person, snapshot, opts) → summaryArtifact
     • computeVerdict(volumeBreakdown, signals, ema14) → verdict
   ============================================================ */

const MSK_OFFSET_MIN = 180; // UTC+3, без DST (с 2014)
const VERDICT_LABELS = {
  on_plan:       'В плане',
  behind:        'Отстаёт',
  overperforming:'Перевыполнил',
  unknown:       'Недостаточно данных',
};
const VOLUME_LABELS = {
  high:   'много',
  normal: 'норм',
  low:    'мало',
};
const JIRA_KEY_RX = /\b([A-Z][A-Z0-9_]{1,9})-(\d{1,6})\b/g;

/* ── Date/Time helpers ────────────────────────────────────── */

/**
 * Возвращает границы «вчера» и «сегодня» по МСК в виде ms-timestamps.
 * «Вчера» = (00:00 МСК предыдущего дня) – (00:00 МСК сегодняшнего).
 * «Сегодня» = (00:00 МСК сегодня) – nowMs.
 */
export function computeMoscowDayBoundaries(nowMs) {
  const now = Number(nowMs) || Date.now();
  // utc-midnight для МСК-сегодня:
  //   мск-полночь = utc-полночь − 3ч
  //   Берём сейчас, переводим в МСК-локаль, обрезаем до начала дня, переводим обратно.
  const mskNow = now + MSK_OFFSET_MIN * 60_000;
  const mskDay = Math.floor(mskNow / 86_400_000) * 86_400_000;
  const todayStartUtc     = mskDay - MSK_OFFSET_MIN * 60_000;
  const yesterdayStartUtc = todayStartUtc - 86_400_000;
  return {
    yesterdayStart: yesterdayStartUtc,
    yesterdayEnd:   todayStartUtc,
    todayStart:     todayStartUtc,
    todayEnd:       now,
  };
}

function _parseTs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

/* ── Jira-key extraction & attribution ────────────────────── */

export function extractJiraKeysFromText(text) {
  if (!text) return [];
  const s = String(text);
  const out = new Set();
  let m;
  JIRA_KEY_RX.lastIndex = 0;
  while ((m = JIRA_KEY_RX.exec(s)) !== null) {
    out.add(`${m[1]}-${m[2]}`);
  }
  return Array.from(out);
}

/**
 * Сопоставляет список активностей (commits/PRs/comments/builds) с Jira-задачами.
 * Источники привязки (в порядке надёжности):
 *  1. it.issueKey (если уже распарсено)
 *  2. extractJiraKeysFromText(it.title || it.text)
 *  3. extractJiraKeysFromText(it.branch || it.repo)
 *
 * Возвращает { byKey: { [JIRA-KEY]: [activity...] }, orphans: [...] }.
 * Для orphan-блока всегда фиксируем причину (`unattributedReason`).
 */
export function attributeActivitiesToJira(activities, knownTaskKeys = []) {
  const known = new Set((knownTaskKeys || []).map(k => String(k).toUpperCase()));
  const byKey = Object.create(null);
  const orphans = [];
  const ensure = (key) => { if (!byKey[key]) byKey[key] = []; return byKey[key]; };

  for (const it of (activities || [])) {
    if (!it) continue;
    const fromField = String(it.issueKey || it.key || '').toUpperCase();
    let resolved = '';
    if (fromField && /^[A-Z][A-Z0-9_]{1,9}-\d+$/.test(fromField)) resolved = fromField;
    if (!resolved) {
      const candText = `${it.title || ''} ${it.text || ''}`.trim();
      const keys = extractJiraKeysFromText(candText);
      if (keys.length) resolved = keys[0];
    }
    if (!resolved) {
      const candBranch = `${it.branch || ''} ${it.repo || ''}`.trim();
      const keys = extractJiraKeysFromText(candBranch);
      if (keys.length) resolved = keys[0];
    }
    if (resolved) {
      ensure(resolved).push({
        ...it,
        _attributionRule:
          fromField ? 'field issueKey' :
          /[A-Z]+-\d+/.test(it.title || '') ? 'JIRA-key в заголовке' :
          'JIRA-key в ветке/репо',
      });
    } else {
      orphans.push({
        ...it,
        unattributedReason:
          'не найдено упоминание JIRA-XX в заголовке, ветке и поле issueKey',
      });
    }
  }

  // Для задач, которых нет в knownTaskKeys (LLM-сопоставление сюда может
  // добавить позже), помечаем что это «свободный» ключ.
  for (const k of Object.keys(byKey)) {
    if (!known.has(k.toUpperCase())) {
      byKey[k].forEach(a => { a._unknownTask = true; });
    }
  }
  return { byKey, orphans };
}

/* ── Volume classification ────────────────────────────────── */

/**
 * Эвристические пороги для волюм-метрик, когда нет EMA-14d.
 * Калибровка на основе SBOFPLCORE-2025 (медианы ~3 commits/day, 1 PR/day).
 * Сила: detail снапшота / per-person median будет реализован отдельно.
 */
const VOLUME_HEURISTICS = {
  commits: { low: 1, high: 6 },
  prs:     { low: 1, high: 3 },
  reviews: { low: 1, high: 5 },
  closed:  { low: 0, high: 2 },   // closed=0 = «мало», =1-2 норм, ≥3 много
  comments:{ low: 1, high: 5 },
};

/**
 * Классифицирует объём активности vs EMA-14d или эвристический threshold.
 *  Если ema14 непустой:
 *   z = (value − mean) / stdDev
 *   z > +1 → «много»; −1 ≤ z ≤ +1 → «норм»; z < −1 → «мало»
 *  Если ema14 пустой: используются VOLUME_HEURISTICS[kind].
 * confidence: 'low' (<3 точек) / 'medium' (3-6) / 'high' (≥7 точек) /
 *             'heuristic' (без истории, по domain-default'у)
 */
export function classifyVolume(value, ema14, kind = 'commits') {
  const v = Number(value) || 0;
  const days = Number(ema14?.daysObserved) || 0;
  if (days < 3) {
    const thr = VOLUME_HEURISTICS[kind] || VOLUME_HEURISTICS.commits;
    let label = VOLUME_LABELS.normal;
    if (v <= thr.low)  label = VOLUME_LABELS.low;
    if (v >= thr.high) label = VOLUME_LABELS.high;
    return {
      label, z: null, delta: null, baseline: null,
      confidence: 'heuristic',
      thresholds: thr,
    };
  }
  const mean = Number(ema14.mean) || 0;
  const sd = Math.max(Number(ema14.stdDev) || 0, 0.5);
  const z = (v - mean) / sd;
  let label = VOLUME_LABELS.normal;
  if (z > 1)  label = VOLUME_LABELS.high;
  if (z < -1) label = VOLUME_LABELS.low;
  return {
    label, z: Math.round(z * 10) / 10, delta: Math.round((v - mean) * 10) / 10,
    confidence: days >= 7 ? 'high' : 'medium',
    baseline: Math.round(mean * 10) / 10,
  };
}

/* ── Verdict ──────────────────────────────────────────────── */

/**
 * Композитный вердикт по 5 сигналам:
 *  1. velocity vs ema14 (z-score)
 *  2. touched vs typical touched
 *  3. closed vs typical closed
 *  4. stop-задачи >5d
 *  5. blockers
 * Большинство (>=3 сигналов за позитив/негатив) → лейбл.
 * При равенстве → 'unknown' с warn.
 */
export function computeVerdict(signals) {
  const s = signals || {};
  const votes = { on_plan: 0, behind: 0, overperforming: 0 };

  // velocity vs EMA
  if (s.velocityZ !== undefined && s.velocityZ !== null) {
    if (s.velocityZ > 1)       votes.overperforming++;
    else if (s.velocityZ < -1) votes.behind++;
    else                       votes.on_plan++;
  }
  // touched vs typical
  if (s.touched !== undefined && s.typicalTouched !== undefined) {
    const d = s.touched - s.typicalTouched;
    if (d > 1)       votes.overperforming++;
    else if (d < -1) votes.behind++;
    else             votes.on_plan++;
  }
  // closed vs typical
  if (s.closed !== undefined && s.typicalClosed !== undefined) {
    if (s.typicalClosed >= 1 && s.closed > s.typicalClosed * 1.5) votes.overperforming++;
    else if (s.closed < s.typicalClosed * 0.5)                    votes.behind++;
    else                                                          votes.on_plan++;
  }
  // stops
  if (typeof s.stopsBeyond5d === 'number') {
    if (s.stopsBeyond5d >= 1) votes.behind++;
    else                       votes.on_plan++;
  }
  // blockers
  if (typeof s.activeBlockers === 'number') {
    if (s.activeBlockers >= 1) votes.behind++;
    else                        votes.on_plan++;
  }

  const total = votes.on_plan + votes.behind + votes.overperforming;
  if (total === 0) {
    return { label: VERDICT_LABELS.unknown, code: 'unknown', votes, confidence: 'low' };
  }
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const code = winner[0];
  return {
    label: VERDICT_LABELS[code] || code,
    code,
    votes,
    confidence: total >= 4 ? 'high' : (total >= 2 ? 'medium' : 'low'),
  };
}

/* ── Rationale generators ─────────────────────────────────── */

/** Причины «почему задача в плане сегодня?» — на основе её свойств. */
function _planRationale(task) {
  const reasons = [];
  const status = String(task.status || '').toLowerCase();
  if (/in progress|в работе|разработ/.test(status))           reasons.push(`Статус «${task.status}» — задача активна`);
  else if (/to do|открыт|новая/.test(status))                  reasons.push(`Статус «${task.status}» — в очереди`);
  if (task.assignee || task._isAssigned)                       reasons.push('Назначена на сотрудника');
  if (task._inActiveSprint)                                    reasons.push('В активном спринте');
  if (Number(task.originalEstimateSeconds) > 0) {
    const eH = Math.round(task.originalEstimateSeconds / 360) / 10;
    const tH = Math.round((task.timeSpentSeconds || 0) / 360) / 10;
    const remH = Math.max(0, eH - tH);
    reasons.push(`Estimate ${eH}h, осталось ~${remH}h`);
  }
  if (task.duedate) {
    const due = _parseTs(task.duedate);
    const now = Date.now();
    const daysLeft = Math.round((due - now) / 86_400_000);
    if (daysLeft <= 0)      reasons.push(`Срок «${task.duedate}» — просрочена`);
    else if (daysLeft <= 1) reasons.push(`Срок «${task.duedate}» — горит, ${daysLeft}д`);
    else if (daysLeft <= 5) reasons.push(`Срок «${task.duedate}» — близкий (${daysLeft}д)`);
  }
  if (task._lastTouchHoursAgo !== undefined && task._lastTouchHoursAgo < 24) {
    reasons.push(`Последняя активность ${Math.round(task._lastTouchHoursAgo)}ч назад — горячая`);
  }
  if (String(task.priority || '').toLowerCase().match(/highest|critical|blocker|критич/)) {
    reasons.push(`Высокий приоритет «${task.priority}»`);
  }
  if (!reasons.length) reasons.push('Признаки активности минимальны (попала в выборку как WIP-кандидат)');
  return reasons;
}

/** Причины «почему активность относится к факту вчера?» */
function _factRationale(activity, windowStart, windowEnd) {
  const reasons = [];
  const ts = _parseTs(activity.at || activity.ts);
  if (ts && ts >= windowStart && ts < windowEnd) {
    reasons.push(`Время ${new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} — попадает в МСК-сутки вчера`);
  }
  if (activity._attributionRule) {
    reasons.push(`Привязка к задаче: ${activity._attributionRule}`);
  }
  if (activity.kind) {
    const k = activity.kind;
    const map = { commit: 'Коммит в репозиторий', pr: 'PR в Bitbucket', review: 'PR-ревью', edit: 'Правка Confluence', commented: 'Комментарий в Jira', transitioned: 'Транзишен статуса', closed: 'Закрытие задачи' };
    reasons.push(map[k] || `Активность типа «${k}»`);
  }
  return reasons;
}

/* ── Plan Today ───────────────────────────────────────────── */

/**
 * Строит «План на сегодня»:
 *   { tasks: [{ key, title, status, priority, rationale[] }], verdict, volume }
 * Источник кандидатов: p.issuesNow (WIP) + sprintScope (assigned-to-me в спринте).
 */
export function buildPlanToday(p, model, opts = {}) {
  const tz = computeMoscowDayBoundaries(opts.now || Date.now());
  const wip = Array.isArray(p?.issuesNow) ? p.issuesNow : [];
  const sprintScope = Array.isArray(opts.sprintScope) ? opts.sprintScope : [];

  // dedupe by key
  const map = new Map();
  for (const t of wip) {
    if (!t?.key) continue;
    if (!map.has(t.key)) map.set(t.key, { ...t, _source: 'wip' });
  }
  for (const t of sprintScope) {
    if (!t?.key || map.has(t.key)) continue;
    map.set(t.key, { ...t, _source: 'sprint', _inActiveSprint: true });
  }

  // markup
  const lastTouchByKey = _indexLastTouch(p);
  const tasks = [];
  for (const t of map.values()) {
    const lastTouchAt = lastTouchByKey[t.key] || 0;
    const lastH = lastTouchAt ? Math.round((Date.now() - lastTouchAt) / 3600_000 * 10) / 10 : undefined;
    const enriched = { ...t, _isAssigned: true, _lastTouchHoursAgo: lastH };
    enriched.rationale = _planRationale(enriched);
    tasks.push(enriched);
  }
  // sort: in-progress first, then due-date, then estimate
  tasks.sort((a, b) => {
    const aIp = /in progress|разработ|в работе/i.test(a.status || '') ? 0 : 1;
    const bIp = /in progress|разработ|в работе/i.test(b.status || '') ? 0 : 1;
    if (aIp !== bIp) return aIp - bIp;
    const aDue = _parseTs(a.duedate) || Number.POSITIVE_INFINITY;
    const bDue = _parseTs(b.duedate) || Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return (b.originalEstimateSeconds || 0) - (a.originalEstimateSeconds || 0);
  });

  // verdict — основан на стопах + блокерах + WIP-overload
  const stops = (p?.stale || []).length || 0;
  const blockers = (p?.blockers || []).length || 0;
  const wipOver = tasks.length > 4;
  const verdict = computeVerdict({
    touched: tasks.length,
    typicalTouched: 3,
    stopsBeyond5d: stops,
    activeBlockers: blockers,
  });
  if (wipOver) {
    verdict.warnings = (verdict.warnings || []).concat(`WIP=${tasks.length} >4 — много контекста в работе`);
  }

  return {
    windowMsk: tz,
    tasks,
    verdict,
    counts: { total: tasks.length, fromWip: wip.length, fromSprint: sprintScope.length },
  };
}

/* ── Fact Yesterday ───────────────────────────────────────── */

/**
 * Строит «Факт вчера»:
 *   { jiraTasks: [{ key, title, activities[], rationale[] }],
 *     orphans, volume, verdict, byActivityType }
 * Источники: events (timelineYesterday), bb-items, cf-items —
 * фильтрованные по МСК-вчера, привязанные к Jira.
 */
export function buildFactYesterday(p, model, opts = {}) {
  const tz = computeMoscowDayBoundaries(opts.now || Date.now());
  const yStart = tz.yesterdayStart, yEnd = tz.yesterdayEnd;

  // Все активности — события + bb + cf
  const inWindow = (arr) => (arr || []).filter(it => {
    const ts = _parseTs(it?.at || it?.ts);
    return ts >= yStart && ts < yEnd;
  });
  const events = inWindow(p?.timelineYesterday).concat(
    // если timelineToday содержит ранние утренние события (после полуночи МСК) — учитываем
    inWindow(p?.timelineToday)
  );
  const bb = inWindow(p?.bbItems);
  const cf = inWindow(p?.cfItems);

  // Соберём pool активностей в унифицированной форме
  const pool = [];
  for (const e of events) {
    pool.push({
      kind: e.kind || 'jira-event',
      title: e?.issue?.summary || e?.text || '',
      text: e?.text || '',
      at: e.at || '',
      ts: _parseTs(e.at),
      issueKey: e?.issue?.key || '',
      _src: 'jira',
    });
  }
  for (const it of bb) {
    pool.push({
      kind: it.kind || 'commit',
      title: it.title || '',
      repo: it.repo || '',
      branch: it.branch || '',
      at: it.at || '',
      ts: _parseTs(it.at),
      issueKey: it.issueKey || '',
      _src: 'bb',
    });
  }
  for (const it of cf) {
    pool.push({
      kind: it.kind || 'cf-edit',
      title: it.title || '',
      space: it.spaceName || it.spaceKey || '',
      at: it.at || '',
      ts: _parseTs(it.at),
      issueKey: it.issueKey || '',
      _src: 'cf',
    });
  }

  // Attribution
  const knownKeys = []
    .concat((p?.issuesNow || []).map(t => t.key))
    .concat((p?.stale || []).map(t => t.key));
  const attrib = attributeActivitiesToJira(pool, knownKeys);

  // Группировка по jira-задачам
  const knownByKey = new Map();
  for (const t of (p?.issuesNow || [])) knownByKey.set(t.key, t);
  for (const t of (p?.stale || []))     if (!knownByKey.has(t.key)) knownByKey.set(t.key, t);

  const jiraTasks = [];
  for (const [key, acts] of Object.entries(attrib.byKey)) {
    const task = knownByKey.get(key) || { key, summary: '(не в WIP)', _outsideWip: true };
    const factRationale = [];
    factRationale.push(`Привязка через ${acts.length} актив${acts.length === 1 ? 'ность' : 'ности'} с упоминанием ключа ${key}`);
    if (!task._outsideWip) factRationale.push('Задача в текущем WIP сотрудника');
    if (acts.some(a => a._src === 'bb')) factRationale.push('Есть код-активность (Bitbucket)');
    if (acts.some(a => a._src === 'jira')) factRationale.push('Есть Jira-события (комменты/транзишены)');
    if (acts.some(a => a.kind === 'closed')) factRationale.push('Задача закрыта вчера — кандидат на «перевыполнение»');

    jiraTasks.push({
      key, title: task.summary || task.title || '',
      status: task.status || '',
      activities: acts.map(a => ({
        kind: a.kind,
        text: a.title || a.text,
        at: a.at,
        _src: a._src,
        rationale: _factRationale(a, yStart, yEnd),
      })),
      rationale: factRationale,
      outsideWip: !!task._outsideWip,
    });
  }
  jiraTasks.sort((a, b) => b.activities.length - a.activities.length);

  // Volume breakdown с EMA-14d
  const ema14 = opts.ema14 || {};
  const counts = {
    commits:  bb.filter(it => (it.kind || 'commit') === 'commit').length,
    prs:      bb.filter(it => it.kind === 'pr').length,
    reviews:  bb.filter(it => it.kind === 'review').length,
    cfEdits:  cf.length,
    jiraEvents: events.length,
    closed:   events.filter(e => e.kind === 'closed').length,
  };
  const volume = {
    commits: classifyVolume(counts.commits, ema14.commits, 'commits'),
    prs:     classifyVolume(counts.prs, ema14.prs, 'prs'),
    reviews: classifyVolume(counts.reviews, ema14.reviews, 'reviews'),
    closed:  classifyVolume(counts.closed, ema14.closed, 'closed'),
    raw: counts,
  };

  const verdict = computeVerdict({
    velocityZ: volume.commits.z,
    touched: jiraTasks.length,
    typicalTouched: ema14.touched?.mean || 2,
    closed: counts.closed,
    typicalClosed: ema14.closed?.mean || 0.5,
    stopsBeyond5d: (p?.stale || []).length,
    activeBlockers: (p?.blockers || []).length,
  });

  return {
    windowMsk: { yesterdayStart: yStart, yesterdayEnd: yEnd },
    jiraTasks,
    orphans: attrib.orphans,
    volume,
    verdict,
  };
}

/* ── 72h Summary ──────────────────────────────────────────── */

/**
 * Сводка за 72ч — комбинирует план+факт+общий вердикт.
 * Возвращает данные без LLM, готовые к рендеру.
 */
export function build72hSummary(p, model, opts = {}) {
  const plan = buildPlanToday(p, model, opts);
  const fact = buildFactYesterday(p, model, opts);
  // overall verdict — компромисс между plan и fact
  const codes = [plan.verdict?.code, fact.verdict?.code].filter(Boolean);
  let overallCode = 'unknown';
  if (codes.includes('behind'))          overallCode = 'behind';
  else if (codes.every(c => c === 'overperforming')) overallCode = 'overperforming';
  else if (codes.includes('on_plan'))    overallCode = 'on_plan';
  const overall = {
    label: VERDICT_LABELS[overallCode],
    code:  overallCode,
    drivers: [
      `Плановых задач: ${plan.counts.total}`,
      `Активных задач во вчера: ${fact.jiraTasks.length}`,
      `Orphan-активностей: ${fact.orphans.length}`,
      fact.volume.commits.confidence === 'heuristic'
        ? `Объём по коммитам: ${fact.volume.commits.label} (${fact.volume.raw.commits} — по эвристическим нормам)`
        : `Объём по коммитам: ${fact.volume.commits.label} (${fact.volume.raw.commits} vs ${fact.volume.commits.baseline} EMA-14d)`,
    ],
  };
  return { plan, fact, overall };
}

/* ── Helpers ──────────────────────────────────────────────── */

function _indexLastTouch(p) {
  const idx = Object.create(null);
  const stamp = (key, atRaw) => {
    if (!key) return;
    const t = _parseTs(atRaw);
    if (!t) return;
    if (!idx[key] || idx[key] < t) idx[key] = t;
  };
  for (const e of (p?.timelineToday || []))     stamp(e?.issue?.key, e?.at);
  for (const e of (p?.timelineYesterday || [])) stamp(e?.issue?.key, e?.at);
  for (const it of (p?.bbItems || []))          stamp(it.issueKey, it.at);
  return idx;
}

export const _internal = { JIRA_KEY_RX, VERDICT_LABELS, VOLUME_LABELS };
