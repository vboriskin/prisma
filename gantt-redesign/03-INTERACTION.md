# 03 — Interaction & A11y audit. Гант «Призма»

> **Жанр:** read-only аудит вкладки `КУРС → Гант` (вид «Детальный по задачам»).
> **Источники:** `views/gantt.js` (renderChart, _attachKeyboardDnD, ctx-menu, DnD-handlers), `index.html` (#section-gantt 978–1025, modals 258–442), `styles.css` (.gantt-type-pill, .gantt-cell, .kb-drag-active, .drop-aligned, .drop-rejected, P10.26-28, P10.25, P11.3), `app/uxKit.js` (ConfirmDialog, FocusTrap), `app.js:1258-1302` (requireMoveComment), `audit-2026-05-04/12-user-feedback.md` (Дмитрий, Игорь, Олеся), `audit-2026-05-04/dashboard-redesign/03-INTERACTION.md` (паттерны).
> **Не правил код.** Все цитаты «как есть» на 2026-05-04.
> **Контракты, которые нельзя ломать:** cross-epic guard (pills всегда привязаны к одной строке `data-row-id`), plan-lock requireMoveComment гейт, history-checkpoint перед каждым drop, постмутационный `renderChart()` с rAF-навеской `.drop-aligned`, scroll-anchor через `_withScrollAnchor`, roving-tabindex одновременно держит ровно одну focusable pill.

---

## Section 1 — Карта взаимодействий «как сейчас»

`#section-gantt` состоит из:

```
section-header (h2 + .section-header-actions: 11 кнопок toolbar)
gantt-pill-legend         (collapsible подсказки)
gantt-filters             (сейчас .display=none, заглушка)
gantt-wrap[role=application aria-label="Доска Ганта"]
  ├ team-header           (свернуть / развернуть команду)
  ├ row-header            (эпик + epic-stripe + meta + add-pill +)
  └ gantt-cell[data-col][data-row-id]   ← drop-target
       └ gantt-bar-multi
            └ gantt-type-pill[draggable=true tabindex=-1 role=button] × N
gantt-legend-extra
```

Таблица «элемент | действие | trigger | feedback | aria/state»:

| Элемент | Действие | Trigger | Feedback | aria / state |
|---|---|---|---|---|
| `#gantt-wrap` | контейнер всех взаимодействий | — | — | `role="application"` + `aria-label="Доска Ганта"` ✓ (P11.3) |
| `.gantt-type-pill` (drag) | mouse-DnD: cross-cell → новый колодец; intra-cell → reorder | `dragstart` (gantt.js:1520) | при старте: `style.opacity:.4`. На цели: `.gantt-cell-dragover` (фон + dashed outline) или `.gdt-drop-valid` / `.gdt-drop-invalid` (хатч ::after). На успехе: `.drop-aligned` 600 ms (rotate-3°→2°→0° + scale). На отказе (cross-epic / same-col): `.drop-rejected` 800 ms shake | `draggable="true" tabindex="-1" role="button" aria-label="<wt· …>" data-tip="<lines>"` |
| `.gantt-type-pill` (kb-DnD) | Enter/Space → старт; ←/→ ходят по колодцам той же строки; Enter/Space → drop; Esc → отмена | `keydown` per-pill (gantt.js:1811) | `.kb-drag-active` (3 px outline + 6 px ring), `.kb-drag-target` на ячейке-цели (dashed outline). На drop: тот же `.drop-aligned`. На отказ — toast. SR: `#gantt-kb-live` `aria-live=polite` диктует «Задача BE выбрана…», «Колодец 1.21», «перемещена в …», «отменено» | `aria-grabbed="true|false"` (deprecated в HTML5, но AT-совместимо) |
| `.gantt-type-pill` (focus) | roving-tabindex; стрелки навигируют между pills, Enter/F2 — открывает контекст-меню | `focusin` + wrap-keydown (gantt.js:145, 150) | `:focus-visible` → `outline 2px solid var(--prizma-information)` + `outline-offset 2px` (styles:2360-2365) | `tabindex` runtime: 0 у активной, -1 у остальных |
| `.gantt-type-pill` (hover) | tooltip preview (data-tip, multi-line, 200 ms delay) | `mouseover` (delegated, _bindFastTooltip) | `:hover` → `box-shadow 0 1px 4px rgba(0,0,0,.10)` | `aria-label` = первые два-три кусочка tipParts |
| `.gantt-cell` (drop) | mouse: `dragover` `preventDefault` + class; `drop` async → cross-epic guard → same-col guard → activeSection guard → requireMoveComment → moveWtBetweenCols → renderChart | `dragover/dragleave/drop` per-cell (gantt.js:1533) | `gantt-cell-dragover` (фон + dashed outline) на dragover; **drop успех — никакого моментального cell-feedback** (только новый pill в новой ячейке + `.drop-aligned` на нём) | без `role="gridcell"`; data-col + data-row-id |
| `.gantt-cell` (hover) | row-expand: hover увеличивает `max-height` до 320 px, поднимает z-index, добавляет тень | CSS `:hover` (styles:2195) | плавный grow (без transition) — может «дёрнуть» при переходе с pill на pill | без role |
| `.gdt-add-type-btn` (`+` в backlog) | открывает picker для добавления типа задачи | `click` (gantt.js:1853) | стандартный hover .btn | `title="Добавить тип задачи"`, **без `aria-label`** (title не озвучивается всегда) |
| `.gdt-team-add-epic` (`+` в team-header) | добавить эпик в команду | `click` | стандартный | `aria-label="Добавить эпик в команду {team}"` ✓ |
| `.gantt-team-header` (collapse) | свернуть/развернуть команду | `click` (gantt.js:1497) | translateY-1px? нет, контейнер просто меняет `[data-collapsed]` | **без `aria-expanded`**, **без `role="button"`**, не focusable — клавиатурой не свернуть |
| `.gdt-pill-state-*` иконка (todo/active/done) | визуальный индикатор; контекст-меню offer'ит «Завершить» | indirect (через ctx-menu pill) | — | `aria-hidden` отсутствует — иконка ●/✓ озвучивается читалкой как часть pill aria-label (двойной звук) |
| `.gdt-pill-cmt-marker` (точка комментария) | `data-tip` с текстом комментария | hover | fast-tooltip 200 ms | без `aria-label` — невидим для screen-reader |
| `.gdt-trail-cmt` / `.gdt-trail-arrow` (↗/↘) | trail-маркеры переноса в исходной/целевой ячейке | hover | fast-tooltip | `aria-hidden="true"` ✓ |
| Контекст-меню pill | rmb / Enter / F2 → меню «Завершить, Назначить, Перенести в…, Удалить, Откат» | `contextmenu` (gantt.js:2004) | список с hover'ами | свой DOM-overlay; **без `role="menu"` / `role="menuitem"`**, **без focus-trap**, ESC закрывает |
| Toolbar `.section-header-actions` (11 кнопок) | lock plan / tips / history / edit-mode / unlock / search Cmd+K / mode (overview) / density / expand-all / undo / redo / fullscreen | clicks + ⌘K | hover .btn-outline + active state | каждая кнопка имеет `aria-label` ✓ (P11.3 P11.30); **контейнер БЕЗ `role="toolbar"`** — название P11.3 «toolbar aria» относится только к sizing-классу, role не выставлен |
| `#gantt-lock-status` (lock-badge) | информер «План зафиксирован …» / «… (режим редактирования)» | render-time | text + цвет (drift / information) | без `role="status"`, без `aria-live` |
| Plan-lock comment dialog (`#modal-gantt-move`) | textarea «комментарий», OK disabled пока пусто, Esc=cancel | вызов `App.requireMoveComment` | OK активизируется по input | `role="dialog" aria-modal="true" aria-labelledby` ✓; **focus идёт на ta через setTimeout(50)**, **БЕЗ FocusTrap.attach** (хотя `app/uxKit.js` экспортирует FocusTrap — другие модалки через `bindAutoFocusTrapForOverlays` ловят это, но re-entry-guard через `dataset.busy` обходит auto-attach) |
| Cross-release move toast | «Перенос выполнен» / «Перенос отменён» / «Задача уже в этом колодце» / «Перенос между эпиками не предусмотрен» | post-drop | `showToast` 1.4-3 s | toast-queue имеет `aria-live` где-то на app-уровне |
| ⌘K Jump-palette | navigation к команде / эпику | global keydown (gantt.js:283) | overlay с поиском, ranked results | overlay есть, фокус-ловушка не явная (но guard-condition `modalOpen` исключает реентрант) |

**Главный вывод по карте.**
- Mouse-DnD + Keyboard-DnD функционально полные. Pulse + Align на drop'е есть, но **только в виде анимации на самом pill** (не на ячейке-приёмнике в момент drag) — это разные жесты и Дмитрий жалуется именно на момент drag→drop.
- Wave 4 motion (`.gex-grid-cell.cell-receive`, `.kanban-col-body.prizma-drop-target`) **не дотянулась до Ганта**. Pulse-glow в P10.26-28 объявлен только для ExecutionGrid и Kanban (styles:17409-17411). Для Ганта используется старый класс `.gantt-cell-dragover` (background-flat) и Ховер-pulse в `.gantt-cell-receiving` срабатывает только в редком пути «через ctx-menu → перенести в…», не в DnD.
- Плотные слои signal'ов на pill (state-glyph, cmt-marker, progress-underline, prog-state класс, initials, name-truncate-18) — **screen-reader получает усечённый `aria-label` только из tipParts**, а маркеры комментариев не озвучиваются.

---

## Section 2 — Проблемы взаимодействий (6)

### 1. [interaction] Drag-drop на mouse — silent в момент Pulse, Align только постфактум

**Где:** `gantt.js:1533-1535` per-cell `dragover`/`drop`; `styles:5707` `.gantt-cell-dragover`.
**Что не так:** Wave 4 P10.26-28 декларирует Pulse-glow для drop-target'ов через `.gex-grid-cell.cell-receive::after { animation: prizma-drag-pulse … infinite }`. Но эта стилевая привязка указывает только на `.gex-grid-cell.cell-receive` (ExecutionGrid) и `.kanban-col-body.prizma-drop-target`. **Для `.gantt-cell` Pulse-glow не объявлен**, JS не навешивает класс `.gantt-cell-receiving` (`-receiving` есть, но используется только в ctx-menu-flight'е, не в DnD). На dragover у Ганта — плоский фон + dashed outline. Игорь и Дмитрий «перетащил, и…?» — они правы, brand'ом пообещано pulse, реально не доехало.
**Кто страдает:** Дмитрий (BE-lead, 30+ перетаскиваний/день — «pулsing мог бы быть и в Ганте»), Игорь (50–80 drag/day, motion-fatigue в обратную сторону).

