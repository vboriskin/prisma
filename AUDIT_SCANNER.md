# AUDIT_SCANNER.md — Раздел «Сканнер команд» + дизайн подвкладки «Гигиена Jira»

> Этап 10/14. Команда: продуктовый дизайнер + tech lead + senior-developer (Jira).
> Дата: 2026-05-07. Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`.
>
> Часть А — состояние раздела «Сканнер команд» (НЕ дублируем V21-tabs/V20 handoff).
> Часть Б — design-doc подвкладки «Гигиена Jira» (новая, не существующая на сегодня).

---

## Часть А. Текущее состояние раздела «Сканнер команд»

### A.0 Topology — что фактически есть (по коду)

Раздел «Сканнер команд» — **не самостоятельная top-level section**, он рендерится из семейства `integrations/teamScanner2*.js` (12 файлов, 12.8k LOC). Точка входа — `TeamScanner2.attach(container)` (`integrations/teamScanner2.js:253`). Внутри одного контейнера живут **3 подвкладки** (sub-tabs), отрисовываемые через единый `renderTeamGlance(model, ctx)` в `teamScanner2Renderer.js`:

| Подвкладка | Trigger | Что показывает | Состояние |
|---|---|---|---|
| **«Сегодня»** (`today`, default) | `_scannerTab='today'` | Hero (group-counts, velocity row, sources, risks) → Daily brief (в коде = empty stub) → Action queue (top-5) → `<details>` Операции → `<details>` Тренды | живая, основное место |
| **«Глубже»** (`deeper`) | `_scannerTab='deeper'` | Hero (тот же) + tab-bar + `renderSleepingDataInsights(model)` — 7+ tile-блоков с tab-фильтром (Все/Ежедневно/Спринт/Команда/Организация/Качество) | живая, агрегатор |
| **«Метрики»** (`metrics`) | `_scannerTab='metrics'` | Hero + tab-bar + `<div id="ts2-metrics-mount">` куда монтируется `views/metricsDeep/` ECharts-дашборд | Phase 1 (2 demo charts), Phase 2 — 60 charts (TODO) |

Дополнительные «вторичные» surface'ы внутри Сканнера:

- **Hero** (`renderTeamGlance`) — один и тот же на всех подвкладках; меняется только pane снизу (today/deeper/metrics).
- **Multi-team view** (`renderMultiTeamView`) — переключатель `_activeView='team'|'multi'` в orchestrator'е. Аггрегатная таблица команд.
- **Sub-tab «sd-tabs»** внутри `renderSleepingDataInsights` (категории «Ежедневно/Спринт/Команда/Организация/Качество»).
- **Sub-tab «velocity-view»** (`data-velocity-view`) — внутри hero, переключает 3 режима velocity-row.
- **Side-panel (slide-in 480px)** — `renderEmployeeDetailPanel` для drill-down per-person.
- **Modals** — `renderTeamConfigModal`, `renderDiagnosticModal`, `renderHowCalculatedModal`, `renderIdentityResolvePreview`, `renderCrvDrilldownModal`, `renderAnomalyMiniChart`, `renderVelocityCompareModal`.

### A.1 Ценность каждой подвкладки

| Подвкладка | Целевой пользователь | Ценность утром / в ретро / редко |
|---|---|---|
| Сегодня | Тимлид (5 минут утра) | **Ежедневная**: «5 минут — 5 имён — действие на каждого». Hero даёт «здесь и сейчас», Action queue — приоритезированный top-5 кому помочь. |
| Глубже | PO/SM на ретро + тимлид раз в 1-2 недели | **Ретроспективная**: sleeping data (resolution split, sub-task ratio, fix-version coverage, DORA proxy, throughput, hot-files, knowledge centralization, dependency Sankey). Не для daily, для разбора паттернов. |
| Метрики | CEO/PM (управленческая отчётность) | **Стратегическая**: 60 ECharts-графиков (planned). Сейчас 2 demo — decoupled от Сегодня/Глубже. |

### A.2 Соотношение с другими разделами и потенциальные дубли

| Раздел верхнего уровня | Где пересечение со Сканнером | Дубль? |
|---|---|---|
| **Метрики** (`#section-metrics`, `views/metrics.js`) | Поверх `state.rows` (registry-derived). Сканнер — поверх Pulse-модели (Jira+BB+CF live). | Нет дубля API, но есть **дубль ментальной модели**: оба зовутся «Метрики», оба показывают KPI. Это путает — см. также Допущение #2 в `AUDIT_MAP.md`. |
| **Сотрудники** (`views/employees.js`) | Per-person view; Сканнер тоже даёт person-rows + side-panel. | **Сильный дубль** по surface'ам (per-person KPI карточка). Сканнер показывает activity (events 24h), Сотрудники — registry-derived (assignments, skills, leave). Нужна навигация-bridge — сейчас она односторонняя (через `data-jump-key` action queue, но НЕ из Сотрудников в Сканнер). |
| **Перегрузка** (`BurnoutWatchtowerView`) | Сканнер показывает out-of-sprint ratio + блокеры; Перегрузка — workload-based burnout. | Близко, но НЕ дубль: разные метрики (events vs. assignments). При этом UX-fragmentation: тимлид должен ходить в обе. |
| **Здоровье компонентов** (`ComponentHealthView`) | В Sleeping Data есть «Component owner load» (`sum.componentOwnerLoad`) и «Top shared components» в `crossTeamMetrics`. | **Частичный дубль**: Component Health показывает то же самое плюс CF-связку. |
| **Точность оценок** (`EstimationCalibrationView`) | В Сканнере есть `renderEstimateAccuracy(model)` (median actual/estimate за 30д) и `renderSprintLagBreakdown`. | **Дубль** — почти один-в-один. Раздел верхнего уровня = read-only static; Сканнер = live, с действиями. |
| **Документация: долги** (`DocDebtConsoleView`) | В Сканнере: `staleConfluence` в bigMetrics + per-person CF events. | Не дубль (разный угол), но связь через `confluenceAccountId` identity. |
| **AI Анализ** (`#section-ai`) | Использует данные Pulse-модели через `aiContextBuilder.js` (косвенно). | Не дубль — другой режим (LLM narrative vs. rule-based). |
| **Действия** (`#section-actions`) | Action queue в Сканнере = mini-actions (top-5). Раздел Действия = персистентный backlog действий. | Связь должна быть: queue → раздел Действия (сейчас отсутствует — find #21). |

### A.3 Подвкладки и пайплайн в коде — недоделанные / мало используемые

- **Daily brief** (`renderDailyBrief`, line 1176) — **stub, возвращает пустую строку** (`'V21 — карточка «Сверка курса · Копировать» удалена по запросу пользователя.'`). Insights API `buildDailyBrief()` зовётся, но в renderer'е разрезано. → мёртвая ветка.
- **«Метрики»** sub-tab — Phase 1 (2 demo). Без roadmap'а Phase 2 (60 charts) этот таб смотрится как заглушка.
- **`renderDetailStub(model, key)`** (`teamScanner2Renderer.js:3473`) — P5 placeholder, fallback когда нет side-panel, в production unreachable.
- **DemoFixture** (`teamScanner2DemoFixture.js`, 937 LOC) — отлично, но активируется только через debug-flag/URL hash. CTA в `renderEmpty` — ссылка скрыта.
- **VelocityCompareModal** — есть renderer, но единственный entry-point — `data-velocity-compare` button, недокументирован для тимлидов в onboarding.
- **`renderHowCalculatedModal`** — покрывает только subset метрик (S1.4 Pilot ask). Большинство «Как считается?» туда не уходит.
- **`flashAnchorTarget`** — V21 P3 E2 анкорный скролл; вызывается из Action queue + `data-jump-key`, но не из external surface'ов (например, из верхней секции Сотрудники).

### A.4 50 находок по разделу «Сканнер команд»

Формат: `раздел | файл:строка | severity | проблема | решение | LOE`

```
A. Topology / sub-tabs
01 | подвкладки     | teamScanner2Renderer.js:42-66       | high     | 3 sub-tab'а («Сегодня/Глубже/Метрики») делят один hero, но каждый pane инкапсулирован разной логикой; нет единого DSL для подвкладок (config-driven). Добавить подвкладку = трогать renderTeamGlance в 3 местах. | Вынести SubTabRegistry: { id, label, render(model,ctx), badge?, visible? }; renderTeamGlance читает реестр. | M
02 | Daily brief    | teamScanner2Renderer.js:1176        | high     | renderDailyBrief — empty stub, но buildDailyBrief() в Insights работает. Утренняя сводка отсутствует, хотя V20 S12 I1 для неё была сделана инфраструктура. | Восстановить как карточку (без copy-to-TG) ИЛИ удалить buildDailyBrief() из Insights, чтобы не вводить в заблуждение. | S
03 | «Метрики» Phase2 | views/metricsDeep/index.js          | medium   | 60 charts roadmap не начат; demo 2 charts смотрится как «недоделано» — пользователь чётко видит «потёмкинский» таб. | Либо явный «Coming soon» empty-state с roadmap, либо переименовать в «Графики (beta)». | S
04 | подвкладки     | teamScanner2Renderer.js:1086-1095   | medium   | Modifier-class .ts2-glance--metrics дублирует .ts2-glance--deeper («тот же паттерн что у deeper — скрывает person-rows»). CSS-класс перегружен. | Завести единый класс .ts2-glance--full-pane для обоих режимов. | XS
05 | navigation     | teamScanner2.js:213-220             | medium   | _activeView ('team' / 'multi') и _activePkFilter — 2 ortho state'а, persist'ятся в localStorage отдельно. _scannerTab — не persist'ится (на refresh всегда «today»). | Унифицировать через TeamScanner2._uiState = { tab, view, pkFilter, search }, single localStorage key. | S
06 | sub-tabs sd    | teamScanner2Renderer.js:2125-2159   | medium   | sd-tabs (Все/Ежедневно/Спринт/…) — категоризация по regex от <span> заголовка. Любая опечатка в заголовке роняет в дефолтный 'daily'. | data-sd-cat ставить в render-source каждого tile, не угадывать regex'ом. | S
07 | demo mode      | teamScanner2.js:230-234             | low      | demoMode = single boolean — нет режима «частично demo» (например, demo-режим только для CF, чтобы тестировать CF-flow без рабочего Confluence). | Переход на demoSources = { jira, bb, cf, zephyr } (уже подготовлен через _panelFilters). | M

B. Дубли с другими разделами
08 | дубль          | views/teamHealthDashboards.js:65 (EstimationCalibrationView) vs renderEstimateAccuracy() | high   | «Точность оценок» как отдельная section + та же метрика в Сканнере (Операции). Confused: куда смотреть? | Раздел верхнего уровня = surface для read-only, Сканнер = live. Связать: EstimationCalibrationView = «снимок» того же расчёта + кнопка «Открыть в Сканнере». | M
09 | дубль          | views/teamHealthDashboards.js:129 (ComponentHealthView) vs Sleeping Data «Component owner load» | high | Identical metric (issues open per component) считается дважды (различными pipelines). | Component Health → читать `model.summary.componentOwnerLoad` из единого Pulse-model'я. | M
10 | дубль          | views/employees.js vs renderPersonRows + renderEmployeeDetailPanel | medium | per-person card делается в двух местах с разной семантикой. Тимлид не понимает где «правильный» снимок сотрудника. | Договориться: «Сотрудники» = registry-perspective (skills/team/leave/assignments), «Сканнер» = activity-perspective (events 24h, blockers, sprint commit). Добавить cross-link «Открыть в Сотрудниках»/«Открыть в Сканнере». | S
11 | название       | views/metrics.js + ts2-tab=metrics  | high     | Два разных «Метрики» (top-level vs sub-tab). См. AUDIT_MAP допущение №2. | Sub-tab переименовать «Графики» (или «Тренды» если совпадение разрешим). | XS
12 | bridge         | actions queue → раздел Действия     | medium   | Action queue показывает «↑ #1 → действие», но не пишет в `actionLayer.js`. После закрытия Сканнера queue теряется. | Опция «Создать действие» на каждой строке queue — пишет в state.actions. | S

C. Состояние / TTL / стабильность
13 | TTL            | teamScanner2.js:5-25                | medium   | 6 разных TTL (5мин, 24ч, 30д, 120мин), документированы в JSDoc, но нет UI-индикатора для пользователя «вы видите снимок Х часов назад». | Hero badge: «Обновлено N мин назад · live/cached» с ссылкой на refresh. (отчасти есть в renderTopBar, но без TTL-семантики). | S
14 | refresh        | teamScanner2.js (refresh)           | medium   | refresh() сбрасывает _scannerTab → 'today' (resetScannerTab). Это раздражает: тимлид листал Глубже, нажал refresh — улетел в Сегодня. | НЕ сбрасывать tab при refresh, только при смене команды. | XS
15 | search         | teamScanner2.js:142-180             | low      | _searchCache LRU=20, дёшево; но _filterParticipantsByQuery игнорирует unicode normalization (NFC vs NFD), а в demo-fixture есть кириллица с разной композицией. | String.prototype.normalize('NFC') в обоих сравниваемых строках. | XS
16 | identity       | teamScanner2Renderer.js:1130-1152   | high     | Identity coverage banner вшит в hero — показывается всегда когда CF<50%/BB<50%, но «Auto-Resolve» сразу запускает bulk без preview каждого матча. | Открытие renderIdentityResolvePreview() — уже есть; направить кнопку туда вместо bulk apply. | S

D. Renderer god-module + расширяемость
17 | god-module     | teamScanner2Renderer.js (4890 LOC)  | critical | 4.9k строк в одном файле, 30+ render* функций. Tree-shaking невозможен; touch одного блока = риск регресса в чужом. | Распилить по слою (RenderHero, RenderToday, RenderDeeper, RenderInsights, RenderModals) — V21 V2 todo уже зафиксирован в комментарии :1255. | L
18 | enrichment     | teamScanner2Enrichment.js (1351 LOC)| high     | Один файл — classify, blockers, sprintGoal, hygiene, riskSummary, etc. mix of pure + IO-aware (читает state.employees). | Разбить: pure-classifier (есть отдельно), per-person-metrics (тоже есть), team-metrics (новый файл). | M
19 | classifier     | teamScanner2Classifier.js:118       | low      | Classifier 118 LOC pure; используется через WeakMap-cache + bumpClassifyEpoch. Хороший паттерн, но не задокументирован для других views (не используется ими). | Один doc-page в `docs/integrations/scanner2-classifier.md` + export `classifyByCriteria()` для re-use. | XS
20 | rendering      | teamScanner2Renderer.js:1463-2160   | high     | renderSleepingDataInsights — 700 LOC одна функция: 7-25 tile-блоков inline. Условия рендера через if (sum.X) — невозможно тестировать. | Каждый tile = отдельная функция renderTile_<name>(model) → null|string. SleepingData = orchestrator. | M

E. Гигиена данных (релевантно для будущей подвкладки)
21 | hygiene-shape  | teamScanner2Enrichment.js:694-698   | high     | Поле `hygiene` присутствует ТОЛЬКО внутри sprint (sprintGoal.sprints[].hygiene), не для backlog/all. И только 3 проверки: noAssignee/noPriority/noDescription. | Расширить до полноценного `model.hygiene = { perPk, total, byRule[] }`. См. часть Б. | L
22 | hygiene-cov    | teamScanner2Renderer.js:2378-2385   | medium   | Hygiene flags выводятся в Sprint Health как chips, но пороги (noAssignee>0) hardcode'нуты. Невозможно отключить. | Конфигурируемые пороги в teamScanner2Config.js (HYGIENE_THRESHOLDS). | S
23 | backlogHealth  | portfolioPulseModel.js:1532-1545    | medium   | backlogHealth = priority+description, но не учитывает epic/components/duedate/estimate. Слишком grubo. | Дробная: hasPriority, hasDescription, hasEpic, hasComponent, hasEstimate, hasDueDate (для bug). См. часть Б. | M
24 | orphans        | teamScanner2Enrichment.js:794-836   | medium   | Real Orphans = unassigned ∧ (in-sprint ∨ (fresh ∧ highPri)). Не учитывает orphan + epic-критичность. | + criterion: linked to goal-critical epic. | S
25 | zombies        | renderZombieIssues + detectZombies  | medium   | Zombies = open >30д без транзишенов. Не учитывает «без коммитов в branch» / «без worklog 30д». | Multi-source staleness: Jira(no transition) AND BB(no commit on branch) AND CF(no edit). | M
26 | jira-fields    | server.js:1176                      | medium   | JIRA_FIELDS статически hardcode'нут. Кастомные customfield_* не приходят (epic-link, story-points, sprint resolved через name-matching). | Авторесолв id'шников + UI для конфигурации в Settings. | M
27 | scopeChurn     | teamScanner2Renderer.js:2261-2293   | low      | scopeChurn detail работает только если есть history snapshot >1 дня. Empty state не информативен (просто скрыто). | Empty с CTA «Снимок будет завтра — сейчас baseline=сегодня». | XS
28 | components     | server.js JIRA_FIELDS               | medium   | components fetch'ится но не используется как hygiene-критерий («без компонента»). | См. часть Б, правило R-04. | S
29 | duplicates     | везде                                | high     | Нет проверки «дубли тикетов» (похожие summary/description) — стандартный hygiene-кандидат. | Cosine на summary tokens (n-gram), threshold ≥0.85 + same project + open. | M
30 | jira-links     | jiraIssueLink (renderer:67)         | low      | Link на Jira открывается с rel=noopener, но НЕ через middleware logging — Pulse не знает что тимлид открыл задачу. | Telemetry event `scanner2.issue_open` (есть pattern в logger.js, не используется). | XS

F. UX / навигация
31 | nav            | teamScanner2.js (subTab persist)    | medium   | tab не persist'ится; multi-team + pkFilter persist'ятся. Inconsistent. | Single _uiState localStorage. | S
32 | drilldown      | data-jump-key                       | low      | Click на имени из Action queue делает scroll-to-row + flashAnchorTarget. Не открывает side-panel. | Клик имени = open side-panel; chevron-icon = scroll. | XS
33 | empty states   | renderTopBar / renderEmpty          | medium   | Empty state когда «нет команд» = static text, без CTA «настроить интеграции» с deep-link. | Кнопка «Настроить Jira/BB/CF» → integrationsView с pre-set tab. | XS
34 | onboarding     | views in scanner                    | medium   | Tour onboarding не покрывает Сканнер 2.0 (есть только base sections в `onboarding/`). | Add 5-step tour: hero → today pane → deeper → metrics → person-row click. | M
35 | print/export   | renderTopBar export buttons         | low      | export только JSON snapshot. Печать (PDF) для CEO-отчётов не доступна. | window.print() + dedicated print stylesheet @media print. | M
36 | i18n           | hardcoded strings ru                 | low      | Все тексты на русском в JS-файлах. Невозможен EN-режим даже для CEO/инвесторов. | Извлечь в strings.scanner2.{ru,en}.json + `t(key)` helper. | L
37 | swap          | model `participants[]` semantics     | medium   | UX непонятно: «participant» = тот, у кого есть identity; vs employee = registry. Тимлид не знает почему один человек в Сотрудниках есть, а в Сканнере его нет. | Tooltip-glossary + хедер «Активные за 14д (N из M по реестру)». | S

G. Performance
38 | re-render      | teamScanner2.js:138-180             | medium   | _renderFull = full innerHTML rewrite каждый раз. На 109 participants заметно мерцание. | Diff-render по разделам: hero / pane / rows; реюзовать NodeList'ы. | L
39 | classify       | teamScanner2Classifier WeakMap      | low      | bumpClassifyEpoch при любом refresh — теряет cache даже при micro-update. | Detect changed-only participants → invalidate selectively. | M
40 | echarts        | views/metricsDeep/index.js          | medium   | echarts.esm.min.js (~660KB) грузится await'ом при первом открытии вкладки «Метрики». Spinner отсутствует. | Show ts2-loading-mark в #ts2-metrics-mount, а не пустой div. | XS

H. Tests / Documentation
41 | tests          | tests/unit/teamScanner2*.test.js    | medium   | Renderer практически не покрыт unit-тестами (4900 LOC). Snapshot-tests на чистых fixture'ах могли бы быстро ловить регрессии. | jsdom + golden-snapshots for renderTeamGlance(demoModel). | L
42 | docs           | docs/v20-scanner2-handoff.md        | low      | Handoff покрывает V20, но V21 sub-tabs (Глубже/Метрики) не задокументированы в одном месте. | docs/scanner2-overview.md с разделами по подвкладкам. | S
43 | telemetry      | integrations/telemetry.js           | low      | scanner2.detail_open и пара других есть, но coverage слабый: tab-switch / pane-open / refresh / export. | Расширить event'ы; собрать в panel «Чем тимлиды реально пользуются». | S

I. Server / contract
44 | jira contract  | server.js JIRA_FIELDS                | high     | parent.fields не expand'ится, поэтому epic-info есть только через name-matching customfield. На больших инстансах с custom epic-link это ломается. | Try expand=names + customfield-resolver (уже есть для sprint). | M
45 | rate limit     | jiraSearchAll (server:1112)         | medium   | maxResults=100×N (PAGE_SIZE) hardcode. На крупном PK с 5k issues = 50 запросов синхронно. | Honour Retry-After + adaptive PAGE_SIZE. | M
46 | scope          | server.js (jql 'inProgress')        | medium   | inProgress JQL = `statusCategory = "In Progress"`. На некоторых проектах статус «Code Review» относится к категории «To Do». | Принять список status-names из Settings + сэмплирование. | M

J. Связи с другими системами
47 | bb-link        | jiraIssueLink + bb commit messages   | medium   | Issue → ничего не показывает про связанные BB-PR/commit (хотя в bbAuthors items есть). Тимлид кликает на key, идёт в Jira, оттуда в Stash — 3 переключения. | inline-popover на hover: «3 commits, 1 PR (open)». | M
48 | cf-link        | confluence stale                     | low      | В sleeping data есть stale CF, но нет «связь между Jira-issue и CF-page» (через смешеные mention'ы / page-links). | Best-effort: regex-find «PROJ-XXX» в page bodies → atrribute pages back to issues. | L
49 | actions        | actionLayer.js                       | medium   | Action queue не сохраняется. Тимлид «помог» — нет отметки что это было сделано. | Bind queue → state.actions (создать = open ticket в actionLayer). | S
50 | history        | teamScanner2History.js (190 LOC)     | low      | History хранит до 30 дней × 30 entries — но diagnostic-modal не имеет UI для history-восстановления (только text-export). | UI «Сравнить с N дней назад» в hero. | M
```

---

## Часть Б. Дизайн новой подвкладки «Гигиена Jira»

### Б.0 Самое важное на 1 строку

**«Гигиена Jira» = быстрый обзор того, насколько данные команды в Jira пригодны для управленческих решений; список конкретных задач с проблемами; массовые действия для починки.**

### Б.1 Что такое «гигиена Jira» — 3 интерпретации

**Интерпретация-А «Качество backlog'а»** — backlog, готовый к взятию в работу. Каждый тикет имеет epic / priority / estimate / description / components. Перспектива: PM/PO/SM. Артефакт: список «не готовых к sprint planning».

**Интерпретация-Б «Дисциплина процесса»** — соблюдение договорённостей команды: assignee назначен, статусы переходят без обхода workflow, тикет в работе ≤ N дней, in-progress без коммитов = аномалия. Перспектива: тимлид ежедневно. Артефакт: список «нарушений сегодня + score команды».

**Интерпретация-В «Reporting-чистота»** — данные пригодны для аналитики/отчётности (CEO-режим, AI Анализ). Эпики с датами и описанием, fixVersion'ы у тикетов, story points для velocity. Перспектива: CEO/PM раз в неделю. Артефакт: «доверие к графикам (data quality score)».

#### Выбор: **Интерпретация-Б как ядро + куски Интерпретации-А и -В как «модули»**

Обоснование (tech lead + product designer):

1. Интерпретация-Б наиболее **actionable** ежедневно — это main-loop тимлида, который уже открыт в Сканнере.
2. Интерпретация-А усиливает grooming (раз в спринт), а -В — релиз-трейн (раз в релиз). Оба нужны, но реже. → разные «модули правил» в одной подвкладке, переключаемые табами.
3. Конкуренты (Eazy BI, Atlassian Hygiene, etc.) делают -А-only и теряют ценность daily. Призма должна объединять.

### Б.2 Целевые пользователи

| Роль | Когда заходит | Что хочет |
|---|---|---|
| **Тимлид** | Каждое утро на ~2 минуты | «Сколько тикетов в моей команде сломано? Какие именно? 1 клик — починил». |
| **PO** | Перед planning'ом раз в спринт | «Готов ли backlog? Какие эпики/тикеты не пройдут DOR (definition of ready)?» |
| **PM/SM** | Раз в неделю | «Тренд — гигиена улучшается / ухудшается. На какую команду надо нажать?» |
| **CEO** | Раз в месяц / квартал | «Можно ли доверять цифрам в дашборде? Где данные кривые?» |
| **Каждый сотрудник** | Опционально | «Что у меня лично сломано — без assignee, без estimate, что висит». |

### Б.3 Какие проблемы Jira-данных подвкладка находит

**24 правила гигиены, разбитые на 4 группы (модуля).**

#### Группа 1 — Daily process (ежедневно, тимлид)

| Код | Правило | Сигнал |
|---|---|---|
| D-01 | Без assignee в активном sprint | tickets in-sprint AND assignee=null |
| D-02 | In Progress без коммитов > 5 дней | status='In Progress' AND lastCommit-on-branch > 5d ago |
| D-03 | Status='In Review' > 3 дней | dwell-time per status > threshold (см. teamScanner2Enrichment dwell) |
| D-04 | Сменил assignee >2 раз за неделю | changelog.assignee transitions ≥3 in 7d |
| D-05 | In Progress но кто-то другой коммитит | branch-author ≠ assignee |
| D-06 | Орфан в активном sprint (Real Orphans) | уже есть, computeRiskSummary |

#### Группа 2 — Backlog / Definition-of-Ready (раз в спринт, PO)

| Код | Правило | Сигнал |
|---|---|---|
| R-01 | Без приоритета | priority=null OR 'None' |
| R-02 | Без описания (≤30 chars) | length(description) < 30 |
| R-03 | Без epic-link (для type≠Bug≠Spike) | issue.epic=null AND type ∉ excludedTypes |
| R-04 | Без component | components=[] AND projectRequiresComponent (config) |
| R-05 | Без estimate (для type=Story/Task) | timeOriginalEstimate=null AND storyPoints=null |
| R-06 | Без fixVersion | fixVersions=[] AND issue.priority IN [High, Critical] |
| R-07 | Без AC (acceptance-criteria-маркер в description) | regex('AC|критер|приёмк') нет в description |
| R-08 | Бесхозный эпик (assignee у эпика null) | issuetype=Epic AND assignee=null |
| R-09 | Эпик без срока | issuetype=Epic AND duedate=null AND startDate=null |
| R-10 | Эпик с 0 sub-задач | sub-task count = 0 (мёртвый эпик) |

#### Группа 3 — Quality / data integrity (раз в неделю / квартал)

| Код | Правило | Сигнал |
|---|---|---|
| Q-01 | Дубли (похожие summary в одном PK, status=open) | cosine(n-gram) ≥ 0.85, batch within PK |
| Q-02 | Estimate vs actual расхождение > 2× | aggregatetimespent / timeOriginalEstimate > 2 OR < 0.5 |
| Q-03 | Закрыто без коммитов / PR | status terminal AND linked BB commits = 0 |
| Q-04 | Циклические зависимости | links graph cycle detect |
| Q-05 | Sub-task переживает родителя | parent.status=Done AND child.status≠Done |
| Q-06 | Странные переходы статусов | transition skips required (per-PK config workflow) |

#### Группа 4 — Reporting / management (раз в месяц, CEO/PM)

| Код | Правило | Сигнал |
|---|---|---|
| M-01 | Тикеты с component'ом, у которого нет owner'а | components[*].owner=null |
| M-02 | Releases без даты + open issues | fixVersion.releaseDate=null AND linked issues>0 |
| M-03 | Story points отсутствуют у >30% sprint issues | aggregate per sprint |
| M-04 | Заброшенные доски / фильтры | board.lastView > 90d |

Каждое правило: `id, title, group, scope (PK | sprint | epic | issue), severity (block / warn / info), enabled (bool), threshold (object), suggestionText, autoFixAction (optional)`.

### Б.4 Концепции главного экрана

#### Концепция-1 «Score + причины»
Вверху — крупный Hygiene Score (0-100) команды, ниже — три-четыре «домена» (assignee / estimate / epic / status), под каждым — top-5 проблемных тикетов.

**+** Понятно «насколько всё плохо», CEO-friendly.
**−** Score синтетичен; разные роли спорят как взвешивать; «починил один тикет — score не дрогнул» демотивирует.

#### Концепция-2 «Список нарушений с фильтрами»
Лента всех violations, фильтры по правилу/PK/severity/assignee. Top-bar: счётчики `D 12 · R 47 · Q 3 · M 1`.

**+** Полностью actionable, тимлид видит конкретные тикеты сразу.
**−** Без агрегата трудно ответить на «как мы в целом?» CEO/PM.

#### Концепция-3 «Тепловая карта rules × teams/PK»
Матрица: правила × команды/PK, в ячейке — count. Cell-click drill'ится в список.

**+** PM-уровень: видно где «горит». Хорошо в multi-team view.
**−** Один тимлид одной команды теряется в матрице.

#### Выбранный гибрид: **Hero (score + breakdown) → Stack «Action Lane» → Drill-down (Концепция-2) — с переключением на Концепцию-3 в multi-team mode**

Логика:
- Default-mode (один tл) — Hero(Score) + 4 столбца «Action Lanes» по группам D/R/Q/M, в каждом — top-3 тикета.
- Multi-team mode — heatmap-матрица.
- Drill-down (клик правила или тикета) — slide-in panel (тот же 480px, что в Сканнере) со списком тикетов по фильтру.

Score = взвешенная сумма по группам с настраиваемыми весами (default: D=40% / R=30% / Q=20% / M=10%) — чтобы ежедневное преобладало.

### Б.5 Структура экрана

```
┌─ HERO (всегда виден) ───────────────────────────────────────────────┐
│ Гигиена Jira команды Альфа · 73/100 · ↓4 за неделю                  │
│ ┌─ Score breakdown ──────────┐  ┌─ Identity coverage (карри) ─┐    │
│ │ D 28 · R 41 · Q 3 · M 1   │  │ Jira 100 · BB 67 · CF 24    │    │
│ └────────────────────────────┘  └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
┌─ FILTERS BAR ──────────────────────────────────────────────────────┐
│ [Группа: D | R | Q | M | Все]  [PK ▾]  [Assignee ▾]  [Severity ▾] │
│ [Только мои]  [Скрыть исключённые]   [Поиск тикета: ___ ]          │
└─────────────────────────────────────────────────────────────────────┘
┌─ ACTION LANES (4 столбца) ─────────────────────────────────────────┐
│  Daily process  │ Backlog DoR  │  Quality       │  Reporting      │
│  D-01 12 ▶      │ R-05 18 ▶    │  Q-01 3 ▶      │  M-02 1 ▶       │
│  D-02 8 ▶       │ R-03 11 ▶    │  Q-02 0        │  M-03 0         │
│  D-03 6 ▶       │ R-01 8 ▶     │  Q-03 0        │  M-04 0         │
│  …              │ …            │  …             │  …               │
└─────────────────────────────────────────────────────────────────────┘
┌─ TREND ROW (collapsible) ──────────────────────────────────────────┐
│ Hygiene Score за 30д ────▁▂▂▃▄▄▅▆▇█  ↑ improving                  │
│ Violations: total ↓42 (–7 vs week) · by group: D –3, R –4, Q ±0   │
└─────────────────────────────────────────────────────────────────────┘
┌─ BULK ACTIONS BAR (sticky bottom) ─────────────────────────────────┐
│ [✓ выбрать всё видимое]  N selected  [Назначить ▾] [Игнорировать]  │
│ [Открыть в Jira] [Создать действие] [Эскалировать]                 │
└─────────────────────────────────────────────────────────────────────┘
```

При клике на строку правила (или badge `12 ▶`) — slide-in:

```
┌─ Side panel ───────────────────────────────────────────────────────┐
│ D-01 · Без assignee в активном sprint · 12 тикетов               ✕│
│ Threshold: in-sprint AND assignee=null  [Настроить] [Отключить]    │
├─────────────────────────────────────────────────────────────────────┤
│ ▢ ALPHA-123 · Восстановление checkout (2д в спринте) · @null      │
│   sprint: PI-1.21 ·  in progress  ·  open in Jira ↗                │
│ ▢ ALPHA-145 · Подготовить миграцию ledger · @null                  │
│ ▢ ALPHA-203 · …                                                    │
├─────────────────────────────────────────────────────────────────────┤
│ [✓ выбрать все 12]  [Bulk-assign к тимлиду]  [Назначить по rule]   │
│ [LLM: «почему не assign'нуто?» — сводка]                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Б.6 Действия (что пользователь может сделать)

#### Per-issue actions
- **Open in Jira** — `jiraIssueLink()`, уже работает в проекте.
- **Назначить assignee** — inline assignee-picker (re-use `bulkEditPanel.js` подход + jira REST `/rest/api/2/issue/{key}/assignee`).
- **Установить estimate / priority / epic / fixVersion** — inline edit modal для одного тикета.
- **Игнорировать (snooze N дней)** — добавить ключ в `localStorage('hygiene:snoozed[KEY]')` со сроком.
- **Игнорировать вечно (mark "won't fix in hygiene")** — отдельный set, видим в settings.
- **Создать действие** — пишет `state.actions[]` через actionLayer (см. находку 49 в Части А).
- **Эскалировать** — открыть в Слаке/TG (link config'уется в team config).

#### Bulk actions
- **Bulk assign** — по выбранным проставить assignee. JIRA REST: `/rest/api/3/issues/_bulk` (если поддерживается) или последовательно с rate-limit.
- **Bulk add component / fixVersion / label** — массово ставить общие поля.
- **Bulk close as won't fix** — для дубликатов и зомби.
- **Export CSV** — для off-line грумминга. (через `dataStore CSV._scrubSecrets` — обязательно по `CLAUDE.md`).
- **Скопировать список Jira-key'ев** — clipboard.

#### Rule-level actions
- **Включить/выключить правило для команды**.
- **Поменять threshold** (например, «дни без assignee» = 2 → 5).
- **«Доверить LLM-обоснование»** — генерить `"почему этот тикет нарушает правило"` (см. модуль LLM ниже).

### Б.7 Drill-down: от score к тикету

```
Score 73/100
  ↓ click breakdown 'D 28'
Список 28 D-violations с group-фильтром 'D'
  ↓ click rule chip 'D-01 (12)'
12 тикетов нарушают D-01 в side-panel
  ↓ click конкретный тикет
Inline expanded preview: title, description preview, last-event timeline, related BB/CF activity
  ↓ click 'open in Jira'
Внешний Jira-tab.
```

Каждый шаг сохраняет «хлебные крошки» в URL hash: `#hygiene/team=alpha/group=D/rule=D-01/issue=ALPHA-123` — расшариваемая ссылка.

### Б.8 Настройки правил (drilldown «Настроить»)

Open via top-right `⚙ Настройки гигиены`. Modal:

```
Правила (24)              [Все вкл] [Все выкл]   per-team profile: Альфа ▾
─────────────────────────────────────────────────────────────────────────
[✓] D-01 Без assignee в активном sprint
    Применять: к командам ▾ (Все)
    Severity: warn ▾
    Threshold: (нет — boolean правило)
    LLM-suggestion: [✓] включено
[✓] D-02 In Progress без коммитов > 5 дней
    Threshold: дни ▢ 5
    Применять только если есть BB integration: [✓]
…
[✗] R-04 Без component
    (отключено — на проекте Альфа компоненты не используются)
…
─────────────────────────────────────────────────────────────────────────
[Сохранить] [Применить пресет: «строгий» / «обычный» / «мягкий»]
```

Хранение — `teamScanner2Config.js` extend: `team[].hygieneRules = { [ruleId]: { enabled, threshold, severity } }`.

### Б.9 Расписание и уведомления

| Trigger | Action |
|---|---|
| Daily 09:00 (cron) | Server: пересчитать hygiene → если score упал ≥ 5 пунктов и group=D — telemetry alert + опц. Slack/TG webhook (за config'ом). |
| Weekly Mon 09:00 | Email digest (если настроен) — top-10 violations за неделю. |
| Real-time | UI: при ручном refresh Сканнера — пересчёт. Тяжёлые группы (Q, M) — async, fire-and-forget. |
| On-demand | «Запустить сейчас» в hero (manual). |

Notify:
- Тимлид — daily summary (in-app badge на nav «Гигиена · 41»).
- Сотрудник (опц.) — личный список «у меня сломано: 3 тикета».
- PM/CEO — еженедельный email + heatmap.

### Б.10 Интеграция с существующими разделами

- **Sleeping Data → ссылка**: tile «Backlog health» (уже есть, см. portfolioPulseModel.js:1532) → клик ведёт на `Гигиена Jira / R-01..R-07`.
- **Sprint Health hygiene-chips** (renderSprintHealth, line 2378-2385) — вместо inline-chips сделать кликабельный count → переход в sub-tab.
- **Сотрудники**: per-employee row → счётчик `🩹 5` (5 hygiene violations attributed) → side-panel filtered by assignee=user.
- **AI Анализ**: новый блок `hygiene_summary` в `BLOCKS_PER_SECTION.ai` — нарратив «что починить в backlog'е перед planning'ом».
- **AI CEO**: tile «Data quality 73/100» с трендом.
- **Действия** (`actionLayer.js`): «Создать действие» из side-panel пишет туда — там же treк выполнения.
- **historyLog**: каждое bulk-action логируется (audit trail).

### Б.11 Использование LLM — где полезно, где избыточно

**Полезно:**
- **Per-issue diagnostic** (per-click) — сводка «почему этот тикет так вис»: combine последний comment + changelog + related BB events. ~200 tokens.
- **Bulk-explain group**: «10 тикетов без epic — что у них общего? Один эпик мог бы их объединить?». LLM кластеризует summary'и.
- **Suggested fix**: «для этих 5 тикетов с пустым description — пред-сгенерировать DoR-шаблон AC».
- **Nightly summary для тимлида** (опционально, on user request) — «гигиена ухудшилась из-за новых тикетов с …»; persist в digest.

**Избыточно (rule-based достаточно):**
- Сам факт «нарушение D-01» — детерминистично, LLM не нужен.
- Score recalculation — pure-rule.
- Bulk actions (assign/close) — это команда, не нарратив.

**Архитектурно**: re-use `ai/llmClient.js` + `chat/chatPrompts.js`. Не создавать отдельный pipeline. Кнопка «LLM-обоснование» — opt-in per-click, не auto-batch (стоимость).

### Б.12 MVP (1 неделя) vs полная версия (1-2 месяца)

#### MVP (1 неделя, ≤8 правил, single-team только)
- Подвкладка «Гигиена Jira» рядом с «Сегодня/Глубже/Метрики».
- Правила: D-01, D-02, R-01, R-02, R-03, R-05, R-08, Q-05 (8).
- Hero (score + breakdown), 4 lanes (свернуть Q+M в один — данных мало).
- Drill-down side-panel со списком и open-in-Jira.
- Snooze per-issue (localStorage).
- НЕТ: bulk actions, settings, schedule, multi-team heatmap, LLM, history-trend.

#### V1 (3-4 недели)
- Все 24 правила.
- Settings modal (вкл/выкл, threshold, presets).
- Bulk actions (assign / close / set-component / set-fixVersion).
- Per-team config persistence.
- Trend row (sparkline 30d).
- LLM per-click обоснование.

#### V2 (1-2 месяца)
- Multi-team heatmap.
- Schedule + Slack/TG webhooks.
- Email digest.
- AI CEO tile + AI Анализ block.
- Cross-link с Сотрудники / Sprint Health (replace inline chips).
- Onboarding tour 5 шагов.

### Б.13 KPI продукта

| Метрика | MVP цель | V2 цель |
|---|---|---|
| % тимлидов открывших Гигиену в первую неделю | 60% | 90% |
| Средн. число bulk-action / тимлид / неделю | — | 5+ |
| Рост `backlogHealth` через 30 дней | +10% | +25% |
| Снижение D-01 (без assignee) | –30% | –70% |
| Time-to-fix per violation (median) | < 24ч | < 4ч |

---

## Б.14 Техническое ТЗ на MVP

### Ниже минимально полный план для команды разработки на MVP-версию (1 неделя).

### TЗ-1. Данные от Jira (что нужно дополнительно к существующему)

**Текущее покрытие** (`server.js:1176`, `JIRA_FIELDS`): summary, description, status, assignee, reporter, updated, created, priority, issuetype, labels, duedate, timetracking, timeoriginalestimate, aggregatetimespent, worklog, comment, parent, subtasks, resolution, resolutiondate, issuelinks, fixVersions, versions, components, attachment.

**Достаточно для MVP** — все 8 правил MVP покрыты. Custom-fields:
- **storyPoints** — нужен для R-05 (estimate). Резолвится через field-name-matching (паттерн как для `customfield_10020` Sprint), искать `name LIKE '%story point%'`. Уже есть подобное в `server.js:1244` для других customfield'ов — добавить `storyPointsFieldId` в config-resolver.
- **epicLink** — для R-03 (без epic). Резолвится через `customfield_10014` (Atlassian default) или name='Epic Link'. Аналогично — auto-resolve в фоне, persist в `jira_config.json`.

**JQL запросы на сервере** — добавить новый bucket в `pulseFetchPk()`:
```js
{
  name: 'hygiene',
  jql: `project="${pk}" AND statusCategory != Done`,
  fields: HYGIENE_FIELDS,  // subset JIRA_FIELDS + storyPoints + epicLink
  expand: ['changelog'],
  cap: 2000, budgetMs: 90000,
}
```
Кэш 5 мин (как остальные buckets). Telemetry: `hygiene.fetch.ms`.

### TЗ-2. Модель данных (frontend)

```ts
// state-shape для hygiene
state.hygiene = {
  fetchedAt: '2026-05-07T09:00:00Z',
  perTeam: {
    [teamId]: {
      score: 73,                    // 0..100
      scoreDelta7d: -4,
      breakdownByGroup: { D: 28, R: 41, Q: 3, M: 1 },
      violations: [
        {
          ruleId: 'D-01',
          severity: 'warn',
          issueKey: 'ALPHA-123',
          summary: 'Восстановление checkout',
          assignee: null,
          dwellHours: 48,
          context: { sprint: 'PI-1.21', status: 'In Progress' },
          snoozedUntil: null,
        },
        // …
      ],
      perRuleCount: { 'D-01': 12, 'D-02': 8, 'R-01': 8, /* … */ },
      historyScore: [62, 65, 67, 71, 73, /* 30 дней */],
    }
  },
  rules: {                          // конфиг (от teamScanner2Config или отдельно)
    'D-01': { enabled: true, severity: 'warn', threshold: {} },
    'D-02': { enabled: true, severity: 'warn', threshold: { days: 5 } },
    /* … */
  },
  snoozed: {                        // localStorage-mirror
    'ALPHA-123:D-01': '2026-05-09',
  },
};
```

Persist:
- `state.hygiene.perTeam` — НЕ persist'ится (вычисляется из Pulse-model'и).
- `state.hygiene.rules` — persist в team-config (`teamScanner2Config.js`).
- `state.hygiene.snoozed` — `localStorage('hygiene:snoozed:v1')`.

Reactive: мутации в `state.hygiene` НЕ должны триггерить полный refresh — это computed-derivative. Wrap в `Reactive.silent()` (см. CLAUDE.md контракт #1).

### TЗ-3. Компоненты UI

| Компонент | Файл | Поверх |
|---|---|---|
| `HygieneTabRegistry` entry | `integrations/teamScanner2Renderer.js` (доп. case в `_scannerTab`) | существующий tab-bar |
| `renderHygieneHero(model, history)` | новый файл `integrations/teamScanner2Hygiene.js` | pure renderer |
| `renderHygieneLanes(violations, rules)` | то же | — |
| `renderHygieneSidePanel(ruleId, violations)` | то же (re-use `.ts2-detail-panel` стилей) | существующая slide-in 480px |
| `computeHygiene(model, rules)` | `integrations/teamScanner2HygieneEngine.js` (pure) | поверх already-fetched Pulse-model'и |
| `applyHygieneAction(action)` | `integrations/teamScanner2HygieneActions.js` | server REST + state mutation |
| Settings modal | re-use паттерн `renderTeamConfigModal` | — |

Router: реализовать через расширение `TeamScanner2._scannerTab` enum + добавить `hygiene` в `setScannerTab` allow-list (`teamScanner2Renderer.js:44`).

### TЗ-4. Основные сценарии (acceptance)

1. **Тимлид открыл Сканнер → Гигиена.** Видит score 73, 4 lane'а с top-3, и 41 violations в lane R. Время до данных < 1с (кэш 5мин из Pulse).
2. **Click 'D-01 12 ▶'.** Open side-panel со списком 12 тикетов. Side-panel = re-use slide-in из Сканнера; close по `Esc / ✕ / click-outside`.
3. **Click тикет → Open in Jira.** Открыта Jira в новом tab'е; telemetry event `hygiene.issue_open`.
4. **Bulk-snooze** на 7 дней (3 тикета). После reload — они не в lane'ах, но видны в фильтре «Скрыть исключённые: off».
5. **Settings → выключить R-04.** После save: violations этого правила пропадают; score пересчитан.
6. **Refresh Сканнера** — пересчёт hygiene синхронно (≤200ms, pure JS поверх уже-fetched data).
7. **Smoke test multi-team** — переключить team-switcher; данные другие; URL hash `#hygiene/team=BETA` обновляется.

### TЗ-5. Эстимация на MVP (1 разработчик)

| Этап | Задачи | Часы |
|---|---|---|
| 1. Backend | новый JQL bucket + customfield-resolver для storyPoints/epicLink | 4 |
| 2. Engine | `computeHygiene()` для 8 правил MVP + score | 8 |
| 3. UI hero | `renderHygieneHero` + score + breakdown chips | 4 |
| 4. UI lanes | 4 столбца, click→side-panel | 6 |
| 5. UI panel | side-panel со списком + open-in-Jira + per-issue snooze | 6 |
| 6. Wiring | sub-tab в `_scannerTab`, click-handlers, telemetry | 4 |
| 7. Tests | unit для computeHygiene (8 правил × happy/empty), DOM smoke | 6 |
| 8. Docs | `docs/integrations/scanner2-hygiene.md` + JSDoc | 2 |
| **ИТОГО** | | **40 часов (~5 дней разработки)** |

### TЗ-6. Эстимация на V1 (доп.)

| Этап | Часы |
|---|---|
| 16 правил (Q-* + M-* + R-04..R-10 + D-04..D-06) | 24 |
| Bulk-actions UI + REST integration | 16 |
| Settings modal | 8 |
| Trend row (sparkline) + history persistence | 8 |
| LLM per-click обоснование (через `ai/llmClient.js`) | 8 |
| Tests (unit + e2e) | 16 |
| **ИТОГО V1** | **80 часов (~2 недели)** |

### TЗ-7. Риски

| Риск | Вероятность | Митигация |
|---|---|---|
| Custom-field IDs (storyPoints/epicLink) разные на разных Jira-инстансах | High | name-matching auto-resolve (как для sprint customfield) + UI override в Settings |
| 24 правила = 24 источника путаницы для тимлида | Medium | DoR-presets ('строгий/обычный/мягкий') + onboarding tour |
| Bulk-assign через REST упирается в rate-limit | Medium | client-side throttle 5/sec + Retry-After honour |
| Score синтетичен → споры о весах | Medium | веса в Settings (per-team) + tooltip объясняет формулу |
| Дубликат метрик с EstimationCalibrationView и backlogHealth | Medium | при роллауте — единый расчёт в `teamScanner2HygieneEngine`, остальные surface'ы читают оттуда |

---

## Чеклист этапа 10

- [x] Часть А — состояние Сканнера: 50 находок, не дублирующих этапы 1-7.
- [x] Часть Б — концепция / структура / действия / drill-down / настройки / расписание / интеграция / LLM / MVP-vs-полная.
- [x] Техническое ТЗ на MVP (данные / модель / компоненты / сценарии / эстимация / риски).
- [x] A11Y не упомянут.
- [x] Файл создан в корне (`AUDIT_SCANNER.md`).
