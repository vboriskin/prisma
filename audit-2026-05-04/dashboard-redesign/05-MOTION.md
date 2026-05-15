# 05 — MOTION-аудит вкладки «Дашборд»

> Read-only ревизия моушна на странице **Дашборд** проекта Призма.
> Базис — брендбук §9 (Emerge / Breathe / Pulse / Align), четыре жеста,
> принципы спокойствия и `prefers-reduced-motion`.
>
> Источники, на которые я опираюсь:
> - `my_prisma-brand/BRAND_BOOK.md` §9 (стр. 262–298) — длительности и easing.
> - `my_prisma-brand/tokens/motion.json` — спецификация в JSON.
> - `my_prisma-brand/tokens/theme.css` — определены keyframes
>   `prizma-emerge-core`, `prizma-emerge-ray`, `prizma-breathe`,
>   `prizma-pulse-ring`, `prizma-align`, `prizma-loader-inline`,
>   `prizma-shimmer` + универсальный `prefers-reduced-motion`-rule.
> - `views/dashboard.js` — render-pipeline (KPI / progress / risks /
>   blocking / release-cards / teams / no-release / needs-confirm).
> - `styles.css` — фактический набор keyframes, transition-токены и
>   reduced-motion handles.
> - `audit-2026-05-04/12-user-feedback.md` — пять персон. Дмитрий: «нет
>   feedback после drop’а», Светлана: «звезда дышит — это успокаивает»,
>   Анна: «не вдохновляет — просто экран с цифрами».

---

## Section 1. Motion на дашборде — что есть сейчас

| # | Элемент / селектор | Жест | Где определён | Reduced-motion handle |
|---|---|---|---|---|
| 1 | `.prizma-mark` (звезда в топбаре) | **Breathe** (4s loop) | `styles.css:266-272` + `@keyframes prizma-breathe` :310 | yes — `:316-319` (`animation: none; opacity: 1`) |
| 2 | `.prizma-hero-mark` (8-лучевая звезда в hero дашборда, 64×64) | **Breathe** (4s loop) — П4 Sec 7 | `styles.css:574-580` (`animation: prizma-breathe 4s ease-in-out infinite`) | yes — `:582-584` |
| 3 | `.prizma-empty-glyph` (звезда в empty-state «Курс ещё не проложен») | **Breathe** (4s loop, opacity 0.3) | `styles.css:2926` | yes — `:2928` |
| 4 | `.kpi-card` hover | hover-transition (`box-shadow`, `transform: translateY(-1px)`) | `styles.css:1215-1220` (transition .2s) | нет явного — но это `transform`, под общий reduced-motion в `theme.css:166-173` (universal `animation-duration: 0.01ms`) подпадает только `animation`, не `transition` |
| 5 | `.progress-card` (карточки релизов 1.20–1.22 / OT / Всего) | `ui-fade-up` при первом монтировании (`var(--motion-mid)`, ~240ms) | `styles.css:5168-5173` + `@keyframes ui-fade-up` :2903 | косвенно через universal-rule в `theme.css` (но reduce_motion-блок есть только для `animation`, и iter=1 — fade всё ещё проиграется) |
| 6 | `.progress-bar-fill` (заполнение бара процента готового) | `transition: width .4s var(--ease-emphasis)` (~Align-подобное) | `styles.css:5183-5186` | нет (transition не покрыт universal-правилом, см. Section 8) |
| 7 | `.modal-overlay > .modal-box` (KPI-modal при клике на карточку) | **Align** (spring) — `modal-align-in` 200ms | `styles.css:17204-17210` (Wave 4 P10.13-17) | yes — `:17218-17225` |
| 8 | `.modal-overlay.closing .modal-box` | fade-down 160ms | `styles.css:17211-17217` | yes — там же |
| 9 | `.signal-dot.signal-dot-pulse` (используется в дашборде у `progress-counts` — "Перегрузка") | **L1 inline-pulse** (1400ms loop, scale+opacity) | `styles.css:15728-15730` + `prizma-loader-inline` :153 (theme.css) | косвенно через universal reduced-motion |
| 10 | `.app-section.section-enter` (вход на section) | `section-enter` 240ms (Y-fade) | `styles.css:1165` + `@keyframes section-enter` :2902 | нет явного |
| 11 | `.kpi-card-clickable` hover focus | стандартный transition.box-shadow / transform | те же `:1215-1220` | — |

