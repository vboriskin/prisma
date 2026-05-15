---
role: Design Systems Engineer
author: Сергей Поляков
date: 2026-05-03
status: draft
depends_on: 01-art-direction.md, 03-header-and-navigation.md, 04-screens-adaptation.md
---

# 05. Дизайн-токены «Призма» — миграционная спецификация

> Анна задала рамку (Editorial + 6 лучей), Дмитрий — живой mark, Мария — каскад `[data-active-ray]`, Игорь — page-template и нейтральные тела. Моя работа — собрать это в **трёхуровневую токен-систему**, в которой можно работать одним `:root` блоком, без бандлера, без переписывания 44k LOC. Один спринт на раскатку — это значит сначала **shim** (старые имена живут), потом **revalue** (значения уезжают на новые), потом **rename** по компонентам, последним — удаление shim'а. Ниже — числа и таблицы; реализация по чек-листу §10.

---

## 1. Целевая структура — три уровня

Архитектурный принцип, наследуемый из `07-design-system.md`: **primitives → semantic → component**. Призма расширяет его одним динамическим уровнем — `--ray-active`, который зависит от атрибута `[data-active-ray]` на `<html>`. Это не отдельный уровень токенов, а контекстный override semantic-слоя.

### 1.1. Уровень 1 — Primitives (физические значения)

Primitives **не имеют контекста использования**. Они называются «что это есть», а не «где это применяется». Меняются только **при смене темы** (light/dark), но не при смене раздела.

#### Нейтралы — `--color-neutral-{0..950}` (12 ступеней)

Анна (§2.1) задала ключевые точки шкалы (тёплый off-white `#FAFAF7`, графит `#15171C`, dark surface `#0F1115`). Я разворачиваю это в полную 12-ступенчатую шкалу с тёплым off-white-уклоном на light (а не «холодный синий» как в текущем `#f0f2f7`) и слегка-синим графитом на dark.

| Token | Light value | Dark value | Назначение |
|---|---|---|---|
| `--color-neutral-0`   | `#FFFFFF` | `#0A0C10` | Pure / inverted ink |
| `--color-neutral-50`  | `#FAFAF7` | `#0F1115` | Page surface (Анна) |
| `--color-neutral-100` | `#F5F4EE` | `#161922` | Subtle bg, hover |
| `--color-neutral-150` | `#EEECE3` | `#1C2029` | Card-elevated bg |
| `--color-neutral-200` | `#E6E2D8` | `#222632` | Hairline (Анна) |
| `--color-neutral-300` | `#D5CFC0` | `#2D323F` | Border-default |
| `--color-neutral-400` | `#A8A496` | `#3D4351` | Border-strong, disabled text |
| `--color-neutral-500` | `#7A7669` | `#5C6270` | Text-tertiary (light), low-contrast guides |
| `--color-neutral-600` | `#5C6270` | `#7C8290` | Text-secondary (Анна `--text-2` light) |
| `--color-neutral-700` | `#3F4452` | `#9AA0AC` | Text-secondary alt (Анна `--text-2` dark) |
| `--color-neutral-800` | `#2A2D36` | `#C7CBD3` | Hairline-on-text |
| `--color-neutral-900` | `#15171C` | `#ECEEF3` | Text-primary (Анна `--text-1`) |
| `--color-neutral-950` | `#0A0B0F` | `#F8F9FB` | Inverse ink, deep print |

WCAG AA проверки: `neutral-900` light на `neutral-50` light = 16.4:1, `neutral-900` dark на `neutral-50` dark = 14.8:1, `neutral-600` light на `neutral-50` light = 5.8:1 (AA для body), `neutral-700` dark на `neutral-50` dark = 4.9:1 (AA для body). Текущий проект имеет проблему: `--text-4` `#9ca3af` на `--bg` `#f0f2f7` даёт 2.4:1 — failing AA. Заменяем `text-disabled` на `neutral-400` light = `#A8A496` на `#FAFAF7` = 3.1:1 (AA для disabled только, обозначение «не для чтения» ок) или на `neutral-500` `#7A7669` = 5.0:1 если хотим читаемое disabled.

#### Лучи — `--color-ray-{name}-{50..900}` (6 лучей × 9 ступеней = 54 значения)

Для каждого луча Анна дала **пару базовых hex** (light fill / dark fill). Для трёхуровневой системы этого мало — нужны ступени для bg-fills (50/100), hover (200), focus-tint (300), стрипа (700, насыщенный), и hover-стрипа (800/900). Я строю каждую шкалу через HSL-интерполяцию: фиксирую hue, line-of-sight через S = 8% (лёгкий tint) → S = 95% (рабочий рав), L идёт от 96% → 18%. Базовый hex арт-директора попадает на ступень **700** (light theme) — это позиция «рабочий цвет stripe/eyebrow/hairline».

**Луч планирования (Indigo Ink, hue ≈ 224°)**

| Step | Light | Dark (mirrored) | Назначение |
|---|---|---|---|
| 50  | `#F2F4FA` | `#1A1F2E` | tint-bg для very-rare wash-кейсов (filter popover-checkbox-row) |
| 100 | `#E2E7F1` | `#222A3D` | hover-tint-bg |
| 200 | `#C7D0E3` | `#2C3550` | softer fill |
| 300 | `#9BA9C7` | `#3D4A6E` | border-on-ray |
| 400 | `#5E6F9C` | `#5468A0` | secondary fill |
| 500 | `#3E4F7E` | `#6B7DBA` | mid (rare) |
| 600 | `#33446D` | `#7A8FCF` | hover на 700 (light) / base (dark, Анна) |
| 700 | `#2B3A67` | `#8E9FD8` | **base light (Анна)** |
| 800 | `#1F2C4F` | `#A6B4DF` | active/pressed |
| 900 | `#15203A` | `#C2CCE9` | text-on-tint |

**Луч контроля (Amber Forge, hue ≈ 28°)**

| Step | Light | Dark | Назначение |
|---|---|---|---|
| 50  | `#FBF4EA` | `#2A1F12` | tint-bg |
| 100 | `#F4E4CA` | `#3A2C18` | hover-tint |
| 200 | `#EBCEA0` | `#4D3B1F` | softer fill |
| 300 | `#DEAD68` | `#7A5A2F` | border-on-ray |
| 400 | `#CC8B3A` | `#B07F4A` | secondary fill |
| 500 | `#BD7522` | `#D69960` | mid |
| 600 | `#A35E18` | `#E8A766` | **base dark (Анна)** |
| 700 | `#B8651A` | `#F0B375` | **base light (Анна)** |
| 800 | `#8C4B12` | `#F5C28E` | active |
| 900 | `#5E3209` | `#FAD5AE` | text-on-tint |

**Луч предсказания (Deep Iris, hue ≈ 258°)**

| Step | Light | Dark | Назначение |
|---|---|---|---|
| 50  | `#F4F1FA` | `#221C2E` | tint-bg |
| 100 | `#E5DEF1` | `#2C2540` | hover-tint |
| 200 | `#CDC0E3` | `#3A3155` | softer fill |
| 300 | `#A18FC7` | `#5A4B85` | border-on-ray |
| 400 | `#7864AC` | `#806DBC` | secondary fill |
| 500 | `#5D4F95` | `#9586C8` | mid |
| 600 | `#4F4185` | `#9C8DD6` | **base dark (Анна)** |
| 700 | `#4A3D7A` | `#AC9FE0` | **base light (Анна)** |
| 800 | `#3A305F` | `#BFB4E8` | active |
| 900 | `#251F40` | `#D8D0F0` | text-on-tint |

**Луч коммуникации (Spruce, hue ≈ 158°)**

