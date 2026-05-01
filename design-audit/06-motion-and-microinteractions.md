# 06. Motion и микровзаимодействия

> **Роль**: motion-дизайнер. Где интерфейс не дышит, какие моменты пустуют, и как добавить характера через движение.

## 1. Текущая «motion-карта»

### Что уже работает

| Где | Что | Длительность | Easing | Оценка |
|---|---|---|---|---|
| Toast | `translateY(12px → 0)` + opacity | ≈400ms (in/out) | Default ease | ✓ Хорошо |
| Modal overlay | opacity 0 → 1 | ~140ms | Default | ✓ Норм |
| Modal box | `translateY(10px) scale(.98) → 0/1` | 240ms | `--ease-emphasis` | ✓ Хорошо |
| Section enter | opacity + `translateY(6px → 0)` | 240ms | `--ease-standard` | ⚠️ Слишком тихо |
| FAB pulse | `box-shadow: 0 0 0 0 → 0 0 0 6px transparent` | 3s loop | linear | ✓ Хорошо для accent |
| KPI fillGrow | `width: 0 → calc(var(--p) * 1%)` | (варьируется) | ease | ✓ Существует |
| Pie spin in | `scale(.8) rotate(-18deg) → 1/0` | (варьируется) | ease | ✓ Хорошо |
| Gantt cell-receive | `glow` через `box-shadow` | 900ms | ease-out | ⚠️ Слишком слабо для drag-and-drop ack |
| Gantt arrow flow | dashed-line `stroke-dashoffset` анимация | (варьируется) | linear | ✓ Хорошо |
| FAB on hover | `transform: translateY(-1px)` + `box-shadow` upgrade | 140ms | `--ease-standard` | ✓ Норм |
| Section transitions | `scroll-behavior: smooth` глобальный | n/a | n/a | ⚠️ Нежелателен (см. ниже) |

### Что **отсутствует** или работает плохо

| Где | Проблема |
|---|---|
| **Hover на nav-item** | `background-color` через transition, но **нет глубины** (всё едино) |
| **Active nav-item** | Mгновенный, без motion-acknowledgment («я перешёл сюда сейчас») |
| **Inline-edit** в Реестре | Появляется input, без visual transition (пользователь не видит, что cell стал editable) |
| **Bulk-action** completion | Toast 1.5s — единственная feedback. Нет «осязаемого» подтверждения (например, выделенные строки не «mark» как изменённые) |
| **Save successful** (Storage.flushNow) | Молчит. Пользователь не знает, что данные сохранены. |
| **Filter applied** | Таблица rerender моментально, без feedback «новые данные подгружены» |
| **CSV import success** | Toast + страница перерисовывается. Нет «приходящего» эффекта новых строк. |
| **Drag в Ганте — drop успешен** | Cell-receive glow есть (900ms `box-shadow`), но **очень слабый** для такого осмысленного действия |
| **LLM streaming response** | Текст появляется по мере прихода токенов — это есть, но без cursor-blinking / typewriter-feel |
| **Tab switching** | section-enter 240ms — но при быстрых переключениях ощущается как **тормоз**. Должен быть короче или мгновенным для повторных переходов. |
| **Loading states** | Spinner у Pulse, но в большинстве случаев нет skeleton-loading — просто пустой блок до прихода данных |
| **Empty states** | Просто текст. Нет «дыхания», нет персонажа. |

---

## 2. Почему motion важен в этом продукте

В B2B-инструменте motion — не «украшение», а **функция feedback'а**:

1. **Ощущение скорости** — даже быстрая операция, если она не даёт «звукового удара», воспринимается медленнее.
2. **Уверенность в действии** — пользователь делает bulk-action на 50 строк, ему нужно **физически знать**, что прошло.
3. **Орientation** — при переключении больших view'ов (Реестр → Гант) motion помогает не «потеряться».
4. **Identity** — характерное motion-language делает продукт **узнаваемым** (Linear, Things, Notion — у каждого своё).

---

## 3. Где не хватает «жизни» по конкретным экранам

### 3.1 Дашборд

**Сейчас**: загружается → все блоки появляются одновременно через `section-enter` (translate 6px). Нет разделения «hero / body / reference».

**Что добавить**:
- **Stagger-анимация** при первом приходе на страницу: блоки появляются с лагом 50-80ms между ними. Hero → KPI → Risks → Detail → Releases → Tables.
- **Number countup** на KPI numbers (от 0 → итоговое число за 600-800ms). Сейчас — мгновенно.
- **Progress-bars** на Release-breakdown — анимировать `width` от 0 до целевого % за 500-700ms (есть `fillGrow`-keyframe — но не используется во всех местах).
- **Risks-panel** — при появлении нового критического риска: **lighter pulse** (3 цикла за 1.5s), затем спокойное состояние.

### 3.2 Реестр

**Сейчас**: таблица — статичная. Hover на строку — `background: --row-hover`. Inline-edit на клик — input появляется без перехода.

