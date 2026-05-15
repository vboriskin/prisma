'use strict';
/* ============================================================
   TEAM SCANNER 2.0 — DEMO FIXTURE  (V21 π5 / scanner-demo)
   --
   Pre-baked `model` snapshot для демо-режима. Используется когда
   у пользователя нет токенов / projectKeys / он хочет посмотреть как
   выглядит сканнер до настройки интеграций.

   Контракт shape — тот же, что выдаёт
     analysePulse → enrichForScanner2(...)
   при реальном fetch'е, но **без** перепрогона: model уже готов.

   Содержит (V21 расширение — π5 round 2):
     · 18 участников × 4 команды (Платформа / Аналитика / QA / Frontend)
     · все 4 поведенческих класса покрыты (idle / moving / watch / stop)
       по нескольким человек в каждом
     · 3 sprint goals с разным pace (on-track / drift / off-track)
     · богатый timeline72h на каждом участнике (5-12 событий)
     · полные heatmap72x4 (5 столбцов × 24 часов) с реалистичным распределением
     · contextSwitches с switchEvents (для side-panel «частые переключения»)
     · cfItems / bbItems / zephyrTestsCreatedRecent / zephyrTestsExecutedRecent
       у соответствующих ролей
     · 7 stale issues разной возрастной группы (3 / 7 / 14 / 30 / 60 / 90 / 180д)
     · 12 «out of sprint» — outOfSprintRatio ≈ 18% (для risk-bar)
     · полный identity-set (jira / bitbucket / confluence) — почти у всех
     · model.spaces с populated sprintIssues для drill-down
     · meta.isDemo = true → triggers banner + drill-down disable

   Frozen object — read-only, нельзя случайно записать через mutation.
   `getScanner2DemoModel()` возвращает deep-clone (mutable).
   ============================================================ */

const NOW_ISO = '2026-05-04T09:00:00+03:00';
const NOW_MS  = Date.parse(NOW_ISO);
const HOUR    = 3600 * 1000;
const DAY     = 24 * HOUR;

/** ISO-string для (NOW − offset_hours) — удобно для timeline-событий. */
function ago(hours) { return new Date(NOW_MS - hours * HOUR).toISOString(); }

/** Простой PRNG (детерминированный, seed=NOW) — чтобы фикстура была
 *  стабильной между вызовами в тестах. Не cryptographic, нужен только
 *  для распределения heatmap. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

/** Генератор heatmap 5×24 (5 дней × 24 часа). Распределяет «активность» по
 *  будням в рабочие часы (10:00-19:00) и slightly меньше по выходным. */
function makeHeatmap(seed, intensity = 1) {
  const rng = makeRng(seed);
  const grid = []; const rowTotals = []; const colTotals = new Array(24).fill(0);
  let peak = { row: 0, col: 0, val: 0 };
  for (let d = 0; d < 5; d++) {
    const row = new Array(24).fill(0);
    let rowSum = 0;
    for (let h = 0; h < 24; h++) {
      let v = 0;
      const isWorkHour = h >= 10 && h <= 19;
      if (isWorkHour && rng() < 0.65) v = Math.floor(rng() * 5 * intensity) + 1;
      else if (!isWorkHour && rng() < 0.08) v = 1;
      row[h] = v;
      rowSum += v;
      colTotals[h] += v;
      if (v > peak.val) peak = { row: d, col: h, val: v };
    }
    grid.push(row);
    rowTotals.push(rowSum);
  }
  return { grid, rowTotals, colTotals, peakCell: peak };
}

/** Вспомогательный generator timeline-событий: возвращает массив items
 *  с разбросом по часам в окне 72ч. */
function makeTimeline72h(items) {
  return items.map((it, i) => ({
    key: it.key, summary: it.summary, kind: it.kind || 'issue',
    at: ago(it.atHoursAgo ?? (i * 4 + 2)),
    project: it.project || (it.key || '').split('-')[0] || 'DEMO',
  }));
}

/** Issue-stub для timelineToday/Yesterday/blockers. */
function iss(key, summary, atHoursAgo = 1, kind = 'issue', extra = {}) {
  return {
    key, summary, kind,
    at: ago(atHoursAgo),
    project: key.split('-')[0],
    ...extra,
  };
}

/** Минимальный participant-shape для UI. Все поля match с тем что
 *  пишет enrichForScanner2 (см. integrations/teamScanner2Enrichment.js). */
function p(overrides = {}) {
  const defaults = {
    key:               '',
    name:              '',
    email:             '',
    avatar:            '',
    jiraAccountId:     '',
    bitbucketLogin:    '',
    confluenceAccountId: '',
    activeIssuesCount: 0,
    blockedCount:      0,
    issuesNow:         [],
    timelineToday:     [],
    timelineYesterday: [],
    timeline72h:       [],
    blockers:          [],
    stale:             [],
    badges: {
      commits48h:       0,
      pr48h:            0,
      reviews:          0,
      approves:         0,
      conf48h:          0,
      testsCreated48h:  0,
      testsExecuted48h: 0,
      prReviews48h:     0,
      prApproves48h:    0,
    },
    cfItems:           [],
    bbItems:           [],
    zephyrTestsCreatedRecent:  [],
    zephyrTestsExecutedRecent: [],
    heatmap72x4:       null,
    contextSwitches:   { distinctIssueKeys: 0, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0, pace: 'no-data', planned: 0, done: 0 },
    teamKey:           'platform',
  };
  return { ...defaults, ...overrides, badges: { ...defaults.badges, ...(overrides.badges || {}) } };
}

/* ────────────────────────────────────────────────────────────
   PARTICIPANTS — 18 человек × 4 команды
   Расклад по поведенческим классам:
     · moving (4): активная работа, timeline ≥ 2 событий
     · watch  (4): есть blockers ИЛИ малая активность
     · stop   (4): blockers без today-активности
     · idle   (3): нет ни blockers, ни today, ни yesterday
     · mixed  (3): высокий load + blocker (контекст-свич риск)
   ──────────────────────────────────────────────────────────── */

