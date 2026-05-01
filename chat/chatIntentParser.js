'use strict';
/* ============================================================
   CHAT INTENT PARSER — v10_0
   Pure functions — no imports, no side effects.
   ============================================================ */

export const INTENTS = {
  EXECUTIVE_SUMMARY: 'executive_summary',
  RELEASE_OVERVIEW:  'release_overview',
  TEAM_OVERVIEW:     'team_overview',
  MEETING_PREP:      'meeting_prep',
  ASK_PLAN:          'ask_plan',
  FILTER_TASKS:      'filter_tasks',
  RELEASE_NOTES:     'release_notes',
  WHAT_RISKS:        'what_risks',
  OVERLOAD:          'overload',
  REVIEW_MODE:       'review_mode',
  // Operations
  BATCH_ACTION:      'batch_action',
  FIND_TASKS:        'find_tasks',
  EXPLAIN:           'explain',
  DAILY_REPORT:      'daily_report',
  HISTORY:           'history',
  CLEAR_FILTERS:     'clear_filters',
  CONFIRM_BATCH:     'confirm_batch',
  CANCEL_BATCH:      'cancel_batch',
  GENERIC:           'generic',
};

const RULES = [
  // Executive summary / CEO update
  {
    intent: INTENTS.EXECUTIVE_SUMMARY,
    patterns: [
      /ceo.?(апдейт|обновление|отчёт|отчет|update)/i,
      // V12 fix (FOUND_BUGS #8): include accusative «сводку» and other endings.
      /сводк[аиуоей]/i,
      /краткий.?(статус|отчёт|отчет)/i,
      /краткая.?сводка/i,
      /краткий.?обзор/i,
      /общий.?(статус|обзор|итог)/i,
      /итог.{0,10}(релиз|sprint|спринт)/i,
      /что.{0,15}(происходит|сейчас|статус)/i,
      /executive.?summary/i,
      /сводка.{0,15}статус/i,
      /статус.{0,15}проект/i,
    ],
    extract: () => ({}),
  },
  // Release notes generation
  {
    intent: INTENTS.RELEASE_NOTES,
    patterns: [
      /release.?notes?/i,
      /заметки.{0,10}(релиз|выпуск)/i,
      /что.{0,10}(вышло|готово|сделано).{0,10}(в|по|для).{0,10}(релиз|1\.\d)/i,
      /список.{0,15}(готов|сделан)/i,
      /changelog/i,
    ],
    extract: (text) => {
      const m = text.match(/1\.(20|21|22)/);
      return { release: m ? `r1${m[1]}` : null };
    },
  },
  // Release overview
  {
    intent: INTENTS.RELEASE_OVERVIEW,
    patterns: [
      /релиз[уаеёя]?\s*1\.(20|21|22)/i,
      /1\.(20|21|22)/i,
      /по\s*1\.(20|21|22)/i,
      /окно\s*1\.(20|21|22)/i,
      /sprint\s*1\.(20|21|22)/i,
      /(что|задач[иа]).{0,15}(в|на)\s*1\.(20|21|22)/i,
      /овертайм.{0,20}(задач|статус|что)/i,
      /(backlog|бэклог).{0,20}(что|задач|статус)/i,
    ],
    extract: (text) => {
      const m = text.match(/1\.(20|21|22)/);
      if (m) return { release: `r1${m[1]}` };
      if (/овертайм/i.test(text)) return { release: 'overtime' };
      if (/backlog|бэклог/i.test(text)) return { release: 'backlog' };
      return {};
    },
  },
  // Team overview
  {
    intent: INTENTS.TEAM_OVERVIEW,
    patterns: [
      /команд[аы].{0,30}(статус|загрузк|блокер|риск)/i,
      /(загрузк|нагрузк).{0,20}команд/i,
      /(статус|обзор).{0,20}команд/i,
      /у\s+команд/i,
      /топ.{0,10}команд/i,
    ],
    extract: (text) => {
      // Try to extract specific team name if mentioned
      const teamMatch = text.match(/команд[аы]?\s+[«"']?([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Za-z][а-яёa-z]*)*)[»"']?/i);
      return { team: teamMatch ? teamMatch[1].trim() : null };
    },
  },
  // Meeting prep
  {
    intent: INTENTS.MEETING_PREP,
    patterns: [
      /встреч[уаи]/i,
      /митинг/i,
      /совещани[ея]/i,
      /груминг/i,
      /демо/i,
      /ретро/i,
      /sprint.?review/i,
      /подготовк[аи].{0,20}(к|для)/i,
      /подготовь.{0,20}(встреч|митинг|совещ|повестк)/i,
      /повестк[аи]/i,
      /agenda/i,
    ],
    extract: (text) => {
      const types = [];
      if (/груминг/i.test(text)) types.push('grooming');
      if (/демо/i.test(text)) types.push('demo');
      if (/ретро/i.test(text)) types.push('retro');
      if (/sprint.?review/i.test(text)) types.push('sprint_review');
      if (/встреч|митинг|совещани/i.test(text)) types.push('meeting');
      return { meetingType: types[0] || 'meeting' };
    },
  },
  // Overload / capacity  (must be BEFORE what_risks and team_overview)
  {
    intent: INTENTS.OVERLOAD,
    patterns: [
      /перегруз/i,
      /загрузк.{0,15}(исполнит|сотрудник)/i,
      /нагрузк.{0,15}(исполнит|сотрудник)/i,
      /капасити/i,
      /capacity/i,
      /кто.{0,20}(перегруж|занят|загружен)/i,
      /у кого.{0,20}(много|больше всего)/i,
    ],
    extract: () => ({}),
  },
  // Filter tasks  (must be BEFORE what_risks to avoid "задачи с блокерами" misclassification)
  {
    intent: INTENTS.FILTER_TASKS,
    patterns: [
      /покаж[иы].{0,20}задач/i,
      /отфильтруй/i,
      /найди.{0,20}(задач|строк)/i,
      /задачи.{0,10}(где|которые|с|без|со)/i,
      /задачи\s+(команд|блокер|риск|без\s*релиз)/i,
      /задачи\s*с\s*(блокер|риск)/i,
    ],
    extract: (text) => {
      const params = {};
      const teamM = text.match(/команд[аы]?\s+[«"']?([А-ЯЁ][а-яё]+)/i);
      if (teamM) params.team = teamM[1];
      if (/блокер/i.test(text)) params.onlyBlocking = true;
      if (/риск/i.test(text)) params.onlyRisky = true;
      if (/сделан|готов/i.test(text)) params.onlyDone = true;
      const relM = text.match(/1\.(20|21|22)/);
      if (relM) params.release = `1.${relM[1]}`;
      return params;
    },
  },
  // What risks
  {
    intent: INTENTS.WHAT_RISKS,
    patterns: [
      /риск/i,
      /блокер/i,
      /проблем/i,
      /угроз/i,
      /тревожн/i,
      /что.{0,15}(плохо|не так|опасн|критично)/i,
      /сигнал/i,
    ],
    extract: () => ({}),
  },
  // Action plan
  {
    intent: INTENTS.ASK_PLAN,
    patterns: [
      /план.{0,20}(действий|работ|задач)/i,
      /что.{0,20}(сделать|нужно|надо|приоритет)/i,
      /с чего.{0,20}начат/i,
      /action.?plan/i,
      /приоритет.{0,20}(задач|работ)/i,
      /рекоменд/i,
    ],
    extract: () => ({}),
  },
  // ── CONFIRM / CANCEL batch (must be FIRST — short, unambiguous) ──
  {
    intent: INTENTS.CONFIRM_BATCH,
    patterns: [
      /^(да|применить|подтвердить|ок|ok|apply|confirm|выполни|запусти)[\s!.]*$/i,
      /^применить$|^да$|^подтвердить$/i,
    ],
    extract: () => ({}),
  },
  {
    intent: INTENTS.CANCEL_BATCH,
    patterns: [
      /^(нет|отмена|отменить|cancel|стоп|stop|не надо|не применять)[\s!.]*$/i,
    ],
    extract: () => ({}),
  },

  // ── CLEAR FILTERS ──
  {
    intent: INTENTS.CLEAR_FILTERS,
    patterns: [
      /сними\s+фильтр/i,
      /сброс\w*\s+фильтр/i,
      /убери\s+фильтр/i,
      /очисти\s+фильтр/i,
      /фильтр\w*\s+(сбр|убр|очист|снять)/i,
      /показ\w+\s+вс[её]\s+(задачи|строки)?\s*$/i,
    ],
    extract: () => ({}),
  },

  // ── BATCH ACTIONS (must be before FIND_TASKS) ──
  {
    intent: INTENTS.BATCH_ACTION,
    patterns: [
      /перенеси\s+(все\s+)?задачи/i,
      /назначь\s+(все\s+)?задачам/i,
      /назначь\s+(всем|всё)\s/i,
      /установи\s+(всем|всё|статус)/i,
      /смени\s+(статус|релиз|владельца)/i,
      /распредели\s+(задачи|всё|все)/i,
      /отметь\s+(все\s+)?задачи\s+(как\s+)?(сделано|готово|выполнено)/i,
      /добавь\s+комментарий/i,
      /поставь\s+статус/i,
    ],
    extract: (text) => {
      const p = { action: null, filter: {}, value: null };
      const t = text.toLowerCase();
      // Detect action type
      if (/перенеси|распредели.*релиз|назначь.*релиз/.test(t)) {
        p.action = 'assign_release';
        const relM = text.match(/1\.(20|21|22)/);
        if (relM) p.value = relM[1];
        if (/без релиза|без.*релиз|нет.*релиза|isUnassigned/.test(t)) p.filter.isUnassigned = true;
        if (/в scope|scope.*да|в скоуп/.test(t)) p.filter.scopeStatus = 'Да';
      } else if (/назначь.*статус|установи.*статус|смени.*статус|поставь.*статус/.test(t)) {
        p.action = 'set_scope';
        if (/needs approval|требует подтвержд|подтвержд/.test(t)) p.value = 'Требует подтверждения';
        else if (/в scope|в скоуп|да\b/.test(t)) p.value = 'Да';
        else if (/out of scope|вне скоупа|нет\b/.test(t)) p.value = 'Нет';
        if (/без (владельца|owner|assignee)|без исполнит/.test(t)) p.filter.noAssignee = true;
      } else if (/отметь.*как\s*(сделано|готово|выполнено)|закрой\s+задачи/.test(t)) {
        p.action = 'mark_done';
        p.value  = true;
      } else if (/добавь\s+комментарий/.test(t)) {
        p.action = 'set_comment';
        const m = text.match(/комментарий[:\s]+["«»]?(.+?)["»]?\s*$/i);
        p.value = m ? m[1].trim() : '';
      }
      // Filter extraction
      const relM = text.match(/1\.(20|21|22)/);
      if (relM) p.filter.release = relM[1];
      const teamM = text.match(/команд[аы]?\s+[«"']?([А-ЯЁ][а-яё]+)/i);
      if (teamM) p.filter.team = teamM[1];
      if (/блокер/.test(t)) p.filter.onlyBlocking = true;
      if (/риск/.test(t))   p.filter.onlyRisky    = true;
      return p;
    },
  },

  // ── FIND TASKS (search intelligence) ──
  {
    intent: INTENTS.FIND_TASKS,
    patterns: [
      /найди\s+(задачи|строки)/i,
      /покажи\s+(задачи|строки|всё|всех)\s+(без|с|в|по|которые)/i,
      /покажи\s+все\s+(критичн|блокер|рискован)/i,
      /задачи\s+без\s+(владельца|owner|исполнит)/i,
      /задачи\s+в\s+scope\s+без\s+релиза/i,
      /задачи\s+без\s+owner/i,
      /блокеры\s+(ближайш|следующ|в\s+1\.)/i,
      /критичн\w+\s+(по|команд)/i,
    ],
    extract: (text) => {
      const t = text.toLowerCase();
      const p = { filters: {}, label: '' };
      if (/без (владельца|owner|исполнит)/.test(t)) { p.filters.noAssignee = true; p.label = 'без исполнителя'; }
      if (/в scope без релиза/.test(t))              { p.filters.isUnassigned = true; p.filters.scopeStatus = 'Да'; p.label = 'в scope без релиза'; }
      if (/блокер/.test(t))                          { p.filters.onlyBlocking = true; p.label = 'блокеры'; }
      if (/риск|критичн/.test(t))                    { p.filters.onlyRisky = true; p.label += ' рискованные'; }
      const relM = text.match(/1\.(20|21|22)/);
      if (relM) { p.filters.release = `1.${relM[1]}`; p.label += ` в ${p.filters.release}`; }
      const teamM = text.match(/команд[аы]?\s+[«"']?([А-ЯЁ][а-яё]+)/i);
      if (teamM) { p.filters.team = teamM[1]; p.label += ` команда ${teamM[1]}`; }
      p.label = p.label.trim() || 'по запросу';
      return p;
    },
  },

  // ── EXPLAIN ──
  {
    intent: INTENTS.EXPLAIN,
    patterns: [
      /объясни\s+(riskScore|healthScore|pressure|velocity|bottleneck|spof|риск|хелс|нагруз|метрик)/i,
      /почему\s+(релиз|задача|команда|riskScore|healthScore|такой|такие|высок|низк)/i,
      /что\s+означает\s+(riskScore|healthScore|pressure|метрик)/i,
      /как\s+считается\s+(riskScore|healthScore|pressure|оценка|метрик)/i,
      /почему\s+(этот|эта)\s+(релиз|задача|показатель)/i,
      /расскажи\s+(про\s+)?(рейтинг|риск|оценку|метрику)/i,
    ],
    extract: (text) => {
      const t = text.toLowerCase();
      const p = { metric: null, epic: null, release: null, team: null };
      if (/health/.test(t) || /хелс/.test(t))             p.metric = 'health';
      else if (/pressure|нагруз|загруз/.test(t))           p.metric = 'pressure';
      else if (/velocity|скорост|велосит/.test(t))         p.metric = 'velocity';
      else if (/bottleneck|узкое\s+место/.test(t))         p.metric = 'bottleneck';
      else if (/spof|single\s+point/.test(t))              p.metric = 'spof';
      else if (/risk|риск/.test(t))                        p.metric = 'risk';
      // Release in context
      const relM = text.match(/1\.(20|21|22)/);
      if (relM) p.release = `r1${relM[1]}`;
      // Team
      const teamM = text.match(/команд[аы]?\s+[«"']?([А-ЯЁ][а-яё]+)/i);
      if (teamM) p.team = teamM[1];
      return p;
    },
  },

  // ── DAILY REPORT ──
  {
    intent: INTENTS.DAILY_REPORT,
    patterns: [
      /ежедневн\w+\s+отчёт/i,
      /дневной\s+отчёт/i,
      /что\s+(изменилось|поменялось)\s+(за\s+сегодня|сегодня|вчера)/i,
      /что\s+(нового|нов)\s+(за\s+)?(сегодня|вчера|день)/i,
      /дейли/i,
      /daily\s+report/i,
      /итоги\s+(дня|сегодня)/i,
      /отчёт\s+за\s+(сегодня|день)/i,
    ],
    extract: () => ({}),
  },

  // ── HISTORY ──
  {
    intent: INTENTS.HISTORY,
    patterns: [
      /что\s+(изменилось|поменялось)\s+(в\s+задач|по\s+задач)/i,
      /история\s+(изменений|задачи|по)/i,
      /кто\s+(менял|изменил|поменял)\s+(scope|релиз|статус)/i,
      /покажи\s+изменения\s+(за|по|в)/i,
      /последние\s+изменения/i,
      /лог\s+(изменений|действий)/i,
      /change\s+log/i,
      /что\s+было\s+(изменено|поменяно)/i,
    ],
    extract: (text) => {
      const p = { today: false, release: null, field: null };
      if (/сегодня/.test(text)) p.today = true;
      const relM = text.match(/1\.(20|21|22)/);
      if (relM) p.release = `1.${relM[1]}`;
      if (/scope/.test(text.toLowerCase()))  p.field = 'scope';
      if (/релиз/.test(text.toLowerCase()))  p.field = 'release';
      if (/статус/.test(text.toLowerCase())) p.field = 'status';
      return p;
    },
  },

  // ── REVIEW MODE ──
  {
    intent: INTENTS.REVIEW_MODE,
    patterns: [
      /режим.{0,15}(ceo|dm|риск|lead|тимлид)/i,
      /обзор.{0,15}(ceo|руководител|менеджер)/i,
      /глаза.{0,15}(ceo|dm|риск)/i,
      /как.{0,20}(ceo|менеджер|руководитель)/i,
      /посмотри.{0,20}как\s+(ceo|dm|delivery|risk|team\s*lead)/i,
      /с\s+точки\s+зрения\s+(ceo|dm|риск)/i,
    ],
    extract: (text) => {
      if (/ceo/i.test(text)) return { role: 'ceo' };
      if (/dm|delivery/i.test(text)) return { role: 'dm' };
      if (/риск|risk/i.test(text)) return { role: 'risk' };
      if (/lead|тимлид/i.test(text)) return { role: 'lead' };
      return { role: 'ceo' };
    },
  },
];

/**
 * Parse intent from user text.
 * @param {string} text
 * @returns {{ intent: string, confidence: number, params: object }}
 */
export function parseIntent(text) {
  if (!text || typeof text !== 'string') return { intent: INTENTS.GENERIC, confidence: 0, params: {} };
  const t = text.trim();
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(t)) {
        return {
          intent: rule.intent,
          confidence: 0.85,
          params: rule.extract ? rule.extract(t) : {},
        };
      }
    }
  }
  return { intent: INTENTS.GENERIC, confidence: 0, params: {} };
}

/**
 * Check if intent should be handled by rule engine (no LLM needed).
 */
export function isRuleBased(intent) {
  return [
    INTENTS.EXECUTIVE_SUMMARY,
    INTENTS.RELEASE_OVERVIEW,
    INTENTS.TEAM_OVERVIEW,
    INTENTS.MEETING_PREP,
    INTENTS.RELEASE_NOTES,
    INTENTS.WHAT_RISKS,
    INTENTS.OVERLOAD,
    INTENTS.FILTER_TASKS,
    INTENTS.ASK_PLAN,
    INTENTS.REVIEW_MODE,
    // Operations — always rule-based
    INTENTS.BATCH_ACTION,
    INTENTS.FIND_TASKS,
    INTENTS.EXPLAIN,
    INTENTS.DAILY_REPORT,
    INTENTS.HISTORY,
    INTENTS.CLEAR_FILTERS,
    INTENTS.CONFIRM_BATCH,
    INTENTS.CANCEL_BATCH,
  ].includes(intent);
}

/* ============================================================
   INTENT CATEGORY (for LLM-prompt routing) — v10_0
   Maps both fine-grained intents and free-form text to one of
   seven broad categories. Each category drives a different
   system + user prompt (see chatPrompts.js).

   Categories: search · explain · action · analysis · planning · report · general
   ============================================================ */

export const CATEGORIES = ['search','explain','action','analysis','planning','report','general'];

/* Direct mapping for fine-grained intents that already have rule handlers.
   Used as a hint when LLM does end up running on a known intent. */
const INTENT_TO_CATEGORY = {
  [INTENTS.FILTER_TASKS]:      'search',
  [INTENTS.FIND_TASKS]:        'search',
  [INTENTS.HISTORY]:           'search',
  [INTENTS.EXPLAIN]:           'explain',
  [INTENTS.BATCH_ACTION]:      'action',
  [INTENTS.CONFIRM_BATCH]:     'action',
  [INTENTS.CANCEL_BATCH]:      'action',
  [INTENTS.CLEAR_FILTERS]:     'action',
  [INTENTS.EXECUTIVE_SUMMARY]: 'analysis',
  [INTENTS.RELEASE_OVERVIEW]:  'analysis',
  [INTENTS.TEAM_OVERVIEW]:     'analysis',
  [INTENTS.WHAT_RISKS]:        'analysis',
  [INTENTS.OVERLOAD]:          'analysis',
  [INTENTS.REVIEW_MODE]:       'analysis',
  [INTENTS.ASK_PLAN]:          'planning',
  [INTENTS.MEETING_PREP]:      'report',
  [INTENTS.RELEASE_NOTES]:     'report',
  [INTENTS.DAILY_REPORT]:      'report',
  [INTENTS.GENERIC]:           null,   // fall through to free-text rules
};

/* Free-text rules — applied when intent is GENERIC. Order matters: first match wins. */
const CATEGORY_RULES = [
  { cat: 'action',   patterns: [
    /^\s*(перенеси|перенести|переноси|двинь|сдвинь|перемести|переместить)(?![а-яёa-z0-9])/iu,
    /^\s*(удали|удалить|снеси|снести|drop|delete)(?![а-яёa-z0-9])/iu,
    /^\s*(отметь|отметить|пометь|пометить|закрой|закрыть|закройте)(?![а-яёa-z0-9])/iu,
    /^\s*(назначь|назначить|присвой|поставь|выстави)(?![а-яёa-z0-9])/iu,
    /^\s*(сделай|сделать|выполни|выполнить|примен[ия]|примени|apply|do)(?![а-яёa-z0-9])/iu,
    /^\s*(объедин[ия]|объедини|merge|расщеп[ии]|split)(?![а-яёa-z0-9])/iu,
    /^\s*(добавь|добавить|создай|создать)(?![а-яёa-z0-9])/iu,
  ]},
  { cat: 'planning', patterns: [
    /(?:^|[^а-яёa-z0-9])(как.{0,12}(спасти|сохранить|вытащить).{0,15}релиз)/iu,
    /\b(план|стратег|варианты|сценари[ий]|roadmap)(?![а-яёa-z0-9])/iu,
    /\b(как.{0,15}(организовать|улучшить|оптимизировать|перепланировать))(?![а-яёa-z0-9])/iu,
    /\b(что.{0,10}делать|куда.{0,10}движемся)/i,
    /\bпредложи.{0,10}(вариант|план|сценари)/i,
  ]},
  { cat: 'explain',  patterns: [
    /^\s*(почему|отчего|из[- ]за.?чего|зачем)(?![а-яёa-z0-9])/iu,
    /\b(объясни|объяснить|раскрой|разъясн[ия])(?![а-яёa-z0-9])/iu,
    /\bв чём.{0,10}(причин|проблем)/i,
    /\bчто.{0,10}значит(?![а-яёa-z0-9])/iu,
    /\bчем.{0,10}отличается(?![а-яёa-z0-9])/iu,
  ]},
  { cat: 'report',   patterns: [
    /\b(отч[её]т|отчитаться|отчитайся|сводка для|summary для|status report)(?![а-яёa-z0-9])/iu,
    /\b(итог[иа]|подведи.{0,10}итог|release.?notes|changelog)/i,
    /\bсделай.{0,10}отч[её]т(?![а-яёa-z0-9])/iu,
  ]},
  { cat: 'search',   patterns: [
    /^\s*(покажи|показать|найди|найти|выведи|вывести|перечисли|list)(?![а-яёa-z0-9])/iu,
    /\b(какие.{0,10}задачи|у кого нет|без владельца|без релиза|без скоупа|без оценки)(?![а-яёa-z0-9])/iu,
    /\b(сколько.{0,10}задач|где.{0,10}задачи|кто.{0,10}отвечает)/i,
  ]},
  { cat: 'analysis', patterns: [
    /\b(что.{0,10}происходит|общая.?ситуация|общий.?статус|разбер[ие])(?![а-яёa-z0-9])/iu,
    /\b(анализ|проанализируй|разбери|дай.{0,10}картину)(?![а-яёa-z0-9])/iu,
    /\b(где.{0,10}риск|где.{0,10}проблем)/i,
    /\b(статус.{0,10}проект|здоровье.{0,10}проект)/i,
  ]},
];

/**
 * Resolve an intent category for prompt routing.
 *
 * @param {string} text — raw user message
 * @param {string=} hintIntent — optional fine-grained intent already parsed
 * @returns {{ category: string, source: 'intent'|'rule'|'fallback' }}
 *
 * - If `hintIntent` maps directly to a category, return it (source='intent').
 * - Otherwise apply free-text rules; first match wins (source='rule').
 * - Otherwise return 'general' (source='fallback').
 */
export function parseIntentCategory(text, hintIntent) {
  // 1) Try fine-grained intent first
  if (hintIntent && INTENT_TO_CATEGORY[hintIntent]) {
    return { category: INTENT_TO_CATEGORY[hintIntent], source: 'intent' };
  }
  // 2) Free-text rules
  const t = String(text || '').trim();
  if (t) {
    for (const rule of CATEGORY_RULES) {
      for (const p of rule.patterns) {
        if (p.test(t)) return { category: rule.cat, source: 'rule' };
      }
    }
  }
  // 3) Fallback
  return { category: 'general', source: 'fallback' };
}
