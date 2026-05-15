# Codebase — производительность

> Performance engineer аудит. Render perf, scroll perf, layout thrashing, large lists, animation jank.
> Дата: 2026-05-07

| ID | Sev | File:line | Bottleneck | Impact (estimate) | Fix |
|---|---|---|---|---|---|
| **P1** | **CRIT** | `views/registry.js:244-323` | `renderBody`: `tbody.innerHTML=''` + создание ~10–15 элементов на строку через `createElement` без виртуализации; на 5k строк = ~75k DOM-нод за кадр | 800–1500 ms / кадр на 5k×17 cols; layout > 200 ms; freeze main thread | Виртуальный скролл (windowing, render only ~30 видимых рядов); IntersectionObserver или `tanstack/virtual` подобный rolled-own |
| **P2** | **CRIT** | `views/registry.js:252` | Преднамеренный `void tbody.offsetHeight` — forced reflow перед каждым rebuild ради re-trigger CSS-анимации | +30–60 ms на 5k строк (sync layout) | Убрать reflow-trigger и анимировать только новые `<tr>` через `animation-delay: var(--i)` с `prefers-reduced-motion`; либо включать класс через `requestAnimationFrame` |
| **P3** | HIGH | `index.html:1594` | `libs/xlsx.full.min.js` (~952 KB) грузится синхронно blocking-script на boot, хотя нужен только при импорте/экспорте | +300–800 ms на parse+eval (на медленном CPU) перед FCP | `<script defer>` + динамический `import()` при первом клике на `#input-xlsx`/`#btn-export-xlsx` (паттерн уже использован для echarts в `metricsDeep/index.js:94`) |
| **P4** | HIGH | `views/gantt.js:1504` | `wrap.innerHTML = ...` целиком пересобирает Gantt-DOM на каждый drag/drop/delete | 200–700 ms для проекта 100 эпиков × 5 колонок | Incremental update: пересобирать только затронутую колонку/эпик-row; держать стабильные `data-row-id` и diff-апдейт |
| **P5** | HIGH | `views/gantt.js:2610-2622, 1502, 2015, 2288` | Цепочки read→write DOM (getBoundingClientRect → append → измерение), `_prevHeight = wrap.offsetHeight` сразу перед `innerHTML=` | 5–20 ms каждое, накапливается при drag/menu-open | Батчить через `requestAnimationFrame`: read-фаза → write-фаза; кэшировать rect'ы во временную карту |
| **P6** | HIGH | `reactiveStore.js:47` + `app.js:2077` | Каждая мутация state триггерит `App.refreshAll()` → `renderSection()` целого section, debounce всего 100 ms | Bulk-edit на 50 строках = серия 50 ms-перерисовок registry/gantt | Поднять debounce до 200–250 ms; добавить «coalesce by section» — один render на section за tick; во время `bulkEdit` оборачивать в `Reactive.silent` + явный `flushNow` в конце |
| **P7** | MED | `views/employees.js:309-332` | Teams-summary: для каждой команды × 12 метрик новый `tr.filter(...)` (≈12×N сканов), плюс `innerHTML` на весь host | 30–80 ms на 30 команд × 5k rows | Single-pass агрегация в `Map<team, counters>` за O(N), потом render |
| **P8** | MED | `filters.js:36-86` | `getFiltered` рассчитывает predicate с `[...row.release120Types,...]` спред + `.split(/[|,]/)` для tag/role/assignee на КАЖДУЮ row при каждом `_cacheKey` miss; `cache_hash` зависит от `_dataVersion` — любая мутация invalidates | 40–120 ms на 5k rows; 3-4× вызовов на refreshAll | Денормализовать tags/roles/assignees в `Set<string>` один раз в `rowFactory` (или ленивым геттером с memo), убрать spread в горячем пути; precompute `allTypes` |
| **P9** | MED | `views/registry.js:528` | `<datalist>` пересобирается полным `innerHTML` со всеми unique values при каждом focus в текстовое поле | 5–15 ms × N input focus | Кэшировать datalist по `col.key` + `_dataVersion`; пересобирать только при invalidation |
| **P10** | MED | `styles.css` (~19k LOC, 241 `@keyframes`) | `will-change` всего 6× — почти не используется на анимируемых pills/loaders | Лишние paint-areas, jank на скролле gantt с активными breathe-анимациями | Аудит: оставить keyframes только для активных эффектов; на pills/skeleton добавить `will-change: transform, opacity`; для off-screen контейнеров — `content-visibility: auto` |
| **P11** | LOW | `views/dashboard.js:80-553` | Dashboard рендерит KPI/teams через 6+ независимых `innerHTML` блоков; cache-hash есть, но overall — full rewrite | 50–150 ms при switch на dashboard | Сохранить cache-hash; рендерить только секции с изменённым hash, не весь host |
| **P12** | LOW | `index.html` 7 sync `<script>` (xlsx + 2 modules + inline) | Boot waterfall: xlsx (~300 ms) → history.js → csv-stream-exporter.js → app.js (module graph) | +0.5–1.0 s до интерактивности | `defer` + `type=module` для всего; убрать xlsx из boot-пути |
| **P13** | LOW | `views/registry.js:318-321` (per-row inline `<svg>`) | На каждый `<tr>` парсятся 2 копии inline-SVG (copy/del icons) | +1–3 ms на 1k строк | `<template>` или `Icons.get(...)` (используется в gantt:1574); либо `<symbol>` + `<use>` |

## TL;DR

Критичны три вещи:
1. **Registry без виртуализации** на 5k rows блокирует main thread на ~1–1.5 с,
2. **xlsx грузится sync на boot** — лишние ~300–800 ms до интерактива (хотя у проекта уже есть паттерн lazy `import()` для echarts),
3. **Gantt full-innerHTML rebuild** на каждое мелкое действие.

Reactive debounce 100 ms слишком агрессивен для bulk-операций. CSS — 241 keyframes без `will-change`, риск paint-jank.
