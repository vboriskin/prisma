# П8 — Технические неровности в действиях / кнопках / модалках

> Аудит: топбар (`index.html:416-545`), модалки (`index.html:191-410`),
> drag-and-drop (registry/gantt/kanban/appSettings), toast-система (`app.js:131-153`),
> ConfirmDialog (`app/uxKit.js`).
>
> Эксперт-роли: senior frontend, design-system architect, code-health auditor.

---

## 1. Топбар-кнопки — единообразие

### 1.1 Класс-структура

Все 6 топбар-кнопок используют **одни и те же классы**: `btn btn-ghost btn-sm topbar-icon-btn`.
Это хорошо. Но дальше начинаются расхождения:

| ID | Иконка | `aria-label` | `title` | `data-tb` | Disabled-state |
|---|---|---|---|---|---|
| `btn-toggle-filters` (461) | text-chevron `▾` | «Активных фильтров» (на counter, не на самой кнопке) | «Показать / скрыть панель фильтров» | (не задан) | (нет) |
| `btn-save` (462) | SVG floppy | «Сохранить всё» | «Пересчитать и сохранить всё (Ctrl/Cmd+S)» | `save` | `btn-save-dirty-dot` (отдельный indicator) |
| `btn-files-dropdown` (471) | SVG file | «Файлы — импорт, экспорт, очистка» | «Файлы — импорт / экспорт / очистка» | `files` | (нет) |
| `btn-sim-mode` (528) | SVG (?) | «Режим симуляции» | «Режим симуляции — изменения не сохраняются» | `sim` | `aria-pressed="false"` |
| `btn-theme-toggle` (531) | SVG moon | «Переключить тему» | «Переключить тему» | `theme` | (нет) |
| `btn-app-settings` (534) | SVG | «Настройки приложения» | «Настройки» | `settings` | (нет) |
| `btn-onboarding` (537) | SVG | «Обучение и тур по приложению» | «Обучение / Тур по приложению» | `onboarding` | (нет) |

**Несконсистентности:**

| # | Что | Цитата |
|---|---|---|
| 1 | `btn-toggle-filters` единственный имеет иконку **через текст** (`<span class="filters-chevron">▾</span>`) — все остальные SVG. | `index.html:461` |
| 2 | `aria-label` дублирует `title` 6/7 раз, но **формулировки разные**: «Сохранить всё» vs «Пересчитать и сохранить всё (Ctrl/Cmd+S)». Screen-reader не услышит keyboard-shortcut. | `index.html:462` |
| 3 | `aria-pressed` есть только на `btn-sim-mode`, хотя `btn-theme-toggle` тоже toggle (light/dark) — там его нет. Несконсистентный pattern. | `index.html:528 vs 531` |
| 4 | `data-tb=...` есть на всех кроме `btn-toggle-filters` — дискриминируется в каком-то цикле выше? | `index.html:461` |
| 5 | `btn-save` имеет dirty-dot `<span id="btn-save-dirty-dot" class="btn-save-dirty-dot hidden">` внутри — индикатор unsaved-state. У `btn-sim-mode` (тоже state-aware) такого нет, только `aria-pressed`. Два разных способа показать «состояние». | `index.html:466` |

> _Senior frontend:_ типичный «органический» topbar. Семь почти-одинаковых
> кнопок без shared-builder функции. Если бы всё это рендерилось через
> JS-helper `topbarBtn({id, icon, label, onAction, isToggle?, isDirty?})`,
> неконсистентность аура-pressed/dirty-dot/data-tb отпала бы сама.

### 1.2 Hit-target

Все `topbar-icon-btn` маленькие (предположительно 32×32 или меньше — проверить в CSS).
SVG иконки 14-16px. Brandbook рекомендует ≥40×40 для тач. На десктопе пройдёт,
но если кто-то откроет на iPad — узкие кнопки.

### 1.3 Focus-state

Только `topbar-brand` (link-as-button) имеет explicit `tabindex="0"` (`index.html:423`).
Кнопки `<button>` получают focus автоматически — норм. Но **порядок tab-навигации**
не задан и идёт по DOM-order. Если добавить кнопку посередине — Tab-order
прыгает. Не блокер, но и не контролируется.

### 1.4 Handlers — централизация

В `app.js` биндинг разбросан:

| Кнопка | Где биндится |
|---|---|
| `btn-save` | `app.js:837` |
| `btn-onboarding` | `app.js:586` |
| `btn-files-dropdown` | `app.js:1759` |
| `btn-sim-mode` | `app.js:1811` |