### 2. [interaction] Tooltip preview при mouse-drag — отсутствует

**Где:** dragstart (gantt.js:1520) выставляет `style.opacity=.4` и заполняет dataTransfer. Никакого «куда летим» preview не показано — даже native cursor-image отключён `e.dataTransfer.setDragImage` не вызывается.
**Что не так:** во время drag нет ни drag-image (визуально летит сам pill через нативный браузер-механизм + `opacity .4`), ни floating-tooltip с ETA «{wt} → 1.21 (вторник 12.05)». Когда колодцы 1.20/1.21/1.22/OT визуально похожи, и пользователь промахивается на 1 cell влево — он узнаёт об этом только по toast'у пост-фактум. Это противоположность best-practice (Linear показывает destination-цвет под курсором).
**Кто страдает:** Олеся (новичок — не понимает разницу между r120/r121), Анна на iPad'е (если бы она открыла гант).

### 3. [a11y] Контекст-меню pill — без `role="menu"`, без focus-trap

**Где:** `gantt.js:2004-2456` — `wrap.addEventListener('contextmenu', …)` собирает свой `<div id="gdt-ctx-menu">` со списком пунктов. Нет `role="menu"` на контейнере, нет `role="menuitem"` на пунктах, нет `aria-activedescendant`, нет внутренней стрелочной навигации (только ESC). Открывается через keyboard (Enter/F2 dispatchEvent) — но первый пункт получает фокус естественно? Нет, фокус остаётся на pill, читалка молчит.
**Кто страдает:** Игорь (keyboard-only flow «Tab. Tab. Где я?»); screen-reader-юзеры; WCAG 4.1.2 (Name, Role, Value).

