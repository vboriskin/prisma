---
role: UX Designer
author: Мария Левина
date: 2026-05-03
status: draft
depends_on: 01-art-direction.md, 02-logo-and-favicon.md
---

# 03. Шапка и навигация «Призма»

> Анна (§5.2): «группируй вкладки по лучам caps-разделителями, активная — stripe-left 3px цвета родительского луча, шапка — eyebrow + хейрлайн, без цветных хедеров». Дмитрий — живой mark с динамическим сегментом. Это IA-спецификация под их рамку. Фронтенд собирает без додумывания.

---

## 1. Mapping 17 разделов на 6 лучей

В реальном `app/appSettings.js:34-45` зарегистрировано **17** ключей, не 14: вдобавок к перечисленным в брифе есть `diagnostics`, `actions`, `errors`. Раскладываю все 17 — нельзя оставить разделы без луча.

| Раздел | Луч | Обоснование |
|---|---|---|
| `registry`      | Планирование  | квартальные задачи — структура «что делать» |
| `gantt`         | Планирование  | Гант-cascade — структурный «когда делать» |
| `kanban`        | Планирование  | WIP-вид того же реестра, не самостоятельная грань |
| `podlozhka`     | Планирование  | подложка планерок — артефакт планирования |
| `timeline`      | Планирование  | хронология эпиков, тот же структурный взгляд |
| `dashboard`     | Контроль      | главный «вход» оператора, состояние сейчас |
| `employees`     | Контроль      | FTE-нагрузка, anomaly — операционный мониторинг |
| `summary`       | Контроль      | сводная по релизам в моменте |
| `metrics`       | Контроль      | slope, Z-score, EMA — операционный пульс |
| `insights`      | Контроль      | bottlenecks/аномалии текущего квартала |
| `ai`            | Предсказание  | health, forecast, «если ничего не менять» |
| `ai-ceo`        | Коммуникация  | отчёт CEO = narrative наружу |
| `actions`       | Коммуникация  | Action Layer = задачи/нарративы для исполнителей |
| `integrations`  | Связи         | Jira/Bitbucket/Confluence — cross-team зависимости |
| `diagnostics`   | Связи         | scanner-команды, целостность интеграций |
| `errors`        | Связи         | журнал ошибок интеграций |
| `history`       | Ретроспектива | мульти-day snapshots, прошедший квартал |

Итог: 5/5/1/2/3/1.

**Видны ли пустые лучи?** Пустых нет — у каждого из 6 минимум один пункт. Одиночные лучи (Предсказание, Ретроспектива) caps-разделитель получают: каркас «6 граней квартала» должен читаться с первого открытия. **Placeholder'ы «coming soon» запрещаю** — банковский B2B, не consumer-app. Когда Forecasting/Retro-Loops станут отдельными экранами — добавим вкладку. Anticipation держится через caps-нарратив, confusion исключается отсутствием кликабельных тупиков.

---

## 2. Шапка приложения

### 2.1. Что меняется

**Уходит** (из `index.html:325-433`, `styles.css:70-110`):

- `topbar-logo` pill (фон `--accent`, `border-radius`, padding) — Анна §6 запрет цветных плашек.
- Текст «СБОФ» внутри pill → wordmark «Призма» Plus Jakarta 600.
- `.topbar-title` «Планировщик» — заголовок раздела живёт в hero-блоке секции, не в шапке.
- `box-shadow: var(--shadow-sm)` под топбаром → плоская хейрлайн.
- `backdrop-filter: blur(12px)` → плотный `--surface-0` (editorial-чистота).
- Standalone `#btn-onboarding` (?-help) и `#btn-theme-toggle` → внутрь нового `#user-menu` дропдауна.

**Остаётся:** `#topbar-brand` (как кнопка возврата на Дашборд), `#btn-toggle-filters` + counter, `#btn-save`, `#files-dropdown`, `#btn-sim-mode`, `#btn-app-settings`, высота 56px.

**Приходит:** `.topbar-ray-indicator` (точка + caps-eyebrow текущего луча), inline-SVG `prisma-mark` с динамическим сегментом, `.prisma-wordmark`, `#topbar-search` (Cmd-K), `#user-menu` дропдаун, `.topbar-hairline` 1px цвета луча.

### 2.2. DOM-схема

