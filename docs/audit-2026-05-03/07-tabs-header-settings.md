# Audit 07 — Tabs / Header / Settings / Sidebar

**Авторы:** 5 экспертов — Tech+UX Tab Auditor, Topbar/Header Auditor, Settings Auditor, Sidebar/IA Auditor + 1 user persona (Team Lead).

---

## TL;DR

**3 must-fix перед расширением:**
1. **Save в topbar теряется среди 7 ghost-icons** — нет primary-state, нет dirty-indicator (●), пользователи делают Ctrl+S в надежде
2. **Дублирующая иконка** Диагностика ↔ Ошибки + 16/17 sidebar-items без `title=` атрибута → collapsed-mode unreadable
3. **«Удалить всех сотрудников» без double-confirm** — destructive primary в шапке секции

**Главный вердикт от пользователя (тимлид):**
> «Bookmark survival = highest priority. URL/shortcuts/layout не должны меняться вместе с rebrand. Метафоры на лендинге — ок. Внутри продукта — раздражает.»

---

## A. Tabs (17 секций) — топ проблем

| # | Section | Top issue | File:Line | Severity |
|---|---|---|---|---|
| 1 | **Gantt** | 2315 LOC monolith, 30+ inline `renderChart()` triggers — почти неотлаживаемый | `gantt.js` | 🔴 High |
| 2 | **Employees** | «Удалить всех» без double-confirm в шапке | `index.html:822` | 🔴 High |
| 3 | **Actions** | Нет per-action undo, action-log truncation теряет ранние записи | `actionLayer.js:82` | 🔴 High |
| 4 | **Registry** | DnD/resize listeners пере-подключаются на каждом render | `registry.js:149-196` | 🟠 High |
| 5 | **Kanban** | `slice(0, 100)` тихо обрезает — пользователь не видит 101+ карточку | `kanban.js:62` | 🟠 High |
| 6 | **Metrics** | `render()` = 370 LOC monolith | `metrics.js:335-703` | 🟠 High |
| 7 | **Integrations** | Settings modal — 800-LOC binder | `integrationsView.js:67` | 🟠 High |
| 8 | **Timeline** | Хардкод дат `'20.04–17.05'` (устареют в Q3) | `timeline.js:23-25` | 🟡 Med |
| 9 | **Dashboard** | 12 KPI без приоритизации, нет тренда | `dashboard.js:60-72` | 🟡 Med |
| 10 | **AI / AI-CEO** | Дубль severity/scenario maps, RU_SEVERITY дублируется в обоих файлах | `aiView.js:49`, `aiCeoView.js` | 🟡 Med |
| 11 | **Errors** | `_unsub` не очищается при смене view → memory leak | `errorsView.js:73` | 🟡 Med |
| 12 | **History** | `clearHistoryLog` без confirm | `history.js:64` | 🟡 Med |
| 13 | **Insights** | `overloaded >= 6` magic number, не объяснён | `metrics.js:734` | 🟡 Med |
| 14 | **Podlozhka** | `window.RegistryView` cross-coupling | `timeline.js:138` | 🟡 Med |
| 15 | **Employees** | `getTasksForEmployee` O(N×M) fullscan per-employee | `employees.js:42` | 🟡 Med |
| 16 | **Summary** | `renderDetailed` dead code (V17.1 G1) | `metrics.js:81-329` | 🟢 Low |
| 17 | **Integrations** | Emoji в loader-фразах нарушает Spine guidelines | `integrationsView.js:667` | 🟡 Med |
| 18 | **Diagnostics** | Нет empty-state и time-of-import | `metrics.js:803` | 🟡 Med |
| 19 | **Registry** | Sort не мемоизирован, O(n log n) каждый touch | `registry.js:31` | 🟡 Med |
| 20 | **Gantt** | Toolbar 12 кнопок без группировки | `index.html:717-743` | 🟡 Med |
| 21 | **Timeline** | Inline-style на сотнях строк | `timeline.js:51-105` | 🟢 Low |
| 22 | **AI** | Loader общий на 13 блоков (нет per-block progress) | `aiView.js:218` | 🟢 Low |
| 23 | **Kanban** | Нет mobile drag-handle (только `draggable=true`) | `kanban.js:72` | 🟢 Low |
| 24 | **Actions** | `switch` на string-keys без enum | `actionLayer.js:61` | 🟢 Low |
| 25 | **Insights** | Risk-ratio при `total=1` показывается (статистический шум) | `metrics.js:737` | 🟢 Low |