### 4. [a11y] team-header (collapse) — без `aria-expanded`, не focusable

**Где:** `views/gantt.js:1497` `rowEl.addEventListener('click', …)`.
**Что не так:** свернуть команду можно только мышкой. Нет `tabindex="0"`, нет `role="button"`, нет `aria-expanded`. Клавиатурный пользователь не может свернуть команду из 30 эпиков, чтобы быстрее долистать до своей. Аналогичная проблема с `gdt-pill-legend` и `pill-legend toggle` (только click).
**Кто страдает:** Игорь (planet 200+ строк, сворачивает чужие команды чтобы добраться до своей).

### 5. [a11y] Lock-badge / edit-mode — без `aria-live` и без `role="status"`

**Где:** `#gantt-lock-status` (index.html:989) — обычный span, обновляется в `App.bindGanttPlanLock`.
**Что не так:** когда план зафиксирован/расфиксирован, появляется/меняется бейдж «План зафиксирован 12.05.2026» / «… (Режим редактирования)». Screen-reader не услышит это изменение состояния. Игорь, нажав «Зафиксировать план» → диалог OK → бейдж появился — но он не знает, что это был success. Аналогично — изменение режима редактирования.
**Кто страдает:** screen-reader-юзеры; формально WCAG 4.1.3 Status Messages.

