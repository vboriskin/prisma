/* ПРИЗМА · GANTT LAB — общий демо-датасет для всех прототипов.
   Plain global (window.PZ_DATA) — чтобы открывалось и через file://, и
   через дев-сервер без ESM/CORS-нюансов. Данные синтетические, но
   правдоподобные: 5 команд, ~16 эпиков, окна релизов с реальными датами
   квартала, статусы/переносы/риски/зависимости/оценки. Сегодня = 23.05
   (внутри окна 1.21). */
(function () {
  'use strict';

  // Окна релизов (год-агностично; даты как в текущем Ганте).
  const releases = [
    { key: 'backlog',  short: 'Бэклог',  start: null,        end: null,        dated: false },
    { key: 'r120',     short: '1.20',    start: '2026-04-20', end: '2026-05-17', dated: true },
    { key: 'r121',     short: '1.21',    start: '2026-05-18', end: '2026-06-14', dated: true, current: true },
    { key: 'r122',     short: '1.22',    start: '2026-06-15', end: '2026-07-14', dated: true },
    { key: 'overtime', short: 'Овертайм', start: null,        end: null,        dated: false },
  ];

  const today = '2026-05-23';

  const milestones = [
    { id: 'm1', date: '2026-05-17', label: 'Код-фриз 1.20' },
    { id: 'm2', date: '2026-05-30', label: 'Релиз-кандидат' },
    { id: 'm3', date: '2026-06-20', label: 'Прод 1.22' },
  ];

  // Тип работы → токен цвета + краткий ярлык.
  const WT = {
    BE:   { label: 'backend',    color: 'var(--wt-be)' },
    FE:   { label: 'frontend',   color: 'var(--wt-fe)' },
    QA:   { label: 'тестирование', color: 'var(--wt-qa)' },
    AN:   { label: 'аналитика',  color: 'var(--wt-an)' },
    BA:   { label: 'бизнес-анализ', color: 'var(--wt-ba)' },
    IMPL: { label: 'внедрение',  color: 'var(--wt-impl)' },
    MIG:  { label: 'миграция',   color: 'var(--wt-mig)' },
    STAB: { label: 'стабилизация', color: 'var(--wt-stab)' },
    HF:   { label: 'хотфикс',    color: 'var(--wt-hf)' },
  };

  // p(wt, col, state?, assignee?) — pill helper.
  const p = (wt, col, state, who) => ({ wt, col, state: state || 'planned', who: who || null });

  // Эпики. pills[].state: planned | progress | done | unplanned.
  // moves = число переносов между релизами (для churn-heat).
  // est — оценки в человеко-днях по дисциплинам (часто простаивающее «золото»).
  const epics = [
    { id: 'e1', team: 'Платежи', epic: 'Новый процессинг СБП', risk: 'off-course', moves: 4,
      deps: [], est: { be: 28, fe: 12, qa: 14, an: 6 },
      pills: [ p('AN','r120','done','Морозова'), p('BE','r121','progress','Сидоров'), p('FE','r121','progress','Ким'), p('QA','r122'), p('BE','overtime') ] },
    { id: 'e2', team: 'Платежи', epic: 'Лимиты и антифрод 2.0', risk: 'drift', moves: 3,
      deps: ['e1'], est: { be: 18, fe: 8, qa: 10, an: 4 },
      pills: [ p('BE','r120','done','Сидоров'), p('AN','r120','done','Морозова'), p('QA','r121','progress','Волков'), p('FE','r122') ] },
    { id: 'e3', team: 'Платежи', epic: 'Рекуррентные платежи', risk: null, moves: 0,
      deps: [], est: { be: 10, fe: 14, qa: 8 },
      pills: [ p('FE','r122'), p('BE','r122'), p('QA','overtime') ] },

    { id: 'e4', team: 'Безопасность', epic: 'Переход на mTLS внутри контура', risk: 'drift', moves: 2,
      deps: [], est: { be: 16, impl: 10, qa: 6 },
      pills: [ p('STAB','r120','done','Новиков'), p('BE','r121','progress','Новиков'), p('IMPL','r122'), p('QA','r122') ] },
    { id: 'e5', team: 'Безопасность', epic: 'Обновление TLS-сертификатов', risk: null, moves: 0,
      deps: [], est: { stab: 6, qa: 4 },
      pills: [ p('STAB','r120','done','Новиков'), p('QA','r120','done','Лебедева') ] },
    { id: 'e6', team: 'Безопасность', epic: 'Аудит доступов RBAC', risk: 'off-course', moves: 3,
      deps: ['e4'], est: { ba: 8, be: 12, qa: 6 },
      pills: [ p('BA','backlog'), p('BE','r122'), p('QA','overtime'), p('BE','r121','unplanned') ] },

    { id: 'e7', team: 'Интеграции', epic: 'Шина событий Kafka', risk: 'drift', moves: 1,
      deps: [], est: { be: 22, impl: 8, qa: 10 },
      pills: [ p('BE','r120','done','Орлов'), p('IMPL','r121','progress','Орлов'), p('QA','r121'), p('BE','r122') ] },
    { id: 'e8', team: 'Интеграции', epic: 'Миграция legacy SOAP→REST', risk: null, moves: 2,
      deps: ['e7'], est: { mig: 18, be: 10, qa: 8 },
      pills: [ p('MIG','r121','progress','Зайцев'), p('BE','r122'), p('QA','r122') ] },
    { id: 'e9', team: 'Интеграции', epic: 'Webhook-платформа партнёров', risk: null, moves: 0,
      deps: [], est: { be: 8, fe: 6, qa: 4 },
      pills: [ p('BE','backlog'), p('FE','backlog') ] },

    { id: 'e10', team: 'Аналитика', epic: 'Дашборд KYC-метрик', risk: null, moves: 1,
      deps: [], est: { an: 10, fe: 12, be: 6 },
      pills: [ p('AN','r121','progress','Морозова'), p('FE','r121','progress','Морозова'), p('BE','r122') ] },
    { id: 'e11', team: 'Аналитика', epic: 'Исследование A/B тестирования', risk: null, moves: 0,
      deps: [], est: { an: 8 },
      pills: [ p('AN','r122'), p('BA','overtime') ] },
    { id: 'e12', team: 'Аналитика', epic: 'Витрина риск-скоринга', risk: 'drift', moves: 2,
      deps: ['e1','e2'], est: { an: 12, be: 14, qa: 8 },
      pills: [ p('AN','r120','done','Захарова'), p('BE','r121','progress','Петров'), p('QA','r122') ] },

    { id: 'e13', team: 'Мобайл', epic: 'Редизайн платёжного флоу', risk: 'off-course', moves: 5,
      deps: ['e1'], est: { fe: 24, be: 8, qa: 12, an: 4 },
      pills: [ p('AN','r120','done','Ким'), p('FE','r121','progress','Ким'), p('FE','r122'), p('QA','r122'), p('FE','overtime') ] },
    { id: 'e14', team: 'Мобайл', epic: 'Биометрия входа', risk: null, moves: 1,
      deps: [], est: { be: 10, fe: 14, qa: 8 },
      pills: [ p('BE','r121','progress','Соколов'), p('FE','r122'), p('QA','r122') ] },
    { id: 'e15', team: 'Мобайл', epic: 'Push-центр уведомлений', risk: null, moves: 0,
      deps: ['e7'], est: { be: 8, fe: 10, qa: 6 },
      pills: [ p('FE','backlog'), p('BE','backlog'), p('QA','overtime') ] },
    { id: 'e16', team: 'Мобайл', epic: 'Хотфикс краша на сплэше', risk: null, moves: 0,
      deps: [], est: { hf: 2, qa: 1 },
      pills: [ p('HF','r120','done','Соколов'), p('QA','r120','done','Лебедева') ] },
  ];

  const teams = ['Платежи', 'Безопасность', 'Интеграции', 'Аналитика', 'Мобайл'];

  // Удобные агрегаты для прототипов.
  function pillsOf(epic, col) { return epic.pills.filter(x => x.col === col); }
  function teamEpics(team) { return epics.filter(e => e.team === team); }
  function loadByTeamRelease(team, col) {
    return teamEpics(team).reduce((n, e) => n + pillsOf(e, col).length, 0);
  }
  function effortOf(epic) { return Object.values(epic.est || {}).reduce((a, b) => a + b, 0); }
  function doneRatio(epic) {
    const t = epic.pills.length || 1;
    const d = epic.pills.filter(x => x.state === 'done').length;
    return d / t;
  }

  window.PZ_DATA = {
    releases, today, milestones, WT, teams, epics,
    helpers: { pillsOf, teamEpics, loadByTeamRelease, effortOf, doneRatio },
  };
})();
