# П9 — Технические неровности в контенте вкладок

> Аудит: форматирование данных (числа, проценты, длительности, даты),
> локализация копи (RU/EN), empty-state-паттерны, лоадеры, tooltip, ARIA.
>
> Эксперт-роли: senior frontend, design-system architect, code-health auditor.

---

## 1. Числа и проценты

### 1.1 Что нашлось

| Подход | Где | Цитата |
|---|---|---|
| `Math.round(x*100)` для процентов | везде | `dashboard.js:73`, `metrics.js:366`, `timeline.js:55` |
| `.toFixed(1)`/`.toFixed(2)` для долей | sparkPath, gantt-pill-progress | `metrics.js:522`, `gantt.js:1161` |
| Inline `(ms / 3600000).toFixed(1)+'ч'` | insightsDashboards | `insightsDashboards.js:33` |
| `Intl.NumberFormat` | **не используется** | — |
| `Intl.RelativeTimeFormat` | **не используется** | `history.js:32-41` ad-hoc |
| Pluralize «1 задача / 2 задачи / 5 задач» | 5 ad-hoc копий | `gantt.js:45`, `insightsDashboards.js:222` |

**Проблемы:**

| # | Что | Цитата |
|---|---|---|
| 1 | Большие числа без separator'а: `<div class="kpi-value">${rows.length}</div>` — для 12 000 задач отрисуется `12000`, а не `12 000`. | `dashboard.js:106`, `employees.js:244` |
| 2 | Проценты округлены differently: `Math.round` (dashboard:73), `.toFixed(1)` (gantt:1161), `.toFixed(2)` (metrics:386 в conic-gradient). Несконсистентно. | См. таблицу выше |
| 3 | `0%` рендерится как `0%` — для empty-state-блока «Прогресс» это unrelated info, лучше `—`. Не везде проверяется. | `dashboard.js:157`, `metrics.js:544` |
| 4 | Нет thousand-separator'а в любом из views. На корп-данных это часто сразу заметно. | — |

> _Senior frontend:_ `Intl.NumberFormat('ru-RU').format(n)` — одна строка
> для thousand-separator. Не используется нигде в 12 400 LOC.

### 1.2 Длительности

В `views/insightsDashboards.js:33`:
```js
function _fmtH(ms) { return ms > 0 ? `${(ms / 3600000).toFixed(1)}ч` : '—'; }
```

Это единственный duration-форматтер в проекте. Нет единого Utils.formatDuration. Если завтра нужно показывать «1ч 30м» вместо «1.5ч» — придётся искать все места.

---

## 2. Даты

### 2.1 Форматы

Найдено **минимум 6 разных** date-форматов в views:

| Формат | Пример | Где |
|---|---|---|
| ISO `YYYY-MM-DD` | `2026-05-04` | `history.js:142, 143` (key для группировки) |
| ISO timestamp (`toISOString`) | `2026-05-04T12:34:56.789Z` | везде в `row.updatedAt`, `row.doneDate`, etc. |
| `DD.MM` | `04.05` | `gantt.js:_shortPeriod (671)` |
| `DD.MM.YY` | `04.05.26` | `gantt.js:fmtMoveDate (706)` |
| `DD.MM–DD.MM` (en-dash) | `20.04–17.05` | `gantt.js:617-621` (release sub-titles) |
| `DD month YYYY` long | `4 мая 2026 г.` | `history.js:147` (`toLocaleDateString('ru', {day,month:'long',year})`) |
| `DD month` long-RU genitive | `20 апреля – 17 мая` | `gantt.js:formatLongRange (61-69)` |
| `DD.MM.YYYY HH:MM:SS` | `04.05.2026 12:34:56` | `history.js:24-30` (`toLocaleString('ru', {...})`) |
| `DD.MM.YYYY, HH:MM:SS` (default) | через дефолт `toLocaleString('ru')` | `errorsView.js:30` (sameDay → time only) |
| `DD.MM, HH:MM` | `04.05, 12:34` | `gantt/aux.js:46-49` (`'ru-RU', {day,month,hour,minute}` без секунд) |