### 6. [interaction + a11y] Plan-lock comment dialog — без FocusTrap, без announce, OK disabled но без явной подсказки

**Где:** `app.js:1258-1302` `requireMoveComment` использует ручной promise + manual cleanup без FocusTrap.attach и без объявления зачем нужен комментарий. textarea получает фокус через `setTimeout(50)`, но Tab выводит из модалки на soft-Closed-overlay → focus уходит «в воздух». Дополнительно: OK-кнопка `disabled` пока textarea пуст, но никакой подсказки «введите ≥3 символа» нет; пользователь жмёт OK и не понимает, почему ничего не происходит.
**Кто страдает:** Игорь (keyboard-flow); все screen-reader-юзеры; контрибьюторы UX-консистенции — диалог делает то, что в `app/uxKit.js:121` уже реализовано (FocusTrap.attach с returnFocus).

---

## Section 3 — Что должно появиться (новые взаимодействия)

### 3.1. Pulse-glow на drop-target cells при mouse-drag (must)

**Где:** при `dragstart` навешивать `.gantt-cell-receiving` на все ячейки той же строки кроме `srcCol`. Сейчас только `.gdt-drop-valid` (плоский outline). Хочется: тот же brand'овый Pulse-glow что в Wave 4 ExecutionGrid + Kanban — `prizma-drag-pulse 1600 ms infinite` в `.gantt-cell.gdt-drop-valid::after`.
**Эффект:** Дмитрий «увидел сам момент возможности». Pulse гасится через `dragend` (это уже работает на сброс класса).
**Альтернатива (мягче):** Pulse только на `.gantt-cell-dragover` (под курсором) — но это лишает преимущества «pre-highlight всех валидных целей».

### 3.2. Tooltip preview во время drag (should)

**Где:** при `dragstart` создать floating `.gdt-drag-preview` с текстом «<wt> → 1.21» (целевой колодец под курсором обновляется на dragover). Скрыть на dragend. Это **не** SR-фича, чисто визуальная.
**Параметры:** body-attached, `position: fixed`, `pointer-events: none`, follow `e.clientX/Y + 12 px`. Без motion (анимация мешает скорости).

