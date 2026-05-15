# 00 — Синтез 6 экспертных отчётов · Гант · 2026-05-04 deep

> Вход: 01-visual-brand, 02-typography, 03-interaction-motion, 04-a11y, 05-ia-ux, 06-code-health (написаны 2026-05-04, read-only).
> Выход: единое предложение для согласования. Без правок кода.

---

## TL;DR

V21 pills refresh **закрыт чисто** — никто из 6 экспертов не ругает (border убран, weight 500, work-type tokens, hover D, ghost-chip B, density minimal, arrows на токенах). Wave 1 cleanup из `gantt-redesign/` реализован на ~70%. Реальные проблемы сейчас:

1. **Забытая регрессия эмодзи** `▸/▾` в team-collapse (textContent затирает SVG)
2. **Prod-bug в HTML-экспорте**: literal `${gexIcon(...)}` в выходе из-за пропущенных backticks
3. **Toolbar-кнопки без `:focus-visible`** — все 12 кнопок Ганта недоступны клавиатурному пользователю
4. **Trail-chip light theme contrast fail** (от моих сегодняшних правок B): WCAG 1.4.3 fail
5. **5 release-цветов всё ещё в 6 источниках Tailwind-hex** — `--release-*` токены готовы в `:root` но Гант их не использует

**137 findings суммарно**: 9 Critical, 44 Important, 84 Polish, 12 cross-confirmed между экспертами.

---

## Top 10 cross-cutting (порядок исполнения)

| # | Что | Где | Эксперты | Severity | Цена |
|---|---|---|---|---|---|
| 1 | **Prod bug**: `statusLabel` single-quoted, `${gexIcon(...)}` не интерполируется в HTML-экспорте | `ganttHtmlExport.js:209,210,332,333` | Code Health | Critical | 1 строка |
| 2 | **`▸/▾` regression**: textContent затирает SVG-chevron на team-collapse toggle | `gantt.js:1542` | Interaction, IA | Critical | 1 строка |
| 3 | **`.btn:focus-visible` отсутствует** — все 12 toolbar-кнопок Ганта без видимого фокуса | `styles.css:820` | Interaction, A11y | Critical (WCAG 2.4.7) | 1 правило |
| 4 | **Trail-chip light theme contrast fail** (мои правки B): FE `#3A8060` на `#F0EDE5` = 4.4:1 (нужно ≥4.5:1) | `theme.css:97-105` | A11y, Visual | Critical (WCAG 1.4.3) | затемнить 3 light-токена |
| 5 | **`btn:hover translateY(-1px)` нарушает reduced-motion** — глобальный `*` гасит длительность, transform остаётся | `styles.css:827-828` | Interaction, A11y | Important (WCAG 2.3.3, brand §9) | 1 @media-rule |
| 6 | **`aria-grabbed` deprecated** ARIA 1.2 — screen readers ignore. Drag-state идёт через live-region (работает) | `gantt.js:1751,1778,1878` | A11y | Important | удалить 3 строки |
| 7 | **Lock-status без `aria-live`** — план фиксируется/расфиксируется, screen reader не получает | `index.html:999`, `app.js:1226` | Interaction, A11y | Important (WCAG 4.1.3) | 1 атрибут |
| 8 | **5 release-цветов в 6 источниках Tailwind hex** — `--release-*-color` токены готовы, Гант их не использует | `styles.css:6093+`, `gantt.js inline x2`, `ganttHtmlExport.js`, `constants.js` | Visual, IA | Important | sed-уровень, ~15 правок |
| 9 | **Cmd+K palette без combobox aria** — `role="listbox"`, `aria-activedescendant`, `role="option"` отсутствуют | `index.html:373-387`, `gantt.js:413-419` | Interaction, A11y | Important (WCAG 4.1.2) | ~5 атрибутов |
| 10 | **Naming chaos «1.20/Релиз 1.20/r120/OT/Овертайм»** — 4 написания одного релиза | `constants.js`, `gantt.js × 4`, `modals × 2` | IA | Important | новый `RELEASE_LABELS` константа |

---

## Сводная таблица — все 88 пунктов на человеческом

**Условные обозначения**: 🔴 сейчас (баги, недоступно, видно сразу) · 🟡 скоро (важно, влияет на восприятие) · ⚪ потом (мелкая полировка)

