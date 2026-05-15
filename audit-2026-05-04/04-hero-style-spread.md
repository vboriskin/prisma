# П4 — Распространение hero-стиля Дашборда на остальные вкладки

## TL;DR

Hero-блок Дашборда (`0% / КУРС КВАРТАЛА / 30 В РАБОТЕ / 3 ДРЕЙФ / 13 БЕЗ КУРСА`) — единственное место в приложении, где брендбук Призмы материализован полностью: 8-лучевая звезда, 48px JetBrains Mono на главном KPI, eyebrow CAPS 11px / 1.5px на caption. Этот стиль естественно подходит для **summary, metrics, ai-ceo, employees, insights, LLM-chat hero** — везде, где есть один доминирующий «состояние одного взгляда» KPI. Не подходит для: реестра, ганта, канбана, таймлайна — там плотность важнее ритма.

---

## Что конкретно нравится — анатомия Дашборд-hero

Источник в коде: `views/dashboard.js:60-86` через хелпер `app/prizmaUI.js:76-92` (функция `renderHero`). CSS: `styles.css:543-586`.

### Иерархия элементов

```
prizma-hero  (column flex, gap 8px, padding 24px 0)
├── prizma-hero-mark   — 8-лучевая звезда 64×64px (`STAR_SVG_INLINE`, currentColor)
├── prizma-hero-kpi    — главное число «0%»
├── prizma-hero-caption — «КУРС КВАРТАЛА»
└── prizma-hero-supporting (row flex, gap 32px)
    └── prizma-hero-supporting-item × 3
        ├── prizma-hero-supporting-num   — «30», «3», «13»
        └── prizma-hero-supporting-lab   — «В РАБОТЕ», «ДРЕЙФ», «БЕЗ КУРСА»
```

### Типографические спецификации

| Слой | Шрифт | Размер | Вес | Letter-spacing | Источник |
|---|---|---|---|---|---|
| `prizma-hero-kpi` | **JetBrains Mono / SF Mono / Menlo / Consolas** | 48px | 300 | -1px | `styles.css:556-562` |
| `prizma-hero-kpi` feature | `font-feature-settings: "tnum" 1` | — | — | — | tabular numerals |
| `prizma-hero-kpi` color | `var(--prizma-text-primary)` | — | — | — | `#FFFFFF` dark / `#1A1A22` light |
| `prizma-hero-caption` | **SF Pro Display** | 11px | 500 | 1.5px | `styles.css:563-568` |
| `prizma-hero-caption` style | `text-transform: uppercase` | — | — | — | — |
| `prizma-hero-caption` color | `var(--prizma-text-secondary)` | — | — | — | `#5A5A64` dark / `#7A7A82` light |
| `prizma-hero-supporting-num` | **JetBrains Mono** | 20px | 400 | — | `styles.css:575-580` |
| `prizma-hero-supporting-num` feature | `tnum 1` | — | — | — | mono-tabular |
| `prizma-hero-supporting-lab` | SF Pro Display | 10px | 500 | 1.2px | `styles.css:581-586` |
| `prizma-hero-supporting-lab` style | UPPERCASE | — | — | — | — |
| `prizma-hero-mark` | inline SVG | 64×64 | — | — | `currentColor`, breathe-keyframe candidate |

### Расстояния (spacing)

| Между чем | Промежуток | Источник |
|---|---|---|
| Лучи звезды → KPI | `gap: 8px` + `margin-top: 8px` на kpi | `:546, :561` |
| KPI → caption | `gap: 8px` (от parent flex) | `:546` |
| Caption → supporting-row | `margin-top: 16px` | `:571` |
| Между supporting-items | `gap: 32px` | `:570` |
| Padding hero-блока | `24px 0` | `:547` |

### Использует токены

| Токен | Где | Назначение |
|---|---|---|
| `--prizma-mark` | `.prizma-hero-mark` color | цвет звезды (унаследовано через currentColor от `--prizma-text-primary`) |
| `--prizma-text-primary` | KPI 48px | основной текст |
| `--prizma-text-secondary` | caption и lab | приглушённый текст |
| `--prizma-bg-elevated` | (опционально, если положить hero в карту) | `#1A1A22` dark / `#FFFFFF` light |

### Motion (заложен, не активирован)

