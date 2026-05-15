# Erica Heinz — Сканнер команд: data-viz аудит

> **Кто я.** Erica Heinz. 10+ лет dense-information dashboards: Tableau staff, потом
> Looker, последние шесть лет — независимый консультант для команд, у которых
> «график есть, но решение не приходит». Любимые книги — Tufte «Visual Display»,
> Cleveland «Elements of Graphing Data», Bertin «Sémiologie graphique», Few
> «Information Dashboard Design». Не люблю «цвет ради цвета» и chart-junk.
>
> **Что смотрела.** Только data-viz слой Сканнера 2.0: heatmap 72×4(5), dot-strip
> «Сегодня/Вчера», sparkline 14 дней, anomaly-mini-chart, burnup, sprint-gauge bar,
> velocity-bars, sankey зависимостей, anomaly-badges (`4×`/`−30%`), R²-маркеры,
> цветовые шкалы, density encoding, форматирование чисел, легенды.
>
> **Что НЕ смотрела.** Информационная архитектура, UX-flow, copywriting, навигация,
> drill-down правильность. Если виджет «не на месте» с точки зрения тимлида — это
> не ко мне, это к Anna PO / Дмитрию UX. Я отвечаю на один вопрос: «когда
> пользователь смотрит на виджет, делает ли он правильный read».

---

## TL;DR

1. **Heatmap 72×n путает категориальное кодирование с интенсивностью.** Один цвет
   на источник (J=blue, B=green, …) перемножается с непрерывной `opacity 0.1→1.0`
   как proxy для «количество событий». В терминологии Bertin это смешение двух
   разных каналов (`hue` для номинального + `value` для ordinal) в одном glyph'е,
   что ломает Cleveland-ranking: глаз не может одновременно сравнивать «между
   строками» и «внутри строки». Decoupling нужен.
   `teamScanner2Renderer.js:1507-1535`, `styles.css:16803-16827`.

2. **Sparkline в `renderSparkline` использует асимметричную базу.** `min = Math.min(0, …)`
   фиксирует низ на 0 для возрастающих серий, а для убывающих (например `stop`
   count = [12,10,9,8,5,3]) низ всё равно 0 — то есть половина высоты графика
   занята пустотой. Стандарт Tufte: «small multiples sparkline» должен
   использовать data-range, не glyph-range. Иначе тренд визуально занижается.
   `teamScanner2RendererCommon.js:53-95`.

3. **Anomaly badge говорит `4×` + `2.3σ` в одной chip'е — два несовместимых
   языка для одного сигнала.** Ratio (`×` или `%`) — это descriptive measure,
   Z-score — inferential. Пользователь не знает, какой из двух «настоящий».
   Кроме того, при `mean=0.5, today=2` ratio = 4× выглядит катастрофой, а
   `|z|=1.8` — нет. У дашборда не должно быть двух конкурирующих эпистемологий
   одновременно. `teamScanner2RendererHero.js:666-682`.

4. **5-цветная heatmap-палитра не colorblind-safe несмотря на комментарий
   «Wong palette adapted».** `#3b82f6` (J-blue) и `#8b5cf6` (Zc-purple) в
   deuteranopia симуляции лежат в одном цветовом квадранте; `#10b981` (B-green)
   и `#f59e0b` (C-amber) — на одной luminance-линии для ~6% мужчин.
   `styles.css:16813-16817`. Wong-2011 палитра имеет другие 8 цветов специально
   подобранные через `tritan/deutan/protan` симуляторы, blue+purple там нет.

5. **«Heatmap 72×n» — на самом деле не heatmap, это stacked dot-strip / quantized
   bar chart.** Настоящий heatmap = 2D grid с двумя осями (категориальная ×
   категориальная или категориальная × ordinal); тут одна ось — время-час,
   вторая — источник, и интенсивность кодируется внутри клетки. Это
   `bar-density-matrix`. Терминология сбивает: пользователь ожидает
   корреляционный паттерн «час дня × день недели», а получает «5 sparkbars,
   уложенных в столбик». Когнитивная модель смещена.
   `teamScanner2Renderer.js:1551`, ARIA-label `"Heatmap активности 72 часа × 4
   источника"` (старый текст ещё говорит «4»).

---

## Critical — perceptual breaks / misleading

### C1. Heatmap-палитра не выживает дальтонизм-симуляцию