### Критичные баги и недоступность

| # | Где | Что не так | Что предлагаем | Когда |
|---|---|---|---|---|
| 1 | Экспорт в HTML | Вместо галочки «Завершено» в выходном файле виден литерал `${gexIcon("check-circle")}` — пропущенные обратные кавычки в строке | Поправить кавычки в `ganttHtmlExport.js` строки 209, 210, 332, 333 | 🔴 |
| 2 | Кнопка свернуть/развернуть команду | После клика стрелка превращается из иконки обратно в Unicode-знак `▸/▾` — регрессия эмодзи-чистки | `gantt.js:1542` использовать `Icons.get('chevron-…')` вместо `textContent` | 🔴 |
| 3 | Все 12 кнопок toolbar Ганта | При навигации Tab клавиатурой нет видимого фокус-кольца — пользователь не понимает, на какой кнопке курсор | Добавить общее правило `.btn:focus-visible { outline: 2px solid var(--prizma-information); outline-offset: 2px }` | 🔴 |
| 4 | Чипы переноса в светлой теме | Текст серых типов работ (FE, fallback) на бежевой плашке даёт контраст 4.0–4.4:1 — ниже минимума 4.5:1, плохо читается | Затемнить light-токены `--prizma-worktype-fe/an/ba` в `theme.css:97-105` на ~10% | 🔴 |
| 5 | Кнопки toolbar при reduced-motion | У пользователя с включённым «убирать анимации» кнопки всё равно «прыгают» на 1px при hover | Адресный override `@media (prefers-reduced-motion) .btn:hover { transform: none }` | 🔴 |
| 6 | Бейдж «План зафиксирован» | Меняется без уведомления — пользователи скрин-ридеров не услышат, что план зафиксирован/расфиксирован | На `<span id="gantt-lock-status">` добавить `role="status" aria-live="polite"` | 🔴 |
| 7 | Drag-state на пилюлях | Используется `aria-grabbed` — атрибут отменён в ARIA 1.2, screen-reader его игнорирует | Удалить `aria-grabbed` из `gantt.js` (3 места) | 🟡 |
| 8 | Цвета и тексты в чипе переноса | Чип не получает фокус, нет описания — клавиатурный пользователь ничего не узнает о переносе | Сделать `<span tabindex="0" role="img" aria-label="перенос FE: 1.20 → 1.21, 12.04">` | 🟡 |

### Тексты в интерфейсе на «нашем» русском

