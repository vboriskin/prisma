# 00 — Синтез 6 экспертных отчётов · Гант

> Вход: 01-IA, 02-VISUAL, 03-INTERACTION, 04-UX, 05-MOTION, 06-CROSS (написаны 2026-05-04, read-only).
> Выход: единое предложение для согласования. Без правок кода.

---

## TL;DR

Гант — **технически зрелый power-user view** (рейтинг 4/5 у Дмитрия и Игоря), но имеет 5 болезней:

1. **Шапка перегружена** — h2 дублирует prizma-h1 (как было на Метриках до Wave 5)
2. **Toolbar из 12 кнопок без группировки** — Дмитрий: «зоопарк символов на одной полке»
3. **Wave 4 Pulse не доехал до Ганта** — `prizma-drag-pulse` подключён к `.gex-grid-cell` и `.kanban-col-body`, но НЕ к `.gantt-cell`. Жалоба Дмитрия «silent drag-drop» **формально не закрыта** в коде Ганта — это **livebug**, отмеченный 4/6 экспертами
4. **26+ hex hardcode**, 5 источников цветов колодцев, эмодзи `🔒 ✏` в lock-badge, type-scale 10 размеров + 5 весов с weight 800
5. **Cross-cutting**: 4 view'а задач (Реестр / Гант / Канбан / Таймлайн) живут в общем модуле СЛЕД ПУТИ с одним FilterEngine, но **не имеют общей навигации** — Дмитрий хочет «один таб с layout-toggle» (П12 #6)

**3 эксперта (IA / Cross / UX) рекомендуют вариант β** — промежуточный шаг ~2 дня: общий path-toolbar/filter-bar поверх 4 view'ов + visual cleanup Ганта. Полный γ (один таб с layout-toggle) — отдельный 12-дневный спринт после.

```
БЫЛО:                                  ПОСЛЕ β:
СЛЕД ПУТИ                              СЛЕД ПУТИ
  ├─ Реестр (свой filter+toolbar)       ├─ shared filter-bar (один)
  ├─ Гант (свой)                        ├─ Реестр   ┐
  ├─ Канбан (свой)                      ├─ Гант     ├─ secondary toolbar per view
  ├─ Таймлайн (свой)                    ├─ Канбан   │
  └─ Подложка [DEBUG]                   ├─ Таймлайн ┘
                                        └─ (Подложка остаётся DEBUG-only)
```

---

## 1. Consensus 6 экспертов

| # | Что | IA | Visual | Interaction | UX | Motion | Cross |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Legacy h2 «Гант по релизам» — тавтология с prizma-h1 | ✓ | ✓ | — | ✓ | — | — |
| Wave 4 Pulse НЕ подключён к `.gantt-cell` (livebug) | ✓ | — | ✓ | ✓ | ✓ | — |
| Toolbar 12 кнопок без визуальной группировки (PLAN / VIEW / NAV) | ✓ | ✓ | ✓ | ✓ | — | — |
| 26+ hex hardcode (gantt-lock-badge, ganttHtmlExport, цвета колодцев в 5 источниках) | — | ✓ | — | — | — | — |
| Эмодзи `🔒 ✏ ▸ ▾ ✓` в production (`app.js:1197-1201`, gantt.js, styles.css) | — | ✓ | — | — | — | — |
| `gdt-cell-receive` keyframe готов в CSS, но не подключён к drop-handler | — | — | ✓ | — | ✓ | — |
| FocusTrap отсутствует в plan-lock comment dialog | — | — | ✓ | — | — | — |
| Domain-glossary gap: новички не понимают «1.20 / 1.21 / OT» | — | — | — | ✓ | — | — |
| `#gantt-filters` мёртв в DOM (display:none), но `GanttView.gf` живёт в коде | ✓ | — | — | — | — | ✓ |
| dead code в `views/gantt.js` `renderFilters()` (gantt.js:561-573) | — | — | — | — | — | ✓ |
| Plan-lock dyря в Канбане: `kanban.js:39-75` меняет `release*Types` без gate | — | — | — | — | — | ✓ |
| Cmd+K в Ганте есть, но без task-by-id | — | — | — | ✓ | — | — |
| **Рекомендация — β** | ✓ | implied | implied | — | implied | ✓ |

