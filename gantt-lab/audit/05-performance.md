# Производительность — экспертный аудит Ганта 3.0

> Эксперт: Performance Engineer (рендер / reflow / память / масштабирование).
> Дата: 2026-05-24.
> Что покрыто: `views/gantt3.js` (6888 строк), `views/dependencyGraph.js` (341), `views/gantt/aux.js` (`drawPostponeArrows` / `bindFastTooltip`), пути ре-рендера через `scheduleRenderChart` + post-render hook, все 11 «Видов»-режимов и интерактивные фичи живого грида (Линза, Фокус, Командный, Marquee, Peek, Diff, Burndown, Chips, Annotations, Radial, Scrubber, Mission).
> Метод: статический разбор реального кода + анализ алгоритмической сложности относительно `state.rows.length` (N эпиков-строк), `cols.length` (M колодцев, обычно 5–8), `teams.length` (T), `arrows` (переносы). Сейчас демо ~22 строки; цель банка — сотни эпиков. Оценки стоимости даны для N≈200, M≈6, T≈15 (реалистичный квартал крупного трайба).

---

## Резюме (где главные горячие точки)

Архитектура «живого грида» сама по себе разумна: `renderChart()` коалесцируется в один rAF (G-04), per-team бакетинг сделан Map'ой (G-05), `transferComments` пребакетятся (H6), `drawPostponeArrows` индексирует DOM одним проходом (AUDIT-13). Прошлые perf-фиксы реальны и работают. **Но** масштабирование на 200+ эпиков упирается в три класса проблем:

1. **Полное `innerHTML`-перестроение всего грида на каждую микро-мутацию.** Любой drop / done / unplan / reorder / удаление пилюли → `wrap.innerHTML = ...` для ВСЕХ N строк (+ trail-под-строки) + повторная индивидуальная навеска ~6 типов слушателей на каждую пилюлю и каждую ячейку. Это P0 при N≈200: один пользовательский клик = пере-парс десятков тысяч DOM-узлов + тысячи `addEventListener`. Нет инкрементальности вообще.

2. **`_collectEpics()` — полный DOM-скан-«паразит» при открытии любого «Вида».** querySelectorAll по всем строкам → по всем ячейкам → по всем пилюлям, плюс 4 `querySelector` на каждую пилюлю (читает текст/состояние/мету из DOM вместо `state`), плюс два O(N²)-участка. Данные уже есть в `state.rows` — режимы читают их «глазами через DOM». На 200 эпиках это десятки–сотни мс на ровном месте, при том что источник истины (`state`) рядом.

3. **Layout-thrash в hot-циклах (`getBoundingClientRect` по элементам в цикле).** `_marqueeMove` дёргает `getBoundingClientRect` для КАЖДОЙ пилюли на КАЖДЫЙ `pointermove` (P1 — заметные фризы при выделении на большом гриде). `dependencyGraph.drawWires` вызывает `getBoundingClientRect` 4× на провод + `scene.getBoundingClientRect()` внутри `center()` и перерисовывается на `scroll` **без debounce** (P1). `drawPostponeArrows`/Линза — O(arrows) принудительных layout'ов, но reads сгруппированы, поэтому мягче.

Самое дорогое и самое частое — №1 (полный rebuild + per-node re-bind на каждый клик). Самое «бесплатно-устранимое» — №2 (кэш `_collectEpics` + чтение из `state`). Самое «дёргающее на глаз» — №3 (marquee + scrubber тик).

**Счёт находок:** 1×P0, 9×P1, 11×P2, 4×P3 = 25.

---

## Находки

### P0 — критично для масштабирования

---

**PERF-01 · P0 · Полный `innerHTML`-rebuild всего грида + индивидуальная навеска слушателей на каждую пилюлю/ячейку при любой микро-мутации**
`views/gantt3.js:5157` (`wrap.innerHTML = ...`), навеска: `:5290,5317,5328,5336,5350,5376,5402,5454,5470` (по `querySelectorAll().forEach(addEventListener)`), цикл сборки `:4412–4965`.

Суть. `renderChart()` → `renderDetailedTasks()` всегда собирает HTML-строку для ВСЕХ команд × строк × trail-под-строк и делает `wrap.innerHTML = …` (полная замена поддерева). Сразу после — post-render блок навешивает индивидуальные слушатели на каждый матч:
- `.gantt-type-pill[draggable]` → `dragstart`+`dragend` (`:5454`) — 2 листенера × (N×пилюль);
- `.gantt-cell[data-col]` → `dragover`+`dragleave`+`drop` (`:5470`) — 3 листенера × (N×M);
- плюс per-row: `.gantt-team-vis-btn`, `.gdt-team-add-epic`, `.v16-epic-deps-badge`, `.v16-epic-deps-edit`, `.gdt-cell-note-icon`, `.gdt-col-eye`, `.gdt-cell-risk-glyph` (`:5290–5425`).

Триггерится отовсюду: drop-handler (`:5552`), intra-cell reorder (`:6714`), ctx-menu действия, `cellNotes`/`cellRisks` `onChange` (`:5369,5421`), удаление релиза, undo/redo. Каждое из этих действий — это `renderChart()` целиком.

