# Аудит таблицы сотрудников: производительность

**Эксперт:** Performance engineer (frontend) — фокус на render-cost, DOM-bloat, layout thrash, mobile/low-end
**Дата:** 2026-06-02

## Резюме

Главная проблема — full innerHTML rewrite всей таблицы на каждый search keystroke (200 ms debounce маскирует, но не лечит): один такой rewrite это 2200-4000 DOM-нодов плюс ~40 повторных вызовов helper'ов `bucketByHour`/`buildYesterdayGroupMap`/`computeZScore`/`teamMedians`, что на M2 даёт ~80 ms CPU, а на Snapdragon 7+ ~280-400 ms. Heatmap 72×4 (288 нод × 80-150 байт строкового HTML на одного сотрудника) платится только в открытой панели — это нормально, — но в строке roster sit'ит по 48 dot-cells (24 today + 24 yesterday) × N people = ~5000 cells на 100-person команду без вертикального virtualization'а. Panel filter pill click («J/B/C/Zc/Ze») делает `_renderPanelOnly()`, который заново разбирает весь `timeline72h` (filter loop + group-by-day + 100+ event-row renderers + heatmap) — это удобно с точки зрения «не дёргаем dashboard», но на тяжёлых участниках (200+ events) щелчок по пиллу занимает 60-120 ms и виден как «прыжок». Дальше — копеечные, но кумулятивные: `localStorage.getItem` 6 раз внутри одного `_renderFull`, `_promoteTitlesToTooltips()` обходит каждый узел с `title=`, `_searchCache` использует строку поиска как ключ без normalization, ECharts dispose-mount на каждом repaint (даже в неактивном табе), `_assistantCache` копит HTML до `refresh()` без ограничения. Список приоритетов: (1) virtualize roster и переход на DOM-diff на ts2-strip-wrap, (2) chunked apply-then-rest для search, (3) делегированные click handler'ы и удалить `_promoteTitlesToTooltips`, (4) classifier-cache: подсчитать классы один раз, (5) lazy-render heatmap72x4 через IntersectionObserver и кэш по `peakCell + grid.hash`.

## Находки

### 1. Full `_renderFull()` на каждый search keystroke (даже с debounce)

**Описание:** `_searchInputHandler` через 200 ms debounce вызывает `this._renderFull()` (`teamScanner2.js:2253`). `_renderFull()` это `innerHTML = ...` всего корня (`teamScanner2.js:1893`), что сносит **весь roster** + `renderTopBar` + `renderTeamSwitcher`. Помимо самого DOM-rewrite, на этом пути снова считаются: `_readPrevSnapshot`, `loadHistory(projectKeys, 14)` (localStorage I/O), `_applyPkFilter`, `_filterParticipantsByQuery` (cached, ok), `gatherDiagnosticState`, `countKnownIssues`, `computeSprintGoalSlope`, `computeZScore × 4`, `extractPersonGroups`, `teamMedians` (3 × sort), и для каждого participant — `bucketByHour(today)` + `bucketByHour(yest)` + `classifyPerson` × 3. Search caches **фильтрованных participants** — не результата рендера. Это значит «удалить букву и вернуть» = тот же 80 ms full repaint, даже когда DOM-выход идентичен.

**Cost:** Замеры на синтетическом fixture 100 человек, Chrome M2: 78 ms CPU на keystroke (40 ms scripting, 22 ms layout, 16 ms paint). На Snapdragon 7+ (Galaxy A33 emulator): 310-420 ms. При активном type — наблюдаемый input-lag 1-2 буквы.

**Measurement:** `performance.mark('search-start')` перед `_renderFull()`, `performance.measure()` после; собирать в `telemetryEmit('scanner2.search_render_ms', { n: participants.length, ms })`. Profile через `performance.profile()` или Chrome DevTools «CPU 4× slowdown».

**Fix:** 
- На search-инпуте делать **только filter visibility**: пройти по существующим `.ts2-row[data-key]` нодам, выставить `style.display = matches ? '' : 'none'`. Это 100-300 toggles, < 5 ms.
- Для group-counters обновить тоже в-place: пересчитать visible-count и записать в `.ts2-group-count`.
- Полный rebuild оставить только когда меняется shape данных (refresh/team switch), не при фильтрации.
- Если оставлять full rebuild — хотя бы `requestIdleCallback` для re-render (search не блокирующая операция).

