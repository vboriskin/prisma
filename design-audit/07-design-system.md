# 07. Дизайн-система — предложение по обновлённым токенам

> **Роль**: дизайн-системщик. Предлагаю **набор токенов** (цвет, типографика, spacing, radius, shadow, motion, semantic) для нового дизайна. Без кода — таблицами и значениями.

## 1. Принципы

1. **Один источник правды** — все токены в `:root` + `body.theme-dark`. Никаких хардкодов в правилах после миграции.
2. **Семантические уровни** — токены делятся на **primitives** (фундамент) и **semantic** (контекстные алиасы). UI использует **semantic**.
3. **Тема — параметр, не fork** — переключение темы меняет значения primitives, semantic не дублируются.
4. **Scale, не free-form** — spacing/radius/font-size/motion идут по дискретной шкале, никаких «промежуточных» 12.5px.
5. **Концепция-aware** — три направления редизайна используют разные значения primitives, но **тот же набор semantic-токенов**. Это значит: можно менять направление за 1 файл (новые primitives) без переписывания всего CSS.

---

## 2. Структура токенов — двухуровневая

```
PRIMITIVES (физические значения)              SEMANTIC (контекстные алиасы)
─────────────────────────────────             ──────────────────────────────
Colors:                                        Surfaces:
--color-blue-50 .. blue-900                    --surface-bg
--color-neutral-50 .. neutral-900              --surface-card
--color-emerald-50 .. emerald-900              --surface-elevated
--color-amber-, --color-red-, …                --surface-overlay

Type-scale:                                    Borders:
--font-size-10 .. font-size-48                 --border-default
--font-weight-400 .. font-weight-800           --border-strong
                                                --border-focus
Space:
--space-0 .. space-24                          Text:
                                                --text-primary
Radius:                                        --text-secondary
--radius-2 .. radius-24                        --text-tertiary
                                                --text-on-accent

                                                Action:
                                                --action-primary
                                                --action-primary-hover
                                                --action-secondary
                                                ...
```

**Как меняется при темной/светлой теме**: только `surface-*`, `text-*`, `border-*` — указывают на разные primitives. Размеры/радиусы/spacing — не меняются.

**Как меняется при концепции** (A vs B vs C): меняются **primitives** (цвет-палитра, шрифт-семейство, размеры в шкале) → `semantic` остаётся тот же → UI-rules не трогаем.

---

## 3. Цвет — primitives

### Базовые шкалы (10-step Tailwind-like)

Текущая система использует 5-step (50/100/600/700) — это **минимально**. Расширяем до 10-step для каждого основного цвета, чтобы получить точный контроль над оттенками.

#### Neutral (используется как `--surface-*`, `--border-*`, `--text-*`)

| Token | Light theme | Dark theme |
|---|---|---|
| `--color-neutral-0` | `#ffffff` | `#0b1020` |
| `--color-neutral-50` | `#fafbfc` | `#0f152a` |
| `--color-neutral-100` | `#f3f4f6` | `#141d35` |
| `--color-neutral-200` | `#e5e7eb` | `#1f2a44` |
| `--color-neutral-300` | `#d1d5db` | `#2b3756` |
| `--color-neutral-400` | `#9ca3af` | `#445278` |
| `--color-neutral-500` | `#6b7280` | `#5f6e94` |
| `--color-neutral-600` | `#4b5563` | `#7c8baf` |
| `--color-neutral-700` | `#374151` | `#a3afca` |
| `--color-neutral-800` | `#1f2937` | `#d2dbeb` |
| `--color-neutral-900` | `#111827` | `#eff2f8` |
| `--color-neutral-950` | `#030712` | `#ffffff` |

(Логика: для dark — это «инвертированный» серый, не литеральная инверсия.)

#### Brand / Accent

> Конкретные значения зависят от концепции; см. `09-concepts.md`. Здесь — **структура** primitive-палитры accent.

