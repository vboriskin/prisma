# 02 — VISUAL / TYPOGRAPHY AUDIT · Дашборд

> **Роль:** Visual / Typography Lead.
> **Скоуп:** вкладка `Курс / Дашборд` (`section-dashboard`).
> **Метод:** read-only аудит фактического CSS (`styles.css`) и рендера (`views/dashboard.js`) в сопоставлении с брендбуком (`my_prisma-brand/BRAND_BOOK.md`).
> **Дата:** 2026-05-04. После П11.1 (`.kpi-value` 22/600 mono, `.kpi-label` 11/CAPS/0.6px).

---

## TL;DR

Дашборд сейчас — это **двухслойная сцена с конфликтом масштабов**:

- **Hero-блок** (П4 / Волна 2) построен по канону брендбука §4: 48px JetBrains Mono / 300 / -1px на `.prizma-hero-kpi`, eyebrow CAPS 11/1.5px на caption, mono-tabular numerals — это эталон.
- **KPI-grid из 12 карточек** (`renderKPIs`) построен на **другой шкале** (22/600 mono после П11.1), и **все 12 карточек одного веса**. Зрителю Анне (PO, 6/10 fitness) это читается как «12 цифр-фактов одинаковой важности» — что прямо ломает §3.3 «signal vs decoration» (только 4 из 12 имеют signal-cls; остальные 8 нейтральные, но визуально неотличимы по доминированию).
- **Третий слой** — `.release-card-count` 24/700 в `--prizma-information`, `.risk-counter-value` 20/700 в `--warning` — это **четвёртая шкала чисел**, не выровненная с первыми двумя. Получаются 4 разных «числовых голоса» на одном экране (48 / 22 / 24 / 20), и ни один из них кроме hero не доминирует.

**Главный вывод:** иерархия должна быть строгая trio: **Hero (48) → Primary KPI (32) → Secondary stats (20)**. Сейчас primary-уровень отсутствует — между hero (48) и KPI-grid (22) пропасть в 26pt без посредника, и взгляд Анны «проваливается». В то же время боковые `release-card-count` (24/700) **визуально весомее** чем сам KPI-grid (22/600), хотя по смыслу они вторичны.

---

## Section 1. Текущая type-scale (фактическая)

> Источник: `styles.css` строки указаны в столбце.

| # | Селектор | font-size | weight | letter-spacing | font-family | color-token | Назначение | Источник |
|---|---|---|---|---|---|---|---|---|
| 1 | `.prizma-hero-kpi` | 48px | 300 → **700** (override `:16828`) | -1px | JetBrains Mono | `--prizma-text-primary` | Главное число дашборда «N%» | `:585-592 + :16827-32` |
| 2 | `.prizma-hero-caption` | 11px | 500 | 1.5px CAPS | SF Pro Display | `--prizma-text-secondary` | Eyebrow «КУРС КВАРТАЛА» | `:593-598` |
| 3 | `.prizma-hero-supporting-num` | 20px | 400 | — | JetBrains Mono | `--prizma-text-primary` | 3 supporting-числа | `:605-610` |
| 4 | `.prizma-hero-supporting-lab` | 10px | 500 | 1.2px CAPS | SF Pro Display | `--prizma-text-secondary` | Подписи под supporting | `:611-616` |
| 5 | `.prizma-page-eyebrow` | 10px | 600 | 1.2px CAPS | SF Pro Display | `--prizma-text-secondary` | «КУРС · ДАШБОРД» над h1 | `:521-527` |
| 6 | `.prizma-page-h1` | 28px | 300 | -0.01em | SF Pro Display | `--prizma-text-primary` | Заголовок страницы | `:528-534` |
| 7 | `.prizma-page-sub` | 14px | 400 | — | SF Pro Display | `--prizma-text-secondary` | Подзаголовок страницы | `:535-538` |
| 8 | `.kpi-value` | 22px (legacy 26px перебит на :16837) | 600 | -0.5px | JetBrains Mono | `--text-1` (=`--prizma-text-primary`) | 12 KPI-чисел | `:1283-88 + :16836-41` |
| 9 | `.kpi-label` | 11px (legacy 9px перебит на :16845) | 700 | 0.6px CAPS | SF Pro Display | `--prizma-text-tertiary` | подпись KPI-карточки | `:1279 + :16844-49` |
| 10 | `.kpi-sub` | 11px | 400 | — | SF Pro | `--text-4` | Дополнительная строка KPI | `:1289` |
| 11 | `.dash-empty-title` | 16px | 600 | — | SF Pro | `--prizma-text-primary` | «Курс ещё не проложен» | `:16889-94` |
| 12 | `.dash-empty-sub` | 13px | 400 | — | SF Pro | `--prizma-text-tertiary` | «Импортируйте план…» | `:16895-900` |
| 13 | `.risks-panel-title` | 13px | 700 | — | SF Pro | `--text-2` | «Риски внимания» | `:1311` |
| 14 | `.risk-counter-value` | 20px | 700 | — | (default sans, **mono inherited via :16921**) | `--warning` (=`--prizma-drift`) | Счётчик каждого риска | `:1318` |
| 15 | `.risk-counter-label` | 11px | 400 | — | SF Pro | `--text-3` | Подпись счётчика | `:1319` |
| 16 | `.blocking-detail-title` | 13px | 700 | — | SF Pro | `--danger` (=`--prizma-off-course`) | Заголовок «Блокирующие зависимости» | `:1326-30` |
| 17 | `.release-card-title` | 15px | 700 | — | SF Pro | `--text-1` | «1.20 / 1.21 / 1.22 / OT» | `:1339` |
| 18 | `.release-card-dates` | 11px | 400 | — | SF Pro | `--text-3` | Даты рядом с заголовком | `:1340` |
| 19 | `.release-card-count` | 24px | 700 | — | mono inherited (`:16926`) | `--prizma-information` | «N задач» | `:1341` |
| 20 | `.mini-breakdown-row` | 12px | 400 | — | SF Pro | `--text-3` (label) / `--text-2` 600 (val) | scope-распределение по релизу | `:1343-45` |
| 21 | `.progress-label` | 12px | 700 | — | SF Pro | `--text-2` | «1.20 / 1.21…» в progress-card | `:5178` |
| 22 | `.progress-counts` | 11px | 400 | — | mono inherited (`:16921`) | `--text-3` | «3 / 17 задач» | `:5179` |
| 23 | `.progress-pct` | 13px | 700 | — | SF Pro | `--text-1` | «18%» под прогресс-баром | `:5187` |
| 24 | `.data-table-title` | 14px | 700 | — | SF Pro | `--text-2` | Заголовки таблиц «Сводка по командам», «Без релиза» | `:1350` |
| 25 | `.data-table th` | 11px | 600 | 0.3px CAPS | SF Pro | `--text-3` | Шапка таблиц | `:1352` |
| 26 | `.data-table td` | 12px | 400 | — | SF Pro | `--text-2` | Ячейки таблиц | `:1353` |
| 27 | `.count-badge` | 11px | 600 | 0 | mono | `--text-3` | бейдж рядом с заголовком таблиц | `:1177-87` |

