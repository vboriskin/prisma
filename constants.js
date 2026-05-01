'use strict';
/* ============================================================
   CONSTANTS — v8_0 ES module
   ============================================================ */

export const STORAGE_KEY = 'q2_plan_v3';
export const SETTINGS_KEY = 'q2_settings_v3';
export const LLM_SETTINGS_KEY = 'q2_llm_settings_v1';
export const STORAGE_KEYS = [STORAGE_KEY, 'q2_plan_v2', 'q2_plan'];
export const SETTINGS_KEYS = [SETTINGS_KEY, 'q2_settings_v2', 'q2_settings'];
export const DEFAULT_LLM_SYSTEM_PROMPT = `Ты аналитик внутри СБОФ Планировщик — инструмента планирования спринта Q2. Отвечай на русском языке, опираясь на переданный контекст приложения.

Структура контекста:
- summary: агрегированная статистика (totalRows, done, blockers, risky, inScope и т.д.)
- releaseDistribution: распределение задач по релизам (backlog, 1.20, 1.21, 1.22, overtime)
- riskSummary: счётчики по типам рисков
- teamBreakdown: количество задач, блокеров, рисков по каждой команде
- topBlockers / topRiskyRows: конкретные задачи-блокеры и рискованные строки с деталями
- rows / visibleRows: массив строк реестра с полями: team, epic, tasks, scopeStatus, release120/121/122Types, overtimeTypes, assignee, blockingDependency, riskFlags, isDone, workPeriodStart/End, comment

Релизные окна: 1.20 (20.04–17.05), 1.21 (18.05–14.06), 1.22 (15.06–14.07), Overtime — задачи за пределами окон.
Типы работ: backend, frontend, тестирование, аналитика, бизнес аналитика, внедрение, миграция данных, стабилизация, хотфикс.
Статусы scope: "Да" = в скоупе, "Нет" = вне скоупа, "Требует подтверждения" = на согласовании.

Давай конкретные, actionable ответы. Ссылайся на конкретные команды, эпики, задачи из данных. Если в переданном контексте данных достаточно — отвечай. Если строк нет или контекст пуст — предложи пользователю выбрать режим контекста "Весь реестр" в настройках ассистента (⚙).`.trim();

export const RELEASE_WINDOWS = {
  r120:    { label:'Релиз 1.20', short:'1.20', dates:'20.04–17.05', barCls:'gantt-bar-r120',    winCls:'gantt-window-r120',    stageCls:'stage-r120'    },
  r121:    { label:'Релиз 1.21', short:'1.21', dates:'18.05–14.06', barCls:'gantt-bar-r121',    winCls:'gantt-window-r121',    stageCls:'stage-r121'    },
  r122:    { label:'Релиз 1.22', short:'1.22', dates:'15.06–14.07', barCls:'gantt-bar-r122',    winCls:'gantt-window-r122',    stageCls:'stage-r122'    },
  overtime:{ label:'Овертайм',   short:'OT',   dates:'',            barCls:'gantt-bar-overtime', winCls:'gantt-window-overtime', stageCls:'stage-overtime' },
};

export const PHASE_ORDER = ['бизнес аналитика','аналитика','backend','frontend','тестирование','внедрение','миграция данных','стабилизация','хотфикс'];
export const PHASE_COLORS = {
  'бизнес аналитика':'#7c3aed','аналитика':'#0284c7','backend':'#4f46e5','frontend':'#059669',
  'тестирование':'#d97706','внедрение':'#dc2626','миграция данных':'#db2777',
  'стабилизация':'#65a30d','хотфикс':'#ea580c',
};
export const PHASE_SHORT = {
  'бизнес аналитика':'БА',
  'аналитика':'АН',
  'backend':'BE',
  'frontend':'FE',
  'тестирование':'QA',
  'внедрение':'ВН',
  'миграция данных':'МД',
  'стабилизация':'СТ',
  'хотфикс':'HF',
};
export const GANTT_RELEASE_WINDOWS = [
  { key:'r120', label:'1.20', start:new Date('2025-04-20'), end:new Date('2025-05-17'), tf:'release120Types' },
  { key:'r121', label:'1.21', start:new Date('2025-05-18'), end:new Date('2025-06-14'), tf:'release121Types' },
  { key:'r122', label:'1.22', start:new Date('2025-06-15'), end:new Date('2025-07-14'), tf:'release122Types' },
  { key:'ot',   label:'OT',   start:null, end:null, tf:'overtimeTypes' },
];
export const GANTT_TIMELINE_START = new Date('2025-04-01');
export const GANTT_TIMELINE_END   = new Date('2025-09-01');
export const GANTT_DAY_PX = 5;
export const GANTT_RELEASE_BOUNDS = {
  r120: [new Date(GANTT_RELEASE_WINDOWS[0].start), new Date(GANTT_RELEASE_WINDOWS[0].end)],
  r121: [new Date(GANTT_RELEASE_WINDOWS[1].start), new Date(GANTT_RELEASE_WINDOWS[1].end)],
  r122: [new Date(GANTT_RELEASE_WINDOWS[2].start), new Date(GANTT_RELEASE_WINDOWS[2].end)],
};

export const WORK_TYPES = [
  'backend','frontend','тестирование','аналитика',
  'бизнес аналитика','внедрение','миграция данных','стабилизация','хотфикс',
];

export const SCOPE_OPTIONS = ['Да','Нет','Требует подтверждения'];

