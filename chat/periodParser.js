'use strict';
/* ============================================================
   chat/periodParser.js — V22+ Week 1 (P-01..P-04)

   Парсинг периодов времени из свободного русского/английского текста.
   Возвращает нормализованный объект {from, to, label, mode}.

   ── Поддерживаемые синтаксисы ─────────────────────────────────

   1. Базовые keyword'ы (rolling — относительно сегодня):
        «сегодня», «вчера», «позавчера»
        «за неделю», «за прошлую неделю», «за 2 недели»
        «за месяц», «за квартал», «за полугодие», «за год»
        «за последние 30 дней», «за последние 3 месяца»

   2. Календарные периоды (mode='calendar'):
        «в марте», «март 2026», «январь»
        «Q1», «Q1 2026», «во втором квартале»
        «в 2025», «2024 год»
        «эта неделя», «этот месяц», «этот квартал», «этот год»
        «прошлая неделя», «прошлый месяц», «прошлый квартал», «прошлый год»

   3. Custom range:
        «с 1 марта по 15 апреля»
        «с 2026-03-01 по 2026-04-15»
        «01.03.2026–15.04.2026»

   ── ВАЖНО: regex и кириллица ──────────────────────────────────
   В JS regex `\w` = `[a-zA-Z0-9_]` (без Cyrillic) и `\b` между Cyrillic
   буквами не fires. Поэтому все «word» классы — `[а-яёa-z0-9_]+`
   (или `\p{L}` с `/u` флагом), а вместо `\b` — explicit `(?:^|[^а-яёa-z0-9])`.

   ── Возвращаемый формат ───────────────────────────────────────

   {
     from:   Date | null,
     to:     Date | null,   // exclusive (next-day 00:00:00)
     label:  string,        // human-readable
     mode:   'rolling' | 'calendar' | 'custom' | 'sprint' | 'unknown',
     keywordMatched: string
   }
   ============================================================ */

const CW = '[а-яёa-zа-яёА-ЯЁA-Zё0-9_]'; // Cyrillic+Latin word char class

const RU_MONTHS = {
  'январ': 0, 'феврал': 1, 'март': 2, 'апрел': 3,
  'мая': 4, 'мае': 4, 'май': 4,
  'июн': 5, 'июл': 6, 'август': 7, 'сентябр': 8,
  'октябр': 9, 'ноябр': 10, 'декабр': 11,
  'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
  'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11,
};
const RU_MONTH_NAMES = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function startOfDay(d) { const o = new Date(d.getTime()); o.setHours(0, 0, 0, 0); return o; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function startOfQuarter(d) { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1, 0, 0, 0, 0); }
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0); }
function startOfWeek(d) {
  const o = startOfDay(d);
  const dow = o.getDay() || 7;
  if (dow > 1) o.setDate(o.getDate() - (dow - 1));
  return o;
}
function addDays(d, n) { const o = new Date(d.getTime()); o.setDate(o.getDate() + n); return o; }
function addMonths(d, n) { const o = new Date(d.getTime()); o.setMonth(o.getMonth() + n); return o; }

function _resolveMonthName(name) {
  if (!name) return -1;
  const lc = String(name).toLowerCase();
  for (const key of Object.keys(RU_MONTHS).sort((a, b) => b.length - a.length)) {
    if (lc.startsWith(key)) return RU_MONTHS[key];
  }
  return -1;
}

function _period(from, to, label, mode = 'rolling', keywordMatched = '') {
  return { from, to, label, mode, keywordMatched };
}

/**
 * @param {string} text
 * @param {object} opts  — { now?: Date }
 * @returns {object|null} period | null
 */
