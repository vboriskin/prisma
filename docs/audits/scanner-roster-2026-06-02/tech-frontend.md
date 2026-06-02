# Аудит таблицы сотрудников: технический долг (vanilla JS, ~90k LOC)

**Эксперт:** Senior front-end / архитектор vanilla JS (no-bundler ES modules)
**Дата:** 2026-06-02

## Резюме

Roster + detail panel технически работают, но архитектурно начинают расходиться. `teamScanner2.js` (4 171 LOC) — God Object: orchestrator + state + DOM-binding + 13 модальных диалогов + LLM-кэш + audit-queue в одном объекте. Внутри есть как минимум **четыре** места, где классификационная логика «stop/watch/moving/idle» либо продублирована руками (`_extractSnapshot` строки 386-409), либо размазана по фильтрам и нарративам (`renderTeamGlance`, `renderEmployeeDetailPanel`, brief-export). PersonRows / Renderer / Hero делят общий visual-vocabulary (`srcChip`, бэйджи, dot-strip), но каждый рендер строит chips по своему стайл-гайду, потому что extract'ы (May-12 «Tier 0 phase 4/5») не были доведены до конца — общим оказался только `RendererCommon.js`. WeakMap-кэш classifier работает корректно, но требует ручной координации через `bumpClassifyEpoch()` из двух разных мест в orchestrator'е, и инвариант «epoch bumped before render» нигде не enforced. `_bindEvents` живёт в render-pipeline вместо EventBus/delegation, поэтому каждый refresh переcоздаёт ~50+ листенеров и блокирует возможность partial render. DOMParser в брифе — не баг, но симптом отсутствия «component → data» серилизации.

## Где это в коде (быстрая карта)

| Файл | LOC | Что делает | Архитектурная роль |
|---|---|---|---|
| `teamScanner2.js` | 4 171 | orchestrator | God Object: state + lifecycle + binding + modals |
| `teamScanner2Renderer.js` | 2 364 | renderer (panel + general) | Mix renderer + classifier re-export + `_classifyPerson` indirection |
| `teamScanner2RendererHero.js` | 1 462 | hero / topbar / sprint | Cyclic import с main renderer (`getScannerTab`) |
| `teamScanner2RendererPersonRows.js` | 313 | roster rows | Чистый — изолирован, но дублирует подсчёты медиан |
| `teamScanner2RendererCommon.js` | 249 | shared util | Mutable state на module-level (`_renderContext`) |
| `teamScanner2Classifier.js` | 118 | classifier + WeakMap cache | Хороший pattern, но недо-применён |
| `teamScanner2Insights.js` | 1 192 | производные сигналы | Импортируется и из renderer'а, и из orchestrator'а |
| `teamScanner2BriefExport.js`/`V2.js` | 895 + 1 403 | standalone HTML | DOMParser над выхлопом renderer'а — пирамида подгонок |

## Находки

### 1. Inline-копия classifier в `_extractSnapshot` — нарушение Single Source of Truth, документированное в коде

**Where:** `teamScanner2.js:386-409` (метод `_extractSnapshot`) + комментарий-предупреждение в `teamScanner2Classifier.js:5-12` дословно описывает этот сценарий (~«scnapshot day N classified как `idle`, day N+1 как `moving` без изменения данных, только из-за рассинхронизации»).

**Smell:** Duplicated business logic. В `_extractSnapshot` руками переписан `classifyPerson` ровно с тем же набором условий (`stuck > 0 && today === 0` etc.). Комментарий в `teamScanner2.js:389-390` это признаёт: «Reuse renderer's classifier import indirectly через direct count: делаем простой count здесь чтобы не тащить classifyPerson сюда». Это аргумент в пользу подключения, а не отказа.

**Refactor:** 
- Импортировать `classifyPerson` из `teamScanner2Classifier.js` напрямую в orchestrator (он уже импортирует `bumpClassifyEpoch` оттуда — circular dependency не появится).
- Заменить блок 391-409 на `for (const p of model.participants||[]) counts[classifyPerson(p)]++;`.
- Сохранится корректность снепшотов; bug-bait в виде «забыли обновить обе копии при добавлении сигнала» уходит.

