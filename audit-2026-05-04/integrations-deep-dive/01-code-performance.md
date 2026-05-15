# 01 — Code & Performance audit (Сканнер команд 2.0 + Чёрный дашборд)

Дата: 2026-05-04
Auditor: Senior Frontend & Performance Engineer
Scope: только две интеграции вкладки «Интеграции» — Сканнер команд 2.0 и Чёрный дашборд. Portfolio Pulse / TechInfo / AI / Chat — out of scope.

## Сводка
- Critical: 2
- High: 4
- Medium: 9
- Low: 6
- Polish: 4

## Метод

Файлы прочитаны (in-scope, абсолютные пути):
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Enrichment.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Insights.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Diagnostic.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2DemoFixture.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2PersonMetrics.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2History.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Classifier.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Config.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Prefs.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/blackDashboard.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/integrationsRenderer.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/views/integrationsView.js`
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/docs/state-contracts.md` (для контрактов)
- `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/CLAUDE.md` (контекст)

Что проверял:
- 3 контракта (Reactive.silent, identity-deterministic attribution, _scrubSecrets)
- Listener-leaks, double-render, race conditions, abort discipline
- Hot-path complexity (O(N²) циклы по participants/blockers, deep clones, повторные вычисления)
- Дублирование: формула классификации, форматтеры, сниппеты JSON.parse/stringify localStorage
- Dead code: импорты без использования, mute-флаги, ссылки на несуществующие поля
- innerHTML без escapeHtml
- setTimeout/setInterval lifecycle
- console.* в production-path
- JSDoc-покрытие для функций над Proxy state

---

## Находки

### F1 — `state.snapshot` не существует в Proxy state — стабильно `currentCounts = {}` в Sensitivity Preview [Critical]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:1918`
**Симптом:** В `_openDiagModal` обработчик "threshold sensitivity preview" читает `state.snapshot?.current?.counts`. Но `state.js` не содержит `snapshot` — это локальный объект внутри `gatherDiagnosticState` (см. `teamScanner2Diagnostic.js:138`). На строке 1822 объявлен `const state = gatherDiagnosticState({...})`, и эта локальная константа _shadow_'ит модуль-уровневую `state` (proxy). Внутри обработчика на 1918 это уже LOCAL state (от gather), но в нём поле — `state.snapshot.current` (нижестоящее `_countsFromModel`), которое возвращает `{stop, watch, moving, idle}`.

Проверка показывает: даже если case-by-case везде совпадает, semantic очень опасен: если future PR добавит `state.snapshot` в `state.js` proxy, чтение пойдёт через Proxy (заблокирует ничего, но усложнит data flow). Если кто-то уберёт `const state = gatherDiagnosticState(...)`, выражение читает `appState.snapshot` — `undefined`, ничего не падает, но `currentCounts` всегда пуст и delta-row в `renderSensitivityResults` рисуется с нулевыми base-counters → пилот видит "−15 в стопе" как `0 → −15` (бесполезно).
**Причина:** Variable shadowing + использование общего имени `state` для двух разных объектов в одном файле (модуль-уровневый proxy в импорте + локальная const в `_openDiagModal`/`_performExport`). Комментарий на строке 57 явно говорит, что alias `appState` сделан как раз ради TDZ-guard, но в `_openDiagModal` всё равно тянет локальный `state`.
**Контракт/принцип:** dead-or-misleading
**Рекомендация (без потери функционала):** на 1918 заменить `state.snapshot?.current?.counts || {}` на `_countsFromModel-эквивалент` из локального `state` (который уже содержит `state.snapshot.current.counts` — если он реально создаётся в `gatherDiagnosticState`). Имя локального `state` переименовать в `diagState` для читаемости. Юнит-тест: проверить, что delta-row показывает корректный baseline.
**Цена изменения:** S

### F2 — `_gatherThresholds` читает поле `_teamThresholds`, но enrichment пишет `teamThresholds` (без `_`) — diagnostic всегда показывает `perTeam: null` [Critical]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Diagnostic.js:750` vs `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Enrichment.js:424`
**Симптом:** `gatherDiagnosticState → thresholds.perTeam` стабильно `null`, даже когда Olga (ML pilot) сохранила per-team override через `_openConfigModal`. В JSON экспортах diagnostic per-team overrides не отображаются — реверс-инжиниринг через export не работает.
**Причина:** Field-name typo. Enrichment записывает `model.scannerV2 = { ..., teamThresholds, ... }`. Diagnostic читает `m?.scannerV2?._teamThresholds`. Также комментарий на 334 ссылается на `_teamThresholds` (тоже мёртвый).
**Контракт/принцип:** identity-determ adjacent (поведенческий контракт пары orchestrator+diagnostic)
**Рекомендация (без потери функционала):** заменить чтение на `m?.scannerV2?.teamThresholds || null` в `teamScanner2Diagnostic.js:750`; обновить comment в `teamScanner2Diagnostic.js:334` (`model.scannerV2.teamThresholds`). Покрыть юнит-тестом в `tests/unit/`: после `applyPreset(pk, 'research')` экспорт diagnostic содержит `thresholds.perTeam[pk].codeReview === 24`.
**Цена изменения:** S

