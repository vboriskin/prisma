# AUDIT_TECH.md — Технический аудит Призмы

> Этап: технический. Источник карты: `AUDIT_MAP.md`. Контракты: `docs/state-contracts.md`, `CLAUDE.md`.
> Дата: 2026-05-07. Сторона: senior-инженеры (надёжность / производительность / безопасность / качество кода / архитектура в малом).
>
> Severity: critical (риск падения / утечки / порчи данных), high (заметная боль на проде или растущая поддержка), medium (улучшение заметное, не блокер), low (косметика / мелкие debt-fragments).
> Effort: S ≤ 1 день, M = 1-3 дня, L > 3 дней (или требует декомпозиции).
>
> Ссылки на строки даны на момент аудита; могут смещаться после рефакторингов. В этом случае искать по сигнатуре, указанной в колонке «проблема».

---

## 1. Дашборд (`views/dashboard.js`, 655 LOC)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 1. Дашборд | views/dashboard.js:320,595 | medium | Двойной forEach по rows × assignees / rows × workTypes (`computeLoad`-стиль) дублируется на каждом render — для квартала на 1.5k строк это 5-15 ms × 6 блоков = заметные re-render-jank'и при изменении фильтра. | Перенести агрегацию в memoized helper с ключом `state._dataVersion + filtersKey` (как в `FilterEngine._cacheKey`); либо переиспользовать `c = computeDashboardCounters(rows)` который уже single-pass. | M |
| 1. Дашборд | views/dashboard.js:34 (`esc`) | low | `Utils.escapeHtml` импортируется индивидуально в каждом view; нет single-shot helper'а с CSP-политикой. Каждый новый view риск пропустить escape — lint-rule `local/no-unescaped-innerhtml` сейчас на `warn`. | Поднять lint до `error` для views/dashboard.js (он уже clean) — регрессионный guard. | S |
| 1. Дашборд | views/dashboard.js:55 (`render`) | medium | Render зависит от глобальных side-effect'ов: `window.App?.markRenderedNow()`, мутации `state` через `Storage.save` в child-обработчиках. Тестировать модуль изолированно невозможно — нет DI. | Передавать `App.markRenderedNow` через параметр или контекст-объект (минимально); в новых views — конструктор с ctx. | M |

## 2. Метрики (`views/metrics.js`, 549 LOC)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 2. Метрики | views/metrics.js:208 | low | Открытый TODO «унифицировать dayKey() с registry.js, gantt.js» — три view'и считают календарный день своим способом, расхождения в edge-case (часовые пояса). | Вынести `dayKey(date)` в `utils.js` и заменить локальные копии. | S |
| 2. Метрики | views/metrics.js (MetricsView._stagger) | medium | Инициирование animation через прямые CSS-class toggle + `setTimeout` — гонка с `App.refreshAll()`: при быстром переключении секций animation cleanup не запускается, узлы остаются с in-flight transition'ом, копится утечка transition-listener'ов. | В `MetricsView.unmount()` явно отменять stagger-таймеры; либо переключиться на CSS `animation-iteration-count: 1` без JS-cleanup. | M |
| 2. Метрики | views/metricsDeep/index.js (lazy `await import('echarts')`) | medium | `libs/echarts.esm.min.js` ~1+ MB подгружается по `await import` без user-feedback и без error-boundary. Если bundle 503 — view зависает молча. | Обернуть import в `try/catch` с fallback message «не удалось загрузить ECharts»; добавить prefetch hint при наведении на вкладку «Метрики». | S |