const PARTICIPANTS = [

  // ── ПЛАТФОРМА (8 человек) ─────────────────────────────────

  p({
    key: 'demo-ivanov.ii', name: 'Иванов Иван Иванович', label: 'Иванов И.И.',
    email: 'ivanov@demo.local',
    jiraAccountId: 'demo-ivanov', bitbucketLogin: 'ivanov.ii', confluenceAccountId: 'cf-demo-ivanov',
    teamKey: 'platform',
    activeIssuesCount: 5, blockedCount: 0,
    issuesNow: [
      iss('DEMO-101', 'PR review для модуля авторизации'),
      iss('DEMO-102', 'Refactor session token'),
      iss('DEMO-110', 'Migrate to mTLS — Phase 2'),
    ],
    timelineToday: [
      iss('DEMO-101', 'PR review', 1, 'pr'),
      iss('DEMO-102', 'commit: refactor token storage', 2, 'commit'),
      iss('DEMO-101', 'PR approved', 3, 'review'),
      iss('DEMO-110', 'comment в Jira: «жду от SecOps»', 5),
    ],
    timelineYesterday: [
      iss('DEMO-099', 'commit: fix typo', 26, 'commit'),
      iss('DEMO-100', 'PR review', 28, 'review'),
      iss('DEMO-100', 'approve', 28, 'review'),
    ],
    timeline72h: makeTimeline72h([
      { key: 'DEMO-101', summary: 'PR review', kind: 'pr', atHoursAgo: 1 },
      { key: 'DEMO-102', summary: 'commit', kind: 'commit', atHoursAgo: 2 },
      { key: 'DEMO-099', summary: 'commit', kind: 'commit', atHoursAgo: 26 },
      { key: 'DEMO-100', summary: 'review', kind: 'review', atHoursAgo: 28 },
      { key: 'DEMO-101', summary: 'comment', kind: 'comment', atHoursAgo: 50 },
      { key: 'DEMO-098', summary: 'commit', kind: 'commit', atHoursAgo: 60 },
    ]),
    blockers: [],
    badges: { commits48h: 7, pr48h: 3, reviews: 4, approves: 2, conf48h: 0, prReviews48h: 4, prApproves48h: 2 },
    bbItems: [
      { key: 'PR-101', title: 'Migrate to mTLS — Phase 2', updatedAt: ago(1), kind: 'pr' },
      { key: 'PR-102', title: 'Refactor session token', updatedAt: ago(2), kind: 'commit' },
      { key: 'PR-099', title: 'fix: typo in headers.js', updatedAt: ago(26), kind: 'commit' },
    ],
    heatmap72x4: makeHeatmap(101, 1.4),
    contextSwitches: { distinctIssueKeys: 5, switchEvents: [
      { from: 'DEMO-099', to: 'DEMO-101', at: ago(26) },
      { from: 'DEMO-101', to: 'DEMO-102', at: ago(2) },
      { from: 'DEMO-102', to: 'DEMO-110', at: ago(5) },
    ], switchScore: 3 },
    sprintGoalProgress: { progress: 0.55, pace: 'on-track', planned: 40, done: 22 },
  }),

  p({
    key: 'demo-petrov.pp', name: 'Петров Пётр Петрович', label: 'Петров П.П.',
    email: 'petrov@demo.local',
    jiraAccountId: 'demo-petrov', bitbucketLogin: 'petrov.pp', confluenceAccountId: 'cf-demo-petrov',
    teamKey: 'platform',
    activeIssuesCount: 4, blockedCount: 1,
    issuesNow: [
      iss('DEMO-201', 'Migration to mTLS — Phase 1'),
      iss('DEMO-202', 'Fix CVE-2024-1234'),
      iss('DEMO-203', 'Audit log для админ-действий'),
    ],
    timelineToday: [iss('DEMO-202', 'commit: hotfix', 4, 'commit')],
    timelineYesterday: [iss('DEMO-201', 'comment: «жду SecOps approve»', 32)],
    timeline72h: makeTimeline72h([
      { key: 'DEMO-202', summary: 'commit hotfix', kind: 'commit', atHoursAgo: 4 },
      { key: 'DEMO-201', summary: 'comment', kind: 'comment', atHoursAgo: 32 },
      { key: 'DEMO-203', summary: 'comment', kind: 'comment', atHoursAgo: 50 },
    ]),
    blockers: [
      { key: 'DEMO-203', summary: 'Audit log: ожидание SecOps approval', dwellHours: 72, ageDays: 4 },
    ],
    badges: { commits48h: 3, pr48h: 1, reviews: 0, approves: 0, conf48h: 0, prReviews48h: 0, prApproves48h: 0 },
    bbItems: [
      { key: 'PR-202', title: 'Fix CVE-2024-1234', updatedAt: ago(4), kind: 'commit' },
      { key: 'PR-201', title: 'mTLS Phase 1', updatedAt: ago(28), kind: 'pr' },
    ],
    heatmap72x4: makeHeatmap(201, 0.7),
    contextSwitches: { distinctIssueKeys: 3, switchEvents: [
      { from: 'DEMO-201', to: 'DEMO-202', at: ago(4) },
    ], switchScore: 1 },
    sprintGoalProgress: { progress: 0.35, pace: 'drift', planned: 30, done: 11 },
  }),

  p({
    key: 'demo-kozlov.dd', name: 'Козлов Дмитрий Дмитриевич', label: 'Козлов Д.Д.',
    email: 'kozlov@demo.local',
    jiraAccountId: 'demo-kozlov', bitbucketLogin: 'kozlov.dd',
    teamKey: 'platform',
    activeIssuesCount: 9, blockedCount: 2,
    issuesNow: [
      iss('DEMO-401', 'Stabilization sprint task'),
      iss('DEMO-402', 'Refactor auth module'),
      iss('DEMO-403', 'Migration: drop legacy column'),
    ],
    timelineToday: [],
    timelineYesterday: [
      iss('DEMO-401', 'comment: «жду DBA»', 30),
    ],
    timeline72h: makeTimeline72h([
      { key: 'DEMO-401', summary: 'comment', kind: 'comment', atHoursAgo: 30 },
    ]),
    blockers: [
      { key: 'DEMO-401', summary: 'Stabilization: ждём БД-DBA', dwellHours: 168, ageDays: 7 },
      { key: 'DEMO-402', summary: 'Refactor: блокирован обзором', dwellHours: 96, ageDays: 4 },
    ],
    stale: [
      { key: 'DEMO-501', summary: 'Доки требуют ревью', ageDays: 30 },
      { key: 'DEMO-502', summary: 'Старая ветка с тестами', ageDays: 60 },
    ],
    badges: { commits48h: 0, pr48h: 0, reviews: 1, approves: 0, conf48h: 0, prReviews48h: 1, prApproves48h: 0 },
    bbItems: [],
    heatmap72x4: makeHeatmap(401, 0.2),
    contextSwitches: { distinctIssueKeys: 2, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.10, pace: 'off-track', planned: 35, done: 4 },
  }),

  p({
    key: 'demo-fedorov.ff', name: 'Фёдоров Фёдор Фёдорович', label: 'Фёдоров Ф.Ф.',
    email: 'fedorov@demo.local',
    jiraAccountId: 'demo-fedorov', bitbucketLogin: 'fedorov.ff', confluenceAccountId: 'cf-demo-fedorov',
    teamKey: 'platform',
    activeIssuesCount: 0, blockedCount: 0,
    issuesNow: [],
    timelineToday: [],
    timelineYesterday: [],
    timeline72h: [],
    blockers: [],
    badges: { commits48h: 0, pr48h: 0, reviews: 0, approves: 0, conf48h: 0, prReviews48h: 0, prApproves48h: 0 },
    heatmap72x4: makeHeatmap(601, 0.05),
    contextSwitches: { distinctIssueKeys: 0, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0, pace: 'no-data', planned: 0, done: 0 },
  }),

  p({
    key: 'demo-volkov.vv', name: 'Волков Василий Васильевич', label: 'Волков В.В.',
    email: 'volkov@demo.local',
    jiraAccountId: 'demo-volkov', bitbucketLogin: 'volkov.vv',
    teamKey: 'platform',
    activeIssuesCount: 6, blockedCount: 0,
    issuesNow: [
      iss('DEMO-801', 'Backend: kafka consumer'),
      iss('DEMO-802', 'API gateway upgrade'),
      iss('DEMO-803', 'Метрики: latency-budget alert'),
    ],
    timelineToday: [
      iss('DEMO-801', 'commit: kafka backoff retry', 2, 'commit'),
      iss('DEMO-801', 'PR opened', 3, 'pr'),
      iss('DEMO-802', 'commit: gateway timeout fix', 5, 'commit'),
    ],
    timelineYesterday: [
      iss('DEMO-802', 'commit: rate-limit', 28, 'commit'),
      iss('DEMO-802', 'PR opened', 30, 'pr'),
    ],
    timeline72h: makeTimeline72h([
      { key: 'DEMO-801', summary: 'commit', kind: 'commit', atHoursAgo: 2 },
      { key: 'DEMO-801', summary: 'PR opened', kind: 'pr', atHoursAgo: 3 },
      { key: 'DEMO-802', summary: 'commit', kind: 'commit', atHoursAgo: 5 },
      { key: 'DEMO-802', summary: 'commit', kind: 'commit', atHoursAgo: 28 },
      { key: 'DEMO-803', summary: 'comment', kind: 'comment', atHoursAgo: 48 },
    ]),
    blockers: [],
    badges: { commits48h: 8, pr48h: 2, reviews: 1, approves: 0, conf48h: 0, prReviews48h: 1, prApproves48h: 0 },
    bbItems: [
      { key: 'PR-801', title: 'Kafka backoff retry', updatedAt: ago(2), kind: 'commit' },
      { key: 'PR-801b', title: 'API gateway timeout fix', updatedAt: ago(5), kind: 'commit' },
      { key: 'PR-802', title: 'Rate-limit: gateway tier', updatedAt: ago(28), kind: 'pr' },
    ],
    heatmap72x4: makeHeatmap(801, 1.6),
    contextSwitches: { distinctIssueKeys: 3, switchEvents: [
      { from: 'DEMO-801', to: 'DEMO-802', at: ago(5) },
      { from: 'DEMO-802', to: 'DEMO-803', at: ago(48) },
    ], switchScore: 2 },
    sprintGoalProgress: { progress: 0.62, pace: 'on-track', planned: 32, done: 20 },
  }),

  p({
    key: 'demo-egorov.ee', name: 'Егоров Евгений Евгеньевич', label: 'Егоров Е.Е.',
    email: 'egorov@demo.local',
    jiraAccountId: 'demo-egorov', bitbucketLogin: 'egorov.ee',
    teamKey: 'frontend',
    activeIssuesCount: 4, blockedCount: 0,
    issuesNow: [
      iss('FE-1001', 'KYC-форма: валидация'),
      iss('FE-1002', 'Dashboard widget: метрики'),
    ],
    timelineToday: [
      iss('FE-1001', 'commit: input mask', 1, 'commit'),
      iss('FE-1002', 'review', 3, 'review'),
      iss('FE-1001', 'commit: a11y label', 5, 'commit'),
    ],
    timelineYesterday: [
      iss('FE-1001', 'commit: form validation rule', 26, 'commit'),
      iss('FE-1003', 'comment', 32),
    ],
    timeline72h: makeTimeline72h([
      { key: 'FE-1001', summary: 'commit input mask', kind: 'commit', atHoursAgo: 1 },
      { key: 'FE-1002', summary: 'review', kind: 'review', atHoursAgo: 3 },
      { key: 'FE-1001', summary: 'commit a11y', kind: 'commit', atHoursAgo: 5 },
      { key: 'FE-1001', summary: 'commit validation', kind: 'commit', atHoursAgo: 26 },
      { key: 'FE-1003', summary: 'comment', kind: 'comment', atHoursAgo: 32 },
    ]),
    blockers: [],
    stale: [{ key: 'FE-1003', summary: 'Старый legacy widget', ageDays: 7 }],
    badges: { commits48h: 5, pr48h: 1, reviews: 3, approves: 1, conf48h: 0, prReviews48h: 3, prApproves48h: 1 },
    bbItems: [
      { key: 'PR-FE1001', title: 'KYC: input mask', updatedAt: ago(1), kind: 'commit' },
      { key: 'PR-FE1002', title: 'Dashboard widget', updatedAt: ago(3), kind: 'pr' },
    ],
    heatmap72x4: makeHeatmap(1001, 1.2),
    contextSwitches: { distinctIssueKeys: 3, switchEvents: [
      { from: 'FE-1001', to: 'FE-1002', at: ago(3) },
    ], switchScore: 1 },
    sprintGoalProgress: { progress: 0.72, pace: 'on-track', planned: 28, done: 20 },
  }),

  p({
    key: 'demo-tarasova.tt', name: 'Тарасова Татьяна Тимофеевна', label: 'Тарасова Т.Т.',
    email: 'tarasova@demo.local',
    jiraAccountId: 'demo-tarasova', bitbucketLogin: 'tarasova.tt', confluenceAccountId: 'cf-demo-tarasova',
    teamKey: 'qa',
    activeIssuesCount: 5, blockedCount: 0,
    issuesNow: [
      iss('QA-701', 'Регресс auth-flow (e2e)'),
      iss('QA-702', 'e2e тест KYC-сценария'),
      iss('QA-703', 'Smoke: gateway upgrade'),
    ],
    timelineToday: [
      iss('QA-701', 'zephyr: создан тест-кейс', 2, 'zephyr'),
      iss('QA-702', 'zephyr: прогон test-run', 4, 'zephyr'),
      iss('QA-701', 'zephyr: создан тест-кейс', 6, 'zephyr'),
    ],
    timelineYesterday: [
      iss('QA-701', 'zephyr: 5 тест-кейсов созданы', 28, 'zephyr'),
      iss('QA-703', 'comment: блокер найден', 30),
    ],
    timeline72h: makeTimeline72h([
      { key: 'QA-701', summary: 'zephyr created', kind: 'zephyr', atHoursAgo: 2 },
      { key: 'QA-702', summary: 'zephyr executed', kind: 'zephyr', atHoursAgo: 4 },
      { key: 'QA-701', summary: 'zephyr created', kind: 'zephyr', atHoursAgo: 6 },
      { key: 'QA-701', summary: 'zephyr 5 tests', kind: 'zephyr', atHoursAgo: 28 },
      { key: 'QA-703', summary: 'comment', kind: 'comment', atHoursAgo: 30 },
    ]),
    blockers: [],
    badges: { commits48h: 0, pr48h: 0, reviews: 4, approves: 2, conf48h: 0, testsCreated48h: 8, testsExecuted48h: 12, prReviews48h: 4, prApproves48h: 2 },
    zephyrTestsCreatedRecent: [
      { key: 'ZEPH-100', summary: 'auth regression test', when: ago(2), pk: 'QA' },
      { key: 'ZEPH-101', summary: 'KYC happy path', when: ago(6), pk: 'QA' },
      { key: 'ZEPH-102', summary: 'KYC validation rules', when: ago(28), pk: 'QA' },
    ],
    zephyrTestsExecutedRecent: [
      { key: 'ZEPH-101', summary: 'KYC happy path — pass', when: ago(4), pk: 'QA' },
      { key: 'ZEPH-099', summary: 'gateway smoke — fail', when: ago(30), pk: 'QA' },
    ],
    heatmap72x4: makeHeatmap(701, 1.3),
    contextSwitches: { distinctIssueKeys: 3, switchEvents: [
      { from: 'QA-701', to: 'QA-702', at: ago(4) },
      { from: 'QA-702', to: 'QA-703', at: ago(30) },
    ], switchScore: 2 },
    sprintGoalProgress: { progress: 0.50, pace: 'on-track', planned: 24, done: 12 },
  }),

  p({
    key: 'demo-sokolova.ss', name: 'Соколова София Сергеевна', label: 'Соколова С.С.',
    email: 'sokolova@demo.local',
    jiraAccountId: 'demo-sokolova', bitbucketLogin: 'sokolova.ss',
    teamKey: 'platform',
    activeIssuesCount: 3, blockedCount: 1,
    issuesNow: [
      iss('DEMO-1101', 'Mass-assignment vulnerability'),
      iss('DEMO-1102', 'Rate-limit для admin-API'),
    ],
    timelineToday: [iss('DEMO-1101', 'PR review', 5, 'pr')],
    timelineYesterday: [iss('DEMO-1102', 'comment', 30)],
    timeline72h: makeTimeline72h([
      { key: 'DEMO-1101', summary: 'PR review', kind: 'pr', atHoursAgo: 5 },
      { key: 'DEMO-1102', summary: 'comment', kind: 'comment', atHoursAgo: 30 },
    ]),
    blockers: [
      { key: 'DEMO-1102', summary: 'Rate-limit: ждём design-review от арх. совета', dwellHours: 48, ageDays: 2 },
    ],
    badges: { commits48h: 0, pr48h: 1, reviews: 2, approves: 0, conf48h: 0, prReviews48h: 2, prApproves48h: 0 },
    bbItems: [
      { key: 'PR-1101', title: 'Mass-assignment fix', updatedAt: ago(5), kind: 'pr' },
    ],
    heatmap72x4: makeHeatmap(1101, 0.6),
    contextSwitches: { distinctIssueKeys: 2, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.30, pace: 'drift', planned: 20, done: 6 },
  }),

  // ── АНАЛИТИКА (4 человека) ──────────────────────────────────

  p({
    key: 'demo-sidorova.an', name: 'Сидорова Анна Николаевна', label: 'Сидорова А.Н.',
    email: 'sidorova@demo.local',
    jiraAccountId: 'demo-sidorova', confluenceAccountId: 'cf-demo-sidorova',
    teamKey: 'analytics',
    activeIssuesCount: 6, blockedCount: 0,
    issuesNow: [
      iss('ANL-301', 'Дашборд KYC-метрик'),
      iss('ANL-302', 'A/B тест: 14-дневные результаты'),
      iss('ANL-303', 'Очистка данных KYC'),
    ],
    timelineToday: [
      iss('ANL-301', 'cf: edit «KYC Метрики Q2»', 2, 'cf'),
      iss('ANL-302', 'cf: edit «A/B Тест: результаты»', 4, 'cf'),
      iss('ANL-301', 'comment в Jira', 5),
    ],
    timelineYesterday: [
      iss('ANL-301', 'cf: edit', 26, 'cf'),
      iss('ANL-302', 'cf: edit', 30, 'cf'),
      iss('ANL-303', 'cf: новая страница', 32, 'cf'),
    ],
    timeline72h: makeTimeline72h([
      { key: 'ANL-301', summary: 'cf edit', kind: 'cf', atHoursAgo: 2 },
      { key: 'ANL-302', summary: 'cf edit', kind: 'cf', atHoursAgo: 4 },
      { key: 'ANL-301', summary: 'comment', kind: 'comment', atHoursAgo: 5 },
      { key: 'ANL-301', summary: 'cf edit', kind: 'cf', atHoursAgo: 26 },
      { key: 'ANL-302', summary: 'cf edit', kind: 'cf', atHoursAgo: 30 },
      { key: 'ANL-303', summary: 'cf new page', kind: 'cf', atHoursAgo: 32 },
    ]),
    blockers: [],
    badges: { commits48h: 0, pr48h: 0, reviews: 1, approves: 0, conf48h: 6, prReviews48h: 1, prApproves48h: 0 },
    cfItems: [
      { key: 'CF-1', title: 'KYC Метрики Q2 — обзор', updatedAt: ago(2), kind: 'edit' },
      { key: 'CF-2', title: 'A/B Тест: 14-дневные результаты', updatedAt: ago(4), kind: 'edit' },
      { key: 'CF-3', title: 'Очистка данных KYC — план', updatedAt: ago(32), kind: 'create' },
      { key: 'CF-4', title: 'Дашборд KYC: change-log', updatedAt: ago(26), kind: 'edit' },
    ],
    heatmap72x4: makeHeatmap(301, 1.1),
    contextSwitches: { distinctIssueKeys: 3, switchEvents: [
      { from: 'ANL-301', to: 'ANL-302', at: ago(4) },
    ], switchScore: 1 },
    sprintGoalProgress: { progress: 0.48, pace: 'on-track', planned: 26, done: 12 },
  }),

  p({
    key: 'demo-gorin.gg', name: 'Горин Григорий Григорьевич', label: 'Горин Г.Г.',
    email: 'gorin@demo.local',
    jiraAccountId: 'demo-gorin', confluenceAccountId: 'cf-demo-gorin',
    teamKey: 'analytics',
    activeIssuesCount: 2, blockedCount: 0,
    issuesNow: [iss('ANL-601', 'Очистка дублей в KYC')],
    timelineToday: [iss('ANL-601', 'cf edit «дубли по СНИЛС»', 5, 'cf')],
    timelineYesterday: [iss('ANL-601', 'comment', 30)],
    timeline72h: makeTimeline72h([
      { key: 'ANL-601', summary: 'cf edit', kind: 'cf', atHoursAgo: 5 },
      { key: 'ANL-601', summary: 'comment', kind: 'comment', atHoursAgo: 30 },
    ]),
    blockers: [],
    badges: { commits48h: 1, pr48h: 0, reviews: 0, approves: 0, conf48h: 1, prReviews48h: 0, prApproves48h: 0 },
    cfItems: [{ key: 'CF-5', title: 'Дубли по СНИЛС — анализ', updatedAt: ago(5), kind: 'edit' }],
    heatmap72x4: makeHeatmap(601, 0.5),
    contextSwitches: { distinctIssueKeys: 1, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.38, pace: 'drift', planned: 16, done: 6 },
  }),

  p({
    key: 'demo-romanov.rr', name: 'Романов Роман Романович', label: 'Романов Р.Р.',
    email: 'romanov@demo.local',
    jiraAccountId: 'demo-romanov',
    teamKey: 'analytics',
    activeIssuesCount: 2, blockedCount: 1,
    issuesNow: [iss('ANL-901', 'Out-of-sprint: legacy report')],
    timelineToday: [],
    timelineYesterday: [iss('ANL-901', 'comment: жду PO', 30)],
    timeline72h: makeTimeline72h([
      { key: 'ANL-901', summary: 'comment', kind: 'comment', atHoursAgo: 30 },
    ]),
    blockers: [
      { key: 'ANL-901', summary: 'Out-of-sprint: ждём product-owner', dwellHours: 36, ageDays: 1.5 },
    ],
    stale: [{ key: 'ANL-902', summary: 'Старая задача без апдейтов', ageDays: 14 }],
    badges: { commits48h: 0, pr48h: 0, reviews: 0, approves: 0, conf48h: 0, prReviews48h: 0, prApproves48h: 0 },
    heatmap72x4: makeHeatmap(901, 0.15),
    contextSwitches: { distinctIssueKeys: 1, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.0, pace: 'off-track', planned: 12, done: 0 },
  }),

  p({
    key: 'demo-zaytsev.ze', name: 'Зайцев Захар Эдуардович', label: 'Зайцев З.Э.',
    email: 'zaytsev@demo.local',
    jiraAccountId: 'demo-zaytsev', bitbucketLogin: 'zaytsev.ze', confluenceAccountId: 'cf-demo-zaytsev',
    teamKey: 'analytics',
    activeIssuesCount: 0, blockedCount: 0,
    timelineToday: [],
    timelineYesterday: [],
    timeline72h: [],
    blockers: [],
    badges: { commits48h: 0, pr48h: 0, reviews: 0, approves: 0, conf48h: 0, prReviews48h: 0, prApproves48h: 0 },
    heatmap72x4: makeHeatmap(2102, 0.05),
    contextSwitches: { distinctIssueKeys: 0, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0, pace: 'no-data', planned: 0, done: 0 },
  }),

  // ── QA (3 человека) ─────────────────────────────────────────

  p({
    key: 'demo-mironova.mm', name: 'Миронова Мария Михайловна', label: 'Миронова М.М.',
    email: 'mironova@demo.local',
    jiraAccountId: 'demo-mironova', bitbucketLogin: 'mironova.mm',
    teamKey: 'qa',
    activeIssuesCount: 4, blockedCount: 0,
    issuesNow: [
      iss('QA-1201', 'Performance regression — gateway'),
      iss('QA-1202', 'Smoke pack для KYC'),
    ],
    timelineToday: [
      iss('QA-1201', 'zephyr: prep test-run', 2, 'zephyr'),
      iss('QA-1202', 'zephyr: 4 cases созданы', 4, 'zephyr'),
    ],
    timelineYesterday: [iss('QA-1201', 'zephyr: 6 prog runs', 28, 'zephyr')],
    timeline72h: makeTimeline72h([
      { key: 'QA-1201', summary: 'zephyr prep', kind: 'zephyr', atHoursAgo: 2 },
      { key: 'QA-1202', summary: 'zephyr created', kind: 'zephyr', atHoursAgo: 4 },
      { key: 'QA-1201', summary: 'zephyr executed', kind: 'zephyr', atHoursAgo: 28 },
    ]),
    blockers: [],
    badges: { commits48h: 0, pr48h: 0, reviews: 1, approves: 0, conf48h: 0, testsCreated48h: 4, testsExecuted48h: 6, prReviews48h: 1, prApproves48h: 0 },
    zephyrTestsCreatedRecent: [
      { key: 'ZEPH-201', summary: 'gateway perf — heavy load', when: ago(2), pk: 'QA' },
      { key: 'ZEPH-202', summary: 'KYC smoke — happy path', when: ago(4), pk: 'QA' },
    ],
    zephyrTestsExecutedRecent: [
      { key: 'ZEPH-201', summary: 'gateway perf — fail', when: ago(28), pk: 'QA' },
    ],
    heatmap72x4: makeHeatmap(1201, 0.9),
    contextSwitches: { distinctIssueKeys: 2, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.45, pace: 'on-track', planned: 18, done: 8 },
  }),

  p({
    key: 'demo-pavlov.pa', name: 'Павлов Павел Александрович', label: 'Павлов П.А.',
    email: 'pavlov@demo.local',
    jiraAccountId: 'demo-pavlov',
    teamKey: 'qa',
    activeIssuesCount: 3, blockedCount: 1,
    issuesNow: [
      iss('QA-1301', 'Регресс admin-flow (manual)'),
      iss('QA-1302', 'Локализация: тесты ru/en'),
    ],
    timelineToday: [],
    timelineYesterday: [iss('QA-1301', 'comment: «жду фикс от FE»', 30)],
    timeline72h: makeTimeline72h([
      { key: 'QA-1301', summary: 'comment', kind: 'comment', atHoursAgo: 30 },
    ]),
    blockers: [
      { key: 'QA-1301', summary: 'Регресс: ждём фикс от FE-команды', dwellHours: 60, ageDays: 2.5 },
    ],
    badges: { commits48h: 0, pr48h: 0, reviews: 0, approves: 0, conf48h: 0, testsCreated48h: 0, testsExecuted48h: 0, prReviews48h: 0, prApproves48h: 0 },
    heatmap72x4: makeHeatmap(1301, 0.3),
    contextSwitches: { distinctIssueKeys: 2, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.20, pace: 'drift', planned: 14, done: 3 },
  }),

  p({
    key: 'demo-belov.bb', name: 'Белов Богдан Богданович', label: 'Белов Б.Б.',
    email: 'belov@demo.local',
    jiraAccountId: 'demo-belov', bitbucketLogin: 'belov.bb', confluenceAccountId: 'cf-demo-belov',
    teamKey: 'qa',
    activeIssuesCount: 2, blockedCount: 0,
    issuesNow: [iss('QA-1401', 'Auto-tests: pipeline upgrade')],
    timelineToday: [
      iss('QA-1401', 'commit: pipeline.yml', 2, 'commit'),
      iss('QA-1401', 'cf: edit «CI pipeline»', 5, 'cf'),
    ],
    timelineYesterday: [iss('QA-1401', 'commit', 28, 'commit')],
    timeline72h: makeTimeline72h([
      { key: 'QA-1401', summary: 'commit', kind: 'commit', atHoursAgo: 2 },
      { key: 'QA-1401', summary: 'cf edit', kind: 'cf', atHoursAgo: 5 },
      { key: 'QA-1401', summary: 'commit', kind: 'commit', atHoursAgo: 28 },
    ]),
    blockers: [],
    badges: { commits48h: 3, pr48h: 1, reviews: 0, approves: 0, conf48h: 1, testsCreated48h: 0, testsExecuted48h: 0, prReviews48h: 0, prApproves48h: 0 },
    bbItems: [
      { key: 'PR-QA1401', title: 'CI pipeline upgrade', updatedAt: ago(2), kind: 'commit' },
    ],
    cfItems: [{ key: 'CF-6', title: 'CI pipeline — описание этапов', updatedAt: ago(5), kind: 'edit' }],
    heatmap72x4: makeHeatmap(1401, 0.8),
    contextSwitches: { distinctIssueKeys: 1, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.55, pace: 'on-track', planned: 16, done: 9 },
  }),

  // ── FRONTEND (3 человека) ─────────────────────────────────

  p({
    key: 'demo-savina.sa', name: 'Савина Светлана Андреевна', label: 'Савина С.А.',
    email: 'savina@demo.local',
    jiraAccountId: 'demo-savina', bitbucketLogin: 'savina.sa',
    teamKey: 'frontend',
    activeIssuesCount: 5, blockedCount: 0,
    issuesNow: [
      iss('FE-1501', 'Дашборд: новый layout'),
      iss('FE-1502', 'A11y: focus states'),
      iss('FE-1503', 'Темы: light/dark refactor'),
    ],
    timelineToday: [
      iss('FE-1501', 'commit: layout-grid', 1, 'commit'),
      iss('FE-1502', 'PR review', 3, 'pr'),
      iss('FE-1503', 'commit: theme tokens', 5, 'commit'),
      iss('FE-1501', 'commit: responsive breakpoints', 7, 'commit'),
    ],
    timelineYesterday: [
      iss('FE-1501', 'commit: header layout', 26, 'commit'),
      iss('FE-1502', 'commit: focus ring', 30, 'commit'),
    ],
    timeline72h: makeTimeline72h([
      { key: 'FE-1501', summary: 'commit layout', kind: 'commit', atHoursAgo: 1 },
      { key: 'FE-1502', summary: 'PR review', kind: 'pr', atHoursAgo: 3 },
      { key: 'FE-1503', summary: 'commit theme', kind: 'commit', atHoursAgo: 5 },
      { key: 'FE-1501', summary: 'commit responsive', kind: 'commit', atHoursAgo: 7 },
      { key: 'FE-1501', summary: 'commit header', kind: 'commit', atHoursAgo: 26 },
      { key: 'FE-1502', summary: 'commit focus', kind: 'commit', atHoursAgo: 30 },
    ]),
    blockers: [],
    badges: { commits48h: 9, pr48h: 2, reviews: 3, approves: 1, conf48h: 0, prReviews48h: 3, prApproves48h: 1 },
    bbItems: [
      { key: 'PR-FE1501', title: 'Dashboard new layout', updatedAt: ago(1), kind: 'commit' },
      { key: 'PR-FE1502', title: 'A11y focus states', updatedAt: ago(3), kind: 'pr' },
      { key: 'PR-FE1503', title: 'Theme tokens refactor', updatedAt: ago(5), kind: 'commit' },
    ],
    heatmap72x4: makeHeatmap(1501, 1.7),
    contextSwitches: { distinctIssueKeys: 3, switchEvents: [
      { from: 'FE-1501', to: 'FE-1502', at: ago(3) },
      { from: 'FE-1502', to: 'FE-1503', at: ago(5) },
    ], switchScore: 2 },
    sprintGoalProgress: { progress: 0.68, pace: 'on-track', planned: 32, done: 22 },
  }),

  p({
    key: 'demo-novikov.nn', name: 'Новиков Николай Никитич', label: 'Новиков Н.Н.',
    email: 'novikov@demo.local',
    jiraAccountId: 'demo-novikov', bitbucketLogin: 'novikov.nn',
    teamKey: 'frontend',
    activeIssuesCount: 4, blockedCount: 1,
    issuesNow: [
      iss('FE-1601', 'Mobile-web: responsive hero'),
      iss('FE-1602', 'i18n: добавить ru/en'),
    ],
    timelineToday: [iss('FE-1601', 'commit: media queries', 4, 'commit')],
    timelineYesterday: [iss('FE-1601', 'comment: жду design specs', 30)],
    timeline72h: makeTimeline72h([
      { key: 'FE-1601', summary: 'commit', kind: 'commit', atHoursAgo: 4 },
      { key: 'FE-1601', summary: 'comment', kind: 'comment', atHoursAgo: 30 },
    ]),
    blockers: [
      { key: 'FE-1601', summary: 'Mobile-web: ждём финальные design-specs', dwellHours: 30, ageDays: 1.25 },
    ],
    badges: { commits48h: 2, pr48h: 0, reviews: 1, approves: 0, conf48h: 0, prReviews48h: 1, prApproves48h: 0 },
    bbItems: [{ key: 'PR-FE1601', title: 'Mobile-web hero', updatedAt: ago(4), kind: 'commit' }],
    heatmap72x4: makeHeatmap(1601, 0.5),
    contextSwitches: { distinctIssueKeys: 2, switchEvents: [], switchScore: 0 },
    sprintGoalProgress: { progress: 0.25, pace: 'drift', planned: 22, done: 5 },
  }),

  p({
    key: 'demo-orlov.oo', name: 'Орлов Олег Олегович', label: 'Орлов О.О.',
    email: 'orlov@demo.local',
    jiraAccountId: 'demo-orlov', bitbucketLogin: 'orlov.oo', confluenceAccountId: 'cf-demo-orlov',
    teamKey: 'frontend',
    activeIssuesCount: 7, blockedCount: 1,
    issuesNow: [
      iss('FE-1701', 'Performance: bundle-split'),
      iss('FE-1702', 'Bug: input-mask for SNILS'),
      iss('FE-1703', 'Refactor: state.activeSection'),
    ],
    timelineToday: [
      iss('FE-1701', 'commit: chunk split', 1, 'commit'),
      iss('FE-1702', 'PR review', 3, 'pr'),
      iss('FE-1703', 'commit', 5, 'commit'),
      iss('FE-1701', 'commit: lazy-imports', 6, 'commit'),
    ],
    timelineYesterday: [
      iss('FE-1701', 'commit', 26, 'commit'),
      iss('FE-1702', 'comment: «нашёл edge-case с дробью»', 32),
    ],
    timeline72h: makeTimeline72h([
      { key: 'FE-1701', summary: 'commit chunk', kind: 'commit', atHoursAgo: 1 },
      { key: 'FE-1702', summary: 'PR review', kind: 'pr', atHoursAgo: 3 },
      { key: 'FE-1703', summary: 'commit', kind: 'commit', atHoursAgo: 5 },
      { key: 'FE-1701', summary: 'commit lazy', kind: 'commit', atHoursAgo: 6 },
      { key: 'FE-1701', summary: 'commit', kind: 'commit', atHoursAgo: 26 },
    ]),
    blockers: [
      { key: 'FE-1703', summary: 'Refactor: ждём решение арх. совета по state-shape', dwellHours: 84, ageDays: 3.5 },
    ],
    badges: { commits48h: 6, pr48h: 2, reviews: 4, approves: 1, conf48h: 0, prReviews48h: 4, prApproves48h: 1 },
    bbItems: [
      { key: 'PR-FE1701', title: 'Bundle-split', updatedAt: ago(1), kind: 'commit' },
      { key: 'PR-FE1702', title: 'SNILS mask', updatedAt: ago(3), kind: 'pr' },
      { key: 'PR-FE1703', title: 'State refactor', updatedAt: ago(5), kind: 'commit' },
    ],
    heatmap72x4: makeHeatmap(1701, 1.5),
    contextSwitches: { distinctIssueKeys: 4, switchEvents: [
      { from: 'FE-1701', to: 'FE-1702', at: ago(3) },
      { from: 'FE-1702', to: 'FE-1703', at: ago(5) },
      { from: 'FE-1703', to: 'FE-1701', at: ago(6) },
    ], switchScore: 3 },
    sprintGoalProgress: { progress: 0.58, pace: 'on-track', planned: 36, done: 21 },
  }),
];