4 разных места в одном файле без общего реестра. Когда добавишь 8-ю топбар-кнопку,
её handler ляжет в седьмое.

---

## 2. Модалки

### 2.1 Перепись (по `modal-overlay`)

```bash
grep -c 'modal-overlay' index.html → 10
```

Все 10 модалок используют:
- `<div id="modal-..." class="modal-overlay hidden">`
- `<div class="modal-box">` (или `modal-box-wide`)
- `<div class="modal-header">` + `<button class="modal-close-btn">`✕`</button>`
- `<div class="modal-footer">` с `btn btn-outline btn-sm` + `btn btn-primary btn-sm`

Это хорошо. Но:

### 2.2 Несконсистентности

| # | Что | Цитата |
|---|---|---|
| 1 | `modal-restore` использует **другой класс** `welcome-overlay welcome-overlay-modal hidden` + inline `style="position:fixed;inset:0;z-index:10500;..."`. Целое окно сделано **отдельной системой** от других модалок. | `index.html:191` |
| 2 | Модал в `index.html` имеет ровно **1 раз** `role="dialog" aria-modal="true"` — на `gdt-jump-palette` (`index.html:347`). Остальные 9 модалок без этих атрибутов. Screen-reader не объявляет их как dialog. | `index.html:347` vs `235, 252, 273, 300, 319, 365, 393` |
| 3 | Inline-style в каждой модалке: `<div ... class="modal-text-muted" style="margin-bottom:10px;font-size:12.5px;color:var(--text-3)">` — **повторяется 6 раз** буквально. | `index.html:259, 280, 307, 309, 326, 372, 400` |
| 4 | Inline `style="display:block;font-size:11.5px;font-weight:600;color:var(--text-3);margin-bottom:4px;"` на `<label>` — **повторяется 6 раз**. Должно быть `<label class="modal-form-label">`. | `index.html:260, 283, 287, 377, 381, 401` |
| 5 | Закрытие реализовано **двумя способами**: classList toggle (`closeModal(el)` в `app.js:170-174` использует `modal-closing` + setTimeout 140ms) И через `overlay.remove()` (в `gantt/aux.js:82, 167` — модалки добавляются `insertAdjacentHTML` и **удаляются** из DOM полностью). | `app.js:170-174` vs `views/gantt/aux.js:82-84` |
| 6 | Inline-CSS-`style="padding:0 20px 16px 20px;display:flex;gap:8px;justify-content:flex-end;"` для footer — есть `class="modal-footer"`, но используется только в одной из 10 модалок (`modal-kpi-footer`, `index.html:245`). Остальные **inline** flex! | `index.html:404, 388, 312, 293, 266, 245, 405-406` |
| 7 | Inline `style="max-width:440px;"` на `modal-gantt-lock` `modal-box` — magic ширина. Не через модификатор класса `.modal-box-narrow`. | `index.html:366` |

### 2.3 ESC и backdrop-click

| Модалка | Backdrop-click | ESC-key |
|---|---|---|
| `modal-kpi` | `app.js:619` ✓ | (через `modal-kpi-close` button) |
| `modal-gantt-complete/dates/assign/...` | (не нашёл общего обработчика) — каждая своя | ?? |
| `modal-restore` | (нет) | (нет) |
| Динамические `modal-gantt-history`, `modal-gantt-add-epic` | `aux.js:83, 168` ✓ | `aux.js:84, 171` ✓ (named-handler removed-on-close) |
| `gdt-jump-palette` | (через own controller) | own |

`closeModal` в `app.js:170` **не подключает global-ESC**. Каждый модал биндит свой Esc сам или забывает.

> _Senior frontend:_ Близко к unbearable. На 10 модалок — 4 разных пути закрытия:
> backdrop+button (kpi), button-only (gantt static), DOM-remove + Esc (gantt-aux dynamic),
> own controller (jump-palette). Должна быть единая ModalController:
> `Modal.open({id, body, onClose}) → resolve(result)`. ConfirmDialog в
> `app/uxKit.js:36` уже близок — расширить его scope на все модалки.

### 2.4 Animation

`closeModal` использует `modal-closing` → setTimeout(140ms) → `hidden`. Это работает, но:
- Показ — без анимации (просто `classList.remove('hidden')`).
- `funny-loader` имеет своё `funny-loader-phrase-in` через `void offsetWidth` (`app.js:238`).
- ConfirmDialog в `app/uxKit.js` — своя анимация.

Три разных способа animate показа.

---

## 3. Drag-and-drop — три реализации