---

### F3 — Insights-функции вызываются заново на каждом `_renderFull` без memoize [High]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js:900-913, 1025, 1028, 1033, 1089, 1140-1143, 2026, 2051, 2081, 2104, 2125, 2165, 2263, 2285-2288`
**Симптом:** В `renderTeamGlance` + дочерних рендерах вызываются 20+ pure-функций над `model.participants` (от `computePrCycleTime` до `computeOnboardingRamp`). Каждая итерируется по всем participants × bbItems × blockers. Например `computeTeamHealthScore` вызывает `detectZombies` + `buildScopeChurnDetail`; `buildDailyBrief` вызывает `buildActionQueue` + `detectZombies`. На 109 участниках pilot-сценария это десятки `O(N×M)` циклов на каждый _renderFull (а он триггерится на любой filter pill, search-input, kebab toggle).
**Причина:** Нет analog'а memo'а который есть в `enrichForScanner2` (`_v20s8_metricsMemo`). Все insights-функции pure → их легко мемоизировать.
**Контракт/принцип:** perf
**Рекомендация (без потери функционала):** в renderer добавить short-lived cache, ключ — `model.fetchedAt` (или `_fetchedAtMs`):
```js
function _withModelMemo(model, key, compute) {
  const cache = (model._renderInsightsMemo ||= {});
  if (cache._fp !== model.fetchedAt) { cache._fp = model.fetchedAt; cache.data = {}; }
  if (cache.data[key] == null) cache.data[key] = compute();
  return cache.data[key];
}
```
Использовать в 20 точках. Помечать non-enumerable как сделано в enrichment, чтобы не утекало в diagnostic export. Альтернатива — делать compute один раз в `enrichForScanner2` и складывать в `model.scannerV2.insights`.
**Цена изменения:** M

### F4 — Тройное (или более) вычисление `classifyPerson` per-render для одного и того же participant [High]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js:676, 787, 2474, 2573` + `teamScanner2Insights.js:48, 99, 163, 277, 628` + `teamScanner2.js:_extractSnapshot` (252-269) + `teamScanner2Diagnostic.js:758` + `teamScanner2History.js:54, 90`
**Симптом:** `classifyPerson(p)` вызывается ≥7 раз для одного и того же participant в одном render-цикле:
1. `renderTeamGlance` — counts (`for (const p of parts) counts[classifyPerson(p)]++`)
2. `renderPersonRows` — group bucket
3. `renderSprintLagBreakdown` — `.filter(p => classifyPerson(p) === 'stop')`
4. `buildDailyBrief` — counts
5. `buildActionQueue` — group filter
6. `computeTeamHealthScore` — counts (через свой for-loop)
7. `_countsFromModel` (diagnostic)
В каждом вызове classifier пробегает все массивы `p.timelineToday`, `timelineYesterday`, `issuesNow`, `blockers`, `stale`, `badges.reviews`, `cfItems`, `bbItems`, `zephyrTestsCreatedRecent`, `zephyrTestsExecutedRecent`. Для 109 участников это 109 × 7 ≥ 700 классификаций.
**Причина:** Classifier — pure, но не cached на participant level. Также `_extractSnapshot` в orchestrator inline-копия правил classifyPerson (вместо import из classifier) — дрифт-риск.
**Контракт/принцип:** perf + dup
**Рекомендация (без потери функционала):** в `enrichForScanner2` после `applyPersonMetrics` сделать одно прохождение: `for (const p of model.participants) p._group = classifyPerson(p);`. Затем все consumers (renderer, insights, diagnostic, history.saveDailySnapshot, orchestrator._extractSnapshot) читают `p._group`. Memo за O(N), вместо 7×N. Отдельный `classifyPerson` сохраняется как pure entry-point. `_extractSnapshot` в `teamScanner2.js:252-269` заменить на reuse `_group` (-15 LOC).
**Цена изменения:** S