### Section-by-section quick map

| Section | Что делает | Главное |
|---|---|---|
| **registry** | Табличный реестр с фильтрами, DnD-resize, bulk-edit | Виртуализация для >300 строк, event delegation |
| **gantt** | Гантт по командам/эпикам, lock-plan, ⌘K palette | Split на gantt/render.js + interactions.js + aux.js |
| **dashboard** | 12 KPI + risks + breakdown | Trend-deltas «↑3 за 7д», 4 hero-KPI крупно |
| **kanban** | DnD карточек между релизами | Виртуализация колонок, paginate >100 |
| **timeline** | Bar-stages с workType breakdown | Брать даты из `GANTT_RELEASE_BOUNDS`, sticky thead |
| **podlozhka** | Сводная таблица с группировкой | Sticky thead, отдельная группа «Без эпика» |
| **employees** | Карточки/таблица сотрудников + KPI + OT | Двух-этапный confirm для destructive, pre-build assignee→rows index |
| **summary** | CEO-вид с 6 hero + релизы + 3 инсайта | Удалить dead code, добавить Print/PDF stylesheet |
| **metrics** | Pie/sparkline/release-health/quality | Декомпозиция render(), tooltip с формулой score |
| **insights** | Severity-bucket сигналы + actions | Конфигурируемые thresholds, min `total>=3` |
| **diagnostics** | Источники данных + warnings | Empty-state, copy-as-bug-report |
| **actions** | Каталог 21 bulk-действия | Per-action undo-snapshot, preview before apply |
| **ai** | 13 LLM-блоков с fallback→enhance | Per-block streaming/skeleton, cache 5min |
| **integrations** | 7+ subtabs с sync/full-pull | Subtab-router lazy-init, «Verify connection» badge |
| **aiCeo** | CEO-аналитик с preview-modal | Общий LLMRunner с aiView |
| **history** | Журнал действий + CSV-export | Confirm перед очисткой, pin-favorites |
| **errors** | Список ошибок/warn с stack | Copy-as-bug-report, group-by-source |

---

## B. Topbar / Header — top-15 issues

| # | Issue | Severity |
|---|---|---|
| 1 | **Save не визуально primary** — теряется среди 7 ghost-icons | 🟠 High |
| 2 | **Нет dirty-indicator (●)** на Save — пользователь не знает что есть unsaved | 🟠 High |
| 3 | **Theme icon статичный** — не отражает текущее состояние | 🟡 Med |
| 4 | **Sim mode active state слабый** — нет stripe/badge | 🟡 Med |
| 5 | **Files dropdown — 10 пунктов плоско** без группировки лейблами | 🟡 Med |
| 6 | **«Очистить данные» destructive в общем меню** без warning | 🟠 High |
| 7 | **«CSV update» vs «Импорт CSV»** — без подсказки разницы | 🟡 Med |
| 8 | **Нет command palette (Cmd+K)** — 9+ действий просятся | 🟠 High |
| 9 | **`?` не bound** как shortcut для help | 🟢 Low |
| 10 | **Demo-bar layout shift** при входе/выходе из demo | 🟡 Med |
| 11 | **Filter chevron ▾** — текстовый символ, ломает SVG-консистентность | 🟢 Low |
| 12 | **Brand-кликабельность не очевидна** — нет hover-underline | 🟢 Low |
| 13 | **Нет responsive breakpoints** — на planshetах перекрытие | 🟡 Med |
| 14 | **Нет статуса сервера / sync-индикатора** для интеграций | 🟠 High |
| 15 | **Row-count badge скрыт** `hidden` — где логика показа? | 🟢 Low |

