# 05 — MOTION-аудит вкладки «Гант»

> Read-only ревизия моушна на странице **Гант** Призмы. Базис — брендбук
> §9 (Emerge / Breathe / Pulse / Align), четыре жеста, принцип спокойствия,
> `prefers-reduced-motion`.
>
> Источники: `BRAND_BOOK.md` §9 (262–298), `tokens/motion.json`,
> `tokens/theme.css:115-174` (брендовые `--prizma-ease-*` + keyframes
> `prizma-emerge-core/-ray`, `prizma-breathe`, `prizma-pulse-ring`,
> `prizma-align`, `prizma-loader-inline`, `prizma-shimmer`),
> `views/gantt.js` (`renderChart()` :574, drop-handler :1536-1623,
> kb-DnD :1626-1779), `styles.css` namespaces `GANTT-DRAG-MOTION
> P10.26-28` :17403, `KEYBOARD-DND P10.25` :17550, `GANTT-TOOLBAR P11.3`
> :17223 + legacy `gdt-cell-receive` :2261, `gdt-jump-pulse` :2094,
> `gtx-focus-pulse` :3599. Соседний `dashboard-redesign/05-MOTION.md`
> (Emerge stagger 50–60ms, number-Align 320ms spring, Pulse только на
> off-course). Метрик-папки `summary-metrics-redesign/` нет — ориентируюсь
> на keyframes `metrics-emerge/-hero-emerge/-num-align/-attention-pulse`
> (`styles.css:17833-17869`) как W4-источник.

---

## Section 1. Motion на Ганте — что есть сейчас

| # | Элемент / селектор | Жест | Где определён | Reduced-motion handle |
|---|---|---|---|---|
| 1 | `.gex-grid-cell.cell-receive::after`, `.kanban-col-body.prizma-drop-target::after` | **W4 Drop Pulse** — `prizma-drag-pulse` 1600ms ease-out **infinite**, кольцо `border 2px var(--prizma-information)` | `styles.css:17409-17427` | yes — `:17451-17462` (`animation: none`) |
| 2 | `.gantt-card.drop-aligned`, `.kanban-card.drop-aligned`, `.gantt-type-pill.drop-aligned` | **W4 Drop Align** — `prizma-drop-align` 600ms `cubic-bezier(0.34,1.56,0.64,1)` (spring), one-shot | `styles.css:17429-17438`. Триггер: `gantt.js:1619` (mouse) + `:1775` (kb-DnD), `setTimeout` 600ms убирает класс | yes — там же `:17451-17462` |
| 3 | `.gantt-card.drop-rejected`, `.kanban-card.drop-rejected`, `.gantt-type-pill.drop-rejected` | **W4 Drop Reject** — `prizma-drop-reject` 800ms ease-out, shake ±4px | `styles.css:17440-17449`. Триггер: `gantt.js:1554, :1561, :1566` (cross-epic, same-col), `setTimeout` 800ms | yes — там же |
| 4 | `.gantt-type-pill.kb-drag-active` | **W5 KB-DnD outline** — статичный outline 3px + box-shadow color-mix 25% | `styles.css:17556-17560`. Триггер: `gantt.js:1682, :1709` | yes (частичное) — `:17579-17581` (`box-shadow: none`); outline остаётся |
| 5 | `.gantt-cell.kb-drag-target` | KB-DnD target — outline 2px dashed + bg color-mix 8% | `styles.css:17562-17566` | нет адресного — попадает только под универсальный rule в `theme.css:166` (но это **не** анимация, поэтому не отключается; зато и не движется) |
| 6 | `.gantt-cell-dragover` (mouse drag-over подсветка) | mouse-DnD target — outline 2px dashed | `styles.css:5707, :5721` | n/a — статика |
| 7 | `.gantt-cell-receiving` + `::after` (после move flight) | legacy Pulse — `gdt-cell-receive` 0.9s + `gdt-cell-receive-glow` 0.9s | `styles.css:2248-2270` | нет адресного |
| 8 | `.gantt-pill-flying` (move-pill flight animation) | inline `transition: transform .65s cubic-bezier(.45,.05,.25,1.6), opacity .55s .15s ease-out, box-shadow .25s` | `gantt.js:2416` (inline style) + `styles.css:2241-2245` | нет — inline style игнорирует universal rule (только animation-duration режется, transition тоже, но class navigation ставит в JS) |
| 9 | `.gantt-type-pill` hover | `transition: box-shadow .12s, transform .12s` | `styles.css:2355-2357` | нет адресного. `transform` в transition универсальное правило не отменяет — см. §6. |
| 10 | `.kanban-card` hover/active/dragging | `transition: box-shadow .15s, transform .15s` + `:active { transform: scale(.98) }` + `.dragging { opacity:.5; transform: scale(.95) }` | `styles.css:2686-2693` | нет адресного |
| 11 | `.kanban-col-body` drag-over | `transition: background .15s` | `styles.css:2680-2685` | нет (transition покрыт universal-rule в `theme.css`) |
| 12 | `.gdt-jump-pulse` (Cmd+K jump-to-row) | legacy Pulse — `gdt-jump-pulse` 1.4s ease-out, box-shadow ring | `styles.css:2094-2103`. Триггер: `gantt.js:390, :1507`, `setTimeout` 1400ms | нет адресного |
| 13 | `.gtx-row-focus` (focus после клика на стрелке) | legacy Pulse — `gtx-focus-pulse` 1s ease-in-out, bg-flash | `styles.css:3433, :3599-3603` | нет адресного |
| 14 | `.app-section.section-enter` (вход в секцию Гант) | `section-enter` 240ms (`var(--motion-mid)` × `var(--ease-emphasis)`), Y-fade | `styles.css:1167, :2906` | нет адресного |
| 15 | `.gantt-cell:hover` (раскрытие пилюль) | `transition: max-height` неявно через `max-height: 320px` без явного timing — мгновенный | `styles.css:2195` | n/a |
| 16 | Column-header `.gantt-header-col` (рельса с релизом) | без motion. Только статика. `position: sticky; top: 0; z-index: 10` (`:1793`). `.gdt-rail-today` (`:1840`) — accent-pill, без анимации появления | — | n/a |
| 17 | `.gantt-pill-flying` filter `drop-shadow` | статика | `styles.css:2244` | n/a |