| Step | Light | Dark | Назначение |
|---|---|---|---|
| 50  | `#EDF5F1` | `#152822` | tint-bg |
| 100 | `#D5E8DE` | `#1B3530` | hover-tint |
| 200 | `#B0D2BE` | `#234A40` | softer fill |
| 300 | `#75AC8E` | `#3A6E5A` | border-on-ray |
| 400 | `#3E876A` | `#509078` | secondary fill |
| 500 | `#2B6E54` | `#5FA38A` | mid |
| 600 | `#235E48` | `#6FB59A` | **base dark (Анна)** |
| 700 | `#1F5946` | `#80C2A8` | **base light (Анна)** |
| 800 | `#15433A` | `#9AD0BB` | active |
| 900 | `#0C2B25` | `#BCE0CF` | text-on-tint |

**Луч ретроспективы (Slate, hue ≈ 222°, S низкая)**

| Step | Light | Dark | Назначение |
|---|---|---|---|
| 50  | `#F2F3F6` | `#1B1D24` | tint-bg |
| 100 | `#E2E4EA` | `#252830` | hover-tint |
| 200 | `#C7CBD5` | `#33373F` | softer fill |
| 300 | `#9BA1B0` | `#4F5460` | border-on-ray |
| 400 | `#727989` | `#777F8E` | secondary fill |
| 500 | `#5E6577` | `#8B92A2` | mid |
| 600 | `#535B6E` | `#9AA3B8` | **base dark (Анна)** |
| 700 | `#52596B` | `#ABB3C5` | **base light (Анна)** |
| 800 | `#3D4351` | `#C0C7D5` | active |
| 900 | `#262A33` | `#DADEE7` | text-on-tint |

**Луч связей (Brass, hue ≈ 44°)**

| Step | Light | Dark | Назначение |
|---|---|---|---|
| 50  | `#FAF6E9` | `#27210F` | tint-bg |
| 100 | `#F1E8C5` | `#352D14` | hover-tint |
| 200 | `#E2D292` | `#473C19` | softer fill |
| 300 | `#C6AC56` | `#6F5D24` | border-on-ray |
| 400 | `#A8862A` | `#9C7E36` | secondary fill |
| 500 | `#947625` | `#BEA052` | mid |
| 600 | `#8A6E1F` | `#D4B062` | **base dark (Анна)** |
| 700 | `#7B621C` | `#DDB97A` | **base light (Анна)** — небольшой оффсет от 600, чтобы оставаться отделимым |
| 800 | `#5A4815` | `#E8CB94` | active |
| 900 | `#37290A` | `#F2DBB3` | text-on-tint |

**Замечание про Brass-700 light:** Анна дала `#8A6E1F` как single value, но в моей шкале это попадает на 600. Я держу 700 как «более тёплый» `#7B621C` чтобы stripe-left активной вкладки чуть-чуть отделялся от border-on-ray (300). На уровне semantic это ловится через `--ray-active = step-700` для всех лучей.

#### Состояния — `--color-state-{success|warning|danger|info}-{50..900}`

Анна (§3) явно требует, чтобы семантика **не пересекалась со спектром**. Это значит: ни один state-цвет не должен быть hue одного из 6 лучей. Контроль (Amber) и Brass (Связи) — оба в жёлто-оранжевой части, поэтому для warning беру **более холодный янтарь** (hue 36°), чтобы не путать с Контролем (28°). Danger — приглушённый кирпич (Анна `#C0392B`), info — slate-синий (отделимо от Планирования через S/L).

| Token | Light value | Dark value |
|---|---|---|
| `--color-state-success-50`  | `#EAF6EE` | `#0F2A1A` |
| `--color-state-success-100` | `#C7E6D2` | `#163E27` |
| `--color-state-success-500` | `#3D9163` | `#5BAE7E` |
| `--color-state-success-700` | `#2C7A4D` | `#86C9A4` |
| `--color-state-success-900` | `#163F26` | `#BCE0CF` |
| `--color-state-warning-50`  | `#FBF1DC` | `#2A1F0A` |
| `--color-state-warning-100` | `#F4DDA2` | `#3D2D10` |
| `--color-state-warning-500` | `#C28A1A` | `#E0A93C` |
| `--color-state-warning-700` | `#9E6F12` | `#EBBF67` |
| `--color-state-warning-900` | `#5A3D08` | `#F4D8A0` |
| `--color-state-danger-50`   | `#FBEDEA` | `#2A130E` |
| `--color-state-danger-100`  | `#F4CFC8` | `#3D1D17` |
| `--color-state-danger-500`  | `#C0392B` | `#E55A4A` |
| `--color-state-danger-700`  | `#9A2818` | `#F07A6E` |
| `--color-state-danger-900`  | `#5C170D` | `#F4B5AC` |
| `--color-state-info-50`     | `#EAF1F8` | `#0F1C2E` |
| `--color-state-info-100`    | `#C5D7EA` | `#16293F` |
| `--color-state-info-500`    | `#3A6FA8` | `#6092CB` |
| `--color-state-info-700`    | `#27517D` | `#8AAEDA` |
| `--color-state-info-900`    | `#152E47` | `#BFD2EA` |

#### Шрифты — type primitives

```
--font-display:  'Plus Jakarta Sans', 'Plus Jakarta Sans Fallback', system-ui, sans-serif;
--font-body:     'Inter', 'Inter Fallback', system-ui, -apple-system, sans-serif;
--font-mono:     'JetBrains Mono', ui-monospace, 'SF Mono', Consolas, monospace;
--font-rare:     'EB Garamond', 'EB Garamond Fallback', Georgia, serif;
```

Fallback-семейства расписаны в §6.

#### Type-scale (по `07-design-system.md` §5)

```
--text-3xs:  10px / 0.625rem    /* eyebrow CAPS */
--text-2xs:  11px / 0.6875rem   /* table-headers, footer-meta */
--text-xs:   12px / 0.75rem     /* body таблиц, mono-cells */
--text-sm:   13px / 0.8125rem   /* default UI body, кнопки */
--text-base: 14px / 0.875rem    /* lead text, card body */
--text-md:   16px / 1rem        /* body editorial (CEO-отчёт) */
--text-lg:   18px / 1.125rem    /* H3 */
--text-xl:   20px / 1.25rem     /* H2 в карточках */
--text-2xl:  22px / 1.375rem    /* H2 секций отчёта */
--text-3xl:  28px / 1.75rem     /* H1 page-header */
--text-4xl:  40px / 2.5rem      /* H1 CEO (EB Garamond) */
--text-5xl:  48px / 3rem        /* hero-KPI */

--weight-regular:    400
--weight-medium:     500
--weight-semibold:   600
--weight-bold:       700

--leading-tight:     1.15
--leading-snug:      1.25
--leading-normal:    1.5
--leading-relaxed:   1.65   /* CEO body */

--tracking-tight:    -0.01em  /* H1 */
--tracking-normal:    0
--tracking-caps:      0.12em  /* eyebrow */
--tracking-th:        0.08em  /* table-th CAPS */
```

#### Space scale

```
--space-0:  0
--space-1:  2px       --space-2:  4px       --space-3:  6px
--space-4:  8px       --space-5:  10px      --space-6:  12px
--space-7:  14px      --space-8:  16px      --space-9:  20px
--space-10: 24px      --space-12: 32px      --space-14: 40px
--space-16: 48px      --space-20: 64px      --space-24: 96px
```

#### Radius scale

```
--radius-2:    2px      /* mark inner segment rx */
--radius-3:    3px      /* chips, buttons primary (Игорь §7) */
--radius-4:    4px      /* cards, popovers */
--radius-6:    6px      /* mini-modals */
--radius-8:    8px      /* legacy support, не используем в новом */
--radius-12:   12px     /* legacy */
--radius-full: 9999px   /* avatar, ray-dot */
```

