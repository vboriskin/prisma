# Аудит вкладки «Гант» — V21 tabs review (2026-05-05)

## Intro

Гант — самый крупный view проекта Призма (~2 793 LOC `views/gantt.js` + 400 LOC `views/gantt/aux.js` + 1 097 LOC `views/ganttHtmlExport.js`). Это центральная поверхность квартального планирования: 4 релизных колодца + бэклог + овертайм, drag-drop пилюль с трейлом переносов, контекст-меню на 12 действий, плотность × режим × палитра поиска × keyboard-DnD. Большая часть фич укладывается в Spine-pill (V15) и в V16 roadmap-2 — но V19-split так и не случился, и `renderDetailedTasks` остался на 1 700+ closure-heavy строк.

Аудит проведён пятью экспертами. Группы и тяжесть (severity): **HIGH** — блокирует продуктивную работу или явно ломает контракт; **MED** — заметное трение/риск; **LOW** — полировка.

Источник кода смотрелся живьём: `views/gantt.js`, `views/gantt/aux.js`, `views/gantt/legendContent.js`, `views/ganttHtmlExport.js`, `dependencyEngine.js`, `index.html` (#section-gantt), `styles.css` (`.gantt-*` / `.gdt-*`).

---

## 1. UX / Product

### 1.1 [HIGH] Drag-drop ограничен одной строкой эпика — нет переноса между эпиками
**Файл:** `views/gantt.js:1686-1689` + `:1857-1859`
По коду drop отвергает любой перенос на другой `data-row-id` с тостом «Эта задача относится к другому эпику — перенесите внутри него». Это снимает с пользователя возможность типичной операции «передать BE-этап от эпика A эпику B (тот же релиз)» — частая история на стыке команд. Сейчас единственный путь — удалить и добавить заново, при этом теряется trail/комментарий.
**Предложение:** разрешить cross-row drop в рамках той же команды через explicit-confirm modal («Передать BE из «X» в «Y»?»), записывать парный entry в `transferComments` обеих строк (`from: 'epic:X→Y'`), синхронизировать через `HistoryManager.checkpoint`.

### 1.2 [HIGH] «Перенести в …» ведёт ТОЛЬКО на следующий релиз, нельзя выбрать целевой колодец
**Файл:** `views/gantt.js:2127` (`NEXT_RELEASE = { backlog:'r120', r120:'r121', r121:'r122', r122:'overtime' }`)
Из контекст-меню pill можно перенести только +1 шаг по цепочке. Перенос «1.20 → 1.22» требует двух последовательных операций (с двумя комментариями, если plan-locked). На plan-locked проекте это означает дубль-комментарий и кривой trail.
**Предложение:** заменить single-action `move-next` под-меню «Перенести в …» с радио-выбором всех 4 целевых колодцов; в `transferComments` писать единичный hop, в `ganttArrows` — тоже один.

### 1.3 [MED] Контекст-меню pill доступен только на ПКМ — нет «kebab»-кнопки
**Файл:** `views/gantt.js:2131` (`wrap.addEventListener('contextmenu', …)`)
На тачпадах без эмулированного right-click (особенно у новых сотрудников) меню недоступно. Keyboard есть (Enter/F2 — `:171-180`), но мышиный пользователь без ПКМ не получит ничего.
**Предложение:** при hover на pill показывать ⋯-кнопку в правой части `gdt-pill-row-1`, она триггерит тот же `contextmenu`-поток.

### 1.4 [MED] Нет drill-down с pill в Реестр / задачи
**Файл:** весь блок `_buildPill` (`views/gantt.js:1167-1264`)
Pill — терминал в графе навигации: нельзя «открыть строку реестра», «показать связанные Jira-задачи», «перейти в эмбеддед-AI-анализ». Identity-deterministic контракт даёт `row.id`, всё есть, но связи нет.
**Предложение:** в ctx-меню добавить «Открыть в Реестре» (scroll+select по row.id), «Показать в Дашборде команды», «Открыть Jira» (если `row.tasks` совпадает с TAG_RE).

### 1.5 [MED] Cmd+K палитра не включает фильтр по статусу/исполнителю
**Файл:** `views/gantt.js:331-511` (`openJumpPalette`)
Индексирует только `team` и `epic`. Поиска по ФИО исполнителя, по wt («покажи все BE»), по статусу («unplanned») нет.
**Предложение:** расширить `items.push({ kind: 'assignee'|'wt'|'status', … })`; при выборе — применять virtual-filter (без трогания FilterEngine — локальный pulse highlight всех matched pills).

### 1.6 [LOW] Сегодня-pill в well-header показывает только текстовое «сегодня»
**Файл:** `views/gantt.js:1442-1444`
В V16 roadmap-2 (B5) дату убрали из today-pill. Это правильное направление, но в overview-режиме у пользователя пропадает дата-якорь вообще: well-header выводится длинным русским форматом «20 апреля – 17 мая», а сам сегодняшний день не показан нигде, кроме мелкого `title=`.
**Предложение:** добавить тонкую вертикальную линию-индикатор «today» внутри активного well-cell (как в Linear), позиция = пропорция от start даты диапазона.

### 1.7 [LOW] Bulk-операции отсутствуют — нельзя выделить несколько pills
**Файл:** `views/gantt.js:2126+` ctx-меню
Нет multi-select (Shift+click / Lasso) — каждый перенос/назначение делается по одному. На 100+ командах это болезненно.
**Предложение:** Shift+click добавляет pill в selection-set, ctx-меню показывает только пересечение возможных действий, drag тащит весь набор.

---

## 2. Visual / Brand (Spine-pill дисциплина)

### 2.1 [HIGH] Inline-цвет на stripe-left обходит CSS-токены и нарушает theme-aware политику
**Файл:** `views/gantt.js:1321` — `<span class="v16-epic-stripe" style="background:${_epicStripeColor}" …>`, и `:1047` — `style="background:hsl(${hue},58%,52%)"` для team-rail.
Брендбук «V15 Spine-pill» предписывает signal-цвет ТОЛЬКО через CSS-tokens (`var(--prizma-…)`, `PHASE_COLOR_TOKENS`). Здесь цвет вычисляется в JS и впрыскивается через `style.background`. На dark-theme HSL `52%` light будет резким; в JS-fallback нет re-computation на смену темы.
**Предложение:** генерировать N preset-классов `.v16-team-rail-h0…h11` через CSS custom-prop `--team-hue` с oklch() — JS ставит `style.setProperty('--team-hue', hue)`, цвет резолвится через CSS-variable (theme может его переопределить).

### 2.2 [MED] PHASE_COLORS используется для inline `style.background` и `style.fill` в трёх местах — не theme-aware
**Файл:** `views/gantt.js:1024` (overview-bar), `:1094` (epic-stripe), `:1475` (header dist-spark)
В отличие от `PHASE_COLOR_TOKENS` (CSS var, theme-aware — используется в `aux.js:381` для arrow), `PHASE_COLORS` отдает hex-строки, прокинутые в inline-style. На тёмной теме оттенок BE/FE/QA не пересчитывается.
**Предложение:** свести все вызовы к `PHASE_COLOR_TOKENS`; `PHASE_COLORS` оставить только для legacy-export (`ganttHtmlExport.js`).

### 2.3 [MED] Inline `style="display:grid;grid-template-columns:..."` на каждой строке — повторяется 3× per row
**Файл:** `views/gantt.js:1046, 1319, 1407` — каждая строка (team-header, epic-row, trail-row) содержит inline `style.gridTemplateColumns`.
Это раздувает HTML и делает re-layout колонок при resize-handle вынужденным через JS-loop `updateAllGrids` (`:1581-1584`). CSS-grid template можно держать на одном wrapper'е, дочки наследуют.
**Предложение:** перенести `grid-template-columns` на `.gantt-body` (один общий), либо генерировать `<style id="gdt-grid">` с одной CSS-rule, обновляя её при resize.

### 2.4 [MED] Не tabular-numerals у счётчиков «N задач», «3 переноса» внутри epic-meta
**Файл:** `views/gantt.js:1099` (`_epicMeta`), `:1055` (`team-count`); правил `.v16-epic-meta { font-variant-numeric: tabular-nums }` явных в `styles.css` не нашёл.
Брендбук обязывает mono-tabular numerals на всех числовых данных. Глобальное правило на `body` есть (`styles.css:222`), но проверить локально на этих классах — необходимо: они часто используют свой `letter-spacing`/`font-feature-settings`, который может отменить унаследованное.
**Предложение:** явно прописать в правилах `.v16-epic-meta`, `.v16-team-total`, `.v16-team-bucket-count`, `.gdt-rail-flow-in/out`, `.gdt-overview-count` `font-variant-numeric: tabular-nums`.

### 2.5 [LOW] Эмодзи `↗ ↘ ✕ ↩ ⇥ ← →` остались в ctx-menu и trail-pill
**Файл:** `views/gantt.js:2225, 2244-2247, 2258, 2265, 1392, 1402`
Брендбук V15: «без эмодзи в production UI». Trail-arrow `↗`/`↘` — формально dingbat, но в lucide-стеке (V21 P11.3 заменили expand-icon) они выпадают.
**Предложение:** заменить trail-arrows на inline-SVG (lucide `corner-up-right`/`corner-down-right`), ctx-меню глифы — на 12px Icons.get().

---

## 3. Frontend / Performance

### 3.1 [HIGH] Полная innerHTML-перерисовка на КАЖДОЕ действие
**Файл:** `views/gantt.js:1504` — `wrap.innerHTML = …`; вызовы из drop, ctx-меню, kb-DnD, density-toggle, mode-toggle, +picker — итого ~14 точек.
Перерисовка одной pill (toggle done) пересобирает строку из всего state.rows × cols × per-pill-builder. На 100+ teams × 30 эпиков × 8 wt — это сотни тысяч `escape` и `template-literal` per render. Spine-marker и progress-underline пересчитываются для всех. ResizeObserver + 2× rAF поверх — overhead.
**Предложение:** перейти на surgical-update для статусных переключений: `done/unplan/start-work/stop-work/assign/unassign/set-dates/move-left/move-right` мутируют state, но трогают 1 pill — можно пересобрать только нужный node через локальный `_buildPill(colKey, wt)` + `replaceChild`.

### 3.2 [HIGH] `renderDetailedTasks` ≈ 1 700 LOC closure-heavy функция
**Файл:** `views/gantt.js:715-2778`
В ней 14 inner-функций (`_buildPill`, `_shortPeriod`, `_assigneeLabel`, `findAddComment`, `findMoveComment`, `moveWtBetweenCols`, `revertMove`, `updateAllGrids`, `_attachKeyboardDnD`, `_executeDrop`, …) — каждая держит closure-ссылку на `rows`/`wrap`/`cols`/per-team-aggregations. Функция переcоздаёт ВСЕ замыкания на каждый renderChart. См. комментарий `aux.js:6-8` — вынос блокировался именно этим.
**Предложение:** см. секцию **Decomposition status** ниже. Минимум — вынести pure-helpers (`_shortPeriod`, `_assigneeLabel`, `_initialsLabel`, `fmtMoveDate`, `_phaseRank`) в module scope (без closure-зависимости).

### 3.3 [MED] Scroll-preservation хитрая, но в density-change меняется высота строк — anchor не отрабатывает
**Файл:** `views/gantt.js:233-256` (`_withScrollAnchor`) + `:1532-1556` (scroll restoration)
`_withScrollAnchor` использует первый team-header > wrapTop. При смене density (regular→minimal) высоты epic-rows меняются с ~44px на ~22px — anchor team находит правильный, но visible bottom сдвинется. Также savedDocY восстанавливается ЛЕГАСИ-формой `window.scrollTo(0,y)` (`:1547`) поверх `html { scroll-behavior:smooth }` — на старых Safari не применит instant. Комментарий это признаёт.
**Предложение:** хранить anchor как `{teamKey, rowIndex, offsetWithinTeam}` чтобы при density-change восстанавливаться по relative-offset; перевести html→`scroll-behavior:auto` на момент restoration через add/remove inline-class.

### 3.4 [MED] Bind-on-each-render: per-pill listeners ставятся на каждом renderChart()
**Файл:** `views/gantt.js:1646-1655` (`pill.addEventListener('dragstart',…)`) + `:1660` per-cell drop + `:1979` plus-button + `:2083` resize-handle
Wrap-level делегирование используется только для contextmenu, dragstart/dragend/drop. Пер-узел listeners на pill/cell повторно привязываются после каждого innerHTML wipe. Это работает, но это память: 300 pills × 5 listeners × N renders = много пересозданных closure-объектов.
**Предложение:** делегировать всё на wrap (как уже сделано для contextmenu/dragstart). Цели — per-cell drop, per-pill draggable-keyboard, per-button click. Снимет ~80% bind-цикла и упростит teardown.

### 3.5 [LOW] `state.rows.find(r => r.id === rowId)` вызывается ~12 раз на каждое действие
**Файл:** `views/gantt.js:1699, 1727, 1865, 1885, 1984, 2140, 2598, 2728`
Линейный поиск по 5k+ строк суммарно ~60ms на cold path.
**Предложение:** держать `state._rowsById` — `Map<id, row>`, lazy-built при первом read; invalidate при mutation.

---

## 4. Domain expert (квартальное планирование Сбера)

### 4.1 [HIGH] Add-epic modal не видит Sigma-полей и не пишет их
**Файл:** `views/gantt/aux.js:110-220` (`openAddEpicModal`)
Modal формирует seed с `team/epic/category/scopeStatus/dependencies/blockingDependency`, но `sigmaInitiative`, `sigmaQuarter`, `actualDoneDate` не упоминаются. По CLAUDE.md domain-glossary Sigma — отдельный инстанс для квартальных целей, и Чёрный дашборд завязан на этих полях.
**Предложение:** добавить опциональный fieldset «Sigma-привязка» (initiative, quarter), проброс seed → `RowFactory.create`. Убедиться, что `RowFactory.updateDerived` корректно вычисляет integration-видимость.

### 4.2 [HIGH] `transferComments[].from === '+'` не читается ни одним consumer'ом кроме самого Ганта
**Файл:** `views/gantt.js:1130-1141, 2059-2061`
Bulk-add под plan-lock пишет `from: '+'` в transferComments, рендер использует это для пилюль-маркера. Но в Реестре/Дашборде/Pulse эти записи невидимы — то есть «решение, принятое после фиксации» не попадает в audit-trail вне Ганта.
**Предложение:** прокинуть transferComments в `metricsEngine.js` отдельным «added-after-lock» счётчиком (compliance use-case). При экспорте — гарантировать через `_scrubSecrets` (текст комментария не должен содержать Bearer/secret).

### 4.3 [MED] OT-колодец не различает типы overtime (компенсируемый/некомпенсируемый/staged)
**Файл:** `views/gantt.js:707` (`{key:'overtime',label:'OT',sub:'Овертайм'}`) — `overtimeTypes` flat-array
Бизнес-практика Сбера: OT часто разделяют на «paid», «time-off-in-lieu», «emergency-fix». В текущей модели всё в одной куче.
**Предложение:** ввести `overtimeKind` в pill-meta (per-pill через `assigneePills`-like map), отрисовать в ctx-меню «Тип овертайма».

### 4.4 [MED] `requireMoveComment` → `[edit-mode]` плейсхолдер в transferComments — теряется явный signal в exportе
**Файл:** `views/gantt.js:818-822`
Когда план locked + edit-mode-on, в transferComments пишется text=`[edit-mode]`. В CSV-экспорте это выглядит как обычный комментарий. Compliance-юзер не отличит «реальный пустой» от «edit-mode пропуска».
**Предложение:** выделить в отдельное поле `kind: 'edit-mode-bypass'`, рендерить в legendContent в спецзоне.

### 4.5 [LOW] Identity-deterministic для assignee — но в `openAddEpicModal` исполнитель не назначается
**Файл:** `views/gantt/aux.js:110-220`
Поле `assignee` в форме отсутствует. Identity-таблица `state.employees` не используется. PM создаёт эпик и сразу должен закрыть modal, найти строку, открыть assign-modal.
**Предложение:** добавить `<input list="ae-employees">` через `state.employees` (с `email`/`jiraAccountId` в значении) — V17.2 I1c контракт сохраняем, fuzzy-name-match не делаем (валидация по точному совпадению значения из datalist).

---

## 5. Accessibility

### 5.1 [MED] Keyboard-DnD: aria-grabbed deprecated в WAI-ARIA 1.1+
**Файл:** `views/gantt.js:1810, 1937, 1968`
`aria-grabbed` помечен deprecated; современный паттерн — описывать в `aria-describedby` + live-region (что уже есть). Современные SR (NVDA 2024) `aria-grabbed` игнорируют.
**Предложение:** убрать `aria-grabbed`, держать только live-region announce; добавить `aria-keyshortcuts="Enter Space ArrowLeft ArrowRight Escape"` на pill после `_attachKeyboardDnD`.

### 5.2 [MED] Контекст-меню — focus возвращается на pill только при Escape, не при click-action
**Файл:** `views/gantt.js:2353-2360` (комментарий явный: «click-on-item уже сам по себе перенесёт focus на следующий interactive»)
После выбора `done` через клавиатуру (Enter on menuitem) меню закрывается, но pill пересоздан в renderChart() — focus падает на body, screen-reader пользователь теряется.
**Предложение:** после `renderChart()` в action-handlers попытаться вернуть focus на новый pill по `[data-row-id="..."][data-src-col="..."][data-wt="..."]`; если не нашлось — на team-header.

### 5.3 [MED] `aria-label` на pill дублируется status-постфиксом, но read-out — длинный
**Файл:** `views/gantt.js:1218-1219, 1254`
`aria-label` строится как `BE — Иванов · Период: 2026-04-01 → 2026-04-15 · Статус: В работе` — SR будет читать каждое нажатие при roving-tabindex. На 30 пилях в одной строке это нон-стоп narration.
**Предложение:** сократить aria-label до `${wt}, ${statusText}`; полный текст вынести в `aria-describedby` (произносится только при focus-pause).

### 5.4 [MED] Resize-handle колонок — без клавиатурной альтернативы
**Файл:** `views/gantt.js:2083-2124`
mousedown-only. Keyboard-юзер ширину well настроить не может.
**Предложение:** на handle добавить `tabindex=0`, `role="separator"`, `aria-orientation="vertical"`, обработать Arrow Left/Right (10px шаг) + Home/End (min/max).

### 5.5 [LOW] `gdt-fasttip` — кастомный tooltip без role/aria
**Файл:** `views/gantt/aux.js:236-247`
Tooltip создаётся как `<div>` без `role="tooltip"`, без `aria-describedby` на target. SR пользователь его никогда не получит, остаётся только `aria-label`.
**Предложение:** на target ставить `aria-describedby="gdt-fasttip-{id}"` лениво при mouseover; tooltip-узлу добавить `role="tooltip"`.

### 5.6 [LOW] Drag-over highlight (`gantt-cell-dragover`, `gdt-drop-valid/invalid`) не отражается в live-region
**Файл:** `views/gantt.js:1661, 2691-2697`
Mouse-DnD ничего не announce'ит. Keyboard-DnD — да (`_announce`), но если пользователь mixed-mode (мышь + screen-reader, low-vision) — ему ничего не озвучат.
**Предложение:** при `dragover` на новую cell вызывать `_announce` с throttling 800ms.

---

## Decomposition status

`renderDetailedTasks` (1 700+ LOC, `views/gantt.js:715-2778`) остаётся монолитом. В V18.3 B1 успешно вынесли 4 pure-функции в `views/gantt/aux.js` (~292 LOC: openHistoryModal, openAddEpicModal, bindFastTooltip, drawPostponeArrows). Файл `aux.js:6-8` явно отмечает: «остальное — слишком closure-heavy для безопасного split'а».

### Что МОЖНО вынести в V19 split (в порядке риска)

| Часть | Размер | Зависимости от closure | Куда | Риск |
|---|---|---|---|---|
| Pure helpers: `_shortPeriod`, `_assigneeLabel`, `_initialsLabel`, `fmtMoveDate`, `_phaseRank` | ~80 LOC | Нет (чистые функции) | `views/gantt/pillFormatters.js` | LOW |
| `moveWtBetweenCols`, `revertMove` | ~60 LOC | Через ref на `state`, `RowFactory`, `Storage`, `colKeyMap` | `views/gantt/pillMutations.js` | LOW (передать `colKeyMap` параметром) |
| Aggregations: `teamCounts`, `colWtMix`, `flowIn/Out`, `teamWtBuckets` | ~80 LOC | rows + cols | `views/gantt/aggregations.js` | LOW |
| Header builder (`headerCols`, today-pill, dist-spark, flow-badges) | ~100 LOC | cols + aggregations | `views/gantt/headerRenderer.js` | MED |
| Pill builder (`_buildPill`) | ~110 LOC | row, donePills, unplannedPills, inProgressPills, transferCommentsMaps, assigneePills, esc, fmt-helpers | `views/gantt/pillRenderer.js` | MED-HIGH (много state-deps, надо тащить bag-параметром) |
| Ctx-menu (`removeCtxMenu`, contextmenu listener) | ~540 LOC | весь lex-scope | `views/gantt/ctxMenu.js` | HIGH (12 actions × callbacks обратно в renderChart + Storage + HistoryManager) |
| Keyboard-DnD (`_executeDrop`, `_kbDrag`, `_attachKeyboardDnD`, `_announce`) | ~210 LOC | wrap + state + COL_LABEL_MAP + moveWtBetweenCols | `views/gantt/keyboardDnD.js` | MED |
| Mouse-DnD (per-cell drop, wrap-level reorder) | ~140 LOC | те же + flagRejectedPill | `views/gantt/mouseDnD.js` | MED |

### Что НЕЛЬЗЯ выносить дёшево
- `_phaseRank` локально продублирован два раза (`:1276-1279` и `:1295-1298`) — это уже признак, что вынос pure-helpers просрочен.
- Aggregations пересчитываются на каждый renderChart — это аргумент за вынос, чтобы можно было memo'изировать по rows-hash.
- Вторичный wrap-level dragstart/dragend (`:2672-2705`) переплетён с per-cell drop через `_dragData`. Нужен общий DnD-controller с явным state-machine.

### Рекомендация V19 sequencing
1. **V19 split-1 (LOW risk):** pure helpers + aggregations + mutations → 3 файла, ~220 LOC out, без contract-changes.
2. **V19 split-2 (MED):** header + pill renderers (через explicit param-bag, никаких closures) → 2 файла, ~210 LOC out.
3. **V19 split-3 (HIGH, отдельный спринт):** ctx-menu в `ctxMenu.js` с callback-bag (`{onMutated, onSelectorRequest, requireMoveComment}`); параллельно — DnD-controller.
4. После всех трёх `renderDetailedTasks` остаётся ~600 LOC оркестратором — приемлемо.

---

## Сводная таблица

| # | Severity | Эксперт | Тема | Файл:строки |
|---|---|---|---|---|
| 1.1 | HIGH | UX | Cross-epic drag запрещён | `views/gantt.js:1686-1689` |
| 1.2 | HIGH | UX | move-next только +1 | `views/gantt.js:2127` |
| 1.3 | MED | UX | Нет kebab для ctx-menu | `views/gantt.js:2131` |
| 1.4 | MED | UX | Нет drill-down в Реестр/Jira | `views/gantt.js:1167-1264` |
| 1.5 | MED | UX | Cmd+K без assignee/wt-фильтров | `views/gantt.js:331-511` |
| 1.6 | LOW | UX | Today-marker слабый в overview | `views/gantt.js:1442` |
| 1.7 | LOW | UX | Нет multi-select | `views/gantt.js:2126+` |
| 2.1 | HIGH | Brand | Inline HSL stripe-left обходит токены | `views/gantt.js:1047, 1321` |
| 2.2 | MED | Brand | PHASE_COLORS вместо токенов | `views/gantt.js:1024,1094,1475` |
| 2.3 | MED | Brand | Inline grid-template-columns на каждой строке | `views/gantt.js:1046,1319,1407` |
| 2.4 | MED | Brand | tabular-nums не везде явный | `views/gantt.js:1099,1055` |
| 2.5 | LOW | Brand | Эмодзи `↗↘✕⇥` в trail/ctx | `views/gantt.js:2225,1392` |
| 3.1 | HIGH | Perf | innerHTML rebuild на любое действие | `views/gantt.js:1504` |
| 3.2 | HIGH | Perf | renderDetailedTasks 1 700 LOC closure | `views/gantt.js:715-2778` |
| 3.3 | MED | Perf | Scroll anchor при density-change | `views/gantt.js:233-256` |
| 3.4 | MED | Perf | Per-node bind-on-render | `views/gantt.js:1646,2083,1979` |
| 3.5 | LOW | Perf | Линейный rows.find ×12 за action | `views/gantt.js:1699,2598` |
| 4.1 | HIGH | Domain | Add-epic не пишет Sigma-полей | `views/gantt/aux.js:110-220` |
| 4.2 | HIGH | Domain | `from:'+'` не виден в metrics/export | `views/gantt.js:1130-1141, 2059` |
| 4.3 | MED | Domain | OT без подтипов | `views/gantt.js:707` |
| 4.4 | MED | Domain | `[edit-mode]` плейсхолдер не различим в audit | `views/gantt.js:818-822` |
| 4.5 | LOW | Domain | Add-epic без assignee из identity-table | `views/gantt/aux.js:110-220` |
| 5.1 | MED | A11y | aria-grabbed deprecated | `views/gantt.js:1810,1937` |
| 5.2 | MED | A11y | Focus return после ctx-action | `views/gantt.js:2353-2360` |
| 5.3 | MED | A11y | aria-label слишком длинный | `views/gantt.js:1218-1254` |
| 5.4 | MED | A11y | Resize-handle без keyboard | `views/gantt.js:2083-2124` |
| 5.5 | LOW | A11y | gdt-fasttip без role=tooltip | `views/gantt/aux.js:236-247` |
| 5.6 | LOW | A11y | Mouse-DnD не announce'ит | `views/gantt.js:1661,2691` |

**Итого: 28 пунктов** (7 HIGH / 13 MED / 8 LOW), плюс отдельный план Decomposition v19 на 3 split'а.

### Топ-5 приоритетов на ближайший спринт
1. **3.1 + 3.2** (innerHTML rebuild + декомпозиция) — основа, без неё дальнейшие фичи будут тормозить.
2. **1.1 + 1.2** (cross-epic drag, выбор целевого колодца) — самые частые продуктовые жалобы по UX.
3. **2.1** (HSL inline → CSS-tokens) — нарушение брендбука + dark-theme regression.
4. **4.1 + 4.2** (Sigma-привязка в add-epic, audit-видимость для `from:'+'`) — закрывает compliance use-case.
5. **5.2 + 5.3** (focus return после ctx-action, короткий aria-label) — критично для SR-пользователей при ежедневной работе.
