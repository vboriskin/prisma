# Виктор Демин — Гант: технический аудит

> Ex-Asana Gantt tech-lead, 12 лет на planning-tools (Asana → GanttPRO → MS Project online). Спец по timeline-рендерингу, виртуализации и dependency-arrows.
> Смотрел: `views/gantt.js` (2924 LOC), `views/gantt/{aux.js,legendContent.js}`, `views/ganttHtmlExport.js` (1104 LOC), `dependencyEngine.js`, `state.js`, `reactiveStore.js`, `tests/unit/{ganttParse,ganttHtmlExport,v17AuditFixes,rowFactoryV14}.test.js`, `eslint-rules/`, `constants.js` (Gantt-зона).

---

## TL;DR

1. **«Гант» — это не Gantt.** Это bucket-вью (Backlog / 1.20 / 1.21 / 1.22 / OT) с пилюлями типов работ. Нет timeline-bar по длительности, нет inter-task dependency-arrows. `state.epicDeps` существует, но в `views/gantt.js` не упоминается ни разу. Линейному PM это нужно объяснять при онбординге — иначе он ищет «таймлайн со стрелочками» и не находит.
2. **Монолит `renderChart` 2200 LOC закладывает временно́й долг S2-уровня.** Закрытая funcция renderChart + renderDetailedTasks читает/связывает контекст-меню, drag-drop, keyboard-DnD, resize-handlers, ResizeObserver, tooltip — в одном scope. Любая правка ломает 3 не связанных пути. В `aux.js` отщеплено 4 утилиты, но горячий путь не тронут (комментарий L7 явно: «отложено в V19»).
3. **Hard-coded даты релизов и timeline-start 2025-04-01.** `constants.js:197–203` — TIMELINE_START/END в 2025 году (сегодня 2026-05-15), `views/gantt.js:776–778` — `sub:'20.04–17.05'` строкой. Year-rollover guard для today-pill добавили (QA A4.2), но базовые границы не переезжают между кварталами без редактирования constants.js. Перенос на Q3/Q4 = ручная правка нескольких файлов.
4. **Утечка через HTML-export — нет `_scrubSecrets`.** `views/ganttHtmlExport.js:1006` клонирует живой DOM и выдаёт `Blob`-ссылку на скачивание. Через `row.transferComments[].text`, `row.epic`, `row.doneComment` пользователь может вставить произвольный текст. Контракт #3 из CLAUDE.md прямо требует `CSV._scrubSecrets` на любом export-path — в gantt-export его нет. S0/S1 граница.
5. **Frame-budget на 1000+ строк не выдержит.** Полный rebuild `wrap.innerHTML` на каждое действие (drop, ctx-click, +, resize), без виртуализации, без diffing. На 30 команд × 30 эпиков × 10 пиллов = ~9000 нодов. Замеры замеряли, но архитектурно — не масштабируемо за пределами ~50 команд.

---

## Critical (S0)

### C1. Gantt HTML-export не проходит `_scrubSecrets` — нарушение контракта #3
`views/ganttHtmlExport.js:1006–1098` — `wrap.cloneNode(true)` + `cloned.outerHTML` + блок с `_buildAssigneeSummary(rows)` / `_buildUnassignedSummary(rows)` идут наружу. `rows` — это сырой `state.rows`. В `transferComments[].text`, `doneComment`, `assigneePills[*]`, `epic`, `team`, `tasks` (полу-свободные строки) пользователь способен вставить токен/пароль (хоть случайно, хоть как UAT-baseline).

Что плохо: CLAUDE.md §«3 контракта»:
> Все экспорты (CSV / JSON / bundle) ОБЯЗАНЫ проходить через `CSV._scrubSecrets()`. Любой новый export-path без него = security regression.

Я не нашёл ни одного вызова `_scrubSecrets` в `ganttHtmlExport.js`. По коду в `dataStore.js:378` — функция доступна, но gantt-export её не зовёт.

Impact: shareable .html передаётся вне периметра (по почте / в Confluence / на ноут юзера). Один Bearer-token в комментарии «перенесли с 1.20 — Bearer xyz...» — и он gone.

Направление фикса: пропускать всё user-controlled content `_scrubSecrets`-эквивалентом + regex-стрип (`/(Bearer|token|password|apikey)/i`) на тексте перед `esc()`. Тестом покрыть.

### C2. `row.ganttArrows.push(...)` — мутирует proxy-массив, Reactive.set-trap не срабатывает
`views/gantt.js:876, 889, 892, 2173–2175, 2645` — паттерн `if (!Array.isArray(row.X)) row.X = []; row.X.push(...)`. Внутри Reactive Proxy `push` идёт через `Array.prototype.push`, который интернально читает `length` и присваивает new index — но это происходит на raw-target внутри обёртки, и поведение зависит от того, является ли `row.X` уже proxy-обёрткой или raw-ссылкой.

Что плохо: в `reactiveStore.js:122` set-trap триггерит `_markDirty()` только при `Reflect.set(target, key, ...)`. При `arr.push(x)` Proxy-handler видит set('0', x) + set('length', 1) на сам массив — но только если `arr` — это **Proxy**. В коде после `row.ganttArrows = []` обратное чтение `row.ganttArrows` возвращает обёрнутый Proxy (см. `_handler.get` в `reactiveStore.js:110–121`) — так что в принципе push должен триггерить flush. **НО** в этом коде сразу после push явно зовётся `Storage.save()` (L897), и `App.refreshAll` вообще не нужен — render идёт через явный `GanttView.renderChart()`. Это work-around, который случайно работает.