| Где | Тип DnD | Реализация |
|---|---|---|
| **Реестр** — заголовки колонок | reorder columns | Native HTML5 DnD. `dragstart/dragover/dragleave/drop` с `_dragColKey` глобальной переменной. Splice массива `state.colOrder`. |
| **Реестр** — col-resize | resize column | Mouse-based: `mousedown` на handle → cached colTds → `mousemove` → `mouseup`. **Не использует HTML5 drag**. |
| **Канбан** — карточки между колонок | move card между release-окнами | Native HTML5 DnD. `_drag={rowId, sourceCol}` static-state. Удаляет/добавляет в `release[120/121/122]Types` массивы. |
| **Гант** — пилюли между колонками | move pill между bucket'ами | Native HTML5 DnD. Свой closure-state, animation на drop. |
| **Гант** — задачи внутри cell'а | reorder pills inside cell | Не нашёл — возможно не поддерживается, только cross-cell. |
| **Настройки приложения** — sortable nav | reorder nav items | Native HTML5 DnD. `appSettings.js:511, 563`. Свой подход. |
| **Bulk panel** — нет DnD | — | (только flat list) |

| # | Несконсистентность | Цитата |
|---|---|---|
| 1 | Глобальные state'ы для drag: `_dragColKey` (registry.js:18), `KanbanView._drag` (kanban.js:15), `_dt*` в gantt — **четыре разных способа** хранить «что сейчас тащим». | `registry.js:18`, `kanban.js:15` |
| 2 | Drop-target подсветки: registry — `th.classList.add('drag-over')`, kanban — `colEl.classList.add('drag-target')` + `body.classList.add('drag-over')`. **Разные имена классов** для одного и того же. | `registry.js:171`, `kanban.js:37-38` |
| 3 | `dragend` cleanup в registry правильно сбрасывает `dragging` класс на th, но в kanban `_drag` не сбрасывается. | `registry.js:170` vs `kanban.js:106` |
| 4 | Resize-колонок (registry) использует mouse-events — есть проект гайд «всё DnD через HTML5 API». Но resize не drag в строгом смысле — норм. Просто паттерн исключения не задокументирован. | `registry.js:186-218` |

> _Senior frontend:_ shared `DragController` с API `start(id, payload)`,
> `over(targetId)`, `drop()`, `cancel()` решит 80% проблем. Сейчас три view
> переизобрели «что я тащу» state.

---

## 4. Toasts / уведомления

`showToast` определён в `app.js:137` и делегирует в `ToastQueue.show(opts)`. Используется в 30+ местах. Хорошо.

| # | Несконсистентность | Цитата |
|---|---|---|
| 1 | Параллельно есть **`alert(...)`** в `views/employees.js:732, 758, 769, 775` и `views/aiView.js:201`. Native dialog. Не unified. | `employees.js:732` |
| 2 | `console.warn(...)` в catch-блоках LLM-вызовов параллельно с `showToast(..., 'error')` — иногда оба, иногда один. | `aiView.js:136` vs `aiView.js:323` |
| 3 | Время показа варьируется: 1500/1800/2200/2400/2600/3000/3500/4200ms — без констант, на глаз. | `kanban.js:45-54`, `app.js:284, 1290, etc.` |
| 4 | Тип toast: `'error', 'warning', 'info', 'success'` — но в коде: `showToast(msg)` (default success), `showToast(msg, 'error')` (positional), `showToast({msg, type})` (object) — **три разных вызова-сигнатуры**. | `app.js:138-140` |
| 5 | Toast при error дублируется в `ErrorsLog` (`app.js:142-150`). Но `console.warn` в catch — не дублируется. Двойная политика логирования. | `app.js:142-150` |

### 4.1 Confirm

| Контекст | Реализация |
|---|---|
| Удалить сотрудника | `ConfirmDialog.show({...})` async (`employees.js:458`) |
| Удалить журнал history | `ConfirmDialog.show({...})` (`history.js:206`) |
| Удалить errors-log | `ConfirmDialog.show({...})` (`errorsView.js:157`) |
| `app.js:817` — fallback | `showToast(..., 'info')` без real confirm — «Подтверждение не совпало» (значит был text-input confirm) |
| `views/aiView.js:201` | `alert(lines)` (раздельный смысл — не подтверждение, а info) |

3 разных способа подтвердить деструктивное действие. ConfirmDialog уже есть и его расширение должно быть мандатным.

---

## 5. Bulk-edit panel

`app.js:296-298` — extracted into `app/bulkEditPanel.js`. Кнопки в `index.html:889-912`:

