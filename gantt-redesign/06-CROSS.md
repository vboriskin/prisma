# 06 — CROSS: Реестр / Гант / Канбан / Таймлайн

> **Read-only audit.** Сравнение четырёх view'ов задач модуля «След пути» под вопрос Дмитрия (П12, BE-lead): «6 разных табов для одних и тех же задач — слить в один с layout-toggle?» Контекст — Гант сейчас редизайним, и это шанс задать cross-cutting вопрос **до** того, как мы зафиксируем Гант как самостоятельную секцию.
>
> Источники: `views/registry.js` (962 LOC), `views/gantt.js` (2 582 LOC), `views/kanban.js` (133 LOC), `views/timeline.js` (223 LOC, +`PodlozhkaView` в том же файле), `index.html` §899–1079, `app/appSettings.js` (`MODULES.path`), `audit-2026-05-04/12-user-feedback.md` §2 (Дмитрий) + §8 quick-win #6.

---

## 1. Inventory — что показывает каждый view

### Реестр (`views/registry.js`, секция `#section-registry`)

1. Топ-полоса действий: `+ Строка`, Undo/Redo, «Столбцы», «Настройки реестра», fullscreen, «Сбросить порядок столбцов».
2. Bulk-panel (скрыт по умолчанию): release / scope / priority / assignee / done / clear release / clear blocker (`#bulk-panel`, index.html 916–949).
3. Sticky header с pin-кнопкой на колонке, drag-сортировка колонок (`registry.js` 191–195), sort-iconы.
4. Body: 36-px строки, inline-edit (`text` / `number` / `select` / `multiselect` / `tags` / `scope`), tag-suggest, color-row, bulk-checkbox.
5. Auto-derived колонки (`row.dirty + RowFactory.updateDerived`) после каждого edit'а.
6. Empty-state с дифференциацией «нет данных» vs «фильтр пуст» (`_renderEmptyState`).
7. Prizma page-header (`renderPageHeader('registry', …)`) — eyebrow + h1 + sub.

### Гант (`views/gantt.js`, секция `#section-gantt`)

1. Топ-полоса: plan-lock (`gantt-lock-status`, `btn-gantt-lock-plan`, `btn-gantt-edit-mode`, `btn-gantt-unlock-plan`), Undo/Redo, Cmd+K jump, density-toggle, expand-all, fullscreen.
2. Pill-anatomy legend (collapsible, `#gantt-pill-legend`).
3. Локальный фильтр-bar `#gantt-filters` — но `renderFilters()` сейчас прячет его (`el.style.display='none'`, gantt.js 561–564); локальный state `GanttView.gf {team, scope, onlyBlocking, onlyNoRelease, onlyRisky}` остаётся в JS, но UI убран.
4. Сетка релизов (бэклог / 1.20 / 1.21 / 1.22 / OT) с pill'ами по команде × эпику × типу работ; внутри ячейки сортировка по `PHASE_ORDER`.
5. DnD pill между ячейками + reorder внутри ячейки, keyboard-режим (`Enter/Space → drop`, gantt.js 1629), plan-lock comment-prompt (`requireMoveComment`).
6. Bulk-add работ в ячейку с обязательным комментарием (gantt.js 1914), context-menu, today-pill, trail/arrows.
7. Overview-mode (одна стек-строка на команду, gantt.js ~A4) и Compact density.

### Канбан (`views/kanban.js`, 133 LOC, `#section-kanban`)

1. 5 колонок-релизов (Без релиза / 1.20 / 1.21 / 1.22 / Овертайм).
2. Карточка эпика: команда / эпик / Jira-tags / scope-chip / типы работ / роль / блокер / risk-badges / done / Jira-status / PR-status.
3. DnD карточки между колонками (`KanbanView._drag`, dragstart/dragover/drop) — меняет `release*Types` поля.
4. Border-status: `card-blocking` / `card-risky` / `card-done` / `kanban-card-overdue` (3-px stripe-left для просроченного блокера).
5. Cap 100 карточек на колонку («…ещё N»).
6. Toast-инфо при невалидном drop'е (карточка уже в колонке / не найдена) — kanban.js 44–56.

