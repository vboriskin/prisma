# AUDIT_MAP.md — Карта проекта по разделам

> Этап 0. Команда: системные аналитики. Этот документ — основа для последующих этапов; границы разделов перед тем как пускать другие команды.

**Корень**: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`
**Стек**: ~44k LOC vanilla JS (ES modules, без бандлера) + один Node.js сервер `server.js` (~6.5k строк) для статики + proxy интеграций. styles.css ~20k строк, index.html ~1.7k строк.

---

## 1. Дашборд

| Что | Файлы |
|---|---|
| Главный view | `views/dashboard.js` |
| Hero / page-header helpers | `app/prizmaUI.js` (`renderHero`, `renderPageHeader`, `prizmaEmptyGlyph`) |
| HTML host | `index.html` (`#section-dashboard`) |
| Стили | `styles.css` (`.dash-*`, `.kpi-*`, `.prizma-hero-*`, `.dashboard-tables-grid`, `.release-breakdown-*`) |
| Использует | `state.js`, `filters.js`, `metricsEngine.js`, `riskEngine.js`, `insightEngine.js`, `constants.js` (`RELEASE_FIELDS`, `RELEASE_WINDOWS`) |
| Тесты | `tests/unit/dashboard*.test.js` (если есть) |

## 2. Метрики (верхний раздел)

| Что | Файлы |
|---|---|
| Главный view | `views/metrics.js` (`MetricsView` + `DiagnosticsView` экспортируется отсюда же) |
| HTML host | `index.html` (`#section-metrics`) |
| Стили | `styles.css` (`.metrics-card`, `.metrics-spark-*`, `.metrics-control-ring-*`, `#section-metrics .metrics-card.is-emerging`) |
| Локальные motion-helpers | `MetricsView._stagger`, `MetricsView._emergeWithDelay` (см. `views/metrics.js:456-481`) |
| Использует | `state.js`, `filters.js`, `constants.js` (`GANTT_RELEASE_BOUNDS`), `libs/safeHtml.js` |

## 3. Реестр

| Что | Файлы |
|---|---|
| Главный view | `views/registry.js` |
| Row factory + EmployeeFactory | `rowFactory.js` |
| Filter engine | `filters.js` |
| Bulk-edit panel | `app/bulkEditPanel.js` |
| HTML host | `index.html` (`#section-registry`, `#registry-legend`, `#col-toggle-panel`, `#registry-settings-panel`, `#bulk-panel`) |
| Стили | `styles.css` (registry-* / col-toggle / bulk-* классы) |

## 4. Гант

| Что | Файлы |
|---|---|
| Главный view | `views/gantt.js` (~2200 строк) |
| Sub-renders | `views/gantt/` директория (если есть подмодули) |
| HTML-export | `views/ganttHtmlExport.js` |
| Dependency graph | `views/dependencyGraph.js` |
| Constants | `constants.js` (`GANTT_RELEASE_BOUNDS`, `WORK_TYPES`, `GANTT_COL_LABELS`) |
| Стили | `styles.css` (`.gantt-*`, `.gdt-*`) |

## 5. История

| Что | Файлы |
|---|---|
| Главный view | `views/history.js` |
| Action log core | `historyLog.js` |
| HTML host | `index.html` (`#section-history`) |

## 6. Таймлайн

| Что | Файлы |
|---|---|
| Главный view | `views/timeline.js` |
| HTML host | `index.html` (`#section-timeline`) |
| Стили | `styles.css` (`.timeline-*`) |

## 7. Сотрудники

| Что | Файлы |
|---|---|
| Главный view | `views/employees.js` |
| Employee factory + ghost/blocked detect | `rowFactory.js` (`EmployeeFactory.create`/`.normalize`/`.detectBlocked`/`.detectServiceAccount`/`.detectGhost`) |
| HTML host | `index.html` (`#section-employees`) |
| Стили | `styles.css` (`.employee-*`, `.employees-*`, `.els-*`, `.kpi-card.kpi-signal-*`) |

## 8. Перегрузка

| Что | Файлы |
|---|---|
| Renderer | `views/teamHealthDashboards.js` (`BurnoutWatchtowerView`, `views/teamHealthDashboards.js:176`) |
| HTML host | `index.html:1370` (`#section-burnout` — пустая секция, заполняется JS) |

## 9. Здоровье компонентов

| Что | Файлы |
|---|---|
| Renderer | `views/teamHealthDashboards.js` (`ComponentHealthView`, `views/teamHealthDashboards.js:129`) |
| HTML host | `index.html:1368` (`#section-component-health`) |

## 10. AI CEO

