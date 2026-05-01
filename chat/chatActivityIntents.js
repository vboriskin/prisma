'use strict';
/* ============================================================
   CHAT ACTIVITY INTENTS — V13
   --
   Intent classification for "activity" queries (про сотрудников):
     · ACTIVITY_NOW       — "что сейчас делает X"
     · ACTIVITY_DAY       — "что делал X сегодня / вчера / в день N"
     · ACTIVITY_COMPARE   — "сравни X и Y", "топ за неделю"
     · ACTIVITY_BY_ISSUE  — "кто работал над PROJ-1234"
     · ACTIVITY_FEED      — "лента событий X в день N"
     · ACTIVITY_TEAM      — "сводка по команде за вчера"

   Pure functions — no IO.

   Параметры извлекаются эвристиками: regex на ключи задач, regex на
   относительные даты, fuzzy-match на имена сотрудников из переданного
   списка known-employees.
   ============================================================ */

/** Intent constants. */
export const ACTIVITY_INTENTS = {
  NOW:       'activity_now',
  DAY:       'activity_day',
  COMPARE:   'activity_compare',
  BY_ISSUE:  'activity_by_issue',
  FEED:      'activity_feed',
  TEAM:      'activity_team',
  GENERIC:   'activity_generic',     // matched "активность" but no specific shape
};

/* ────────────────────────────────────────────────────────────
   Pattern rules — first-match-wins, ordered by specificity.
   ──────────────────────────────────────────────────────────── */

const RULES = [
  // "что сейчас делает X" / "над чем работает прямо сейчас"
  {
    intent: ACTIVITY_INTENTS.NOW,
    patterns: [
      /(?:что|чем).{0,20}сейчас.{0,20}(?:делает|занимается|занят|работает)/iu,
      /(?:над).{0,10}(?:чем|какой).{0,20}(?:сейчас|прямо.?сейчас).{0,20}работает/iu,
      /(?:что|чем).{0,15}(?:он[а]?|они).{0,15}(?:сейчас|прямо.?сейчас)/iu,
      /последн.{0,15}активност/iu,
      /активн.{0,15}сейчас/iu,
    ],
  },
  // "сравни X и Y" / "топ за неделю" — analytical
  {
    intent: ACTIVITY_INTENTS.COMPARE,
    patterns: [
      /(?:^|[^а-яёa-z0-9])сравн[ие]/iu,
      /(?:^|[^а-яёa-z0-9])топ(?:[- ]?\d+)?(?![а-яёa-z0-9])/iu,
      /кто (?:больше|меньше|чаще|активнее)/iu,
      /у кого (?:больше|меньше)/iu,
      /рейтинг.{0,15}(?:сотрудник|инжен)/iu,
    ],
  },
  // "кто работал над PROJ-1234"
  {
    intent: ACTIVITY_INTENTS.BY_ISSUE,
    patterns: [
      /кто (?:работал|трогал|двигал|менял).{0,20}[A-Z][A-Z0-9]+-\d+/iu,
      /активность.{0,15}по.{0,10}задаче.{0,5}[A-Z][A-Z0-9]+-\d+/iu,
      /[A-Z][A-Z0-9]+-\d+.{0,30}(?:кто|участник)/iu,
    ],
  },
  // "лента событий X в Y" / "хронология"
  {
    intent: ACTIVITY_INTENTS.FEED,
    patterns: [
      /(?:^|[^а-яёa-z0-9])лент[ау].{0,20}событ/iu,
      /(?:^|[^а-яёa-z0-9])хронолог/iu,
      /(?:^|[^а-яёa-z0-9])пошагово.{0,30}(?:что|как)/iu,
      /(?:^|[^а-яёa-z0-9])полн.{0,15}актив/iu,
    ],
  },
  // "сводка по команде" / "team summary"
  {
    intent: ACTIVITY_INTENTS.TEAM,
    patterns: [
      /сводк[ауи].{0,20}(?:по )?команд/iu,
      /команд.{0,20}за (?:сегодня|вчера|неделю|день)/iu,
      /все сотрудники.{0,15}(?:сегодня|вчера)/iu,
    ],
  },
  // "что делал X в день N" / "что делал X сегодня"
  {
    intent: ACTIVITY_INTENTS.DAY,
    patterns: [
      /(?:что|чем).{0,20}(?:делал[аи]?|занимал[ас]ь?).{0,30}(?:сегодня|вчера|позавчера)/iu,
      /(?:что|чем).{0,15}(?:сегодня|вчера|позавчера)/iu,
      /активность.{0,15}(?:вчера|сегодня|за день|за неделю)/iu,
      /что было сделано/iu,
    ],
  },
  // generic "активность <name>"
  {
    intent: ACTIVITY_INTENTS.GENERIC,
    patterns: [
      /активност/iu,           // intentionally no boundary — single keyword
    ],
  },
];

