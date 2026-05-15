# 04 — Typography & Information Architecture audit

Сканнер команд 2.0 (`integrations/teamScanner2Renderer.js`, 4587 LOC + 11 satellite-файлов) и Чёрный дашборд (`integrations/blackDashboard*.js`, 4 файла) — оба читаются как «техно-портянка V18-V21»: tnum-микс, ad-hoc font-size'ы (10/10.5/11/11.5/12/12.5/13/14), CAPS-метки, англоязычные термины внутри русского UI и эмодзи-эстетика в табах. Брендбук-шкала (Display 72 / Headline 32 / Subtitle 18 / Body 15 / BodySmall 13 / Caption 11 / MonoNumber 24) применена точечно — например `.prizma-page-h1` (28/300) на верхнем page-header'е и `.insights-dash-col h3` (18/500), но внутри сканнера и BD заголовки садятся на 10/12/14 px и не образуют иерархии.

## Сводка
- Critical: 4
- High: 9
- Medium: 11
- Low: 7
- Polish: 6

## Метод
- Прочитан `BRAND_BOOK.md` §4 Типографика, §7 Tone of voice, §11 Loaders.
- Просмотрены `integrations/teamScanner2Renderer.js` (renderTopBar, renderTeamGlance, renderPersonRows, renderRow, renderEmployeeDetailPanel, renderEmpty, renderError, HOW_SECTIONS, renderMultiTeamView), `integrations/blackDashboardRenderer.js` (полностью, 681 LOC), `integrations/blackDashboard.js`, `integrations/integrationsRenderer.js`, `views/integrationsView.js`.
- В `styles.css` проверены классы `.ts2-*` (916 правил), `.bd-*` (~150 правил), `.int-*` (~80 правил), `.prizma-*` (хелперы), `.signal-*` и default-стили `body { font-feature-settings:"tnum" 1, "lnum" 1 }` (styles.css:226).
- Сверка с CLAUDE.md (§ Принципы дизайна V15 Spine-pill): «Без эмодзи в production UI», «Mono-tabular numerals», «CAPS sub-headers 9-10px / letter-spacing .6-.7px» — последний пункт в проекте действует, но конфликтует с брендбук-Caption (11px / 1.5px).

## Находки

### F1 — `.ts2-h1` нарушает Subtitle-шкалу [High]
**Где:** `integrations/teamScanner2Renderer.js:270` (`<span class="ts2-h1">Сканнер команд</span>`) + `styles.css:12350`.
**Брендбук:** §4 — Subtitle 18px / weight 500 / letter-spacing 0; Headline 32px / 300 / 0.
**Текущее:** `font-size: 18px; font-weight: 700; letter-spacing: -.2px;`
**Должно быть:** Если это «заголовок секции» — Subtitle 18 / 500 / 0 (вес 500, не 700). Если хочется акцент уровня «название блока интеграции» — поднять до Headline 32 / 300 (как `.prizma-page-h1` 28/300). Letter-spacing -0.2px только у `.ts2-h1` — рассинхрон с `prizma-page-h1` (-0.01em).
**Рекомендация:** Заменить класс на `.prizma-page-subtitle` (уже есть, styles.css:15766: 18 / 500 / 0). Сейчас сканнер использует свой собственный H1, не зная о canonical `.prizma-page-h1`, который рендерится `prizmaUI.renderPageHeader()` снаружи (`views/integrationsView.js:566`). Получается два H1 на странице: `prizma-page-h1` 28px и `ts2-h1` 18px — нарушение визуальной иерархии.
**Цена:** S

### F2 — Двойной H1 на странице (page-header + ts2-h1 + bd-title) [Critical]
**Где:** `views/integrationsView.js:566-569` (`renderPageHeader('integrations')` → H1 «Интеграции» 28px), плюс внутри субтабов:
- `integrations/teamScanner2Renderer.js:270` — `.ts2-h1` 18/700 «Сканнер команд»
- `integrations/blackDashboardRenderer.js:196` — `<h3 class="bd-title">⚫ Чёрный дашборд</h3>` 18/700.
**Брендбук:** §4 — на странице один Headline. В сканнере дальше идут блоки, каждый из которых должен быть Subtitle 18.
**Текущее:** Page-H1 «Интеграции» 28/300 → внутри второй «H1»-уровень 18/700 → внутри много H3/H4 на разных размерах (10, 12, 13, 14).
**Должно быть:** На странице ровно один Headline (`.prizma-page-h1` «Интеграции»). Подзаголовки субтабов — Subtitle 18/500. `.bd-title` сейчас обёрнут в `<h3>` с font-size 18px, что не соответствует семантике (h3 = третий уровень). Заменить:
- `.ts2-h1` → `<h2 class="prizma-page-subtitle">Сканнер команд</h2>`
- `.bd-title` → `<h2 class="prizma-page-subtitle">Чёрный дашборд</h2>`
- секции внутри (Goals / Coverage / Metrics) — h3 (BodySmall-bold или 14/700).
**Цена:** S — 2 элемента, классы уже есть в системе.

