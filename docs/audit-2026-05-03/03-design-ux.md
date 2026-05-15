# Audit 03 — Design / UX / IA / Brand / Interaction

**Авторы:** 5 экспертов — Senior Designer, UX Researcher, Information Architect, Brand Designer, Interaction Designer.

---

## TL;DR

**Главные проблемы:**
1. **30+ нарушений Spine-pill** — gradients (18), emoji в data-views (25+), параллельные badge-системы (7+), 3 параллельных primary-button
2. **17-item flat sidebar** без groups, 4 секции с одинаковой целью (Дашборд / Сводная / Метрики / Инсайты)
3. **6+ модалок без focus-trap, native `confirm()`** для destructive actions
4. **Постоянно editable inputs в Реестре** → DOM-шум + accidental edits
5. **No global search / Cmd+K** — power users теряют время
6. **Theme switch wave** — per-button color tween даёт «волну» 140ms по Gantt
7. **Терминологический коллапс** — эпик / задача / row / эпик-цель / тип работы (BE/FE/QA)

---

## A. Visual hierarchy — section by section

| Section | Главная проблема |
|---|---|
| **Дашборд** | 12 KPI-cards equal weight + hover-lift на всех = false affordance. Нужно 3-tier (3 hero / 6 standard / collapsible) |
| **Реестр** | Dual sticky-thead style (.7px vs .3px), плотность стирает иерархию |
| **Гант** | `linear-gradient` на `.gantt-team-header` (нарушение Spine), filled bg вместо `3px stripe-left` |
| **Сотрудники** | `👥` emoji + `⚠️` overload без указания где именно перегруз |
| **AI / AI-CEO** | `linear-gradient(135deg, #6366f1 → #a855f7 → #ec4899)` на `.ai-enhanced-badge` и hero |
| **Канбан** | Каждая карточка с 3+ chip эмодзи (`🟢 Merged`, `🟡 PR`, `✅ Approved`) — accent-инфляция |
| **Метрики** | `linear-gradient` на `.metrics-row-fill` × 5 мест |
| **Таймлайн** | `🚧` emoji prefix × 3, `📂 📊` empty-state |
| **История** | `EVENT_TYPES` буквально содержит emoji-icons (`📊 🤖`) как design language |
| **Ошибки** | Empty «Записей нет ✨» — emoji в data-view |
| **Интеграции** | `ts2-kebab-menu` — `❓ ⚙ 👥 ⚠️ 🔍` (5 эмодзи в одном меню!) — наибольшая концентрация Spine-violations |

---

## B. Information architecture

### Sidebar (17 пунктов, 6 групп через nav-divider)
| Группа | Пункты | Проблема |
|---|---|---|
| 1. Views | Дашборд, Реестр, Гант, Канбан, Таймлайн, Подложка, Сотрудники, Сводная, Метрики, Инсайты | Раздутый «всё подряд»: 5 представлений одной таблицы + 4 аналитики + 1 master-data |
| 2. Diagnostics | Диагностика | singleton |
| 3. Actions | Actions | singleton, English в RU UI |
| 4. AI tools | AI Анализ | singleton |
| 5. Integrations | Интеграции, AI CEO | AI CEO логически — топ-аналитика, не интеграция |
| 6. Logs | История, Ошибки | |

**Diagnosis:** 3 singleton-divider'а — это шум, не структура. Иконки Диагностика и Ошибки **одинаковые** (circle + !). 17 пунктов на flat-list — за пределами Miller's 7±2.

### Topbar density
- 11 контролов без primary/secondary иерархии
- 9 пунктов в `Файлы` dropdown (импорт/экспорт/очистка вперемешку)
- Demo-mode buttons (Демо / Свои данные) занимают слот в визуальной иерархии и сбивают новичка