**Вывод.** Из четырёх брендовых жестов на Ганте задействованы **три**:
Pulse (W4 Drop Pulse — target-cells), Align (W4 Drop Align — новая
пилюля), и Reject (W4 — ремикс shake + Pulse). **Emerge** — нет нигде
(ни на mount, ни на pills). **Breathe** — нет (корректно: Гант —
рабочая плоскость, hero-mark в топбаре дышит, и этого достаточно).
Брендовые токены `--prizma-ease-*` (`theme.css:115-118`) определены, но
в коде Ганта используются inline-кривые (`:17437`, `gantt.js:2416`) —
накопленный долг. Reduced-motion адресный handle есть только для блока
`GANTT-DRAG-MOTION` и `kb-drag-active.box-shadow`; остальные мотионы
покрыты лишь universal-rule `theme.css:166-173`, который не убирает
`transform`-свойства в `:hover` и не отменяет inline-`transition` на
`.gantt-pill-flying`.

---

## Section 2. Где motion должен быть, но его нет (6 точек)

> Каждая точка — read-only рекомендация. Длительности и easing’и сверены
> с брендбуком §9, `motion.json` и dashboard-MOTION (Emerge 50ms stagger,
> number-Align 320ms spring, Pulse — только на критических сигналах).

### 2.1. Pills emerge при первом рендере (stagger по релизам)

- **Где:** `.gantt-type-pill` внутри `.gantt-cell[data-col]`,
  только при mount секции, не при каждом `renderChart()`.
- **Жест:** **Emerge** stagger **по колонкам** (1.20 → 1.21 →
  1.22 → ОТ → Бэклог), не по пилюлям. Внутри колонки — все сразу
  (иначе 50+ пилюль × 30ms = >2s = лаг).
- **Зачем:** сейчас чарт «вспыхивает» 50–200 пилюль сразу. Stagger
  по колонкам = временная подсказка «читай слева направо по рельсе».
- **Длительность:** 360ms на колонку, stagger 80ms = ≤ 680ms total,
  easing `--prizma-ease-calm`.
- **Триггер:** `_renderedOnce` flag в `GanttView`. На rerendere
  (drop / filter / sort) — без Emerge (см. §3 принцип 2).

### 2.2. Smooth pill-move между колонками (без `renderChart` rebuild)

- **Где:** `.gantt-type-pill[data-row-id][data-src-col][data-wt]`
  при mouse-DnD drop. Сейчас drop → `renderChart()` (`gantt.js:1607,
  :1765`) пересобирает `wrap.innerHTML` → пилюля «телепортируется».