> **Наблюдение:** в шкале **минимум 6 разных «числовых голосов»** (48, 28, 24, 22, 20, 13/14) и **минимум 4 разных «label-голоса»** (11/CAPS-1.5, 11/CAPS-0.6, 11/CAPS-0.3, 12/700-no-caps). Это уже звоночек.

---

## Section 2. Проблемы текущей типографики и палитры

### П2.1 — Конфликт `.prizma-hero-kpi` weight: 300 vs 700

**Что нарушено.** В `:587` декларация `font-weight: 300`. На `:16829` — override `font-weight: 700`. Это **противоречие в одном и том же файле** (двойной cascade-удар, выигрывает 700).

**Брендбук §4** (`BRAND_BOOK.md:139-148`) задаёт для главных чисел **MonoNumber: 24px / weight 300 / letter-spacing -0.5px**, для Display — **72px / weight 200**. Hero-KPI 48px должен сидеть между ними по весу: **200-300**, но никак не 700. Тонкий вес — это корневая идея Призмы («спокойный, точный»; Tone of voice §7 «спокойный, не тревожный»).

**Эффект.** Сейчас 48px/700 — это «банковская плакатная» подача (читается как заголовок BBC News). Анна (6/10) восприняла как «*экран с цифрами*», а не «спокойная точка». Олеся (8/10 за brand) полюбила hero именно за breathe-mark, а не за тяжёлое число — ей цифра показалась «грубой».

**Конкретное место.** `styles.css:585-592` (canonical 300) vs `:16827-32` (override 700, П11.1). Один из двух должен уйти; правильный — **300** (соответствует брендбуку §4).

---

### П2.2 — Двенадцать KPI равного веса = плоская иерархия (Анна 6/10)

**Что плохо для глаза.** В `views/dashboard.js:99-112` рендерится **12 карточек KPI** (`Всего задач`, `В scope (Да)`, `Вне scope (Нет)`, `Треб. подтв.`, `В релизе 1.20/1.21/1.22`, `В овертайме`, `Без релиза`, `Блокирующих зав.`, `Строк с рисками`, `Сделано`). Все рендерятся через **один и тот же класс** `.kpi-card` — 22px/600 mono для значения, 11px/CAPS/0.6 для label, та же геометрия. Различие — только 3px stripe-left signal-color у 4 из 12.

**Брендбук §3.3** (signal vs decoration, §3 «Пропорции в интерфейсе» строка 124): **5% — Signal-цвета (только статусы)**. Остальное — нейтрально. Текущий `.signal-drift` / `.signal-off-course` соответствует букве правила, но не духу: **stripe 3px** недостаточно силён, чтобы перевесить визуально равные размеры/веса. Анна в синтетическом интервью (`12-user-feedback.md:21`): «*15 cards равного веса в Дашборде*».

**Эффект.** Hero показывает 0% и эта подача доминирует, но сразу под ним 12 одинаковых плиток без primary-уровня — глаз *не понимает*, какие 3-4 KPI критические сегодня. Анне утром в переговорке с iPad (`12-user-feedback.md:26-27`) нужно «12 задач в риске — какие именно?», ответ требует второго клика, потому что **до клика все цифры весят одинаково**.

**Конкретное место.** `views/dashboard.js:99-112` — массив `kpis[]`. CSS — `.kpi-card` (`:1215-19`), `.kpi-value` (`:16836-41`).

---

### П2.3 — Четвёртая параллельная шкала чисел в release-card / risk-counter

