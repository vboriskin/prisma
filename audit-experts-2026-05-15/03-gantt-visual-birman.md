# Илья Бирман — Гант: визуальный аудит

> Кто я: Илья Бирман, арт-директор Бюро Горбунова. Смотрю на типографику,
> цвет, иерархию, ритм. Без UX-исследований, без аналитики. Только то, что
> видит глаз.
>
> Что смотрел: `views/gantt.js` (renderer, 2924 строки), `views/gantt/aux.js`,
> `views/gantt/legendContent.js`, `views/ganttHtmlExport.js` (standalone-экспорт),
> `index.html` ll. 1228–1294 (toolbar Ганта), `styles.css` секции `.gantt-*` /
> `.gdt-*` / `.v16-*` (~3000+ строк только про Гант), `theme.css` (токены),
> `pz-design-system.css`, `docs/spine-pill.md`, `my_prisma-brand/BRAND_BOOK.md`.

## TL;DR

1. **Шкала размеров шрифта изломана: 9 / 9.5 / 10 / 10.5 / 11 / 12 / 12.5 / 13 / 14 / 16 / 24.** Половина — нечётные. Половина — половинки пикселя. Брендбук декларирует 11/13/15/18/24/32 — гант не соблюдает ни одно из этих чисел кроме 24px у backlog-rail. Это типографический бардак, и его видно сразу.
2. **Сетка шапок колодцев живёт по двум разным грамматикам в одной строке.** «1.20» — JetBrains Mono 16/800. «Бэклог» — JetBrains Mono 24/300. Один рельс, два голоса. У 1.20 — толстый стенограф, у Бэклога — тонкий миллиметровый — оба сидят рядом на расстоянии 200px. Это не «один rail feel», это «два rail в одну строку».
3. **Цветовая мешанина в шапке колонки.** Inset-top-border-information (синий) + inset-top-overtime (красный) + flow-in chip (синий) + flow-out chip (амбер) + today-pill (синий) + рельс-распределение (если включён). На 1 колонку — 5 каналов цвета конкурирующих между собой. Глазу не за что зацепиться.
4. **Pill — это не «3px stripe-left», это «3px stripe-left + 1px box-shadow ring + max-height clip + dashed-border-в-других-состояниях + bottom progress-bar + 7×7 marker».** Манифест V15 декларирует одну тонкую сигнальную полоску. Реальность — шесть параллельных каналов на одном объекте 110×30px. Spine сдох как идея до прихода в массы.
5. **Звукоподавление seven-fold: на одной задаче «не запланирована» сигнал дублируется 4 раза (dashed-stripe + dashed-circle + italic + opacity .72 + hollow-marker). На «done» — 3 раза (strikethrough name + opacity .68 + green checkmark + desaturated stripe).** Слишком громко для тихого сигнала.

---

## Critical — рушит читаемость

### C1. `gdt-rail-label` против `gdt-rail-label-backlog` — два шрифта на одной полке

`styles.css:1978–1994`

```css
.gantt-header-col .gdt-rail-label {
  font-family: var(--font-mono);
  font-size: 16px; font-weight: 800;     /* для 1.20 / 1.21 / 1.22 / OT */
  letter-spacing: .3px;
}
.gantt-header-col .gdt-rail-label-backlog {
  font-family: var(--font-mono);
  font-size: 24px; font-weight: 300;     /* для «Бэклог» */
}
```

Так нельзя. В одном рельсе одной линии не может быть **16/800 рядом с 24/300**. Они визуально воюют — толстый коренастый «1.20» и тонкий длинный «Бэклог» — будто из двух разных дизайн-систем. Комментарий в CSS:

> `Backlog label — V21 — приведено к sibling-style релизных rail-label'ов`

Не приведено. Размер другой, вес противоположный. Если хотели «outsider» — нужно прямо: одинаковый размер, но `text-transform: uppercase` + `letter-spacing: .12em` + `weight: 500` + цвет `--prizma-text-tertiary`. Сейчас — половина решения.

**Должно быть:** все пять заголовков колонок один размер, один вес. «Бэклог» — отличается только цветом (нейтральный) и/или регистром (CAPS).

### C2. Шкала шрифтовых размеров — хаос на полутонах

Найденные в Ганте размеры (grep по `font-size: \d+(\.\d+)?px`):

| px | Где |
|---|---|
| 9 | `.gantt-header-col[data-col="overtime"]::after` («вне релиза») |
| 9.5 | `.gdt-rail-flow`, `.gdt-rail-today`, `.gdt-pill-row-2`, `.gdt-pill-legend-demo-row2`, `.gdt-ctx-section-head` |
| 10 | `.gdt-pill-state`, `.v16-epic-meta`, `.gdt-rail-meta`, `.v16-team-bucket-label`, `.gdt-pill-legend-title`, `.gdt-trail-date`, `.gdt-trail-src`, `.audit-art-team-mono` |
| 10.5 | `body[data-gdt-density="compact"] .gantt-type-pill`, `.v16-epic-cat`, `.v16-epic-sub`, `.v16-epic-cat-empty` |
| 11 | `.gantt-bar`, `.gantt-row-label-sub`, `.gdt-pill-legend-demo-row1`, `.gantt-header-label`, `.v16-team-total`, `.gdt-trail-arrow`, `.gantt-legend`, `.gantt-no-assignee` |
| 12 | `.gantt-row-label`, `.v16-epic-name`, `.gantt-lock-badge`, `.gdt-pill-legend-toggle`, `.gantt-bucket-radio`, `.gantt-team-header-cell` |
| 12.5 | `.gdt-ctx-menu`, `.modal-text-muted` |
| 13 | `.gantt-team-header-cell` (вторая декларация на :6860), `.gdt-pill-legend-toggle-icon`, `.v16-team-bucket-count` |
| 14 | `.v16-team-name`, `.gdt-jump-input` |
| 16 | `.gdt-rail-label` |
| 24 | `.gdt-rail-label-backlog` |

**Одиннадцать размеров на одну вкладку.** Половина — на половинку пикселя. `9.5 / 10 / 10.5` — это не шкала, это набор файлов. Глаз видит «маленький / средний / большой» — а тут шесть «маленьких» с разницей в полпикселя.

Брендбук §4 (`my_prisma-brand/BRAND_BOOK.md:139–148`) явно декларирует:

```
Caption 11px / Body 13px / Subtitle 18px / Headline 32px
```

Гант использует ровно одно число из этой шкалы — 11. Всё остальное — отсебятина.

**Должно быть:** 10 (microcopy/CAPS) / 11 (meta) / 13 (body) / 16 (rail-label) / нет половинок. И не больше пяти размеров на весь экран.

### C3. `gdt-pill-row-2` — 9.5px серое — нечитаемо

`styles.css:2696–2703`

```css
.gdt-pill-row-2 {
  font-size: 9.5px; font-weight: 500;
  color: var(--text-3, #6b7280);
}
```