### Top-10 IA issues
1. 4 секции про аналитику без явной разницы (Дашборд/Сводная/Метрики/Инсайты)
2. Диагностика и Ошибки — одна иконка, разные секции
3. «Подложка» / «Actions» — непрозрачные имена
4. AI CEO визуально в группе «интеграции», логически — топ-аналитика
5. 5 представлений одной таблицы (Реестр/Гант/Канбан/Таймлайн/Подложка) разбросаны без подгруппы «Планирование»
6. 11 контролов в topbar без иерархии
7. Файлы dropdown: 9 пунктов вперемешку
8. Интеграции: 7+ модулей без оглавления внутри секции
9. Sigma как отдельный tab вместо sub-mode Jira
10. Ошибки внизу sidebar, badge-driven — недискаверим

---

## C. Spine-pill consistency violations

| Правило | Нарушено |
|---|---|
| **No emoji в data-views** | ≥ 25 мест: timeline (🚧✅📂), history (📊🤖📭), dashboard (⚠️), employees (⚠️), metrics (🚀💡), gantt, kanban (🟢🟡⚠️✅), integrations (🤖), aiRenderer (🤖🔴🟡✅🔵), errorsView (✨), teamScanner2Renderer (5 в одном меню) |
| **No gradient** | 30+ мест: welcome-title (text-clip), .ai-enhanced-badge L5956, summary-hero L2679, metrics-row-fill L2810/2963, gantt-team-header L4916, ai-empty L7029, kanban progress L7220, ceo-hero L6457 |
| **3px stripe-left для active** | `.toggle-chip` filled bg, `.nav-item.active` filled+stripe одновременно (mixed), `.kanban-col-header-badge` filled accent |
| **Tabular numerals** | Не везде: `.summary-hero-kpi`, `.kanban-col-header-badge`, `.gantt-lock-badge`, timeline-meta, progress-counts |
| **CAPS sub-headers `9-10/.6-.7`** | 9 разных letter-spacing (.05/.15/.2/.3/.4/.5/.6/.7) |
| **border-radius из шкалы** | `border-radius: 20px` на chips × 8 мест, `5px` × 11, `7px` × 3 |

---

## D. Component-level critique

1. **Buttons** — 3 параллельных primary (`.btn-primary` / `.ai-btn-primary` / `.ceo-btn-primary`); `.btn-reset-filters` использует `dashed` border (anti-pattern); нет токенизированного `Button`
2. **KPI cards** — hover-lift на всех 12 = false affordance; перекрашенный border уже несёт семантику, lift избыточен
3. **Tables** — старый `.data-table th` style и Spine sticky-thead конкурируют; нет единого `<DataTable>` (Реестр/Дашборд/Employees все inline-render)
4. **Modals** — universal `.modal-box` (32px/420px) против inline-styled gantt-модалок (`<div style="padding:16px 20px">`); несовместимая внутренняя структура
5. **Toasts** — single `#toast` div, нет queue; second toast overwrites first
6. **Badges/chips** — 7+ параллельных систем (`.chip-red`, `.insight-badge`, `.risk-badge`, `.ts2-*-badge`, `.al-cat-badge`, `.bd-section-badge`, `.kanban-int-badge`)
7. **Forms** — 3 формы инпута с разными heights (`.filter-input` 32px / `.cell-input` inline / settings raw); нет `Field` с label+hint+error

---

## E. Empty / Loading / Error states

**Empty:** Inconsistent — где-то emoji-icon (`📊 📭 👥 🔍 💡`), где-то текст-only. Только Employees + Dashboard дают actionable hint. Большинство — dead-end «Нет данных»

**Loading:** 4 параллельные системы:
1. `.funny-loader` с phrases (`🤖 Дёргаем Jira за галстук`)
2. `.pp-loader` (Pulse only)
3. `.ep-loader` (EmployeePerformance only)
4. Skeleton (Реестр)
Нет единого `<Skeleton>` / `<Spinner>` component. Phrases mix серьёзных и шуточных.

**Error:** errorsView — журнал есть, но в data-views error-state часто = пустой div + console.error. Нет recovery-CTA.

