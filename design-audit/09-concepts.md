# 09. Три концепции редизайна

> На основе всех предыдущих отчётов — три **принципиально разных** направления. Каждое — внутренне согласованно, но между ними резкий контраст. Цель: дать выбор «куда идти», а не «насколько менять».

## Сводка концепций (одной строкой)

| | Название | Суть |
|---|---|---|
| **A** | **Quiet Tools** | Спокойный инструмент мастера: глубокая палитра, тонкая типографика, точные micro-feedback. «Lead не отвлекает, помогает быть в потоке». |
| **B** | **Editorial Bold** | Продукт с позицией и характером: крупные headlines, mix display+body шрифтов, deep colour hero-блоки. «Я работаю с инструментом, который мне нравится». |
| **C** | **Workshop** | Брутальный профессиональный stack: моноширинные accent, hard offset-shadows, чёрно-белая база с одним электрическим цветом. «Это серьёзный stack, без украшательств». |

---

# Концепция A. Quiet Tools

> «Тихий инструмент. Деталь в пользу пользователя».

## A.1 Настроение и для кого

**Эмоция**: фокус, контроль, спокойствие. Пользователь чувствует, что инструмент **не борется за внимание** — даёт работать.

**Архетип**: The Sage (мудрец). Знание + точность.

**Аналог**: Linear (early), Things 3, Reflect, Notion Calendar.

**Подходит** если:
- Ваша культура — «инструмент должен работать, не выпендриваться».
- Минимальный риск переезда — можно показать без сильного wow-effect, но рубрики не вызовет противоречий.
- Главная ценность — **скорость и предсказуемость**, не «крутость».

## A.2 Палитра

| Token | Light | Dark |
|---|---|---|
| `--color-bg-page` | `#fafbfc` (off-white) | `#0c1019` (deep ink) |
| `--color-bg-card` | `#ffffff` | `#161b29` |
| `--color-bg-elevated` | `#fcfcfd` | `#1e2536` |
| `--color-border` | `#e7e9ed` | `#2a3144` |
| `--color-border-strong` | `#cdd1d8` | `#3a4259` |
| `--color-text-primary` | `#0e1116` | `#e8eaed` |
| `--color-text-secondary` | `#454e5c` | `#a3aabb` |
| `--color-text-tertiary` | `#69727f` | `#778298` |
| `--color-brand-500` | **`#0EA5A4`** (teal-600, **не indigo!**) | `#22D3D2` |
| `--color-brand-600` | `#0d8e8d` | `#0EA5A4` |
| `--color-brand-100` | `#e6f7f7` | `#0e3a3a` |
| `--color-success` | `#0a8754` (forest-green, не bright emerald) | `#34d399` |
| `--color-warning` | `#b45309` (amber-700) | `#f59e0b` |
| `--color-danger` | `#b91c1c` (red-700, deeper) | `#f87171` |

**Ключ**: главный цвет — **teal `#0EA5A4`**, спокойный, благородный. Deep enough чтобы быть characterful, neutral enough чтобы не «жать».

## A.3 Типографика

| Role | Font | Sizes |
|---|---|---|
| **Display** | **Inter Variable** (`opsz` 28) | 32 / 40 / 48 px |
| **Body** | **Inter Variable** (`opsz` 14) | 12 / 13 / 14 / 16 px |
| **Mono** | **JetBrains Mono Regular** | 11 / 12 px |

**Веса**: 400 (default body), 500 (UI), 600 (subheaders), 700 (headlines), 800 (rare hero). Используется variable axis — плавные переходы.

**Сигнатура**: Hero numbers на дашборде — **40px** Inter `weight 600` `tracking-tight` `tabular-nums`. Спокойные большие цифры.

## A.4 Ключевые приёмы

1. **Hero-блок «Что требует внимания»** — занимает верх дашборда, на нём 40px цифра + 16px список конкретных задач, light teal background `--color-brand-100`. Один блок, доминирует.
2. **KPI-cards** теперь secondary под hero-блоком, не primary.
3. **Воздух**: section-padding 32px, между cards 16-20px (вместо текущих 12px). Дышит.
4. **Custom иконки**: Lucide outlined, 1.5px stroke, 20×20 — все эмодзи заменяются.
5. **Active nav-item**: solid `--color-brand-500` left border 3px + bg `--color-brand-100` + bold text. Видимо мгновенно.
6. **Status pills** — на cells без округлости-pill, а через color-bar 3px на левом краю cell + муж текст.

