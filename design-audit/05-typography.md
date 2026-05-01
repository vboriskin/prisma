# 05. Типографика

> **Роль**: типограф. Анализирую текущий выбор шрифтов, использование, и предлагаю 2–3 пары на каждое из направлений.

## 1. Текущая типографика

### Шрифт

```css
--font: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
```

**Что это значит**:
- Если у пользователя установлен Inter (на самом деле редко на Windows-only машинах в банке) — используется Inter
- Иначе — Segoe UI (Windows), San Francisco (macOS), Roboto/Noto Sans (Linux/Android), Helvetica (старый macOS)
- Это **system-fallback strategy** — не загружается webfont, мгновенный рендер, нулевой network cost

**Плюсы**:
- 0 KB загрузки
- Мгновенный рендер
- Сейф в политике «no new deps»

**Минусы**:
- На Windows 10-машинах в Сбере чаще всего Segoe UI → не Inter
- Невозможно использовать Inter-specific features (variable axes, optical sizing, alternative number forms, character stylistic sets)
- Между разными OS интерфейс выглядит **разно** — стандартизация теряется
- Нет brand-character — system-fonts по определению нейтральны

### Использование (статистика по styles.css)

```
Веса:                     Размеры (top-10, в порядке убывания):
700  →  195 раз            11px → 179 раз  (UPPERCASE метки, бейджи)
600  →  107                12px → 157      (body таблиц)
500  →   26                13px → 106      (кнопки, summary)
800  →   17                10px →  63
400  →    6                12.5px → 41
900  →    1                11.5px → 32
                           14px →  31
                           18px →  22      (KPI numbers)
                           16px →  22      (section h2)
                           10.5px → 18
```

**Наблюдения**:
- **Regular (400) использован всего 6 раз** — это значит, что весь текст в продукте «давит» весами 600-800. Нет «спокойных» мест.
- Доминируют **10-13px** — типичная B2B-плотность.
- **Заголовков 20px+ практически нет** — нет «больших моментов».
- Для key-numbers используется максимум 18px → этого мало для KPI.
- `.cell-number` использует `font-variant-numeric: tabular-nums` — единственная типографическая «деталь» в проекте, и хорошо.

### Что не делается, что могло бы

| Feature Inter | Используется? | Эффект если включить |
|---|---|---|
| Variable weight (100-900) | ❌ Нет, только 400/500/600/700/800 | Smooth transitions on hover; precise control over hierarchy |
| Tabular figures (`tnum`) | ✅ Только в `.cell-number` | Должно быть **везде**, где есть числа в столбце |
| Slashed zero (`zero`) | ❌ | Помогает различать `0` и `O` в monospace-key контекстах |
| Stylistic sets (`ss01`, `ss02`) | ❌ | Альт-формы для `g`, `i`, etc. — даёт характер |
| `font-feature-settings: 'cv11'` (alt-1) | ❌ | Single-storey `1` — выглядит более geometric |

---

## 2. Проблемы в существующей системе

### П-1. Нет display-pair

В продукте нет ни одного шрифта **для главных моментов** (hero numbers, hero headlines). Inter — отличный body-шрифт, но он же используется для KPI 18px, и для table-headers 11px UPPERCASE, и для ms-tag 10px. Один шрифт делает всю работу — это «functional», но **не выразительно**.

Сильные интерфейсы (Stripe, Linear, Notion) используют **2 разных шрифта**:
- Display / Headlines: характерный (sans с особенностями, или serif)
- Body / UI: нейтральный, читаемый при малых размерах (Inter/IBM Plex/etc.)

### П-2. Нет монументальных моментов

Самый крупный текст в продукте — 18px (KPI numbers). Это **немонументально**. В современных дашбордах key-metrics часто 32-48px, чтобы создать «cinema»-эффект на главной странице.

В Линеар на главных view'ах есть текст 28-32px. В Stripe Dashboard — KPI 32-40px. Всё, что меньше 24px — body, не headline.

### П-3. Нет regular-веса

400 weight используется **только 6 раз** в всей кодовой базе. Это значит, что **весь текст «доказывает свою важность»**. Когда всё важное — ничего не важное. Глаз устаёт.

### П-4. UPPERCASE с letter-spacing — единственный способ обозначить «label»