Стоимость (N≈200, ~5 пилюль/строку, M≈6, + trail-строки). На один клик «отметить done»:
- генерация строки HTML на ~1000 пилюль × двухстрочный шаблон (`_buildPill` ~25 строк template) ≈ сотни КБ строки;
- браузерный HTML-parse + сборка ~30–60 тыс. DOM-узлов;
- ~2000 `addEventListener` на пилюли (dragstart/dragend) + ~7200 на ячейки (dragover/leave/drop) + сотни на бейджи/иконки.
Реалистично 50–200 мс главного потока на КАЖДОЕ действие → ощутимый «фриз» и потеря 60fps. На демо (22 строки) незаметно — отсюда и не всплыло.

Почему так. Исторически грид строится одним template-literal'ом; нет diff/инкрементальной модели. Per-node-навеска не нужна: drag/drop уже частично делегирован на `#gantt3-wrap` (`_gdtDelegated`, `:6011–6715`), но cross-cell `drop`, `dragstart`, `dragend` дублируются и на каждой пилюле/ячейке.

Рекомендация (по возрастанию усилий):
1. **Сделать DnD полностью делегированным** на `#gantt3-wrap` и удалить per-pill `dragstart/dragend` (`:5454`) и per-cell `dragover/dragleave/drop` (`:5470`). Обработчики уже умеют `e.target.closest('.gantt-type-pill'/'.gantt-cell')` — нужно слить две модели в одну. Это убирает ~9000 `addEventListener` за рендер без потери функциональности. Аналогично note/risk/eye/deps-кнопки → один делегированный `click` на wrap с `closest()`-роутингом по классу. **Самый дешёвый большой выигрыш.**
2. **Инкрементальный апдейт одной пилюли/строки.** done/unplan/in-progress/reorder меняют один `row` — не нужно перестраивать весь грид. Ввести `Gantt3View._rerenderRow(rowId)` который пересобирает innerHTML только этой `.gantt-row` (+ её trail-строки) и не трогает остальные N−1. Большинство мутаций затрагивают одну строку.
3. Долгосрочно — виртуализация по вертикали (рендерить только видимые команды/строки; остальные — placeholder-высота). При сотнях эпиков DOM-узлов десятки тысяч даже без ре-рендера.

---

### P1 — высокий приоритет

---

**PERF-02 · P1 · `_collectEpics()` читает данные из DOM (не из `state`) + два O(N²)-участка; пере-сканирует весь грид при открытии каждого «Вида»**
`views/gantt3.js:3146–3192`, вызовы `:3224` (`_modeOpen`), `:2195` (focus-lane), `:3224/3808`.

Суть. На каждый открытый режим («Таблица», «Отчёт», «Дек», «Центр управления», Сплит, Дзен, Scrubber…) делается:
```
wrap.querySelectorAll('.gantt-row[data-epic-key]')          // N
  → row.querySelectorAll('.gantt-cell[data-col]')           // ×M
    → cell.querySelectorAll('.gantt-type-pill…')            // ×пилюли
      → 4× querySelector на пилюлю (.gdt-pill-name, -state-done, -state-active, -pill-meta)
  + row.querySelector('.gdt-cell-risk-glyph…'), '.v16-epic-churn'   // ×2 на строку
```
Плюс два квадрата:
- `:3182` — `out.teams.find(t => t.key === tk)` внутри per-row forEach = O(N×T);
- `:3190` — `out.epics.forEach(e => out.epics.filter(o => o.deps.includes(e.epic)))` = **O(N²)** (на 200 эпиках 40 000 итераций × вложенный `includes`).

Стоимость (N≈200). ~200 строк × (≈6 cell-QSA + ≈5 пилюль × (QSA + 4 querySelector)) ≈ 6–12 тыс. querySelector + forced style-resolution на чтение `textContent`/класса. Плюс O(N²) на `blocks`. Реалистично 30–120 мс на открытие одного режима — пользователь видит задержку «Виды → Таблица».

Корень проблемы концептуальный: **источник истины — `state.rows` / `state.epicDeps`, а `_collectEpics` реконструирует те же данные обратным парсингом DOM.** Это и медленно, и хрупко (зависит от селекторов разметки).

Рекомендация.
1. Переписать `_collectEpics` на чтение из `state.rows` напрямую (wt/done/unplanned/assignee/risk берутся из `row.donePills`, `row.unplannedPills`, `row.cellRisks`, `row.customReleaseTypes`/flat-полей — те же, что использует render-loop). DOM-скан не нужен вообще.
2. Заменить `out.teams.find` Map'ой `teamKey→team` (как уже сделано в render-loop, G-05).
3. `blocks` (`:3190`) — построить обратный индекс `Map<epic, blockers[]>` одним проходом по `deps` вместо O(N²)-фильтра.
4. **Мемоизация:** результат зависит только от `state` — кэшировать `_collectEpics` и инвалидировать в `scheduleRenderChart`/мутациях. Открытие нескольких режимов подряд тогда бесплатно.

---

**PERF-03 · P1 · `_marqueeMove` — `getBoundingClientRect` по всем пилюлям на каждый `pointermove`**
`views/gantt3.js:2881–2893`.

Суть. Во время Shift-выделения рамкой каждое движение мыши выполняет:
```
wrap.querySelectorAll('.gantt-type-pill…').forEach(p => { const r = p.getBoundingClientRect(); … })
```
`getBoundingClientRect` форсирует синхронный layout. `pointermove` летит десятки раз в секунду.