## A.5 Motion-language

- **Длительности**: 120-280ms (короткие).
- **Easing**: `cubic-bezier(.2,.8,.2,1)`.
- **Сигнатурный момент**: **KPI Reveal** — числа отсчитываются с `0` за 600ms (out-cubic). Под каждым числом — тонкая горизонтальная teal-линия рисуется слева направо за 800ms.
- **Drag-drop ack**: pill «садится» с soft-bounce overshoot (1.0 → 1.05 → 1) за 320ms; целевая cell получает `border-bottom: 2px solid teal` 400ms fade.
- **Tab-switch**: сократить section-enter до 120ms (быстрее текущих 240ms).
- **`prefers-reduced-motion`**: full respect — все decorative motions выключены.

## A.6 Mood ключевых экранов (словами)

### Дашборд (A)

Сверху section-header: «Сегодня, 29 апреля» (32px Inter 600), под ним маленькая subtitle: «12:41 · обновлено 3 минуты назад» (12px text-tertiary).

Hero-блок: широкая карточка с deep-teal `--color-brand-100` background, padding 32px. Заголовок «**Внимание сегодня**» (24px tracking-tight). Список из 4 строк:

```
2 блокера   PROJ-123, PROJ-456 в риске
3 без релиза   нет назначения для команды Mobile
4 просрочки   merger вчера
9 в риске   общий счёт
```

Каждая строка имеет 16px цифру + текст-описание + кнопку «Открыть» справа (small ghost button). Кликом — фильтрует Реестр на эти задачи.

KPI-grid ниже, теперь secondary visualisation: 4 карточки 14×14 grid-cells, маленькие цифры 24px, light. Они **сообщают состояние**, не зовут к действию.

Под ним: per-релиз progress (4 release-cards), каждая с прогресс-баром teal на 6-8 px высоту. Чистая, единая колорка.

### Реестр (A)

Тонкая шапка-фильтр (без рамки, просто spacing). Таблица — без zebra-striping; row-hover очень тонкий. Inline-edit: cell получает `border-bottom: 1px solid teal` 200ms на focus, fade обратно при blur. Saved — quick green-flash 300ms.

### Гант (A)

Та же сетка по 5 колонкам (Бэклог / 1.20 / 1.21 / 1.22 / OT). Окна получают **subtle** окрашивание (5-8% opacity teal/emerald/amber/rose tints), не жёсткое. Pills — flat, без shadow, маленький border-radius 6px. Postpone-arrows — тонкие dashed teal lines, **не red** (red остаётся для критических флагов).

### Tech Info modal (A)

Модалка 80vw, padding 32px, large gap между sections. Поиск-input top, full-width, focus с teal-ring. Tabs — простой text + bottom border 2px teal на active. Списки данных — clean, monospace для key, sans-serif для text.

### LLM Assistant panel (A)

Панель slide-in справа, 420 wide. Background `--color-bg-card` (white). Сообщения user — pale teal bubble справа, assistant — без bubble, plain text слева с teal accent-border-left 2px. Streaming text — soft-grey каретка blinks.

## A.7 Что выигрываем

✅ **Самый низкий риск** — не отпугнёт ни одного пользователя.
✅ **Самый быстрый to ship** — теал вместо индиго, увеличение spacing, убрать эмодзи. 2-3 недели работы.
✅ Совместимо с тёмной темой как есть.
✅ A11y улучшается «бесплатно» (контраст teal на white > indigo на white).
✅ Type-scale + iconset = универсальная база, не «концептуальный» wager.

## A.8 Чем рискуем

❌ **«Очередной calm-tech» upgrade** — не запоминается. Через год все B2B-tools так выглядят.
❌ Невостребованный wow-фактор для презентаций («ну, чище стало»).
❌ Уход от indigo может быть неоднозначно встречен (некоторые ассоциируют indigo с «modern UI»).

## A.9 Mini-mood-board (5-8 ссылок)