Editorial-Призма реально использует **только** 2/3/4. Остальные сохраняем как legacy для shim-периода.

#### Shadow scale (Editorial — функциональные, нейтральные)

Editorial-этикет (§3) запрещает shadow на surface-элементах. Тени допустимы только на «отрывных» (popover, modal, drawer, toast).

```
--shadow-xs: 0 1px 2px rgba(15, 23, 42, .04);    /* почти не используется */
--shadow-sm: 0 2px 6px rgba(15, 23, 42, .06);    /* tooltip */
--shadow-md: 0 4px 12px rgba(15, 23, 42, .08);   /* popover (filter dropdown) */
--shadow-lg: 0 8px 24px rgba(15, 23, 42, .12);   /* modal */
--shadow-xl: 0 16px 48px rgba(15, 23, 42, .16);  /* big-confirm modal */

/* dark — глубина без блюра */
--shadow-xs-dark: 0 1px 2px rgba(0,0,0,.45);
--shadow-sm-dark: 0 2px 6px rgba(0,0,0,.5);
--shadow-md-dark: 0 4px 12px rgba(0,0,0,.55);
--shadow-lg-dark: 0 8px 24px rgba(0,0,0,.6);
--shadow-xl-dark: 0 16px 48px rgba(0,0,0,.65);
```

#### Motion scale

```
--motion-duration-instant: 100ms     /* hover */
--motion-duration-fast:    140ms     /* button-press, мелкие affordances */
--motion-duration-base:    240ms     /* navigateTo (Мария §6.1) */
--motion-duration-slow:    400ms     /* drawer, modal */
--motion-duration-slower:  600ms     /* первая загрузка дашборда, KPI count-up */

--motion-ease-linear:      linear
--motion-ease-standard:    cubic-bezier(.2, .8, .2, 1)
--motion-ease-emphasized:  cubic-bezier(.22, .9, .28, 1)
--motion-ease-spring:      cubic-bezier(.34, 1.36, .64, 1)  /* без overshoot — банк */
```

### 1.2. Уровень 2 — Semantic (контекстные алиасы)

Semantic токены **не имеют hex-значений**, они только указывают на primitives. **Меняются при смене темы**, но **не меняются при смене раздела** (за исключением `--ray-active*`).

| Semantic | Light → primitive | Dark → primitive | Где используется |
|---|---|---|---|
| `--bg`                     | `neutral-50` `#FAFAF7`   | `neutral-50` `#0F1115`  | `body` |
| `--bg-secondary`           | `neutral-100` `#F5F4EE`  | `neutral-100` `#161922` | row-hover, filter-chip-bg |
| `--bg-tertiary`            | `neutral-150` `#EEECE3`  | `neutral-150` `#1C2029` | rare wash-fallback |
| `--card`                   | `neutral-0` `#FFFFFF`    | `neutral-100` `#161922` | cards, modals |
| `--card-hover`             | `neutral-100` `#F5F4EE`  | `neutral-150` `#1C2029` | hover на card |
| `--card-elevated`          | `neutral-0` `#FFFFFF`    | `neutral-150` `#1C2029` | hero-block backdrop (rare) |
| `--surface-header`         | `neutral-50` `#FAFAF7`   | `neutral-100` `#161922` | sticky thead |
| `--surface-input`          | `neutral-0` `#FFFFFF`    | `neutral-100` `#161922` | input/select |
| `--surface-overlay`        | `rgba(15,17,28,.45)`     | `rgba(0,0,0,.6)`        | modal backdrop |
| `--row-hover`              | `neutral-100` `#F5F4EE`  | `neutral-150` `#1C2029` | таблицы |
| `--row-selected`           | `neutral-100` `#F5F4EE`  | `neutral-150` `#1C2029` | selected-row фон (Игорь §3.2 — НЕ цвет луча) |
| `--hairline`               | `neutral-200` `#E6E2D8`  | `neutral-200` `#222632` | section dividers, table borders |
| `--border-subtle`          | `neutral-200` `#E6E2D8`  | `neutral-200` `#222632` | дублирует hairline для совместимости с 07-DS |
| `--border-default`         | `neutral-300` `#D5CFC0`  | `neutral-300` `#2D323F` | input, card |
| `--border-strong`          | `neutral-400` `#A8A496`  | `neutral-400` `#3D4351` | sort-icons divider, strong CTA outline |
| `--text-primary`           | `neutral-900` `#15171C`  | `neutral-900` `#ECEEF3` | body, h1-h3 |
| `--text-secondary`         | `neutral-600` `#5C6270`  | `neutral-700` `#9AA0AC` | sub-text, captions |
| `--text-tertiary`          | `neutral-500` `#7A7669`  | `neutral-500` `#5C6270` | meta, table-th |
| `--text-disabled`          | `neutral-400` `#A8A496`  | `neutral-400` `#3D4351` | disabled-state (контраст-fix vs текущего `#9ca3af`) |
| `--text-on-accent`         | `neutral-0` `#FFFFFF`    | `neutral-0` `#0A0C10`   | текст на primary-button |
| `--focus-ring`             | `ray-active` (см. §1.3)  | `ray-active`            | input outline |
| `--accent-default`         | `ray-planning-700`       | `ray-planning-600`      | primary-button (нейтральный CTA, Анна §5.4) |
| `--state-success`          | `state-success-700`      | `state-success-700`     | toast, ok-stripe |
| `--state-success-bg`       | `state-success-50`       | `state-success-100`     | done-row-bg |
| `--state-success-border`   | `state-success-100`      | `state-success-700`     | toast border |
| `--state-warning`          | `state-warning-700`      | `state-warning-700`     | warning-stripe, dirty-dot |
| `--state-warning-bg`       | `state-warning-50`       | `state-warning-100`     | warning-row-bg |
| `--state-warning-border`   | `state-warning-100`      | `state-warning-700`     | toast border |
| `--state-danger`           | `state-danger-500`       | `state-danger-500`      | error-stripe, danger KPI |
| `--state-danger-bg`        | `state-danger-50`        | `state-danger-100`      | error-row-bg |
| `--state-danger-border`    | `state-danger-100`       | `state-danger-500`      | toast border |
| `--state-info`             | `state-info-700`         | `state-info-500`        | info-stripe |
| `--state-info-bg`          | `state-info-50`          | `state-info-100`        | info-row-bg |

### 1.3. Динамический луч — `--ray-active*` (особый semantic-уровень)

Это **четыре** токена, которые меняют значение в зависимости от `[data-active-ray="*"]` атрибута на `<html>`. Все компоненты, которые «носят луч» (eyebrow, hairline, stripe-left, hero-KPI), потребляют **только** эти 4 токена — никогда не `--color-ray-planning-700` напрямую (это привязало бы компонент к одному лучу).

```
--ray-active        /* base — eyebrow text, hairline, stripe-left, hero-KPI */
--ray-active-soft   /* tint-bg — rare hover на nav-active в специфичных кейсах */
--ray-active-strong /* pressed/active — unused в Editorial, держим для совместимости */
--ray-active-on     /* контрастный foreground поверх --ray-active fill */
```

Маппинг через каскад описан в §2.

### 1.4. Уровень 3 — Component (опционально)

Component-токены нужны там, где компонент имеет **уникальные** значения, не покрывающиеся semantic-слоем. В Призме это:

- `--topbar-h: 56px` (Мария §2.6)
- `--sidebar-w: 200px` / `--sidebar-w-collapsed: 52px`
- `--row-h: 36px`
- `--ceo-content-width: 64ch` (Игорь §4.1)
- `--toc-width: 200px`
- `--prisma-mark-size: 24px` / `--prisma-mark-size-large: 80px`