export const RISK_FLAGS = {
  CONFIRMATION_IN_RELEASE: 'Подтверждение, но уже в релизе',
  IN_SCOPE_WITHOUT_RELEASE: 'В scope, но без релиза',
  BLOCKING_NEAR_RELEASE:    'Блокер в ближайшем релизе',
};

export const LEGACY_WT_MAP = {
  'разработка':'backend','backend':'backend','frontend':'frontend',
  'аналитика':'аналитика','тестирование':'тестирование','внедрение':'внедрение',
  'бизнес аналитика':'бизнес аналитика','миграция данных':'миграция данных',
  'стабилизация':'стабилизация','хотфикс':'хотфикс',
};

export const WT_CLS = {
  'backend':'wt-backend','frontend':'wt-frontend',
  'тестирование':'wt-testing','аналитика':'wt-analytics','бизнес аналитика':'wt-analytics',
};

// Registry columns definition — epic FIRST (sticky)
export const REGISTRY_COLS = [
  { key:'epic',               label:'Эпик',          type:'text',        visible:true,  width:180 },
  { key:'team',               label:'Команда',       type:'suggest',     visible:true,  width:110 },
  { key:'category',           label:'Категория',     type:'tags',        visible:true,  width:110 },
  { key:'tags',               label:'Теги',          type:'tags',        visible:false, width:150 },
  { key:'tasks',              label:'Задачи',        type:'jira',        visible:true,  width:220 },
  { key:'scopeStatus',        label:'Scope',         type:'scope',       visible:true,  width:130 },
  { key:'release120Types',    label:'1.20',          type:'multiselect', visible:true,  width:160 },
  { key:'release121Types',    label:'1.21',          type:'multiselect', visible:true,  width:160 },
  { key:'release122Types',    label:'1.22',          type:'multiselect', visible:true,  width:160 },
  { key:'overtimeTypes',      label:'Овертайм',      type:'multiselect', visible:true,  width:160 },
  { key:'role',               label:'Роли',          type:'tags',        visible:true,  width:150 },
  { key:'isDone',             label:'Сделано',       type:'checkbox',    visible:true,  width:70  },
  { key:'doneDate',           label:'Дата сделано',  type:'date',        visible:true,  width:120 },
  { key:'blockingDependency', label:'Блокер',        type:'checkbox',    visible:true,  width:60  },
  { key:'blockingDeadline',   label:'Deadline',      type:'date',        visible:true,  width:120 },
  { key:'commitToCounterparty', label:'Обязат. перед смежн.', type:'checkbox', visible:true, width:80 },
  { key:'commitDate',         label:'Дата обязат.',  type:'date',        visible:true,  width:120 },
  { key:'backend',            label:'BE SP',         type:'number',      visible:false, width:70  },
  { key:'frontend',           label:'FE SP',         type:'number',      visible:false, width:70  },
  { key:'analytics_estimate', label:'Ан. SP',        type:'number',      visible:false, width:70  },
  { key:'testing_estimate',   label:'Тест. SP',      type:'number',      visible:false, width:70  },
  { key:'total_estimate',     label:'Оценка',        type:'number',      visible:false, width:70  },
  { key:'risks',              label:'Риски',         type:'text',        visible:false, width:180 },
  { key:'taskComment',        label:'Коммент.',      type:'text',        visible:false, width:180 },
  { key:'teamDependency',     label:'Зависимость',   type:'text',        visible:false, width:150 },
  { key:'comment',            label:'Комментарий',   type:'text',        visible:false, width:180 },
  { key:'workPeriod',         label:'Период работ',  type:'daterange',   visible:true,  width:220 },
  { key:'workPeriodStart',    label:'Период (нач.)', type:'date',        visible:false, width:120 },
  { key:'workPeriodEnd',      label:'Период (кон.)', type:'date',        visible:false, width:120 },
  { key:'assignee',           label:'Исполнитель',   type:'tags',        visible:true,  width:170 },
  { key:'sourceSheet',        label:'Лист',          type:'readonly',    visible:false, width:100 },
  { key:'priority',           label:'Приоритет',     type:'priority',    visible:true,  width:100 },
  { key:'businessValue',      label:'Ценность',      type:'number',      visible:false, width:80  },
  { key:'riskScore',          label:'Риск',          type:'riskscore',   visible:true,  width:70  },
  // Integration columns — hidden by default, populated via integrations sync
  { key:'jiraKey',            label:'Jira Key',      type:'intlink',     visible:false, width:90  },
  { key:'jiraStatus',         label:'Jira Статус',   type:'readonly',    visible:false, width:120 },
  { key:'jiraAssignee',       label:'Jira Исполн.',  type:'readonly',    visible:false, width:130 },
  { key:'jiraUpdatedAt',      label:'Jira Обновлён', type:'readonly',    visible:false, width:110 },
  { key:'prUrl',              label:'PR',            type:'intlink',     visible:false, width:60  },
  { key:'prStatus',           label:'PR Статус',     type:'readonly',    visible:false, width:100 },
  { key:'prUpdatedAt',        label:'PR Обновлён',   type:'readonly',    visible:false, width:110 },
  { key:'docUrl',             label:'Docs',          type:'intlink',     visible:false, width:60  },
  { key:'docTitle',           label:'Docs Title',    type:'readonly',    visible:false, width:160 },
];
export const COL_TYPES = ['text','number','tags','multiselect','scope','checkbox','date','suggest','daterange','readonly','jira','intlink'];