1. https://linear.app/ — главный референс motion + hero blocks
2. https://things.com/ (Cultured Code Things 3) — hierarchy + breathing
3. https://reflect.app/ — clean + characterful via type
4. https://calendar.notion.so/ (Notion Calendar) — depth через soft shadow
5. https://height.app/ — clean grid + good motion
6. https://radix-ui.com/themes — neutral but characterful through detail
7. https://attio.com/ — modern CRM, тёплый neutral palette
8. https://www.tella.tv/ (UI-моменты) — tabular nums + breath room

---

# Концепция B. Editorial Bold

> «Продукт с характером. Не извиняется за то, что существует».

## B.1 Настроение и для кого

**Эмоция**: уверенность, гордость, **«мне это нравится»**. Пользователь хочет показать инструмент коллеге.

**Архетип**: The Hero + The Creator. Мастерство + выразительность.

**Аналог**: Linear (late 2024 redesign), Pitch, Stripe Press, Arc Browser.

**Подходит** если:
- Внутренне есть готовность отказаться от «нейтральной B2B-эстетики» — продукту разрешено быть **узнаваемым**.
- Команда хочет presentation-ready дашборд (показать на демо, в скриншоте).
- Менеджеры — это **lead-уровень**, ценящие хорошо сделанные вещи.
- Большая инвестиция в long-term identity, не quick win.

## B.2 Палитра

| Token | Light | Dark |
|---|---|---|
| `--color-bg-page` | `#fbfaf7` (warm off-white, slight cream) | `#16161a` (deep charcoal, не navy) |
| `--color-bg-card` | `#ffffff` | `#1f1f23` |
| `--color-bg-elevated` | `#fdfcf9` | `#2a2a30` |
| `--color-bg-hero-deep` | **`#0d3a37`** (deep forest, для hero blocks) | **`#0d3a37`** (тот же) |
| `--color-text-primary` | `#0e0e10` (deep ink) | `#f4f3ee` (cream) |
| `--color-text-secondary` | `#5e5e64` | `#a8a8b0` |
| `--color-brand-500` | **`#FF5722`** (vermillion / deep orange) | `#FF6B47` |
| `--color-brand-600` | `#e64a18` | `#FF5722` |
| `--color-brand-100` | `#fff1eb` | `#3a1408` |
| `--color-accent-secondary` | `#0d3a37` (forest, для editorial moments) | `#5DD9C8` |
| `--color-success` | `#1a7f5a` | `#34d399` |
| `--color-warning` | `#c97a0c` | `#f59e0b` |
| `--color-danger` | `#a8311c` (deeper red) | `#FF6B6B` |

**Ключ**: палитра — **vermilion + deep forest + cream**. Это печатная газетная палитра 2020-х (Pitch, Stripe Press). Vermilion как accent — uncommon, привлекает.

**Hero-blocks** иногда имеют **deep forest `#0d3a37`** background — это даёт editorial-pause для важного контента.

## B.3 Типографика

| Role | Font | Sizes |
|---|---|---|
| **Display** | **Plus Jakarta Sans** (free, Google Fonts) или **Aeonik Pro** (commercial) | 32 / 40 / 56 / 72 px |
| **Body** | **Inter Variable** | 13 / 14 / 16 px |
| **Serif accent** (rare) | **EB Garamond** или **Reckless Neue** | 20 / 24 / 32 px |
| **Mono** | **JetBrains Mono** | 12 px |

**Сигнатура**: Hero number на дашборде — **72px Plus Jakarta Sans `weight 700` tracking-tighter**. Это **газетный титул**.

Иногда serif applied к key-numbers в hero-блоке — например, «**12** задач в риске» где «12» — Garamond italic 56px, «задач в риске» — Inter 18px regular. Editorial pause.

## B.4 Ключевые приёмы

1. **Hero-блок full-width** на forest `#0d3a37` background. На нём cream-текст, **vermilion** accent-numbers. Margin от edge of screen — 0 (full-bleed).
2. **Mix sans + serif**: serif для editorial moments (key numbers in hero, page titles). Sans для всего UI.
3. **Card-stack** layout: главный card занимает 60% ширины, secondary cards меньше, **разные размеры** — bento-grid feel.
4. **Иллюстрации**: 5-7 custom SVG-иллюстраций (welcome, empty registry, import success, success state). Стиль — flat, geometric, vermilion-accented.
5. **Decorative numbering**: section headers нумерованные — «01. Сегодня», «02. На этой неделе» — большие пёсочные labels.
6. **Letter-spacing tight** на hero typography (-0.02em) — современный editorial look.