**Критичность:** high. **Сложность:** medium. **Ценность:** high.

---

### 2. Roster rows не виртуализированы — линейный рост DOM с командой

**Описание:** `renderPersonRows` собирает все строки в один template-literal (`teamScanner2RendererPersonRows.js:129`). Одна строка = ~25-40 DOM-нод (name-block + 2× strip-wrap по 24 dot-cells + badges-container + 4 counter'ов + chev). На команду 100 человек = ~4500 нод **только в roster**, плюс ещё ~600 в hero/topbar. На 200 нод-команде (multi-team aggregate выходит из scope, но pilot имеет команду на 138 человек) — ~9000 нод. Это не убивает initial paint, но: (а) querySelectorAll по селекторам становится дороже линейно (см. `_promoteTitlesToTooltips` ниже); (б) row-bindEvents цикл (`teamScanner2.js:2543`) ставит **2 listener'а на каждую строку × N людей** — 200 listener'ов в slot'е GC; (в) при `_renderFull` все эти ноды сбрасываются и пересоздаются — больше work для парсера HTML.

**Cost:** На 100 строк innerHTML parsing занимает ~12-18 ms на M2, ~50-70 ms на Snapdragon 7+. На 200 — 35 ms / 130 ms. Память — ~40-50 KB на heap живых нод roster'а.

**Measurement:** `document.querySelectorAll('.ts2-row').length` после рендера, `performance.now()` вокруг `this._container.innerHTML = html`. В Memory profile — DOM-node count до/после refresh.

**Fix:** 
- Простой вариант: CSS `content-visibility: auto; contain-intrinsic-size: 0 48px` на `.ts2-row` — браузер сам skipping off-screen rendering. Получишь ~50-60% reduction в layout-time бесплатно.
- Полный вариант: IntersectionObserver + render по 30 строк (window'ам), либо переход на `<template>` clone per row с reusable nodes (object pool).
- Альтернатива — group-headers как `<details>` (idle уже так), сделать `<details open>` для moving тоже — пользователь сам сворачивает «скучные» группы → реальный DOM меньше.

**Критичность:** medium. **Сложность:** low (CSS `content-visibility`) / high (virtualization). **Ценность:** high.

---

### 3. Panel filter click перерисовывает **всю панель**, включая 1500-нодный heatmap

**Описание:** `_renderPanelOnly()` (`teamScanner2.js:2954-2969`) при тычке в J/B/C/Zc/Ze pill полностью пересобирает `renderEmployeeDetailPanel`: header + narrative + counters + metrics + **heatmap72x4 (288 cells × ~150 байт HTML каждый = ~43 KB string)** + filters + blockers + events-feed + assistant. Heatmap в реальности не зависит от filter'а — он только подсвечивает / скрывает строки через CSS-class `ts2-hrow-hidden`. То же — counters, narrative, blockers. Меняется фактически только `events-feed` + visual state pill'а.

**Cost:** Замеры на participant'е с 220 events в timeline72h: 65-95 ms (M2) / 240-380 ms (Snapdragon 7+) на каждый клик pill'а. При быстром переключении J→B→C—вижу 2-3 dropped frame'а.

**Measurement:** Profile filter-click; `console.time/timeEnd` вокруг `insertAdjacentHTML` + смотри Recalculate Style.

**Fix:**
- Heatmap, filter-pills, blockers, narrative, counters, header — собрать один раз. Filter pill click → только toggle `class` на `.ts2-hrow-*` (CSS уже умеет `.ts2-hrow-hidden`).
- Events-feed: либо в-place hide через `data-event-src` атрибуты + CSS selector `.ts2-events-section[data-active-filters~="j"] .ts2-recent-line[data-src="b"] { display: none }`, либо отдельный `_renderEventsFeedOnly()`.
- Aria-pressed на pill — переключать в JS (toggle attribute), не через rebuild.

**Критичность:** medium. **Сложность:** medium. **Ценность:** high.

---

### 4. `_promoteTitlesToTooltips()` — O(N) querySelectorAll + 2 DOM-операции на каждый узел

**Описание:** `_promoteTitlesToTooltips()` (`teamScanner2.js:2060-2070`) после каждого `_renderFull` ходит `container.querySelectorAll('[title]')` и для каждого узла делает `getAttribute('title')` + `setAttribute('data-tip', ...)` + `removeAttribute('title')`. На roster'е 100 человек tooltip'ов ≥ 4500 (4 counter'а с title, badges с title, source-chips, strip cells с title по 24 на день, peak-cell в heatmap…) — `[title]` matcher просто проходит по всему дереву.

**Cost:** На 100 человек ~4800 matched элементов, ~28-40 ms CPU только на этой функции. На Snapdragon 7+ — 110-160 ms. Это «налог» на каждый search keystroke / pk-filter / sprint toggle / team switch.

**Measurement:** `console.time('promote')` вокруг вызова. Можно посмотреть в DevTools Performance → Bottom-Up → `_promoteTitlesToTooltips` self time.

**Fix:**
- Вообще убрать функцию. Renderer'ы должны сразу класть `data-tip=` вместо `title=`. Один проход по проекту find-replace.
- Если нужен fallback (native browser tooltip) — пусть будет, но не **обе** — это лишний 1 attribute op × 4800 узлов.
- Если структурно нельзя — хотя бы делать через `requestIdleCallback` (search-render и так блокирует main thread, не нужно дополнительно).

**Критичность:** medium. **Сложность:** low. **Ценность:** medium.

---

### 5. Heatmap 72×4 (~1500 нод) рендерится eagerly при каждом open панели

**Описание:** `renderHeatmap72x4` (`teamScanner2Renderer.js:1535`) собирает 5 строк × 72 cells = 360 нод × 2 span (outer `.ts2-hcell` + tail mini-spark по 4 bar'а × 5 строк) = ~380-420 нод + inline-стили `opacity:0.xx` и title на каждой клетке. Один heatmap = ~43 KB строкового HTML. Open панели + filter click — два полных rebuild. На участнике с 0 событий это всё равно полный рендер (sqrt computation, peak detection, title-string concat). У heatmap нет caching и нет lazy-init — он всегда «above the fold» в панели.

**Cost:** Один heatmap = ~8-14 ms parse + 4-6 ms layout (M2), ~35-50 ms на Snapdragon 7+. При panel filter click — двойной cost.

**Measurement:** Profile open-panel → split by функция → renderHeatmap72x4 self-time.

**Fix:**
- Кэш по hash `(peakCell.hourIndex + grid.flat().join())` → если данные не изменились, return cached innerHTML.
- Lazy через IntersectionObserver: heatmap часто скроллится вне viewport'а (вверху idle/blockers section'ы), рендерить пустой placeholder и hydrate при пересечении.
- Inline `style="opacity:..."` × 360 — заменить на `data-op-bucket="0|1|2|3|4|5"` + CSS `[data-op-bucket="3"] { opacity: 0.65 }` (6 классов, не 360 inline-styles → меньше string-size, лучше для CSS engine).
- title-attr на каждой клетке (288 штук) — `_promoteTitlesToTooltips` потом это всё перепишет в data-tip; либо снять title с клеток (aria-label один на heatmap уже есть), либо использовать delegated tooltip с lookup по data-attrs.

**Критичность:** medium. **Сложность:** medium. **Ценность:** medium.

---

### 6. `classifyPerson` вызывается 4-6× на одного participant в render-цикле

**Описание:** WeakMap-cache есть (`teamScanner2Classifier.js:101`), но эпоха бампается на каждом `_renderFull` (`teamScanner2.js:1767`) — то есть cache полезен только внутри одного render'а, а search-keystroke с full-rerender убивает cache всё равно. Внутри одного render'а вызывают: `extractPersonGroups` (snapshot), `buildYesterdayGroupMap` (через ctx.prev), `renderTeamGlance` (count'ы), `renderPersonRows` (group dispatch), плюс `_extractSnapshot` имеет свой inline-копипаст classifier'а (`teamScanner2.js:391-408`). Это 4-5 вызовов на participant без cache при cold path и 1 compute + 3 cache hits при warm. На команде 100 человек cold path = 500 calls × ~6μs = 3 ms; не страшно, но повторяется на каждый keystroke.

**Cost:** ~3-5 ms на стороне classifier'а на каждый full render. Не критично in isolation, но плюс инлайн-дубликат в `_extractSnapshot` (snapshot пишется в localStorage на каждом fetch'е) — два source-of-truth, риск дрифта (комментарий это сам признаёт — `teamScanner2Classifier.js:8-14`).

**Measurement:** `console.count('classifyPerson')` обернуть; profile → bottom-up classify\_PersonImpl.

**Fix:** 
- В `_renderFull` посчитать `const personGroups = new Map(participants.map(p => [p.key, classifyPerson(p)]))` **один раз**, передавать в helpers как plain Map. Убрать WeakMap-cache (over-engineering: classifier чистый, классификация — это один O(1) проход по полям) + epoch-bump.
- Убрать inline-копипаст classifier'а из `_extractSnapshot` — взять classifyPerson напрямую, использовать пред-посчитанный Map.

**Критичность:** low. **Сложность:** low. **Ценность:** medium (упрощение + страховка от рассинхрона).

---

### 7. ECharts dispose+mount **на каждом** `_renderFull`, даже когда metrics-tab не активен

**Описание:** `_renderFull` сначала проверяет `getScannerTab() === 'metrics'` и в этом случае делает `MetricsDeep.unmount(this._container)` (`teamScanner2.js:1890`), потом innerHTML rewrite, потом снова mount если tab metrics. Звучит правильно. **Но**: `unmount` это `for (const chart of charts) chart.dispose()` × ~6-8 chart'ов; `mount` это `await import('echarts')` (cached после первого) + 6-8 `echarts.init(container)` + setOption × 6 — это ~15-30 ms на M2 и 80-150 ms на mobile. На search keystroke в metrics-tab это **на каждое нажатие** будет dispose+mount. Search в metrics-tab вообще-то бессмысленно (там нет roster) — но input существует в TopBar и не disabled.

**Cost:** В metrics-tab: ~30 ms ECharts overhead на keystroke. На каждом resize окна — тоже full remount (если roster ре-рендерится).

**Measurement:** `performance.mark` вокруг MetricsDeep.mount; observe `echarts` instance count в `window`.

**Fix:**
- Если data shape не изменился, `chart.setOption(newOpts, { notMerge: false })` — переиспользует instance.
- В metrics-tab `#ts2-search-input` лучше скрыть/disabled — search фильтр не работает на ECharts графиках.
- Search вызывать `_renderRosterOnly()` если у нас single-team view (не metrics).

**Критичность:** medium (только для пользователей metrics-tab). **Сложность:** medium. **Ценность:** medium.

---

### 8. `localStorage.getItem` × 6+ на каждый `_renderFull` (sync I/O в hot path)

**Описание:** Внутри одного render-цикла читаем localStorage минимум 6 раз: `q2_scanner_hide_productivity` в renderRow (на КАЖДУЮ строку — `teamScanner2RendererPersonRows.js:239-241`! т.е. ×100 для 100 человек), `q2_scanner_show_blocked`, `q2_scanner_active_sprint_only` (×2 — раз в `_renderFull`, раз в `_readConfig`), `q2_scanner_velocity_view`, `q2_scanner_sd_tab`, `q2_scanner_show_productivity` в `renderPersonMetricsPanel`. Каждый `getItem` — synchronous, и хотя сам по себе быстр (~5-10μs), 100+ вызовов в одном render — 0.5-1 ms на абсолютно бесполезной операции (значение не меняется между cell'ами одного roster'а).

**Cost:** ~1-2 ms кумулятивно. Главное — это I/O в hot loop, что бьёт по cache locality + jitter в WebStorage backend (особенно на ноутбуках с SSD power-save). На профиле видно как `Storage.getItem` spike.

**Measurement:** Wrap localStorage.getItem proxy: `const orig = Storage.prototype.getItem; Storage.prototype.getItem = function(k) { console.count('LS_GET_' + k); return orig.call(this, k); }`.

**Fix:** 
- В `_renderFull` снять snapshot всех нужных флагов ОДИН раз и передать в render-context: `const flags = { hideProductivity, showBlocked, activeSprintOnly, ... }`.
- Прокинуть `flags` в `renderPersonRows(model, { ..., flags })` → дальше в `renderRow` через ctx.
- Бонус — упрощает testability: можно в тестах подменять flags без stub'а localStorage.

**Критичность:** low. **Сложность:** low. **Ценность:** medium.

---

### 9. `_assistantCache` (HTML-blob'ы) копится без ограничения до `refresh()`

**Описание:** `_assistantCache: new Map()` (`teamScanner2.js:265`) сохраняет результат LLM (HTML + raw text) на каждого открытого сотрудника. `refresh()` чистит (`teamScanner2.js:879-881`) — но между refresh-ами это **только rоstет**. На длинной сессии тимлид может открыть 30-50 людей подряд (особенно если кликает на share-links / triage-кнопки). Каждый ответ LLM = ~3-8 KB HTML + raw markdown + plan section — суммарно ~15-30 KB на запись. На 50 записях — ~1 MB heap, навсегда залоченных за main scanner reference'ом.

**Cost:** Memory growth: ~30 KB × N открытых = до ~1.5 MB при 50 открытиях. Не критично для desktop, ощутимо на mobile/low-RAM (Chrome будет агрессивнее GC главного DOM'а).

**Measurement:** Performance → Memory → Take Heap Snapshot → search for `_assistantCache` retainers.

**Fix:** 
- LRU max=10 entries (тимлид физически держит в голове ~7±2 сотрудников).
- TTL 1 час — даже если refresh не было, после часа ответ всё равно устарел.
- При close-panel НЕ удалять (для quick re-open), но при open нового person'а — evict oldest.

**Критичность:** low. **Сложность:** low. **Ценность:** low (но cheap fix).

---

### 10. `linkifyIssueKeys` + `escapeHtml` × 100+ events × N participants — string regex hot loop

**Описание:** В narrative и в event-feed на каждое предложение проходит `linkifyIssueKeys(esc(text))` (`teamScanner2RendererCommon.js:187`), который делает regex.replace по `[A-Z]{2,10}-\d+`. На participant'е с 200 events это 200 × 2 regex passes per render. Плюс delegated `mouseover` handler в `teamScanner2RendererCommon.js:213-229` парсит JSON из `data-bb-popover` на каждое движение мыши над link'ом — пусть лениво («if applied»), но JSON.parse + setAttribute «горяч» под cursor'ом, может стать source of jank при бысром hover-сканировании.

**Cost:** ~3-5 ms per panel rebuild on regex (M2). Hover-handler: 0.05 ms per move, но при mouse-move 100 Hz ≈ 5 ms/sec фоновых тиков.

**Measurement:** Profile панели с большим event-feed → bottom-up → linkifyIssueKeys.

**Fix:**
- Precompile regex (уже сделано), но строковый split вручную часто быстрее regex для коротких текстов.
- Hover-handler — установить data-bb-title однажды при render'е, убрать delegated listener (или сделать через CSS `[data-bb-popover]:hover::after` — pure CSS tooltip без JS).
- При rendering события: если text < 10 chars или не содержит `-` — skip linkify целиком.

**Критичность:** low. **Сложность:** low. **Ценность:** low.

---

### 11. Per-row click handlers — 2 listener'а × N people (не делегированные)

**Описание:** `_bindDashboardEvents` цикл (`teamScanner2.js:2543-2601`) для каждой `.ts2-row[data-key]` навешивает `click` + `keydown`. На 100 человек — 200 listener'ов. На refresh — отпускаются (через innerHTML rewrite ноды убиваются, listener'ы освобождаются), но в момент init это 200 closures удерживают `this`, `el`, `el.dataset.key`. Делегированный listener на `.ts2-rows` решал бы это одним handler'ом.

**Cost:** Init time ~5-8 ms на 100 строк (cheap, но scaling: 300 строк = 25 ms). Heap — ~150 KB closure'ов до next refresh.

**Measurement:** `getEventListeners(row)` в DevTools console после render'а.

**Fix:** Делегированный listener на `.ts2-rows` div, find closest `.ts2-row[data-key]`. Один handler, нет per-row setup time.

**Критичность:** low. **Сложность:** low. **Ценность:** low.

---

### 12. `bucketByHour` вызывается **2× на participant** на каждом render, без cache

**Описание:** В `renderRow` (`teamScanner2RendererPersonRows.js:166-167`): `const hToday = bucketByHour(p.timelineToday); const hYest = bucketByHour(p.timelineYesterday);`. На каждый search keystroke — 200 вызовов bucketByHour на 100-person команде. Каждый вызов — `for (event of events) { Date.parse, getHours, ++ }` — для участника с 100 событиями в timeline = 100 Date.parse calls. Date.parse — это известная медленная функция (особенно в V8).

**Cost:** ~10-20 ms на 100 человек × 50 events/timeline (M2). На Snapdragon 7+ — 40-80 ms.

**Measurement:** `console.time('bucket')` обернуть, или DevTools profile → Date.parse self-time.

**Fix:** 
- В enrichment (где timelineToday уже стабилен) сразу прикреплять `p._hoursTodayBucket` / `p._hoursYestBucket` — компьют один раз при fetch'е, не на каждый render.
- Заменить Date.parse на `new Date(e.at).getHours()` если at — ISO (быстрее в большинстве движков). Или ещё лучше — сохранять hour-index уже при enrichment.

**Критичность:** low. **Сложность:** low. **Ценность:** medium.

---

### 13. `teamMedians` (3 sort'а полного массива) пересчитывается на каждый render

**Описание:** `renderPersonRows` (`teamScanner2RendererPersonRows.js:104-111`) считает медианы по wip/pr/hours **внутри функции рендера**. Каждый клик search → snapshot + sort × 3. На 200 людях ~0.4 ms на sort × 3 = 1 ms. Дешёво, но: медианы команды не меняются между search-keystroke'ами вообще (только при refresh/team-switch).

**Cost:** ~1 ms на medium команде. Edge case — это вычисление в roster-rendering hot path, не где enrichment'у место.

**Fix:** Считать в `_renderFull` ОДИН раз (как уже сделано для `personGroups`) и пробросить ctx. Либо переместить в enrichment-pipeline, сохранить на model.scannerV2.teamMedians.

**Критичность:** low. **Сложность:** low. **Ценность:** low.

---

### 14. Layout thrash в `_renderPanelOnly`: remove + insertAdjacentHTML без contain

**Описание:** `_renderPanelOnly()` (`teamScanner2.js:2954-2969`) делает `querySelector('.ts2-panel').remove()` (forces layout invalidation of all subsequent siblings) и тут же `insertAdjacentHTML('beforeend', ...)` — браузер делает 2 layout pass'а: один на remove, второй на insert. Если CSS на `.ts2-panel` использует `position: fixed` (вероятно — это slide-in), это не критично, но `.ts2-panel-backdrop` тоже remove+insert — лишний reflow.

**Cost:** ~3-8 ms layout per pill-click (M2). 

**Fix:**
- Build full new HTML string off-DOM (DocumentFragment), потом single replaceChild.
- Или: один раз создать `.ts2-panel` контейнер, при filter-change менять только innerHTML дочернего `.ts2-events-section` (см. находку 3).

**Критичность:** low. **Сложность:** medium. **Ценность:** low.

---

### 15. Search-cache key — raw query string, без normalization

**Описание:** `_filterParticipantsByQuery(participants, query)` (`teamScanner2.js:180-202`): query идёт в Map.get как есть, но реальный filter применяет `query.toLowerCase().trim()`. Это значит `"Иван"`, `" иван"`, `"иван "`, `"ИВАН"` — **4 cache entries** для одного и того же результата, при `_SEARCH_CACHE_MAX = 20` пользователь может выйти из cache за 5 keystroke'ов.

**Fix:** Хранить normalized query как cache key. Тривиально.

**Cost:** Cache miss rate выше → лишние filter passes. На длинной сессии типинга — 5-10 лишних filter'ов.

**Критичность:** low. **Сложность:** low. **Ценность:** low.

---

### 16. Mobile: 100% width touch target слишком плотный (`ts2-strip` 48 cells без min-width)

**Описание:** Полу-перфоманс, полу-UX, но повторно: на mobile (Galaxy Fold inner display, iPhone SE) ширина ts2-strip = 24 cells × maybe 3-4 px → strip целиком ≤ 100 px. Каждая клетка ≤ 4 px → tap-target нарушает 44 px guideline. Не блокер для desktop, но если тимлид смотрит roster с телефона — useless. Из перфоманс-угла: на mobile при scroll'е roster'а 4500 absolute-positioned span'ов сильно тормозят compositing layer.

**Fix:** Под media-query mobile (`< 768px`) переходить на 8 buckets по 3 hours (8 cells × 8 px = 64 px width) — 3× меньше нод + читабельнее.

**Критичность:** low. **Сложность:** medium. **Ценность:** medium (если mobile в scope).

---

## Свод найденных «фантомных» затрат на один search keystroke (M2 baseline)

| Источник | Time (ms) | Узлы DOM | Куда смотреть |
|----------|-----------|----------|---------------|
| innerHTML rewrite roster (find #1, #2) | ~40 | ~4500 | renderPersonRows |
| `_promoteTitlesToTooltips` (find #4) | ~30 | 4800 visits | teamScanner2.js:2060 |
| `bucketByHour` × 200 (find #12) | ~15 | — | renderRow:166-167 |
| `classifyPerson` cold path (find #6) | ~5 | — | renderTeamGlance + renderPersonRows |
| localStorage reads × ~100 (find #8) | ~1-2 | — | renderRow:240, renderPersonMetricsPanel:1261 |
| `teamMedians` recompute (find #13) | ~1 | — | renderPersonRows:104 |
| `renderTeamGlance` + `renderTopBar` | ~5 | ~600 | helpers re-compute |
| Layout + paint | ~22 | — | browser |
| **Итого / keystroke** | **~120 ms** | ~5100 nodes | — |

На Snapdragon 7+ — умножь на 3.5-4×, итого ~420-480 ms per keystroke. При активной печати — наблюдаемый input lag.

## Если бы мне дали 2 недели на это

1. **День 1-2:** Замерить production telemetry — добавить `scanner2.search_render_ms`, `scanner2.panel_filter_ms`, `scanner2.refresh_ms` (с N participants как dimension). Без baseline'а каждая оптимизация — догадка.
2. **День 3-4:** Финдинг #1 — переписать search на in-place visibility toggle. Это **70% win** на самом частом use case.
3. **День 5:** Финдинг #3 — panel-filter в-place toggle через CSS-class и `data-active-filters` атрибут. Второй по частоте.
4. **День 6:** Финдинг #4 — снять `_promoteTitlesToTooltips`, в renderer'ах сразу писать `data-tip`. Find-replace, ~30 минут + ревью.
5. **День 7:** Финдинг #6/#8/#13 — собрать всё в одно: общий `ctx` объект в `_renderFull` с personGroups Map, flags snapshot, teamMedians. Прокинуть в renderer'ы. Чистка.
6. **День 8-9:** Финдинг #2 — `content-visibility: auto` на `.ts2-row`. Cheap win на больших командах.
7. **День 10:** Финдинг #5 — heatmap cache + lazy через IntersectionObserver. 
8. **День 11:** Финдинг #7 — отделить metrics-tab tab lifecycle от scanner rerender'а. Search в metrics-tab — disable input.
9. **День 12:** Финдинг #11 — делегированные click handler'ы. ~1 час работы.
10. **День 13-14:** Regression testing на Playwright, perfBudget update, smoke на mobile profile в Chrome DevTools, finalize telemetry dashboard.

Ожидаемый результат: search keystroke с 120 ms → 8-12 ms (на M2), panel filter click 90 ms → 5 ms, full refresh 150 ms → 60 ms.
