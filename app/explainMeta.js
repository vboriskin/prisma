'use strict';
/* ============================================================
   EXPLAIN META — registry «kind → meta» для блоков UI.
   ------------------------------------------------------------
   AUDIT_HOLISTIC AI1 — «Объясни этот экран».
   Закрывает: SCANNER_METRICS F-EXPL-1, COPY 22, UX 8.

   Используется в `app/explainScreen.js`. Вью НЕ трогаем — это
   phase-2 (TODO ниже).

   Каждая запись:
     { kind:string, what:string, how:string, soWhat:string,
       links?:[{href,label}], seeAlso?:[kind] }

   Тон голоса (Brand §7): партнёр, спокойный, тёплый, точный,
   на «вы», без эмодзи, без восклицательных знаков, без жаргона.

   PHASE-2 TODO: повесить в views/* `data-explain="<kind>"` и
   `data-explain-meta` (по необходимости) — ExplainScreen.attachMeta
   сам подхватит атрибут. Сейчас registry — единственный источник.
   ============================================================ */

/**
 * @typedef {Object} ExplainMeta
 * @property {string}  kind     — стабильный идентификатор блока
 * @property {string}  what     — что показывает (1 фраза)
 * @property {string}  how      — как считается / источник (2-4 фразы)
 * @property {string}  soWhat   — что делать, если плохо (1-3 пункта)
 * @property {Array<{href:string,label:string}>} [links]
 * @property {string[]} [seeAlso] — связанные kind для cross-reference
 */