---

## F. UX user flows audit

### Flow 1: «Утренняя проверка» (5 мин)
- **Time-to-decision:** 6-8 мин (нужно посетить 3-4 секции)
- **Frustration:** counts без объяснения «почему 79 в Стопе»; нет «что изменилось со вчера»
- **Mental model gap:** «Стоп» = «не работает», на самом деле часто = identity-gap → ошибочное обвинение в 1:1

### Flow 2: «Планирование квартала»
- **Time-to-decision:** 25-40 мин
- **Frustration:** Канбан/Гант/Timeline/Подложка одни данные — учиться какой вид для какой задачи
- **Mental model gap:** «эпик» в Реестре ≠ «эпик» в Sigma ≠ «N задач у эпика» в Ганте (типы работ BE/FE/QA)

### Flow 3: «Подготовка к ретро»
- **Time-to-decision:** 15-20 мин с плохим качеством выводов
- **Frustration:** «Овертайм» — и релиз-окно, и статус — двойное значение
- **Mental model gap:** нет single-screen «релиз 1.21: closed N, moved to 1.22 M, dropped K, slipped into Овертайм L»

### Top-15 UX friction points

| # | Section | Friction | Severity |
|---|---|---|---|
| 1 | IA / Sidebar | 17 равновеликих пунктов, нет группировки | 🟠 High |
| 2 | Dashboard / Сводная / Метрики / Инсайты | Дублирующая цель | 🟠 High |
| 3 | Сканнер «Стоп» | Читается как «не работает», часто identity-gap | 🟠 High |
| 4 | Терминология | эпик/задача/row/эпик-цель/тип работы — каша | 🟠 High |
| 5 | Релиз 1.21 / Овертайм / Бэклог | Слово «релиз» перегружено | 🟡 Med |
| 6 | Scope «Требует подтверждения» | Не воспринимается как 3-state | 🟡 Med |
| 7 | Bulk Actions vs Реестр | Разорванный workflow | 🟠 High |
| 8 | Section animation 240ms | Раздражает при частой навигации | 🟡 Med |
| 9 | AI vs AI CEO | Названия не различимы | 🟡 Med |
| 10 | Sigma vs Delta Jira | Один visual в Интеграциях | 🟡 Med |
| 11 | Импорт XLSX без draft | Нельзя примерить расстановку | 🟠 High |
| 12 | Lock плана без warning | Случайный lock | 🟡 Med |
| 13 | **No global search / Cmd+K** | Power user не имеет быстрой навигации | 🟠 High |
| 14 | Numeric metrics без baseline / Δ | Не видно динамики | 🟠 High |
| 15 | Tour V14 24 шага | Stale, длинный, никто не доходит | 🟡 Med |

---

## G. Brand expression

**Читается:** "internal-tech / serious / engineering-first" с modern-fintech accent (indigo `#4f46e5`). Не corporate-Сбер (нет green, нет логотипа), не playful. **Соответствие тимлиду** — точное попадание.

**Палитра:** consistent на уровне tokens (`--accent`, `--success`, ...), но **fragmentation** — 1452 hex-литерала в `styles.css`, параллельные `--accent-strong / -dark / -muted / -light` без scale.

**Tone of voice:** инженерный, ироничный («Дёргаем Jira за галстук»). Соответствует internal tool, но смешан с сухим UI-копирайтом — нет style-guide.

**Typography:** `Inter` external — corporate compliance risk (supply-chain immunity). Mono-tabular numerals canon есть, но не везде. `font-feature-settings: tnum, lnum` should be in `:root`.

**Brand top-10:**
1. Emoji в production data-views (25+)
2. Gradients не вычищены (18)
3. 1452 hex literals — нет stylelint
4. Token sprawl у accent (без scale)
5. `chip-red/green/yellow` — color-named рядом с semantic
6. Inter внешне → compliance risk
7. Contrast не аудирован (`--text-3` <4.5:1)
8. Tabular nums не везде
9. Radii bypass tokens (20px × 13)
10. Tone-of-voice не зафиксирован