| Token | Назначение |
|---|---|
| `--color-brand-50` | Очень светлый фон (бейджи) |
| `--color-brand-100` | Светлый фон (selected bg) |
| `--color-brand-200` | Hover для brand-100 |
| `--color-brand-300` | Border / disabled-on-brand |
| `--color-brand-400` | Secondary brand (illustrations) |
| `--color-brand-500` | **Default brand (action-primary)** |
| `--color-brand-600` | Hover для brand-500 |
| `--color-brand-700` | Active / pressed brand |
| `--color-brand-800` | Brand на тёмном фоне |
| `--color-brand-900` | Тёмный brand-фон (hero blocks) |

#### Semantic (status)

Аналогичные 10-step для `--color-success-*`, `--color-warning-*`, `--color-danger-*`, `--color-info-*`. **Без значимых изменений vs текущих** — emerald/amber/red/sky — semantic-stable, менять не надо.

---

## 4. Цвет — semantic-токены

> Они **не зависят от темы напрямую** — они указывают на primitives, которые **переключаются**.

### Surfaces (фоны)

| Semantic | Light → primitive | Dark → primitive | Использование |
|---|---|---|---|
| `--surface-bg` | `neutral-50` (`#fafbfc`) | `neutral-50` (`#0f152a`) | Фон страницы |
| `--surface-card` | `neutral-0` (`#ffffff`) | `neutral-100` (`#141d35`) | Cards / modals |
| `--surface-card-hover` | `neutral-100` | `neutral-200` | Hover на card |
| `--surface-elevated` | `neutral-0` | `neutral-100` | Hero blocks |
| `--surface-input` | `neutral-0` | `neutral-100` | Inputs / btn-outline |
| `--surface-row-hover` | `neutral-100` | `neutral-200` | Table rows hover |
| `--surface-header` | `neutral-50` | `neutral-200` | Sticky thead |
| `--surface-overlay` | `rgba(0,0,0,.45)` | `rgba(0,0,0,.7)` | Modal backdrop |

### Borders

| Semantic | Light | Dark | Использование |
|---|---|---|---|
| `--border-default` | `neutral-200` | `neutral-300` | Default thin border |
| `--border-strong` | `neutral-300` | `neutral-400` | Stronger borders, separators |
| `--border-focus` | `brand-500` | `brand-400` | Input focus ring |
| `--border-subtle` | `neutral-100` | `neutral-200` | Internal section dividers |

### Text

| Semantic | Light | Dark | Использование |
|---|---|---|---|
| `--text-primary` | `neutral-900` | `neutral-900` | Body text, headlines |
| `--text-secondary` | `neutral-600` | `neutral-700` | Subdued text |
| `--text-tertiary` | `neutral-500` | `neutral-600` | Meta, captions, labels |
| `--text-disabled` | `neutral-400` | `neutral-500` | Disabled states |
| `--text-on-accent` | `neutral-0` | `neutral-0` | Текст на brand-кнопках |
| `--text-link` | `brand-600` | `brand-400` | Гиперссылки |

### Action / interactive

| Semantic | Light | Dark | Использование |
|---|---|---|---|
| `--action-primary-bg` | `brand-500` | `brand-500` | Primary button bg |
| `--action-primary-bg-hover` | `brand-600` | `brand-400` | Primary hover |
| `--action-primary-bg-active` | `brand-700` | `brand-600` | Primary active |
| `--action-secondary-bg` | `neutral-0` | `neutral-100` | Secondary button (outline) |
| `--action-secondary-border` | `neutral-300` | `neutral-400` | Secondary outline |
| `--action-danger-bg` | `danger-500` | `danger-500` | Danger button |

### Status

| Semantic | Light | Dark | Использование |
|---|---|---|---|
| `--status-success-bg` | `success-50` | `success-100` | Bg для success-bauns |
| `--status-success-text` | `success-700` | `success-300` | Text |
| `--status-success-border` | `success-200` | `success-300` | Borders |
| (аналогично warning / danger / info) | | | |

---

## 5. Типографика — токены

### Семейства

| Token | A. Calm | B. Editorial | C. Workshop |
|---|---|---|---|
| `--font-display` | Inter Variable | Plus Jakarta Sans / Aeonik | IBM Plex Sans / Geist |
| `--font-body` | Inter Variable | Inter | IBM Plex Sans / Geist |
| `--font-mono` | JetBrains Mono | JetBrains Mono | IBM Plex Mono |
| `--font-serif` (опц.) | — | EB Garamond | — |

