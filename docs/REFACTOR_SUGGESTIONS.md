# Предложения по рефакторингу

Места, которые тяжело тестировать из-за архитектуры. **НЕ РЕФАКТОРЮ САМ** — фиксирую для разбора.

---

## 1. `testRunner.js` дублирует логику реальных модулей inline

**Файлы**: `testRunner.js` строки 30-168 vs `riskEngine.js` / `filters.js` / `metricsEngine.js`

`testRunner.js` написан как CommonJS и не может статично импортить ESM-модули, поэтому копирует туда `RiskEngine`, `applyFilters`, `computeProgress` etc inline. Любая правка в реальном файле **не отразится** на тестах — они проверяют копию.

**Симптом**: 104 зелёных теста при сломанной реальной реализации.

**Предложение**: переписать `testRunner.js` либо на `node:test` (как новые тесты в `tests/`), либо на dynamic-import-обёртки. Параллельно — мигрировать существующие группы (RiskEngine, FilterEngine, MetricsEngine) в `tests/unit/`. После миграции inline-mirrors выкинуть.

**Объём**: ~300 LOC для миграции, можно делать постепенно.

---

## 2. Время не инжектируется — `Date.now()` зашит везде

**Файлы**: `integrations/portfolioPulseModel.js`, `integrations/portfolioPulseRenderer.js`, многие места.

`analysePulse` вызывает `todayStart()` / `yesterdayStart()` / `Date.now()` напрямую. Чтобы тестировать time-bucketing, мы заменяем `globalThis.Date` (см. `tests/helpers/timeFreeze.js`) — это работает, но хрупко.

**Предложение**: завести единый источник `clock.now()` в `utils.js` или передавать `clock` через `analysePulse(raw, { clock })`. По умолчанию реальный — в тестах подменяемый. Тогда time-freeze исчезнет.

**Severity**: средняя. Основная боль — параллельные time-зависимые тесты конфликтуют через mutable `globalThis.Date`.

---

## 3. `analysePulse` — God-функция (250 LOC, 8 циклов внутри)

**Файл**: `integrations/portfolioPulseModel.js:35-300`

Один большой цикл по всем reports делает: классификацию issues, обход changelog, comments, worklog, агрегацию summary, hydrate badges. Это всё пишется через mutable `out`, что ломает читаемость и тестируемость отдельных частей.

**Предложение**: разнести на чистые подфункции:
- `classifyIssue(issue, sprintKeys, backlogKeys)` → `{slim, terminal, initial}`
- `walkChangelog(issue, slim, ensureUser, windows)` → events[]
- `walkComments(issue, slim, ensureUser, windows)` → events[]
- `walkWorklog(issue, slim, ensureUser, windows)` → seconds map
- `hydrateBadges(participants, bbAuthors, cfAuthors)`
- `computeSummary(spaces, participants)`

Каждую можно тестировать отдельно. Сейчас приходится проходить полный pipeline ради проверки одного шага.

---

## 4. `userKey` нестабилен через границы Jira/Bitbucket/Confluence

**Файл**: `integrations/portfolioPulseUtils.js:72-75`

`userKey` берёт первое непустое из `accountId/key/name/emailAddress/displayName` — но Jira отдаёт разный набор полей для assignee (с email) и changelog.author (без email). Один человек получает два разных ключа → дубль в `participants` (FOUND_BUGS.md #2).

**Предложение**: добавить второй ключ-нормализатор `nameKey(u)` = lowercased displayName, и держать карту `nameKey → primaryKey`. При первом обращении к displayName, если уже есть participant с тем же nameKey, переиспользовать его.

---

## 5. Renderer/Orchestrator имеет module-scope мутируемое состояние (`_renderCtx`)

**Файл**: `integrations/portfolioPulseRenderer.js:30-37`

`setRenderContext({jiraBaseUrl})` выставляет module-local state, который читается из `renderIssueRow` неявно. В тестах это значит, что параллельный запуск двух тестов рендера может дать гонку.

**Предложение**: либо протащить `ctx` через все вызовы рендера (`renderIssueRow(it, {ctx})`), либо обернуть renderer в фабрику — `createRenderer({jiraBaseUrl}) → {renderIssueRow, renderTeamsTab, ...}`. Второй вариант лучше — выглядит как «инстанс рендерера», без глобального state.

---

## 6. `PromptsEditor` живёт в `app.js` как const, доступен через `window.*`

**Файл**: `app.js:368`, `app/llmAssistant.js:527`

Декомпозиция `app.js` по модулям приостановилась на полпути: `PromptsEditor` остался внутри. Чтобы `llmAssistant.js` (отдельный модуль) до него достал, пришлось вешать на `window` (FOUND_BUGS.md #5). Это анти-паттерн.

**Предложение**: вынести `PromptsEditor` в `app/promptsEditor.js`, импортить явно. Заодно вынести `StorageSettings`, `AppSettings` и прочие inline-объекты — их в `app.js` ещё много.

---

## 7. CSV-импорт не делает `Storage.flushNow()` — возможна потеря данных

**Файл**: `dataStore.js:308`, `Storage.save()` 19-52

После CSV-импорта `Storage.save()` ставит 400 ms таймер. Быстрый F5 = потеря (FOUND_BUGS.md #6).

**Предложение**: добавить `Storage.flushNow()` (синхронный, читает текущий timer и форсирует setItem). Вызывать его в конце CSV/XLSX-импорта.

---

## 8. Нет инжекции HTTP-клиента — server.js в тестах требует реального fetch

**Файл**: `server.js`, функции `jiraForward`, `jiraRequest`

Сервер делает реальные HTTP-запросы через `https.request` напрямую. Чтобы протестировать (как в `contractTest.js`), приходится поднимать fake-сервер на localhost. Это работает, но медленно — каждый contract-test = boot Node-процесса + http-сервера.

**Предложение**: вынести `httpClient` как dependency: `jiraForward(opts, { httpClient = realHttpClient }) → Promise`. В тестах подсовывать мок — будет в 100 раз быстрее и избавит от port-conflict-ов.

---

## 9. Глобальный `state` без очистки между тестами

**Файл**: `state.js`

`state` — экспортированный module-singleton. Если тест мутирует `state.rows`, следующий тест видит мусор. В `testRunner.js` это «обходится» порядком тестов, но в параллельных тестах через `node:test` сломается.

**Предложение**: ввести `createState()` фабрику, в `state.js` экспортить только дефолтный экземпляр. В тестах создавать свежий `createState()` для каждого случая.

---

## 10. Внутри `chat/chatEngine.js` есть прямые вызовы `fetch()` к LLM

**Файл**: `chat/chatEngine.js` (предположительно — TBD после изучения)

LLM-вызовы должны мокаться в тестах. Если сейчас нет инжекции — придётся либо обернуть в clientFactory, либо stubить `globalThis.fetch`. Второе работает, но у нас тогда тесты shared global.

**Предложение** (после изучения): передавать `llmClient` как параметр `processChat(msg, {llmClient})`, в реальной жизни — реальный, в тестах — мок.

---

*Файл генерируется автоматически в процессе написания тестов. Каждая запись отражает реальный пейн при попытке тестировать.*
