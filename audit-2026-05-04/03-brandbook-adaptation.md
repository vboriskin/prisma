# П3 — Адаптация вкладок под брендбук Призмы (без Дашборда)

## TL;DR

Брендбук уже частично применён: `renderPageHeader()` вызывается в 12 из ~25 секций (`views/dashboard.js`, `gantt.js`, `registry.js`, `kanban.js`, `timeline.js`, `metrics.js`, `employees.js`, `aiView.js`, `aiCeoView.js`, `history.js`, `insightsDashboards.js × 4`). KPI-карточки — leaky-abstraction: чёрно-серый Spine-pill (`.kpi-card`, `.kpi-green/red/blue/yellow`) сосуществует с prizma-токенами (`.prizma-hero`, `.prizma-page-eyebrow`). Ни одна вкладка кроме `dashboard` не использует mono-tabular numerals на главных числах, и legacy emoji остаются в нескольких местах (`📁 📍 ✅ 👁 🚀`). Цель П3 — единый шрифтовой ритм + signal-цвета как семантика, без нарушения рабочей плотности `registry`/`gantt`.

---

## Карта вкладок и состояние брендирования

| # | Вкладка | section-id | Файл рендера | Page-header | Использует prizma-токены |
|---|---|---|---|---|---|
| 1 | Дашборд (Курс) | `section-dashboard` | `views/dashboard.js:60` | да | hero+supporting |
| 2 | Сводка | `section-summary` | `views/dashboard.js` (renderTeamsSummary) | нет | нет |
| 3 | Метрики | `section-metrics` | `views/metrics.js:23` | да (через helper) | частично |
| 4 | Инсайты | `section-insights` | `views/dashboard.js`/`insightsDashboards.js` | нет | нет |
| 5 | Реестр | `section-registry` | `views/registry.js:44` | да | только header |
| 6 | Гант | `section-gantt` | `views/gantt.js:39` | да | только header |
| 7 | Канбан | `section-kanban` | `views/kanban.js:124` | да | только header |
| 8 | Таймлайн | `section-timeline` | `views/timeline.js:26` | да | только header |
| 9 | История | `section-history` | `views/history.js:58` | да | + empty-glyph |
| 10 | Сотрудники | `section-employees` | `views/employees.js:212` | да | KPI legacy |
| 11 | Выгорание | `section-burnout` | `views/insightsDashboards.js:226` | да | нет |
| 12 | Здоровье компонентов | `section-component-health` | `views/insightsDashboards.js:150` | да | нет |
| 13 | AI-CEO (Цели) | `section-ai-ceo` | `views/aiCeoView.js:303` + `ai/aiCeoRenderer.js:65` | да | hero legacy `ceo-hero-*` |
| 14 | Действия | `section-actions` | `views/dashboard.js` (renderActions) | нет | нет |
| 15 | AI-Анализ | `section-ai` | `views/aiView.js:218` + `ai/aiRenderer.js:361` | да | `ai-layout-hero` legacy |
| 16 | Калибровка оценок | `section-est-calibration` | `views/insightsDashboards.js:102` | да | нет |
| 17 | Долги документации | `section-doc-debt` | `views/insightsDashboards.js:313` | да | нет |
| 18 | Интеграции | `section-integrations` | `views/integrationsView.js` | нет | нет |
| 19 | Журнал ошибок | `section-errors` | `views/errorsView.js:66` | нет | нет |
| 20 | Подложка | `section-podlozhka` | `index.html:1022` | нет | нет |
| 21 | Диагностика | `section-diagnostics` | `index.html:1131` | нет | нет |
| 22 | LLM-чат | `chat-*` (модальный/панель) | `chat/chatUIRenderer.js` | нет | нет |
| 23 | Сценарии | — | (не найдено в коде) | — | — |
| 24 | Фиды | — | (не найдено в коде) | — | — |

> **Прим.:** Вкладок «Сценарии» и «Фиды» среди `data-section=*` нет (`grep` не нашёл). Если они подразумеваются как будущие — привязать к шаблону, описанному в §«Универсальный page-header» ниже.

---

## Подробная таблица: разрыв vs. брендбук + правки

> Эксперты-роли: **BD** = brand designer, **TL** = typography lead, **MD** = motion designer, **A11y** = accessibility reviewer.

### 2. Сводка (`section-summary`)