| Что | Файлы |
|---|---|
| Главный view | `views/aiCeoView.js` |
| Renderer | `ai/aiCeoRenderer.js` |
| Fallback engine | `ai/aiCeoFallback.js` |
| HTML host | `index.html:1422` (`#section-ai-ceo`) |
| LLM client | `ai/llmClient.js` |

## 11. CEO-режим

| Что | Файлы |
|---|---|
| Главный view | `views/exec.js` |
| HTML host | `index.html:1424` (`#section-exec`) |
| (отдельный read-only KPI экран — codebase-04 audit i3) |

## 12. Действия

| Что | Файлы |
|---|---|
| Action layer | `app/actionLayer.js` |
| HTML host | `index.html:1376` (`#section-actions`) |
| (плагины-действия, кнопки workflow) |

## 13. AI Анализ

| Что | Файлы |
|---|---|
| Главный view | `views/aiView.js` (`AIView`) |
| Renderer | `ai/aiRenderer.js` |
| Context builder для LLM | `ai/aiContextBuilder.js` |
| Fallback engine | `ai/aiFallbackEngine.js` |
| LLM client | `ai/llmClient.js` |
| HTML host | `index.html:1411` (`#section-ai`) |
| Блоки (toggleable) | `app/appSettings.js:BLOCKS_PER_SECTION.ai` (13 блоков: health/forecast/if_nothing_changes/dashboard/quality/bottlenecks/anomalies/risk_narrative/second_opinion/prioritization/dependency/replanning/recommendations) |

## 14. Точность оценок

| Что | Файлы |
|---|---|
| Renderer | `views/teamHealthDashboards.js` (`EstimationCalibrationView`, `views/teamHealthDashboards.js:65`) |
| HTML host | `index.html:1366` (`#section-est-calibration`) |

## 15. Документация (доки-долги)

| Что | Файлы |
|---|---|
| Renderer | `views/teamHealthDashboards.js` (`DocDebtConsoleView`, `views/teamHealthDashboards.js:262`) |
| HTML host | `index.html:1372` (`#section-doc-debt`) |

## 16. Интеграции (контейнер-секция)

| Что | Файлы |
|---|---|
| Главный view + settings modal handler | `views/integrationsView.js` |
| Settings modal markup | `integrations/integrationsRenderer.js` (`renderSettingsModal`) |
| Server config endpoints | `server.js` (`/api/jira/config`, `/api/integrations/*`) |
| Token store / config sync | `integrations/integrationsStore.js`, `integrations/integrationsSync.js` |
| HTML host | `index.html` (`#section-integrations`) |

## 17. Сканнер команд (содержит подвкладки)

| Что | Файлы |
|---|---|
| Orchestrator | `integrations/teamScanner2.js` (~2700 строк) |
| Renderer (god-module) | `integrations/teamScanner2Renderer.js` (~5300 строк) |
| Enrichment + classify | `integrations/teamScanner2Enrichment.js` |
| Diagnostic + safe export | `integrations/teamScanner2Diagnostic.js` |
| Classifier (single source) | `integrations/teamScanner2Classifier.js` |
| Per-team config + thresholds | `integrations/teamScanner2Config.js` |
| Multi-day history | `integrations/teamScanner2History.js` |
| Insights (rule-based briefs) | `integrations/teamScanner2Insights.js` |
| Person-level metrics | `integrations/teamScanner2PersonMetrics.js` |
| Per-user prefs | `integrations/teamScanner2Prefs.js` |
| Demo fixture | `integrations/teamScanner2DemoFixture.js` |
| Telemetry | `integrations/telemetry.js` |
| Server-side fetchers | `server.js` (`ppFetchBitbucketActivity`, `ppFetchConfluenceActivity`, `ppFetchZephyrActivity`, `ppFetchSprintCommitVsDelivery`, etc.) |
| Pulse pipeline (V19 D3 facade) | `integrations/portfolioPulseModel.js` (~1900), `integrations/portfolioPulse.js`, `pulse/index.js`, `portfolioPulseApi.js`, `portfolioPulseBacklog.js`, `portfolioPulseInsights.js`, `portfolioPulseMetrics.js`, `portfolioPulseRenderer.js`, `portfolioPulseUtils.js` |
| Подвкладки (внутри Сканнера) | Glance / Today-pane / Operations / Trends / Sleeping data — внутри `teamScanner2Renderer.js`. **«Метрики» внутри Сканнера** — отдельная sub-tab, см. этап 11. |

## 18. Чёрный дашборд

