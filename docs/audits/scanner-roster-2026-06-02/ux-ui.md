# Аудит таблицы сотрудников: UX/UI (когнитивная нагрузка, иерархия, paradigm)

**Эксперт:** UX/UI designer, data-dense internal tools (мониторинги, дашборды); фокус — cognitive load и hierarchy, не визуальные мелочи
**Дата:** 2026-06-02

## Резюме

Roster-строка несёт **до 18 независимых визуальных сигналов** (1 ФИО · 2 dot-strip × 24 точки · до 4 src-chips · до 5 badge-сигналов · 4 counter'а · chevron) — это **двукратное превышение порога 4±1 Миллера** для сканирующего чтения. Пилотный паттерн «утром 5 минут на 30 человек» (~10 сек на строку) физически не успевает прочитать ни одной строки целиком, тимлид принимает решение на 1-2 случайно зацепившихся сигналах. Главная системная проблема — **отсутствие единого primary-сигнала на строке**: все элементы конкурируют за внимание с равным весом, и при этом некоторые из них дублируют друг друга (▌Nh dwell vs stop-группа stripe-left vs красный triage; switches ↻N vs PROD chip за тем же флагом). «Panel» — на самом деле **полноэкранная модалка** (4vh/4vw), что ломает обещание side-by-side сравнения. Pulse-animation на регрессе делает строку **визуально неустойчивой** (3 пульса × 1600ms = 5 сек дёргания) и работает как anti-pattern «крик о помощи» на data-dense таблице. Рекомендация — провести **жёсткую амортизацию сигналов до 3 ярусов** (что критично · что контекст · что drill-down) с переездом большинства chip'ов на hover/expand.

## Находки

### 1. Plot 18 сигналов в одной строке — за гранью parallel scan

**Описание:** `renderRow` (teamScanner2RendererPersonRows.js:163-313) рендерит на grid'е `16px 200px 220px 220px 1fr auto 16px` (CSS styles.css:16571) набор:

- spacer 3px
- ФИО (200px)
- label «Сегодня» + 24-точечный strip (220px)
- label «Вчера» + 24-точечный strip (220px)
- badge-area: diff-arrow + до 4 src-chips (B/C/Z/J) + dwell ▌Nh + switch ↻N + CR Nч + N↗ Z% (до 8 элементов в одной inline-flex)
- 4 counter'а (WIP, PR, задач, ч) с number + label
- chevron

Итого: **48-72 видимых atom'а на одной строке**, при 30 строках — **2160 atom'ов на экране**. По стандарту data-dense (Tufte, Few) на одной табличной строке не должно быть больше 7±2 distinct visual channel'ов. Пилот это уже почуял — отсюда пьедестал localStorage-флагов `q2_scanner_hide_productivity` / `q2_scanner_show_productivity`, но это **per-user hack**, а не системное решение.

**Зачем чинить:** утренний 5-минутный scan на 30 человек = ~10 сек/строка. Reading этого объёма требует ~30 сек на строку — ×3 от факт-бюджета. Тимлид принимает решение на 1-2 случайно зацепившихся сигналах → ошибка приоритезации. Это первичная UX-проблема, ВСЕ остальные находки — её симптомы.

**Как чинить:** жёсткая 3-ярусная амортизация:

- **Ярус 1 (always-visible, 4-5 atom'ов):** ФИО · primary-signal-pill · today-strip · key-counter · chevron. Primary-signal-pill = composite chip, выбираемый по приоритету: «▌48ч CALC-201» > «WIP 5×» > «PR 3 mergeable» > «—»
- **Ярус 2 (on hover/row-focus, fade-in 80ms):** src-chips, secondary counters, vчера-strip
- **Ярус 3 (on expand/click):** всё, что сейчас в panel

Можно сделать без переписки grid'а — current grid template превращается в `auto 1fr auto auto auto auto`, ячейки badge-area и yesterday-strip получают `opacity: 0; transition: opacity 120ms` и активируются на `.ts2-row:hover, .ts2-row:focus-within`. Это **выглядит как тот же layout**, но при scan'е глаз цепляется только за ярус-1. Регрессия — touch-устройства; для них применить `@media (hover: none)` с always-visible второй ярус.

**Критичность:** high
**Сложность:** medium
**Ценность:** high

---

### 2. Dot-strip 24 ячейки × 6px на строке не читается — это орнамент, не данные

**Описание:** `dotStrip` (teamScanner2RendererCommon.js:148-167) рендерит 24 ячейки по 6×14px = 144px ширины с 4×4px точками. Opacity нормировка `sqrt(n/rowMax)` (V22 S-16) — корректная по Stevens, но проблема **не в нормировке**, а в **resolution**. На 6px колонке между двумя соседними часами (07 и 08, оба с 1-2 коммитами) перцептивно неразличимо, какой час был активнее. По Cleveland's hierarchy of graphical perception, dot-density на 4×4px = **самая нижняя ступенька** (worse than line position, length, slope, area).

Поверх этого: **строка имеет 2 strip'а** (сегодня + вчера), оба занимают `220 + 220 = 440px` row-grid'а = ~30% horizontal real-estate, при этом передают тот же класс сигнала («когда был активен»). В итоге половина строки = пара трудночитаемых орнаментов, дёшево покупающих «есть какая-то ритмическая картинка».

Кроме того — **dot-strip на свободной хронологической оси сравнивает несравнимое**: «вчера 14:00» по часам совпадает с «сегодня 14:00», но если сегодня 10:30 — большая часть «сегодня»-strip'а будущее (пустое), а «вчера»-strip имеет полные 24ч. Side-by-side два strip'а одинаковой ширины врут о пропорциях.

**Зачем чинить:** 30% строки → недорого. При scan'е глаз ищет «есть активность сегодня?» → бинарный вопрос на 144px → переплата. **Никто реально не сравнивает 14:00 vs 16:00** — это вопрос для drill-down.

**Как чинить:** заменить today-strip на **компактный 8-сегментный 3-hour-bucket strip** = 8 ячеек × ~6px = 48px (или micro-bar-chart). Это сразу:

- читается «утро/день/вечер активность»
- освобождает 170px на строке
- даёт реальные «равные по площади» бакеты для today vs yesterday

Yesterday-strip убрать со строки совсем. Заменить на **single delta-glyph** (▲/▼/=) рядом с today-strip: «vs вчера: +12 / -3 / same». Это **тот же информационный посыл** в 1 atom'е вместо 24. Полная hourly resolution остаётся в heatmap72×4 в panel — там 6px×24×4 уже оправдан как drill-down.

**Критичность:** high
**Сложность:** medium
**Ценность:** high

---

### 3. Triple-duplicate сигнал «у этого человека всё плохо»

**Описание:** Один и тот же status — «висит блокер давно» — кодируется в трёх местах одновременно:

1. **Group stripe-left 3px red** (CSS styles.css:16536 `.ts2-group-stop`) — вся группа красная слева
2. **▌Nh dwell-badge** в row (PersonRows.js:245-247) — `maxDwell ≥ 24ч`
3. **diff-arrow ↓ stop** (PersonRows.js:280-287) с `is-pulse-attention` анимацией
4. (исторически было ещё `.ts2-blocker` red stripe слева от имени — удалено в V18.1 P7-S3.2, но `ts2-blocker-spacer` 3px остался → дырка в grid'е)

При этом сам факт «человек в Стопе» уже = primary-сигнал через **порядок групп** (stop первая). Группа имеет header «Требует внимания» — четвёртое сообщение того же.

`renderPersonRows.js:121-124` явно фиксирует: «Stop-группа уже первая в renderGroup-порядке + ▌Nh dwell-badge на row, pill дублировал» — но при этом stripe-left + group-header + ▌Nh + diff-arrow остались.

**Зачем чинить:** Redundancy в data-dense UI = **noise**, а не reinforcement. Пользователь учится игнорировать самый «громкий» сигнал (red stripe everywhere → стрингует в фоне), а тонкие сигналы (CRV 12ч на конкретном ревьюере) теряются. Это closer to «тревожная сирена в кафе» (стерта внимание полностью), чем к focus tool.

**Как чинить:** одна правда — **порядок групп + group-header**. Внутри stop-группы:

- убрать stripe-left 3px (groups уже сегрегированы)
- ▌Nh dwell-badge оставить **только для maxDwell ≥ 72ч** (раньше — это уже понятно из принадлежности к stop)
- pulse-animation **выключить полностью** (см. находку #6)
- diff-arrow ↓ → удалить с row, оставить **только в panel header** (это контекстная инфа, не scan-сигнал)

Сравнить with: stop-группа целиком даёт «крик», внутри строки primary-pill говорит **конкретно почему** («▌96ч CALC-201 в QA») — это action-able, а не «smash red».

**Критичность:** high
**Сложность:** low
**Ценность:** high

---

### 4. Pulse-animation на регрессе — антипаттерн на data-dense

**Описание:** PersonRows.js:286 `if (groupDropped) cls += ' is-pulse-attention'` + CSS styles.css:16392 — три пульса × 1600ms = 4.8 сек дёргающейся диф-стрелки. По комментарию: «Брендбук §9 #3 — pulse только на регрессе, не на улучшении». Это **системно неверный паттерн** на data-dense таблице:

- Pulse-animation работает как **attention magnet** — в HUD/notification, **где нет других магнитов**. На таблице с 30 строками одновременно может пульсировать 3-7 строк → 3-7 параллельных attention-magnet'ов → cognitive panic.
- При расширенной команде (50+ человек) pulse-animation в нескольких строках на разных скроллах = motion sickness vector. `prefers-reduced-motion` не включается у пользователей по умолчанию.
- «Только на регрессе» — это **уже** signal через **diff-arrow ↓ + color** (off-course red). Pulse — третья сигнальная нагрузка на тот же atom.

**Зачем чинить:** pulse-animation создаёт **визуальное несогласие при scan'е**: глаз постоянно вытаскивается на «что там мерцает» → невозможно прочитать соседние строки. Это работает в push-notification (1 atom на экране), не в таблице.

**Как чинить:** удалить `is-pulse-attention` со строки. На регрессе оставить:

- цветной diff-arrow ↓ (red) с border-left 3px — статическая визуальная weight
- **plus** один-time toast «↓ 3 человека ухудшились с вчера: [Иванов, Петров, Сидоров]» при первом открытии Сканнера в день — это работает как **summary**, не как per-row эффект

Если очень нужен row-emphasis на свежем downgrade — однократный **flash 200ms на open** (как highlight найденного в Find-in-page), затем static. Никаких 4.8 сек.

**Критичность:** high
**Сложность:** low
**Ценность:** high

---

### 5. «Panel» — это full-screen modal, что ломает promise side-by-side

**Описание:** Класс `ts2-panel-modal` (CSS styles.css:16922-16930) даёт inset `top: 4vh; bottom: 4vh; left: 4vw; right: 4vw` — это **94% × 92% экрана**, поверх backdrop'а 0.42 alpha. То есть «detail panel» в коде = на самом деле **полноэкранная модалка**, которая полностью закрывает roster.

Это создаёт три проблемы:

1. **Сравнение «Иванов vs Петров»** — кейс «у этих двоих похожие WIP, но Петров копит CR» — **невозможен**: открыл Иванова → modal закрыл roster → открыл Петрова → перерендер. Память человека не держит 4 числа из закрытого вьюпорта.
2. **Контекст групп теряется**: открыл из stop-группы, через 30 секунд читая narrative — где я? «Назад» breadcrumb (renderPanelHeader teamScanner2Renderer.js:1448) частично помогает, но это **второй фрейм навигации**, не visual context.
3. **Modal-paradigm = "осознанное действие → закрыть → продолжить"** (как «Как считается»), но drill-down в roster — это **flow-задача** «прошёл по 30 человекам утром». Modal на каждом шаге = 30 mode-switch'ей.

История кода это подтверждает: изначально (styles.css:16905) был `position: fixed; right: 0; width: clamp(420px, 38vw, 540px)` — slide-in справа. Потом «PR-CN — детализация по сотруднику теперь полноэкранная модалка (как «Как считается»), а не slide-in справа» — переключили **обратно**.

**Зачем чинить:** это primary-mode сценарий продукта (drill-down в каждого человека на стэндапе). Modal-paradigm здесь несовместим с use-case.

**Как чинить:** вернуть **slide-in panel ~540px справа** с одной критической доработкой — **roster не блокируется backdrop'ом**. Тимлид может:

- кликать другую строку → panel перерендерится на нового человека (без mode-switch)
- видеть roster слева (340px при ~1920 viewport) → есть контекст «откуда пришёл»
- Esc / клик вне panel'и → close

Для мобильных и узких экранов (`< 1280px`) — fallback на full-screen modal. Текущий код уже умеет slide-in (`styles.css:16905-16914`), нужен только revert класса + добавить «продолжить кликать roster при открытой panel»-handler.

Side-by-side comparison — отдельный feature (Cmd-click → multiple panels?), но **базовая single-panel slide-in** обязательна.

**Критичность:** high
**Сложность:** medium
**Ценность:** high

---

### 6. «Сегодня / Вчера» labels — паразитный шум

**Описание:** PersonRows.js:301-302 рендерит `<span class="ts2-strip-label">Сегодня</span>` и `<span class="ts2-strip-label">Вчера</span>` перед каждым strip'ом. Комментарий в CSS:16669-16677: «подпись „Сегодня" / „Вчера" перед dot-strip'ом, чтобы пользователь сразу понимал, что две точечные линии в строке = два разных дня». Логика верная, но реализация плохая:

- **На КАЖДОЙ строке** (30 повторений × 2 label'а = 60 повторений «Сегодня/Вчера»)
- Labels CAPS 10px/700 letter-spacing 0.6 — высокая визуальная weight по cognitive model'у (текст с capital-letter + bold + tracking = "официальное")
- Они одинаковые для всех строк → **информация = 0 бит**, шум = 100%

**Зачем чинить:** табличный column-header — стандартная UX-паттерн с 1970-х. Положить label'ы в **один header-row** наверху таблицы (или группы). 60 повторений → 2 повторения. Тимлид через 3-4 секунды учится «левый strip = сегодня», и labels на каждой строке становятся pure noise.

**Как чинить:** добавить sticky table-header перед первой группой:

```
[Имя]  [Сегодня (последние 24ч)]  [Вчера (предыдущие 24ч)]  [Сигналы]  [WIP·PR·Задач·Ч]
```

Внутри группы убрать per-row label'ы. CSS-затраты — добавить `.ts2-rows-header` с тем же grid-template-columns. Bonus: header'ы можно сделать **сортируемыми** (клик «WIP» → sort by WIP desc) — сейчас единственная сортировка в коде `timelineToday desc` хардкодом (PersonRows.js:71-76).

**Критичность:** medium
**Сложность:** low
**Ценность:** medium

---

### 7. Counter-block: 4 числа без иерархии и сравнения

**Описание:** PersonRows.js:304-309 рендерит 4 counter'а: `WIP / PR / задач / ч`. Все одинакового weight (13px/700 mono на num, 10px/700 caps на label). Tooltip частично делает попытку «vs медиана» (`tm.wip`, `tm.pr`, `tm.hours`) — но **видно только на hover**.

Проблемы:

1. **Все 4 числа равноправны** — но «5 задач» и «6ч» по effort'у ≠ равны. Без weight'а пользователь читает все 4 → переплата.
2. **Сравнение с медианой команды только в tooltip** — на scan'е невидимо. Хотя сам код это вычисляет: `_median(_wipArr)`, `_median(_prArr)`, `_median(_hrArr)` (PersonRows.js:98-111).
3. **`tasks` (distinct issue keys 72h)** конкурирует с `WIP` (issuesNow) — оба «сколько задач», тимлид путает.
4. **`ч`** (loggedTodaySec) — это **разница в природе** от остальных (часы vs counts). Должен быть отдельно.

Эти 4 числа в текущем виде = классическая «KPI tile soup».

**Зачем чинить:** «kpi soup» на data-dense = pattern-1 для cognitive overload. Тимлид игнорирует все 4, пока в одной строке не торчит «×3.5 от среднего» — но это видно только в tooltip.

**Как чинить:** заменить 4 counter'а на **inline bullet-chart-style indicator**:

```
WIP ●●●●○  PR ●○○○  └ задач 8 · 6ч сегодня
```

- WIP / PR — 5-dot scale relative to team median; ●●●● = 1.5× median, ●●●●● = 2×+
- «задач» и «ч» — pushed в subtitle row (faded), доступны но не равны WIP/PR по visual weight
- При WIP ≥ 1.5× median → красная точка + tooltip «×3.5 от среднего, 5 задач при норме ≤ 2»

Это **immediately readable**: видишь «●●●●●» — знаешь overload, без чтения числа. То что сейчас в tooltip — становится primary visual.

**Критичность:** medium
**Сложность:** medium
**Ценность:** medium

---

### 8. Source-chips B/C/Z/J — 4 chip'а × 30 строк = 120 chip'ов с одинаковым visual weight

**Описание:** PersonRows.js:222-230, srcChip helper рендерит до 4 chip'ов на строку (B, C, Z, J) при `n > 0`. Каждый = `key + num` с border-left coloured 2px, font-size 10px. Визуально chip'ы выглядят как «бэйджи действия» (как Spine-pill), но семантически они **просто counter'а в другом виде**.

Проблема:

1. **Они конкурируют по weight'у с действительно важными сигналами** (▌Nh dwell, CR Nч, N↗ %). На строке `dwell Nh + B 12 + C 3 + Z 1 + J 5 + CR 8ч + 3↗ 67%` — 7 равноправных chip'ов, primary неотличим от noise.
2. **Counts не actionable**: «B 12» — это много или мало? Без contextual reference (медиана команды на BB) chip говорит «у Иванова 12 что-то в Bitbucket». **Что с этим делать?**
3. **«J ⚠» error-chip** (PersonRows.js:226) — единственный actionable signal среди chip'ов, но **визуально похож** на остальные → теряется.
4. Цвета chip'ов tokenized (var(--prizma-on-course/-drift/-approve/-information)) но это **семантически неверно**: B = green (success?), C = orange (drift?), Z = purple (approve?), J = blue (information?). Цвета привязаны к **brand-palette**, а не к **smysl** источника. Иванов смотрит на «C 3 orange» и читает «3 drift-сигнала из Confluence»? нет, это просто Confluence как таковой.

**Зачем чинить:** src-chips сейчас = **четыре дополнительных counter'а** в строке, маскирующиеся под action-badges. Это либо primary (тогда оставлять цвет = drift/off-course нельзя), либо meta (тогда убрать с row-scan).

**Как чинить:** убрать src-chips с always-visible слоя. Заменить на **один composite src-glyph** (5 микро-dot'ов: J · B · C · Zc · Ze, opacity по нормировке к row-max). Это даёт scan-сигнал «человек активен ТОЛЬКО в BB, не пишет в CF» без 4 chip'ов:

```
sources: ● ● ○ ○ ○   (J активен, B активен, остальные нет)
```

8px wide, читается как «multi-source coverage glyph». Полные числа — в panel `renderPersonMetricsPanel` (там CF/Z/J уже есть).

`J ⚠` error-chip оставить в строке — это **единственный actionable**, должен быть visible (alert-style: red border, не зелёный/синий).

**Критичность:** medium
**Сложность:** medium
**Ценность:** medium

---

### 9. Detail panel — длинный verticalный stack без navigation

**Описание:** `renderEmployeeDetailPanel` (teamScanner2Renderer.js:1142-1156) рендерит 8 секций строго сверху вниз:

1. Header (имя, badges, email)
2. Narrative (3-5 предложений + copy)
3. Counters (segmented activity bar)
4. Person metrics chips (CF/Z/J + опционально PROD/АКТИВ/SWITCH/LOC/Σ/FRT/BURNOUT)
5. Heatmap 72×4 (5 × 72 = 360 клеток)
6. Filter pills J/B/C/Zc/Ze
7. Blockers shelf (collapsed by default)
8. Events feed 72ч (grouped by day)
9. Assistant section (LLM, collapsed)
10. Switches note

При viewport 92vh пользователь видит секции 1-3 (header + narrative + activity bar). **Heatmap уже за fold'ом**. Чтобы попасть в events feed — 2-3 экрана скролла.

Проблемы:

1. **Нет навигации внутри панели** — sticky table-of-contents / tabs / breadcrumb по секциям отсутствуют. Если тимлид хочет «глянуть Старые задачи» — нужно scroll-hunt.
2. **Filter pills** (J/B/C/Zc/Ze) находятся **под heatmap'ом** (1149 потом 1150), хотя они **контролируют** heatmap. Cause-after-effect = читать слева-направо не работает: видишь heatmap → не понимаешь почему 0 событий в Confluence → надо доскроллить ниже, увидеть что фильтр выключен.
3. **Narrative** сейчас primary-content, но рендерится **до** counters и activity bar — порядок «текст → числа → визуализация» обратный к natural scan ([F-pattern eye tracking](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/)): глаз сначала ищет числа сверху, потом читает текст. Перевернуть = narrative ниже activity bar.
4. **Section-titles все 10px CAPS 700** — нет visual hierarchy между primary («Сводка за 24ч») и meta («Heatmap 72×4»). Все одинаково «зычны».

**Зачем чинить:** info-dense panel требует navigation pattern. Без него panel = «long scroll wall», пользователь читает первые 30% и закрывает.

**Как чинить:** три изменения:

- **Sticky section-tabs** под header'ом: `Сегодня · Что мешает · 72ч активности · События · LLM`. Клик → smooth-scroll в секцию. По умолчанию активен «Сегодня».
- **Filter pills** перенести **над** heatmap (визуально control'ы всегда **над** их target'ом). Дополнительно — totals можно показывать прямо на pill'ах (уже сделано, rowTotals), но pill-order сейчас J/B/C/Zc/Ze хардкодом — поменять на **сортируемый по total** (самые активные источники первыми).
- **Visual hierarchy титулов**: primary («Сводка за 24ч») — 13px medium-weight (не CAPS, не trackable); meta («Heatmap 72×4», «События») — 10px CAPS как сейчас. Это поднимет narrative как **primary**, остальные секции как «детализация».

**Критичность:** medium
**Сложность:** medium
**Ценность:** medium

---

### 10. Group-headers как клик-цели — invisible affordance

**Описание:** `renderPersonRows.js:130-134` группа stop/watch/moving имеет `<div class="ts2-group-head">` с `<span class="ts2-group-count" title="${meta.desc}">${arr.length}</span>`. По описанию в задаче — count'ы кликабельны (jump-to-group). В CSS (styles.css:16542-16560) — `.ts2-group-head` без `cursor: pointer`, без hover-state, без focus-state. То есть **аффорданс "кликни на меня" отсутствует**.

Idle-группа — `<details>` с `<summary>` (PersonRows.js:138) — там есть native browser disclosure-triangle (`▾ / ▴` в CSS:16561-16562), но это **discoverable только для idle**. Для остальных групп — нет.

Проблема: пользователь, который знает про функцию (из onboarding или случайно навёл), может кликнуть, но **никто из новых пользователей не догадается**.

**Зачем чинить:** обещанная функциональность (jump-to-group) бесплатная по cost'у, но недоступна по discoverability. Для группы 79 stop это критично — переход к началу группы без скролла спасает 2-3 сек.

**Как чинить:**

- `cursor: pointer` на `.ts2-group-head`
- `hover:` background slightly darker + chevron-right в правом краю заголовка
- aria-button-role: `<button class="ts2-group-head" type="button">` (PersonRows.js:131)
- При скроллированной странице — `position: sticky; top: <header-height>` для group-head'ов: тимлид всегда видит к какой группе он сейчас в roster'е. Особенно полезно для длинных списков (50+ stop).
- Counter chip-style: `<span class="ts2-group-count">79</span>` оставить, но при hover — tooltip «Перейти к группе» вместо `meta.desc`.

**Критичность:** medium
**Сложность:** low
**Ценность:** medium

---

### 11. Idle группа в `<details>` — collapse работает против sense-making

**Описание:** PersonRows.js:135-141 — idle группа рендерится как `<details>` collapsed by default («снимает шум с главного экрана»). Логично с точки зрения первичного экрана (тимлид утром хочет действий, не пустоту). Но на UX-уровне это создаёт две регрессии:

1. **«Тихий» сотрудник на отпуске** — НЕ виден тимлиду без открытия collapsed-секции. На стэндапе кто-то спросит «а Васи где?», тимлид скажет «Вась нет в Сканнере». Логически Вася в idle, technically видно после клика, на UX — НЕТ.
2. **Collapse hides состав команды**. Roster — это **roster** = реестр команды. Если 8 из 20 в idle, и idle collapsed, то visible часть таблицы — 12 человек. На вопрос «сколько у меня людей сегодня в активе?» нужно мысленно добавить idle, что подсчёт затрудняет.
3. Idle group имеет border-left grey (CSS:16539) — но collapsed его не видно. Эффект «отрезанного куска команды».

Дополнительно: `idleCount === parts.length` → банер «Вся команда в idle» (PersonRows.js:57-62) — это **catch-all для специального случая**. Между «1 idle» и «все idle» — большой gap с разной UX-обработкой.

**Зачем чинить:** roster обещает «команда сегодня» — должна показать команду целиком. Collapse полезен для **расширенных карточек**, не для **существования людей**.

**Как чинить:** заменить `<details>` на **compact-mode rendering** для idle-секции:

- Idle-группа всегда **видна**, но рендерится в **одной строке** (chip-row): `Без активности · 8 чел · [Иванов] [Петров] [Сидоров] [+5]` — chip-style avatars/names.
- При клике на chip → opens panel для этого человека (тот же flow что обычный row).
- При клике на «Развернуть»-кнопку → expand idle-group в обычные строки (как сейчас).

Это решает: (а) тимлид видит **всех людей** на главном экране, (б) idle compact = не вытесняет real-content, (в) drill-down работает identical.

**Критичность:** medium
**Сложность:** medium
**Ценность:** medium

---

### 12. Triage-pill spec'а — мёртвый дополнительный сигнал

**Описание:** PersonRows.js:85-92 строит `stopTriage` — top-3 stop-person'а по `maxDwellHours`. Затем PersonRows.js:117-124 фиксирует:

```js
const showTriage = stopTriage.length > 0 && (groups.stop.length >= 5 || maxAnyDwell >= 48);
// V21 — блок «Топ N в Стопе сегодня» удалён по запросу пользователя.
const triagePillHtml = '';
```

То есть **вся вычислительная логика** triage-приоритизации **есть**, но **не рендерится**. Это была попытка решить «79 stop без приоритизации = тимлид теряется», но user feedback убил pill, оставив проблему «79 stop без приоритизации».

Проблема осталась: stop-группа отсортирована **по timelineToday desc** (PersonRows.js:71-76), что для stop-группы (где `today === 0` по определению classifyPerson!) **бессмысленно**. То есть sort'а нет — порядок stop-строк случайный (deterministic, но не actionable).

**Зачем чинить:** sort внутри группы — это **второй ярус приоритизации** после самой группировки. Без sort'а группа 79 = роspetto. Pilot-feedback это и сказал, но удалили pill, не **починили sort**.

**Как чинить:** внутри `stop`-группы sort'ить по `maxDwellHours desc`:

```js
groups.stop.sort((a, b) => {
  const aDwell = Math.max(0, ...(a.blockers||[]).map(b => b.dwellHours||0));
  const bDwell = Math.max(0, ...(b.blockers||[]).map(b => b.dwellHours||0));
  if (aDwell !== bDwell) return bDwell - aDwell;
  return (b.blockers||[]).length - (a.blockers||[]).length;
});
```

Внутри `watch` — sort по WIP desc (overload-первые):

```js
groups.watch.sort((a, b) => (b.issuesNow||[]).length - (a.issuesNow||[]).length);
```

Внутри `moving` — текущая логика (timelineToday desc) валидна.

Внутри `idle` — sort по «дней без активности» (если есть staleness data) или alphabetically (стабильность).

Это **бесплатно** (sort fn change) и решает реальный pain pilot'а из V20.

**Критичность:** medium
**Сложность:** low
**Ценность:** high

---

### 13. Email в panel header — ссылка с tooltip-двусмысленность

**Описание:** renderPanelHeader (teamScanner2Renderer.js:1421, 1474-1478): email отображается в подзаголовке panel'и как clickable mailto-link, masked через `maskEmail` («v.b****@sber.ru»). По комментарию V22 «email-masking убран по UX-фидбеку: внутренний tool, всё внутри корп-сети» — **но при этом** маскировка **всё равно применяется в displayText** (`esc(maskEmail(emailFull))`), а full email в `data-email-full` и `href="mailto:"`.

Проблема:

- Mail-клиент откроется на **полный email** (mailto-href), но displayed text — **masked**. Это **неконсистентно**: пользователь видит `v.b****@sber.ru`, кликает → Outlook открывается на `vasiliy.borisov@sber.ru`. UX-разрыв («что я только что отправил»).
- Tooltip говорит «клик — раскрыть полностью» — но click открывает mail, а не raw-display. **Обещание не выполняется**.
- HR-комментарий о PII privacy — частично валиден для shared-screens (стэндап через Zoom-share). Но как реализовано — это **performance security** (вид защиты без реального скрытия в DOM).

**Зачем чинить:** mailto-link на masked-display — двусмысленно по affordance. Либо masking реально работает (с click-to-reveal toggle), либо не нужен совсем.

**Как чинить:** убрать masking совсем (по корп-сети комментарию V22) — показать `vasiliy.borisov@sber.ru` plain, mailto-link, copy-icon на hover. Если PII важен — реализовать **через click-to-reveal**:

- Default: `v.b****@sber.ru` (display), `tabindex=0`, `aria-label="Показать email"`
- Click → display раскрывается + кнопка «Скопировать»
- mailto-link только **после reveal**, не до

Текущий middle-state = worst of both.

**Критичность:** low
**Сложность:** low
**Ценность:** low

---

### 14. Activity bar в panel — 4 hero-tiles по дизайну

**Описание:** `renderCounters` (teamScanner2Renderer.js:1498-1524) — заявлено как «segmented activity bar» (V22+ Sprint C1, «по Tufte: 4 KPI = wasted real estate»), но фактическая разметка:

```html
<div class="ts2-activity-bar">
  <button class="ts2-activity-seg ts2-seg-commits">...</button>
  <button class="ts2-activity-seg ts2-seg-prs">...</button>
  <button class="ts2-activity-seg ts2-seg-tasks">...</button>
  <button class="ts2-activity-seg ts2-seg-hours">...</button>
</div>
```

Это **4 одинаковых кнопки в row**, с inset-shadow цветом снизу (CSS:24626-24629). По factual rendering — это **4-tile dashboard KPI strip**, не bar-chart. «Сегменты с пропорциями» обещаны в комментарии, но реализация — 4 кнопки `1fr` ширины с равными `text-align: center` числами.

Проблемы:

1. **Pretending to be bar chart, actually = 4 KPI tiles** — то против чего Sprint C1 сам же и боролся.
2. **Numbers без context**: `28 коммитов` за 48ч — много? Tooltip говорит «коммитов за 48ч: 28» — то же число. Median-tick обещан в коде («team-median tick») — **отсутствует в DOM-выводе**.
3. **Цвет нижней stripe**: commits=green, prs=blue, tasks=orange, hours=purple — **семантически случайно**. Цвета не несут информации (это просто bookmarks). При 8px height stripe — это **визуальный шум**, не data.
4. **Кнопки** — но при click что происходит? Грэп `ts2-activity-seg` показывает их как button, but no handler. Affordance врёт.

**Зачем чинить:** primary KPI sub-panel = первое после name/breadcrumb. Он либо real chart (with comparison), либо clean numbers.

**Как чинить:** real comparative chart:

```
Активность 48ч                       (vs медиана команды)
коммиты    ━━━━━━━━ 28    ●●●  (+12 vs med)
PR         ━━━ 3            ●○○  (-2 vs med)
задачи     ━━━━━━ 8         ●●●  (+2)
часы 72ч   ━━━━━━━━ 14.2ч   ●●○  (medium)
```

Horizontal bullet-chart с bar relative to team max, точкой = mean, opacity score = position relative. **Цветá — только signal-derived** (red over-, green under-, neutral middle). Без декоративных stripe colors.

Если bar-chart перебор для 4 чисел — упростить до **single-line summary**: `28c · 3PR · 8задач · 14ч (×0.9 от среднего)` — 1 строка plain-text, comparison явный.

**Критичность:** medium
**Сложность:** medium
**Ценность:** medium

---

### 15. Heatmap 72×4 — primary tool, занимающий 60% panel вертикали

**Описание:** `renderHeatmap72x4` (teamScanner2Renderer.js:1535-1624) рендерит 5 рядов × 72 ячейки + axis (−72ч / −48ч / −24ч / сейчас). По CSS (`.ts2-heatmap` flex-column) занимает ~140px высоты × full width. В panel.modal viewport ~92vh — это ~15% screen real-estate. Поверх — есть row-tail mini-sparkline за 12ч (V22+ Sprint C6) — это **mini-trend в каждой строке heatmap'а** — дополнительное чтение.

Жалоба из контекста: «heatmap занимает много места» — валидна.

Проблемы:

1. **Resolution overkill**: 72 часа × 5 источников = 360 ячеек, при использовании юзером — «когда был активен» (бинарно: пик утром/днём/вечером). Resolution per-hour никто не читает.
2. **Перцептивная задача sqrt-нормировки** (V22 S-16) хорошо сделана, но даже при идеальной нормировке 72 hourly-ячейки на 4×4px = **читается как texture**, не как data.
3. **Row-tail mini-sparkline** (CSS:24701) — отдельный chart в каждой строке heatmap'а. Это **micro-detail для micro-detail**. На стэндап-чтении бесполезно. (peer find: уже сам код это знает: «event-log дублирует данные heatmap», но не уменьшает heatmap).

**Зачем чинить:** жалоба пилотов прямая. Real-estate ~15% screen × low utility = bad ratio.

**Как чинить:** collapse heatmap **по умолчанию**, показывать **3-day bar-chart** вместо:

```
Активность 72ч
позавчера ━━━━━━━━━━ 18
вчера     ━━━━━━━ 12
сегодня   ━━━━━ 8     <— спад
```

3 bars stacked-by-source (J/B/C/Zc/Ze), читается **мгновенно**. Heatmap 72×4 → раскрыть by click («Подробно по часам») для тех редких случаев когда хочется понять «когда конкретно работал». Filter pills остаются доступны (для events feed).

Это решает: (а) panel короче, sigma меньше скролла, (б) primary-сигнал «тренд по дням» сразу виден, (в) детализация остаётся за один клик.

**Критичность:** medium
**Сложность:** medium
**Ценность:** medium

---

### 16. Productivity-флаги в localStorage — admission of UX failure

**Описание:** PersonRows.js:239-244 + Renderer.js:1260-1262 показывают паттерн:

```js
const hideProductivity = localStorage.getItem('q2_scanner_hide_productivity') === '1';
const _showProductivityChips = localStorage.getItem('q2_scanner_show_productivity') === '1';
```

То есть:

- switch-badge `↻N` в строке — **скрывается** по флагу (default visible, hide via flag)
- PROD / SWITCH / LOC chips в panel — **показываются** по флагу (default hidden, show via flag)

Это **два разных дефолта** для семантически одного класса метрик (productivity). И **флаги — не UI-visible** (`localStorage.q2_scanner_hide_productivity = '1'` — это **DevTools-only command**).

Жалоба из контекста: «productivity chips потенциально токсичны» — да, но реализация решения через invisible flags = **спрятать токсичность для тех, кто знает**, а 95% пользователей продолжают видеть. И обратно — Renderer-флаг показывает chips опытным power-user'ам, но они **их и не нужны** (тимлид без обучения = не сможет правильно интерпретировать).

**Зачем чинить:** invisible localStorage flag в product-UI = **broken contract**. Либо метрики должны быть default (с tutorial), либо удалены, либо иметь visible toggle.

**Как чинить:** заменить флаги на **explicit UX-paradigm**:

1. На уровне команды: settings-checkbox в Scanner header «Показывать engineering-метрики (PROD/SWITCH/LOC)» — default off. Persistent в `localStorage.q2_scanner_eng_metrics`.
2. При первом enable — **modal с инструкцией**: «Эти метрики — для команды, не для retro/performance review. PROD — composite score формула X. SWITCH — переключения между задачами. Использовать так:» + 3 пункта guidelines.
3. switch-badge `↻N` в строке — **по тому же флагу**, не отдельному. Единая dimension.

Это даёт: (а) discoverability — пользователь знает что есть метрики и почему скрыты, (б) consent — соглашается на ответственность интерпретации, (в) consistency — одна семантика, один toggle.

**Критичность:** low
**Сложность:** low
**Ценность:** medium

---

### 17. Diff-arrow «↓ stop» в строке — текст вместо glyph + i18n

**Описание:** PersonRows.js:283-287 рендерит diff-arrow:

```js
const groupRu = { stop: 'стоп', watch: 'наблюдение', moving: 'движется', idle: 'тихо' };
diffBadge = `<span class="${cls}" title="Вчера: ${...} → Сегодня: ${...}">${arrowIcon} ${esc(groupRu[prevGroup] || prevGroup)}</span>`;
```

То есть на строке появляется **полный русский label** «↓ наблюдение» / «↑ движется» / «↘ стоп». При 30 строках с diff'ами — это **20-30 разноязычных текстовых строк** в badge-area, конкурирующих по visual weight с числами.

Проблемы:

1. **Текст в badge** = высокий visual weight, низкая scan-density. «↓ наблюдение» прочитать ≈ 0.5 сек, при scan'е 30 строк = +15 сек.
2. **Слово «наблюдение» = 11 символов** — wider than counter `WIP 12` (6 символов). Этот badge заполняет горизонтальное место и **сдвигает counters** (через `1fr` cell).
3. **Эта инфа = secondary** — primary уже понятен из принадлежности к группе stop/watch/moving.

**Зачем чинить:** diff-info полезна как **summary** («3 человека ухудшились»), но per-row показ текстом — оверкилл.

**Как чинить:** заменить text на **icon-only** badge: `↓` (red), `↑` (green), `→` (neutral). Tooltip раскрывает «было: наблюдение, стало: стоп». На строке — 1 char, тот же сигнал, в 10× меньше места.

Дополнительно — **показывать только при downgrade** (groupDropped === true). Upgrade'ы (↑) не actionable утром (это праздник, не задача).

И — переезд в panel header: summary «Динамика команды: ↑3 ↓2 →25» в Scanner header — это primary-summary, не per-row.

**Критичность:** low
**Сложность:** low
**Ценность:** medium

---

### 18. Scroll fatigue в широких командах — нет sticky context

**Описание:** При 50+ человек в команде roster становится длинным (~3500px height). Scanner header + Group head — `position: static`. После 20-й строки тимлид теряет:

- К какой группе принадлежит текущая строка (group-head проскроллился)
- Колоночные заголовки (если бы были) — отсутствуют (см. находку #6)
- Quick-jump к началу (всегда scroll-to-top вручную)

Combine с paradigm modal-detail (находка #5): открыл строку → закрыл → roster пере-скроллится в начало (или сохранит scroll? нужно проверить, но subjective UX feel — потерял место).

**Зачем чинить:** длинные roster'ы (Сбер — это командой 30-80 человек точно) = primary use-case. Scroll fatigue убивает «утром 5 минут на стэндап» обещание.

**Как чинить:**

- **Sticky group-head** при scroll: `position: sticky; top: <scanner-header-height>` — текущая группа всегда видна сверху. CSS-only, ~3 строки.
- **Mini-roster sidebar** (опционально): vertical strip 8px wide × full-height с stripe-marks по группам (stop=red, watch=amber, moving=green, idle=grey). Клик на stripe → scroll к группе. Это **mini-map для roster'а**.
- **Scroll-restore at panel-close**: при закрытии modal'и (см. находку #5) **восстановить scroll position**, не reset.
- **Keyboard shortcut `g` → focus на «Требует внимания»** (jump-to-stop).

**Критичность:** medium
**Сложность:** low
**Ценность:** medium

---

### 19. Banner «Маленькая команда» / «Вся команда в idle» — uncalibrated severity

**Описание:** PersonRows.js:49-55 («маленькая команда < 5») и :57-62 («вся команда в idle») — два разных banner'а с разной severity (`info` icon vs `alert-triangle`), но рендерятся **в одинаковом контейнере** `.ts2-team-edge-banner` (с modifiers `-small` / `-idle`). По коду они **stacking** (могут оба сразу при `< 5 && all-idle`) — это валидный edge.

Проблема в hierarchy:

1. **Banner `<5`** — это **soft warning**, info-level. Содержание полезное (metrics статистически нестабильны), но severity-icon `info` (light-blue) делает banner таким же weight'ом как обычный hint.
2. **Banner all-idle** — это **hard alarm**: либо интеграции down, либо команда в отпуске. Severity-icon `alert-triangle` + **должен побуждать к диагностике**, но визуально — те же 12px padding × icon + text как для info-banner'а.
3. Оба banner'а **выше всех групп**, занимают ~50px каждый = ~100px при stacking. Это **30% above-fold real estate** при маленькой команде.

**Зачем чинить:** banner-system без weight-hierarchy = noise. Info-banner на маленькой команде = «информационный», пользователь учится игнорировать.

**Как чинить:**

- **Banner all-idle**: full-width red stripe-left 4px, текст «Команда в idle — проверь интеграции или статус отпусков. [Открыть Диагностику]» с **inline action-button**.
- **Banner < 5**: **inline** в группе header'ах, не отдельный block. Например, в «Требует внимания (1) — маленькая команда, медианы не показаны». Это меньше дёргает выше fold'а.
- **Stacking**: при both → объединять в один (`small + all-idle` = «маленькая idle-команда — проверь интеграции»).

**Критичность:** low
**Сложность:** low
**Ценность:** low

---

### 20. Assistant-section в panel — раскрывашка с LLM, но lazy без preview

**Описание:** `renderAssistantSection` (teamScanner2Renderer.js:1170-1190) — `<details>` collapse default, при раскрытии — fetch в GigaChat-2 (2 промпта параллельно: «Сводка 72ч» + «План/факт»). Placeholder: «Раскройте секцию, чтобы сгенерировать.» Hint: «генерируется GigaChat по данным интеграций · клик — запросить».

Проблемы UX:

1. **No preview** — пользователь не знает что внутри, пока не кликнет. Это **lottery affordance**: либо полезно, либо нет, выясняется после fetch latency (3-10 сек для LLM).
2. **«Клик — запросить»** — звучит как **action with cost**. Если тимлид это видит на 30 panel'ях за утро — он не будет кликать (cost > benefit unknown).
3. **Без cancel-button во время fetch** — если кликнул не туда, нельзя отменить. ~10 сек ожидание.
4. **Default collapsed** = **дефолтное скрытие** primary-AI-value предложения. Если AI-сводка полезна (а она в продукте specifically для этого), почему скрыта?

**Зачем чинить:** internal AI-tool с lazy-load + invisible default = «не используется» в большинстве сессий. ROI продукта (LLM cost vs adoption) низкий.

**Как чинить:** два варианта:

- **Auto-fetch on panel open** (если уже не в кэше). 3-10 сек loading-state, но пользователь видит что что-то происходит, и при открытии нескольких panel'ей подряд — последующие быстрее (cache hit).
- **Inline-preview**: показать **1-line summary** «работал над PROJ-201 и PROJ-205, в PR-ревью 2 чужих» прямо в narrative-section, без скрытия. Полные 2 промпта — за «Подробнее».

Также: **cancel-button** во время fetch (`AbortController` уже есть в коде, нужен UI), **retry-button** при error.

**Критичность:** low
**Сложность:** medium
**Ценность:** medium

---

## Cross-cutting observations

### Pattern: «добавили → не убрали → накопилось»

Кодовая база roster'а — слоистая по version-эпохам (V18.1 → V20 → V21 → V22 → V22+ Sprint A/B/C). Каждая итерация **добавляла сигналы** (badges, chips, ribbons, headers), очень редко **удаляла** (V21 удалила triage-pill, оставив логику; V22 убрала email-masking из display, оставив masking текст). В итоге roster — это **археологические слои** features:

- V18.1 → row badges (switches, dwell)
- V20 → CR / PR throughput chips, diff-arrow, triage-pill (удалена в V21)
- V21 → strip-labels, strip-empty fallback
- V22 → narrative-list, copy-button, CF/Z/J chips в panel
- V22+ → diff-pulse, mini-sparkline в panel header, row-tail в heatmap

Никто не делал **subtraction pass**. Это видно даже по структуре `// V18.1 P7-S4.5 → V20 S10.3 — srcChips переехали...` (PersonRows.js:259) — компромисс «куда положить» без **«нужно ли вообще»**.

**Рекомендация на 2 недели:**

Если бы мне дали 2 недели — провёл бы **«subtraction sprint»** с 3 deliverable'ми:

1. **Week 1 day 1-3** — measure: install Hotjar/Mixpanel на roster: **session recording 5 пилотов утром**. Метрики: average row-look-time, click rate per chip type, expand→close rate без действий. Это даст hard data какие chip'ы НИКОГДА не cause action.

2. **Week 1 day 4-5 → Week 2 day 1-3** — execute «3-tier subtraction»:
   - Tier 1 (всегда visible) = 4-5 atoms: ФИО, today-strip (8 buckets, не 24), primary-signal-pill (composite), key-metric (WIP·PR bullet), chevron
   - Tier 2 (on-hover, 80ms fade-in) = src-chips, secondary counters, yesterday-strip-as-delta-glyph
   - Tier 3 (panel) = всё что есть сейчас в panel
   - Параллельно — modal → slide-in 540px right paradigm revert (находка #5)
   - Tier 1 → table-header instead of per-row labels (находка #6)
   - Sort внутри групп по релевантному signal'у (находка #12)

3. **Week 2 day 4-5** — verify: те же 5 пилотов утром, повторить session recording. Измерить:
   - **decrease in row-look-time** (target: 8 → 3 сек)
   - **increase в actions per session** (target: open >5 panels на 30 команд)
   - **decrease в bounce из panel** (open → close без действия)

Целевой DoD: тимлид утром за 5 минут проходит **всю команду 30 человек**, открывает **5-7 deep-dive panel'ей** (vs current ~2), **успевает скопировать TG-summary** для одной 1:1. То есть **scanner становится action-tool**, а не «информационным дашбордом, который красиво выглядит на демо».

### Что НЕ нужно менять (good design)

- **Class system stop/watch/moving/idle** через `classifyPerson` — clean separation of concerns. WeakMap caching корректный.
- **Insights-pipeline** (composePersonNarrative, computeCrQueueDepth и т.д.) — backend хорошо отделён от render'а.
- **Sprint C6 row-tail micro-sparkline в heatmap** — Tufte-correct в принципе, но **target = wrong place** (heatmap уже dense). Эту же технику применить на main row → great.
- **`emptyDayLanguage` функция** — отлично: «Фокус на код-ревью» вместо «0 событий». Это редкий пример где UX-tone выровнен с product-language.
- **Triage logic (top-3 by maxDwell)** — нужная функция, просто **выключена из UI**. Включить как sort, не как pill (находка #12).

---

## Финал

Roster в текущем виде — **read-only data dashboard для специалиста**, не **action-tool для тимлида**. Если задача продукта — «тимлид утром принимает решения», layer-by-layer subtraction (3-tier modeling из находки #1 + paradigm change из находки #5) + sorting fix (находка #12) — это **необходимое условие** для попадания в use-case. Все остальные находки — детализация.