## B.5 Motion-language

- **Длительности**: 240-500ms (более выразительные).
- **Easing**: `cubic-bezier(.34,1.56,.64,1)` — slight overshoot.
- **Сигнатурный момент**: **Stagger reveal** — на загрузке дашборда блоки появляются один за другим (hero → KPI → secondary, delay 80ms each). Hero-block fade-up + slight scale (.98 → 1).
- **Drag-drop**: bouncy, expressive — pill приходит с overshoot, target column gets accent-flash 600ms.
- **Tab-switch**: **slide-transition** (текущий контент уходит влево 280ms, новый приходит справа). Это сильный editorial-move.
- **Page changes** в section ассистента (LLM panel state changes) — soft-fade with slight slide.
- **Hero-numbers**: countup + **subtle scale-pulse** (1 → 1.02 → 1) когда meaningful change.

## B.6 Mood ключевых экранов

### Дашборд (B)

Full-width banner-block на deep forest `#0d3a37`, height 320px, padding 48px. На нём:
- Top: маленькая дата «Tuesday, 29 April · 12:41» (Inter 14px, opacity .6)
- Centre-left: **«Critical attention»** (Plus Jakarta Sans 56px 700 cream)
- Below: cream-text «**12** items need decision today» (Inter 18px regular, with «12» в Garamond italic 32px deeper-cream)
- Right: иллюстрация-vermilion accent (warning-triangle stylized)

Под hero-bandом:
- Section header «01. Releases» (28px Plus Jakarta 700) с decorative underline 3px vermilion
- Bento-grid: одна большая card (1.21 release, doминирует), 3 small cards (1.20, 1.22, OT)
- Каждая release-card имеет large progress number (40px Plus Jakarta), bar-chart, micro-delta indicator

«02. Risks» section — тёмные hero number (38 в Garamond italic 64px) с subtitle «active blockers». Под ним список с illustrations.

«03. Teams» — clean grid таблица.

### Реестр (B)

Тонкая шапка-pageтитл «Tasks · 458 items» (32px). Фильтр-бар подвешен sticky-top, но visible-frame 64px height (более воздушный).
Таблица: row-height 40px (на 4px больше текущего), font 14px regular. Status-cells получают **vermilion left-bar** для warning-rows. Selected — solid vermilion left-bar 4px + bg `--color-brand-100`.
Inline-edit — focus-ring 2px vermilion + slight scale of cell (1.02), 200ms.

### Гант (B)

Same sectional grid, но окна получают **deeper saturated colours**:
- Backlog: warm-cream
- 1.20: deep forest tint
- 1.21: warm orange tint (vermilion-100)
- 1.22: amber
- OT: deep red tint

Pills — slightly rounded squares (radius 6), white text on coloured bg, **bigger** (height 24px vs current 18px).
Drag-drop с big bouncy motion — pill «летит» через editorial cubic-bezier overshoot.

### Tech Info modal (B)

Modal full-bleed at top — first 200px is forest-banner with title «Tech Info» 56px Plus Jakarta. Под ним — content panel (80vw × 60vh) with large padding.
Tabs — pill-style segmented control on banner (rounded-full), active state vermilion bg.
Search input — large 18px font, full-width, with magnifying-glass icon.

### LLM Assistant panel (B)

Panel — 480px wide (на 60px шире текущего), forest accent on top. Messages: user — vermilion-tint card right-aligned, assistant — cream card with serif italic «Q2 assistant» label.
Streaming — typing-dots animation (3 dots, vermillion).

## B.7 Что выигрываем

✅ **Самый запоминающийся** редизайн.
✅ Pres-ready: дашборд можно положить в quarterly review presentation.
✅ Создаёт **identity** для продукта в долгосрочной перспективе.
✅ Привлекает new hires («у нас крутые внутренние tools»).
✅ Через 2 года — выглядит так же modern, как сейчас (editorial идиомы стабильны).

## B.8 Чем рискуем