В `theme.css:124-138` уже есть `prizma-emerge-core`, `prizma-emerge-ray`, `prizma-breathe`. На `.prizma-hero-mark > svg` сейчас не висят — это «лоу-хэнгинг фрукт» для Ф5 миграции.

---

## Куда ещё естественно подходит этот hero

### 1. Сводка (`section-summary`) — ЕСТЕСТВЕННО

**Сейчас**: блок «Кабинет CEO» с 6 квадратными KPI-плитками (`views/metrics.js:199-208` — там же используется в summary), `summary-hero-title` 18px, числа system font.

**Меняем**:
- Убираем `<div class="summary-hero">`, заменяем на `renderHero({ kpi: progress + '%', caption: 'СВОДНЫЙ ПРОГРЕСС', supporting: [{ num: rows.length, label: 'ВСЕГО' }, { num: blockers, label: 'БЛОКЕРОВ' }, { num: risky, label: 'РИСКИ' }] })`.
- Удаляем 6 KPI-плиток сверху (повтор), оставляем supporting-3.
- Detail-сетку из 3 колонок ниже оставляем как есть.

**Точные классы**:
- удалить: `.summary-hero`, `.summary-hero-title`, `.summary-hero-sub`, `.summary-hero-grid`, `.summary-hero-kpi`
- добавить: `.prizma-page-header`, `.prizma-hero`, `.prizma-hero-mark`, `.prizma-hero-kpi`, `.prizma-hero-caption`, `.prizma-hero-supporting`

### 2. Метрики (`section-metrics`) — ЕСТЕСТВЕННО

**Сейчас**: `metrics-hero` (`views/metrics.js:536-540`) и `summary-super-hero` (`:281`). У последнего gradient-фон — нарушение брендбука §П12.

**Меняем**:
- `metrics-hero-title` («Сводка метрик») → `renderHero({ kpi: pct + '%', caption: 'СВОДНЫЙ ПРОГРЕСС', supporting: [...3 KPI...] })`.
- `summary-super-hero` (gradient) → solid `--prizma-bg-elevated` + 3px stripe-left на критичных карточках цвета `--prizma-off-course`.

**Точные классы**:
- удалить gradient: `.summary-super-hero { background: linear-gradient(...) }` → `background: var(--prizma-bg-elevated)`
- использовать: `.prizma-hero-kpi`, `.prizma-hero-caption`, `.prizma-hero-supporting-num`

### 3. AI-CEO (`section-ai-ceo`) — ОЧЕВИДНО

**Сейчас**: `.ceo-hero` (`ai/aiCeoRenderer.js:65-78`) уже структурно близка к prizma-hero, но: (а) свои классы (`ceo-hero-ok/risk/critical`), (б) emoji `📍 ✅ 👁` в `:62` и `:74`, (в) `ceo-hero-score-ring` со своим gradient, (г) caption «ПРОЕКТ ПОД РИСКОМ» 14px bold caps вместо 11px / 1.5px.

**Меняем**:
- Заменить весь блок на `renderHero({ kpi: health.percent + '%', caption: health.label, supporting: [...причины...] })`.
- Цвет: status-маппинг → `--prizma-on-course` (ok), `--prizma-drift` (risk), `--prizma-off-course` (critical) на корневой `.prizma-hero` через `data-signal=`.
- Score-ring: solid arc цвета signal вместо gradient.
- Удалить все emoji (заменить на 12×12 mini-star slot слева от текста причины).

**Точные классы**:
- удалить: `.ceo-hero`, `.ceo-hero-ok/risk/critical`, `.ceo-hero-score-ring`, `.ceo-hero-label`, `.ceo-hero-causes`, `.ceo-hero-crit-rel`
- добавить: стандартные `.prizma-hero*` + новый модификатор `.prizma-hero[data-signal="off-course"]` (см. CSS-template ниже)
- удалить токены emoji: `📍 ✅ 👁`

### 4. Сотрудники (`section-employees`) — ПОДХОДИТ

**Сейчас**: 4 KPI-карточки в `views/employees.js:244-247` (`.kpi-card.kpi-green/red/blue`). Числа system font. Caption 13px regular.