### Таймлайн (`views/timeline.js`, секция `#section-timeline`)

1. Btn-group режим: «Сводный» / «Детальный» (`timeline-mode-summary` / `-detailed`).
2. **Summary**: 3 секции — «Количество задач по стадиям», «По типу работ», «По статусу Scope». Стадии = те же 5 релиз-колодцев. Bar-chart по WT с легендой.
3. **Detailed**: для каждой стадии × команды — стек-бар по типу работ + count.
4. Никакой инлайн-правки — это чисто **аналитический** read-only view.
5. Пустая стадия — фолбэк-плейсхолдер «Нет задач в этой стадии».
6. Цветовая палитра WT встроена (`_wtColors` 9 цветов).

---

## 2. Матрица возможностей

| Фича | Реестр | Гант | Канбан | Таймлайн |
|---|:---:|:---:|:---:|:---:|
| Inline-edit ячеек | ✅ (text/num/select/multi/tags/scope) | ❌ | ❌ | ❌ |
| DnD контента | ✅ (колонок) | ✅ (pill между ячейками + reorder + keyboard) | ✅ (карточка между релизами) | ❌ |
| Bulk-select rows | ✅ (`bulk-row-cb` + select-all) | ⚪ только bulk-add работ в ячейку | ❌ | ❌ |
| Глобальные фильтры (`state.filters`) | ✅ | ✅ | ✅ | ✅ |
| Локальные фильтры view'а | ❌ | ⚪ `GanttView.gf` есть в JS, UI скрыт | ❌ | ⚪ `timelineMode` |
| Сортировка | ✅ (any column, `state.sort`) | ⚪ авто по `PHASE_ORDER` внутри ячейки | ❌ | ❌ |
| Group-by | ⚪ pinnedCols + colOrder | ✅ team → epic → wt (фиксировано) | ⚪ release (фиксировано) | ✅ stage → team / stage → wt / stage → scope |
| View-only / read-only mode | ❌ (всегда editable) | ✅ (`planLocked` гард + comment-flow) | ❌ | ✅ (по природе) |
| Plan-lock контракт | ❌ | ✅ (`state.planLocked` + `requireMoveComment`) | ❌ (изменения проходят без gate'а) | n/a |
| Keyboard-навигация | ✅ (Tab/Enter/Esc по ячейкам) | ✅ (Enter/Space drop, ctx-menu) | ❌ | ❌ |
| Cmd+K jump (внутри view) | ❌ | ✅ (`btn-gantt-jump`) | ❌ | ❌ |
| Fullscreen | ✅ (`btn-fullscreen-registry`) | ✅ (`btn-gantt-fullscreen`) | ❌ | ❌ |
| Undo/Redo | ✅ (`btn-undo`/`btn-redo`) | ✅ (`btn-undo-gantt`/`btn-redo-gantt`) | ❌ (commit идёт через `Storage.save`, undo возможно через History, но кнопок нет) | ❌ |
| Empty-state с дифференциацией | ✅ (фильтр vs данные) | ⚪ один state | ⚪ один state | ⚪ один state |
| Prizma page-header | ✅ | ❌ (legacy `<h2>`) | ✅ (`_injectKanbanHeader`) | ✅ (`_injectPrizmaHeader`) |

> **Замечание про plan-lock.** Канбан-drop меняет `release*Types` напрямую без `requireMoveComment` — это **дыра в контракте плана** (gantt.js 727 проверяет `planLocked && editModeOn`, kanban.js 39–75 — нет). Если объединять view'ы (γ), это всплывёт сразу.

---

## 3. Уникальность

- **Реестр**: inline-edit, drag-сортировка колонок, pinned-колонки, bulk-panel с 8 операциями, сортировка по любой колонке, color-row. Это рабочая поверхность Дмитрия и Игоря (4 quick-win-таблица — оба ставят Реестру 5/5).
- **Гант**: plan-lock + comment-flow, pill-anatomy + trails, bulk-add работ в ячейку через модалку, overview-mode, density-toggle, Cmd+K по эпикам и командам, keyboard-DnD. **2 582 LOC** — самый большой view-файл в репозитории; одна треть от Реестр+Канбан+Таймлайн+Подложка вместе.
- **Канбан**: статус-как-релиз семантика, карточная плотность с интеграцией-чипами (Jira-status, PR-status). **Только здесь** PR/Jira-status видны в основной плоскости (в Реестре они в скрытых столбцах, в Ганте их нет).
- **Таймлайн**: stack-bar агрегации (count × WT × scope), cross-stage сравнение в одном экране. Это **не редактор**, а **диагностический срез**. У него нет аналога ни в одном другом view.

---

## 4. Три варианта

### α — keep separate, только Гант refresh

**Pros.**
- Нулевая ломка контрактов: plan-lock остаётся в Ганте, inline-edit — в Реестре, DnD-валидаторы трогать не надо.
- Не растёт scope гант-редизайна (синтез 00-SYNTHESIS определяет 5 нот: IA / Visual / Interaction / UX / Motion — все локальны Ганту).
- Тесты `tests/unit/views-headers.test.js`, `ganttHtmlExport.test.js`, e2e — все остаются валидны.

**Cons.**
- **Проблема Дмитрия не решается.** П12 §2 frustration #1 явно: «6 табов для одних задач». P12 §8 quick-win #6 — Large effort, Высокий impact. После α-релиза остаётся открытым.
- Anna и Олеся **проиграют пассивно**: для них Гант = 1/1 в персона-таблице, и оставить его отдельной полноразмерной точкой навигации — это шум.

**Эффект.** Дмитрий: 0. Игорь: 0. Анна: 0. Олеся: 0. Power-tool остаётся *работает*, но навигационная боль не уходит.

### β — shared toolbar/filter, view-toggle над четырьмя секциями

**Архитектурно.** Над `#section-registry/-gantt/-kanban/-timeline` встаёт общий хедер: «ЗАДАЧИ» + сегментный selector + общий фильтр-bar (`state.filters`). Сами секции остаются в DOM как сегодня; toggle — это просто `App.navigateTo`-маршруты, обвешанные единым shell'ом.

**Pros.**
- Дмитрий получает «один смысловой раздел» — IA-уровень его frustration уходит наполовину.
- Контракты не трогаем: каждый view рендерится в своей секции, plan-lock остаётся на Ганте, inline-edit — на Реестре, тесты не падают.
- Можно сделать как layered-CSS-задачу + изменение `MODULES.path` (group label `Задачи` → 4 sub-keys).

**Cons.**
- Топ-кнопки секций **всё равно разные**: «+ Строка» Реестра ≠ «Зафиксировать план» Ганта ≠ «Перетащите карточку» Канбана ≠ btn-group режима Таймлайна. Shared toolbar упрётся в развилку «общее или специфичное», и без аккуратной сигнализации Анна снова потеряется.
- Между секциями — full-page transition (текущая `App.renderActive` свопает классы `.app-section.hidden`). DOM не реюзится, scroll/state per-view теряется.
- Олеся: «4 layout'а одного и того же» всё равно не проще, чем 4 пункта меню.

**Эффект.** Дмитрий: +0.5⭐ (IA-боль уходит, но guts остаются разные). Анна: 0. Игорь: 0 (он использует только Реестр + bulk). Онбординг: tooltip на сегменте «view-toggle» + нужен общий «о чём здесь».

### γ — единая «Задачи» с сегментным переключателем layout

**Архитектурно.** Один `<section id="section-tasks">`, один Prizma-header, один shared toolbar, один filter-bar, **общий** mount-point для view-render'ов. `state.tasksLayout ∈ {registry, gantt, kanban, timeline}` хранится отдельно (или в URL hash). Render-функции остаются разные (`RegistryView.render` / `GanttView.render` / …), но рендерят в один контейнер.

**Pros.**
- Полностью решает П12 quick-win #6 и frustration #1 Дмитрия.
- Один URL / один screenshot для онбординга — Олеся видит одну сущность, переключатель — это «настройка моего взгляда».
- Можно унифицировать **общий тулбар**: bulk-select (если выделение есть → bulk-panel поверх любого layout'а), filter chips, save-status, fullscreen.

**Cons.**
- **Контракт plan-lock**: сейчас он живёт на Ганте, а Канбан-drop его игнорирует (см. §2). Если γ предполагает *общий* DnD-handler — это надо унифицировать. Это **не bug-fix-уровень**, это redesign контракта DnD-валидаторов.
- **Bulk-select** работает только в Реестре. На Ганте — `bulk-add работ в ячейку` (другая семантика). На Канбане — нет. Совместить → пересчитать UX bulk'а × 4 layout.
- **Тулбар-collision**: Реестру нужны «+ Строка / Столбцы / Настройки», Ганту — `lock plan / edit-mode / Cmd+K / density / overview`, Канбану — ничего, Таймлайну — `summary/detailed`. Это 3 разных набора кнопок; в γ они должны жить в одном бруске и переключаться по `state.tasksLayout`. Это **полу-копия** того, что сделать ничего не делаем (сегодня каждая секция держит свои), но в одном DOM-узле.
- **Тесты**: `tests/unit/views-headers.test.js` ожидает per-section header injection; section-IDs захардкожены в `BLOCKS_PER_SECTION` (`registry`, `gantt`, `kanban`, `timeline`, `podlozhka`). Расхлопывание секций ⇒ переписать `BLOCKS_PER_SECTION` под новую плоскую плоскость + миграция localStorage `sbof_app_settings_v1`.
- **Sidebar**: `MODULES.path` сейчас содержит 6 sub-sections; Дмитрий-quick-win сводит к одному. Это меняет `defaultSection` логику + breadcrumbs + Cmd+K.
- **Кто проигрывает.** Игорь: keyboard-flow Реестра (Tab по ячейкам) и Cmd+K Ганта — разные. В γ они должны жить рядом без конфликта shortcuts. Светлана / Анна — нейтрально (они в Гант не ходят).

**Объём работ (γ, оценка по факту LOC + контрактов).**

| Под-задача | LOC-дельта | Дни (1 разработчик, full-time) |
|---|:---:|:---:|
| Новая секция `section-tasks` + segment-toggle + URL/hash маршрут | ~150 | 1 |
| Перевод `RegistryView/GanttView/KanbanView/TimelineView.render` на shared mount-point | ~200 (touch-points) | 2 |
| Унификация тулбара (контекстные кнопки по layout'у) | ~250 | 2 |
| Plan-lock generalization: распространить `requireMoveComment` на Канбан-drop | ~80 + тесты | 1 |
| Bulk-select: ввести cross-layout `state.bulkSelected` поверх Реестра, отображать bulk-panel над любым layout'ом | ~150 | 1.5 |
| Миграция `BLOCKS_PER_SECTION` + `sbof_app_settings_v1` + sidebar `MODULES.path` | ~120 | 1 |
| Тесты: переписать `views-headers.test.js`, добавить контракт-тест на `tasksLayout` свитч + plan-lock на Канбане | — | 1.5 |
| Onboarding-обновление: tooltip на сегменте, mini-tour по layout'ам | ~100 | 0.5 |
| QA-проход (Дмитрий + Игорь + Анна по ролям) + регресс | — | 1.5 |
| **Итого** | ~1 050 | **~12 рабочих дней (2.5 недели)** |

> Это **L** в шкале quick-win #6 («1–2 недели»). Реалистичная оценка ближе к верхней границе — потому что Гант = 2 582 LOC и его mount-point рефактор требует осторожности с `_clearTransientInteractions`, scroll-preserve, fullscreen-режимом. Подложка (5-й view модуля «След пути») в смету **не входит** — см. §6.

---

## 5. Финальная рекомендация

**Не делать γ в рамках текущего спринта Гант-редизайна.** Это решение Дмитрия № 6 — Large effort, и в смешать его с Гант-redesign'ом значит **удвоить риск** (визуальная переделка Ганта × IA-переделка модуля). Контракт plan-lock и bulk-select требуют отдельной мысли — это не «склеить хедер».

**Рекомендую β как промежуточный шаг (1.5–2 дня работы).** Конкретно:

1. Выровнять `<section-header>` всех 4 view'ов до общего шаблона (Prizma page-header уже на 3 из 4 — Гант последний без него; редизайн Ганта (нота 02-VISUAL) и так это даёт).
2. Поднять btn-group селектор «Реестр / Гант / Канбан / Таймлайн» в Prizma-header (узкая полоска под h1) — он маршрутизирует через существующий `App.navigateTo`. Никаких миграций state, никаких рефакторов render'ов.
3. Sidebar в `MODULES.path`: оставить «Реестр» как `defaultSection`, остальные 3 view'а перевести в **sub-routes** (или скрыть — открываются только из page-header'а). Это уже фактически сейчас работает через `AppSettings`-toggle: можно поставить им `hiddenSections: ['gantt','kanban','timeline']` по умолчанию + явно держать сегмент в Реестр-page-header'е.

После β у Дмитрия появляется **смысловое единство** «Задачи» без рисков ломки контрактов. Через 2–3 спринта, когда plan-lock-generalization и bulk-select-cross-layout будут проектно отделены, можно идти в γ.

**γ — да, но не сейчас.** Записать в roadmap V18 / V19 как отдельный workstream с собственным sub-audit'ом (CROSS-2: «task-layout merge — план перехода»).

---

## 6. Cross-cutting наблюдения

### Подложка — куда денется

Подложка (`PodlozhkaView` живёт в `views/timeline.js`, секция `#section-podlozhka`) — это **5-й view** модуля «След пути». Она помечена как `_DEBUG_ONLY_SECTIONS` (`appSettings.js:250`) — то есть в продакшн-IA уже сегодня скрыта когда `cfg.debugMode === false`. Это значит, что для вопроса Дмитрия **она не должна учитываться**: в его сценарии (production) её вообще нет. В γ — тем более не объединять, она дев-инструмент.

Альтернатива (П12 рекомендация Дмитрия §«Что бы изменил первой»): «Подложку — в Реестр как режим группировки». Технически это легко: `PodlozhkaView` сегодня собирает таблицу через `RegistryView.getVisibleCols()` (timeline.js:159) — то есть зависимость уже есть. Переезд = опция «Печать-режим / квартальный артефакт» в селекторе layout'а, которая показывает Реестр в подложечной развёрстке.

### Какие фильтры общие, какие разделены

- **Общие** (через `state.filters` + `FilterEngine.getFiltered`): search, team, scope, release, риски, isDone — работают везде. Filter-cache единый.
- **Локальные**:
  - Гант: `GanttView.gf {team, scope, onlyBlocking, onlyNoRelease, onlyRisky}` — в JS, UI скрыт (`renderFilters` пишет `display:none`). По факту дублирует глобальные. Это **dead state**, можно удалить.
  - Таймлайн: `state.timelineMode {summary | detailed}` — это режим, не фильтр.
  - Подложка: `state.podlozhkaGroup {team | epic | scope | none}`, `state.podlozhkaMode {summary | detailed}`.
- **Уникально-локальное**: сортировка Реестра (`state.sort`), `bulkSelected` Реестра, `planLocked` Ганта, drag-state Канбана/Ганта.

В γ глобальные фильтры остаются как есть; локальные state'ы переезжают в `state.tasksLayoutState[layout]` для изоляции.

### Минимальный шаг к γ без полного rip-up

1. **Сейчас в Гант-редизайне (нота 02-VISUAL)**: добавить Prizma page-header Ганту — это **уже** делает выравнивание шапки между всеми 4 view'ами без архитектурных перестановок. Это бесплатный шаг к γ.
2. **+1 день**: добавить узкий sub-band-selector «↺ Реестр · Гант · Канбан · Таймлайн» в Prizma-header'е каждого из 4 view'ов. Он работает поверх `App.navigateTo`, никакой миграции. Это и есть β.
3. **Удалить dead code в Ганте**: `GanttView.gf` + `renderFilters` (gantt.js 561–573) — 12 строк. Закрывает локальный фильтр-bar, который скрыт но мутирует state.

### Контракт-риск, на который надо сразу указать

**Канбан-drop игнорирует plan-lock.** Это уже сегодня баг (kanban.js 39–75 не проверяет `state.planLocked`). В γ-сценарии, где Канбан = «другой layout того же», это становится **критично**: Дмитрий может через Канбан обойти fixed-plan-comment-flow, который Игорь считает контрактным. **Зафиксировать как самостоятельный bug** независимо от того, идём мы в γ или нет.

---

## 7. Спорные моменты

1. **Реестр как «default-layout» vs Гант как «default»**. Дмитрий и Игорь — Реестр-первичные (5/5). Анна и Светлана — никто. Олеся — теряется на любом из них. Если γ — defaultLayout = `registry`. Но Гант редизайним *именно сейчас* как «hero-views», и это вступает в противоречие с «Гант = secondary-layout». Кто из заказчиков-внутренних победит — открытый вопрос.
2. **Канбан как самостоятельный view вообще нужен?** 133 LOC, Дмитрий — 3/5, Анна — 2/5. Уникум — только PR/Jira-status в карточке. Можно ли считать его подмножеством Реестра с `groupBy=release` и `template=card`? Технически — да; политически — П12 говорит «не убивайте, мы ими пользуемся». Не трогать в текущем спринте, но в γ это первый кандидат на схлопывание в Реестр-card-mode.
3. **β как «промежуток» — реальный или leave-it-as-is?** Если на β согласовать но не сделать γ за 6 месяцев, β превратится в долгосрочный компромисс. Опыт redesign-итераций (V13 → V17.2) показывает, что «временные» selectorы становятся постоянными. Заранее заложить deprecation-метку: «β-toggle деактивируется в V19 при включении γ-mode».
4. **Tooltip-glossary (П12 quick-win #7)** vs «View-toggle UX». Если selectorы называются Реестр/Гант/Канбан/Таймлайн (стандартные имена) — tooltip-glossary не нужен. Если переименовать в брендовые («След / Курс / Колонки / Хроника») — Олеся снова потеряется. Рекомендую **в γ оставить стандартные имена layout'ов**, а brand-словарь применять только к module-уровню (Курс / След пути / Команда) — это уже разрешено в П12 Insight 5.
5. **Сегмент или dropdown.** btn-group из 4 кнопок при ширине 14" окна Анны (П12 §1) пожирает ~280px. Альтернатива — combobox «View: Реестр ▼». Сегмент даёт 1-tap; combobox экономит место. По брендбуку (V15 Spine) предпочтительнее sub-band btn-group; по Игорю (keyboard) — combobox тоже норм через `aria-haspopup`. Открыто.
6. **`gantt2` legacy.** В index.html строка 1027 пометка «V14: section-gantt2 removed (B2)». То есть прецедент **удаления view'а из этого модуля** уже есть. Это снижает страх ломки контракта в γ — но и поднимает вопрос: «второе уничтожение крупного раздела — не слишком ли?». Возможно, аккуратнее идти через β + measurable usage-телеметрию (`logger.event('tasks.layout_switch', { from, to })`) и принимать γ-решение через 4–6 недель данных.
7. **AI-CEO / Действия как смежные модули.** Дмитрий §2 жалуется параллельно на «6 табов задач» и на «Действия — отдельный таб» (П12 §4 Игорь, Сценарий-Г). Это **другая** боль — bulk-операции должны жить рядом с выделением, а не на отдельной странице. Если в γ мы делаем shared bulk-panel поверх любого layout'а — это **на половину закрывает quick-win #5** (action-sheet вместо отдельной страницы). Но это уже scope-creep — фиксировать как side-effect, не как цель.

---

## 8. Сценарии: что происходит при каждом варианте

### Дмитрий открывает «Реестр», правит 8 ячеек, переключается в «Гант», переносит pill в 1.22

| Шаг | α (сегодня) | β (shared toolbar) | γ (один section) |
|---|---|---|---|
| Открыть Реестр | sidebar-click (`registry`) | sidebar-click (`tasks`) → segment Реестр | sidebar-click (`tasks`) → segment Реестр |
| Inline-edit 8 ячеек | работает через `RegistryView.renderCell` | работает | работает (тот же mount) |
| Переход в Гант | sidebar-click (`gantt`) → full-section swap, scroll сбрасывается | segment-toggle, full-section swap (быстрее визуально, но DOM swap тот же) | segment-toggle, **в том же `<section-tasks>`** — render-функции просто перерисовывают mount-point. Scroll Реестра не нужен. |
| Перенос pill | `requireMoveComment` если `planLocked`, comment-modal | то же | то же — но **контракт plan-lock не должен зависеть от текущего layout'а**, иначе γ ломает `state.planLocked` |
| Видна ли подсветка изменённых ячеек после возврата в Реестр | нет, full re-render | нет | нет (mount-точка перерисовывается) — нужно ввести short-lived подсветку (`row.justEdited` в state с TTL 5s) |

В α/β Дмитрий потеряет ~1.2s на full-section swap × 5 раз в день = ~6s/день. Это не блокер. Главная боль — **потеря контекстных кнопок** при swap'е (он ищет «Зафиксировать план» в шапке Реестра — её нет). β это не решает; γ — решает через layout-aware-toolbar.

### Олеся открывает «Задачи» впервые

| Сценарий | α | β | γ |
|---|---|---|---|
| Что видит | 4 пункта в `MODULES.path` без объяснений | 1 пункт «Задачи» + сегмент-toggle с 4 кнопками | 1 пункт «Задачи» + сегмент-toggle |
| Что делает | случайно кликает первый, теряется | видит 4 layout'а одной сущности — **семантическое** упрощение | то же, что β; **плюс** можно добавить «layout-tip» в onboarding-tour |
| Сколько кликов до «вижу свои задачи» | 1–2 (если повезло с дефолтом) | 1 (попадает на default-layout) | 1 |
| Где боль | Не понимает, что 4 пункта — это **одно и то же** в разных видах | tooltip на сегменте решает | то же |

### Игорь делает bulk-релизные правки на 50 строках

| Шаг | α | β | γ |
|---|---|---|---|
| Выделение 50 строк | Реестр, `bulkSelected` Set | Реестр, тот же | Реестр-layout, тот же |
| Открытие bulk-panel | Реестр секции | Реестр секции | shared bulk-panel над `section-tasks` — **остаётся видимым при переключении на Гант**, что позволяет валидировать выбор визуально |
| Применение | работает | работает | работает + **bonus**: visual-confirm в Ганте через подсветку выбранных pill'ов |

Это **главный аргумент за γ** на UX-слое. Сегодня bulk-select видим только в Реестре. В γ это становится cross-layout-операцией — и это **новое качество**, которого нет ни в α, ни в β.

---

## 9. Контракт-чек-лист для γ (если когда-нибудь делаем)

Прежде чем начинать γ-проект, явно подтвердить эти 7 пунктов в design-review:

1. **Plan-lock generalization.** `requireMoveComment` срабатывает на любом DnD-операторе изменения `release*Types`, не только в Ганте. Тест-контракт.
2. **Bulk-select cross-layout.** `state.bulkSelected: Set<rowId>` остаётся валидным при переключении layout'а; visual-marker применяется ко всем 4 рендерерам.
3. **Filter-state shared.** `state.filters` уже общий, но `state.tasksLayoutState[layout]` (per-layout local) должен быть изолирован.
4. **Scroll-preserve.** Каждый layout сохраняет свою позицию скролла отдельно (Гант сегодня уже хранит 4 scroll-точки, gantt.js 591–598; обобщить).
5. **Undo/Redo unified.** Сегодня Реестр и Гант имеют **разные** Undo-кнопки в шапке. В γ — одна, layout-aware.
6. **Cmd+K layout-aware.** Игорь жмёт Cmd+K — palette должен предлагать команды в контексте текущего layout'а (поиск эпиков в Ганте, поиск строк в Реестре).
7. **Telemetry.** `logger.event('tasks.layout_switch', { from, to, ts })` — обязательно, чтобы измерить usage-distribution и подтвердить, нужен ли вообще Канбан.

Если хотя бы 2 из 7 не подтверждаются за 1 design-meeting — γ откладывается на следующий цикл и остаёмся на β.

---

> **Метод-нотка.** Этот отчёт основан на чтении кода (v17.2, V18 active) — не на интервью и не на гипотезах о том, что «было бы хорошо». Все цифры LOC, имена контрактов и поведения — из текущего HEAD. Дмитрий — синтетическая персона из `12-user-feedback.md`, его реакции воспроизведены по тексту, не по новому опросу.
