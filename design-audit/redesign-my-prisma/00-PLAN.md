---
role: Editor
date: 2026-05-03
status: draft
scope: Полный план редизайна приложения «Призма» под бренд-пакет `my_prisma-brand` (Northstar / 8-лучевая звезда / 5 модулей / монохром + 5 signal). Брендбук — single source of truth.
brandbook: ../../../my_prisma-brand/BRAND_BOOK.md
---

# План редизайна «Призма» под Northstar Brandbook

> Цель: за 3 волны (~6 недель) перевести приложение с текущего шаблона
> «vanilla v17 + spine-pill + indigo `#4f46e5`» на бренд `my_prisma-brand`:
> 8-лучевая звезда, монохром Star/Ink, 5 модулей вместо 17 разделов, 4 motion-жеста.
> Брендбук — `my_prisma-brand/BRAND_BOOK.md`. Конкурирующий пакет `design-audit/prisma-brand/`
> **отзываем** (Editorial Operator + 6 цветных лучей) — он несовместим со звёздно-монохромной
> концепцией (см. `design-audit/redesign-my-prisma/CONFLICT.md`, отдельно).

---

## 1. Команда (9 экспертов)

| # | Роль | Эксперт | Документ-владелец |
|---|---|---|---|
| 1 | Арт-директор / концепция | **Анна Володина** | §3 этого файла |
| 2 | Бренд-дизайнер / иконограф | **Дмитрий Кравцов** | §4 этого файла |
| 3 | UX-дизайнер / IA | **Мария Левина** | §5 (5 модулей mapping) |
| 4 | UI-дизайнер | **Игорь Тен** | §6 (адаптация экранов) |
| 5 | Дизайн-системный инженер | **Сергей Поляков** | §7 (миграция токенов) |
| 6 | Motion-дизайнер | **Ева Ким** | §8 (4 жеста + splash + лоадеры) |
| 7 | Frontend tech-lead | **Никита Орлов** | §9 (как уложить в vanilla JS без бандлера) |
| 8 | Accessibility-специалист | **Кира Васнецова** | §10 (WCAG 2.1 AA + reduced-motion) |
| 9 | Контент-дизайнер / копирайтер | **Алёна Зорина** | §11 (TOV, словарь курса, ренейминг) |

Эксперты работают **последовательно** (каждый зависит от решения предыдущего):
1 → 2 → 3 → 4 → 5 → 6 → 7 → 10 (a11y) — параллельно с 4-9. 11 (контент) — параллельно с 3-4.

---

## 2. Главные 8 решений (single source of truth)

Эти 8 пунктов — фиксированные. Если кто-то на этапе имплементации хочет переиграть — приходит с фактами и переубеждает заказчика.

1. **Mark = 8-лучевая звезда** ([brandbook §2](../../my_prisma-brand/BRAND_BOOK.md)) — главные 12.5×, боковые 12.5× × 0.7 opacity, диагональные 8× × 0.45, ядро r=4. Только вертикально. **SVG-файл** `my_prisma-brand/assets/svg/logo/star.svg` — копируем в проект как есть.
2. **Палитра — монохром + 5 signal**. Mark всегда `currentColor`. Signal-цвета (onCourse/drift/offCourse/information/insight) — **только** для статуса курса, не декорация. Принцип «60% bg / 20% cards / 15% text / 5% signal».
3. **5 модулей вместо 17 разделов**: Курс / След пути / Команда / Цели / Ритуалы. Системные разделы (Интеграции/Ошибки/Диагностика/Настройки) уходят в `Settings drawer`, **не модуль**. Подробное mapping — §5.
4. **Шрифты — SF Pro Display + JetBrains Mono**. Никакого Plus Jakarta, Inter, EB Garamond. Fallback на `-apple-system, BlinkMacSystemFont, 'Inter', sans-serif` — Inter уже есть в браузерах (system-ui), не загружаем.
5. **Темы — dark default, light как pair**. Не инверсия — каждый цвет на той же hue-оси, разная светлота. Переключатель **auto / dark / light**. Одна CSS-переменная `--prizma-mark` — fill для звезды.
6. **4 motion-жеста — обязательны** (emerge / breathe / pulse / align). **Breathe — default idle всегда**. Splash 2400ms проигрывается до конца. Reduced-motion уважается полностью.
7. **6 запретов жёсткие** ([brandbook §12](../../my_prisma-brand/BRAND_BOOK.md)) — не поворачивать, не раскрашивать, не растягивать, не менять пропорции лучей, без glow/shadow, не вкладывать в формы.
8. **TOV — компас**: «курс / траектория / дрейф / держать ритм / сверить курс». Не «эффективность / задачи / релиз / синхронизация». Полный словарь — §11.

---

## 3. Концепция и арт-дирекция (Анна Володина)

### 3.1. Что мы делаем — одной фразой

«Призма — компас команды». Не таск-трекер, не PM-инструмент. **Один взгляд на дашборд — и тимлид знает: команда на курсе, дрейфует или сбилась.**

### 3.2. Почему звезда, а не призма

Метафора призмы (расщепление света на лучи) красивая, но в продукте требует 6+ цветных разделов — это нарушает принцип «одна картина = одно сообщение». 8-лучевая звезда (Northstar) даёт ту же визуальную плотность (8 лучей = «много граней внимания»), но сводится к **одной точке**, к которой команда движется. Это и есть *компас*: не «карнавал лучей», а *направление*.

### 3.3. Почему монохром

В B2B-инструменте, где тимлид смотрит 4-6 часов в день, цветной brand-system изматывает. Все «карнавальные» паттерны (Linear, Asana, Monday) теряют силу через 2 недели — пользователь перестаёт замечать. Монохром-знак на тёмном фоне с **локальными signal-цветами для статуса** — единственная стратегия, которая удерживается на длинной дистанции.

### 3.4. 4 атмосферных правила

1. **Спокойствие важнее эффектов.** Никаких bounce, jump, parallax. Жесты только из списка [brandbook §9](../../my_prisma-brand/BRAND_BOOK.md). Если кто-то хочет добавить пятый — отклоняем.
2. **Знак никогда не статичен.** Default — `breathe` (4s loop). Это **узнаваемая личность бренда** на длинной дистанции. Замечают через 2 минуты, любят через 2 недели.
3. **Цвет несёт только signal.** Если красный/жёлтый/зелёный появляется не для статуса курса — это нарушение. Ловим на code-review.
4. **Каждое слово в продукте проходит через словарь курса** (§11). «Релиз» → «отрезок курса». «Задача» → «шаг». «Просрочено» → «дрейф». Это длинная работа, но она и есть бренд.

### 3.5. Метрики успеха через 3 месяца