**Что плохо.** Параллельно с hero (48/300) и KPI-grid (22/600) на одном экране живут:
- `.release-card-count` — **24px/700** в цвете `--prizma-information` (`:1341`).
- `.risk-counter-value` — **20px/700** в `--warning` (=`--prizma-drift`, `:1318`).
- `.progress-pct` — **13px/700** в `--text-1` (`:5187`).

Получаются 4 отдельных «числовых голоса»: 48 / 22 / 24 / 20 / 13. Никакой системы не прослеживается, и вес 700 у release-card-count визуально **перевешивает** KPI-grid (22/600) — притом что release-breakdown логически **вторичен** относительно KPI-grid.

**Брендбук §4.** Шкала задаёт только Display 72/200, Headline 32/300, Subtitle 18/500, Body 15/400, BodySmall 13/400, Caption 11/500, Wordmark 32/200, MonoNumber 24/300. Между Headline (32/300) и MonoNumber (24/300) — нет уровня для primary-KPI. Это **дыра в брендбуке**, которую нужно закрыть; иначе каждая команда (П11.1, П4) будет выдумывать свой вес.

**Эффект.** Дмитрий (5/10): «UI bloat» — это про неупорядоченные шкалы, в т.ч. типографические. Светлана (7/10) не лезет в дашборд, поэтому не страдает. Игорь (7/10) не страдает потому что ему важна плотность Реестра, а не типографическая иерархия.

**Конкретное место.** `:1341` (release-card-count) и `:1318` (risk-counter-value) — оба используют **standalone размер и вес**, не выровненные с brandbook §4. Также `:1339` (`.release-card-title` 15/700) — это ни Body 15/400, ни Subtitle 18/500.

---

### П2.4 — Signal-цвет используется как **декорация** в `.release-card-count`

**Что нарушено.** Брендбук §3.3 (signal vs decoration), §3 строка 106 буквально: «Signal — семантические цвета. Используются **только для статуса курса**, никогда как декорация».

В `:1341` `.release-card-count { color: var(--prizma-information); }` — это **синий signal**, применённый к **числу «N задач в релизе»**, у которого нет статуса курса. Это просто счётчик строк. То же в `.risk-counter-value` (`:1318`) — `color: var(--warning)` (=`--prizma-drift`); здесь полу-оправдано (риск == дрейф семантически), но цвет применён к **счётчику** («3», «5»), а не к индикатору состояния.

**Эффект.** Светлана (7/10) узнала Призму по brand-mark и breathe-анимации, но в `Перегрузка` без причины-в-словах signal-цвет ей **непонятен** (`12-user-feedback.md:115`): «*почему* красный — это потому что у него 120% load или потому что у него 3 блокера?». Та же проблема на дашборде: `--prizma-drift` стоит на 5/10/12 одновременно — в каждом значит разное.

**Конкретное место.** `:1318` (`.risk-counter-value`), `:1341` (`.release-card-count`). Плюс `.blocking-detail-title { color: var(--danger); }` на `:1327` — это **заголовок** в signal-цвете, а заголовок не статус курса.

---

### П2.5 — Hardcoded hex: `#fcd34d` и `#fca5a5` в risk/blocking-card

**Что нарушено.** Ограничение задачи (и брендбук): «Только токены `var(--prizma-*)`. Никаких хардкоженных hex». В:
- `:1316` `.risk-counter { border: 1px solid #fcd34d; }` — жёлтый.
- `:1323` `.blocking-detail-card { border: 1px solid #fca5a5; }` — розовый.

Эти hex не из брендбук-палитры и не из signal-tokens. Они выпадают из тёмной/светлой темы (под dark theme не проверено, скорее всего белеют).

**Эффект.** При переключении темы graceful degradation ломается. На retina эти бордеры воспринимаются как «случайный цвет», не как часть системы.

**Конкретное место.** `:1316` и `:1323`. Должны быть `var(--prizma-drift)` 30%-альфа (для warning-light surface) и `var(--prizma-off-course)` 30%-альфа.

---

### П2.6 — Эмодзи `⚠`, `🚧` в production UI

**Что нарушено.** `CLAUDE.md` (project-level, «Принципы дизайна V15»): «**Без эмодзи** в production UI». Брендбук §1 «спокойный, не тревожный».

- `:1312` `.risks-panel-title::before { content: '⚠'; color: var(--warning); }`
- `:1330` `.blocking-detail-title::before { content: '🚧'; }`

**Эффект.** Анна (PO) в утренний обзор видит `⚠ Риски внимания` и `🚧 Блокирующие зависимости`. Это **шумовой алерт**-tone, противоречащий §7 («спокойный, не тревожный», «Партнёр, не учитель»). Олеся (новичок) приняла `«Курс сверен» toast` за «*мини-история*, душевно» — а `⚠` тут читается как «банк-уведомление, не Призма».

**Конкретное место.** `:1312`, `:1330`. Замена — иконка-mini-star (12×12) или мини-glyph (точка signal-цвета 8×8). Брендбук §11 даёт паттерны Loaders (signal-dot 16-24px) — есть из чего собрать.

---

## Section 3. Предложение new type-scale

> Иерархия — трёхуровневое **трио** для чисел: **Hero (48) → Primary KPI (32) → Secondary stats (20)**.
> Подписи — **двухуровневое**: **Eyebrow CAPS 11/1.5** для hero/sectional / **Label CAPS 10/1.2** для KPI и supporting.
> Body — **15/400** для текста (по §4 брендбука), **13/400** для tertiary (BodySmall).