**Вывод по фактам.** Брендбук-инструменты для дашборда **уже в коде**:
- `prizma-breathe`, `prizma-emerge-core`, `prizma-emerge-ray`,
  `prizma-pulse-ring`, `prizma-align` определены в `tokens/theme.css`.
- На дашборде из четырёх жестов **используются только два**:
  Breathe (3 точки) + Align (KPI-modal).
- Жесты **Emerge** и **Pulse** на дашборде не подключены.
  Это и есть «motion-долг» — Анна и Дмитрий чувствуют его как «не дышит,
  кроме звезды» и «нет feedback после действия».

---

## Section 2. Где motion должен быть, но его нет (8 точек)

> Каждая точка — read-only рекомендация. Длительности и easing'и сверены
> с брендбуком §9 и `motion.json`.

### 2.1. Появление KPI-сетки после загрузки

- **Где:** `#dashboard-kpi` (12 KPI-карточек).
- **Жест:** **Emerge** + stagger.
- **Зачем:** дашборд приходит «с ноля» каждый раз при заходе. Сейчас все
  карточки появляются мгновенно — глаз не понимает, что это новая порция
  данных, рябит. Emerge с stagger 60ms даёт иерархическое прочтение
  (слева-направо, сверху-вниз).
- **Длительность:** 420ms на карточку, easing `--prizma-ease-calm`
  (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Триггер:** первый рендер `DashboardView.render()` → `renderKPIs()`,
  опционально и при смене фильтров (тогда — короткий 240ms-вариант).
- **Реализация (без правок):** существующий `ui-fade-up` ближе к Emerge,
  чем к чему-либо другому, но `prizma-emerge-core` точнее по семантике.

### 2.2. Hero-блок при первом рендере

- **Где:** `#dashboard-prizma-header` (звезда + KPI-число %  + 3 supporting-числа).
- **Жест:** **Emerge** для KPI-числа и supporting; **Breathe** на mark уже есть.
- **Зачем:** число «КУРС КВАРТАЛА %» — главная цифра страницы. Сейчас
  она просто появляется. Брендбук § Splash / § Loaders говорит о
  «звезде, передающей курс в idle» — hero-число должно проявляться как
  продолжение этой передачи.
- **Длительность:** opacity 0→1 + translateY 8→0 за 320ms,
  caption — 200ms через 80ms задержки, supporting — stagger 40ms.
- **Триггер:** mount `DashboardView._renderPrizmaHeader`.

### 2.3. Изменение числа KPI при обновлении данных (refresh / smart-sync)

- **Где:** `.kpi-value` внутри каждой `.kpi-card`.
- **Жест:** **Align** (spring lite) на цифре, без вращения — `scale 0.92 → 1.04 → 1` 320ms.
- **Зачем:** числа меняются «беззвучно» — пользователь не видит, что
  «12 рисковых» стало «9». Брендбук §9 принцип 3: «Align — настройка
  курса, смена контекста». Переход числа = смена контекста.
- **Длительность:** 320ms, easing `--prizma-ease-spring`.
- **Триггер:** detect `oldValue !== newValue` при следующем render —
  достаточно сравнить `data-prev-value` с новым.

### 2.4. Pulse на критическом сигнале (риск, блокирующая зависимость, перегрузка)

- **Где:**
  - `kpi-card.signal-off-course` (овертайм, блокеры, риски >0);
  - `risks-panel` если `риски ≥ 1`;
  - `progress-counts .signal-dot.signal-drift` (overload >30 задач).
- **Жест:** **Pulse** (`prizma-pulse-ring`) — кольцо 1600ms ease-out,
  loop. Применяется **только** пока сигнал «свежий» (новая запись с
  прошлого визита) или критический (off-course).
- **Зачем:** Анна — «дайте, что делать сейчас». Pulse — то самое
  визуальное «здесь надо посмотреть». Брендбук §9.3 явно для этого жеста.
- **Длительность:** 1600ms loop, easing decel.
- **Триггер:** `state.lastSeen.dashboard < record.changedAt` или
  `severity === 'off-course'`. **Не декоративно** — иначе теряет силу.

### 2.5. Появление release-cards (1.20 / 1.21 / 1.22 / OT / Всего)

- **Где:** `#release-breakdown .release-card` × 4 + блок «Всего».
- **Жест:** **Emerge** stagger 80ms между карточками.
- **Зачем:** 4 равноценных блока — без stagger глаз «теряет» иерархию
  чтения. Сейчас они приходят через `ui-fade-up` + animation 240ms,
  но без stagger — все одновременно.
- **Длительность:** 360ms на карточку, stagger 80ms (всего 600ms).
- **Триггер:** mount `renderReleaseBreakdown`.

### 2.6. Progress-bar fill (анимация заполнения процента)

- **Где:** `.progress-bar-fill[width=…%]`.
- **Жест:** **Align** (полупружина) — сейчас стоит `transition: width .4s var(--ease-emphasis)`, но `--ease-emphasis` не из брендбук-палитры.
- **Зачем:** % готового — это «настройка курса». Spring-easing
  `--prizma-ease-spring` даст лёгкий overshoot, ощущение «бар встаёт
  на курс», что как раз семантика Align.
- **Длительность:** 600ms, easing `--prizma-ease-spring`.
- **Триггер:** обновление `width` (state-derived).

### 2.7. Появление таблиц «Без релиза» / «Требует подтверждения»

- **Где:** `#no-release-wrap .data-table-wrap`, `#needs-confirm-wrap .data-table-wrap`.
- **Жест:** **Emerge** на контейнер + skeleton-shimmer (брендбук §11 L3) если данные ещё не пришли.
- **Зачем:** блоки нижнего ряда — «информация без давления». Если
  пользователь дочитал до них, он уже в режиме «погружения». Emerge
  спокойный (420ms) — не отвлекает.
- **Длительность:** 420ms каждая, последовательно после release-cards.

### 2.8. Переход в Реестр через KPI-modal CTA («Открыть в реестре»)

- **Где:** `#modal-kpi-goto-registry` click → `App.goTo('registry')`.
- **Жест:** **Align** на иконке модуля в топбаре (`.topbar-module-indicator.is-aligning .topbar-module-icon`) — keyframe **уже есть** в `styles.css:300-307`. Сейчас не триггерится с дашборда, только при общей смене раздела, но проверить — точно ли срабатывает при `goTo()`.
- **Зачем:** брендбук §9.4: Align — «настройка курса при смене контекста».
  Переход дашборд → реестр с фильтром = смена контекста по определению.
- **Длительность:** 1600ms (по брендбуку), easing spring (уже есть).
- **Триггер:** `App.goTo` с диффом `prevSection !== nextSection`.

---

## Section 3. Где motion перебор

**Кратко: на самом дашборде — нет.** Сейчас дашборд скорее «недомоушен»,
чем «перемоушен». Но три точки на грани:

1. **`.prizma-empty-glyph`** breathe-loop в empty-state, opacity 0.3 —
   на грани читаемости, но всё-таки уместно: «пустой курс ещё дышит,
   ждёт данных». Оставить.
2. **`.kpi-card:hover` translateY(-1px)** на 12 карточках одновременно —
   если пользователь ведёт мышь по сетке, всё прыгает. Это не motion-перебор,
   а UX-quirk. В рамках жестов брендбука — нейтрально.
3. **`section-enter` 240ms** на каждом переходе раздела поверх
   `modal-align-in` (если возвращаешься из modal) — могут наслоиться.
   В коде это не блокирующая проблема, но если будут добавлены
   recommendations 2.1–2.5, надо аккуратно проследить, чтобы Emerge не
   накладывался на section-enter.

---

## Section 4. Принципы motion для дашборда

> 6 правил, по которым проверяется любая будущая моушн-добавка на этой странице.

1. **Числа меняются Align'ом, не fade-only.**
   Любой `.kpi-value`, hero-KPI и progress-pct при смене значения
   проигрывают Align (`scale 0.92 → 1.04 → 1` 320ms spring).
   Просто fade — это Sber-old-style. У Призмы числа «настраиваются на курс».

2. **Появление KPI после load — Emerge с stagger 60ms.**
   12 карточек сетки и 4 release-cards читаются как иерархия: stagger
   даёт глазу путь чтения. Без stagger — это «ослепление сеткой».

3. **Hero-mark всегда Breathe’ит (текущее поведение, не трогать).**
   Это идентификатор бренда на дашборде. Останавливается **только** при
   `prefers-reduced-motion: reduce`.

4. **Pulse — только на новом критическом сигнале.**
   Pulse-loop **не декоративный**. Применяется к
   `signal-off-course` элементам (овертайм >0, блокеры >0, риски >0)
   и снимается, как только пользователь увидел/закрыл сигнал.
   Иначе он перестанет работать — глаз игнорирует постоянное «мигание».

5. **При prefers-reduced-motion — убираем transform/scale/rotation.**
   Остаются только opacity-переходы и цвет. `prizma-breathe` →
   `opacity: 1` без `scale`. `prizma-pulse-ring` → static border.
   Универсальный rule в `tokens/theme.css:166-173` уже бьёт по
   `animation-duration`, но **не по transition** — нужны точечные overrides.

6. **Одна анимация за раз на одном элементе** (брендбук §9 принцип 3).
   На `.kpi-card` не должно одновременно играть Emerge и Pulse —
   сначала Emerge (мгновение появления), затем Breathe-idle,
   затем при триггере — Pulse поверх.

---

## Section 5. Sequencing — порядок появления при первом рендере

> Сценарий: пользователь только что зашёл в раздел Дашборд, splash
> завершился, hero-mark получает breathe (брендбук §10 «передача в idle»).

```
0ms      hero-mark begin breathe-loop (continuous)
60ms     hero-kpi-value (КУРС КВАРТАЛА %) emerge
            opacity 0→1, translateY 8→0, 320ms calm
140ms    hero-caption emerge 200ms calm
180ms    hero-supporting items × 3 emerge with stagger 40ms
            (180 / 220 / 260ms)
360ms    kpi-grid begin: 12 cards emerge, stagger 50ms
            (last card finishes at 360 + 11×50 + 240 = 1150ms)
500ms    progress-grid begin: 5 release-cards emerge, stagger 80ms
            (last card finishes at 500 + 4×80 + 240 = 1060ms)
800ms    risks-panel + blocking-detail-card emerge параллельно
            (320ms каждый)
1000ms   release-breakdown × 4 emerge stagger 80ms
            (last finishes at 1000 + 3×80 + 240 = 1480ms)
1200ms   teams-summary table emerge 320ms
1400ms   no-release-table + needs-confirm-table emerge stagger 100ms
1700ms   total sequence — done. dashboard в idle: только hero breathe.
```

ASCII-схема (по группам):

```
hero-mark        ●━━━━━━━━━━━━━━━━━━━━━━━━━━━ breathe
hero-kpi-num         ▓▓▓▓
hero-caption           ▓▓
hero-supporting          ▓▓ ▓▓ ▓▓
kpi-grid (12)              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
progress-cards (5)              ▓▓▓▓▓▓▓
risks/blocking                       ▓▓▓
release-breakdown                       ▓▓▓▓▓▓
teams-summary                                ▓▓▓
tail tables                                     ▓▓ ▓▓

           |0|---|400|---|800|---|1200|---|1700ms|
```

Общая длительность sequence: **~1700ms**. После этого страница «дышит»
только через hero-mark (4s loop).

---

## Section 6. Reduced-motion правила

> Контракт: если у пользователя `prefers-reduced-motion: reduce`,
> дашборд **остаётся читаемым и информативным**, но без движения.

### Полностью выключается

- `prizma-breathe` на hero-mark, prizma-mark в топбаре, empty-glyph
  (опции: `animation: none`, `opacity: 1`, `transform: none`).
- `prizma-pulse-ring` (signal-pulse на сигналах) — кольцо становится статичной 2px-обводкой.
- `prizma-align` (rotation на иконке модуля) — статика.
- Stagger-Emerge в kpi-grid / release-cards — мгновенное появление.
- `transition: transform` на `.kpi-card:hover` — заменяется на изменение border-color.

### Остаётся

- `opacity` переходы (это не motion в строгом смысле — это smooth state-change).
- Цветовые transitions (smooth theme-switch, hover bg).
- Border-color переходы.
- Всё, что не зависит от `transform / scale / rotate`.

### Upgrades (graceful fallback)

- `breathe` на hero-mark → static opacity 0.85 (точка покоя в keyframe 0%).
- `prizma-pulse-ring` → static `outline: 2px solid var(--prizma-information)` без анимации (Анна всё равно видит "тут сигнал").
- Number-Align → плавный `opacity 0.6 → 1` 200ms.
- Progress-bar fill → мгновенное `width` без transition.

### Что в коде уже корректно

- `styles.css:316-319, 410-412, 491-…, 582-584, 2928, 7354-…, 17175-17186, 17218-17225` — точечные `prefers-reduced-motion` блоки.
- `tokens/theme.css:166-173` — универсальный fallback (`animation-duration: 0.01ms`).

### Что неочевидно

- Universal-rule в `tokens/theme.css` бьёт по `animation` и
  `transition-duration`, но **не отменяет** `transform` в transition.
  Поэтому `:hover { transform: translateY(-1px) }` всё ещё сработает.
  При работе над этой страницей нужно добавить адресные `:hover {
  transform: none }` для reduced-motion.

---

## Section 7. CSS-mockup ключевых жестов (иллюстрация, не для копипасты)

```css
/* === DASHBOARD MOTION MOCKUP — не вставлять, опорный псевдо-CSS === */

/* 1. KPI emerge с stagger (12 карточек) */
.kpi-grid > .kpi-card {
  opacity: 0;
  transform: translateY(8px);
  animation: prizma-emerge-core 420ms var(--prizma-ease-calm) both;
}
.kpi-grid > .kpi-card:nth-child(n)  { animation-delay: calc(60ms * (var(--i, 0))); }
/* :nth-child через --i, выставляемый JS, или :nth-child(N) хардкодом */

/* 2. Hero-KPI emerge */
.prizma-hero-kpi {
  animation: prizma-emerge-core 320ms var(--prizma-ease-calm) 60ms both;
}
.prizma-hero-supporting-item:nth-child(1) { animation-delay: 180ms; }
.prizma-hero-supporting-item:nth-child(2) { animation-delay: 220ms; }
.prizma-hero-supporting-item:nth-child(3) { animation-delay: 260ms; }

/* 3. Number-Align при смене значения (требует JS-trigger через class) */
@keyframes prizma-number-align {
  0%   { transform: scale(0.92); }
  60%  { transform: scale(1.04); }
  100% { transform: scale(1); }
}
.kpi-value.is-changing {
  animation: prizma-number-align 320ms var(--prizma-ease-spring);
}

/* 4. Pulse на критическом сигнале (loop, only на off-course) */
.kpi-card.signal-off-course[data-fresh="1"]::after {
  content: '';
  position: absolute; inset: 0;
  border: 2px solid var(--prizma-off-course);
  border-radius: var(--radius);
  animation: prizma-pulse-ring 1600ms var(--prizma-ease-decel) infinite;
  pointer-events: none;
}

/* 5. Reduced-motion overrides — точечно */
@media (prefers-reduced-motion: reduce) {
  .kpi-grid > .kpi-card,
  .prizma-hero-kpi,
  .prizma-hero-supporting-item,
  .kpi-value.is-changing,
  .kpi-card.signal-off-course::after { animation: none; }

  .kpi-card:hover { transform: none; }
  .kpi-card.signal-off-course[data-fresh="1"]::after {
    /* fallback: static outline вместо pulse-ring */
    animation: none;
    opacity: 1;
  }
}
```

---

## Section 8. Спорные моменты и брендбук-расхождения

### 8.1. Конфликт motion vs IA: чтение KPI-сетки

12 KPI с Emerge stagger 60ms → 12 × 60 = 720ms. Если пользователь
зашёл в дашборд второй раз за минуту (например, после save и возврата),
720ms перерисовки воспринимается как «лаг». Решение: cache «уже видел
этот dashboard в текущей сессии», и второй раз показывать без stagger
(только короткий fade 120ms).

### 8.2. Раздражение опытных юзеров (Дмитрий, Игорь)

Дмитрий явно сказал, что motion на навигации = 3 минуты потерянного
времени за день. Игорь — что **отсутствие** motion после действия
утомляет. Это противоречие решается **семантической дисциплиной**:
- Эмбиент-motion (breathe, idle) — для всех, минимальный.
- Action-feedback motion (Pulse, Align на drop, number-Align) — обязателен.
- Decorative motion (transition на hover translateY) — отключаем для
  опытных через настройку «Меньше анимации» (отдельная от reduced-motion,
  это запрос Игоря).

### 8.3. Брендбук §9 принцип «Одна анимация за раз»

В sequence (Section 5) у нас одновременно идут breathe (hero) +
emerge (KPI) + emerge (progress-cards). Формально это **разные элементы**,
но ощущение «одна за раз» проверяется глазом: hero — это «фоновая
константа», emerge'ы — «приходящая иерархия». На практике конфликта нет,
но если кто-то добавит на этом промежутке Pulse — суммарно станет шумно.
Контракт: **во время первого render-sequence (~1700ms) Pulse не запускается**,
даже если есть критические сигналы. Pulse подключается через 200ms после
завершения sequence.

### 8.4. Hero-mark + KPI-modal align — конфликт focus

Когда пользователь кликает KPI-card → modal-align-in 200ms (spring),
hero-mark продолжает breathe в фоне. Это в порядке (modal — overlay,
hero — позади). Но при возврате (modal-align-out → section ещё
существует) **не должен** проигрываться повторный Emerge на KPI-сетке.
Сейчас в коде это не происходит (sequence триггерится только на
mount), и так должно остаться.

### 8.5. `--ease-emphasis` ≠ `--prizma-ease-spring`

В `styles.css:124` определены `--ease-standard` и `--ease-emphasis` —
это **legacy-токены**, не из брендбука. Брендбук-токены — `--prizma-ease-*`
(определены в `tokens/theme.css:115-118`). На дашборде сейчас используются
оба набора (progress-bar-fill — `--ease-emphasis`, modal-align — spring
из брендбука). Расхождение: формально progress-bar играет «не-prizma»
кривой. Долгосрочно: мигрировать `--ease-emphasis → --prizma-ease-spring`,
`--ease-standard → --prizma-ease-calm`. Сейчас не критично, но это
накопленный дизайн-долг.

### 8.6. Универсальный reduced-motion rule в `tokens/theme.css:166-173`

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Это «ядерное» правило. Минусы:
- бьёт по **любому** transition, включая полезные (theme switch),
  который сам брендбук разрешает (240ms).
- Не отменяет `transform` свойств в `:hover`.
- Конфликтует с точечными `prefers-reduced-motion` overrides в
  `styles.css` (там часто `animation: none` — это совместимо, но
  `opacity: 1; transform: none` — переопределит универсальное «1ms»
  и это ОК; ровно ради этого они и стоят точечно).

Вывод: для будущих motion-добавок на дашборд **не полагаться** на
универсальное правило, а писать точечные `@media` блоки рядом с keyframe
(как уже сделано в `:316-319`, `:582-584`, `:17175-17186`, `:17218-17225`).

---

## Резюме motion-стратегии

- **Breathe** — оставить как есть (hero-mark, topbar-mark, empty-glyph). Это бренд-константа.
- **Emerge** — добавить на mount KPI-сетки и release-cards со stagger. Это quick-win против фидбэка Анны «не вдохновляет».
- **Pulse** — добавить точечно на off-course-KPI и активные риски, **не декоративно**. Это quick-win против фидбэка Дмитрия «нет ощущения, что данные живые».
- **Align** — расширить на: number-change в `.kpi-value` и `progress-bar-fill`. Modal-align уже есть.
- **Reduced-motion** — для каждой новой keyframe-точки писать **адресный** `@media` блок (не полагаться на универсальное правило).
- **Sequence ≤ 1700ms** на первый render. Cached re-render ≤ 120ms (только opacity).

---

Отчёт записан в audit-2026-05-04/dashboard-redesign/05-MOTION.md, длина 445 строк.