Impact: если кто-то добавит ещё одно место с `.push()` и забудет `Storage.save()` — изменения потеряются между перезапусками. Нет ни инварианта в коде, ни теста.

Направление фикса: либо `row.ganttArrows = [...row.ganttArrows, newItem]` (immutable reassign — сет-трап гарантированно срабатывает), либо завести invariant + lint-rule «после `.push/.splice` на `state.*` обязателен `Storage.save()` ИЛИ `Reactive.notifyManual()`».

### C3. `wrap.innerHTML = ...` уничтожает все listener'ы — слушатели в `bindKeyboardNav` / `bindJumpPalette` тогда мёртвые ссылки
`views/gantt.js:1595` `wrap.innerHTML = '<div class="gantt-container ...">...'`. Сразу после этого код вешает `addEventListener` на каждый pill, cell, resize-handle (L1740, L1756, L2198, L2246, L2794). Это работает только потому, что слушатели вешаются **каждый renderChart**.

Но `bindKeyboardNav` (L167) и `bindJumpPalette` (L358) вешают listener'ы на **`document`** (L370–391, L370 keydown) — это глобально, через `_kbBound` / `_jumpBound` guard. Когда `renderChart` снёс DOM, замыкания внутри document.addEventListener('keydown', ...) держат **старые ссылки на старые pill-узлы**, которые уже отсоединены от документа.

`allPills()` на L173 — function() вызывается заново при keydown → возвращает свежий список. Так что **сейчас работает**. Но `setupRoving` на L199 вызывается один раз в bind + перевешивается через monkey-patched `renderChart` (L209). Эту monkey-patch конструкцию (`GanttView.renderChart = function(...) { ... }`) ужасно тяжело отлаживать.

Что плохо: **monkey-patch instance-метода в bind-функции** (`views/gantt.js:206–214`):
```js
const _origRender = GanttView.renderChart;
if (!GanttView._kbWrappedRender) {
  GanttView._kbWrappedRender = true;
  GanttView.renderChart = function (...args) { ... };
}
```
Если `bindKeyboardNav` вызвать дважды — guard `_kbWrappedRender` спасает, но если бы guard забыли, был бы recursive wrap.

Impact: на сегодня — рабочее, но это **timing-bomb для будущего рефакторинга**. Любой, кто перепишет renderChart в стрелку или вынесет в импорт, сломает keyboard-nav без видимой ошибки.

Направление фикса: вынести «hook-after-render» в первоклассный API (`GanttView._postRenderHooks.push(setupRoving)`), вызывать в конце `renderChart` явно.

### C4. `_scrubSecrets` пропуск + `Utils.escapeHtml` на user-text — XSS-граница тонкая
`views/gantt.js:404` `const esc = (s) => Utils.escapeHtml(s == null ? '' : String(s));`. Большинство мест используют `esc()`, но я нашёл два места где НЕ:

- `views/gantt.js:1408` — `<span class="v16-epic-meta">${esc(_epicMeta)}</span>` — это ok, тут esc есть, оба `_epicMeta` собран из чисел.
- `views/gantt.js:2333` — `<td class="gex-cell-period">${escH(t.workStart || '?')} → ${escH(t.workEnd || '?')}</td>` — ok.

В целом всё escape'нуто, но в **`drawPostponeArrows`** (`views/gantt/aux.js:298–304`) выражение `wrap.querySelector(`.gdt-trail-src[data-row-id="${cssEsc(rowId)}"][data-arrow-at="${cssEsc(at || '')}"]`)` использует `cssEsc` — `window.CSS.escape ?? `String(s).replace(/"/g, '\\"')` — это CSS-escape, не HTML-escape. Сам по себе query безопасный, потому что вычисление идёт по DOM (атрибуты УЖЕ escaped).

Impact: на сегодня я не нашёл реальной XSS-точки, но `eslint-rules/no-unescaped-innerhtml.js` есть — стоит проверить что он работает на gantt.js.

Направление: добавить fuzz-test «вставить `"><script>alert(1)</script>` во все user-text-поля (epic / team / comment / fio) → assert что HTML не содержит `<script>`».

---

## High (S1)

### H1. `renderChart` — полный rebuild на каждое действие, без diffing/virtualization
`views/gantt.js:732` → `renderDetailedTasks` (700+ LOC) → собирает `body` string → `wrap.innerHTML = ...`. Каждый из 27 вызовов `GanttView.renderChart()` (см. L488, L516, L666, L688, L1709, L1723, L1838, L2007, L2181, L2488, L2501, L2518, L2543, L2566, L2596, L2615, L2627, L2653, L2668, L2682, L2757, L2866, L2867) — это:

1. snapshot scroll'ов (4 источника, L749–755)
2. rebuild `body` string
3. `wrap.innerHTML = ...` — браузер парсит, layout, paint, очищает focus
4. перебинд listener'ов (L1740, L1756, L2094, L2198, L2246, L2794) — `querySelectorAll('.gantt-type-pill[draggable]')` каждый раз
5. restore scroll'ов через rAF + setTimeout (L1623–1647)
6. `drawPostponeArrows` через rAF×2 (L2877)
7. `setTimeout(_release, 50)` для min-height anti-jitter (L1603)