Стоимость. N≈200 × ~5 пилюль = ~1000 forced reflow на КАЖДЫЙ тик мыши; при 60 событиях/с — до 60 000 forced layout/с. Это гарантированный джанк/фриз курсора на большом гриде. Сейчас не видно только из-за 22 строк.

Рекомендация.
1. Снять прямоугольники ОДИН раз в `_marqueeStart` (закэшировать `{el, rect}[]` до начала движения — позиции не меняются во время drag, страница не скроллится). В `_marqueeMove` сравнивать кэш с рамкой — ноль reflow.
2. Если возможен автоскролл — пересчитывать кэш только на событие `scroll`, не на `pointermove`.
3. Дополнительно throttle `_marqueeMove` через rAF (один пересчёт на кадр).

---

**PERF-04 · P1 · `dependencyGraph.drawWires`: `getBoundingClientRect` 4× на провод + `scene.getBoundingClientRect()` в `center()`; redraw на `scroll` без debounce**
`views/dependencyGraph.js:234–256` (`center`/`drawWires`), `:331–335` (`redraw` + `scroll`/`resize`).

Суть. `center(el, edge)` (`:234`) на каждый вызов делает `scene.getBoundingClientRect()` **и** `el.getBoundingClientRect()`. В `wire()` (`:244`) `center` вызывается до 4 раз на один провод (`center(fe)`, `center(te)`, затем `center(fe,'r'|'l')`, `center(te,'l'|'r')`) → до 8 `getBoundingClientRect` на провод. И главное — `scene.addEventListener('scroll', redraw)` (`:332`) **без rAF/throttle**: при скролле графа `drawWires` пересчитывает все провода синхронно на каждый scroll-event.

Стоимость. Эпик с длинной цепочкой (предки+потомки = десятки) → сотни `getBoundingClientRect` за один `drawWires`; на scroll это умножается на частоту scroll-событий → фриз прокрутки модалки графа на большом портфеле.

Рекомендация.
1. Кэшировать `scene.getBoundingClientRect()` + `scene.scrollLeft/Top` один раз в начале `drawWires`, передавать в `center`.
2. Считать rect каждого узла один раз (Map `name→rect`), переиспользовать для обоих рёбер.
3. Обернуть `redraw` (scroll/resize) в rAF-гейт (как уже сделано для Линзы в `_lensScheduleRedraw`, `:2135`) — один пересчёт на кадр.

---

**PERF-05 · P1 · `_mode_scrubber`: `setInterval(750ms)` полностью пересобирает мини-гант через `innerHTML` на каждый тик (+ полная копия `work` всех пилюль)**
`views/gantt3.js:3479–3498` (`render`), `:3495` (`setInterval`).

Суть. При «Проиграть» каждые 750 мс:
- `:3481` — `Object.keys(cur).forEach(ep => work[ep] = cur[ep].map(p => ({...p})))` — глубокая копия всех пилюль всех эпиков;
- `:3482` — обратный проход по всем `moves` с `arr.find(...)`;
- `:3485–3488` — пересборка строки `<div class="sc-gantt">…` для ВСЕХ `epicsP` × M колонок и `stage.innerHTML = g` — полная замена поддерева сцены.

Стоимость. На N≈200 эпиков × M≈6 × ~5 пилюль: каждые 750 мс — копия ~1000 объектов + генерация строки на тысячи span'ов + reflow всей сцены. Это «дискотека reflow» 1.3 раза/с. Анимация будет дёргаться, CPU крутится фоном пока открыт scrubber.

Рекомендация.
1. **Не пересобирать DOM на тик.** Построить сетку пилюль один раз; на тике только переключать класс `.moved`/`.done` и перемещать пилюлю в нужную колонку (или toggle `hidden` у предрассчитанных позиций). Состояние «на шаге k» — это дельта одного переноса относительно k+1, а не полный пересчёт с нуля.
2. Предрассчитать массив снимков (позиция каждой пилюли на каждом шаге k) один раз при открытии — тик становится O(изменившихся пилюль) ≈ 1.
3. Снизить частоту/использовать rAF-таймер с учётом `document.hidden` (сейчас `setInterval` тикает и на скрытой вкладке).

---

**PERF-06 · P1 · `_mode_mission` мини-гант + heat + feed строятся вложенными `data.epics.filter()` внутри `data.cols.map()` внутри `data.teams.forEach()` → O(T×M×N)**
`views/gantt3.js:3420–3458`; особенно heat `:3430–3431` и `teamWorks`/`teamLoad`-стиль агрегации.

Суть. Тепловая карта ёмкости (`:3431`):
```
data.teams.forEach(t => data.cols.map(c => data.epics.filter(e => e.teamKey===t.key)…))
```
для каждой (team×col)-ячейки заново фильтрует ВСЕ epics. Это T×M×N. Аналогично в `_mode_focus`/`_focusLaneRender` (`:2238–2259`) `teamLoad`/quiet-cells, и в `_mode_report` `cap` (`:3379`).

Стоимость. T≈15 × M≈6 × N≈200 = 18 000 проходов по `filter` только на heat; ещё столько же на focus-lane sidebar. Плюс это поверх уже дорогого `_collectEpics`. Десятки мс на открытие Mission/Focus.

Рекомендация. Один проход: построить `Map<teamKey, {colCounts, total, hasRisk}>` за O(N), затем `teams×cols` читают из Map за O(1). Та же техника, что G-05 в основном render-loop. Вынести в helper и переиспользовать в Mission/Focus/Report/Deck.