| Что | Файлы |
|---|---|
| Main entry | `integrations/blackDashboard.js` |
| API client | `integrations/blackDashboardApi.js` |
| Model | `integrations/blackDashboardModel.js` |
| Renderer | `integrations/blackDashboardRenderer.js` |
| Tech Info (соседняя интеграция) | `integrations/techInfo.js`, `integrations/techInfoApi.js`, `integrations/techInfoRenderer.js` |
| Sigma Jira config | `server.js` (`/api/integrations/sigma-*`, `sigmaJiraBaseUrl`/`sigmaJiraToken`/`sigmaGoalEpicKeys`) |

---

## Общее (shared / infra)

| Категория | Файлы |
|---|---|
| **Orchestrator + bootstrap** | `app.js` (~2100 строк), `app/init.js`, `launch.js`, `start.sh` |
| **State (Proxy reactive)** | `state.js`, `reactiveStore.js` |
| **Persistence** | `dataStore.js` (~1800), `appDataStore.js`, `sqliteStore.js` |
| **Filtering** | `filters.js` |
| **Constants / config** | `constants.js`, `globals.d.ts`, `types.js`, `tsconfig.json`, `package.json` |
| **Utilities** | `utils.js` (~860), `app/icons.js`, `app/uxKit.js` |
| **Domain engines** | `metricsEngine.js`, `riskEngine.js`, `insightEngine.js`, `dependencyEngine.js` |
| **Logging** | `historyLog.js`, `errorsLog.js`, `server/logger.js` |
| **App settings + nav** | `app/appSettings.js`, `app/nav.js`, `app/storageSettings.js`, `app/uiToggles.js`, `app/historyManager.js`, `app/migrations.js` |
| **App-level UI helpers** | `app/prizmaUI.js`, `app/promptsEditor.js`, `app/bulkEditPanel.js` |
| **Themes / styles** | `theme.css`, `styles.css` (~20k LOC), `obsidian/obsidian.css` |
| **HTML shell** | `index.html` (~1.7k LOC) |
| **Server** | `server.js` (~6.5k LOC), `server/integrations/*` |
| **Vendored libs** | `libs/xlsx.full.min.js` (~930 KB), `libs/sql-wasm.{js,wasm}` (~50+660 KB), `libs/safeHtml.js`, `libs/echarts.esm.min.js` |
| **LLM чат** | `chat/chatActions.js`, `chatActivityHandler.js`, `chatActivityIntents.js`, `chatActivityPrompts.js`, `chatAlerts.js`, `chatContextBuilder.js`, `chatEngine.js`, `chatExplain.js`, `chatIntentParser.js`, `chatPrompts.js`, `chatReports.js`, `chatTemplates.js`, `chatUIRenderer.js` (13 файлов в `chat/`) + `app/llmAssistant.js` (orchestrator) |
| **Маскот** | `obsidian/obsidian-sprite.svg`, `obsidian/obsidian.css`, `app/obsidianMascot.js` |
| **Onboarding (тур)** | `onboarding/onboarding.js`, `onboarding/onboardingUI.js`, `onboarding/demoData.js`, `app/onboarding.js` |
| **Components (re-usable)** | `components/multiselect.js`, `components/tagInput.js` |
| **Modules** | `modules/csv-stream-exporter.js`, `modules/history.js` |
| **Tests** | `tests/unit/*.test.js`, `tests/contract/*.test.js`, `e2eTest.js`, `testRunner.js` |
| **CI / lint / scripts** | `eslint.config.js`, `eslint-rules/`, `scripts/perfBudget.js`, `.github/`, `.gitlab-ci.yml` |
| **Docs (read-only ADR)** | `docs/`, `audit-2026-05-*` (5 архивных папок V17/V18/V21-tabs/05-04/mascot-chat) |
| **Brand book (отдельный пакет)** | `my_prisma-brand/` — symlink или copy в проект, brandbook + sprite |

---

## Кросс-разрезные подсистемы (shared by multiple sections)