| # | Где | Сейчас | Предлагаем | Когда |
|---|---|---|---|---|
| 9 | Подзаголовок страницы Гант | «Cascade-вид: когда какие шаги проходят по релизам» | «Когда что выпускается. Перетащите задачу в нужный релиз — план соберётся автоматически» | 🟡 |
| 10 | Empty-state | «Нет данных» | «План пуст. Загрузите XLSX или включите демо-данные, чтобы увидеть курс квартала» + CTA | 🟡 |
| 11 | Тост после фиксации плана | «План зафиксирован на 04.05.2026 14:00 — переносы теперь требуют комментарий» | «Курс зафиксирован · 04.05.2026 14:00. Переносы теперь требуют комментарий» | 🟡 |
| 12 | Тост после расфиксации | «Фиксация плана снята» | «Курс снова открыт для коррекций» | 🟡 |
| 13 | Тост запрета кросс-эпик переноса | «Перенос между эпиками не предусмотрен» | «Эта задача в эпике X — её можно перенести только внутри него» | 🟡 |
| 14 | Тост ошибки источника | «Задача больше не существует — перенос отменён» | «Задача удалена другим пользователем — перенос отменён» | 🟡 |
| 15 | Тост ошибки модалки | «Диалог комментария не открылся — перенос остановлен» | «Не удалось открыть форму комментария. Попробуйте ещё раз» | ⚪ |
| 16 | Тост типов задач | «В системе нет типов задач» | «Не настроены типы задач. Откройте Настройки → Типы работ» (с deeplink) | ⚪ |
| 17 | Заголовок add-target модалки | «В какой колодец добавить?» — «колодец» это внутренний жаргон | «В какой релиз добавить?» | 🟡 |
| 18 | Tooltip mode-кнопки | «Режим: Default (детальный) / Overview (одна строка на команду)» | «Вид: Подробный / Обзор по командам» | 🟡 |
| 19 | Tooltip density-кнопки | «Плотность строк (Regular / Compact)» — реальность 3 состояния | «Плотность: Свободная / Плотная / Минимум» | 🟡 |
| 20 | Кнопка «Подсказки» | Заголовок-существительное | «Как читать?» / «Помощь» — действие | ⚪ |
| 21 | Названия релизов | В коде живут 4 написания: «1.20», «Релиз 1.20», «r120», «OT», «Овертайм» — в col-header / legend / двух модалках по-разному | Один словарь `RELEASE_LABELS` в `constants.js`, везде `1.20 / Овертайм` | 🟡 |
| 22 | Колодец Бэклог в шапке | Без подписи (label=''), новички не понимают что это | Добавить eyebrow «Бэклог» 9-10px CAPS или tooltip «Бэклог: ещё не запланированные задачи» | 🟡 |
| 23 | Cmd+K placeholder | «Поиск команды или эпика…» — но теперь работает и task-by-id | «Поиск команды, эпика или задачи (PROJ-1234)…» | 🟡 |
| 24 | Кнопка ⌘K в шапке | Знак ⌘ показывается на всех платформах, на Windows должен быть Ctrl+K | Detect platform, либо нейтральное «Поиск» без хоткея | ⚪ |
| 25 | Легенда состояний | «Перенос с комментарием (наведи на пилюлю)» — устаревшая инструкция про hollow-twin маркеры | «Наведите на пилюлю — увидите комментарий» / «Добавлено после фиксации плана» (формальный язык, единый стиль) | 🟡 |
| 26 | Команда + chevron aria-label | «Скрыть/показать строки команды» | «Свернуть команду «Atlas» (12 эпиков)» — даёт screen-reader контекст | ⚪ |

### Цвета и темы (Tailwind→Призма)

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 27 | 5 цветов колодцев (1.20/1.21/1.22/OT/Бэклог) | Tailwind hex (`#4f46e5/#059669/#d97706/#dc2626/#6b7280`) живёт в 6 источниках: `styles.css × 4` + `gantt.js inline × 2` + `ganttHtmlExport.js × 2` + `constants.js`. Токены готовы в `:root`, но Гант их не использует | Заменить на токены — sed-уровень, ~15 правок | 🟡 |
| 28 | Полоски релиз-баров | `.gantt-bar-r121 #059669` / `.gantt-bar-r122 #d97706` — два случая выпали из токен-системы (r120/backlog/overtime уже на токенах) | Перевести два правила | 🟡 |
| 29 | Числа в team-header | Окрашиваются в цвет колодца (5 хардкод hex для активных, +5 для dark) — но число это нейтральный счётчик, цвет — у stripe-left | Числа в `var(--prizma-text-primary)`, signal через stripe на parent | 🟡 |
| 30 | Sparkline-бары | 5 хардкод hex для light + те же 5 для dark | Через `--release-*-color` токены, dark-override уйдёт сам | 🟡 |
| 31 | Inline hex'ы в JS | `gantt.js:1452, 528-531` рисуют `<span style="background:#4f46e5">` для легенды-точек | Перевести на CSS-переменные через `style="background:var(--release-r120-color)"` | 🟡 |
| 32 | Legend галочки/маркеры | `.gdt-pill-legend-state-done` `#059669`, `.gdt-pill-legend-cmt-add` `#3b82f6`, `.gdt-pill-legend-demo-state-active` `#4f46e5` | На signal-токены `--prizma-on-course/-information/-drift` | 🟡 |
| 33 | Колонка OT (Овертайм) | 4 разных красных hex'а в одной семантической точке | Унифицировать через `--prizma-off-course` | 🟡 |
| 34 | Контекст-меню danger-action | 6 хардкод hex (`#b91c1c/#fca5a5/...`) в одном месте | `var(--prizma-off-course)` + `var(--prizma-off-course-bg)` | 🟡 |
| 35 | Галочка «Завершено» внутри pill | `.gdt-pill-state-done` фон `#059669` хардкод | `var(--prizma-on-course)` | 🟡 |
| 36 | Indigo dragover-states | `rgba(79,70,229,...)` Tailwind-indigo в `.gantt-cell-dragover` и rail-flow | `color-mix(in srgb, var(--prizma-information) X%, transparent)` | ⚪ |
| 37 | Hatched-gutter в OT-колонке | `repeating-linear-gradient(rgba(220,38,38,.06))` + dark-override | Через `color-mix()` единое theme-aware правило | ⚪ |
| 38 | HTML-экспорт цвета | `.gex-status-{done/active/unplanned}` хардкод 3 hex без токенов | В `_BASELINE_CSS` встроить signal-tokens с fallback hex | 🟡 |
| 39 | Расхождение work-type палитры | `PHASE_COLORS` (для SVG-маркеров) даёт BA `#7c3aed` (Tailwind violet), а pill-stripe `#9C8FA8` (Призма приглушённый violet) — разные «семьи» | Синхронизировать значения PHASE_COLORS со значениями `--prizma-worktype-*` | 🟡 |
| 40 | Release-токены и темы | `--release-*-color` определены только в `:root`, нет варианта для `[data-theme="light"]` | Перенести в оба theme-блока theme.css | 🟡 |