/**
 * Classify a free-form Russian query into an activity intent.
 * Returns { intent, confidence }.
 */
export function classifyActivityIntent(text) {
  if (!text || typeof text !== 'string') return { intent: null, confidence: 0 };
  const t = text.trim();
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(t)) return { intent: rule.intent, confidence: 0.85 };
    }
  }
  return { intent: null, confidence: 0 };
}

/* ────────────────────────────────────────────────────────────
   Parameter extraction — даты, ключи задач, имена.
   ──────────────────────────────────────────────────────────── */

/**
 * Extract a single Jira issue key (PROJ-1234) from text. First match wins.
 * Returns '' if none found.
 */
export function extractIssueKey(text) {
  const m = String(text || '').match(/\b([A-Z][A-Z0-9_]*-\d+)\b/);
  return m ? m[1] : '';
}

/**
 * Extract a relative date reference. Supported:
 *   · сегодня / today          → 'today'
 *   · вчера / yesterday        → 'yesterday'
 *   · позавчера                → 'dayBefore'
 *   · в понедельник…воскресенье → 'mon'..'sun'
 *   · на прошлой неделе        → 'lastWeek'
 *   · за неделю / week         → 'week'
 *   · конкретная дата dd.mm    → ISO 'YYYY-MM-DD' (resolved against current year)
 * Returns '' when nothing matched.
 */
export function extractRelativeDate(text) {
  const t = String(text || '').toLowerCase();
  // Cyrillic-aware boundaries — same fix as in chatIntentParser (V12).
  if (/(?:^|[^а-яёa-z0-9])(сегодня|today)(?![а-яёa-z0-9])/iu.test(t))   return 'today';
  if (/(?:^|[^а-яёa-z0-9])(вчера|yesterday)(?![а-яёa-z0-9])/iu.test(t)) return 'yesterday';
  if (/(?:^|[^а-яёa-z0-9])позавчера(?![а-яёa-z0-9])/iu.test(t))         return 'dayBefore';
  if (/прошл.{0,5}недел/i.test(t) || /\blast.?week\b/i.test(t)) return 'lastWeek';
  if (/за.{0,10}недел/i.test(t) || /\bthis.?week\b/i.test(t))   return 'week';
  // Day-of-week
  const dows = [
    [/в.{0,5}понедельник|monday/iu, 'mon'],
    [/в.{0,5}вторник|tuesday/iu,    'tue'],
    [/в.{0,5}сред[уа]|wednesday/iu, 'wed'],
    [/в.{0,5}четверг|thursday/iu,   'thu'],
    [/в.{0,5}пятниц[уа]|friday/iu,  'fri'],
    [/в.{0,5}суббот[уа]|saturday/iu,'sat'],
    [/в.{0,5}воскресень[ея]|sunday/iu,'sun'],
  ];
  for (const [rx, key] of dows) if (rx.test(t)) return key;
  // Explicit dd.mm[.yyyy]
  const m = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (m) {
    const dd = m[1].padStart(2,'0');
    const mm = m[2].padStart(2,'0');
    const yy = (m[3] && m[3].length === 2) ? '20' + m[3] : (m[3] || String(new Date().getFullYear()));
    return `${yy}-${mm}-${dd}`;
  }
  return '';
}