### F5 — Listener-leak: kebab `outsideClick` / `escKebab` теряются если меню повторно открывают без явного close [High]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:1083-1120`
**Симптом:** `kebabBtn.addEventListener('click', ...)` навешивается на каждом `_bindDashboardEvents` (т.е. на каждый _renderFull). Но: 1) сам click handler НЕ снимается при unmount (внутренний листенер на ноду — нода уйдёт с innerHTML, ок); 2) ВНУТРИ click-handler по нажатию `setTimeout 0 → document.addEventListener('click', outsideClick); document.addEventListener('keydown', escKebab)`. Если до выхода с subtab пользователь нажал кебаб (открыл) и не нажал клик-вне — `closeKebab()` не вызовется, и обработчики `outsideClick`/`escKebab` остаются на `document`. На следующий mount `_bindDashboardEvents` навешивает НОВУЮ пару — старая всё ещё жива (ссылается на detach'ed `kebabMenu` ноду). Через 5-10 переключений subtab может накопиться 5-10 живых пар.
**Причина:** Внутри click-handler-функции делается `closeKebab` через два `setTimeout(0)`-привязки, но reference на `outsideClick`/`escKebab` живёт только в closure. На unmount эти closures не очищаются. `unmount()` метод scanner2 чистит только `_escHandler` и `_slashHandler`, не listening пары kebab.
**Контракт/принцип:** listener-leak / re-entry
**Рекомендация (без потери функционала):** хранить ссылки на handler'ы в `this._kebabOutsideHandler` / `this._kebabEscHandler`; в `unmount()` снимать их вне зависимости от состояния меню. Можно сделать единую утилиту `_attachWithCleanup(target, type, fn) → reg в this._cleanups[]`, на unmount пройтись — это поднимет качество и для других кейсов (см. F8).
**Цена изменения:** S

### F6 — `_renderFull` rebuild всего DOM для search-input keystroke (debounce 150ms) — фокус восстанавливается вручную [High]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:1147-1170, 871-879`
**Симптом:** На каждый ввод символа дёргается `this._renderFull()` который пересобирает топбар + glance + 20+ insights-tile + person rows + side-panel (`_expandedKey ? ...`). Для 109 участников это десятки тысяч DOM-операций на 150ms интервале. Затем явно восстанавливают focus + setSelectionRange (на 1156-1161). Это дорогая операция, и любой mid-render фриз ощущается тимлидом как "печатает медленно". `_renderPanelOnly` уже существует как pattern для частичного rebuild → analog нужен для search-filtered rows.
**Причина:** Search-фильтр применяется в `_renderFull` как `filteredModel = { ...filteredModel, participants: ... }`. Нет partial-rebuild path — только full.
**Контракт/принцип:** perf / UX-degrade
**Рекомендация (без потери функционала):** добавить `_renderRowsOnly()` симметрично `_renderPanelOnly`. На search input event дёргать `_renderRowsOnly()` (которая re-renders только `.ts2-rows` контейнер + topbar count в glance). 109 row's HTML-string template literal билдится в ~5-10ms; выборочное `.innerHTML =` контейнера + relevant re-bindEvents на новых rows. Topbar/insights/sprint-lag не перестраиваются — поиск не на них.
**Цена изменения:** M

---

### F7 — `_buildActiveSprintKeySet` вычисляется дважды per fetch — в enrichment + в renderer [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Enrichment.js:312` + `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js:649-654`
**Симптом:** `_buildActiveSprintKeySet` собирает Set всех issue.key из `model.spaces[pk].sprintIssues`. То же самое в `renderSprintLagBreakdown:649` — отдельным циклом снова собирает Set по тем же `model.spaces[pk]?.sprintIssues`. Также `computeRiskSummary:782-787` третий раз делает то же. Все три за один `_fetchAndRender` пробегают по `Object.keys(model.spaces)`.
**Причина:** Нет shared cache; функции не дружат.
**Контракт/принцип:** perf / dup
**Рекомендация (без потери функционала):** в `enrichForScanner2` после `_buildActiveSprintKeySet` записать non-enumerable `Object.defineProperty(model, '_activeSprintKeySet', { value: sprintKeys, enumerable: false })`. Renderer и risk-summary читают этот Set, не пересобирая.
**Цена изменения:** S

### F8 — Modal escape-handlers замыкают на детач'ed overlay, плюс нет TS2-spawned modals в `unmount()` [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:1595-1605, 1729-1737, 1753-1762, 1776-1786, 1804-1811, 1842-1857, 2089-2098`
**Симптом:** Каждый `_open*Modal` (config / how / diag / disclaimer / resolve / velocity / anomaly / crv-drilldown) делает свой `document.addEventListener('keydown', onEsc)` + `document.removeEventListener('keydown', onEsc)` через локальный close. Если пользователь переключает subtab пока modal открыт — `IntegrationsView.render()` дёргает `TeamScanner2.unmount()`, но unmount не закрывает spawned modals → modal остаётся в `document.body`, escape-listener на document остаётся, ссылается на overlay уже несуществующий после `.remove()`.
**Причина:** unmount чистит только `_escHandler` (panel) и `_slashHandler`, не зная про live modals (они через `getElementById('ts2-*-modal')`).
**Контракт/принцип:** listener-leak / orphan DOM
**Рекомендация (без потери функционала):** в `unmount()` сделать `for (const id of ['ts2-config-modal', 'ts2-how-modal', 'ts2-diag-modal', 'ts2-diag-disclaimer', 'ts2-resolve-modal', 'ts2-velocity-modal', 'ts2-anomaly-modal', 'ts2-crv-drilldown']) { document.getElementById(id)?.dispatchEvent(new Event('click', ...)) || document.getElementById(id)?.remove(); }`. Альтернатива чище — единая утилита `_openModal(id, html, { onClose? })` которая регистрирует в `this._activeModals[]` и закрывает все на unmount + очищает соответствующие listener'ы.
**Цена изменения:** M

### F9 — `_phraseTimer` в BlackDashboard продолжает идти если subtab переключили во время загрузки [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/blackDashboard.js:71-104`
**Симптом:** `_showLoader()` запускает `setInterval(tick, 2600)` и сохраняет в `this._phraseTimer`. Если пользователь нажимает subtab "Сканнер команд" во время `_fetchAndRender`, `IntegrationsView.render()` НЕ зовёт никакого `BlackDashboard.unmount/detach` (его не существует) — interval продолжает биться (`tick` находит `el = null` и нет-op'ит на каждом тике), но _phraseTimer не очищается до finally в `_fetchAndRender` (строка 177). При повторном открытии BlackDashboard `_showLoader` вызовет `_stopPhraseRotator` → ок, но интервал между переключением и завершением fetch — utak ~10-30 сек висит без видимых последствий.
**Причина:** В отличие от TeamScanner2, у BlackDashboard нет `unmount/detach` метода, и `IntegrationsView.render()` ему не вызывает cleanup. Интервал fail-safe (оборванный fetch ловится через abort), но bcg phrase tick живёт до finally.
**Контракт/принцип:** lifecycle / listener-leak (минорный)
**Рекомендация (без потери функционала):** добавить `BlackDashboard.unmount() { this._stopPhraseRotator(); try { this._abort?.abort(); } catch(_) {} }`. В `IntegrationsView.render()` симметрично TeamScanner2: если `_activeSubtab === 'black' && next !== 'black'` → `BlackDashboard.unmount()`.
**Цена изменения:** S

### F10 — `_lastRenderAt`/`markRenderedNow` не вызывается в TeamScanner2/BlackDashboard — обходится Reactive grace-period [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:_renderFull` (937-955); `state-contracts.md:60-68` описывает `App.markRenderedNow()` вызывается «из любого view сразу после render»
**Симптом:** `state-contracts.md` Auto-rerender grace period: «`App.markRenderedNow()` вызывается из любого view сразу после render». В `teamScanner2._renderFull` и `blackDashboard._renderFull` нет такого вызова. Если в момент render flush'а Reactive triggered (например при auto-sync employees), то Reactive subscribe re-render'нёт scanner2 ещё раз — теряется scroll position и flash. На текущем коде это смягчается тем, что mass-mutation в `_syncEmployeesFromParticipants` обёрнута в `Reactive.silent(...)`, но Storage.save вне silent (что correct) → reactive subscriber всё равно сработает.
**Причина:** Контракт Auto-rerender grace описан в docs, но scanner2/black не следуют.
**Контракт/принцип:** Reactive.silent (adjacent / grace period)
**Рекомендация (без потери функционала):** в конце `TeamScanner2._renderFull` и `BlackDashboard._renderFull` добавить `try { App.markRenderedNow?.(); } catch(_) {}`. Юнит-тест: после `_syncEmployeesFromParticipants` повторный full-rerender не запускается в течение 250ms.
**Цена изменения:** S

### F11 — Поле `_renderContext` в renderer — модуль-уровневое mutable, Race при двух views в один tick [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js:24-27` + `_renderFull` устанавливает (`teamScanner2.js:851`)
**Симптом:** `let _renderContext = { jiraBaseUrl: '' };` — модуль-singleton. Renderer-функции вроде `jiraIssueLink(key)` читают этот объект. Если в будущем два разных scanner-instance окажутся видимы одновременно (multi-window, или embed) — последний `setRenderContext` побьёт первый mid-render. Сейчас на этом не падают, но Принцип: рендер-функции должны быть pure, не читать из module-state.
**Причина:** ContextPath не пробрасывается через function args.
**Контракт/принцип:** pure-renderer
**Рекомендация (без потери функционала):** заменить `_renderContext` на параметр `ctx` который пробрасывается из `renderTopBar / renderTeamGlance / renderPersonRows / renderEmployeeDetailPanel`. Helper `jiraIssueLink(key, baseUrl)`. Не fundamental, но closes the door.
**Цена изменения:** M

### F12 — `JSON.parse(JSON.stringify(...))` deep-clone в demo-mode hot-path [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2DemoFixture.js:927`
**Симптом:** `getScanner2DemoModel` возвращает `JSON.parse(JSON.stringify(SCANNER2_DEMO_FIXTURE))` — fixture весит 928 LOC (≈30-50KB после минификации). Каждый `loadDemo()` делает full deep-clone. Также любой re-render с demo-mode (filter pill, search) вызовет `_renderFull` — clone не повторяется (model уже клонирован), но loadDemo может вызываться повторно (URL hash demo + ручной вход). При normal flow (не-demo) импорт `teamScanner2DemoFixture.js` всё равно происходит на module load (top-level import строка 122), а не lazy — комментарий обещает lazy, но реально модуль грузится сразу.
**Причина:** 1) JSON.parse(JSON.stringify) для большого объекта (Date конвертится в string, regex теряется — для fixture это ОК, но slow). 2) Top-level import вместо `await import()`.
**Контракт/принцип:** perf / dead-code-pretense
**Рекомендация (без потери функционала):** 1) заменить deep-clone на `structuredClone(SCANNER2_DEMO_FIXTURE)` (нативный, ~10× быстрее, поддерживает Date/Map/Set). 2) Сделать настоящий lazy: `async loadDemo() { const { getScanner2DemoModel } = await import('./teamScanner2DemoFixture.js'); ... }` и убрать top-level import. Это снимает ~15-30KB с initial bundle для нормальных пользователей.
**Цена изменения:** S