### Visual hierarchy в topbar

ВСЕ кнопки (кроме Demo) используют `btn-ghost btn-sm topbar-icon-btn` — **полностью плоская иерархия**.

- **Primary должны быть:** Save (с dirty-indicator), Фильтры
- **Secondary:** Files, Sim mode
- **Tertiary (в overflow `⋯`):** Theme, Onboarding, Sim mode

### Keyboard shortcuts coverage
- ✓ `Ctrl/Cmd+S` (Save)
- ✓ `Ctrl+Z/Y` (Undo/Redo с гейтом по секциям)
- ✗ `Cmd+K` (command palette)
- ✗ `Cmd+,` (settings)
- ✗ `?` (help/onboarding)
- ✗ `Cmd+Shift+F` (filters toggle)
- ✗ `Cmd+E` (export)
- ✗ `g d` / `g r` / `g g` (Vim-style nav)

---

## C. Sidebar / IA — top-12 issues

| # | Issue | Severity |
|---|---|---|
| 1 | **Дублирующая иконка** Диагностика ↔ Ошибки (одинаковый SVG circle+!) | 🔴 Critical (collapsed mode) |
| 2 | **`title=` атрибуты отсутствуют** на 16/17 пунктов → collapsed-mode unreadable | 🟠 High |
| 3 | **Focus-visible не определён** для `.nav-item` — WCAG 2.4.7 fail | 🟠 High |
| 4 | **Singletons с дивайдерами** (Диагностика, Actions, AI Анализ) — визуальный шум без IA | 🟠 High |
| 5 | **Group 1 перегружена** (10 пунктов, 4 ментальных модели) | 🟠 High |
| 6 | **Нет section-headers** — 6 групп безымянные | 🟡 Med |
| 7 | **«Actions» как label** — generic-имя, иконка-солнце не помогает | 🟡 Med |
| 8 | **AI Анализ и AI CEO разделены** дивайдером, хотя оба AI-tier | 🟡 Med |
| 9 | **Интеграции в AI-группе** — категориально системное, не AI | 🟡 Med |
| 10 | **Нет `aria-current="page"`** на active-пункте | 🟡 Med |
| 11 | **`nav-badge` только для Ошибки** — нет паттерна для new-counts | 🟢 Low |
| 12 | **Нет skip-link / shortcut** для перехода между группами; 17 Tab-stops до контента | 🟡 Med |

### Active/hover/focus states
- ✓ Active: `accent-light` bg + 3px stripe-pill (`::after`) — **Spine-pill compliant**
- ✓ Hover: `border-light` bg + `text-2`
- ✗ Focus-visible не задан → keyboard regression
- ✗ Tooltip-mode для collapsed отсутствует (нет `title=`)

---

## D. Settings — top-15 issues

| # | Issue | Severity |
|---|---|---|
| 1 | **Integrations save кнопки не подчиняются глобальной «Сохранить»** — UX-предательство | 🔴 High |
| 2 | **Дублирующиеся миграционные кнопки** в Storage и Debug tabs | 🟠 High |
| 3 | **`q2_telemetry_disabled` без UI** — privacy violation (GDPR-style opt-out) | 🟠 High |
| 4 | **Drag-and-drop без a11y** — keyboard users не могут переупорядочить | 🟠 High |
| 5 | **Reset без confirm и без undo** — мгновенно стирает кастомизацию | 🟠 High |
| 6 | **Token persistence тройная** (saveToLocal/tokenSessionOnly/sessionToken) | 🟠 High |
| 7 | **Storage mode radio переключает мгновенно** — нет «применить и подтвердить» | 🟠 High |
| 8 | **30+ блок-чекбоксов в одном scroll** без поиска / категорий | 🟡 Med |
| 9 | **Theme/SimMode persist отдельно** от App Settings — нет «единой картины» | 🟡 Med |
| 10 | **Registry settings panel не упомянут** в основной модалке | 🟡 Med |
| 11 | **Per-team scanner thresholds** только в скрытой UI | 🟡 Med |
| 12 | **Migration формата отсутствует** — изменение схемы потребует ручной обработки legacy | 🟡 Med |
| 13 | **Validation тихий** (clamp без toast) — пользователь вводит 5000 temperature, видит 2 | 🟡 Med |
| 14 | **`activityWindowHours` глобальное, но в Confluence tab** — мисплейс | 🟡 Med |
| 15 | **Нет export/import всех настроек** одним файлом | 🟡 Med |