### F3 — Эмодзи-приставки в табах и заголовках нарушают brandbook §12 [Critical]
**Где:** 57 эмодзи в `teamScanner2Renderer.js`, 14 в `blackDashboardRenderer.js`. Самые видимые:
- `blackDashboardRenderer.js:182-184` — табы «🎯 Цели», «🔗 Покрытие», «📈 Метрики».
- `blackDashboardRenderer.js:196` — `<h3 class="bd-title">⚫ Чёрный дашборд</h3>`.
- `teamScanner2Renderer.js:270` — DEMO-tag `<span class="ts2-demo-tag">`, кнопки «📋 Диагностика», «↻ Обновить», «❓ Как считается», «⚙ Настройка команд», «👥 По командам», «📋 TG», «🔗 копировать», «💬 Обсудить 1:1», «✕ Закрыть» (3072), «🎉 Все эпики...» (581).
- `views/integrationsView.js:553` — субтаб «⚫ Чёрный дашборд» с дополнительным `signal-dot signal-off-course`.
**Брендбук:** CLAUDE.md «Без эмодзи в production UI (✓ только в emoji-палитре или диагностике)»; §12 Illegal usage — звезда не делит знак с эмодзи; §11 Loaders — «никогда не круговой спиннер. Это не наш язык».
**Текущее:** Эмодзи выполняют функцию иконок (стрелки, сердце, мишень, лупа). Типографика «¬✓ ▶ ☐» у `bd-team-mini` (blackDashboardRenderer.js:271) — три разных глифа, ни один не из набора Lucide.
**Должно быть:** Все 57 эмодзи в TS2 + 14 в BD заменить на Lucide-иконки (через `app/icons.js Icons.get(...)` — уже используется). Минимум:
- 🎯 → `target`, 🔗 → `link`, 📈 → `trending-up`
- ⚫ → не нужен (Чёрный дашборд опознаётся по subtab + content)
- ↻ → `refresh-cw`, ✕ → `x`, 📋 → `clipboard`, ⚙ → `settings`, ❓ → `help-circle`, 👥 → `users`
- ⚠ → `alert-triangle`, ✓ → `check`, ◐ → `loader`, ○ → `circle`
- 🎉 → не нужен («Все эпики/истории привязаны к целям!» — самодостаточно)
- 💬 → `message-circle`.
**Цена:** M — есть Icons.get, но 70+ замен в template literals.

### F4 — Конфликт двух «CAPS sub-header»-стилей [High]
**Где:**
- `styles.css:14552` — `.ts2-counter-lab` 9px / weight 400 / letter-spacing 0.5px / UPPERCASE
- `styles.css:14416` — `.ts2-group-head` 10px / 700 / 0.8px / UPPERCASE
- `styles.css:14813` — `.ts2-panel-section-title` 10px / 700 / 0.8px / UPPERCASE
- `styles.css:9633` — `.ep-section-title` 9px / 700 / 0.6px / UPPERCASE
- `styles.css:13818` — `.ts2-glance-domain` 10px / 700 / 0.4px / **lowercase** (комментарий: «отличается от CAPS sub-headers»)
- `styles.css:11879` — `.bd-type-table th` 11px / 700 / 0.4px / UPPERCASE
- `styles.css:294` — `.topbar-module-label` 11px / 500 / 1.5px / UPPERCASE — это canonical Caption брендбука.
**Брендбук:** §4 Caption — 11px / 500 / **letter-spacing 1.5px** UPPERCASE. CLAUDE.md Spine-pill — 9-10px / 0.6-0.7px UPPERCASE.
**Текущее:** 6 разных «caps-sub-header» с разными размерами (9/10/11), весами (400/500/700) и letter-spacing'ами (0.4/0.5/0.6/0.7/0.8/1.5px). Глаз воспринимает их как «много мелкого CAPS», иерархия теряется.
**Должно быть:** Свести к 2 уровням:
- `caption` — Caption брендбука 11/500/1.5px UPPERCASE для метаданных вверху блоков (`.ts2-glance-domain`, `.bd-fetched`, `.ep-section-title`).
- `eyebrow` — 10/700/0.6px UPPERCASE для меток-внутри (sub-section anchor): `.ts2-group-head`, `.ts2-panel-section-title`, `.ts2-counter-lab`, `.bd-type-example-label`.
Полностью отказаться от 9px (нечитаемо без увеличения, нарушает WCAG 1.4.4 reflow) — `.ts2-counter-lab` 9px и `.ep-metric-label` 9px переписать в 10/700.
**Цена:** M — 12 классов, не больно.

### F5 — `.ts2-counters` числа: 13/700 monospace вместо MonoNumber 24/300 [High]
**Где:** `styles.css:14546` — `.ts2-counter-num { font-size: 13px; font-weight: 700; line-height: 1.1 }`. В `.ts2-row` рендерятся 4 числа на сотрудника: WIP / PR / задач / часы (`teamScanner2Renderer.js:2776-2780`).
**Брендбук:** §4 — MonoNumber 24px / 300 / -0.5px JetBrains Mono. Это «hero»-цифры, должны быть тяжёлой массой формы а не bold-tnum-micro.
**Текущее:** 13/700/1.1 — оптически тонкие, потому что bold-mono с маленьким размером сливается в чёрный пиксель. Глаз тимлида утром не может скан-prinимать 5×4 счётчиков.
**Должно быть:** Counter-цифры — это всё-таки вторичные числа (хотя бы 16/300 mono), а не Subtitle. Минимум: 16-18px / weight 400 / -0.3px / line-height 1. Или ввести шкалу:
- **HeroNumber** (`ts2-hero-num`) — MonoNumber 36/800 (сейчас 36/800 — почти ок, но weight 800 не из брендбука).
- **CounterNumber** (`.ts2-counter-num`, `.ts2-team-wip`, `.ts2-team-sprint-pct`) — 16-18px / 400 / 0px tracking.
- **InlineNumber** (`.ts2-glance-num`) — Body 15px / 400 (уже 15/700, weight снизить до 500).
- **Caption-num** (`.bd-fetched`, `.ts2-recent-at`) — 11/400/0px, mono.
**Цена:** S — точечно поправить counter-num + ts2-glance-num.