> _Senior frontend:_ десять форматов. Из них четыре — для одного и того же
> кейса «ISO → отобразить пользователю кратко». Это типичная ошибка проекта
> без shared-helper'а: каждый разработчик решает «как короче».

### 2.2 Цитаты

| Где | Что |
|---|---|
| `views/history.js:24-30` | `fmtDateTime` локальная: `toLocaleString('ru', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' })` |
| `views/errorsView.js:24-34` | `_fmtTs`: same-day → `toLocaleTimeString('ru')`, иначе `toLocaleString('ru')` (без options) |
| `views/gantt/aux.js:45-49` | `fmtTime`: `toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })` (без секунд, без года) |
| `views/employees.js:682` | `fmtDate`: `toLocaleDateString('ru')` без options (получаем `04.05.2026`) |
| `views/ganttHtmlExport.js:933, 960, 971, 1027` | `new Date().toLocaleString('ru')` без options — 4 разных места |

Проблема: **`'ru'` vs `'ru-RU'`** — разные locale-tags, на современных браузерах ведут к идентичному результату, но **формально разные**.

### 2.3 Парсинг

| Где | Что |
|---|---|
| `gantt.js:67` | regex `^(\d{2})\.(\d{2})\D+(\d{2})\.(\d{2})` для парса ranges |
| `metrics.js:421` | `parseDate=(v)=>{ const d=new Date(v); return Number.isNaN(d.getTime())?null:d; }` |
| `employees.js:74-79` | `Date.parse(d)` без validate |
| `gantt.js:701-707` | `new Date(iso); if (Number.isNaN(d.getTime())) return ''` (с проверкой) |

Три разных способа safe-parse даты. Нет единого `Utils.parseISO(s)` → `Date | null`.

---

## 3. Локализация

### 3.1 Russian — основной язык

Большинство user-facing строк по-русски: «Загрузить», «Сохранить», «Без релиза», etc.

### 3.2 Где **EN-хардкод**

| # | Что | Цитата |
|---|---|---|
| 1 | LLM-промпты (BLOCK_META) на английском | `aiView.js:31-44` — комментарий объясняет почему: «модель лучше держит формат JSON на английском prompt-tuning'е». **OK by design**, но title-ы блоков русифицированы (`'health': {title:'Здоровье проекта', prompt:'Analyze overall...'}`). |
| 2 | LLM system message русско-английский: `'Tы — AI-аналитик... Trebovaniia: vernis\' tol\'ko JSON po skeme:'` — **транслит в коде**! | `views/aiView.js:86` |
| 3 | TOAST messages — почти все RU. Но `console.warn('[AICeoView] LLM call failed:', ...)` на EN — нормально для логов. | `aiCeoView.js:155` |
| 4 | Empty-state в `errorsView.js:125`: `'Записей пока нет — это хорошо ✨'` — RU + emoji. | `errorsView.js:125` |
| 5 | `ts2-sd-row` placeholder text в insights: `'Нет данных или внерабочая активность = 0% у всех'` — внутри математического `0%` mid-sentence. | `insightsDashboards.js:199` |
| 6 | Title attributes часто включают **технические сокращения**: `'CoV (коэффициент вариации)'`, `'bf=1 — одна точка отказа'`. Это RU + домен-жаргон. Не плохо, но не консистентно. | `insightsDashboards.js:108, 161` |
| 7 | Логи / ошибки в коде на EN: `'[AIView] LLM call failed for block'` — для разработчика, ОК. | `aiView.js:136` |

### 3.3 Чисто-EN строк в UI **не нашлось** (хорошо). Но есть лёгкая «кириллица + латиница» в одной фразе:

- `ganttHtmlExport.js:894` — class `.gex-cell-team` имеет CSS-text «гант-cell-команда» в комментарии.
- `views/insightsDashboards.js:222` — RU label + EN data-key «концентрация ${p.gini.toFixed(2)}».

Не баги, просто примеры органического роста.

### 3.4 Транслит в коде

`aiView.js:86`:
```js
const userMsg = `${meta.prompt}\n\nTrebovaniia: vernis' tol'ko JSON po skeme:\n${BLOCK_SCHEMA}\n\nDannye proekta (JSON):\n${serializeContext(ctx)}`;
```