### Settings inventory (~30+ persistence keys)
- App Settings (5 tabs): Sections, Topbar, Blocks, Storage, Debug
- LLM modal: apiMode/baseUrl/model/token/temperature/maxTokens/systemPrompt/contextMode/rowLimit/payloadLimit/customPayload + per-intent prompts
- Integrations (4 sub-tabs): URL/Token/projectKeys + activityWindowHours + sinceDate + allowInsecureTls
- Topbar toggles: theme, simMode
- Registry settings panel: rowHeight, col label/type/width/visibility/pin
- Gantt: density, mode, legend, presetsCollapsed, ganttEditMode, planLocked
- Team Scanner 2: 8+ keys (toggles + per-team config + audit consent + history)
- Hidden LS-only: q2_telemetry_disabled, q2_chat_debug, q2_diag_consent_until

### Spread:
- Дублируется SQLite↔LS migration в Storage tab + Debug tab
- LLM settings `<modal>` существует как самостоятельный элемент + перевешивается в `#app-settings-llm-host`

---

## E. User feedback (real Team Lead)

### Top-5 daily используемых
1. Backlog/Задачи спринта
2. Команда/Capacity
3. Сводка по релизу
4. Риски
5. Канбан-доска

### Никогда не открывал
- Архив планов, Шаблоны, Журнал изменений системы, «Аналитика портфеля» (вечно крутилка), Интеграции (для админов)

### Что бесит
1. Хлебные крошки длиной с экран — обрезаются многоточием в самом интересном месте
2. Иконка «Помощь» открывает Confluence-портал в новой вкладке, грузится 10 сек, ничего не находится
3. Уведомления (колокольчик) — счётчик «47», половина — «план обновлён системой», нельзя прочитать всё одной кнопкой
4. Поиск в шапке ищет только по текущему плану, не глобально
5. Аватарка пользователя занимает место, внутри только «выйти»

### 5 immediate frustrations (последняя неделя)
1. Drag-n-drop карточки между спринтами — отпустил, карточка вернулась обратно молча
2. Экспорт в Excel на 800 задач — крутилка 40 сек, потом «ошибка, попробуйте позже» без деталей
3. Фильтр по исполнителю сбрасывается при переходе на другую вкладку
4. Поля «прогресс %» и «статус» рассинхронизированы (100% при «в работе»)
5. Jira-синк — задачи задвоились после ручной правки, конфликты не показывает

### Add (top-3)
1. **Глобальный поиск через Ctrl+K**
2. **Pinned views** — закрепить «мой спринт» как стартовую
3. **Bulk-редактирование** в бэклоге (выделил 20 задач, поменял компонент)

### Remove (top-3)
1. Theme toggle из шапки — унести в settings
2. Вкладку «Шаблоны» или объяснить что это
3. Половину пунктов Files dropdown («Печать», «Экспорт PDF v1», «Экспорт PDF v2»)

---

## F. Идеи кросс-section развития (35+)