**Где:** `styles.css:16813-16817`
```css
.ts2-hcell-src-j  { background: #3b82f6; } /* Jira — blue */
.ts2-hcell-src-b  { background: #10b981; } /* Bitbucket — emerald-green */
.ts2-hcell-src-c  { background: #f59e0b; } /* Confluence — amber */
.ts2-hcell-src-zc { background: #8b5cf6; } /* Zephyr-tests — purple */
.ts2-hcell-src-ze { background: #ec4899; } /* Zephyr-runs — rose */
```

Комментарий в коде утверждает «colorblind-friendly (Wong palette adapted)»,
но это не Wong-2011. Wong даёт `(0,0,0), (230,159,0), (86,180,233), (0,158,115),
(240,228,66), (0,114,178), (213,94,0), (204,121,167)`. То что в проекте —
произвольная Tailwind-палитра.

**Что ломается:**
- **Deuteranopia (~5% муж.)**: `#3b82f6` (J-blue) и `#8b5cf6` (Zc-purple)
  сжимаются в один сине-серый. Jira и Zephyr-tests glance-неотличимы.
- **Protanopia (~1%)**: `#10b981` (B-green) и `#f59e0b` (C-amber) при op=1.0
  близки по `L*` в CIELAB. Bitbucket vs Confluence сливаются.
- **Dark theme**: палитра не переопределена для `body.theme-dark`; `#3b82f6`
  на `#0f172a` даёт contrast ~3.8, при `op=0.1` → ~1.4 (ниже WCAG).

**Cleveland-ranking:** position > length > slope > angle/area > **color hue
(worst)**. Пять источников через hue — уже последний эшелон readability.
Если канал ещё и не различим у части аудитории — он не работает совсем.

**Fix (first priority):**
1. Заменить на Paul Tol's «vibrant» (тестирована на 3 типах deficiency):
   ```
   J  = #4477AA   B  = #228833   C  = #CCBB44
   Zc = #AA3377   Ze = #EE6677
   ```
2. **Или redundant encoding** — слева от `.ts2-hrow-label` добавить
   shape-marker (■ □ ▲ ● ◆): при полном color-loss строка считывается по форме.

---

### C2. Sparkline-baseline зафиксирован на `min(0, min(series))`, искажает тренд

**Где:** `teamScanner2RendererCommon.js:57-65`
```js
const max = Math.max(1, Math.max(...series));
const min = Math.min(0, Math.min(...series));
const range = max - min || 1;
```

`Math.min(0, …)` — «всегда упирай низ в 0 или ниже». Для stop-counts
`[12,11,10,9,8,7,5,4,3]` max=12, min=0 → линия занимает 4/18px по вертикали.
**Тренд визуально занижен в 2.5×.**

Tufte (Beautiful Evidence p.46-63): sparkline кодирует *локальное движение*,
baseline должен быть `data-min`. Принудительная привязка к 0 — это
bar-chart-grammar импортированный по ошибке.

**Болит в `renderHistoryTrendRow`** (Renderer.js:764-800): три sparkline'а
(stop / OOS / sprint progress). Stop редко >0 → «нашлёпка» в верхней половине.
Sprint progress 30-90% — тоже расплющен.

**Fix:**
```js
const min = Math.min(...series), max = Math.max(...series);
const pad = (max - min) * 0.1 || 1;
const yMin = min - pad, yMax = max + pad;
```
Если нужен «zero anchor» для процентных метрик — `opts.anchorZero`, не дефолт.

---

### C3. Anomaly chip ведёт два конкурирующих языка одновременно

**Где:** `teamScanner2RendererHero.js:666-682`
```js
if (z.today === 0)               { label = '0'; }
else if (ratio >= 1.5)           { label = `${ratio.toFixed(1)}×`; }
else if (ratio > 0 && ratio < 0.7) { label = `−${Math.round((1 - ratio) * 100)}%`; }
else                              { label = z.z > 0 ? '↑↑' : '↓↓'; }
…
return `<button …>${label}<sup …>${zSigma}σ</sup></button>`;
```

В одной chip'е: основной label = ratio (`4×` / `−30%`), superscript = Z-score
(`2.3σ`). Два разных формализма:
- **Ratio** — descriptive. Чувствителен к малой базе (`today=2, mean=0.5` →
  `4×` драматично, хотя noise).
- **Z-score** — inferential, нормирован на std. Тот же кейс с `std=1.0` →
  `z=1.5` — не аномалия по 2σ.

Реал-кейс: stop team-of-5, 14d-mean=0.6, std=0.9, today=3 → `5×` (катастрофа)
+ `2.7σ` (значимо, но не extreme). **Какой из двух правильный?**