### F6 — `.ts2-hero-num` font-weight 800 не существует в брендбуке [Medium]
**Где:** `styles.css:12866` — `.ts2-hero-num { font-size: 36px; font-weight: 800 }`. Используется для Health-score / Sprint Confidence (3-значные числа в hero-блоке `teamScanner2Renderer.js:1150`).
**Брендбук:** §4 — единственный 200/300/400/500 (Display 200, Headline 300, Subtitle 500, Body 400, Caption 500). Weight 800 чужой.
**Текущее:** 36/800/JetBrains Mono.
**Должно быть:** MonoNumber 24/300 или (для hero) 36-48/200 (как `.prizma-hero-kpi` 48/300, styles.css:587). Light weight даёт «спокойную уверенность» (§7 Tone of voice — спокойный, точный); 800 — кричащий heavy-display, на счётчик 76/100 это «рычание».
**Цена:** S.

### F7 — `.bd-kpi-val` font-weight 800 + 28px [Medium]
**Где:** `styles.css:11700` — `.bd-kpi-val { font-size: 28px; font-weight: 800 }`. KPI-блоки «57%», «14», «2400», «9.5%» в renderGoalsTab/renderCoverageTab.
**Брендбук:** Headline 32/300 для hero чисел. KPI-tile «Покрытие 57%» — это hero-число дашборда.
**Текущее:** 28/800 SF Pro Display, не mono.
**Должно быть:** MonoNumber 24/300 JetBrains Mono ИЛИ Headline 32/300 SF Pro Display + tnum. Сейчас цифры разной длины «прыгают» при пересчёте (хотя `body` имеет default tnum, у `.bd-kpi-val` это не выключено — но 800 weight + tabular-nums всё равно даёт «чёрные блоки»).
**Цена:** S.

### F8 — `.ts2-glance-num-stop`, `-watch`, `-muted` — цвет работает, но font-size одинаков [Low]
**Где:** `styles.css:13808` — `.ts2-glance-num` 15/700; цвет-варианты (14221-14223) только меняют color. В renderTeamGlance:846-848 — числа stop/watch/moving смешаны с подписями «движется», «наблюдение», «стоп», но обладают одинаковым весом (15/700).
**Брендбук:** §3 «5% Signal-цвета только для статусов». В строке `5 движется · 3 наблюдение · 1 стоп` — три равноправных счётчика, цвет даёт акцент. Но 15/700 — bold для inline-числа, перетягивает на себя глаза.
**Должно быть:** Числа 15/500 (Body), пометки «движется» 13/400 (BodySmall). Цветной только число у stop. Уменьшить font-weight до 500 — иерархия читается через цвет, не через bold.
**Цена:** S.

### F9 — Trailing-zero pattern непоследователен [Medium]
**Где:**
- `teamScanner2Renderer.js:343` — `${s.progressPct}%` (целое, без точки)
- `teamScanner2Renderer.js:715` — `${s.progressPct}%` (то же)
- `teamScanner2Renderer.js:902` — `PR cycle: ${fmtDuration(prCycle.p50Hours)} / P90 ${fmtDuration(prCycle.p90Hours)}` — `fmtDuration` возвращает что-то вроде «6.5ч»
- `teamScanner2Renderer.js:2965` — `${fmtHours(h.todaySec)}` — без единицы
- `teamScanner2Renderer.js:912` — `MTTR: ${fmtDuration(mttr.mttrHours)}`
- `teamScanner2Renderer.js:3090` — `(hours.toFixed(1))` — всегда 1 знак.
- `teamScanner2Renderer.js:381` — `barsCoveragePct ... { suffix: '%' }` — без знаков.
**Брендбук:** §7 Tone of voice — «точный», но §3 «спокойный» подразумевает не перегружать точностью. Сейчас в одной таблице видно «5%» и «9.5%» — рваный паттерн.
**Должно быть:** Договориться: проценты — целые (округлить, не показывать .0), часы — с одним знаком после точки если <10ч, целое если ≥10ч. Создать `formatPercent(n)` и `formatHours(h)` хелперы. Сейчас `.toFixed(1)` появляется по случаю.
**Цена:** M.

### F10 — Локаль чисел: `'ru'` vs `'ru-RU'` рассогласована [Low]
**Где:**
- `blackDashboard.js:184` — `toLocaleString('ru')`
- `teamScanner2Renderer.js:2927/2928/3250/3945` — `toLocaleString('ru-RU')`
**Брендбук:** прямого правила нет, но §3 «один цвет на всю палитру» подразумевает одну локаль.
**Текущее:** Иногда `'ru'`, иногда `'ru-RU'`. На большинстве систем результат идентичен, но при экзотических locale-fallback'ах могут различаться формат даты и NBSP в числах.
**Должно быть:** `'ru-RU'` всюду, плюс константа `RU_LOCALE = 'ru-RU'` в `app/prizmaUI.js` или `utils.js`.
**Цена:** S — 5 строк.

### F11 — Знак минуса: regular `-` вместо `−` (U+2212) [Polish]
**Где:**
- `teamScanner2Renderer.js:135` — `${arrow}${Math.abs(delta)}` где arrow = '↑'/'↓' (тут OK)
- `teamScanner2Renderer.js:833` — `−${Math.round((1 - ratio) * 100)}%` — здесь `−` (typographic minus, U+2212)
- `teamScanner2Renderer.js:957` — `↘ ${slope.slope}%/день` — slope.slope может быть отрицательным числом, и тогда выйдет regular `-` (hyphen-minus).
- `teamScanner2Renderer.js:2957` — `+${loc.added} / −${loc.removed}` — typographic minus есть.
- `teamScanner2Renderer.js:2722` — `↻${switches}` без знака.
- `teamScanner2Renderer.js:701-702` — `отстаём на ${lagPp}pp` — lagPp может быть отрицательным с regular hyphen.
**Брендбук:** §4 — JetBrains Mono имеет правильный `−` U+2212; правил типографики нет, но «спокойный/точный» голос подразумевает использование typographic minus.
**Должно быть:** Везде где знак отрицательный — typographic minus `−`. Хелпер `signed(n)` который возвращает `+5`, `−3` (с правильным знаком и без пробела).
**Цена:** S.