❌ **Высокий риск отторжения** части пользователей — кто-то скажет «слишком ярко / отвлекает».
❌ Vermilion accent + forest hero — это **bold-decision**, отступать сложно.
❌ Type-pair (Plus Jakarta + Inter + Garamond + Mono) — это 4 webfonts, ~1.5 MB vendored.
❌ Иллюстрации требуют **отдельную работу дизайнера** (custom).
❌ Если культура «не выпендривайся» — может конфликтовать.
❌ A11y — нужно **тщательно** тестировать (vermilion на cream — на грани AA).

## B.9 Mini-mood-board

1. https://linear.app/ (post-2024 redesign) — bento-grid + hero-blocks
2. https://pitch.com/ — confident colour use, character
3. https://press.stripe.com/ — editorial typography in tech context
4. https://arc.net/ — bold, characterful UI
5. https://gumroad.com/ — punchy commercial editorial
6. https://www.are.na/ — minimal but characterful
7. https://tella.tv/ — clean editorial moments
8. https://www.basecamp.com/ — confident, no-fluff editorial

---

# Концепция C. Workshop

> «Серьёзный stack. Каждый пиксель работает».

## C.1 Настроение и для кого

**Эмоция**: профессионализм, точность, **немедленность**. Пользователь чувствует «я работаю на инструменте мастера».

**Архетип**: The Sage + The Outlaw. Знание + нонконформизм.

**Аналог**: Hey email, Are.na, Vercel dashboard, Internet Archive (modern UI), Gumroad post-2023.

**Подходит** если:
- Команда любит сильные позиции и не боится «странного».
- Пользователь — power-user, ценит speed and density.
- Нет страха «оттолкнуть консервативного нового пользователя».
- Identity-чисто-функциональный, no-frills вписывается в индустрию (например, разработчики, инженеры).

## C.2 Палитра

| Token | Light | Dark |
|---|---|---|
| `--color-bg-page` | `#ffffff` (pure white) | `#000000` (true black) |
| `--color-bg-card` | `#ffffff` | `#0a0a0a` |
| `--color-bg-elevated` | `#fafafa` | `#181818` |
| `--color-text-primary` | `#000000` | `#ffffff` |
| `--color-text-secondary` | `#404040` | `#a0a0a0` |
| `--color-text-tertiary` | `#737373` | `#737373` |
| `--color-border` | `#000000` (pure!) | `#ffffff` (pure) |
| `--color-border-light` | `#cccccc` | `#404040` |
| `--color-brand-500` | **`#0066FF`** (electric blue) | `#3D85FF` |
| `--color-brand-600` | `#0052CC` | `#0066FF` |
| `--color-warning` | `#FFB800` (electric yellow) | `#FFB800` |
| `--color-danger` | `#FF1A1A` (alarm red) | `#FF4D4D` |
| `--color-success` | `#00CC66` (electric green) | `#33FF99` |

**Ключ**: чистый black + white + **electric blue** `#0066FF`. Никаких grey shadows. **Borders pure black** (`#000`). Это даёт **высочайший контраст** в индустрии.

**Status-цвета** — **электрические** (yellow `#FFB800`, red `#FF1A1A`, green `#00CC66`). Не приглушённые, а ярко-сигнальные.

## C.3 Типографика

| Role | Font | Sizes |
|---|---|---|
| **Display** | **IBM Plex Sans Bold** OR **Geist Bold** | 24 / 32 / 48 px |
| **Body** | **IBM Plex Sans Medium** OR **Geist Regular** | 12 / 13 / 14 px |
| **Mono (KEY!)** | **IBM Plex Mono Bold** | 11 / 12 / 14 / 18 px (используется ВЕЗДЕ для chunks of attention) |

**Mono — ключ**: значимая информация (KPI numbers, status codes, Jira keys, timestamps, IDs) — **всегда mono**. Это создаёт характер.

**Сигнатура**: Hero KPI на дашборде — **IBM Plex Mono Bold 48px**, например `[ 12 ] BLOCKERS`. Скобки и uppercase — обязательные decorations.

## C.4 Ключевые приёмы

