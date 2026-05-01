# 01. Текущее состояние

> **Что это**: фактический срез того, что есть в продукте сейчас. Без оценок — просто инвентарь.

## 1. Стек и ограничения дизайна

| Слой | Что |
|---|---|
| Frontend | **Vanilla JS, нативные ES-модули, без бандлера** |
| Рендеринг | Императивный DOM через `innerHTML` с обязательным `Utils.escapeHtml` |
| Стили | **Один файл `styles.css`** (≈343 КБ, 8 939 строк), без препроцессора, без CSS-modules |
| Дизайн-токены | Только CSS Custom Properties в `:root` и `body.theme-dark` |
| Шрифт | `'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif` (системный fallback, без webfont-загрузки) |
| Иконки | Эмодзи (🔧 📊 ⚡ 📋 🔍 💡 🗺 💬 …) — никаких icon-фонтов / SVG-спрайтов |
| Темы | Светлая (default) + тёмная (`body.theme-dark` swap CSS-vars) |

**Важное ограничение**: «no new deps» — корпоративная политика. Любой webfont, любая icon-библиотека, любой framework требует security-review. Это влияет на выбор: webfont реален, npm-пакет — практически нет.

---

## 2. Дизайн-токены (`styles.css:4-56`)

### Light (`:root`)

| Token | Value | Назначение |
|---|---|---|
| `--bg` | `#f0f2f7` | Фон страницы (cool grey) |
| `--card` | `#ffffff` | Карточки, модалки, таблицы |
| `--surface` | `#ffffff` | Алиас (для inputs/btn-outline) |
| `--surface-header` | `#f9fafb` | Заголовки таблиц, sticky thead |
| `--surface-input` | `#ffffff` | Фон inputs, btn-outline |
| `--bg-secondary` | `#f3f4f6` | Бейджи-счётчики, info-banner |
| `--row-hover` | `#f3f4f6` | Hover-состояние строк/карточек |
| `--border` | `#e4e7ec` | Стандартный border (тонкий) |
| `--border-light` | `#f3f4f6` | Очень тонкий border (внутри секций) |
| `--border-strong` | `#d1d5db` | Усиленный border (input focus / selected) |
| `--accent` | **`#4f46e5`** (indigo-600) | Главный акцент |
| `--accent-dark` | `#3730a3` | Hover на акцент |
| `--accent-strong` | `#4338ca` | Ссылки visited / press |
| `--accent-light` | `#eef2ff` | Фон кнопок-акцентов, бейджей |
| `--accent-muted` | `#c7d2fe` | Disabled accent |
| `--success` | `#059669` (emerald-600) | OK / "Done" / Story badge |
| `--success-light` | `#d1fae5` | Bg для success-pills |
| `--warning` | `#d97706` (amber-600) | Внимание / стейл / тим-нагрузка |
| `--danger` | `#dc2626` (red-600) | Ошибки / блокеры / risk-flags |
| `--info` | `#0284c7` (sky-600) | Info-баннеры |
| `--done-bg` / `--done-text` | `#f0fdf4` / `#166534` | Состояние "выполнено" в строке |
| `--text-1..4` | `#111827 / #374151 / #6b7280 / #9ca3af` | 4-уровневая текст-иерархия (Tailwind gray) |

### Радиусы

| Token | Value | Где |
|---|---|---|
| `--radius-xs` | `4px` | Мелкие чипы, бейджи, ms-tag |
| `--radius-sm` | `8px` | Кнопки, inputs, мелкие cards |
| `--radius` | `12px` | Default для cards/modals |
| `--radius-lg` | `16px` | Большие модалки, hero-blocks |

### Тени

| Token | Value | Уровень |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,.05)` | Очень тонкая (cards в потоке) |
| `--shadow-sm` | `0 1px 4px rgba(0,0,0,.08)` | Дефолт topbar/cards |
| `--shadow` | `0 4px 16px rgba(0,0,0,.08)` | Hover на cards |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,.12)` | Модалки, dropdowns |

### Анимация

| Token | Value | Где |
|---|---|---|
| `--motion-fast` | `140ms` | Hover, simple state-change |
| `--motion-mid` | `240ms` | Section enter, modal box |
| `--motion-slow` | `420ms` | Section transitions, KPI grow |
| `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | Default ease |
| `--ease-emphasis` | `cubic-bezier(.22,.9,.28,1)` | Modal enter/exit |
| `scroll-behavior` | `smooth` (на `html`) | Глобальный плавный скролл |

### Прочее

- `--sidebar-w: 200px` / `--sidebar-w-collapsed: 52px`
- `--topbar-h: 56px`
- `--row-h: 36px` (плотная регистровая строка)
- `--font-mono: ui-monospace, monospace` — для Jira-ключей и кода

### Темная тема

Полная замена через `body.theme-dark` (см. `styles.css:2010-2173`). База:
- `--bg: #0b1020` (deep navy)
- `--card: #121a2f`
- `--accent: #818cf8` (indigo-300, светлее, чем в light)
- `--text-1..4`: `#e5e7eb / #cbd5e1 / #94a3b8 / #64748b`