export function parsePeriod(text, opts = {}) {
  if (!text || typeof text !== 'string') return null;
  const now = opts.now || new Date();
  const t = text.toLowerCase().trim();

  // ── 1. Custom date-range ────────────────────────────────────
  // ISO: «с 2026-03-01 по 2026-04-15»
  const isoRange = t.match(/с\s+(\d{4}-\d{2}-\d{2})\s+(?:по|до)\s+(\d{4}-\d{2}-\d{2})/);
  if (isoRange) {
    const from = new Date(isoRange[1] + 'T00:00:00');
    const to   = addDays(new Date(isoRange[2] + 'T00:00:00'), 1);
    if (!isNaN(from) && !isNaN(to)) {
      return _period(from, to, `с ${isoRange[1]} по ${isoRange[2]}`, 'custom', isoRange[0]);
    }
  }
  // DD.MM[.YYYY] range
  const ddmmRange = t.match(/(?:с\s+)?(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\s*[–—-]?\s*(?:по|до)?\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (ddmmRange && /по|до|–|—|-/.test(t)) {
    const fromY = ddmmRange[3] ? (ddmmRange[3].length === 2 ? 2000 + parseInt(ddmmRange[3], 10) : parseInt(ddmmRange[3], 10)) : now.getFullYear();
    const toY   = ddmmRange[6] ? (ddmmRange[6].length === 2 ? 2000 + parseInt(ddmmRange[6], 10) : parseInt(ddmmRange[6], 10)) : fromY;
    const from = new Date(fromY, parseInt(ddmmRange[2], 10) - 1, parseInt(ddmmRange[1], 10));
    const to   = addDays(new Date(toY, parseInt(ddmmRange[5], 10) - 1, parseInt(ddmmRange[4], 10)), 1);
    if (!isNaN(from) && !isNaN(to) && to > from) {
      return _period(from, to, `${ddmmRange[1]}.${ddmmRange[2]}–${ddmmRange[4]}.${ddmmRange[5]}`, 'custom', ddmmRange[0]);
    }
  }
  // «с 1 марта по 15 апреля»
  const ruRange = t.match(/с\s+(\d{1,2})\s+([а-яёa-z]+)(?:\s+(\d{4}))?\s+(?:по|до)\s+(\d{1,2})\s+([а-яёa-z]+)(?:\s+(\d{4}))?/);
  if (ruRange) {
    const fromMonth = _resolveMonthName(ruRange[2]);
    const toMonth   = _resolveMonthName(ruRange[5]);
    if (fromMonth >= 0 && toMonth >= 0) {
      const fromY = ruRange[3] ? parseInt(ruRange[3], 10) : now.getFullYear();
      const toY   = ruRange[6] ? parseInt(ruRange[6], 10) : fromY;
      const from = new Date(fromY, fromMonth, parseInt(ruRange[1], 10));
      const to   = addDays(new Date(toY, toMonth, parseInt(ruRange[4], 10)), 1);
      if (!isNaN(from) && !isNaN(to) && to > from) {
        return _period(from, to, `${ruRange[1]} ${RU_MONTH_NAMES[fromMonth]} — ${ruRange[4]} ${RU_MONTH_NAMES[toMonth]}`, 'custom', ruRange[0]);
      }
    }
  }

  // ── 2. Календарные периоды ──────────────────────────────────
  // «Q1 2026», «q3», «во втором/третьем квартале 2025»
  const qNumeric = t.match(/(?:^|[^а-яёa-z0-9])(?:q|кв)\s*([1-4])(?:\s+(\d{4}))?/);
  if (qNumeric) {
    const qIdx = parseInt(qNumeric[1], 10);
    const year = qNumeric[2] ? parseInt(qNumeric[2], 10) : now.getFullYear();
    const from = new Date(year, (qIdx - 1) * 3, 1);
    const to   = new Date(year, qIdx * 3, 1);
    return _period(from, to, `Q${qIdx} ${year}`, 'calendar', qNumeric[0].trim());
  }
  const qOrdinal = t.match(/в?\s*(перв|втор|трет|четв)[а-яё]*\s+квартал[а-яё]*(?:\s+(\d{4}))?/);
  if (qOrdinal) {
    const ord = qOrdinal[1];
    const qIdx = { 'перв': 1, 'втор': 2, 'трет': 3, 'четв': 4 }[ord];
    const year = qOrdinal[2] ? parseInt(qOrdinal[2], 10) : now.getFullYear();
    if (qIdx) {
      const from = new Date(year, (qIdx - 1) * 3, 1);
      const to   = new Date(year, qIdx * 3, 1);
      return _period(from, to, `Q${qIdx} ${year}`, 'calendar', qOrdinal[0].trim());
    }
  }

  // «эта/этот ... » / «прошл... » — ставим ДО month-match чтобы они
  // не сматчились как «в прошлом ...» (где «прошлом» — не месяц, но
  // monthMatch не вернул бы — однако оно делает overlap).
  if (/(?:эт[а-яё]*|текущ[а-яё]+)\s+недел/.test(t)) {
    const from = startOfWeek(now);
    return _period(from, addDays(from, 7), 'эта неделя', 'calendar', 'эта неделя');
  }
  if (/(?:эт[а-яё]*|текущ[а-яё]+)\s+мес/.test(t)) {
    const from = startOfMonth(now);
    return _period(from, addMonths(from, 1), 'этот месяц', 'calendar', 'этот месяц');
  }
  if (/(?:эт[а-яё]*|текущ[а-яё]+)\s+квартал/.test(t)) {
    const from = startOfQuarter(now);
    return _period(from, addMonths(from, 3), 'этот квартал', 'calendar', 'этот квартал');
  }
  if (/(?:эт[а-яё]*|текущ[а-яё]+)\s+год/.test(t)) {
    const from = startOfYear(now);
    return _period(from, new Date(from.getFullYear() + 1, 0, 1), 'этот год', 'calendar', 'этот год');
  }
  if (/прошл[а-яё]+\s+недел/.test(t)) {
    const start = addDays(startOfWeek(now), -7);
    return _period(start, addDays(start, 7), 'прошлая неделя', 'calendar', 'прошлая неделя');
  }
  if (/прошл[а-яё]+\s+мес/.test(t)) {
    const start = addMonths(startOfMonth(now), -1);
    return _period(start, startOfMonth(now), 'прошлый месяц', 'calendar', 'прошлый месяц');
  }
  if (/прошл[а-яё]+\s+квартал/.test(t)) {
    const start = addMonths(startOfQuarter(now), -3);
    return _period(start, startOfQuarter(now), 'прошлый квартал', 'calendar', 'прошлый квартал');
  }
  if (/прошл[а-яё]+\s+год/.test(t)) {
    const y = now.getFullYear() - 1;
    return _period(new Date(y, 0, 1), new Date(y + 1, 0, 1), `${y} год`, 'calendar', 'прошлый год');
  }

  // «в марте», «март 2026», «в мае 2025 года»
  const monthMatch = t.match(/(?:^|[^а-яёa-z])в\s+([а-яёa-z]+)(?:\s+(\d{4}))?(?:\s+год[а-яё]*)?/)
                  || t.match(/^([а-яёa-z]+)\s+(\d{4})(?:\s+год[а-яё]*)?$/);
  if (monthMatch) {
    const monthIdx = _resolveMonthName(monthMatch[1]);
    if (monthIdx >= 0) {
      const year = monthMatch[2] ? parseInt(monthMatch[2], 10) : now.getFullYear();
      const from = new Date(year, monthIdx, 1);
      const to   = new Date(year, monthIdx + 1, 1);
      return _period(from, to, `${RU_MONTH_NAMES[monthIdx]} ${year}`, 'calendar', monthMatch[0].trim());
    }
  }

  // «в 2025», «2024 год», «за 2025 год»
  const yearMatch = t.match(/(?:в|за)\s+(\d{4})(?:\s+год[а-яё]*)?/)
                 || t.match(/^(\d{4})\s+год[а-яё]*$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year >= 2000 && year <= 2100) {
      const from = new Date(year, 0, 1);
      const to   = new Date(year + 1, 0, 1);
      return _period(from, to, `${year} год`, 'calendar', yearMatch[0].trim());
    }
  }

  // ── 3. Rolling периоды («за N дней/недель/месяцев/лет») ────
  // ВАЖНО: порядок alternation: длиннее unit'ы ПЕРВЫМИ (полугоди → квартал → год → мес → недел → дн).
  // Иначе «недели» сматчится по «дн» (бывает на substring «од» в …), но мы используем явные prefix'ы.
  const rollingMatch = t.match(/за\s+(?:последн[а-яё]+\s+)?(\d+|один|одну|два|три|четыре|пять|шесть)?\s*(полугоди[а-яё]*|квартал[а-яё]*|месяц[а-яё]*|мес[а-яё]*|недел[а-яё]*|год[а-яё]*|лет|дн[а-яё]*)/);
  if (rollingMatch) {
    const wordToNum = { 'один': 1, 'одну': 1, 'два': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6 };
    const n = rollingMatch[1]
      ? (wordToNum[rollingMatch[1]] || parseInt(rollingMatch[1], 10) || 1)
      : 1;
    const unit = rollingMatch[2];
    let days = 0, label = '';
    if (/^полугоди/.test(unit))    { days = n * 182; label = n === 1 ? 'за полугодие' : `за ${n} полугодий`; }
    else if (/^квартал/.test(unit)){ days = n * 90;  label = n === 1 ? 'за квартал'  : `за ${n} кв.`; }
    else if (/^месяц|^мес/.test(unit)){ days = n * 30; label = n === 1 ? 'за месяц'   : `за ${n} мес.`; }
    else if (/^недел/.test(unit))  { days = n * 7;   label = n === 1 ? 'за неделю'   : `за ${n} нед.`; }
    else if (/^год|^лет/.test(unit)){ days = n * 365; label = n === 1 ? 'за год'      : `за ${n} лет`; }
    else if (/^дн/.test(unit))     { days = n;       label = n === 1 ? 'за день'      : `за ${n} дн.`; }
    if (days > 0) {
      const to = startOfDay(addDays(now, 1));
      const from = addDays(to, -days);
      return _period(from, to, label, 'rolling', rollingMatch[0].trim());
    }
  }

  // ── 4. Базовые keyword'ы (без `\b` для кириллицы) ──────────
  if (/(?:^|[^а-яёa-z])сегодня(?:[^а-яёa-z]|$)/.test(t)) {
    const from = startOfDay(now);
    return _period(from, addDays(from, 1), 'сегодня', 'rolling', 'сегодня');
  }
  if (/(?:^|[^а-яёa-z])вчера(?:[^а-яёa-z]|$)/.test(t)) {
    const yesterday = addDays(startOfDay(now), -1);
    return _period(yesterday, addDays(yesterday, 1), 'вчера', 'rolling', 'вчера');
  }
  if (/(?:^|[^а-яёa-z])позавчера(?:[^а-яёa-z]|$)/.test(t)) {
    const d = addDays(startOfDay(now), -2);
    return _period(d, addDays(d, 1), 'позавчера', 'rolling', 'позавчера');
  }

  // «спринт» — пока fallback на 2 недели.
  if (/спринт/.test(t)) {
    const to = startOfDay(addDays(now, 1));
    return _period(addDays(to, -14), to, 'за спринт', 'sprint', 'спринт');
  }

  return null;
}

/** Distance в днях между from и to. */
export function periodDays(period) {
  if (!period || !period.from || !period.to) return 0;
  return Math.round((period.to.getTime() - period.from.getTime()) / 86400_000);
}

/** Default — последние 7 дней. Используется builders как
 *  `parsePeriod(text) || defaultPeriod()`. */
export function defaultPeriod(opts = {}) {
  const now = opts.now || new Date();
  const to = startOfDay(addDays(now, 1));
  return _period(addDays(to, -7), to, 'за неделю', 'rolling', '__default__');
}

/** Compute previous period (для comparison-quеries). */
export function previousPeriod(period) {
  if (!period || !period.from || !period.to) return null;
  const length = period.to.getTime() - period.from.getTime();
  const prevTo = new Date(period.from.getTime());
  const prevFrom = new Date(period.from.getTime() - length);
  return _period(prevFrom, prevTo, `${period.label} (предыдущий)`, period.mode, 'previous');
}
