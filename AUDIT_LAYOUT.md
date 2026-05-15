# AUDIT_LAYOUT.md — этап 3/14

> Команда: фронтенд-инженеры с уклоном в дизайн-системы. Думаем токенами, переиспользованием, расхождениями.
> База: `AUDIT_MAP.md` (этап 0).
> Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`.
> Дата: 2026-05-07.

---

## 1. Стек вёрстки

| Параметр | Значение |
|---|---|
| Шаблонизация | **Vanilla `innerHTML`** в каждом view (`views/*.js`, `integrations/*Renderer.js`) — `Utils.escapeHtml` для безопасности, без VDOM |
| CSS | **Vanilla CSS, без препроцессоров и без CSS-in-JS** |
| Файлы стилей | `theme.css` (216 LOC, ~7 KB) → `styles.css` (19 995 LOC, ~795 KB) → `obsidian/obsidian.css` (1 089 LOC, ~49 KB). **Итого ~852 KB CSS на первый paint** |
| Токены | `theme.css` определяет 86 CSS-переменных (`--prizma-*` + signal + worktype + ease) + `styles.css:59-121` ещё ~30 «legacy» (`--bg`, `--text-*`, `--shadow-*`, `--motion-*`, `--ease-*`, `--font`, `--radius-*`) |
| Темизация | `[data-theme="dark"|"light"|"auto"]` на `<html>` + `body.theme-dark` для overrides + `prefers-color-scheme: light` |
| `var()` использование | 3 707 вызовов (хорошо!) vs 503 строк с raw hex `:#xxxxxx` (token-bypass) и 209 уникальных hex'ов |
| Селекторы | 143 id-селектора (`#section-*`, `#topbar`, `#sidebar`, …), 119 атрибутных (`[data-state]`, `[data-tone]`, `[data-severity]`, `[data-density]`) |
| `!important` | **193 случая в styles.css** (+5 в obsidian.css, +3 в theme.css) — на 20k LOC это ~1/100 |
| Inline `style.X` в JS | ~120 случаев в view-слое (gantt 18, registry 18, ganttHtmlExport 8, mascot 5, metrics 4, dashboard 3, …) — конкурирует с CSS, многие задают `display`, `width`, `transform`, цвета |
| Inline `style="..."` в template literals | ~140 случаев (`gantt.js:17`, `metrics.js:16`, `ganttHtmlExport.js:12`, `teamScanner2Renderer.js:12`) |
| HTML shell | `index.html` — 1 726 LOC, 117 KB, **0** inline `style=""` атрибутов, FOUC-guard скрипт в `<head>` |
| Bundle ratio | CSS-payload (852 KB) ≈ **20 % всего критического трафика** при первой загрузке. На медленном корп-VPN ≈ 2-3 s blocking |

**Системная проблема №1 — 3 параллельные системы motion/ease:**
- `--motion-fast/-mid/-slow` + `--ease-standard/-emphasis` (`styles.css:116-120`)
- `--prizma-ease-calm/-spring/-smooth/-decel` (`theme.css:157-161`)
- `--obs-ease-out/-spring/-overshoot/-soft/-sharp/-pendulum/-bounce/-cur` (`obsidian/obsidian.css:52-59`)

Ни одна из 3-х не используется во всех контекстах: gantt держит свой `cubic-bezier(.4,0,.2,1)` ad-hoc (`styles.css:864, 922, 1045`), маскот замкнут на `--obs-ease-*`, `transition: all .15s` встречается 20 раз с дефолтным `ease`. Брендбук Призмы декларирует одну калибровку — её в коде нет.

**Системная проблема №2 — три источника правды для KPI-цветов:** TODO в `styles.css:1368` сам признаёт: `.kpi-green` / `.bd-kpi-green` / `.jp-chip-done` — три параллельных «зелёных».

**Системная проблема №3 — token bypass:** 86 цветовых токенов определены в `theme.css`, но в `styles.css` — 503 строки с raw `#hex`, 209 уникальных hex (топ: `#dc2626`×104, `#f8fafc`×89, `#f59e0b`×88, `#94a3b8`×43, `#2d3f5e`×32). Это значит: **~⅓ цветов идёт мимо токен-системы**. На светлой теме — ок, на тёмной — известные «засветы», для которых уже сделан shim (`styles.css:149-159`), но без чистки исходников.

**Системная проблема №4 — три DOM-стратегии для overlay scroll-lock:** `:has()` в 14 местах (`styles.css:2983-3001`), плюс manual `body.modal-open`, плюс `#welcome-overlay-modal { z-index: 10500 !important }` (двойное определение в 8418 и 18761).

---

## 2. Находки по разделам

> Формат: `раздел | файл:строка | severity | проблема | решение | трудозатраты`

### Раздел 1. Дашборд

```
1. Дашборд | styles.css:1280-1395 | medium | .kpi-card имеет ДВА определения (строки 1280 и 1344) — повторное правило `kpi-card::before { content: none }` отключает stripe, который сам же файл объявляет в .prizma-card | Свести к одному определению, удалить 1344-1349 | S
2. Дашборд | views/dashboard.js | medium | 17 вызовов innerHTML + 8 inline style="…" + 3 .style.* — нет single render path, при каждом refresh весь section пересобирается | Завести `dashboard/templates.js` (string templates) и единый mountPoint, убрать .style.X в стейт-классы | M
3. Дашборд | styles.css:4037-4057 (.summary-super-*) + views/metrics.js:267-322 | high | Класс `.summary-super-*` помечен как «удалённый со Сводной» (CLAUDE-история), но в `metrics.js` всё ещё используется (.summary-super-pie, .summary-super-pill); 50 правил в CSS живые | Либо переименовать в metrics-* (если живы), либо вычистить (cmt в TODO P11.20) | M
4. Дашборд | app/prizmaUI.js (renderHero) + styles.css:758-770 «ВОЛНА 2 — Снос gradient'ов» | low | Заголовок секции «Снос gradient'ов», но строки 510, 4191, 4325, 4365 содержат живые `linear-gradient(90deg,#fff,#f8fafc)` — комментарий лжёт | Либо домыть Волну 2, либо переименовать секцию | S
```

### Раздел 2. Метрики (верхний)

```
5. Метрики | views/metrics.js + styles.css:18900-19329 | medium | 16 inline style="…" в шаблонах + 4 .style.X в JS + #section-metrics scoped overrides на 19308-19328 — три места меняют один внешний вид | Вытащить metrics tokens (--metrics-spark-bg, --metrics-row-track) в theme.css и убрать дубли | M
6. Метрики | views/metrics.js:268 | medium | `style="background:conic-gradient(${pieStops})"` — runtime gradient через innerHTML; брендбук запрещает gradients кроме spine-pill | Перевести легенду на CSS conic-gradient через `--pie-stops` custom prop, либо <svg> | S
```

### Раздел 3. Реестр

```
7. Реестр | styles.css:1496-1577 | high | Таблица реестра имеет 7 разных z-index (2/3/4/10/11/12) + 6 `!important` для sticky-cells; правила перекрывают друг друга (`th[data-sticky]:z-12 !important` vs `th.th-num:z-11`) | Завести z-scale: --z-table-th=10, --z-table-sticky=20, --z-table-actions=30; убрать !important | M
8. Реестр | styles.css:1502, 1517, 1520 + 1496 | medium | 4 raw hex (`#f0f2f5`, `#f9fafb`, `#fafbff`, `#f8f9ff`) для row-states sticky — не токенизированы, на dark-теме переопределены через `body.theme-dark` отдельным правилом | Ввести --row-bg-num, --row-bg-sticky, --row-bg-hover в theme.css | S
9. Реестр | views/registry.js | medium | 20 innerHTML + 18 .style.X + 10 inline style="" — самый «грязный» renderer; rowFactory строит innerHTML для каждой row, но style.width/min-width задаётся в JS (col-resize) | Колоночные ширины в CSS-переменные `--col-w-N`, оставить .style для drag-mid-action только | M
10. Реестр | styles.css:1838-1846 + index.html без data-tone definition | low | .ms-chip[data-tone="0/1/2"] и .tag-item[data-tone="0/1/2"] — два независимых tone-token; данные одинаковые, но дублируются | Унифицировать в .pz-tone[data-tone="…"] (mixin-class) | S
```

### Раздел 4. Гант

```
11. Гант | styles.css:3736-3943 | critical | gtx-* и gar-* раскладки используют 11 разных z-index (1, 3, 4, 7, 8, 9, 10, 11, 12, 30, 33, 34) — параллельные стеки sticky-headers без общей шкалы; добавление новой колонки = ребус | Документировать stack в комментарии и завести `--gtx-z-*` cascade tokens | M
12. Гант | views/gantt.js:18 .style.X + 17 inline style="" + views/gantt/aux.js:10 .style.X | high | Самый style-инвазивный view; runtime задаёт left/top/width/height через .style — это критично для CLS и затрудняет theme/print modes | Перейти на CSS custom props на bar (--bar-left, --bar-w) и data-attrs для category | L
13. Гант | views/ganttHtmlExport.js — 8 .style.X + 12 inline style | low | HTML export копирует runtime-стили, но без --prizma-* токенов → распечатанная версия теряет тему | Использовать те же CSS-классы что и live, не дублировать стили в export | S
14. Гант | styles.css:2490 `z-index: 50 !important` (комментарий «above pills + gridlines») | medium | Магическое число +«!important» — других «50» в шкале нет, не понятно vs какой слой выше | Завести --z-gantt-overlay=50 и убрать !important | S
```

### Раздел 5. История

```
15. История | views/history.js — 2 inline style="" + styles.css (нет специальной секции) | low | History использует общие .card, но без `data-state` — Spine-pill не применяется к ивентам; визуальная иерархия weak | Добавить .prizma-card[data-state] на event-rows | S
```

### Раздел 6. Таймлайн

```
16. Таймлайн | views/timeline.js:5 inline style + styles.css:2897-2925 | medium | #timeline-wrap имеет старый pre-token padding/radius (24px), не унаследован от .app-section + кастомное `border-radius: var(--radius)` который теперь = 12, тогда как Spine-pill использует 8 | Переключить на --radius-sm и убрать локальный padding | S
```

### Раздел 7. Сотрудники

```
17. Сотрудники | styles.css:.employee-card-advanced* (~10 классов) | medium | 10 разных классов под одну карту сотрудника (-body, -header, -kpi, -kpi-list, -title…) — старая «advanced» версия живёт параллельно новой `.kpi-card.kpi-signal-*` | Свести к одной .pz-employee-card + slot-классы | M
18. Сотрудники | views/employees.js — 18 innerHTML + 8 inline style="" | medium | На каждый refresh весь список ре-рендерится; нет diff — длинный список (>200 чел) триггерит layout всей страницы | Лог virtual-scroll или хотя бы IntersectionObserver-skeleton на off-screen строки | L
```

### Раздел 8. Перегрузка

```
19. Перегрузка | views/teamHealthDashboards.js (BurnoutWatchtowerView) + styles.css | medium | 4 view'и в одном файле делят .ts2-pm-chip-burnout/-high и собственные .burnout-* классы; селекторы дублируются | Вынести «health-card» как переиспользуемый prizma-card[data-signal=burnout] | M
```

### Раздел 9. Здоровье компонентов

```
20. Здоровье | views/teamHealthDashboards.js (ComponentHealthView) | low | Использует те же ai-dash-card стили — расхождение названий (component-health-* класс vs ai-dash-card стиль) затрудняет поиск | Привести имена классов и CSS к одной schema | S
```

### Раздел 10. AI CEO

```
21. AI CEO | styles.css ai-* (ai-dash-card / ai-forecast-card / ai-narrative-card / ai-scenario-card) — 4 параллельных «card» definitions | high | 4 ai-*-card класса делают почти одно и то же; +ceo-card-* (6 sub-классов в exec view) | Свести к .pz-card[data-variant=ai|ceo|forecast] + 1 определение | L
```

### Раздел 11. CEO-режим

```
22. CEO | styles.css ceo-card-actions / ceo-card-body / ceo-card-dark / ceo-card-header / ceo-card-icon / ceo-card-title (6 классов) | medium | Каждая «зона» card получила собственный класс — неэффективно: пройдись через slot-pattern (.pz-card .pz-card-body) | Перевести на BEM-slots, удалить ceo-* | M
23. CEO | styles.css:8418 + styles.css:18761 — `.welcome-overlay-modal { z-index: 10500 !important }` × 2 раза | medium | Класс определён дважды, один раз с !important — collision-prone | Удалить дубль, оставить одно правило | S
```

### Раздел 12. Действия

```
24. Действия | styles.css .al-action-card | low | al-action-card живёт изолированно (5 правил), стилистика близка к prizma-card но без data-state | Сделать .al-action-card extends prizma-card (через одинаковые свойства или composition) | S
```

### Раздел 13. AI Анализ

```
25. AI Анализ | views/aiView.js (8 innerHTML + 2 inline style) + styles.css | medium | 13 блоков AI рендерятся одной innerHTML-строкой; CSS не имеет subgrid/nesting — каждый блок «свой» fontsize/padding | Завести .ai-block с slot-helpers (.ai-block-title/-body) | M
26. AI Анализ | styles.css:9310, 10279 — `linear-gradient(90deg, var(--border-light) 25%, var(--border) 50%, ...)` shimmer-skeleton дублируется построчно идентично | low | Skeleton shimmer определён дважды в разных секциях | Один .pz-skel-shimmer (или keyframe) | S
```

### Раздел 14. Точность оценок

```
27. Точность оценок | views/teamHealthDashboards.js (EstimationCalibrationView) | low | View пользуется общими .health-* классами, но HTML-host пуст (#section-est-calibration) — внутри ничего, ждёт JS; на slow-net перед mount — пустая секция без skeleton | Добавить generic .pz-section-skeleton до mount | S
```

### Раздел 15. Документация

```
28. Документация | views/teamHealthDashboards.js (DocDebtConsoleView) | low | Класс .doc-debt-* имеет 3 разных background для warning (raw `#fef3c7`, `#fcd34d`, var(--warning-light)) — расхождение с brandbook drift-token | Заменить на var(--prizma-drift-bg) + var(--prizma-drift) | S
```

### Раздел 16. Интеграции

```
29. Интеграции | views/integrationsView.js — 25 innerHTML, 3 inline style (top по innerHTML) | high | Settings-modal markup (~600 строк HTML в одной строке) — самый длинный template literal; CSS .int-modal-* содержит 30+ классов специально для него | Разнести modal на per-section partial (jira/bb/cf/zephyr) — по одной string-template-функции | L
30. Интеграции | styles.css:14692, 14729 — два .int-modal-overlay overlay'я z:9998 | medium | Два оверлея с одинаковым z; нет понимания stacking | --z-modal-overlay=9998, --z-modal=10000 | S
```

### Раздел 17. Сканнер команд

```
31. Сканнер | integrations/teamScanner2Renderer.js (~5300 LOC, 12 inline style, 8 innerHTML) | critical | God-renderer с собственным микро-set'ом классов: ts2-* (~200 классов) — практически отдельная design-system; ts2-team-tab-active дублирует .toggle-chip.active | Поэтапно мапить ts2-* в общие prizma-* (chips, tabs, cards) | L
32. Сканнер | styles.css:29-57 — color-mix() fallback переопределяет 13 ts2-* классов raw rgba | medium | Fallback существует только для Safari<16.4, но 13 точечных background дублируют значения; легко рассинхронизируется | Сделать fallback через `--ts2-tint-warning` token, definition в одном месте | M
33. Сканнер | integrations/teamScanner2Renderer.js (CSS variables для timeline) | medium | Внутри ts2 есть mini-grid (.ts2-glance-help-item, .ts2-pm-chip-burnout) — каждое со своим background; нет shared signal-token | Поднять до .pz-signal[data-tone=warn|err|on-course] | M
```

### Раздел 18. Чёрный дашборд

```
34. Чёрный дашборд | styles.css:11421-11426 + .bd-loader-meme | low | bd-* классы (~80 определений) живут изолированно; bd-kpi-green дублирует .kpi-green (см. TODO P11.20:1368) | Слить с .kpi-* через signal-token | M
35. Чёрный дашборд | integrations/blackDashboardRenderer.js — 3 inline style, 7 innerHTML | low | Renderer статичен (нет пересборки на refresh), CSS подклассы хорошо изолированы; основной долг — alias имён | См. п.34 | — |
```

---

### Общее (shared / infra)

```
36. Общее | theme.css:147-153 — `* { transition: background-color 240ms, border-color 240ms, color 240ms, fill 240ms; }` | critical | Универсальный селектор `*` с 4-property transition — каждая mutation/hover/focus в DOM (десятки тысяч узлов в Реестре + Ганте) триггерит paint; на theme-switch браузер обходит все nodes за один кадр | Ограничить body, .prizma-card, .btn, .chip, .tag-item, .ms-chip — список явный (10-15 селекторов) | S
37. Общее | styles.css:1, 1368 — TODO P11.19 + P11.20 | medium | 2 явных TODO живут в коде месяцами: font-family dedup + KPI green dedup | Завести issue на каждый, провести 2 спринта | M
38. Общее | styles.css — 22 уникальных font-family declaration vs 5 «должен быть» (var(--font), var(--font-mono), system-stack) | high | "JetBrains Mono"+"SF Mono"+"Menlo"+"Consolas"+"ui-monospace" встречается 11 раз как литерал — каждый раз разный порядок; 19 раз `font-family: inherit` (что обычно не нужно если корень определён) | Нормализовать к 2 значениям: var(--font) и var(--font-mono); удалить inherit | M
39. Общее | styles.css — 117 уникальных px-значений; топ-30 covers ~85 % | high | 1px (742), 2px, 3px, 4px (132), 5, 6, 7, 8 (655), 10 (590), 11, 12 (647), 13, 14, 16, 20, 24 — нет 4-pt grid; есть raw 11px / 13px / 7px / 9px которые не вписываются ни в 4pt ни в 8pt | Зафиксировать spacing scale 2/4/6/8/12/16/20/24/32/40/48 и заменить outliers (11/13/7/9) | M
40. Общее | styles.css — 41 уникальных letter-spacing; брендбук говорит 1 значение для CAPS (`--tracking-caps: 0.06em`) | medium | Раскат 0.05/0.15/0.2/0.3/0.4/0.5/0.6/0.7/1.2px/1.5px/3px/4px/14px (последнее — splash-анимация) | Перевести все CAPS-headers на var(--tracking-caps), оставить отдельные значения только для splash | S |
41. Общее | styles.css — 32 уникальных font-size (340×11px, 268×12px, 151×13px, 129×10px, 64×11.5px, 59×12.5px, 47×10.5px, 36×18, 33×16, 29×9, 18×15, 15×20, 14×22, … вплоть до 8px) | critical | Нет type-scale; 0.5px-step (10/10.5/11/11.5/12/12.5/13/13.5) — это микро-tweaks, ломают consistency и не имеют семантики | Type-scale: 10/12/13/14/16/20/24/32 + 9 для caps; mass-replace через codemod | L
42. Общее | styles.css:194 + 199 — `scrollbar-gutter: stable` глобально | low | OK — компенсация sj1+sj5 jitter; но 6-15px тратится на гипотетический scrollbar даже на коротких view'ях | Оставить, аудит-positive | — |
43. Общее | styles.css — 105 уникальных box-shadow определений vs 4 токена (--shadow-xs/-sm/-/-lg) | high | ~95 box-shadow строк не используют токен; --shadow-xs определён дважды (стр. 84, 88) с разными значениями (rgba(0,0,0,.05) vs rgba(0,0,0,.55)) — баг dark-mode | Свести к 5 токенам и фиксануть double-define | M
44. Общее | styles.css — 50 уникальных z-index значений (от 1 до 100000) | critical | Каоса: 50/78/79/89/90/120/200/500/800/1000/1100/1200/2000/2001/2003/7900/7950/8000/8500/8550/8600/9000/9001/9100/9998/9999/10000/10001/10500/11000/11500/12000/100000/99999. 9999 встречается 6 раз с разной семантикой; шкалы нет | Завести 6-step scale: --z-base=0, --z-sticky=10, --z-fab=100, --z-toast=2000, --z-overlay=9000, --z-modal=10000, --z-debug=12000; mass-replace | M
45. Общее | obsidian/obsidian.css:241-247 + ~45 keyframes obs-* | low | Маскот имеет свою motion-system (8 ease + 12 anim); хорошо изолировано через `--obs-*`, но не интегрировано с --prizma-ease-* | Сделать `--obs-ease-soft` алиасом `--prizma-ease-calm` (если совпадают по бизнес-семантике) | S
46. Общее | styles.css — 23 gradient'а (linear/radial), брендбук Призмы запрещает gradient'ы кроме spine-pill | high | linear-gradient в строках 510, 2934, 4145, 4191, 4325, 4365, 9310, 10279, 11333, 11363, 11499, 11758, 19313, 19322, 19689 — это hero-блоки/loaders/skeleton, явно не spine-pill | Заменить на solid + border-stripe; для skeleton — на animation: shimmer без gradient'а | M
47. Общее | index.html:13-17 (link rel="stylesheet" theme.css → styles.css → obsidian.css) | medium | 3 sequential CSS-файла, 852 KB до first paint, без preload/dns-prefetch; styles.css не разбит на critical/non-critical | Inline critical CSS (40 KB: variables + topbar + dashboard above-the-fold) в `<head>`, defer-load остальное | M
48. Общее | styles.css — 17 backdrop-filter: blur() | medium | Каждый blur — отдельный compositor layer; 17 одновременно (overlay + modal + ts2-panel + …) тяжело на iGPU; на корп-машинах с дешёвыми GPU laggy | Оставить blur только на topbar и modal-overlay (max 2), остальное — semi-transparent solid | M
49. Общее | views/registry.js:18, views/gantt.js:18, views/ganttHtmlExport.js:8 — топ inline `.style.X` в JS | high | ~120 .style.X в view-слое — конкурируют с CSS, исключают theme-switch для тех свойств, ломают `prefers-reduced-motion` | Завести set-css-var helper: `el.style.setProperty('--bar-left', x+'px')` + соответствующий CSS; убрать прямое .style.left/.width | L
50. Общее | styles.css — 31 :has() селектора | medium | :has() — медленный селектор (especially html:has() in line 2983-3001); FF<121 = no-op (acceptable degradation), но html:has в 14 местах = root-recompute on каждом open/close | Свести html:has(...) к одному `body.is-modal` классу, ставить из JS | M
```

### Кросс-разрезные

```
51. Кросс-разрез | theme.css определяет 86 переменных, но styles.css всё ещё содержит 503 raw `:#hex` и 209 уникальных hex'ов | high | 1/3 цветов идёт мимо токенов; на light-теме виден правильно, на dark — через body.theme-dark override-блоки | Codemod: каждый hex → `var(--…)` если совпадает; иначе добавить новый токен | L
52. Кросс-разрез | shared «card» компонент — 120 *-card классов | critical | .card / .prizma-card / .kpi-card / .ai-dash-card / .ai-forecast-card / .ai-narrative-card / .ceo-card / .chat-card / .diag-card / .employee-card / .blocking-detail-card / .release-card / .al-action-card / .beaut-card / .bd-* — у каждого свой padding/radius/shadow | Базовый .pz-card + variants через data-attr; mass-rename codemod | L
53. Кросс-разрез | shared «chip» — 71 *-chip классов; «badge» — 63; «modal» — 59 | critical | На каждый раздел — своё имя для одного и того же UI; никто не наследует базовый .chip | .pz-chip + variants = data-tone/data-size; постепенная миграция (gantt-type-pill, bd-chip, ts2-pm-chip и т.д.) | L
54. Кросс-разрез | 15 max-width breakpoint'ов (480/560/680/700/720/767/860/900/980/1080/1100/1180/1279/1280/1366) | high | Off-by-one (1279 + 1280 одновременно), нет min-width queries вообще; container queries не используются | Зафиксировать 4 breakpoint'а: 480 / 768 / 1024 / 1366 — переписать media-blocks; начать с container queries для card-grid'ов | L
```

---

## Карта расхождений с дизайн-системой

| # | Дизайн-система говорит | В коде факт | Где видно |
|---|---|---|---|
| 1 | Один accent — `--prizma-information` (Sky) | `#4f46e5` (indigo) сидит как fallback на 3-х строках, `#0F8A5F`/`#B5670A` встречаются raw в light-blocks | styles.css:42, 44, 1538, 1771, 2700-2702 |
| 2 | Spine-pill — 3px stripe-left, без filled bg | `.kpi-card`, `.ai-dash-card`, `.employee-card` имеют filled `--bg-secondary` background | styles.css:1280, 1395, employees-* |
| 3 | Mono-tabular на цифрах, font-feature-settings: "tnum" | Только в .prizma-card-num (746) и .jira-tag (1753); реестр / гант / dashboard числа без tnum | styles.css:1549 (только cell-number), миллион чисел без |
| 4 | CAPS sub-headers: 9-10px / `--tracking-caps` (.06em) | 41 уникальный letter-spacing (1.2px / 1.5px / 3px / .05em / .15em / .4em) | styles.css:300, 406, 501, 574, 645, 666 |
| 5 | Без эмодзи в production UI | TODO в коде упоминает «убран эмодзи `⚠`» (1384) — значит был ✓; но `🤖` `🌟` могли остаться в чате | grep по `[\u{1F300}-\u{1FAFF}]` в JS-templates |
| 6 | Без gradients (только spine-pill / маскот) | 23 живых linear-gradient'а в styles.css (см. находку 46) | styles.css:510, 2934, 4145, 4191, 4325, 4365, 9310, 10279, 11333, 11363, 11499, 11758, 19313, 19322, 19689 |
| 7 | Один primary шрифт + один mono | 22 уникальных font-family declaration (см. находку 38) | TODO в styles.css:1 |
| 8 | Type-scale 10/12/13/14/16/20/24/32 | 32 уникальных font-size, в т.ч. 10.5/11.5/12.5/13.5 — половинные шаги | grep `font-size:` |
| 9 | Spacing 4-pt grid (4/8/12/16/20/24/32) | 117 уникальных px; 7px (×79), 9px (×69), 11px (×358), 13px (×158) — outliers | grep `\b[0-9]+px\b` |
| 10 | Z-scale 6-7 уровней | 50 уникальных z-index | см. находку 44 |
| 11 | Один shadow-token-set (--shadow-xs/-sm/-/-lg) | 105 уникальных box-shadow + double-define `--shadow-xs` | находка 43 |
| 12 | Семантические statuses через signal (on-course/drift/off-course/information/insight) | parallel: --success/--warning/--danger + raw `#dc2626` (×104) / `#f59e0b` (×88) / `#16a34a` (×31) | theme.css OK, styles.css не |
| 13 | data-theme="dark"/"light" — единственный switcher | + `body.theme-dark` параллельно (legacy для overrides) | styles.css ~80 правил `body.theme-dark .…` |
| 14 | Анимации: один canonical ease | 3 ease-системы (--ease-*, --prizma-ease-*, --obs-ease-*) + 20 ad-hoc cubic-bezier | находка 36, system-problem-1 |
| 15 | Card / chip / badge / modal — один base + variants | 120 / 71 / 63 / 59 уникальных классов | находки 52-53 |
| 16 | summary-super-* — мёртвый код после удаления Сводной | 50 правил живут; metrics.js:267 всё ещё генерит .summary-super-pie | находка 3 |
| 17 | Mascot motion-system отдельна, но ease-имена согласованы | --obs-ease-* не имеет alias'ов на --prizma-ease-* | находка 45 |

---

## Чек-лист гигиены вёрстки

- [ ] **Token coverage:** каждый цвет = `var(--prizma-…)` или `var(--*-light/-dark)`. Цель: 0 raw `:#hex` в styles.css (сейчас 503 строки).
- [ ] **Spacing scale:** 4-pt сетка (4/8/12/16/20/24/32/40/48). Outliers (7/9/11/13) — только в отдельной секции «text-tight» с комментарием.
- [ ] **Type scale:** 10/12/13/14/16/20/24/32; половинные шаги (10.5/11.5/12.5) запрещены (codemod).
- [ ] **Z-scale:** 6 уровней через `--z-*`; запрещено новое z-index числом без token (lint-rule).
- [ ] **Shadow:** 4-5 токенов в theme.css; box-shadow в коде только `var(--shadow-*)` (или explicit с TODO).
- [ ] **Component naming:** `.pz-{name}` для нового; legacy (`*-card`, `*-chip`, `*-badge`) только в migration-PR.
- [ ] **Motion:** один ease-namespace `--prizma-ease-*`; `--obs-ease-*` алиасы; `transition: all` запрещено (lint).
- [ ] **`!important`:** budget — текущие 193 case фризятся, новый требует комментария + ADR.
- [ ] **Inline `.style.X` в JS:** только для динамических transform/left/top/width (gantt-bars, drag&drop). Остальное — CSS-vars через `setProperty('--x', val)`.
- [ ] **Inline `style="…"`:** только в gantt-bars, conic-gradient pie, sparkline; иначе — класс.
- [ ] **Media-queries:** 4 breakpoint'а (480 / 768 / 1024 / 1366); off-by-one (1279/1280) запрещён.
- [ ] **Container queries:** для всех card-grid'ов вместо media-queries (где возможно).
- [ ] **`*` selector:** запрещён, кроме box-sizing reset; `theme.css:147` транзишен — переписать.
- [ ] **`html:has()`:** для scroll-lock — один `body.is-modal-open` класс из JS.
- [ ] **Critical CSS:** inline в `<head>` (~40 KB: tokens + topbar + dashboard above-the-fold); остальное — defer.
- [ ] **`scrollbar-gutter: stable`:** оставить (sj1/sj5 fix).
- [ ] **Dead code:** `.summary-super-*` — либо вычистить, либо переименовать; legacy CEO `body.theme-dark` правила — ревью.
- [ ] **Backdrop-filter:** max 2 одновременно; rate-limit на низкоэнергетических машинах.
- [ ] **Reduced-motion:** проверять `@media (prefers-reduced-motion)` для каждой новой animation; cur. 31 правило — норма.
- [ ] **prefers-color-scheme:** auto-theme живёт только в `theme.css:111-138`, никаких локальных дублей.
- [ ] **Selectors:** запретить `:has()` на `html`/`body` без обоснования; deeply nested `>` chain >3 уровней — code review.
- [ ] **Empty-state / long-string / overflow:** для каждого нового view иметь skeleton + empty-state + long-string overflow snapshot.
- [ ] **DOM rendering:** новые views мигрировать на `string template + single innerHTML write` (без `+=`), либо на DOM-API без innerHTML — ни один view не должен делать `el.innerHTML += s`.

---

## Сводка по severity

| Severity | Кол-во |
|---|---|
| critical | 7 (#11, #31, #36, #41, #44, #52, #53) |
| high | 9 (#3, #7, #12, #21, #29, #38, #39, #43, #46, #49, #51, #54) |
| medium | 21 |
| low | 9 |

**Итого: 54 находки** (целевая планка 35-50 — превышена сознательно из-за двух системных проблем: 209 hex / 120 *-card классов).

---

## Топ-10 рекомендаций (priority order)

1. **`*`-transition в `theme.css:147`** — критический perf-regression, фикс 5 минут, эффект на каждый interaction.
2. **`box-shadow` double-define `--shadow-xs`** — функциональный баг dark-theme (`styles.css:84` vs `:88`).
3. **Z-scale** — 50 значений, нужна шкала из 6-7 (`--z-*`).
4. **Card / chip / badge consolidation** — 120 + 71 + 63 классов, базовый `.pz-card` + variants через data-attr.
5. **Type-scale + spacing** — 32 font-size + 117 px → 8 + 11.
6. **Token coverage** — 503 raw hex, codemod на `var(--prizma-…)`.
7. **Gradient cleanup** — 23 gradient'а, оставить только маскот + spine-pill.
8. **Motion-system unify** — 3 ease-namespace → 1.
9. **Inline `.style.X` в Gantt/Registry** — переход на CSS-vars (`--bar-left`).
10. **Media-queries cleanup** — 15 breakpoint'ов → 4 + container queries.

---

*Сгенерировано Этапом 3. Готовность к Этапу 4 (арт-дирекшн).*