1. **Pure black borders** на всех cards / inputs / buttons — толщина 1.5px solid black. Никакого grey.
2. **Offset shadows** (вместо blurred): кнопки имеют `box-shadow: 4px 4px 0 0 #000` — neo-brutalist signature. Hover — shadow становится `2px 2px 0 0 #0066FF` (синий offset).
3. **No border-radius** или максимум 4px. Прямоугольники.
4. **Mono accents**: status-cells показывают `[ 03 / 12 ] DONE` или `[ TIMEOUT 12.3s ]` — telegraph-style.
5. **Brackets и dashes** — для emphasis (вместо bullets/icons): `— Status:` `[ Risk ]` `> Action`.
6. **Type-as-art**: section headers — большой mono `12pt → 32pt`, sometimes outlined-only (text-stroke).
7. **Иконки**: monoline 2px-stroke, square corners, 16×16. Lucide stroke=2 базируется.

## C.5 Motion-language

- **Длительности**: 80-160ms (snap, не slow).
- **Easing**: `cubic-bezier(0, 0, 0, 1)` (out-quint) или `linear`.
- **Сигнатурный момент**: **Status Stamp**. Когда задача меняет status в Реестре — в углу cell появляется **monospace stamp** `[ 12:41:33 → DONE ]` со slight tilt -2deg, fades out 1s. Никаких bounces.
- **Click**: button `transform: translate(2px, 2px)` + shadow disappears (как realistic press) — 80ms snap.
- **Drop в Ганте**: pill snaps в slot мгновенно (no animation). Confirmation: cell border flashes electric-blue once (200ms).
- **Tab change**: instant (no enter animation на повторных). First-time: 100ms fade.

## C.6 Mood ключевых экранов

### Дашборд (C)

Top of page — full-width thick border 1.5px black. Под ним top-bar:
```
[ Q2 PLANNER · 12:41:33 · 09 / 458 BLOCKERS ]
```
Mono 14px, pure black, white bg.

Below — section header:
```
TODAY ─────────────────────────────────────
```
IBM Plex Mono Bold 24px, with horizontal line filling rest of width.

KPI grid — 4 cards with thick black borders, mono numbers 48px:
```
┌─────────────────┐  ┌─────────────────┐
│   [ 458 ]       │  │   [ 09 ]        │
│                 │  │                 │
│   TASKS         │  │   BLOCKERS      │
│   IN Q2         │  │   ACTIVE        │
└─────────────────┘  └─────────────────┘
```

Risks section — list items with status-prefixes:
```
[ HIGH    ] PROJ-123  Migration database delayed
[ MEDIUM  ] PROJ-456  No release assigned
[ HIGH    ] PROJ-789  Integration timeout 3x
```

Все pure mono, electric-blue accent on `[ HIGH ]` brackets.

### Реестр (C)

Таблица с 1.5px black borders на всём. Header — UPPERCASE 11px mono bold. Body cells 12px mono medium. **Tabular nums всегда**.

Inline-edit: cell becomes `border: 1.5px solid #0066FF`, instant. Save: brief electric-blue flash 100ms.

Selected rows — pure black left-border 4px (like marker), and bg-yellow-50 (electric-yellow-tint).

### Гант (C)

Same 5-column grid, но with **bold black borders** between cells. Pills — squared (radius 0), 12px mono uppercase tag (`BACKEND`, `QA`, `INFRA`). On drop — instant snap (no animation), border flash electric-blue.

Postpone-arrows — solid red `#FF1A1A` solid lines (not dashed), 2.5px, with arrow-marker. Тяжёлые.

### Tech Info modal (C)

Plain rectangular modal с pure black 2px border. Top: search bar with bracket-style search:
```
[ search keys, names ───────────── ] [ ⤓ JSON ] [ ↻ ] [ ✕ ]
```

Tabs are simple text with bracket-active state:
```
[ JIRA ]  BITBUCKET   CONFLUENCE
```

Section headers `[ 01 — VERSION ]`, `[ 02 — PROJECTS · 187 ]` — counts in brackets.

Lists — table-style with mono key + sans text:
```
SERVERINFO              version            8.20.11
                        buildNumber        820011
```

### LLM Assistant panel (C)

Panel slide-in 400px wide with thick black left-border. Top status:
```
[ ASSISTANT · CONNECTED · GIGACHAT ]
```

User messages — right-aligned in `[bracket]`-style:
```
                              [ USER 12:41 ]
                          Что в риске у Mobile?
```