Это **намеренно** (вероятно — обходить broken UTF-8 в каком-то прокси?). Но без комментария — выглядит как опечатка.

---

## 4. Empty-states

### 4.1 Паттерны (которых нет одного)

| View | Empty markup |
|---|---|
| `dashboard.js:36` | `<div class="empty-state empty-state-inline"><div class="empty-state-title">Курс ещё не проложен</div><div class="empty-state-hint">...</div></div>` |
| `metrics.js:357` | `<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">Нет данных для метрик</div></div>` (без hint, без CTA) |
| `timeline.js:99` | `<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">Нет данных</div></div>` (без хинта) |
| `gantt.js:609` | `<div class="empty-state">${prizmaEmptyGlyph()}<div class="empty-title">Нет данных</div></div>` |
| `kanban.js` | (нет empty-state, просто пустые колонки!) |
| `summary` | `<div class="empty-state"><div class="empty-title">Нет данных для сводной</div></div>` (без glyph) |
| `employees.js:256-257` | Glyph + 2 разных текста для total=0 vs filtered=0, обе с hint и CTA |
| `history.js:96-101` | `<div class="hist-empty">${prizmaEmptyGlyph()}...</div>` — **отдельный класс** `.hist-empty` |
| `errorsView.js:125` | `<div class="errlog-empty">...</div>` — **третий класс** |
| `dashboard.js:199` | `<div style="padding:20px;color:var(--text-3)">Нет строк</div>` — **inline без класса** |

### 4.2 Брендбук L1/L2 паттерн «иконка + caps + body + CTA» — соблюдается?

Брендбук: `my_prisma-brand/BRAND_BOOK.md` (не читал содержимое, но по упоминанию в CLAUDE.md есть design principles).

Из аудита кода: **только `employees.js:256-257` соблюдает паттерн полностью** (glyph + title + hint + CTA-намёк). Остальные — partial:
- 5/10 views имеют glyph
- 8/10 имеют title
- 3/10 имеют hint
- 1/10 имеет реальный CTA
- 0/10 имеют CAPS sub-header (как в Spine-pill принципах CLAUDE.md)

### 4.3 Цитаты несоответствий

| # | Что | Цитата |
|---|---|---|
| 1 | `dashboard.js:199` — empty-state без класса (raw inline). | `dashboard.js:199` |
| 2 | Три разных класс-namespace: `.empty-state`, `.hist-empty`, `.errlog-empty`. | `errorsView.js:125`, `history.js:96` |
| 3 | `kanban.js` — нет empty-state, рендерится 5 пустых колонок с `0` в badge. UX dead-end. | `kanban.js` |
| 4 | Текст empty-state'а: `'Нет данных'` (3-кратно) vs `'Курс ещё не проложен'` (брендовый язык) vs `'Записей пока нет — это хорошо ✨'`. Тон-of-voice неконсистентен. | `gantt.js:609`, `dashboard.js:36`, `errorsView.js:125` |

---

## 5. Лоадеры

### 5.1 Что есть в проекте

| Уровень | Хелпер | Где определён |
|---|---|---|
| L1 — inline pulse (300ms-2s) | `inlinePulseLoader(label)` | `app/prizmaUI.js:119-122` |
| L2 — page loader | `showPageLoader(caption)` | `app/prizmaUI.js:128-150` |
| L3 — full-screen funny | `showFunnyLoader(initialMsg)` | `app.js:213-253` |
| Splash | `<div class="prizma-splash" id="prizma-splash">` | `index.html:44` |

### 5.2 Используется?

| Где | Какой L |
|---|---|
| `views/aiCeoView.js:17, 200+` | `inlinePulseLoader` (L1) + `showPageLoader` (L2) |
| `views/aiView.js:17, ...` | то же |
| `app.js:funnyLoader` | L3 для длинных AI-операций |

### 5.3 Несоответствия