### Модалки, диалоги, поиск

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 41 | Динамические модалки (история, добавление эпика) | Без `role="dialog"`, `aria-modal`, `aria-labelledby`, FocusTrap — фокус «утекает» из модалки | Использовать тот же шаблон что у статических модалок + FocusTrap.attach | 🟡 |
| 42 | Кнопка закрытия модалок history/add-epic | `'✕'` glyph в textContent | Inline SVG как в статических | 🟡 |
| 43 | Bucket-radio в add-target модалке | 5 radio «Бэклог/1.20/.../OT» без `<fieldset><legend>` — screen-reader не понимает «выберите один» | Обернуть в fieldset с visually-hidden legend | 🟡 |
| 44 | Tab внутри ctx-menu | Tab выводит фокус на body, меню остаётся открытым | Trap Tab, либо закрывать меню при Tab-out | 🟡 |
| 45 | Cmd+K palette: input | Без `role="combobox"`, `aria-controls`, `aria-autocomplete="list"`, `aria-expanded` | Стандартный WAI-ARIA combobox pattern | 🟡 |
| 46 | Cmd+K palette: results | Без `role="listbox"`, items без `role="option"` + `aria-selected` | То же | 🟡 |
| 47 | Cmd+K активный элемент | Highlight через JS-class, не через `aria-activedescendant` — screen-reader не озвучивает selection | Добавить `aria-activedescendant` на input | 🟡 |
| 48 | Tooltip pill | Срабатывает только на mouseover, без focusin — клавиатурный юзер не получит подсказку | Добавить focusin/focusout, `role="tooltip"`, `aria-describedby` на pill | 🟡 |
| 49 | Tooltip background | Хардкод `#1f2937` / `#f3f4f6` в inline style | Через токены `--prizma-bg-inverted` / `--prizma-text-inverted` | ⚪ |

### Trail-row (история переносов)

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 50 | Trail-rows показ | Видны всегда — на 50+ командах = 3-4 экрана scroll сверху | Свернуть по умолчанию: «4 переноса · показать» под team-row | 🟡 |
| 51 | Trail-row hairline (тонкая линия-коннектор) | Контраст 1.2:1 light / 1.6:1 dark — фактически невидима | Поднять цвет до `var(--prizma-text-secondary)` без opacity | ⚪ |
| 52 | Trail-row tooltip | На самих ghost-чипах только символы ↗/↘ — discoverability нулевая | Title-attr / data-tip с расшифровкой «Перенесено: BE-модель из 1.21 в 1.22 · 04.05.2026» | 🟡 |
| 53 | SVG-стрелки переноса | Без `aria-hidden="true"` — screen-reader озвучивает «graphic» для каждой | `svg.setAttribute('aria-hidden','true')` | ⚪ |

