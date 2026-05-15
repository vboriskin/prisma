# П7 — Технические неровности по вкладкам и блокам

> Аудит ~12 400 LOC во `views/*.js` (без `integrationsView.js`, см. отдельный документ).
> Это **не функциональные баги** (есть ли что-то сломано), а инженерные неровности —
> вещи, которые работают, но пилят слух разработчику при чтении кода:
> inline-styles вместо классов, copy-paste, magic numbers, неконсистентные
> подходы к одному и тому же.
>
> Эксперт-роли: senior frontend, design-system architect, perf engineer, code-health auditor.

---

## 1. `views/dashboard.js` (319 LOC)

| # | Проблема | Цитата (`файл:строка`) |
|---|---|---|
| 1 | Inline-styles в template literal вместо CSS-классов: `style="cursor:pointer"` на kpi-card. Везде в проекте курсор задаётся через `:hover`/класс. | `views/dashboard.js:106` |
| 2 | `<table style="width:100%">` хардкодом — должен быть default через `.data-table`. Повторяется 4 раза. | `views/dashboard.js:201, 279, 305, 314` |
| 3 | `<div style="overflow-x:auto">` повторён 4 раза в одном файле, без класса-обёртки. | `views/dashboard.js:243, 279, 305, 314` |
| 4 | `<th style="text-align:left">` копи-пастится 13 раз в одной строке вместо `class="th-l"` в CSS. | `views/dashboard.js:280` |
| 5 | Magic-color hex'ы для прогресс-баров (`#3b82f6`, `#8b5cf6`, `#10b981`, `#f97316`, `#64748b`) — должны быть токены `--release-120-color` и т.п. | `views/dashboard.js:140-144` |
| 6 | Inline `style="padding:20px;color:var(--text-3)"` на empty-state — параллельно есть глобальный класс `.empty-state-inline` (используется один раз в этом же файле). | `views/dashboard.js:303, 312` vs `views/dashboard.js:36` |
| 7 | `escTrunc(r.team,16)` / `escTrunc(r.epic,28)` — magic numbers длины обрезки (16/24/28/40/60), без константы. Те же 16/24/28 встречаются и в kanban/podlozhka. | `views/dashboard.js:231-239` |
| 8 | `body.innerHTML='<div style="padding:20px;color:var(--text-3)">Нет строк</div>'` — не использует общий empty-state-паттерн. | `views/dashboard.js:199` |
| 9 | Полный re-render всех 8 блоков на каждый чих (`render()` zerod вверху). На пустом состоянии чистится 8 контейнеров через `forEach + getElementById` — три DOM-walk-прохода. | `views/dashboard.js:25-56` |

> _Senior Frontend:_ KPI-карточка — паттерн, повторяющийся в `dashboard.js:106`,
> `employees.js:244-247` и `metrics.js:542-548` — но три раза разный markup.
> Должен быть единый `RH.kpiCard({label, value, variant})`.

---

## 2. `views/registry.js` (876 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Forced reflow намеренный: `void tbody.offsetHeight` для рестарта анимации — оправдано, но без комментария о trade-off (animations-cost vs паузы UI). | `views/registry.js:230` |
| 2 | Огромный SVG inline в th-кнопке pin (~25 path/attr) дублируется на каждый рендер каждой колонки — выделить в `<symbol>` + `<use>`. | `views/registry.js:122` |
| 3 | Inline-styles `style="min-width:${w}px;width:${w}px;${stickyLeft}"` — нормально для динамики, но плодит длинные strings. На 100 строк × 30 столбцов × 2 атрибута это 6k inline-style-string. | `views/registry.js:121, 204, 281` |
| 4 | DOM-конструирование смешано с innerHTML: `tr=document.createElement('tr')`, потом `tdAct.innerHTML='<svg>...'` для иконок copy/del — два разных подхода в одном цикле. | `views/registry.js:266 vs 296-298` |
| 5 | Drag-and-drop колонок построен «руками» (`dragstart/dragover/dragleave/drop`) — параллельно в `app/appSettings.js:511,563` живёт другой DnD-паттерн для sortable nav. Разные реализации одной и той же задачи. | `views/registry.js:168-183` vs `app/appSettings.js:511` |
| 6 | На каждый рендер заголовка `attach…EventListener` × N колонок — без guard-флага. Для th-resize только handle.classList.add — нет cleanup, утечки слушателей если render вызовется без полного reset. | `views/registry.js:186-218` |
| 7 | Inline `style="font-size:12px;color:var(--text-3)"` в подписи «px» резолвера — нет класса `.col-resize-px`. | `views/registry.js:735` |
| 8 | `onclick = ` overwrite-pattern на `selectAllCb`/делегировании — это норм, но в той же функции выше используются `addEventListener`-цепочки для th. Несконсистентно. | `views/registry.js:130-141` |
| 9 | Magic 36px (initial-left для pinned offset) — без токена и без комментария «width of #/checkbox column». | `views/registry.js:72` |