---

**PERF-07 · P1 · `_burndownBuild`: `querySelectorAll('.gantt-cell[data-col=X] .gantt-type-pill')` внутри `forEach` по заголовкам → O(M × всеПилюли); пере-вызывается каждым рендером пока включён**
`views/gantt3.js:3088–3126` (`:3104` — вложенный QSA), reapply `:5255`.

Суть. Для каждого header-колодца (`:3096`) делается отдельный `wrap.querySelectorAll('.gantt-cell[data-col="X"] .gantt-type-pill…')` (`:3104`) — то есть скан грида M раз. И весь `_burndownBuild` повторяется в post-render hook (`:5255`) при каждом `renderChart`, пока burndown включён → накладывается на PERF-01.

Стоимость. M≈6 × (скан ~1000 пилюль) на каждый рендер. Если пользователь двигает пилюли при включённом burndown — каждый drop триггерит и rebuild грида (PERF-01), и M-кратный re-scan здесь.

Рекомендация.
1. Один `querySelectorAll('.gantt-cell[data-col] .gantt-type-pill…')`, сгруппировать по `data-col` в Map за один проход; колодцы читают из Map.
2. Лучше — считать total/done из `state.rows` (данные есть), не из DOM.
3. Дебаунсить пересборку burndown (и chips/diff/annot) после рендера — см. PERF-08.

---

**PERF-08 · P1 · Post-render hook безусловно пере-применяет ВСЕ активные фичи синхронно после каждого rebuild**
`views/gantt3.js:5216–5264`.

Суть. После каждого `wrap.innerHTML` синхронно вызываются (если фича включена): `_lensBindRows`+`_lensClearFocus` (`:5222`), `_focusLaneBind` (`:5228`), `_cmdEnsureBar`+`_cmdApplyFilter` (`:5234`), `_anatomyBind`+`_anatomyClose` (`:5239`), `_densityApplyAuto` (`:5242`), `_northstarBuild` (`:5244`), `_marqueeBind`+`_marqueeHideBar` (`:5247`), `_peekBind`+`_peekClose` (`:5250`), `_diffApply` (`:5253`), `_burndownBuild` (`:5255`), `_chipsBuild` (`:5257`), `_radialBind`+`_radialClose` (`:5259`), `_inlineBind` (`:5262`), `_annotBind`+`_annotRenderMarkers` (`:5264`).

Многие `*Bind` идемпотентны (guard `wrap._gdt*Bound`) — это дёшево. Но `_cmdApplyFilter`, `_diffApply`, `_burndownBuild`, `_chipsBuild`, `_chipsApply`, `_annotRenderMarkers` делают полноценные DOM-сканы/перестроения (см. PERF-07, PERF-09). Если активны несколько фич одновременно (Chips + Diff + Burndown), каждый рендер — это PERF-01 + N×несколько повторных сканов грида подряд, синхронно, в том же кадре.

Стоимость. Складывается мультипликативно с частотой рендеров. На активных Chips+Diff+Burndown один drop = rebuild + `_chipsApply` (несколько QSA + rows.filter×chips) + `_diffApply` (QSA всех пилюль) + `_burndownBuild` (M-кратный скан). Легко 100–300 мс на действие.

Рекомендация. Объединить «тяжёлые» реапплаи в одну функцию, вызываемую через единый rAF/`requestIdleCallback` после рендера (а не синхронно в hook). Лёгкие идемпотентные `*Bind` оставить синхронными. В идеале — после инкрементального апдейта строки (PERF-01.2) реаппай только для затронутой строки.

---

**PERF-09 · P1 · `_chipsApply`: несколько полных `querySelectorAll`-проходов + `rows.filter` на каждый чип → O(chips × N)**
`views/gantt3.js:3666–3688`.

Суть. `_chipsApply`:
- `:3671` — `[...wrap.querySelectorAll('.gantt-row[data-epic-key]')]` (N);
- `:3673` — `rows.forEach(r => active.every(p => p.test(r)))` — каждый predicate `test(r)` сам делает `r.querySelector(...)` (см. `_chipsPredicates`);
- `:3678` — ещё один QSA по team-headers;
- `:3682` — для каждого чипа `rows.filter(r => test.every(x => x.test(r)))` = **O(chips × N × predicateCost)**.

Predicate'ы тестируют через `closest`/`querySelector` по DOM-узлу строки. На каждый рендер (reapply `:5257`) + на каждый клик по чипу.

Стоимость. ~5 чипов × 200 строк × (querySelector в predicate) = тысячи DOM-запросов на каждый апдейт счётчиков чипов.

Рекомендация. Считать признаки (risk/churn/done-ratio/team) из `state.rows` один раз → массив легковесных дескрипторов; predicate'ы работают над числами/булями, не над DOM. Счётчики чипов считаются по этому массиву за O(chips×N) без querySelector. Подсветку dim навешивать одним проходом.

---

**PERF-10 · P1 · Глобальный reflow всего документа при переключении плотности (`document.body.dataset.gdtDensity`)**
`views/gantt3.js:1422` (`applyDensity`), `:1452` (`bindDensity` toggle), `:1481` (`_densityApplyAuto`).