### F12 — Spacing для тысяч: NBSP не гарантирован [Low]
**Где:** Числа большие (>999) появляются в `bd-kpi-val`, `ts2-team-wip`, и редко в counters. `toLocaleString('ru-RU')` отдаёт NBSP-разделитель «1 234». Но многие места рендерят сырое число (`${s.totalGoals}`, `${counts.stop}`) — без вставки NBSP.
**Брендбук:** ru-локаль ожидает NBSP-разделитель тысяч.
**Должно быть:** Хелпер `fmtCount(n)` который применяет `n.toLocaleString('ru-RU')` для всех чисел в UI ≥ 1000. В рамках Сканнера большинство значений до 100, но `bd-kpi-val` (количество эпиков, задач) может быть 1500+.
**Цена:** S.

### F13 — Sparkline для history.aggregateProgress (renderHistoryTrendRow) — нет числовой подписи [Polish]
**Где:** `teamScanner2Renderer.js:380` (`renderSparkline(series, { width: 220, height: 36 })`) — рисуется только линия, последняя точка цветом.
**Брендбук:** §3 — sparkline должен иметь contextual end-value для glance-понимания.
**Текущее:** Кривая 220×36, без чисел.
**Должно быть:** Справа от sparkline — последнее значение MonoNumber + дельта `−2%`. Без числа sparkline — это «эстетика», а не информация.
**Цена:** S.

### F14 — Right-alignment чисел: соблюдается частично [Medium]
**Где:**
- `.bd-cov-stats` (styles.css:11810) — `text-align: right` ✓
- `.bd-type-table th, td` (11875) — `text-align: right` ✓
- `.ts2-counter` (14543) — `align-items: flex-end` ✓
- `.ts2-team-wip` — нет text-align (inline в grid-track auto)
- `.ts2-team-sprint-pct` — inline в `.ts2-team-sprint`, не выравнено по правому краю колонки
- `.ts2-glance-num` — inline в потоке текста (`5 движется · 3 наблюдение`) — справа не выравниваются
- `.ts2-action-queue-row` — grid `32px auto 1fr auto 1fr` где первая колонка `#1` — `font-weight: 700, color: text-3` — но не aligned right.
**Брендбук:** Digital design принцип — числа в столбцах правым краем.
**Должно быть:** В таблицах (multi-team head, sprint-rows, type-breakdown) числа всегда text-align right. Inline числа (counters, glance) — оставить.
**Цена:** S.

### F15 — Sprint-name truncation 160px — слишком жёстко [Medium]
**Где:** `styles.css:13266` — `.ts2-sprint-name { max-width: 160px }` (топ-bar gauge). На мобилке — 100px (13616).
**Текущее:** Sprint-name «Sprint 1.21 final QA-feedback push» обрезается до «Sprint 1.21 final…».
**Брендбук:** §4 — line-length 70 знаков для прозы; для имени sprint'а 160px → ~14-18 символов.
**Должно быть:** Полное имя в title (есть), 220-260px max-width на десктопе. Убрать ellipsis (`overflow: visible`) для активного спринта или сделать tooltip-on-hover виден всем (не только при naked title).
**Цена:** S.

### F16 — `.ts2-empty-title` 14/700 vs `.ts2-error-title` 14/700 vs `.bd-state-title` 16/700 [Low]
**Где:**
- `styles.css:15028` — `.ts2-empty-title` 14/700.
- `styles.css:15028` — `.ts2-error-title` 14/700.
- `styles.css:11839` — `.bd-state-title` 16/700.
- `styles.css:15058` — `.ts2-empty-hero .ts2-empty-title` 17/700 (override).
**Брендбук:** Subtitle 18/500 для empty-state title.
**Должно быть:** Унифицировать в 18/500 (Subtitle). 14/700 — это «жирное BodySmall», читается как accent в обычном тексте, не как заголовок.
**Цена:** S.

### F17 — Empty-state copy «Нет данных по командам» / «— нет команд» — слабо и недружелюбно [High]
**Где:**
- `teamScanner2Renderer.js:2505` — «Нет данных по командам».
- `teamScanner2Renderer.js:2564` — «Нет данных по участникам за выбранные проекты».
- `teamScanner2Renderer.js:849` — `<span class="ts2-glance-lab">Нет данных</span>` (внутри group-line).
- `teamScanner2Renderer.js:3948` — «Нет данных — fetch не запускался».
- `teamScanner2Renderer.js:4023` — «${esc(p.label)} — нет: …».
- `teamScanner2Renderer.js:4426` — «Нет данных за последние 14 дней».
- `blackDashboardRenderer.js:251` — «Нет привязанных задач (поле «Domain link» пусто или не настроено)».
- `blackDashboardRenderer.js:290` — «— нет целей».
- `blackDashboardRenderer.js:578` — «— нет команд».
- `blackDashboardRenderer.js:581` — «— нет данных».
**Брендбук:** §7 Tone of voice — спокойный, тёплый, информирует (не уговаривает). Словарь — курс / траектория / ориентир / дрейф.
**Текущее:** «Нет данных» — техническая отписка. «— нет целей» с em-dash префиксом — лень дизайнера.
**Должно быть:**
- «Нет данных по командам» → «Команды ещё не загружены. Сверим курс — нажмите ↻ Обновить.» (плюс CTA-кнопка).
- «Нет привязанных задач» → «У этой цели нет связанных задач. Заполните Domain link в Sigma — Призма подтянет дерево.»
- «— нет целей» → «Sigma пока не вернула целей. Откройте настройки — добавьте ключи Goal-эпиков.»
- В renderEmpty:3411 «Нужны проектные ключи» — относительно ок, но стилистически: «Призма ждёт ориентир» / «Команда без курса — нужны ключи Jira-проектов».
- Никаких «—» или «нет данных» как одинокие фразы в empty-state.
**Цена:** M — 8-10 строк.