## 3. Реестр (`views/registry.js`, 997 LOC; `rowFactory.js`, `filters.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 3. Реестр | views/registry.js:158,273,340,361,371,373,384,392,394,411,562,678,740,816 | high | Множественный `tdRisk.innerHTML=…` / `panel.innerHTML=…` без `Utils.escapeHtml` для пользовательского контента (`row.tags`, `col.label`, `state.colLabels`). На строках 562, 740, 816 пользовательские значения интерполируются с минимальной защитой (`replace(/"/g,'&quot;')` только на одном поле). При импорте CSV с `<img onerror=…>` в имени тега — XSS. | Перевести на template-helpers с принудительным escape (см. `libs/safeHtml.js`); добавить regression-test на `<script>`-payload в CSV-import. | M |
| 3. Реестр | views/registry.js:678 | medium | Контекстное меню рендерится через `innerHTML` со встроенным SVG. Каждый правый клик создаёт DOM-узел + listener; cleanup только через `mousedown` outside. Нет AbortController — если меню удаляется не через outside-click (например, через Escape или повторный right-click) — listener протекает. | Заменить на единый `AbortController` per-меню, очищать через `ctrl.abort()`. Аналогично — для context-menu в gantt.js. | S |
| 3. Реестр | views/registry.js:701 | medium | `JSON.parse(JSON.stringify(orig))` для копии row — теряет Set/Map, ломает `bulkSelected` если перенесут на эту копию. Также не ловит cyclic refs. | Использовать структурный клон через `structuredClone(orig)` (Node 17+/Chromium 98+). Для backward-compat — explicit deep-clone helper. | S |
| 3. Реестр | views/registry.js:707 (`autoFitColWidths`) | medium | Вызывает `td.querySelectorAll(...)` × N столбцов × 20 строк × char-based width estimation — O(N×M) на каждом auto-fit. На 80 столбцах квартала это ощутимо (>50ms на main thread). | Кэшировать `text-content`-длины на etap render; либо использовать `getBoundingClientRect` × 1 раз через `requestIdleCallback`. | M |
| 3. Реестр | filters.js:42 (`getFiltered`) | medium | Search по 9 полям — `[row.team, row.category, row.tags, row.epic, row.tasks, row.taskComment, row.comment, row.role, row.assignee].join(' ').toLowerCase().includes(q)` — string allocation на каждой строке. Кэшируется только результат, но не intermediate. | Pre-compute `row._searchIndex = (...).toLowerCase()` в `RowFactory.updateDerived` и инвалидировать при мутации. | M |
| 3. Реестр | rowFactory.js:9-86 | low | `RowFactory.create` каждый раз вызывает `new Date().toISOString()` × 2 (createdAt + updatedAt) и `RiskEngine.computeFlags + computeRiskScore`. На bulk-import 5k строк — 10k allocation-ов даты + 2 цикла RiskEngine. | Принимать `now` параметром в bulk-paths; `RiskEngine.computeRiskScore` уже зовёт `computeFlags` — flag map можно reuse. | S |

## 4. Гант (`views/gantt.js`, 2804 LOC)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 4. Гант | views/gantt.js (39 addEventListener vs 6 removeEventListener) | high | Дисбаланс add/remove listener'ов: drag/dragover/dragend/drop в `wrap.addEventListener` навешиваются при каждом `renderChart()`, но `wrap` тот же DOM-узел. Если код выполнился дважды — дублирующиеся listener'ы (DOM-проверки `_kbBound` есть только для keyboard nav). На 50 re-render'ах квартала — 250 listener'ов на одном элементе. | Проверить идемпотентность binding в `bindChartEvents`; ввести `wrap._gdtBoundOnce` flag (как уже есть для tooltip и ResizeObserver). | M |
| 4. Гант | views/gantt.js:2766,2773 | medium | Двойной `requestAnimationFrame` для draw arrows + `ResizeObserver` обновляющий arrows при каждом resize-tick. На быстром resize окна (например, при collapse sidebar) — десятки SVG re-draw'ов в секунду. | `ResizeObserver` уже rAF-throttle, но добавить `scrollEnd`-style debounce 50ms: только финальное состояние имеет смысл. | S |
| 4. Гант | views/gantt.js:2738 | medium | Drop-handler `arr.splice(fromIdx,1) … arr.splice(toIdx,0,_dragData.wt)` — мутирует массив в reactive proxy дважды. Reactive flush стрельнёт 2 раза → лишний `Storage.save`. | Обернуть mutate-pair в `Reactive.silent(() => { … })`, потом explicit `Storage.save()` — это намеренная mutation. | S |
| 4. Гант | views/gantt.js:130 (`renderChart` re-wraps after first call) | high | `GanttView.renderChart = function (...args) { … }` перезаписывает оригинал внутри `bindKeyboardNav`. При повторных вызовах `bindKeyboardNav` сравнение `_kbWrappedRender` спасает, но если кто-то заменит `_origRender` извне (тесты, e.g. monkey-patch) — wrap всё равно зарегистрируется на старую версию. | Использовать observer-pattern (subscribe на 'rendered' event), не monkey-patch'ить. | M |
| 4. Гант | views/gantt.js (drawPostponeArrows вызывает `wrap.querySelectorAll('.gantt-cell')` каждый раз) | medium | На большом квартале (300+ pills) прорисовка SVG-стрелок включает поиск всех `.gantt-cell` × DOM-rect — 5-15 ms. Прокидывать через `_dataVersion`-кэш либо ограничить выборкой только нужных pills. | Кэшировать computed positions в `wrap._arrowGeometryCache`, инвалидировать через `_dataVersion`. | M |
| 4. Гант | views/gantt.js (G-od object) | high | 2804 LOC одним объектом `GanttView`, 18+ методов, drag/drop/keyboard/resize/animation/menu — всё в одном модуле. `aux.js` уже вынес 4 метода — недостаточно. | Декомпозиция: `gantt/render.js`, `gantt/dragdrop.js`, `gantt/keyboard.js`, `gantt/menu.js`. Цель — каждый модуль ≤ 500 LOC. | L |
| 4. Гант | views/gantt.js:2773 | low | `wrap._gdtArrowsResizeObserver` — не отписывается при unmount секции. ResizeObserver продолжает дёргать на других страницах. | В `GanttView.unmount()` (если нет — добавить) вызывать `wrap._gdtArrowsResizeObserver?.disconnect()`. | S |