Суть. Плотность ставится атрибутом на `<body>` (`document.body.dataset.gdtDensity = …` + класс `gdt-g3-texture`). Селекторы плотности (`body[data-gdt-density] …`) висят на всём документе. Смена атрибута на `<body>` инвалидирует стиль для всего дерева, не только для грида, и тянет за собой rebuild стилей + reflow. Дополнительно `bindDensity` сразу после планирует двойной rAF → `drawPostponeArrows` + `_positionTodayLine` (`:1465`) — ещё один forced layout-pass.

Стоимость. Один клик по «плотности» = глобальный style-recalc + reflow всего документа (а не `#section-gantt3`) + перерисовка всех стрелок. На большом гриде ощутимо; на странице с другими тяжёлыми секциями (Дашборд/Реестр в DOM) — тем более.

Рекомендация. Ставить density-атрибут на корневой контейнер секции (`#section-gantt3` или `#gantt3-wrap`), а не на `<body>`; селекторы переписать на `#gantt3-wrap[data-gdt-density]`. Это локализует invalidation областью грида. `_densityApplyAuto` (`:1479`) к тому же делает `querySelectorAll('.gantt-row[data-epic-key]').length` каждый рендер — заменить на известное `rows.length`.

---

### P2 — средний приоритет

---

**PERF-11 · P2 · Замыкания и константы per-pill/per-row пересоздаются в цикле сборки**
`views/gantt3.js:4664` (`_buildPill`), `:4793–4800` (`_RISK_SVG_INNER`/`_RISK_GLYPHS`/`_RISK_LABELS`), `:4801` (`_riskGlyph`), `:4773` (`_noteBubble`), `:4827`/`:4846` (`_phaseRank`/`_phaseRankR`), `:4896` (`findComment`), `:4639/4656` (`findAddComment`/`findMoveComment`).

Суть. Внутри `teamRows.forEach(row => …)` (`:4530`) на КАЖДУЮ строку заново создаются: объект `_RISK_SVG_INNER`, `_RISK_GLYPHS` (через `Object.fromEntries(map)`), `_RISK_LABELS`, функции `_riskGlyph`/`_noteBubble`/`_buildPill`/`_phaseRank`/`findComment` и т.д. `_RISK_GLYPHS` особенно — это аллокация объекта + map на каждую строку, хотя контент константный.

Стоимость. N≈200 строк × (несколько объект/функц-аллокаций) — это GC-давление и лишняя работа на каждый rebuild (а rebuild частый, PERF-01). Не катастрофа, но «пыль», умноженная на N и на частоту.

Рекомендация. Вынести все константы (`_RISK_*`, SVG-строки иконок, `PHASE_ORDER`-rank) и чистые helpers за пределы цикла строк — на уровень `renderDetailedTasks` или модуля. `_buildPill`/`findComment` сделать функциями от `(row, …)` один раз, а не замыканием на строку (где это требует доступа к per-row `dp/up/ip/ap` — передавать их аргументом).

---

**PERF-12 · P2 · Team-bucket-ячейки: `teamRows.filter(r => _hasTypes(r, col.key)).length` внутри `cols.map` внутри `teams.forEach` → O(T×M×N)**
`views/gantt3.js:4473–4474`.

Суть. Для каждой команды × каждого колодца считается `teamRows.filter(...).length` — линейный проход по строкам команды на каждую (team×col)-ячейку шапки.

Стоимость. Σ(teamRows)×M = N×M проходов (≈1200 на N=200,M=6) на каждый рендер. Меньше квадрата (teamRows, не все rows), но всё равно лишнее.

Рекомендация. Посчитать `Map<team, Map<col, count>>` одним проходом по `rows` (как `teamCounts` уже делается для legacy-бакетов `:4344`) и читать за O(1). Фактически расширить существующий `teamCounts` на произвольные `cols`.

---

**PERF-13 · P2 · `drawPostponeArrows` — O(arrows) `getBoundingClientRect`; запускается двойным rAF на каждый рендер и на каждый ResizeObserver-фон**
`views/gantt/aux.js:381–404` (rect в цикле), запуск `views/gantt3.js:6725` (двойной rAF на рендер), `:6745` (ResizeObserver), `:1465` (density).

Суть. Хотя индексация DOM сделана одним проходом (AUDIT-13, хорошо) и `cRect` кэшируется (`:379`), сам цикл (`:381`) делает 2 `getBoundingClientRect` на каждую стрелку. Reads сгруппированы (нет write между ними) — это смягчает thrash, но не отменяет O(arrows) forced layout. Плюс двойной-rAF после каждого `renderChart` (`:6725`) и ResizeObserver (debounce 50мс, `:6747`).

Стоимость. При большом числе переносов (сотни trail-строк) — сотни `getBoundingClientRect` после каждого рендера. На ResizeObserver (сайдбар, окно, чат, 1fr-перераспределение) — повторно. Терпимо при умеренных arrows, дорого при «churn-heavy» квартале.

Рекомендация.
1. Координаты пилюль можно получить из CSS-grid-геометрии (известны ширины колонок `_dtColWidths`/`makeGT` + позиция строки), не вызывая `getBoundingClientRect` вовсе — но это крупный рефактор.
2. Минимум: пропускать стрелки для свёрнутых/вне-вьюпорта строк (часть уже отсекается отсутствием в индексе). Рисовать только для видимой области.
3. Объединить триггеры (рендер + RO + density) в один rAF-гейт, чтобы не было двух layout-pass подряд.

---

