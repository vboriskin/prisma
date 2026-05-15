# 03 — Interaction & A11y audit. Дашборд «Призма»

> **Жанр:** read-only аудит вкладки «Дашборд» (раздел `КУРС → Дашборд`).
> **Источники:** `views/dashboard.js`, `app/prizmaUI.js`, `index.html` (#section-dashboard), `styles.css` (kpi-*, prizma-hero-*, release-*, dash-empty, focus-visible), `my_prisma-brand/BRAND_BOOK.md` §§3, 7, 9, 11, `audit-2026-05-04/12-user-feedback.md`.
> **Не правил код.** Все цитаты «как есть» на 2026-05-04.
> **Контракты, которые нельзя ломать:** `renderHero` в hero-блоке обязан вызываться, KPI-cards уже кликабельны (улучшаем feedback, не заменяем поведение), на дашборде нет DnD (это не реестр и не гант).

---

## Section 1 — Карта взаимодействий «как сейчас»

Дашборд состоит из 9 контейнеров (см. `index.html:883-898`). Render-pipeline в `views/dashboard.js`:

```
_renderPrizmaHeader()  → page-header + hero (звезда+КПИ+supporting)
renderKPIs()           → 12 kpi-card-clickable → modal-kpi
renderProgress()       → 5 progress-card (1.20/1.21/1.22/OT/Всего)
renderRisksPanel()     → counters (read-only)
renderBlockingCard()   → таблица блокеров (read-only)
renderReleaseBreakdown() → 4 release-card (read-only)
renderTeamsSummary()   → таблица команд (read-only)
renderNoReleaseTable() → таблица «Без релиза» (read-only)
renderNeedsConfirmTable() → таблица «Требует подтверждения» (read-only)
```

Таблица `элемент | действие | trigger | feedback | aria-label / state`:

| Элемент | Действие | Trigger | Feedback | aria / state |
|---|---|---|---|---|
| `prizma-hero` (мета-блок: звезда + 57.7% + supporting) | **нет** click-target. Полностью презентационный. | — | breathe-анимация на `.prizma-hero-mark` (4s ease-in-out, infinite) | без `role`, без `aria-label`. Звезда `aria-hidden="true"` |
| `prizma-hero-supporting-item` (3 числа: «В РАБОТЕ», «ДРЕЙФ», «БЕЗ КУРСА») | **нет** click-target | — | нет hover/focus | без role; визуально похожи на KPI-карточки → ложное обещание |
| `kpi-card.kpi-card-clickable` (12 шт., `data-kpi="..."`) | click → `openKpiModal(label, rows, kpiKey)` | mouse click; Enter; Space (через `el.onkeydown`, dashboard.js:146) | `:hover` → `box-shadow: var(--shadow); transform: translateY(-1px)`; `:focus-visible` → outline 2px text-primary, offset 2px, radius 8px | `role="button"`, `tabindex="0"`, `aria-label="Перейти к {label}"` |
| `modal-kpi` footer-CTA `#modal-kpi-goto-registry` | «Открыть в реестре с фильтром» → mutate `state.filters` + `Nav.goTo('registry')` | mouse click | стандартный `.btn-primary` hover | без `aria-describedby`, без focus-trap (но есть `closeModal` через ESC через app.js:658) |
| `progress-card` (5 шт., 1.20/1.21/1.22/OT/Всего) | **нет** click-target | — | нет hover/focus | без role; число + progress-bar; `.signal-dot` имеет `role="img"` + `aria-label="Перегрузка"` (только при overload) |
| `risks-panel` / `.risk-counter` | **нет** click-target | — | нет hover | `risks-panel-title` без `role="region"`; рисками не управляют |
| `blocking-detail-card` (таблица 20 строк блокеров) | **нет** click-target. `.tasks-cell` содержит `RH.jiraTagsHtml` — внутри pills могут быть ссылки, но карточка целиком не кликабельна | — | строки не подсвечиваются на hover | без `aria-labelledby`; заголовок «Блокирующие зависимости (N)» — обычный `div` |
| `release-card` (4 шт., 1.20/1.21/1.22/OT) | **нет** click-target | — | нет hover/focus | без role; число задач + mini-breakdown — read-only |
| `data-table-wrap` (Сводка по командам / Без релиза / Требует подтверждения) | **нет** click-target | — | `:hover` всей wrap → `box-shadow: var(--shadow); transform: translateY(-1px)` (styles.css:1349) — wrap-уровень! Внутри строки tbody tr → `background: var(--row-hover)` | без `role="region"`, без `aria-label` |
| `dash-empty` (state «Курс ещё не проложен») | **нет** CTA. Текст «Импортируйте план из XLSX или начните с шаблона» — это совет без кнопки | — | `prizmaEmptyGlyph` — звезда с opacity 0.3 + breathe 4s | `aria-hidden` на glyph, остальное — обычный текст |
| Скрытые кнопки/действия | в render-pipeline дашборда **нет** ни одной кнопки. Все CTA («Импорт XLSX», «Шаблон», bulk, Cmd+K) живут на топбаре, в шапке Реестра, или вообще не существуют | — | — | — |

**Главный вывод по карте.** На дашборде сейчас ровно **одна** интерактивная сущность — KPI-карточки. Hero, progress-cards, release-cards, risks-panel, таблицы — всё read-only. Empty-state — без CTA. Модулей-CTA «применить bulk», «сверить курс с Jira» — на дашборде **нет**.

---

## Section 2 — Проблемы взаимодействий

### 1. [interaction] Hero — это плакат, а не точка входа в работу

**Где:** `views/dashboard.js:77-88`, hero-блок «звезда + 57% + 3 supporting числа».
**Что не так:** hero сообщает «общий курс квартала», но супер-числа (`В РАБОТЕ`, `ДРЕЙФ`, `БЕЗ КУРСА`) визуально читаются как KPI и зрители ждут от них клик, как от карточек ниже. Кликнуть нельзя. Это «фантомная интерактивность» — у пользователя падает доверие к остальным числам экрана.
**Кто страдает:** Анна (PO, утренний обзор за 15 секунд) — она видит «3 в дрейфе» и инстинктивно тыкает; Олеся (новичок) — теряется, потому что число выглядит как ссылка.

### 2. [interaction] Дашборд не отвечает на вопрос «что делать сейчас»

**Где:** весь дашборд от render-цепочки до empty-state.
**Что не так:** между «57% курса квартала» (hero) и «Сводка по командам» (низ) нет ни одной CTA-карточки уровня «эти 3 задачи требуют действия». Анна явно сказала: «Утром у меня нет второго клика». Сейчас все пути от дашборда к работе идут через KPI → modal → footer-CTA «открыть в реестре» — это **3 клика** для типичного утреннего сценария.
**Кто страдает:** Анна (5/5 страдания), Олеся («где «начни здесь»?» — 12-feedback.md строка 207).

### 3. [a11y] KPI-cards — `role="button"` без видимого focus-state на тёмной теме

**Где:** `styles.css:16871-16876` — `.kpi-card-clickable:focus-visible { outline: 2px solid var(--prizma-text-primary); outline-offset: 2px; border-radius: 8px; }`.
**Что не так:** `--prizma-text-primary` на тёмной теме — это `Star (#FFFFFF)`. Карточка с `kpi-neutral` имеет background `--prizma-bg-elevated` (Twilight `#1A1A22`) — белый outline видно. Но карточки `signal-off-course` / `signal-drift` имеют stripe-left того же `#FFB347/#FF6B6B`, и **сам `outline-offset: 2px` залезает в зону, где могут быть соседние карточки в grid `repeat(auto-fill, minmax(155px, 1fr)) gap: 12px`**. На уплотнённом гриде outline-кольцо двух соседних карточек может слипнуться и читаться как одна обведённая зона.
**Кто страдает:** Игорь (keyboard-юзер: «Tab. Tab. Tab. Где я?» — 12-feedback.md строка 149) — фрагмент про focus-ring пропадает на топбаре пересекается с этой проблемой.

### 4. [a11y] Числа в KPI обновляются без `aria-live`

**Где:** `views/dashboard.js:114-115` — innerHTML генерируется заново на каждый `App.refreshAll`. После импорта XLSX, после bulk-операции, после Jira-sync — числа меняются.
**Что не так:** screen-reader не получает уведомления «всего задач: 248 → 312». Это технически WCAG 2.1 SC 4.1.3 — Status Messages. Контейнер `#dashboard-kpi` — обычный `div.kpi-grid`.
**Кто страдает:** screen-reader-юзер; Игорь (опытный планировщик после bulk-операции «применил авто-релиз к 50 строкам» — он не знает, что число сменилось).

### 5. [interaction] Release-cards и progress-cards не кликабельны при том, что данные в них фильтрабельны

**Где:** `renderReleaseBreakdown` (4 карточки 1.20/1.21/1.22/OT) и `renderProgress` (5 progress-карточек).
**Что не так:** карточка «1.20 — 47 задач» — те же данные, что и KPI-карточка `r120`. Но KPI кликается, release-card — нет. Двойной стандарт. Дмитрий и Игорь привыкли «всё, что число + label, кликается».
**Кто страдает:** Дмитрий (BE-lead, ожидает «всё интерактивно как в Linear»), Анна (видит карточку «1.21» и тыкает — ничего не происходит).

### 6. [a11y + interaction] Empty-state без CTA — мёртвая точка

**Где:** `views/dashboard.js:33-49` (rows.length === 0).
**Что не так:** «Курс ещё не проложен. Импортируйте план из XLSX или начните с шаблона» — это **совет**, не CTA. Кнопок «Импортировать XLSX» / «Применить шаблон» в `dash-empty` нет. Олеся увидела welcome-overlay → нажала «Сверить курс» → попала на дашборд → empty → тупик. Tab-flow от empty-state ведёт мимо — на топбар.
**Кто страдает:** Олеся (новичок, день первый), любой новый пользователь, screen-reader (нет интерактива → роль `region` без landmarks → дашборд для них «пустая страница без ориентиров»).

---

## Section 3 — Что должно появиться (новые взаимодействия)

### 3.1. Hero «Что требует курса» (must, эффект на Анну/Олесю — высокий)

**Структура.** Между `prizma-hero` (метрика квартала) и `dashboard-kpi` — новая секция `.dash-hero-actions` с 1–3 карточками: «Что требует курса прямо сейчас». Это не KPI, а **action-cards** (т.е. читаются как «сделай это»).

Каждая карточка — 1 строка:

```
[icon: signal-off-course]  56 задач без релиза в 1.20  →  «Распределить»
[icon: signal-drift]        12 задач требуют подтверждения scope  →  «Сверить курс»
[icon: signal-off-course]  3 блокирующих зависимости истекают на этой неделе  →  «Открыть»
```

**Click-targets.**
- Вся карточка (`role="button"`, `tabindex="0"`) — открывает Реестр с предзаполненным фильтром (как существующий `modal-kpi-goto-registry`).
- Внутри — текстовая CTA-кнопка (`.prizma-btn-secondary`) — синонимичный путь, screen-reader видит её отдельно.

**Keyboard-flow.** Tab → 1-я карточка → Enter (вся карточка) ИЛИ Tab → CTA-кнопка → Enter (та же мишень). Двойная цель — не a11y-нарушение, потому что у вложенной кнопки `tabindex="-1"` или нет `tabindex` (естественный focus); внешний контейнер исключается из таб-цепочки через `tabindex="0"` только если кнопка скрыта. Альтернатива (предпочтительно): **карточка — `tabindex="-1"`, кнопка — единственная focusable точка**. Hover карточки — подсвечивает кнопку.

**Источник «что показать».** Алгоритм (мой proposal, не код):
1. Если `risky > 0` — топ-1: «N задач с риском».
2. Если `blockingDependency > 0` и deadline ≤ 7 дней — топ-2: «N блокеров истекают».
3. Если `needs_confirm > 0 && needs_confirm > 5` — карточка-3: «Сверить scope».
4. Если ни одного — show «Курс ровный. На этой неделе всё под контролем».

### 3.2. Проактивные actions из дашборда (should)

| Сценарий | Триггер | Где появляется CTA | Куда ведёт |
|---|---|---|---|
| После импорта XLSX | впервые попали данные | dashboard-kpi-area верх, лента-баннер | «Сверим курс с Jira?» → /integrations или toast «Курс сверен» |
| Empty-state | нет данных | внутри `.dash-empty` | 2 кнопки: «Импортировать XLSX», «Шаблон демо» |
| risky > 30 | дрейф критичный | hero подменяется на signal-off-course тон | без перехода — только цветовой alert |

### 3.3. Hover / focus / active feedback — конкретные правила

**KPI-карточка:**
- `:hover` — `transform: translateY(-1px)`, `box-shadow: var(--shadow)`, `transition: 140ms cubic-bezier(0.4, 0, 0.2, 1)`. Уже есть, но добавить мягкое усиление stripe-left: `border-left-width: 4px` (с 3px) — даёт тактильный сигнал.
- `:focus-visible` — `outline: 2px solid var(--prizma-information)` (а не `text-primary`), `outline-offset: 3px`, `border-radius: 8px`. Information-цвет (`#6EC1E4` темная / `#1F6B96` светлая) — не конфликтует с signal-цветами карточки.
- `:active` — `transform: translateY(0)`, `box-shadow: var(--shadow-sm)` (как при mouse-down).
- Все transitions ≤ 140ms (brandbook §9 — спокойствие важнее эффектов).

**Hero-mark (звезда):** уже есть `breathe 4s ease-in-out infinite`. Не трогаем.

**Hero-supporting-item:** добавить `cursor: default`, чтобы исчезло «фантомное обещание клика» (см. проблема #1). Если решено сделать кликабельными → новая роль `role="button"`, focus-ring как у KPI.

**Release-card / progress-card** (если станут кликабельными — см. proposal 5):
- Те же правила, что и KPI-карточка.
- `:hover` — translateY(-1px) + box-shadow усиление.
- focus-visible — `outline: 2px solid var(--prizma-information)`, offset 3px.

**Action-card (новый Hero «что требует курса»):**
- `:hover` — `background: var(--prizma-bg-hover)`, stripe-left 4px → 6px, **CTA-кнопка внутри становится `bg: --prizma-mark`** (как primary).
- focus-visible — на CTA-кнопке (карточка не в таб-цепочке, см. 3.1).

### 3.4. Keyboard navigation flow по дашборду

Tab-последовательность (предлагаемая):

```
[топбар-кнопки]  → пропускаются для дашборда — есть skip-link «К содержанию»

1. Hero — без таб-стопа (звезда + 57% — презентация)
2. Action-card 1 «56 задач без релиза» — Tab/Enter → Реестр
3. Action-card 2 «12 требуют подтв.»     → Реестр
4. Action-card 3 «3 блокера»             → Реестр
   --- Section break (focus group divider) ---
5. KPI-card 1 «Всего задач»              → modal-kpi
6. KPI-card 2 «В scope (Да)»             → modal-kpi
... (всего 12 KPI)
   --- Section break ---
17. Progress-card 1 «1.20» (если станет кликабельной)
... (5 progress)
22. Release-card 1 «1.20 — расширенная»
... (4 release)
26. risks-panel — пропускается (read-only)
27. blocking-detail-card таблица — таблица фокусируется как region (см. ARIA §4)
28. teams-summary таблица
29. no-release таблица
30. needs-confirm таблица
```

Внутри `modal-kpi` — focus-trap (сейчас отсутствует! см. ARIA §4.5).

---

## Section 4 — ARIA / a11y

### 4.1. Landmarks / regions

- `<section id="section-dashboard">` — должен иметь `role="region"` (или просто `<section aria-label="Сводный дашборд курса квартала">`).
- `dashboard-kpi` — `role="region"` + `aria-label="Ключевые показатели курса"`.
- `risks-panel` — `role="region"` + `aria-labelledby="risks-panel-title"` (заголовок уже есть, нужен `id`).
- `release-breakdown` — `role="region"` + `aria-label="Разбивка по релизам"`.
- Каждая `.data-table-wrap` (Сводка / Без релиза / Требует подтв.) — `role="region"` + `aria-labelledby` ссылается на `.data-table-title` (нужно дать `id`).

### 4.2. Status / live regions

- `dashboard-kpi` — добавить `aria-live="polite"` + `aria-atomic="false"`. Когда числа пересчитываются после bulk/import — screen-reader получит «Всего задач 312, ранее 248» (если использовать `aria-relevant="text"`).
- `prizma-hero-kpi` (главное число «57%») — отдельный `aria-live="polite"` + `aria-atomic="true"` (читать всё число, не дельту).
- Прогресс-бары `.progress-bar-fill` — `role="progressbar"` + `aria-valuemin="0"` `aria-valuemax="100"` `aria-valuenow="{pct}"` `aria-label="{label} {done} из {total}"`.

### 4.3. Screen-reader-only labels для иконок

- `.signal-dot.signal-drift` уже имеет `role="img" aria-label="Перегрузка"` — хорошо.
- `.prizma-empty-glyph` — `aria-hidden="true"` уже есть — хорошо.
- В hero-supporting числа сейчас просто текст «3 / ДРЕЙФ» — для screen-reader читается как «3 dreif». Нужно `aria-label="3 задачи в дрейфе"` на `.prizma-hero-supporting-item` или `<span class="visually-hidden">задачи в состоянии</span>` между числом и подписью.

### 4.4. KPI-карточка

Сейчас:
```html
<div class="kpi-card kpi-card-clickable signal-drift" role="button" tabindex="0" data-kpi="needs_confirm" aria-label="Перейти к Треб. подтв.">
```
**Замечания:**
- `aria-label` усечённый: «Перейти к Треб. подтв.» — screen-reader читает «Treb. podtv.» как одну букву. Лучше: `aria-label="Перейти к ${labelExpanded}: ${value} задач"`. Например, `aria-label="Открыть в реестре: требует подтверждения, 12 задач"`.
- `aria-describedby` или `aria-pressed` не нужны (это не toggle).
- Контракт: `role="button"` + `tabindex="0"` + ручной keydown-handler для Space/Enter — это **антипаттерн**, нативный `<button>` сделал бы это бесплатно. **Однако** мы read-only-аудит: фиксируем, что текущая реализация **корректна** для своего жанра, но при следующем рефакторе KPI-карточка должна стать `<button class="kpi-card kpi-card-clickable ...">` (a11y-выигрыш + меньше кода в `el.onkeydown`).

### 4.5. Focus management при навигации в Реестр (важно)

Сейчас `modal-kpi-goto-registry` (app.js путь):
```js
overlay.classList.add('hidden');     // закрыли модал
window.App?.goTo?.('registry');      // перешли в Реестр
```

**Проблема:** focus после `goTo('registry')` остаётся «в воздухе» (на закрытом overlay). Screen-reader-юзер не знает, что навигация произошла. WCAG 2.4.3 — Focus Order.

**Что должно быть:**
1. После `goTo('registry')` — установить focus на h2 раздела `#section-registry > .section-header > h2` (нужен `tabindex="-1"` чтобы можно было программно фокуснуть).
2. Перед навигацией — `aria-live` toast «Открываю реестр с фильтром: {payload}».
3. Внутри `modal-kpi` — focus-trap (focus не уходит за пределы modal, ESC закрывает, focus возвращается на исходную KPI-карточку).

### 4.6. Action-card (новый Hero «требует курса»)

```html
<div class="dash-hero-action signal-off-course">
  <div class="dash-hero-action-num">56</div>
  <div class="dash-hero-action-text">задач без релиза в 1.20</div>
  <button class="prizma-btn prizma-btn-secondary" 
          aria-label="Распределить 56 задач без релиза, перейти в реестр">
    Распределить
  </button>
</div>
```

Контейнер `.dash-hero-action` — без `role="button"` (избегаем double-button-trap), focus только на кнопке.

---

## Section 5 — Motion на дашборде

Brandbook §9 определяет 4 жеста: **Emerge / Breathe / Pulse / Align**.

### 5.1. Что есть сейчас

- **Breathe** — на `.prizma-hero-mark` (4s ease-in-out, infinite). Хорошо.
- **Breathe** — на `.prizma-empty-glyph` в `dash-empty` (та же кривая). Хорошо.
- **Emerge** — нигде в дашборде не используется.
- **Pulse** — нигде.
- **Align** — нигде.

### 5.2. Что должно появиться

#### Emerge — появление KPI-grid после empty → данные пришли

**Когда:** пользователь импортировал XLSX, `rows.length` стал > 0, render() пересобрал dashboard-kpi.
**Как:** на каждой `.kpi-card` — `animation: kpi-emerge 1100ms cubic-bezier(0.16, 1, 0.3, 1)` со stagger по 50ms (как splash). Карточки появляются волной слева-направо.
**Параметры (предлагаю):** `opacity: 0 → 1`, `transform: translateY(8px) → translateY(0)`. Не scale (карточка должна оставаться в своём footprint в гриде, иначе соседние прыгают).

#### Pulse — внимание к новой задаче / новому signal

**Когда:** прилетел Jira-update (через poll или webhook): новая задача попала в «требует подтверждения» / появился новый риск.
**Как:** на соответствующей `.kpi-card.signal-drift` или action-card — `prizma-pulse-ring` (как у `dirty-pulse`-keyframe, но spec'нутый по brandbook §9.3): `scale: 0.4 → 1.6` ring + `opacity: 0.8 → 0`, 1600ms ease-out, **3 повторения** (не infinite — иначе motion-fatigue для Игоря, который смотрит дашборд 8 часов).
**Где НЕ применять:** на каждом render() — только когда **появилось новое**, не когда число пересчиталось.

#### Align — переход «дашборд → реестр» (KPI-modal CTA)

**Когда:** пользователь нажал «Открыть в реестре с фильтром».
**Как:** на топбар-mark (звезда в шапке) — `prizma-align` 1600ms cubic-bezier(0.34, 1.56, 0.64, 1) (rotation -12° → 2° → 0°). Это уже декларировано в brandbook §9.4 для смены контекста. Сейчас не применяется к navigation-events.
**Bonus:** `breathe` на hero-mark **приостанавливается** на время `align` (одна анимация за раз, brandbook §9 принцип 3) и возвращается после.

#### Breathe — оставить как есть

На hero-mark и empty-glyph. **Не добавлять** breathe на kpi-card — это будет суетой (12 dancing cards).

### 5.3. Reduced-motion fallback

Сейчас `@media (prefers-reduced-motion: reduce)` останавливает только `.prizma-hero-mark` (styles.css:582). Нужно расширить:

```css
@media (prefers-reduced-motion: reduce) {
  .prizma-hero-mark,
  .prizma-empty-glyph { animation: none; }
  .kpi-card { transition: none; transform: none !important; }
  .kpi-card:hover { transform: none !important; }
  /* emerge, pulse, align — не запускать вообще */
  .kpi-card.is-emerging,
  .signal-pulse-ring,
  .topbar-mark.is-aligning { animation: none; }
  /* opacity-only fade для emerge: 0→1 без translate */
}
```

Игорь и Дмитрий, вероятно, оставят motion включённым; Светлана любит дыхание (12-feedback.md строка 125 — «звезда дышит, это успокаивает»).

---

## Section 6 — Concrete proposal (8–15 пунктов)

| # | Что | Приоритет | Эффорт |
|:--:|---|:--:|:--:|
| 1 | **Hero «Что требует курса»** — 1–3 action-card между prizma-hero и dashboard-kpi (см. §3.1) | must | M |
| 2 | **Empty-state CTA** — две кнопки «Импортировать XLSX» / «Применить шаблон» внутри `.dash-empty` | must | S |
| 3 | **Focus-management при KPI-modal → Реестр** — установить focus на `#section-registry h2`, добавить focus-trap в modal-kpi (см. §4.5) | must | S |
| 4 | **`aria-live="polite"`** на `#dashboard-kpi` и `.prizma-hero-kpi` | must | S |
| 5 | **`role="region" + aria-labelledby`** на каждом блоке дашборда (см. §4.1) | must | S |
| 6 | **`aria-label` KPI-карточки расширить до «Открыть в реестре: {label}, {value} задач»** | should | S |
| 7 | **`role="progressbar"` + `aria-valuenow`** на `.progress-bar-fill` | should | S |
| 8 | **focus-visible на KPI** перевести с `text-primary` на `prizma-information` + offset 3px | should | S |
| 9 | **Emerge на kpi-grid** после rows.length === 0 → > 0 (stagger 50ms) | should | M |
| 10 | **Align на topbar-mark при KPI → Реестр navigation** | should | S |
| 11 | **prefers-reduced-motion расширить** на kpi-card transition + hover transform | should | S |
| 12 | **Pulse при появлении нового risk/needs_confirm** (3 повтора) | could | M |
| 13 | **Release-card / progress-card сделать кликабельными** (как KPI), вести в modal-kpi с тем же фильтром, что у KPI `r120/r121/r122` | could | M |
| 14 | **Снять `cursor:pointer`-обещание** с `.prizma-hero-supporting-item` (или сделать кликабельным) | could | S |
| 15 | **При следующем рефакторе** — заменить `<div role="button" tabindex="0">` KPI-карточек на `<button class="kpi-card">` (избавляет от ручного keydown-handler в dashboard.js:146-152) | could | M |

> Эффорт: S = ≤ 1 день, M = 2–5 дней, L = неделя+. Все S без архитектурных рисков.

---

## Section 7 — Спорные моменты (конфликт с IA / Visual / Motion)

### 7.1. Action-card в hero vs «дашборд = read-only мониторинг»

**Аргумент против:** некоторые product-owners (не Анна — другие, более «панельные») считают, что дашборд — это **зеркало**, а не пульт. Кнопки «Распределить» на дашборде превращают его в action-page и размывают границу с Реестром.
**Аргумент за (мой):** brandbook §1 говорит «один взгляд на дашборд — и видно, куда движется команда». Если «куда движется» = «есть дрейф», то логичный следующий шаг — «скорректировать траекторию» (§7 словарь Призмы). Action-card — это **скорректировать**, а не «переехать в реестр».
**Резолюция:** action-card — **рекомендация-CTA**, а не bulk-edit-controls. Нет inline-редактирования на дашборде. Клик ведёт в Реестр с предзаполненным фильтром (как KPI-modal сейчас) — это уже принятый паттерн, не новый.

### 7.2. Pulse vs «спокойствие важнее эффектов» (brandbook §9.1)

**Аргумент против:** Pulse-ring 1.6s — мерцание. Игорь (planner с 8-часовым экраном) устанет.
**Аргумент за:** brandbook §9.3 явно разрешает Pulse «когда пришла нотификация / обнаружен дрейф». Это **редкое** событие, не каждый refresh.
**Резолюция:** **3 повтора, не infinite** + cooldown (один Pulse на одно событие, не запускать второй раз для той же KPI пока пользователь не отвёл взгляд / не кликнул). Проверять `prefers-reduced-motion`.

### 7.3. Release-card → кликабельная vs «дублирование KPI»

**Аргумент против:** KPI `r120/r121/r122` уже ведут в модал. Release-card с тем же кликом — два пути к одному месту, IA-confusion.
**Аргумент за:** разный контекст. KPI-card компактна (для скана), release-card — детализирована (mini-breakdown по types и scope). Клик с release-card может вести в **другой** реестровый фильтр (release + breakdown by work-type).
**Резолюция:** не делать в первой итерации (пункт #13 в proposal — could, не must). Сначала — hero-action-card, потом измерить, тыкают ли в release-card; если да — открывать.

### 7.4. Navigation focus → h2 раздела vs первая интерактивная

**Аргумент против:** некоторые a11y-гайды (NN/g) рекомендуют фокус на первый интерактивный элемент новой страницы, не на h2.
**Аргумент за:** Реестр первая интерактивная — это поиск или фильтр-чип, и она НЕ передаёт контекст «куда я попал».
**Резолюция:** focus на h2 + `aria-live` toast «Открыто в реестре с фильтром: дрейф». Двойная страховка.

### 7.5. Breathe на hero-mark — постоянный, без выкл

**Аргумент против:** Дмитрий (12-feedback.md) сказал «mark в шапке симпатичный, breathe-анимация ядра приятно» — но он же про motion-fatigue в Ганте. Если у дашборда 30+ минут открытым, breathe становится фоновым шумом.
**Аргумент за:** brandbook §9.4 «Breathe всегда включён. Это default idle-состояние».
**Резолюция:** **не трогаем** — это контракт brandbook'а. Если жалоба возникнет — добавить настройку «приостановить дыхание звезды» в preferences.

---

## Резюме

Дашборд как **interaction-поверхность** сейчас — на 25% от потенциала: одна интерактивная сущность (KPI-карточки) на 9 контейнеров. Hero — плакат, release/progress/risks/tables — read-only, empty-state — без CTA. Главный must-fix: **action-cards «что требует курса»** — закрывает Анну и Олесю одновременно (insight #1 из 12-feedback.md). Главный a11y-fix: **focus-management + aria-live** при пересчёте чисел и navigation в Реестр (закрывает Игоря). Главный motion-выигрыш: **Emerge** на kpi-grid после empty → данные и **Align** на topbar-mark при переходе в Реестр — это запускает 2 из 4 неиспользуемых жестов brandbook §9.

Все 15 пунктов proposal'а — без нарушения 3 контрактов state.js, без DnD, без переписывания KPI-логики. 8 пунктов — must/should эффорта S (≤ 1 день каждый).

---

Отчёт записан в audit-2026-05-04/dashboard-redesign/03-INTERACTION.md, длина 361 строка.