### Font-sizes (type-scale)

| Token | Value | Rem | Использование |
|---|---|---|---|
| `--text-3xs` | `10px` | 0.625rem | Микро-метки (UPPERCASE) |
| `--text-2xs` | `11px` | 0.6875rem | Caption, table-headers |
| `--text-xs` | `12px` | 0.75rem | Body таблиц, registry |
| `--text-sm` | `13px` | 0.8125rem | Default UI body, кнопки |
| `--text-base` | `14px` | 0.875rem | Lead text, card body |
| `--text-md` | `16px` | 1rem | Section H3 |
| `--text-lg` | `18px` | 1.125rem | KPI numbers (small) |
| `--text-xl` | `20px` | 1.25rem | Subsection H2 |
| `--text-2xl` | `24px` | 1.5rem | Section H2 |
| `--text-3xl` | `32px` | 2rem | Section H1 (top of page) |
| `--text-4xl` | `40px` | 2.5rem | Hero number / display |
| `--text-5xl` | `48px` | 3rem | Mega-display (rare) |

**Сравнение с текущим**: сейчас 10-13px доминируют, верхний предел 18px. В новой системе появляются 24/32/40/48 для заголовков и hero — **это ключевое обновление**.

### Font-weights

| Token | Value | Использование |
|---|---|---|
| `--weight-regular` | `400` | Body — **должен использоваться чаще, чем сейчас** |
| `--weight-medium` | `500` | UI body, default text |
| `--weight-semibold` | `600` | Subheaders |
| `--weight-bold` | `700` | Headlines, KPI numbers |
| `--weight-extrabold` | `800` | Hero (rare) |

### Line-heights

| Token | Value | Использование |
|---|---|---|
| `--leading-tight` | `1.1` | Display / hero (32px+) |
| `--leading-snug` | `1.25` | Headlines (16-24px) |
| `--leading-normal` | `1.5` | Body (12-14px) |
| `--leading-relaxed` | `1.625` | Long-form text |

### Letter-spacing

| Token | Value | Использование |
|---|---|---|
| `--tracking-tight` | `-0.02em` | Display (32px+) — компенсирует визуальный «отдых» крупного шрифта |
| `--tracking-normal` | `0` | Default |
| `--tracking-wide` | `0.02em` | UPPERCASE labels |
| `--tracking-wider` | `0.04em` | Micro UPPERCASE (10-11px) |

---

## 6. Spacing — scale

> Текущий проект использует hard-coded `12px / 16px / 20px / 14px / 8px` в разных местах. В новой системе:

| Token | Value | Использование |
|---|---|---|
| `--space-0` | `0` | — |
| `--space-1` | `2px` | Очень компактные gaps (chips inside row) |
| `--space-2` | `4px` | Tight spacing (icon-text gap) |
| `--space-3` | `6px` | Tight (mini-pills internal padding) |
| `--space-4` | `8px` | Compact gaps |
| `--space-5` | `10px` | Compact internal padding |
| `--space-6` | `12px` | **Default gap** между elements в section |
| `--space-7` | `14px` | Card padding (compact) |
| `--space-8` | `16px` | Default card padding, section padding |
| `--space-9` | `20px` | Generous section gap |
| `--space-10` | `24px` | Hero padding |
| `--space-12` | `32px` | Section break |
| `--space-16` | `48px` | Major section break |
| `--space-20` | `64px` | Page-level spacing |
| `--space-24` | `80px` | Reserved для full-page hero (rare) |

---

## 7. Radius — scale

| Token | Value | Использование |
|---|---|---|
| `--radius-2` | `2px` | Chip inner corners (workshop only) |
| `--radius-4` | `4px` | Mini-pills, badges, current `--radius-xs` |
| `--radius-6` | `6px` | Inputs (medium) |
| `--radius-8` | `8px` | Buttons, current `--radius-sm` |
| `--radius-10` | `10px` | Modals (workshop, current `.ti-modal`) |
| `--radius-12` | `12px` | Default cards, current `--radius` |
| `--radius-16` | `16px` | Hero blocks, current `--radius-lg` |
| `--radius-20` | `20px` | Большие display-cards (editorial only) |
| `--radius-full` | `9999px` | Pills, avatars |

