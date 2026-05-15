# 03 — Brand & Visual Design audit

## Сводка

- Critical: 7
- High: 11
- Medium: 9
- Low: 4
- Polish: 6

Главное: Сканнер команд 2.0 и Чёрный дашборд массово используют hex-палитру эпохи СБОФ (slate `#1a2035`/`#2d3f5e`, blue `#3b82f6`/`#93c5fd`, Tailwind utility-цвета `#f59e0b`/`#16a34a`/`#dc2626`) вместо токенов `--prizma-*`. Эмодзи заполняют tab-labels, кнопки и состояния. Чёрный дашборд содержит «meme face» loader с фиолетовым свечением, drop-shadow и круговым спиннером — три отдельных нарушения брендбука одновременно.

## Метод

- Прочитал брендбук v1.0 (`my_prisma-brand/BRAND_BOOK.md`, 407 строк).
- Файлы:
  - `integrations/teamScanner2Renderer.js` (4 587 LOC)
  - `integrations/teamScanner2.js` (2 269 LOC)
  - `integrations/blackDashboard.js` (234)
  - `integrations/blackDashboardRenderer.js` (682)
  - `integrations/integrationsRenderer.js` (177)
  - `integrations/loaderPhrases.js` (64)
  - `views/integrationsView.js` (646)
  - `styles.css` (18 116 LOC) — выборка по `ts2-`, `bd-`, `int-`, `intg-`, `signal-`
  - `theme.css` (214) — токены актуальной темы
- Регулярки:
  - `#[0-9a-fA-F]{3,6}` в правилах с in-scope префиксами
  - `linear-gradient|radial-gradient|conic-gradient`
  - `[\x{1F300}-\x{1F9FF}]|[\x{2600}-\x{27BF}]|✓|✕|⚠|🎯|🔗|📈|⚙|↻` (эмодзи и dingbat-символы)
  - `spin|rotate.*360|@keyframes.*spin` (запрещённые круговые спиннеры)
  - `drop-shadow|text-shadow|filter:.*blur|box-shadow.*glow` (свечение)
  - `text-transform.*uppercase|letter-spacing.*1\.5|font-feature-settings.*tnum` (Caption / mono-numerals)

## Находки

### F1 — Целый legacy-блок «slate/blue» в `body.theme-dark .int-*` [Critical]

**Где:** `styles.css:11239–11270` (32 правила подряд).

**Брендбук:** §3 Палитра — Night `#0A0A0F`, Twilight `#1A1A22`, Mist; принцип «не инверсия, а на той же hue-оси». §8 Темы — переключение через CSS-переменную, без хардкода.

**Текущее:**
```css
body.theme-dark .int-section { background: #1a2035; border-color: #2d3f5e; }
body.theme-dark .int-modal-box { background: #1a2035; }
body.theme-dark .int-stab.active { color: #93c5fd; border-color: #93c5fd; }
body.theme-dark .int-field-input { background: #1e2a40; border-color: #3f5284; color: #e2e8f0; }
body.theme-dark .int-btn:hover { background: #27406e; border-color: #5a7ac0; color: #dbeafe; }
…
```
Это палитра Tailwind `slate-800/700` + `blue-300/400` — родом из СБОФ-планировщика, ничего общего с Призмой.

**Должно быть:** заменить весь блок на токенный override либо удалить (если базовые `:root` правила уже покрывают тёмную тему через `--prizma-bg-elevated`, `--prizma-border`, `--prizma-information`):
```css
body.theme-dark .int-section { background: var(--prizma-bg-elevated); border-color: var(--prizma-border); }
body.theme-dark .int-stab.active { color: var(--prizma-information); border-color: var(--prizma-information); }
```

**Влияние:** в тёмной теме блок настроек выглядит как чужой стек (синие тоны вместо Twilight); ломает 60/20/15/5-пропорцию (15% текста стало синим); делает тематизацию неработоспособной — переключение `--prizma-*` ни на что не влияет.

**Рекомендация:** удалить весь `body.theme-dark .int-*` блок и сделать override через `[data-theme="dark"]` (как в `theme.css`), оставив только семантические токены.

**Цена:** M (нужно проверить визуально все 4 интеграции в обоих темах).

---

### F2 — «Meme face» loader Чёрного дашборда — multi-violation [Critical]

**Где:**
- `integrations/blackDashboardRenderer.js:631–672` (DOM)
- `styles.css:10454–10543` (CSS)

**Брендбук:**
- §3 Палитра — никаких декоративных purple/violet вне Signal Insight.
- §11 Loaders — L2 page-loader = знак (8-лучевая звезда) + breathe + ring + caption «УСТАНАВЛИВАЕМ КУРС». Никаких лиц, мемов, glow, drop-shadow.
- §12 Illegal usage — без свечения и теней; не вкладывать звезду в формы; знак самодостаточен.
- §10 Splash — единственная разрешённая визуальная драма — emerge → settle → exit, всё через звезду.