9.5px (!) serif-неподобный размер для **основной мета-информации**: «Иванов · 01.05—15.05». Это контекст, без которого pill не читается. И он спрятан на 9.5px на сером `--text-3`. На dark — `--prizma-text-secondary #8E8E96` на фоне `--prizma-bg-elevated #1A1A22` — ~5.4:1, проходит, но на грани. На light — `#7A7A82` на `#FFFFFF` ~4.3:1 — **не проходит WCAG AA для small text** (требование 4.5:1 на размере < 18px regular).

Тема light имеет `--prizma-text-secondary: #7A7A82` (`theme.css:77`) — на белом это 4.32:1 по контрасту. Меньше требуемых 4.5:1. На pill-фоне `--prizma-bg-elevated` (#FFFFFF) у вас формальный fail AA для текста, без которого пиллы не работают.

**Должно быть:** 10px минимум (целое число), цвет на pill — `--prizma-text-primary` с уменьшенной opacity (0.65) или прямо `--text-2` с проверкой контраста. Не 9.5.

### C4. Шапка колонки несёт 6 каналов сигнала параллельно

`views/gantt.js:1572` + `styles.css:2009–2080`

В одной шапке `.gantt-header-col` одной колонки (например 1.21) живут:

1. `gdt-rail-label` — текст «1.21» (mono 16/800)
2. `gdt-rail-meta` — «18 мая – 14 июня» (mono 10)
3. `gdt-rail-today` — «сегодня» (information-pill 9.5/700, синий)
4. `gdt-rail-flow-in` — «+5» (information-tinted chip, синий)
5. `gdt-rail-flow-out` — «−3» (drift-tinted chip, амбер)
6. `.gdt-rail-current` — `box-shadow: inset 0 2px 0 0 information` (синяя планка сверху)
7. (потенциально) `gdt-rail-dist` — мульти-цветный sparkline (сейчас `display:none`, но HTML рендерится)

И, если это OT — ещё `border-top: 2px solid off-course` + `::after` «вне релиза» 9px caps off-course red.

Семь параллельных каналов в области ~140×60px. Если меня просят «увидеть статус релиза одним взглядом» — мой взгляд бьётся о шесть конкурирующих визуальных объектов и не находит главный. Какой канал главный? Не понятно.

**Должно быть:** один главный канал — крупный mono-tabular release-tag. Один второй — диапазон дат. Всё остальное — либо в tooltip, либо одной нейтральной линией снизу. flow-in/out — не нужен в шапке, это data для дашборда. today-pill дублирует `gdt-rail-current` (inset-border) — оставьте одно.

### C5. «Pill» — не Spine, а ёлка

`styles.css:2557–2613` + `views/gantt.js:1336–1347`

В реальном пилле V21 одновременно живут:

```
border-left: 3px solid --pill-stripe          (Spine принцип №3)
box-shadow: 0 0 0 1px --prizma-border          (контур — 1px ring)
on hover: + inset 1px 0 0 --pill-stripe       (двойной stripe)
on focus-visible: outline: 2px solid info     (фокус-ring)
on drag: outline: 2px dashed information       (drag-ring)
+ gdt-pill-progress: 2px bottom-bar            (нижняя линия)
+ row-1 state-glyph: ●/✓/○/dashed-circle      (правый верх)
+ row-1 cmt-marker: 7×7 square / hollow        (правый верх №2)
+ row-2 meta:  ФИО · period                   (мета-строка)
+ if .gdt-pill-done: opacity .68 + strike       (затухание)
+ if .gdt-pill-unplanned: dashed-border + italic + opacity .72
```

Восемь визуальных каналов на объект ~110×30. Это **не** Spine-pill. Spine-pill — это ОДИН тонкий канал слева. Здесь — восемь.

Особенно дико: на «не запланирована» сигнал дублируется четыре раза (dashed left-stripe + dashed state-circle + italic name + opacity .72) + cmt-marker превращается в hollow-twin. Где остановиться?

```css
/* styles.css:7409 */
.gdt-pill-unplanned {
  opacity: .72;
  border-left-style: dashed !important;
}
.gdt-pill-unplanned .gdt-pill-name { font-style: italic; }
.gdt-pill-unplanned .gdt-pill-cmt-marker {
  background: transparent;
  border: 1.2px solid var(--cmt-color, #6b7280);
}
.gdt-pill-state-unplanned {
  border: 1.2px dashed currentColor;
  border-radius: 50%;
}
```

**Должно быть:** одно состояние = один канал. «Не запланирована» — только opacity .55 (всё остальное снять). «Done» — только strikethrough name (всё остальное снять). «In-progress» — только solid stripe-цвет (никакого progress-bar — это анимация процесса, не идентичность).

### C6. `box-shadow: 0 0 0 1px` поверх `border-left: 3px solid` — Spine с забором

`styles.css:2563–2580` (комментарий «Не нарушает no-border spine-pill philosophy (это shadow, не border)»)

Это самообман. Box-shadow визуально работает как border. Что я вижу — ёлочка-pill с 4-сторонним хайрлайном, у которого левая сторона ещё и 3px цветная. Это **очерченный card**, а не Spine-pill. Spine-pill принцип: один цветной канал на нейтральном фоне. Здесь — нейтральный фон + 4-сторонний контур + цветной канал = три канала, не один.

Если pill сливается с cell-фоном (как в Бэклоге) — это **признак того, что cell-фон выбран неправильно**, не оправдание контура. Закрасить cell `--prizma-bg-tertiary` (тёмнее на 1 ступень), и pill чисто сядет на свой `--prizma-bg-elevated` без какого-либо ring.

**Должно быть:** убрать `box-shadow: 0 0 0 1px var(--prizma-border)`. Если в каком-то сценарии pill сливается — менять фон cell, не добавлять контур.

### C7. Pluralization без mono-tabular в meta «N задач · M переносов»

`views/gantt.js:1183` + `styles.css:2360–2366`

```css
.v16-epic-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
```

Сама строка — mono. Хорошо. Но содержание — `${_totalWorks} ${pl(_totalWorks, TASK_FORMS)}${_moveCount ? ' · ' + _moveCount + ' ' + pl(...) : ''}`. То есть «**12 задач · 3 переноса**» / «**1 задача**» / «**7 задач · 11 переносов**». Слова разной длины → mono даёт ровные цифры, но окончание ломает выравнивание следующей колонки. Это не баг, но это типографически разваливает столбец «Эпик/Категория». Mono тут просит **только** цифровую часть.

**Должно быть:**

```html
<span class="meta-num">12</span> задач
       ↑ mono                ↑ proportional
```

Цифры — mono-tabular. Слова — обычный Inter/SF Pro. Тогда столбец `N работ` будет ровный по разрядам, а слова не будут торчать монохромным «12 задач» когда сверху «1 задача».

### C8. `--prizma-worktype-an: #8A8AA0` и `--prizma-worktype-ba: #9C8FA8` — близнецы

`theme.css:55–56`

На dark эти два цвета (analytics и BA) — серо-фиолетовые твины с разницей в hue ~10° и в lightness 1%. Глаз их не различит на 3px stripe-left. Если pill с `[data-wt="аналитика"]` соседствует с pill `[data-wt="бизнес аналитика"]` — пользователь не увидит разницы между двумя категориями работ.

Та же история на light: `#5A5A6E` vs `#6A5E78` — оба десатурированные нейтральные. Если цвет на 3px полоске должен **отличать** типы работ, цвета должны быть различимы. Здесь они теряются.

**Должно быть:** либо разнести AN/BA по hue минимум на 30° (один уйти в zinc-grey, другой в slate-blue), либо объединить их в один «analytical work» цвет.

### C9. `.gantt-team-header-cell` декларируется дважды с разным `font-size`

`styles.css:2312` — `font-size: 12px; font-weight: 700; color: var(--text-2)`
`styles.css:6860` — `font-size: 13px; font-weight: 700; color: var(--text-1)`

Двойная декларация одного селектора с разным `font-size` и `color`. Какая выигрывает — кастем (последняя). То есть фактически работает 13px. Первая — мёртвый код. Это типичный признак неконтролируемой эволюции стилей. На код-ревью такое — кричаще красный флаг.

---

## High

### H1. Toolbar `.section-header` бьёт 14 кнопок в одну строку

`index.html:1233–1283` — 14 контролов в одном `role="toolbar"` (без `flex-wrap` визуально). На узком экране (1280px минус sidebar 200px = 1080px рабочей ширины) кнопки уезжают за край. Кластеры PLAN | VIEW | NAV пытаются скомпенсировать через `topbar-divider data-cluster-label`, но визуально это не помогает: divider — это `aria-hidden span` 1px, метка `data-cluster-label="Вид"` не выводится.

**Должно быть:** показывать `data-cluster-label` хотя бы как CAPS sub-header над группой при overflow. Или схлопывать все NAV в один dropdown «Действия Ганта» с иконкой `more-horizontal`.

### H2. CAPS sub-headers с let-spacing `.4px` — разрозненная шкала

`styles.css:1963` — `.gantt-header-label` letter-spacing: .4px
`styles.css:2828` — `.gdt-pill-legend-title` letter-spacing: .6px
`styles.css:7456` — `.gdt-ctx-section-head` letter-spacing 0.06em (~0.84px при 14px-базе)
`styles.css:2780` — overtime «вне релиза» letter-spacing: .5px

Брендбук и docs/spine-pill.md §5 предписывают `.6-.7px` для CAPS sub-headers. Половина CAPS-блоков соблюдает, половина — нет. Это типографическая неряшливость.

**Должно быть:** один токен `--tracking-caps: 0.06em` (он уже есть в `styles.css:116`!) — применить везде. Не существует «letter-spacing на глаз» — это design-token.

### H3. `gdt-rail-today` — пилюля «сегодня» в шапке колодца

`styles.css:2009–2024`

```css
.gantt-header-col .gdt-rail-today {
  padding: 1px 7px;
  font-size: 9.5px; font-weight: 700;
  letter-spacing: .3px;
  text-transform: lowercase;
  border-radius: 999px;
}
```

— `font-size: 9.5px` (см. C2)
— `text-transform: lowercase` — единственное место в Ганте где CAPS обыграно как lowercase. Зачем? Это нарушает Spine принцип CAPS sub-headers и выглядит как ад-хок-юнвенция дизайнера-стажёра.
— `border-radius: 999px` — pill-форма с углом 999 для слова из 7 букв. На размере 9.5px толщина линии = меньше геометрии скругления. Это чрезмерно.

Плюс: `gdt-rail-current` уже даёт `inset 0 2px 0 0 information` — синюю планку сверху. И `gdt-rail-today` тоже синяя пилюля. **Двойная сигнализация одного состояния** «эта колонка — сейчас».

**Должно быть:** убрать `gdt-rail-today`-пилюлю. Оставить только `inset` синюю планку сверху. Если очень нужен явный «сегодня DD.MM» — поставить меткой между `rail-label` и `rail-meta` тем же текстовым весом, без pill-формы.

### H4. `gdt-pill-state-todo` — пустой кружок, glassed-twin

`styles.css:2635–2640`

```css
.gdt-pill-state-todo {
  width: 9px; height: 9px;
  border: 1.2px solid var(--pill-stripe, #6b7280);
  border-radius: 50%;
  background: transparent;
}
```

Размер 9px при border 1.2px = внутренний диаметр 6.6px. На retina это сглаженный мутный круг. Внутри pill высотой 32px стоит почти-невидимый кружок 9px. Зачем? «To Do» — это самое частое состояние, оно **по умолчанию**. Default-состояние не нуждается в видимом сигнале, оно **есть** само по себе. Когда сигналом помечена половина пиллов — он перестаёт быть сигналом.

**Должно быть:** на `todo` — никакого state-glyph. Glyph появляется только когда состояние ≠ default: ● in-progress, ✓ done, ⊘ unplanned. Это базовое правило сигнальной системы.

### H5. `gdt-pill-progress` — 2px полоска снизу — дублирует state-glyph «в работе»

`styles.css:2599–2607`

«В работе» уже сигналится через ● solid-circle state-glyph **в той же row-1**. Зачем ещё снизу 2px цветная полоска с прогрессом? Прогресс работ — это процентное число, его место в tooltip. На пилле 110×30 — 2px-линия с переменной шириной — это очень шумно, особенно когда таких пиллов в колонке 30 штук, и снизу каждой ползёт линия разной длины. Глаз цепляется не за state-glyph, а за «забор» из 30 разноразмерных hairline снизу.

**Должно быть:** убрать `gdt-pill-progress`. State-glyph + tooltip достаточны. Если очень хочется визуализировать прогресс — это отдельная density-mode «Timeline», не дополнение к Spine-pill.

### H6. Цвет `--prizma-worktype-hf: #C47A5C` (хотфикс) — слишком близко к `--prizma-drift: #FFB347`

`theme.css:60` vs `theme.css:36`

Hotfix-stripe (`#C47A5C`) и drift-сигнал (`#FFB347` — амбер «дрейф») — оба тёплые оранжево-коричневые, близкие по hue. У них разная функция: hotfix — тип работы, drift — статус курса. Когда они соседствуют (hotfix-pill в drift-tinted bucket), смысловые слои смешиваются.

Это конкретное нарушение брендбук-принципа §3 «Signal — только для статуса курса, никогда как декорация»: hotfix-decorative-цвет и drift-signal-цвет ходят парой и спорят.

**Должно быть:** hotfix-stripe увести в красно-фиолетовое (например `#A8506E`) или вообще присвоить hotfix цвет `--prizma-off-course` (он и есть offer-course по семантике, реально). Тогда оранжевый остаётся **только** за drift-signal.

### H7. `gantt-bar` (legacy) — 10px white на цвете — низкоконтрастный белый текст

`styles.css:2409–2413`

```css
.gantt-bar {
  height: 22px; ...
  font-size: 10px; font-weight: 600; color: #fff;
}
```

Существует ли он сейчас в реальном DOM — отдельный вопрос (grep по `class="gantt-bar"` без `-multi` ничего значимого не дал в renderer'е, кажется, мёртвый legacy). Но 10px белого на `--release-r122-color` (drift amber `#FFB347` на dark) даёт контраст ~3.4:1 — fail для small text. Если этот класс ещё рендерится где-то — это accessibility-баг.

**Должно быть:** проверить, рендерится ли `.gantt-bar` (без `-multi`) — если нет, удалить декларацию. Если да — переключить `color` на `--prizma-text-primary` (тёмный) и проверить WCAG.

### H8. `.gantt-legend` (внизу Ганта) — дублирует rail-legend наверху

`views/gantt.js:1579–1581` рендерит `<div class="gantt-legend">` с 5 dot+label парами «Бэклог / 1.20 / 1.21 / 1.22 / OT». А над Гантом уже есть `#gantt-pill-legend` с тем же содержанием в развёрнутом виде. И ещё `#gantt-legend-extra .view-legend` в `index.html:1292`. Три легенды на одну вкладку. Глаз не знает, какая авторитетная.

**Должно быть:** оставить одну — раскрываемую `#gantt-pill-legend` сверху (по кнопке «Как читать?»). Удалить `.gantt-legend` снизу и `.view-legend extra`.

### H9. Trail-row высотой 20px (или 16px в compact) с пилюлями опадает в нечитаемое

`styles.css:7320–7378`

```css
.gantt-row-trail { min-height: 20px; }
.gdt-trail-src, .gdt-trail-dst {
  font-size: 10px; padding: 2px 6px;
  background: var(--prizma-bg-tertiary);
}
.gdt-trail-arrow { font-size: 11px; }
.gdt-trail-date { font-size: 10px; }
```

— 10/11px текст в padding 2px = высота элемента ~16-18px на трейл-row 20px. Тесно. Если пиллы переноса должны быть «archive-look» — должна быть **отчётливая** иерархия: главный pill крупный, trail-pill заметно мельче. Сейчас разница 1px в font-size и 2px в padding — это **полутень**, а не иерархия. Trail-row сливается с main-row на 70% визуального веса.

— Стрелка `↗` / `↘` — Unicode-glyph 11px рядом с датой `12.04` 10px — два разных кегля рядом, разная baseline. Стрелочка тонкая, дата толстая. Визуальный mismatch.

**Должно быть:** trail-row высоту 16px твёрдо, текст 9px CAPS-стиль mono `--text-3`. Стрелка — глифом из Lucide (`arrow-up-right` / `arrow-down-right`) того же кегля, что текст. Не Unicode `↗`.

### H10. `audit-art-team-mono` — 2-буквенный chip с border, рядом с team-name

`views/gantt.js:105–119` (runtime style inject)

```css
.audit-art-team-mono {
  min-width: 22px; height: 18px;
  padding: 0 5px;
  font-size: 10px; font-weight: 700;
  letter-spacing: .6px;
  color: var(--prizma-text-secondary);
  background: transparent;
  border: 1px solid var(--prizma-border);
  border-radius: 4px;
  text-transform: uppercase;
}
```

Идея верна (identity ≠ color), исполнение — chip-в-chip. Внутри уже сделанного team-row (там слева 1px hairline rail + 14px gap + monogram-chip + 8px gap + team-name + count + sparkline + + button) — добавился ещё один «контейнер с границей». Шесть прямоугольников в одной строке слева направо. Это типографический шум.

**Должно быть:** monogram **без border, без background, без padding** — просто 10/700 caps с letter-spacing .8px цветом `--text-3`. Тогда `ПВ` стоит ровно перед `Платежи Веб` как часть подписи, а не как ещё одна сущность с гранью.

### H11. `gantt-team-vis-btn` (chevron) — 24×24 — больше самой team-row на compact-density

В compact-density `body[data-gdt-density="compact"] .gantt-team-header.v16-team-row { min-height: 36px }`. Сам chevron — 24×24. То есть chevron занимает 67% высоты строки. На minimal — `min-height: 28px` — chevron уже 86% строки. Это много.

**Должно быть:** chevron вписан в `(min-height − 8px) × (min-height − 8px)`. При compact = 24×24 OK, при minimal должен ужиматься до 18×18. Сейчас он жёстко 24×24 (комментарий «V21 — 18→24px для тач-минимума WCAG 2.5.5 AA») — это конфликт между тач-target и плотностью.

### H12. `gantt-team-header` стили — три параллельных декларации

— `styles.css:2308–2316` — `.gantt-team-header { background: --surface-header; border-bottom: 1px solid --border; }`
— `styles.css:6859–6860` — `.gantt-team-header { background: var(--prizma-information-bg); border-bottom: 2px solid var(--prizma-information-bg); }`
— `styles.css:7119–7120` — `.gantt-team-header { background: var(--prizma-bg-tertiary); border-left: 3px solid var(--prizma-information); }`
— `styles.css:7130–7146` — `.gantt-team-header.v16-team-row { background: var(--prizma-bg-tertiary); border-left: 0; }`

Четыре каскадных правила на один класс. Каждое перебивает предыдущее. Финальный результат непонятен без рендеринга. **Это не CSS, это палимпсест.**

**Должно быть:** одно правило, явная декларация. Старые удалить.

---

## Medium

### M1. `--font-mono` дублируется в `:root` — 2 раза

`styles.css:96` — `--font-mono: ui-monospace, monospace;`
`styles.css:121` — `--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;`

Второе перебивает первое. Первое — мёртвый код, виден через VSCode при чтении (вводит в заблуждение).

### M2. `body { font-feature-settings: "tnum" 1, "lnum" 1; font-variant-numeric: tabular-nums lining-nums; }` — глобально на всё

`styles.css:244–252`

Декларация tabular-nums применена ко **всему body**. Это значит mono-tabular везде, включая контекстный текст «Перенесено отсюда: ↗ 12.04», где сейчас числа выровнены, а текст вокруг — нет. Текст становится «ровненький по цифрам, прыгающий по буквам». На больших объёмах это утомляет глаз. Tabular-nums нужен **в столбцах сравнимых чисел** (KPI, table cells, dates стек), не в проз-тексте.

**Должно быть:** убрать с `body`, поставить точечно на `.gantt-cell .gdt-pill-meta`, `.v16-team-bucket-count`, `.gdt-rail-meta`, `.v16-epic-meta`. Везде, где числа сравниваются вертикально.

### M3. `--release-r120-color` = `--prizma-information` — синий. `--release-r121` = `--prizma-on-course` — зелёный. `--release-r122` = `--prizma-drift` — амбер. `--release-ot` = `--prizma-off-course` — красный.

`styles.css:208–212`

То есть **порядок релизов закодирован в семантические сигналы**: первый — синий («Information»), второй — зелёный («OK»), третий — амбер («дрейф»), последний — красный («off-course»). Это **смысловой клин**: «1.22» закрашен амбером, как будто релиз сам по себе «в дрейфе». Хотя релиз — это просто временной слот.

Брендбук §3.: «Signal-цвета используются только для статуса курса, никогда как декорация». Здесь signal используется как **идентификатор временного слота**, что разрушает signal-семантику: когда я в дашборде увижу пилюлю в амбере, я уже не знаю, это «дрейф» или «релиз 1.22».

**Должно быть:** release-tints — нейтральные градации серого / нейтрального tertiary с разной opacity (например 4% / 8% / 12% / 16% от `--prizma-text-tertiary`). А signal-цвета остаются за состоянием задач (done/at-risk/blocked), не за бакетами.

### M4. `.gantt-window-r120` (background для всей колонки) — `var(--prizma-information-bg)` = rgba(110, 193, 228, 0.12)

`styles.css:2724`

Колонка 1.20 целиком закрашена бледно-синим, колонка 1.21 — бледно-зелёным, 1.22 — бледно-амбером. На dark выглядит как разноцветные полосы. Это **тяжёлая визуальная нагрузка**: при горизонтальном скролле ваш экран всегда полосат, и каждая полоса конкурирует с пиллами внутри неё. В Линеаре, Жире, Notion-Timeline — колонки нейтральные, акцент — на пиллах. Здесь акцент рассеян по всей плоскости.

**Должно быть:** колонки — нейтральные `--prizma-bg`. Только разделитель `border-right` (уже есть). Пиллы — единственный носитель цвета.

### M5. Density-mode «minimal» (22px) теряет читаемость pill name

`styles.css:2106–2116`

```css
body[data-gdt-density="minimal"] {
  --gdt-row-h: 22px;
}
body[data-gdt-density="minimal"] .gantt-type-pill {
  padding: 2px 5px 2px 4px;
  font-size: 10px;
}
```

22px row высота. Pill — 10px font в 2px×2px padding = ~14px высоты. Внутри — `.gdt-pill-name` truncate до 18 символов + state-glyph 12×12 + cmt-marker 7×7. На 110px ширины колонки умещается ~14 символов name + glyph. То есть `BE-аналитик…` обрезается, и пользователь видит много обрезанных pills без assignee/period (они скрыты). Зачем эта плотность вообще нужна? Чтобы видеть «много задач», но не видеть содержимое каждой. Это полу-функция.

**Должно быть:** minimal-density должен показывать **только** stripe-color и компактный counter, как в Overview-mode. Минимум 22px не для name+glyph+marker, а для «8 цветных полосок в строке».

### M6. `.gantt-cell:hover { max-height: 320px; box-shadow: 0 4px 14px rgba(17,24,39,.08); }`

`styles.css:2408`

При hover ячейка вырастает до 320px **с тенью**, перекрывая соседние строки. Это inline-expander с shadow, что нарушает clean-geometry брандбука. На быстром mousemove по таблице — ячейки скачут вверх-вниз, тени мерцают. Шум.

**Должно быть:** разворачивать содержимое в popover/tooltip, не в самой ячейке. Или хотя бы — раскрытие на click, не на hover. Hover-grow на 22px row → 320px row = в 14 раз.

### M7. `.gdt-pill-cmt-marker` — 7×7 square с border-radius 1.5px

`styles.css:2673–2685`

Семь пикселей на восемь с скруглением 1.5. Внутри — нет содержимого. Это **точка в углу пилюли**. На retina при определённых параметрах это 14×14 физических пикселей, при low-DPI — 7×7. На 7×7 пикселях `border-radius: 1.5px` визуально неотличимо от `border-radius: 0`. Если хотите square — пусть будет square, не квадрат-в-полрадиуса.

— И `hollow-twin` версия — 8×8 с 1.2px border. Внутренний диаметр 5.6px — буквально точка с дыркой. На физическом 0.5x DPI — пятно.

**Должно быть:** просто 6×6 квадрат без border-radius (или 8×8 если хотите хайлайт). Hollow-twin не нужен — opacity на родителе уже погасит marker.

### M8. `.gantt-pill-ghost` и `.gdt-trail-src/-dst` — два разных «archive» стиля

`styles.css:2422–2431` vs `styles.css:7358–7378`

```css
.gantt-pill-ghost {
  background: transparent !important;
  border: 1px dashed currentColor !important;
  color: var(--text-3) !important;
  opacity: .85;
  font-style: italic;
}
.gdt-trail-src, .gdt-trail-dst {
  background: var(--prizma-bg-tertiary);
  border: 0;
  color: var(--pill-stripe, var(--prizma-text-secondary, #6b7280));
}
```

Два конкурирующих визуальных языка для «archive-pill» (одна с dashed-border + italic + opacity, другая — tinted background без border). Используются вместе на одном элементе в trail-row (`class="gantt-type-pill gantt-pill-ghost gdt-trail-src"`). То есть на trail-pill применяются **оба** стиля каскадом. Финальный вид — компромисс между ними. Это типичная legacy-эволюция: ввели V21 новый стиль, не удалили старый.

**Должно быть:** один из них удалить (V21-комментарий говорит, что dashed-border сошёл с дистанции — значит, `.gantt-pill-ghost` нужно удалить или сильно ограничить). Сейчас оба активны и борются за приоритет.

### M9. Backlog «+» кнопка `gdt-add-type-btn`

`views/gantt.js:1372`: `<button class="gdt-add-type-btn" data-row-id="…" title="Добавить тип задачи">+</button>`

Не нашёл стилей класса в проинспектированных секциях — значит, базовые `button` стили. Это значит на каждой строке Бэклога — голая кнопка «+» без визуального якоря. На 100 строках Бэклога — 100 одинаковых маленьких «+». Шум.

**Должно быть:** показывать «+» только на hover-row (через `.gantt-row:hover .gdt-add-type-btn { opacity: 1 }`). По умолчанию — opacity 0. Это уберёт 99% «+» с экрана и сохранит функцию.

### M10. Modal `.gantt-bucket-radio` — radio-chips с `border-radius: 4px`

`styles.css:2514–2520`

```css
.gantt-bucket-radio {
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
}
```

— `padding: 5px 10px` — нечётные. Брендбук 4/8 grid. Должно быть `4px 8px` или `6px 12px`.
— `border-radius: 4px` — на 32px высоте элемента это `--radius-xs`. У вас есть токен `--radius-sm: 8px` для chip-форм. Здесь используется радиус для button-controls.

**Должно быть:** padding `6px 12px`, radius `var(--radius-sm)`.

---

## Low — придирки

### L1. `gdt-trail-arrow` `font-weight: 500` — после `font-weight: 700` в legacy

`styles.css:7382` — комментарий `/* V21 — 11/700 → 11/500. */`. ОК, рефактор был. Но `↗` и `↘` Unicode на 500 — выглядят особенно тонко. На retina они почти пропадают. Стрелка-сигнал должна быть полужирной (или Lucide-иконкой).

### L2. `gantt-no-assignee` — `color: var(--warning); font-size: 11px; font-weight: 700;`

`styles.css:7043`

«!» в углу — drift-цвет, 11/700. На pill 110px — это якорь, к которому уходит взгляд. Если задача без assignee — это нормально на ранней стадии планирования. Поднимать это сигналом «warning» с 700 весом — паника без повода.

**Должно быть:** opacity .55 + `--text-3` (нейтральный), не амбер сигнал.

### L3. `gdt-pill-state-done` `border-radius: 50%` — кружок 12×12 с белой галочкой

`styles.css:2650–2657` + override §E12 на mask-image

Галочка через SVG mask-image на 12×12 круге зелёного цвета. Если в pill name strikethrough + opacity .68 — кружок становится третьим сигналом «done». Слишком.

### L4. `.gantt-pill-flying` — flight-animation с `filter: drop-shadow(0 4px 10px rgba(79,70,229,.45))`

`styles.css:2454–2458`

`drop-shadow` с фиолетовой 45% opacity тенью — выглядит как «магия». Особенно на 700ms продолжительности. Брендбук-motion §9 не предписывает spring-anim для drag-and-drop. Тень должна быть нейтральная `rgba(0,0,0,.3)`, не accent.

### L5. `.gantt-lock-badge` — `border-left: 3px solid var(--prizma-drift)` — Spine, good

`styles.css:2490–2502` — единственное место, где Spine-pill применён ремесленно правильно. Левая 3px stripe, нейтральный фон, нейтральный текст. Это эталон, на который надо равнять остальное.

### L6. `.v16-team-spark` — sparkline 5 баров, фон `rgba(127,127,127,.06)`

`styles.css:7181–7200`

Декорация работает: 5 серых баров одинаковой ширины 4px. Но runtime-override `audit-art-gantt-style` сделал все 5 баров одинаковым `--prizma-text-tertiary` (см. `views/gantt.js:124–136`). Это значит, sparkline теперь показывает **только высоту**, не цвет. На дистанции — 5 одинаково-серых столбиков. Глаз не различает, какой бакет — какой. Sparkline без визуального якоря по X — превращается в просто barchart без оси.

**Должно быть:** оставить цвет release-токенов **только** на activeBuckets, остальные — `--text-4` (15-20% opacity). Или вообще убрать sparkline — он дублирует bucket-counts справа.

### L7. `gdt-overview-bar` — 4-сегментный stacked bar в overview-mode

`styles.css:6971–7000`

Кричит цветами work-type-палитры — 9 цветов на одну строку. На overview-mode из 50 команд получаем 50×9=450 цветовых сегментов на экран. Это техноимпрессионизм, не дата-визуализация.

**Должно быть:** в overview оставить максимум 3-4 цвета (топ-3 work-types + «прочее» серым).

### L8. `.gdt-ctx-menu` — `box-shadow: 0 12px 32px rgba(0,0,0,.18); border-radius: 10px`

`styles.css:7420–7431`

10px — нет в шкале радиусов (4/8/12/16). Должно быть 12 (`--radius`). 0.18 opacity тени — больше, чем у модала pz-modal (0.20 на 24px). Меню становится heavier чем сам модал.

### L9. `body[data-gdt-mode="overview"] #btn-gantt-mode` — стилизуется как active

`styles.css:7011–7016`

Кнопка переключения режима в active-state — но я не нашёл, как это выглядит. Скорее всего, accent-bg или accent-stripe. Если accent-bg — нарушает Spine принцип №3 (не filled).

### L10. JetBrains Mono — отсутствует self-hosted

`styles.css:121` объявляет `'JetBrains Mono'` как первый в стэке, но `--font` (`styles.css:132`) явно НЕ грузит её через `@font-face`. То есть на машинах без JBM локально установленной — fallback на `ui-monospace`. Это значит, что на 95% корп-машин дизайн **выглядит не так, как задумано**: цифры в SF Mono / Segoe UI Mono, не JBM. Брендбук §4 декларирует JBM как Secondary шрифт — формально нарушено.

**Должно быть:** либо self-host JBM в `/libs/fonts/` (брендбук это допускает), либо убрать декларацию JBM, оставив только `ui-monospace`. Не вешать имя, которое не загружается.

### L11. `.gdt-pill-progress border-radius: 0 1px 1px 0` — на 2px высоте

`styles.css:2599–2607`

1px скругление на элементе 2px высоты — не видно. Лишний код.

### L12. `gantt-header-col[data-col="overtime"]::after` — `'вне релиза'` (9px CAPS)

`styles.css:2774–2784`

Содержимое injected через CSS — `content: 'вне релиза'`. На light: hardcoded ru-RU. Если когда-то будет i18n — этот текст не будет в js-source. Это типичный CSS-anti-pattern.

---

## Брендбук-консистентность

Брендбук §3 «Палитра» декларирует пропорции **60/20/15/5**: 60% фон, 20% карты, 15% текст, **5% сигнальные цвета**. Что я вижу в Ганте:

**Сигнальные цвета используются:**
- Pill stripe (9 work-types через `--prizma-worktype-*`) — 100% активных pills имеют цветную stripe
- Cell background tint (`r120/r121/r122/ot` через signal-tokens) — 80% площади экрана покрыто цветным tint
- State-glyph (information / on-course / off-course)
- Cmt-marker (drift / information)
- flow-in / flow-out chip (information / drift)
- today-pill (information)
- rail-current (information inset-top)
- Sparkline overload (off-course)
- Epic left-stripe (work-type)
- Team rail (1px text-tertiary — единственное место, где приведено к норме после AUDIT-ART #12)

Итого: ~50-60% площади экрана несёт сигнальный цвет. Это **в 10 раз больше**, чем декларирует брендбук. Спайн-принцип «accent — semantic only» сорван не точечно, а массово.

**Spine-pill принципы (`docs/spine-pill.md`) и их соблюдение в Ганте:**

| Принцип | Состояние |
|---|---|
| 1. Без эмодзи | ✓ Соблюдено (V21 wave-3 убрала emoji prefixes). Единственное место — `gdt-pill-legend-state-done` `✓` glyph, но через mask-image, не emoji. |
| 2. Без gradients | ✓ Не нашёл явных gradient на surfaces. (`repeating-linear-gradient` на OT hatching — это паттерн, не gradient в смысле декорации, ok.) |
| 3. 3px stripe-left | ✗ Нарушено. Pill имеет 3px stripe-left **+ 1px box-shadow ring + dashed-border-в-других-состояниях**. См. C5/C6. |
| 4. Mono-tabular numerals | ✓✗ Частично. Глобально через `body` (M2 — перебор). На pill row-2 — mono есть, но через `.gdt-pill-meta` отдельно. Не точечно. |
| 5. CAPS sub-headers 9-10/.6-.7 | ✗ Нарушено. См. H2 — letter-spacing скачет .3/.4/.5/.6. |
| 6. SVG icons вместо emoji | ✓✗ Lucide везде, **но**: trail-row использует Unicode `↗/↘` (`views/gantt.js:1476, 1486`), что — старый эмодзи-стайл. Должно быть Lucide `arrow-up-right`. |
| 7. Color только для семантики | ✗ Жёстко нарушено. Release-cells покрашены сигнальными цветами (information/on-course/drift/off-course) как чисто-декоративные. См. M3/M4. |
| 8. Spacing на 4/8 grid | ✗ `padding: 5px 10px / 4px 7px 4px 6px / 2px 6px 4px 6px / 1px 7px / 2px 4px / 3px 5px` — в Ганте десятки нечётных значений. |
| 9. Inline-style → CSS-prop | ✓ В основном (AUDIT_HOLISTIC O10). Остатки в SVG-arrows и `_epicStripeColor` через `style="background:${color}"`. |

**Брендбук §4 Типографика:**

Декларирует шкалу: 11 (Caption) / 13 (BodySmall) / 15 (Body) / 18 (Subtitle) / 24 (MonoNumber). Гант использует 11 (есть), 13 (есть), 24 (только Backlog). **15 и 18 отсутствуют целиком.** Вместо этого 16 (rail-label), 14 (team-name), 12.5, 12, 10.5, 10, 9.5, 9 — никакого из этого нет в брендбуке.

---

## Что я бы сделал

В порядке убывания удара по виду — что **конкретно** надо сделать на этой неделе.

### 1. Зафиксировать шкалу шрифтов в 5 размерах

```
10 — CAPS sub-headers, microcopy
11 — meta (period, ФИО, counts)
13 — body (pill name, team-name, label-name)
16 — rail-label
24 — backlog-rail-label (если хотим outsider)
```

Удалить из styles.css все 9 / 9.5 / 10.5 / 12 / 12.5 / 14. Минимум по 30 правок, но это вычистка визуального шума на 40%.

### 2. Удалить `box-shadow: 0 0 0 1px` с pill

`styles.css:2580` — снять. Pill `border-left: 3px solid stripe` на нейтральном фоне = чистый Spine. Если pill сливается с cell — перекрасить cell-фон (`--prizma-bg` нейтрально-чёрный/белый, без release-tint).

### 3. Удалить release-tint с cells

`styles.css:2723–2726, 4613–4616` — убрать `.gantt-window-r120/r121/r122 { background: information-bg/on-course-bg/drift-bg }`. Колонки — нейтральный `--prizma-bg`. Только vertical divider справа.

Это **главная** правка. Сразу убирает 60% цветового шума с экрана. Signal-цвета возвращаются в роль signal: pill-stripe и state-glyph.

### 4. Снять дубли сигналов с pill-states

— `.gdt-pill-unplanned`: оставить только `opacity: .55`. Снять dashed-border, italic, hollow-marker-cascade.
— `.gdt-pill-done`: оставить только `text-decoration: line-through` на name + `opacity: .68`. Снять green-circle-glyph (избыточно).
— `.gdt-pill-state-todo`: убрать вообще (default не нуждается в glyph).
— `.gdt-pill-progress`: убрать (прогресс — в tooltip).

После этого pill имеет один сигнал на один смысл. Spine как было задумано.

### 5. Унифицировать `letter-spacing` для CAPS через `--tracking-caps`

Один find-and-replace: все `letter-spacing: 0.3px / 0.4px / 0.5px / 0.6px / 0.7px` в caps-блоках → `letter-spacing: var(--tracking-caps)`. Токен уже определён, его надо просто **использовать**.

### 6. Schliff на «сегодня» и «сегодня DD.MM»

Удалить `gdt-rail-today` pill (`styles.css:2009–2024`). Оставить **только** `gdt-rail-current { box-shadow: inset 0 2px 0 0 information }`. Дата `DD.MM` — она уже в `gdt-rail-meta` чуть выше. Сигнализация выполнена одним каналом, не двумя.

### 7. Trail-row → одна линия 14px highlight-серым

Сделать trail-row реально вторичной: высота 14px, фон тот же что main-row (без `rgba .025` tint), padding-left 30px остаётся. Pills вообще убрать, заменить на текстовую строку «`↗ 12.04 → 1.21`» (Lucide-arrow + mono-date + label). Без chip-формы. Так trail читается как «лог», а не как «ещё одна задача».

### 8. Removed: `.gantt-legend` snizu + `.view-legend` extra

`views/gantt.js:1579–1581` + `index.html:1292` — убрать. Одна легенда — `#gantt-pill-legend` сверху. Триггер — кнопка «Как читать?» в toolbar.

### 9. JetBrains Mono — self-host или удалить из стэка

В брендбуке заявлена. Если нужна — self-host (`/libs/fonts/JetBrainsMono-Regular.woff2` + Bold). Если не нужна — убрать имя из `--font-mono`, оставить `ui-monospace`.

### 10. Cells — `min-width: 0` уже стоит, но добавить `padding: 4px 8px` (а не `4px 6px`)

`styles.css:2387–2404`. Перевести на 4/8 grid. После переключения цвета колонок на нейтральные — pillы выходят на передний план, и нужны ритмичные отступы (8px минимум между pill и краем cell).

---

## Идеи для killer-visual

Что бы я сделал, если бы мне дали 2 дня и просили «сделать красиво». Ремесленно, без революции.

### Идея 1. Mono-tabular numerals — **только** на чи́слах, а не глобально

Снять `font-feature-settings: "tnum"` с `body`. Добавить **точечно**:

```css
.gdt-pill-meta { font-variant-numeric: tabular-nums; }
.v16-team-bucket-count { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.gdt-rail-meta { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.gdt-rail-label { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.gdt-trail-date { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
.v16-epic-meta .num { font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
```

В renderer'е обернуть числовые части в `<span class="num">`:

```js
`<span class="num">${_totalWorks}</span> ${pl(_totalWorks, TASK_FORMS)}${
  _moveCount ? ' · <span class="num">' + _moveCount + '</span> ' + pl(...) : ''
}`
```

Эффект: числа выровнены по колонкам, слова — натуральные proportional Inter. Это **классический** ремесленный приём типографики.

### Идея 2. «Раз-два-три» сетка ритма по 8px

В Ганте сейчас padding нечётные (5/7/9/11). Сделать жёсткую 8px-сетку:

- Pill padding: `4px 8px 4px 8px` (вместо `4px 7px 4px 6px`)
- Cell padding: `4px 8px` (вместо `4px 6px`)
- Pill gap: `4px` (вместо `2px`)
- Row min-height: 40/32/24px (вместо 40/30/22)
- Team-header min-height: 48/40/32px (вместо 44/36/28)
- Trail-row: 16px (вместо 20)
- gap между state-glyph и name: `8px` (вместо `4px`)

Ритм 8/16/24/32/40 — глаз ловит его подсознательно как «спокойный». Текущая 5/7/9/11/13 — глаз нервничает как от джаза. Это самое простое и самое эффективное «сделать красиво» — переключить spacing на 8-grid.

### Идея 3. Эпик-stripe — не цветной, а текстовый identity

`v16-epic-stripe` сейчас — 2px полоска цвета доминирующего work-type. Это шум: цвет полоски не несёт нового смысла (типы работ уже видны в пиллах справа).

Заменить на: monogram эпика (две первые буквы названия эпика, нейтральный grey, CAPS, 9/700) **перед** именем эпика. Например, эпик «Платёжная форма» → `ПФ Платёжная форма`. Цвет не нужен — monogram говорит «это identity-маркер».

В реестре, в дашборде, в bandgap — тот же monogram. Глаз учится связывать эпик с его двумя буквами. На скриншоте начальство, увидев `ПФ`, сразу понимает «это про Платёжную форму». Цвет не несёт identity.

### Идея 4. «Бэклог» — другая зона, не колонка

Бэклог сейчас — первая колонка. Это значит, он соревнуется по площади с релизами. Но 90% задач в бэклоге — пока не релевантны для просмотра «когда они придут».

Сделать Бэклог **выдвижной панелью слева**, как drawer. По умолчанию схлопнут до 40px (только counter + iconBubble «120»). По клику — выезжает на 280px, показывает pillы. Так Гант **визуально становится релиз-таймлайном**, не «свалка + таймлайн». Это resolves проблему C1 (два разных rail-label стиля): backlog не на одной полке с релизами, у него своя.

### Идея 5. Pill row-2 (meta) — отдельная типографическая зона

Сейчас row-2 — это `9.5px serif-весом 500 серый цвет` (см. C3 — fail AA). Заменить на:

```css
.gdt-pill-row-2 {
  font-family: var(--font-mono);    /* mono для технического flavour */
  font-size: 10px;
  font-weight: 400;                 /* light — нюанс vs row-1 */
  color: var(--prizma-text-tertiary);
  letter-spacing: 0.04em;            /* чуть разогнать — mono dense иначе */
}
```

Эффект: row-1 — Inter 13 medium (имя задачи, человеческое чтение). Row-2 — mono 10 light (дата + ФИО, технические данные). Две **разные типографические грамматики** на одной пилле — это и есть Spine. Сейчас обе строки proportional 11 / 9.5 medium — одна грамматика, разные кегли.

### Идея 6. Today-indicator — горизонтальная линия через ВЕСЬ гант, а не пилюля в шапке

`gdt-rail-current` сейчас даёт inset-border-top только на одной колонке. Это значит «эта колонка — сегодня».

Заменить на: вертикальную пунктирную линию `border-left: 1px dashed information` на ширине ровно в 2px, position absolute через всю высоту Ганта, на координате где сегодняшняя дата внутри колонки. То есть линия **точно где сегодня**, не «эта колонка вся сегодня». Это правильное решение для timeline-визуализации (см. Linear, GitHub Roadmap).

```js
// в renderer'e:
const today = new Date();
const r121Start = new Date('2026-05-18');
const r121End   = new Date('2026-06-14');
if (today >= r121Start && today <= r121End) {
  const dayInWindow = (today - r121Start) / (1000 * 60 * 60 * 24);
  const totalDays   = (r121End - r121Start) / (1000 * 60 * 60 * 24);
  const positionPct = dayInWindow / totalDays;
  // <div class="gantt-today-marker" style="--pos: 32%"></div>
}
```

```css
.gantt-today-marker {
  position: absolute; top: 0; bottom: 0;
  left: calc(/* column offset */ + var(--pos) * var(--column-width));
  border-left: 1px dashed var(--prizma-information);
  z-index: 6;
  pointer-events: none;
}
```

Один сигнальный канал — линия через ВЕСЬ Гант — заменяет три текущих (`gdt-rail-today`-pill + `gdt-rail-current`-inset + `gdt-rail-meta` дата). И визуально гораздо красивее.

### Идея 7. Печать / Экспорт — `@media print` отсутствует

В `ganttHtmlExport.js` нет `@page` правил и нет `@media print`. То есть распечатанный экспорт — это сжатый-под-А4 веб-вью, без оптимизации. Hue-токены, тени, dark-фоны идут в принтер.

Добавить:

```css
@media print {
  body { background: white !important; color: black !important; }
  .gex-card, .gex-legend, .gex-page-header { box-shadow: none !important; }
  .gantt-window-r120, .gantt-window-r121, .gantt-window-r122, .gantt-window-overtime {
    background: white !important;
  }
  .gantt-type-pill {
    background: white !important;
    color: black !important;
    border: 1px solid #ccc !important;
    box-shadow: none !important;
    page-break-inside: avoid;
  }
  .gantt-row { page-break-inside: avoid; }
  .gantt-header-col { font-size: 9pt; }
  .gdt-pill-name { font-size: 8pt; }
}
@page { margin: 1.5cm; size: A3 landscape; }
```

A3 landscape — Гант на A4 не помещается без обрезания. На А3 один лист — один квартал команды (5 колодцев × 8-12 эпиков). Это **полностью меняет качество** PDF-выгрузки на peer-review совещаниях.

### Идея 8. Pill-shape — менять `border-radius` по плотности

Сейчас pill всегда `border-radius: var(--radius, 12px)` (что есть 12 на компактном элементе 110×30 — много для 30px высоты). При regular density радиус должен быть `8`. При compact — `6`. При minimal — `4`. Чем плотнее, тем геометричнее.

```css
.gantt-type-pill { border-radius: 8px; }
body[data-gdt-density="compact"] .gantt-type-pill { border-radius: 6px; }
body[data-gdt-density="minimal"] .gantt-type-pill { border-radius: 4px; }
```

Это даёт **разные ощущения** трёх плотностей: regular «комфортно», compact «дельно», minimal «технически». Сейчас все три плотности — одинаковые `radius: 12px` — отличаются только высотой. Это не три режима, а один с тремя гайтами.

---

**Итог.**

Гант страдает не от одного крупного дефекта, а от **накопленного гипертекста**. 11 размеров шрифта, 4 декларации одного селектора, 8 сигнальных каналов на пилле, 6 — в шапке колонки, 5 цветовых tint на колонках, 3 легенды, 2 разные грамматики rail-label. Каждое отдельное добавление было обосновано, в сумме — визуальная свалка.

Spine-pill как идея — гениальная. Реализация Spine-pill в этой кодовой базе — её отрицание: тонкая полоска слева утонула в шести параллельных каналах.

Решение — не редизайн. Решение — **вычистка**. Снять половину сигналов, оставшимся — дать дышать. Шкала шрифтов в 5 размеров. Шкала spacing на 8. Сигнал — только за статусом, не за идентификатором. Pill — одна полоска слева, точка glyph в правом верху, две строки текста — и больше ничего. Колонки — нейтральные. Today — одна вертикальная линия.

Гант станет в три раза чище. И это — настоящая Призма.