> _Performance engineer:_ при перерендере таблицы очищается ВСЯ tbody через
> `tbody.innerHTML=''` (строка 227), даже если изменилась одна строка.
> Есть точечный API `findRowEl()`/`updateRowVisual()`/`updateRowRiskCell()` — но
> вызывается только из bulk-edit-обработчиков; обычный render бьёт по всему
> body. На 500 строк это видимо в paint profile.

---

## 3. `views/gantt.js` (2331 LOC) + `views/gantt/aux.js` (372 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | `_wtColors` — захардкоженная карта на 9 hex (`#3b82f6` etc.), та же карта дублируется в `views/timeline.js:44-48` и в `views/metrics.js:469-481` (через emoji-функцию). | `views/gantt.js:632-647` vs `timeline.js:44`, `metrics.js:469` |
| 2 | `wtEmoji()` определена в gantt.js, в metrics.js, в gantt/aux.js — три почти-идентичных копии. | `gantt.js:632`, `metrics.js:468-482` |
| 3 | Inline `style="background:hsl(${hue},58%,52%)"` для `v16-team-rail` — magic colour-formula, не через CSS hue-rotate / token. | `views/gantt.js:973` |
| 4 | Inline `style.cssText='position:fixed;top:${py}px;left:${px}px;z-index:9999'` для popup picker'а — z-index magic, нет CSS-класса `.gdt-floating-picker`. | `views/gantt.js:1640` |
| 5 | Тот же inline контекстное меню: `style.cssText="position:fixed;top:${e.clientY}px;left:${e.clientX}px;z-index:9999;visibility:hidden"`. Z-index 9999 руками, рядом 10000 для drag-ghost. | `views/gantt.js:1806, 2164-2166` |
| 6 | Inline `box-shadow:0 4px 16px rgba(0,0,0,.25)` на drag-ghost — то же значение есть в CSS-токенах. | `views/gantt.js:2166` |
| 7 | `monkey-patch` `GanttView.renderChart`: оборачивается оригинал в свой wrapper для setupRoving. Хрупкий паттерн — лучше hook-callback. | `views/gantt.js:135-143` |
| 8 | `formatLongRange` парсит `DD.MM–DD.MM` regex'ом и пересобирает; в этом же файле другой `_shortPeriod` собирает `DD.MM—DD.MM` (другой dash!) из ISO. | `views/gantt.js:61-69, 663-674` |
| 9 | `pl(n, forms)` — самопальная плюрализация. В чате есть тот же алгоритм; в `insightsDashboards.js:222` — четвёртая ad-hoc копия (`p.breadth === 1 ? 'проект' : (p.breadth < 5 ? 'проекта' : 'проектов')`). | `views/gantt.js:45-52` vs `insightsDashboards.js:222` |
| 10 | `aux.js:openHistoryModal` использует `document.body.insertAdjacentHTML('beforeend', html)` каждый раз → мусорные узлы остаются если `.remove()` не отработает. И там же **вторая** реализация Esc-handler-через-named-function (повторяется в `openAddEpicModal`). | `views/gantt/aux.js:80-84, 165-171` |

> _Design-system architect:_ Гант — самый болезненный пример «свой подход
> на каждый случай». 11 inline gradient/shadow конструкций, 3 разные функции
> формата даты, два set'а pill-классов (`gdt-pill-*` и `gantt-type-pill*`).
> Нужен либо `views/gantt/styles.css` извлечённый, либо строгий гайд «никаких
> inline style.cssText в render-path».