«Implied» — эксперт фокусировался на своей роли, но через предложенные правки не противоречит β.

---

## 2. Финальное предложение

### 2.1. Структурно

**Volna 1: Гант visual cleanup (без архитектурных перестановок).**

#### А. Шапка
- УДАЛИТЬ: legacy `<h2>Гант по релизам</h2>` в `.section-header` — тавтология с prizma-h1 «Гант». Eyebrow «СЛЕД ПУТИ · ГАНТ» уже есть.
- УДАЛИТЬ из DOM: `#gantt-filters` (мёртвый контейнер), `#gantt-legend-extra` (пустой).
- УДАЛИТЬ из JS: `GanttView.gf` (приватный фильтр-state), `renderFilters()` (gantt.js:561-573) — dead code.

#### B. Toolbar — группировка в 3 кластера
Без изменений количества кнопок (контракт), но с визуальными divider'ами:

```
[ PLAN ]                  [ VIEW ]               [ NAV ]
gantt-lock-status         tips-toggle            jump (Cmd+K)
btn-gantt-lock-plan       history                mode (Default/Overview)
btn-gantt-edit-mode       expand-all             density (Regular/Compact)
btn-gantt-unlock-plan     undo / redo            fullscreen
```

Между кластерами — `<span class="topbar-divider">` (тот же класс что в Wave 2 топбара).

#### C. Hex hardcode (П11.23 + cross-cutting)
- `views/ganttHtmlExport.js:710-719, 984` — `#fef3c7 / #78350f / #f59e0b` → `var(--prizma-drift-*)` (light-theme уже unified в dark в `styles.css:2274-84`)
- `.gdt-pill-cmt-transfer/-add` `#f59e0b / #3b82f6` → `var(--prizma-drift)` / `var(--prizma-information)`
- 5 источников цветов колодцев → один токен per release (V18 `--release-r120-color` etc уже унифицирован для дашборда — расширить на Гант)

#### D. Эмодзи cleanup
- `app.js:1197-1201` (lock-status badge `🔒 / ✏`) → `Icons.get('lock' / 'edit')`
- `gantt.js:964` (team-vis-btn `▸ / ▾`) → `Icons.get('chevron-right' / 'chevron-down')`
- `styles.css:1019` (`▾`) → SVG в HTML
- `styles.css:2421` (`.gdt-pill-state-done::before { content: '✓' }`) → `Icons.get('check')` или mini-SVG inline

#### E. Type-scale → trio
- `.gdt-rail-label` 16/800 → 24/300 (брендбук MonoNumber)
- `.gantt-bar-label` 13/700 → 11/500/1.5 CAPS (eyebrow на колодец)
- Все weight 800 → 400/500
- Mono-tabular на `.v16-team-total`, `.team-count`, `.gantt-no-assignee`

#### F. Density off-grid
- compact 30px → 32px (4-grid)
- 9.5px / 10.5px → ближайший 4-grid (8/12)

### 2.2. Volna 2: Wave 4 Pulse fix (livebug + W4 dep)

`prizma-drag-pulse` уже определён в `styles.css` для `.gex-grid-cell.cell-receive` и `.kanban-col-body.prizma-drop-target`. Подключить **третий селектор**: `.gantt-cell.cell-receive` (или `.gantt-cell.gantt-cell-dragover`).

Проверить:
- `gdt-cell-receive` keyframe готов на `styles.css:2247-2270` — подключить к drop-success path в `gantt.js`.
- Reduced-motion: `prizma-drop-pulse` сейчас выключается через `animation: none` — нужен static outline fallback (Motion §3 livebug).

### 2.3. Volna 3: Interaction + a11y polish

#### MUST
- `role="toolbar"` на `.section-header-actions` (не было после P11.3 несмотря на название)
- FocusTrap в plan-lock comment dialog (`app.js:1258`) — `app/uxKit.js:121` уже экспортирует FocusTrap, но `requireMoveComment` его не использует
- `team-header collapse` сделать focusable + `aria-expanded`