```
<header id="topbar">
  <div class="topbar-left">
    <a class="topbar-brand" href="#dashboard">
      <svg class="prisma-mark" viewBox="0 0 32 32">
        <rect data-seg="planning"/> ... <rect data-seg="links"/>  <!-- 6 шт -->
      </svg>
      <span class="prisma-wordmark">Призма</span>
    </a>
  </div>

  <div class="topbar-ray-indicator" aria-live="polite">
    <span class="ray-dot"></span>
    <span class="ray-eyebrow">ЛУЧ КОНТРОЛЯ</span>
  </div>

  <div class="topbar-actions">
    <button id="topbar-search">⌘K</button>
    <button id="btn-toggle-filters">Фильтры <span class="topbar-filter-count">3</span></button>
    <button id="btn-save"/> <div id="files-dropdown"/> <button id="btn-sim-mode"/>
    <button id="btn-app-settings"/>
    <div id="user-menu"><button class="topbar-user-trigger">МЛ ▾</button>...</div>
  </div>
</header>
<div class="topbar-hairline"/>   <!-- 1px цвета current ray -->
```

Активный луч управляется одним атрибутом: `document.documentElement.dataset.activeRay = 'control'`. Через каскад CSS-селекторов (`[data-active-ray="control"] .prisma-mark [data-seg="control"] { fill: var(--ray-control); }`) подсвечивается сегмент mark, точка индикатора и хейрлайн.

### 2.3. Слева: бренд

Состав — **mark 24×24 + wordmark «Призма» 16px Plus Jakarta 600**. Без tagline, без «Планировщик», без счётчика. Mark живой (§A4 Дмитрия): активный сегмент = текущий луч.

- Click → Дашборд (default landing), текущая логика `#topbar-brand` сохраняется.
- `:hover` — wordmark `--text-1` → `--ray-{current}`, mark неизменен.
- `:focus-visible` — 2px outline `--accent-default`.

### 2.4. Центр: индикатор луча

**Главное UX-новшество шапки.** Hero-eyebrow Анны при скролле длинной таблицы уезжает за viewport. Дублируем в шапке в облегчённом виде — всегда видно.

- **Точка `.ray-dot`** 6px, `--ray-{current}` — **единственное цветовое пятно в шапке**.
- **Caps `.ray-eyebrow`** рядом, gap 8px. Plus Jakarta 600, 10px, ls 0.12em, цвет `--text-2` (НЕ цвет луча — Анна §2.4: cross-section нейтральные). Текст: `ЛУЧ ПЛАНИРОВАНИЯ`, `ЛУЧ КОНТРОЛЯ` и т.д.
- `min-width: 160px` (по самому длинному «ЛУЧ ПРЕДСКАЗАНИЯ») — без jitter при переключении.
- Позиция между `.topbar-left` и `.topbar-actions`, flex распределяет три зоны.
- `aria-live="polite"` для скринридера.

Не делаю: иконку луча, фон, обводку. Точка + eyebrow достаточны.

### 2.5. Справа: actions

Порядок справа налево:

1. **`#topbar-search`** — иконка, Cmd-K, поиск **глобальный** (задачи + эпики + сотрудники + разделы). Контекстный фильтр раздела остаётся в `#global-filters-bar` `#filter-search` — это разные системы: глобальный про jump-to, локальный про фильтрацию.
2. **`#btn-toggle-filters` + counter** — остаётся в шапке. Фильтры нужны почти на каждом разделе, дублировать в 8 toolbar'ов хуже.
3-6. **`#btn-save`, `#files-dropdown`, `#btn-sim-mode`, `#btn-app-settings`** — все остаются (глобальные команды/модификаторы).
7. **`#user-menu`** (новый): имя + роль (identity-store, V17.2 I1c; иначе «Гость»), тема light/dark/system (унесена из `btn-theme-toggle`), обучение (бывший `btn-onboarding`), шорткаты (см. §4), выйти (`disabled` пока auth нет). Триггер — инициалы 28×28, фон `--bg-secondary`, без фотографии (банковский compliance).

Колокольчик-уведомлений не добавляю — без push-нотификаций пока visual debt. Когда Forecasting-alerts появятся (§6.3) — добавим.

### 2.6. Поведение шапки