---

## 4. `views/kanban.js` (125 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Карточка собирается через `card.innerHTML=...` со встроенными emoji (🚧, 🔵, 🟢, ✅, 🟡, ⚠️) — параллельно brandbook требует «без эмодзи в production UI». | `views/kanban.js:97-100` |
| 2 | `<span class="chip chip-red">🚧${...}</span>` — один и тот же блокинг-чип строится в `kanban.js:97`, `dashboard.js`, `registry.js`, `timeline.js` подложке. Должен быть `RH.blockingChip(row)`. | `views/kanban.js:97` vs `views/timeline.js:189` |
| 3 | Inline `style.cssText='padding:8px;font-size:11px;color:var(--text-4)'` для «...ещё N» footer'а. Без класса. | `views/kanban.js:109` |
| 4 | Магические лимиты: `slice(0,100)` для карточек в колонке — без константы и без UX-предупреждения «показано 100 из 250». | `views/kanban.js:77, 109` |
| 5 | Полный `board.innerHTML=''` + `appendChild` цикл на каждый drop. Move одной карточки = re-render всей доски. | `views/kanban.js:28, 75 (KanbanView.render())` |
| 6 | Поле `card.dataset.rowId` устанавливается, но click-handler на карточку не привязан — карточка только draggable. На drop логика выясняет источник через `_drag` state. Если drag прервался — `_drag` остаётся stale до следующего dragstart. | `views/kanban.js:88, 102-106` |

---

## 5. `views/timeline.js` (218 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | 27 inline-style вхождений (рекордсмен после ganttHtmlExport.js). Большинство — повторяющийся `style="width:120px;font-size:11px;font-weight:600;color:var(--text-3);text-align:right;flex-shrink:0"` 4-кратно. | `views/timeline.js:77, 85` |
| 2 | Inline magic colors `#059669, #9ca3af, #d97706` для scope-bar'ов — те же значения есть в dashboard release-card-color и в metrics.js scopeMix. Не через токен. | `views/timeline.js:87, 90` vs `views/metrics.js:436-438` |
| 3 | Progress-bar-внутри-секции собран ad-hoc: `<div style="height:6px;background:var(--border-light);border-radius:3px;...">` — рядом в проекте есть `.progress-bar-wrap` (dashboard) и `.mini-progress` (metrics) — три разных progress-bar в одном проекте. | `views/timeline.js:69-70` |
| 4 | `_wtColors` — отдельная локальная копия 9-цветной карты. См. п.3.1. | `views/timeline.js:44-48` |
| 5 | `<span style="font-size:10px;font-weight:400">${s.dates}</span>` — magic 10px, не через CSS-класс subtitle. | `views/timeline.js:65` |
| 6 | В detailed-режиме row, у которого `cnt===0`, рендерится ПУСТЫМ inline-bar'ом с `width:100%` и `background:var(--border-light)` — это и есть «empty-bar», но визуально неотличимо от заполненного шкалы. Magic поведение без класса `.timeline-bar-empty`. | `views/timeline.js:106` |

---

## 6. `views/employees.js` (793 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Локальный `_esc()` дублирует `Utils.escapeHtml` (строка 19-21). В проекте уже есть `dashboard.js:19`, `history.js:13`, `metrics.js:21` — пять копий одной escape-функции. | `views/employees.js:19-22` |
| 2 | `_escAttr = _esc` — одно и то же экранирование для текста и атрибутов. Для атрибутов нужно ещё бить `'` (учтено), но псевдоним создаёт ложное ощущение разных функций. | `views/employees.js:22` |
| 3 | Empty-state в этом view сделан с `prizmaEmptyGlyph()` + кастомным div'ом `.empty-state` — другой формат чем в dashboard (`empty-state-inline`). | `views/employees.js:256-257` vs `views/dashboard.js:36` |
| 4 | Inline `style="font-size:10px;opacity:.7;margin-left:4px"` на drill-down-каунтере — без класса. | `views/employees.js:442` |
| 5 | `alert('CSV пустой')` / `alert('Положите libs/xlsx.full.min.js рядом с index.html')` — native `alert` параллельно с custom `showToast`/`ConfirmDialog`. Inconsistent UX. | `views/employees.js:732, 758, 769, 775` |
| 6 | `_renderControls` делает `direct addEventListener` потому что «inputs are few and have heterogeneous semantics» — но соседний `_buildFioInput` тоже direct, и вообще DOM-конструирование. Зачем тогда вообще общий `bar.innerHTML = ...`? Микс HTML+DOM-API. | `views/employees.js:185-200` |
| 7 | Magic 6 — порог `isOverloaded = empLoad.total >= 6` в коде, не в `constants.js`. | `views/employees.js:429` |
| 8 | `EmployeesView.render()` дёргается на каждый change input'а — full re-render таблицы из 100 сотрудников при правке одной FIO-ячейки. Никакого partial update. | `views/employees.js:281-287` |