```css
font-size: 11px; text-transform: uppercase; letter-spacing: .3px-.4px; font-weight: 700;
```

Это паттерн "B2B small caps" — эффективно, но банально. Используется везде, где нужно сказать «это не основной текст» — KPI labels, table headers, summary labels.

Альтернативы (оставить как есть в большинстве мест, но в hero-блоках использовать):
- Text-style «caption» с регулярным весом и микро-color (например, `--text-3` italic)
- True small-caps если шрифт поддерживает (Inter поддерживает через `font-feature-settings: 'smcp'`)

---

## 3. Предложения — пары шрифтов

> Принцип: **один display + один body**. Body должен быть читаем при 10-12px. Display — характерный, для headlines / KPI / hero.

### Пара 1: «Calm Operator» — спокойный профи

**Display**: **Inter Display** (вариант `font-feature-settings: 'opsz' 28`)
- Это тот же Inter, но `opsz` axis = 28 — оптимизированная под крупные размеры версия
- Нужен variable Inter (≈600 KB woff2 vendored в `libs/`)

**Body**: **Inter** (`opsz` 14, default)

**Mono**: **JetBrains Mono** (vendored, ≈250 KB)

**Почему**:
- **One-family** approach — нет несостыковки между display и body
- Variable axes даст **бесплатно** smooth weight transitions, optical sizing, и slashed-zero
- Знакомый, но через variable features ощущается фирменно

**Затраты**: ≈800 KB woff2 в `libs/` (Inter Variable + JetBrains Mono Regular)

**Стиль**: тонкий, чистый, technological. **Без характера** — но через **детали** (tabular nums везде, optical sizing, variable weight 350 для regular) ощущается «продуманным».

---

### Пара 2: «Editorial Operator» — с характером

**Display**: **Söhne** (или **Söhne Breit** — широкий вариант для headlines) ИЛИ open-source альтернатива **GT Walsheim** / **Aeonik**
- Если бюджета на лицензии нет — **Manrope** (free) или **Plus Jakarta Sans** (free)

**Body**: **Inter** (тот же, что в пара 1)

**Optional accent**: **Tiempos Headline** или **Reckless Neue** для **очень редких** моментов (название продукта, «hero number» на дашборде) — даёт editorial-feel.
- Free-аналог: **Source Serif 4** или **EB Garamond**.

**Mono**: **JetBrains Mono**

**Почему**:
- Display-шрифт даёт **характер** (Walsheim/Aeonik — geometric, confident, friendly).
- Mix sans + occasional serif — current trend, добавляет «editorial gravitas».
- Body остаётся Inter — не теряем читаемость и tech-feel.

**Затраты**: ≈1.2-1.5 MB woff2 (display + body + mono + редко-используемый serif)

**Стиль**: confident, хорошо запоминается, **современный** без trends-overdose.

**Free-вариант (если без коммерческих шрифтов)**:
- **Display**: Plus Jakarta Sans (Google Fonts, free, geometric, friendly)
- **Body**: Inter
- **Mono**: JetBrains Mono
- **Accent serif** (опционально): EB Garamond

---

### Пара 3: «Workshop / Brutalist» — мастеровой, плотный

**Display**: **IBM Plex Mono** (для headlines!) ИЛИ **Space Grotesque** ИЛИ **PP Supply Mono** (если коммерческий бюджет)
- Free: **Space Grotesque** (Google Fonts) или **JetBrains Mono Bold** для headlines

**Body**: **IBM Plex Sans** (free) или **Geist** (Vercel, free)

**Mono**: тот же IBM Plex Mono / JetBrains

**Почему**:
- Mono-headlines — сильное, character-led решение
- IBM Plex — open-source, разработан IBM для their software products → semantically близко (это инструмент, а не consumer app)
- Geist — новый Vercel-шрифт, neutral but modern

**Затраты**: ≈900 KB-1 MB

**Стиль**: непугливый, явный, technical. Каждая буква читается. Нет softness.

---

## 4. Рекомендация по выбору