---

## 3. Типографика — что используется

Иерархия размеров (по частоте использования из CSS, top-10):

| px | Использований | Где |
|---|---|---|
| **11px** | 179 | UPPERCASE-метки, бейджи, summary chips |
| **12px** | 157 | Body text в таблицах, registry cells |
| **13px** | 106 | Кнопки, summary блоки, integrations |
| **10px** | 63 | Микро-тексты, sub-bg labels |
| 12.5px | 41 | Headers вторичные |
| 11.5px | 32 | Bd labels |
| 14px | 31 | Section titles, dashboard hero KPIs |
| 18px | 22 | Главные KPI-цифры |
| 16px | 22 | Section H2 |

**Веса**: `700` (главный, 195 правил), `600` (107), `500` (26), `800` (17), `400` (6), `900` (1).

**Наблюдение**: преобладает узкий 10–13px диапазон с сильными весами 600–700 → плотная информационная сетка, типичная для админ-панелей. Заголовков выше 18px практически нет — кроме hero KPI-цифр.

---

## 4. Информационная архитектура

**Аудитория** (по коду + текстам):
- Релиз-менеджеры / руководители разработки в Сбере (СБОФ — направление развития CRM-платформы для МСБ)
- Бизнес-аналитики
- Тимлиды (читают «Мои задачи», смотрят активность)

**Top-bar (post-V13)** — в одну строку: лого «СБОФ» + «Планировщик» + бейдж-счётчик строк + панель ассистентов/настроек справа.

**Sidebar (16 секций)**:
1. Дашборд (KPI + риски + прогресс по релизам)
2. Реестр (главная таблица задач)
3. Гант (детальный по задачам / стрелки)
4. Канбан
5. Timeline
6. Подложка (per-team rows)
7. Сотрудники (employees + загрузка)
8. Сводка (summary view)
9. Метрики
10. Инсайты
11. Диагностика (debug)
12. Действия (action catalogue)
13. AI (LLM Assistant)
14. Интеграции (Jira / BB / CF / Sigma)
15. AI CEO (исполнительный дашборд)
16. История (audit log)

**Контент-таб (пример Дашборд)**:
- View-legend (цветные точки-легенда)
- KPI-grid (4 карточки)
- Progress-grid (по релизам)
- Risks-panel (компактный список)
- Blocking-detail-card
- Release-breakdown (4 колонки)
- Teams-summary-wrap (таблица)
- Dashboard-tables-grid (no-release / needs-confirm)

---

## 5. Ключевые экраны (текстовые описания)