Assistant — left-aligned mono header + text:
```
[ ASSIST 12:41 ]
> 3 задачи в риске у команды Mobile:
  ─ PROJ-123 Migration delayed
  ─ PROJ-456 No release assigned  
  ─ PROJ-789 Integration timeout
```

Streaming — typewriter-effect, but instant (no fancy fade).

## C.7 Что выигрываем

✅ **Самый запоминающийся** UI в индустрии — никто не забудет.
✅ Identity: 100% дифференцированно.
✅ Power-users (technical leads) **обожают** этот стиль.
✅ Pure contrast — A11y контраст-проверки **проходят с большим запасом**.
✅ Печатные стиль workflow-tools (Hey, Are.na) — резонирует с тем, что это инструмент для opinionated-people.

## C.8 Чем рискуем

❌ **Самый высокий риск отторжения**. Пользователь может сказать «выглядит как 1985 / DOS / непрофессионально».
❌ В корпоративном Сбере может вызвать «странные комментарии» от любого, кто видит над плечом.
❌ Mono-ширифты для длинного body — **читать дольше**. Не подходит для long-text reading.
❌ Меньше brand-cohesion с остальной экосистемой Сбера (которая мягкая, geometric).
❌ Brutalist стиль может быстро «устареть» — он сейчас trendy, но через 3 года может казаться dated.
❌ A11y-контраст идеален, но **monospace для всего** может уставать глаз — нужно тестировать.

## C.9 Mini-mood-board

1. https://www.hey.com/ — opinionated, characterful productivity tool
2. https://www.are.na/ — minimal, archival, mono-led
3. https://gumroad.com/ — punchy, mono-accented
4. https://archive.org/ (modern theme) — functional brutalism
5. https://vercel.com/dashboard — dark mode with character
6. https://geist-ui.dev/ — Vercel's design system reference
7. https://brutalist-web.design/ — manifesto + examples
8. https://www.craigslist.org/ — extreme example of brutalist function

---

# Сравнение в одной таблице

| | A. Quiet Tools | B. Editorial Bold | C. Workshop |
|---|---|---|---|
| **Палитра** | Teal + neutral cream | Vermilion + forest + cream | Pure B&W + electric blue |
| **Display шрифт** | Inter Variable | Plus Jakarta / Aeonik | IBM Plex Sans Bold / Geist |
| **Body шрифт** | Inter | Inter | IBM Plex Sans / Geist |
| **Mono** | JetBrains Mono | JetBrains Mono | **IBM Plex Mono (везде!)** |
| **Радиусы** | 4 / 8 / 12 / 16 | 4 / 8 / 12 / 16 / 20 + full | 0 / 2 / 4 (max) |
| **Тени** | Soft neutral | Coloured (brand-tinted) | Offset hard `4px 4px 0 0` |
| **Иконки** | Lucide outlined 1.5px | Lucide / Phosphor mix | Lucide stroke=2, square |
| **Иллюстрации** | Минимум | 5-7 custom SVG | Нет (type-as-art) |
| **Motion**: длительность | 120-280ms | 240-500ms | 80-160ms |
| **Motion**: easing | smooth standard | overshoot bounce | snap linear |
| **Hero numbers** | 40px Inter 600 | 72px Plus Jakarta 700 | 48px IBM Plex Mono Bold |
| **Запоминаемость** | Средняя | Высокая | Очень высокая |
| **Риск отторжения** | Низкий | Средний | Высокий |
| **Time to ship** | 2-3 недели | 5-7 недель | 4-6 недель |
| **Webfont budget** | ~700 KB | ~1.5 MB | ~900 KB |
| **Custom illustrations** | 0-2 | 5-10 | 0 |
| **A11y baseline** | Pass AA easy | Pass AA с осторожностью | Pass AA с большим запасом |
| **Sber-fit** (organisational) | High | Medium | Medium-low |

---

## Резюме по концепциям

- **A. Quiet Tools** — выбирайте если хотите **modernise quietly**: продукт станет лучше, но останется «инструментом», без лишних claims.
- **B. Editorial Bold** — выбирайте если **готовы инвестировать** в long-term identity и хотите, чтобы продукт **узнавали**.
- **C. Workshop** — выбирайте если **есть смелость** делать sharp moves и команда состоит из людей, которые ценят function над form.

Подробное сравнение и моя рекомендация — в `00-README.md`.
