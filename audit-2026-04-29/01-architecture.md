# 01. Архитектура

## Соответствие ARCHITECTURE.md

`ARCHITECTURE.md` описывает (V11): vanilla ES modules + Node server + 7 layers. Реальность V12 в основном совпадает, но есть расхождения:

| Заявлено | Факт | Расхождение |
|---|---|---|
| `server.js` ~1100 LOC | `server.js` **2612 LOC** | в 2.4× больше — добавились sigma + black-dashboard + tech-info + dev-status |
| `app.js` после декомпозиции | `app.js` **2148 LOC** | всё ещё гигантский, декомпозиция 50% завершена |
| 13-блочный AI Analysis | 13 блоков подтверждены в `ai/aiCeoFallback.js` (computeCeoMetrics → 7 функций × ~70 LOC) | OK |
| Reactive store (audit #6) | реализован в `reactiveStore.js`, активен | подтверждено — но workaround'ы вокруг него (см. ниже) |
| `node:test` встроенный | используется в `tests/unit/*.test.js` | новое в V11/V12, не упомянуто в ARCHITECTURE.md |
| Black Dashboard | работает (`integrations/blackDashboard*.js`) | не упомянут в ARCHITECTURE.md |
| Tech-info modal | работает (`integrations/techInfo*.js`) | не упомянут |

**Вывод**: ARCHITECTURE.md устарел минимум на 2 фичи (Black Dashboard, Tech Info) и не отражает актуальные размеры. Стоит обновить.

## Размеры модулей — топ-20

```
   2612 ./server.js
   2148 ./app.js
   1366 ./integrations/portfolioPulseRenderer.js
   1100 ./views/gantt.js
    908 ./testRunner.js          # tests, отдельная категория
    886 ./dataStore.js
    851 ./views/metrics.js
    829 ./app/llmAssistant.js
    823 ./integrations/portfolioPulseModel.js
    822 ./views/registry.js
    699 ./chat/chatEngine.js
    653 ./ai/aiCeoFallback.js
    617 ./integrations/techInfoRenderer.js
    575 ./views/integrationsView.js
    551 ./sqliteStore.js
    547 ./chat/chatIntentParser.js
    527 ./ai/aiFallbackEngine.js
    494 ./integrations/integrationsRenderer.js
    446 ./ai/aiCeoRenderer.js
    411 ./chat/chatActions.js
```

**Подозрительно большие** (>1000 LOC):
1. `server.js` 2612 — God-server. Делать ли модули `server/jiraApi.js`, `server/integrationsApi.js`, `server/staticServe.js`? Сейчас всё в одном файле + private helpers без экспорта.
2. `app.js` 2148 — God-app. Декомпозиция приостановилась: остались `Storage`, `StorageSettings`, `PromptsEditor`, `Nav`, `App`, `AppSettings` — всё ещё inline.
3. `integrations/portfolioPulseRenderer.js` 1366 — мега-renderer. 5 tabs × per-tab logic + 12 атомов + diagnostics + how-modal. Можно разнести на `pp-renderer-{teams,summary,sprints,insights,metrics,backlog}.js`.
4. `views/gantt.js` 1100 — content + Gantt-V2 в одном файле.

## Слои зависимостей

Объявлено в ARCHITECTURE.md (упрощённо):
```
constants.js → state.js → utils.js → rowFactory.js → engines (risk/filter/metrics/dependency)
                                  ↘ dataStore.js → views/*
                                                  ↘ app.js
```

**Найденные нарушения**:

1. **`reactiveStore.js` импортируется из `app.js` ниже по level'у, но `dataStore.js` (lower) тоже его импортирует**:
   ```js
   // dataStore.js:12
   import { Reactive } from './reactiveStore.js';
   ```
   Это OK — `reactiveStore` — это infrastructure-level, не application. Но в ARCHITECTURE.md не описан.

2. **`appDataStore.js` импортирует `state.js`** (norm) и одновременно мутирует `state.rows` (`state.rows = SQLiteStore.getRows()` — appDataStore.js:154). Side-effect через нижний слой обратно в state. Архитектурно не катастрофа, но создаёт возможность гонок.

3. **`chat/chatTemplates.js` зависит от `state` И от `window.FilterEngine`** (chatTemplates.js:13). Это смесь module import + window-global. Грязно.

4. **`integrations/portfolioPulse.js` импортирует `integrationsStore`** — нижний пакет читает из верхнего:
   ```js
   // integrations/portfolioPulse.js:12
   import { loadSettingsRaw } from './integrationsStore.js';
   ```
   Это OK по структуре (тот же пакет), но нет чёткой границы что во `integrations/` следует чему.

## Циклические импорты

```bash
$ for f in app.js dataStore.js state.js utils.js; do
    grep "^import" $f | grep -oE "'\./[^']+'" 
  done
```

Проверил вручную — циклов нет. Но **module-load-time side effects** есть:
- `reactiveStore.js:145` — `if (window) window.Reactive = Reactive` — вешается при загрузке.
- `app.js:2074-2088` — присвоения `window.X` в нескольких местах.
- `integrations/portfolioPulse.js:287` — то же.

Это не циклы, но явный module-load-time IO. Замедляет hot-reload, усложняет тестирование (state shared между тестами).

## Дублирование логики

### Парсинг дат
- `Utils.parseDateish` (`utils.js:57-69`) — RU dd.mm.yyyy + ISO + Date()
- `_zephyrResultFromStatus` (`portfolioPulseModel.js:469-475`) — другой парсер для test status
- `_parseDomainLink` (`server.js:1700+`) — issue keys из строки/массива
- `Utils.parseJiraLinks` (`utils.js:170-188`) — `https://.../browse/KEY-123`

Не одно и то же, но похоже. Архитектурно — каждый по-своему.

### Ссылки на Jira
- `renderIssueRow` (`portfolioPulseRenderer.js:62`) — `<a href="${baseUrl}/browse/${key}">`
- `renderJiraBlock` (`integrations/integrationsRenderer.js:185+`) — то же
- `renderTechInfoModal` (`techInfoRenderer.js`) — то же

Три места строят `${jiraBaseUrl}/browse/${key}` руками. Стоит вынести в `utils.js → Utils.jiraIssueUrl(baseUrl, key)`.

### Bitbucket repo expansion
- `ppFetchBitbucketActivity` (`server.js:704-728`) — single-segment → list of repos
- `ppFetchDevStatusForIssues` — отдельная логика
- Tech-info `_tiFetchBitbucket` — третья

Все три ходят к одному и тому же Stash, но независимо. Можно разделить на `_tiBbProjectsList`, `_tiBbRepos` и переиспользовать.

### `_ppMakeAuthHeader`
В `server.js:614` есть, в `_tiBitbucketGet` есть, в `_tiConfluenceGet` тоже использует — не дублируется на вид, но разные функции имеют свои локальные `auth = makeAuth(...)` constructions.

### Sort-by-date functions
Сортировки `String(b.at || '').localeCompare(String(a.at || ''))` встречаются в:
- `portfolioPulseModel.js:339-341` (×3 timeline)
- `portfolioPulseModel.js:482, 497` (bbItems, cfItems)
- `_ppMergeAuthorMaps` (`server.js:1101`)

Hopper для общего helper'а.

## `app.js` после декомпозиции

После прочтения 2148 строк, что в нём осталось:

| Объект/функция | Строки | Что делает | Можно вынести? |
|---|---|---|---|
| `StorageSettings` | 212-362 | Settings tab UI for storage mode | Да → `app/storageSettings.js` |
| `PromptsEditor` | 368-475 | Prompts editor UI | Да → `app/promptsEditor.js` (в FOUND_BUGS уже отмечено) |
| `App` orchestrator | 1369-2068 | Main bootstrap | Сложно вынести — оркестратор должен где-то жить |
| `Nav` | 778-801 | Section navigation | Да → `app/nav.js` |
| `AppSettings` | ~803-1370 | Settings modal | Гигант — стоит разбить на `app/settings/` (theme/sections/llm/storage/...) |
| `BulkEditPanel` | (после) | Bulk edit | Да → `app/bulkEdit.js` |
| `subscribe(reason => ...)` | 2071-2082 | Notify→refresh handler | Inline OK |
| `Reactive.subscribe(() => ...)` | 2090-2114 | Auto-flush handler | Inline OK |
| `DOMContentLoaded` | 2099-2105 | Bootstrap entry | Inline OK |

**Итого**: можно ужать `app.js` до ~700 LOC, вынеся StorageSettings + PromptsEditor + Nav + AppSettings (последнее — большая работа).

## Window globals — список

```
window.AppDataStore     (appDataStore.js:178)
window.Reactive         (reactiveStore.js:145)
window.SQLiteStore      (sqliteStore.js:551)
window.App              (app.js:2074)
window.LLMAssistant     (app.js:2075, app/llmAssistant.js:829 — двойное!)
window.PromptsEditor    (app.js:2079)  
window.HistoryManager   (app.js:2080, app/historyManager.js:148 — двойное!)
window.AppSettings      (app.js:2083)
window.Onboarding       (app.js:2084, app/onboarding.js:90 — двойное!)
window.ThemeUI          (app.js:2085)
window.RegistryView     (app.js:2086)
window.BulkEditPanel    (app.js:2087)
window.ActionLayer      (app.js:2088, app/actionLayer.js:196 — двойное!)
window.IntegrationsLoadSettings  (views/integrationsView.js:572)
window.IntegrationsRenderModal   (views/integrationsView.js:573)
window.IntegrationsBindModal     (views/integrationsView.js:574)
window.BlackDashboard            (integrations/blackDashboard.js:154)
window.PortfolioPulse            (integrations/portfolioPulse.js:287)
window.TechInfo                  (integrations/techInfo.js:193)
window.HistoryView               (views/history.js:210)
```

**~20 globals**. Двойные присвоения (`HistoryManager`, `LLMAssistant`, `Onboarding`, `ActionLayer`) — оба сами себя ставят И app.js повторяет. Race не страшен (одно значение оба раза), но это redundant.

**Управляемость**: умеренная. Есть pattern, но не задокументирован. Хорошо бы:
- Один файл `app/globals.js` с `Object.assign(window, {...})` — чтобы было видно сразу всё.
- Или `console.log(Object.keys(window).filter(k => k[0] === k[0].toUpperCase()))` для self-check.

## Заключение

Архитектура | Оценка
---|---
Слои | хорошо — нарушений нет, но lower-layer mutates state through globals местами
Размеры модулей | удовлетворительно — 4 файла >1000 LOC, server.js 2612 особенно проблемно
Дублирование | удовлетворительно — несколько повторяющихся паттернов, можно вынести в utils
Window globals | удовлетворительно — управляемо, но 20 глобалов пугают
Циклы | хорошо — нет
ARCHITECTURE.md | плохо — устарел на 2 фичи, размеры расходятся, не отражает V12