### F18 — «WIP» / «In Progress» — английские термины в русском UI [High]
**Где:**
- `teamScanner2Renderer.js:2360` — `{ key: 'inProgress', label: 'In Progress' }` (диалог настроек dwell-time, метка для пользователя).
- `teamScanner2Renderer.js:2550` — `<span>WIP</span>` (заголовок колонки multi-team).
- `teamScanner2Renderer.js:2777` — `WIP` (счётчик в person-row).
- `teamScanner2Renderer.js:3499` — «In Progress: 48 ч».
- `teamScanner2Renderer.js:4147` — `<label>In Progress (ч)</label>`.
- `teamScanner2Renderer.js:4160` — `_kv('In Progress', d.inProgress)`.
- `teamScanner2Insights.js` (через ImpactQueue) — может содержать `WIP`.
- `blackDashboardRenderer.js:271` — `▶ ${team.wip}` в team-head (визуально символ, но контекст англоязычный).
- `teamScanner2Renderer.js:2360` — массив колонок в dwell-config содержит ключи `'codeReview'`, `'qa'`, `'inProgress'`, `'todo'` с label'ами в которых видны англицизмы.
- HOW_SECTIONS:3499 — `<b>To Do / Open</b>: 72 ч`, `<b>In Progress</b>: 48 ч`, `<b>Code Review</b>: 8 ч`, `<b>QA / In Testing</b>: 16 ч`.
**Брендбук:** §7 Tone of voice — «партнёр, информирует, на «вы». Англицизмы для ключевых статусов нарушают «русскоязычный UI».
**Текущее:** Колонка «WIP», лейблы «In Progress», «Code Review», «QA».
**Должно быть:**
- WIP → «В работе» (long), «WIP» допустим только в технической диагностике / какой-то sub-debug панели. В person-row counter `<span class="ts2-counter-lab">WIP</span>` → `В работе` / уменьшить до `АКТИВ`.
- In Progress → «В работе».
- Code Review → «На ревью» / «Код-ревью» (последнее уже используется в `teamScanner2Renderer.js:4423` — оставить эту форму).
- QA / In Testing → «Тестирование».
- To Do / Open → «К работе».
**Цена:** M — 15+ мест.

### F19 — `Сводка` секции содержит «rolling 24h» [Medium]
**Где:** `teamScanner2Renderer.js:2892` — «Сводка <span class="ts2-panel-section-hint">— rolling 24h, для 1:1</span>».
**Брендбук:** §7 — на «вы», без англицизмов.
**Должно быть:** «Сводка <hint>— за последние 24 часа, для 1-на-1</hint>».
**Цена:** S.

### F20 — Кнопки: смесь «↻ Обновить» / «Загрузить» / «Сохранить» / «✓ Сохранить N изменений» [Medium]
**Где:**
- `teamScanner2Renderer.js:275` — «↻ Обновить» (символ, не Lucide).
- `teamScanner2Renderer.js:2440` — «Сохранить».
- `teamScanner2Renderer.js:4128` — «✓ Сохранить ${changed.length} изменений».
- `teamScanner2Renderer.js:3383` — «Загрузить данные команды».
- `teamScanner2Renderer.js:3387` — «Посмотреть демо».
- `teamScanner2Renderer.js:3419` — «Открыть настройки интеграций».
- `blackDashboardRenderer.js:199` — «↻ Обновить».
- `blackDashboardRenderer.js:607` — «Открыть настройки».
- `blackDashboardRenderer.js:615` — «Загрузить».
- `blackDashboardRenderer.js:679` — «Повторить».
**Брендбук:** §7 — глаголы первого лица: «Сверить», «Скорректировать», «Уточнить».
**Должно быть:** Использовать «Сверить курс» / «Сверим курс» вместо «Обновить» (важный момент: «Обновить» нейтрально, но «Сверить» — это callback к словарю Призмы и одновременно объясняет что происходит — мы запрашиваем актуальное состояние). Загрузить → «Запросить курс» / «Загрузить курс команды». «Повторить» → «Сверить ещё раз».
**Цена:** M — 8-10 кнопок, требует UX-согласования.

### F21 — `aria-label="Закрыть"` нормально, но `aria-label="Меню"` дублирует title [Low]
**Где:** `teamScanner2Renderer.js:278` — `title="Дополнительные действия" aria-label="Меню"` — два разных текста на одну кнопку.
**Брендбук:** WCAG 4.1.2 — Name, Role, Value. Когда title и aria-label расходятся, screen reader озвучивает aria-label, но visual tooltip показывает title — это рассогласование.
**Должно быть:** `aria-label="Дополнительные действия"` или общая обёртка через util.
**Цена:** S.

### F22 — Tooltip-длина превышает рекомендованные ~70 знаков [Medium]
**Где:**
- `teamScanner2Renderer.js:2982` — burnout chip title:
  > "Composite burnout-сигнал (видит только тимлид): … . Confidence: ${bo.confidence}. Сигналы: weekend>25%, lateNight>15%, WIP≥4, 5+д без коммитов. ВНИМАНИЕ: использовать для разговора, не для performance review."
  
  ~250 символов, читается тяжело.
- `teamScanner2Renderer.js:2917` — productivity chip title — ~240 символов.
- `teamScanner2Renderer.js:3067` — TG-copy title 5 строк через `&#10;` — это нормально для info, но nettricklikely.
**Брендбук:** §4 — длина строки 70 знаков для read-flow.
**Должно быть:** Tooltip ≤120 символов в одной строке. Длинные пояснения — `<details>` accordion в info-popover, не title. PR-CM (`styles.css:13193+`) уже даёт `data-tip` с max-width 320px — но текст всё равно слишком длинный, не помещается в 2 строки.
**Цена:** M.