Impact: 30 команд × 30 эпиков × ~10 pill'ов = ~9000 DOM-узлов на rebuild. На MBP M1 — ~80–150ms. На корпоративном Lenovo с PoE-Win — больше. Drag-drop с ghost-flight + setTimeout(700)+renderChart (L2757) — это значит, после клика «перенести в 1.21» юзер ждёт 700ms (анимация) + 100ms (rebuild) — в сумме почти секунду. Frame-budget 16.6ms давно дренирован.

Направление фикса (по убыванию ROI):
1. **Surgical updates** — для drop-action создать новый DOM только для одной строки, не всего gantt'а. `data-row-id` уже есть как селектор-якорь.
2. **Detached batch** — собирать поддерево в DocumentFragment, потом `replaceChild` целевого row'а.
3. **Виртуализация** — IntersectionObserver-based row rendering. На 100+ команд это даст 10× по памяти и paint-time.

### H2. O(N×M) под-логика в горячем пути даже после H6-фикса
`views/gantt.js:1060–1061`:
```js
teams.forEach(team => {
  const teamRows = rows.filter(r => r.team === team);
```
`rows` уже отфильтровано, но это всё ещё O(teams×rows). На 30 команд × 1000 эпиков = 30k iter / render. Map уже построен на L965 (`teamCounts`), но **rows-by-team Map не построен**. Каждый render тратит лишние ~30k сравнений.

`views/gantt.js:1096`:
```js
const cnt = teamRows.filter(r => r[hasMap[col.key]]).length;
```
Внутри `teams.forEach × cols.forEach` ⇒ O(teams × cols × teamRows) = O(teams × 5 × N/teams) = O(5N) ⇒ ok, но это снова сканирует team-rows × 5 раз.

`views/gantt.js:1167–1175` — `_wtTally` сборка через 5 forEach-вложенностей внутри `teamRows.forEach(row => ...)`.

Impact: на 1000 строк ~50–80ms «лишних» на каждый render. Сейчас это спрятано за тем, что данных мало (декабрь–май). К Q3 (если бизнес-данные подрастут) — заметно.

Направление: один pass `rows.forEach` строит `teamRowsMap = new Map<team, Row[]>` + per-team aggregates до `teams.forEach` цикла. Это уже сделали для `teamCounts` (L965) — повторить паттерн.

### H3. Hardcoded year-2025 в TIMELINE_START / RELEASE_BOUNDS / sub-строках
- `constants.js:191–203` — `r120/r121/r122` start/end жёстко в `2025-04-20..2025-07-14`. Сегодня 2026-05-15 — старые windows. Today-pill (`views/gantt.js:1510–1527`) сравнивает month+day (year-agnostic), так что **UI отрисуется**, но `GANTT_TIMELINE_START = new Date('2025-04-01')` и `GANTT_DAY_PX = 5` остались как мёртвые константы (импортируются в gantt.js:14–15 — ниже H4).
- `views/gantt.js:776–778` — литерал `sub:'20.04–17.05'` в build-cols. **Переезд на следующий квартал** = ручная правка строкового literal.

Impact: при переходе на Q3/Q4 2026 (через ~6 недель — сегодня 2026-05-15, релиз 1.22 заканчивается 14.07 → ~Q3 старт середина июля) кто-то будет редактировать вручную. Высокая вероятность забыть один из 4 источников: `constants.js` × 2 (RELEASE_WINDOWS + RELEASE_BOUNDS), `gantt.js` cols, `ganttHtmlExport.js` regex'ы для current-release detection.

Направление: ввести `getQuarterConfig(today)` → возвращает массив окон. Один источник правды.