| Подсистема | Используется в | Файлы |
|---|---|---|
| **Reactive state proxy** | все views | `state.js`, `reactiveStore.js` |
| **FilterEngine** | Дашборд, Реестр, Гант, Канбан, Таймлайн, Сотрудники, Метрики, Подложка, История | `filters.js` |
| **Storage (localStorage + SQLite-WASM opt-in)** | все sections, persists `state.*` | `dataStore.js`, `sqliteStore.js`, `appDataStore.js` |
| **AppSettings (visibility, order, debug)** | sidebar, topbar, все sections | `app/appSettings.js`, `app/nav.js` |
| **Маскот (FAB + chat avatar + per-message + tour + toast)** | глобально через `#obsidian-fab-mascot`, чат, тур, тосты, splash | `app/obsidianMascot.js`, `obsidian/`, `chat/chatUIRenderer.js` (per-message), `onboarding/onboardingUI.js` (tour), `app/uxKit.js` (toast) |
| **LLM-чат (FAB-overlay)** | глобально, контекст from active section | `app/llmAssistant.js` + 13 файлов `chat/` |
| **Identity (Jira/BB/CF/Zephyr/Jenkins)** | Сканнер, Pulse, Black Dashboard | `integrations/integrationsSync.js`, `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId, jenkinsUserId}` |
| **CSV / XLSX export** | Реестр, Гант, Сотрудники, Метрики, Сканнер | `dataStore.js` (`CSV._scrubSecrets`), `libs/xlsx.full.min.js`, `modules/csv-stream-exporter.js` |
| **HistoryLog (action log)** | глобально (audit trail) | `historyLog.js`, view `views/history.js` |
| **ErrorsLog** | глобально (silent-error sink) | `errorsLog.js`, view `views/errorsView.js` |
| **Telemetry (client-side events)** | Сканнер, Маскот, Чат, AI | `integrations/telemetry.js` (sender → server `/api/telemetry`) |
| **Server logger (NDJSON, PII-scrub)** | server-side, во всех integration-fetcher'ах | `server/logger.js` |
| **Onboarding tour + demo data** | глобально (первый запуск, demo mode) | `onboarding/`, `app/onboarding.js`, `integrations/teamScanner2DemoFixture.js` |

---

## Допущения и неоднозначности

| # | Допущение | Если неверно |
|---|---|---|
| 1 | «Подложка» (`podlozhka`) — это feature in-flight (debug-only по `_DEBUG_ONLY_SECTIONS` в `appSettings.js:256`), не входит в 18 разделов. | Если она нужна — добавить как раздел №19. |
| 2 | «Метрики» (раздел №2 в твоём списке) и «Метрики» внутри Сканнера команд (этап 11) — **разные сущности**. №2 это `views/metrics.js` поверх state.rows, в Сканнере — sub-tab по participants. | Если задумывалась единая — это дубль, которого надо избежать (см. этап 11 сам). |
| 3 | «AI Анализ» (раздел №13) объединяет 13 блоков в одном `aiView.js` (`#section-ai`). «AI CEO» (10) и «CEO-режим» (11) — отдельные sections, хотя визуально близки. | Если они должны быть одной секцией — отдельная находка для этапа 14 (HOLISTIC). |
| 4 | «Действия» (`actions`) — отдельная section с action-плагинами; `app/actionLayer.js` — вероятно её orchestrator. Не путать с action-chips в чате. | Если это просто chat-actions wrapper — пометить в HOLISTIC. |
| 5 | «Документация» = «Документация: долги» (`doc-debt`) — про CF stale pages + ping owners (см. `teamHealthDashboards.js:14`). НЕ про продуктовую документацию (CLAUDE.md и т.п.). | Если user имел в виду project docs — нужен отдельный раздел или это ошибка scope. |
| 6 | «Чёрный дашборд» (раздел №18) — это **не отдельная top-level section**, а **sub-tab внутри `#section-integrations`** через `integrations/blackDashboard.js`. | Если задумывалась как отдельный пункт sidebar — нужно вынести (см. этап 4 для арт-дирекшна и этап 14 для HOLISTIC). |
| 7 | `onboarding/`, `obsidian/`, `chat/`, `ai/` — относятся к «Общему», не привязаны к одной section. Маскот рендерится глобально, чат — FAB overlay через global. | OK, чёткое разделение. |
| 8 | `libs/echarts.esm.min.js` — используется только Метрики Deep View (внутри сканнера), не вспомнил topology. Lazy-load через `await import()` ([views/metricsDeep/index.js:94](prisma_new_design_v2/views/metricsDeep/index.js:94)). | OK |

---

## Проверочный чек-лист (как использовать карту в других этапах)

Каждая команда в этапах 1-9 должна:
1. Пройтись по всем 18 разделам (не пропускать «маленькие» как Подложка / История).
2. Использовать `views/teamHealthDashboards.js` для разделов 8-9 + 14-15 (это один файл, 4 view).
3. Использовать `integrations/teamScanner2*` для раздела 17 (12 файлов в семействе).
4. Чёрный дашборд (18) — внутри Интеграций, отдельный feature; не дублировать находки с Сканнером.
5. AI-разделы (10, 11, 13) — все используют `ai/llmClient.js` + `chat/`-инфраструктуру.

В блоке **«Общее»** в каждом этапе фиксировать находки которые касаются shared-кода.
В блоке **«Кросс-разрезные»** — то же самое для подсистем из последней таблицы выше.

---

*Сгенерировано Этапом 0. Готовность: команда подтверждает что 18 разделов покрыты + общее + кросс-разрезные. Можно запускать Этапы 1-14.*