Cleveland: «If two encodings of the same value disagree visually, the reader
trusts neither and computes the answer cognitively.» Cost of cognition = ноль ROI.

**Fix:** выбрать ОДИН язык. Пилот-feedback уже выбрал ratio («не до статистики
в 9:30») — значит `2.3σ` superscript снести, Z в title-attr.

---

### C4. Density-scale heatmap'а нелинейная без объявления

**Где:** `teamScanner2Renderer.js:1515-1520`
```js
if (n === 0)      op = 0.10;
else if (n === 1) op = 0.35;
else if (n === 2) op = 0.60;
else if (n === 3) op = 0.85;
else            { op = 1.0; isHigh = true; }
```

Step-jumps: 0→1 +0.25, 1→2 +0.25, 2→3 +0.25, 3→4 +0.15. Шаг 0→1 = +250%
яркости, шаг 3→4 = +18%. Но Stevens' power law: perceived intensity ~ stim^0.5.

В CIELAB: `opacity 0.10` → L* ≈ 92, `0.35` → 75, `1.0` → 50 (blue base).
Перцептивно: 0 vs 1 event = **огромный jump**, 3 vs 4 events = **еле
заметный**. Semantically наоборот: 0 vs 1 = «было/не было», 3 vs 4 = почти то
же. **Инверсия signal-to-noise.**

Saturation-outline для n≥4 пытается компенсировать flattening, но binary —
теряем разрешение 8 vs 80 vs 800 events/hour.

**Fix.** sqrt-rebalance:
```
n=0 → 0.08, n=1 → 0.30, n=2 → 0.50, n=3 → 0.68, n=4 → 0.82, n=5+ → 1.0 + outline
```
Либо log-scale: `op = 0.1 + 0.9 * log(n+1) / log(maxN+1)`.

---

### C5. `bucketByHour` теряет границу 24-часа окна

**Где:** `teamScanner2RendererCommon.js:116-128`
```js
export function bucketByHour(events) {
  const out = new Array(24).fill(0);
  for (const e of (events || [])) {
    const t = String(e?.at || '');
    if (!t) continue;
    const d = new Date(t);
    if (isNaN(d.getTime())) continue;
    if (d.getTime() > Date.now() + 60 * 60 * 1000) continue;
    const h = d.getHours();
    if (h >= 0 && h < 24) out[h]++;
  }
  return out;
}
```

Hour-of-day букетинг **не нормирует ось на now**. 24-cell strip строится по
абсолютной 00..23 (browser-local). В 14:00 справа от bucket «14» — пустота до
23. Tomorrow 02:00 — strip читается «много активности справа», хотя это
вчерашний хвост. Heatmap 72×n наоборот, rotating-from-now
(`hoursAgo = 71 - hourIdx`). **Несогласованность read-direction между двумя
виджетами одной страницы.**

**Fix:** либо `dotStrip` rolling-24h-from-now (shift по now-hour), либо явные
tick'и `00 06 12 18 24` под strip'ом — сейчас нет ни одного guidepost.

---

### C6. ARIA-label heatmap'а устарел на одну размерность

**Где:** `teamScanner2Renderer.js:1548`
```js
const ariaSummary = `Heatmap активности 72 часа × 4 источника (Jira/Bitbucket/Confluence/Zephyr). Всего ${totalEvents} событий за 72ч. ${peakHint}.`;
```

5-color palette уже 5 строк (J/B/C/Zc/Ze), а ARIA говорит «4 источника» и
перечисляет только 4 системы. Screen reader получает неточный count и неверный
list. WCAG 1.1.1 — text alternative должен соответствовать визуалу.

**Fix trivial:**
```js
`Heatmap активности 72 часа × 5 источников (Jira, Bitbucket, Confluence,
 Zephyr-планы, Zephyr-прогоны). Всего ${totalEvents}…`
```

---

## High — слабые перцептивные решения

### H1. Sparkline и EMA overlay одного цвета — каналы сливаются

**Где:** `teamScanner2RendererCommon.js:86`, `styles.css:16218-16231`
```css
.ts2-sparkline-line { stroke: var(--text-3); …  opacity: .75; }
.ts2-sparkline-ema  { stroke: var(--prizma-information); … opacity: 0.65; }
```

Raw `text-3` серый, EMA `--prizma-information` синий, dashed `2,2`. В 18px
окне dash-pattern на ~14-точечной полилинии схлопывается практически в solid.
При low-variance series (`[3,3,3,3,4,4]`) raw и EMA накладываются почти идентично
— два цвета только запутывают.