## 5. История (`views/history.js`, 211 LOC; `historyLog.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 5. История | historyLog.js (loadHistoryLog) | medium | Нет capping размера журнала в localStorage — на годичном использовании action-log пухнет (>5MB), QuotaExceededError ловится только на `Storage.save`, а не на самом `historyLog.append`. | Ввести rolling window (последние N=2000 entries) с auto-trim; добавить export-CSV перед trim. | M |
| 5. История | views/history.js | low | Нет фильтрации/поиска по log; на 1000+ записей UI становится useless. | Добавить простой text-input + filter по category/level. | S |

## 6. Таймлайн (`views/timeline.js`, 223 LOC)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 6. Таймлайн | views/timeline.js | low | TimelineView и PodlozhkaView экспортируются из одного файла — два разных View склеены в один модуль. Если PodlozhkaView расширят (debug-only feature) — придётся бить файл. | Разделить на `views/timeline.js` и `views/podlozhka.js` пока модуль маленький. | S |
| 6. Таймлайн | state.js:48 (`summaryMode`) | low | `summaryMode` — мёртвый код per комментарию: «Сводная удалена … оставлен для backwards-compat серилизации. Удалить после миграции». | Запустить миграцию через `app/migrations.js` (V21 W) — drop поле + bump version. | S |

## 7. Сотрудники (`views/employees.js`, 934 LOC; `rowFactory.js` EmployeeFactory)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 7. Сотрудники | views/employees.js:223,255,270,278,304,325,447,527,537,607,624,644,660,766,785,810,817 | high | 17 точек `innerHTML=…` с интерполяцией пользовательских ФИО / ролей / комментариев. Часть прошита через `Utils.escapeHtml(d)`, но не везде (например, 537 — `Icons.get('x',{label:'Удалить сотрудника'})` без экранирования label при динамическом пути). При импорте employees.csv с `<svg onload=>` в FIO — XSS. | Audit построчно + добавить regression test «emp.fio = `<img src=x onerror=alert(1)>`». | M |
| 7. Сотрудники | rowFactory.js:198 (`detectServiceAccount`) | medium | Pattern-detection по `key.toLowerCase()`: pattern 1 (`out-`, `svc-`, `bot-`) ловит легитимных пользователей с такими префиксами имени (например, login `out-dinov-` — реальный сотрудник). Захардкожен в комменте — «Pattern 1». | Pattern-detection вынести в config-driven allowlist (`constants.js`) с возможностью override per-tenant. | M |
| 7. Сотрудники | rowFactory.js:167 (auto-detect блокировки в normalize) | medium | `EmployeeFactory.detectBlocked` запускается при каждом `normalize()` (вызывается из `create`) — regex `/\[\s*[ХXВB]\s*\]/i.test(fio)`. При батч-импорте 200 employees × normalize × 3 проходов (load/restore/save) — 600 regex evaluations. Не критично, но N+1. | Memoize `detectBlocked` через `_lastDetectedFio === fio` cache. | S |

## 8. Перегрузка (`views/teamHealthDashboards.js` BurnoutWatchtowerView)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 8. Перегрузка | views/teamHealthDashboards.js (BurnoutWatchtowerView) | medium | 4 разных View (`EstimationCalibrationView`/`ComponentHealthView`/`BurnoutWatchtowerView`/`DocDebtConsoleView`) живут в одном 360 LOC модуле. Если хотя бы один view расширится — этот файл тоже превратится в god. | Разделить на 4 файла с общим helpers модулем `views/teamHealth/_shared.js`. | M |
| 8. Перегрузка | views/teamHealthDashboards.js | low | Все 4 view не имеют тестов в `tests/unit/`. | Добавить хотя бы smoke test «render не бросает на пустом state». | S |

## 9. Здоровье компонентов (`views/teamHealthDashboards.js` ComponentHealthView)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 9. Здоровье компонентов | views/teamHealthDashboards.js (ComponentHealthView) | medium | Читает `state.scanner2._model` напрямую, без guard на shape — если pulse-fetch упал, view рендерит «undefined». | Добавить null-guard + empty-state UI; в идеале — proxy `getModelOrEmpty()` в `teamScanner2.js`. | S |