/* ────────────────────────────────────────────────────────────
   TEAMS — 4 команды, members consistent с participants[]
   ──────────────────────────────────────────────────────────── */
const TEAMS = [
  {
    key: 'platform', name: 'Платформа',
    members: ['demo-ivanov.ii','demo-petrov.pp','demo-kozlov.dd','demo-fedorov.ff','demo-volkov.vv','demo-sokolova.ss'],
    paceClass: 'on-track',
    activeIssuesCount: 27, blockedCount: 4,
  },
  {
    key: 'analytics', name: 'Аналитика',
    members: ['demo-sidorova.an','demo-gorin.gg','demo-romanov.rr','demo-zaytsev.ze'],
    paceClass: 'drift',
    activeIssuesCount: 10, blockedCount: 1,
  },
  {
    key: 'qa', name: 'Тестирование',
    members: ['demo-tarasova.tt','demo-mironova.mm','demo-pavlov.pa','demo-belov.bb'],
    paceClass: 'on-track',
    activeIssuesCount: 14, blockedCount: 1,
  },
  {
    key: 'frontend', name: 'Frontend',
    members: ['demo-egorov.ee','demo-savina.sa','demo-novikov.nn','demo-orlov.oo'],
    paceClass: 'on-track',
    activeIssuesCount: 20, blockedCount: 2,
  },
];