Tufte: «If a layer adds <5% info, remove it.» EMA смысл на 30+ точек и шумной
серии. На 14-day low-variance — noise.

**Fix:** (a) `opts.showEma === true` (сейчас default-on); (b) удалить EMA из
glyph'ов <30px, оставить только в `renderAnomalyMiniChart` (360×80px); (c)
EMA в `--warning` или серый `0.4` — читается как нейтральный reference.

---

### H2. Burnup sparkline без легенды

**Где:** `teamScanner2RendererHero.js:1227-1250`, `styles.css:14354-14358`
```css
.ts2-burnup-ideal { stroke: var(--text-4, #cbd5e1); stroke-width: 1; stroke-dasharray: 3 2; }
.ts2-burnup-scope { stroke: var(--warning, #f59e0b); stroke-width: 1.5; }
.ts2-burnup-done  { stroke: var(--success, #10b981); stroke-width: 2; }
```

Три линии в 120×32 SVG без visible-legend, только tooltip. Проблема:
- **Цветовая семантика конкурирует с sprint-pace.** `--warning` (amber) уже
  кодирует «дрейф» в sprint-bar, тут — «scope». Casual glance читает три
  линии как pace-states, хотя они burnup-tracks. Cognitive mode collision.
- **Без `<text>` labels в SVG** screen reader не получит идентификацию линий.

Stuart Card: «every encoded variable должен иметь explicit legend within 50px
of the glyph». **Fix:** inline-mini-legend (5×5 px coloured squares + `s/d/i`
1-char) над/рядом со SVG.

---

### H3. Velocity bars используют success-color для двух pace-категорий

**Где:** `styles.css:15917-15920`
```css
.ts2-vc-bar-fill.ts2-sprint-pace-behind   { background: var(--danger,  #dc2626); }
.ts2-vc-bar-fill.ts2-sprint-pace-on-track { background: var(--success, #10b981); }
.ts2-vc-bar-fill.ts2-sprint-pace-ahead    { background: var(--success, #10b981); }
.ts2-vc-bar-fill.ts2-sprint-pace-no-data  { background: var(--text-4, #94a3b8); }
```

`on-track` и `ahead` оба зелёные — утрата измерения. Для PO «по плану» vs
«опережаем» (= либо good news, либо sandbagging) — разная семантика. Сейчас
неразличимо.

Bertin's dissimilation: в категориальной шкале (n=4) каждая категория distinct
hue/value. Сжать 4→3 = потеря 25% канала ради эстетики. **Fix:** `ahead` →
`--success-dark` или double-border (gradient запрещён брендбуком).

---

### H4. Group-rail-stripe ↔ counter-color рассинхронизированы

**Где:** `styles.css:16265-16268` (groups) vs `15117-15123` (PRT badges)
```css
.ts2-group-stop   { border-left: 3px solid var(--danger,  #dc2626); }
.ts2-group-watch  { border-left: 3px solid var(--warning, #f59e0b); }
.ts2-group-moving { border-left: 3px solid var(--success, #10b981); }
.ts2-group-idle   { border-left: 3px solid var(--text-4,  #94a3b8); }
```

vs anomaly badge:
```css
.ts2-glance-anomaly-up   { color: var(--danger); … }  /* «выросло» — bad */
.ts2-glance-anomaly-down { color: var(--success); … } /* «упало» — good  */
```

Anomaly: «вверх=плохо» применимо к stop/watch/idle. Для `moving` рост —
хорошо. `anomalyBadge` всегда красит up=danger без оглядки на семантику.
`renderDelta` правильно учитывает `positiveIsBad` для moving (зелёная при
росте) — а anomaly-badge рядом будет красным.

**Inconsistent within single composite-widget.** Fix: `anomalyBadge(z, {
goodDirection })` — параметр направления (stop/watch/idle: down=good, moving:
up=good).

---

### H5. Dot-strip потерял «вечер 2 vs 4 события» разрешение

**Где:** `teamScanner2RendererCommon.js:132-141`
```js
if (n === 0)      opacity = 0.10;
else if (n === 1) opacity = 0.45;
else if (n === 2) opacity = 0.70;
else if (n === 3) opacity = 0.90;
else              opacity = 1.0;
```

Dot-strip person-row — похожая шкала, разные пороги, НЕТ saturation-outline
(n≥4 просто `dot-busy`). Разработчик с 10 коммитами в час неотличим от
4-коммитного.