- **Sticky/fixed** — остаётся. Hide-on-scroll и shrink — отвергаю: data-tool требует стабильной навигации.
- **Высота 56px — оставляю.** 64px тестировала — читается чуть лучше, но Реестр теряет 1 строку viewport на 14" ноутбуке. 56 побеждает.
- **Mobile (< 720px)** — не делаю сейчас, закладываю media-query: индикатор сворачивается до **точки** без caps, wordmark убирается, остаётся mark, actions сворачиваются в overflow кроме Filters.

### 2.7. Анти-паттерны

1. Никакого `background: var(--ray-{current})` на шапку — Анна §2.2.
2. Никакого gradient'а или wash'а в actions-зоне.
3. Никакого «search input всегда раскрытый» — съедает 240px горизонтали впустую. Иконка + Cmd-K — банковский паттерн (Linear, Pitch).

---

## 3. Sidebar / навигация

### 3.1. Группировка под лучи

```
ЛУЧ ПЛАНИРОВАНИЯ  ─── --ray-planning (Indigo Ink)
  · Реестр · Гант · Канбан · Подложка · Таймлайн

ЛУЧ КОНТРОЛЯ  ─────── --ray-control (Amber Forge)
  · Дашборд (default landing) · Сотрудники · Сводная · Метрики · Инсайты

ЛУЧ ПРЕДСКАЗАНИЯ  ─── --ray-foresight (Deep Iris)
  · AI Анализ

ЛУЧ КОММУНИКАЦИИ  ─── --ray-comms (Spruce)
  · AI CEO · Actions

ЛУЧ СВЯЗЕЙ  ───────── --ray-links (Brass)
  · Интеграции · Диагностика · Ошибки

ЛУЧ РЕТРОСПЕКТИВЫ  ── --ray-retro (Slate)
  · История
```

Порядок лучей — по operational rhythm brand-doc'а: «делаю → вижу → предсказываю → рассказываю → связываю → учусь». Старт с Планирования — исторический корень (СБОФ-планировщик) и самый объёмный луч (5/17); большой первый блок задаёт объём ожиданий.

### 3.2. Анатомия nav-item

**Идентификация луча:**
- **3px stripe-left** на active — текущая `.nav-item::after` механика (`styles.css:200-213`) сохраняется; меняем `var(--accent)` → `var(--ray-{group})` через каскад от `.nav-group[data-ray]`.
- **Иконка** active — `--ray-{group}`; inactive — `--text-3` (явный нейтрал вместо текущего `opacity: 0.7`).
- **Лейбл active** — `--text-1`, НЕ цвет луча. Цвет несут stripe + иконка, текст — читаемость. Критично при близких лучах (Slate/Brass на light).
- **Фон active** — `--bg-secondary` (тёплый off-white), НЕ `--accent-light` (текущий `styles.css:199`). Wash'и запрещены (Анна §6.3).

**Hover:** `var(--border-light)`, иконка `--text-2`, без перехода в цвет луча. Hover = «могу нажать», active = «я здесь».

**Размеры:** padding 9px 10px (текущий ок), высота ~34px, иконка 16×16, gap 10px. Лейбл Plus Jakarta 500 13px (active 600). Stripe-left absolute не толкает текст.

**Иконку оставляем** (Анна §5.2 подтверждает; в collapsed — единственное, что осталось).

**Badge** (`.nav-badge-err`): `font-feature-settings: 'tnum'`, цвет `--state-error`, фон 10% alpha. Это **state, не ray** — ошибки красные везде (Анна §3).

### 3.3. Collapsed sidebar (52px)

- Иконки по центру.
- **Caps-разделители скрываются** (текст нечитаем в 52px).
- Между группами — **хейрлайн-нить 1px ширины 24px**, цвета луча, центрирована. Compact-version caps: цвет несёт информацию.
- Active-stripe-left сохраняется.
- Hover на иконке — tooltip `«КОНТРОЛЬ · Дашборд»` (caps-prefix + раздел) — пользователь не теряет группировку.
- Цветные точки/буквы вместо иконок отвергаю: stripe + хейрлайн + tooltip — перебор.

### 3.4. Caps-разделители — pixel-spec

```
[16px space-above]
  ПЛАНИРОВАНИЕ                 ●     <- caps text (left) + 6px dot (right)
  ────────────────────────────       <- 1px hairline цвета луча dim, full-width
[8px space-below]
  □ Реестр
```