/** @type {Object<string, ExplainMeta>} */
export const EXPLAIN_META = {
  'dashboard.kpi-grid': {
    kind: 'dashboard.kpi-grid',
    what: 'Сводка курса портфеля: четыре опорных показателя за выбранный период.',
    how: 'Показатели считаются из state.rows на лету. «Готовность» — доля задач со статусом «Готово». «Дрейф» — сумма задач без релиза или со scope «Требует подтверждения». «Блокеры» — задачи с blockingDependency=true. «Темп» — изменение готовности относительно предыдущего среза.',
    soWhat: 'Если значение красное — откройте Реестр с фильтром той же команды и посмотрите конкретные строки. Из карточки можно перейти в Сканнер для разбора по сотрудникам.',
    seeAlso: ['scanner.gini', 'metrics.control-circle'],
  },

  'metrics.control-circle': {
    kind: 'metrics.control-circle',
    what: 'Круг управляемости — насколько пропорции работ выглядят управляемыми.',
    how: 'Каждый сектор — категория (BE, FE, QA, аналитика). Радиус сектора — доля задач этой категории. Управляемой считается команда с равномерными секторами и без пустот. Источник — state.rows.tasks, агрегация по полю «Тип работ».',
    soWhat: 'Острый перекос в один сектор — сигнал, что вы держите релиз на одной роли. Перекинуть нагрузку можно через Сканнер → «Перегрузка» или через Bulk-edit в Реестре.',
    seeAlso: ['scanner.gini', 'gantt.team-rail'],
  },

  'gantt.team-rail': {
    kind: 'gantt.team-rail',
    what: 'Загрузка команды по релизам — горизонтальная дорожка с эпиками во времени.',
    how: 'Дорожка собирается из state.rows: ось X — релизы 1.20 / 1.21 / 1.22 / Овертайм / Бэклог. Высота полосы — число задач у эпика. Цвет — scope (Да / Нет / Требует подтверждения). Соединительные линии — зависимости из dependencyEngine.',
    soWhat: 'Если у одной команды все эпики прижаты к одному релизу — это перегрузка. Перенесите часть в Овертайм или 1.22 через drag-n-drop, либо через Bulk-edit в Реестре.',
    seeAlso: ['scanner.bus-factor', 'metrics.control-circle'],
  },

  'scanner.gini': {
    kind: 'scanner.gini',
    what: 'Gini — коэффициент равномерности распределения нагрузки между людьми.',
    how: 'Считается по формуле Gini для массива «задач на сотрудника» внутри команды. Значение от 0 до 1. 0 — идеально равномерно, 1 — вся работа на одном человеке. Граница «нормально» — до 0.35; «насторожиться» — 0.35–0.5; «перегрузка» — выше 0.5.',
    soWhat: 'Gini выше 0.5 значит, что один-два человека держат релиз. Откройте список сотрудников этой команды и перераспределите задачи, либо обсудите риски с тимлидом.',
    seeAlso: ['scanner.bus-factor', 'metrics.control-circle'],
  },

  'scanner.bus-factor': {
    kind: 'scanner.bus-factor',
    what: 'Bus-factor — сколько людей реально знают эту область.',
    how: 'По умолчанию считается из state.employees: количество сотрудников, у которых эпик/компонент есть в навыках или в истории коммитов. Минимум 1, выше — лучше. Значение 1 — единая точка отказа: уйдёт человек, область встанет.',
    soWhat: 'Bus-factor=1 — план парного ревью или передачи знаний. Откройте профиль сотрудника и подберите второго, кому дать задачи в этой же области.',
    seeAlso: ['scanner.gini', 'employees.profile'],
  },

  'scanner.overload': {
    kind: 'scanner.overload',
    what: 'Перегрузка — список людей с непропорциональной нагрузкой.',
    how: 'Считается так: для каждого сотрудника берётся число активных задач за период, нормируется на среднее по команде. Перегруженным считается тот, у кого нагрузка выше 1.5× среднего и при этом есть блокеры.',
    soWhat: 'Перегрузка — это не упрёк, а сигнал. Снимите 1–2 задачи, перенесите в Овертайм или передайте человеку с bus-factor=1 в той же области.',
    seeAlso: ['scanner.gini', 'scanner.bus-factor'],
  },

  'employees.profile': {
    kind: 'employees.profile',
    what: 'Карточка сотрудника — что человек делает в этом квартале.',
    how: 'Источник — state.employees + identity-таблица (email, jiraAccountId, bitbucketLogin). Активные задачи берутся из Реестра по совпадению identity. Метрики — из integrations/employeePerformance.',
    soWhat: 'Если карточка пустая — проверьте поля email и jiraAccountId в профиле. Без identity сотрудник не получает данные из интеграций — это контракт системы.',
    seeAlso: ['scanner.bus-factor'],
  },

  'registry.row': {
    kind: 'registry.row',
    what: 'Строка Реестра — один эпик/задача с полным набором атрибутов.',
    how: 'Каждая колонка — поле rowFactory. «Команда», «Эпик», «Задачи», «Релиз», «Scope», «Assignee», «Блокер», «Risk» — обязательные. Остальные — кастомные через Settings → Колонки.',
    soWhat: 'Чтобы изменить несколько строк сразу — выделите чекбоксами и используйте Bulk-edit. Для повторяющихся правок сохраните как Saved view.',
  },

  'hygiene.violation': {
    kind: 'hygiene.violation',
    what: 'Запись Гигиены — нарушение правила, которое можно починить bulk-операцией.',
    how: 'Правила описаны в SCANNER §Б. Каждое нарушение хранит: правило, anchor (id строки/сотрудника), severity, suggested-fix. Источник — rule-engine, проходит по state.rows и state.employees.',
    soWhat: 'Можно починить точечно через «Применить» или массово через Bulk-platform с режимом dry-run. Если фикс кажется неверным — нажмите «Скрыть правило» и оставьте комментарий.',
  },

  'ai.insight': {
    kind: 'ai.insight',
    what: 'AI-инсайт — короткий вывод по текущему срезу плана, сделанный LLM.',
    how: 'Подаётся state-снэпшот (рамка из ai/aiContextBuilder.js) в LLM. Ответ парсится через parseLLMJsonResponse и валидируется по shape. Кэш на 30 минут на ключ {section, filtersHash}.',
    soWhat: 'Если инсайт кажется странным — нажмите «Объяснить ход мысли», LLM покажет какие строки повлияли на вывод. При несогласии — оставьте reaction, инсайт скроется и не вернётся.',
    seeAlso: ['ai.ceo'],
  },
};

/** @returns {ExplainMeta|null} */
export function getMeta(kind) {
  if (!kind || typeof kind !== 'string') return null;
  return EXPLAIN_META[kind] || null;
}

/** @returns {string[]} */
export function listKinds() {
  return Object.keys(EXPLAIN_META).slice();
}

/**
 * Регистрирует кастомную мету (используется ExplainScreen.attachMeta при
 * inline-привязке к элементу через kind).
 * Не перезаписывает существующие записи без явного override=true.
 */
export function registerMeta(meta, opts = {}) {
  if (!meta || typeof meta !== 'object' || !meta.kind) return false;
  if (EXPLAIN_META[meta.kind] && !opts.override) return false;
  EXPLAIN_META[meta.kind] = {
    kind: meta.kind,
    what:   String(meta.what   || ''),
    how:    String(meta.how    || ''),
    soWhat: String(meta.soWhat || ''),
    links:   Array.isArray(meta.links)   ? meta.links.slice()   : undefined,
    seeAlso: Array.isArray(meta.seeAlso) ? meta.seeAlso.slice() : undefined,
  };
  return true;
}

/** Сбрасывает реестр к defaults (для тестов). Возвращает удалённые kinds. */
export function resetMetaRegistry(_defaults = null) {
  // No-op stub — registry is module-scoped; tests should clone if needed.
  return Object.keys(EXPLAIN_META);
}
