'use strict';
/* ============================================================
   TONE-OF-VOICE LINT — AU5 (AUDIT_HOLISTIC)
   Post-processor middleware для LLM-output перед показом в чате.

   Цель: соблюдение брендбука §7 «Tone of voice»:
     спокойный · точный · тёплый · уверенный.
     Без эмодзи. Партнёр, не учитель. На «вы».

   Связанные паттерны AUDIT_HOLISTIC:
   - Pattern 2 (строка 25): 17+ эмодзи в LLM-промптах / fallback-копи
                             нарушают «no-emoji» в production UI.
   - Pattern 10 (строка 33): фраза «Курс сверен/не сверен» девальвирована —
                             используется в 23 местах.

   API:
     lintLlmOutput(text, opts?) → { text, warnings: [{rule, snippet, hint?}] }
     applyDefaultLint(text)     → автоматически удаляет эмодзи (R1) и
                                  возвращает warnings по остальным правилам.

   Mode (opt-in, через localStorage):
     localStorage['prizma.llm.lint'] = 'on' | 'off' | 'warn-only' (default)
       'off'       → no-op (passthrough), warnings = []
       'warn-only' → текст не модифицируется, только warnings (default)
       'on'        → R1 удаляется, остальные — warnings

   Правила (по умолчанию все включены, можно отключать через opts.disable):
     R1 emoji          — Unicode-emoji + surrogate pairs.       Action: strip.
     R2 anglicisms     — task/blocker/scope/release/sprint/...   Action: warn.
     R3 kurs_overuse   — «Курс сверен» > 1 раз в одном ответе.   Action: warn.
     R4 shouty         — !!! / ВНИМАНИЕ! / СРОЧНО / Действуйте.  Action: warn.
     R5 ty_form        — «привет / делай / возьми / напиши …».    Action: warn.

   Все правила — pure functions, без I/O, без DOM, без globals
   (кроме безопасного try/catch на localStorage).
   ============================================================ */

/* ── Mode resolver ───────────────────────────────────────── */

const MODE_KEY = 'prizma.llm.lint';
const MODE_OFF = 'off';
const MODE_ON  = 'on';
const MODE_WARN = 'warn-only';

export function getLintMode() {
  try {
    const v = (typeof localStorage !== 'undefined') ? localStorage.getItem(MODE_KEY) : null;
    if (v === MODE_OFF || v === MODE_ON || v === MODE_WARN) return v;
  } catch (_) { /* private mode / SSR */ }
  return MODE_WARN;  // default: not pollutes UX, only logs
}

/* ── Regex / helpers ─────────────────────────────────────── */

/* R1 — Emoji.
   Покрываем основные Unicode-блоки, surrogate-pairs (U+D800-DBFF лидер)
   и variation selectors. Намеренно НЕ ловим математические символы (×, ±)
   и стрелки (→, ↻ — последняя используется в `chatUIRenderer`
   для action-prefix), т.к. они допустимы в UI. */
// Symbols & Pictographs (U+1F300-1F5FF), Emoticons (U+1F600-1F64F),
// Transport & Map (U+1F680-1F6FF), Misc Symbols (U+2600-26FF, кроме
// допустимых стрелок), Dingbats (U+2700-27BF), Supplemental Symbols
// (U+1F900-1F9FF), Flags (U+1F1E6-1F1FF), Variation selectors (U+FE0F),
// Skin tones (U+1F3FB-1F3FF), Zero-width joiner (U+200D).
const RE_EMOJI = /(?:[✀-➿]|\uD83C[\uDDE6-\uDDFF]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF]|[☀-⛿])[️‍\uD83C-􏰀-\uDFFF]*/g;

/* R2 — Английские термины (минимальный словарь).
   Слово целиком (\b), case-insensitive. Suggest — русский эквивалент. */