**Текущее:**
```css
.bd-loader-meme { background: radial-gradient(... #0a0a0a 0%, #000 60%); }
.bd-meme-eye { background: radial-gradient(ellipse, #e9d5ff 0%, #a78bfa 35%, #6d28d9 75%); 
               box-shadow: 0 0 14px 3px rgba(167,139,250,.55), 0 0 30px 6px rgba(124,58,237,.25); }
.bd-meme-grin { filter: drop-shadow(0 0 4px rgba(255,255,255,.5)); }
```
+ 4 keyframes (`bd-meme-blink`, `bd-meme-sway`, `bd-meme-fadein`, `bd-meme-grin-breath`), inline SVG с `<linearGradient>` и `<filter id="bd-meme-grin-glow">` (feGaussianBlur).

**Должно быть:** `renderLoader()` возвращает стандартный L2 loader Призмы:
```html
<div class="prizma-loader-page">
  <div class="prizma-loader-page-mark">{{star.svg inline}}</div>
  <div class="prizma-loader-page-caption">УСТАНАВЛИВАЕМ КУРС · СВЕРЯЕМ SIGMA + DELTA</div>
  <div class="bd-loader-elapsed" id="bd-loader-status">…</div>
  <button class="prizma-btn prizma-btn-ghost" id="bd-loader-cancel">Отменить</button>
</div>
```
(`prizma-loader-page-mark` уже описан в `styles.css:435–465` — нужно лишь подключить.)

**Влияние:**
1. Знак подменён мемом — фундаментальное нарушение бренд-метафоры.
2. Violet-glow ассоциируется с Insight (статусный цвет), но используется декоративно — ломает Signal-семантику.
3. Drop-shadow + box-shadow + text-shadow одновременно — полный набор illegal usage.
4. Чёрный фон поверх Twilight: `!important` сжигает тематизацию (loader всегда тёмный, даже в light-теме).
5. «Mood» инструмента: Призма — спокойный компас, не creepy uncanny-valley face.

**Рекомендация:** удалить целиком (`bd-loader-meme*` блоки + meme-keyframes + meme face SVG). Заменить на `renderPageLoader('Сверяем Sigma + Delta', etapsedSec)` из shared компонента.

**Цена:** M.

---

### F3 — Все Goals/Coverage chips на Tailwind-палитре [Critical]

**Где:** `styles.css:11761–11773` (chips), `11702–11712` (KPIs), `11807–11809` (coverage fills), `11891–11893` (% pct).

**Брендбук:** §3 — Signal-цвета только для статуса, и только из палитры (`#7FE8B5/#FFB347/#FF6B6B/#6EC1E4/#B084CC` для dark; светлый twin). Декоративный синий, зелёный, жёлтый, красный — запрещён.

**Текущее:**
```css
.bd-chip-done { background: #dcfce7; color: #14532d; border-color: #86efac; }   /* green-100/900/200 */
.bd-chip-wip  { background: #dbeafe; color: #1e3a8a; border-color: #93c5fd; }   /* blue-100/900/300 */
.bd-chip-todo { background: #f3f4f6; color: #4b5563; border-color: #d1d5db; }
.bd-kpi-blue  { background: #eef2ff; border-color: #c7d2fe; }                   /* indigo-50 */
.bd-kpi-green { background: #dcfce7; ... color: #14532d; }
.bd-cov-fill.bd-kpi-green .bd-cov-fill-inner { background: #16a34a; }           /* green-600 */
…
```
17 уникальных hex-цветов, ни один — не из брендбука.

**Должно быть:**
```css
.bd-chip-done { background: var(--prizma-on-course-bg); color: var(--prizma-on-course); 
                border-color: color-mix(in srgb, var(--prizma-on-course) 30%, transparent); }
.bd-chip-wip  { background: var(--prizma-information-bg); color: var(--prizma-information); … }
.bd-chip-todo { background: color-mix(in srgb, var(--prizma-text-tertiary) 12%, transparent); 
                color: var(--prizma-text-secondary); … }
.bd-kpi-green { background: var(--prizma-on-course-bg); color: var(--prizma-on-course); border-color: …; }
.bd-cov-fill.bd-kpi-green .bd-cov-fill-inner { background: var(--prizma-on-course); }
```
И отдельный override в `[data-theme="light"]` НЕ нужен — токены уже двухцветные.

**Влияние:** Coverage-bars и chips выглядят как Linear/Asana (зелёный/синий/жёлтый Tailwind), не как Призма (мятный/янтарный/коралловый Signal). 5%-Signal-budget превышен в 4-5 раз — каждый chip кричит цветом.

**Рекомендация:** одной миграцией заменить bd-chip-* и bd-kpi-* на токены; удалить `body.theme-dark .bd-chip-*` дубликаты — токены сами развернутся.

**Цена:** M.

---

### F4 — Эмодзи в production UI: tab labels, кнопки, состояния [Critical]