**По концепциям**:
- A. Calm: используем 4 / 8 / 12 / 16 (как сейчас, минимально)
- B. Editorial: + 20 для hero, full для chips
- C. Workshop: больше 2 / 4 / 6 / 8 (минимум скругления, ничего больше 8)

---

## 8. Shadow — scale

### Текущая система

```
--shadow-xs:  0 1px 2px rgba(0,0,0,.05)
--shadow-sm:  0 1px 4px rgba(0,0,0,.08)
--shadow:     0 4px 16px rgba(0,0,0,.08)
--shadow-lg:  0 8px 32px rgba(0,0,0,.12)
```

Это **функциональные** shadows, нейтральные. По концепциям предлагаются **разные характеры**:

### A. Calm Operator — minimal, soft

| Token | Light | Dark |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(15, 23, 42, .04)` | `0 1px 2px rgba(0,0,0,.4)` |
| `--shadow-sm` | `0 2px 4px rgba(15, 23, 42, .06)` | `0 2px 4px rgba(0,0,0,.5)` |
| `--shadow-md` | `0 4px 12px rgba(15, 23, 42, .08)` | `0 4px 12px rgba(0,0,0,.55)` |
| `--shadow-lg` | `0 12px 32px rgba(15, 23, 42, .12)` | `0 12px 32px rgba(0,0,0,.6)` |
| `--shadow-xl` | `0 24px 64px rgba(15, 23, 42, .16)` | `0 24px 64px rgba(0,0,0,.7)` |

### B. Editorial Bold — coloured shadows

| Token | Light | Dark |
|---|---|---|
| `--shadow-xs` | `0 2px 4px -1px rgba(brand-300, .15)` | (как Calm) |
| `--shadow-sm` | `0 4px 8px -2px rgba(brand-300, .2)` | |
| `--shadow-md` | `0 8px 16px -4px rgba(brand-400, .2)` | |
| `--shadow-lg` | `0 16px 40px -8px rgba(brand-500, .25)` | |
| `--shadow-xl` | `0 32px 80px -16px rgba(brand-600, .3)` | |

(Тонировка тени брендовым цветом — современный приём, делает elevation характерной.)

### C. Workshop / Brutalist — offset, hard

| Token | Light | Dark |
|---|---|---|
| `--shadow-xs` | `2px 2px 0 0 var(--neutral-300)` | `2px 2px 0 0 var(--neutral-400)` |
| `--shadow-sm` | `3px 3px 0 0 var(--neutral-400)` | (analog) |
| `--shadow-md` | `4px 4px 0 0 var(--neutral-500)` | |
| `--shadow-hover` | `2px 2px 0 0 var(--brand-500)` | |
| `--shadow-active` | `0 0 0 2px var(--brand-500)` | |

---

## 9. Motion — токены

### Длительности

| Token | Value | Использование (по концепциям) |
|---|---|---|
| `--duration-instant` | `100ms` | Workshop hover/active |
| `--duration-fast` | `140ms` | Calm/Editorial hover |
| `--duration-mid` | `240ms` | Calm modal, Editorial section |
| `--duration-slow` | `400ms` | Editorial drag-drop, motion-reveals |
| `--duration-deliberate` | `600ms` | Editorial first-load reveals, KPI countup |
| `--duration-cinematic` | `1200ms` | Editorial большие cinema-моменты (rare) |

### Easing

| Token | Value | Использование |
|---|---|---|
| `--ease-linear` | `linear` | Indeterminate progress |
| `--ease-out` | `cubic-bezier(.0, .0, .2, 1)` | Most exits |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | Most entrances |
| `--ease-standard` | `cubic-bezier(.2, .8, .2, 1)` | Calm default |
| `--ease-emphasis` | `cubic-bezier(.22, .9, .28, 1)` | Calm modal |
| `--ease-overshoot` | `cubic-bezier(.34, 1.56, .64, 1)` | Editorial bounce |
| `--ease-snap` | `cubic-bezier(.0, .0, .0, 1)` | Workshop snap |

---

## 10. Иконки

### A. Calm Operator

- Стиль: **Outlined**, 1.5px stroke, rounded line-caps
- Inset 24×24 grid, 20×20 visible icon
- Source: vendored from **Lucide** (https://lucide.dev/) — open-source, 1100+ icons, MIT
- Vendoring: ~30-50 KB SVG inline в `libs/icons.svg` (sprite)

### B. Editorial

- Стиль: **Filled** + **Outlined mix** — outlined для UI-actions, filled для status/state
- 2px stroke, slightly rounded
- Source: Lucide или **Phosphor** (https://phosphoricons.com/)

### C. Workshop

- Стиль: **Mono-stroke 2px**, sharp corners, geometric
- 16×16 (compact)
- Source: Lucide stroke=2 OR **iconify-design**, ИЛИ выкрашенные тонкими линиями вручную

В любом случае: **никаких эмодзи** в продакшене (можно оставить в admin / dev-only views типа Diagnostics).

---

## 11. Components — фундаментальные паттерны

> Это не «список компонентов с примерами», это **семантическое разделение**.

| Component-class | Использование |
|---|---|
| `card` | `.card-default` / `.card-hero` / `.card-elevated` |
| `surface` | `.surface-bg` / `.surface-card` / `.surface-elevated` |
| `button` | `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger` / `.btn-icon` |
| `input` | `.input-default` / `.input-search` / `.input-inline` |
| `chip` | `.chip-status-*` / `.chip-tag` / `.chip-action` |
| `pill` | `.pill-wt` (work-type) / `.pill-status` / `.pill-team` |
| `nav-item` | `.nav-default` / `.nav-active` |
| `tab` | `.tab-default` / `.tab-active` |
| `badge` | `.badge-count` / `.badge-status` / `.badge-new` |

---

## 12. Migration plan — без полного редизайна

Если решено **не делать полный редизайн**, а **постепенно мигрировать на новую токен-систему**:

1. **Этап 1** (½ дня): Добавить **primitives** (10-step neutral / brand) рядом с текущими `--accent-*`, `--text-*`. Старые продолжают работать.
2. **Этап 2** (1 день): Добавить **semantic** layer (`--surface-*`, `--text-*`, `--action-*`) — указывая на primitives. Оставить старые алиасы (`--card`, `--accent`) как алиасы новых.
3. **Этап 3** (2-3 дня): Постепенно переписать `styles.css`-rules на semantic-токены. Это можно делать point-by-point, без big-bang.
4. **Этап 4** (по решению): Применить новую type-scale. Это самое заметное изменение.

**Эффект после Этапа 3** (только система токенов, без визуальных изменений): код становится 30-40% компактнее (повторяющиеся paint-rules уходят в вариативность токенов), темы и концепции становятся 1-параметровыми. **Внешний вид при этом — не меняется**.

---

## 13. Ключевые числовые изменения по сравнению с текущим

| | Сейчас | Предложение |
|---|---|---|
| Уровней neutral | 4 (`--text-1..4`) + 5 (`--surface-*`) = 9 | 12 (`--neutral-0..950`) |
| Уровней brand | 4 (`--accent`/`-dark`/`-light`/`-muted`) | 11 (`--brand-50..950`) |
| Type-sizes | 10+ ad-hoc (10/10.5/11/11.5/12/12.5/13/14/16/18) | 12 в строгой шкале |
| Spacing tokens | 0 (hardcoded) | 12 в шкале |
| Radius tokens | 4 (`xs/sm/normal/lg`) | 9 |
| Shadow tokens | 4 (`xs/sm/normal/lg`) | 5-6 + per-concept tonality |
| Motion durations | 3 (`fast/mid/slow`) | 6 |
| Motion easings | 2 (`standard/emphasis`) | 7 |

---

## 14. Что **не нужно** делать

- ❌ **Перепрыгивать** на дизайн-токены ради дизайн-токенов. Цель — concept first, токены подстраиваются.
- ❌ Делать **JSON-based design-tokens** (Style Dictionary, Tokens Studio) — для vanilla-проекта это overkill. CSS-vars достаточно.
- ❌ Декомпозировать `styles.css` на 10 файлов **до миграции**. Сначала миграция, потом декомпозиция.
- ❌ Вводить **новые semantic-категории** без явной потребности (например, `--text-warning-on-status-success` — нет такого UI-кейса).