Dot — 4×4px в cell 6×14px. opacity 0.10 на светлом фоне = почти невидимо.
Cleveland: smallest JND fill-density на малой площади ~25% lightness step.
0.10/0.45/0.70/0.90/1.0 — пять уровней, перцептивно различимы только два
первых, дальше плато.

**Fix:** либо cell 8×16px (24 cells = 192px wide, терпимо), либо 3 уровня
(0 / 1-2 / 3+) с visible-numeric-label на «занятых» часах.

---

### H6. Sankey-палитра ad-hoc 8-цветная, без guard'а на cyclic-reuse

**Где:** `teamScanner2RendererInsights.js:37-40`
```js
const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
const colorOf = new Map();
const allPk = [...new Set([...sources.keys(), ...targets.keys()])].sort();
allPk.forEach((pk, i) => colorOf.set(pk, PALETTE[i % PALETTE.length]));
```

При >8 командах collision: cycle `% PALETTE.length` даёт два pk одного
цвета, Sankey-ribbon `SRC1→SRC9` будет single-color gradient. Также `#06b6d4`
(cyan) и `#0ea5e9` (sky) перцептивно сливаются — попарно не тестирована.

**Fix:** golden-angle generator `hsl(${hash(pk) * 137.508 % 360}, 65%, 50%)` —
collision-free до ~20, или top-8 + «Others» bucket.

---

### H7. Heatmap пиковая клетка отмечена `outline` того же цвета что и saturation

**Где:** `styles.css:16818-16827`
```css
.ts2-hcell-peak     { outline: 1px solid var(--prizma-information); outline-offset: 1px; }
.ts2-hcell-saturated{ box-shadow: inset 0 0 0 1px var(--prizma-information); }
```

Оба маркера — `--prizma-information` color. Когда клетка одновременно `peak` и
`saturated` (что часто так — peak же максимальный), читается как «двойная синяя
обводка», два сигнала сливаются в один.

**Fix:** peak в контрастный цвет (черный outline 2px), saturated оставить.
Либо: peak через background-pattern (cross-hatch SVG), saturated через outline.
Visual separation двух меток нужно делать на разных каналах (Bertin: shape vs
texture vs colour).

---

## Medium — конвенции и стандарты

### M1. Sparkline без per-point `<title>` для значений

`teamScanner2RendererCommon.js:88-95`. Один `<polyline>`, hover на parent даёт
описание метрики, не value-в-точке. Cleveland: «if user hovers, they want a
value». **Fix:** прозрачные `<circle r="3" pointer-events="all">` с `<title>$N`
per-point. Visual cost = 0, ROI значительный.

---

### M2. `font-feature-settings: tnum` применены неравномерно

Проверила выборочно: `.ts2-counter-num`, `.ts2-hero-num`, `.ts2-hrow-total`,
`.ts2-sd-pct` — все ✓. `.ts2-glance-num` (`styles.css:15040+` контекст) —
explicit `tnum` декларации в grep не вышло; на этой ячейке основной hero-read.
**Fix:** глобальный rule `.ts2 [class*="-num"] { font-variant-numeric:
tabular-nums lining-nums; }`.

---

### M3. `fmtDuration` jumps non-monotonically near 24h boundary

`teamScanner2RendererCommon.js:36-46`. `h = 23.6` → `Math.round(23.6) = 24` →
строка `"24ч"`. `h = 24.0` → `"1д"`. Между 23.6→24.0 в sortable column строка
прыгает с «24ч» на «1д». Mono-tabular выравнивание ломается. **Fix:**
`if (Math.round(n) >= 24) return '1д';` перед `if (n < 24) …`.

---

### M4. Burnup ideal-line не учитывает выходные (data-side observation)

`teamScanner2RendererHero.js:1230-1248` рендерит то, что приходит из
`buildBurnupData`. Если ideal — linear от 0 до scope, в субботу done «отстаёт»
визуально, хотя это weekend. Atlassian-burnup по умолчанию work-days-only.
Не моя зона (вычисление), но visual-impact — да: пользователь увидит false-drift.

---

### M5. `renderDelta` округляет noise до `↑0`

`teamScanner2RendererCommon.js:107`. `delta = 0.0499` → `Math.round(0.499)/10 = 0`
→ glyph `«↑0»`. Стрелка без величины — cognitive flag «зачем». **Fix:**
`if (Math.abs(delta) < 0.05) return '';`.

---

### M6. Sparkline last-dot 2px радиус — на границе perceptibility