**PERF-14 · P2 · Линза: `scroll`(capture)+`resize` слушатели на `window`, redraw читает `getBoundingClientRect` по всей цепочке**
`views/gantt3.js:1919–1921` (bind scroll capture + resize), `:2105–2133` (`_lensDrawWires` — `anchor()` с `getBoundingClientRect` на focus + каждый узел цепочки).

Суть. В режиме Линзы на `window` вешается `scroll` в **capture** (ловит все вложенные скроллеры) + `resize`, оба → `_lensScheduleRedraw`. Сам redraw rAF-гейтнут (хорошо, `:2138`), но `_lensDrawWires` делает `getBoundingClientRect` на focus-узел + на каждый узел цепочки (предки+потомки) на каждый кадр скролла.

Стоимость. Скролл страницы при включённой Линзе с большой цепочкой → `getBoundingClientRect` × (1+|chain|) каждый кадр. rAF-гейт спасает от burst, но при непрерывном скролле это каждый кадр.

Рекомендация. rAF-гейт уже есть — оставить. Дополнительно: кэшировать rect'ы узлов цепочки и пересчитывать только при изменении layout (не на каждый scroll-кадр, если позиции относительно overlay не меняются — а они не меняются при скролле, т.к. overlay fixed и читает абсолютные координаты; проверить, можно ли заменить на `transform`-сдвиг SVG вместо полного пересчёта).

---

**PERF-15 · P2 · `bindFastTooltip`: `getBoundingClientRect` цели + tooltip на каждый показ (read→write→read)**
`views/gantt/aux.js:267–268`.

Суть. На hover пилюли (после 200мс delay) — `target.getBoundingClientRect()` затем `node.getBoundingClientRect()` (после записи контента). Это read→(write innerHTML)→read — потенциальный forced reflow на каждый показ тултипа.

Стоимость. По одному показу — копейки; но тултипы показываются постоянно при наведении на грид. Не P1 (не в цикле), но «пыль».

Рекомендация. Минор: измерять tooltip через `offsetWidth/Height` после вставки в один проход; или позиционировать через `transform` без повторного измерения цели.

---

**PERF-16 · P2 · `getRows()` → `FilterEngine.getFiltered()` на каждый `renderChart`; результат не мемоизируется на уровне Ганта**
`views/gantt3.js:3995` (`getRows`), `:4083` (вызов в render).

Суть. Каждый `_renderChartImmediate` зовёт `FilterEngine.getFiltered()`. У FilterEngine есть собственный кэш (по CLAUDE.md), но при частых рендерах (PERF-01) это всё равно вызов + потенциальная инвалидация.

Стоимость. Зависит от реализации кэша FilterEngine; при cache-hit дёшево. Отмечаю как точку внимания, не как подтверждённый хотспот.

Рекомендация. Убедиться, что `FilterEngine` cache переживает рендеры Ганта (не инвалидируется на каждый `Storage.save`). Если нет — мемоизировать `rows` в Ганте до следующей мутации.

---

**PERF-17 · P2 · `new Date()` / Date-парсинг в циклах сборки**
`views/gantt3.js:4980` (`const today = new Date()` внутри `cols.map`), `:4732–4735` (`new Date()` ×3 на in-progress пилюлю в `_buildPill`), `:3093–3095` (`_burndownBuild`), trail `findComment` `Date.parse` в цикле (`:4900–4907`).

Суть. `today` создаётся на каждую колонку (`:4980`, M раз). В `_buildPill` для каждой in-progress пилюли — 3 `new Date()` + арифметика (`:4732`). `findComment` (`:4896`) делает `Date.parse` по всем `comments` на каждый матч (хотя H6 уже пребакетит add/move — но `findComment` для trail-строк, `:4896`, всё ещё линейный по comments на каждую стрелку).

Стоимость. Date-аллокации множатся на N×M×пилюли. Не доминирующий фактор, но устранимо.

Рекомендация. Вынести `today`/`Date.now()` в одну переменную на рендер. `findComment` для trail — пребакетить comments в Map по `wt|from|to` один раз на строку (как уже сделано для add/move в `_addByPill`/`_moveByPill`).

---

**PERF-18 · P2 · `makeGT()` вызывается на каждую строку и каждую trail-строку (генерация одинаковой grid-template-строки)**
`views/gantt3.js:4872` (главная строка), `:4961` (trail-строка), определение `:4305`.

Суть. `style="grid-template-columns:${makeGT()}"` встраивается inline в КАЖДУЮ `.gantt-row` и каждую trail-строку. `makeGT()` (`:4305`) каждый раз делает `cols.map(...)`. Результат идентичен для всех строк в одном рендере.

Стоимость. N×(1+trail) вызовов `makeGT` + дублирование длинной inline-строки в разметке (раздувает размер HTML → больше парсинга). На 200 строк × M это лишние килобайты повторяющегося inline-стиля.

Рекомендация. Вычислить `gt` один раз (`:4968` уже делает для header — переиспользовать). Лучше — задать `grid-template-columns` одним CSS-правилом на контейнер/класс `.gdt-grid-row` (CSS custom property `--gdt-gt` на wrap), а не inline на каждой строке. `updateAllGrids` (`:5284`) тогда меняет одну переменную вместо обхода всех строк.

---

**PERF-19 · P2 · `_anatomy`/`_peek`/`_radial`/mode `onKey2`: document/window-слушатели через `setTimeout`-навеску; корректный teardown есть, но риск накопления при быстром открытии/закрытии**
`views/gantt3.js:2600–2630` (anatomy onDoc на document mousedown/keydown + window scroll capture), `:3212` (views onDoc), `:3321/3417` (mode onKey2), `:3746` (radial show rAF).