### F13 — Дублирование formula `_extractSnapshot` ↔ `_extractMinimalSnapshot` ↔ `_countsFromModel` [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:247-284` + `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2History.js:48-95` + `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Diagnostic.js:754-761`
**Симптом:** Три разных места делают одно и то же:
- `_extractSnapshot` в orchestrator (для 24h delta) — inline classifier (267-268)
- `_extractMinimalSnapshot` в History (для 30-day) — использует `classifyPerson` из classifier модуля
- `_countsFromModel` в Diagnostic — использует `classifyPerson`
Плюс расширенные snapshots — `personGroups`, `sprintsByPk` — в History; в orchestrator снапшоте этих полей нет, поэтому prev-snapshot diff в `_renderFull` иногда пустой (если prev из orchestrator, а render ожидает personGroups → это точно дрифтит логически).
**Причина:** Эволюционный rust: orchestrator snapshot < History snapshot.
**Контракт/принцип:** dup
**Рекомендация (без потери функционала):** перенести `_extractSnapshot` логику в `teamScanner2History.js` как exported helper `composeFullSnapshot(model)`, которая возвращает _superset_ (counts+risks+sprintGoal+personGroups+sprintsByPk). Orchestrator зовёт его и берёт нужные fields. Diagnostic зовёт `_countsFromModel` (или тот же helper). Один источник truth — единственное место где надо обновлять при добавлении нового сигнала.
**Цена изменения:** M