| Слой | Текущее | Разрыв с брендбуком | Что менять | Эксперт |
|---|---|---|---|---|
| Хедер | нет page-header | §4 «caption 11px / 1.5px» отсутствует | Обернуть в `renderPageHeader('summary', { sub })` | BD |
| Числа | `summary-hero-kpi .v` (system font) | mono-tabular не задано | Применить `font-family: 'JetBrains Mono'`, `font-feature-settings: "tnum" 1` | TL |
| Сабхедеры | `<h2>` 16px regular | §4 «Caption» CAPS 11px lsp 1.5px | Заменить на `.prizma-page-eyebrow` | TL |
| Цвет акцента | мягкий синий (`#3b82f6`) | §3 «не декорация» | Только `--prizma-information` для info-карточек | BD |
| Motion | прыжок без переходов | §9 Emerge | Применить `prizma-emerge-core` к hero при первом рендере | MD |

### 3. Метрики (`section-metrics`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| `.metrics-hero-title` | 18px medium | §4 H1 28px 300 | Заменить на `.prizma-page-h1` | TL |
| `.summary-super-hero` (`views/metrics.js:281`) | gradient-фон | §П12 «не цветные» | Убрать gradient → `--prizma-bg-elevated` | BD |
| Signal-карточки | свои `.kpi-red/green/blue` | дубль signal-палитры | Маппинг: red→`--prizma-off-course`, green→`--prizma-on-course`, yellow→`--prizma-drift`, blue→`--prizma-information` | BD |
| Числа | system font | не tnum | Mono-tabular для всех `.v` | TL |
| 3px stripe-left | нет | §«spine-pill» | На критичных карточках добавить `border-left: 3px solid var(--prizma-off-course)` вместо filled-bg | BD |

### 4. Инсайты (`section-insights`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Хедер | отсутствует | §4 нет eyebrow | `renderPageHeader('insights', { sub: 'Сигналы курса: что меняется быстрее ожиданий.' })` | BD |
| Hero-блок | (не найден в коде) | §пропущен | Добавить `renderHero({ kpi: <count of insights>, caption: 'СИГНАЛОВ ЗА НЕДЕЛЮ' })` | BD |
| Цвет инсайтов | разные акценты | §3 Insight = `#B084CC`/`#6B4488` | Все badge-инсайты только `--prizma-insight` | BD |
| Caption | разный регистр | §4 Caption 11px UPPERCASE | Нормализовать заголовки списков | TL |

### 5-8. Реестр / Гант / Канбан / Таймлайн (рабочая плотность)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Page-header | есть | OK | оставить | — |
| Тело таблицы/доски | плотная сетка | НЕ ТРОГАТЬ — рабочая плотность важнее ритма | См. список «не трогать» | BD |
| Фокус-кольцо | отсутствует/тонкое | §A11y | `:focus-visible { box-shadow: 0 0 0 2px var(--prizma-information) }` | A11y |
| Числа в ячейках | system font | mono-tabular для дат/PK | Применить `font-feature-settings: "tnum"` к `.cell-jira-pk`, дат-ячейкам | TL |
| Active-row | filled background | §«3px stripe-left» | Заменить filled на `border-left: 3px solid var(--prizma-mark)` | BD |

### 9. История (`section-history`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Hairline между записями | толстая полоска | §3 `--prizma-border` 8% | `border-top: 1px solid var(--prizma-border)` | BD |
| Таймстамп | system font | mono-tabular | `font-family: JetBrains Mono` для всех timestamp | TL |
| Empty-state | уже использует `prizmaEmptyGlyph()` | OK | оставить | — |
| Categorical chips | gradient | §П12 без gradients | Solid signal-bg | BD |

### 10. Сотрудники (`section-employees`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| KPI-карточки (`employees.js:244-247`) | `.kpi-card .kpi-green/red/blue` | дубль signal-палитры | Свернуть на `--prizma-on-course/off-course/information` | BD |
| `.kpi-value` | system font | не tnum | Mono-tabular | TL |
| `.kpi-label` | 13px regular | §4 Caption 11px / 1.5px | Заменить на eyebrow-стиль | TL |
| Аватары/инициалы | разноцветные | §3 «5% signal» | Только нейтральная палитра + signal только для статуса «в OT» | BD |

