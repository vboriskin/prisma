# 02 — VISUAL / TYPOGRAPHY AUDIT · Гант

> **Роль:** Visual / Typography Lead.
> **Скоуп:** вкладка `Курс / Гант` (`section-gantt`), включая doc-export `ganttHtmlExport.js`.
> **Метод:** read-only аудит фактического CSS (`styles.css`) и рендера (`views/gantt.js`, `views/ganttHtmlExport.js`, `app.js` — secретный кусок lock-status), сопоставление с брендбуком (`my_prisma-brand/BRAND_BOOK.md` §3, §4, §6) и с уже принятым стандартом дашборда (`audit-2026-05-04/dashboard-redesign/02-VISUAL.md`).
> **Дата:** 2026-05-04. Wave 1 в П11.3 (07-tech-views.md) уже почистил toolbar (33 → 15 кнопок, emoji glyph → SVG, inline-styles → CSS-классы). НЕ затронуто этим аудитом.

---

## TL;DR

Гант — это **трёхслойная сцена с 8 числовыми голосами и ≥26 hex-литералами** в трёх местах:

1. **5 цветов колодцев** (`#6b7280 / #4f46e5 / #059669 / #d97706 / #dc2626`) дублируются в **5 источниках**: `.gantt-bar-*` (`:2474-78`), `.gantt-type-pill[data-wt=*]` (`:5869-77`), `.v16-spark-bar-*` (`:6048-52`), `.v16-team-bucket-active` (`:6096-6100`), `gantt.js:1389` (legend inline), `ganttHtmlExport.js:411-414` (export legend inline).
2. **Plan-lock readonly-badge** (`.gantt-lock-badge` `:2274-82` + `ganttHtmlExport.js:710-719,984`) — `#fef3c7 / #78350f / #f59e0b` хардкодом. Dark-тема на `:2283-84` уже использует `var(--prizma-drift-*)`, light-тема — нет. Это **П11.23**.
3. **Comment-marker** `.gdt-pill-cmt-transfer/-add` `#f59e0b / #3b82f6` (`:2443-44, :2658-59`).

**Типография** — 10 уникальных font-size (16, 14, 13, 12.5, 12, 11, 10.5, 10, 9.5, 9) и 5 весов (400/500/600/**700**/**800**). Брендбук §4 знает 6 размеров (72/32/18/15/13/11) и 4 веса (200/300/400/500). Главное расхождение — **`.gdt-rail-label` 16/800 mono** (`:1812-18`): 800 в брендбуке нет вообще, 16 — между Body 15 и Subtitle 18.

Дашборд (`02-VISUAL.md` §3) уже зафиксировал трио **48/32/20**. На ганте Hero отсутствует — Primary роль занимает **24/300 mono** (брендбук MonoNumber).

**Главный вывод:** `.gdt-rail-label` 16/800 → **24/300 mono**; 5 цветов колодцев → 5 переменных `--gdt-bucket-*` (4 нейтральных + 1 signal OT); lock-badge → `var(--prizma-drift-*)`; убрать эмодзи `🔒/✏/▸/▾/✓`.

---

## Section 1. Текущая type-scale (фактическая)

> Источник: `styles.css` (строки указаны), `views/gantt.js` (рендер), `views/ganttHtmlExport.js` (экспорт), `app.js` (lock-status badge).