## 10. AI CEO (`views/aiCeoView.js`, `ai/aiCeoRenderer.js`, `ai/aiCeoFallback.js`, `ai/llmClient.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 10. AI CEO | ai/llmClient.js (shared by 10/13) | medium | LLM-запросы не имеют per-request timeout на стороне frontend — если server proxy висит, UI «AI обдумывает…» вечно (server SSE heartbeat есть, но клиент его не enforce'ит). | Добавить `AbortController` с timeout 90s в client; toast «LLM долго отвечает, попробуйте ещё раз». | S |
| 10. AI CEO | ai/aiCeoFallback.js | low | Fallback-engine = duplicate бизнес-логики между frontend и `ai/llmClient.js` (если LLM недоступен). При расхождении — две правды. | Документировать в `docs/ai/fallback-contract.md` какие блоки имеют fallback и каков SLO расхождения. | S |

## 11. CEO-режим (`views/exec.js`, 237 LOC)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 11. CEO-режим | views/exec.js | low | Отдельный read-only KPI-экран с собственной агрегацией; дублирует часть `metricsEngine.computeDashboardCounters`. | Переиспользовать `computeDashboardCounters` либо явно вытащить shared aggregator. | S |

## 12. Действия (`app/actionLayer.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 12. Действия | app/actionLayer.js | medium | Action-плагины зарегистрированы статически (на boot) — нет hot-reload, нет per-user-toggle (есть только AppSettings visibility, не enable/disable). | Ввести registry-pattern: `ActionLayer.register(name, fn)` + `unregister`. | M |
| 12. Действия | app/actionLayer.js | low | Нет валидации payload'а action — если плагин зовёт `applyBulkAction(…, {release: undefined})` — silent no-op без error. | Добавить JSDoc-types + runtime guard на required-fields. | S |

## 13. AI Анализ (`views/aiView.js`, `ai/aiRenderer.js`, `ai/aiContextBuilder.js`, `ai/aiFallbackEngine.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 13. AI Анализ | ai/aiContextBuilder.js | medium | Контекст для LLM собирается на каждый запрос — без кэширования. На больших state (1000 rows × 50 employees) — ~5-10 ms сериализации × per-block × 13 блоков = до 130 ms blocking. | Memoize по `state._dataVersion`: один build → переиспользуют 13 блоков. | M |
| 13. AI Анализ | views/aiView.js (13 блоков toggle через AppSettings) | medium | Если пользователь скрывает все 13 блоков — view рендерит пустую секцию без empty-state. | Добавить empty-state «Все блоки скрыты» с CTA «открыть настройки». | S |
| 13. AI Анализ | ai/llmClient.js (CSV._scrubSecrets contract) | high | Контекст для LLM может содержать поля `email`, `jiraAccountId` — не secrets per `_scrubSecrets` whitelist, но PII. Server logs (V19 E4) JSON-stringify request → PII утекает в ELK. | Дополнить `CSV._scrubSecrets` (или новый `_scrubPII`) для LLM-payload и server logger; маскировать email→`u****@d.com`. | M |

## 14. Точность оценок (`views/teamHealthDashboards.js` EstimationCalibrationView)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 14. Точность оценок | views/teamHealthDashboards.js (EstimationCalibrationView) | low | Берёт estimate-данные из state.rows напрямую; нет fallback при отсутствии полей `total_estimate` / `aggregateProgress`. | Guard + сообщение «нет данных по оценкам». | S |

## 15. Документация (`views/teamHealthDashboards.js` DocDebtConsoleView)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 15. Документация | views/teamHealthDashboards.js (DocDebtConsoleView) | medium | Читает `model.summary.cfHealth.bySpace` без проверки `model.summary` — TypeError, если pulse не дошёл до этой стадии. | Optional chaining `model?.summary?.cfHealth?.bySpace ?? {}`. | S |

## 16. Интеграции (`views/integrationsView.js`, 850 LOC; `integrations/integrationsRenderer.js`, `integrations/integrationsStore.js`, `integrations/integrationsSync.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 16. Интеграции | views/integrationsView.js:777 | medium | TODO carry-over: «share-link на удалённого сотрудника» — feature недоделан; в коде есть mock-handler. | Либо реализовать, либо удалить mock-блок (мёртвый код). | S |
| 16. Интеграции | integrations/integrationsStore.js + integrations/integrationsSync.js | high | Identity-таблица employees — single source of truth (V17.2 I1c contract), но read/write идут через 2 модуля без явного lock. При конкурентном sync (auto-create from Jira participants + manual edit) возможен потерянный write. | Ввести `IdentityMutex`-обёртку: все mutate-paths через `withLock(async () => { … })`; либо optimistic concurrency через `emp.updatedAt` compare-and-set. | M |
| 16. Интеграции | views/integrationsView.js (settings modal) | medium | Settings modal сохраняет токены через POST /api/integrations/save → `jira_config.json`. При нескольких open вкладок одного браузера — гонка. | Сервер делает `jiraReadConfig + spread + writeFileSync` (`server.js:621-624`) без lock. Добавить atomic write (`tmp + rename`). | S |