### 11. Выгорание (`section-burnout`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| `.ts2-sd-bad/.ts2-sd-mid/.ts2-sd-good` | свои hex | дубль signal | Маппинг bad→`--prizma-off-course`, mid→`--prizma-drift`, good→`--prizma-on-course` | BD |
| `.ts2-sd-pct` (число %) | system font | не tnum | mono-tabular | TL |
| Tone of voice заголовков | нейтрально | §7 «Партнёр» | «Watchtower» (англ.) → «Дозор курса» | BD |
| Pulse при новом сигнале | отсутствует | §9 Pulse | `prizma-pulse-ring` на счётчик новых событий | MD |

### 12. Здоровье компонентов (`section-component-health`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| `bf=1` маркер | красный текст | signal-pill | Заменить на `<span class="prizma-pill" data-signal="off-course">bf=1</span>` | BD |
| `.insights-dash-hint` | `<p>` 13px | §4 BodySmall | OK, оставить | — |
| H3 «Компоненты по нагрузке» | 16px medium | §4 Subtitle 18px / 500 | Привести к 18px / 500 | TL |

### 13. AI-CEO / Цели (`section-ai-ceo`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| `.ceo-hero` (`ai/aiCeoRenderer.js:65`) | свой layout, классы `ceo-hero-ok/risk/critical` | дубль prizma-hero | Обернуть тот же `renderHero` + signal-color на корне | BD |
| `📍 ✅ 👁` emoji | livin'-emoji в `aiCeoRenderer.js:62`, `74` | §«без эмодзи» | Заменить на star-glyph + signal-color | BD |
| `ceo-hero-score-ring` | свой gradient | §П12 | Solid arc, цвет = signal | BD |
| Hero-число «56%» | system font 32px | hero-kpi 48px mono | Привести к `.prizma-hero-kpi` (48px JetBrains Mono) | TL |
| «ПРОЕКТ ПОД РИСКОМ» | bold caps 14px | §4 caption 11px / 1.5px | `.prizma-hero-caption` | TL |

### 14. Действия (`section-actions`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Хедер | отсутствует | §4 нет eyebrow | `renderPageHeader('actions', ...)` | BD |
| Action-card | filled bg + emoji | §«stripe-left» / «без эмодзи» | 3px stripe-left + caps-eyebrow | BD |
| CTA | разноцветные кнопки | §4 prizma-btn | Унифицировать на `.prizma-btn-primary/secondary` | BD |

### 15. AI-Анализ (`section-ai`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| `.ai-layout-hero` (`ai/aiRenderer.js:361`) | свой класс | дубль prizma-hero | Заменить на `renderHero()` | BD |
| Loader при генерации | `showPageLoader` | OK | оставить | — |
| Recommendation-карточки | filled цвет по приоритету | §«stripe-left» | 3px stripe-left + signal | BD |

### 16. Калибровка оценок (`section-est-calibration`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Числа точности (0.7-1.3) | system font | не tnum | mono-tabular | TL |
| Hint-параграф | OK | — | — | — |
| Заголовки колонок | `<h3>` 16px | §4 Subtitle | 18px / 500 | TL |
| Color на «недооценивает» / «переоценивает» | нет | signal | drift / off-course | BD |

### 17. Долги документации (`section-doc-debt`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Owner-pills | filled bg | stripe-left | 3px left | BD |
| Дни-просрочки | system font | не tnum | mono-tabular | TL |
| Empty-state | текст | §11 Loaders | `prizmaEmptyGlyph()` | BD |

### 18. Интеграции (`section-integrations`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Хедер | отсутствует | нет eyebrow | `renderPageHeader('integrations', ...)` | BD |
| Verify-кнопки | разноцветные | §4 buttons | `prizma-btn-secondary` + spinner на `prizma-loader-inline` при работе | BD/MD |
| Status-pill «✅ Connected» | emoji | без эмодзи | Заменить на signal-pill «На курсе» / «Дрейф» / «Сбился» | BD |
| Тон сообщений | техн. | §7 ToV | «Призма видит: 3 проекта, последняя сверка — 14:02» | BD |

### 19. Журнал ошибок (`section-errors`)

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Хедер | отсутствует | нет eyebrow | `renderPageHeader('errors', ...)` | BD |
| Severity-цвет | свой red/yellow | signal | off-course / drift | BD |
| Stack-trace | system font | mono | JetBrains Mono | TL |
| Empty-state | текст «Ошибок нет» | §11 | star-glyph + caption «КУРС ЧИСТЫЙ» | BD |
| Live-pulse при новой ошибке | нет | §9 Pulse | prizma-pulse-ring | MD |

