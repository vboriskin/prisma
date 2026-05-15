# X-05 — Решение по roadmap V22+/V23

> Источник: `audit-experts-2026-05-15/10-cross-cutting-selvadurai.md`, секция
> «Roadmap critique».

## Контекст

Naveen Selvadurai (cross-cutting product audit) рекомендует **отложить**
запланированные V22+/V23 фичи (Jira Hygiene Engine, Cross-team Benchmarks)
в пользу 2-недельного focus-sprint'а по cross-tab glue.

## Аргументы Selvadurai

1. **Marginal value Сканнера падает.** Сканнер 2.0 — 3640 LOC orchestrator +
   ~2500 LOC рендереров (5 файлов). Каждая новая под-фича — +200–400 LOC при
   compound-effect'е ≈0 (она остаётся внутри-Сканнерной).
2. **Product-level confusion растёт.** Hygiene-score и Benchmarks-score —
   это **ещё два числа** в продукте, который уже путает пользователя
   четырьмя разными score-метриками (Chat health, Scanner sprint-gauge,
   Gantt off-course, Hygiene). Без unified-health-score новые score только
   усугубят.
3. **Distraction от main moat.** Identity-deterministic attribution + cross-
   tab focus — это unique selling points Призмы. Они недо-вложены.
4. **«Killer feature»-rationale в night-summary спорно.** Hygiene —
   полезная фича, но **не moat**: SonarQube, Linear, JiraSenpai делают то
   же самое. Cross-team Benchmarks — interesting, но это аналитика, не
   product-glue.

## Что вместо этого предлагает Selvadurai

**V22 (вместо Hygiene):**
- F1. Production call-сайты для `Focus.set` в Реестре, Ганте, Сканнере и
  Чате. 4 точки входа. ≤16 часов.
- F2. `executeAction` case `'set_focus'` + chip-actions для SCANNER_QUERY
  response. ≤8 часов.
- F3. `GanttView.applyFocus({kind:'epic'})` — scroll + highlight + temp-
  style. ≤8 часов.
- F4. Объединённый router: `#scanner?employee=...` через Router whitelist.
  Удалить дубликат hash-логики из teamScanner2.js. ≤12 часов.

**V23 (вместо Cross-team Benchmarks):**
- F5. Unified health-score model. Engine-уровень merge всех 4 score'ов в
  один с explainable breakdown. ≤24 часа.
- F6. Cross-tab block-graph: Реестр-эпики ↔ Сканнер-Jira-issues by
  epicKey. ≤32 часа.
- F7. «Утренний briefing» — новый intent `OVERVIEW_ALL` + UI-блок над FAB
  / на dashboard. ≤24 часа.
- F8. Symmetric deep-link с `history.pushState` (browser-back работает).
  ≤12 часов.

## Решение по фактически выполненной работе

В рамках текущего sprint'а (V22, audit-experts-2026-05-15) **уже реализованы**:

| Selvadurai-task | Текущая реализация | Статус |
|---|---|---|
| F1 (Focus.set call-sites) | X-02 + K-03 — 3 production call-sites: Registry row-click, Gantt pill-click, Scanner participant-toggle | ✅ Сделано |
| F2 (set_focus action) | X-02 — `case 'set_focus'` в `chatActions.js:executeAction` + whitelist в `_VALID_ACTION_TYPES` | ✅ Сделано |
| F3 (GanttView.applyFocus epic) | X-02 + K-03 — `app.js` EventBus `focus-changed` handler делает scroll+highlight; CSS `.gantt-row-focused` 2.4s pulse | ✅ Сделано |
| F4 (unified router) | X-03 — `app/router.js` принимает `focusKind`/`focusId`/`focusPeriod`; Scanner hash формат переведён на канонический; legacy `#scanner2/employee/<key>` распознаётся для обратной совместимости | ✅ Сделано |
| F5 (unified health-score) | Не сделано — это полноценный engine | ⏳ Отложено |
| F6 (cross-tab block-graph) | Частично — X-04 merge blockers из Registry + Scanner в `WHAT_RISKS` context (`buildRisksContext`) с маркировкой `_blockerSource`. Полный block-graph engine — не сделан | 🟡 Частично |
| F7 (Morning briefing) | Не сделано — отдельный killer (K-01 в master-таблице, оценка 1 sprint) | ⏳ Отложено |
| F8 (history.pushState) | Не сделано — Router сейчас использует `replaceState`. Browser-back между секциями работать не будет до этого фикса | ⏳ Отложено |

## Решение по Hygiene Engine V23 / Benchmarks

**Текущая позиция:** оба остаются как есть (уже выкачены, ~656 LOC). Не
расширять до 24 правил, не добавлять новые подвкладки. Наблюдать
telemetry-флаги:
- `scanner2.hygiene_open` — если drilldown-rate < 5% после месяца → killer
  не работает, candidate на cleanup.
- `scanner2.benchmark_view` — то же.

## Следующий блок работы (рекомендация)

1. **F5 (unified health-score)** — единый 0–100 score с explainable
   breakdown: «65/100. −10 за 3 блокера (Сканнер), −8 за 5% задач без
   эпика (Hygiene), −7 за перенос на 1.22 (Гант), −5 за low sprint-goal
   alignment (Сканнер)». Click on row → focus.
2. **F7 (Morning Brief)** — карточка «что изменилось за ночь» в Dashboard
   на первом открытии за день. Использует `buildDailyReport` (`chatReports.js`
   уже готов) + новый render-target вне chat-panel.
3. **F8 (history.pushState)** — заменить `replaceState` на `pushState`
   только для пользовательских navigate-action'ов; URL-hash-driven init
   остаётся replaceState (чтобы не плодить history-entries при first-load).

---

— Принято на основании audit-experts-2026-05-15 § Selvadurai #5, V22-sprint.