| # | Селектор | font-size | weight | letter-spacing | font-family | color-token | Назначение | Источник |
|---|---|---|---|---|---|---|---|---|
| 1 | `.gantt-header-label` | 11px | 700 | 0.4px CAPS | SF Pro / system | `var(--text-3)` | Левая шапка «Эпик / Категория» | `:1795-98` |
| 2 | `.gantt-header-col` (контейнер) | inherit | inherit | — | inherit | `var(--text-1)` | Колонка-колодец (backlog/1.20/1.21/1.22/OT) | `:1799-1808` |
| 3 | `.gdt-rail-label` | **16px** | **800** | 0.3px | **ui-monospace** | `var(--text-1)` | «1.20 / 1.21 / 1.22 / OT» в шапке колодца | `:1812-18` |
| 4 | `.gdt-rail-label-backlog` | 13px | 700 | 0.15px | Inter | `var(--text-1)` | Слово «Бэклог» | `:1821-25` |
| 5 | `.gdt-rail-meta` | 10px | 500 | 0.2px | ui-monospace | `var(--text-3)` | Даты-диапазон под label «01.05–31.07» | `:1826-37` |
| 6 | `.gdt-rail-today` | **9.5px** | 700 | 0.3px **lowercase** | inherit | `var(--prizma-information, #4f46e5)` ← **fallback hex** | Pill «сегодня DD.MM» | `:1840-51` |
| 7 | `.gdt-rail-flow` (in/out) | 9.5px | 700 | 0.2px | ui-monospace | `#1d4ed8` / `#b45309` ← **hardcoded** | «+N / −N» переносы в/из | `:1889-1911` |
| 8 | `.gantt-team-header-cell` | 13px | 700 | — | system | `var(--text-2)` | Команды — заголовок-полоса (V14 fallback) | `:2109-13` (потом перебито :5698) |
| 9 | `.gantt-team-header-cell .team-count` | 10px | 500 | — | system | `var(--text-3)` | Счётчик «N задач» | `:2114` |
| 10 | `.v16-team-name` | 14px | 600 | 0.1px | system | `var(--text-1)` | Имя команды в team-row | `:5991-99` |
| 11 | `.v16-team-total` | 11px | 500 | 0 | system | `var(--text-3)` | «N задач» рядом с именем | `:6004-09` |
| 12 | `.v16-team-bucket-label` | 10px | 600 | 0.4px CAPS | system | `var(--text-3)` | Лейбл колодца внутри team-bucket | `:6074-80` |
| 13 | `.v16-team-bucket-count` | **13px** | **700** | 0 (mono) | ui-monospace inherit | `var(--text-1)` (active — **5 hex** :6096-6100) | Счётчик «N» в team-bucket | `:6081-86` |
| 14 | `.gantt-row-label` | 12px | 400 | — | system | `var(--text-2)` | Эпик/категория слева | `:2115-19` |
| 15 | `.gantt-row-label-name` | inherit (12) | 600 | — | system | inherit | Имя эпика | `:2121-24` |
| 16 | `.gantt-row-label-sub` | 11px | 400 | — | system | `var(--text-4)` | Подпись под эпиком | `:2125` |
| 17 | `.v16-epic-name` | 12.5px | 600 | 0.05px | system | `var(--text-1)` | Имя эпика V16 | `:2143-47` |
| 18 | `.v16-epic-sub` | 10.5px | 400 | — | system | `var(--text-3)` | Подпись эпика V16 | `:2148-54` |
| 19 | `.v16-epic-meta` | 10px | 500 | 0 mono | ui-monospace | `var(--text-3)` | «N задач · M переносов» | `:2155-61` |
| 20 | `.v16-epic-cat` | 10.5px | 500 | 0 | Inter | `var(--text-2)` | Категория-инлайн | `:2163-70` |
| 21 | `.gantt-type-pill` | 11px | 600 | — | system | `var(--text-1)` (`.theme-dark` `#e5e7eb`) | Сама пилюля задачи | `:2336-56` |
| 22 | `.gdt-pill-row-1` | 11px | 600 | — | system | `var(--text-1)` | Строка-1 (имя + status + cmt) | `:2385-89` |
| 23 | `.gdt-pill-row-2` | **9.5px** | 500 | — | system | `var(--text-3)` | Строка-2 (assignee · period) | `:2455-62` |
| 24 | `.gdt-pill-meta` | inherit (9.5) | 500 | 0 (`tabular-nums`) | system | inherit | Текст-meta внутри row-2 | `:2463-67` |
| 25 | `.gdt-pill-initials` | 9px | 700 | 0.3px | ui-monospace | `var(--text-3)` | Инициалы (compact density) | `:1939-47` |
| 26 | `body[data-gdt-density="compact"] .gantt-type-pill` | 10.5px | 600 | — | system | inherit | compact-вариант пилюли | `:1926-29` |
| 27 | `.gantt-lock-badge` | 12px | 600 | — | system | `#78350f / #fef3c7 / #f59e0b` ← **3 hex** | «🔒 План зафиксирован» (light) | `:2274-82` |
| 28 | `.gantt-lock-badge-edit` | 12px | 600 | — | system | `#dbeafe / #1e3a8a / #3b82f6` ← **3 hex** | «✏ Режим редактирования» (light) | `:2282` |
| 29 | `.gantt-bucket-radio` | 12px | 400 (600 if checked) | — | system | `var(--bg-1, #fff)` ← **fallback hex** | Radio в add-target modal | `:2296-2308` |
| 30 | `.gantt-legend` | 11px | 400 | — | system | `var(--text-3)` | Полоска-легенда снизу | `:2552` |
| 31 | `.gantt-legend-item` | inherit (11) | 400 | — | system | inherit | Item легенды + dot 12×12 | `:2553-54` |
| 32 | `.gdt-pill-legend-toggle` | inherit | inherit | — | system | inherit (fallback `#eef2ff / #4f46e5`) | Toggle «Подсказки» | `:2562-75` |
| 33 | `.gdt-pill-legend-demo-row1` | 11px | 600 | — | system | inherit | Демо-pill в легенде | `:2622` |
| 34 | `.gdt-pill-legend-demo-row2` | 9.5px | 500 | 0 mono | system | `var(--text-3, #6b7280)` ← **fallback hex** | Demo-meta | `:2623` |
| 35 | `.gdt-overview-count` | inherit | inherit | — | inherit | inherit | Счётчик в overview-mode | `:5828` |
| 36 | `.gex-readonly-badge` (export) | **11px** | 600 | 0.3px | inherit | `#78350f / #fef3c7 / #f59e0b` ← **3 hex** | Badge «План зафиксирован» в HTML-экспорте | `ganttHtmlExport.js:710-719` |
| 37 | `.gex-page-title` (export) | 18px | 700 | — | inherit | inherit | Заголовок экспортной страницы | `ganttHtmlExport.js:705` |
| 38 | `.gex-page-meta` (export) | 12px | 400 | — | inherit | `#6b7280` ← **hex** | Meta-строка экспорта | `ganttHtmlExport.js:706` |
| 39 | `.gex-bucket-{120,121,122,OT}` (export) | inherit | inherit | — | inherit | **8 hex** для bg+text | Бейджи колодцев в экспорт-таблице | `ganttHtmlExport.js:931-938` |
| 40 | `.gex-status-{done,active,unplanned}` (export) | inherit | inherit | — | inherit | `#059669 / #2563eb / #b45309` ← **6 hex** | Статусы в экспорте | `ganttHtmlExport.js:940-945` |

> **Наблюдение 1 (типография).** На одном экране **минимум 8 разных размеров** (16, 14, 13, 12.5, 12, 11, 10.5, 10, 9.5, 9 — всего **10 уникальных значений**) и **5 разных весов** (400, 500, 600, 700, **800**). Брендбук §4 даёт **6 размеров** (72/32/18/15/13/11) и **4 веса** (200/300/400/500). Единственный пункт где weight 600 в брендбуке — это § Caption (11/500/1.5 CAPS) — а тут 600 на pill (11), 600 на v16-team-name (14), 600 на v16-epic-name (12.5), 600 на kpi-label-edit, 700 на rail-label (16), 700 на rail-flow (9.5), 700 на v16-team-bucket-count (13), **800 на rail-label**. Дрейф системности.
>
> **Наблюдение 2 (палитра).** Минимум **26 hex-литералов** только для ганта в общей сложности (без учёта дублирующих светло-тёмных пар), причём 5 цветов колодцев (`#6b7280 / #4f46e5 / #059669 / #d97706 / #dc2626`) повторяются в **5 местах** (`.v16-spark-bar-*` → `.v16-team-bucket-active` → `.gantt-bar-*` → `.gantt-type-pill[data-wt]` → `gantt.js:1389` → `ganttHtmlExport.js:411`). При смене темы (или ребрендинге) поправить нужно **6 файлов**.

---

## Section 2. Проблемы (6 штук)

### П2.1 — `.gdt-rail-label` 16px / weight **800** ломает брендбук

**Что нарушено.** `styles.css:1812-18` — заголовок колодца «1.20 / 1.21 / 1.22 / OT» рендерится **16px / 800 / mono**. Брендбук §4 (`BRAND_BOOK.md:139-148`) знает только веса **200 / 300 / 400 / 500**. Размер 16 — между Body 15 и Subtitle 18; ни тот, ни тот. Mono-семейство для **числа релиза** уместно — это «технический tag», не текст; но 800 это уже не Призма (§7 Tone of voice — «спокойный, не тревожный»).

Дашбордовый стандарт — Hero 48/300, Primary 32/400, Secondary 20/400. Заголовок колодца на ганте семантически = «Primary stat номер релиза» — должен сидеть на **24/400 mono** (брендбук MonoNumber 24/300, лёгкий апгрейд до 400 для читаемости в шапке-grid; либо строго 24/300 как в брендбуке).