/**
 * Resolve a relative-date label to an actual Date range.
 * Returns { fromIso, toIso, label } or null when not resolvable.
 */
export function resolveDateRange(rel, now = new Date()) {
  const day = 24 * 3600 * 1000;
  const start = new Date(now); start.setHours(0,0,0,0);
  const t0 = start.getTime();
  switch (rel) {
    case 'today':     return { fromIso: new Date(t0).toISOString(),         toIso: new Date(t0 + day).toISOString(), label: 'сегодня' };
    case 'yesterday': return { fromIso: new Date(t0 - day).toISOString(),   toIso: new Date(t0).toISOString(),       label: 'вчера' };
    case 'dayBefore': return { fromIso: new Date(t0 - 2*day).toISOString(), toIso: new Date(t0 - day).toISOString(), label: 'позавчера' };
    case 'week':      return { fromIso: new Date(t0 - 7*day).toISOString(), toIso: new Date(t0 + day).toISOString(), label: 'за неделю' };
    case 'lastWeek':  return { fromIso: new Date(t0 - 14*day).toISOString(), toIso: new Date(t0 - 7*day).toISOString(), label: 'на прошлой неделе' };
    default: {
      // ISO format YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(rel)) {
        const d = new Date(rel + 'T00:00:00');
        if (!Number.isNaN(d.getTime())) return { fromIso: d.toISOString(), toIso: new Date(d.getTime() + day).toISOString(), label: rel };
      }
      // Day-of-week — past 7 days
      const dowMap = { mon:1, tue:2, wed:3, thu:4, fri:5, sat:6, sun:0 };
      if (dowMap[rel] !== undefined) {
        const target = dowMap[rel];
        const todayDow = start.getDay();
        let diff = todayDow - target;
        if (diff <= 0) diff += 7;
        const d = t0 - diff * day;
        return { fromIso: new Date(d).toISOString(), toIso: new Date(d + day).toISOString(), label: rel };
      }
      return null;
    }
  }
}

/**
 * Find employee names mentioned in text. Matches against `knownEmployees[]`
 * (list of {label, key, projects} entries). Returns array of matched
 * employee labels (preserves order of mention).
 *
 * Heuristic:
 *   1. Direct substring match (lowercased) of `label` in `text`.
 *   2. First-name only match if the surname's first 4 chars also appear
 *      anywhere in text.
 *   3. Email-username (anna.petrova) substring match on label.
 */
export function extractEmployees(text, knownEmployees) {
  if (!text || !Array.isArray(knownEmployees) || !knownEmployees.length) return [];
  const t = String(text).toLowerCase();
  const found = new Set();
  for (const e of knownEmployees) {
    const label = String(e.label || '').toLowerCase();
    if (!label) continue;
    if (t.includes(label)) { found.add(e.label); continue; }
    const tokens = label.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      // Match if both first AND surname-prefix in text (any order).
      const [first, surname] = tokens;
      if (t.includes(first) && surname.length >= 4 && t.includes(surname.slice(0, 4))) {
        found.add(e.label);
      }
    }
    // Email-style label: anna.petrova
    if (/[._]/.test(label) && t.includes(label.replace(/[._]/g, ' '))) {
      found.add(e.label);
    }
  }
  return Array.from(found);
}

/**
 * High-level: classify intent + extract all parameters in one call.
 * Returns { intent, params: { employees[], date, issueKey } }.
 */
export function parseActivityQuery(text, knownEmployees = []) {
  const { intent } = classifyActivityIntent(text);
  return {
    intent,
    params: {
      employees: extractEmployees(text, knownEmployees),
      date:      extractRelativeDate(text),
      issueKey:  extractIssueKey(text),
    },
  };
}