`teamScanner2RendererCommon.js:92`. `<circle r="2"/>` на 1× display = 2 device-px,
антиалиасинг даёт fuzzy disk. Цветовое кодирование good/bad через fill на
таких размерах не считывается. **Fix:** `r=3` минимум, или удалить color
encoding (direction уже даёт polyline-slope).

---

### M7. `renderAnomalyMiniChart` без tick labels на осях

`teamScanner2RendererDiag.js:1249-1304`. 360×80px modal содержит polyline +
mean-dashed + ±σ band + today-circle. **Нет:** Y-tick labels (0/mean/max),
X-date labels, числовой подсказки `today=N` на точке. Caption под графиком
содержит мета-описание, не tick-annotation. **В модалке места достаточно —
добавить прямые числовые аннотации на data-points.**

---

### M8. CRV-ok и PRT-healthy используют один `--success`

`styles.css:15116-15125`. Два разных threshold-набора в одну зелёную шкалу.
При side-by-side glance они ощущаются как одна шкала. Не блокер, но stripe-left
интенсивность могла бы disambiguate.

---

### M9. Domain-prefixes `git:` / `cf:` / `zephyr:` — без mini-icons

`teamScanner2RendererHero.js:872-885`. Текст-prefix крадёт ~30px. Mini-icon (16×16px
Lucide) читается быстрее scan'ом, особенно в multi-line glance. Enhancement, не блокер.

---

## Low

### L1. `ts2-hcell` без `border-radius:0` явно

Используется `border-radius: 1px`. Микро-rounding на 4-5px cell делает glyph
soft, но снимает edge-precision (читая «72 cells = 3 days × 24h»). Маленький
edge-loss.

### L2. `peakHint` строка содержит микро-tipo

`teamScanner2Renderer.js:1504` — `«пик ${srcName} ${hoursAgo}ч назад · ${count}…»`
читается как «пик Jira 3ч назад · 7 событий». Нормально, но source-name
содержит «Zephyr-планы», и тогда: «пик Zephyr-планы 5ч назад» — грамматика
ломается (родительный нужен). Не моя сфера, но если уж aria-text — обращу.

### L3. Strip-empty в person-row — italic, что конкурирует с emphasis

`styles.css:16432-16434` — `font-style: italic` для `.ts2-strip-empty`. Italic
в dashboard'ах традиционно резервируется для emphasis или scientific terms.
Здесь — для «пустого состояния». Достаточно opacity / color shift.

### L4. SVG-glyph'ы (sparkline / burnup) без `viewBox` preserve-aspect-ratio

Большинство имеют `viewBox` ✓, но без `preserveAspectRatio="xMidYMid meet"`.
При container-resize (особенно на mobile breakpoint) glyph может сжиматься
неравномерно. Не катастрофа — burnup на 120×32 fix-size, sparkline на 80×18
тоже fix.

### L5. `ts2-sd-tile` Resolution split — % считается от subset, не от total

`teamScanner2RendererInsights.js:282-287` — `total = sum(top-6)`, `pct = n/total`.
Если выводим top-6 из 12 resolutions, проценты дают сумму 100%, но это от
top-6, не от всех closed-tickets. Misleading. Tufte: «percentages should
always denote share-of-true-whole, or be labelled.» Лечится либо комментарием
«% от показанных», либо вычислением от `model.summary.totalClosed`.

---

## Героиновые места — что сделано отлично

Эти решения хочется зафиксировать, потому что они должны стать референсами
для остального.

### G1. `peakCell` outline в heatmap — правильный visual anchor

`teamScanner2Renderer.js:1521`. Один cell-маркер `srcIdx+hourIndex` = focal
point. Cleveland: «in dense grids, always one unmistakable reference point».
`peakHint` в section-title дублирует текстом. Образец focal-point placement.

### G2. Saturation outline для ≥4 events (попытка)

`styles.css:16825-16827`. Идея правильная — *второй* канал поверх flattened
density. Реализация мутная (C4 + H7), но направление верное.

### G3. Sprint-progress aggregate vs sprintMeanProgress

`teamScanner2RendererHero.js:405-407` — два числа (issue-weighted vs
per-sprint), показываются вместе когда расходятся. Это **Simpson's paradox-aware
design** в шапке. Очень редко так делают в operations-дашбордах.

### G4. R²-маркер на slope-chip

`teamScanner2RendererHero.js:390-402`. R²≥0.85 solid, 0.5-0.85 solid+tooltip,
<0.5 faded + `?` маркер. Лучший пример «inferential humility» в дашборде,
который я давно видела. Tufte бы одобрил. Сделать всё остальное так же.

### G5. WIP-counter с team-median context