| # | Что | Цитата |
|---|---|---|
| 1 | В views без AI (registry, gantt, employees) — **нет** видимого loader при `Storage.save()`. На больших dataset'ах `forceSave()` может задержать UI. | `app.js:264-292` |
| 2 | `funnyLoader` имеет 20 random phrases с emoji (🤖, ☕, 🐌, ...) — параллельно brandbook требует «без эмодзи в production UI». Намеренное исключение? | `app.js:184-205` |
| 3 | Splash в `index.html:44` использует `role="status"` + `aria-live="polite"` — правильно. Но другие лоадеры (`prizma-loader-inline`, `funny-loader-card`) не нашёл аналогичных ARIA. | `index.html:44` |
| 4 | `inlinePulseLoader` возвращает `<span ... role="status">` — в HTML спецификации `role="status"` на span подойдёт, но screen-reader не объявит его как region — нужен `aria-live`. | `app/prizmaUI.js:121` |

---

## 6. Tooltip / `title` атрибут

### 6.1 Native vs кастом

| Где | Какой tooltip |
|---|---|
| Большинство кнопок в `index.html` | native `title="..."` |
| Гант-пилюли | data-tip + custom `bindFastTooltip` (`gantt/aux.js:`) — **заменяют native** title для скорости (native ждёт ~1.5s) |
| Реестр-cellы | native `title=` через `RH.jiraTagsHtml` |
| Insights-dash | native `title=` для CoV/bf-индексов |

### 6.2 Несоответствия

| # | Что | Цитата |
|---|---|---|
| 1 | Кастомный `bindFastTooltip` (`gantt/aux.js`) — **только в Ганте**. Если пользователь привыкнет к 200ms tooltip-у в Ганте и перейдёт в Реестр, там будет 1500ms wait. UX inconsistency. | `gantt.js:1144-1148`, `gantt/aux.js` |
| 2 | `title` дублирует `aria-label` 6/7 раз в топбаре, см. П8.1. | См. П8 |
| 3 | Иконочные кнопки `.row-act-btn` в реестре имеют `title='Копировать строку'` без `aria-label` — **screen-reader получит только title как accessible-name**, но title не всегда читается (зависит от screen-reader). | `registry.js:296-298` |
| 4 | `.col-pin-btn` имеет **И** `title` **И** `aria-label` с одинаковым текстом (`registry.js:122`) — двойное объявление. | `registry.js:122` |
| 5 | KPI-карточка имеет `title` через… ничего. Hover не показывает что произойдёт по клику. | `dashboard.js:106` |

---

## 7. Accessibility

### 7.1 ARIA в `index.html`

`grep -c 'aria-' index.html → 54`. На 1422 строк HTML. Density низкая.

| Что есть | Где |
|---|---|
| `role="dialog" aria-modal="true"` | **Только** на `gdt-jump-palette` (`index.html:347`) |
| `role="status"` | Splash + tab module-indicator + **inline-loader** |
| `role="img"` | На SVG-марке |
| `role="region"` | На filters-bar (`index.html:754`) |
| `role="log" aria-live="polite"` | На assistant-messages (`index.html:1216`) — комментарий V17 P3 (CHAT-10) |
| `role="button"` | На `topbar-brand` (link-as-button) |
| `aria-pressed` | **Только** на `btn-sim-mode` |
| `aria-expanded` / `aria-controls` | На `btn-toggle-filters` |
| `aria-live="polite" aria-atomic="true"` | На `topbar-module-indicator` (`index.html:441`) |
| `aria-label` | 30+ мест, но не везде где нужно |
| `aria-hidden="true"` | На декоративных SVG-частях (хорошо) |

### 7.2 Что **не покрыто**