1. **5-сек тест узнаваемости:** скриншот любого экрана без логотипа → 7/10 респондентов из target-аудитории называют «Призма».
2. **Sales говорит в TOV-словаре:** ≥70% звонков sales использует слова «курс / дрейф / траектория» вместо «задачи / релиз / просрочено».
3. **Pilot-recall:** 15 интервью с тимлидами через 3 месяца — медианно ≤5 сек от вопроса «как называется инструмент?» до ответа «Призма».

Если выполнено все три — построена категория, не обновлён UI. Если меньше — итерация.

---

## 4. Бренд-имплементация (Дмитрий Кравцов)

### 4.1. SVG-ассеты, которые копируем как есть

Из `my_prisma-brand/assets/svg/`:

| Источник | Куда положить в проекте |
|---|---|
| `logo/star.svg` | `assets/brand/star.svg` (новая папка) |
| `logo/star-wordmark.svg` | `assets/brand/star-wordmark.svg` |
| `logo/favicon-16.svg` | заменить `favicon.svg` корневой |
| `logo/app-icon-ios.svg` | `assets/brand/app-icon-ios.svg` (для PWA в будущем) |
| `modules/kurs.svg` | `assets/brand/modules/course.svg` (англ slug, не транслит) |
| `modules/sled-puti.svg` | `assets/brand/modules/path.svg` |
| `modules/komanda.svg` | `assets/brand/modules/team.svg` |
| `modules/tseli.svg` | `assets/brand/modules/goals.svg` |
| `modules/ritualy.svg` | `assets/brand/modules/rituals.svg` |

**Slug'и переименовываем на английский** (`tseli` → `goals`, `ritualy` → `rituals`). Транслит в файлах непрофессионально, мешает grep-навигации.

### 4.2. Favicon — три файла

```
favicon.svg              ← single-mode currentColor (для современных браузеров)
favicon-16.png           ← 16×16 fallback для legacy
apple-touch-icon.png     ← 180×180 для iOS home-screen
```

В `<head>` `index.html`:
```html
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="icon" type="image/png" sizes="16x16" href="favicon-16.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="theme-color" content="#0A0A0F" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#FAFAF8" media="(prefers-color-scheme: light)">
```

### 4.3. Шапка приложения (topbar)

Текущий `index.html:325-338` (`.topbar-logo` pill с «СБОФ» / «Призма» Triad-Mark из PR-BE) — **полностью снести**.

Новая структура:
```html
<a class="topbar-brand" href="#course">
  <svg class="prizma-mark" width="28" height="28" aria-label="Призма">
    <!-- inline copy of star.svg viewBox 0 0 120 120 -->
  </svg>
  <span class="prizma-wordmark">ПРИЗМА</span>
</a>
```