---

## 7. `views/aiCeoView.js` (402 LOC) и `views/aiView.js` (350 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Два почти-идентичных файла: оба строят `system + user msg`, оба парсят `text.match(/\{[\s\S]*\}/)`, оба `JSON.parse(match[0])`, оба обрабатывают `direct vs proxy` mode. ~80 LOC duplicated. | `aiView.js:74-138` vs `aiCeoView.js:91-158` |
| 2 | `applyFilter` функция есть и там и там, с почти идентичными условиями (`if filterPayload.team !== undefined ...`). | `aiView.js:157-174` vs `aiCeoView.js:178-195` |
| 3 | `showExplain` в aiView использует `alert(lines)` как fallback! `views/aiView.js:201`. — единственный native alert в analytics-вью. | `views/aiView.js:201` |
| 4 | Modal `modal-kpi` шарится между Dashboard KPI и AI-view explain — это видно по тому что у него есть `data-owner="dashboard"` атрибут. Один модал = два разных «контракта» использования. | `views/aiView.js:194-200` vs `views/dashboard.js:166-198` |
| 5 | Inline `<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px">` для explain-блока вместо `.modal-pre`. | `views/aiView.js:198` |
| 6 | LLM-ответ парсится через regex `/\{[\s\S]*\}/` без проверки структуры (только `typeof parsed.summary !== 'string'`). На malformed ответе UI получит частичные данные. | `views/aiView.js:128-134` |

> _Code-health auditor:_ aiView и aiCeoView — кандидаты на extract-common
> в `ai/llmClient.js`. Плюс пара `applyFilter()` идентична логике в
> `chat/*` — три места меняют `state.filters` руками. Должен быть единый
> `FiltersUI.applyPayload()`.

---

## 8. `views/metrics.js` (878 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Inline conic-gradient `style="background:conic-gradient(${pieStops})"` — три разных места строят pie-chart как inline gradient вместо `<canvas>` или SVG. | `views/metrics.js:224, 311, 556, 688` |
| 2 | 4-стоповый ring-gradient в один inline-стайл: `conic-gradient(#6366f1 0 ${progress}%, #ef4444 ..., #f59e0b ..., #1f2a44 ...)`. Magic colors + сложная inline-расчёт-логика в template literal. | `views/metrics.js:688` |
| 3 | `mini-progress` (один паттерн) против `progress-bar-wrap`/`progress-bar-fill` (dashboard) и inline `<div style="height:6px;...">` (timeline) — **три разных progress-bar реализации**. | `views/metrics.js:72, 85, 139, 161, 567` vs `dashboard.js:154-155` vs `timeline.js:69-70` |
| 4 | Sparkline хардкодит размеры `sparkW=440,sparkH=120,sparkPad=16` — magic numbers, не зависят от viewport. | `views/metrics.js:518` |
| 5 | `dayKey()` локальный и снова дублируется в `app/historyManager.js`/`historyLog.js`. Должна быть одна `Utils.dayKey()`. | `views/metrics.js:505` |
| 6 | `splitTags` определена 4 раза в проекте: `metrics.js:350`, `employees.js:41`, `summary.renderDetailed`, `dashboard.js` (через filter). Один и тот же regex `/[|,]/`. | `views/metrics.js:350` |
| 7 | `releases` color-палитра захардкожена и **отличается** от dashboard! В dashboard `r120 = #3b82f6`, тут `r120 = #6366f1`. Нет единого источника истины. | `views/metrics.js:369-372` vs `views/dashboard.js:140-143` |