**Где:**
- `integrations/blackDashboardRenderer.js:182–184` — tab-labels `{label: '🎯 Цели'}`, `'🔗 Покрытие'`, `'📈 Метрики'`.
- `integrations/blackDashboardRenderer.js:196` — `<h3 class="bd-title">⚫ Чёрный дашборд</h3>`.
- `blackDashboardRenderer.js:271` — `<span class="bd-team-mini">✅ ${done} · ▶ ${wip} · ☐ ${todo}</span>`.
- `blackDashboardRenderer.js:434` — `<span class="bd-chip">✓ цель</span>`.
- `blackDashboardRenderer.js:468` — `title="✓ Завершено · ◐ В работе · ○ Не начато"`.
- `blackDashboardRenderer.js:581` — `🎉 Все эпики/истории привязаны к целям!`.
- `blackDashboardRenderer.js:604/612/676` — state-icons `⚙ / 📥 / ⚠`.
- `blackDashboardRenderer.js:668` — loader phrase fallback `⏳ Просыпаюсь, потягиваюсь…`.
- `blackDashboardRenderer.js:671` — `<button>✕ Отменить</button>`.
- `views/integrationsView.js:553` — sub-tab Чёрный дашборд использует `signal-dot` (правильно), но текстовое название «Чёрный дашборд» содержит черноту-как-метафору без черноты в визуале.
- `integrations/teamScanner2Renderer.js`: 30+ вхождений (`📋 Диагностика`, `❓ Как считается`, `⚙ Настройка команд`, `👥 По командам`, `✓ Показать заблокированных`, `⚠ stale`, `↻ carry`, `↻N`, `▌Nh`, `💬`, `🔗`, `🔍`, `🔒`, `⚠️`, `🟢/🟡/🔴`, `ℹ️`).
- `integrations/teamScanner2.js`: 15+ вхождений (`✓ скопировано`, `📊`, `🚫`, `🔧`, `🗣 1:1`, `👤`).
- `integrations/loaderPhrases.js:11–47` — 37 фраз, КАЖДАЯ начинается с эмодзи (`🤖`, `☕`, `🐌`, `🎯`, `🧠`, `🐘`, `🛸`, `🪄`, `☁️`, `🐙`, `🥷`, `🪜`, `🦥`, `🚀`, `🐢`, `🍿`, `🐉`).
- `integrations/integrationsRenderer.js:20` — `⚙ Настройки интеграций`.
- `integrationsRenderer.js:45/69/92/115` — `<span class="int-token-ok">✓ Сохранён</span>` (× 4).

**Брендбук:** §7 ToV — «без эмодзи»; примеры «плохо: `Лучшая в мире платформа для команд 🚀`». §5 Иконки — только семья 8-лучевой звезды или Lucide line-glyph.

**Должно быть:**
- Tab-labels — без эмодзи. Можно префиксовать SVG-иконкой из семейства (`assets/brand/modules/goals.svg` для «Цели», новая `coverage.svg` или `link.svg` Lucide-line для «Покрытие», `metrics.svg` для «Метрики»).
- `✓ Сохранён` → `signal-dot signal-on-course` + текст «сохранён».
- `↻ Обновить` → SVG (Lucide `refresh-cw` line) + слово «Сверить курс».
- `⚠ stale` → `signal-dot signal-drift` + «данные устарели» (или Призма-формулировка «дрейф данных»).
- Loader-phrases — без эмодзи. Если хочется humour, оставить чистый текст: «Беру у джуна интервью», «Грею GPU. Зимой это бонус» — звучит даже лучше без эмодзи (см. §7 «спокойный, не тревожный»).
- `🟢/🟡/🔴` → `signal-dot` с правильным класcом (`on-course/drift/off-course`).
- `📋 Диагностика` → SVG-иконка (Lucide `clipboard-list`) + слово.

**Влияние:** интерфейс выглядит как Slack/Telegram-bot, а не как Призма. Tab-bar Чёрного дашборда (`🎯 / 🔗 / 📈`) — иконки разной визуальной весомости, разной семантики, не Призма-семья.

**Рекомендация:** массовый swap. Делать одной волной (1 PR, label «brand: emoji removal») — иначе превратится в half-state. Loader phrases переписать заново (37 фраз × 2-3 секунды показа = можно даже сократить до 12 без потерь).

**Цена:** L (но один проход).

---

### F5 — Спиннеры с круговой rotation 360° (3 шт.) [Critical]

**Где:**
- `styles.css:10382–10389` — `.pp-loader-spinner` + `@keyframes pp-spin { to { transform: rotate(360deg); } }` — используется в `bd-loader` (line 10428).
- `styles.css:10864–10872` — `.int-loader-spinner` + `@keyframes int-loader-spin`.
- `styles.css:7729–7738` — `.funny-loader-spinner` + `@keyframes funny-spin`.
- (Pulse `pp-loader-spinner` вне scope, но `bd-loader` импортирует именно его — хвост зависимости.)

**Брендбук:** §11 Loaders — «**Никогда не круговой спиннер. Это не наш язык.**» (точная цитата). Только L1 inline pulse (`scale 0.85↔1.0`), L2 page loader (звезда + breathe + ring), L3 skeleton shimmer.

**Текущее:**
```css
.bd-loader-spinner { 
  width: 56px; height: 56px;
  border-radius: 50%;
  border: 4px solid color-mix(...);
  border-top-color: var(--prizma-information);
  animation: pp-spin .9s linear infinite;
}
@keyframes pp-spin { to { transform: rotate(360deg); } }
```

**Должно быть:** `.bd-loader-spinner` и `.int-loader-spinner` удалить целиком. Использовать `prizma-loader-page` (см. F2).

**Влияние:** прямое нарушение текстового запрета брендбука. В коде встречается даже `int-loader-spin` — для маленьких inline-загрузок (verify Jira) — там должен быть `prizma-loader-inline` (pulse, уже описан в `styles.css:419–428`).