### F14 — `prepareDiagnosticExport` пропускает `summary.bbResolved` / `summary.cfResolved` без scrub в `out.innerHTML = ...` [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:2064`
**Симптом:** `out.innerHTML = '<div class="ts2-diag-ok">✓ Получены данные: ${resp.summary.bbResolved} BB, ${resp.summary.cfResolved} CF из ${resp.summary.total}. Открываю preview…</div>'` — `resp.summary.*` это числа от server. Если server вернёт строку (NaN, "OK", не число) — она попадёт в DOM без `Utils.escapeHtml`. Server должен возвращать числа, но defensive XSS-policy требует escape.
**Причина:** В подобном `out.innerHTML = '<div...>Не удалось: ${Utils.escapeHtml(...)}</div>'` (на 2073) — escape есть, на 2064 — нет. Inconsistent.
**Контракт/принцип:** XSS defense-in-depth
**Рекомендация (без потери функционала):** обернуть `${Utils.escapeHtml(String(resp.summary.bbResolved))}` (и для cf/total). Та же проверка для других inline-template strings — идём по списку:
- `out.innerHTML = renderProbeResults(probe);` (1888) — рендерер уже escapes
- `out.innerHTML = renderSensitivityResults(sim, currentCounts);` (1919) — то же
- `out.innerHTML = renderProbeResults(probe);` ok — но `renderProbeResults` принимает probe.error который redacted в `runConnectionProbe` ✓.
Конкретно фикса хватит на 2064 + любые `out.innerHTML` где есть `${something}` без `esc`.
**Цена изменения:** S