const ANGLICISMS = [
  { en: 'task',     ru: 'задача' },
  { en: 'tasks',    ru: 'задачи' },
  { en: 'blocker',  ru: 'блокер / препятствие' },
  { en: 'blockers', ru: 'блокеры' },
  { en: 'scope',    ru: 'объём / границы' },
  { en: 'release',  ru: 'релиз' },
  { en: 'sprint',   ru: 'спринт' },
  { en: 'standup',  ru: 'стендап' },
  { en: 'stand-up', ru: 'стендап' },
  { en: 'milestone',ru: 'веха' },
  { en: 'backlog',  ru: 'бэклог' },
  { en: 'deadline', ru: 'срок' },
  { en: 'feature',  ru: 'фича / функция' },
  { en: 'roadmap',  ru: 'дорожная карта' },
  { en: 'PR',       ru: 'pull-request / запрос на слияние' },
];
// Compile once. \b в JS работает по ASCII — для en→ru это ок.
const RE_ANGLICISMS = ANGLICISMS.map(a => ({
  rx: new RegExp(`\\b${a.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
  en: a.en,
  ru: a.ru,
}));

/* R3 — «Курс сверен» overuse. Мы не запрещаем фразу — она брендовая,
   но при > 1 повторении в одном ответе теряет вес (см. AUDIT_HOLISTIC §10). */
const RE_KURS = /курс\s+сверен/gi;

/* R4 — «кричащие» формы.
   - !!! и больше      → визуальный крик
   - ВНИМАНИЕ! / ВАЖНО!→ all-caps + восклицание (3+ заглавных подряд)
   - СРОЧНО            → давление
   - «Действуйте сейчас» / «Не подведите команду» — манипулятивные триггеры. */
// JS \b — ASCII-only, поэтому для Cyrillic используем lookaround на «не-букву».
const RE_SHOUTY = [
  { rx: /!{3,}/g,                                                 hint: 'двойного-тройного «!» лучше избегать' },
  { rx: /(?:^|[^A-Za-zА-Яа-яЁё])(ВНИМАНИЕ|ВАЖНО|СРОЧНО)(?:!|(?=[^A-Za-zА-Яа-яЁё])|$)/g, hint: 'all-caps воспринимается как крик; используйте обычный регистр' },
  { rx: /действуйте\s+сейчас/gi,                                  hint: 'давление; смягчите формулировку' },
  { rx: /не\s+подведите\s+команду/gi,                             hint: 'манипуляция через стыд' },
];

/* R5 — «ты»-форма. Список характерных «ты»-маркеров (формы императива
   и обращения). Мы матчим только частые случаи — не ловим контекстные
   совпадения вроде «делай-тся». Используем \b и пробельную границу. */
const RE_TY = [
  { rx: /(?:^|[\s,;.:!?(])(привет)(?=[\s,;.:!?)]|$)/gi,            hint: '«привет» → «здравствуйте»' },
  { rx: /(?:^|[\s,;.:!?(])(пока)(?=[\s,;.:!?)]|$)/gi,              hint: '«пока» → «до встречи / всего доброго»' },
  { rx: /(?:^|[\s,;.:!?(])(делай|сделай)(?=[\s,;.:!?)]|$)/gi,      hint: 'императив на «ты» → форма на «вы» («сделайте»)' },
  { rx: /(?:^|[\s,;.:!?(])(возьми|бери)(?=[\s,;.:!?)]|$)/gi,       hint: 'императив на «ты» → «возьмите»' },
  { rx: /(?:^|[\s,;.:!?(])(напиши)(?=[\s,;.:!?)]|$)/gi,            hint: 'императив на «ты» → «напишите»' },
  { rx: /(?:^|[\s,;.:!?(])(посмотри)(?=[\s,;.:!?)]|$)/gi,          hint: 'императив на «ты» → «посмотрите»' },
  { rx: /(?:^|[\s,;.:!?(])(скажи)(?=[\s,;.:!?)]|$)/gi,             hint: 'императив на «ты» → «скажите»' },
  { rx: /(?:^|[\s,;.:!?(])(ты\s+(?:можешь|должен|видишь|хочешь))(?=[\s,;.:!?)]|$)/gi, hint: 'обращение на «ты» → форма на «вы»' },
];

/* ── Rule runners ────────────────────────────────────────── */

function _snippet(text, idx, len) {
  const start = Math.max(0, idx - 12);
  const end   = Math.min(text.length, idx + len + 12);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** Проверка R1 — эмодзи. Возвращает {newText, warnings}.
 *  Если strip=true — удаляет, иначе только warning'и. */
function checkEmoji(text, strip) {
  const warnings = [];
  let newText = text;
  RE_EMOJI.lastIndex = 0;
  let m;
  while ((m = RE_EMOJI.exec(text)) !== null) {
    warnings.push({ rule: 'R1', snippet: _snippet(text, m.index, m[0].length), match: m[0] });
    if (m[0] === '') break;  // safety
  }
  if (strip && warnings.length) {
    // V21 — двух-проходный strip: эмодзи + возникающие двойные пробелы.
    newText = newText.replace(RE_EMOJI, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:!?])/g, '$1').trimEnd();
  }
  return { text: newText, warnings };
}

function checkAnglicisms(text) {
  const warnings = [];
  for (const { rx, en, ru } of RE_ANGLICISMS) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text)) !== null) {
      warnings.push({
        rule: 'R2',
        snippet: _snippet(text, m.index, m[0].length),
        match: m[0],
        hint: `«${en}» → «${ru}»`,
      });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  return warnings;
}

function checkKursOveruse(text) {
  const warnings = [];
  RE_KURS.lastIndex = 0;
  const matches = text.match(RE_KURS) || [];
  if (matches.length > 1) {
    warnings.push({
      rule: 'R3',
      snippet: `${matches.length}× «Курс сверен»`,
      match: matches[0],
      hint: 'фраза девальвирована (см. AUDIT_HOLISTIC §10) — оставьте 1 раз; для остальных используйте нейтральные success-формулы',
    });
  }
  return warnings;
}

function checkShouty(text) {
  const warnings = [];
  for (const { rx, hint } of RE_SHOUTY) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text)) !== null) {
      warnings.push({
        rule: 'R4',
        snippet: _snippet(text, m.index, m[0].length),
        match: m[0],
        hint,
      });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  return warnings;
}

function checkTyForm(text) {
  const warnings = [];
  for (const { rx, hint } of RE_TY) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text)) !== null) {
      // m[1] — слово без ведущего разделителя
      const matched = m[1] || m[0];
      const idx = m.index + (m[0].length - matched.length);
      warnings.push({
        rule: 'R5',
        snippet: _snippet(text, idx, matched.length),
        match: matched,
        hint,
      });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  return warnings;
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Lint LLM output по всем правилам.
 *
 * @param {string} text - сырой текст ответа LLM (после markdown-парсинга).
 * @param {object} [opts]
 * @param {boolean} [opts.stripEmoji=false] - если true, эмодзи удаляются
 *                  (применяется в `applyDefaultLint`). Default false:
 *                  warnings only, текст не модифицируется.
 * @param {{R1?:boolean,R2?:boolean,R3?:boolean,R4?:boolean,R5?:boolean}} [opts.disable]
 *                  - явное отключение конкретных правил (для тестов / opt-out).
 * @returns {{ text: string, warnings: Array<{rule:string,snippet:string,match?:string,hint?:string}> }}
 */
export function lintLlmOutput(text, opts) {
  const safeText = (typeof text === 'string') ? text : String(text ?? '');
  if (!safeText) return { text: safeText, warnings: [] };

  const o = opts || {};
  const disable = o.disable || {};
  const stripEmoji = !!o.stripEmoji;
  const warnings = [];
  let out = safeText;

  if (!disable.R1) {
    const r = checkEmoji(out, stripEmoji);
    out = r.text;
    warnings.push(...r.warnings);
  }
  if (!disable.R2) warnings.push(...checkAnglicisms(out));
  if (!disable.R3) warnings.push(...checkKursOveruse(out));
  if (!disable.R4) warnings.push(...checkShouty(out));
  if (!disable.R5) warnings.push(...checkTyForm(out));

  return { text: out, warnings };
}

/**
 * Default lint (используется как middleware в `chatUIRenderer`):
 *   - режим определяется через `localStorage['prizma.llm.lint']`:
 *       'off'        → no-op
 *       'on'         → удаляет эмодзи, остальное — warnings
 *       'warn-only'  → не модифицирует текст, только warnings (default)
 *
 * Логирование warnings оставляется вызывающей стороне (renderer пишет в
 * console.debug или telemetry).
 *
 * @param {string} text
 * @returns {{ text: string, warnings: Array, mode: string }}
 */
export function applyDefaultLint(text) {
  const mode = getLintMode();
  if (mode === MODE_OFF) {
    return { text: (typeof text === 'string') ? text : String(text ?? ''), warnings: [], mode };
  }
  const stripEmoji = (mode === MODE_ON);
  const { text: outText, warnings } = lintLlmOutput(text, { stripEmoji });
  return { text: outText, warnings, mode };
}

/* Экспортируем константы для тестов / внешних редакторов. */
export const _internal = {
  ANGLICISMS,
  RE_EMOJI,
  RE_KURS,
  MODE_KEY, MODE_ON, MODE_OFF, MODE_WARN,
};
