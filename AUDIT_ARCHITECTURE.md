# AUDIT_ARCHITECTURE.md — этап 12 / 14

> Команда: архитектор + tech lead. Метод — top-down прогон по `ARCHITECTURE.md`,
> `CLAUDE.md`, `AUDIT_MAP.md` + сверка с реальным кодом (по 18 разделам, shared
> и кросс-разрезным подсистемам).
>
> Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`
>
> Дата: 2026-05-07.

---

## Часть А — Актуальность ARCHITECTURE.md

`ARCHITECTURE.md` существует, читается за 5 минут, описывает ровно то, что в
голове у tech-lead'а. Но **версия рассинхронизирована с кодом**: документ
помечен «V17.2 (2026-05-01)», а в `CLAUDE.md` проект уже на «V18» с roadmap до
V19/V21/V22. Метки `V19 D3`, `V21 W`, `V22` в исходниках встречаются десятками,
а в карте архитектуры их нет. Это первая системная дыра — ARCHITECTURE.md
де-факто фиксирует прошлогодний срез.

### А.1. Что описано, но не реализовано / расходится с кодом

| # | В ARCHITECTURE.md написано | На самом деле |
|---|---|---|
| A1 | «server.js ~2.5k строк» (CLAUDE.md) | `server.js` = **6486 строк**. Декомпозиция в `server/integrations/*` начата (4 файла, ~небольшие выдержки), но monolith остался. |
| A2 | «views/* … не должны вызывать `Storage.save()` напрямую (только через mutation)» | `views/registry.js` содержит **30+ прямых `Storage.save()`** (строки 183, 220, 257, 405–705…). Контракт нарушен повсеместно. |
| A3 | `Reactive` debounce «100 ms» | В `reactiveStore.js:51` заложено **200 ms** (`_DEBOUNCE_MS`). Документ не обновили после P6 fix (codebase-02 audit). |
| A4 | «Decomposition status (V17)» — таблица из 9 подмодулей, `BulkEditPanel` помечен «(всё ещё в `app.js`)» | `BulkEditPanel` уже вынесен в `app/bulkEditPanel.js` (V18.1 P9). Появились `app/uiToggles.js`, `app/migrations.js`, `app/uxKit.js`, `app/icons.js` — в таблице их нет. |
| A5 | «server.js ~6.5k LOC» (AUDIT_MAP.md) vs «~2.5k» (CLAUDE.md) | Между двумя якорными документами — расхождение в 2.6×. Один из них врёт; код подтверждает 6.5k. |
| A6 | High-level data flow ASCII-art показывает только `localStorage / SQLite` под dataStore.js | Реально — три bucket'а localStorage (`q2_plan_v3`, `q2_settings_v3`, `sbof_app_settings_v1` плюс LLM/integrations/onboarding/action_log/llm_conv) + SQLite-WASM + `appDataStore.js` (отдельный V11 facade). Multi-store. |
| A7 | «Persistence model» список keys: 8 ключей | В коде `STORAGE_KEYS` + `SETTINGS_KEYS` + `app/appSettings.js` `APP_SETTINGS_KEY` — не все перечислены в архитектуре, плюс ad-hoc (`q2_last_seen_v1` в app.js:1932). |
| A8 | «Чёрный дашборд» внутри Async-job pattern | Pulse тоже async-job (`/api/integrations/portfolio-pulse/start` + `/status`), но в архитектуре сказано «используется только blackDashboard.js». Это устарело с V18 P7 (см. `audit-2026-05-V18/07-async-job-unification.md`). |
| A9 | «18 разделов» — упомянуты как product taxonomy | В `app.js` `renderSection` switch покрывает **23 кейса** (включая retired insights, kanban, podlozhka, diagnostics, errors, summary). Карта 18 ≠ карта 23 sections в Nav. |
| A10 | «`docs/state-contracts.md` — 3 контракта» | В коде *подразумевается* четвёртый — Auto-rerender grace period (`_AUTO_RERENDER_GRACE_MS = 250` в `app.js:2176` + `App.markRenderedNow()`). Контракт документирован в `docs/state-contracts.md` под first heading, но в ARCHITECTURE.md упоминания нет. |

### А.2. Что реализовано, но не описано

- **`app/migrations.js`** — V21 W versioned migration runner; в архитектуре нет ни упоминания, ни поля `version`, ни границ.
- **`app/uxKit.js`** (607 строк) — `ConfirmDialog`, `FocusTrap`, `ToastQueue`. По факту — отдельный UI-toolkit-слой; в ARCHITECTURE.md его нет.
- **`server/logger.js`** (NDJSON structured logger, V19 E4) — упомянут в `CLAUDE.md`, отсутствует в ARCHITECTURE.md.
- **`integrations/telemetry.js`** + сервер `/api/telemetry` — клиентская телеметрия; в архитектуре упоминания «`/api/telemetry`» нет.
- **`integrations/pulse/index.js`** (V19 D3 facade) — barrel-файл, через который должен идти весь импорт Portfolio Pulse. ARCHITECTURE.md по-прежнему предлагает прямые импорты `portfolioPulse*.js`.
- **`views/teamHealthDashboards.js`** — единый файл с 4 разделами (8, 9, 14, 15 в карте). В архитектуре про эту консолидацию ничего нет.
- **`views/metricsDeep/`** — динамически загружаемый подграф со своим `dataAdapter.js`, `echartsPrizmaTheme.js`. Lazy-import (`await import()`), отдельная категория-папка с категориями метрик. Не описан.
- **`/api/jira/config`** хранит **Sigma Jira credentials внутри того же файла** что и Delta — в `CLAUDE.md` это упоминается одной строкой («исторический артефакт»), но архитектурного решения «как разделить» нет.
- **`/health`, `/ready`, `/metrics`, `/metrics/prom`** — operational endpoints (`server.js:6240+`). В архитектуре нет.
- **`/api/client-error`** — приёмник client-error из `errorsLog.js`. Не задокументирован.
- **Cross-tab `storage` event listener** (`app.js:2127`) — описан в version-history V12, но не в ARCHITECTURE.md.

### А.3. Что описано неправильно

- Раздел «Reactive flow (must-know)» утверждает что Subscribers это «Storage.save() + App.refreshAll() + FilterEngine.invalidate()». На самом деле в `app.js:2177` это **один subscriber**, который в `Reactive.silent` оборачивает три действия + проверяет `_AUTO_RERENDER_GRACE_MS` + ставит `_reactiveFlushing` re-entry guard. Описание нарочно упрощено, но скрывает важную нелинейность.
- «Module boundaries» таблица: `chat/* — не путать с ai/*`. Реально `ai/aiContextBuilder.js`, `ai/aiFallbackEngine.js`, `ai/aiCeoFallback.js` **импортируют `computeHealthScore` из `chat/chatAlerts.js`**. Граница есть, но протекает.
- «Add a new view» инструкция перечисляет 4 шага, но ничего не говорит о том, что нужно прописать секцию в `app/appSettings.js` `NAV_SECTIONS` и `BLOCKS_PER_SECTION`, в `app/nav.js` (если есть special-routing вроде `insights→dashboard`), и в `app/appSettings.js` `_DEBUG_ONLY_SECTIONS` (если она debug-only).
- «Что retired» — V17 P9 написал «filled-pill chips → stripe-only», но в `audit-2026-05-V21-tabs/` есть ещё рантайм-консолидация tabs, которой в списке retired нет (V21 tabs-consolidation вариант A — `insights` retired, см. `app.js:1858`).

### А.4. Если бы ARCHITECTURE.md не было — что должно быть

Структура целевого черновика — в конце документа («Обновлённый черновик ARCHITECTURE.md»).

---

## Часть Б — Фактическая архитектура

### Б.1. Слои (как они получились де-факто)

```
                      ┌──────────────────────────────────────────────┐
                      │ index.html (1726 LOC) — single-page shell   │
                      │ + theme.css + styles.css (~20k LOC)          │
                      └──────────────────────────────────────────────┘
                                       │
                                       │ DOMContentLoaded
                                       ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ ORCHESTRATOR LAYER                                                       │
   │   app.js (2208 LOC, ↓ 700 после V18.1 P9, всё ещё «god module»)          │
   │   app/init.js, app/nav.js, app/appSettings.js, app/migrations.js         │
   │   app/historyManager.js, app/bulkEditPanel.js, app/uiToggles.js          │
   │   app/storageSettings.js, app/onboarding.js, app/promptsEditor.js        │
   │   app/llmAssistant.js (1577 LOC — sub-orchestrator чата),                │
   │   app/obsidianMascot.js, app/actionLayer.js                              │
   └──────────────────────────────────────────────────────────────────────────┘
            │                          │                       │
            │ subscribes                │ uses                  │ uses
            ▼                          ▼                       ▼
   ┌─────────────────────┐    ┌────────────────────┐   ┌────────────────┐
   │ STATE LAYER         │    │ UTILS / DOMAIN     │   │ UX KIT         │
   │ state.js (Proxy)    │    │ utils.js, types.js │   │ app/uxKit.js   │
   │ reactiveStore.js    │    │ constants.js       │   │ ToastQueue,    │
   │ rowFactory.js       │    │ rowFactory         │   │ ConfirmDialog, │
   │ filters.js          │    │ EmployeeFactory    │   │ FocusTrap      │
   │ + subscribe/notify  │    │ riskEngine.js      │   │ app/icons.js   │
   │   (legacy event-bus)│    │ metricsEngine.js   │   │ app/prizmaUI.js│
   │ historyLog.js       │    │ insightEngine.js   │   └────────────────┘
   │ errorsLog.js        │    │ dependencyEngine.js│
   └──────────┬──────────┘    └────────────────────┘
              │                          ▲
              │ reads / mutates          │
              ▼                          │
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ PERSISTENCE LAYER                                                        │
   │   dataStore.js (1337 LOC) ─ localStorage (8+ ключей) + Reactive.silent   │
   │   appDataStore.js (V11 facade) ─ выбор localStorage | SQLite             │
   │   sqliteStore.js (libs/sql-wasm.js + .wasm)                              │
   │   modules/csv-stream-exporter.js, libs/xlsx.full.min.js (vendored)       │
   └──────────────────────────────────────────────────────────────────────────┘
              │                          ▲
              │ feeds                    │ writes through
              ▼                          │
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ VIEW LAYER (per-section render)                                          │
   │   views/dashboard.js, views/registry.js (997), views/gantt.js (2804),    │
   │   views/timeline.js, views/kanban.js, views/employees.js (934),          │
   │   views/metrics.js, views/teamHealthDashboards.js (4 view в одном файле),│
   │   views/aiView.js, views/aiCeoView.js, views/exec.js,                    │
   │   views/integrationsView.js, views/history.js, views/errorsView.js,     │
   │   views/dependencyGraph.js, views/ganttHtmlExport.js,                    │
   │   views/metricsDeep/* (lazy)                                             │
   └──────────────────────────────────────────────────────────────────────────┘
              │ uses                      │ uses
              ▼                          ▼
   ┌──────────────────────┐    ┌──────────────────────────────────────────────┐
   │ CHAT LAYER (FAB)     │    │ AI LAYER (analytics block-views)             │
   │ chat/chatEngine,     │    │ ai/aiContextBuilder, ai/aiRenderer,          │
   │ chatActions,         │    │ ai/aiFallbackEngine, ai/aiCeoFallback,       │
   │ chatUIRenderer,      │    │ ai/aiCeoRenderer, ai/llmClient.js            │
   │ chatActivityHandler, │    │                                              │
   │ chatIntentParser,    │    │ ⚠ ai/* импортирует chat/chatAlerts.js —      │
   │ chatTemplates,       │    │   протечка границы.                          │
   │ chatPrompts,         │    └──────────────────────────────────────────────┘
   │ chatExplain,         │
   │ chatReports,         │
   │ chatAlerts,          │             ┌──────────────────────────────────────┐
   │ chatContextBuilder   │             │ INTEGRATIONS LAYER (frontend)        │
   └──────────────────────┘             │   integrations/integrationsSync.js   │
                                        │   integrations/integrationsStore.js  │
                                        │   integrations/integrationsRenderer  │
                                        │                                      │
                                        │   PORTFOLIO PULSE (V19 D3)           │
                                        │     pulse/index.js  ← facade        │
                                        │     portfolioPulse.js (orch)         │
                                        │     portfolioPulseModel.js (1984)    │
                                        │     portfolioPulseRenderer.js (1377) │
                                        │     +Api/Insights/Metrics/Backlog/Utils│
                                        │                                      │
                                        │   TEAM SCANNER 2.0 (12 файлов)       │
                                        │     teamScanner2.js (2711)           │
                                        │     teamScanner2Renderer.js (4890!)  │
                                        │     +Enrichment/Diagnostic/Classifier│
                                        │      Config/History/Insights/Prefs   │
                                        │      PersonMetrics/DemoFixture       │
                                        │                                      │
                                        │   BLACK DASHBOARD                    │
                                        │     blackDashboard + Api+Model+Rend  │
                                        │   TECH INFO (techInfo + Api + Rend)  │
                                        │   telemetry.js, loaderPhrases.js     │
                                        └──────────────────────────────────────┘
                                                          │ HTTP /api/*
                                                          ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ SERVER (Node.js, без зависимостей)                                       │
   │   server.js (6486 LOC, monolith)                                         │
   │     ├ static-server (fs.realpath path-traversal closure)                 │
   │     ├ /api/jira/config (read/write jira_config.json)                     │
   │     ├ /api/integrations/* (≥25 endpoints — Jira, BB, CF, Sigma, Jenkins,│
   │     │  pulse start/status, black-dashboard start/status, scanner-prefs, │
   │     │  diag-audit, resolve-identities, confluence-audit-logins, …)     │
   │     ├ /api/llm/chat (proxy to GigaChat / direct, OAuth caching)          │
   │     ├ /api/telemetry, /api/client-error                                  │
   │     ├ /health, /ready, /metrics, /metrics/prom                           │
   │     └ async job-store (in-memory cache TTL для Pulse + BlackDashboard)   │
   │                                                                          │
   │   server/logger.js (NDJSON) ─ structured logs (V19 E4)                   │
   │   server/integrations/{authHelpers, blackDashboard, jobs, techInfo}.js   │
   └──────────────────────────────────────────────────────────────────────────┘
```

### Б.2. Mermaid — модули и зависимости (упрощённо)

```mermaid
flowchart TB
  subgraph BROWSER[Browser]
    direction TB
    HTML[index.html + styles.css + theme.css]

    subgraph ORCH[Orchestrator app.js + app/*]
      AppJS[app.js god-module]
      Nav[app/nav.js]
      AppSettings[app/appSettings.js]
      LLMA[app/llmAssistant.js]
      Mascot[app/obsidianMascot.js]
      UxKit[app/uxKit.js + icons + prizmaUI]
    end

    subgraph STATE[State + reactive]
      State[(state.js Proxy)]
      Reactive[reactiveStore.js]
      Filter[filters.js]
      Row[rowFactory.js]
      HistLog[historyLog.js]
      ErrLog[errorsLog.js]
    end

    subgraph PERS[Persistence]
      DataStore[dataStore.js]
      AppData[appDataStore.js]
      SQLite[sqliteStore.js + libs/sql-wasm]
    end

    subgraph VIEWS[Views per-section]
      Dash[dashboard]
      Reg[registry]
      Gantt[gantt + ganttHtmlExport]
      Timel[timeline + kanban + podlozhka]
      Empl[employees]
      Metrics[metrics + metricsDeep lazy]
      Health[teamHealthDashboards 4-в-1]
      AIv[aiView + aiCeoView + exec]
      Integrs[integrationsView]
      Hist[history + errorsView]
    end

    subgraph CHAT[Chat layer]
      ChatEng[chatEngine + Actions + UI]
      ChatCtx[chatContextBuilder + Alerts]
      ChatAct[chatActivity + Intents + Prompts]
    end

    subgraph AI[AI layer]
      AICtx[aiContextBuilder]
      AIFall[aiFallbackEngine + aiCeoFallback]
      AIRend[aiRenderer + aiCeoRenderer]
      LLMcli[llmClient]
    end

    subgraph INTEG[Integrations frontend]
      ISync[integrationsSync]
      IStore[integrationsStore]
      Pulse[pulse/index.js facade]
      Scanner[teamScanner2 family - 12 files]
      BD[blackDashboard family]
      TI[techInfo family]
      Tele[telemetry]
    end
  end

  subgraph SERVER[Node server.js 6486 LOC]
    direction TB
    Static[static + path-traversal guard]
    Routes[/api/integrations/* 25+]
    Cfg[/api/jira/config = jira_config.json]
    LLMch[/api/llm/chat]
    JobC[in-memory async jobs cache]
    Ops[/health /ready /metrics]
    Telem[/api/telemetry + /api/client-error]
    Logger[server/logger.js NDJSON]
    SrvInt[server/integrations/*]
  end

  HTML --> AppJS
  AppJS --> Nav
  AppJS --> State
  AppJS --> Reactive
  AppJS --> DataStore
  AppJS --> Filter
  AppJS --> VIEWS
  AppJS --> LLMA
  AppJS --> Mascot
  AppJS --> AppSettings
  Reactive -.subscribes.-> AppJS
  State <--> Reactive
  Filter --> State
  DataStore <--> State
  DataStore --> AppData
  AppData --> SQLite
  Row --> State
  HistLog --> State
  ErrLog --> State
  VIEWS --> State
  VIEWS --> Filter
  VIEWS --> DataStore
  VIEWS --> UxKit
  VIEWS -.WARN.-> DataStore
  CHAT --> State
  CHAT --> Filter
  AI --> State
  AI -.WARN crosses border.-> ChatCtx
  CHAT --> LLMcli
  AI --> LLMcli
  LLMA --> CHAT
  INTEG --> State
  Scanner --> Pulse
  BD --> Pulse
  Health --> Scanner
  ISync --> Routes
  Pulse --> Routes
  Scanner --> Routes
  BD --> Routes
  TI --> Routes
  LLMcli --> LLMch
  Tele --> Telem
  ErrLog --> Telem
  Routes --> JobC
  Routes --> Logger
  Routes --> SrvInt
  Cfg --> JSON[(jira_config.json)]

  classDef leak fill:#ffe6e6,stroke:#c40,stroke-dasharray:4 3
  class AI leak
  class VIEWS leak
```

### Б.3. Поток данных «эпик от импорта до Ганта»

```
XLSX/CSV → dataStore.XLSXImporter / CSV.import
         → RowFactory.normalize (заполняет derived поля)
         → state.rows = [...]   (в Reactive.silent — иначе loop)
         → notify('import')     (legacy event-bus subscribers)
         → Reactive flush (debounce 200 ms)
            ├─ Storage.save (debounce 400 ms)         → localStorage q2_plan_v3
            ├─ FilterEngine.invalidate
            └─ App.refreshAll → renderSection(state.activeSection)
                                  → GanttView.render
                                     ↳ FilterEngine.getFiltered (cache by _dataVersion + rows.length)
                                     ↳ DOM innerHTML build
                                     ↳ legend, listeners, drag-drop bind
```

### Б.4. Per-section карта (18 разделов)

| # | Раздел | Свой код | Что общего использует | Особенность архитектуры |
|---|---|---|---|---|
| 1 | Дашборд | `views/dashboard.js` | state, FilterEngine, metricsEngine, riskEngine, insightEngine, RELEASE_FIELDS | Чистый view, единственный читатель `RELEASE_FIELDS`/`RELEASE_WINDOWS`. KPI-cards renderable от пустого state. |
| 2 | Метрики (топ) | `views/metrics.js` | state, FilterEngine, GANTT_RELEASE_BOUNDS, libs/safeHtml | Свой stagger/animation (`_stagger`, `_emergeWithDelay`) — единственный view с локальным motion-системой; общий `App.animateSection` намеренно скипает Метрики. |
| 3 | Реестр | `views/registry.js` (997), `app/bulkEditPanel.js`, `rowFactory.js`, `filters.js`, `components/multiselect.js`, `components/tagInput.js` | state, Storage, RiskEngine | **Самая большая зависимость** — 30+ direct `Storage.save()`, ad-hoc reactive bypasses (`window.Reactive?.silent`). Inline-edit меняет `state.rows[i].x` напрямую. |
| 4 | Гант | `views/gantt.js` (2804), `views/gantt/{aux,legendContent}.js`, `views/dependencyGraph.js`, `views/ganttHtmlExport.js` (1097) | constants (PHASE_*, GANTT_*), state, RowFactory, FilterEngine | Plan-lock `state.planLocked` + `state.ganttEditMode`. HTML-export = standalone document, читает CSS через `fetch('styles.css')`. |
| 5 | История | `views/history.js`, `historyLog.js`, `modules/history.js` | state, Reactive, Storage | Собственный append-only log, persisted в `q2_action_log_v1`. Параллельно есть `errorsLog.js`. |
| 6 | Таймлайн | `views/timeline.js` (содержит `TimelineView` + `PodlozhkaView`) | state, FilterEngine | Два экспорта в одном файле — Подложка и Таймлайн расшарили рендер. |
| 7 | Сотрудники | `views/employees.js` (934), `rowFactory.EmployeeFactory` | state.employees (V17.2 identity-table), integrationsSync (`resolveIdentitiesByEmail`) | Делает direct fetch (`/api/integrations/confluence-resolve-user`) — **layer leak** в integrations frontend. |
| 8 | Перегрузка | `views/teamHealthDashboards.js` (`BurnoutWatchtowerView`) | TeamScanner2 (`integrations/teamScanner2.js`) | Не использует state.rows напрямую — read-only из pulse-model через scanner. |
| 9 | Здоровье компонентов | `views/teamHealthDashboards.js` (`ComponentHealthView`) | TeamScanner2 | то же |
| 10 | AI CEO | `views/aiCeoView.js`, `ai/aiCeoRenderer.js`, `ai/aiCeoFallback.js` | ai/llmClient + chat/chatAlerts (`computeHealthScore`!) | LLM-call с graceful fallback engine. Импортирует из `chat/` — нарушение границы. |
| 11 | CEO-режим | `views/exec.js` | state, FilterEngine | Чистый read-only KPI экран; data flow тот же что Дашборд но другой рендер. |
| 12 | Действия | `app/actionLayer.js` | state, HistoryLog | Plugin-стиль; рендерит section через `ActionLayer.render()` (не view-folder). Странность — единственный «view», который живёт в `app/`. |
| 13 | AI Анализ | `views/aiView.js`, `ai/aiRenderer.js`, `ai/aiContextBuilder.js`, `ai/aiFallbackEngine.js`, `ai/llmClient.js` | chat/chatAlerts | 13 toggleable блоков из `BLOCKS_PER_SECTION.ai` (`app/appSettings.js`). Главный читатель `state.rows` среди AI. |
| 14 | Точность оценок | `views/teamHealthDashboards.js` (`EstimationCalibrationView`) | TeamScanner2 + `computeEstimateAccuracy` | то же что 8/9 — pulse-model only. |
| 15 | Документация (доки-долги) | `views/teamHealthDashboards.js` (`DocDebtConsoleView`) | TeamScanner2 + Confluence audit | то же. |
| 16 | Интеграции | `views/integrationsView.js` (850), `integrations/integrationsRenderer.js`, `integrations/integrationsStore.js`, `integrations/integrationsSync.js` | server `/api/jira/config` + verify endpoints | Settings-modal живёт здесь же; делает прямой `fetch()` на `/api/jira/config` etc. — должно идти через `integrationsSync.proxyPost`. |
| 17 | Сканнер команд | 12 файлов `integrations/teamScanner2*` (Renderer = 4890 LOC!) + Pulse facade (`pulse/index.js`) + 8 файлов `portfolioPulse*` | server + scanner endpoints | Своя «архитектура внутри архитектуры». Подвкладки (Glance/Today/Operations/Trends/Sleeping/Метрики/Деталь сотрудника) — внутри Renderer без декомпозиции на per-tab файлы. |
| 18 | Чёрный дашборд | `integrations/blackDashboard*.js` (4 файла) | Sigma Jira (отдельный инстанс) + async-job pattern | Sigma config живёт в **том же** `jira_config.json` что и Delta — связность high. |

### Б.5. Кросс-разрезные подсистемы

| Подсистема | Где живёт | Используется в | Архитектурная роль |
|---|---|---|---|
| **Reactive Proxy** | `state.js` + `reactiveStore.js` | Все mutations + 1 subscriber в `app.js` | Single source of reactivity. Контракт `Reactive.silent` обязателен для bulk-paths. |
| **Legacy event-bus** | `state.js` `subscribe`/`notify` | `chat/chatActions.notify('chat_filter')`, `dataStore.js` after-import | Параллельная нотификация рядом с Reactive. **Дубль**, см. Часть В. |
| **FilterEngine** | `filters.js` (130 LOC) | Дашборд, Реестр, Гант, Канбан, Таймлайн, Сотрудники, Метрики, AI, Чат | Кэш по `_dataVersion + rows.length` — фрагильный fingerprint (см. F12 fix комментарий). |
| **Storage** | `dataStore.js`, `appDataStore.js`, `sqliteStore.js` | Всё | Multi-bucket localStorage + opt-in SQLite. Save обёрнут в Reactive.silent внутри (иначе loop). |
| **AppSettings** | `app/appSettings.js` (774 LOC) | Sidebar, topbar, settings modal, Nav, AI blocks | NAV_SECTIONS + BLOCKS_PER_SECTION + APP_SETTINGS_KEY. Большой реестр — но гомогенный, не god-module. |
| **uxKit** | `app/uxKit.js` (607 LOC) | Все views | ToastQueue + ConfirmDialog + FocusTrap. Хорошо инкапсулирован. |
| **prizmaUI helpers** | `app/prizmaUI.js` (276 LOC) | Все views (renderPageHeader, prizmaEmptyGlyph, renderHero) | Mini design-system. |
| **Icons** | `app/icons.js` (257 LOC) | DOM-`data-icon` placeholders → SVG | hydrate(document) после init. |
| **Identity table** | `state.employees[]` (V17.2 I1c) | Сканнер, Pulse, BlackDashboard, Employees view | Контракт «no fuzzy matches». |
| **HistoryLog** | `historyLog.js`, `views/history.js` | Глобально — audit trail | append-only, persisted. |
| **ErrorsLog** | `errorsLog.js`, `views/errorsView.js` | Глобально — silent-error sink | Зеркалит showToast(error/warn). Sends `/api/client-error`. |
| **Telemetry** | `integrations/telemetry.js` | Сканнер, Маскот, Чат, AI, app.init | Sender → server `/api/telemetry`. |
| **Маскот** | `app/obsidianMascot.js` + `obsidian/`, intermixed в `chat/chatUIRenderer.js` (per-message), `onboarding/onboardingUI.js` (tour) | Глобально (FAB), чат, тур, тосты, splash | **Расползание concern'а**: маскот рендерится из 4 разных мест. |
| **Onboarding** | `onboarding/onboarding.js` + `onboardingUI.js` + `demoData.js`, `app/onboarding.js` | First-run, demo mode | Два «онбординга» (legacy 24-step tour + CEO micro-tour) — ARCHITECTURE.md упоминает но без архитектуры. |

---

## Часть В — Оценка архитектуры

### В.1. Слоистость

**Вердикт: концептуально 5-слойная (state / persistence / view / integrations / orchestrator) — но протекает в трёх местах.**

1. **`views/* → Storage.save` direct**. Контракт «views не вызывают Storage.save» нарушен 30+ раз только в `views/registry.js`, плюс встречается в `views/employees.js`, `views/gantt.js`. С тех пор как появился Reactive Proxy — эти прямые `Storage.save()` стали избыточны (mutation сама запускает flush), но никто не подчистил.
2. **`views/* → fetch('/api/...')` direct**. `views/integrationsView.js` (5 мест), `views/employees.js` (1 место) делают прямой `fetch` на API endpoints. Должно идти через `integrations/integrationsSync.js` `proxyPost`. Единственный осмысленный случай — `views/ganttHtmlExport.js` `fetch('styles.css')` (это static, не API).
3. **`ai/* → chat/chatAlerts.js`**. Три AI-файла (`aiContextBuilder`, `aiFallbackEngine`, `aiCeoFallback`) импортируют `computeHealthScore` из `chat/`. Граница есть, но протекает; означает что `computeHealthScore` нужно вынести в `metricsEngine.js` или новый `health/score.js`.

### В.2. Связность

| Связь | Высокая (хорошо) | Низкая (плохо) |
|---|---|---|
| `app.js` → 35+ модулей | — | god-module по факту даже после P9 |
| `views/registry.js` ↔ `dataStore.js` ↔ `state.js` ↔ `Reactive` | плотная связность вокруг Реестра — он действительно центральный | трудно поменять `Storage.save` сигнатуру: 30+ call sites в одном файле |
| `chat/chatEngine` ↔ `chat/chatActions` ↔ `chat/chatIntentParser` | hot-path чата кучный — это нормально | но есть плотная связь и с `app/llmAssistant.js` (1577 LOC) — границу LLM-orchestrator vs chat-modules не видно |
| `integrations/teamScanner2Renderer.js` (4890 LOC) | максимальная локальная связность — все scanner-tabs в одном файле | НЕВОЗМОЖНО протестировать pieces — split на per-tab нужен (см. V20 handoff) |
| `views/metricsDeep/*` lazy | хорошая граница — отдельный bundle, отдельный echarts | — |
| `pulse/index.js` facade | хорошая попытка barrel-границы | внутри pulse-модулей друг-на-друга прямые импорты — facade не enforced |

### В.3. Где должны быть границы, но их нет

1. **`app.js` ↔ orchestrator-объекты**. Объект `App = { init, bindXxx, renderSection, … }` (`app.js:588`) до сих пор имеет 30+ методов. Должна быть граница `App` (минимальный bootstrap) vs `Bindings` (UI handlers) vs `RenderRouter` (renderSection switch).
2. **`views/integrationsView.js`** делает и settings-modal, и таб-роутинг (Сканнер vs BlackDashboard), и direct fetch'и, и invokes Scanner2. 850 LOC, 4 ответственности.
3. **`server.js`** (6486 LOC) — единственный файл на бэкенде. `server/integrations/*` начали выносить, но 95% routes по-прежнему inline в монолите.
4. **`integrations/teamScanner2Renderer.js`** (4890 LOC) — все scanner sub-tabs (Glance, Today, Operations, Trends, Sleeping, Метрики, Detail) в одном файле. Этот один файл больше всего views-folder вместе взятого.
5. **`app/llmAssistant.js`** (1577 LOC) и `chat/*` (4427 LOC суммарно) — один LLM-FAB-overlay, расколот по двум папкам без чёткой ответственности «кто кого вызывает».

### В.4. Где границы есть, но лишние / неправильные

1. **`ai/*` vs `chat/*`** — концептуальная граница (analytics vs conversational), но протекает (см. В.1). Скорее проблема правильной декомпозиции.
2. **`appDataStore.js` vs `dataStore.js` vs `sqliteStore.js`** — три файла на одну ответственность «persistence». Можно объединить под `storage/` папкой с явными слоями (`storage/index.js` facade, `storage/local.js`, `storage/sqlite.js`).
3. **`historyLog.js` (root) vs `modules/history.js`** — два файла «history», один действительно про action-log, второй — про что-то ещё (CSV stream history?). Названия путают.

### В.5. Дублирование подсистем

1. **Две системы уведомлений мутации**:
   - `state.subscribe/notify` (legacy event-bus, named events: `'chat_filter'`, `'import'`, …)
   - `Reactive.subscribe` (auto-flush на ANY mutation)
   Они **существуют параллельно**. `notify('chat_batch')` в `chat/chatActions.js:240` живёт рядом с прямой mutation `state.rows[i].x = y`, которая тоже запустит Reactive flush. Дублирование с риском двойного re-render.
2. **Два onboarding'а** — `onboarding/onboarding.js` (legacy 24-step tour) + `onboarding/onboardingUI.js` (CEO micro-tour) + `app/onboarding.js` (orchestrator). По факту 3 модуля делят одну поверхность.
3. **Два разных способа показа toast** — `showToast()` (глобальная функция в `app.js`, легаси API) и `ToastQueue.show()` (новый API в `app/uxKit.js`). `showToast` теперь делегирует в `ToastQueue`, но 234 call-сайта по всему коду — миграция не завершена.
4. **`app.js:computeProgress` vs `metricsEngine.computeProgress`** — `app.js:85` имеет функцию `computeProgress(rows)`, и в `metricsEngine.js` есть аналогичный экспорт (используется dashboard.js). Дубль.
5. **`computeLoad` (app.js:100)** — нигде ещё не используется кроме одного `parseLLMCommand` (строка 131); это dead-code-ish.

### В.6. Точки роста и точки боли

| Горизонт | Что начнёт мешать |
|---|---|
| **6 месяцев** | `views/registry.js` 30+ Storage.save вызовов — каждый новый column type требует ручного вписывания save'а или забывания. `teamScanner2Renderer.js` 4890 LOC — каждый новый scanner-tab кладёт +500-1000 строк в один файл. `server.js` 6486 LOC — каждый новый integration endpoint удлиняет монолит. |
| **12 месяцев** | Новый разработчик не сможет найти границу «где закончился render и начался state». Расхождение «что в ARCHITECTURE.md» vs «что в коде» уже на V19→V22 (3 эпохи за документом). LLM-агенты, которыми, по `CLAUDE.md`, проект растёт, начнут давать broken patches. |
| **18-24 месяца** | Если миграция реестра 1.20-1.22 → 1.23-1.25 не сделана через `RELEASE_FIELDS` (а это уже частично сделано — V21 audit 4.1), то ad-hoc release-strings в Pulse / Scanner / BlackDashboard всплывут как несогласованные. Sigma config внутри jira_config.json взорвётся при попытке вынести Sigma в отдельный сервис. |

### В.7. Соответствие масштабу

**Не over-engineered.** Проект — внутренний инструмент на ~1 desk. Решение «vanilla без бандлера» доказано в `CLAUDE.md` как сознательное (compliance + supply-chain + AI-augmented dev).

**Под-engineered в 3 местах:**

- **Серверная архитектура** — http+url+fs из stdlib без любого route-table или middleware-механизма. Token-redact, rate-limit, security-headers — всё в одном файле.
- **DOM rendering** через `innerHTML` без template-системы или хотя бы единого `escapeHtml` enforce'а. Соотношение `innerHTML` vs `escapeHtml` calls = 195 vs 49 (4×). Любая забытая escape — XSS.
- **Тесты** — 52 unit-файла, но только некоторые покрывают core (`reactiveStore.test.js`, `filterEngine.test.js`, `migrations.test.js`). Большая часть покрывает интеграции, а самый большой риск (`views/registry.js`, `views/gantt.js`, `app.js`) практически не покрыт.

---

## Часть Г — Целевая архитектура и план перехода

### Г.1. Куда двигаться: 3 направления

**1. Дисциплина границ (без переписывания) — 2-3 спринта.**
- Запретить direct `Storage.save()` в `views/*` через ESLint custom rule (в `eslint-rules/` уже есть инфраструктура — `no-unescaped-html`).
- Запретить `fetch('/api/...')` в `views/*` (тот же подход).
- Перенести `chat/chatAlerts.computeHealthScore` в `metricsEngine.js` (или новый `health/score.js`) — убрать единственный ai → chat импорт.
- Заменить ad-hoc `window.Reactive?.silent` (в `views/registry.js`) на правильный import.
- Дописать недостающие `app/*` модули в ARCHITECTURE.md `Decomposition status` таблицу.

**2. Разрезать монолиты (рискованно, но обязательно) — 4-6 спринтов.**
- `server.js` 6486 → 2000 LOC (роутер + 25 сервис-модулей).
  - Вытащить `/api/integrations/portfolio-pulse/*` в `server/integrations/pulse.js`.
  - Вытащить `/api/integrations/{jira-fetch-all, bitbucket-prs, confluence-search, verify-*, jenkins-verify, sigma-verify}` в per-integration файлы.
  - Оставить в `server.js` только: bootstrap, route table (mapping path → handler), middleware (rate-limit, token-redact, logger).
- `views/gantt.js` 2804 → split на per-mode rendering (V18.2 P11).
- `integrations/teamScanner2Renderer.js` 4890 → per-tab files (`scanner2/{glance, today, operations, trends, sleeping, metrics, detail}.js`).
- `app.js` 2208 → последний этап декомпозиции: `app/bindings.js` (все bindXxx) + `app/renderRouter.js` (renderSection).

**3. Разворот к лёгкому типизированному ядру — 6-12 месяцев.**
- Расширить `// @ts-check` opt-in coverage от текущих ~5% файлов до 80%+ для core (`state.js`, `dataStore.js`, `filters.js`, `rowFactory.js`, `reactiveStore.js`).
- Объединить `historyLog`, `errorsLog`, `telemetry` в единый `observability/` пакет — три log-sink'а с одинаковым interface.
- Завести `storage/` пакет (`storage/index.js`, `storage/local.js`, `storage/sqlite.js`) — отрезать `appDataStore.js` от `dataStore.js`.
- Schema-validation на сохраняемое `state` (миграции уже есть в `app/migrations.js`, не хватает run-time invariants).

### Г.2. Что в первую, что во вторую, что параллельно

**В первую (быстрая победа, без боли):**
- `[fix-doc]` обновить `ARCHITECTURE.md` (см. черновик ниже).
- `[lint-rule]` ESLint правило `no-direct-storage-save-in-views`.
- `[lint-rule]` ESLint правило `no-direct-api-fetch-in-views`.
- `[refactor-S]` вынести `computeHealthScore` из `chat/` в `metricsEngine.js` или `health/`.
- `[fix-S]` вычистить `app.js:computeProgress` дубль с `metricsEngine.js`.
- `[fix-S]` вычистить `app.js:computeLoad` если действительно мёртвый.
- `[doc]` написать `docs/persistence-keys.md` со списком всех localStorage-ключей и migrations.

**Во вторую (требует осторожности):**
- `[refactor-M]` `views/registry.js` Storage.save cleanup (заменить на reactive mutation в каждой call-сайте).
- `[refactor-M]` `views/integrationsView.js` direct fetch → proxyPost.
- `[refactor-L]` `server.js` route extraction (не разом — pulse сначала, потом BB, CF, Sigma).
- `[refactor-L]` `views/gantt.js` split (V18.2 P11).
- `[refactor-XL]` `teamScanner2Renderer.js` split на per-tab.

**Параллельно (без блокировок):**
- Расширение typed-coverage (`@ts-check` на 5-10 новых файлов в спринт).
- Тестовое покрытие view-логики (хотя бы smoke-тесты на render).
- Миграция `showToast → ToastQueue.show` (постепенная).

### Г.3. Что без переписывания (рефакторинг границ)

- `pulse/index.js` facade уже есть → enforce через ESLint: запретить импорты `from '../portfolioPulse*.js'` снаружи `integrations/` (только через facade).
- Аналогичный facade для `chat/` (chat/index.js exporting public API), `ai/` (ai/index.js), `app/` (app/index.js).
- Единый `Storage` facade — не Storage object с 15+ методами в `dataStore.js`, а `storage/index.js` с явными `loadPlan / savePlan / loadSettings / saveSettings / migrate / restore`.

### Г.4. Что требует серьёзных вложений

- `server.js` декомпозиция — это 6.5k строк → плановая работа на 4-6 недель.
- `teamScanner2Renderer.js` split — единственный путь к продолжению фичей сканнера; иначе через 6 месяцев он будет 7-8k строк.
- Полноценный type-check всего state — нужен полный JSDoc или переход на `// @ts-check` на всех core-files. Без этого migrations будут накапливать тех-долг.

---

## Находки

Формат: `раздел | файл:строка | severity | проблема | решение | трудозатраты`

| # | Раздел | Файл:строка | Sev | Проблема | Решение | T |
|---|---|---|---|---|---|---|
| 1 | Общее | `ARCHITECTURE.md:3` | high | Версия V17.2 (2026-05-01); код уже на V18/V19/V21/V22, расхождение 3 эпохи | Обновить шапку + `Decomposition status` + Reactive flow по черновику ниже | S |
| 2 | Общее | `ARCHITECTURE.md:128` | medium | Описанный контракт «views/* не должны вызывать Storage.save() напрямую» нарушен 30+ раз | Либо ослабить контракт документально, либо ввести ESLint-правило и постепенно мигрировать call-сайты | M |
| 3 | Общее | `reactiveStore.js:51` vs `ARCHITECTURE.md:107` | low | Документ говорит «100ms», код = 200 ms | Обновить документ или поднять флаг как config | S |
| 4 | Общее (state) | `state.js:7` + `app.js:2177` | high | Параллельно работают `state.subscribe/notify` (legacy) и `Reactive.subscribe` — двойная нотификация на одни мутации | Решить: либо удалить legacy event-bus и перевести `notify('chat_filter')` на reactive-only, либо явно задокументировать «когда что» | M |
| 5 | Реестр | `views/registry.js:183-705` | high | 30+ direct `Storage.save()` после mutations; Reactive Proxy уже умеет это сам | Удалить `Storage.save()` после прямой mutation `state.rows[i].x = y` (Reactive flush сделает); сохранить только там, где идёт fast-path без mutation | M |
| 6 | Реестр | `views/registry.js:218,258` | medium | `window.Reactive?.silent` ad-hoc вместо import | Импортировать `Reactive` нормально (нет cycle — `reactiveStore.js` это лист) | S |
| 7 | Реестр | `views/registry.js` (весь) | medium | 997 LOC, mixed responsibility (render + binders + bulk + customCols + settings panel) | Split на `registry/render.js` + `registry/edits.js` + `registry/settings.js` (V18.2 backlog) | L |
| 8 | Гант | `views/gantt.js` | high | 2804 LOC monolith — сложнее всего тестировать, любой patch требует grep | V18.2 P11 split (запланирован в roadmap) | L |
| 9 | Сотрудники | `views/employees.js:399` | high | Direct `fetch('/api/integrations/confluence-resolve-user')` обходит `integrationsSync.proxyPost` (нет timeout, нет centralized error redact) | Перенести в `integrations/integrationsSync.js` (`resolveConfluenceUser`) и импортировать в view | S |
| 10 | Интеграции | `views/integrationsView.js:190,324,482,555` | high | 4 direct fetch'а на API из view (нет 90s timeout, нет redact) | Перенести в `integrationsSync.js` + ESLint guard | M |
| 11 | Интеграции | `views/integrationsView.js` (весь) | medium | 850 LOC = settings-modal + tab-routing + verify-handlers + scanner/black switch | Разделить на `integrations/settingsModal.js` (UI) и `views/integrationsView.js` (только тонкий router) | M |
| 12 | Сканнер | `integrations/teamScanner2Renderer.js` | critical | 4890 LOC — самый большой single file в проекте | Split per-tab: `scanner2/glance.js`, `scanner2/today.js`, `scanner2/operations.js`, `scanner2/trends.js`, `scanner2/sleeping.js`, `scanner2/metrics.js`, `scanner2/detail.js` | L |
| 13 | Сканнер | `integrations/teamScanner2.js` (2711 LOC) + 11 sibling files | medium | Семейство 12 файлов — Renderer god-file перетягивает весь концерн | Установить convention `teamScanner2*.js` → `scanner2/*.js` папка | M |
| 14 | Pulse | `integrations/portfolioPulseModel.js` (1984), `portfolioPulseRenderer.js` (1377) | medium | Pulse facade `pulse/index.js` создан, но не enforced — внутренние модули по-прежнему гигантские | ESLint правило: outside of `integrations/`, импортить только из `pulse/index.js` | S |
| 15 | AI / Chat | `ai/aiContextBuilder.js:10`, `ai/aiFallbackEngine.js:11`, `ai/aiCeoFallback.js:11` | high | `import { computeHealthScore } from '../chat/chatAlerts.js'` — нарушение границы ai↔chat | Вынести `computeHealthScore` в `metricsEngine.js` или `health/score.js` (нейтральное место) | S |
| 16 | Чат | `app/llmAssistant.js` (1577) + `chat/*` (4427 LOC сум.) | medium | Не ясно «кто оркестрирует»: app/llmAssistant или chat/chatEngine | Чёткая инструкция в ARCHITECTURE.md: `llmAssistant` = UI/FAB-overlay, `chat/*` = pure logic. Декларация публичного API чата через `chat/index.js` | M |
| 17 | Server | `server.js:6486` | critical | Монолит на 6.5k строк, 25+ endpoints inline | Поэтапная декомпозиция в `server/integrations/*` (V18.1 начато для jobs+authHelpers — 108 LOC вынесено, остаётся 6378) | L |
| 18 | Server | `server.js` + `jira_config.json` | high | Sigma Jira creds внутри одного файла с Delta — нарушение isolation, разделение = breaking change (упомянуто в `CLAUDE.md`/`docs/sigma-isolation.md`) | План миграции: `sigma_config.json` отдельно, dual-read в server.js на 1 версию, потом drop | M |
| 19 | Server | `server.js:174` | low | Bucket для rate-limit считается ad-hoc в одной строке — magic split-by-3 | Вынести `_routeBucket(pathname)` в helper | S |
| 20 | Storage | `dataStore.js`, `appDataStore.js`, `sqliteStore.js` | medium | Три файла на одну ответственность; нет публичного facade | Завести `storage/index.js` facade, `storage/local.js`, `storage/sqlite.js`. Депрекировать прямые импорты | M |
| 21 | Storage | `app.js:1932` (`q2_last_seen_v1`) | low | Ad-hoc localStorage key вне `STORAGE_KEYS` constants | Добавить в `constants.STORAGE_KEYS` или хотя бы в константу модуля | S |
| 22 | Persistence keys | `dataStore.js`, `historyLog.js`, `app/appSettings.js`, `errorsLog.js` | medium | 8+ ключей localStorage без единого индекса | `docs/persistence-keys.md` с таблицей key → owner → version → migration | S |
| 23 | UX kit | `app.js:158` showToast vs `app/uxKit.js` ToastQueue | low | Двойной API. 234 call-сайта — миграция не завершена | План постепенного rename `showToast → ToastQueue.show` | M |
| 24 | Onboarding | `onboarding/onboarding.js`, `onboarding/onboardingUI.js`, `app/onboarding.js` | low | Два tour'а + один orchestrator на одну поверхность | Объединить в `onboarding/index.js` facade с `tourLegacy` + `microTour` | M |
| 25 | Mascot | `app/obsidianMascot.js` + render in `chat/chatUIRenderer.js` + `onboarding/onboardingUI.js` + `app/uxKit.js` | low | Mascot рендерится из 4 разных мест | Дать `mascot/render.js` с публичным API; точки рендера зовут его | S |
| 26 | History | `historyLog.js` (root) vs `modules/history.js` | low | Два файла «history» с разной семантикой | Переименовать `modules/history.js` или явно задокументировать в обоих headers | S |
| 27 | History | `app.js:85 computeProgress` vs `metricsEngine.computeProgress` | medium | Две функции с одинаковым именем, разные реализации | Удалить `app.js:computeProgress`, использовать metricsEngine | S |
| 28 | History | `app.js:100 computeLoad` | low | Используется только внутри `parseLLMCommand` (строка 131); `parseLLMCommand` сам похож на dead | Грепнуть call-сайты `parseLLMCommand`; если только одна точка — удалить обе | S |
| 29 | Async-jobs | `ARCHITECTURE.md:160` («Async-job pattern (Black Dashboard)») | medium | Документ говорит «используется только blackDashboard», реально Pulse тоже async-job (V18 P7) | Обновить раздел «Async-job pattern» с обоими endpoint-парами | S |
| 30 | Sec/HTML | проектwide | high | Соотношение `innerHTML` (195) vs `escapeHtml` (49) — потенциал XSS если string forgotten | Audit всех `innerHTML` в views, прогнать `eslint-rules/no-unescaped-html` агрессивнее | M |
| 31 | Cross-tab sync | `app.js:2127` | low | Cross-tab `storage` event listener документирован в version-history (V12), но не в ARCHITECTURE.md | Добавить раздел «Cross-tab sync» | S |
| 32 | Operational | `server.js:6240` (`/health, /ready, /metrics`) | low | Operational endpoints не в ARCHITECTURE.md | Добавить раздел «Operational endpoints» | S |
| 33 | Reactive | `reactiveStore.js:90` (Set/Map не trapped) | medium | `state.bulkSelected.add()` не триггерит flush; нужен `Reactive.notifyManual()` (V21 S) — задокументировано, но мало где enforced | Lint-правило / тест на бородатый случай: каждое использование `Set.add/delete` с reactive proxy на следующей строке `Reactive.notifyManual()` | M |
| 34 | Decomposition | `app.js` 2208 LOC | medium | Всё ещё «god module» после P9. `App` объект имеет 30+ методов | Финальный split: `app/bindings.js` + `app/renderRouter.js` | M |
| 35 | Tests | `tests/unit/` 52 файла | medium | Coverage сосредоточена на integrations. Core (`views/registry.js`, `views/gantt.js`, `app.js`) — практически не покрыты | Добавить smoke-test render-circles для каждой view с пустым state и стандартным fixture | L |
| 36 | TypeScript | `globals.d.ts` | low | `App?: any`, `LLMAssistant?: any` — типы 'any' для главных orchestrator-объектов | Описать `interface AppApi { init(): void; refreshAll(): void; ... }` в globals.d.ts | M |
| 37 | Dependencies | `views/teamHealthDashboards.js:19` | low | View напрямую импортирует `TeamScanner2` из integrations | Обновить ARCHITECTURE.md «views зависят от scanner» — это **архитектурное решение** (4 view = тонкие read-only обёртки над pulse-model) | S |
| 38 | Doc | отсутствует | medium | Нет ADR-стиля документа «решение V19 D3 — facade для pulse» — оно описано только в комментарии header'а `pulse/index.js` | Завести `docs/adr/` папку или хотя бы `docs/decisions.md` со списком ADR | S |

**Итого: 38 находок, 4 critical, 9 high, 13 medium, 12 low.**

---

## Обновлённый черновик ARCHITECTURE.md

> Это **draft replacement** — можно положить в репо вместо текущего. Сохраняет
> структуру оригинала, но обновлён до V22 + закрывает дыры из Части А.

```markdown
# Призма — Architecture

> Текущая активная версия: **V22** (2026-05-07). История V11→V22:
> [`docs/version-history.md`](./docs/version-history.md).
> LLM-агенту читать сначала [`CLAUDE.md`](./CLAUDE.md), потом этот файл.

## Overview

Внутренний инструмент квартального планирования для мобильной платформы Сбербанка.
Управление эпиками / релизами / зависимостями + интеграции
(Jira Delta + Sigma, Bitbucket, Confluence, GigaChat-LLM, Jenkins, Zephyr).

Архитектура: **vanilla-JS browser + один Node.js сервер**, без бандлера и без
рантайм-зависимостей. Сервер работает как:

1. Static-server для модулей и `index.html` (с `fs.realpath` path-traversal guard
   и CSP/X-Frame headers)
2. Proxy для интеграций (`/api/integrations/*`) — там и хранятся токены
3. Конфиг-стор (`jira_config.json` рядом с `server.js`)
4. Operational endpoints (`/health`, `/ready`, `/metrics`, `/metrics/prom`)
5. Telemetry sink (`/api/telemetry`, `/api/client-error`)

## Почему vanilla — рацио

Это **сознательный выбор**, не легаси:

1. **Corporate compliance** — каждый npm-пакет проходит security review.
2. **Supply-chain immunity** — vendored только `xlsx` и `sql-wasm`.
3. **Offline-friendly** — работает с `file://` или локальным proxy.
4. **AI-augmented dev workflow** — vanilla код LLM генерируют надёжнее.
5. **One-step deploy** — `node server.js` это вся production-настройка.

## Tech Stack

| Layer | Tech |
|---|---|
| Browser JS | Native ES Modules; никакого бандлера |
| Rendering | Imperative DOM через `innerHTML` (обязательный escape `Utils.escapeHtml`) |
| State | Single mutable `state` Object, обёрнутый в Proxy → debounced flush 200 ms |
| Persistence | `localStorage` (default, 8+ ключей) или SQLite-WASM (opt-in, V11) |
| Server | Node.js built-ins (`http`, `https`, `fs`, `url`); никакого Express |
| Auth proxies | OAuth для GigaChat (server-side caching), Bearer/Basic для Jira/BB/CF |
| XLSX | `libs/xlsx.full.min.js` (vendored, ~930 KB) |
| SQLite | `libs/sql-wasm.js` + `sql-wasm.wasm` (vendored, ~50 + 660 KB) |
| Charts | `libs/echarts.esm.min.js` (lazy via `await import()` в Metrics Deep) |
| Type checking | JSDoc + `tsc --checkJs` (opt-in per file через `// @ts-check`) |
| Tests | `node:test` (52 unit + 11 contract + 10 e2e) + `testRunner.js` (legacy) |

## High-level data flow

См. `AUDIT_ARCHITECTURE.md` § Б.1, Б.2 — там полная картина.

Краткая схема:

```
browser ──(mutations)──▶ state.js Proxy ──(debounce 200ms)──▶ Reactive.subscribe
                                                                    │
                          ┌─────────────────────────────────────────┤
                          ▼                                         ▼
                   FilterEngine.invalidate                   Storage.save (debounce 400ms)
                          │                                         │
                          ▼                                         ▼
                  views/* (per-section render)             localStorage / SQLite
                          │
                          ▼
                  fetch /api/* ──▶ server.js (route table) ──▶ jira/bb/cf/sigma APIs
```

## State as a single source of truth

Всё живое состояние в одном объекте `state` (`state.js`). Этот объект — Proxy-обёрнутый
mutable Object (не Redux-store, не Vue-reactive — наша минимальная Proxy-обёртка
в `reactiveStore.js`).

Ключевые поля: `rows[]`, `employees[]` (V17.2 identity), `filters`, `activeSection`,
`diagnostics`, `sort`, `ganttMode`, `colOrder/Widths/Visibility/Types/Labels`,
`pinnedCols`, `customCols`, `theme`, `sidebarCollapsed`, `simMode`, `planLocked`
(V14), `ganttEditMode` (V14), `llm`, `actionLog[]`, `bulkSelected` (Set).

Полный shape — в `state.js` `_rawState`.

## Reactive flow (must-know)

`state` обёрнут в Proxy в `reactiveStore.js`. Любая мутация:

1. `state.rows[i].team = 'X'` → Proxy fires `set` trap → marks dirty
2. **200 ms** debounce → fires single `Reactive.subscribe` callback в `app.js`
3. Callback (под `Reactive.silent` и `_reactiveFlushing` re-entry guard):
   - `FilterEngine.invalidate()`
   - `Storage.save()` (внутри 400 ms debounce + `Reactive.silent` обёртка)
   - `App.refreshAll()` — ТОЛЬКО если активная секция не была отрисована за
     последние **250 ms** (`_AUTO_RERENDER_GRACE_MS`)
4. View re-renders

`Reactive.silent(() => { ... })` временно отключает proxy-trap для mass-mutations
(snapshot restore, bootstrap, syncColumnSettings).

`Reactive.notifyManual()` (V21 S) — для не-видимых Proxy мутаций (Set/Map ops,
direct localStorage write).

→ Полный контракт: [`docs/state-contracts.md`](./docs/state-contracts.md)

## Key contracts (4 штуки)

1. **Reactive.silent** для bulk-mutations — иначе infinite loop.
2. **Auto-rerender grace 250 ms** — если view только что отрисован, reactive
   flush НЕ перерисовывает повторно (анти-blink).
3. **Identity-deterministic attribution** (V17.2) —
   `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}`
   авторитетная identity-таблица для интеграций.
4. **`_scrubSecrets` policy** — все экспорты через `CSV._scrubSecrets()`.

→ [`docs/state-contracts.md`](./docs/state-contracts.md)

## Module boundaries

| Модуль | Ответственность | Не должен |
|---|---|---|
| `state.js` | Хранить state, экспортировать Proxy-обёртку | Содержать business logic |
| `reactiveStore.js` | Proxy + silent guard | Делать I/O |
| `dataStore.js` | Persistence (load/save/import/export) для localStorage | Знать про DOM |
| `appDataStore.js` | V11 facade — выбор между localStorage / SQLite | — |
| `sqliteStore.js` | SQLite-WASM-обёртка | Знать про другие хранилища |
| `app.js` | Bootstrap, navigation, bind handlers, hold App-singleton | Стать «god-object» — постепенный split в `app/*` |
| `app/*` | Декомпозированные подмодули (см. таблицу ниже) | — |
| `views/*` | Рендер per-section | Вызывать `Storage.save()` напрямую (положись на reactive flush) — *см. ESLint guard в roadmap* |
| `views/*` | Рендер per-section | Делать `fetch('/api/...')` — только через `integrations/integrationsSync.proxyPost` |
| `integrations/*` | Frontend-логика интеграций + analyse | Делать direct fetch — только через `proxyPost` |
| `pulse/index.js` | Facade для всего Portfolio Pulse (V19 D3) | Импортироваться из pulse-internal модулей (циклический ref) |
| `chat/*` | LLM-чат features (pure logic) | Путать с `ai/*` (там analytics block-renderers) |
| `ai/*` | AI-Анализ + AI-CEO views (analytics) | Импортировать из `chat/*` (один случай — `computeHealthScore` — TODO migrate) |
| `app/llmAssistant.js` | LLM-FAB-overlay UI orchestrator | Содержать pure intent-parsing — это в `chat/` |
| `app/uxKit.js` | ToastQueue / ConfirmDialog / FocusTrap | — |
| `server.js` | Static + proxy + config persistence + operational | Хранить state в памяти долго (только cache с TTL) |
| `server/logger.js` | NDJSON structured logger (V19 E4) | — |

## Persistence model

Два варианта (выбор юзером в Настройках → Хранилище):

1. **localStorage** (default) — 8+ ключей:
   - `q2_plan_v3` — rows + employees
   - `q2_settings_v3` — col-settings + theme + planLocked + ganttEditMode
   - `q2_llm_settings_v1` — LLM config
   - `q2_integrations_v1` — integration tokens (deprecated, server is now source of truth)
   - `q2_onboarding_v1` — first-run state + mode
   - `sbof_app_settings_v1` — sidebar/topbar visibility
   - `q2_action_log_v1` — historyLog
   - `q2_llm_conv_v1` — chat conversation
   - `q2_last_seen_v1` — для personal digest
   - Migrations v1→v2→v3 в `dataStore.js` + `app/migrations.js` (V21 W versioned runner).
2. **SQLite-WASM** (opt-in, V11) — `sqliteStore.js` + `appDataStore.js` facade.

Cross-tab sync: `window.addEventListener('storage', ...)` в `app.js:2127` — реагирует
только на `STORAGE_KEYS` + `SETTINGS_KEYS`, ignores `removeItem`. Reload идёт через
`Reactive.silent` чтобы не triggered save loop.

Экспорт/импорт:
- **CSV** — строки + `__Q2SETTINGS__` / `__Q2BUNDLE__` / `__Q2EMPLOYEES__` маркеры
- **JSON** — атомарный round-trip (`JSONExport.buildSnapshot` / `JSONImport.apply`)
- **XLSX** — через vendored `xlsx.full.min.js`

Все экспорты ОБЯЗАНЫ проходить через `CSV._scrubSecrets()`.

## Async-job pattern

Большие запросы идут через async-job (V18 P7 унификация для двух pipelines):

| Pipeline | Start | Status | Cache TTL |
|---|---|---|---|
| Portfolio Pulse | `POST /api/integrations/portfolio-pulse/start` → `{jobId}` | `GET /api/integrations/portfolio-pulse/status?jobId=...` | TTL ~5 min |
| Black Dashboard | `POST /api/integrations/black-dashboard/start` → `{jobId}` | `GET /api/integrations/black-dashboard/status?jobId=...` | TTL ~5 min |

Server держит `Map<jobId, {status, result, progress}>`, client поллит каждые 2с.

## Operational endpoints

- `GET /health` — process liveness
- `GET /ready` — config readiness
- `GET /metrics` — JSON
- `GET /metrics/prom` — Prometheus exposition
- `POST /api/telemetry` — клиентские события (`integrations/telemetry.js`)
- `POST /api/client-error` — клиентские исключения (`errorsLog.js`)

## Decomposition status (V18.1 + V19 + V21 + V22)

### `app.js` (2208 LOC, target ~600)

| Подмодуль | Где | LOC |
|---|---|---|
| `Onboarding` | `app/onboarding.js` + `onboarding/onboarding.js` + `onboarding/onboardingUI.js` | 91 + 200 + ~300 |
| `LLMAssistant` | `app/llmAssistant.js` | 1577 |
| `HistoryManager` | `app/historyManager.js` | 160 |
| `BulkEditPanel` | `app/bulkEditPanel.js` (V18.1 P9) | 140 |
| `ActionLayer` | `app/actionLayer.js` | 214 |
| `PromptsEditor` | `app/promptsEditor.js` | 137 |
| `Nav` | `app/nav.js` | 112 |
| `init` (welcome splash) | `app/init.js` | 198 |
| `StorageSettings` | `app/storageSettings.js` | 195 |
| `SimMode/SidebarUI/ThemeUI` | `app/uiToggles.js` (V18.1 P9) | 144 |
| `AppSettings/NAV_SECTIONS/BLOCKS_PER_SECTION/TOPBAR_ITEMS` | `app/appSettings.js` (V18.1 P9) | 774 |
| `Migrations` (V21 W) | `app/migrations.js` | 132 |
| `ConfirmDialog/FocusTrap/ToastQueue` (V21 P) | `app/uxKit.js` | 607 |
| `Icons` (V21 Wave-3) | `app/icons.js` | 257 |
| `Page-headers / Hero / EmptyState` | `app/prizmaUI.js` | 276 |
| `ObsidianMascot` | `app/obsidianMascot.js` | 494 |
| Все ещё в `app.js` | toast (legacy `showToast`), `App` orchestrator (init/bindXxx/renderSection/refreshAll), Reactive subscribe, cross-tab listener | 2208 |

### `server.js` (6486 LOC, target ~2000)

V18.1 P10 начал — вынесено в `server/integrations/{authHelpers, blackDashboard, jobs, techInfo}.js` (~108 LOC). Остальные 25+ endpoints inline. Roadmap V18.2+:
- pulse → `server/integrations/pulse.js`
- jira-fetch-all + bitbucket-prs → `server/integrations/{jira, bitbucket}.js`
- confluence-search + confluence-audit-logins → `server/integrations/confluence.js`
- sigma-verify → `server/integrations/sigma.js`
- jenkins-verify → `server/integrations/jenkins.js`
- llm/chat → `server/llm.js`
- telemetry/client-error/operational → `server/observability.js`

### `views/gantt.js` (2804 LOC) — split в V18.2 P11.
### `integrations/teamScanner2Renderer.js` (4890 LOC) — split per-tab в V19+.

## Adding a new view

1. Создай `views/myview.js` экспортирующий `render(rows)` или `render()`.
2. Добавь `<section id="section-myview" class="app-section hidden">` в `index.html`.
3. В `app.js` `App.renderSection(s)` switch — добавь case `'myview' → MyView.render()`.
4. Добавь nav-button в `index.html` (`<button class="nav-item" data-section="myview">`).
5. Прописать в `app/appSettings.js`:
   - `NAV_SECTIONS` (если в навигации)
   - `BLOCKS_PER_SECTION` (если есть toggleable блоки)
   - `_DEBUG_ONLY_SECTIONS` (если debug-only)
6. Если view нужны секционные легенды — `App.renderSectionLegends(s)` в `app.js`.

Pattern «mobile-first»: render заполняет existing DOM-узел через innerHTML
(не создаёт поверх). Cleanup listeners идемпотентен — view может re-render'иться
много раз.

## Adding a new integration endpoint

1. Frontend: создай fetch-helper в `integrations/<name>Api.js`. Используй
   `proxyPost('/api/integrations/<name>', body)` (`integrationsSync.js`).
2. Server: добавь route в `server.js` где остальные `/api/integrations/*`
   (или в `server/integrations/*` если уже декомпозировано).
3. Token-handling: пройди через `_ppMakeAuthHeader(cfg.<name>Token)` /
   `server/integrations/authHelpers.js`. Token-redact на error path.
4. Если данные в Pulse-pipeline → расширь `analysePulse(opts)` сигнатуру.
5. Тесты: contract-test в `tests/contract/`.

→ [`docs/integrations/README.md`](./docs/integrations/README.md)

## Security defaults

| Поверхность | Защита |
|---|---|
| HTML insert | `Utils.escapeHtml` обязателен; ESLint правило `no-unescaped-html` (max-warnings 215 — есть legacy) |
| CSV/JSON exports | `CSV._scrubSecrets` рекурсивно вычищает token/secret/password/auth/key |
| CSV cell injection | escapeCSV префиксует ZWSP `​` для значений начинающихся с `= + - @ \t \r` |
| Path traversal | `fs.realpath` closure в static-server |
| CSP, X-Frame-Options | static-server отдаёт security headers |
| Rate-limit | `RATE_LIMIT_PER_MIN` (default 60) на `/api/*` (бакетинг по pathname split-by-3) |
| Token-redact | error-paths замазывают `Bearer`, `Authorization`, etc. |
| Server logger | NDJSON + PII-scrub на server-side |

## Что retired

См. [`docs/version-history.md`](./docs/version-history.md) и
[`docs/dont-touch.md`](./docs/dont-touch.md).

| V | Что retired |
|---|---|
| V14 (B2) | `GanttV2` — старый «Гант со стрелками». Следы в constants. |
| V14 (B3) | `gantt2*` settings keys |
| V15 | Editorial-Bold редизайн |
| V17 P9 | filled-pill chips → Spine-pill stripe-only |
| V17.2 I1c | `_ppFindByPartial` fuzzy-name-match — production-disabled, dev-fallback за флагом |
| V18.1 | summaryMode (Сводная свёрнута в Дашборд, П4-MS Wave 1) |
| V21 tabs-A | `insights` route — remap → dashboard в `Nav.goTo` |

## Dev tooling

```bash
npm start                    # node launch.js 8080
npm run server               # node server.js 8080
npm test                     # testRunner + unit + contract → 534/11/0
npm run typecheck            # tsc --checkJs (JSDoc-typed files only)
npm run lint                 # eslint --max-warnings 215
npm run ci                   # typecheck + lint + test + e2e + perfBudget
```

## Integration-specific docs

- [`docs/integrations/README.md`](./docs/integrations/README.md) — обзор + Pulse pipeline
- [`docs/integrations/api-endpoints.md`](./docs/integrations/api-endpoints.md) — таблица endpoints
- [`docs/integrations/auth-and-secrets.md`](./docs/integrations/auth-and-secrets.md)
- [`docs/sigma-isolation.md`](./docs/sigma-isolation.md) — план разделения Sigma config
- [`docs/v20-scanner2-handoff.md`](./docs/v20-scanner2-handoff.md) — Scanner 2.0 handoff
```

---

## Резюме (TL;DR для tech-lead'а)

- **ARCHITECTURE.md рассинхронизирован на 3-4 эпохи** (V17.2 → V22). Самое
  быстрое полезное действие — заменить файл на черновик выше.
- **Главный технический долг — три монолита**: `server.js` (6486),
  `teamScanner2Renderer.js` (4890), `views/gantt.js` (2804). Они блокируют
  6-12-месячный roadmap.
- **Контрактная протечка `views/* → Storage.save` direct** (30+ мест) —
  низкорисковый рефакторинг, но требует ESLint-правила.
- **Дубль системы уведомлений** (`state.subscribe/notify` + `Reactive.subscribe`) —
  legacy event-bus теоретически можно retire, но требует аудита всех `notify(...)` call-сайтов.
- **`ai/* → chat/*` impurity** — единственный нарушенный import; устраняется за S-час.
- **Под-engineered места**: server-side route-table (нет!), ESLint-enforce'мент
  HTML-escape, view-level test coverage.

Архитектура **в целом здоровая** — слои read как-задумано, контракты Reactive
работают. Главное — догнать документацией реальный код и разрезать три монолита,
прежде чем они станут 8-9k строк каждый.