---

## 9. `views/insightsDashboards.js` (356 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Подобная плюрализация in-place: `${p.breadth === 1 ? 'проект' : (p.breadth < 5 ? 'проекта' : 'проектов')}` — пятая копия pl-функции. | `views/insightsDashboards.js:222` |
| 2 | Все 4 view (`EstimationCalibration`, `ComponentHealth`, `BurnoutWatchtower`, `DocDebtConsole`) имеют одинаковый `if (!m) { root.innerHTML = _renderNoData(...) }` boilerplate. Можно обернуть в HOF. | `views/insightsDashboards.js:64-66, 127, 174, ...` |
| 3 | `_fmtH(ms)` — единственная локальная функция формата длительности (часы из миллисекунд). Нет общего форматтера времени в `Utils`. | `views/insightsDashboards.js:33` |
| 4 | Inline `style="font-size:11px;color:var(--text-3)"` на reviewer-stats note — есть класс `.insights-dash-hint`, но он же используется ВЫШЕ для того же visual-style. | `views/insightsDashboards.js:213` |
| 5 | CSS-семья `.ts2-sd-*` и параллельно `.insights-dash-*` — две family для одного фичерсета (см. комментарий в начале файла). | `views/insightsDashboards.js:13` |

---

## 10. `views/history.js` (221 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Локальный `fmtDateTime` использует `toLocaleString('ru', {day:'2-digit',...})` — НЕ совпадает с форматом `errorsView.js:30` `toLocaleString('ru')` (без options) и не с `gantt/aux.js:48` (`'ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}` — без секунд). Три разных формата времени в трёх местах. | `views/history.js:24-30` vs `views/errorsView.js:30` vs `gantt/aux.js:46-49` |
| 2 | `fmtRelative` ad-hoc (мин/ч/дн) — нет `Intl.RelativeTimeFormat`. | `views/history.js:32-41` |
| 3 | Категория icon'ы — emoji map (`'📊', '🤖', ...`). Параллельно рядом видно policy «без эмодзи в production». | `views/history.js:15-22` |
| 4 | `hist-stat-card` — кнопка с `--stat-color` через inline `style` (по-нормальному, через CSS-var) — но семантика «кнопка для toggle filter» дублирует поведение selector'а `<select>` выше. Два контрола делают одно. | `views/history.js:86-92, 191-197` |

---

## 11. `views/errorsView.js` (180 LOC)

| # | Проблема | Цитата |
|---|---|---|
| 1 | Снова локальный `_esc` — копия №6. | `views/errorsView.js:18-22` |
| 2 | `_fmtTs` — четвёртый ad-hoc форматтер времени. | `views/errorsView.js:24-34` |
| 3 | Tabs-фильтр по уровню реализован через `data-errlog-level` + ручной `classList.toggle('errlog-tab-active', ...)` — параллельно в `gantt.js`/`metrics.js` есть свои tab-системы (`mode-toggle`, `density-toggle`). 3 разных tab-импла. | `views/errorsView.js:135-143` |
| 4 | Subscribe-pattern `ErrorsLog.onChange` правильный, но cleanup только при перезаписи `_unsub`. Если view удалится без render — leak. | `views/errorsView.js:71-77` |
| 5 | Иконка очистки — emoji `🗑`, экспорт — `⤓` (символ). Не из единой icon-системы. | `views/errorsView.js:91-92` |

---

## Общие недуги (cross-view)

### A. Copy-paste

| # | Что | Где |
|---|---|---|
| A1 | `_renderPrizmaHeader`/`_injectPrizmaHeader` хелпер скопирован буквально 6 раз: `dashboard.js:60`, `registry.js:35`, `kanban.js:115`, `gantt.js:29`, `timeline.js:16`, `metrics.js:23`, `employees.js:203`. | 7 файлов |
| A2 | Локальный `esc/_esc` определяется в каждом view (10 копий), вместо общего экспорта. | См. таблицы выше |
| A3 | `splitTags(v) { return String(v\|\|'').split(/[\|,]/).map(...).filter(Boolean) }` — 4 копии. | `metrics.js:350`, `employees.js:41`, `summary` |
| A4 | `wtEmoji` — 3 копии. | `gantt.js:632`, `metrics.js:468`, etc. |
| A5 | `applyFilter(payload)` — 3 копии (aiView, aiCeoView, ChatPanel). | См. п.7.2 |
| A6 | Pluralizer (1/2-4/5+ задач) — 5 копий. | `gantt.js:45`, `insightsDashboards.js:222`, etc. |