/* ────────────────────────────────────────────────────────────
   SCANNER_V2 — sprint goals (4) + risks + meta
   ──────────────────────────────────────────────────────────── */
const SPRINTS = [
  {
    pk: 'DEMO', name: 'Платформа Sprint 24',
    startDate: '2026-04-22', endDate: '2026-05-06',
    progress: 0.55, pace: 'on-track',
    plannedHours: 200, doneHours: 110, daysLeft: 2,
    teamKey: 'platform',
  },
  {
    pk: 'ANL', name: 'Аналитика Sprint 12',
    startDate: '2026-04-22', endDate: '2026-05-06',
    progress: 0.32, pace: 'drift',
    plannedHours: 80, doneHours: 26, daysLeft: 2,
    teamKey: 'analytics',
  },
  {
    pk: 'QA', name: 'QA Sprint 18',
    startDate: '2026-04-22', endDate: '2026-05-06',
    progress: 0.40, pace: 'on-track',
    plannedHours: 60, doneHours: 24, daysLeft: 2,
    teamKey: 'qa',
  },
  {
    pk: 'FE', name: 'Frontend Sprint 31',
    startDate: '2026-04-22', endDate: '2026-05-06',
    progress: 0.50, pace: 'on-track',
    plannedHours: 95, doneHours: 48, daysLeft: 2,
    teamKey: 'frontend',
  },
];