Стиль:
- mark — 28×28, `fill: var(--prizma-mark)`, `breathe`-анимация default
- wordmark — SF Pro Display 16px, weight 200, letter-spacing 4px (компактнее splash'а 8px), color `var(--prizma-text-primary)`
- gap между ними — 12px
- click → переход на «Курс» (бывший Дашборд)
- hover — wordmark fade opacity 0.7→1.0

**Никакого pill-фона, без Indigo, без Triad из PR-BE.** Это разрыв с прошлой работой.

### 4.4. App-icon iOS / PWA (на будущее)

Из `my_prisma-brand/assets/svg/logo/app-icon-ios.svg` — фон `#0A0A0F`, звезда белая 320×320 в центре. Для iOS Apple применит squircle-маску. **Сейчас не делаем PWA** (внутренний банковский tool), но мастер-файл должен быть в `assets/brand/` к моменту когда mobile-стратегия определится.

---

## 5. IA: 5 модулей вместо 17 разделов (Мария Левина)

### 5.1. Mapping — окончательный

Текущий `app/appSettings.js:34-45` содержит **17 ключей**:
```
dashboard, registry, gantt, kanban, timeline, podlozhka, employees,
summary, metrics, insights, diagnostics, actions, ai, integrations,
ai-ceo, history, errors
```

+ 4 dashboard'а из PR-BF (insightsDashboards.js):
```
est-calibration, component-health, burnout, doc-debt
```

+ Сканнер 2.0 (sub-tab в integrations) и Чёрный дашборд (sub-tab в integrations).

**Итого 23 единицы**, мапим в **5 модулей**:

| Модуль | Иконка | Что внутри (из 23 единиц) | Главный экран |
|---|---|---|---|
| **Курс** (course) | `course.svg` (полная звезда) | dashboard · summary · metrics · insights | Дашборд |
| **След пути** (path) | `path.svg` (звезда + затухающие точки) | registry · gantt · kanban · timeline · podlozhka · history | Реестр |
| **Команда** (team) | `team.svg` (звезда + 3 спутника) | employees · **Сканнер 2.0** · burnout · component-health | Сканнер 2.0 |
| **Цели** (goals) | `goals.svg` (звезда + концентрические круги) | **Чёрный дашборд (Sigma)** · ai-ceo · actions · ai | Чёрный дашборд |
| **Ритуалы** (rituals) | `rituals.svg` (две звезды в диалоге) | **AI Чат** · onboarding · est-calibration · doc-debt · *(future: ретро, 1:1)* | AI Чат |

**Settings drawer (вне модулей):**
| Раздел | Где |
|---|---|
| Интеграции | drawer справа из `Settings → Integrations` |
| Ошибки (логи) | drawer `Settings → System → Errors log` |
| Диагностика | drawer `Settings → System → Diagnostics` |
| App settings | drawer `Settings` (главный) |

### 5.2. Почему именно так

- **Курс** — оперативный взгляд «где мы сейчас». Дашборд (default landing), Сводная (сводка релизов), Метрики (slope/Z-score), Инсайты (anomaly).
- **След пути** — где задачи проходят. Все 5 view планировщика + История (это не «прошлое отдельно», это «след пути» в обратную сторону).
- **Команда** — люди и их состояние. **Сканнер 2.0** — главный экран модуля (мы делали 200+ часов работы вокруг него). Burnout/Component health — части этого же экрана детализации.
- **Цели** — квартальные ориентиры. **Чёрный дашборд** — главный экран (Sigma quarterly goals). AI CEO (отчёт про цели), Action Layer (нарративы про цели), AI Анализ (forecasting к целям).
- **Ритуалы** — регулярные практики. AI Чат (диалог о работе), onboarding (вход), точность оценок (рефлексия), документация-долги (рефлексия). Зона **роста**: сюда добавятся retro-инструменты, 1:1 шаблоны, daily-стендапы.

### 5.3. Модули в sidebar

Sidebar получает **2 уровня иерархии**:

```
[28×28 mark + ПРИЗМА wordmark]
─────────────────────────────────
  ★ Курс          [active = stripe-left + breathe]
    · Дашборд (default)
    · Сводная
    · Метрики
    · Инсайты

  ✦ След пути
    · Реестр (default)
    · Гант
    · Канбан
    · Таймлайн
    · Подложка
    · История

  ✧ Команда
    · Сканнер 2.0 (default)
    · Сотрудники
    · Перегрузка
    · Здоровье компонентов

  ✪ Цели
    · Чёрный дашборд (default)
    · AI CEO
    · Action Layer
    · AI Анализ

  ✫ Ритуалы
    · AI Чат (default)
    · Точность оценок
    · Документация: долги
    · Onboarding
─────────────────────────────────
[Settings] [Theme toggle] [Help]
```

Иконки модулей (✦✧✪✫) — это `assets/brand/modules/*.svg`, 16×16 inline-SVG.

При клике на модуль → переход на default-раздел модуля. При клике на подраздел → переход + sticky-stripe-left на пункт.

### 5.4. Шапка-индикатор текущего модуля

В шапке **между** wordmark и actions — `.module-indicator`:
```html
<div class="module-indicator">
  <svg class="module-icon"><!-- из current module --></svg>
  <span class="module-label">КОМАНДА</span>
</div>
```

- Иконка модуля 14×14 в `var(--prizma-text-secondary)`
- Label SF Pro Display 11px weight 500 letter-spacing 1.5px UPPERCASE — Caption-стиль из brandbook §4
- При навигации между модулями — `align`-жест на иконке (rotation -12° → 2° → 0°, spring 1600ms)

Это даёт pre-attentive cue «в каком модуле я сейчас» — **без раскрашивания всего интерфейса**.

### 5.5. Keyboard shortcuts

```
⌘1  Курс
⌘2  След пути
⌘3  Команда
⌘4  Цели
⌘5  Ритуалы
⌘,  Settings
⌘K  Глобальный поиск
```

`⌘N` (где N=1..5) — переход на default-раздел модуля. `⌘⇧N` — внутри модуля next/prev раздел (V19+, не сейчас).

---

## 6. Адаптация экранов (Игорь Тен)

### 6.1. Page-template — каркас

Каждая страница продукта собирается из 3 зон:

```
┌──────────────────────────────────────────┐
│ ZONE A · Page-header                     │
│  - eyebrow CAPTION (модуль · раздел)     │
│  - h1 Headline                           │
│  - sub Body (опционально)                │
│ ──────────────────────────────────────── │ ← hairline 1px var(--prizma-border)
│ ZONE B · Page-toolbar (опц.)            │
│  - tabs / filters / actions              │
│ ──────────────────────────────────────── │
│ ZONE C · Page-body                       │
│  (table / canvas / cards / longform)     │
└──────────────────────────────────────────┘
```

Типографика:
- eyebrow: Caption (11px weight 500 ls 1.5px CAPS) `var(--prizma-text-secondary)`. Текст: `КУРС · ДАШБОРД`, `СЛЕД ПУТИ · РЕЕСТР`. Это и есть «знаю где я».
- h1: Headline 32px weight 300 `var(--prizma-text-primary)`
- sub: Body 15px `var(--prizma-text-secondary)` max-width 64ch (только на редакционных экранах)
- hairline: 1px solid `var(--prizma-border)` (rgba(255,255,255,0.08) на dark, rgba(26,26,34,0.08) на light)

**Без цветных хедеров, без gradient'ов, без cup-shadows.** Если кто-то на code-review предложит «давай тонируем шапку слегка» — отклоняем.

### 6.2. Hero-блок — где появляется звезда

На каждой странице **может быть** 1 hero-блок:
- Звезда 48-64px с breathe-анимацией
- Большое число (KPI) JetBrains Mono 24px weight 300 ls -0.5px
- Caption под числом

Появляется **только на главных экранах модулей** (Дашборд, Реестр, Сканнер 2.0, Чёрный дашборд, AI Чат). На под-разделах (Сводная, Гант, Метрики и т.д.) — без hero, сразу page-toolbar или body.

Пример hero «Дашборда»:
```
       ★             <- 64px breathe
                     
      57.7           <- mono number
   КУРС КВАРТАЛА     <- caption
```

### 6.3. Карточки и компоненты

Все компоненты переписываем под brandbook color-rules:

| Компонент | Что меняется |
|---|---|
| `.kpi-card` | radius 4 (было 8), border 1px `--prizma-border`, без shadow, hover → `border-color: --prizma-border-strong`. Stripe-left **только** signal-цвет (никакого «акцент»-цвета). KPI-цифра JBM 24 weight 300, Caption-eyebrow CAPS. |
| `.btn-primary` | Фон `--prizma-mark` (Star/Ink — same color as the mark!), текст `--prizma-bg`, radius 3, без shadow. Это «нейтрально-тёмная» в dark и «нейтрально-светлая» в light. |
| `.btn-secondary` | Transparent + 1px border `--prizma-mark`, hover bg `--prizma-bg-elevated` |
| `.btn-ghost` | Только текст `--prizma-text-secondary`, hover → `--prizma-text-primary`. Без border. |
| `.input / .select` | radius 3, 1px `--prizma-border`, focus 2px outline `--prizma-information` (signal-цвет, не акцент!). Caption над label. |
| `.modal` | radius 4, 1px `--prizma-border`, shadow `0 8px 32px rgba(0,0,0,.4)` (на dark sense). Header — caption + h1 18px. Без цветных хедеров. |
| `.toast` | Bottom-right 320px, stripe-left 3px **signal-color** (onCourse/drift/offCourse). Auto-dismiss 5s. |
| `.chip-status` | Hairline-border + transparent fill, JBM 10 CAPS `--prizma-{signal}`. |
| `.tooltip` | Фон `--prizma-text-primary`, текст `--prizma-bg`, Body 12px, radius 3, без стрелки. |

### 6.4. Что сносим в первую очередь (Волна 1)

| Файл | Что сносим |
|---|---|
| `index.html:325-338` | `.topbar-logo` pill, Triad-mark из PR-BE, текст «Призма» с inline-SVG треугольника |
| `index.html:340-432` | flat 17-section sidebar nav |
| `index.html:74-76` | onboarding logo (старый «СБОФ» fallback или Призма Triad) |
| `styles.css:1-100` | `:root` `--accent: #4f46e5` indigo и все его derived (`--accent-light`, `--accent-muted`) |
| `styles.css:70-110` | `.topbar-*` — переписать целиком под новую структуру |
| `styles.css:170-220` | `.sidebar-nav` — переписать под 5 модулей × подразделы |
| `styles.css:443-486` | `.kpi-card` — color-rules под brandbook §3 |
| `styles.css:2730+` | `.summary-super-hero / .metrics-hero` — gradient-катастрофа сносится |
| `styles.css:7477+` | `ceo-hero-*` modifiers → semantic `--state-*` (onCourse/drift/offCourse) |
| `app/appSettings.js:34-45` | `NAV_SECTIONS` — реструктура в 5 модулей × подразделы (см. §5.1) |
| `app.js` (`navigateTo`) | Установка `data-active-module` на html, `align`-жест на module-indicator |
| `favicon.svg` | Заменить на `my_prisma-brand/assets/svg/logo/favicon-16.svg` |
| `favicon-light.svg` `favicon-dark.svg` | Удалить (если есть от PR-BE) — у нас один currentColor SVG |

---

## 7. Миграция дизайн-токенов (Сергей Поляков)

### 7.1. Стратегия — shim + revalue + rename

44 KLOC vanilla JS + 600KB styles.css. Прямая замена `--accent` → `--prizma-mark` сломает 200+ мест. Поэтому **3 этапа**:

1. **Shim (день 1)** — добавить `--prizma-*` токены в `:root` параллельно с существующими `--accent`, `--bg`, etc. **Старые имена живут**, ничего не ломается. Это даёт `theme.css` рядом с `styles.css`, оба загружаются.
2. **Revalue (день 2-5)** — `--accent: var(--prizma-mark)` (старое имя получает новое значение). Все 200+ мест автоматически перекрашиваются в нейтрально-Star. Спайн-pill красный? `--accent-strong: var(--prizma-information)`. И т.д. — мапим каждый старый токен на новый.
3. **Rename (волна 2-3, постепенно)** — заменяем `var(--accent)` на `var(--prizma-mark)` пофайлово. По мере того как файл трогается — токены rename'ятся. Не делаем bulk find-replace.
4. **Cleanup (волна 3 финал)** — удаляем shim после rename всех 200+ мест.

### 7.2. Прямая копия из brandbook

`my_prisma-brand/tokens/theme.css` (174 строки) — **копируем как есть** в новый файл `theme.css` рядом с `styles.css`. Подключаем в `index.html` **первой** (`<link>` перед styles.css), чтобы стили могли использовать `--prizma-*`.

### 7.3. Mapping legacy → new

```css
/* В styles.css верхней частью добавляем shim */
:root {
  /* === Legacy → Prizma shim === */
  --bg:           var(--prizma-bg);
  --bg-secondary: var(--prizma-bg-elevated);
  --bg-tertiary:  var(--prizma-bg-tertiary);
  --text-1:       var(--prizma-text-primary);
  --text-2:       var(--prizma-text-secondary);
  --text-3:       var(--prizma-text-tertiary);
  --border:       var(--prizma-border);
  --border-light: var(--prizma-border-strong);
  --accent:       var(--prizma-mark);          /* Indigo #4f46e5 → Star/Ink mono */
  --accent-light: var(--prizma-bg-elevated);   /* было tint, теперь elevated bg */
  --accent-muted: var(--prizma-text-secondary);
  --accent-strong:var(--prizma-information);   /* hover/focus → signal-info */
  --success:      var(--prizma-on-course);
  --warning:      var(--prizma-drift);
  --danger:       var(--prizma-off-course);
  --info:         var(--prizma-information);
}
```

После этого все 44 KLOC уже **частично выглядят как brandbook** (все цвета фона, текста, акцентов мапятся на нейтралы и signal). Дальше — целевой rename и cleanup CSS-overrides.

### 7.4. Что **нельзя** сматчить shim'ом

| Legacy | Почему shim не работает |
|---|---|
| `gradient(135deg, var(--accent), var(--accent-strong))` | gradient-fills brandbook запрещает (`--prizma-*` не имеют пары для gradient'а). Сносим вручную. |
| `box-shadow: var(--shadow-sm)` под карточками | Brandbook §12 — без shadow для mark'а, но shadow для cards/modals остаётся. Маппим `--shadow-*` → нейтральные `0 4px 12px rgba(0,0,0,.12)`. |
| `.kpi-green/red/yellow/blue/teal/purple` (PR-BF dashboard cards) | Это карнавальная палитра. **Снести**, заменить на `--state-{ok,warning,error,info}` semantic. |
| Все 6 цветных `--ray-*` из `design-audit/prisma-brand/05-design-tokens.md` | **Никогда не имплементировались**. Если кто-то их добавил — снести. |

---

## 8. Motion-имплементация (Ева Ким)

### 8.1. Что копируем из brandbook

`my_prisma-brand/tokens/motion.json` — спецификации 4 жестов + splash + 3 уровней лоадеров. **Копируем в `theme.css`** как `@keyframes`.

### 8.2. Жест Breathe — default everywhere

```css
@keyframes prizma-breathe {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50%      { transform: scale(1.04); opacity: 1; }
}
.prizma-mark {
  animation: prizma-breathe 4s ease-in-out infinite;
  transform-origin: center;
}
@media (prefers-reduced-motion: reduce) {
  .prizma-mark { animation: none; opacity: 1; }
}
```

Применяется везде где `.prizma-mark` (topbar, sidebar-icons модулей, hero-блоки на главных экранах модулей, splash, Pulse-loader).

### 8.3. Жест Emerge — splash + первое открытие модуля

Сложная анимация (sequence 0-1100ms): ядро scale 0→1 (0-400ms) → главные лучи (300-1000ms) → боковые (500-1200ms) → диагональные (650-1400ms stagger 50ms).

Имплементация — **CSS `@keyframes` с разными `animation-delay` на каждой группе `<polygon>`**. Тяжело написать вручную, но один раз — и работает на любом размере звезды.

### 8.4. Жест Pulse — нотификация / дрейф обнаружен

Когда обнаружен дрейф или пришла нотификация — звезда в шапке получает **расширяющееся кольцо**:

```css
@keyframes prizma-pulse {
  0%   { transform: scale(0.4); opacity: 0.8; }
  100% { transform: scale(1.6); opacity: 0; }
}
.prizma-mark::after {
  content: '';
  position: absolute; inset: 0;
  border: 2px solid var(--prizma-drift);
  border-radius: 50%;
}
.prizma-mark.is-pulsing::after {
  animation: prizma-pulse 1.6s ease-out infinite;
}
```

`is-pulsing` toggle'ится через JS когда количество offCourse-сигналов > 0. Цвет кольца — drift или offCourse в зависимости от severity.

### 8.5. Жест Align — смена модуля

Spring-анимация (`cubic-bezier(0.34, 1.56, 0.64, 1)`) на module-indicator при переходе между модулями:

```css
@keyframes prizma-align {
  0%   { transform: rotate(-12deg); }
  50%  { transform: rotate(2deg); }
  100% { transform: rotate(0deg); }
}
.module-indicator.is-aligning .module-icon {
  animation: prizma-align 1.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

JS toggle'ит `.is-aligning` на 1.6s при `App.navigateTo(newModule)`. После — снимает class.

### 8.6. Splash screen

**Новый**, текущий проект не имеет splash'а. Появляется при первом open приложения / после login (когда будет auth).

```html
<div class="prizma-splash" data-phase="emerge">
  <svg class="prizma-splash-mark" width="96" height="96"><!-- star --></svg>
  <div class="prizma-splash-wordmark">ПРИЗМА</div>
  <div class="prizma-splash-tagline">СЕВЕРНАЯ ЗВЕЗДА ДЛЯ ВАШЕЙ КОМАНДЫ</div>
</div>
```

Phases (через JS): emerge (0-1000ms) → settle (1200-2000ms) → exit (2000-2400ms).

Wordmark **letter-spacing animation 14px → 8px** на settle-phase.

После 2400ms `<div>` плавно fade-out (200ms), и в углу шапки app-mark continues breathe — как «знак передан в idle».

### 8.7. Loaders (3 уровня)

L1 (300ms-2s): inline-pulse 16-24px рядом с триггером действия. **Текст подписи из словаря**: «Сверяем курс…», «Сохраняем…», «Ищем…».

L2 (2-6s): page-loader центральный — звезда 48-64px breathe + кольцо expand (2400ms loop) + caption «УСТАНАВЛИВАЕМ КУРС».

L3 (>6s): skeleton с shimmer (1600ms linear loop, gradient `#1A1A22 → #2A2A30 → #1A1A22`, background-size 200% 100%) + маленькая звезда в углу как маркер.

**Никогда не круговой спиннер.** Если в коде есть `<div class="spinner">` — рефакторим на L1/L2.

---

## 9. Frontend-имплементация (Никита Орлов)

### 9.1. Vanilla JS контракты (CLAUDE.md)

Проект — vanilla JS без бандлера, без build-step. Все наши изменения должны:
1. Работать через ES-modules без транспиляции (Node 22+, Chrome/Safari/Firefox без Babel).
2. Не нарушать `Reactive.silent` контракт — масс-мутации state остаются обёрнуты.
3. Не ломать identity-deterministic attribution (`state.employees[].{email, jiraAccountId, …}`).
4. Не ломать `_scrubSecrets` policy на экспортах.

### 9.2. Где живёт `data-active-module`

```js
// app.js — App.navigateTo
App.navigateTo = function(sectionKey) {
  const moduleKey = getModuleForSection(sectionKey);  // из NAV_SECTIONS
  const previousModule = document.documentElement.dataset.activeModule;

  document.documentElement.dataset.activeModule = moduleKey;
  document.documentElement.dataset.activeSection = sectionKey;

  // Жест align — только при смене модуля, не подраздела
  if (previousModule !== moduleKey) {
    triggerAlignGesture();
  }

  // Title
  document.title = `${getSectionLabel(sectionKey)} · Призма`;

  // ... existing render logic
};

function triggerAlignGesture() {
  const indicator = document.querySelector('.module-indicator');
  if (!indicator) return;
  indicator.classList.add('is-aligning');
  setTimeout(() => indicator.classList.remove('is-aligning'), 1600);
}
```

CSS-каскад от `[data-active-module="team"]` управляет sub-стилями (active sidebar item, hero-illustration, etc).

### 9.3. NAV_SECTIONS — новая структура

```js
// app/appSettings.js
export const MODULES = [
  {
    key: 'course', label: 'Курс', icon: 'course.svg',
    sections: [
      { key: 'dashboard', label: 'Дашборд' },
      { key: 'summary',   label: 'Сводная' },
      { key: 'metrics',   label: 'Метрики' },
      { key: 'insights',  label: 'Инсайты' },
    ],
  },
  {
    key: 'path', label: 'След пути', icon: 'path.svg',
    sections: [
      { key: 'registry',  label: 'Реестр' },
      { key: 'gantt',     label: 'Гант' },
      { key: 'kanban',    label: 'Канбан' },
      { key: 'timeline',  label: 'Таймлайн' },
      { key: 'podlozhka', label: 'Подложка' },
      { key: 'history',   label: 'История' },
    ],
  },
  {
    key: 'team', label: 'Команда', icon: 'team.svg',
    sections: [
      { key: 'scanner2',          label: 'Сканнер 2.0' },
      { key: 'employees',         label: 'Сотрудники' },
      { key: 'burnout',           label: 'Перегрузка' },
      { key: 'component-health',  label: 'Здоровье компонентов' },
    ],
  },
  {
    key: 'goals', label: 'Цели', icon: 'goals.svg',
    sections: [
      { key: 'black-dashboard', label: 'Чёрный дашборд' },
      { key: 'ai-ceo',          label: 'AI CEO' },
      { key: 'actions',         label: 'Action Layer' },
      { key: 'ai',              label: 'AI Анализ' },
    ],
  },
  {
    key: 'rituals', label: 'Ритуалы', icon: 'rituals.svg',
    sections: [
      { key: 'chat',             label: 'AI Чат' },
      { key: 'est-calibration',  label: 'Точность оценок' },
      { key: 'doc-debt',         label: 'Документация: долги' },
      { key: 'onboarding',       label: 'Onboarding' },
    ],
  },
];

// Helpers
export function getModuleForSection(sectionKey) {
  for (const m of MODULES) {
    if (m.sections.some(s => s.key === sectionKey)) return m.key;
  }
  return 'course'; // fallback
}
```

Backward-compat: callsites `NAV_SECTIONS.map(s => s.key)` → `MODULES.flatMap(m => m.sections.map(s => s.key))`. Грепнем `NAV_SECTIONS` и поправим.

### 9.4. Sidebar — render

```js
// app.js или views/sidebar.js
function renderSidebar() {
  const activeSection = document.documentElement.dataset.activeSection;
  const activeModule  = document.documentElement.dataset.activeModule;
  const html = MODULES.map(m => `
    <section class="sidebar-module" data-module="${m.key}">
      <div class="sidebar-module-header">
        <svg class="sidebar-module-icon"><use href="${m.icon}#icon"/></svg>
        <span class="sidebar-module-title">${m.label}</span>
      </div>
      <ul class="sidebar-module-sections">
        ${m.sections.map(s => `
          <li class="sidebar-section ${s.key === activeSection ? 'is-active' : ''}"
              data-section="${s.key}">
            <a href="#${s.key}">${s.label}</a>
          </li>
        `).join('')}
      </ul>
    </section>
  `).join('');
  document.getElementById('sidebar-nav').innerHTML = html;
}
```

Stripe-left на `.is-active` через CSS `::before` (3px var(--prizma-text-primary)).

### 9.5. Тесты

Добавляем regression-тесты:
1. `tests/unit/navSections.test.js` — `MODULES` имеет ровно 5 модулей с правильными ключами.
2. `getModuleForSection('scanner2')` → `'team'` etc.
3. Snapshot test sidebar HTML после рендера.
4. `App.navigateTo('scanner2')` устанавливает `data-active-module="team"` и `data-active-section="scanner2"`.

### 9.6. Что не ломать

- **PortfolioPulse + Scanner 2.0 pipeline** — мы только переименовываем UI. Server-side endpoints `/api/integrations/portfolio-pulse/*`, `/api/integrations/black-dashboard/*` остаются как есть.
- **Identity-attribution** — `state.employees[]` структура не трогается.
- **PR-CV (TDZ fix), PR-CG (BB allowlist), PR-CJ (tzSkew), PR-CH ([X] filter)** — все остаются.
- **Sigma Jira isolation** (PR-CL) — Чёрный дашборд использует Sigma, остальные модули — Delta.

---

## 10. Accessibility (Кира Васнецова)

### 10.1. WCAG 2.1 AA — что проверить

| Критерий | Что проверяем |
|---|---|
| 1.4.3 Contrast | Все цвет-пары в `theme.css` ≥ 4.5:1 для body, ≥ 3:1 для UI components |
| 1.4.11 Non-text contrast | Mark на bg ≥ 3:1 (Star `#FFFFFF` на Night `#0A0A0F` = 20.5:1 ✓). Signal-цвета на bg — нужно проверить (offCourse `#FF6B6B` на `#0A0A0F` = 4.7:1 ✓) |
| 2.1.1 Keyboard | Tab-навигация по всем модулям, sidebar items, actions. Esc закрывает модалки. ⌘1..5 переходы между модулями. |
| 2.3.3 Reduced-motion | Все 4 жеста + splash + 3 лоадера уважают `prefers-reduced-motion: reduce`. Breathe и Pulse останавливаются полностью. Emerge показывается мгновенно (без stagger). Splash 2400ms → 0ms (skip). |
| 4.1.2 Name/Role/Value | `aria-label` на mark «Призма», role="navigation" на sidebar, `aria-current="page"` на active section, `aria-live="polite"` на module-indicator при смене |

### 10.2. Reduced-motion implementation

```css
@media (prefers-reduced-motion: reduce) {
  /* Все анимации мгновенны */
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  /* Mark — статичен, без opacity-pulse */
  .prizma-mark { opacity: 1; transform: none; }
  /* Splash — пропускается */
  .prizma-splash { display: none; }
  /* Loaders — статичные иконки */
  .prizma-loader-l1 { animation: none; opacity: 0.7; }
  .prizma-loader-l2-ring { animation: none; opacity: 0; }
  .prizma-loader-l3-shimmer { animation: none; background-position: 0 0; }
}
```

### 10.3. Focus management

- Splash 2400ms — `aria-busy="true"` на `<body>` пока играет. После — `focus()` на main content.
- Module-switch — `aria-live="polite"` на `.module-indicator` объявит «Команда» / «Цели» при смене.
- Modal open — focus-trap (Tab/Shift+Tab cycle), Esc закрывает + return focus to trigger.
- Sidebar collapsed — tooltip при focus на иконке («Команда · Сканнер 2.0»).

### 10.4. Color-blind testing

Signal-цвета должны различаться при protanopia/deuteranopia:
- onCourse `#7FE8B5` (зелёный) vs offCourse `#FF6B6B` (красный) — protanopia делает обоих похожими на жёлто-серый. **Не полагаться только на цвет** — все signal-pills имеют **иконку** (✓ on-course / ⚠ drift / ✗ off-course / ⓘ info / ✦ insight) рядом с цветом.

---

## 11. Контент / TOV (Алёна Зорина)

### 11.1. Полный rename — что переписываем

| Текущая фраза | Новая фраза |
|---|---|
| «Дашборд» | «Курс» (название модуля); внутри — оставляем «Дашборд» как раздел |
| «Реестр задач» | «След пути» (модуль); «Реестр» — раздел |
| «Сканнер команд» | «Команда» (модуль); «Сканнер 2.0» — раздел |
| «Чёрный дашборд» | «Цели» (модуль); «Чёрный дашборд» — раздел |
| «AI Чат» | «Ритуалы» (модуль); «AI Чат» — раздел |
| «Стоп / Внимание / Движется / Простой» | «Сбился с курса / Дрейф / На курсе / Без следа» |
| «Просрочено» | «Дрейф {N} дней» |
| «На грани срыва» | «Сильный дрейф» |
| «Релиз 1.21» | «Отрезок курса 1.21» (или оставить «Релиз 1.21» — это технический термин, обсудимо) |
| «Срок» | «Точка назначения» |
| «Срочно действуйте!» | «Сверьте курс» (без exclamation) |
| «Сохранено!» | «Курс сверен» |
| «Загружаем…» | «Сверяем курс…» |
| «Импорт прошёл успешно» | «Курс установлен» |
| «Ошибка интеграции» | «Сигнал прерван» |

### 11.2. Системные state-сообщения

| State | Сообщение |
|---|---|
| onCourse | «На курсе» |
| drift | «Замечен дрейф» |
| offCourse | «Сбился с курса» |
| information | (нейтральное состояние) |
| insight | «Найден ориентир» |

### 11.3. Empty states — без эмодзи, в TOV

| Контекст | Старый (примеры) | Новый |
|---|---|---|
| Реестр пуст | «📊 Нет задач» | «След пути ещё не проложен. Загрузите план квартала.» |
| Нет результатов фильтра | «🔍 Ничего не найдено» | «Среди {N} шагов — ни одного по этим условиям.» |
| AI Чат пуст | «💬 Задайте вопрос» | «Спросите Призму. Она знает курс команды.» |
| Сканнер 2.0 пуст | «👥 Загрузите данные» | «Команда ещё не сверила курс. Запустите анализ.» |

### 11.4. Ошибки — спокойно, без CAPS

| Старый | Новый |
|---|---|
| «ОШИБКА! Не удалось загрузить» | «Сигнал не прошёл. Попробуем ещё раз?» |
| «Внимание! 3 задачи просрочены, срочно действуйте!» | «Дрейф в 3 шагах. Сверим курс?» |
| «Соединение потеряно» | «Связь с курсом оборвалась» |

### 11.5. Что НЕ меняем

- Технические имена endpoint'ов, токенов, env-vars — английские, как есть.
- Имена сотрудников, тикетов Jira — как есть.
- Логи в DevTools — английский для grep'а, без TOV.

---

## 12. Карта изменений по файлам кода

| Файл | Что меняется | Кто отвечает | Волна |
|---|---|---|---|
| `index.html:6` | `<title>СБОФ Планирование</title>` → `Призма` | 4 | 1 |
| `index.html:7` (новые link'и) | favicon.svg + apple-touch + theme-color meta | 2 | 1 |
| `index.html:74-76` | onboarding logo → splash component | 2, 6 | 1 |
| `index.html:325-338` | topbar → mark + wordmark + module-indicator | 2, 4 | 1 |
| `index.html:340-432` | sidebar → 5 модулей × подразделы | 3 | 1 |
| `theme.css` (новый файл) | копия из `my_prisma-brand/tokens/theme.css` | 5 | 1 |
| `styles.css:1-100` | shim legacy → prizma в `:root` | 5 | 1 |
| `styles.css:70-110` | `.topbar-*` переписать | 4 | 1 |
| `styles.css:170-220` | `.sidebar-nav` → 2-уровневая иерархия | 4 | 1 |
| `styles.css:443-486` | `.kpi-card` под brandbook §6.3 | 4 | 2 |
| `styles.css:2730+` | `.summary-super-hero / .metrics-hero` snose gradient | 4 | 2 |
| `styles.css:7477+` | `ceo-hero-*` modifiers → semantic state | 4 | 2 |
| `styles.css:end` | `@keyframes prizma-breathe / pulse / align / emerge` | 6 | 1 |
| `app/appSettings.js:34-45` | `NAV_SECTIONS` → `MODULES` 5×N | 7 | 1 |
| `app.js` (`navigateTo`) | `data-active-module` + align-gesture | 7 | 1 |
| `app.js` (`renderSidebar`) | 2-уровневая иерархия из MODULES | 7 | 1 |
| `app/llmAssistant.js` | TOV-rename в системных сообщениях | 11 | 2 |
| `views/dashboard.js:24-90` | `renderPageHeader` + hero-блок | 4 | 2 |
| `views/registry.js:67` | `updateRowVisual` → semantic state | 4 | 2 |
| `views/aiCeoView.js` + `ai/aiCeoRenderer.js` | longread layout | 4 | 2 |
| `integrations/teamScanner2Renderer.js` | переименовать «Сканнер команд» → «Сканнер 2.0» в подразделе модуля «Команда» | 11 | 2 |
| `integrations/blackDashboardRenderer.js` | переименовать в подраздел «Чёрный дашборд» модуля «Цели» | 11 | 2 |
| `views/insightsDashboards.js` | 4 dashboard'а распределяются: Burnout/Component-Health → «Команда»; Estimation/Doc-debt → «Ритуалы» | 3, 4 | 2 |
| `chat/chatPrompts.js` | TOV в system-prompt'ах | 11 | 2 |
| `constants.js` (DEFAULT_LLM_SYSTEM_PROMPT) | TOV в system-prompt'е | 11 | 2 |
| `assets/brand/*.svg` (новая папка) | копии из `my_prisma-brand/assets/svg/` | 2 | 1 |
| `favicon.svg` | заменить на `my_prisma-brand/assets/svg/logo/favicon-16.svg` | 2 | 1 |
| `tests/unit/navSections.test.js` (новый) | regression: MODULES структура + getModuleForSection | 7 | 1 |
| `tests/unit/branding.test.js` (новый) | snapshot test mark + wordmark в topbar | 7 | 2 |
| `docs/branding-proposals.md` (старый) | пометить deprecated, ссылка на этот план | — | 1 |
| `design-audit/prisma-brand/` (Editorial 6 лучей) | пометить deprecated, ссылка на этот план | — | 1 |

---

## 13. Волны имплементации

### Волна 1 (sprint 1-2, ~2 недели) — каркас

**Цель:** новый mark, новая сетка sidebar, токены замапены, breathe-анимация работает.

| Задача | Кто | Размер |
|---|---|---|
| Создать `theme.css` (копия из brandbook) | 5 | XS |
| Скопировать SVG-ассеты в `assets/brand/` | 2 | XS |
| Заменить favicon на star | 2 | XS |
| Shim legacy → prizma в `styles.css:1-100` | 5 | S |
| Переписать topbar (`index.html:325-338` + styles) | 2, 4 | M |
| Переписать sidebar в 5 модулей × подразделы | 3, 4, 7 | M |
| `MODULES` структура в `app/appSettings.js` + helpers | 7 | M |
| `App.navigateTo` → `data-active-module` + align gesture | 7 | S |
| Breathe-анимация на mark в topbar | 6 | S |
| Reduced-motion поддержка | 10 | S |
| `<title>` → «Призма» | 4 | XS |
| Regression-тесты на MODULES | 7 | S |
| **Smoke test:** клик по 5 модулям, переход между ними, align-жест работает | 4, 10 | S |

**Готово когда:** все 5 модулей доступны через sidebar, активный модуль виден через breathe-mark + module-indicator label.

### Волна 2 (sprint 3-4, ~2 недели) — экраны

**Цель:** главные экраны 5 модулей перерисованы под brandbook page-template.

| Задача | Кто | Размер |
|---|---|---|
| Page-template (eyebrow + h1 + hairline + body) | 4 | M |
| Hero-блок с звездой + KPI на главных экранах модулей | 4, 6 | M |
| Дашборд (модуль Курс) | 4 | M |
| Реестр (модуль След пути) | 4 | M |
| Сканнер 2.0 (модуль Команда) — главный экран | 4 | L |
| Чёрный дашборд (модуль Цели) | 4 | M |
| AI Чат (модуль Ритуалы) | 4 | M |
| Снос gradient'ов в `.summary-super-hero / .metrics-hero` | 4 | S |
| Кнопки primary / secondary / ghost под brandbook | 4 | S |
| KPI-card под brandbook (semantic state, без accent цветов) | 4 | M |
| Toast / Modal / Tooltip компоненты | 4 | S |
| TOV-rename в системных сообщениях | 11 | M |
| Splash screen (новый) | 6 | M |
| Pulse-loader, page-loader, skeleton-loader | 6 | M |
| **Smoke test:** 5-сек тест узнаваемости (5 респондентов) | 1 | S |

**Готово когда:** 5/10 респондентов узнают «Призму» по любому скриншоту главных экранов.

### Волна 3 (sprint 5-6, ~2 недели) — подразделы и cleanup

**Цель:** все 23 раздела на новом языке, cleanup токенов, accessibility-audit пройден.

| Задача | Кто | Размер |
|---|---|---|
| Подразделы Курса (Сводная, Метрики, Инсайты) | 4 | S |
| Подразделы След пути (Гант, Канбан, Таймлайн, Подложка, История) | 4 | M |
| Подразделы Команды (Сотрудники, Перегрузка, Здоровье компонентов) | 4 | M |
| Подразделы Целей (AI CEO, Action Layer, AI Анализ) | 4 | M |
| Подразделы Ритуалов (Точность оценок, Документация: долги, Onboarding) | 4 | M |
| Settings drawer (Интеграции, Ошибки, Диагностика, App Settings) | 4 | M |
| Полный TOV-rename во всех views (через словарь) | 11 | L |
| Rename `var(--accent)` → `var(--prizma-mark)` пофайлово | 5 | M |
| Удалить shim после rename всех мест | 5 | S |
| Accessibility audit (WCAG 2.1 AA) — полный | 10 | M |
| Color-blind testing (protanopia/deuteranopia) | 10 | S |
| Snapshot tests для всех 5 модулей | 7 | M |
| Documentation: новый brand reference в `docs/brand.md` | 11 | S |
| **Final smoke test:** 15 пилот-тимлидов, метрики §3.5 | 1, 11 | M |

**Готово когда:** все три критерия §3.5 на ≥ goal-уровне.

---

## 14. Anti-pattern'ы — что нельзя пропустить на code-review

1. **`var(--accent: #4f46e5)` где-то остался.** После cleanup-этапа Волны 3 — найти grep'ом и убить. Если кто-то добавил новый `--accent`-derived токен — отклоняем.
2. **Эмодзи в production UI.** Kept только в legend / dev-tools. Если в code-review `<span>📊</span>` на странице — отклоняем.
3. **Цветной фон карточки** (rgba(сигнал, 0.04)). Brandbook прямо запрещает signal как декорацию. Карточки — нейтральный border, signal только как stripe-left.
4. **Spinner-loader.** Если кто-то добавил `<div class="spinner">` — рефакторим на L1 inline-pulse.
5. **Mark на цветном фоне.** Mark на `--prizma-bg` (Night/Paper). Никаких «давайте слегка тонируем header'»» — это карнавализирует знак.
6. **Поворот mark или mark внутри shape (треугольник, щит).** Brandbook §12 прямой запрет.
7. **«Релиз / Спринт / Задача» в новых текстах** (вне технических терминов API). Используем словарь курса (§11).
8. **Splash при каждом open приложения.** Splash — только при cold-start (auth-flow, первое открытие после установки). На F5 — не показывать.
9. **CAPS заголовки** (h1 UPPERCASE, как было в Editorial-предложении). Brandbook §4 — CAPS только для Caption (11px ls 1.5px). H1 mixed-case.
10. **Анимации без reduced-motion fallback.** Каждый `@keyframes` должен иметь `@media (prefers-reduced-motion: reduce)` правило.

---

## 15. Что не делается в этом плане

| Что | Почему отложено |
|---|---|
| **PWA-manifest** + offline-mode | Внутренний банковский tool, не consumer. До решения по mobile-стратегии. |
| **Полный motion для micro-interactions** (hover-states, button-press) | Brandbook определяет 4 жеста для mark'а; для остальных — стандартные 240ms ease-out. Подробный motion-language — отдельная итерация после Волны 3. |
| **Локализация на английский** | Кириллица — primary. Если pilot-success приведёт к expansion — отдельный проект. |
| **Иллюстрации модулей в hero-блоках** | Brandbook §11 — только звезда + число. Никаких иллюстраций. Если когда-то понадобится — отдельное обсуждение. |
| **Тёмная и светлая темы — оба готовы** | Brandbook покрывает. Auto-detection через `prefers-color-scheme`. Если pilot покажет проблему — отдельный аудит. |
| **Sound design** (нотификации) | Brandbook не покрывает. До решения по мобильной стратегии. |
| **Vault-integration для secrets, audit log для config-mutations** | Это PR из Phase 2 backlog'а (security), не относится к редизайну. |
| **server.js split, regression tests для PR-CV/CG/CJ** | Это P1 backlog, отдельная work-stream. Параллельно с редизайном. |

---

## 16. Решения по open-questions (зафиксировано 2026-05-03)

| # | Вопрос | Решение |
|---|---|---|
| 1 | Slug'и модулей | **Английские** (`goals`, `rituals`, `path`, `team`, `course`) — для grep-навигации |
| 2 | «Релиз» в TOV | **Оставить** как технический термин Jira fixVersion |
| 3 | Splash в Web app | **На каждом F5** — играется 2.4 сек всегда (даже если данные готовы) |
| 4 | «Чёрный дашборд» name | **Оставить** как есть |
| 5 | Sigma isolation ADR | **Создан** — [docs/sigma-isolation.md](../../docs/sigma-isolation.md) |
| 6 | A11y audit cadence | **Skip** — не делаем (заказчик: «забей») |
| 7 | Удалить `design-audit/prisma-brand/` (Editorial 6 лучей) | **Deprecated сейчас** ([DEPRECATED.md](../prisma-brand/DEPRECATED.md)), физически удалить в Волне 3 |

### Последствия решения #6 (skip a11y)

A11y audit убран из Волны 3. Базовая поддержка остаётся:
- `prefers-reduced-motion: reduce` — обязательна (уже в плане motion §8.2)
- `aria-label` на mark и module-indicator — обязательно
- Keyboard navigation (Tab/Esc) — стандартно

Полноценный WCAG 2.1 AA audit (Lighthouse, screen-reader testing, color-blind simulator) — **за рамками текущего проекта**. Если регулятор (банк-compliance) потребует — отдельный спринт.

### Последствия решения #3 (splash на каждом F5)

Тимлид делает 100+ F5 в день → 100 × 2.4 сек = 4 минуты splash-времени за рабочий день. Это осознанное решение: бренд выше скорости. **Не редактируется без консультации с заказчиком.**

Альтернативы если pilot покажет жалобы:
- Skip splash для same-session reload (`sessionStorage.firstShown`)
- Skip splash при `window.performance.navigation.type === reload`
- Уменьшить duration с 2400ms до 1200ms (только emerge без settle)

Не делаем сейчас — следим в Волне 3.

---

## 17. Финальная рекомендация (от меня)

**Делаем по этому плану. Брендбук `my_prisma-brand` — single source of truth.**

Перед стартом — обсудить 7 open-questions выше с заказчиком (~30 минут). Затем — Волна 1 (~2 недели), 5-сек smoke-test, далее Волна 2 + Волна 3.

Если на любом этапе один из 3 critical-метрик §3.5 не движется в нужную сторону — пауза, retrospective, корректировка плана. Не «допиливаем upfront». Pilot-feedback — главный сигнал.

---

**Дата:** 2026-05-03
**Статус:** черновик, готов к review с заказчиком
**Следующий шаг:** обсуждение open-questions §16 + старт Волны 1