### F15 — `_searchDebounce` живёт в orchestrator, но не очищается в `unmount()` — pending callback дёргает уничтоженный container [Medium]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:1150-1162, 2248-2268`
**Симптом:** `unmount()` сбрасывает `this._searchQuery = ''`, но не делает `clearTimeout(this._searchDebounce)`. Если пользователь печатает в search, тут же переключает subtab — pending setTimeout через 150ms дёрнет `this._renderFull()` на детач'ed контейнере (раз уже unmount'ились), потенциально painting на innerHTML несуществующего элемента или невидимого scope.
**Причина:** Lifecycle gap.
**Контракт/принцип:** listener-leak / re-entry
**Рекомендация (без потери функционала):** в `unmount()` добавить `if (this._searchDebounce) { clearTimeout(this._searchDebounce); this._searchDebounce = null; }`.
**Цена изменения:** S

---

### F16 — Импорты `extractTrendSeries` (orchestrator) + `weekdayAdjustedAnomaly` (renderer) — без использования [Low]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:86` (`extractTrendSeries`) + `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js:207` (`weekdayAdjustedAnomaly`)
**Симптом:** `extractTrendSeries` импортирован в orchestrator, но в файле нет ни одного вызова. `weekdayAdjustedAnomaly` импортирован в renderer (строка 207), но grep показывает 0 вызовов (есть только в Insights `export function weekdayAdjustedAnomaly`). Аналогично `composeDailyBriefMarkdown` — корректно используется (1033).
**Причина:** Эволюционный leftover после рефакторинга.
**Контракт/принцип:** dead
**Рекомендация (без потери функционала):** удалить из import-list. Юнит-тест `tests/unit/teamScanner2.test.js`: typecheck'ом отловит.
**Цена изменения:** S

### F17 — Hardcoded magic numbers без const [Low]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:295` (5 * 60 * 1000), `2167` (1000), `1984` (24 * 60 * 60 * 1000), `1671` (slice(-50)); `teamScanner2Renderer.js:2605` (Math.max(0, ...)); множество `* 86400 * 1000`
**Симптом:** `5 * 60 * 1000` (5 мин) встречается в `_FRESH_TTL_MS`, `_DETAIL_CACHE_TTL_MS` и inline в `_readPrevSnapshot`. `24 * 60 * 60 * 1000` встречается ещё в 5+ мест. Числа дублируются — изменение TTL потребует охоты.
**Причина:** Не вынесены константы.
**Контракт/принцип:** dup / readability
**Рекомендация (без потери функционала):** в `teamScanner2Config.js` (или новом `teamScanner2Constants.js`) экспортировать `MS_PER_MIN, MS_PER_HOUR, MS_PER_DAY` + `FRESH_CACHE_TTL_MS, DETAIL_CACHE_TTL_MS, SNAPSHOT_TTL_MS, CONSENT_TTL_MS, JOB_TTL_MS, AUDIT_QUEUE_MAX_ENTRIES, DETAIL_CACHE_MAX_ENTRIES, SNAPSHOT_KEEP_DAYS`. Это уже частично есть в `teamScanner2.js` как class-level (`_FRESH_TTL_MS`, `_SNAPSHOT_TTL_MS`), но 1) inline `5 * 60 * 1000` в `_readPrevSnapshot:295` дублирует FRESH_TTL_MS; 2) `JOB_TTL_MS` в Diagnostic:95 — отдельная декларация.
**Цена изменения:** S

### F18 — Console.warn/info в production-path вместо `logger.event`/`telemetryEmit` [Low]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:513, 702, 756, 826, 833, 1347, 1480, 1525, 1552, 2129, 2197` + `blackDashboard.js:161` + `teamScanner2History.js:128`
**Симптом:** На клиенте используются `console.warn`/`console.info` для непредвиденных ошибок (storage.save quota, clipboard API failure, share-link bad chars и т.д.). 13 вхождений за scope. Часть уже параллельно telemetry-эмитит (например `_saveSnapshot` shoots `telemetryEmit('scanner2.silent_error', ...)`), но многие остаются consol-only. Server-side `server/logger.js` существует, но это не наша зона. На клиенте нет аналогичного structured logger.
**Причина:** Гибрид — telemetry развит, но console-fallback всегда там же.
**Контракт/принцип:** observability
**Рекомендация (без потери функционала):** на клиенте создать минимальный `chat/telemetry.js`-style helper `clientLogger.warn(scope, msg, meta)`, который пишет в `console.warn` И отправляет `telemetryEmit('scanner2.silent_error', { where: scope, msg })`. В hot-path заменить `console.warn('[scanner2] X failed:', e)` на `clientLogger.warn('scanner2.X', e?.message, { stack: e?.stack?.slice(0, 200) })`. Не блокирующе, но улучшит производственную диагностику.
**Цена изменения:** M