**Меняем**:
- ВЫШЕ KPI-сетки добавить `renderHero({ kpi: list.length, caption: 'КОМАНДА', supporting: [{ num: weekdayReady, label: 'НА КУРСЕ' }, { num: withOtDays, label: 'В OT' }, { num: taskLinks, label: 'СВЯЗАНО ЗАДАЧ' }] })`.
- KPI-сетку ниже сжать до второстепенной информации (4-7px паддинги, mono-tabular на `.kpi-value`).
- Цвет KPI: `kpi-green` → `--prizma-on-course`, `kpi-red` → `--prizma-off-course`, `kpi-blue` → `--prizma-information`.

**Точные классы**:
- добавить: `.prizma-hero` (новый блок выше), `.prizma-hero-kpi`, `.prizma-hero-supporting`
- модифицировать: `.kpi-value { font-family: 'JetBrains Mono'; font-feature-settings: "tnum" 1; }`
- модифицировать: `.kpi-label { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; }`

### 5. Инсайты (`section-insights`) — ОЧЕНЬ ПОДХОДИТ

**Сейчас**: hero-блока инсайтов нет (поиск `prizma-hero` в `insightsDashboards.js` — пусто).

**Меняем**:
- Добавить hero: `renderHero({ kpi: criticalCount, caption: 'СИГНАЛОВ ЗА НЕДЕЛЮ', supporting: [{ num: drifts, label: 'ДРЕЙФА' }, { num: insightsCount, label: 'ИНСАЙТОВ' }, { num: actionables, label: 'К ДЕЙСТВИЮ' }] })`.
- Корневой `.prizma-hero[data-signal="insight"]` цветом `--prizma-insight` `#B084CC`.

**Точные классы**: `.prizma-hero`, `.prizma-hero-mark`, `.prizma-hero-kpi`, `.prizma-hero-caption`, `.prizma-hero-supporting`.

### 6. LLM-чат (`chat/*`) — ПОДХОДИТ для приветствия и пустого состояния

**Сейчас**:
- Hero-приветствие в чате — (не найдено в коде, `chat-empty`/`chat-welcome` отсутствуют).
- Заголовки сообщений `chat-card-title`, `chat-plan-title` — system font.
- `chat-review-badge` (`chatUIRenderer.js:101`) — содержит `👁` эмодзи + `<strong>`.

**Меняем**:
- **Hero-приветствие** на пустом чате: `<div class="prizma-hero" data-context="chat-empty"><div class="prizma-hero-mark"><svg breathe>...</svg></div><div class="prizma-hero-caption">ПРИЗМА СЛУШАЕТ</div><div class="prizma-page-sub">«Сверь курс», «Найди дрейф», «Кто перегружен?» — спроси.</div></div>`.
- **Заголовки секций ответа** (`chat-card-title`): caps 11px / 1.5px вместо system bold.
- **Empty-state**: использовать `prizmaEmptyGlyph()` вместо текста.
- **Спиннер** «Призма думает...»: `inlinePulseLoader('Сверяет курс…')`.

---

## Где НЕ подходит (не трогать)

| Вкладка | Почему не подходит |
|---|---|
| Реестр (`section-registry`) | Дениз-таблица на 1000+ строк; hero крадёт viewport, ломает рабочий поток. Достаточно page-header. |
| Гант (`section-gantt`) | Тайм-сетка занимает 100% ширины и высоты, hero-блок отнимет 200px. |
| Канбан (`section-kanban`) | WIP-доска: каждый пиксель = задача. Hero лишний. |
| Таймлайн (`section-timeline`) | По-релизная диаграмма по неделям, плотность — приоритет. |
| История (`section-history`) | Хронологический список — hero-KPI не имеет смысла («сколько событий» не главное). |
| Журнал ошибок (`section-errors`) | Нет «одного KPI», который должен доминировать. |
| Интеграции (`section-integrations`) | Список настроек, hero-формат неестественен. Достаточно page-header + status-pill. |
| Подложка / Диагностика | Служебные. |

---

## CSS-template — копипастабельная hero-карточка