### 3.3. Drop-Pulse на ячейке-приёмнике (must)

**Где:** успешный drop → перед `renderChart()` запомнить `dstCol` + `rowId`, после rAF навесить `.gantt-cell-receiving` на новую ячейку (на 900 ms — keyframe `gdt-cell-receive` уже есть в styles:2261). Сейчас Align только на pill (rotate+scale), но **сама ячейка не моргает** — пользователь не понимает «куда оно прилетело». Особенно если scrollY изменился в результате layout.

### 3.4. Hover/focus/active унификация с дашбордом

**Pill:**
- `:focus-visible` → перевести с текущего `outline 2px var(--prizma-information) offset 2px` на **`outline 2px var(--prizma-information) offset 3px`** (паттерн дашборда) — лучше отделяется от соседних pill'ов в плотной cell.
- `:hover` — оставить `box-shadow 0 1px 4px rgba(0,0,0,.10)`, добавить мягкое усиление stripe-left (если pill — typed): `border-left-width 3px → 4px` через transition 140 ms.
- `:active` (mousedown) — `transform: translateY(0); box-shadow: var(--shadow-sm)`. Сейчас отсутствует — клик ощущается «без удара».

**Cell:**
- `:hover` сейчас grow до 320 px без transition — добавить `transition: max-height 140ms ease-out`. Слишком резкий grow «дёргает» layout у Дмитрия.

**Toolbar-кнопки (P11.3):**
- Уже выровнены по 32×32, hover .btn-outline корректный. Унифицировать `:focus-visible` с дашбордом: `outline 2px var(--prizma-information) offset 3px`.

### 3.5. Bulk multi-select pills (could)

**Где:** Shift+click / Cmd+click на pill → добавляет в selection (визуально — синий outline + checkmark в углу). Drag любого выбранного → переносит всю группу. Полезно для Игоря («50–80 drag/day»: «применил bulk-перенос BE+FE+QA одной задачи в 1.21»).
**Контракт:** все selected pills должны быть в одной строке (cross-epic уже исключён инвариантом). При cross-row Shift+click — toast «Bulk-перенос работает только внутри одного эпика».
**Альтернатива:** оставить bulk на Реестр (там уже есть) и не делать в Ганте — спорно, см. §7.

### 3.6. Action на свежие риски / блокеры — Pulse pill (could)