| # | Селектор | font-size | weight | letter-spacing | font-family | color-token | Назначение |
|---|---|---|---|---|---|---|---|
| 1 | `.prizma-hero-kpi` | **48px** | **300** (брендбук §4 MonoNumber-логика) | **-1px** | JetBrains Mono | `--prizma-text-primary` | Главный KPI «N%» — единственный hero |
| 2 | `.prizma-hero-caption` | 11px | 500 | 1.5px CAPS | SF Pro Display | `--prizma-text-secondary` | Eyebrow под hero |
| 3 | `.prizma-hero-supporting-num` | 20px | 400 | -0.2px | JetBrains Mono | `--prizma-text-primary` | 3 supporting под hero (без изменений) |
| 4 | `.prizma-hero-supporting-lab` | 10px | 500 | 1.2px CAPS | SF Pro Display | `--prizma-text-secondary` | Label supporting (без изменений) |
| 5 | `.prizma-page-eyebrow` | 10px | 600 | 1.2px CAPS | SF Pro Display | `--prizma-text-secondary` | «КУРС · ДАШБОРД» |
| 6 | `.prizma-page-h1` | 28px | 300 | -0.01em | SF Pro Display | `--prizma-text-primary` | h1 страницы (без изменений) |
| 7 | `.prizma-page-sub` | 15px (Body §4) | 400 | 0 | SF Pro Display | `--prizma-text-secondary` | Подзаголовок |
| 8 | **`.kpi-value` PRIMARY** (новый) | **32px** | **400** | **-0.5px** | JetBrains Mono | `--prizma-text-primary` | 3-4 главные KPI: что требует курса (риски, блокеры, треб.подтв., без курса) |
| 9 | **`.kpi-value` SECONDARY** (новый) | **20px** | **400** | **-0.2px** | JetBrains Mono | `--prizma-text-secondary` | 8-9 нейтральных KPI: всего, scope-Да/Нет, релизы 1.20/.21/.22, сделано |
| 10 | `.kpi-label` | 10px | 600 | 1.2px CAPS | SF Pro Display | `--prizma-text-tertiary` | Подпись KPI (для обоих PRIMARY/SECONDARY) |
| 11 | `.kpi-sub` | 13px (BodySmall) | 400 | 0 | SF Pro Display | `--prizma-text-tertiary` | дополнительная строка KPI |
| 12 | `.dash-empty-title` | 18px (Subtitle §4) | 500 | 0 | SF Pro Display | `--prizma-text-primary` | «Курс ещё не проложен» |
| 13 | `.dash-empty-sub` | 13px (BodySmall) | 400 | 0 | SF Pro Display | `--prizma-text-tertiary` | «Импортируйте план…» |
| 14 | `.risks-panel-title` | 11px | 500 | 1.5px CAPS | SF Pro Display | `--prizma-text-secondary` | Eyebrow секции рисков (CAPS, не bold) |
| 15 | `.risk-counter-value` | 20px | 400 | -0.2px | JetBrains Mono | `--prizma-text-primary` (нейтральный, signal — в stripe-left) | счётчик каждого риска |
| 16 | `.risk-counter-label` | 10px | 500 | 1.2px CAPS | SF Pro Display | `--prizma-text-tertiary` | Подпись счётчика |
| 17 | `.blocking-detail-title` | 11px | 500 | 1.5px CAPS | SF Pro Display | `--prizma-text-secondary` (НЕ signal — заголовок, не статус) | Заголовок секции блокеров |
| 18 | `.release-card-title` | 18px (Subtitle §4) | 500 | 0 | SF Pro Display | `--prizma-text-primary` | «1.20 / 1.21 / 1.22 / OT» |
| 19 | `.release-card-dates` | 11px | 400 | 0 | SF Pro Display | `--prizma-text-tertiary` | даты под заголовком релиза |
| 20 | `.release-card-count` | **20px** (downgrade с 24/700) | 400 | -0.2px | JetBrains Mono | `--prizma-text-primary` (НЕ `--prizma-information`) | Счётчик задач в релизе. Цвет — нейтральный, signal только если overload |
| 21 | `.mini-breakdown-label` | 12px | 400 | 0 | SF Pro Display | `--prizma-text-tertiary` | label scope-распределения |
| 22 | `.mini-breakdown-val` | 12px | 600 | 0 | JetBrains Mono | `--prizma-text-secondary` | val scope-распределения, mono |
| 23 | `.progress-label` | 11px | 500 | 1.2px CAPS | SF Pro Display | `--prizma-text-secondary` | label прогресс-карточки (CAPS, не 700) |
| 24 | `.progress-counts` | 11px | 400 | 0 | JetBrains Mono | `--prizma-text-tertiary` | mono счётчик «3 / 17 задач» |
| 25 | `.progress-pct` | 15px (Body §4) | 500 | -0.2px | JetBrains Mono | `--prizma-text-primary` | «18%» под прогресс-баром |
| 26 | `.data-table-title` | 11px | 500 | 1.5px CAPS | SF Pro Display | `--prizma-text-secondary` | Заголовки таблиц (eyebrow-стиль, не bold) |
| 27 | `.data-table th` | 10px | 600 | 1.2px CAPS | SF Pro Display | `--prizma-text-tertiary` | шапка таблиц |
| 28 | `.data-table td` | 13px (BodySmall §4) | 400 | 0 | SF Pro Display | `--prizma-text-secondary` | ячейки |
| 29 | `.count-badge` | 11px | 600 | 0 | JetBrains Mono | `--prizma-text-tertiary` | бейдж рядом с заголовком (без изменений) |