### Pills и состояния

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 54 | State-glyph completed (●/✓/○) | Чисто визуальные, в `aria-label` pill не упоминаются | Добавлять статус-постфикс: «в работе»/«завершено»/«не запланирована» | 🟡 |
| 55 | Cmt-marker (квадратик переноса) | `cursor:help` без aria-label / title — screen-reader не понимает «есть комментарий» | Aria-label или вынос признака в pill aria-label | 🟡 |
| 56 | State-done «галочка» | `font-weight: 800` в правиле, content уже SVG-mask — мёртвый weight | Удалить `font-weight: 800` | ⚪ |
| 57 | Density compact font-size | 10.5px — половинный размер вне type-scale брендбука | Решить: либо принять как density-исключение, либо убрать compact-уменьшение | ⚪ |
| 58 | Initials pill (инициалы исполнителя в Compact density) | Light-фон `var(--text-3)` `#B5B5BC` = 1.6:1 — fail контраст | Поднять до `--text-2` | 🟡 |

### Поведение интерактива и motion

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 59 | Кнопки `.gantt-team-vis-btn` (chevron 20×20) и `.gdt-add-type-btn` (плюс 22×22) | Меньше WCAG-минимума 24×24 — мисс-таргет на тач-экранах | Поднять до 24×24 | 🟡 |
| 60 | Pulse при перетаскивании | Анимация infinite — на 80 drop/день = 2-3 минуты infinite-Pulse в периферии | Ограничить до 3 циклов либо paused-on-dragleave | 🟡 |
| 61 | Emerge stagger при первом рендере | Обещано в Wave 4 (pills появляются по колонкам в каскаде), не реализовано | Добавить `is-first-render` class + stagger keyframe | ⚪ |
| 62 | Counter Align в team-header | После bulk-операции число меняется без feedback | Keyframe `prizma-counter-align` (уже спроектирован в Motion §6) | ⚪ |
| 63 | Tooltip drag-preview | Не реализован — пользователь узнаёт о промахе по toast'у | `setDragImage` или custom-tooltip над курсором | ⚪ |
| 64 | Toolbar-кнопки toggle (mode/density/tips) | Без `aria-pressed` — скрин-ридер не понимает, что состояние переключается | Добавить `aria-pressed="true|false"` | 🟡 |
| 65 | Кнопка «Подсказки» (gantt-tips-toggle) | Без `aria-expanded`, `aria-controls` — disclosure-pattern неясен AT | Добавить два атрибута | 🟡 |
| 66 | Resize-handles колонок | Только мышь — клавиатурный юзер не может изменить ширину | Добавить keydown-handler ←/→ для shift width на 8px | ⚪ |
| 67 | Toast после действия | Один общий канал aria-live="polite", error/warning не повышаются до assertive | Вторая live-region с aria-live="assertive" для error-toast | 🟡 |
| 68 | Hint-discoverability | Right-click ctx-menu, multi-select, kb-DnD (Enter→стрелки→Enter) не имеют visible affordance | Добавить `<kbd>` chiplets в footer Cmd+K palette с hint-ами | ⚪ |

### Иерархия и подписи

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 69 | Toolbar PLAN/VIEW/NAV группы | Разделены через невидимые `<span class="topbar-divider">` — пользователь не видит группы | Добавить eyebrow-подписи через `data-cluster-label` `::before` или tooltip | ⚪ |
| 70 | Density-кнопка (3 состояния) | Иконка одна, активное состояние не выделено | Менять иконку либо добавить state-индикатор | ⚪ |
| 71 | Mode-кнопка (Default/Overview) | Иконка одна, active-state не выделен | Active-state класс для overview-mode | ⚪ |
| 72 | Иерархия заголовков на странице | 7 визуальных уровней — должно быть 4 | Свести к 4: eyebrow / page-h1 / team-name (14/500) / pill-name (11/500) | 🟡 |
| 73 | Backlog rail-label | 13/700 weight, без mono — отстаёт от 1.20/1.21/.../OT (24/300 mono) | Привести к тому же 24/300 mono | 🟡 |