- **Жест:** **flight-Align** через FLIP-pattern (захватить
  bounding-rect старой и новой cell, отрендерить `.gantt-pill-flying`
  overlay, после `transitionend` → `renderChart()`).
- **Зачем:** существующий `.gantt-pill-flying` (`styles.css:2241`,
  `gantt.js:2416`) уже умеет это для context-menu move, но drop-DnD
  идёт мимо. Для power-user 50–80 drop/день — главный feedback
  «прямого манипулирования».
- **Длительность:** 280–320ms `--prizma-ease-spring` → drop-Align
  600ms = 920ms цепочка.
- **Caveat:** требует FLIP, нетривиально. Если приоритет низкий —
  текущий drop-Align уже даёт landing-фидбэк, можно отложить.

### 2.3. Counter Align на column-header при drop

- **Где:** counter-badge в `.gantt-header-col` (сейчас в коде такого
  бейджа нет — только `.gdt-rail-label/-meta/-today`,
  `styles.css:1812-1851`; если редизайн его добавит, тут должен
  играть Align).
- **Жест:** **number-Align** — `scale 0.92 → 1.04 → 1` 320ms spring.
- **Зачем:** при drop счётчики двух колонок меняются (A: 13→12,
  B: 8→9). Без Align изменения тихие, нет подтверждения пересчёта.
  Брендбук §9.4 Align — «смена контекста колодца».

### 2.4. Tooltip preview при drag (что я тащу)

- **Где:** floating div поверх cursor’а на `dragstart` пилюли —
  epic / wt / assignee / period (то, что в `.gep-tooltip` при
  `:hover`, и пропадает при drag).
- **Жест:** **Emerge** short — 200ms calm на появление, mouse-track
  без transition, 120ms fade-out на `dragend`.
- **Зачем:** при drag пилюля — «призрак» (opacity .7,
  `styles.css:6138`), пользователь теряет контекст. Критично при
  cross-epic reject (50+ drag/день, ошибки бывают часто): без
  preview не понятно, какая именно пилюля была «в руке».

### 2.5. Row-labels stagger при первом рендере

- **Где:** `.gantt-row-label.v16-epic-label`.
- **Жест:** **Emerge** stagger 30ms, ограничено первыми ~20 viewport-
  строками (остальные — без анимации; иначе на 100+ строках получим
  3s sequence).
- **Длительность:** 280ms на строку, stagger 30ms → ≤ 880ms.
- **Триггер:** mount `renderChart()` при `_renderedOnce !== true`.
  На rerendere (sort, filter) — без stagger.

### 2.6. Pulse на свежих overdue/blocking row’ах

- **Где:** `.gantt-row-label` строк с `row.riskFlags.includes('overtime')`
  или `row.blockingCount > 0`, **только если** строка свежая с
  прошлого визита (`state.lastSeen.gantt < epicChangedAt`).
- **Жест:** **Pulse** (`prizma-pulse-ring`) 1600ms ease-out, **1
  повтор на scroll-into-view** (не infinite, см. §7.4 — на Ганте
  overdue’ев десятки, контракт W4 «3 повтора» здесь смягчаем).
- **Зачем:** сейчас `.kanban-card.card-blocking` имеет статичный
  `border-left 3px var(--danger)` (`styles.css:2696`) — читается
  только при сканировании. Pulse «кивает один раз», глаз ловит.
- **Анти-перебор:** не более 3 строк одновременно (по приоритету
  overtime > blocking > risk), остальные — static red dot.

---

## Section 3. Принципы motion для Ганта (power-user сценарий 50–80 drag/день)

> 6 правил, по которым проверяется любая будущая моушн-добавка на
> этой странице. Главное отличие от дашборда: Гант — рабочая
> плоскость, motion **подтверждает действие**, не «вдохновляет».

1. **Drop-feedback — обязателен. Idle-motion — нет.**
   Drop Pulse / Drop Align / Drop Reject — это часть UX-контракта
   (Дмитрий: «нет фидбэка после drop’а»). А Breathe-loop’ов на
   пилюлях / cell’ах быть не должно — на 200+ пилюлях это вызовет
   morose sea-sickness через 5 минут.

2. **Emerge — только на первом рендере секции, не на каждом render.**
   Power-user пересортирует/перефильтрует за минуту 5–10 раз. Stagger
   на каждый rerender = +500ms каждый раз = -50 секунд продуктивности
   за день. Контракт: `_renderedOnce` флаг + 100ms короткий fade на
   rerendere.