### F19 — `bucketByHour` в renderer (стр. 145-157) — отдельная функция от `getLocalHour` в enrichment [Low]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js:145-157` vs `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Enrichment.js:222-230`
**Симптом:** Renderer'овский `bucketByHour` использует `Date.getHours()` (browser local), enrichment'овский `getLocalHour` поддерживает `tzOffsetMin`. На production они дают одно и то же (rendering всегда client-local), но семантически дрейф. Если в будущем server-rendered preview — enrichment корректен, renderer наивен.
**Причина:** Не объединено.
**Контракт/принцип:** dup
**Рекомендация (без потери функционала):** заменить `bucketByHour` в renderer на использование `getLocalHour` (из enrichment) с `tzOffsetMin = null`. Сэкономит ~12 LOC.
**Цена изменения:** S

### F20 — `_extractSnapshot` хранит `outOfSprintRatio` без `outOfSprintRatioBasis` [Low]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:271-283`
**Симптом:** Snapshot persist'ит `outOfSprintRatio: model.scannerV2?.risks?.outOfSprintRatio || 0`, но НЕ basis (`unique-keys` vs legacy events-based). Если в будущем basis поменяется (S6.2.3 → S7.x.y), сравнение prev vs current даст ложный delta — пилот видит «out-of-sprint вырос с 12% до 35%» хотя реальные числа не менялись, просто definition.
**Причина:** Не сохранён маркер.
**Контракт/принцип:** correctness / data-versioning
**Рекомендация (без потери функционала):** в `_extractSnapshot` добавить `_v: 1, basis: 'unique-keys'`. В `_renderFull` если `prev.basis !== model...basis` — не рендерить delta для этой метрики (или рендерить с warning «другая методика»). Минимальный fix — версия в snapshot для будущих миграций.
**Цена изменения:** S

### F21 — `bb.{commit,pr,review}` парсинг в `_lastRawDiag` — `Object.values(authors).reduce` дважды без memoize [Low]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js:670-688`
**Симптом:** `Object.values(raw?.bitbucket?.authors || {}).reduce(...)` и аналог для cf/zephyr — выполняется один раз на fetch, не критично. Но: `bbAuthorsCount: Object.keys(raw?.bitbucket?.authors || {}).length` — отдельный pass; `bbItemsTotal: Object.values(...).reduce((s, a) => s + (a?.items?.length || 0), 0)` — второй pass. Можно одним проходом.
**Причина:** Микрооптимизация.
**Контракт/принцип:** perf (минор)
**Рекомендация (без потери функционала):** инлайн-helper `_summarizeAuthors(authors) → { count, itemsTotal }`, один pass через `Object.values(...).reduce((acc, a) => ({ count: acc.count+1, itemsTotal: acc.itemsTotal + (a?.items?.length || 0) }), {count:0, itemsTotal:0})`.
**Цена изменения:** S

---

### F22 — JSDoc: orchestrator-методы над Proxy state без типов параметров [Polish]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2.js` — `_syncEmployeesFromParticipants(model)`, `_runIdentityResolve(diagOverlay)`, `_openIdentityResolvePreview(diff, summary)`, `_performExport(state, mode, consentMeta)`
**Симптом:** Эти методы мутируют `state.employees` (Proxy), берут `model` (Pulse-shape), `state` (diagnostic-shape — омоним!) — без JSDoc у future maintainers нет шансов понять, какой `state`. `_performExport(state, mode)` получает diagnostic-state, не Proxy — контракт легко нарушить. Без `@param {object}` это серая зона.
**Причина:** Convention gap.
**Контракт/принцип:** docs / readability
**Рекомендация (без потери функционала):** добавить JSDoc к 4-5 ключевым методам:
```js
/**
 * @param {object} model — output of analysePulse() + enrichForScanner2()
 * @param {object} diagOverlay — DOM element of #ts2-diag-modal
 */
```
Для `_performExport` явно показать что `state` тут — `gatherDiagnosticState()` output, не Proxy.
**Цена изменения:** S