```html
<button id="bulk-btn-release" class="btn btn-sm btn-primary">Назначить</button>
<button id="bulk-btn-scope"   class="btn btn-sm btn-outline">Scope</button>
<button id="bulk-btn-priority" class="btn btn-sm btn-outline">Приоритет</button>
<button id="bulk-btn-assignee" class="btn btn-sm btn-outline">Назначить исп.</button>
<button id="bulk-btn-done"     class="btn btn-sm btn-outline">✓ Сделано</button>
<button id="bulk-btn-clear-release" class="btn btn-sm btn-outline">Убрать из релиза</button>
<button id="bulk-btn-clear-blocker" class="btn btn-sm btn-outline">Снять блокер</button>
<button id="bulk-btn-deselect" class="btn btn-sm btn-ghost bulk-deselect">✕</button>
```

| # | Что | Цитата |
|---|---|---|
| 1 | «✓ Сделано» — единственная кнопка с **символом** (✓) внутри текста. Остальные — чистый текст. Нет иконки-системы для bulk-actions. | `index.html:908` |
| 2 | «Назначить» (release) — `btn-primary`, остальные `btn-outline`. Дизайн-семантика «primary = главное действие» здесь не очевидна. | `index.html:889` |
| 3 | `bulk-btn-deselect` — единственная с `aria-label`-аналогом через `title`. Остальные — без. | `index.html:912` |
| 4 | `bulk-btn-priority`/`scope`/`assignee` — text-only кнопки, открывают popup'ы. Indicator «открыт popup» не задан (no `aria-haspopup`, `aria-expanded`). | `index.html:896, 903, 906` |

---

## 6. Прочие inline-кнопки (action-buttons)

В views встречаются:

| Класс | Где | Стиль |
|---|---|---|
| `.row-act-btn` (registry copy/del) | `registry.js:296-299` | inline SVG, `title` |
| `.col-pin-btn` | `registry.js:122` | inline SVG, `title` + `aria-label` |
| `.employee-act-btn` | `employees.js:441, 451` | text/svg mixed (✕, ▼) |
| `.ob-cta-btn` | `index.html:183` | onboarding-only |
| `.modal-close-btn` | `index.html:239+` | unified ✕ |
| `.errlog-tab` | `errorsView.js:97` | tab-button (нет `role="tab"`) |
| `.hist-stat-card` | `history.js:87` | button-as-card (нет `aria-pressed`) |

**Семь разных action-button кастом-классов**. Дизайн-системой это не называется.

---

## 7. Disabled-state

| Место | Disabled-state |
|---|---|
| `modal-gantt-add-target-ok` | `disabled` атрибут (`index.html:339`) — без визуального подтверждения через CSS-класс. |
| `bulk-btn-*` | (не disabled никогда — всегда видны) |
| `btn-undo`/`btn-redo` | `disabled` атрибут (`index.html:868-869`) — но JS должен toggle'ить. |
| `modal-gantt-move-ok` | `disabled` (`index.html:406`) |

Использует только native `disabled`. Нет ARIA-альтернатив для button-likes (`.hist-stat-card`).

---

## 8. Хит-таргеты в bulk action / row-actions

| Где | Размер (предположит.) |
|---|---|
| `.row-act-btn` SVG 15×15 в td-actions (registry.js:296-298) | визуальная — 15px, кликабельная зона зависит от padding td |
| `.col-pin-btn` SVG 11×11 (registry.js:122) | очень мелко |
| `.modal-close-btn` ✕ | стандарт, ок |

Pin-кнопка 11px — пограничный фейл по WCAG (2.5.5 AAA минимум 44×44 для touch).

---

## Резюме П8

Кнопки и действия — органически выросший зоопарк:
- **7 топбар-кнопок** ≈ единые классы, но 5 разных способов передать состояние (aria-pressed, dirty-dot, hidden chevron, data-tb, нет ничего).
- **10 модалок** ≈ общая структура, но 4 разных способа закрытия + role="dialog" только у одной + 6 копий inline-style на label/text-muted.
- **3 разные DnD-системы** + ещё одна mouse-resize.
- **3 confirmation-method'а**: ConfirmDialog (правильно), native alert/confirm (legacy), text-input verify в `app.js:817`.
- **30+ showToast вызовов** с magic-millисекундами 1500…4200.
- **7 action-button-классов** без общего CSS-namespace.

Quick wins: (a) extract `topbarBtn(opts)` builder, (b) обернуть все модалки в `Modal.open()`,
(c) Toast-times → 5 семантических уровней (`Toast.SHORT`/`MED`/`LONG`/`PERSISTENT`).