**Что добавить**:
- **Inline-edit transition**: cell-blur → cell-border-glow 200ms → input fades in. Создаёт ощущение «cell открылась».
- **Save успешный**: cell-flash green-tint 400ms → fade обратно.
- **Filter changed**: rows fade-out → новые строки fade-in. Не блок-перерендер, а смена «занавесей».
- **Bulk-select**: selected rows получают **persistent ring** (1px solid accent на левом краю), который слегка пульсирует, чтобы пользователь не забыл что их сколько-то.
- **Scroll position lock**: при `Storage.save` или filter-change — НЕ скроллить вверх (это уже частично в коде `app.js _AUTO_RERENDER_GRACE_MS`, но не везде).

### 3.3 Гант (детальный)

**Сейчас**: drag-and-drop работает. После drop — `cell-receive` glow 900ms (очень слабый). Postpone-arrows рисуются SVG.

**Что добавить**:
- **Drag start**: pill, которую тащим, получает `scale(1.05)` + `shadow-lg` + `cursor: grabbing`. Сейчас просто drag без визуального «лифт-офф».
- **Drag over valid drop-zone**: target-cell **подсвечивается** ярко-accent border + slight scale на target-cell (1.02).
- **Drop successful**: target-pill **bounces in** (scale 0.7 → 1.1 → 1) за 400ms + glow ring fades 800ms. Это значимое действие — оно должно **звучать**.
- **Drop cancelled** (drag away): pill returns с small bounce-back, не моментально.
- **Add new wt via «+»**: picker появляется с slight slide-down + scale (как dropdown). Сейчас instant.
- **Postpone-arrow draw**: при первой отрисовке стрелки — `stroke-dashoffset` анимируется с `1000 → 0` за 1.2s, рисуется как ручная линия. Это уже есть, но только у `gdt-arrow-flow` keyframe — применять на initial render.

### 3.4 Канбан

**Сейчас**: minimal motion. Hover карточек — `translateY(-1px)`.

**Что добавить**:
- **Card hover**: `translateY(-2px)` + larger shadow + slight lighter background. Сейчас `-1px` — практически незаметно.
- **Card drag**: `scale(1.02) rotate(1deg)` — даёт ощущение «оторвал от стола».
- **Card drop**: target-column slight scale + glow 600ms.
- **Column header hover** (ст count-badge): badge rotates 5deg with slight bounce → даёт chararecter.

### 3.5 Modal окна

**Сейчас**: overlay opacity + box `translateY(10px) scale(.98)` 240ms. Это **OK**.

**Что улучшить**:
- На больших модалках (Tech Info — 80vw × 86vh) — entrance medlennее (320ms) и с более выраженным `scale(.92 → 1)`. Это создаёт «cinema»-feel.
- На малых (confirm-dialogs) — оставить 240ms.
- Backdrop blur (если CSS supports) — `backdrop-filter: blur(4px)` на overlay даёт глубину. Сейчас просто `rgba(0,0,0,.45)`.
- ESC close — backwards animation (модалка fades down + scale .98), не сразу `display: none`.

### 3.6 LLM Assistant

**Сейчас**: панель slide-in справа, FAB pulse. Сообщения добавляются через `msg-slide-in` keyframe (есть!).

**Что добавить**:
- **Streaming text**: курсор-блинк в конце streaming-сообщения. Сейчас просто текст растёт.
- **Tokens arriving**: subtle word-by-word fade-in (opacity 0.3 → 1 на новых словах). Делает streaming визуально живым.
- **Send button activate**: при typing → button color/weight changes, при send → button «leaves» куда-то, реappears.
- **Context indicator**: в LLM-чате есть «context: filtered rows» — показывается? Если да — добавить mini-shimmer на context-chip когда контекст меняется.

### 3.7 Topbar / Navigation

**Сейчас**: nav-item active = bg-color change.

**Что добавить**:
- **Active indicator** — animated underline / border-left bar, который **скользит** между табами при переходе (как в Material Design tabs или iOS). Это **сильный** signature-move motion.
- **Hover на nav** — slight `translateX(2px)` — даёт ощущение «нажимается».

### 3.8 Empty states / Loading

**Сейчас**: текст-заглушка или spinner.

**Что добавить**:
- **Skeleton loaders** на тех экранах, где данные приходят с server (Pulse, Tech Info, Black Dashboard). Skeleton-блоки с лёгкой shimmer-анимацией (`translateX(-100% → 100%)` linear-gradient over 2s).
- **Empty-state — animated illustration** (если иллюстрации появятся): subtle breathing-эффект на иллюстрации (scale 1 → 1.02 → 1 за 4s).

---

## 4. Рекомендации по motion-language для каждой концепции

### A. «Calm Operator» — спокойный, точный motion

**Принципы**:
- Длительности: **120-280ms** (короткие)
- Easing: `cubic-bezier(.2,.8,.2,1)` (current `--ease-standard`)
- Эстетика: «мне не мешают, но я знаю что произошло»
- НЕТ: больших scale-эффектов, bouncy-анимаций, длинных циклов

**Сигнатурный эффект**: **Number countup на KPI**. Когда дашборд открывается — числа отсчитываются с 0 за 600ms (out-cubic). Это спокойно, но даёт момент «жизни».