### F23 — `renderSettingsModal` в `integrationsRenderer.js` мешает inline + overlay стили в одном template literal [Polish]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/integrationsRenderer.js:13-176`
**Симптом:** 163 LOC одной функции с 2 conditional branch'ами (`inline=true` vs overlay) + 4 panel templates (Jira/Sigma/BB/CF) + хардкод HTML structure — сложно читать. Любое изменение в Confluence panel требует прокрутки 100+ строк.
**Причина:** Single-template approach.
**Контракт/принцип:** readability
**Рекомендация (без потери функционала):** разнести на 4 helper-функции `renderJiraDeltaPanel(s)`, `renderJiraSigmaPanel(s)`, `renderBitbucketPanel(s)`, `renderConfluencePanel(s)`. Top-level `renderSettingsModal` — orchestrator, ~30 LOC. Хорошо для test'ов (4 small render-tests vs 1 monolith).
**Цена изменения:** M

### F24 — `_buildSprintNarrative` (renderer 518) дублирует логику pace-calculation в renderer вместо переиспользования из enrichment [Polish]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/teamScanner2Renderer.js:518-541`
**Симптом:** `_buildSprintNarrative(sg, slope)` имеет inline if-цепочку для `pace === 'behind'`/`'ahead'`/`'on-track'`. Но enrichment уже вычисляет это в `aggregatePace`. Inline-narrative не дрейфит сейчас, но если в enrichment добавится 4-й pace (`stalled` для прерванного спринта) — narrative его не подхватит.
**Причина:** Маленькая дупликация.
**Контракт/принцип:** dup / readability
**Рекомендация (без потери функционала):** вынести в `teamScanner2Insights.js` как `composeSprintNarrative(sg, slope) → string`, импортировать в renderer. Минор, но симметрично остальным insights helpers.
**Цена изменения:** S

### F25 — Long if-else-if цепочка в `_renderActiveTab` BlackDashboard на 3 режима — switch с default redundant [Polish]
**Где:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design/integrations/blackDashboard.js:194-201`
**Симптом:** `switch(this._activeTab) { case 'goals': … case 'coverage': … case 'metrics': … default: renderGoalsTab(); }`. Default-fallback на goals — если кто-то добавит 4-й tab, default безмолвно redirect. Удалить default или throw на unknown tab.
**Причина:** Defensive default mute.
**Контракт/принцип:** mute-flag adjacent
**Рекомендация (без потери функционала):** убрать default или заменить на `console.warn('[BlackDashboard] unknown tab', this._activeTab)` + fallback. Не блокирует, чисто polish.
**Цена изменения:** S

---

## Сводный счёт находок (для XLS-сводки)

| ID  | Severity | Контракт/принцип        | Файл                              | Цена |
|-----|----------|-------------------------|-----------------------------------|------|
| F1  | Critical | dead-or-misleading      | teamScanner2.js:1918              | S    |
| F2  | Critical | identity-determ adj     | teamScanner2Diagnostic.js:750     | S    |
| F3  | High     | perf                    | teamScanner2Renderer.js (multi)   | M    |
| F4  | High     | perf + dup              | multi (classifier callsites)      | S    |
| F5  | High     | listener-leak           | teamScanner2.js:1083-1120         | S    |
| F6  | High     | perf / UX               | teamScanner2.js:1147-1170         | M    |
| F7  | Medium   | perf / dup              | teamScanner2Enrichment.js:312     | S    |
| F8  | Medium   | listener-leak           | teamScanner2.js (modals)          | M    |
| F9  | Medium   | lifecycle               | blackDashboard.js                 | S    |
| F10 | Medium   | Reactive (grace)        | scanner2 + black _renderFull      | S    |
| F11 | Medium   | pure-renderer           | teamScanner2Renderer.js:24-27     | M    |
| F12 | Medium   | perf / lazy-import      | teamScanner2DemoFixture.js:927    | S    |
| F13 | Medium   | dup                     | snapshot extractors (3 places)    | M    |
| F14 | Medium   | XSS defense-in-depth    | teamScanner2.js:2064              | S    |
| F15 | Medium   | listener-leak           | teamScanner2.js:1150 / unmount    | S    |
| F16 | Low      | dead                    | imports unused                    | S    |
| F17 | Low      | dup / readability       | magic numbers (multi)             | S    |
| F18 | Low      | observability           | console.* (multi)                 | M    |
| F19 | Low      | dup                     | bucketByHour vs getLocalHour      | S    |
| F20 | Low      | correctness / versioning| _extractSnapshot                  | S    |
| F21 | Low      | perf (minor)            | teamScanner2.js:670-688           | S    |
| F22 | Polish   | docs / readability      | orchestrator JSDoc                | S    |
| F23 | Polish   | readability             | integrationsRenderer.js           | M    |
| F24 | Polish   | dup / readability       | _buildSprintNarrative             | S    |
| F25 | Polish   | mute-flag adj           | blackDashboard.js                 | S    |