**Где:** при появлении нового risk-flag / blockingDependency на pill — после render() однократно навесить `.pill-pulse-fresh` (Pulse-ring 1600 ms 3-повтора, по brand'у §9.3). НЕ infinite — иначе Игорь сойдёт с ума через 30 минут.

---

## Section 4 — ARIA / a11y

### 4.1. Landmarks / regions

- `<section id="section-gantt">` — добавить `role="region" aria-labelledby="section-gantt-title"` (h2 нужен `id`).
- `#gantt-wrap` — `role="application" aria-label="Доска Ганта"` ✓ (P11.3, gantt.js:140-148).
- `.section-header-actions` под `#section-gantt` — добавить `role="toolbar" aria-label="Действия Ганта"` + опциональная стрелочная навигация между кнопками. Сейчас P11.3 — только sizing-CSS, роль не выставлена.
- `gantt-pill-legend` — `role="region" aria-label="Подсказки по визуализации"` (если развёрнут).

### 4.2. Status / live regions

- `#gantt-lock-status` — `role="status" aria-live="polite"` ✓ (после изменения текст диктуется).
- `#gantt-kb-live` — уже есть (`aria-live="polite" aria-atomic="true"` ✓ gantt.js:1639). Ок.
- Toast'ы на drop (`Перенос выполнен` / `Перенос отменён` / `Задача уже в этом колодце`) — должны идти через тот же live-region что kb-DnD, чтобы mouse-юзер тоже получал озвучку. Сейчас `showToast` имеет свой механизм, проверить дублирование.
- Number badges (счётчик задач в team-header / в колодце) — добавить `aria-live="polite"` на agg-count: после bulk-операции команда «1.20: 47 → 51 задач» должна быть зачитана.

### 4.3. Pills

```html
<span class="gantt-type-pill" draggable="true" tabindex="-1" role="button"
  aria-label="BE · 1.20 · ●в работе · комментарий есть"
  data-tip="…multi-line…">
```

**Замечания:**
- `role="button"` ✓.
- `aria-label` сейчас собирается из `tipParts.join(' · ')` — могут быть очень длинные. Усечь до 3 первых элементов («wt · cell · state»), остальное — оставить в `data-tip` для зрячих.
- `aria-grabbed="true|false"` — deprecated в HTML5, но kept для legacy SR (NVDA + IE/Firefox-ESR). Это **корректное** решение для legacy-поддержки. Современный путь — добавить `aria-pressed="true"` параллельно (двойной сигнал, новый AT поймёт хоть один).
- `aria-keyshortcuts="Enter Space"` — добавить на pill, чтобы AT диктовал «Доступны: Enter, Space» при первом фокусе.

### 4.4. Plan-lock comment dialog

**Сейчас:** ручной promise в `app.js:1258-1302`, `setTimeout(50) ta.focus()`, без FocusTrap.
**Что должно быть:**
1. **`FocusTrap.attach(overlay, { initialFocus: ta, returnFocus: <pill-or-toolbar-btn> })`** — `app/uxKit.js:121` уже умеет это, нужно просто использовать.
2. **`aria-describedby`** на `<dialog>` указывает на `<p id="…-explainer">Перенос требует комментарий, поскольку план зафиксирован.</p>` (сейчас — `.modal-text-muted` без id).
3. **Submit-disabled hint** — рядом с OK-кнопкой `<span class="modal-form-hint" id="…-hint">Введите хотя бы 3 символа</span>`, OK получает `aria-describedby="…-hint"`.
4. **Autofocus на ta** через `autofocus` attribute или `requestAnimationFrame` — без `setTimeout(50)`, который race'ит с FocusTrap.

### 4.5. Контекст-меню pill

```html
<div id="gdt-ctx-menu" role="menu" aria-label="Действия задачи {wt}">
  <button role="menuitem">Завершить</button>
  …
</div>
```

- `role="menu"` + `role="menuitem"` на пунктах.
- ↑/↓ — навигация между пунктами; Enter — выбор; Esc — закрытие; Tab — закрытие + переход дальше.
- Открытие — фокус на первый пункт (а не на pill), закрытие — `returnFocus` на pill.
- `aria-haspopup="menu"` на pill (поскольку pill открывает меню).

### 4.6. team-header collapse

```html
<div class="gantt-team-header" data-team-key="…">
  <button type="button" class="gantt-team-toggle"
          aria-expanded="true" aria-controls="…rows…">
    {team-name}
  </button>
  …
</div>
```

- Toggle стал нативной `<button>` — focusable, Space/Enter работает бесплатно.
- `aria-expanded` синхронизирован с `[data-collapsed]`.
- `aria-controls` указывает на DOM-id rows под этим header'ом.

---

## Section 5 — Motion (что добавить)

Brandbook §9: **Emerge / Breathe / Pulse / Align**.

### 5.1. Что есть сейчас

- **Align** на pill после drop ✓ (`.drop-aligned 600 ms` cubic-bezier overshoot).
- **Reject-shake** на pill при cross-epic / same-col ✓ (`.drop-rejected 800 ms`).
- **Pulse** на kb-DnD active pill ✓ (`.kb-drag-active` — outline + ring, статичный).
- **Cell-receive glow** ✓ декларирован в styles:2247-2270, но **не подключён в DnD-handler** (только в ctx-menu-flight).

### 5.2. Что должно появиться

#### Emerge — pills появляются волной по релизам при первом рендере / при смене filter

**Когда:** `renderChart()` после `getRows()` — первый раз ИЛИ когда количество rows резко изменилось (>30% дельта).
**Как:** на каждом `.gantt-type-pill` — `animation: pill-emerge 1100ms cubic-bezier(0.16, 1, 0.3, 1)` со stagger `0.5ms × index-в-cell` (каждая cell начинает свою волну). `opacity 0 → 1`, `transform translateY(4px) → 0`. Не scale (порушит cell layout).
**Альтернатива:** stagger по релизам (backlog → 1.20 → 1.21 → 1.22 → OT) — даёт визуальный «time gradient» как заявлено в C2-сортировке.

#### Align на счётчиках в колодцах при изменении

**Когда:** после bulk-операции / drop / Jira-sync счётчик задач в team-header или mini-bar в overview-mode меняется.
**Как:** `text-flash 200ms` (color → information → color) + tabular-num не сдвигается (font-feature-settings уже включены).

#### Pulse на свежие риски / блокеры

**Когда:** появилась новая risk-flag / blockingDependency после Jira-sync.
**Как:** на `.gdt-pill-state-active.has-risk` — single-shot Pulse-ring 3 раза × 1600 ms. Не infinite. После 3-х повторов класс снимается через timeout.

#### Drop-Pulse на cell — переход состояния (must)

См. §3.3. Использовать существующий `gdt-cell-receive 0.9s` keyframe — просто подключить class в DnD-handler.

### 5.3. prefers-reduced-motion

Сейчас (styles:17451 + 17579):
- `.drop-aligned`, `.drop-rejected` — `animation: none` ✓.
- `.kb-drag-active box-shadow: none` ✓.

Расширить:
```css
@media (prefers-reduced-motion: reduce) {
  .gantt-type-pill.is-emerging,
  .gantt-cell-receiving::after,
  .gantt-type-pill.pill-pulse-fresh { animation: none; }
  .gantt-cell { transition: none; }
}
```

---

## Section 6 — Concrete proposal (15 пунктов)

| # | Что | Где | Приоритет | Эффорт |
|:--:|---|---|:--:|:--:|
| 1 | **Pulse-glow на drop-target cells** при `dragstart` (использовать уже существующий `gdt-cell-receive-glow` keyframe, навесить через `.gantt-cell.kb-drag-target` + новый `.gantt-cell.dnd-receive`) | gantt.js:2480, styles:2247 | must | S |
| 2 | **Cell-Pulse на приёмнике после успешного drop** (rAF после renderChart, 900 ms) | gantt.js:1612, 1768 | must | S |
| 3 | **`role="toolbar" aria-label="Действия Ганта"` + стрелочная навигация** на `.section-header-actions` | index.html:981 | must | S |
| 4 | **Plan-lock comment dialog → FocusTrap.attach + aria-describedby + hint про disabled OK** | app.js:1258 | must | S |
| 5 | **team-header collapse → нативная `<button>` + `aria-expanded` + `aria-controls`** | gantt.js:1497 | must | S |
| 6 | **`#gantt-lock-status` → `role="status" aria-live="polite"`** | index.html:989 | must | S |
| 7 | **`role="region" aria-labelledby` на `#section-gantt` + h2 id** | index.html:978 | must | S |
| 8 | **Контекст-меню pill → `role="menu"` + `role="menuitem"` + ↑/↓/Esc + initial-focus + return-focus** | gantt.js:2004-2456 | should | M |
| 9 | **Tooltip preview во время mouse-drag** (`.gdt-drag-preview` follows cursor с целевым колодцем) | gantt.js:1520, 2500 | should | M |
| 10 | **focus-visible на pill — offset 3 px** (унификация с дашбордом) | styles:2360 | should | S |
| 11 | **Cell-hover `transition: max-height 140ms ease-out`** (убрать «дёрганье» при hover) | styles:2195 | should | S |
| 12 | **Emerge-волна pills при первом рендере / filter-change** (1100 ms cubic-bezier, stagger 0.5 ms × index) | gantt.js:1170, styles | should | M |
| 13 | **Pulse-ring 3 повтора на свежих рисках/блокерах** после Jira-sync | gantt.js render, styles | could | M |
| 14 | **Bulk multi-select pills** (Shift+click добавляет в selection, drag переносит группу) — только same-row | gantt.js:1519 | could | L |
| 15 | **`aria-keyshortcuts="Enter Space"` + `aria-haspopup="menu"`** на pill | gantt.js:1159 | could | S |

> Эффорт: S = ≤ 1 день, M = 2–5 дней, L = неделя+. Позиции 1-7 без архитектурных рисков и закрывают Игоря/Дмитрия/screen-reader цикл за 5 дней.

---

## Section 7 — Спорные моменты

### 7.1. Bulk multi-select pills в Ганте — vs. перевод бойни в Реестр

Игорь явно просит bulk в Ганте: «50–80 drag/day, многие — синхронные BE+FE+QA пары». **Контра-аргумент:** Реестр уже умеет bulk-edit (column-by-column), и Гант — это **визуальный** инструмент. Если добавить bulk-в-Гант, мы дублируем функцию — ещё один путь. Дмитрий, наоборот, ругает «6 разных табов для одних и тех же задач» — добавить bulk в Гант противоречит принципу «один инструмент на задачу».
**Моя позиция:** оставить bulk в Реестре, но в Ганте дать **multi-row apply-template** через ctx-menu (выбрать pill → меню «Применить эту перестановку к…» → list строк) — это не drag, это action.

### 7.2. Pulse infinite vs. one-shot

Wave 4 P10.26-28 подключил `prizma-drag-pulse 1600ms infinite` к Kanban / ExecutionGrid drop-target'ам. Если расширить на Гант, Игорь смотрит на это 8 часов в день. **Контра:** infinite только во время drag (т.е. макс. 1-2 секунды на каждый перенос). После dragend класс снимается. Это безопасно. Но если pre-highlight (§3.1) держится в момент когда курсор далеко от drop-cell, infinite-pulse становится «надоедливым визуальным шумом».
**Решение:** infinite **только под курсором** (`gantt-cell-dragover`); на `gdt-drop-valid` — один цикл pulse при появлении класса (announce-once), потом только flat-outline.

### 7.3. role="application" — правильно ли это?

ARIA-spec говорит, что `role="application"` отключает стандартное браузерное чтение виджета и переводит SR в «raw mode» (читалка не озвучивает структуру, ждёт от веб-приложения собственных hints). Для Ганта это **корректно** (custom DnD, кастомные клавиатурные жесты), но требует чтобы все sub-elements имели **полные** ARIA-атрибуты. Если хоть одна pill без `aria-label`, screen-reader зачитает «button» без названия. Сейчас этот контракт **частично нарушен** (см. §1: cmt-marker, state-glyph, fallback-pill «задача» без явного label).
**Решение:** либо подтянуть все ARIA до полноты (см. proposal #15), либо снизить с `application` на `region` + конкретные `role="grid" / "row" / "gridcell"` на cell-структуре. Второй путь — больше работы, но соответствует семантике (Гант **это** grid). Решение откладываю до Wave 6.

### 7.4. Tooltip preview vs. native drag-image

Native HTML5 DnD умеет `e.dataTransfer.setDragImage(canvas, x, y)` — браузер сам рисует image у курсора. Это бесплатно и ОС-нативно. Но: image статичный (текст «BE → 1.21» не меняется при наведении на разные cells). Custom floating div (proposal #9) обновляется на dragover, но требует JS-логики. **Предлагаю:** custom-tooltip — Игорь и Дмитрий получат «куда лечу» в реальном времени; native dragImage оставить только для accessibility-fallback (в Firefox + screen-reader).

### 7.5. Олеся «не понимает релизы 1.20»

Это **не** interaction-проблема, это **content-проблема**. На pill написано «BE» / «1.21», а что значит «1.21» — Олеся не знает. **Решение** не в interaction-слое: в Hover-tooltip pill добавить «1.21 — релиз июнь 2026» (lookup из release-meta). Альтернатива — onboarding-tour: при первом открытии Ганта pulsate на названии колонки + tooltip-подсказка «Это релиз — окно планирования. См. словарь». Это закрывает Олесю, но рассыпается за пределы interaction-аудита (тут только §3.1.1).

---