### Принципы новой шкалы

**Веса — ровно 4 уровня:**
- **700** — нигде на дашборде. Дешёвый эффект (Анна 6/10). Брендбук §4 не вводит 700 для чисел.
- **600** — только для CAPS-eyebrow на h1-уровне (если CAPS, weight выше для компенсации скруглённости). На числах — никогда.
- **500** — Subtitle (release-card-title), CAPS-labels, CAPS-eyebrow, dash-empty-title.
- **400** — все числа (KPI-value primary/secondary, hero-supporting, release-count, risk-counter), Body, BodySmall.
- **300** — Hero KPI 48px (брендбук §4 «MonoNumber 300»). Page h1 28px.

**Letter-spacing — ровно 6 уровней:**
- **-1px** — Hero 48px (single instance).
- **-0.5px** — Primary-KPI 32px.
- **-0.2px** — все остальные mono-числа 20-24px (компенсирует расхождение JetBrains Mono на средних размерах).
- **0** — Body, BodySmall, Subtitle.
- **1.2px** CAPS — все вторичные labels (kpi-label, supporting-lab, page-eyebrow, table-th).
- **1.5px** CAPS — eyebrow-уровень (hero-caption, page-section-eyebrow, risks-panel-title — для **зрительной паузы** между секциями).

**Mono-tabular везде:**
- Hero KPI, supporting-num — JetBrains Mono.
- KPI-value (primary/secondary) — JetBrains Mono.
- Release-count, risk-counter-value, progress-pct, progress-counts — JetBrains Mono.
- Данные в `<td>` для числовых колонок — `tabular-nums` через `font-feature-settings: "tnum" 1`.

> **TODO для брендбука §4.** Текущий §4 не покрывает «Primary KPI» уровень между Headline (32/300) и MonoNumber (24/300). Предлагаю ввести **«Primary KPI: 32px / weight 400 / letter-spacing -0.5px / JetBrains Mono / mono-tabular»** — это нынешняя дыра. Также §4 не задаёт Eyebrow (CAPS 11/1.5 / SF Pro Display / weight 500) явно — он есть в Caption-строке (11/500/1.5px), но без явного имени «Eyebrow» в тексте брендбука.

---

## Section 4. Палитра — новые правила

### 4.1. Где **ОБЯЗАТЕЛЬНО** signal-цвет

> Signal = «нужно действие или внимание прямо сейчас». 5% поверхности интерфейса (брендбук §3 строка 124).

| Место | Какой signal | Почему |
|---|---|---|
| **Hero stripe-left** на `.prizma-hero-kpi` | `--prizma-on-course` / `--prizma-drift` / `--prizma-off-course` в зависимости от %-курса | Это **главный** статус-сигнал дашборда: курс в норме / дрейф / сбился. 3px stripe-left уже реализован в `:569-573`, корректно. Сама цифра остаётся `--prizma-text-primary` — signal только в stripe. |
| **`.kpi-card.signal-drift` / `.signal-off-course` stripe-left** на 3-4 PRIMARY-карточках | drift / off-course | Только для KPI «требующих курса»: «Треб. подтверждения», «Без релиза», «Блокирующих зав.», «Строк с рисками» (если >0). Остальные 8 — **нейтральные** без stripe. |
| **`.signal-dot`** в progress-card-header при `overload` | drift | Уже реализовано на `views/dashboard.js:173`, корректно. Точка 8×8 — это атомарный signal. |
| **3px border-left на `.blocking-detail-card`** | off-course | Целая секция «блокеры» — это off-course статус. Сейчас border 1px hex `#fca5a5` — заменить на `border-left: 3px solid var(--prizma-off-course)` + остальные стороны `var(--prizma-border)`. |
| **3px border-left на `.risks-panel`** | drift | Целая секция «риски внимания» — drift статус. Аналогично. |

### 4.2. Где **ЗАПРЕЩЕНО** signal-цвет

| Место | Что сейчас | Должно быть |
|---|---|---|
| `.release-card-count` (`:1341`) | `color: var(--prizma-information)` — синий | `color: var(--prizma-text-primary)`. Число строк в релизе — не статус, это счётчик. Synal только если overload (>30 строк), и только в виде `.signal-dot` рядом. |
| `.risk-counter-value` (`:1318`) | `color: var(--warning)` (=drift) | `color: var(--prizma-text-primary)`. Само число риска — нейтральное. Signal — в stripe-left на parent `.risk-counter` (`drift` или `off-course` в зависимости от severity). |
| `.blocking-detail-title` (`:1327`) | `color: var(--danger)` (=off-course) | `color: var(--prizma-text-secondary)` + CAPS 11/1.5 eyebrow-стиль. Signal — в border-left секции, не в заголовке. |
| Декоративные числа в hero-supporting-num | `--prizma-text-primary` (сейчас ОК) | Так и остаётся. **Никогда** не красить supporting-num в signal — это создаст «3 цвета на одном hero», теряется доминирование KPI. |
| `.release-card-title`, `.data-table-title` | сейчас `--text-1`/`--text-2` — ОК | Остаётся нейтральным. Заголовок таблицы никогда не signal. |

### 4.3. Что должно остаться нейтральным