const SCANNER_V2 = {
  risks: {
    totalOrphans:        7,
    totalRealOrphans:    4,
    totalOutOfSprint:   12,
    outOfSprintRatio:   0.18,
    orphansByPk:        { DEMO: 4, ANL: 2, QA: 1, FE: 0 },
    outOfSprintByPerson: {
      'demo-romanov.rr':   2,
      'demo-kozlov.dd':    3,
      'demo-pavlov.pa':    1,
      'demo-novikov.nn':   2,
      'demo-orlov.oo':     1,
      'demo-petrov.pp':    1,
      'demo-sokolova.ss':  2,
    },
  },
  sprintGoal: {
    aggregateProgress: 0.46,
    aggregateDone:     208,
    aggregateTotal:    435,
    aggregatePace:     'on-track',
    sprints:           SPRINTS,
  },
  teams: TEAMS,
  meta: {
    fetchedAtMs:      NOW_MS,
    fingerprint:      'demo-fixture-v2',
    pkCount:          4,
    sprintsCount:     4,
    participantCount: PARTICIPANTS.length,
    dwellHours:       24,
  },
};

/* ────────────────────────────────────────────────────────────
   SPACES — populated sprintIssues для drill-down
   ──────────────────────────────────────────────────────────── */
function _sprintIssues(pk, count, prefix) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push({
      key: `${prefix}-${i}`,
      summary: `Demo issue ${prefix}-${i}`,
      status: i % 4 === 0 ? 'Done' : (i % 3 === 0 ? 'Review' : 'In Progress'),
      assignee: PARTICIPANTS[i % PARTICIPANTS.length].label,
      pk,
    });
  }
  return out;
}