- `.nav-group-title` контейнер: `padding: 0 10px`, flex space-between.
- Caps-текст: Plus Jakarta 600, 10px, letter-spacing 0.12em, uppercase, color `--text-3` (НЕ цвет луча — это разделитель, не сам луч).
- Точка-маркер: 6×6 circle, `background: var(--ray-{group})`, margin-left auto. Единственный цветовой акцент в caps-row.
- Hairline: 1px, `var(--ray-{group})` с alpha 0.4 (приглушённый, не конкурирует с active stripe). Margin-top 6px, ширина = sidebar минус 8px горизонтального padding.
- Spacing: 16px above caps-row, 8px below caps до hairline, 8px от hairline до первого nav-item. Между группами 24px дыхания.
- Первая группа сверху: padding-top 12px (равен текущему `#sidebar` padding), не 16px — иначе двойной отступ.

### 3.5. Footer

`.sidebar-collapse-btn` (`styles.css:116-130`) остаётся как есть — V18.1 паттерн рабочий. Над ней — новая `.sidebar-footer-meta`: 1 строка `v18.2 · Q2-2026`, Plus Jakarta 500 10px цвет `--text-3`, центр. В collapsed — скрывается.

---

## 4. Хлебные крошки и переключение между лучами

**Breadcrumbs не нужны.** Структура «луч → раздел» двухуровневая, плоская. `Главная › Контроль › Дашборд` — «Главная» избыточна, «Контроль» уже в индикаторе шапки и caps-разделителе sidebar. Тройной дубль.