```css
/* ============================================================
   PRIZMA HERO — универсальный блок «состояние одного взгляда»
   Использование: <div class="prizma-hero" data-signal="…"><…></div>
   ============================================================ */
.prizma-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  position: relative;
}

.prizma-hero-mark {
  width: 64px;
  height: 64px;
  color: var(--prizma-mark);                  /* звезда наследует currentColor */
  display: flex;
  align-items: center;
  justify-content: center;
  animation: prizma-breathe 4000ms ease-in-out infinite;
}
.prizma-hero-mark > svg {
  width: 100%;
  height: 100%;
}

.prizma-hero-kpi {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
  font-size: 48px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -1px;
  font-feature-settings: "tnum" 1;            /* mono-tabular numerals */
  color: var(--prizma-text-primary);
  margin-top: 8px;
}

.prizma-hero-caption {
  font-family: 'SF Pro Display', -apple-system, sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--prizma-text-secondary);
}

.prizma-hero-supporting {
  display: flex;
  gap: 32px;
  margin-top: 16px;
  justify-content: center;
}
.prizma-hero-supporting-item {
  text-align: center;
}
.prizma-hero-supporting-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 20px;
  font-weight: 400;
  font-feature-settings: "tnum" 1;
  color: var(--prizma-text-primary);
}
.prizma-hero-supporting-lab {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--prizma-text-secondary);
  margin-top: 2px;
}

/* Signal-варианты — окрашивает звезду + KPI в семантику */
.prizma-hero[data-signal="on-course"]  .prizma-hero-mark,
.prizma-hero[data-signal="on-course"]  .prizma-hero-kpi { color: var(--prizma-on-course); }
.prizma-hero[data-signal="drift"]      .prizma-hero-mark,
.prizma-hero[data-signal="drift"]      .prizma-hero-kpi { color: var(--prizma-drift); }
.prizma-hero[data-signal="off-course"] .prizma-hero-mark,
.prizma-hero[data-signal="off-course"] .prizma-hero-kpi { color: var(--prizma-off-course); }
.prizma-hero[data-signal="information"].prizma-hero-mark,
.prizma-hero[data-signal="information"].prizma-hero-kpi { color: var(--prizma-information); }
.prizma-hero[data-signal="insight"]    .prizma-hero-mark,
.prizma-hero[data-signal="insight"]    .prizma-hero-kpi { color: var(--prizma-insight); }

/* Pulse-ring при новом сигнале (нотификация) */
.prizma-hero[data-pulse="true"]::before {
  content: "";
  position: absolute;
  top: 8px; left: 50%;
  width: 64px; height: 64px;
  margin-left: -32px;
  border-radius: 50%;
  border: 2px solid currentColor;
  animation: prizma-pulse-ring 1600ms ease-out infinite;
  pointer-events: none;
}

/* Уважаем prefers-reduced-motion (брендбук §9 принцип 2) */
@media (prefers-reduced-motion: reduce) {
  .prizma-hero-mark,
  .prizma-hero[data-pulse="true"]::before { animation: none; }
}
```

### HTML-разметка (минимальная)

```html
<div class="prizma-hero" data-signal="drift">
  <div class="prizma-hero-mark"><svg viewBox="0 0 120 120">…(STAR_SVG_INLINE)…</svg></div>
  <div class="prizma-hero-kpi">56%</div>
  <div class="prizma-hero-caption">ПРОЕКТ ПОД РИСКОМ</div>
  <div class="prizma-hero-supporting">
    <div class="prizma-hero-supporting-item">
      <div class="prizma-hero-supporting-num">3</div>
      <div class="prizma-hero-supporting-lab">ДРЕЙФА</div>
    </div>
    <div class="prizma-hero-supporting-item">
      <div class="prizma-hero-supporting-num">7</div>
      <div class="prizma-hero-supporting-lab">БЛОКЕРОВ</div>
    </div>
    <div class="prizma-hero-supporting-item">
      <div class="prizma-hero-supporting-num">14</div>
      <div class="prizma-hero-supporting-lab">ДНЕЙ ДО ЦЕЛИ</div>
    </div>
  </div>
</div>
```

### JS-вызов через хелпер (предпочтительно)

```js
import { renderHero } from '../app/prizmaUI.js';
host.innerHTML = renderHero({
  kpi: '56%',
  caption: 'ПРОЕКТ ПОД РИСКОМ',
  supporting: [
    { num: 3, label: 'ДРЕЙФА' },
    { num: 7, label: 'БЛОКЕРОВ' },
    { num: 14, label: 'ДНЕЙ ДО ЦЕЛИ' },
  ],
});
```

> **TODO для хелпера** (`app/prizmaUI.js:76`): добавить опциональный параметр `signal: 'on-course' | 'drift' | 'off-course' | 'information' | 'insight'`, который пробрасывается в `data-signal=` на корневом `.prizma-hero`. Тогда AI-CEO сможет использовать тот же helper без своего legacy-`ceo-hero-*` класса.