### H4. 8 неиспользуемых imports в `gantt.js:13–19` — dead code
Уже зафиксировано предыдущим аудитом (`audit-2026-05-04/gantt-deep/`), не исправлено в working copy:
```js
import { SCOPE_OPTIONS, RELEASE_WINDOWS, GANTT_RELEASE_WINDOWS,
  GANTT_TIMELINE_START, GANTT_TIMELINE_END, GANTT_DAY_PX,
  GANTT_RELEASE_BOUNDS, PHASE_ORDER, PHASE_COLORS, PHASE_SHORT,
  PHASE_COLOR_TOKENS, PHASE_COLOR_TOKEN_FALLBACK,
  WORK_TYPES, GANTT_COL_LABELS,
} from '../constants.js';
```
- `SCOPE_OPTIONS` — не используется (упоминается в aux.js для add-epic-modal, в gantt.js — нет)
- `RELEASE_WINDOWS` — не используется
- `GANTT_RELEASE_WINDOWS` — не используется
- `GANTT_TIMELINE_START/END` — не используется
- `GANTT_DAY_PX` — не используется
- `GANTT_RELEASE_BOUNDS` — не используется
- `PHASE_SHORT` — не используется (присутствует grep'ом 0 раз вне импорта)
- `PHASE_COLORS` — упоминается только в комментариях (см. L1104, L1177, L1558)

Impact: cognitive load, тестам ничего не ломает, но новый разработчик читает import и думает «о, тут есть timeline». Нет, тут только колодцы.

### H5. `state.epicDeps` существует, но в Ганте не отображается
`state.js:30` — `epicDeps: {}`. `dependencyEngine.js` — целый Sugiyama-lite layout-engine для зависимостей. Используется в **`views/dependencyGraph.js`** (отдельная view), **НЕ в Ганте**.

В Ганте есть только `row.ganttArrows` — это «переносы между колодцами», т.е. **trail-arrow одной задачи** (1.20 → 1.21 = «отложили»). Это совершенно другая семантика, чем зависимость A→B.

Impact: PM с background'ом в Asana/Linear/Project ожидает увидеть стрелки между эпиками-блокерами в самом Ганте. Сегодня — отдельная view (`btn-gantt-deps`, L671–676, открывает `Services.DependencyGraphView?.toggle()`). Это не интеграция, это переключение.

Направление фикса (полу-фикс, полу-feature): overlay-режим — `epicDeps` рисуем SVG-arrows поверх gantt-body, между строками-эпиками. Использовать `drawPostponeArrows` как референс реализации. Toggle отдельной кнопкой.

### H6. Дубликаты `cssEscape` / `_phaseRank` / `colKeyMap` внутри renderChart
Внутри одного `renderDetailedTasks` я нашёл:
- `cssEscape` определён локально на L546 — внутри `openJumpPalette` (не renderChart, но рядом)
- В `renderChart` он же определяется анонимно через `const _esc = (s) => (window.CSS?.escape ? CSS.escape(String(s)) : String(s))` минимум 4 раза: L1778, L1845, L1899, L2012
- `_phaseRank` определён дважды (L1360 и L1379) для backlog vs releases — идентичная логика
- `colKeyMap`, `hasMap`, `tfMap` — три отдельные таблицы, описывающие одно и то же сопоставление (L795–797)

Impact: 3 источника правды → дрейф (один обновили — другой нет). Уже видны следы рефакторинга: `GANTT_COL_LABELS` вынесли в `constants.js` (хорошо), но `colKeyMap` остался дублированным.

### H7. `setTimeout` на 700ms перед `renderChart` после ghost-flight
`views/gantt.js:2757` — `setTimeout(() => GanttView.renderChart(), 700);` после `moveWtBetweenCols(fresh, ...)`.

Импликации:
1. **Race condition**: за 700ms юзер может уйти в другую секцию. На L1801 есть guard `if (state.activeSection !== 'gantt') return`, но в drop-handler — не в этом setTimeout.
2. **State out-of-sync**: в течение 700ms `row.ganttArrows` уже обновлён, но UI показывает «старую» картину + ghost flight. Если в это время другой code-path сделает re-render (например, реактивный flush), pill будет в новом месте раньше, чем закончится flight.
3. **Flush race с Reactive (debounce 200ms)**: `moveWtBetweenCols` → `Storage.save()` (L897) синхронно, но реактивный proxy на mutation `row.dirty = true` запланирует flush через 200ms. Этот flush триггерит подписчиков (Storage.save, App.refreshAll), а **App.refreshAll** может перерисовать **этот же** Гант — но уже без анимации.

Импликация: визуально юзер видит, как pill «прилетел» в OT, но в это время Gantt дёрнулся (re-render), pill пропал, потом setTimeout(700) — ещё один render. Два render'а за секунду на 9000-нодовый DOM = заметный stutter.

Направление: отказаться от ghost-flight (или) запретить реактивный flush внутри drop-handler через `Reactive.silent()`.

---

## Medium (S2)

### M1. Monkey-patch `GanttView.renderChart` в `bindKeyboardNav`
`views/gantt.js:206–214` (см. C3) — нарушает «явное лучше неявного». Любой `import { GanttView } from './gantt.js'` где-то ещё в системе будет вызывать **обёртку**, а не оригинал — без понимания почему.

### M2. ResizeObserver leak — `wrap._gdtArrowsResizeObserver`
`views/gantt.js:2884–2902` — ResizeObserver привязан к DOM-узлу `wrap` через _expando_ `wrap._gdtArrowsResizeObserver`. Guard idempotency: `if (!wrap._gdtArrowsResizeObserver && typeof ResizeObserver ...)`. Сейчас работает, но **никогда не отвязывается**. На переключении секций (`activeSection` ≠ 'gantt') ResizeObserver продолжает работать на скрытом `wrap`'е — при window-resize вызывает `drawPostponeArrows(wrap)` зря.

Direction: в `_clearTransientInteractions` (L80) добавить disconnect/cleanup.

### M3. `document.addEventListener('mousemove', GanttView._docTipListener)` — нет цикла очистки
`views/gantt.js:734–737`:
```js
if (GanttView._docTipListener) {
  document.removeEventListener('mousemove', GanttView._docTipListener);
  GanttView._docTipListener = null;
}
```
Цикл работает, но **`_docTipListener` никогда не устанавливается** в текущем коде — grep `GanttView._docTipListener =` даёт только этот `null`. Это dead-cleanup-path. Если он остался из старой версии — лучше удалить.

### M4. `window.addEventListener('scroll', hide, true)` в `bindFastTooltip` — global listener в `aux.js:277`
Listener вешается раз (через `boundState.bound`), но **никогда не снимается**. На SPA-приложении это OK, но если когда-то будет hot-reload или unit-тест с `import('./gantt.js')` × 2 — leak.

### M5. `document.addEventListener('keydown', onKey, true)` в jumpPalette не снимается при unmount
`views/gantt.js:560`. Снимается через `close()` (L507) — но **только** при явном close. Если юзер закрыл вкладку браузера / перешёл в другую секцию через keyboard-shortcut, который не зовёт close — listener висит.

### M6. `_dtHiddenTeams` / `_dtColWidths` — session state без персистенции
`views/gantt.js:513, 926, 927`. При обновлении страницы юзер теряет: какие команды свёрнуты, какие ширины колонок выставлены. `_gantt_density` и `_gantt_mode` — персистятся в localStorage (L266, L327). Несимметрия: одни UI-настройки сохраняются, другие нет.

Direction: единый ключ `q2_gantt_view_v22` { hiddenTeams: [], colWidths: {}, mode, density }.

### M7. `renderChart` сначала **читает** `_pendingScrollX/Y` со старого render'а, потом перезаписывает (L750–756). Если два render'а подряд (например, кнопка + Reactive-flush), второй потеряет позицию.
`views/gantt.js:750–756`:
```js
if (_wrapForScroll) {
  GanttView._pendingScrollX     = _wrapForScroll.scrollLeft || 0;
  GanttView._pendingScrollY     = _wrapForScroll.scrollTop  || 0;
  ...
}
```
Сохраняет **текущий** scrollX, но если предыдущий render не успел дойти до scroll-restore (rAF деференсится), второй render зафиксирует 0/0. После — оба `applyScrolls()` рестораят 0/0, и юзер прыгает в начало.

### M8. `Services.HistoryManager?.checkpoint(...)` 14 раз — без guard'а если undefined
`views/gantt.js:858, 1836, 1837, 2005, 2483, 2493, 2510, 2535, 2559, 2587, 2607, 2661, 2676, 2720, 2858` — везде optional chaining `?.checkpoint(...)`. Если HistoryManager не загружен — `undefined` тихо, и юзер теряет undo. Это анти-паттерн «silent fallback» — для critical-path надо логировать в `ErrorsLog`.

### M9. Drop-handler — guard `if (state.activeSection !== 'gantt') return` стоит **после** `e.preventDefault` (L1801)
`views/gantt.js:1766, 1801`:
```js
e.preventDefault();
cell.classList.remove('gantt-cell-dragover');
...
if (state.activeSection && state.activeSection !== 'gantt') return;
```
preventDefault случается **до** проверки секции. На странице с дублирующимися cells (если когда-то будет multi-instance Ганта) — drop отменится глобально. Minor, но логически порядок неверен.

### M10. `setTimeout(_release, 50)` в anti-jitter (L1603) + `requestAnimationFrame(_release)` — два triggera для одного флага
Idempotent (`_released` guard) — работает. Но `setTimeout(50)` означает: на скрытой вкладке, где `rAF` тротлится до 1Hz, юзер увидит min-height на 50ms. На быстрой вкладке — оба зовут `_release` сразу, рАФ выигрывает. Это надёжно, но я бы предпочёл `MutationObserver` на новый `.gantt-container` — точнее.

### M11. `drawPostponeArrows` зовётся 4 раза при resize и 2 раза при первом render
`views/gantt.js:2218, 2233, 2877, 2884–2901`. Resize → `redrawArrows()` через `requestAnimationFrame` + после mouseUp ещё `rAF × 2`. ResizeObserver — debounce 50ms + rAF. + initial render — `rAF × 2`. На активном resize'е получается ~5-7 redraw'ов за секунду. Каждый redraw — это полный `wrap.querySelectorAll('.gdt-arrows-svg')` + создание SVG-defs + markers. На 50 переносах × 50 marker'ов = тысяча DOM ops/sec.

### M12. `Date.parse(c.at)` без TZ-обработки в comment bucketing (L1217, L1437)
`views/gantt.js:1217`:
```js
const ts  = Date.parse(c.at) || 0;
```
Если `c.at` это `'2026-05-15'` (date-only) — `Date.parse` использует UTC. Если `'2026-05-15T10:00:00'` — местная. Несимметрично между моментально-локальным timestamp'ом (`new Date().toISOString()` на L868) и парсингом обратно.

Impact: comment-bucketing внутри одних суток корректен, но при сравнении timestamp'ов разных origin'ов может выбрать «не самый последний» комментарий.

---

## Low / Nice-to-have

### L1. Magic numbers — нет констант
- `Math.max(960, wrap.clientWidth || 0)` (L928) — 960px min-width
- `Math.max(220, Math.min(420, Math.round(wrapW * 0.18)))` (L929)
- `Math.max(140 / 80 / 600 / 600)` resize limits (L2205–2206)
- `slice(0, 12)` — max pills per cell (L1365, L1384)
- `slice(0, 40)` — max jump-palette results (L487)
- `slice(0, 16)` — max category text length (L1163)
- `slice(0, 500)` — max history entries (L64 в aux.js)
- `OVERLOAD_THRESHOLD = 8` (L981) — есть, но локальный

Direction: вынести в `constants.js` под namespace `GANTT_LIMITS`.

### L2. Inconsistent option-style toast'ы
`window.showToast?.('msg', 'type', 1800)` (L1824, L2123) vs `Services.Toast?.warning?.('msg', { ms: 2400 })` (L1790, L1975). Два API сосуществуют. UX 4.1 уже пометил «унифицировано через window.Toast.warning» (L1788–1789, L1973), но другой код всё ещё зовёт `window.showToast`. Не закончено.

### L3. `RU_MONTHS_GEN` дублируется
`views/gantt.js:64` и `views/ganttHtmlExport.js:603` — в инлайн-JS экспорта есть свой массив `monthNames`. Длинная вариативность: «янв» vs «январь» vs «января». При changel чего-то в одном — другой не обновится.

### L4. Ghost-pill «без эпика» — три fallback'а
`row.epic || row.tasks || '(без эпика)'` встречается в `views/gantt.js:1154, 1811, 1984, 2532, 2554, 2582`. Должен быть helper `Utils.rowDisplayName(row)`.

### L5. Inline-style вместо CSS-class — нарушение `no-inline-style` lint-rule?
`views/gantt.js:1305–1306`:
```js
const dc = isDone      ? ' gdt-pill-done'      : '';
const uc = isUnplanned ? ' gdt-pill-unplanned' : '';
```
OK — class-based. Но `style="height:${heightPct.toFixed(0)}%"` (L1086) и десятки других. Lint-rule `no-inline-style.js` есть в eslint-rules — он, видимо, разрешает в gantt (динамические значения по природе).

### L6. `_GHOST_COL_LABEL` (L1195) идентичен `GANTT_COL_LABELS` (L798)
Тот же объект, переименован зачем-то.

### L7. SVG-marker IDs без cleanup
`views/gantt/aux.js:347–364` — `_ensureMarker` кэширует `_markerCache` Set, но Set локальный для каждого вызова `drawPostponeArrows`. SVG-DOM удаляется на L289 (`wrap.querySelectorAll('.gdt-arrows-svg').forEach(el => el.remove())`). OK, но не очевидно.

### L8. `console.warn('[gantt] drawPostponeArrows:', diag)` (`aux.js:323`) — production-логи
Diag попадает в DevTools console каждый раз, когда «есть переносы, но нет endpoint'ов» — например, при resize до того как layout settled. Шумно.

---

## Browser-quirks (отдельный pass)

### B1. `file://`-режим: `await fetch('styles.css')` в HTML-export
`views/ganttHtmlExport.js:1010–1013`:
```js
try {
  const res = await fetch('styles.css');
  if (res.ok) cssText = await res.text();
} catch (_) { /* fall back to baseline */ }
```
На `file://` многие браузеры (Chrome, Safari) блокируют `fetch` из локального HTML. Тогда экспорт пойдёт с `_BASELINE_CSS` только — то есть **без основных styles.css правил для пилюль**. Юзер откроет .html и увидит unstyled-mess. Catch есть, но pollback CSS неполный.

### B2. Safari + contenteditable
В Ганте нет `contenteditable`-полей — только `<input>`/`<textarea>` внутри modal'ов (aux.js add-epic). OK.

### B3. Firefox drag-events
Firefox требует `dataTransfer.setData('text/plain', ...)` для запуска drag — `views/gantt.js:1743–1745` ставит только кастомные ключи (`rowId`, `srcCol`, `wt`). На Firefox может не запуститься drag для всех pills. Линия L2803 `try { e.dataTransfer.setData('text/plain', _dragData.wt); } catch(_){}` это ставит — но только для **intra-cell reorder**, не для **cross-cell**. Cross-cell dragstart на L1741–1748 не ставит text/plain.

Тестировать на Firefox обязательно.

### B4. Touch / iPad — drag-and-drop не работает
HTML5 drag-events не работают в iOS Safari. Нет fallback'а (Pointer Events + manual). Ganttovskie pillsy на iPad не двигаются. Это известное ограничение — но для корп-планировщика, где CEO смотрит на iPad-Pro в перелёте, это deal-breaker.

### B5. `prefers-reduced-motion` уважается, но `.drop-aligned` setTimeout (`L1851`) ставит **класс**, который не имеет анимации в reduced-motion — нет визуальной обратной связи.
Брендбук P10.27 — уже учтено для `gdt-drop-ghost`, но не для `.drop-aligned`.

---

## State / reactivity contract violations

### R1. Mass-mutation без `Reactive.silent` — нет ни одного вызова
В **`views/gantt.js`** и **`views/gantt/aux.js`** — `0` использований `Reactive.silent` (grep подтвердил). Все мутации идут через явный `Storage.save()` после mutation + явный `GanttView.renderChart()`.

Контракт #1 из CLAUDE.md:
> Mass-mutations ОБЯЗАНЫ быть в `Reactive.silent(() => { ... })` иначе infinite loop.

В Ганте я не вижу bulk-mutation (типа `state.rows.forEach(r => r.x = y)`), кроме `bulk_add` в picker'е (L2166–2179) — там добавляются типы в **один** row, ок. Но если завтра кто-то добавит «массовое снятие назначения с команды» — без `silent` будет ад.

Profilactic fix: добавить comment-guard в helpers `moveWtBetweenCols` / `revertMove` — «если нужно cycle на >1 row, обернуть в Reactive.silent».

### R2. `assigneePills` / `donePills` / `unplannedPills` / `inProgressPills` — четыре отдельных map'а с одним ключом `${col}__${wt}`
`views/gantt.js:1189, 1192, 1235, 1249, 2270–2273, 2495, 2512`. Если кто-то добавит пятый state — снова map. Это разбивка по причинам, но фактически — единая структура `pillState[col__wt] = { done, unplanned, inProgress, assignee }`.

Impact на reactivity: 4 set'а вместо 1 на действие → 4 Reactive markDirty → 1 debounce → 1 flush. Не критично.

### R3. `row.dirty = true` + `row.updatedAt = new Date().toISOString()` — паттерн, не контракт
`views/gantt.js:894–895, 919–920, 919, 2497–2498, 2515–2516, 2540–2541, 2562–2563, 2591–2592, 2611, 2623, 2649, 2665, 2679`. Везде дублируется. Если забыл — `row.dirty` останется false и row не попадёт в incremental save / API sync.

Direction: helper `RowFactory.markDirty(row, reason?)`.

---

## Тестовое покрытие

### T1. Что есть
- `tests/unit/ganttParse.test.js` (37 LOC) — только смок-тест «модуль импортируется без SyntaxError»
- `tests/unit/ganttHtmlExport.test.js` (224 LOC) — assignee summary, _splitTags, escape HTML
- `tests/unit/v17AuditFixes.test.js` — точечные регрессии CRIT-3, CRIT-4 (delete pill scope ganttArrows)
- `tests/unit/rowFactoryV14.test.js` — RowFactory shape, `ganttArrows` поле

### T2. Чего НЕТ — critical paths без покрытия
- **`moveWtBetweenCols`** — не покрыт. Только косвенно через CRIT-4 regression на удаление. Никто не тестирует «move backlog→r120 формирует arrow с правильным timestamp».
- **`revertMove`** — не покрыт. На L902–923 — обратная операция, может удалить wrong arrow.
- **`drawPostponeArrows`** — нет unit-теста (DOM-heavy, но можно через `happy-dom`).
- **Keyboard DnD** — нет.
- **drop-handler с plan-locked + cancel comment** — нет.
- **`renderChart` с empty state / 1-row / 1000-rows** — нет performance budget'а.
- **`_buildAssigneeSummary` + `_buildUnassignedSummary` per-pill override** — есть (хорошо).
- **`bindFastTooltip` idempotence** — нет.
- **`requireMoveComment` cancel-path** — нет.
- **Today-pill year-rollover** — есть в комменте (QA A4.2 L1521–1524), нет теста.
- **`drawPostponeArrows` на ResizeObserver-debounce** — нет (race condition surface).

### T3. Что бы покрыл я (топ-7)
1. `moveWtBetweenCols(row, wt, src, dst)` — assert: `row.ganttArrows.push` срабатывает 1 раз, в `transferComments` запись появляется при `planLocked + !editMode + comment='X'`, при cancel — НЕ появляется.
2. `revertMove` — после move + revert: `row.ganttArrows` пуст, original col восстановлен.
3. Year-rollover today-pill — `c.sub = '28.12–15.01'`, `today = 2026-01-02` → assert `isCurrent === true`.
4. Empty state render — `state.rows = []` → `wrap.innerHTML` содержит `.empty-state` и НЕ содержит `gantt-row`.
5. 1000-row render budget — `console.time/timeEnd`, assert < 200ms.
6. Drag-drop cancel via modal cancel → row не мутирует.
7. HTML-export без scrub: вставить в `row.epic = 'Bearer abc.xyz'`, экспорт, assert HTML не содержит `Bearer abc.xyz` (после фикса C1).

---

## Новые идеи / killer features

### F1. **Capacity heatmap (per-team × per-week)**
Сейчас sparkline (L1085) показывает 5 баров per-bucket — это distribution. Asana / MS Project делают цветную тепловую матрицу: дни × команды, intensity = `Σ работ`. Эта матрица — один взгляд PMO «где перегруз». В Ганте уже есть `overloadCount` (L1080), `OVERLOAD_THRESHOLD = 8` — половина работы сделана.

### F2. **Burndown sub-rail внутри bucket'а**
Колодец 1.21 закрывается 14.06 (через ~4 недели). Сегодня pills рендерятся как «есть/нет». Добавить inline-sparkline: «доля done / total» как мини-progress bar в header'е bucket'а. Один взгляд = «1.21 на 60% готов».

### F3. **Cross-team dependency overlay (S0 для PM-PMO)**
`state.epicDeps` уже хранит зависимости. Сегодня они видны в **отдельной view** (DependencyGraphView). В Asana / Linear зависимости рендерятся **поверх Gantt-bar'ов**. Я бы:
- toggle-кнопка "Зависимости" → SVG overlay поверх gantt-body
- стрелки между `gantt-row`'ами эпиков
- critical-path подсвечен красным
- `dependencyEngine.buildGraphLayout` уже умеет считать — не нужно новой логики

### F4. **Forecast-shift visualisation**
Если pill `A` перенесли в OT, и от него зависит pill `B` (через `epicDeps`) — `B` тоже визуально «отодвигается» (например, рендерится pulse-анимацией с надписью «авто-сдвинется»). PMO моментально видит цепочку влияния одного решения.

### F5. **Snap-to-team-rail для DnD (touch + mouse)**
При перетаскивании pill «магнитится» к крайним пикселям своей team-row. Это даёт grid-feel вместо free-form. Linear так делает в Cycle planning.

### F6. **«Auto-pack» команды по capacity**
Кнопка «Распределить по релизам» → берёт N задач из Backlog, раскидывает по 1.20/1.21/1.22 так, чтобы overload не превысил `OVERLOAD_THRESHOLD`. Это NP-hard в общем виде, но greedy-эвристика «положить в первый свободный bucket» уже даёт 80%. Это **киллер-фича** для тимлида, который пришёл в понедельник с 50 свежими PR-задачами.

### F7. **Replay-timeline («Машина времени»)**
`state.actionLog` (state.js:66) хранит историю. Slider в гант-header: «откатить вид на N дней назад». Видим pills в состоянии прошлого вторника. История переносов уже есть — `transferComments` + `ganttArrows`. Этого достаточно для replay.

### F8. **`row.workStartDate/EndDate` → mini-timeline-bar внутри cell'и**
Сейчас даты только в pill-meta (`01.05—15.05`). Можно нарисовать тонкий bar `┃━━━━━━┃` от workStart до workEnd, аналог настоящего Gantt-bar. Это даст users временной контекст без отказа от bucket-парадигмы.

### F9. **Bulk-select pills через Shift-click**
Выбрать 5 pills → правый клик → «перенести все в 1.22 с одним комментарием». Сейчас юзер делает 5 переносов × 5 модалок. Существенная боль на больших планах.

### F10. **Inline-edit названия эпика через двойной клик**
В Asana — двойной клик на эпик в Gantt → инплейс-редактор. В Призме — нужно идти в Реестр. Лёгкая фича, большой UX-bump.

---

## Что бы я сделал в первую очередь

### Шаг 1 (1 день) — security gap C1 + R-2 теста
Закрыть HTML-export секреты-leak: `_scrubSecrets(rows)` перед `_buildAssigneeSummary`, + regex-стрип `Bearer/token/password` на `transferComments[].text` и `doneComment`. Два теста: «scrub удаляет token из row.epic», «scrub удаляет text-like-Bearer из transferComments[].text». **Обоснование**: shareable .html уходит наружу, contract-violation, минимальная стоимость, S0.

### Шаг 2 (2–3 дня) — `renderChart` decomposition + surgical row update
Разбить `renderDetailedTasks` на:
- `_buildHeader(cols)` → DOM
- `_buildTeamHeaderRow(team, teamRows, ...)` → DOM
- `_buildEpicRow(row, cols, ...)` → DOM
- `_buildTrailRow(row, arrow, cols, ...)` → DOM
- `_bindRowInteractions(rowEl)` → void

Контракт: `renderRow(rowId)` — заменить ОДНУ строку без re-render всего gantt'а. Использовать в `moveWtBetweenCols` (вместо `setTimeout(700) + renderChart`). **Обоснование**: убирает H1+H6, готовит почву для виртуализации, делает H7 race condition невозможной. Все 27 вызовов `renderChart` пересматриваем — большинство можно заменить на `renderRow`.

### Шаг 3 (1 день) — tests scaffold + perf budget
Создать `tests/unit/gantt-render.test.js`:
- happy-dom + minimal state
- `renderChart` снимок на 0/1/10/1000 строк
- assert: 1000 строк рисуется < 200ms (perf budget)
- assert: cleanup — после `wrap.innerHTML = ''` ResizeObserver disconnected, документ-listener'ы тоже

**Обоснование**: без guard-теста никакой рефакторинг не будет надёжным. Текущие 261 LOC тестов это только smoke + summary export.

---

## Приложение А — карта файлов

| Файл | LOC | Что | Состояние |
|---|---|---|---|
| `views/gantt.js` | 2924 | Основной рендерер + все interactions | **Перегружен** (H1, H6, M1) |
| `views/gantt/aux.js` | 398 | 4 utility — modals + tooltip + arrows | Чистый, idempotent |
| `views/gantt/legendContent.js` | 43 | Текст легенды | Чистый |
| `views/ganttHtmlExport.js` | 1104 | HTML-export | **Не scrubbed** (C1, B1) |
| `dependencyEngine.js` | 212 | Sugiyama-lite layout | Чистый, но **не интегрирован в Гант** (H5) |
| `constants.js` (gantt-зона L128–207) | ~80 | Колодцы, цвета, окна релизов | **Hardcoded 2025-год** (H3, H4) |
| `tests/unit/gantt*.test.js` | 261 | Парс, HTML-export, regression | **Огромные дыры** (T2) |

---

## Приложение Б — топ-10 ссылок на конкретные строки (для быстрого открытия)

| Что смотреть | Где |
|---|---|
| Корневой render hot-path | `views/gantt.js:732–785` |
| Сборка тела + iteration через `rows.forEach` | `views/gantt.js:1035–1495` |
| `_buildPill` (per-pill HTML) | `views/gantt.js:1251–1348` |
| Drop-handler (mouse) | `views/gantt.js:1756–1864` |
| Drop-handler (keyboard) | `views/gantt.js:1898–2090` |
| Context-menu | `views/gantt.js:2246–2790` |
| Monkey-patch renderChart | `views/gantt.js:206–214` |
| `moveWtBetweenCols` | `views/gantt.js:857–899` |
| HTML-export без scrub | `views/ganttHtmlExport.js:1006–1024` |
| Hardcoded даты релизов | `constants.js:191–203`, `views/gantt.js:776–778` |

— Виктор Демин, 2026-05-15