**Tab-switcher — только для Планирования.** 5 разделов с однородным content-shape (вариации одного dataset'а). Над hero: `[Реестр] [Гант] [Канбан] [Подложка] [Таймлайн]`, 2px underline-active `--ray-planning`. У остальных лучей контент несравним — tabs не нужны.

**Keyboard `⌘1..6`:** `⌘1` Планирование → Реестр; `⌘2` Контроль → Дашборд; `⌘3` Предсказание → AI Анализ; `⌘4` Коммуникация → AI CEO; `⌘5` Связи → Интеграции; `⌘6` Ретроспектива → История. `⌘⇧1..N` внутри луча — V19+. `⌘K` глобальный поиск (§2.5). `←/→` не вешаю — заняты move-cell в таблицах.

---

## 5. Onboarding-фрагмент

В `index.html:71-99` — экран `ob-welcome`. Меняю **только** три строки, где встречается логотип/название:

- **`:74`** `<div class="ob-welcome-logo">СБОФ</div>` → полный lockup §A5 Дмитрия: mark 80×80 (активный сегмент №1, Indigo Ink — это «дефолт-бренд», вне-секционный) + wordmark «Призма» 32px Plus Jakarta 700. Без pill-обёртки.
- **`:75`** `<h1>Планировщик релизов</h1>` → `<h1>Квартал в гранях</h1>`. EB Garamond 400, 32px (единственный onboarding-момент, где serif допустим — Анна §4).
- **`:76`** `<p>Аналитика, риски и AI-поддержка для управления Q2-планом</p>` → `<p>Один свет — четыре грани квартала: планирование, контроль, предсказание, коммуникация.</p>`. Inter 400, 14px, цвет `--text-2`.

Карточки демо/обучение/настройка `.ob-welcome-cards` — не трогаю, это другой scope (Волна 2/3).

---

## 6. Микро-моменты UX

### 6.1. Переход между лучами

`navigateTo` в раздел другого луча, 240ms (motion-mid):
- Mark: активный сегмент **загорается** на новой позиции (другой rect получает active-class, transition opacity+fill).
- `.ray-dot` плавно меняет fill (CSS `background-color` transition).
- `.ray-eyebrow` — crossfade opacity 1→0→1 с заменой текста посередине. НЕ slide (slide на data-tool «меня куда-то едет»).
- `.topbar-hairline` — тот же 240ms color-transition.
- Hero-блок данных рендерится **без анимации**. Бренд анимируется, данные — нет.

### 6.2. Раздел внутри того же луча

Реестр → Гант: **mark и eyebrow не меняются**, в sidebar только stripe-left уезжает с пункта на пункт за 240ms. Пользователь чувствует, что остался в том же режиме мышления; шапка не моргает.

### 6.3. Уведомление из чужого луча

Forecasting сгенерил alert при пользователе в Реестре. Пункт `AI Анализ` получает **badge 6px** справа в nav-item, цвета `--ray-foresight`. НЕ красный (не error), НЕ цвет текущего луча (анти-карнавал). Caps-разделитель `ПРЕДСКАЗАНИЕ` НЕ подсвечивается. В collapsed — точка над иконкой. Tooltip: «Новое: команда X — риск срыва 1.21». Click → переход, badge сбрасывается.

---

## 7. Что НЕ менять

1. **`.sidebar-collapse-btn` footer-pattern** (`styles.css:116-130`) — V18.1 идеален.
2. **`#topbar-brand` ARIA** (`role="button" tabindex="0"`, `index.html:327`) — корректный «бренд как кнопка-домой».
3. **Sticky-fixed layout с `--topbar-h` + `padding-top` на `#app-layout`** (`styles.css:166`) — меняем значения, не структуру.
4. **`.nav-item::after` 3px stripe-left** (`styles.css:200-213`) — заменяем только цвет, transitions/positioning не трогаем.
5. **`#topbar-row-count` toggle через `.hidden`** — рабочая реактивность.

---

## 8. Чек-лист имплементации

### `index.html`

- **`:6`** title `СБОФ Планирование` → `Призма — квартал в гранях`. В `App.navigateTo` динамически `«Дашборд · Призма»`.
- **`:7`** `<link rel="icon">` — заменить на 5 link'ов (light-svg, dark-svg, ico fallback, apple-touch, mask) + 2 meta theme-color (§B3 Дмитрия).
- **`:74-76`** onboarding logo/title/sub — см. §5.
- **`:325-338`** `#topbar-brand`: убрать pill `.topbar-logo` обёртку, заменить на inline-SVG `prisma-mark` (6 rect, по сегменту на луч) + `<span class="prisma-wordmark">Призма</span>`. Удалить `.topbar-title` `«Планировщик»`.
- **между `:339` и `:340`** добавить `<div class="topbar-ray-indicator">` с `.ray-dot` + `.ray-eyebrow`.
- **`:340-432`** в `.topbar-actions`: добавить `#topbar-search` первым элементом; обернуть theme-toggle + onboarding в новый `#user-menu` дропдаун (удалить standalone `#btn-theme-toggle`, `#btn-onboarding`).
- **после `:433` `</header>`** добавить `<div class="topbar-hairline"></div>`.
- **`:438-513`** `.sidebar-nav`: переписать — обернуть существующие `.nav-item` в 6 `<section class="nav-group" data-ray="...">`, каждая с child `<div class="nav-group-title">` (caps + dot + hairline). Удалить старые `.nav-divider`. Mapping по таблице §1.

### `styles.css`

**Tokens (`:root`, `:5-57`):**
- Добавить `--ray-planning, --ray-control, --ray-foresight, --ray-comms, --ray-retro, --ray-links` (light hex по §2.1 Анны).
- Добавить `--ray-*-dim` (alpha 0.4) для hairlines.
- В `[data-theme="dark"]` блоке — dark Mist-парные значения.
- `--accent` оставить как алиас `var(--ray-planning)` для legacy. Добавить `--accent-default: var(--ray-planning)` для submit-кнопок (§5.4 Анны).
- Пометить deprecated: `--accent-light, --accent-muted, --accent-dark, --accent-strong` (всё `#4f46e5`-derived).

**Topbar (`:70-110`):**
- `#topbar`: убрать `backdrop-filter`, `box-shadow`. Добавить `background: var(--surface-0)`. `border-bottom` через нейтральный `--hairline`.
- Удалить: `.topbar-logo`, `.topbar-logo-mark`, `.topbar-logo-text`, `.topbar-title`.
- Добавить: `.prisma-mark` (24×24 без подложки), `.prisma-wordmark` (Plus Jakarta 600 16px, color `--text-1`), `.topbar-ray-indicator` (flex gap 8px), `.ray-dot` (6×6 circle), `.ray-eyebrow` (caps Plus Jakarta 600 10px ls 0.12em, color `--text-2`), `.topbar-hairline` (1px height).
- 6 каскад-селекторов вида `[data-active-ray="control"] .prisma-mark [data-seg="control"] { fill: var(--ray-control); }` + `[data-active-ray="control"] .ray-dot { background: var(--ray-control); }` + `[data-active-ray="control"] .topbar-hairline { background: var(--ray-control); }`.

**Sidebar/nav (`:170-220`):**
- `.nav-group` — новая обёртка, `padding: 16px 0 8px`.
- `.nav-group-title` — flex space-between, child `.nav-group-caps`, `.nav-group-dot`, `.nav-group-hairline` по §3.4.
- `.nav-item.active`: `background: var(--accent-light)` → `background: var(--bg-secondary)`. Лейбл `--text-1`.
- `.nav-item.active::after`: `background: var(--accent)` → `background: var(--ray-current)` (определяется внутри `.nav-group[data-ray]` через локальный CSS-var).
- Collapsed: `#sidebar.collapsed .nav-group-title` — скрыть текст и точку, оставить только hairline-нить (24px center).

### `app/appSettings.js`

**Структура `NAV_SECTIONS` (`:34-45`):** плоский массив → иерархия:

```js
export const NAV_SECTIONS = [
  { ray: 'planning',  label: 'ЛУЧ ПЛАНИРОВАНИЯ',  sections: [
    { key:'registry', label:'Реестр' }, { key:'gantt', label:'Гант' },
    { key:'kanban', label:'Канбан' }, { key:'podlozhka', label:'Подложка' },
    { key:'timeline', label:'Таймлайн' },
  ]},
  { ray: 'control',   label: 'ЛУЧ КОНТРОЛЯ',      sections: [
    { key:'dashboard', label:'Дашборд' }, { key:'employees', label:'Сотрудники' },
    { key:'summary', label:'Сводная' }, { key:'metrics', label:'Метрики' },
    { key:'insights', label:'Инсайты' },
  ]},
  { ray: 'foresight', label: 'ЛУЧ ПРЕДСКАЗАНИЯ',  sections: [
    { key:'ai', label:'AI Анализ' },
  ]},
  { ray: 'comms',     label: 'ЛУЧ КОММУНИКАЦИИ',  sections: [
    { key:'ai-ceo', label:'AI CEO' }, { key:'actions', label:'Action Layer' },
  ]},
  { ray: 'links',     label: 'ЛУЧ СВЯЗЕЙ',        sections: [
    { key:'integrations', label:'Интеграции' }, { key:'diagnostics', label:'Диагностика' },
    { key:'errors', label:'Ошибки' },
  ]},
  { ray: 'retro',     label: 'ЛУЧ РЕТРОСПЕКТИВЫ', sections: [
    { key:'history', label:'История' },
  ]},
];
```

Backward-compat: callsite `NAV_SECTIONS.map(s => s.key)` → `NAV_SECTIONS.flatMap(g => g.sections.map(s => s.key))`. Грепнуть `NAV_SECTIONS` и поправить (Settings-modal, render-nav, любой код перебирающий разделы).

Helper: `export function getRayForSection(key)` — по ключу возвращает ray-id родительской группы.

### `app.js`

- В `App.navigateTo(section)`: `document.documentElement.dataset.activeRay = getRayForSection(section)` — управляет mark + точкой + хейрлайном через CSS-каскад.
- Там же: `document.title = '${getSectionLabel(section)} · Призма'`.
- `App.renderSidebar` (грепнуть `sidebar-nav`): переписать на двухуровневую итерацию по новому `NAV_SECTIONS`.
- Keyboard handler: добавить `⌘1..6` обработчик → `navigateTo(NAV_SECTIONS[i].sections[0].key)`.

### Прочие

- **`favicon.svg`** → заменить на `favicon-light.svg` + `favicon-dark.svg` по §B2 Дмитрия.
- **`styles.css:51`** font-stack: добавить `'Plus Jakarta Sans'`, `'EB Garamond'`. Webfont-загрузка — задача дизайн-системного инженера.

---

**Мария Левина**
*UX-дизайнер, бренд «Призма» — V18.x*

> «Шапка — это договор о том, где я. Sidebar — карта путешествия. Призма даёт нам шесть граней этой карты, и моя работа — не нарисовать шесть карт, а одну, которая показывает грань под луч в нужный момент.»