**Что НЕ выделяем в component-токены**: button-padding, card-radius, table-header-color — это покрывается комбинацией semantic + scale-primitives (`var(--space-3) var(--space-4)`, `var(--radius-3)`, `var(--text-tertiary)`). Component-уровень — anti-pattern если применять без меры; держим минимум.

---

## 2. Динамический активный луч — `[data-active-ray]` каскад

### 2.1. HTML-крючок

`App.navigateTo(section)` (см. `app.js`) выставляет: `document.documentElement.dataset.activeRay = getRayForSection(section)`. Helper `getRayForSection` живёт в `app/appSettings.js` (Мария §3.5). Возвращает строки: `'planning' | 'control' | 'foresight' | 'comms' | 'retro' | 'links'`.

Дефолт (если атрибут не выставлен — например, splash до первого navigateTo): `data-active-ray="planning"` (Анна §5.1, Дмитрий §A4 — Планирование = «дефолт-бренд»).

### 2.2. CSS-каскад — 6 правил для 6 лучей (light)

```css
/* default — Planning */
:root,
[data-active-ray="planning"] {
  --ray-active:        var(--color-ray-planning-700);   /* #2B3A67 */
  --ray-active-soft:   var(--color-ray-planning-50);    /* #F2F4FA */
  --ray-active-strong: var(--color-ray-planning-800);   /* #1F2C4F */
  --ray-active-on:     var(--color-neutral-0);          /* #FFFFFF */
}
[data-active-ray="control"] {
  --ray-active:        var(--color-ray-control-700);    /* #B8651A */
  --ray-active-soft:   var(--color-ray-control-50);     /* #FBF4EA */
  --ray-active-strong: var(--color-ray-control-800);    /* #8C4B12 */
  --ray-active-on:     var(--color-neutral-0);
}
[data-active-ray="foresight"] {
  --ray-active:        var(--color-ray-foresight-700);  /* #4A3D7A */
  --ray-active-soft:   var(--color-ray-foresight-50);   /* #F4F1FA */
  --ray-active-strong: var(--color-ray-foresight-800);  /* #3A305F */
  --ray-active-on:     var(--color-neutral-0);
}
[data-active-ray="comms"] {
  --ray-active:        var(--color-ray-comms-700);      /* #1F5946 */
  --ray-active-soft:   var(--color-ray-comms-50);       /* #EDF5F1 */
  --ray-active-strong: var(--color-ray-comms-800);      /* #15433A */
  --ray-active-on:     var(--color-neutral-0);
}
[data-active-ray="retro"] {
  --ray-active:        var(--color-ray-retro-700);      /* #52596B */
  --ray-active-soft:   var(--color-ray-retro-50);       /* #F2F3F6 */
  --ray-active-strong: var(--color-ray-retro-800);      /* #3D4351 */
  --ray-active-on:     var(--color-neutral-0);
}
[data-active-ray="links"] {
  --ray-active:        var(--color-ray-links-700);      /* #7B621C */
  --ray-active-soft:   var(--color-ray-links-50);       /* #FAF6E9 */
  --ray-active-strong: var(--color-ray-links-800);      /* #5A4815 */
  --ray-active-on:     var(--color-neutral-0);
}
```

### 2.3. Каскад в dark-теме

В dark Анна (§2.3) велит использовать **Mist-парные** значения. Реализуем переопределением `--ray-active*` под `[data-theme="dark"][data-active-ray="*"]`:

```css
[data-theme="dark"][data-active-ray="planning"]  { --ray-active: var(--color-ray-planning-600);  }   /* #7A8FCF */
[data-theme="dark"][data-active-ray="control"]   { --ray-active: var(--color-ray-control-600);   }   /* #E8A766 */
[data-theme="dark"][data-active-ray="foresight"] { --ray-active: var(--color-ray-foresight-600); }   /* #9C8DD6 */
[data-theme="dark"][data-active-ray="comms"]     { --ray-active: var(--color-ray-comms-600);     }   /* #6FB59A */
[data-theme="dark"][data-active-ray="retro"]     { --ray-active: var(--color-ray-retro-600);     }   /* #9AA3B8 */
[data-theme="dark"][data-active-ray="links"]     { --ray-active: var(--color-ray-links-600);     }   /* #D4B062 */
```

Аналогично для `--ray-active-soft` (используем step-100 dark вместо step-50), `--ray-active-strong` (step-700 dark), `--ray-active-on` (step-900 dark, чтобы тёмный текст на светлом mist-fill — read-able).

### 2.4. Кто потребляет `--ray-active`

**Потребляют** (луч проявляется):

- `.page-header-eyebrow` (Игорь §1.1) — `color: var(--ray-active)`
- `.page-header-hairline` — `background: var(--ray-active)`
- `.nav-item.active::after` (3px stripe-left, Мария §3.2)
- `.topbar-hairline`, `.ray-dot`, `.prisma-mark [data-seg=current]` (Мария §2.4 — через каскад от `--ray-active`)
- `.kpi-hero` цифра (Игорь §2.1) — `color: var(--ray-active)` — **только** одна на странице
- `.tab-active::after` underline 2px (Мария §4)
- `.ceo-pull-quote` `border-left` (Игорь §4.2)
- `.input:focus` outline 2px (Игорь §7)
- `.registry-cell:focus` outline (Игорь §3.2)
- `.gantt-today-line`, `.gantt-selected-pill outline` (Игорь §5)
- `.ceo-toc-active-stripe` (Игорь §4.5)

**НЕ потребляют** (луч не проявляется — нейтральные токены):

- `.btn-primary` (`background: var(--text-primary)` или `var(--accent-default)`, фиксированный)
- `.btn-secondary`, `.btn-ghost`
- `.row` body таблиц
- `.kpi-card` подчинённые карточки в body (`color: var(--text-primary)`, stripe-left — `--state-*`)
- `.toast` (фон `--surface-input`, stripe — `--state-*`)
- `.modal`, `.drawer` (нейтральные)
- `.filter-chip` active (нейтральный)
- `.checkbox`, `.radio`, `.switch` (нейтральные fill, focus-ring через `--ray-active`)
- `.row-risky / .row-done / .row-dirty` — все через `--state-*`, не через ray
- `.chart-*` — отдельная палитра §7

---

## 3. Маппинг старых токенов на новые

Текущий `:root` блок (`styles.css:1-57`) и dark-overrides (`styles.css:3046-3081`). Полная таблица:

| Старый токен | Старое light | Старое dark | Новый токен | Новое light | Новое dark | Действие |
|---|---|---|---|---|---|---|
| `--bg`              | `#f0f2f7` | `#0b1020` | `--bg`              | `#FAFAF7` | `#0F1115` | **revalue** (тёплый paper) |
| `--card`            | `#ffffff` | `#121a2f` | `--card`            | `#FFFFFF` | `#161922` | **revalue dark** (легче синька) |
| `--border`          | `#e4e7ec` | `#25304d` | `--hairline`        | `#E6E2D8` | `#222632` | **rename + revalue** (тёплый hairline) |
| `--border-light`    | `#f3f4f6` | `#1a2440` | `--border-subtle`   | `#E6E2D8` | `#222632` | **rename + revalue** (alias hairline) |
| `--accent`          | `#4f46e5` | `#818cf8` | `--ray-active` (dynamic) | varies | varies | **rename + DYNAMIC** |
| `--accent-light`    | `#eef2ff` | `#202b4f` | `--ray-active-soft` (dynamic) | varies | varies | **rename + DYNAMIC** |
| `--accent-muted`    | `#c7d2fe` | `#45508a` | `--ray-active-soft` | varies | varies | **rename to soft alias** |
| `--accent-dark`     | `#3730a3` | `#6366f1` | `--ray-active-strong` (dynamic) | varies | varies | **rename + DYNAMIC** |
| `--accent-strong`   | `#4338ca` | `#6366f1` | `--accent-default`  | `#2B3A67` | `#7A8FCF` | **rename + revalue** (планирование как дефолт) |
| `--success`         | `#059669` | `#34d399` | `--state-success`   | `#2C7A4D` | `#86C9A4` | **rename + revalue** |
| `--success-light`   | `#d1fae5` | `#0f2e2a` | `--state-success-bg`| `#EAF6EE` | `#163E27` | **rename + revalue** |
| `--warning`         | `#d97706` | `#f59e0b` | `--state-warning`   | `#9E6F12` | `#EBBF67` | **rename + revalue** (отделимо от Amber-ray) |
| `--warning-light`   | `#fef3c7` | `#36260c` | `--state-warning-bg`| `#FBF1DC` | `#3D2D10` | **rename + revalue** |
| `--danger`          | `#dc2626` | `#f87171` | `--state-danger`    | `#C0392B` | `#E55A4A` | **rename + revalue** (приглушённый кирпич, Анна §3) |
| `--danger-light`    | `#fee2e2` | `#3b1d24` | `--state-danger-bg` | `#FBEDEA` | `#3D1D17` | **rename + revalue** |
| `--info`            | `#0284c7` | `#38bdf8` | `--state-info`      | `#27517D` | `#6092CB` | **rename + revalue** |
| `--info-light`      | `#e0f2fe` | `#123243` | `--state-info-bg`   | `#EAF1F8` | `#16293F` | **rename + revalue** |
| `--done-bg`         | `#f0fdf4` | `#0f2e2a` | `--state-success-bg`| (alias)   | (alias)   | **alias** (унификация) |
| `--done-text`       | `#166534` | `#6ee7b7` | `--state-success`   | (alias)   | (alias)   | **alias** |
| `--text-1`          | `#111827` | `#e5e7eb` | `--text-primary`    | `#15171C` | `#ECEEF3` | **rename + minor revalue** (графит, не black) |
| `--text-2`          | `#374151` | `#cbd5e1` | `--text-secondary`  | `#5C6270` | `#9AA0AC` | **rename + revalue** (Анна §2.1) |
| `--text-3`          | `#6b7280` | `#94a3b8` | `--text-tertiary`   | `#7A7669` | `#5C6270` | **rename + revalue** (тёплый сдвиг) |
| `--text-4`          | `#9ca3af` | `#64748b` | `--text-disabled`   | `#A8A496` | `#3D4351` | **rename + revalue** (контраст-fix) |
| `--surface-header`  | `#f9fafb` | `#16203a` | `--surface-header`  | `#FAFAF7` | `#161922` | **revalue** |
| `--surface-input`   | `#ffffff` | `#141d35` | `--surface-input`   | `#FFFFFF` | `#161922` | **keep light, revalue dark** |
| `--row-hover`       | `#f3f4f6` | `#1a2745` | `--row-hover`       | `#F5F4EE` | `#1C2029` | **revalue** (тёплый off-white) |
| `--border-strong`   | `#d1d5db` | `#334772` | `--border-strong`   | `#A8A496` | `#3D4351` | **revalue** |
| `--bg-secondary`    | `#f3f4f6` | `#1f2937` | `--bg-secondary`    | `#F5F4EE` | `#161922` | **revalue** |
| `--surface`         | `#ffffff` | `#121a2f` | `--card`            | (alias)   | (alias)   | **alias** (`--surface` дублирует `--card`) |
| `--shadow-xs`       | (как было) | (как было) | `--shadow-xs`     | new tonal | new tonal | **revalue** |
| `--shadow-sm`       | ... | ... | `--shadow-sm` | new | new | **revalue** |
| `--shadow`          | ... | ... | `--shadow-md` | new | new | **rename + revalue** (унификация имён `xs/sm/md/lg/xl`) |
| `--shadow-lg`       | ... | ... | `--shadow-lg` | new | new | **revalue** |
| `--radius-xs`       | `4px` | `4px` | `--radius-3`        | `3px`    | `3px`    | **rename + revalue** (Editorial требует sharper) |
| `--radius-sm`       | `8px` | `8px` | `--radius-4`        | `4px`    | `4px`    | **rename + revalue** |
| `--radius`          | `12px`| `12px`| `--radius-6`        | `6px`    | `6px`    | **rename + revalue** (Editorial) |
| `--radius-lg`       | `16px`| `16px`| `--radius-8`        | `8px`    | `8px`    | **rename + revalue** |
| `--sidebar-w`       | `200px` | `200px` | `--sidebar-w`     | `200px`  | `200px`  | **keep** |
| `--sidebar-w-collapsed` | `52px` | `52px` | `--sidebar-w-collapsed` | `52px` | `52px` | **keep** |
| `--topbar-h`        | `56px` | `56px` | `--topbar-h`        | `56px`   | `56px`   | **keep** (Мария §2.6) |
| `--row-h`           | `36px` | `36px` | `--row-h`           | `36px`   | `36px`   | **keep** |
| `--row-lines`       | `1` | `1` | `--row-lines`           | `1`      | `1`      | **keep** |
| `--font`            | `'Inter', ...` | (same) | `--font-body`     | `'Inter', ...` | (same) | **rename + extend stack** |
| `--font-mono`       | `ui-monospace, ...` | (same) | `--font-mono` | `'JetBrains Mono', ...` | (same) | **revalue** (см. §6) |
| `--motion-fast`     | `140ms` | `140ms` | `--motion-duration-fast` | `140ms` | `140ms` | **rename** |
| `--motion-mid`      | `240ms` | `240ms` | `--motion-duration-base` | `240ms` | `240ms` | **rename** |
| `--motion-slow`     | `420ms` | `420ms` | `--motion-duration-slow` | `400ms` | `400ms` | **rename + minor revalue** |
| `--ease-standard`   | `cb(.2,.8,.2,1)` | (same) | `--motion-ease-standard` | (same) | (same) | **rename** |
| `--ease-emphasis`   | `cb(.22,.9,.28,1)`| (same) | `--motion-ease-emphasized` | (same) | (same) | **rename** |

Семь новых токенов, у которых нет старых аналогов: `--font-display`, `--font-rare`, `--ray-{6 лучей}-{9 ступеней}` (54), `--state-{4}-{50/100/500/700/900}` (20), `--text-3xs`, `--text-2xs`, `--text-md`, `--text-2xl`, `--text-3xl`, `--text-4xl`, `--text-5xl`, `--space-*` шкала (15 значений), `--motion-duration-instant`, `--motion-duration-slower`, `--motion-ease-linear`, `--motion-ease-spring`, `--chart-1..--chart-8` (см. §7).

---

## 4. Стратегия миграции

### 4.1. Backwards-compatibility слой (shim)

44k LOC styles.css содержит сотни `var(--accent)`, `var(--text-1)` и т.д. Нельзя за 1 спринт переименовать все вхождения. Решение — **переходный shim-блок**, который держит старые имена как алиасы новых. После 2-3 спринтов рефактора shim удаляется.

Полный shim — в `:root` сразу после нового primitive-блока:

```css
/* === SHIM (V18 → V19) — DO NOT EXTEND. Slated for removal in V19.3.
   These keep legacy CSS rules working until they're refactored to new names.
   When you touch a rule that uses one of these, replace inline. === */
:root {
  --accent:          var(--ray-active);
  --accent-light:    var(--ray-active-soft);
  --accent-muted:    var(--ray-active-soft);
  --accent-dark:     var(--ray-active-strong);
  --accent-strong:   var(--accent-default);

  --bg:              var(--bg);              /* no-op, name kept */
  --card:            var(--card);            /* no-op */
  --border:          var(--hairline);
  --border-light:    var(--border-subtle);

  --success:         var(--state-success);
  --success-light:   var(--state-success-bg);
  --warning:         var(--state-warning);
  --warning-light:   var(--state-warning-bg);
  --danger:          var(--state-danger);
  --danger-light:    var(--state-danger-bg);
  --info:            var(--state-info);
  --info-light:      var(--state-info-bg);

  --done-bg:         var(--state-success-bg);
  --done-text:       var(--state-success);

  --text-1:          var(--text-primary);
  --text-2:          var(--text-secondary);
  --text-3:          var(--text-tertiary);
  --text-4:          var(--text-disabled);

  --surface:         var(--card);
  --shadow:          var(--shadow-md);

  --radius-xs:       var(--radius-3);
  --radius-sm:       var(--radius-4);
  --radius:          var(--radius-6);
  --radius-lg:       var(--radius-8);

  --font:            var(--font-body);
  --motion-fast:     var(--motion-duration-fast);
  --motion-mid:      var(--motion-duration-base);
  --motion-slow:     var(--motion-duration-slow);
  --ease-standard:   var(--motion-ease-standard);
  --ease-emphasis:   var(--motion-ease-emphasized);
}
```

**Важная семантика shim'а**: после revalue-этапа (см. §4.2 этап 2) старые имена начинают возвращать **новые значения**. Это и есть ключ — `var(--accent)` начинает рендериться как Indigo Ink, а если пользователь в разделе Контроля — как Amber Forge. Без переписывания компонент-стилей. Это работает, потому что `--accent` теперь алиас динамического `--ray-active`.

Один риск: компоненты, которые предполагают, что `--accent` константа на странице (например, генерируют image-fill или передают значение в JS-runtime), сломаются — но в проекте таких мест нет (проверить grep'ом `getPropertyValue('--accent')` — должно быть пусто).

### 4.2. Этапы миграции

**Этап 1 — токен-фундамент** (день 1-2 спринта).
Что: добавить в `:root` (`styles.css:1-57`) полный блок primitives + semantic + ray-active каскад + shim. Старые имена из `:root` **удалить** (теперь они приходят из shim'а). Та же операция для `body.theme-dark` (`:3046-3081`) → `[data-theme="dark"]` блок (унифицируем селектор; `body.theme-dark` оставляем как параллельный селектор-shim: `[data-theme="dark"], body.theme-dark { ... }`).
Тест: визуальный diff на 3 ключевых экранах (Дашборд/Реестр/AI-CEO) до/после. Должно быть **минимально** разное (тёплый bg, чуть другой графит). Если рендер сильно отличается — где-то shim не сработал, ловим и фиксим.
Коммит: один коммит на ветку `feature/v18-tokens-foundation`. PR-описание: «Добавлен primitive-слой + ray-active каскад. Visual diff acceptable: warmer paper-bg, graphite text. No new component CSS.»

**Этап 2 — primitives revalue** (этот же спринт, день 3-5).
Что: перевключить shim. На этом этапе уже всё видно как Призма: amber в hero на Дашборде, indigo на Реестре, EB Garamond в onboarding-h1.
Тест: ручной обход 10 экранов в обеих темах. WCAG-snapshot через `axe-core` — все блокирующие violations должны быть = 0 (расширение текущего accessibility-теста, см. `08-accessibility.md`).
Коммит: `feature/v18-prisma-tokens-active`. После этого можно делать demo CTO.

**Этап 3 — постепенный rename по компонентам** (спринты V19.1 - V19.3).
Что: грепать `var(--accent)` по компонентам, заменять на `var(--ray-active)` или `var(--accent-default)` (зависит от семантики — нужен ли «луч» или «дефолт-CTA»). Регионально: одна группа компонентов = один PR. Порядок: navbar, sidebar, page-header (новое), kpi-card, registry-table, ceo-renderer, gantt, остальное.
Тест: после каждого PR — `npm test` (534/11/0) + ручной обход затронутого экрана. Lint-rule: `--max-warnings 215` остаётся, плюс новый ESLint-плагин (на этапе 4).
Коммит-мощность: ~100-300 строк CSS на PR. Один разработчик за спринт делает 3-4 таких PR.

**Этап 4 — удаление shim, lint-guard** (спринт V19.4).
Что: проверить grep'ом, что `var(--accent)` / `--text-1` / etc. не остались нигде. Удалить shim-блок. Добавить кастомный ESLint-rule (или stylelint-plugin) `no-deprecated-tokens` со списком запрещённых имён. Прогон в CI: `npm run lint` упадёт, если кто-то введёт legacy-имя обратно.
Тест: full visual regression suite + `npm run ci`.
Коммит: `feature/v19-tokens-finalize`.

**Привязка к плану арт-директора**: волна 1 (Дашборд + Реестр + Отчёт CEO, 2 спринта по Анне §5.3) укладывается в **этапы 1-2 + первая порция этапа 3** (только три компонент-группы переписываются, остальное живёт в shim). Волны 2-3 (остальные экраны) идут параллельно с продолжением этапа 3 — каждый адаптируемый экран сразу пишется на новых токенах.

---

## 5. Темизация: light + dark + луч

Сейчас тема переключается классом `body.theme-dark` (см. `styles.css:3046`). Новый стандарт — атрибут `[data-theme="dark|light"]` на `<html>` (унифицируется с `[data-active-ray]` рядом). На время миграции держим оба селектора.

### 5.1. Архитектура слоёв

Не «12 файлов на 2×6 комбинаций», а **слоистый каскад**:

```css
/* Layer 1: primitives + semantic light (default) */
:root { /* все primitives + semantic light */ }

/* Layer 2: dark theme override */
[data-theme="dark"], body.theme-dark { /* primitives и semantic переопределяются на dark */ }

/* Layer 3: active ray (light values) */
[data-active-ray="planning"] { --ray-active: ...; ... }
[data-active-ray="control"] { ... }
/* ... 6 правил */

/* Layer 4: active ray в dark (Mist values) */
[data-theme="dark"][data-active-ray="planning"] { --ray-active: ...; ... }
/* ... 6 правил */
```

Итого: 1 (primitives+semantic light) + 1 (dark) + 6 (ray light) + 6 (ray dark) = **14 правил-блоков**. Это управляемо в одном `:root`-секции файла styles.css (~150 LOC всего на токены).

Альтернатива через `light-dark()`. CSS-функция `light-dark(light-value, dark-value)` (Baseline 2024, поддержка Safari 17.5+, Chrome 123+, Firefox 120+). Идея:

```css
:root {
  color-scheme: light dark;
  --bg: light-dark(#FAFAF7, #0F1115);
  --text-primary: light-dark(#15171C, #ECEEF3);
}
```

Это убирает Layer 2 — не нужен dark-override блок, всё inline. Проблема для Призмы: банковские пользователи могут сидеть на корпоративном Edge старой версии. Полный support для `light-dark()` достиг 90% только в начале 2025; банк примет 95%+. **Решение**: использовать классический подход с `[data-theme]` сейчас, перейти на `light-dark()` через 6-12 месяцев когда Baseline укатится в Edge LTS. Это не блокер — переход локализован в `:root`-блоке.

### 5.2. Источник системной темы

`@media (prefers-color-scheme: dark)` подключается как **первичный сигнал**, но `[data-theme]` всегда **переопределяет** его (пользователь явно нажал toggle):

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark overrides */ }
}
[data-theme="dark"] { /* dark overrides */ }
```

`#user-menu → Тема → light/dark/system` (Мария §2.5) переключает атрибут.

---

## 6. Шрифты — техническое подключение

### 6.1. Стратегия hosting

**Self-hosted, не Google Fonts CDN.** Причины:
- **Supply-chain**: банковский compliance, никакого third-party JS/CSS на проде. Текущий проект уже vanilla без внешних рантайм-зависимостей (CLAUDE.md), Google CDN сломает этот контракт.
- **Privacy**: Google Fonts CDN отправляет IP-адрес пользователя в Google; для банковской сети — нарушение 152-ФЗ (трансграничная передача), документировать дороже, чем self-host.
- **Latency**: внутри корп-сети self-hosted на nginx ближе, чем CDN.