### B. «Editorial Operator» — выразительный, но не показной motion

**Принципы**:
- Длительности: **240-500ms** (более expressive)
- Easing: own custom — `cubic-bezier(.34,1.56,.64,1)` (slight overshoot для key actions)
- Эстетика: «motion рассказывает историю»
- ДА: stagger, sequence, narrative motion

**Сигнатурные эффекты**:
- **Stagger reveal** на дашборде: hero блок → KPI один за другим (delay 60ms каждый).
- **Drag-drop bounce**: drop-target принимает pill с overshoot (scale 1 → 1.08 → 1 за 400ms).
- **Page transition motif**: при смене таба контент уходит влево, новый приходит справа (slide 280ms). Это сильный editorial-move.

### C. «Workshop / Brutalist» — резкий, точный, без лишнего motion

**Принципы**:
- Длительности: **80-180ms** (snap-fast)
- Easing: linear или `cubic-bezier(.0, .0, .2, 1)` (out-quint)
- Эстетика: «всё работает, ничего не отвлекает»
- НЕТ: bounce, overshoot, decorative motion

**Сигнатурные эффекты**:
- **Snap-to-grid**: Pills в Ганте, при drag, snap-to-target с visible click-effect (border flashes once).
- **Status-changes**: state-flips мгновенные, без crossfade (binary, точечные).
- **Loading**: вместо spinner — **monospace prefix** в углу (например, `[01/12 LOADING…]`) меняющийся каждые 100ms.

---

## 5. Сводная таблица «moments что должны быть подкреплены motion»

| Action | Сейчас | Должно быть | Приоритет |
|---|---|---|---|
| Drag-drop в Ганте complete | Слабый glow 900ms | Bounce-in pill + visible glow 800ms + small confetti для bulk | High |
| Bulk action complete | Toast 1.5s | Toast + selected rows pulse green 400ms | High |
| Inline-edit save | Молчит | Cell flash green 400ms | High |
| Filter applied | Instant rerender | Fade-out rows → fade-in new rows (200ms) | Med |
| Modal close | Instant disappear | Reverse-animation (240ms) | Med |
| KPI on first load | Instant | Number countup 600ms | Med |
| Tab change | Section-enter 240ms | Reduce to 120ms на повторные переходы | Med |
| Loading state | Spinner / blank | Skeleton + shimmer | Med |
| Hover nav-item | bg color change | bg + translateX(2px) | Low |
| Active nav-item indicator | bg only | Animated bar/underline that slides | Med |
| LLM streaming | Text grows | + cursor blink | Low |
| Empty state | Static text | Subtle illustration breathing | Low |

---

## 6. Несколько конкретных «hero»-моментов motion (по 1 на концепцию)

### A — Calm Operator: «KPI Reveal»

При первом заходе на дашборд — все 4 KPI cards появляются. Числа `0 → final` за 600ms (ease-out-cubic). Под каждым числом — тонкая горизонтальная линия (1px), которая **рисуется слева направо** за 800ms, синхронно с заполнением числа. Никаких bounces. Просто **числа вступают**.

### B — Editorial Operator: «Drag → Drop celebration»

В Ганте, после успешного drag-and-drop pill из колонки 1.21 в 1.22:
- **Stage 1** (0-100ms): drop-target column **breathes** — slight scale + accent-light bg.
- **Stage 2** (100-300ms): pill «летит» с original-position в новый slot via `animate()` Web API (cubic-bezier overshoot).
- **Stage 3** (300-700ms): new pill **bounces** (scale 0.5 → 1.1 → 1).
- **Stage 4** (700-1200ms): **тонкая стрелка** рисуется от source-cell к destination (через cell-receive + arrow-flow keyframes). Это запоминающийся signature-move — physical motion + narrative arrow.

### C — Workshop: «Status Stamp»

В Реестре, когда строка-задача меняет статус (e.g., done):
- **Stage 1** (0-50ms): flat colour-change в status-cell (instant, snap).
- **Stage 2** (50-150ms): **«stamp»**-эффект: monospace text «✓ DONE 12:41:33» появляется как штамп в углу строки, лёгкий tilt -3deg, fades out за 1s.

Никаких округлостей. Только функциональная «отметка прошла».

---

## 7. Что НЕ нужно

- ❌ Loading-spinners на каждое действие (визуальный шум)
- ❌ Long-form animations на frequently-repeated actions (вызывает раздражение через час)
- ❌ Decorative motion без функции (типа «летающие сердечки» на hover)
- ❌ `scroll-behavior: smooth` глобальный — ломает быстрый scroll и navigation. Лучше точечно `behavior: 'smooth'` где нужен.

---

## 8. Технические заметки

- Все motion-keyframes уже **есть в проекте** — добавить ещё 5-10 нужных, не более 1-2 KB CSS.
- Новые motion **не требуют JS** в большинстве случаев — CSS animations + transitions.
- **prefers-reduced-motion**: добавить `@media (prefers-reduced-motion: reduce) { ... motion: none-or-instant }`. Сейчас этого нет — это accessibility-baseline (см. `08-accessibility.md`).