## 17. Сканнер команд (12 файлов; `teamScanner2*.js`, `portfolioPulse*.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 17. Сканнер команд | integrations/teamScanner2Renderer.js (4890 LOC) | critical | God-module: 35+ exported render-функций, 130+ helpers, mix renderTopBar / renderTeamGlance / renderPersonRows / sleeping-data insights / sprint-gauge / dependency sankey / how-modal / 4 detail-panels. Уже задокументирован в `docs/v20-scanner2-handoff.md`, но прогресса нет. Поддержка одного fix занимает часы поиска. | Декомпозиция по доменам: `scanner2/topbar.js`, `scanner2/glance.js`, `scanner2/personRows.js`, `scanner2/sprintGauge.js`, `scanner2/sleepingData.js`, `scanner2/howModal.js`. Целевой размер каждого ≤ 800 LOC. | L |
| 17. Сканнер команд | integrations/teamScanner2.js:773-776 | high | `_abort = new AbortController()` на каждый fetch, но fetch использует server-side `/api/integrations/portfolio-pulse` через POST + cluster-job pattern (server.js `_pulseCluster`). Frontend abort НЕ проксируется на сервер — job на сервере продолжает работать. | Передавать `jobId` в abort path; на сервере добавить `/api/integrations/portfolio-pulse/cancel/:jobId`. | M |
| 17. Сканнер команд | integrations/teamScanner2.js (88 addEventListener / unmount?) | high | 88 точек `addEventListener` в orchestrator — визуально вижу AbortController только для kebab-меню (line 1480). При frequent navigation между секциями — вероятная утечка document-listener'ов на ESC / outside-click. | Audit + AbortController-by-default pattern для всех document/window listener'ов. | M |
| 17. Сканнер команд | integrations/portfolioPulseModel.js:783-925 | high | Logic mixing: `_buildAuthorLookups` × `_ppFindByPartial` (dev-only fallback per `docs/dont-touch.md`) + bbAuthors / cfAuthors / devStatus merge × per-participant attribution. Identity-deterministic contract (V17.2 I1c) намеренно нарушается через `_ppFindByPartial`. Если флаг включат в проде — ложные attribution-ы. | Покрыть `_ppFindByPartial` regression test «должен возвращать null если флаг выключен»; добавить telemetry-event при срабатывании fallback. | S |
| 17. Сканнер команд | integrations/portfolioPulseModel.js:703 | medium | `EmployeeFactory.detectBlocked(e)` повторно зовётся для каждого emp при каждом `analysePulse` — N×M в нагруженном квартале (200 emp × 6 PK × несколько pulse'ов в час). | Cache `e.isBlocked` уже в `EmployeeFactory.normalize`, проверять только его — не вызывать `detectBlocked` снова. (Реализовано? — проверить, и если нет — починить.) | S |
| 17. Сканнер команд | server.js:2545,3240 | high | `_bbGate` (Bitbucket shared rate-limit) объявлен в server.js:3240, но используется только в одном месте. Аналогичный `_jiraGateUntil` (line 1015) полностью реализован. Если BB-rate-limit срабатывает, gate не блокирует параллельные BB-fetch'и (только локально retry). | Дублировать паттерн `_jiraGateClose/_jiraGateWait` для BB; убедиться что `ppFetchBitbucket*` идут через gate. | M |
| 17. Сканнер команд | server.js:2505-2700 (`_runPortfolioPulse`) | high | 200+ строк инициализации 15 параллельных fetch'ей с per-promise timeout/withTimeout. Если хоть один из 4 «новых» fetcher'ов (cfHealth, bbGov, retro, cfAcl) бросит unhandled — `Promise.all` reject'нёт всё. Сейчас все обёрнуты в `withTimeout`, но это не error-resilient (только timeout). | Перевести на `Promise.allSettled` + per-promise `.catch` с graceful degrade. | M |
| 17. Сканнер команд | server.js (Jira retry budget) | high | `RATE_LIMIT_MAX = 12` × 30s = до 6 минут блокировки на одну Jira-страницу + HARD_BUDGET_MS=6 мин. Если 429 storm — сервер залипает на 6 минут, request-cluster timeout и клиент теряется в loading-state. | Понизить per-request HARD_BUDGET_MS до 2 минут (с current 6); пропустить 429-страницу с partial-results вместо полной блокировки. | M |
| 17. Сканнер команд | integrations/teamScanner2DemoFixture.js (937 LOC) | medium | Демо-фикстура размером с боевой module — runtime-loaded даже когда demo не открыт. | Lazy-import: `await import('./teamScanner2DemoFixture.js')` только при `loadDemo()`. | S |
| 17. Сканнер команд | server.js:2534 (`_HTTP_CACHE.clear()` в начале pulse) | medium | Очистка ВСЕГО HTTP-cache при старте каждого pulse — убивает cache hits соседних запросов (techInfo, blackDashboard pulled параллельно). 5-минутный TTL и так обеспечивал свежесть. | Очищать только entries с `host=jiraBaseUrl/bitbucket/confluence/zephyr`, не глобально. | S |

## 18. Чёрный дашборд (`integrations/blackDashboard*.js`)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 18. Чёрный дашборд | integrations/blackDashboardRenderer.js (773 LOC) | medium | Renderer переиспользует `pp-chart-*` стили (см. eslint css-class-prefix ownership), это цементирует неявную зависимость BD → Pulse. Если Pulse-стили перепишут — BD сломается. | Переименовать shared chart-стили в нейтральный `chart-*` префикс; добавить ADR в `docs/`. | M |
| 18. Чёрный дашборд | integrations/blackDashboardModel.js | medium | Sigma Jira config (`sigmaGoalEpicKeys`) хранится в `jira_config.json` (см. CLAUDE.md «Что НЕ трогать»). Это исторический артефакт; миграция = breaking. Но текущее: добавление новых Sigma-полей разрастает `jira_config.json` по 100+ полей. | Документировать в `docs/sigma-isolation.md` deprecation-path: новые Sigma-поля идти через отдельный `sigma_config.json`. | M |
| 18. Чёрный дашборд | integrations/blackDashboard.js (Cloners follow) | medium | `followCloners: true` (server.js:614, default) расширяет JQL для всех команд, не только SMEAM. На команде с 1k cloner-цепочек — JQL разрастается → 414 URI Too Long либо медленный Jira-search. | Сделать `followCloners` per-area; включён по умолчанию только для list of teams где это нужно. | M |

---

## Общее (shared / infra)

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| Общее: server.js | server.js (6486 LOC) | critical | God-сервер: 250+ функций, mix статика / Jira proxy / BB / CF / Zephyr / Jenkins / OAuth / sigma / telemetry / metrics / rate-limit / SSRF guard / circuit breakers / cluster-jobs / migrations / health checks. Один синтаксический сбой блокирует ВСЕ интеграции. | Декомпозиция по доменам: `server/jira.js`, `server/bb.js`, `server/cf.js`, `server/zephyr.js`, `server/llm.js`, `server/admin.js`. Сохранить single entry-point `server.js` ≤ 500 LOC. См. также `server/integrations/*` уже частично применён pattern. | L |
| Общее: state | state.js (Reactive proxy) | medium | `state` — single mutable object, Proxy-обёрнут. Все views и engines пишут напрямую. Нет immutable snapshots — undo/redo (HistoryManager) использует JSON-clone (см. `dataStore.js` paths) на каждый checkpoint. На крупных state'ах — ощутимая аллокация. | Поднять иммутабельные структуры через `structuredClone` на checkpoint; либо CRDT-подход для long-term. | L |
| Общее: dataStore | dataStore.js:72-112 | high | `Storage.save` debounced 400ms; на F5 в окне debounce — потеря изменений. `flushNow()` есть (line 119), но не везде вызывается. Например `addRow`/`deleteRow`/`copyRow` в `views/registry.js` зовут `Storage.save()` без `flushNow`. | Перед `window.beforeunload` принудительно `Storage.flushNow()`. Также — для всех bulk-операций в `applyBulkAction`. | S |
| Общее: dataStore | dataStore.js:155-184 | medium | `Storage.load` ловит corruption silently — записывает в ErrorsLog, но возвращает `null`. UX: при corruption пользователь видит пустой план без warning'а (toast только если `window !== undefined`). | На corruption блокировать загрузку с modal «План повреждён, загрузить backup?». | M |
| Общее: utils | utils.js:159 (Utils.scrubPII) | medium | `Utils.scrubPII` маскирует СНИЛС (XXX-XXX-XXX YY) — но регулярка может ложно срабатывать на номера задач. Не покрыто тестами. | Добавить unit-тесты для `Utils.scrubPII`; уточнить regex чтобы не ловить «AB-123-456» = Jira key. | S |
| Общее: filters | filters.js:42-90 | medium | `getFiltered` обходит ВСЕ rows на каждый cache-miss; нет индексов по team/scope/release. На 5k+ строк — 50ms+. | Pre-compute indexes (Map<team, Set<rowId>>) при `state.rows` mutation; cache-key уже учитывает `_dataVersion`. | M |
| Общее: linting | eslint.config.js | medium | `--max-warnings 215` — высокий budget, означает много `local/no-unescaped-innerhtml` warning'ов которые «сойдут с рук». На каждом PR ratchet снижается, но темп слишком медленный. | Per-file `error` для уже-чистых views (registry/employees/scanner) — регрессионный guard. | S |
| Общее: tests | tests/unit/*.test.js (534 unit + 11 contract + 0 e2e) | medium | E2E count = 0 в `package.json` test description, но есть `npm run test:e2e` (e2eTest.js). Не запускается в `npm test`. | Включить e2e в smoke-suite либо удалить упоминание из CLAUDE.md. | S |
| Общее: launch | launch.js:81-115 | medium | SIGUSR2 heap-snapshot каждые 30s в `--profile` режиме — производит файлы по 500MB+ × N часов = заполняет диск. | Cap last-N (3-5) snapshots, ротация `_pruneSnapshots` помечена как TODO в `launch.js`. | S |

## Кросс-разрезные проблемы

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| Кросс: Reactive | reactiveStore.js + 18 views | critical | Контракт `Reactive.silent(() => {…})` для bulk-mutations задокументирован, но НЕ enforced runtime — забытый wrap = infinite loop. На каждый PR это новая ловушка. | Поставить тест-перехватчик (mock `Storage.save`): любой mass-mutation path должен иметь `silent` wrapper; e2e-тест на «100 mutations за tick → 1 save». | M |
| Кросс: identity | rowFactory.js + integrations/* | high | `EmployeeFactory.normalize` запускается при каждой `EmployeeFactory.create` — load + restore + auto-create, в нагруженном квартале это сотни вызовов. `detectServiceAccount` + `detectBlocked` regex'ы. Для 200 emp × 5 mount'ов в день = 1000 regex evaluations. | Memoize в `emp._normalizedAt` + skip если `Date.now() - _normalizedAt < 60s`. | S |
| Кросс: storage layer | appDataStore.js + sqliteStore.js + dataStore.js | high | Три layer'а persistance: `localStorage` (dataStore), `sqliteStore.js` (sql-wasm), `appDataStore.js` (facade). Mode-switch — runtime через `state.appStorageMode`, нет migration-path в обе стороны. При пустом SQLite + non-empty localStorage можно потерять данные. | `Migrations.run()` при mode-switch с явным confirm-dialog «перенести 234 строки в SQLite?». | M |
| Кросс: CSV scrub | dataStore.js:303-340 (`_scrubSecrets`) | high | `KEYS_PRESERVE_SECRETS` намеренно сохраняет `q2_integrations_v1` и `q2_llm_settings_v1` без scrub'а — личный backup, токены экспортируются. Если пользователь поделится файлом — LEAK. UI должен показывать warning, но в коде только comment, не enforced. | В `_buildSettingsBundle` добавить confirmation dialog «Файл будет содержать токены — продолжить?». | S |
| Кросс: history log | historyLog.js + errorsLog.js | medium | Два независимых log-store'а в localStorage с одинаковым shape `[{at, level, source, message}]`. ErrorsLog.add дважды позиционно вызывался (V21 fix, dataStore.js:174-176) — паттерн прайнтить регрессию. | Унифицировать API через `LogStore({ kind: 'history' | 'errors' })`; добавить TS-types для callsites. | M |
| Кросс: telemetry | integrations/telemetry.js + server.js:31-74 | medium | Frontend шлёт events через `navigator.sendBeacon`, server валидирует имя regex-whitelist'ом + truncate до 200 chars. Но: PII в `data` (например, `emp.fio`) ничем не маскируется. Server logger.event добавляет `src: 'browser'` но не scrub'ает. | Whitelist допустимых ключей в `data` (как уже сделано для имени event); добавить PII-scrub аналог `CSV._scrubSecrets`. | S |
| Кросс: server logger | server/logger.js (NDJSON to stdout) | medium | logger пишет JSON в stdout без rate-limit; на 429-storm от Jira — 100 warn-entries/sec заплёскивают ELK. | Per-key throttle (например, max 10 warns/sec на одинаковый `code`). | S |
| Кросс: identity-coverage | rowFactory.js:225 (`detectGhost`) + portfolioPulseModel.js | high | Ghost-detect использует `!email && !bb && !cf` — но employee с заполненным `bitbucketLogin` но пустым email НЕ ghost. Auto-create из Jira participants создаёт employee только с `jiraAccountId` — он сразу ghost. | Уточнить ghost-detect: «есть jiraAccountId но нет ни одного из email/bb/cf и не service-account» — это 95% ghost'ов и НЕ ловит легитимных. | S |
| Кросс: index.html | index.html (1726 LOC, 3 inline scripts) | medium | Inline scripts на line 22, 186, 292 + большой SVG sprite ~ 200 LOC. CSP `'unsafe-inline'` обязательная, реальная strict-CSP блокирована (см. server.js:6210-6217). | Вынести inline-scripts в `assets/boot.js`, `assets/splash.js`, `assets/welcome.js`; SVG sprite — отдельный файл с `<svg src="…">`. CSP можно подтянуть. | M |
| Кросс: styles.css | styles.css (19995 LOC, 193 `!important`, дубли) | high | 35× `.kpi-card`, 28× `.registry-table`, 22× `.gantt-type-pill`, 19× `.toast` — селекторы определяются и переопределяются десятки раз, не по единому правилу (БЭМ). Любая правка цвета/радиуса заставляет править 28 точек либо вмешивается в каскад. 193 `!important` — спецификность тушится грубой силой. | Декомпозиция CSS по разделам (`styles/dashboard.css`, `styles/registry.css`, `styles/gantt.css`, `styles/scanner.css`) с явным @import'ом; cleanup `!important` (audit case-by-case). Цель — каждый файл ≤ 2000 LOC. | L |
| Кросс: styles.css | styles.css | medium | Нет автогенерации dead-CSS report — селекторы для удалённых view'ев (`gantt2-*`, `g2-*` per V14 retired) могут жить мёртвым грузом. | Запустить `purgecss` (можно offline через npm-pkg-lock); или скрипт grep .class-name × .js-codebase. | M |
| Кросс: bundle-size | libs/xlsx.full.min.js (~930KB), libs/sql-wasm.* (~710KB), libs/echarts.esm.min.js (~1MB) | high | Vendored libs ~2.6 MB загружаются при первом render'е (xlsx — lazy через `ensureXLSX`, ECharts — lazy через `await import`). Но sql-wasm.js + sql-wasm.wasm — eagerly через `<script>` в index.html (если SQLite mode включен). | Все три должны быть lazy + dynamic-import. Перепроверить sql-wasm путь; добавить prefetch hint при наведении на settings/storage-mode. | M |
| Кросс: globals via window.* | app.js:79+ (50+ window-привязок) | high | 50+ `window.*` exports для cross-module communication (избегая circular imports). Невозможно делать tree-shake / типизацию / тестирование изолированно. | Постепенно мигрировать на event-bus pattern либо явный DI-context object; `globals.d.ts` уже описывает ожидаемые поля — это readiness. | L |
| Кросс: catch (_) {} | 80+ мест в codebase | medium | Pervasive `try { … } catch (_) {}` (silent swallow) даже там где должна быть видимость (storage write, listener registration, JSON.parse settings). Нет stack-trace в ErrorsLog для половины из них. | Lint-rule: `no-empty` уже включён, но `allowEmptyCatch: true` в конфиге. Поднять до `catch (_) { ErrorsLog.add(...) }` через codemod; defensive paths оставить с явным комментарием. | M |
| Кросс: tests/unit | tests/unit (534 tests, no coverage gate) | medium | `npm run test:coverage` существует но не enforced в CI. Не известно покрытие god-modules (scanner2Renderer, server.js). | Добавить `nyc` или `c8` coverage-gate ≥ 60% на новые changes. | M |

---

## Сводка по severity

| severity | count |
|---|---|
| critical | 4 |
| high | 14 |
| medium | 26 |
| low | 9 |
| **итого** | **53** |

## Топ-7 для немедленного фикса

1. **server.js god-module** (Общее, critical) — декомпозиция server'а по доменам; любая bug-fix-я сейчас в server.js — час навигации.
2. **teamScanner2Renderer.js god-module** (раздел 17, critical) — декомпозиция renderer'а по 6 доменам; уже задокументирован handoff.
3. **Reactive.silent contract enforcement** (Кросс, critical) — runtime-test на infinite-loop, потому что забытый wrap = реальная боль на проде.
4. **state Reactive proxy без immutable snapshots** (Общее, medium→critical при росте rows) — undo/redo через JSON.clone не масштабируется.
5. **CSV._scrubSecrets для LLM/telemetry payload** (раздел 13 + Кросс) — PII течёт в server logs.
6. **innerHTML XSS surface в Реестре + Сотрудниках** (3, 7, high) — 17+ точек с интерполяцией пользовательских строк.
7. **add/remove listener disbalance в Ганте + Сканнере** (4, 17, high) — утечка handler'ов на длительных сессиях.

---

*Аудит подготовлен по карте `AUDIT_MAP.md` (этап 0). 18 разделов покрыты + Общее + Кросс-разрезные. Следующий этап (этап 14, HOLISTIC) должен перепроверить взаимосвязи между разделами 10/11/13 (AI), 8/9/14/15 (teamHealth), 17/18 (integrations).*