| Токен | Где |
|---|---|
| `--prizma-bg` | Главный фон секции, `body`. |
| `--prizma-bg-elevated` | `.kpi-card`, `.release-card`, `.risks-panel`, `.blocking-detail-card`, `.data-table-wrap`. |
| `--prizma-border` | Все default-границы карт и таблиц. |
| `--prizma-border-strong` | stripe-left на `.kpi-card.kpi-neutral` (нейтральный 3px stripe — уже реализовано на :16855). |
| `--prizma-text-tertiary` | Все labels, dates, captions внутри карт. |
| `--prizma-text-secondary` | Eyebrows, table-titles, sub-headers. |
| `--prizma-text-primary` | Все числа (включая release-count, risk-counter), все KPI-value. |
| `--prizma-mark` | Звезда в hero (`.prizma-hero-mark`). |

### 4.4. Конкретное предложение для 12 KPI на дашборде

> Из `views/dashboard.js:99-112`. Распределение **по новой иерархии**: 3-4 PRIMARY (32px) с signal только если статус-критичен, 8-9 SECONDARY (20px) нейтральных.

| # | Label | Текущий cls | Новый cls | Размер | Signal |
|---|---|---|---|---|---|
| 1 | Всего задач | `kpi-neutral` | `kpi-secondary` | 20px | — нейтральный |
| 2 | В scope (Да) | `kpi-neutral` | `kpi-secondary` | 20px | — нейтральный |
| 3 | Вне scope (Нет) | `kpi-neutral` | `kpi-secondary` | 20px | — нейтральный |
| 4 | **Треб. подтв.** | `signal-drift` | **`kpi-primary signal-drift`** | **32px** | **drift** stripe-left (нужно действие) |
| 5 | В релизе 1.20 | `kpi-neutral` | `kpi-secondary` | 20px | — нейтральный |
| 6 | В релизе 1.21 | `kpi-neutral` | `kpi-secondary` | 20px | — нейтральный |
| 7 | В релизе 1.22 | `kpi-neutral` | `kpi-secondary` | 20px | — нейтральный |
| 8 | **В овертайме** | `signal-off-course` | **`kpi-primary signal-off-course`** | **32px** | **off-course** stripe-left |
| 9 | **Без релиза** | `signal-drift` | **`kpi-primary signal-drift`** | **32px** | **drift** stripe-left |
| 10 | **Блокирующих зав.** | `signal-off-course` | **`kpi-primary signal-off-course`** | **32px** | **off-course** stripe-left |
| 11 | Строк с рисками | dynamic (off-course / neutral) | **`kpi-primary signal-off-course`** если >0, иначе `kpi-secondary` | **32px / 20px** | **off-course** только если есть |
| 12 | Сделано | `kpi-neutral` | `kpi-secondary` (можно подчеркнуть `signal-on-course` если ≥80%) | 20px | optional `on-course` |

**Логика разделения.** PRIMARY (4-5 карточек, 32px) — это «требует курса» по словам Анны: треб. подтв. / без релиза / блокеры / овертайм / риски. SECONDARY (7-8 карточек, 20px) — это **факты-распределения**: всего / scope-Да/Нет / релизы 1.20/.21/.22 / сделано. PRIMARY физически крупнее на 60% — глаз Анны находит их за 1 взгляд, не за 5.

**Сетка KPI-grid:** PRIMARY и SECONDARY можно держать в одной CSS-grid `repeat(auto-fill, minmax(155px, 1fr))` — высота карточек слегка отличается из-за 32 vs 20, но grid-row выровнен по самой крупной (PRIMARY). Это создаёт «два регистра громкости» в одной сетке, как 2 голоса в хоре.

---

## Section 5. Ритм и spacing

### 5.1. Базовая unit

**4px-base, 8px-major.** Брендбук явно не задаёт base-unit, но фактическая шкала в `styles.css` уже на 4-base: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48. Сохраняем.

> **TODO для брендбука.** Добавить §6.5 «Spacing scale: 4px base, 8/12/16/20/24/32/48/64 — major steps». Сейчас §6 только про размеры знака.

### 5.2. Gap между блоками

| Между чем | Gap | Логика |
|---|---|---|
| `.prizma-page-header` → KPI-grid | **32px** | После hero-блока пауза, чтобы взгляд «приземлился». |
| Hero → `.prizma-page-hairline` → toolbar | 16px / 1px-line / 0 | Уже корректно (`:541`). |
| `.kpi-grid` (между карточками) | **12px** (текущее) | Достаточно плотно для 12 карточек. Не увеличивать — сейчас норма. |
| `.kpi-grid` → `.dashboard-progress` | **24px** | Между типами секций. |
| `.dashboard-progress` → `.risks-panel` | **24px** | — |
| `.risks-panel` → `.blocking-detail-card` | **24px** | — |
| `.release-breakdown-grid` (между картами) | **16px** (текущее) | Карты крупнее KPI, gap чуть больше. |
| `.dashboard-tables-grid` колонки | **16px** | — |
| `.risk-counter` (между счётчиками) | **8px** (gap у risks-panel-items :1313 = 10px → выравниваем на 8). | Атомарный gap, элементы маленькие. |

### 5.3. Padding ключевых блоков