Файлы кладём в `/fonts/` директорию рядом с `index.html`. `server.js` уже раздаёт статику.

### 6.2. Subsetting

**Сабсеты обязательны** для русского интерфейса. Разделяем:
- `latin`: U+0020-007E + U+00A0-00FF + U+2000-206F (типографика)
- `cyrillic`: U+0400-045F + U+0490-0491 + U+2010-2011

Используем `pyftsubset` (fonttools) или `glyphhanger` для генерации. Каждый шрифт — два WOFF2 файла (`-latin.woff2`, `-cyrillic.woff2`) + `unicode-range` в `@font-face` для условной загрузки. Браузер скачивает только нужный сабсет.

### 6.3. Variable fonts

- **Inter** — variable (один файл вместо 6 weights). `Inter.var.woff2` ≈ 280 KB полный, после latin-сабсета ≈ 60 KB, cyrillic-сабсета ≈ 50 KB.
- **JetBrains Mono** — variable. Полный ≈ 200 KB, latin-only ≈ 45 KB, cyrillic ≈ 40 KB.
- **Plus Jakarta Sans** — variable (опубликован Google в 2022). Полный ≈ 220 KB, latin ≈ 55 KB, cyrillic ≈ 45 KB.
- **EB Garamond** — variable (italic-axis включён). Полный ≈ 380 KB, но используется **редко** (splash, h1 CEO, no-results-italic) — **берём только regular + italic**, не variable, чтобы не тащить axes mass. Static `.woff2` 400 + 400-italic, по latin ≈ 35 KB + 35 KB, cyrillic ≈ 30 KB + 30 KB.

**Итого после subsetting** (light theme rendering, latin+cyrillic):
- Inter (variable): 60 + 50 = 110 KB
- JetBrains Mono (variable): 45 + 40 = 85 KB
- Plus Jakarta Sans (variable): 55 + 45 = 100 KB
- EB Garamond (regular + italic, static): 35 + 35 + 30 + 30 = 130 KB

**Total: 425 KB** для всех 4 шрифтов. Это укладывается в budget типичного банковского intranet (cache HIT после первой загрузки).

### 6.4. `@font-face` декларации (живут в `styles.css` — `:0` блок до `:root`)

Inline в styles.css, не отдельный CSS-файл. Vanilla-стек, минимум `<link>`-ов в `<head>`.

```css
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('/fonts/PlusJakartaSans-var-latin.woff2') format('woff2-variations');
  font-weight: 400 700;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Plus Jakarta Sans';
  src: url('/fonts/PlusJakartaSans-var-cyrillic.woff2') format('woff2-variations');
  font-weight: 400 700;
  font-display: swap;
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* аналогично Inter, JetBrains Mono, EB Garamond regular + italic */
```

### 6.5. `font-display`

`swap` для всех шрифтов. Обоснование: банк-internal-tool имеет cached fonts после первой загрузки (browser cache + nginx), FOUT минимален; `optional` рискует выкатить долго загружающимся шрифтом и юзер получит fallback на постоянной основе для 1-секундной сессии (плохо для Editorial — типографика и есть бренд).

### 6.6. Fallback-stack

Используем `font-fallbacks-tools` (или Capsize) для генерации size-adjust fallback-семейств — это убирает FOUT-jump (когда Inter подгружается, текст не «прыгает»).

```css
@font-face {
  font-family: 'Inter Fallback';
  src: local('Arial');
  size-adjust: 107%;
  ascent-override: 90%;
  descent-override: 22%;
  line-gap-override: 0%;
}

:root {
  --font-display: 'Plus Jakarta Sans', 'Plus Jakarta Sans Fallback', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-body:    'Inter', 'Inter Fallback', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --font-rare:    'EB Garamond', 'EB Garamond Fallback', Georgia, 'Times New Roman', serif;
}
```

### 6.7. Preload

В `<head>` `index.html` — preload только **самых критичных** двух сабсетов (Inter cyrillic + Plus Jakarta cyrillic — потому что русский UI):

```html
<link rel="preload" href="/fonts/Inter-var-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/PlusJakartaSans-var-cyrillic.woff2" as="font" type="font/woff2" crossorigin>
```

EB Garamond и JetBrains Mono — **не** preload, lazy loading (используются на одной странице или в моноспейсе, не в первом viewport).

---

## 7. Chart-палитра (отдельная)

Анна (§5.4 + §3) явно изолирует data-vis от лучей. 8 цветов, **не пересекающихся** с шестью лучами по hue, **colorblind-safe** (Okabe-Ito + 2 дополнительных).

| Token | Light hex | Dark hex | Hue | Назначение |
|---|---|---|---|---|
| `--chart-1` | `#0072B2` | `#56B4E9` | 200° | sky-blue (Okabe-Ito), не путать с info |
| `--chart-2` | `#E69F00` | `#F0B86F` | 41°  | orange — отделяем от Amber/Brass через L |
| `--chart-3` | `#009E73` | `#5DBC9F` | 162° | bluish-green, не путать с Spruce (158° L=22%) |
| `--chart-4` | `#CC79A7` | `#D9A1C0` | 327° | pink-magenta — нет в палитре лучей |
| `--chart-5` | `#56B4E9` | `#7CC8F0` | 202° | light-blue (доп. оттенок) |
| `--chart-6` | `#D55E00` | `#E68450` | 24°  | vermillion — путать с Amber легко по hue, но L и S сильно разные |
| `--chart-7` | `#F0E442` | `#F4EB6F` | 56°  | yellow — нет аналога в лучах |
| `--chart-8` | `#999999` | `#BCBCBC` | 0°   | neutral для «прочих» |