**Эффект.** Анна (PO, 6/10), просматривая Гант на retina, видит 5 «жирных мономерных кирпичей» в одну строку — оптически читается как **5 банковских табло**, не как навигация по релизам. Доминирование переезжает с пилюль (где живёт смысл) на шапку (где только метка).

**Конкретное место.** `:1812-18` (`.gdt-rail-label`). Надо: **24px / 300 / -0.5px / JetBrains Mono / `var(--prizma-text-primary)`**, как Primary-уровень дашборда. Бэклог `.gdt-rail-label-backlog` — Subtitle 18/500 SF Pro Display (`:1821-25`).

---

### П2.2 — Hex hardcode в `.gantt-lock-badge` (`:2274-82`) и `ganttHtmlExport.js:710-719,984`

**Что нарушено.** Ограничение задачи: «Только токены `var(--prizma-*)`. Никаких хардкоженных hex». В:
- `styles.css:2277` `.gantt-lock-badge { background: #fef3c7; color: #78350f; }` + `border: 1px solid #f59e0b;` — это amber/warning набор, не ссылается на `var(--prizma-drift)`.
- `:2282` `.gantt-lock-badge-edit { background: #dbeafe; color: #1e3a8a; border-color: #3b82f6; }` — синий набор, не `var(--prizma-information)`.
- `:2283-84` тёмная тема **корректно** использует `var(--prizma-drift-bg / drift)` и `var(--prizma-information-bg / information)` — то есть автор знал, что нужно. Но light-тему оставил на хардкоде. Это П11.23 (которую прицельно просили закрыть).
- `ganttHtmlExport.js:710-719` дублирует `#fef3c7 / #78350f / #f59e0b` плюс dark-вариант `#422006 / #fde68a / #92400e` (тоже **не** `var(--prizma-drift-*)` в expirt-baseline-CSS, который встроен в инлайн-`<style>`).
- `ganttHtmlExport.js:984` — **inline-стиль на самом badge-элементе** (`<span class="gex-readonly-badge" style="background:#fef3c7;color:#78350f;border-color:#f59e0b;">`). Этот inline-style **третий слой** дублирования и не победится при смене темы.

**Эффект.** При переключении на тёмную тему в в браузере badge остаётся пастельно-жёлтым (баг светимости — в dark-теме мы хотим `var(--prizma-drift-bg)` 12%-альфа на фоне `var(--prizma-bg-elevated)`). При переключении бренда (или внесении нового signal-цвета по §3.3) — 3 места под правку; легко пропустить inline-style.