### Типографика (массовые правки)

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 74 | ~28 правил с font-weight 600/700/800 в гант-окружении | После V21 pill ушёл на 500 — окружение осталось «жирным» | Привести всё к 500, оставить 600 только на page-eyebrow и primary-button hover | 🟡 |
| 75 | 15+ мест с half-pixel размерами (9.5/10.5/11.5/12.5/13.5) | Брендбук type-scale = только целые числа | Нормализовать на 9/10/11/12/13/14/16/18/24 | ⚪ |
| 76 | ~12 mono-селекторов используют `ui-monospace, SFMono-Regular, Menlo` | Брендбук primary mono = JetBrains Mono — на Windows/Linux кириллические цифры выглядят хуже | Глобальный fallback `'JetBrains Mono', 'SF Mono', ui-monospace, Menlo` | ⚪ |
| 77 | CAPS sub-header letter-spacing | Разбросан: .3px / .4px / .5px / .6px — 4 значения для одного типографического кейса | Стандартизировать: .6 для 9-10px CAPS, 1.2-1.5 для 11px+ eyebrows | ⚪ |
| 78 | Inter standalone в font-family (rail-label-backlog, v16-epic-cat) | Без `'SF Pro Display'` fallback — нарушение брендбук §4 primary | Полная цепочка `'SF Pro Display', -apple-system, ..., 'Inter', sans-serif` | ⚪ |
| 79 | mono-tabular-numerals не везде | Не применён на `.gantt-bar` числа в multi-bar legend, `.gantt-team-header-cell .team-count` | Добавить `font-variant-numeric: tabular-nums` | ⚪ |

### Уборка кода

| # | Где | Что не так | Предлагаем | Когда |
|---|---|---|---|---|
| 80 | ~80 LOC dead CSS rules | `.gantt-bar`, `.gantt-bar-r12*`, `.gantt-bar-overtime`, `.gantt-bar-backlog`, `.gantt-filters`, `.gdt-pill-comment`, `.gantt-row.team-hidden`, `.gantt-card.*`, `.gantt-no-assignee` | Удалить, обновить комментарии | ⚪ |
| 81 | 8 unused imports в `views/gantt.js:13-15` | `SCOPE_OPTIONS, RELEASE_WINDOWS, GANTT_RELEASE_WINDOWS, GANTT_TIMELINE_*, GANTT_DAY_PX, GANTT_RELEASE_BOUNDS, PHASE_SHORT` не используются | Удалить из import-блока | ⚪ |
| 82 | `wtEmoji = () => ''` в `gantt.js:697,1967` | Функция всегда возвращает пустую строку — V21 retired emoji-prefix | Удалить определение и call-site | ⚪ |
| 83 | Дубли селекторов | `.gantt-header` (2), `.gantt-team-header` (2), `.gantt-cell` (3), `.gantt-bar-multi` (2 c `!important`) | Слить дубли в одно правило | ⚪ |
| 84 | `!important` на `.gantt-cell-dragover` | Селектор уникальный — лишнее | Снять `!important` | ⚪ |
| 85 | Inline-styles в JS-template'ах | `gantt.js:1023, 1452, 528-531`, `aux.js:223-227`, `gantt.js:2555-2561` — статичные цвета вшиты в строки | Перенести статичную часть в CSS, оставить только динамические width/transform | ⚪ |
| 86 | Monkey-patch `GanttView.renderChart` для setupRoving | `_origRender` кешируется и оборачивается — хрупкий паттерн | Заменить на explicit hook callback `_postRender = setupRoving` | ⚪ |
| 87 | 5 проходов rows.forEach подряд в `renderChart` | teamCounts, colWtMix, teamWtBuckets, flowIn/Out, ganttArrows — 5 циклов | Слить в один проход | ⚪ |
| 88 | `wrap.querySelectorAll('.gantt-type-pill[draggable]')` дублируется 3 раза для DnD-bindings | Каждый рендер 3×N pills query'ев | Объединить в один pass | ⚪ |

---

## Итого по срочности

| Срочность | Кол-во |
|---|---|
| 🔴 Сейчас | 6 |
| 🟡 Скоро | 47 |
| ⚪ Потом | 35 |
| **Всего** | **88** |

(остальные ~50 находок из 137 — мелкие повторы или поглощены группировкой; полный список — в отчётах 01-06)

---

## План реализации

1. **Сегодня** — 6 красных (критичные баги и a11y-блокеры): один день, закрывает prod-bug
2. **Завтра/послезавтра** — кластер C (цвета и темы, #27-40): один день, всё ходит через готовые токены
3. **Через день** — кластер D (тексты #9-26): полдня микрокопи + naming canonization
4. **Потом** — модалки/aria, типографика, code cleanup отдельными wave'ами

**Суммарно**: 6-8 дней на full sweep всех 137 findings.

---

## Контракты (что НЕ ломать)

См. README.md → секция «Что НЕ менять (контракты)».