Суть. Поповеры/меню вешают document-listener'ы (часто в `setTimeout(…,0)`) и снимают их в close. Teardown присутствует (`_anatomyClose`, `_modeClose` `:3238–3247`). Риск: если open вызывается повторно без гарантированного close между ними (например, post-render hook вызывает `_anatomyClose` затем `_anatomyBind`, но `onDoc` от старого поповера…). На практике guard'ы есть, но это хрупкая зона.

Стоимость. Не хотспот по CPU; риск утечки слушателей/двойных хендлеров при граничных сценариях.

Рекомендация. Везде, где `setTimeout(()=>addEventListener)`, хранить ссылку и снимать в close идемпотентно (уже частично сделано). Рассмотреть `{ signal }` AbortController на open → один `abort()` в close снимает все разом.

---

**PERF-20 · P2 · `_modeClose` чистит только `M.st.timer/onKey2/onResize`; режимы с другими таймерами/слушателями полагаются на единый shape `st`**
`views/gantt3.js:3238–3247`.

Суть. Teardown режима снимает фиксированный набор (`onKey2`, `onResize`, `timer`). Если будущий режим заведёт иной таймер/слушатель не в этих полях — утечёт. Scrubber кладёт `timer` в `st` — ок. Deck/Zen кладут `onKey2` — ок. Но это «соглашение по именам», не структурная гарантия.

Рекомендация. Ввести `M.cleanups = []` (массив teardown-функций); каждый режим пушит свои; `_modeClose` вызывает все. Устойчивее к добавлению новых режимов.

---

**PERF-21 · P2 · SVG-перерисовки через `innerHTML` строкой (Линза, Граф, Radial, Burndown, Anatomy leaders)**
`views/gantt3.js:2133` (`svg.innerHTML=s` Линза), `:3604` (anatomy leaders), `:3740` (radial), `:3116` (burndown SVG строкой), `dependencyGraph.js:256` (`wires.innerHTML=s`).

Суть. Везде SVG собирается конкатенацией строк и присваивается `innerHTML`/`outerHTML`. Это парсинг SVG-строки + полная замена поддерева на каждый redraw. Для Линзы/Графа redraw происходит на hover/scroll.

Стоимость. На редкие события (hover/открытие) — терпимо. На scroll-redraw (PERF-04/14) складывается с layout-thrash.

Рекомендация. Где redraw частый (Линза/Граф на scroll) — переиспользовать `<path>`-элементы: создать пул path'ов один раз, на redraw менять только атрибут `d` (без re-parse). Для редких (radial/anatomy/burndown) — оставить как есть.

---

### P3 — низкий приоритет / гигиена

---

**PERF-22 · P3 · `_collectEpics` вызывается даже когда режиму нужна только часть данных**
`views/gantt3.js:3224` (всегда полный сбор перед любым режимом).

Суть. `_modeOpen` всегда зовёт полный `_collectEpics`, даже для Anatomy (`_mode_anatomy(body)` `:3538` данные вообще не использует — это статический референс) или Merge (использует только имена эпиков).

Рекомендация. Anatomy не требует data — не звать `_collectEpics`. Для Merge достаточно списка имён. После мемоизации (PERF-02.4) это неважно, но до неё — лёгкая экономия.

---

**PERF-23 · P3 · `_positionMilestoneLines`: вложенный цикл `lines × headers` с `getBoundingClientRect` на найденный header**
`views/gantt3.js:6825–6848`.

Суть. Для каждой вехи перебираются все headers (`:6829`) с `getBoundingClientRect` на матч (`:6837`). Вех обычно мало (1–5), headers ≈ M — не хотспот, но `getBoundingClientRect` в двойном цикле.

Рекомендация. Снять rect'ы всех headers один раз в Map перед циклом вех. Минор.

---

**PERF-24 · P3 · `console.warn` диагностика в `drawPostponeArrows` на каждый рендер при missing-стрелках**
`views/gantt/aux.js:334–337`.

Суть. Если есть «битые» стрелки (что нормально при отфильтрованных/свёрнутых строках — они «отсутствуют в индексе» по комментарию `:312`), `console.warn` вызывается на КАЖДЫЙ рендер. `console.warn` сам по себе небесплатен (сериализация объекта `diag`) и засоряет консоль.

Рекомендация. Логировать только при реально неожиданном расхождении (не при ожидаемом отсутствии из-за фильтра/свёртки), либо за dev-флагом. Сейчас при свёрнутой команде с переносами это будет варнинг каждый рендер.

---

**PERF-25 · P3 · `today`-line/milestone reposition на `window resize` без throttle (одно из мест)**
`views/gantt3.js:6858–6860` (`window.addEventListener('resize', reposition)` один раз — ок по навеске, но `reposition` сам не throttled).

Суть. `_bindTodayLineResize` вешает resize→`reposition` (без debounce), плюс отдельный ResizeObserver на header. `reposition` делает `getBoundingClientRect` на header+container. На непрерывный resize окна — каждый event.

Рекомендация. Обернуть `reposition` в rAF-гейт (как arrows RO `:6741`). Минор, т.к. событий resize меньше, чем scroll/pointermove.

---

## Сделано хорошо