| # | Проблема | Цитата |
|---|---|---|
| 1 | 9 из 10 модалок без `role="dialog"` + `aria-modal="true"`. См. П8.2.2. | `index.html:235, 252, ...` |
| 2 | `<table>` в реестре, dashboard, summary, history — **нет `<caption>`** или `aria-label`. Screen-reader не объявляет назначение таблицы. | `dashboard.js:201, 244, 281`, `registry.js` |
| 3 | `.errlog-tab` — кнопки-табы, но нет `role="tab"`/`role="tablist"`/`aria-selected`. Они работают как переключатели, но screen-reader увидит просто кнопки. | `errorsView.js:97-98` |
| 4 | `.hist-stat-card` — кнопка-карточка для filter-toggle. Без `aria-pressed` / `aria-selected`. Состояние «активен» только визуально. | `history.js:87-92` |
| 5 | Иконочные кнопки SVG — большинство имеют `aria-hidden="true"` на SVG (хорошо), но не у всех. Например `.row-act-btn` в registry.js:296 содержит `<svg width="15" height="15" ...>` без `aria-hidden`. | `registry.js:296-298` |
| 6 | KPI-карточки `[data-kpi]` кликабельны, но они **`<div>`** не `<button>` (`dashboard.js:106`). Нет `role="button"`, нет `tabindex`. Только `cursor:pointer` inline. Невидимы для keyboard-only пользователей. | `dashboard.js:106` |
| 7 | Гант-пилюли — `role="button"` + `tabindex` есть (`gantt.js:1172`) — единственное место где kbd-навигация для grid-content реализована вручную. Хорошо, но единичный пример. | `gantt.js:1172-1174` |
| 8 | Drag-and-drop кнопки/ячейки нигде не имеют `aria-grabbed`/`aria-dropeffect` (deprecated, но альтернатив для HTML5 DnD нет — ожидаемая дыра). | — |
| 9 | Empty-state-glyph — SVG без `aria-label`. Декоративный? Если да, нужен `aria-hidden="true"`. | `app/prizmaUI.js` (предполагается) |

### 7.3 Keyboard

| Где | Поддержка |
|---|---|
| Гант — `←/→/↑/↓/Enter/F2/Esc` (roving tabindex) | `gantt.js:96-184` ✓ |
| Реестр — Tab по cell-input'ам | работает default, но нет roving-tabindex в taborder |
| Bulk-edit — Tab + Space на кнопках | default ОК |
| Канбан — drag только мышью | **kbd-only пользователь не может перетащить карточку** |
| KPI-карточка `[data-kpi]` | div без tabindex — **не получит focus** |
| Скип-линк | `index.html:414` ✓ — есть «Перейти к основному содержимому» |
| Keyboard-shortcut Ctrl+S | привязан к `btn-save`, тоже работает |

### 7.4 Lang attribute

`grep <html lang=`: значение не нашёл, но известно что `index.html` может не задавать. Нужно перепроверить — если `<html lang="">` без значения, screen-reader не выберет правильный голос.

---

## 8. Резюме П9

| Пункт | Статус |
|---|---|
| Числа | Без `Intl.NumberFormat`. 4 разных округления процентов. |
| Даты | **10 разных форматов** одного и того же ISO-input'а. Нет общего DateUtils. |
| Длительности | Один `_fmtH` в insightsDashboards. Больше нет. |
| Локализация | RU как основной, ОК. EN-промпты в LLM по design (документировано). Транслит в `aiView.js:86` без комментария. |
| Empty-states | 3 разных CSS-namespace (`empty-state`, `hist-empty`, `errlog-empty`). 0/10 views полностью соответствуют brandbook L1-pattern (icon+CAPS+body+CTA). Канбан вообще без empty-state. |
| Loaders | L1/L2/L3 определены в helpers, используются в AI views. В Registry/Gantt/Employees при `Storage.save` UI не блокируется индикатором. |
| Tooltips | Native vs custom (Гант) — split UX. На иконочных кнопках то `title`+`aria-label`, то только title. |
| Accessibility | 9/10 модалок без `role="dialog"`. Tables без caption. KPI-карточки `<div>` без button-semantics. Канбан без kbd-DnD. |

**Quick wins (≤1 час каждое):**
1. `Utils.fmtDateShort/Long/RelTime` — три функции, заменить 10 ad-hoc.
2. `Utils.fmtNumber(n)` через `Intl.NumberFormat('ru-RU')` — заменить bare `${n}` в KPI-карточках.
3. Все `<table>` в данных-views получают `<caption>` или `aria-label` (можно через RH-helper).
4. KPI-карточкам — `role="button" tabindex="0"` + keyup-handler для Enter/Space.
5. Все 10 модалок: добавить `role="dialog" aria-modal="true"` (single-line edit).

**Medium wins:**
- Единый `EmptyState({title, hint, glyph?, cta?})` builder. Покрыть все 10 views.
- Канбан получает empty-state и kbd-DnD-альтернативу (button-меню «Переместить в…»).
- Plurals — `Utils.pl(n, forms)` единая функция, удалить 5 копий.