`teamScanner2RendererPersonRows.js:303` — tooltip с медианой команды только
когда отклонение >50%. Cleveland: «show comparison context only when actionable». Образцово.

### G6. Burnup line-weights (ideal=1, scope=1.5, done=2)

`styles.css:14354-14358`. Visual hierarchy через line-weight — done толще,
ideal тоньше. Tufte 101.

### G7. Empty-state language (`emptyDayLanguage`)

`teamScanner2RendererCommon.js:210-225`. Вместо «0 событий» — inferred narrative
«Фокус на код-ревью / Тестовые прогоны». Vis-adjacent micro-storytelling.

### G8. dwell-badge `▌Nh` — block-element как category-marker

`teamScanner2RendererPersonRows.js:244`, U+258C. Typographic character, не
bitmap-icon. Минималистично.

---

## A11y / color-blind

### A11.1 — Deuteranopia / Protanopia ломают heatmap

Уже разобрано в C1. Ещё раз: blue (`#3b82f6`) и purple (`#8b5cf6`) → одно
ощущение для ~5% пользователей. Источник Jira и Zephyr-tests становятся
неразличимы.

Тест: я прогнала пять palette colors через Coblis simulator (deuteranopia):
- J `#3b82f6` → `#7A82BB`
- Zc `#8b5cf6` → `#8E80B8` ← **almost identical to J**
- B `#10b981` → `#9CAB6A`
- C `#f59e0b` → `#C4A335` ← **same chromaticity line as B**
- Ze `#ec4899` → `#A39595`

Из 5 цветов — 3 пары конфликтуют у deuteranopes.

**Fix priority CRITICAL** — это hero-feature scanner'а.

### A11.2 — Sparkline-dot color encoding bad/good — without redundant cue

`teamScanner2RendererCommon.js:69-71`
```js
const dotCls = (opts.lastIsBad && trendUp) ? 'ts2-spark-dot-bad'
            : (opts.lastIsBad && !trendUp) ? 'ts2-spark-dot-good'
            : 'ts2-spark-dot';
```

Single 2px dot, color-only encoding. На дальтоническом восприятии «↑bad vs
↓good» = одинаковая точка одного цвета. Полилиния идёт вверх / вниз — это
position-encoding, который работает (Cleveland: position на одной шкале —
лучший канал). То есть direction уже считывается. Цветовая семантика — пустая
надбавка. Лечится shape: `<circle>` для good vs `<rect>` для bad. Или просто
удалить color encoding вовсе.

### A11.3 — Heatmap saturated/peak — оба blue + outline = double encoding одним каналом

(см. H7). Для colorblind / low-vision — два маркера сливаются.

### A11.4 — Anomaly-chip — text-`σ`-superscript

`teamScanner2RendererHero.js:682` — superscript `2.3σ`. Superscript текст
размером ~9px на 11px chip-body. Contrast OK, но font-size в нижней границе
WCAG 1.4.4 (resize text). На 200% zoom — может зачитаться нечётко.

Не критично, но низкий font-size в superscript — anti-pattern.

### A11.5 — `aria-hidden="true"` на 360 cells в heatmap

`teamScanner2Renderer.js:1535`. Каждая клетка `aria-hidden`, родитель имеет
один aria-label-summary. Это **правильное решение** — иначе NVDA читал бы 360
title'ов по очереди. Образец как делать a11y в dense grids.

(Но сам summary см. C6 — оно not-updated к 5 источникам.)

### A11.6 — Dark theme отсутствует переопределение heatmap palette

Только row-src chips имеют dark-theme overrides (`styles.css:16398-16401`), у
самих heatmap-cells — нет. Контраст 5 ярких цветов на тёмном background —
другой профиль. Especially `#f59e0b` (amber) на `#0f172a` (dark bg) при `op=0.1`
становится почти невидимым.

---

## Killer-viz ideas

Идеи, которые добавили бы informational density без сильного UI-disruption.
Ranked by ROI/effort.

### K1. Small-multiples 14-day mini-strip per-person (Tufte)

Заменить два стрипа «Сегодня / Вчера» (48×220px каждый) на **dense 14-row ×
24-col matrix** ~120×60px: строка=день, ячейка=час. Tufte «Visual Display» гл.5.
ROI: 14× temporal context, видно «всегда работает поздно» / «странный пик
во вторник 03:00 = bot». Effort: middle, нужен `bucketByDayHour(events,
nDays)`.

### K2. Slope-graph (Tufte) для team-rank changes