### 5.1 Дашборд
Сверху section-header «Сводный дашборд» (h2, 16-18px, weight 700).
Под ним — горизонтальная цветная легенда из 4-5 точек («1.20» indigo, «1.21» emerald, «1.22» amber, «OT» red, «Бэклог» grey).
Дальше KPI-grid в 4 колонки: каждая карточка `--card` background, `--shadow-xs`, `--radius`, padding 14-16px, цифра 18px/700, сверху 10-11px label `--text-3` UPPERCASE.
Ниже progress-grid: per-релиз карточки с bar-chart progress (CSS `width: var(--p)%`).
Risks-panel — компактный список emoji-prefixed строк.
Все блоки — однотонные на `--bg` (#f0f2f7), без иллюстраций, без градиентов, без декоративных элементов.

### 5.2 Реестр
Большая прокручиваемая таблица. Sticky-thead с `--surface-header` (#f9fafb). Строки чередуются hover-effect-only (без zebra). Первая колонка `#`-номер, дальше — настраиваемый набор столбцов (имя/команда/тип/релизы/сроки). Inline-edit по клику, validation-states cells (red/green/yellow тонкими ring-границами).
Шапка с фильтрами и presets. Внизу справа — total/done counters.
Плотная сетка, в которой 12-13px шрифт ≤ row-height 36px.

### 5.3 Гант (детальный по задачам)
Header с грид-сеткой 5 колонок: Бэклог / 1.20 / 1.21 / 1.22 / OT.
Каждая ячейка — для одной задачи: содержит wt-pills (work-type, разноцветные капсулы 9-10px), «+»-кнопку для добавления типа, drag-handles.
Разделители: `--border-light` 1px solid.
Цвета окон: backlog `var(--bg-secondary)`, r120 `#1b2348`-подобный indigo-tint, r121 emerald-tint, r122 amber-tint, ot rose-tint.
SVG-стрелки переноса (postpone-arrows): красная пунктирная dashed-line (`#dc2626`), толщина 2.4, dash 6,4.

### 5.4 Канбан
Колонки `--card` bg, `--shadow-xs`, padding 12-14px. Заголовок колонки — `var(--surface-header)` (бледно-серый), цифра-бейдж `--accent-light` фоном.
Карточки задач — `--card` background, `--border-light`, hover лёгкий `transform: translateY(-1px)` + shadow upgrade.

### 5.5 Сотрудники
Таблица employees-table с фотками-аватарами (заглушки emoji 👤). В столбцах: ФИО, команда, нагрузка-бар, действия. Хедер — `--surface-header`, hover на строки `--row-hover`.

### 5.6 LLM-ассистент (slide-out панель справа)
Floating action button (FAB) внизу справа — круглая 56×56, accent-gradient, с pulse-анимацией (`@keyframes fab-pulse` 3s).
Открытая панель — `--card` background, `--shadow-lg`, занимает ~420×80vh справа. Сверху toolbar: иконка-минимизация, кнопка-настройки (⚙), закрыть (✕).
Сообщения: user — справа, accent-light bubble; assistant — слева, card+border. Markdown-рендер с syntax-highlight.
Снизу textarea + кнопка отправки + dropdown категорий промптов.

### 5.7 Tech Info модалка
Открывается по кнопке «🔧» в Integrations или topbar-debug.
Overlay `rgba(0,0,0,.45)` + центрированная карточка 80%×86vh, `--card` bg, `--radius` 10px, `--shadow-lg`.
Шапка: search-input (на всю ширину) + кнопки «⤓ JSON» / «↻ Обновить» / «✕».
Tabs: Jira / Bitbucket / Confluence — обычные text-link active-state с border-bottom.
Контент: collapsible `<details>` секции с count-бейджами справа от заголовка. Body — list-items с monospace-key + text + sub + copy-кнопкой.

### 5.8 Black Dashboard
Header «Чёрный дашборд» с goals-summary вверху (linkedCount/totalGoals/coveragePct).
Per-team grid: команда + total/linked-count + список issues с чипами-статусами.

---

## 6. Глобальные паттерны и характерные визуальные решения

| Паттерн | Реализация |
|---|---|
| **Pills/chips для тегов** | `inline-flex`, padding `2px 7-8px`, `border-radius: 999px`, font 10-11px/700, фон через `color-mix(in srgb, var(--accent) 10%, transparent)` |
| **Status-cells в таблицах** | Тонкая ring-обводка (`box-shadow: inset 3px 0 0 #93a2ff`) для selected-row |
| **KPI cards** | Цифра 18px/700 → label 10-11px UPPERCASE letter-spacing .3-.4px |
| **Section enter** | `@keyframes section-enter` — opacity 0→1 + translateY(6px→0), 240ms |
| **Hover on row/card** | `background: var(--row-hover)` + иногда `transform: translateY(-1px)` |
| **FAB pulse** | `box-shadow: 0 0 0 0 → 0 0 0 6px transparent`, 3s infinite |
| **Toast** | `@keyframes toast-in/out` с `translateY(12px → 0)`, position fixed bottom |
| **Modal enter** | overlay opacity + box `translateY(10px) scale(.98) → 0/1`, 240-280ms |

---

## 7. Что бросается в глаза, если открыть впервые

1. Главный акцент — **indigo `#4f46e5`** (Tailwind/Material-default-tier), используется и для брендового логотипа, и для accent-фонов, и для links.
2. Все карточки белые на cool-grey фоне → классический «admin-dashboard look».
3. Текст преимущественно 11–13px, плотная сетка → информационно-плотный, но без воздуха.
4. Никаких иллюстраций, никаких декоративных градиентов, никаких custom-illustrations. Только эмодзи как иконки.
5. Анимации **есть** (toast, modal, section enter, FAB pulse, gantt cell-receive glow), но они короткие и осторожные. UI чувствуется тихим.
6. Тёмная тема — **глубокий navy** (`#0b1020`), а не нейтральный slate. Это выделяет продукт, но при светлой/тёмной паре они выглядят как два разных приложения.
7. Шрифт — Inter (если установлен) или системный sans-serif. Без характера, утилитарный.

---

## 8. Что **уже хорошо** (зафиксировать, чтобы не сломать)

- Внятная **дизайн-токенная** база — после V13 audit #27 все цвета через `var()`, тема свапается в одной точке.
- Чёткая **4-уровневая текст-иерархия** через `--text-1..4`.
- Корректные **status-цвета** (emerald для done, amber для warn, red для danger) — semantically read-able.
- **Микроанимации существуют** (FAB pulse, gantt arrow flow, KPI fillGrow, section enter) — есть фундамент для усиления.
- Тёмная тема **полноценная**, не «стилизованная».
- Хорошие **shadow-tiers** (xs/sm/normal/lg).

---

## 9. Технические ограничения для редизайна

1. ❌ **Нельзя**: webfont-загрузка с CDN, npm-зависимости (svg-icon-libs), любые билд-инструменты → препроцессоры.
2. ✅ **Можно**: вендорить `.woff2` локально в `libs/` (vendored, как `xlsx.full.min.js`), писать SVG inline, всё в одном `styles.css`, добавлять CSS-vars и keyframes сколько угодно.
3. ⚠️ **Осторожно**: 343 КБ CSS уже на 93% бюджета (`scripts/perfBudget.js: 360 КБ cap`). Радикальное расширение токенов = придётся параллельно резать другое.
4. ⚠️ **innerHTML-подход**: всё рендерится строками. Сложные SVG-иллюстрации внутри карточек — реальны, но требуют `Utils.escapeHtml` для всех динамических вставок (custom ESLint rule это форсит).