- **Коалесинг рендеров (G-04).** `renderChart()` → `scheduleRenderChart()` через rAF (`:4013–4026`) схлопывает 3–5 синхронных вызовов (move+revert+checkpoint+flush+Reactive) в один реальный rebuild. Это правильное и важное решение; `flushRenderChart` для тестов — аккуратно.
- **Per-team бакетинг Map'ой (G-05).** `rowsByTeam` (`:4328`) убрал O(N×T) `rows.filter` в hot-path — есть даже комментарий с расчётом «20 000 итераций». Образцовый фикс.
- **Пребакетинг `transferComments` (H6).** `_addByPill`/`_moveByPill` Map (`:4625–4638`) вместо O(N×M)-скана на каждую пилюлю — снимает «4.5M итераций per render». Отлично.
- **`drawPostponeArrows` индексирует DOM одним проходом (AUDIT-13)** (`:314–317`) и кэширует `cRect` (`:379`) — классическая read-batching оптимизация.
- **Линза redraw rAF-гейтнут** (`_lensScheduleRedraw` `:2135–2148`) — правильный паттерн против scroll-burst.
- **ResizeObserver для стрелок — debounce 50мс + rAF** (`:6737–6750`), today-line RO reobserve свежий header (AUDIT-8, `:6862–6872`) с disconnect старого — нет утечки detached-observer.
- **anti-jitter min-height freeze** при rebuild (`:5124–5166`) и scroll-restoration (`:5185–5209`) — грамотная борьба с layout-shift.
- **Wrap-level делегирование DnD** (`_gdtDelegated` `:6004–6715`) с корректным remove-перед-add (AUDIT bug#1) — нет накопления делегатов.
- **Bind-once guards** на всех toolbar-кнопках (`_gdt*Bound`, `:1216–1841`) и интерактивных wrap-фичах (`_gdtMqBound`, `_gdtPeekBound`, `_gdtRadialBound`, `_gdtAnnotBound`) — нет дублей слушателей при ре-рендере.
- **Ctx-menu не инициализирует per-pill maps на каждый правый клик** (`:6026–6037`) — осознанно избегает Reactive-проксированной записи → лишнего рендера.

---

## Приоритетный план оптимизаций

Порядок — по соотношению «выигрыш / усилие» при цели N=200+.

**Этап 1 — снять самую частую боль (P0/P1), умеренные усилия:**
1. **PERF-01.1** Полностью делегировать DnD + note/risk/eye/deps-кнопки на `#gantt3-wrap`; удалить per-pill `dragstart/dragend` и per-cell `dragover/leave/drop`. Убирает ~9000 `addEventListener` за рендер. *(самый дешёвый крупный выигрыш)*
2. **PERF-02** Переписать `_collectEpics` на чтение из `state` + Map для teams + обратный индекс для `blocks` (убрать O(N²)) + **мемоизация** с инвалидацией в `scheduleRenderChart`. Делает все «Виды» мгновенными.
3. **PERF-03** Кэшировать rect'ы пилюль в `_marqueeStart`; `_marqueeMove` без `getBoundingClientRect`. Убирает фриз курсора при выделении.
4. **PERF-05** Scrubber: предрассчитать снимки шагов, на тик — дельта без `innerHTML`/без копии всех пилюль.

**Этап 2 — снять накладные расходы активных фич (P1/P2):**
5. **PERF-08 + PERF-07 + PERF-09** Объединить тяжёлые reapply (chips/diff/burndown/annot) в один отложенный rAF/`requestIdleCallback`; пересчитывать признаки из `state`, не из DOM; burndown/chips — Map за один проход.
6. **PERF-06 + PERF-12** Единый helper «агрегаты по team×col за один проход» (как G-05) для Mission/Focus/Report/Deck и team-bucket-ячеек.
7. **PERF-04** dependencyGraph: кэш `scene` rect + rect-на-узел один раз + rAF-гейт на scroll-redraw.
8. **PERF-10** Перенести density-атрибут с `<body>` на `#gantt3-wrap`; локализовать style-invalidation.

**Этап 3 — структурная масштабируемость (крупно):**
9. **PERF-01.2** Инкрементальный `_rerenderRow(rowId)` — большинство мутаций затрагивают одну строку; не перестраивать весь грид.
10. **PERF-01.3** Вертикальная виртуализация строк/команд при сотнях эпиков (placeholder-высоты для невидимого).
11. **PERF-18** `grid-template-columns` через CSS-переменную на wrap вместо inline на каждой строке.

**Этап 4 — гигиена (P2/P3, по пути):**
12. PERF-11 (вынести константы/helpers из цикла строк), PERF-13/PERF-21 (path-пул для частых SVG-redraw), PERF-17 (Date в циклах), PERF-19/20 (AbortController + `cleanups[]` для teardown), PERF-23/24/25 (минорный thrash, dev-флаг для warn, rAF на reposition).

---

*Замечание по верификации.* Оценки стоимости — аналитические (по сложности относительно N/M/T), не замеры. До и после Этапа 1 рекомендуется снять реальные цифры: Performance-профиль одного drop при N≈200 (сгенерировать через временный fixture), метрики `PerformanceObserver('longtask')`, и счётчик forced reflow в DevTools (Rendering → «Layout Shift Regions» + «Paint flashing»). `perfBudget` из CI (`npm run ci`) стоит расширить сценарием «200 эпиков → один drop → время до next paint».