| Если выбрана концепция | Используем пару |
|---|---|
| **Quiet Tools** (направление A) | **Пара 1**: Inter Variable + JetBrains Mono |
| **Editorial Bold** (направление B) | **Пара 2**: Plus Jakarta Sans / Aeonik + Inter + EB Garamond + JetBrains Mono |
| **Workshop / Brutalist** (направление C) | **Пара 3**: IBM Plex Sans + IBM Plex Mono (or Geist + JetBrains Mono) |

---

## 5. Иерархия размеров — рекомендация

Текущая иерархия фрагментарна (10/10.5/11/11.5/12/12.5/13/14/16/18) — слишком много промежуточных значений. Мы предлагаем **строгую type-scale**:

| Token | Size | Weight | Use case |
|---|---|---|---|
| `--ts-display` | **48px** | Variable 600 | Hero numbers, splash |
| `--ts-h1` | **32px** | 700 | Section h1 (Дашборд) |
| `--ts-h2` | **24px** | 700 | Subsection h2 |
| `--ts-h3` | **18px** | 700 | Card titles, KPI numbers |
| `--ts-body-l` | **14px** | 500 | Larger body / lead |
| `--ts-body` | **13px** | 400 | Default body |
| `--ts-body-s` | **12px** | 400 | Table cells |
| `--ts-caption` | **11px** | 500 | Small labels |
| `--ts-micro` | **10px** | 600 | Bbtags, badges, UPPERCASE |
| `--ts-mono` | **12px** | 500 | Jira-keys, code |

**От текущего к новому: пересчёт**

- Текущий 18px (KPI) → `--ts-h3` 18px (то же)
- Hero KPI (новые) — `--ts-display` 48px (новое; используется только на дашборде главного блока)
- Section h2 «Сводный дашборд» (текущий 16-18px) → `--ts-h1` 32px (увеличиваем)
- Table headers (текущий 11px UPPERCASE 700) → `--ts-micro` 10px (то же стилем)
- Body таблиц (текущий 12px 600/700) → `--ts-body-s` 12px **400** (уменьшаем weight!) — чтобы появился breathing room

---

## 6. Утилитарные правила, которые надо ввести

| Правило | Где |
|---|---|
| `font-variant-numeric: tabular-nums` | На все числовые столбцы и KPI-числа (сейчас только в `.cell-number`) |
| `font-feature-settings: 'cv11', 'ss01'` | Для display-headlines (если шрифт это поддерживает) |
| `text-rendering: geometricPrecision` | Для крупных headlines |
| `font-variant-numeric: slashed-zero` | В моноширинных контекстах (Jira-keys) |

---

## 7. Webfont vs system-font: компромисс

Если **нельзя** вендорить webfont (CTO-policy):
- Используем `'Inter', system-ui, sans-serif` как сейчас
- Пишем **fallback-strategy** на CSS-переменные: `--font-display`, `--font-body`, `--font-mono` — все указывают на Inter / system-ui / monospace соответственно
- Когда policy разрешит — меняем только value переменной, без правок rules

Если **можно** вендорить woff2 в `libs/`:
- Это **самый быстрый** path к выразительной типографике
- Размер 1-1.5 MB не критичен (xlsx.full.min.js уже занимает 930 KB)
- Loading через `font-display: swap` — без FOUT-проблем

**Промежуточный вариант**: Google Fonts через `<link rel="preconnect">` — но это network-dependency, корпоративная сеть может блокировать `fonts.gstatic.com`. **Не рекомендую**.

---

## 8. План внедрения (без редизайна, просто типография)

Если решено сделать **только типографику** без полного редизайна:

1. Завести `--font-display`, `--font-body`, `--font-mono` в `:root`.
2. Вендорить выбранную пару в `libs/fonts/`.
3. Прописать `@font-face` в начале `styles.css` или отдельном `styles/fonts.css`.
4. Завести type-scale variables (`--ts-display..--ts-micro`).
5. Постепенно мигрировать **только заголовки секций** на новый scale (н-р, `.section-header h2 { font-size: var(--ts-h1) }`) — это даст 30% эффекта.
6. Затем — KPI numbers на `--ts-h3` или `--ts-display` (если есть hero-блок).
7. Затем — переписать body-text на 400/500 weight с увеличением breathing.

**Ожидаемый эффект** (без других изменений): ~30% увеличение subjective-perception «качество интерфейса». Это самый дешёвый улучшайзер.