### B. Magic numbers (без источника)

| Где | Что | Цитата |
|---|---|---|
| Truncate-длины | 16/18/20/24/28/40/60 | `dashboard.js:231`, `kanban.js:91`, `timeline.js:106` |
| z-index'ы | 9999, 10000, 10500 | `gantt.js:1640, 1806, 2164`, `index.html:191` |
| Slice-лимиты | 50/100/500/30 | `dashboard.js:307`, `kanban.js:77, 109`, `gantt/aux.js:52` |
| Pixel sizes | 220/420/200/36/8 | `gantt.js:783-789`, `registry.js:72` |
| Color-hex повторы | `#3b82f6` ≠ `#6366f1` для одного и того же r1.20 | `dashboard.js:140` vs `metrics.js:369` |

### C. Inline-style hot-spots

Подсчёт `grep -c 'style='`:

| File | Кол-во |
|---|---:|
| `metrics.js` | 40 |
| `timeline.js` | 27 |
| `gantt.js` | 17 |
| `dashboard.js` | 14 |
| `registry.js` | 10 |
| `ganttHtmlExport.js` | 9 |

Senior-frontend норма для ~3000 LOC view — менее 10. Любой view выше 15 — явный кандидат на extract-в-CSS.

### D. Forced reflow / sync layout reads

| Где | Что |
|---|---|
| `registry.js:230` | `void tbody.offsetHeight` — намеренный reflow для restart-CSS-animation. Можно через `animationend` + `removeClass`. |
| `gantt.js:225-228` | `wrap.getBoundingClientRect()` затем перебор `.querySelectorAll` детей с `el.getBoundingClientRect()` — read-after-write если в loop. |
| `gantt.js:2157-2158` | `srcPill.getBoundingClientRect()` + `dstCell.getBoundingClientRect()` подряд — на drop-анимации. Норм, но нет batch'а. |

### E. Lifecycle leaks

| Где | Что |
|---|---|
| `registry.js:186-218` | th-resize handler не cleanup'ится при render. Mitigate флагом `tbody._delegated`, но для thead аналогичной защиты нет. |
| `errorsView.js:71-77` | `_unsub` живёт пока new render не перезапишет; если section спрятан — slice-of-state-listener висит. |
| `gantt/aux.js:84,171` | `document.addEventListener('keydown', escClose)` — снимается на close, но если modal удалили через DOM-mutation помимо `close()`, listener останется. |
| `kanban.js:_drag` | Stale-state `{rowId, sourceCol}` если drag прерван (alt+tab, scroll-out). Нет dragend cleanup в global scope. |

### F. Несконсистентные naming-conventions классов

- BEM-подобные: `.kpi-card.kpi-green`, `.progress-card-header` (kebab-case 2 слова + модификатор)
- Префиксные: `.gdt-pill-progress`, `.gex-cell-team`, `.ts2-sd-row` (3-letter prefix + dashes)
- Аббревиатурные: `.hist-entry-icon`, `.errlog-tab-active`
- Wrapped с числом версии: `.v16-team-spark`, `.v16-team-rail`

Один проект — 4 разных «системы» class-naming. Дизайн-система зарезает выбор.

---

**Резюме П7:** проект — типичный 12k-LOC vanilla-JS с органическим ростом.
В каждой view есть 5-10 видимых неровностей. Самые болезненные: 6 копий
`_renderPrizmaHeader` (можно собрать в helper за 30 мин), 5 ad-hoc плюрализаторов,
3 разных progress-bar, 3 разных date-time форматтера, 27 inline-style в `timeline.js`.
Это не баги — это пунктики. Но для команды на 6 человек и +1 LLM-агент это
12k LOC замедляет каждое следующее изменение на 10-15%.