Семантически badge «План зафиксирован» — это **drift-уровень** (по брендбуку §3 строка 110 «Дрейф = #FFB347 / #B5670A»): план зафиксирован → переносы требуют комментария → дрейф против исходного плана. Это **точный signal**, а не декоративный amber. Но он скрыт за хардкодом и не унаследует никакие будущие изменения токена.

**Конкретное место.** `styles.css:2274-82`, `ganttHtmlExport.js:710-719,984`. Нужно: `background: var(--prizma-drift-bg); color: var(--prizma-drift); border: 1px solid var(--prizma-drift);` (одна декларация без `body.theme-dark` override — токен сам переключится). В export — то же, но через CSS-переменную, защищаемую `_BASELINE_CSS` (которая раньше идёт в `<style>` чем встроенная `styles.css`).

---

### П2.3 — Signal-цвет колодцев как **декорация** в 5 местах

**Что нарушено.** Брендбук §3.3 (signal vs decoration), §3 строка 105: «Signal — семантические цвета. Используются **только для статуса курса**, никогда как декорация».

Цвета колодцев `#4f46e5 / #059669 / #d97706 / #dc2626` сейчас живут как **раскраска идентификатора релиза**:
- `.gantt-bar-r120 / -r121 / -r122 / -overtime` (`:2475-78`) — фон полоски-бара
- `.gantt-type-pill[data-wt=*]` `:5869-77` — stripe пилюли (по типу работ — **другая семантика**, но цвета пересекаются: `#4f46e5` это и backend, и r120; `#059669` это и frontend, и r121)
- `.v16-spark-bar-{r120,r121,r122,overtime}` `:6048-52` — sparkline в team-row
- `.v16-team-bucket-active[data-bucket=...]` `:6096-6100` — числовой счётчик-цифра окрашена в цвет колодца
- `gantt.js:1389` legend dots — **inline-стиль** `style="background:${c}"`
- `ganttHtmlExport.js:411-414` export legend — **inline-стиль** `style="background:#4f46e5"`

`#dc2626` (Овертайм) на самом деле семантически **off-course** (овертайм = сбился с курса). Но используется он во всех 5 местах одинаково с другими (нейтральными) колодцами; глаз не различает «информационный синий 1.20» и «опасный красный OT» по силе подачи. Это **антипаттерн** §3.3.

**Эффект.** Светлана (7/10) и Дмитрий (5/10) описывали (`12-user-feedback.md`) что не различают, **где статус-сигнал**, а где просто «цвет колодца». Брендбук-палитра (`--prizma-information / on-course / drift / off-course`) применима только к OT (off-course), остальные — нейтральные «buckets identifiers». Должно быть: **все 4 release-цвета — нейтральные** (один единственный нейтральный синий-серый или 4 hue-сдвига одной нейтральной палитры), **OT — единственный с signal-окраской** (`var(--prizma-off-course)`).

**Конкретное место.** Одна из самых сложных правок. Минимум — ввести 5 переменных `--gdt-bucket-{backlog,r120,r121,r122,ot}` в `:root` и `body.theme-dark`, и заменить 5 источников хардкода на эти переменные. Долгосрочно — переосмыслить, что 1.20/1.21/1.22 это **нейтральные кварталы**, не signal.

---

### П2.4 — Эмодзи `🔒`, `✏`, `▸`, `▾` в production UI

**Что нарушено.** `CLAUDE.md` (project-level), §V15 «Принципы дизайна»: «**Без эмодзи** в production UI». Брендбук §1 «спокойный, не тревожный».

- **`app.js:1197`** `status.innerHTML = ... <span class="gantt-lock-badge gantt-lock-badge-edit">**✏** Режим редактирования (без фиксации переносов)</span>` — эмодзи pencil в badge.
- **`app.js:1200-01`** — `🔒 План зафиксирован · ${ts}` и `✏ Режим редактирования` (как textContent кнопки).
- **`gantt.js:964`** — `<button class="gantt-team-vis-btn">${isHidden?'▸':'▾'}</button>` — стрелочки UTF (это glyph, а не emoji, но семантически тот же дешёвый эффект; должны быть SVG `chevron-right / chevron-down` через `data-icon`).
- **`styles.css:1019` `.gex-legend-summary::before { content: '▾'; }`** — то же.
- **`styles.css:2413` `.gdt-pill-state-active::before { content: '●'; }`** — bullet, **допустимо** (это 1px-glyph в роли «in-progress dot», ок).
- **`styles.css:2421` `.gdt-pill-state-done::before { content: '✓'; }`** — checkmark UTF; должен стать SVG `check-12` или brand-mini-glyph (брендбук §11 Loaders задаёт паттерн signal-dot).

**Эффект.** Анна, открывая зафиксированный план: `🔒 План зафиксирован · 2026-05-04 14:32`. Это **банковское оповещение**, не Призма. Олеся (8/10 за brand) полюбила Призму за breathe-mark и spokojстvo — а тут **📋 банк** в собственном UI. Wave 1 уже почистил toolbar — теперь надо добить badge и chevron.

**Конкретное место.** `app.js:1197,1200,1201`. `gantt.js:964`. `styles.css:1019, 2421`. Замена — `data-icon="lock"` / `data-icon="pencil"` (как в самой `index.html:990,999` уже используется на кнопках; нужно протянуть в badge). Для chevron — `data-icon="chevron-right"`. Для check — SVG-checkmark из брендбук-pack `assets/svg/`.

---

### П2.5 — Density-toggle обходит 4-grid (font-size 10.5, 9.5)

**Что нарушено.** Размеры **10.5px** (`.gdt-pill-row-2`, `.v16-epic-cat`, `.gdt-pill-legend-demo-row2`, `.gdt-jump-sub`, compact `.gantt-type-pill`) и **9.5px** (`.gdt-rail-today`, `.gdt-rail-flow`, `.gdt-pill-row-2`, `.gdt-jump-kind`) — не на 4-grid. Брендбук §4 знает 11/13/15/18/32; 9.5 / 10.5 — «подкручено вручную чтобы влезло». Также gap 3px (`.v16-team-spark` `:6015`), padding `1px 5px` (`.gdt-rail-flow-in` `:1901`), `5px 10px` (`.gantt-bucket-radio` `:2298`) — все не на 4-grid.

**Эффект.** Игорь (7/10, любит плотность) не страдает; Анна и Олеся — «технично, но шумно», без брендового спокойствия. На retina 0.5px-stepping даёт sub-pixel размытие.

**Конкретное место.** Compact-density: `--gdt-row-h: 32px` (не 30) + meta-row 11/500 (не 9.5/500), single-line.

---

### П2.6 — Mono-tabular непоследовательно

**Что нарушено.** CLAUDE.md V15: «Mono-tabular numerals на всех числовых данных».

**Mono ЕСТЬ корректно:** `.gdt-rail-label` `:1813`, `.gdt-rail-meta` `:1830`, `.gdt-pill-meta` `:2465` (`tabular-nums`), `.v16-team-bucket-count` `:6071`, `.v16-epic-meta` `:2156-60`.

**Mono НЕТ (должно быть):** `.v16-team-total` `:6004-09` («N задач» — 11/500 sans), `.gantt-team-header-cell .team-count` `:2114`, `.gantt-row-label-sub` `:2125`, `.gantt-no-assignee` `:5879`, `.gex-cell-team` (export `:918`).

**Mono ЕСТЬ зря:** `.gdt-jump-kind` `:2047` (тэг «TEAM/EPIC» — это слово, не число — mono здесь только для technical-feel, спорно).

**Эффект.** «1.20 — 23 задачи · 1.21 — 17 задач · 1.22 — 8 задач» — числа **23/17/8** в team-row не выровнены по разряду между строками (т.к. `.v16-team-total` не mono). Сила mono-tabular — выравнивание колонок цифр; смешанный режим её убивает.

**Конкретное место.** `font-family: ui-monospace,...` + `font-variant-numeric: tabular-nums lining-nums` на: `.v16-team-total`, `.team-count`, `.gantt-no-assignee`.

---

## Section 3. Предложение унифицированной шкалы

> Иерархия — **трио** наследуется от дашборда: **Hero (48) → Primary (32) → Secondary (20)**.
> На ганте Hero нет (это рабочий инструмент, не landing). Берём **Primary 24** (брендбук MonoNumber) и **Secondary 18 (Subtitle)** для шапки, **Body 13/15** для пилюль и эпиков, **Caption 11** для labels.

| # | Селектор | font-size | weight | letter-spacing | font-family | color-token | Назначение |
|---|---|---|---|---|---|---|---|
| 1 | `.gantt-header-label` | 11px | 500 | 1.5px CAPS | SF Pro Display | `--prizma-text-secondary` | Eyebrow «Эпик / Категория» (CAPS-eyebrow) |
| 2 | `.gdt-rail-label` | **24px** | **300** | -0.5px | JetBrains Mono | `--prizma-text-primary` | Primary KPI: «1.20 / 1.21 / 1.22 / OT» (брендбук MonoNumber) |
| 3 | `.gdt-rail-label-backlog` | **18px** | **500** | 0 | SF Pro Display | `--prizma-text-primary` | «Бэклог» — Subtitle, не tag |
| 4 | `.gdt-rail-meta` | 11px | 400 | 0 | JetBrains Mono | `--prizma-text-tertiary` | Даты-диапазон (BodySmall mono для tabular выравнивания) |
| 5 | `.gdt-rail-today` | 10px | 500 | 1.2px CAPS | JetBrains Mono | `--prizma-information` | «СЕГОДНЯ DD.MM» (CAPS, не lowercase) |
| 6 | `.gdt-rail-flow-{in,out}` | 11px | 500 | 0 mono | JetBrains Mono | **`--prizma-text-secondary` (нейтральный, signal — в фоне-token)** | «+N / −N» (фон 12%-альфа token) |
| 7 | `.gantt-team-header-cell` | 11px | 500 | 1.5px CAPS | SF Pro Display | `--prizma-text-secondary` | (legacy V14 fallback) eyebrow-команда |
| 8 | `.v16-team-name` | **15px** | 500 | 0 | SF Pro Display | `--prizma-text-primary` | Body Subtitle: имя команды |
| 9 | `.v16-team-total` | 11px | 400 | 0 mono | **JetBrains Mono** | `--prizma-text-tertiary` | «N задач» (mono для tabular) |
| 10 | `.v16-team-bucket-label` | 10px | 600 | 1.2px CAPS | SF Pro Display | `--prizma-text-tertiary` | label колодца внутри bucket |
| 11 | `.v16-team-bucket-count` | **15px** | 400 | -0.2px | JetBrains Mono | `--prizma-text-primary` (НЕ цвет колодца) | Secondary stat: счётчик-цифра. Signal только если overload (>cap) |
| 12 | `.gantt-row-label` | 13px | 400 | 0 | SF Pro Display | `--prizma-text-secondary` | Эпик/категория слева |
| 13 | `.v16-epic-name` | 13px | 500 | 0 | SF Pro Display | `--prizma-text-primary` | Body: имя эпика |
| 14 | `.v16-epic-sub` | 11px | 400 | 0 | SF Pro Display | `--prizma-text-tertiary` | Подпись эпика |
| 15 | `.v16-epic-meta` | 11px | 400 | 0 mono | JetBrains Mono | `--prizma-text-tertiary` | «N задач · M переносов» |
| 16 | `.v16-epic-cat` | 11px | 400 | 0 | SF Pro Display | `--prizma-text-secondary` | Категория-инлайн (без mono — это слово) |
| 17 | `.gantt-type-pill` | 11px | 500 | 0 | SF Pro Display | `--prizma-text-primary` | Pill (имя задачи) |
| 18 | `.gdt-pill-row-1` | 11px | 500 | 0 | SF Pro Display | `--prizma-text-primary` | Row-1 пилюли |
| 19 | `.gdt-pill-row-2` | **11px** (а не 9.5) | 400 | 0 mono | JetBrains Mono | `--prizma-text-tertiary` | Row-2 (assignee · period) — на 4-grid |
| 20 | `.gdt-pill-meta` | 11px | 400 | 0 (`tabular-nums`) | JetBrains Mono | `--prizma-text-tertiary` | Meta-период |
| 21 | `.gdt-pill-initials` | 11px | 500 | 0.5px | JetBrains Mono | `--prizma-text-tertiary` | Инициалы |
| 22 | `body[data-gdt-density="compact"] .gantt-type-pill` | 11px | 500 | 0 | SF Pro Display | `--prizma-text-primary` | compact pill (та же сетка, но row-2 hidden) |
| 23 | `.gantt-lock-badge` | 11px | 600 | 1.2px CAPS | SF Pro Display | `var(--prizma-drift)` (текст) на `var(--prizma-drift-bg)` фоне | Plan-locked badge (CAPS-pill, не sentence-case) |
| 24 | `.gantt-lock-badge-edit` | 11px | 600 | 1.2px CAPS | SF Pro Display | `var(--prizma-information)` на `var(--prizma-information-bg)` | Edit-mode badge |
| 25 | `.gantt-bucket-radio` | 13px | 400 (500 if checked) | 0 | SF Pro Display | `--prizma-text-primary` | Radio-bucket в add-target |
| 26 | `.gantt-legend` | 11px | 400 | 0 | SF Pro Display | `--prizma-text-tertiary` | Полоска-легенда снизу |
| 27 | `.gex-readonly-badge` (export) | 11px | 600 | 1.2px CAPS | SF Pro Display | `var(--prizma-drift)` на `var(--prizma-drift-bg)` | то же что `.gantt-lock-badge`, но в экспорте |
| 28 | `.gex-page-title` (export) | 18px | 500 | 0 | SF Pro Display | `--prizma-text-primary` | Subtitle: заголовок экспорта |
| 29 | `.gex-page-meta` (export) | 11px | 400 | 0 mono | JetBrains Mono | `--prizma-text-tertiary` | Meta-строка экспорта |
| 30 | `.gex-bucket-{120,121,122,OT}` (export) | 11px | 500 | 0 mono | JetBrains Mono | `--gdt-bucket-{...}` через **CSS-variable**, signal только OT | Бейджи колодцев |
| 31 | `.gex-status-{done,active,unplanned}` (export) | 11px | 500 | 1.2px CAPS | SF Pro Display | соответственно `var(--prizma-on-course / information / drift)` | Статусы (CAPS-pill) |

### Принципы новой шкалы

**Веса — ровно 4 уровня:**
- **800** — нигде. Брендбук такого веса не знает.
- **700** — нигде на ганте. Удалить из `.gdt-rail-label`, `.gdt-jump-prompt`, `.gdt-pill-initials`, `.gdt-rail-flow`, `.v16-team-bucket-count`, `.gantt-team-header-cell`, `.gantt-team-header-cell .team-count` (10/500). Дешёвый эффект.
- **600** — только для CAPS-eyebrow на 10-11px (компенсация скруглённости CAPS).
- **500** — Subtitle 18 (`.v16-team-name`, `.gdt-rail-label-backlog`, `.gex-page-title`), Body 13 (`.v16-epic-name`), `.gantt-type-pill`, `.gdt-pill-row-1`. CAPS-eyebrow 11/1.5.
- **400** — все числа (rail-meta, v16-team-bucket-count, v16-epic-meta, gdt-pill-meta), все Body-тексты, BodySmall.
- **300** — Primary KPI 24 (`.gdt-rail-label`).

**Letter-spacing — ровно 5 уровней:**
- **-0.5px** — Primary 24 (`.gdt-rail-label`).
- **-0.2px** — Secondary 15 mono (`.v16-team-bucket-count`).
- **0** — Body, BodySmall, Subtitle.
- **1.2px** CAPS — все вторичные labels (kpi-label, bucket-label, today-pill, status-pill).
- **1.5px** CAPS — eyebrow-уровень (gantt-header-label, lock-badge, page-eyebrow в экспорте).

**Mono-tabular строго для чисел.** Все числа — JetBrains Mono + `font-variant-numeric: tabular-nums lining-nums`. Слова (включая имя команды, эпика, категории) — SF Pro Display.

> **TODO для брендбука §4.** Уровень «Primary KPI 24/300 mono» уже зафиксирован в дашбордовом аудите как «Primary 32». На ганте Hero отсутствует (нет процентного главного-числа), поэтому Primary роль занимает **24/300 mono** (родная MonoNumber брендбука). Нужно явно описать в брендбук-таблице, что MonoNumber 24/300 это **Primary stat в рабочем инструменте** (не landing).

---

## Section 4. Палитра — правила signal

### 4.1. Где **ОБЯЗАТЕЛЬНО** signal-цвет

| Место | Какой signal | Почему |
|---|---|---|
| **`.gantt-lock-badge`** | `--prizma-drift` (текст) на `--prizma-drift-bg` (фон) | План зафиксирован → переносы требуют комментария → дрейф против плана. Это семантически **drift-статус**, а не decoration amber. **Замена П11.23.** |
| **`.gantt-lock-badge-edit`** | `--prizma-information` | Режим редактирования = информационный статус (не предупреждение, не риск). |
| **`.gantt-bar-overtime`, `.gantt-window-overtime`, `.v16-spark-bar-overtime`, `.v16-team-bucket-active[data-bucket="overtime"]`** | `--prizma-off-course` | OT — это **сбился с курса**. Это единственный колодец из 5, который реально статус. Сейчас `#dc2626` (`:2478, :6052, :6099`) — близко по hue, но не token. |
| **`.gdt-rail-today` (pill)** | `--prizma-information` | Сегодняшняя дата = информация-marker, не предупреждение. (Сейчас `var(--prizma-information, #4f46e5)` с **fallback hex** — fallback убрать). |
| **`.gdt-pill-cmt-transfer` / `.gdt-pill-cmt-add`** | соответственно `--prizma-drift` (transfer = переносили = drift) / `--prizma-information` (add = добавили) | Сейчас `#f59e0b` / `#3b82f6` (`:2443-44`) — заменить на token. |
| **`.gantt-no-assignee` (`:5879`)** | `--prizma-drift` (warning) | Текст «без исполнителя» — это drift (нужен курс — пилюля без owner). Сейчас `var(--warning)` — псевдо-token, должен быть `--prizma-drift`. |
| **`.gdt-pill-state-done`** | `--prizma-on-course` (бейдж заливкой) | Done = на курсе. Сейчас `#059669` (`:2415-16`) — заменить. |
| **`.gex-status-{done,active,unplanned}` (export)** | `--prizma-on-course / information / drift` | Сейчас `#059669 / #2563eb / #b45309` (`ganttHtmlExport.js:940-942`). Каждый статус — signal. |

### 4.2. Где **ЗАПРЕЩЕНО** signal-цвет (currently violating)

| Место | Что сейчас | Должно быть |
|---|---|---|
| `.v16-spark-bar-{r120,r121,r122}` (`:6049-51`) | `#4f46e5 / #059669 / #d97706` (3 hex) | `--gdt-bucket-r120 / -r121 / -r122` — **нейтральные**, не signal. 1.20/1.21/1.22 — это просто кварталы, у них нет «статуса курса». Палитра — 3 hue-сдвига одного нейтрального серо-синего, или 4 grayscale-step. |
| `.v16-team-bucket-active[data-bucket="r120"...] .v16-team-bucket-count` (`:6096-98`) | `#4f46e5 / #059669 / #d97706` цветят **число** | Числовой счётчик — `--prizma-text-primary`. Активность колодца — выделять **stripe-left** на parent `.v16-team-bucket` 2px в `--gdt-bucket-r120/...`, а не цветом цифры. |
| `.gantt-bar-r120 / -r121 / -r122` (`:2475-77`) | `var(--prizma-information) / #059669 / #d97706` | Аналогично — `--gdt-bucket-r120 / -r121 / -r122` (нейтральная серия). `--prizma-information` сейчас по факту = «синий 1.20» — это нарушение semantic-token-системы. |
| `.gantt-type-pill[data-wt=*]` (`:5869-77`) — 9 hex для типов работ | 9 цветов через 9 hex | Это **другая семантика** (тип работ ≠ колодец). Должно быть `--gdt-wt-{backend,frontend,...}` 9 переменных, **нейтральная палитра** (типы работ — это идентификаторы, не статусы). Не signal-tokens. Допустимо использовать palette-light/palette-dark пары без брендбук-перетекания. |
| `.gdt-rail-flow-{in,out}` (`:1898-1911`) — `#1d4ed8 / #b45309` | Цвет «+N / −N» текст | Сделать **нейтральным** `--prizma-text-secondary` на нейтральном фоне `var(--prizma-bg-tertiary)`. Сами числа — не статус, это счётчики. |
| `.gantt-bucket-radio:has(input:checked)` (`:2304-06`) | `--prizma-information-bg / -information` | OK как есть (выделение active-state — допустимо как information-signal). Главное — убрать `#fff` fallback на `:2300` (light theme bg-1). |

### 4.3. Что должно остаться нейтральным

| Токен | Где |
|---|---|
| `--prizma-bg-elevated` | `.gantt-team-header.v16-team-row` (сейчас `--prizma-bg-tertiary` — норма), `.gantt-type-pill` (сейчас `var(--card)` legacy → должен быть `--prizma-bg-elevated`), `.gdt-jump-box`. |
| `--prizma-border` | Все default-границы. |
| `--prizma-text-tertiary` | Все labels, dates, captions. |
| `--prizma-text-secondary` | Eyebrows, sub-headers, gantt-row-label, v16-epic-cat. |
| `--prizma-text-primary` | Все числа (включая `.v16-team-bucket-count`, `.gdt-rail-label`, `.v16-epic-name`). |
| `--gdt-bucket-{backlog,r120,r121,r122,ot}` | **5 новых нейтральных переменных** для идентификации колодца. OT — единственный с signal-окраской (`var(--prizma-off-course)`). |
| `--gdt-wt-{...}` | 9 переменных для типов работ (нейтральная многоцветная палитра). |

### 4.4. Конкретное предложение для plan-lock badge (П11.23)

Текущее (`styles.css:2274-84`):
```css
.gantt-lock-badge {
  background: #fef3c7; color: #78350f;        /* hex hardcode */
  border: 1px solid #f59e0b;                  /* hex hardcode */
}
.gantt-lock-badge-edit { background: #dbeafe; color: #1e3a8a; border-color: #3b82f6; }
body.theme-dark .gantt-lock-badge      { background: var(--prizma-drift-bg); color: var(--prizma-drift); border-color: var(--prizma-drift); }
body.theme-dark .gantt-lock-badge-edit { background: var(--prizma-information-bg); color: var(--prizma-information); border-color: var(--prizma-information); }
```

Должно быть:
```css
.gantt-lock-badge {
  background: var(--prizma-drift-bg);
  color: var(--prizma-drift);
  border: 1px solid var(--prizma-drift);
}
.gantt-lock-badge-edit {
  background: var(--prizma-information-bg);
  color: var(--prizma-information);
  border-color: var(--prizma-information);
}
/* dark-overrides УДАЛИТЬ — токены сами переключатся через :root ↔ .theme-dark */
```

В `ganttHtmlExport.js:710-719` — то же. В **inline-style на `:984`** — `style="..."` снять полностью, оставить только class.

---

## Section 5. Spacing rhythm

### 5.1. Базовая unit

**4px-base, 8px-major.** Наследуем от дашборд-стандарта.

### 5.2. Gap между колонками и блоками

| Между чем | Gap | Текущее | Логика |
|---|---|---|---|
| `.gantt-filters` → `.gantt-pill-legend` | **16px** | `margin-bottom: 16px` — ОК | — |
| `.gantt-pill-legend` → `.gantt-wrap` | 16px | 12px (`:2561`) — на 4-grid | Чуть увеличить |
| `.gantt-header` → первая `.gantt-row` | **0** (sticky граница) | OK через `border-bottom: 2px` (`:1792`) | — |
| Между `.gantt-row` (через `border-bottom`) | 1px hairline | OK (`:1914`) | — |
| `.gantt-cell` (между колонками) | 1px hairline через `border-right` | OK | — |
| `.v16-team-spark` bars gap | **4px** | 3px (`:6015`) — не на 4-grid | Поднять |
| `.v16-team-bucket` баланс label/count | **8px** | 6px (`:6070`) — не на 4-grid | Поднять до 8 |
| `.gantt-bucket-radio` group | 8px | 8px ix-bucket-row inline (норма) | — |
| `.gdt-jump-item` отступы между | 0 (плотный список) | OK | — |
| `.gantt-legend` items | 12px | OK | — |

### 5.3. Padding ключевых блоков

| Блок | Padding | Текущее | Логика |
|---|---|---|---|
| `.gantt-header-col` | **12px 12px 8px** | `10px 10px 8px` (`:1803`) — не на 4-grid | До 12 |
| `.gantt-header-label` | **12px 16px** | `10px 14px` (`:1796`) — не на 4-grid | До 12/16 |
| `.gantt-team-header-cell` | **8px 16px** | `6px 14px` (`:2110`) | До 8/16 |
| `.gantt-row-label` | **8px 16px**, padding-left **24px** (отступ под группу) | `6px 14px / 24px` (`:2116-19`) | До 8/16 |
| `.v16-team-bucket-cell` | **8px 12px** | OK (`:6064`) | — |
| `.gantt-type-pill` | **4px 8px 4px 8px** (left = 8 вкл. 3 stripe? — нужно уточнить с UX) | `4px 7px 4px 6px` (`:2350`) — не на 4-grid | Унифицировать на 4/8 |
| `.gantt-bucket-radio` | **4px 8px** | `5px 10px` (`:2298`) | До 4/8 |
| `.gdt-rail-flow-{in,out}` | **2px 4px** (badge) | `1px 5px` (`:1901`) — не на 4-grid | До 2/4 |
| `.gantt-lock-badge` | **4px 8px** | `4px 10px` (`:2276`) | До 4/8 |
| `.gantt-pill-legend-toggle` | 8px-12px | OK | — |

### 5.4. Vertical rhythm

**Одна линия:** все CAPS-eyebrow (gantt-header-label, gantt-lock-badge, gex-readonly-badge) на 11/1.5px / weight 600 / `--prizma-text-secondary`. Это создаёт «зрительную полку» через всё приложение (дашборд, метрики, гант).

**Числа:** `.gdt-rail-label` 24/300 mono — единственный Primary stat в шапке колодца, baseline выровнен с `.v16-team-bucket-count` 15/400 mono в team-row через одинаковую `line-height: 1`.

**Mono-tabular** для чисел в одном столбце: внутри одной колонки (например, `.v16-team-bucket-count` для всех команд по колодцу r120) `letter-spacing: 0` (не -0.2/-0.5), чтобы цифры выровнялись по разряду между строками.

### 5.5. Hairline-разделители

`border-right: 1px solid var(--prizma-border)` между колонками шапки и cell — корректно. **Дополнительно** добавить `border-bottom: 2px solid var(--prizma-border-strong)` под `.gantt-header` (сейчас `2px solid var(--border)` — правильно, проверить что переменная). Между группой команды и эпиков — **3px stripe-left** в нейтральном `--prizma-border-strong` (как kpi-neutral в дашборде).

---

## Section 6. CSS-mockup ключевых правил

> Псевдо-CSS, не для копипаста. Иллюстрация Section 3-5.

```css
/* ─── 5 нейтральных переменных колодцев ─── */
:root {
  --gdt-bucket-backlog: var(--prizma-text-tertiary);
  --gdt-bucket-r120:    color-mix(in srgb, var(--prizma-text-secondary) 80%, var(--prizma-information) 20%);
  --gdt-bucket-r121:    color-mix(in srgb, var(--prizma-text-secondary) 80%, var(--prizma-on-course) 20%);
  --gdt-bucket-r122:    color-mix(in srgb, var(--prizma-text-secondary) 80%, var(--prizma-drift) 20%);
  --gdt-bucket-ot:      var(--prizma-off-course);   /* единственный signal */
}

/* ─── PRIMARY заголовок колодца ─── */
.gdt-rail-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 24px;                                  /* брендбук MonoNumber */
  font-weight: 300;                                 /* было 800 — снять */
  letter-spacing: -0.5px;
  line-height: 1;
  font-variant-numeric: tabular-nums lining-nums;
  color: var(--prizma-text-primary);
}
.gdt-rail-label-backlog {
  font-family: 'SF Pro Display', sans-serif;
  font-size: 18px; font-weight: 500;                /* Subtitle */
  letter-spacing: 0;
}

/* ─── EYEBROW + Today-pill ─── */
.gantt-header-label {
  font-size: 11px; font-weight: 500; letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--prizma-text-secondary);
}
.gdt-rail-today {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 500; letter-spacing: 1.2px;
  text-transform: uppercase;                        /* было lowercase */
  color: var(--prizma-information);
  background: var(--prizma-information-bg);
  border-radius: 999px;
  padding: 2px 8px;                                 /* 4-grid */
}

/* ─── PLAN-LOCK BADGE — П11.23 fix ─── */
.gantt-lock-badge {
  font-family: 'SF Pro Display', sans-serif;
  font-size: 11px; font-weight: 600; letter-spacing: 1.2px;
  text-transform: uppercase;
  background: var(--prizma-drift-bg);
  color: var(--prizma-drift);
  border: 1px solid var(--prizma-drift);
  padding: 4px 8px; border-radius: 4px;
}
.gantt-lock-badge-edit {
  background: var(--prizma-information-bg);
  color: var(--prizma-information);
  border-color: var(--prizma-information);
}
/* (dark-override УДАЛИТЬ — токены сами переключатся) */

/* ─── PILL — единая 11/500 ─── */
.gantt-type-pill {
  font-family: 'SF Pro Display', sans-serif;
  font-size: 11px; font-weight: 500;
  background: var(--prizma-bg-elevated);
  border: 1px solid var(--prizma-border);
  border-left: 3px solid var(--gdt-wt-default, var(--prizma-text-tertiary));
  padding: 4px 8px; border-radius: 6px;
  color: var(--prizma-text-primary);
}
.gdt-pill-row-2 {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; font-weight: 400;                /* было 9.5 — на 4-grid */
  font-variant-numeric: tabular-nums;
  color: var(--prizma-text-tertiary);
}

/* ─── TEAM-ROW + bucket-count ─── */
.v16-team-name {
  font-family: 'SF Pro Display', sans-serif;
  font-size: 15px; font-weight: 500;                /* Body Subtitle */
  color: var(--prizma-text-primary);
}
.v16-team-bucket-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px; font-weight: 400; letter-spacing: -0.2px;
  font-variant-numeric: tabular-nums;
  color: var(--prizma-text-primary);                /* НЕ цвет колодца */
}
.v16-team-bucket-active {                           /* signal в stripe, не в цифре */
  border-left: 2px solid var(--gdt-bucket-r120);    /* пример — реально через [data-bucket] */
}
.v16-team-bucket-active[data-bucket="overtime"] {
  border-left: 2px solid var(--prizma-off-course);  /* единственный signal */
}
```

---

## Section 7. Спорные моменты

### С7.1. С IA-экспертом: 5 колодцев или 4?

Принять текущие 5 (Бэклог + 1.20/1.21/1.22 + OT) как фиксированную ось. Если IA скажет «вынести Бэклог в left-side-tab» — моя шкала валидна: rail-label остаётся 24/300, бэклог-tab превращается в Subtitle 18/500 на левом краю.

### С7.2. С motion-экспертом: «Сегодня DD.MM» — pulse или статика?

Я за **статичный** `.gdt-rail-today` (CAPS 10/1.2). Motion может надстроить breathe (§9 #2) — не противоречит. Постоянный pulse — нарушает §1 «спокойный, не тревожный».

### С7.3. С interaction-экспертом: hover-effect на pill

`:2357` `box-shadow: 0 1px 4px rgba(0,0,0,.10)` — OK. Можно поднять до `0 2px 8px var(--prizma-shadow-soft)`. `scale: 1.02` или `translateY: -1px` — нарушает Spine-pill (V15 plain neutral).

### С7.4. С brand-экспертом: 5 колодцев — нейтральные или semantic?

Главный спор. Я за: **4 release-колодца нейтральные**, **OT — единственный signal** (`--prizma-off-course`). Альтернатива: «текущий = `--prizma-on-course`, ближайший = `--prizma-information`, дальний = `--prizma-drift`» — семантически богаче, но требует динамической покраски через JS (текущий релиз ≠ 1.20 навсегда). Текущий-релиз уже выделяется `box-shadow: inset 0 2px 0 0 var(--prizma-information)` (`:1859`) — отдельным механизмом.

### С7.5. С автором брендбука: апдейт §4 и §6

- §4 не описывает Primary KPI 24/300 как **роль на рабочем экране**. Расширить: «MonoNumber 24/300 — Primary stat-уровень для рабочих инструментов (Гант, Метрики, AI)».
- §6 не задаёт spacing-scale 4-grid. Без этого density-toggle (compact = 30 вместо 32) выпадает из системы.

---

## Сводка изменений

| # | Что делаем | Где | Эффект |
|---|---|---|---|
| 1 | `.gdt-rail-label` 16/800 → **24/300 mono** | `:1812-18` | Снимает «банковскую» тяжесть, восстанавливает брендбук §4 MonoNumber |
| 2 | `.gdt-rail-label-backlog` 13/700 → **18/500** | `:1821-25` | Subtitle вместо tag — слово «Бэклог» читается ровно |
| 3 | `.gantt-lock-badge` hex `#fef3c7/#78350f/#f59e0b` → `var(--prizma-drift-bg/drift)` | `:2274-82` (light) | П11.23 закрытие; убрать dark-override (`:2283`) |
| 4 | `.gex-readonly-badge` (export) — то же | `ganttHtmlExport.js:710-719,984` | Inline-style тоже снять |
| 5 | Удаляем эмодзи `🔒`, `✏`, `▸`, `▾`, `✓` | `app.js:1197,1200,1201`, `gantt.js:964`, `styles.css:1019, 2421` | §7 «спокойный, не тревожный» |
| 6 | Eyebrow CAPS 11/1.5 на `.gantt-header-label`, `.gantt-team-header-cell`, `.gantt-lock-badge` | `:1795-98, :2109-13, :2274` | Единый «голос» eyebrow с дашбордом |
| 7 | 5 цветов колодцев → 5 переменных `--gdt-bucket-*` (4 нейтральных + 1 signal OT) | 5 источников: `:2475-78, :5869-77, :6048-52, :6096-6100, gantt.js:1389, ganttHtmlExport.js:411-414` | §3.3 — signal не decoration |
| 8 | `.v16-team-bucket-count` цвет с `#4f46e5/059669/d97706/dc2626` → `var(--prizma-text-primary)`. Signal — в stripe-left на parent | `:6096-6100` | Signal не в числе |
| 9 | `.gdt-pill-cmt-transfer/-add` `#f59e0b / #3b82f6` → `var(--prizma-drift) / var(--prizma-information)` | `:2443-44, :2658-59` | Token, не hex |
| 10 | `.v16-team-name` 14/600 → **15/500** (Body Subtitle) | `:5991-99` | Брендбук §4 |
| 11 | `.gdt-pill-row-2` 9.5/500 → **11/400 mono** | `:2455-62` | На 4-grid + mono-tabular |
| 12 | `.v16-team-total` add **mono** | `:6004-09` | Mono-tabular для чисел |
| 13 | `.gantt-no-assignee` `var(--warning)` → `var(--prizma-drift)` | `:5879` | Token-canon |
| 14 | `.gdt-pill-state-done` `#059669` → `var(--prizma-on-course)` | `:2415-16` | Token |
| 15 | TODO в брендбук §4: «MonoNumber 24/300 — единый Primary stat для рабочих экранов» | `BRAND_BOOK.md` | Закрыть дыру в шкале |
| 16 | TODO в брендбук §6.5: spacing scale 4px-base | `BRAND_BOOK.md` | Закрыть дыру в системе |
| 17 | Centralize `_BUCKET_COLORS` в `constants.js` (источник правды) | `gantt.js:1389`, `ganttHtmlExport.js:411-414` | Один файл правки при ребрендинге |

---

**Отчёт записан в audit-2026-05-04/gantt-redesign/02-VISUAL.md, длина ~506 строк.**