3. **Number-Align на счётчиках колонок.**
   При каждом drop счётчики двух колонок меняются. Без Align — как
   будто система «забыла» подтвердить. С Align (320ms spring) —
   получается очень короткий, но заметный «кивок».

4. **Pulse — только на свежих критических сигналах, ≤ 3 повтора.**
   Не infinite. На Ганте Pulse-infinite на cell — допустим **только**
   во время drag (drop-target hint), потому что это явная фаза
   взаимодействия. Вне drag — никаких infinite-loop’ов.

5. **Reduced-motion: оставить только Reject и outline-кей.**
   Reject 800ms shake — это **функциональный** фидбэк (cross-epic
   запрет): без него пользователь не понимает, что drop отменён.
   В reduced-motion shake → static red outline 200ms. Drop Align
   → static border-flash. KB-drag outline остаётся (это
   фокус-индикатор, не motion в строгом смысле).

6. **Одна анимация за раз на одном элементе.**
   `prizma-drop-align` (600ms) + `prizma-drag-pulse` (target-cell)
   могут совпасть, если пилюля упала в cell, который ещё подсвечивался
   (что нормально по таймингу — class `.cell-receive` снимается при
   `dragleave`, а `.drop-aligned` ставится на новую пилюлю в
   `requestAnimationFrame` после `renderChart`). Сейчас в коде они
   на разных элементах — конфликта нет. При добавлении row-Pulse
   (точка 2.6) проверить, чтобы во время drop-Align Pulse был
   приостановлен на эту строку.

---

## Section 4. Sequencing — порядок появления при первом рендере

> Сценарий: пользователь только что зашёл в раздел Гант с дашборда.
> Toolbar и levels уже отрисованы (W3 sticky toolbar — `GANTT-TOOLBAR
> P11.3`, `:17223`), сейчас mount-ится chart внутри `#gantt-wrap`.

```
0ms      section-enter (Y-fade 6px → 0, 240ms ease-emphasis)
            существует, не трогаем
60ms     gantt-header (sticky rail, 5 cols) emerge
            opacity 0→1, translateY 4→0, 280ms calm
            (одной волной, без stagger — это структурный каркас)
140ms    row-labels begin: первые ~20 строк, stagger 30ms
            (последняя из 20 заканчивает в 140 + 19×30 + 280 = 990ms)
220ms    pills внутри cells: stagger 80ms по колонкам
            col 1.20  start at 220ms, finish 580ms
            col 1.21  start at 300ms, finish 660ms
            col 1.22  start at 380ms, finish 740ms
            col OT    start at 460ms, finish 820ms
            col Бэк   start at 540ms, finish 900ms
800ms    overdue/blocking row-Pulse begin
            (3×1600ms = 4800ms, ends at 5600ms)
            ТОЛЬКО для строк с свежими flag'ами (lastSeen guard)
1000ms   total mount sequence — done. Гант в idle.
            После этого Pulse догрывает свои 3 повтора и останавливается
            (5600ms — это финальная отметка для свежих overdue).
```

ASCII-схема (по группам):

```
section-enter  ▓▓
gantt-header     ▓▓
row-labels (20)    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓
pills col 1.20       ▓▓▓
pills col 1.21         ▓▓▓
pills col 1.22           ▓▓▓
pills col OT               ▓▓▓
pills col Бэк                ▓▓▓
overdue row-Pulse              ●━━━━━━━━━━━━━━━━━ (3 повтора)

           |0|---|400|---|800|---|1200|---|2000|---|5600ms|
```

Mount-sequence: **~1000ms** (Pulse догрывает в фоне, не блокирует).
**Rerender** (drop / filter / sort): 100ms fade на изменённых
элементах, без stagger / Emerge / Pulse — power-user не ждёт.

---

## Section 5. Reduced-motion правила

> Контракт: при `prefers-reduced-motion: reduce` Гант **остаётся
> функциональным** — drag/drop работает, фидбэк есть, но без
> transform / scale / rotate.

### Выключаем (нужен **функциональный fallback**, не голый `animation: none`)

- **Drop Pulse** target-cell → static `border 2px var(--prizma-information)`.
  Сейчас в коде `animation: none` (`:17460`) → кольцо исчезает, hint потерян.
- **Drop Align** (600ms spring) → 120ms outline-color flash, без transform.
- **Drop Reject** (800ms shake) — **критично** заменить, не убирать:
  static 200ms `border-color: var(--prizma-off-course)` + toast уже есть
  (`gantt.js:1560`).