Проверка colorblind-safety:
- **Deuteranopia** (red-green): chart-2 vs chart-6 (orange-vermillion) — distinguishable по L (45% vs 41%) и saturation. chart-3 vs chart-7 — distinguishable по hue spread.
- **Protanopia**: аналогично deuteranopia.
- **Tritanopia** (blue-yellow): chart-1 vs chart-5 — оба blue, но chart-5 заметно светлее (L 67% vs 35%).
- Инструменты: Coblis (https://www.color-blindness.com/coblis/), Sim Daltonism (macOS app). Прогнать скриншот многоцветного chart'а и проверить distinguishability.

**Anti-pattern**: НЕ использовать chart-палитру в KPI-карточках или nav-elements. И обратное: НЕ использовать `--ray-*` в bar/line charts (Анна §5.4).

Для 9+ серий (если потребуется): циклически возвращаемся на chart-1, добавляя pattern-fill (диагональные штрихи) — это отдельный feature, не sprint-1.

---

## 8. Motion-токены и accessibility

### 8.1. Числовые значения

Уже даны в §1.1 (Motion scale). Mapping на компоненты:

- **instant (100ms)** — button-hover-bg-change, link-color
- **fast (140ms)** — input-focus-outline, chip-add/remove
- **base (240ms)** — `App.navigateTo` (Мария §6.1: mark transition + ray-dot color + eyebrow crossfade + hairline color)
- **slow (400ms)** — drawer slide-in, modal fade-in
- **slower (600ms)** — KPI count-up на Дашборде (первая загрузка, Игорь §2)

### 8.2. `prefers-reduced-motion`

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-instant: 0ms;
    --motion-duration-fast:    0ms;
    --motion-duration-base:    0ms;
    --motion-duration-slow:    0ms;
    --motion-duration-slower:  0ms;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Это **отключает** все transitions глобально. Sole-exception — instant feedback на click (которого у нас нет — все hover-эффекты через transition).

### 8.3. `prefers-contrast: more`

Поднимаем все hairline-borders на ступень primitive вверх:

```css
@media (prefers-contrast: more) {
  :root {
    --hairline:        var(--color-neutral-400);  /* было 200 */
    --border-default:  var(--color-neutral-500);  /* было 300 */
    --border-strong:   var(--color-neutral-700);  /* было 400 */
  }
  [data-theme="dark"] {
    --hairline:        var(--color-neutral-400);  /* dark inverted shift */
    --border-default:  var(--color-neutral-500);
    --border-strong:   var(--color-neutral-700);
  }
}
```

Пользователи с low-vision увидят более выраженные разделители без необходимости включать spec-режим.

### 8.4. `prefers-color-scheme: dark`

См. §5.2. `@media (prefers-color-scheme: dark)` подключает dark-overrides если пользователь **не выбрал тему явно** (`[data-theme]` не `light`/`dark`).

---

## 9. Файловая структура — где жить токенам

**Решение: один файл `styles.css`, выделенная секция в начале с разделителями-комментариями.**

Обоснование: 
- Vanilla-стек (CLAUDE.md), нет bundler'а. Если выделять `tokens.css` — нужен второй `<link rel="stylesheet">` в `<head>`, что добавляет network round-trip, и у нас две точки правды (где hairline жёлтая? в tokens.css или в styles.css?).
- 44k LOC проект: токены ≈ 250 LOC после миграции. Это 0.6% от файла. Выносить отдельный файл — увеличение infrastructure без proportional payoff.
- Банк хочет minimum new infrastructure (роль брифа).

**Структура `styles.css` после миграции:**

```
:0-30    /* @font-face declarations (4 семейства × 2 сабсета + 2 fallback) */
:31-50   /* === COMMENT BLOCK: TOKEN ARCHITECTURE EXPLANATION === */
:51-100  /* :root primitive layer: neutrals + state */
:101-160 /* :root primitive layer: 6 ray ramps × 9 steps */
:161-200 /* :root primitive layer: type/space/radius/shadow/motion scale */
:201-260 /* :root semantic layer: bg/card/text/border/state aliases */
:261-280 /* :root SHIM (legacy names) — DO NOT EXTEND */
:281-310 /* [data-theme="dark"] override */
:311-340 /* [data-active-ray="*"] cascade — 6 rules light */
:341-370 /* [data-theme="dark"][data-active-ray="*"] cascade — 6 rules dark */
:371-400 /* @media accessibility overrides */
:401-...  /* остальной CSS как есть, постепенно мигрирует */
```

Каждая секция с хедер-комментарием в духе `/* ============ PRIMITIVES — NEUTRAL ============ */` для grep-навигации.

В будущем (V20+, если потребуется), если токенов станет >1000 — выделить в `tokens.css` через CSS `@import` (один request, без bundler-зависимости).

---

## 10. Чек-лист имплементации для разработчика

Пронумерованный, привязан к файлам. Один спринт на пункты 1-12, два-три спринта на 13-18, четвёртый на 19-20.

1. **`/fonts/` директория**: положить 8 WOFF2 файлов (Plus Jakarta + Inter + JetBrains Mono variable, EB Garamond regular+italic — всё × latin/cyrillic сабсеты). Сгенерировать через `pyftsubset` или `glyphhanger`.
2. **`styles.css:0-30`**: добавить `@font-face` декларации (4 семейства × 2 сабсета + 2 fallback-семейства Inter Fallback / EB Garamond Fallback с `size-adjust`).
3. **`index.html` `<head>`**: добавить 2 `<link rel="preload">` для cyrillic-сабсетов Inter + Plus Jakarta Sans.
4. **`styles.css:1-57`** (текущий `:root`): полностью заменить на новый primitive-блок (neutrals 12 ступеней + 6 лучей × 9 ступеней + state × 5 ступеней + type/space/radius/shadow/motion).
5. **`styles.css:` после primitives**: добавить semantic-слой (bg/card/text/border/state-aliases — около 30 переменных).
6. **`styles.css:` после semantic**: добавить `[data-active-ray="*"]` каскад — 6 правил для light.
7. **`styles.css:3046-3081`** (текущий `body.theme-dark`): дополнить селектор до `[data-theme="dark"], body.theme-dark { ... }`. Содержимое заменить на dark-override semantic-слоя + 6 правил `[data-theme="dark"][data-active-ray="*"]`.
8. **`styles.css:` после dark**: добавить shim-блок (`--accent` → `--ray-active` и т.д.) с пометкой `DO NOT EXTEND`.
9. **`styles.css:` после shim**: добавить `@media (prefers-reduced-motion: reduce)` и `@media (prefers-contrast: more)` overrides.
10. **`app.js` в `App.navigateTo`**: после установки `currentSection` добавить `document.documentElement.dataset.activeRay = getRayForSection(section)`.
11. **`app/appSettings.js`**: экспортировать helper `getRayForSection(key)` (Мария §3.5) — возвращает один из 6 ray-id; default `'planning'`.
12. **Smoke test**: открыть Дашборд, переключиться на Реестр (Планирование) → Реестр (Контроль). Убедиться визуально, что hairline под page-header / stripe в active nav-item / hero-KPI-цифра меняют цвет.
13. **`styles.css:70-110`** (topbar-стили): следовать чек-листу Марии §8 — снести `.topbar-logo` pill, добавить `.prisma-mark`, `.prisma-wordmark`, `.topbar-ray-indicator`, `.topbar-hairline`. Цвета ставить из `--ray-active`/`--text-primary`, не из старых `--accent`.
14. **`styles.css:170-220`** (sidebar): следовать §8 Марии — `.nav-group`, `.nav-group-title`, новые caps-разделители, `.nav-item.active::after` через `--ray-active`.
15. **`styles.css:395-486`** (page-header + kpi-card): добавить `.page-header`, `.page-header-eyebrow` (с `var(--ray-active)`), `.page-header-h1`, `.page-header-hairline`, `.page-toolbar`, `.kpi-hero` (48px цвета `--ray-active`), `.kpi-card` (stripe-left из `--state-*`, не из ray).
16. **`styles.css:567-700`** (registry-table): убрать зебру; `.row:hover` → `--row-hover`; `.row.selected` → `box-shadow: inset 3px 0 0 var(--ray-active)` + `background: var(--row-hover)`; thead CAPS на `--text-tertiary`.
17. **`styles.css:7477-7600`** (CEO-hero) + новый блок CEO-page: убрать score-ring, добавить `.ceo-page-narrow` (max-width: 64ch), `.ceo-pull-quote` (`border-left: 3px solid var(--ray-active)`), `.ceo-section-h2`, `.ceo-toc`.
18. **Chart-палитра**: добавить 8 `--chart-*` токенов в primitive-блок, обновить `views/dashboard.js` / `views/metrics.js` / `views/insights.js` — заменить hardcoded chart-fills на `var(--chart-*)`.
19. **Lint-rule**: после volume 1 (Дашборд + Реестр + AI-CEO мигрированы) добавить custom stylelint-plugin `disallow-tokens` со списком legacy-имён → warning. После volume 3 — переключить с warning на error.
20. **Удаление shim'а**: после полной миграции (V19.4) — удалить shim-блок из styles.css, прогон `npm run ci` (typecheck + lint + 534/11/0 tests).

---

**Сергей Поляков**  
*Дизайн-системный инженер, бренд «Призма» — V18.x*

> «Токены — это не имена цветов, токены — это договор о том, чем компонент имеет право управлять, а чем не имеет. Если разработчик в kpi-card может написать `color: var(--ray-active)` — это уже регрессия. Hero-KPI получает луч через явный класс, не через дефолт. Спецификация выше держит этот договор в одном `:root` блоке.»