**Рекомендация:** удалить keyframes `pp-spin`, `int-loader-spin`, `funny-spin` (последний — не наш scope, но в той же эпохе). Заменить usages.

**Цена:** S.

---

### F6 — `body.theme-dark .bd-*` тёмные оверрайды на slate-палитре [Critical]

**Где:** `styles.css:11707–11849` (32 правила).

**Брендбук:** §3, §8 — токенный override.

**Текущее:**
```css
body.theme-dark .bd-kpi { background: #1f2937; border-color: #374151; }     /* gray-800 */
body.theme-dark .bd-kpi-green { background: #064e3b; ... color: #a7f3d0; }   /* green-900/200 */
body.theme-dark .bd-team-block { background: #111827; }                       /* gray-900 */
body.theme-dark .bd-issue-type { background: #374151; }
body.theme-dark .bd-cov-track { background: #374151; }
body.theme-dark .bd-empty { background: #111827; border-color: #374151; }
…
```
Полный mid-tone грей вместо Twilight `#1A1A22` (это _глубже_ #111827 — заметно тёплее и мрачнее).

**Должно быть:** используя `--prizma-bg-elevated`, `--prizma-bg-tertiary`, `--prizma-border`. После F3 (chips на токенах) большинство этих оверрайдов удалится автоматически.

**Влияние:** Чёрный дашборд на тёмной теме фактически серый, а не Чёрный (Night `#0A0A0F` — это _действительно_ почти чёрный, гораздо темнее `#1f2937`).

**Рекомендация:** см. F1 — общий refactor `body.theme-dark` блоков.

**Цена:** M (вместе с F1 + F3).

---

### F7 — Black Dashboard `bd-loader` (без -meme) использует `--prizma-information` для loader-фона [High]

**Где:** `styles.css:10413–10446`:
```css
.bd-loader { background: linear-gradient(135deg, color-mix(... var(--prizma-information) 6%), ...);
             border: 1px dashed color-mix(... var(--prizma-information) 26%); }
```

**Брендбук:** §3 — Information `#6EC1E4` зарезервирован для статуса (info). На loader-фоне Information читается как «эта операция в категории Информация», что неправильно (loader — нейтральное состояние ожидания, не статус).

**Должно быть:** прозрачный фон или `var(--prizma-bg-elevated)`. Никаких Signal-tints для нейтрального ожидания. Border — `var(--prizma-border)`.

**Влияние:** ломает Signal-семантику. Если потом в этом же интерфейсе появится action «настройте Information-уровень», пользователь увидит эту синюю dashed-обёртку и подумает, что что-то пошло не так.

**Цена:** S.

---

### F8 — Decorative Tailwind-палитра в светлом fallback `body:not(.theme-dark) .ts2-*` [High]

**Где:** `styles.css:21–55` (22 правила «tint-fallbacks для самых видимых классов»).

**Текущее:**
```css
.ts2-glance-help-item { background: rgba(220, 38, 38, 0.08); }     /* red-600 alpha */
.ts2-sprint-filter-on { background: rgba(79, 70, 229, 0.10); }     /* indigo-600 alpha */
.ts2-sprint-filter-warn { background: rgba(245, 158, 11, 0.12); }  /* amber-500 alpha */
.ts2-sh-checkpoint-mid { background: rgba(79, 70, 229, 0.12); color: #4f46e5; }
.ts2-narrative-section { background: #f5f4ff; }
.ts2-zombie-count { ...color: #b45309; }
.ts2-team-tab-active { background: var(--bg-2, #f1f5f9); }
…
```

**Брендбук:** §3 Signal только для статуса. Декоративный indigo / amber / red запрещён.

**Должно быть:** на токенах. `ts2-sprint-filter-warn` это статус «дрейф» → `var(--prizma-drift-bg)` + `var(--prizma-drift)`. `ts2-team-tab-active` — нейтральное активное состояние, должно быть 3px stripe-left (см. §spine-pill в `docs/`), не filled.

**Влияние:** в светлой теме сканнер играет всеми цветами Tailwind — пёстро и не «editorial calm».

**Цена:** M.

---

### F9 — `int-cross-warning` / `int-cross-info` stripe-left на hex [High]

**Где:** `styles.css:11004–11005`:
```css
.int-cross-item.int-cross-warning { border-left: 3px solid #f59e0b; }
.int-cross-item.int-cross-info    { border-left: 3px solid #3b82f6; }
```

**Брендбук:** §3 — Drift `#FFB347` (dark) / `#B5670A` (light); Information `#6EC1E4` / `#1F6B96`.

**Должно быть:**
```css
.int-cross-item.int-cross-warning { border-left: 3px solid var(--prizma-drift); }
.int-cross-item.int-cross-info    { border-left: 3px solid var(--prizma-information); }
```
(Это правильное использование Signal — статус «требует внимания» = drift; «инфо» = information. Только цвет неправильный.)

**Цена:** XS.

---

### F10 — `.ts2-group-stop/watch/moving/idle` stripe-left хардкод [High]

**Где:** `styles.css:14405–14408`:
```css
.ts2-group-stop   { border-left: 3px solid var(--danger,  #dc2626); }
.ts2-group-watch  { border-left: 3px solid var(--warning, #f59e0b); }
.ts2-group-moving { border-left: 3px solid var(--success, #10b981); }
.ts2-group-idle   { border-left: 3px solid var(--text-4,  #94a3b8); }
```

**Брендбук:** §3 Signal-семантика — это и есть статус «курс». stop = off-course, watch = drift, moving = on-course, idle = mist (нейтральный).

**Должно быть:**
```css
.ts2-group-stop   { border-left: 3px solid var(--prizma-off-course); }
.ts2-group-watch  { border-left: 3px solid var(--prizma-drift); }
.ts2-group-moving { border-left: 3px solid var(--prizma-on-course); }
.ts2-group-idle   { border-left: 3px solid var(--prizma-text-tertiary); }
```

**Влияние:** на тёмной теме `--success: #10b981` (Tailwind emerald-500) более кричащий, чем брендовый `--prizma-on-course: #7FE8B5` (мятный) — ломает «5% Signal-budget».

**Цена:** XS (4 строки).

---

### F11 — Tone of voice: «выполнено / закрыто / WIP» вместо Призма-словаря [High]

**Где:**
- `blackDashboardRenderer.js:271` — `✅ ${done} · ▶ ${wip} · ☐ ${todo}` (выполнено / в работе / не начато).
- `teamScanner2Renderer.js:348/360/626/713` — «закрыто», «сделано».
- `teamScanner2Renderer.js:1527/1612/2538/2550/2777` — «WIP» как метка интерфейса (не как технический термин).
- `blackDashboardRenderer.js:606/613/677` — «не настроена», «готов к загрузке», «Ошибка загрузки».

**Брендбук:** §7 Словарь — курс / траектория / ориентир / дрейф; «не подведите команду!» = плохо. Вместо «WIP» — «в работе» / «в траектории». Вместо «закрыто» — «завершено» / «вышло на курс». Вместо «Ошибка загрузки» — «Не удалось сверить курс».

**Должно быть:**
- `Done · WIP · TODO` → `завершено · в траектории · не начато` или (если хочется бренда) `на курсе · идём · ожидание`.
- `WIP-counter` на per-person — оставить число + «активные» (не «WIP»).
- `closed/done` (в копи-кнопках) — заменить на «завершено» / «доехало».
- Loader status «Идёт запрос к Sigma + Delta» → «Сверяем курс по Sigma + Delta».
- В существующем коде уже есть toast «Курс сверен · Jira» (`integrationsView.js:185`) — это эталонная Призма-формулировка. Распространить везде.

**Влияние:** 50% UI говорит языком Jira-админа, 50% — языком Призмы. Раздвоение голоса.

**Цена:** M (диалоговая редактура, ~80 строк правок).

---

### F12 — `int-token-ok` хардкод mint-green [High]

**Где:** `styles.css:11214`:
```css
.int-token-ok { background: #d1fae5; color: #065f46; }     /* emerald-100/900 */
```
И в HTML: `<span class="int-token-ok">✓ Сохранён</span>` (× 4).

**Брендбук:** §3 — On-course `#7FE8B5`/`#0F8A5F`. Не emerald.

**Должно быть:**
```css
.int-token-ok { background: var(--prizma-on-course-bg); color: var(--prizma-on-course); }
```
+ убрать ✓ из текста, заменить на `<span class="signal-dot signal-on-course"></span> Сохранён`.

**Цена:** XS.

---

### F13 — `int-status-ok` дублирует ту же mint-green ошибку [High]

**Где:** `styles.css:9500`:
```css
.int-status-ok { background: #d1fae5; color: #065f46; ... }
```

Та же история, что F12.

**Цена:** XS.

---

### F14 — Coverage fill-bar на trio Tailwind hex [High]

**Где:** `styles.css:11807–11809`:
```css
.bd-cov-fill.bd-kpi-green  .bd-cov-fill-inner { background: #16a34a; }   /* green-600 */
.bd-cov-fill.bd-kpi-yellow .bd-cov-fill-inner { background: #ca8a04; }   /* amber-600 */
.bd-cov-fill.bd-kpi-red    .bd-cov-fill-inner { background: #dc2626; }   /* red-600 */
```

И вне inner — `.bd-cov-fill { background: rgba(99,102,241,.18); }` (indigo).

**Брендбук:** Coverage = статус, значит Signal. green → on-course, yellow → drift, red → off-course.

**Цена:** XS.

---

### F15 — Tab-pill активный = filled background, не stripe-left [High]

**Где:** `styles.css:9526` (`.int-subtab-active`), `styles.css:11258–11259` (theme-dark .int-stab.active), Black Dashboard tabs (`bd-tab-active` — не нашёл явного правила, но реализован как `border-bottom-color`).

**Брендбук:** §spine-pill (CLAUDE.md §«Принципы дизайна») — «3px stripe-left для активных/выделенных элементов вместо filled background».

**Текущее:** sub-tabs Сканнер / Чёрный — bottom-border + filled-color. Не stripe-left, но согласно brandbook это вертикальные навигационные элементы — допустимо bottom-border при условии что внутри row-list есть stripe-left для выбранного человека/команды.

**Проверка:** `ts2-team-tab-active { background: var(--bg-2, #f1f5f9); }` (line 54) — _filled_ background для активного, нарушает spine-pill.

**Должно быть:**
```css
.ts2-team-tab-active { 
  background: transparent;
  box-shadow: inset 3px 0 0 var(--prizma-information);
  /* или border-left: 3px solid var(--prizma-information); */
}
```

**Цена:** S.

---

### F16 — Декоративный fef9c3-yellow на `bd-empty bd-empty-success` (мажорное empty-state) [Medium]

**Где:** `blackDashboardRenderer.js:581` + `styles.css:11829`:
```html
<div class="bd-empty bd-empty-success">🎉 Все эпики/истории привязаны к целям!</div>
```
```css
.bd-empty-success { background: #dcfce7; color: #14532d; border-color: #86efac; }
```

**Брендбук:** §7 «Хорошо: Команда сверяет курс на пятницу. Плохо: ВНИМАНИЕ! 3 задачи просрочены, срочно действуйте!». «🎉» + восклицание = тревожный/хвастливый tone.

**Должно быть:**
```html
<div class="bd-empty bd-empty-success">Курс выдержан — все эпики привязаны к целям.</div>
```
+ token-based фон через `var(--prizma-on-course-bg)`.

**Цена:** XS.

---

### F17 — Иконки модулей не семья 8-лучевой звезды [Medium]

**Где:** Tab-icons Чёрного дашборда (`🎯 🔗 📈`), kebab-меню Сканнера (`❓⚙👥📋`).

**Брендбук:** §5 — «Каждый модуль — вариация звезды. Это семья, не отдельные иконки». Файлы — `assets/brand/modules/{course,goals,team,path,rituals}.svg`.

**Текущее:** иконки модулей не используются в integrations-tab вообще. Tab-bar использует эмодзи (см. F4) или Lucide (см. integrationsView.js где `Icons.get('eye')`).

**Должно быть:**
- «Цели» (Goals tab) → `assets/brand/modules/goals.svg` (если есть).
- «Команда» (Сканнер) → `assets/brand/modules/team.svg`.
- «Покрытие», «Метрики» — если нет в семье 8-лучевой звезды, использовать Lucide-line (link, bar-chart-3).
- Все одного weight (1.5px stroke), одного размера (16px в tab-bar), одного цвета (var(--prizma-text-secondary)).

**Цена:** S.

---

### F18 — `bd-loader-status` использует `font-family: ui-monospace` для technical-feel [Medium]

**Где:** `styles.css:10437`:
```css
.bd-loader-status {
  font-size: 13px; color: var(--text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

**Брендбук:** §4 Типографика — JetBrains Mono для чисел в дашбордах, координаты, технические подписи. Loader status — это _текст_ типа «Идёт запрос к Sigma + Delta · 4 с», ne числовые координаты.

**Должно быть:** SF Pro / Inter (var(--font)). Если хочется выделить «4 с» monospace — обернуть только число `<span class="num-tnum">4</span>`.

**Цена:** XS.

---

### F19 — `bd-error-banner` хардкод amber/yellow [Medium]

**Где:** `styles.css:11593–11594`:
```css
.bd-error-banner { background: #fef3c7; border: 1px solid #f59e0b; color: #78350f; }
body.theme-dark .bd-error-banner { background: #422006; border-color: #92400e; color: #fde68a; }
```

**Брендбук:** Drift `#FFB347/#B5670A`. Off-course — для критических.

**Должно быть:** 
- Если это warning (errors[] from server, partial success) → `var(--prizma-drift-bg)` + `var(--prizma-drift)`.
- Если ошибка прервала операцию полностью → `var(--prizma-off-course-bg)` + `var(--prizma-off-course)`.

(Семантически в коде это «errors из server response с частичными данными» — drift, не off-course.)

**Цена:** XS.

---

### F20 — `bd-diag-rule-name`, `bd-diag-row` Tabular numerals не настроены [Medium]

**Где:** `styles.css:11652-11700` (диагностика — нет `font-feature-settings: "tnum"`).

**Брендбук:** §4 «Mono-tabular numerals на числах в дашбордах». В `_renderDiagnosticsDetails` числа `seedCount=24, expandedCount=189` отрисовываются обычным шрифтом — колонки не выравниваются.

**Должно быть:** `.bd-diag-val { font-feature-settings: "tnum"; }` или `.bd-diag-num` обёртка.

**Цена:** XS (1 строка).

---

### F21 — `bd-cov-stats` использует `var(--font-mono)` без tnum [Medium]

**Где:** `styles.css:11810`:
```css
.bd-cov-stats { ... font-family: var(--font-mono); font-size: 11.5px; ... }
```

**Брендбук:** §4 — JetBrains Mono для чисел. Mono без `tnum` всё равно выровнен (mono = равная ширина), но `tnum` гарантирует это явно.

**Должно быть:** добавить `font-feature-settings: "tnum"`.

**Цена:** XS.

---

### F22 — `int-modal-title` content `⚙ Настройки интеграций` [Medium]

**Где:** `integrationsRenderer.js:20`.

**Брендбук:** §5 — без эмодзи в production UI.

**Должно быть:** `<div class="int-modal-title"><span class="prizma-mark prizma-mark-sm" aria-hidden="true"></span> Настройки интеграций</div>` или с Lucide settings-line.

**Цена:** XS.

---

### F23 — Tabs Чёрного дашборда: filled-text-color активного без stripe [Medium]

**Где:** Bd-tab-active реализован в `styles.css` где-то в районе 11848+ (поиск показал что класс используется через JS, конкретный CSS можно не нашёл явно — пробежался). Эффект: активный таб — другой цвет текста (`var(--prizma-information)`?).

**Брендбук:** spine-pill 3px stripe-left для row-level активности; для tab-bar допустим bottom-border (как в `int-subtab-active:526`).

**Проверка:** в `index.html` и view не нашёл явных `.bd-tab-active` правил для stripe — нужно проверить визуально. Если activetab = filled-background — нарушение.

**Цена:** XS (если нарушение).

---

### F24 — `body.theme-dark .ts2-team-tab-active` использует `var(--card, #fff)` [Medium]

**Где:** `styles.css:55` (uxp `.ts2-vc-tab-active { background: var(--card, #fff); }`).

**Текущее:** на тёмной теме `--card` должен быть Twilight, fallback `#fff` означает что в проекте без `--card` => всегда белый.

**Должно быть:** `var(--prizma-bg-elevated)` без fallback на белый (Призма всегда определяет токены).

**Цена:** XS.

---

### F25 — Loader phrases без эмодзи всё равно слабые [Low]

**Где:** `loaderPhrases.js`.

**Брендбук:** §7 «спокойный, не тревожный»; «уверенный, не хвастливый». 

**Текущее:** «Запускаю CEO-режим, держитесь…», «🐲 Дрессирую Cloners-цепочку…», «🔍 Под микроскопом разглядываю Domain link…» — это подростковый/«lol jk»-голос. Юмор есть, но НЕ Призма-юмор.

**Должно быть (вместо meme'ов):**
- «Сверяем курс по Sigma и Delta…»
- «Проверяем привязку эпиков к целям…»
- «Считаем покрытие. Это занимает минуту.»
- «Готовим траекторию команд…»
- «Раскладываем Domain link по полочкам…»

3-4 спокойных фразы — лучше 37 джунско-мемных.

**Цена:** S (заменить весь массив).

---

### F26 — `bd-cov-pk` mono-pill цвет на тёмной теме хардкод [Low]

**Где:** `styles.css:11794` `body.theme-dark .bd-cov-pk { background: #374151; color: #d1d5db; }`.

Должно быть `var(--prizma-bg-tertiary)` + `var(--prizma-text-secondary)`.

**Цена:** XS.

---

### F27 — Diagnostics chevron `▸` text-icon [Low]

**Где:** `blackDashboardRenderer.js:163` — `<span class="bd-diag-chev">▸</span>`. Также `.bd-goal-chev` (line 233/245).

**Брендбук:** §5 — line-glyph SVG, не unicode-символы.

**Должно быть:** Lucide `chevron-right` 12px, который ротируется при `details[open]` через CSS `[open] .bd-diag-chev { transform: rotate(90deg); }`.

**Цена:** XS.

---

### F28 — Кнопка `↻ Обновить` (refresh) не использует SVG [Low]

**Где:** `blackDashboardRenderer.js:199`, `teamScanner2Renderer.js:275`.

**Брендбук:** §5 + Lucide `refresh-cw`.

**Должно быть:** `<button class="prizma-btn"><svg>...</svg> Сверить курс</button>` (см. F11 — слово тоже).

**Цена:** XS.

---

### F29 — Polish: `--prizma-bg` fallback `#0A0A0F` всё-таки в коде [Polish]

**Где:** `styles.css:11432` (`.ob-welcome-overlay { background: var(--prizma-bg, #0A0A0F); }`).

Не в нашем scope (onboarding), но это паттерн. В `int-*` правилах токены идут без fallback (после F1) — хорошо.

**Цена:** N/A.

---

### F30 — Polish: `bd-loader-meme .int-btn-ghost` прокрученный с `border-color: #404040` [Polish]

**Где:** `styles.css:10475`.

При удалении meme-loader (F2) этот override уйдёт автоматически. Сейчас даже на 5 секунд показа кнопка «Отменить» — серая Tailwind, не Призма-ghost.

**Цена:** N/A.

---

### F31 — Polish: дубликат `bd-loader { background: linear-gradient... }` для theme-dark [Polish]

**Где:** `styles.css:10445` `body.theme-dark .bd-loader { background: linear-gradient(135deg, rgba(99,102,241,.08), rgba(99,102,241,.03)); }`.

`rgba(99,102,241,...)` — indigo-500 alpha, не Призма Information.

**Цена:** XS (после F2 уйдёт).

---

### F32 — Polish: `bd-loader-meme .bd-loader-phrase` text-shadow-on-loader [Polish]

**Где:** `styles.css:10471` `text-shadow: 0 1px 2px rgba(0,0,0,.8);`.

§12 запрет теней. Уйдёт с F2.

---

### F33 — Polish: `bd-loader` `border: 1px dashed` — необычное оформление для loader [Polish]

**Где:** `styles.css:10421`.

Dashed-border = «временное / placeholder». Loader — это active-state, не placeholder. Если оставить (без meme), сделать solid `var(--prizma-border)`.

---

### F34 — Polish: BD не использует skeleton-shimmer для длительных запросов [Polish]

**Брендбук:** §11 — > 6s = L3 skeleton. Sigma+Delta fetch занимает 8-30 секунд (сам loader пишет «Может тормозить»). Должен показываться skeleton goals/coverage/metrics-таблиц + маркер-звезда в углу.

**Должно быть:** после первых 6 секунд `bd-loader-status` показывает время и переключается на skeleton-разметку (готовые места под KPIs / coverage-rows / metrics-grid).

**Цена:** M (новый компонент).

---

## Идеи улучшения (UX/визуал без потери функционала)

1. **Меньше chip-color, больше типографики.** Сейчас в Goals/Coverage 4-5 цветных pill'ов на строке (status, count, error, missing, good). Заменить большую часть на CAPS-Caption-стиль (`text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; font-weight: 500`) — статус читается как метаданные, а не как кричащая лампочка. Цвет оставить только для одного pill `.bd-statuschip` (он несёт реальный смысл).

2. **Coverage-bar как градусник, не как color-coded thermometer.** Вместо «зелёный/жёлтый/красный» fill-цветов — единый Information-цвет, насыщенность которого зависит от %. Низкий % = блёклый mint (3% насыщенности `var(--prizma-on-course)`), высокий = полная насыщенность. Информацию о пороге дать numeric badge справа — `< 40%` отрисовать в `.signal-off-course` Caption, `40-70%` в drift, `> 70%` в on-course. Bar — единая семантика, цифра — Signal.

3. **«Чёрный дашборд» → переименовать в Призма-словаре.** «Чёрный» = непрозрачный = отсутствие цвета = противоположность «света». В Призме нет чёрного как метафоры. Варианты: «Цели квартала», «Северный курс», «Маяк целей». Subtab-label короткий. (Ребрендинг — задача для Product, но визуально вкладка не должна быть _чернее_ остальных.)

4. **Loader с реальным прогрессом, а не с phrases.** Sigma+Delta fetch = serial steps (1 — Sigma load goals, 2 — Delta expand seed-keys, 3 — coverage compute). Показать линейный прогресс из 3 шагов с галочкой завершения каждого (через `signal-dot signal-on-course`). Пользователь видит «1/3 ✓ Sigma; 2/3 идёт Delta…» — понятно где затык. Phrase rotation — убрать целиком.

5. **Ссылку на Jira-issue в Coverage делать через типографический weight, не через blue underline.** Сейчас issue-key (`PAY-123`) — синяя ссылка. Заменить на mono-monospace Caption-style без подчёркивания, с подчёркиванием только на hover. Минус 50% визуального шума в таблице из 100 строк. Цена: 3 строки CSS.

6. **Сделать heatmap-strip в Сканнере читаемым в swipeable-mode.** Сейчас 24 ячейки × 14px = 336px wide. На MacBook 13" в split-view не помещается. Альтернатива: 12 ячеек × 24h-bucketing с `font-feature-settings: "tnum"` numbers внутри каждой ячейки (показывать число событий). Текст-плотность вместо dot-плотности — лучше для accessibility и read-at-glance.

7. **Заменить ↻ refresh-кнопку на «Сверяем курс…» state-toggle.** Кнопка сейчас всегда `↻ Обновить`. После клика становится `<spinner> Загружаем…`. После успеха — `✓ Курс сверен · 12:34`. Это idle → active → confirmed cycle через одну кнопку, без отдельного toast. Меньше UI-движения.

8. **Tooltip-text в Caption-стиле, не Body-стиле.** Сейчас все `title="..."` атрибуты браузерные tooltips, отрисовка системная. Заменить на кастомный tooltip-component с Caption-typography (11px, letter-spacing 1.5px, uppercase). Минус: затраты на компонент. Плюс: единый голос — даже tooltip говорит на «языке Призмы».

9. **Empty-state без 🎉.** Сейчас «Все эпики привязаны к целям 🎉». Заменить на иллюстрацию — статичная 8-лучевая звезда + Caption-text «Курс выдерживается. Все эпики на траектории.» Editorial calm, не tinder.

10. **Перевести `WIP=3 Stop` в Caption-метку.** Per-person row сейчас показывает `(3 WIP)`. Заменить на `<span class="signal-tag signal-drift">в траектории — 3 задачи</span>` — статус и метрика одновременно, без аббревиатуры.

---

## Итоговая map — приоритеты

| Тип | Кол-во | Цена | Действие |
|---|---|---|---|
| Critical (F1, F2, F3, F4, F5, F6) | 6 | M-L | Отдельный sprint «brand: integrations cleanup» |
| High (F7-F15) | 9 | XS-M | Внутри critical-sprint, последняя волна |
| Medium (F16-F24) | 9 | XS-S | Подметание после crit/high — 1-2 PR |
| Low (F25-F28) | 4 | XS | Polish-PR |
| Polish (F29-F34) | 6 | XS | Долёт после remediation — самовосстановятся |

---

## Версия

Brand audit v1.0 · 2026-05-04 · scope: Сканнер команд 2.0 + Чёрный дашборд + Integrations settings.