- **row-Pulse** на overdue → static red dot.
- **Number-Align** на счётчиках → `opacity 0.6 → 1` 200ms.
- **Stagger-Emerge** (2.1, 2.5) → мгновенное появление.
- **`transform: scale`** на `.kanban-card:active/:hover/.dragging`
  (`styles.css:2692-2693`) и `.gantt-type-pill[draggable]:active`
  (`:6138`) — **адресные** overrides; universal-rule только режет
  `transition/animation-duration`, сам `transform` остаётся.

### Оставляем

- `opacity` переходы (state-change, не motion).
- Цвет / border-color transitions (theme switch).
- KB-DnD outline (`:17557`) — фокус-индикатор; box-shadow-glow уже
  снимается в `:17580`, корректно.
- Tooltip-preview drag (2.4) — opacity-only.

### Что неочевидно

Inline-стили на `.gantt-pill-flying` (`gantt.js:2416 transition:
transform .65s …`) обходят CSS-каскад. Universal `transition-duration:
0.01ms` сократит flight до телепорта без трейса — корректно, но резко.
Нужен явный `matchMedia('(prefers-reduced-motion: reduce)').matches`
guard в JS перед flight.

---

## Section 6. CSS-mockup ключевых жестов (иллюстрация, не для копипасты)

```css
/* === GANTT MOTION MOCKUP — не вставлять, опорный псевдо-CSS === */

/* 1. Pills emerge с stagger по колонкам (только на первом рендере) */
.gantt-wrap.is-first-render .gantt-cell[data-col] .gantt-type-pill {
  opacity: 0;
  transform: translateY(4px);
  animation: prizma-emerge-core 360ms var(--prizma-ease-calm) both;
  animation-delay: var(--col-emerge-delay, 0ms);
}
.gantt-cell[data-col="r120"]    { --col-emerge-delay: 220ms; }
.gantt-cell[data-col="r121"]    { --col-emerge-delay: 300ms; }
.gantt-cell[data-col="r122"]    { --col-emerge-delay: 380ms; }
.gantt-cell[data-col="overtime"]{ --col-emerge-delay: 460ms; }
.gantt-cell[data-col="backlog"] { --col-emerge-delay: 540ms; }

/* 2. Row-labels stagger (только viewport, первый render) */
.gantt-wrap.is-first-render .gantt-row-label {
  opacity: 0;
  animation: prizma-emerge-core 280ms var(--prizma-ease-calm) both;
  animation-delay: calc(140ms + 30ms * var(--row-i, 0));
}

/* 3. Counter-Align на column-header badge */
@keyframes prizma-counter-align {
  0%   { transform: scale(0.92); }
  60%  { transform: scale(1.04); }
  100% { transform: scale(1); }
}
.gantt-header-col .gdt-rail-counter.is-changing {
  animation: prizma-counter-align 320ms var(--prizma-ease-spring);
}

/* 4. Tooltip preview при drag — opacity emerge */
.gantt-drag-preview {
  position: fixed; pointer-events: none; z-index: 9999;
  opacity: 0;
  animation: prizma-emerge-core 200ms var(--prizma-ease-calm) both;
}

/* 5. row-Pulse на свежих overdue (3 повтора, не infinite) */
.gantt-row[data-fresh-overdue="1"] .gantt-row-label::after {
  content: '';
  position: absolute; inset: 0;
  border: 2px solid var(--prizma-off-course);
  border-radius: 4px;
  opacity: 0;
  animation: prizma-pulse-ring 1600ms var(--prizma-ease-decel) 3;
  pointer-events: none;
}

/* 6. Reduced-motion overrides — точечно поверх universal-rule */
@media (prefers-reduced-motion: reduce) {
  .gantt-wrap.is-first-render .gantt-type-pill,
  .gantt-wrap.is-first-render .gantt-row-label,
  .gantt-header-col .gdt-rail-counter.is-changing,
  .gantt-drag-preview,
  .gantt-row[data-fresh-overdue="1"] .gantt-row-label::after { animation: none; }

  .kanban-card:hover,
  .kanban-card:active,
  .gantt-type-pill:active { transform: none; }

  .gex-grid-cell.cell-receive::after,
  .kanban-col-body.prizma-drop-target::after {
    /* fallback: static outline вместо infinite Pulse */
    animation: none;
    opacity: 1;
  }
  .gantt-card.drop-rejected,
  .gantt-type-pill.drop-rejected {
    /* shake → static red border 200ms */
    animation: none;
    box-shadow: 0 0 0 2px var(--prizma-off-course);
    transition: box-shadow 200ms ease-out;
  }
}
```