| Блок | Padding | Текущее | Логика |
|---|---|---|---|
| `.prizma-hero` | `32px 24px 24px` (top больше, bottom меньше — взгляд опускается) | `24px 0` | Симметричный 24/0 не даёт hero «вес». |
| `.kpi-card` (PRIMARY) | `20px 18px 18px 21px` (left = 18 + 3 stripe) | `16px` + `padding-left: 19px` (`:1278`) | PRIMARY-карты крупнее — паддинг чуть больше. |
| `.kpi-card` (SECONDARY) | `14px 14px 12px 17px` | `16px` | SECONDARY компактнее, экономит вертикаль. |
| `.release-card` | `20px` (текущее `18px`) | `:1336` | Чуть больше воздуха. |
| `.risks-panel` | `16px 20px` (текущее) | `:1308-09` | ОК. |
| `.blocking-detail-card` | `16px 20px` | ОК. | — |
| `.data-table-title` | `16px 20px 12px` (текущее `14px 18px 10px`) | `:1350` | Сетка 4-base — 14/18/10 не на 4-grid. |
| `.dash-empty` | `48px 20px` (текущее) — ОК | `:16885` | — |

### 5.4. Vertical rhythm

**Одна линия:** все заголовки секций (eyebrow CAPS 11/1.5, color `--prizma-text-secondary`) отстоят от верхней границы своей карточки **ровно на 16px** — это создаёт зрительную «полку» через дашборд.

**Числа:** baseline всех больших чисел (Hero 48, Primary 32, Secondary 20) выровнен на одну математическую сетку — line-height: 1 везде, чтобы baseline не «плавал» при смешанных размерах.

**Mono-tabular** работает ТОЛЬКО при одинаковом `letter-spacing` внутри каждой колонки. В `<td data-coltype="number">` letter-spacing: 0 (не -0.2/-0.5), потому что цифры в строке должны выровняться по столбцу копейка-в-копейку.

### 5.5. Hairline-разделители

Брендбук неявно использует 1px hairline `var(--prizma-border)` (`:539-541` `.prizma-page-hairline`). На дашборде сейчас один такой разделитель — между header и body. Я бы добавил ещё один — между **hero** и **KPI-grid**, чтобы зрительно отделить «Где курс» (hero) и «Что требует курса» (KPI). Это снижает 12-карточковый wall-of-numbers до **двух чтений**.

---

## Section 6. CSS-mockup ключевых правил

> **Псевдо-CSS, не для копипаста**, для иллюстрации правил Section 3-5.

```css
/* ─── HERO ─── каноничный, 48/300, mono-tabular */
.prizma-hero-kpi {
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 48px;
  font-weight: 300;                                /* брендбук §4, не 700 */
  letter-spacing: -1px;
  line-height: 1;
  font-variant-numeric: tabular-nums lining-nums;
  color: var(--prizma-text-primary);
}

/* ─── KPI-PRIMARY ─── 4-5 карточек «требует курса», 32/400 */
.kpi-card.kpi-primary .kpi-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 32px;
  font-weight: 400;
  letter-spacing: -0.5px;
  line-height: 1;
  font-variant-numeric: tabular-nums lining-nums;
  color: var(--prizma-text-primary);               /* signal — в stripe, не в цвете цифры */
}

/* ─── KPI-SECONDARY ─── 7-8 карточек-фактов, 20/400 */
.kpi-card.kpi-secondary .kpi-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 20px;
  font-weight: 400;
  letter-spacing: -0.2px;
  line-height: 1;
  font-variant-numeric: tabular-nums lining-nums;
  color: var(--prizma-text-secondary);             /* нейтральный, чуть тише primary */
}

/* ─── KPI-LABEL ─── единый CAPS для всех 12 карточек ─── */
.kpi-label {
  font-family: 'SF Pro Display', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--prizma-text-tertiary);
  margin-bottom: 8px;
}

/* ─── SIGNAL stripe-left, never colored numbers ─── */
.kpi-card { border: 1px solid var(--prizma-border); }
.kpi-card.kpi-neutral   { border-left: 3px solid var(--prizma-border-strong); }
.kpi-card.signal-drift      { border-left: 3px solid var(--prizma-drift); }
.kpi-card.signal-off-course { border-left: 3px solid var(--prizma-off-course); }
.kpi-card.signal-on-course  { border-left: 3px solid var(--prizma-on-course); }
/* запрет — цвет числа */
.kpi-card .kpi-value { color: var(--prizma-text-primary) !important; }

/* ─── EYEBROW для секций (risks/blocking/tables) ─── */
.risks-panel-title,
.blocking-detail-title,
.data-table-title {
  font-family: 'SF Pro Display', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--prizma-text-secondary);
}
/* убрать эмодзи ⚠ 🚧, заменить на mini signal-dot */
.risks-panel-title::before,
.blocking-detail-title::before { content: none; }

/* ─── RELEASE-CARD ─── никаких signal-цветов на счётчике ─── */
.release-card-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 20px;
  font-weight: 400;
  letter-spacing: -0.2px;
  color: var(--prizma-text-primary);               /* НЕ --prizma-information */
  font-variant-numeric: tabular-nums;
}
.release-card-title {
  font-size: 18px; font-weight: 500;               /* Subtitle §4, не 15/700 */
  color: var(--prizma-text-primary);
}

/* ─── BLOCKING/RISKS card ─── stripe-left, не hex ─── */
.blocking-detail-card {
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-left: 3px solid var(--prizma-off-course);
}
.risks-panel {
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-left: 3px solid var(--prizma-drift);
}
.risk-counter-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 20px; font-weight: 400; letter-spacing: -0.2px;
  color: var(--prizma-text-primary);               /* нейтральный */
  font-variant-numeric: tabular-nums;
}
```