### Component primitives
1. **ActionRegistry singleton** — один реестр, переиспользуется в Insights / AI-CEO / ActionLayer / Bulk-panel
2. **Skeleton loading component** — `<Skeleton variant="table|grid|chart">`
3. **Empty-state component** — `EmptyState({icon, title, hint, actions:[...]})`
4. **ConfirmDialog для всех destructive** — не native `confirm()`
5. **Sticky thead** для всех таблиц (registry уже есть; podlozhka/employees-table/history — нет)

### Performance
6. **Виртуализация** в Registry/Podlozhka/Employees/Errors/History (>300 строк)
7. **Per-block AI cache** (5min TTL) — chunk-hash → response
8. **Pre-build `assigneeRowsIndex`** — устранить O(N×M) в employees
9. **Memoize sort** в registry

### UX
10. **Cmd+K command palette** — все 30+ действий + поиск секций/фильтров/эпиков/людей
11. **Search input** в шапке — глобально, не только в текущем плане
12. **Pinned views** — закрепить frequently-used view как стартовую
13. **Trend-deltas** на dashboard KPI: `↑3 за 7д`
14. **Filter persist URL** — share-link с активными фильтрами
15. **Print/PDF stylesheet** для Summary / Metrics / AI-CEO
16. **Mobile-friendly drag** — long-press handle вместо `draggable=true`
17. **Toolbar overflow** ⋯ для Gantt/Registry: при <1280px складывать кнопки

### Settings UX
18. **Единый Settings hub** с поиском (`Cmd+,`)
19. **«Что я изменил» history** — diff-panel в hub (использовать существующий HistoryLog.settings)
20. **Pending changes pattern** везде — все toggles становятся pending, footer «Применить N / Отменить»
21. **Settings export/import JSON** — одним файлом
22. **Discoverability badges** — «изменено», «не настроено», «требует перезагрузки»

### Sidebar reorg
23. **4 кластера с CAPS-headers**:
    - **ПЛАНИРОВАНИЕ:** Дашборд, Реестр, Гант, Канбан, Таймлайн, Подложка
    - **АНАЛИТИКА:** Сводная, Метрики, Инсайты, Сотрудники
    - **ИНТЕЛЛЕКТ:** AI Анализ, AI CEO, Actions
    - **СИСТЕМНОЕ:** Интеграции, Диагностика, История, Ошибки
24. **Pinning frequently-used** — drag-to-top или star-icon
25. **Recent items** — динамическая мини-секция «Недавно» (top-3 по timestamp)
26. **Tooltip-mode для collapsed** — auto-`title=label` + hover-popover (200ms delay)
27. **Переименовать Actions** → конкретное (Команды / Bulk-операции / Центр действий)

### Topbar
28. **Save с состояниями** — idle / dirty (●) / saving (spinner) / saved (✓ 2с)
29. **Group в Files dropdown** — caps-headers «ИМПОРТ» / «ЭКСПОРТ» / «ДАННЫЕ»; «Очистить» с red-tint + confirm
30. **Theme toggle с двумя icon** (sun ↔ moon) + `Cmd+Shift+L`
31. **Sim mode persistent banner** под шапкой когда включён
32. **Status indicator** (зелёный/жёлтый/красный dot) — server health + интеграции (last-sync tooltip)
33. **Notification badge** на onboarding/settings — V18 hint о новых features
34. **User/Profile menu** в правом углу — last-saved-by, мой Jira-ID, logout

### Live preview & confirmation
35. **Live preview в ActionLayer и BulkEdit** — «затронет 47 задач (12 в scope, 8 готовых)» before apply
36. **Per-action undo-snapshot** — каждое мутирующее действие → entry в HistoryManager c `revert()`

---

**Файлы для глубокого refactoring:**
- `views/gantt.js` (split на render/interactions/aux)
- `views/metrics.js` (декомпозиция render)
- `views/integrationsView.js` (settings modal extract)
- `app/actionLayer.js` (undo-snapshot)
- `index.html` (sidebar reorg, topbar overflow)
- `app/appSettings.js`, `app/storageSettings.js`, `integrations/integrationsRenderer.js` (settings hub)