**Критичность:** medium (latent — bug проявится только при добавлении нового сигнала в classifier).
**Сложность:** low (5-минут правка + один unit-test).
**Ценность:** high (превентивно закрывает целый класс рассинхронизации).

---

### 2. `teamScanner2.js` (4 171 LOC) — God Object: orchestrator + 13 модалок + кэши + audit queue

**Where:** `teamScanner2.js` целиком. См. `_bindDashboardEvents` (2117-2600), `_bindPanelEvents` (2604-2837), `_openConfigModal` (2976-3046), `_openDiagModal`, `_openDiagDisclaimer`, `_openHowModal`, `_openCrvDrilldownModal`, `_openAnomalyMiniChartModal`, `_openIdentityResolvePreview`, `_openVelocityCompareModal`, `_runIdentityResolve`, `_runBulkIdentityResolve`, `_bindBbAuthorToEmployee`, `_assistantCache` + `_runAssistantFetch` + `_renderAssistantBlock` + `_fillAssistantBlocks`, `_enqueueServerAudit` + `_flushServerAuditQueue`.

**Smell:** Single-Responsibility violation. Один объект отвечает за state, lifecycle (attach/paint/detach), data fetching, кэширование снепшотов, identity-resolve flow, LLM-кэш + abort, audit queue, и хост 13 модалок. Нет ни одного `extract` теста, который мог бы быть запущен в node-test без эмуляции DOM/localStorage/IntersectionObserver.

**Refactor:**
- Выделить `TeamScanner2Modals.js` (открытие/закрытие, focus-trap, синхронизация `body.is-ts2-modal-open`). Это снимет ~700-800 LOC.
- Выделить `TeamScanner2AssistantController.js` (cache + inflight + fetch + render block — 2838-2947). Самодостаточный модуль с инжектируемым `_llmGenerateSummary`. Снимет ~200 LOC + сделает LLM-сводку юнит-тестируемой.
- Выделить `TeamScanner2AuditQueue.js` (`_enqueueServerAudit`, `_flushServerAuditQueue`, _AUDIT_QUEUE_KEY). Снимет 120 LOC + ставит чёткий контракт.
- Выделить `TeamScanner2Snapshot.js` (`_extractSnapshot`, `_readPrevSnapshot`, `_saveSnapshot`, `_compactSnapshotForStorage`, `_cleanupStaleSnapshots`). ~250 LOC.
- Останется ядро (~2 000 LOC) — render-loop + lifecycle + binding. Уже руководимо.