---

## Section 7. Спорные моменты (для обсуждения с другими экспертами)

### С7.1. С IA-экспертом: «12 KPI или 8?»

Я предлагаю оставить все 12, но разделить на 4 PRIMARY + 8 SECONDARY. IA-аудитор (Section 1 в `02-ux-audit.md` если есть) может настаивать на **сокращении до 8 KPI** или вынесении части в hero-supporting (сейчас там 3 supporting). Если IA скажет «8 KPI достаточно», моя шкала всё равно валидна: 4 PRIMARY + 4 SECONDARY.

### С7.2. С motion-экспертом: stripe-left vs background-tint

Я топлю за **3px stripe-left** (V15 spine-pill, `CLAUDE.md`) на signal-картах. Motion-эксперт может предложить **анимацию stripe** (например, `.signal-off-course` с pulse-stripe) — это **поверх** моей шкалы, не противоречит. Но если он предложит **фоновую заливку** (`background: var(--prizma-off-course-bg)`) — это нарушает §3 «5% signal» и §3.3 «никогда декорация».

### С7.3. С interaction-экспертом: hover state

В `:1220` на `.kpi-card:hover { transform: translateY(-1px) }` сейчас 1px-сдвиг. Я бы предложил **+1px на stripe-width** при hover (3 → 4px) вместо translateY — translateY на 12 карточках в grid создаёт ряби. Interaction-эксперт может аргументировать наоборот.

### С7.4. С tone-of-voice экспертом: «Без курса» vs «Без релиза»

В KPI-array `dashboard.js:108` лейбл `Без релиза`. В hero-supporting (`:85`) — `БЕЗ КУРСА`. Это два лексикона — техно (релиз) и брендбук (курс). По §7 («Словарь Призмы», `BRAND_BOOK.md:213`) правильно — **«БЕЗ КУРСА»** везде. Но Дмитрий (5/10, `12-user-feedback.md:61`) уже психует на «След пути вместо Реестра» — навязать «без курса» вместо «без релиза» в тех-зоне может пушнуть его до 3/10. Tone-of-voice эксперт должен решить: **brand-словарь только в hero/toast** (как Insight 5 в `12-user-feedback.md:291-295`), либо **везде**.

### С7.5. С content-экспертом: длина labels

Мой `.kpi-label` 10px / 1.2px CAPS / 600 потребует, чтобы все 12 labels поместились в одну строку в карточке 155px-ширины. «Блокирующих зав.» и «Треб. подтв.» уже сейчас укорочены — это намёк, что content-эксперт уже ужал. Если он предложит расширить до «Блокирующих зависимостей» — мне придётся либо понижать font-size до 9px (тогда CAPS 1.2 стирается), либо разрешать 2-строчный label (что ломает vertical rhythm). Компромисс — оставить как есть.

### С7.6. С brand-экспертом / автором брендбука: апдейт §4

Брендбук §4 не покрывает Primary KPI 32/400. Также не задаёт явно spacing-scale (TODO для §6.5). Без апдейта брендбука каждая команда (П11.1, П4, П7) будет придумывать свои размеры — что и произошло (см. П2.1 двойной 300/700, П2.3 четыре числовых голоса).

---

## Сводка изменений

| # | Что делаем | Где | Эффект |
|---|---|---|---|
| 1 | Hero KPI weight 700 → **300** | `:16829` | Снимает «банковскую» тяжесть, восстанавливает брендбук §4 |
| 2 | Вводим **kpi-primary 32/400** для 4-5 карточек | новый класс | Hero (48) → Primary (32) → Secondary (20) — иерархия трио |
| 3 | Понижаем 8 нейтральных KPI до **20/400** | `.kpi-secondary` | Снимает плоскость 12 равных карточек (Анна 6/10) |
| 4 | Убираем signal-цвет с `.release-card-count` (`--prizma-information` → `--prizma-text-primary`) | `:1341` | §3.3 — signal не декор |
| 5 | Убираем signal-цвет с `.risk-counter-value` | `:1318` | То же, signal в stripe-left на parent |
| 6 | Заменяем hex `#fcd34d`, `#fca5a5` на `var(--prizma-drift)` / `var(--prizma-off-course)` 3px stripe-left | `:1316`, `:1323` | Соблюдение токенов |
| 7 | Удаляем эмодзи ⚠ 🚧 | `:1312`, `:1330` | §7 «спокойный, не тревожный» |
| 8 | Eyebrow CAPS 11/1.5 на всех section-titles | `.risks-panel-title`, `.blocking-detail-title`, `.data-table-title` | Единый «голос» заголовков |
| 9 | Subtitle 18/500 на `.release-card-title`, `.dash-empty-title` | `:1339`, `:16890` | Брендбук §4 Subtitle |
| 10 | TODO в брендбук §4: добавить **Primary KPI 32/400** уровень | `BRAND_BOOK.md` | Закрыть дыру в шкале |
| 11 | TODO в брендбук §6.5: spacing scale 4px-base | `BRAND_BOOK.md` | Закрыть дыру в системе |

---

**Отчёт записан в audit-2026-05-04/dashboard-redesign/02-VISUAL.md, длина ~410 строк.**