---

## Section 7. Спорные моменты

### 7.1. 50–80 drag в день — Drop Pulse не надоест?

`prizma-drag-pulse` сейчас **infinite** на target-cell, но играет
только во время активного drag (`.cell-receive` навешивается на
`dragenter`, снимается на `dragleave`/`drop`). Hover над target
≈ 0.5–2s → 1–2 цикла на drag. Pulse навешен на ячейку 120px+
в периферическом зрении, scale 0.96 → 1.04 — это мягкий heartbeat,
не «диско». **Mitigation на будущее:** заменить infinite на 3
цикла + `animation-play-state: paused` до `dragleave` — суммарно
за сессию 80 drag × 10s = 13 минут Pulse усредняются глазом
в фоновый шум, ограничение количества циклов лечит привыкание.

### 7.2. Когда применять Emerge — на каждом render или только на первом?

**Только на первом.** Power-user делает `renderChart()` десятки раз
за минуту (drop / sort / filter). Emerge на каждом — +700–1000ms
ожидания × 100 раз = ~1.5 минуты потерянного времени в день.

**Контракт:** `GanttView._renderedOnce` flag (выставляется на первом
render, сбрасывается при возврате из другой секции — это «новый
заход = новый курс»). На rerendere внутри секции — короткий 100ms
fade на изменённых элементах, без stagger.

### 7.3. Cmd+K open — Align на topbar mark?

На Ганте Cmd+K — чаще jump-to-row (`gdt-jump-pulse` :2094 уже
играет на target row). Если ещё и Align на topbar mark — double-
feedback (Align + Pulse) нарушает брендбук-принцип «одна анимация
за раз». **Рекомендация:** Cmd+K **открытие палитры** — только
`modal-align-in` 200ms на самом dialog’е, без Align на mark.
Cmd+K **с jump в другую секцию** — Align на mark (это смена
контекста модуля). Cmd+K с jump внутри Ганта — только row-Pulse.

### 7.4. Pulse 3 повтора (W4) vs 1 повтор на overdue row Ганта

Метрики и дашборд (W4) — 3 повтора на attention-Pulse. На Ганте
overdue-эпиков может быть 5–15 одновременно — 5 строк × 3 повтора =
4.8s «хор». Расхождение с W4 контрактом, но контекст другой
(на дашборде ≤ 3 карточки overdue). **Compromise:** 1 повтор на
строку при scroll-into-view, и не более 3 строк одновременно (по
приоритету overtime > blocking > risk), остальные — static red dot.

### 7.5. Накопленный долг: `--ease-emphasis` vs `--prizma-ease-spring`

`section-enter` использует `var(--ease-emphasis)` (legacy),
`prizma-drop-align` — inline `cubic-bezier(0.34,1.56,0.64,1)` (spring,
но не через токен). Долгосрочно — мигрировать на `--prizma-ease-*`.
Сейчас разница ≤ 5% по визуалу, не критично.

---

## Резюме motion-стратегии для Ганта

- **Drop Pulse / Drop Align / Drop Reject (W4)** — оставить как есть.
  Это сердце feedback’а на Ганте. Только обсудить infinite → 3 цикла
  в Pulse (см. 7.1).
- **KB-DnD outline (W5)** — оставить. Reduced-motion fallback уже
  корректный.
- **Emerge** — добавить **только на первый render** секции, по
  колонкам (80ms stagger) и по строкам (30ms stagger, ≤ 20). Не
  на rerendere.
- **Number-Align** — добавить на счётчики column-header (если
  редизайн их добавит) и на любые числовые counters (рисковые,
  блокеры, переносы) при изменении.
- **Pulse on row** — **точечно** на свежих overdue/blocking, ≤ 1
  повтор, только при scroll-into-view, не более 3 строк
  одновременно.
- **Tooltip-preview при drag** — добавить, opacity-only.
- **Smooth pill-flight** — желательно, но низкий приоритет
  (FLIP-pattern — нетривиально). Текущий drop-Align уже даёт
  «landing»-feedback.
- **Reduced-motion** — для каждой новой keyframe-точки писать
  адресный `@media` блок с **функциональным fallback’ом**, не просто
  `animation: none` (особенно для Drop Reject и target-Pulse —
  там нужна замена outline’ом).
- **Mount-sequence ≤ 1000ms** на первый render. Rerender ≤ 100ms
  (короткий fade на изменённых элементах).

---

Отчёт записан в audit-2026-05-04/gantt-redesign/05-MOTION.md, длина 448 строк.