**Критичность:** medium (никаких bug'ов, но `git blame` каждый раз — катастрофа; новый dev ничего не поймёт без 2-3 часов чтения).
**Сложность:** medium (механика рефакторинга, но без semantic-changes — много граничных случаев `this.`).
**Ценность:** high (плата за разработку каждой следующей фичи прямо здесь).

---

### 3. WeakMap-кэш classifier'a держится на ручной координации `bumpClassifyEpoch` — fragile invariant

**Where:** `teamScanner2Classifier.js:59-65` (WeakMap + epoch). `teamScanner2.js:888` (refresh) + `teamScanner2.js:1767` (`_renderFull`). Только эти два места обязаны вызвать `bumpClassifyEpoch()`, и контракт нигде не enforced — только в комментариях.

**Smell:** Implicit invariant + hidden coupling. Если кто-то напишет новую точку рендера (например, новый export-path) и забудет bump — получит cached `value` для нового participant'а с теми же объектами (которые могут жить между сессиями через snapshot-restore). Comment в classifier'е уже подразумевает осведомлённость: «Между рендерами participant-объекты могут жить (cache hit при re-render без refresh)».

**Refactor:**
- Сделать epoch автоматическим: cache invalidation по identity модели (`model.fetchedAt`). API: `classifyPerson(p, model)` где `model.fetchedAt` ставит epoch для cache-key. Нет необходимости в side-effect функции.
- Альтернатива: вместо WeakMap — расставить `_classifyResult` non-enumerable property на participant'е (как уже делается для `_v20s8_metricsMemo` в enrichment). Тогда cache живёт ровно столько, сколько живёт participant. Bonus: можно сериализовать классификацию в snapshot, тогда `_extractSnapshot` (см. находку #1) станет тривиальным `p._classify || classifyPerson(p)`.
- Минимальная компенсация: явно throw'ить в dev-mode если detected stale cache (epoch unchanged after model.fetchedAt changed).

**Критичность:** medium (latent — currently bug-free, но при добавлении нового рендер-сайта легко регрессирует).
**Сложность:** low.
**Ценность:** medium.

---

### 4. PersonRows / Hero / Renderer-panel считают одно и то же по своим формулам — рассинхронизация source-chips

**Where:**
- `teamScanner2RendererPersonRows.js:222-230` — `srcChip(label, n, cls, titleOverride)` + `srcChips` композиция: формирует `<span class="ts2-row-src-chip ts2-row-src-${cls}">…`.
- `teamScanner2Renderer.js:1914-1925` — `renderSrcBadge(src, kind)` для events feed: формирует `<span class="ts2-recent-src ts2-recent-${m.cls}">…`. Совершенно другой DOM, тот же набор «J/B/C/Zc/Ze».
- `teamScanner2RendererHero.js` aggregates `commits48h/prs48h/conf48h/testsCreated48h/testsExecuted48h` (635-647) — снова руками, без `SRC_KEYS`.

**Smell:** Parallel hierarchies / shotgun surgery. При добавлении 6-го источника (Jenkins-pipelines уже на горизонте — есть `J⚠` chip с warn) надо править минимум три места, и каждый раз — по разным регулярным выражениям. Тест на «5 источников везде согласованы» отсутствует.

**Refactor:**
- Превратить `SRC_KEYS`/`SRC_LABELS`/`SRC_NAMES` (PersonRows строки 24-26) в единый registry `Sources.js` с объектом-описанием `{ key, label, name, color, perPersonCounter: p => …, eventBadge: kind => … }`.
- Заменить три варианта src-chip / src-badge / aggregation на `Sources.forEach(s => …)` + одну функцию рендера.
- Параллельно: `renderEventsFeed` (1691-1751) сейчас делает switch-block по `src`. Это та же таблица. Вынести в Sources registry с pluggable `renderEvent(e)` per-source.

**Критичность:** medium.
**Сложность:** medium (4-6 часов аккуратной работы + visual smoke tests).
**Ценность:** high (любая будущая source-integration делается за 1 правку вместо 4-5).

---

### 5. `_bindEvents` рекомпилирует ~50+ листенеров на каждый `_renderFull` вместо event-delegation

**Where:** `teamScanner2.js:2112` (`_bindEvents`) → `_bindDashboardEvents` (2117-2600) + `_bindPanelEvents` (2604-2837). Каждый блок — серия `root.querySelector(...).addEventListener(...)` / `querySelectorAll(...).forEach(btn => btn.addEventListener(...))`. На refresh всё `_container.innerHTML = html` (1893), листенеры на старых nodes мертвеют, новые подписываются заново.

**Smell:** Premature DOM-mutation, ручное re-binding после каждого render'а вместо event-delegation. Поощряет paste-pattern «забыл подписаться → починю в _bindDashboardEvents». Делает trace-trough-flow трудным: чтобы понять, что делает click на row, читаешь 4 файла.

**Refactor:**
- Один listener на `_container` с `event.target.closest('[data-action]')` диспатчем по `data-action` атрибутам. Сейчас уже есть прецеденты (`data-jump-group`, `data-jump-key`, `data-anomaly-metric`, `data-team-pk`) — продолжить.
- Конкретно для roster-row click → `data-action="open-person"` + `data-key="..."`. Listener мапится на `_openPanel(key)`. Сразу снимает ~200 LOC из `_bindDashboardEvents`.
- Re-render не требует re-binding. Bonus: можно делать partial re-render через targeted innerHTML без боязни сломать листенеры.
- Промежуточный шаг: registry `_actions = { 'open-person': this._openPanel, 'jump-group': this._jumpToGroup, … }` + один root.addEventListener.

**Критичность:** medium (никаких bug'ов, но perfromance regression на больших командах при частых refresh и memory leaks при забытом removeEventListener — см. find #6).
**Сложность:** medium-high (граничные случаи focus-management, focus-trap для модалок).
**Ценность:** high (структурно меняет траекторию проекта).

---

### 6. AbortController + leftover-listener pattern — фрагильность escHandler

**Where:** `teamScanner2.js:2611-2633` — `_bindPanelEvents` руками `removeEventListener(this._escHandler)` потом `addEventListener` нового handler'а; одновременно через `_getGlobalAbortSignal()` цепляет тот же handler к глобальному AbortController. Двойная подписка (если abort не сработал) или leftover handler (если remove не сработал).

**Smell:** Belt-and-suspenders без чёткого контракта, плюс two-way coupling state: `this._escHandler` хранится как property orchestrator'а, потому что remove'ить надо «вручную».

**Refactor:**
- Полностью отказаться от ручного `removeEventListener` — оставить только AbortController-based path. Контракт: «всё, что навешано в _bindPanelEvents живёт до следующего close»; у `_closePanel` есть свой AbortController, который abort'ится один раз.
- Идеально: при открытии panel создаётся local `panelAbort = new AbortController()`, всё навешивается с `signal: panelAbort.signal`. `_closePanel()` зовёт `panelAbort.abort()`. Никакой `this._escHandler` property не нужен.

**Критичность:** low.
**Сложность:** low.
**Ценность:** medium (упростит mental-model).

---

### 7. `setRenderContext` — module-level mutable state в `RendererCommon.js`

**Where:** `teamScanner2RendererCommon.js:174-178` — `let _renderContext = { jiraBaseUrl: '' };` + `setRenderContext`. Это global mutable variable shared between PersonRows / Hero / Renderer-panel. Устанавливается из `_renderFull` строка 1787.

**Smell:** Hidden dependency. `jiraIssueLink` неявно читает `_renderContext.jiraBaseUrl`; никакого indicator'а в сигнатуре. Race условия: если параллельно работают два контейнера (теоретически возможно, например multi-team-view внутри Pulse) — последний выигрывает.

**Refactor:**
- Передавать `ctx` через props (что и так делается в render-функциях, но не доходит до `jiraIssueLink`).
- Лёгкая версия: `jiraIssueLink(key, ctx)` + ctx-prop на каждой render-функции, drillthrough.
- Альтернатива: ContextProvider pattern — в `_renderFull` оборачиваем render в `withRenderContext(ctx, () => renderEverything(model))` (через try-finally стек).

**Критичность:** low (текущий проект singleton — race не реален).
**Сложность:** medium (тянет через ~20 функций).
**Ценность:** medium (testability — становится возможно мокать `jiraBaseUrl` в test'е).

---

### 8. `_classifyPerson` re-export через `as _classifyPerson` indirection в renderer.js

**Where:** `teamScanner2Renderer.js:308` — `import { classifyPerson as _classifyPerson, stuckListOf as _stuckListOf, statusOfPerson as _statusOfPerson } from './teamScanner2Classifier.js';` затем строки 313-315: `const stuckListOf = _stuckListOf;` + комментарий-объяснение. И строка 341: `export const classifyPerson = _classifyPerson;` — реэкспорт.

**Smell:** Indirection-without-purpose. После extract'а classifier'а в свой модуль, renderer всё ещё переэкспортирует его. Cargo-cult от пред-extract эпохи. Затрудняет поиск call-sites: ищешь `classifyPerson` → находишь и его настоящее определение, и три re-export'а, и `_classifyPerson` alias.

**Refactor:**
- Удалить alias и re-export. Все consumer'ы должны импортировать напрямую из `teamScanner2Classifier.js`.
- Проверить и обновить imports в `teamScanner2RendererHero.js`, `teamScanner2RendererPersonRows.js`, `teamScanner2Insights.js`, `teamScanner2History.js`, `teamScanner2Diagnostic.js`, `teamScanner2BriefExportV2.js` (они уже импортируют напрямую — но кто-то всё ещё дёргает через renderer).
- Заодно убрать символы из `teamScanner2.js:91-117` import-блока, которые там фигурируют, но используются только как re-export.

**Критичность:** low.
**Сложность:** low (грепнуть + удалить, плюс пробовать линт `no-restricted-imports`).
**Ценность:** low-medium (developer-experience).

---

### 9. DOMParser в брифе — симптом отсутствия «component → data → template» разделения

**Where:** `teamScanner2BriefExport.js:83-124` (`_buildPeopleSection`), `teamScanner2BriefExportV2.js:565-650` (~аналогично). Шаг: вызываем `renderPersonRows(model)` → парсим HTML обратно в DOM → дописываем `data-*` для sort/search → удаляем nodes по селекторам → перекладываем в новый wrapper.

**Smell:** «String → DOM → String» pipeline. Бриф фактически реверс-инжинирит renderer, чтобы извлечь данные, которые у него уже были. Это и есть классический сигнал «нужен renderer, который отдаёт сначала Model[], потом template над ним». Сейчас `renderRow` смешивает «возьми данные» и «нарисуй HTML» в один проход.

**Refactor:**
- Двухфазный renderer: `buildRowModel(p, ctx) → RowVM` + `renderRowVM(vm) → string`. PersonRows вызывает оба. Бриф вызывает только `buildRowModel` + свой template.
- Это убирает DOMParser, parser-fallback-если-undefined, и `_trimDetailForBrief` (137-163 в BriefExport) с его «удалить ts2-panel-head по селектору».
- Прикладной эффект: один patch enrichment-поля → автоматически прокатывается в live UI + бриф + brief V2 + потенциально PDF export.

**Критичность:** medium.
**Сложность:** medium (затрагивает PersonRows + два брифа).
**Ценность:** high (всё, что после rendering хочет работать с данными — тесты, screenshot diff, экспорт — выигрывает).

---

### 10. `_v20s8_metricsMemo` non-enumerable + `_classifyCache` WeakMap + `_detailCache` Map + `_assistantCache` Map + `_searchCache` Map — пять кэшей с разными контрактами инвалидации

**Where:**
- `teamScanner2Enrichment.js:444-461` — `_v20s8_metricsMemo` non-enumerable property с fingerprint`${model.fetchedAt}|${parts.length}|${dwellHours}|${fpThresholds}`.
- `teamScanner2Classifier.js:59` — `_classifyCache: WeakMap` + epoch.
- `teamScanner2.js:258` — `_detailCache: Map`, 5 мин TTL, max 20 entries.
- `teamScanner2.js:265-266` — `_assistantCache: Map`, `_assistantInflight: Map`. Очищается при refresh().
- `teamScanner2.js:169-202` — `_searchCache: Map` + `_searchCacheKey`, shape-hash invalidation.

**Smell:** Cache-zoo. Пять разных способов инвалидации (TTL / epoch / fingerprint / shape-hash / clear-on-refresh). Каждый написан руками; ни один не имеет единого «invalidate by predicate». Memory footprint мониторится только опосредованно (telemetry `scanner2.snapshot_quota_exceeded`).

**Refactor:**
- Минимальный шаг — централизовать через `CacheRegistry`: каждый кэш регистрируется с invalidation-key (`'modelFetchedAt'`, `'configFp'`, `'classifierEpoch'`, `'searchShape'`). Один method `CacheRegistry.invalidate('modelFetchedAt')` чистит все привязанные кэши.
- Документировать TTL и shape в одном месте (сейчас «cheat-sheet» в comment'е `teamScanner2.js:6-18` — но это не контракт, а напоминание).
- Идеально: общий debug-panel «Cache stats» в Diagnostic-modal: что есть, сколько entries, hit-rate.

**Критичность:** low.
**Сложность:** medium.
**Ценность:** medium (debuggability на длинных сессиях, где «странные данные» сейчас не воспроизводимы).

---

### 11. Cyclic import между Renderer.js и RendererHero.js — runtime-resolution через комментарий

**Where:** `teamScanner2RendererHero.js:52-58` — импортирует `_renderScannerTabBar`, `renderHygieneView`, `getScannerTab`, `renderHistoryTrendRow` из `teamScanner2Renderer.js`. Renderer.js, в свою очередь, импортирует `renderTopBar` и т.д. из Hero. Комментарий «Cyclic — main re-exports эти symbols к moment'у вызова уже определены» — признание в архитектурном долгу.

**Smell:** Circular dependency, замаскированный через late binding. Работает только потому, что cycles в ES-модулях резолвятся через export bindings + использование функций на runtime, а не на load. Опасно: импорт on top-level переменной (не функции) сразу даст `undefined`. И linter (eslint-plugin-import) сейчас всё равно ругается на это в `npm run lint`.

**Refactor:**
- Извлечь общий tab-bar logic в `teamScanner2TabBar.js` или в `teamScanner2RendererCommon.js`.
- `renderHygieneView` — отдельный self-contained модуль `teamScanner2RendererHygiene.js` (там и так уже папка `hygiene/`).
- После extract'а — circular dependency исчезает естественно.

**Критичность:** low-medium.
**Сложность:** medium (несколько moves + import-path updates).
**Ценность:** medium.

---

### 12. `localStorage.getItem` в hot path рендера + try/catch боксы

**Where:** Минимум 4 места в roster-render path:
- `teamScanner2RendererPersonRows.js:239-241` — `hideProductivity = localStorage.getItem('q2_scanner_hide_productivity')`. Каждый row.
- `teamScanner2Renderer.js:1260-1261` — `_showProductivityChips = localStorage.getItem('q2_scanner_show_productivity')`. Каждый раз renderPersonMetricsPanel.
- `teamScanner2.js:1853` / `1858` — `showBlocked`, `activeSprintOnly` reads в `_renderFull`.
- `teamScanner2.js:1983-1992` — `_readSelectedTeamFromStorage` с regex-validation.

**Smell:** localStorage read внутри renderRow (вызывается N раз) + повторяющиеся try/catch boilerplate. На команде 100 человек — 100 × `localStorage.getItem` + `try/catch` overhead. localStorage синхронный, но в Safari он подёргивает event-loop и медленнее, чем object property read.

**Refactor:**
- Один read в начале `_renderFull` (или в `_readConfig`): `const prefs = readScannerPrefs()` → возвращает `{ hideProductivity, showProductivity, showBlocked, activeSprintOnly, selectedTeam }`. Пробрасывается в `ctx`.
- `teamScanner2Prefs.js` уже существует (91 LOC) — там и место для этого. Сейчас он почти не используется, см.:
- Bonus: вынести флаги productivity-метрик в один объект — сейчас два разных ключа `q2_scanner_hide_productivity` (PersonRows) и `q2_scanner_show_productivity` (Renderer). Семантика разная (hide row-badges vs show panel-chips), но названо так, что путаешь.

**Критичность:** low (Performance regression только при больших командах + старых браузерах).
**Сложность:** low.
**Ценность:** medium (вместе с #4 убирает много раздробленной конфигурации).

---

### 13. Renderer-functions возвращают template strings — нельзя протестировать без emulation DOM

**Where:** Все public renderers в этом стеке. `renderEmployeeDetailPanel` возвращает большой template string (1093-1156). `renderRow` тот же паттерн.

**Smell:** Templating без сепарации концернов. Чтобы протестировать «при `prT.flag === 'overload'` появляется кнопка `Обсудить 1:1`» — надо распарсить HTML, искать `#ts2-detail-spawn-1on1`. Нет unit-теста rendering layer'а на сейчас.

**Refactor:**
- Длинный путь — VM-pattern (см. находку #9). Тогда `tests/unit/scanner-rowvm.test.js` берёт `buildRowVM(participant)` → ожидает `{ badges: { dwellHours: 96, switchCount: 0, … } }`.
- Короткий путь — `tests/unit/scanner-renderRow.test.js` с jsdom (он уже в node-testing chain через playwright). На сейчас в `tests/unit/` (judging по CLAUDE.md «~1613 unit tests») rendering testing почти нет.
- Минимум: snapshot test для `renderRow` на типовых фикстурах (stop / watch / moving / idle + edge cases). При любом visual regression — тест валится.

**Критичность:** low-medium (нет тестов = регрессии вылезают только в pilots).
**Сложность:** medium.
**Ценность:** high.

---

### 14. `_renderFull` смешивает: bumpClassifyEpoch, share-link apply, render context push, pk-filter, search-filter, history fetch, sprint-slope compute, z-score anomaly compute, diag light state, render template, mount metrics-deep, focus panel, announce

**Where:** `teamScanner2.js:1760-1931` (172 LOC одной функцией).

**Smell:** Layered responsibilities, all-in-one. Каждый из этих шагов имеет свой failure-mode, нет границ — `try`/`catch` отсутствует, при ошибке в `loadHistory` ломается весь render. `gatherDiagnosticState` зовётся ДВАЖДЫ на каждый рендер (один раз `lightDiagState` 1828, потом в `_freshDiagState` при открытии модалки) — лишний работы много, кэша нет.

**Refactor:**
- Разбить на pipeline:
  ```
  renderModel = prepareRenderState(model, ctx) // pure
  domHtml = renderTemplate(renderModel)
  applyToContainer(html, container)
  mountSideEffects(container) // metrics-deep, focus, announce
  ```
- Каждый шаг тестируется отдельно.
- Кэширование `lightDiagState` на одну сессию (он зависит от model + employees, никак не от UI).

**Критичность:** low.
**Сложность:** medium-high.
**Ценность:** medium (вместе с #2 и #13 даёт overall testability boost).

---

### 15. Hero-renderer вычисляет агрегаты (commits48h, prs48h, conf48h, …) которые УЖЕ есть в model.scannerV2 / portfolioPulseModel

**Where:** `teamScanner2RendererHero.js:635-657` — `for (const p of parts) { commits48h += …; prs48h += …; conf48h += … }`. То же самое делает enrichment для других нужд (`computePrThroughput`, `computeCrQueueDepth` etc.). Никакого централизованного aggregateSummary нет.

**Smell:** Calculation duplication между renderer'ом и enrichment'ом. Если enrichment когда-то начнёт фильтровать participants по `deactivatedFilteredOut`, а Hero не узнает — расхождение в шапке.

**Refactor:**
- В enrichment добавить `model.scannerV2.aggregate48h = { commits, prs, conf, testsCreated, testsExecuted, blockerTotal, dwellMaxTeam }`. Это уже nature `enrichForScanner2`.
- Hero читает `model.scannerV2.aggregate48h`. Никаких for-loop'ов в renderer'е.

**Критичность:** low.
**Сложность:** low.
**Ценность:** medium.

---

### 16. `requestAnimationFrame` для aria-live re-announce работает, но `_announce` идёт через `_container.querySelector` — если container detach'нулся между renderами, эта же функция silent fail

**Where:** `teamScanner2.js:2099-2104` (`_announce`). 

**Smell:** Silent failure без telemetry. При unmount → mount cycle между двумя announce'ами теряется. Скрытый bug: SR-аннонсы пропадают.

**Refactor:**
- Глобальный `<div id="prizma-aria-live">` в `index.html`, не привязанный к container. `_announce` всегда работает.
- Альтернатива: проверять `container.isConnected` перед `requestAnimationFrame`.

**Критичность:** low.
**Сложность:** low.
**Ценность:** low.

---

## Если бы мне дали 2 недели на это — что бы я сделал в первую очередь

**Неделя 1 — урезать `teamScanner2.js`:**
1. День 1-2: Extract `TeamScanner2Snapshot.js` (~250 LOC) + fix #1 (использовать `classifyPerson` вместо inline copy). Тест: snapshot-round-trip.
2. День 3: Extract `TeamScanner2AssistantController.js` (~200 LOC) + сделать LLM-сводку юнит-тестируемой через инжект fake `_llmGenerateSummary`.
3. День 4-5: Extract `TeamScanner2Modals.js` (~700 LOC) — все open/close + focus-trap + body-class. Заводим один тестируемый `ModalRegistry`.

**Неделя 2 — упростить event-binding и завести VM:**
4. День 6-7: Перевести row-click + group-jump + filter-pill на event-delegation через `data-action`. Удалить ~100 LOC из `_bindDashboardEvents`. Снимает coupling «render → bind».
5. День 8-9: Pilot extract `buildRowVM(participant, ctx)` + переписать `renderRow` поверх неё. Сделать `tests/unit/scanner-rowvm.test.js` на 8 типовых фикстур (stop+blockers / watch+overload / moving+anomaly / idle / moving+1on1 / cross-team / Jenkins-error / pulse-attention regress).
6. День 10: Brief'у скормить тот же VM. Удалить DOMParser path (~200 LOC). Регрессия только через visual smoke.

После этого `teamScanner2.js` ужмётся до ~2 600 LOC, и любая следующая фича roster'а делается за один файл вместо четырёх. Это инвестиция, которая платит проценты на каждой last-mile правке.