---

## H. Interaction issues — top-12

1. Нативные `confirm()` для destructive actions (UX-катастрофа)
2. Все ячейки Реестра — постоянно editable → DOM-шум, accidental edits
3. Нет Shift+click range-select в таблице
4. Toast без «Undo» CTA, хотя HistoryManager есть
5. DnD не touch-friendly (HTML5 API only)
6. Отсутствуют active-filter chips над таблицей
7. Multiselect dropdown без search/select-all/keyboard-arrows
8. Нет inline validation (только Toast/ErrorsLog)
9. Resize-handle visible только при hover; нет double-click auto-fit
10. Sort affordance слабая: пустой `<span class="sort-icon">`, нет 3-rd state
11. Нет focus-ring/tabindex на row → keyboard nav сломан
12. Date inputs нативные → cross-OS inconsistency, нет relative-quick-picks, нет range-picker

---

## I. Идеи развития (25+)

### Quick wins (1-2 спринта)
1. **Pluralize-helper** + рефактор ~30 мест
2. **Focus-trap** mini-lib для всех 6+ модалок
3. **Skip-link** + `<main>` wrapper + `aria-label` на ✕
4. **Theme persistence** в localStorage
5. **`@supports (color-mix)` fallback**
6. **Toast queue** + Undo CTA
7. **Filter chip-bar** над Registry
8. **Replace native `confirm()`** custom dialog
9. **Tabular nums в `:root`**
10. **Active-state stripe-left consistency** (3 → 2 уровня stripe)

### Design system
11. **Design tokens v2** (Style Dictionary build)
12. **Component primitives** (Button/Field/Modal/Toast/Badge/KPI/DataTable/EmptyState/Skeleton)
13. **Iconography sprite** `/icons/icons.svg` + `<Icon name="...">`
14. **Spine linter** (eslint-plugin запрет emoji/gradient/inline-style)
15. **Storybook-light** vanilla `/sandbox.html` с матрицей состояний
16. **Motion principles doc** + `prefers-reduced-motion` first-class
17. **Color scale refactor** (`--accent-50..900`)
18. **Self-hosted Inter** + tabular-nums by default

### IA / UX
19. **Command palette (Cmd+K)** — fuzzy search по секциям/фильтрам/эпикам/людям/действиям
20. **Personalized "Главная"** — single-screen 5-min flow
21. **Sidebar reorg** в 4 кластера: Главная / Планирование / Аналитика / Интеллект / Системное
22. **Topbar declutter** — 3 уровня (primary/secondary в `⋯` overflow)
23. **Onboarding revamp** — 24 шагов → progressive 3-tier (2 min essentials / 5 min daily / deep dives)
24. **«Why this number?» pop-overs** на любых метриках
25. **Draft-mode для квартального планирования** — sandboxed snapshot, apply/discard
26. **Workspace-aware bulk actions** в контекст-меню Реестра

### Interaction
27. **Edit-on-focus** вместо edit-by-default в Реестре
28. **Pointer-events DnD** rewrite (touch+pen support)
29. **Quick-actions cmd-palette** — fuzzy search над action registry
30. **Inline validation** (red border + aria-invalid + message)
31. **Empty/Loading/Error library** — единый `EmptyState({title, hint, action})`

---

**Файлы high-priority:**
- `styles.css` (520KB) — token enforcement, color-mix fallback, hex literals, gradients
- `index.html` (1164 LOC) — модалки без focus-trap, inline styles
- `views/timeline.js, history.js, kanban.js, dashboard.js, employees.js, metrics.js, integrationsView.js` — emoji violations
- `integrations/teamScanner2Renderer.js` (3626 LOC) — наибольшая концентрация Spine-violations
- `components/multiselect.js, tagInput.js` — ARIA gaps
- `app.js:1656` (animateSection), `app.js:127` (showToast) — UX issues