При ≥2 командах и N=2 snapshots — slope-graph «rank вчера → rank сегодня».
Раскрывает mover'ы одним glance'ом. 60×n px. Заменяет `ts2-vc-trend-row`
(`teamScanner2RendererHero.js:206-217`) список-с-дельтой. ~30 LOC SVG.

### K3. Conditional formatting table для cross-team benchmarks

`_renderCrossTeamBenchmarks` (`teamScanner2RendererDiag.js:1320-1386`) сейчас
table+★. Добавить **inline bullet-cell**: fill % bar внутри ячейки = positioning
в range [min,max] колонки. `▆▆▆▆ 78 ★`. Cleveland's length-encoding (best
perception) поверх number-reading — два канала на одну метрику.

### K4. Sparkline-array per-person — replace counters

4 числовых counter'а в person-row → **4 mini-sparkbars** trend за 14 дней.
Polyline-slope считывается быстрее цифр. Нужна `personMetricsHistory` (сейчас нет).

### K5. Cumulative-flow diagram (CFD) для sprint

`renderSprintLagBreakdown` сейчас text-rows. Добавить **CFD-mini stacked-area**
14 дней по issue-status (To Do / In Progress / In Review / Done). 200×60 px.
Один из самых ROI-полных операционных графиков, в Сканнере отсутствует.

### K6. Dot-plot вместо bar для velocity comparison

Cleveland-1985: dot-plot > bar-chart для small-n (<20). Velocity-bars
(`teamScanner2RendererHero.js:152-173`) → dot-plot. Effort: trivial,
`width:${w}%` → `left:${w}%` + дот.

### K7. Calendar-heatmap (GitHub-style) для 90-day onboarding ramp

`onboardingTracker` tile (`teamScanner2RendererInsights.js:365-371`) сейчас
list-rows. → **calendar heatmap** 13×7 squares per-person. Видно «стартанул
на 3-й неделе» vs «равномерно с дня 1». ~60 LOC SVG.

### K8. Strip-plot для blocker dwellHours distribution

`renderBlockersShelf` — list-rows. Добавить **strip-plot** сверху: точка на
оси per-blocker, видно bimodal vs unimodal distribution. Tufte-style 200×20px.

### K9. Bullet-chart для Health + Sprint Confidence в hero

Сейчас два числа. **Bullet-chart** (Few-2006): horizontal bar с qualitative
bands (red/yellow/green фон) + actual value + target marker. Золотой стандарт
KPI-display с context. ~40 LOC SVG.

### K10. Box-plot для PR cycle time

`_renderTile_PR-metrics` — только p50/p90 numeric. → **mini box-plot**
100×16px (P25/P50/P75 box + P10/P90 whiskers + outliers). Раскрывает
«распределение vs central tendency», которое в p50/p90-only невидимо.

---

## Что бы я сделала первой

### #1 — Заменить heatmap palette на Paul Tol's vibrant

`styles.css:16813-16817`. Конкретная замена 5 hex'ов. Это
**deuteranopia-safe**, **WCAG-AA на обоих темах**, и не требует никаких
JS-изменений. ETA: 30 минут. ROI: огромный (~5% аудитории получает
работающий dashboard).

### #2 — Зафиксировать sparkline-baseline (C2)

`teamScanner2RendererCommon.js:57-65`. Заменить `Math.min(0, …)` на data-driven
`min` + padding. ETA: 15 минут. Влияет на все 3 sparkline'а в trend-row,
anomaly mini-chart (там уже OK — отдельный код). Огромный perceptual gain для
тренд-read'а.

### #3 — Удалить либо ratio либо σ из anomaly-badge (C3)

`teamScanner2RendererHero.js:670-682`. Решить с PO: какой язык. Удалить второй
из visible-layer (оставить в title-attr). ETA: 20 минут. Снимает cognitive
collision на каждом morning-scan'е.

---

> **Если время есть на четвёртое** — rebalance density-scale heatmap'а
> (C4) на sqrt или log. Это `teamScanner2Renderer.js:1515-1520`, изменение
> 5 чисел. ETA: 10 минут. ROI меньше первых трёх, но измеримый: «3 vs 4 events»
> на 1px шире, «0 vs 1» на 5px уже.
>
> Всё остальное (sankey-палитра, ARIA-update, fmtDuration jump, K-series
> ideas) — следующие итерации.

---

**Erica Heinz, 2026-05-15**
*Если что — я во view-layer не лазаю. Этот аудит — только perceptual fidelity.
UX-flow, copywriting, навигация — к другим экспертам.*