const SPACES = {
  DEMO: {
    pk: 'DEMO', name: 'Платформа',
    sprintIssues: _sprintIssues('DEMO', 24, 'DEMO'),
    activeSprintName: 'Платформа Sprint 24',
    activeSprintInfo: { name: 'Платформа Sprint 24', startDate: '2026-04-22', endDate: '2026-05-06' },
    hasError: false,
  },
  ANL: {
    pk: 'ANL', name: 'Аналитика',
    sprintIssues: _sprintIssues('ANL', 12, 'ANL'),
    activeSprintName: 'Аналитика Sprint 12',
    activeSprintInfo: { name: 'Аналитика Sprint 12', startDate: '2026-04-22', endDate: '2026-05-06' },
    hasError: false,
  },
  QA: {
    pk: 'QA', name: 'Тестирование',
    sprintIssues: _sprintIssues('QA', 14, 'QA'),
    activeSprintName: 'QA Sprint 18',
    activeSprintInfo: { name: 'QA Sprint 18', startDate: '2026-04-22', endDate: '2026-05-06' },
    hasError: false,
  },
  FE: {
    pk: 'FE', name: 'Frontend',
    sprintIssues: _sprintIssues('FE', 18, 'FE'),
    activeSprintName: 'Frontend Sprint 31',
    activeSprintInfo: { name: 'Frontend Sprint 31', startDate: '2026-04-22', endDate: '2026-05-06' },
    hasError: false,
  },
};

