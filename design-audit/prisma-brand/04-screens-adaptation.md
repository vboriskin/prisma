---
role: UI Designer
author: Игорь Тен
date: 2026-05-03
status: draft
depends_on: 01-art-direction.md, 03-header-and-navigation.md
---

# 04. Адаптация экранов под «Призму»

> Анна задала рамку (Editorial Operator + 6 лучей с правилом «один луч на экран», eyebrow CAPS + хейрлайн + stripe-left, запрет фоновых wash'ей и цветных CTA). Мария разложила навигацию и шапку. Дмитрий — живой mark. Моя работа — спустить эту рамку в реальные экраны продукта так, чтобы фронтенд сел и начал верстать без додумывания, а волна 1 (Дашборд + Реестр + Отчёт CEO) могла уйти в код в ближайшие 2 спринта без блокеров. Я **не** трогаю DOM-структуру там, где она работает — меняю токены, типографику, иерархию, отдельные новые компоненты (eyebrow, hairline, ray-stripe). Реализация — фронтенд по чек-листу §9.

---

## 1. Page-template — общий каркас страницы Призмы

Любая страница продукта (за исключением модалок и чисто-canvas Ганта в fullscreen) собирается из четырёх вертикальных зон в строгом порядке. Это не «гайдлайн с исключениями» — это **обязательный каркас**, в котором живёт правило «один луч на экран».

```
┌────────────────────────────────────────────────────────────┐
│ ZONE A · Page-header           (eyebrow + h1 + sub)        │
│ ───────────────────────────────────────────────────────── │ ← hairline 1px ray
│ ZONE B · Page-toolbar          (фильтры/сортировка/actions)│  нейтральный
│ ───────────────────────────────────────────────────────── │ ← hairline 1px neutral
│ ZONE C · Page-body             (table / canvas / cards)    │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

Нижняя хейрлайн под toolbar — нейтральная (`--hairline`), верхняя — цвета луча. Это даёт тимлиду **двойной якорь сверху**: первая нить говорит «в каком я луче», вторая — «где кончается шапка-зона и начинается работа».

### 1.1. ZONE A — page-header

Состав сверху-вниз, без альтернатив:

1. **Eyebrow CAPS** — `ЛУЧ ПЛАНИРОВАНИЯ`, Plus Jakarta 600, 10 px, letter-spacing 0.12em, color `var(--ray-{current})`. Margin-bottom 6 px.
2. **H1** — Plus Jakarta 700, 28 px (было 20 в `.section-header h2`), line-height 1.2, `--text-1`, ls -0.01em. Margin-bottom 4 px.
3. **Подзаголовок (опционально)** — Inter 400, 14 px, `--text-2`, max-width 60ch. Только на редакционных экранах (CEO, AI-Анализ, History).
4. **Hairline 1 px** — `var(--ray-{current})`, margin-top 16 px, full-width контейнера page-body.

Padding `24px 24px 0`. Без иконок и actions в шапке — иконка в sidebar, actions в toolbar.

### 1.2. ZONE B — page-toolbar

Нейтральная горизонталь высотой 44 px, прижата к page-header. Состав слева-направо, опционально:

- **Tab-switcher** (только для Планирования, Мария §4): underline-active 2 px `var(--ray-planning)`, остальные подразделы — `--text-3`.
- **Фильтр-чипы** (active filters с ×) — серый pill, см. §3.3.
- **Сортировка / группировка** — ghost-кнопка с иконкой, нейтрально.
- **Spacer** — flex: 1.
- **Главное действие раздела** (`+ Эпик`, `Экспорт PDF`, `Сохранить snapshot`) — primary-button нейтральный (Indigo Ink или чёрный, **не** цвет луча — Анна §3).

Padding `0 24px`, нижний border `1px solid var(--hairline)`. Sticky при скролле для таблиц (Реестр, Сотрудники), не sticky для редакционных экранов (CEO-отчёт).

Toolbar **может отсутствовать** на чистых редакционных страницах (Отчёт CEO, splash). Тогда ZONE A прилегает прямо к ZONE C.

### 1.3. ZONE C — page-body

Padding `24px`. Содержит то, ради чего пользователь сюда пришёл: таблица, canvas, сетка карточек, длинный текст. Здесь **луч исчезает** — все цвета нейтральные либо семантические (success/warning/error). Единственное исключение — **один** hero-KPI на странице получает цвет луча (Анна §2.2 «KPI-цифра в hero-блоке»), и это право принадлежит первой по визуальной важности цифре в зоне body. Остальные KPI — нейтрально-чёрные.

### 1.4. Состояния

- **Empty state** — центрированный блок 320–400 px ширины, без иконок-эмодзи (банковский tone-of-voice). Eyebrow CAPS «НЕТ ДАННЫХ» цвета `--text-3`, h3 Plus Jakarta 600 18 px нейтрально, sub Inter 14 px `--text-2`, ниже primary-кнопка действия. Margin-top 96 px от верха ZONE C.
- **Loading skeleton** — серые прямоугольники `--bg-secondary`, shimmer-анимация 1.4 s linear infinite. **Не** окрашены в цвет луча — иначе при загрузке экран моргает чужим лучом. Skeleton = «пустой контейнер», не «бренд».
- **Error state** — `--state-error` 1 px border, eyebrow «ОШИБКА» того же цвета, h3 нейтральный, sub `--text-2` с описанием, кнопка «Повторить». Не цвет луча даже если ошибка случилась в Контроле — Анна §3 правило семантики.

---

## 2. Дашборд — луч КОНТРОЛЯ (Amber Forge `#B8651A` light / `#E8A766` dark)

Это первый экран, на который попадает тимлид утром. Hero должен мгновенно отвечать на единственный вопрос «насколько всё в порядке?». Текущий `views/dashboard.js:24` рендерит 8 параллельных блоков — это слишком плоско, нет иерархии. Перестраиваю.

### 2.1. Hero-зона

**Один hero-KPI** наверху ZONE C, прижат к toolbar — **одна доминанта + контекст**, не сетка из 12 карточек как сейчас.

- **Главная цифра** — % выполнения квартала, **48 px**, Plus Jakarta 700, color `var(--ray-control)` (Amber Forge). Единственное место заливки amber на дашборде.
- Под цифрой — Inter 13 px `--text-2`: «Здоровье квартала · {date}, {time}». Timestamp обязателен.
- Справа (flex row, gap 32 px) — **3 supporting-числа**: рисков / блокеров / без релиза. Plus Jakarta 600 24 px `--text-1`, labels CAPS 10 px `--text-3`. Цифры окрашиваются в `--state-warning/-error` если > 0, **не** в amber.

Flex row на ≥ 1280, column на ≤ 1024. Min-height 96 px. Без border/фона. Margin-bottom 32 px до сетки.

### 2.2. Карточки/блоки в body

Сетка карточек под hero — «вторичная плотность» (release-cards, breakdown, anomaly). Сетку `.kpi-grid` (`auto-fill, minmax(155px, 1fr)`) оставляю, **карточку переделываю**.

Новая `.kpi-card`:
- `border: 1px solid var(--hairline)`, `border-radius: 4 px` (было ~8 — squircle уходит).
- Без shadow. Hover — `border-color: var(--text-3)` (нейтральное усиление линии).
- `::before` 3 px stripe-left остаётся, но теперь **семантический** маркер из `--state-*` (ok/warning/error/info), не «цвет KPI». Лучи в карточки не приходят.
- Padding `16px 16px 16px 19px`.

Внутри: eyebrow CAPS 10 px `--text-3` («РЕЛИЗ 1.21») → опциональный H3 Plus Jakarta 600 14 px → **KPI-цифра 24 px Plus Jakarta 700 `--text-1` tabular-nums** (никогда не цвет луча — hero уже взял Amber) → подпись JetBrains Mono 11 px `--text-2` со стрелкой delta семантического цвета.

### 2.3. Состояния карточки (ok / warning / danger)

Через семантические `--state-*` токены, **не лучи**:

| Состояние | Stripe-left | Eyebrow color | KPI-цифра |
|---|---|---|---|
| ok      | `--state-ok` (graphite-зелёный) | `--text-3` | `--text-1` |
| warning | `--state-warning` (тёплый янтарь) | `--state-warning` | `--text-1` (цифра остаётся нейтрально) |
| danger  | `--state-error` (приглушённый кирпич) | `--state-error` | `--state-error` (**цифра окрашивается** — это единственный случай) |
| info    | `--state-info` (slate-синий) | `--text-3` | `--text-1` |

Логика: цифра краснеет **только** в danger. Warning подсвечивает eyebrow + stripe, но цифра нейтральная — иначе при 8 жёлтых карточках экран превращается в светофор.

### 2.4. Anomaly chips

Текущие `.risk-badge-*` (filled-color) → **hairline-style**: 22 px, padding `2px 8px`, `border: 1px solid var(--state-{level})`, фон прозрачный, JetBrains Mono 10 px CAPS `--state-{level}`. Эмодзи-иконки сваливаются. На плотных листах (>5 chip'ов в строке) — переход на нейтральный border + цветная точка 6 px слева.

### 2.5. Цветовое присутствие луча — где Amber появляется

Дисциплина: на Дашборде **amber присутствует ровно в трёх местах**, и только в них:

1. **Eyebrow** `ЛУЧ КОНТРОЛЯ` в page-header.
2. **Hairline 1 px** под page-header.
3. **Главная цифра hero-KPI** — % выполнения квартала.

Всё. Нет amber-карточек, нет amber-кнопок, нет amber-фонов, нет amber-borders на табличках в body. Если проверка покажет, что amber присутствует ещё где-то — это регрессия. Sidebar-stripe и mark-segment управляются глобально из шапки и не считаются «появлениями на странице» (они одинаковы во всех разделах Контроля).

---

## 3. Реестр — луч ПЛАНИРОВАНИЯ (Indigo Ink `#2B3A67` light / `#7A8FCF` dark)

Самый сложный экран продукта, тест на §3 Анны: editorial-типографика **должна** выдержать плотность 50+ строк и inline-edit. Если Реестр развалится — концепция не масштабируется.

### 3.1. Page-header в Реестре

Полноценный page-header **обязателен**, но **минимальный**: eyebrow + h1 + hairline. Подзаголовок отсутствует — Реестр это «рабочая лошадь», не редакционный экран. **Высота шапки 76 px** (24 + 12 + 28 + 6 + 16 hairline space). Это много для частого экрана, но цена «знания где я» — оправданная.

**Sticky behavior:** page-header **не sticky**. Sticky остаётся только page-toolbar (с фильтр-чипами и `+ Эпик`) — потому что при скролле на 50-й строке таблицы `+ Эпик` нужен, а eyebrow «ЛУЧ ПЛАНИРОВАНИЯ» уже не нужен (его роль играет ray-indicator в шапке приложения).

Tab-switcher из §4 Марии (`Реестр / Гант / Канбан / Подложка / Таймлайн`) — **первый ряд внутри page-toolbar**. Underline 2 px `--ray-planning`, активная вкладка Plus Jakarta 600 13 px `--text-1`, неактивные 500 `--text-3`.

### 3.2. Таблица — где живёт цвет, где исчезает

Анна §3: «в теле таблицы луч исчезает».

**Header (`thead th`):** фон `--surface-0`, bottom-border 1 px `--hairline`, Plus Jakarta 600 11 px CAPS ls 0.08em `--text-2`. Sticky-top даёт `box-shadow: 0 1px 0 var(--hairline)`. Sort-active: текст → `--text-1` + ↑/↓ глиф 10 px. Drag-over: `outline: 1.5px dashed var(--ray-planning)` (вместо текущего `2px dashed var(--accent)`) — **единственное** место в таблице с indigo, как кратковременный affordance.

**Строки:**
- **Зебра убирается полностью.** Editorial = «ровная бумага», hairlines + tabular-nums дают читаемость без полосок.
- `border-bottom: 1px solid var(--hairline)` на каждую row.
- **Hover:** `background: var(--bg-secondary)` (текущий `#f8f9ff` уходит).
- **Selected (multi-select):** `--bg-secondary` + `box-shadow: inset 3px 0 0 var(--ray-planning)`.
- **Focused cell:** `outline: 2px solid var(--ray-planning); outline-offset: -2px` (не border — layout не прыгает).
- **Row-risky / row-done / row-dirty:** фон уходит, остаются: risky → stripe-left 3 px `--state-error`; done → text `--text-3` + line-through на названии; dirty → точка 4 px `--state-warning` в первой колонке.

**Inline-edit cell:** клик → outline 2 px `--ray-planning` + cursor text без layout-shift'а. Pending save → точка `--state-warning` в углу, на blur → `--state-ok` fade-out 600 ms. Validation error → outline `--state-error` + tooltip-strip 11 px снизу.

**Bulk-action bar (>1 строки выбрано):** sticky bottom-of-viewport (не в toolbar), 56 px, фон `--text-1`, текст `--surface-0`. **Нейтральная**, без indigo (bulk-bar кросс-секционный, есть и в Канбане, и в Сотрудниках). Слева: `{N} выбрано · ×`. Справа: action-кнопки.

**Числа:** числовые колонки — JetBrains Mono 12 px `tnum, zero`, right-aligned; текстовые — Inter 13 px `--text-1` left-aligned. Это **функциональная**, не декоративная, разница шрифтов.

### 3.3. Фильтры

`#btn-toggle-filters` остаётся в шапке (Мария §2.5), drawer открывается оттуда. На уровне Реестра — два новых компонента в toolbar:

**Filter chips (active filters):** h 28 px, padding `4px 8px 4px 10px`, radius 3, фон `--bg-secondary`, 1 px `--hairline`. Структура: `КЛЮЧ` (Plus Jakarta 600 10 px CAPS `--text-3`) `:` `value` (Inter 12 px `--text-1`) `×`. Gap 6 px, max-width 240. При ≥2 фильтрах — ghost-кнопка «Сбросить все» в конце. **Нейтральные**, без indigo: активный фильтр = состояние данных, не «грань Планирования».

**Filter dropdown (popover):** 1 px `--hairline`, `box-shadow 0 4px 12px rgba(0,0,0,.08)` (одно из немногих мест, где тень допустима — popover должен «оторваться»), radius 4, фон `--surface-0`. Header: Plus Jakarta 600 12 px CAPS `--text-2`. Body: search-input + чекбоксы; selected option `--text-1` + checkbox-fill `var(--ray-planning)` (единственное место indigo в фильтре). Footer: «Применить» primary + «Отмена» ghost.

### 3.4. Empty-state / no-results

Реестр пуст — три случая, у каждого свой текст.

- **Реестр пустой (нет данных вообще):** centred block, без иконок. Eyebrow «РЕЕСТР ПУСТ» CAPS 10 px `--text-3`. h3 Plus Jakarta 600 18 px «Загрузите план квартала». Sub Inter 14 px `--text-2`: «Файл XLSX/CSV или подключите Jira-интеграцию». Две кнопки: primary «Импорт XLSX» (нейтральная), secondary «Подключить Jira» (ghost).
- **No-results после фильтра:** одна редакционная фраза вместо иконок. **EB Garamond 400 italic 18 px**, color `--text-2`, max-width 40ch, центр: «Среди 247 задач — ни одной по этим условиям». Под фразой — ghost-кнопка «Сбросить фильтры» Inter 12 px `--ray-planning` (один из редких случаев, где indigo появляется как inline link). Это и есть «один редакционный жест на экран», который Анна разрешила.
- **Search-no-results (поиск в фильтре):** мини-вариант той же фразы, в popover-теле, EB Garamond 14 px italic.

---

## 4. Отчёт CEO — луч КОММУНИКАЦИИ (Spruce `#1F5946` light / `#6FB59A` dark)

Это **редакционный экран** (Анна §5.3). Здесь Editorial-серф проявляется сильнее всего: длинный AI-сгенерированный текст для CTO, который тимлид копирует в slack-thread или PDF для совета. Текущий `aiCeoView.js` рендерит через `renderCeoPage` (см. `ai/aiCeoRenderer.js:437`) семь блоков (hero, ifNothingChanges, hardTruths, saveTheRelease, actionFeed, …) как плотный dashboard. Я **разворачиваю** их в editorial-журнальный лонгрид.

### 4.1. Layout

Single-column 64ch (~720 px при body 16 px), centered, max-width parent 960 px (с учётом TOC). Viewport ≥ 1440 — right-side TOC sidebar 200 px sticky gap 64 px; < 1280 — TOC сворачивается в top-collapsible. Page-header по центру колонки, hairline под ним full-width до 64ch. Padding-top 48 px (больше воздуха, чем на Дашборде), padding-bottom 96 px перед footer-actions.

### 4.2. Типографика отчёта

**H1:** EB Garamond 400, 40 px, `--text-1`, line-height 1.15, ls -0.01em. Один из трёх мест serif в продукте (splash, onboarding, CEO). Под H1 — eyebrow «ОТЧЁТ ОТ {date}» CAPS 10 px `--text-3`. H1 и eyebrow меняются местами относительно общего page-template (editorial-обложка: заголовок первым, дата подзаголовком).

**H2 секций** (Здоровье квартала, Если не менять, Жёсткие истины, Действия): Plus Jakarta 700 22 px `--text-1`. Над H2 — eyebrow CAPS 10 px `--ray-comms`. Margin-top 48, margin-bottom 16. Внутри лонгрида хейрлайнов нет.

**Body:** Inter 400 16 px, line-height 1.65, `--text-1`, max-width 64ch. `p + p { margin-top: 16px }`. Только left-align.

**Числа:** inline `font-feature-settings: 'tnum'` через body-style. Крупные акценты («риск 73 → 41») — JetBrains Mono 15 px + backplate `--bg-secondary`, padding `1px 6px`, radius 3.

**Pull-quote:** EB Garamond italic 24 px `--text-1`, line-height 1.4, max-width 56ch. `border-left: 3px solid var(--ray-comms)` + padding-left 24, margin 32 ↕. **Главный момент луча** на странице — Spruce как «голос отчёта».

**Списки причин (`ceo-cause-text`):** Inter 14 px, gap 8 px, маркер — squircle-точка 4 px `--state-{severity}` вместо `✅` (Анна §6).

**Action Feed:** flat-list 5–8 пунктов с inline-номерами `01 02 03` Plus Jakarta 700 14 px `--text-3` (журнальный приём). Title Plus Jakarta 600 16, body Inter 14 `--text-2`. Severity-точка слева от номера. Без карточек/теней.

### 4.3. Действия (export, copy, send)

Action-bar **снизу страницы** (не в toolbar), внутри 64ch колонки, после последней секции. Над bar'ом хейрлайн 1 px `--hairline`, margin-top 48 px. Три кнопки в ряд: **«Скачать PDF»** primary (`background var(--text-1)`, нейтрально), **«Копировать в Slack»** secondary (border `--text-1`), **«Отправить email»** ghost (текст `--ray-comms`). Слева — Inter 12 px `--text-2` «Экспорт отчёта от {date}, {time}» (честный timestamp на момент действия). Под bar — ссылка «Посмотреть исходные данные» Inter 11 px `--text-3`, открывает дровер с raw-JSON для аудита.

### 4.4. «Сгенерировано AI» — индикатор

Дискретно, но честно. Не watermark, не модальное предупреждение. Решение: **eyebrow page-header расширяется**: `ЛУЧ КОММУНИКАЦИИ · AI-DRAFT · СГЕНЕРИРОВАНО 30 СЕК НАЗАД · GIGACHAT-2`. Plus Jakarta 600 10 px CAPS, color `--ray-comms`. Тайм-метка обновляется live (`setInterval` 30 s).

Под action-bar — sub-строка EB Garamond 13 px italic `--text-2`: «Этот отчёт собран AI-моделью на основе данных Реестра и Метрик. Цифры точны, формулировки — рекомендация, а не приказ». Tone-of-voice — серьёзно, без пугалок.

### 4.5. Sidebar TOC

Right-sidebar 200 px (только viewport ≥ 1440). Eyebrow «В ОТЧЁТЕ» CAPS 10 px `--text-3`, список секций Inter 13 px `--text-2`, gap 10 px. **Active** (через IntersectionObserver на H2): `--text-1` + 3 px stripe-left `--ray-comms`. Под TOC — мини-блок «Актуальность данных» Inter 11 px `--text-3`.

---

## 5. Гант — короткий гайдлайн (волна 2)

5 пунктов, canvas трогаем после валидации волны 1.

1. **Page-header и toolbar** — общий шаблон §1, eyebrow «ЛУЧ ПЛАНИРОВАНИЯ», tab-switcher Планирования в toolbar.
2. **Canvas нейтральный.** Pills, стрелки, фон release-полей — `--text-1`, `--text-2`, `--bg-secondary`. Indigo появляется только в трёх местах: today-line 1 px `--ray-planning`, selected-pill outline 2 px, drag-drop dashed border 1.5 px (фон цели — `--bg-secondary`, не wash).
3. **Header дат** — eyebrow `1.21 · 20 АПРЕЛЯ – 17 МАЯ` `--text-3`, без indigo.
4. **Зависимости-стрелки** — текущий нейтральный 1.5 px стиль остаётся, hover до `--text-1`. Indigo не подходит — сольётся с текстом.
5. **Phase-colors** (BE/FE/QA/AN из `PHASE_COLORS`) — отдельная data-vis палитра, перевести на Okabe-Ito в волне 2, **не пересекать с лучами**.

---

## 6. Остальные экраны — гайдлайны

По строчке на каждый. Все по page-template §1.

- **Канбан / Подложка / Таймлайн** (Планирование) — tab-switcher в toolbar, нейтральные body. Indigo — только active-card outline / today-line. Подложка — без hero-цифры (плотный текст-список).
- **Сводка / Метрики / Инсайты** (Контроль) — pattern Дашборда. Hero-цифра Amber. Графики на data-vis палитре (Okabe-Ito), не Amber. Снести `gradient`-катастрофу `.summary-super-hero` и `.metrics-hero` `border-left: 4px #818cf8`.
- **Сотрудники** (Контроль) — pattern Реестра §3, selected-row stripe → Amber. Inline overload-warning через chip §2.4.
- **AI Анализ** (Предсказание, Deep Iris) — гибрид Дашборда и CEO-отчёта: hero-цифра forecast Iris 48 px + редакционные секции с pull-quote.
- **Action Layer** (Коммуникация, Spruce) — list нарративов по pattern Action Feed §4.2.
- **Интеграции / Диагностика** (Связи, Brass) — settings + table. Hero-цифра Brass. Карточки интеграций — stripe-left семантический (ok/error), не Brass.
- **Ошибки** (Связи) — log-style. Hero-цифра «Ошибок за 24ч» **семантическая** (`--state-error` если > 0), **не Brass** — semantic перебивает ray.
- **История** (Ретроспектива, Slate) — snapshot-list. Hero-цифра «{N} снимков» Slate. List-cards с timestamp.

---

## 7. Компонент-библиотека — что трогаем

| Компонент | Изменение |
|---|---|
| **Button primary** | radius 8 → 3, фон `var(--accent)` → `var(--text-1)`, текст `--surface-0`, Plus Jakarta 600 13 px, без shadow. |
| **Button secondary** | transparent + 1 px border `--text-1`, hover фон `--bg-secondary`. |
| **Button ghost** | Только текст `--text-2`, hover `--text-1`, без border. |
| **Input / Select** | radius 3, 1 px `--hairline`, focus 2 px outline `--ray-current` (единственное проявление луча в формах). Inter 13 px, h 36. |
| **Modal** | radius 4, 1 px `--hairline`, shadow `0 8px 32px rgba(0,0,0,.12)`. Header eyebrow + h2 18 px. Не несёт цвет луча. |
| **Drawer** | Справа 380 px, та же edge как modal. Eyebrow `ФИЛЬТРЫ` нейтрально. |
| **Toast** | Bottom-right 320 px, stripe-left 3 px `--state-{level}`, фон `--surface-0`. Auto-dismiss 5 s. Без лучей. |
| **Chip status** | Hairline-border + transparent fill, JetBrains Mono 10 px CAPS `--state-{level}`. |
| **Chip ray** | Только в nav и notification-badge: точка 6 px `--ray-{x}`, без фонового пилла. |
| **Tooltip** | Фон `--text-1`, текст `--surface-0`, Inter 12 px, radius 3, без стрелки. |
| **Tabs** | Underline-active 2 px цвета луча группы, Plus Jakarta 600 13 px. |
| **Empty / Skeleton / Error** | §1.4 — три варианта одной структуры (eyebrow + h3 + sub + action). |

---

## 8. Anti-pattern guard — где соблазн нарушить правило

5 пунктов, в которых я уже вижу «фронтенд начнёт творить, и потом не вернёшь».

1. **На Дашборде не делать все 12 KPI цвета лучей.** Соблазн: «у нас Amber на странице, давайте все 12 карточек с amber-stripe». Это нарушит §2.5 «amber ровно в 3 местах». Stripe карточек — **только семантика** (ok/warning/error), цвет луча — только в hero-цифре и eyebrow page-header.
2. **В Реестре не красить selected-row фоном indigo-ink (как сейчас `.selected-row` фон).** Stripe-left 3 px — да, фон — нейтральный `--bg-secondary`. Иначе при 5 selected строках экран превращается в синюю простыню и теряет плотность данных.
3. **В Отчёте CEO не делать pull-quote'ы во ВСЕХ секциях.** Pull-quote с Spruce-stripe — это **акцент**, а не дефолтный стиль абзаца. Один-два pull-quote на отчёт. Если каждый параграф станет pull-quote'ом — потеряет вес. Анна §3 «контент главнее лучей».
4. **Не использовать цвет луча в семантических состояниях.** «Сохранить» в Дашборде — нейтрально-чёрная, **не** Amber. Toast «Импорт прошёл» — `--state-ok`, **не** цвет текущего луча. Filter-chip active — нейтральный, **не** цвет луча. Это самая частая ошибка multi-color design-system'ов и она нас ждёт на code-review.
5. **Не вводить цветные фоновые wash'и под секциями страницы** (даже «лёгкие 4% alpha»). Соблазн «давай тонируем секцию hero чуть-чуть в amber» возникнет на первом же UX-review. Анна §6 запрет прямой и абсолютный. Wash'и убивают читаемость данных и конкурируют с stripe-left, который и есть наш доминирующий приём.

---

## 9. Чек-лист имплементации

**`views/dashboard.js`**
- `render()` (стр. 24) — добавить `renderPageHeader()` в начало (eyebrow + h1 + hairline).
- `renderKPIs()` (стр. 57) — разделить: hero-блок с 1 цифрой Amber + 3 supporting; body-сетка карточек с семантическими stripe-left. Классы `kpi-green/red/yellow/blue/teal/purple` → `kpi-state-ok/-warning/-error/-info`.
- `renderRisksPanel()` — chips на hairline-style §2.4, эмодзи убрать.
- `renderProgress / renderBlockingCard / renderReleaseBreakdown / renderTeamsSummary / renderNoReleaseTable / renderNeedsConfirmTable` — на новый стиль `.card` §2.2.
- Empty-state (30–44) — без `📊`, по pattern §1.4.

**`views/registry.js`**
- `render()` (стр. 19) — добавить `renderPageHeader()` + tab-switcher Планирования. `#registry-empty` → три варианта §3.4.
- `renderHeader()` (стр. 90) — th: CAPS 11 px `--text-2`, sort-icons 10 px справа, drag-over → indigo dashed.
- `renderBody()` + `updateRowVisual` (стр. 67) — снести фоновую заливку `.row-colored`/`row-risky`; risky → stripe-left семантика.
- Selected-row — `box-shadow: inset 3px 0 0 var(--ray-planning)`.
- Filter chips — новый компонент в `#registry-toolbar` из `state.activeFilters`.
- No-results — EB Garamond italic + ghost-link «Сбросить».

**`views/aiCeoView.js` + `ai/aiCeoRenderer.js`**
- `renderCeoPage()` (renderer:437) — single-column 64ch, page-header с extended eyebrow `· AI-DRAFT · {age} · {model}`.
- `renderCeoHero()` (renderer:47) — `.ceo-hero-score-ring` снести, цифра 56 px без ring; modifiers → `--state-*`.
- `renderHardTruths / renderIfNothingChanges / renderActionFeed` — eyebrow `--ray-comms` + Plus Jakarta 22 px h2 + Inter 16 px body. Squircle-точки вместо эмодзи.
- Новый `renderCeoPullQuote()` — 1–2 на отчёт, EB Garamond italic 24 px + Spruce-stripe.
- Action-bar — bottom-of-page; снести override `#section-ai-ceo .section-header-actions` (styles:426).
- `renderCeoTOC()` — новый, IntersectionObserver на H2.

**`styles.css` — зоны**
- `:root` (1–60) — токены `--ray-*` (light/dark пары), `--accent` алиас `--ray-planning`, отдельно `--state-ok/-warning/-error/-info`.
- Page-template — добавить `.page-header / -eyebrow / -h1 / -sub / -hairline / .page-toolbar` после `.section-header` (стр. 395). Старый `.section-header` депрекейтить.
- `.kpi-card` (443–486) — снести box-shadow, `--kpi-color` → `--state-*`, цифра 24 px. Hero — отдельный `.kpi-hero` 48 px цвета луча.
- Registry table (567–700) — убрать зебру, hover → `--bg-secondary`, selected → inset stripe, header CAPS, drag-over → ray.
- CEO hero (7477–7600) — снести score-ring, modifiers → семантика, layout vertical.
- CEO body (новый) — `.ceo-page-narrow` 64ch, `.ceo-pull-quote`, `.ceo-section-h2`, `.ceo-toc`.
- Summary/Metrics hero (2676–2930) — снести `gradient` и `border-left: 4px #818cf8`, на page-template.
- Новые: `.filter-chip` (рядом с `ts2-filter-pill`), Buttons primary/secondary/ghost (border-radius 8 → 3), `.risk-badge-*` на hairline-border.

---

**Игорь Тен**
*UI-дизайнер, бренд «Призма»*

> «Адаптация — это не ребрендинг. Это правка на двух уровнях: токены (что переименовать в один проход) и три экрана (где новый язык должен сработать целиком). Если волна 1 проходит по §7 Анны (5-секундный тест ориентации) — мы катим остальное. Если нет — возвращаемся на чертёжную, не выкатывая полу-Призмы на остальные 14 разделов.»