#### SHOULD
- Контекст-меню pill: `role="menu"` / `menuitem` + focus-trap + return-focus
- Cmd+K palette: расширить на task-by-id (5 строк кода, эффорт S, рефлекс power-юзера)

### 2.4. Volna 4: Motion рефреш

#### MUST
- Drop Pulse infinite → ≤3 цикла + paused-on-dragleave (Motion §6)
- Reduced-motion: static outline fallback вместо `animation: none`

#### SHOULD
- pills emerge stagger по колодцам на первом render (только `_renderedOnce === false`)
- Counter Align на column-header при drop (если решим вернуть счётчик)

#### COULD
- Smooth pill-move (FLIP) между колонками без перерендера — крупная задача, отдельный спринт
- Tooltip-preview при mouse-drag

### 2.5. Volna 5: β cross-cutting (опционально, ~2 дня)

**Shared filter-bar и view-switcher для модуля СЛЕД ПУТИ:**

Добавить общую полоску **выше** section-registry / section-gantt / section-kanban / section-timeline:
- Filter-input + chip-filters (общие для 4 view'ов)
- View-switcher: `[Реестр] [Гант] [Канбан] [Таймлайн]` (segmented, текущий active)
- Bulk-actions (если выделение есть)

Реализация:
- Новый `views/pathToolbar.js` или функция в `app.js`
- Моунтится при первом goTo в любой из 4 view'ов
- Filter-state остаётся в state.filters (общий)

**Что это не делает:**
- Не объединяет в один section (это γ)
- Не трогает inline-edit / DnD-валидаторы
- Тесты не ломаются

### 2.6. Подложка
По Cross-comparison — она `appSettings.js:250` помечена как DEBUG-only. **Не трогаем**, она дев-инструмент.

### 2.7. Plan-lock dыра в Канбане (cross-cutting fix)
Cross-comparison обнаружил: `kanban.js:39-75` меняет `release*Types` без `requireMoveComment` gate'а. Это **отдельный bug**, не связан с Гант-редизайном. Исправить — **одна обёртка** в drop-handler (если `state.planLocked && !state.editMode` → вызвать `requireMoveComment`). 

Решение: добавить fix в Volna 5 (когда касаемся Канбана) или отдельно.

---

## 3. Что НЕ делаем

- **γ полный merge** (Реестр+Гант+Канбан+Таймлайн в один section с layout-toggle) — отдельный 12-дневный спринт. Слишком много контрактов сразу (DnD validators × 4 + plan-lock + inline-edit + tests).
- **Cmd+K расширить на section-jump поверх task-by-id** — отдельный спринт после.
- **Domain-glossary tooltip** на «1.20 / 1.21» — для новичков, но они Гант не открывают по П12. Отложить до onboarding-tour-refresh.
- **renderFilters dead code** уже в Volna 1 (удаляется), не дублируем.

---

## 4. Контракты

- **DnD-валидаторы** (mouse + keyboard) — не ломаем
- **Plan-lock + editMode** — не ломаем, FocusTrap добавляется поверх
- **Cross-epic guard** — не ломаем
- **Reactive.silent** для mass-mutations — не ломаем
- 1017 unit-тестов остаются зелёными на каждой волне
- **renderHero** на Ганте не используется (контракт-тест не требует) — мы не добавляем hero, Гант остаётся рабочей плоскостью

---

## 5. План работ — по этапам

### Wave 1 — Гант visual cleanup (1 день)
- Удалить legacy h2, мёртвые контейнеры, dead JS code
- Toolbar dividers PLAN / VIEW / NAV
- Hex hardcode → токены (`gantt-lock-badge`, ganttHtmlExport, pill-cmt-* цвета)
- Эмодзи `🔒 ✏ ▸ ▾ ✓` → SVG via Icons.get
- Type-scale → trio + удалить weight 800

### Wave 2 — Pulse livebug + motion polish (0.5 дня)
- Подключить `prizma-drag-pulse` к `.gantt-cell.cell-receive`
- Подключить `gdt-cell-receive` keyframe в drop-handler
- Drop Pulse: infinite → ≤3 цикла, paused-on-dragleave
- Reduced-motion static fallback

### Wave 3 — Interaction + a11y (1 день)
- `role="toolbar"` на `.section-header-actions`
- FocusTrap в `requireMoveComment` dialog
- team-header collapse focusable + aria-expanded
- Контекст-меню pill: role="menu" + focus-trap

### Wave 4 — Cross-cutting fix Канбан plan-lock (0.5 дня)
- Канбан drop-handler: добавить requireMoveComment gate

### Wave 5 — β shared toolbar (опционально, 2 дня)
- `views/pathToolbar.js` — common filter + view-switcher для 4 view'ов
- Тесты обновления навигации

### Финал
- npm test + preview verify

**Без Wave 5 (только α-вариант):** ~3 дня.
**С Wave 5 (β-вариант):** ~5 дней.

---

## 6. Что нужно решить (вопросы продукту)

### 6.1. α или β?
- **α** (только Гант refresh) — 3 дня
- **β** (Гант refresh + shared toolbar) — 5 дней
- **γ** (полный merge) — 12 дней, отдельный спринт

**Моя рекомендация:** **β**. Закрывает Дмитрия (П12 #6) минимальными силами. γ — отдельный продакт-вопрос (нужен ли вообще единый таб «Задачи» или нав-структура «4 разных view'а» — это паттерн).

**Вопрос:** ок β или сейчас только α (Гант), а β/γ — отдельный спринт?

### 6.2. Cmd+K расширить на task-by-id?
UX советует — 5 строк кода, эффорт S. Power-юзеры рефлексом нажимают Cmd+K, чтобы быстро найти задачу.

**Моя рекомендация:** да, добавить в Wave 3. Низкий риск.

**Вопрос:** ок?

### 6.3. Plan-lock dыра в Канбане
Cross-comparison обнаружил отдельный bug. Влияет на compliance use-case (V14 B5). Можно фиксить:
- Сейчас (Wave 4) — одна правка в kanban.js
- Отдельным спринтом

**Моя рекомендация:** **сейчас**. Это не фича-реквест, это bug-fix.

**Вопрос:** ок?

### 6.4. Domain-glossary для «1.20 / 1.21 / OT»?
UX advocate отметил, что новичок (Олеся) не понимает домен. Можно добавить tooltip на release-header («1.20 = январь–март 2026» или «релиз X»).

**Моя рекомендация:** **отложить**. Олеся Гант не открывает по П12. Glossary лучше делать в onboarding-tour, не в самом Ганте.

**Вопрос:** делаем сейчас (мини-tooltip в release-header) или отложить?

### 6.5. Заголовок Ганта
Сейчас h1 — «Гант» (от prizma `getSectionLabel('gantt')`). Можем оставить, или переименовать в «План квартала» (как Дашборд → «Курс квартала»).

**Моя рекомендация:** оставить «Гант» — название признанное power-user'ами (Дмитрий, Игорь — они так его называют). Переименование в «План» создаст confusion для существующих пользователей.

**Вопрос:** ок «Гант» или переименовать?

### 6.6. Поваsled подзаголовок Ганта
Сейчас sub: «Тайм-сетка по релизам и командам.» — нейтрально. Можно оставить.

**Моя рекомендация:** оставить.

**Вопрос:** ок?

---

## 7. Метрики успеха

После:
- Дмитрий «silent drag-drop» — закрыт (Pulse подключён)
- Игорь «motion-fatigue в обратной» — закрыт (≤3 цикла, paused-on-leave)
- 1017 unit-тестов зелёные на каждой волне
- 0 hex hardcode в Гант-related файлах
- 0 эмодзи в production Ганта
- Toolbar в 3 визуальных кластера

---

## 8. Резюме

Гант — **технически готовый** view, но имеет 5 livebug'ов и косметических разрозненностей. Всё это решается за **3-5 дней** в зависимости от того, делаем ли β cross-cutting сейчас или отдельным спринтом. Контракты (DnD, plan-lock, cross-epic) полностью сохраняются.

**Минимальный набор для согласования:** п. 6.1–6.6.