/* ────────────────────────────────────────────────────────────
   FULL FIXTURE — frozen
   ──────────────────────────────────────────────────────────── */
function deepFreeze(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  Object.values(obj).forEach(deepFreeze);
  return Object.freeze(obj);
}

/** Полный demo-model. Frozen — read-only.
 *  Обращение через `loadDemo()` в `TeamScanner2` либо через тесты. */
export const SCANNER2_DEMO_FIXTURE = deepFreeze({
  isDemo: true,
  fetchedAt:   NOW_ISO,
  jiraBaseUrl: 'https://demo.example.local',
  projectKeys: ['DEMO', 'ANL', 'QA', 'FE'],
  participants: PARTICIPANTS,
  spaces:       SPACES,
  scannerV2:    SCANNER_V2,
  bots:                       [],
  botsFilteredOut:            0,
  deactivatedFilteredOut:     0,
  totalIssues:                68,
  totalDoneIssues:            18,
  unresolvedIssues:           50,
  teamThresholdsApplied:      {},
  _isDemoFixture: true,
});

/** Returns deep clone — позволяет вызывающему мутировать fixture (например,
 *  ставить `_fetchedAtMs = Date.now()`) без затрагивания frozen original.
 *  Возвращает новый объект на каждый вызов. */
export function getScanner2DemoModel() {
  const model = JSON.parse(JSON.stringify(SCANNER2_DEMO_FIXTURE));
  // Участники fixture используют teamKey, а не projects[]. Проставляем
  // projects[] постфактум чтобы _applyPkFilter работал в demo-режиме
  // при клике по команде в multi-view.
  const TK_PK = { platform: 'DEMO', analytics: 'ANL', qa: 'QA', frontend: 'FE' };
  model.participants = model.participants.map(participant => {
    const pk = TK_PK[participant.teamKey];
    return pk ? { ...participant, projects: [pk] } : participant;
  });
  return model;
}