### 20-21. Подложка / Диагностика

| Слой | Текущее | Разрыв | Что менять | Эксперт |
|---|---|---|---|---|
| Хедер | отсутствует | — | `renderPageHeader(...)` | BD |
| Layout | сырой | — | Один `.prizma-page > .prizma-page-body` | BD |
| Контролы | кнопки разные | — | Унифицировать на prizma-btn | BD |

### 22. LLM-чат (`chat/*`)

| Слой | Текущее | Разрыв с брендбуком | Что менять | Эксперт |
|---|---|---|---|---|
| Hero-приветствие (`chat-empty` — отсутствует) | (не найдено в коде) | §4 нет hero | Добавить hero с прозрачной звездой 48px + caption «ПРИЗМА СЛУШАЕТ» | BD |
| `chat-card-icon` | принимает emoji-параметр (`chatUIRenderer.js:40`) | §«без эмодзи» | Маппинг emoji → signal-pill цветом | BD |
| `chat-review-badge` (`chatUIRenderer.js:101`) | `👁` | §«без эмодзи» | Заменить на star-glyph 12×12 | BD |
| `chat-action-btn-primary` | свой стиль | §4 prizma-btn | Привести к `prizma-btn-primary` | BD |
| `chat-plan-num` | разные значки | §«без эмодзи» | mono-tabular «1·2·3» | TL |
| Спиннер «Призма думает…» | нет | §11 L1 | `inlinePulseLoader('Сверяет курс…')` | MD |
| ToV в pre-set prompts | разный | §7 ToV «партнёр» | Перевести на «сверь курс», «найди дрейф» | BD |

---

## План миграции (5 фаз)

| Фаза | Задача | Затронутые файлы | Риск |
|---|---|---|---|
| **Ф1. Header consistency** | `renderPageHeader()` во всех 25 секциях; eyebrow + h1 + sub + hairline | `views/dashboard.js` (для summary/insights/actions ветвей), `views/integrationsView.js`, `views/errorsView.js`, `index.html` (podlozhka, diagnostics) | низкий — изолировано |
| **Ф2. Typography unify** | Mono-tabular на всех числах (`tnum`); CAPS 11px / 1.5px на всех eyebrows; H1 28px / 300 | `styles.css` (глобальные классы), `views/metrics.js`, `views/employees.js`, `chat/*` | низкий |
| **Ф3. Signal palette merge** | Свернуть `.kpi-red/green/blue/yellow`, `.ts2-sd-bad/mid/good` на 5 prizma-signal токенов | `styles.css`, `views/employees.js:244-247`, `views/insightsDashboards.js`, `views/dashboard.js:91-103` | средний — широкая замена, нужна grep-проверка регрессов |
| **Ф4. Stripe-left + ban-emoji + ban-gradients** | 3px stripe-left на active/highlighted; убрать `📁 📍 ✅ 👁` всюду; убрать gradients на surfaces | `ai/aiCeoRenderer.js:62,74`, `chat/chatUIRenderer.js:40,101`, `views/metrics.js:281` | средний — emoji ловятся регуляркой `/[\u{1F300}-\u{1FAFF}]/u` |
| **Ф5. Motion + ToV** | Emerge на первом рендере; Pulse на новых сигналах; ToV-аудит UI-строк | `app/init.js`, `views/errorsView.js`, `views/insightsDashboards.js`, локали и текстовки | низкий, но требует QA-обхода |

---

## Список «не трогать» (рабочая плотность)

1. **Реестр** (`views/registry.js`) — таблица 9-row dense layout, минимальные паддинги — НЕ менять line-height, padding, font-size ячеек.
2. **Гант** (`views/gantt.js`) — тайм-сетка с ячейками 24px, текст 11-12px — оставить как есть.
3. **Канбан** (`views/kanban.js`) — карточка задачи в колонке, плотность важнее ритма.
4. **Таймлайн** (`views/timeline.js`) — диаграмма по неделям, пользователь сравнивает плотность.
5. **Подложка** (`section-podlozhka`) — служебный отладочный экран, ребрендинг не приоритет.
6. **Sigma fields** в `jira_config.json` — служебная конфигурация, не UI.

В этих местах меняются **только** page-header (eyebrow + h1 + hairline), focus-rings и заголовки модалок. Тело таблицы/доски — нет.