### F23 — `.ts2-row` line-height 1.4 не задан явно — наследует body 1.5 [Low]
**Где:** `styles.css:14433` — `.ts2-row` нет `line-height`. `body { line-height: 1.5 }` (220).
**Брендбук:** §4 (строкой не задано, но Material standard 1.4 для body).
**Текущее:** Person-row высотой 10+padding+10 = 30px на 13/600 имени даёт ~46px row height. На full-screen 1080p помещается ~12 person-rows без скролла.
**Должно быть:** Если row сильно сжимать (~14 строк/screen) — line-height 1.3, padding 8/12 → 38px. Это даст «команда из 12 человек на одном экране без скролла», что даёт основной promise сканнера.
**Цена:** S.

### F24 — Density: subtask «Сводка дня» + «Action queue» + «Sprint health» + 7 sleeping-tile'ов = вертикальная портянка [High]
**Где:** `teamScanner2Renderer.js:1000-1010` — последовательный рендер 13+ блоков под team-glance:
- Daily brief
- Action queue
- Sprint health
- Scope churn detail
- Stale PRs
- Estimate accuracy
- Onboarding ramp
- Solo author files
- Zombie issues
- Sprint lag breakdown
- Sleeping data insights (7 tile'ов внутри)
- History trend row
**Брендбук:** §1 «Один взгляд на дашборд — и видно, куда движется команда».
**Текущее:** Тимлид утром скроллит 12-15 экранов. Между «Сводка дня» и person-rows — 6+ collapsible details, каждое имеет свой UPPERCASE-label.
**Должно быть:** Реструктурировать в 3 уровня:
1. **Hero** (всегда виден) — Health-score + 4 группы + sprint progress.
2. **Today** (collapsible, **открыто**) — Daily brief + Action queue + Top-3 stop.
3. **Operations** (collapsible, **закрыто** по умолчанию) — sprint health, churn, stale PRs, onboarding, zombies.
4. **Trends** — sparklines, history (закрыто по умолчанию).
5. **Sleeping data** — отдельный subtab «Глубже» (как в Чёрном дашборде).
Сейчас всё на main view → когнитивная перегрузка. Это не просто Density — это IA-проблема.
**Цена:** L — переструктуризация, но без переписывания контента.

### F25 — Sprint-gauge progressBar 60px, не достаточно для глаза [Low]
**Где:** `styles.css:13270` — `.ts2-sprint-bar { width: 60px; height: 6px }`. В topbar — рядом с заголовком.
**Брендбук:** Glance-понимание требует proportional readability.
**Текущее:** На 60×6px при 50% позицию tick'а различить тяжело — это 30px split.
**Должно быть:** 100×8px в topbar; для team-row gauges 80×6px остаётся.
**Цена:** S.

### F26 — `.ts2-h1` letter-spacing -0.2px, `.bd-title` без letter-spacing, `.prizma-page-h1` -0.01em — три разных tracking [Low]
**Где:** `styles.css:12350, 11587, 528`.
**Брендбук:** Headline 32/300 letter-spacing 0; Subtitle 18/500 letter-spacing 0.
**Должно быть:** Все «уровни H» letter-spacing 0 (брендбук), кроме `.prizma-page-h1` где -0.01em терпимо для optical correction крупного шрифта.
**Цена:** XS.

### F27 — Capitalization Title Case vs «На курсе» / «Стоп» [Medium]
**Где:**
- GROUP_META — «Требует разговора», «Под наблюдением», «Движется», «Без активности» — Title Case.
- В brandbook §3 Signal — «На курсе», «Дрейф», «Сбился с курса» — Title Case (capital first).
- `.ts2-group-head` UPPERCASE — то есть GROUP_META label (Title Case) → renderowany через `text-transform: uppercase` → «ТРЕБУЕТ РАЗГОВОРА».
- `teamScanner2Renderer.js:283` — кнопка «Показать заблокированных» (sentence-case).
- `teamScanner2Renderer.js:282` — «По командам» / «Одна команда» (Title Case).
- `bd-state-title` — «Sigma Jira не настроена» (sentence-case).
- BD goals chip status — «Завершено», «В работе», «Не начато» (Title Case в comment but lowered to lowercase — `bd-chip-todo` color: var(--text-3), text content from API).
**Брендбук:** §7 Tone of voice — спокойный, точный.
**Должно быть:** Жёстко зафиксировать:
- Заголовки H1/H2/H3 — Sentence case с заглавной первой («Сканнер команд», «Чёрный дашборд», «Покрытие по командам»).
- Eyebrow / Caption (10-11px UPPERCASE) — «КОМАНДА · СКАННЕР».
- Кнопки — глагол первого лица с заглавной («Сверить», «Загрузить», «Сохранить»).
- Signal-метки — Sentence case («На курсе», «Дрейф», «Сбился с курса»).
- В person-row chip status — Sentence case без UPPERCASE override.
Сейчас «Требует разговора» рендерится как «ТРЕБУЕТ РАЗГОВОРА» — длинный CAPS-блок не читается, нарушает спокойный голос.
**Цена:** M.

### F28 — Lack of Prizma vocabulary — «курс / дрейф / траектория» отсутствуют [High]
**Где:** Грепнул `teamScanner2Renderer.js` + `blackDashboardRenderer.js` + `integrationsRenderer.js` — слов «курс», «дрейф», «траектория», «ориентир», «компас» **нет ни одного раза**. Только в `views/integrationsView.js:185-189` — «Курс сверен · Jira» в toast. Внутри сканнера — техно-копи: «Сводка дня», «Кому помочь сегодня», «Action queue», «Что за «отстаём»?».
**Брендбук:** §7 — словарь Призмы (курс / траектория / ориентир / дрейф). §1 — позиционирование «помогаем команде удерживать курс». Сканнер команд — это и есть «компас» команды.
**Должно быть:** Заменить пять-семь ключевых формулировок:
- «Сводка дня» → «Сверка курса» (3-5 предложений нарратива именно про то, куда движется команда)
- «Кому помочь сегодня» → «Кто отклонился от курса»
- «Action queue» (`teamScanner2Renderer.js:1092`) → «Очередь сверки» / «Что скорректировать»
- «Sprint health» → «Курс спринта»
- «Pace: behind/ahead» → «Дрейф / Опережение / По курсу»
- «Что за «отстаём»? — разбор по спринтам» → «Где дрейф? — разбор по спринтам».
- Subtab «Сканнер команд» — норм; альтернатива «Курс команд». «Чёрный дашборд» → «Курс квартала» (в брендбуке §1 «дашборд» → «компас»).
- В empty-state «Сканнер готов к работе» → «Призма ждёт первый ориентир» (более тёплый).
**Цена:** L — требует UX-revision и согласования.

### F29 — `bd-team-mini` использует `✅ ▶ ☐` глифы [Polish]
**Где:** `blackDashboardRenderer.js:271` — `<span class="bd-team-mini">✅ ${team.done} · ▶ ${team.wip} · ☐ ${team.todo}</span>`.
**Брендбук:** §3 — Signal-цвет («На курсе» зелёный) и signal-dot — единый язык. Эмодзи + ASCII-glyph + box character = три разных языка иконок.
**Должно быть:** `<span class="signal-dot signal-on-course"></span> ${done}` / `<span class="signal-dot signal-information"></span> ${wip}` / `<span class="signal-dot signal-information signal-dot-pulse" style="opacity:.4"></span> ${todo}`. Signal-dot в брендбуке уже есть (styles.css:15775).
**Цена:** S.

### F30 — Health-score / Sprint Confidence label CAPS 10/700 — не Caption брендбука [Polish]
**Где:** `styles.css:12870` — `.ts2-hero-lab { font-size: 10px; font-weight: 700; letter-spacing: 0.8px; UPPERCASE }`. Подпись под Health-числом.
**Брендбук:** Caption 11/500/1.5px UPPERCASE.
**Должно быть:** 11/500/1.5px UPPERCASE.
**Цена:** XS.

### F31 — `signal-dot` для status-categories есть, но используется не везде [Medium]
**Где:** `styles.css:15775+` — отличная система signal-dot с 5 цветами. В `views/integrationsView.js:553` используется для black-dashboard subtab. В `bd-cov-fill` — нет, status-color через `.bd-kpi-green/yellow/red` (legacy). В `.ts2-team-chip-stop/-watch/-moving` — нет dot, только background-color.
**Брендбук:** §3 Signal-цвет только для статуса. Signal-dot — каноничный способ.
**Должно быть:** Везде где есть status-семантика (pace ahead/behind, group stop/watch/moving, kpi green/yellow/red) — `signal-dot` префикс.
**Цена:** M.

### F32 — Chip count «42» внутри `.ts2-action-queue-rank` без `tnum` хелпера [Polish]
**Где:** `styles.css:12601` — `.ts2-action-queue-rank` использует ui-monospace, font-feature-settings нет.
**Брендбук:** Default-tnum в body уже включён (styles.css:226). Но при `font-family: ui-monospace` глаф уже моноширинный — значит tnum дополнительно не критичен. Однако `.ts2-team-people` (13664) использует `font-feature-settings: "tnum" 1;` без указания font-family — то есть SF Pro + tnum (правильно).
**Должно быть:** Аудит всех 916 правил `.ts2-*` на наличие `font-family: ui-monospace` без `font-feature-settings: "tnum"` — снять monospace там где числа не aligned-критичны (имена, метки), оставить только для столбцовых данных.
**Цена:** M.

### F33 — Numerical density: 4×4 counter в person-row создаёт визуальный шум [Medium]
**Где:** `teamScanner2Renderer.js:2776-2780` — `WIP / PR / задач / часы` × 4 числа. В каждой строке persona — 4 числа + 24-dot strip × 2 + статус-chips.
**Брендбук:** §1 «Один взгляд». Когнитивная нагрузка.
**Должно быть:** Уменьшить до 2-3 ключевых: WIP + час + PR (или WIP + час). Остальное — в side-panel при expand. Сейчас тимлид видит 4 числа и не знает, на какое смотреть в первую очередь.
**Цена:** M.

### F34 — Margin/padding inconsistency: 6px vs 8px vs 10px [Polish]
**Где:**
- `.ts2-rows-inner` row gap 0 (через grid)
- `.bd-cov-list { gap: 6px }`
- `.bd-goals-list { gap: 8px }`
- `.bd-section-title { margin: 16px 0 8px }`
- `.ts2-glance-line { gap: 6px 10px }`
- `.ts2-row-badges { gap: 4px }`
- `.bd-team-issues { gap: 2px }`
**Брендбук:** не задаёт spacing scale, но Material/Apple — 4-base scale (4/8/12/16/24/32).
**Должно быть:** Зафиксировать spacing tokens (`--prizma-gap-xs: 4px`, `-sm: 8px`, `-md: 12px`, `-lg: 16px`, `-xl: 24px`) и использовать. Сейчас 2/3/4/5/6/8/10/12/14/16 — рваный grid.
**Цена:** L (cosmetic, но правильное вложение).

### F35 — Module indicator vs page-eyebrow дублирование [Low]
**Где:**
- `views/integrationsView.js:566` — `renderPageHeader('integrations', { sub: '...' })` рендерит eyebrow «КОМАНДА · ИНТЕГРАЦИИ» (или похожее).
- В topbar — `topbar-module-indicator` (styles.css:284) — тот же label.
- В сканнере — `.ts2-h1 «Сканнер команд»`.
- Subtab — «Сканнер команд» / «Чёрный дашборд».
**Брендбук:** не дублировать.
**Текущее:** «Сканнер команд» написан 3 раза на одной странице — module-indicator + page-h1 + subtab.
**Должно быть:** Page-h1 — название модуля («Интеграции»). Subtab подзаголовок «Сканнер команд» / «Чёрный дашборд». Внутри субтаба — без своего H1.
**Цена:** S.

### F36 — `.bd-state-icon` 36px эмодзи — не line-glyph [Polish]
**Где:** `blackDashboardRenderer.js:604,613,676` — иконки `⚙ 📥 ⚠`. 36px font-size (styles.css:11838).
**Брендбук:** §11 «никогда не круговой спиннер. Это не наш язык». Эмодзи — ещё дальше от языка Призмы.
**Должно быть:** Вместо `⚙` — `Icons.get('settings', { size: 36 })`. Empty-state — `prizmaEmptyGlyph()` (styles.css `prizma-empty-glyph` уже есть).
**Цена:** S.

### F37 — Tab-pill «DEMO» не определён по типографике [Polish]
**Где:** `teamScanner2Renderer.js:270` — `<span class="ts2-demo-tag">DEMO</span>`. CSS не найден в moих grep'ах (наверное в другой части `styles.css`).
**Брендбук:** Caption 11/500/1.5px UPPERCASE — каноничный для inline-метки «DEMO».
**Должно быть:** проверить и убедиться что demo-tag = 11/500/1.5px UPPERCASE с `--prizma-information-bg`.
**Цена:** XS.

## Идеи улучшения IA / читаемости

1. **Inverted pyramid layout**. Hero первым — 3 числа (Health / Sprint / Stop-count). Дальше — Today (Daily brief + Action queue), потом — Operations (sprint health, churn, stale, onboarding) свернуты по умолчанию, потом — Trends и Sleeping data на subtab «Глубже». Сейчас всё на main view — тимлид теряется.

2. **Person-row уменьшить до 2 чисел**. Имя · 24h-strip · 24h-strip-yest · WIP · часы · chev. Остальные badge'и (CR, PR, dwell, switches, src-chips, diff) — в side-panel при expand. 4-числа на строке × 12 человек = 48 числовых значений на скролл-frame.

3. **Группировка status-pills по принципу 4-цветовой signal-системы**. Сейчас статус «pace=behind» = красный (signal-off-course), «severity=100» action — тоже красный, «orphan» — тоже красный. Нужно: красный = «сбился с курса» (требует немедленного вмешательства); жёлтый = «дрейф» (наблюдать); зелёный = «на курсе»; синий = «информация» (NEW); фиолетовый = «инсайт». Не путать orange/red — сейчас 5+ оттенков красного.

4. **MonoNumber 24/300 для всех hero-чисел**. Hero, sprint-pct, kpi-val — единый класс `.prizma-num-mono` (уже есть, styles.css:15748). Снять собственные правила (.ts2-hero-num 36/800, .bd-kpi-val 28/800, .bd-cov-stats 11.5/700). Унификация даст «Призма-голос» цифр.

5. **Sprint-confidence sparkline — добавить «end-value badge»**. История за 14 дней (`renderSparkline` 220×36) сейчас без числовой подписи. Тимлид видит «кривая идёт вниз» но не знает absolute value. Добавить рядом mono-число последней точки + delta.

6. **Empty-state как ориентир, а не отписка**. В каждом empty-state — три обязательных уровня: (1) причина, (2) следующий шаг, (3) ссылка. «Призма пока не нашла команд. Откройте настройки → Jira → Project keys (через запятую). После сохранения нажмите «Сверить курс»». Сейчас «— нет команд» это deadtext.

7. **Caption-уровень 11/500/1.5px UPPERCASE — единственный canonical Caption**. Все 6 разных «UPPERCASE sub-headers» свести к одному стилю. Уберёт 50% визуального шума: глаз перестанет читать «9px / 0.5px / 400» и «10px / 0.6px / 700» как два разных уровня — он их видит как один шум.

8. **Russified domain vocabulary**. Заменить «WIP», «In Progress», «Code Review», «To Do», «orphans», «out-of-sprint», «sprint backlog» на русские эквиваленты («В работе», «На ревью», «К работе», «Без assignee» / «Без исполнителя», «Вне спринта», «Бэклог спринта»). Это 15-20 строк, но даст 100% russified UX внутри субтабов.

9. **Tooltip → Info-popover для длинного объяснения**. Tooltip ≤120 символов всегда, длиннее — `<details>` или `i`-кнопка с popover. Burnout-chip с 250-символьным title — анти-pattern (tooltip скрывается через 1 сек, прочитать невозможно).

10. **Unify TG-кнопка / share / 1:1 / how-button / config-button — в один kebab**. Топ-bar сканнера сейчас — refresh + diag-with-badge + kebab (5 пунктов). 5 кнопок горизонтально для тимлида = «5 опций → ладонь к лицу». Свести к: «Сверить курс» + «⋯ Меню» (всё остальное в menu-popover). Чёрный дашборд — то же.

---

**Итого:** 4 critical (двойной H1 + эмодзи + IA-портянка + russification), 9 high (типографика + empty-states + Prizma vocabulary), и десятки medium/polish правок шкалы / весов / spacing'ов. Главный вектор: сейчас сканнер — это «техно-консоль для тимлида», а должен быть — «компас команды» в брендбук-тоне.
