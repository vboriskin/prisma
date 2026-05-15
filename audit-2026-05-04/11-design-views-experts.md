# П11 — Дизайн-аудит вкладок и контента

> Дата: 2026-05-04. Метод: 5 экспертных голосов проходят по ~15 вкладкам приложения, фиксируют локальные проблемы, общие болезни и quick-wins. Источники: `index.html` (sections 845-1156), `views/*.js`, `styles.css` (614 KB, 645 объявлений `border-radius`), `BRAND_BOOK.md`.

**Эксперты:**
- *typography lead* (T) — иерархия, scale, mono-numerals
- *color/brand designer* (C) — палитра, signal vs decoration
- *layout/grid specialist* (L) — отступы, density, baseline
- *accessibility advocate* (A) — контраст, focus, hit-targets
- *editorial illustrator* (I) — hero-блоки, иллюстрации, пустые состояния

---

## 1. Прохождение по 15 ключевым вкладкам

### 1.1 Дашборд (`section-dashboard`, `views/dashboard.js`)

**Вердикт:** «KPI-стенка без иерархии — 12 одинаковых карточек гасят сигнал».

| Эксперт | Проблема |
|---|---|
| T | Hero-цифра `pct + '%'` (строка 77) и `kpi-value` имеют одинаковый weight; глаз не цепляется за главное. |
| C | KPI-классы `kpi-red/yellow/blue/green/teal` (`views/dashboard.js:91-103`) применяются как **декорация** — нарушение брендбука §3.3 («Signal только для статуса курса»). |
| L | `style="cursor:pointer"` инлайн (`dashboard.js:106`) вместо CSS-класса; всё в одном flex-row без визуального group-by. |
| A | `kpi-card` — кликабельный `<div>` без `role="button"`, без `tabindex`, без focus-ring; недоступен с клавиатуры. |
| I | Hero «КУРС КВАРТАЛА» уже есть (`renderHero` строки 76-84), но ниже его 12 KPI разрывают визуальный фокус — нужна graceful demotion. |

**Рейтинг (1-5):** hierarchy 2 / density 2 / colour 2 / motion 3 / consistency 3.

### 1.2 Реестр (`section-registry`, `views/registry.js`)

**Вердикт:** «Excel в браузере — функционально, но визуально плотно и без воздуха».

| | |
|---|---|
| T | Шапка таблицы и body на одном font-size (~12 px); CAPS sub-header (`docs/spine-pill.md`) применён неконсистентно. |
| L | Колонок 20+, density регулируется только глобальным переключателем; нет sticky-первой-колонки в compact-mode. |
| A | `📌 Закрепить` (`views/registry.js:725`) — кнопка только с emoji, без `aria-label`. |
| C | Filter-chips и status-chips соревнуются за внимание (общий `--success-light` и `--warning-light` без визуальной субординации). |
| I | Empty-state при нулевом фильтре отсутствует — пустой `<tbody>` без иллюстрации/CTA. |

**Рейтинг:** hierarchy 3 / density 1 / colour 3 / motion 3 / consistency 3.

### 1.3 Гант (`section-gantt`, `views/gantt.js`)

**Вердикт:** «Toolbar — зоопарк символов на одной полке».

| | |
|---|---|
| T | Кнопки `⌘K ▦ ⇕ ⊟ ↺ ↻` (`index.html:970-978`) рендерятся в трёх font-size (13/14/16 px) — `style="font-size:13px"` инлайн. |
| L | Padding кнопок инлайном `padding:5px 9px` (`index.html:970,974,975`), не использует CSS-переменные `--btn-pad-*`. |
| C | `gex-readonly-badge` (`views/ganttHtmlExport.js:960`) хардкодит `background:#fef3c7;color:#78350f` вместо токена signal-drift. |
| A | Drag-handles между колодцами не имеют видимого focus-ring; ARIA-роль `application` не объявлена. |
| I | Тултипы при drag — текстовые, без preview-сниппета (визуально неинформативны). |

**Рейтинг:** hierarchy 2 / density 2 / colour 2 / motion 4 / consistency 2.

### 1.4 Канбан (`section-kanban`, `views/kanban.js`)

**Вердикт:** «Карточки кричат emoji-чипами».

| | |
|---|---|
| C | `🟢 Merged / 🟡 PR / ⚠️` (`views/kanban.js:100`) — четыре эмодзи + четыре `chip-*` цвета на одной строке. |
| L | Колонки фиксированной ширины не подстраиваются под viewport <1280 px. |
| T | Карточный заголовок и assignee — одинаковый weight; не ясно что primary. |
| A | Drag-and-drop без клавиатурной альтернативы. |
| I | Нет визуальной отметки «overdue» — только текст «просрочено N дней». |

**Рейтинг:** hierarchy 3 / density 3 / colour 1 / motion 3 / consistency 2.

### 1.5 Таймлайн (`section-timeline`, `views/timeline.js`)

**Вердикт:** «Эмодзи разбросаны по cells как декор».

| | |
|---|---|
| C | `✅ doneDate` (`timeline.js:163,193,210`) повторяется 4 раза в одной view — глаз перестаёт его видеть. |
| L | Stat-блоки (`timeline-stat-sub`) и team-row не выровнены по baseline (`baseline grid` нарушен). |
| T | Числа в `timeline-team-count` без mono-tabular numerals на >100. |
| A | Сравнительные цвета между timeline-bars не имеют label — только цвет (нарушение SC 1.4.1). |
| I | Нет «зебры» по неделям — длинные таймлайны сливаются в полосу. |

**Рейтинг:** hierarchy 3 / density 3 / colour 2 / motion 3 / consistency 3.

### 1.6 Подложка (`section-podlozhka`)

**Вердикт:** «Заглушка без идеи раздела». Минимум контента, page-header повторяет шаблон, но без hero-метрики.

**Рейтинг:** hierarchy 2 / density 4 / colour 4 / motion 3 / consistency 3.

### 1.7 Сотрудники (`section-employees`, `views/employees.js`)

**Вердикт:** «Карточки + таблица — два режима без общей сетки».

| | |
|---|---|
| L | Toggle `▦ Карточки` (`employees.js:177`) — emoji-glyph, разная высота с соседним «Список». |
| C | `⚠️` для overload (`employees.js:432`) висит в `<span class="emp-load-total">` — без отдельного chip / signal-dot. |
| T | ФИО и роль одинакового weight; иерархия плоская. |
| I | Empty-state при нулевом фильтре — отсутствует. |
| A | Аватаров нет вообще; alt-fallback инициалов не озвучен SR. |

**Рейтинг:** hierarchy 3 / density 3 / colour 3 / motion 3 / consistency 2.

### 1.8 Сводная (`section-summary`)

**Вердикт:** «Текстовая полировка отчёта без визуального ритма». Нет hero, нет sparkline, нет signal-точек.

**Рейтинг:** hierarchy 2 / density 4 / colour 3 / motion 3 / consistency 3.

### 1.9 Метрики (`section-metrics`, `views/metrics.js`)

**Вердикт:** «Графики без подписей осей и без brand-палитры».

| | |
|---|---|
| C | Type-icon `📈 📊 🚀 📝` (`metrics.js:470-480`) — emoji вместо line-glyph, плюс **дублирование с `views/gantt.js:635`**. |
| T | Числа графиков в `var(--font)`, не в `JetBrains Mono`. |
| L | Гриды графиков 12-col, но canvas-height фиксированный 240 px — небрежно на 4K. |
| A | Decorative SVG без `role="img"`, легенды без связи `aria-describedby`. |
| I | Нет нулевого состояния: график «нет данных» → пустой canvas. |

**Рейтинг:** hierarchy 2 / density 3 / colour 2 / motion 3 / consistency 2.

### 1.10 Инсайты (`section-insights`, `views/insightsDashboards.js`)

**Вердикт:** «Tlead-баннер `⚠ Только для тимлидов` (`insightsDashboards.js:227`) красивый, остальное — серый текст».

**Рейтинг:** hierarchy 3 / density 3 / colour 3 / motion 3 / consistency 3.

### 1.11 Точность оценок / Документация (Ритуалы)

**Вердикт:** «Заглушки секций (`section-est-calibration` пустой `<section>` `index.html:1093`)». Технически рендерятся, но дизайн-каркас отсутствует.

**Рейтинг:** hierarchy 2 / density 4 / colour 3 / motion 3 / consistency 3.

### 1.12 AI-CEO (`section-ai-ceo`, `views/aiCeoView.js`)

**Вердикт:** «Хорошая идея, плохой контраст hard-truths-блока».

| | |
|---|---|
| T | `hardTruths` / `suspicious` / `weakSignals` рендерятся одним размером, не различаются по силе сигнала. |
| C | `severity:'critical/warning/info'` — три значения, но цветов **четыре** (добавлен fallback gray). |
| I | Нет иллюстрации для пустого «всё в порядке»-состояния. |
| L | Кнопка `↺ AI` (`aiCeoView.js:342`) висит правее заголовка без выравнивания по baseline. |
| A | Action-feed item — `<div role="button">` без focus-visible-стиля. |

**Рейтинг:** hierarchy 3 / density 3 / colour 2 / motion 3 / consistency 3.

### 1.13 Действия (`section-actions`, `app/actionLayer.js`)

**Вердикт:** «Каталог действий с emoji-каталогом — не масштабируется».

| | |
|---|---|
| C | 16 действий × emoji-icon (`actionLayer.js:29-51`) — нет style-консистенции (mix утилитарных и декоративных). |
| L | Карточки действий не имеют сетки 12-col; flex-wrap создаёт «лестницу». |
| I | Категории (`CAT_ICONS`) — 8 emoji-иконок без визуального семейства. |

**Рейтинг:** hierarchy 3 / density 3 / colour 2 / motion 3 / consistency 1.

### 1.14 AI Анализ (`section-ai`, `views/aiView.js`)

**Вердикт:** «13 AI-блоков, но визуально все одинаковые». Нет primary-блока (Project Health), нет ranking-визуала.

**Рейтинг:** hierarchy 2 / density 3 / colour 3 / motion 3 / consistency 3.

### 1.15 Интеграции (`section-integrations`, `views/integrationsView.js`)

**Вердикт:** «Тестеры подключений выглядят как DevTools».

| | |
|---|---|
| T | `⏳ Проверяем... / ✓ Подключено / ✗ Ошибка` (`integrationsView.js:133-352`) — 5 повторов, разный контекст. |
| C | Зелёный `✓` и красный `✗` — это signal в инфо-контексте; должны стать `signal-on-course` / `signal-off-course` точкой. |
| L | Поля Jira / BB / Confluence в одной длинной портянке без collapse-сегментов. |
| A | Token-input без `type="password"`, видны открытым текстом. |
| I | Нет диаграммы «как поток идёт» (Pulse pipeline) — текстовое описание в `docs/`, но не в UI. |

**Рейтинг:** hierarchy 2 / density 2 / colour 3 / motion 3 / consistency 2.

---

## 2. Общие болезни (паттерны на всех вкладках)

| Болезнь | Доказательство | Эффект |
|---|---|---|
| **Ad-hoc spacing** | `index.html` — 55 inline-`style="…"` (grep), `views/metrics.js` — 40, `views/timeline.js` — 27, `views/gantt.js` — 17. | Сбой 8-px baseline, диагностика «почему карточки разной высоты». |
| **Emoji как icon-system** | 168 production-попаданий по grep'у; `app/actionLayer.js:29-51` — каталог из 16 emoji. | UI выглядит как Slack-чат, не как enterprise-tool. Брендбук §1 «спокойный, точный» нарушен. |
| **Зоопарк border-radius** | `styles.css` имеет **38 уникальных значений** `border-radius` (от `1.5px` до `20px`, плюс ассимметричные `0 0 12px 12px`, `0 4px 4px 0`). | На одной странице соседние карточки могут быть `8px / 10px / 12px`. |
| **4 семьи шрифтов** | `styles.css`: `'SF Pro Display'`, `'Inter'`, `'JetBrains Mono'`, `'SF Mono'`, плюс fallback `system-ui`, `monospace`, `Menlo`. Брендбук §4 предписывает **2 семьи** (SF Pro Display + JetBrains Mono). | Rendering-наследование непредсказуемо в legacy-браузерах. |
| **Дублирующиеся palette-определения** | `kpi-red/yellow/green` (`styles.css:1221-1227`), параллельно `bd-kpi-*` (`styles.css:11456-11460`), `jp-chip-done` (5326), `chip-teal` (10804). | 3 источника правды для одного и того же «зелёного». |
| **Отсутствие mono-tabular numerals** | Numerics в `views/dashboard.js`, `metrics.js`, `timeline.js` рендерятся в `var(--font)`. CLAUDE.md обещает «`font-feature-settings: "tnum"` на всех числовых». | Цифры «прыгают» при обновлении (3→8→11). |
| **Inline `cursor:pointer`** | `views/dashboard.js:106`, `index.html:81-308`. | Сигнал «кликабельно» подменяет CSS-state, focus-ring не отрабатывает. |
| **Hardcoded hex в JS** | `views/dashboard.js:140-144` (`#3b82f6 #8b5cf6 #10b981 #f97316 #64748b`) — релизные цвета прямо в JS вместо токена. | Тёмная тема не подхватывает; брендбук §3 требует hue-axis-перевод. |
| **Дубль логики между views** | `views/gantt.js:635-645` и `views/metrics.js:470-480` — идентичный type-icon mapper. | DRY-violation, дрифт реализации. |
| **Отсутствие empty / loading / error visual state** | dashboard, registry, employees, integrations — нет иллюстрации для нулевого состояния. Брендбук §11 предлагает 3 уровня loaders, но `inlinePulseLoader` используется только в 1-2 местах. | UI «мигает» пустотой при первом загрузе. |

---

## 3. 10 quick-wins (за 1 день каждый)

1. **Удалить дубль toolbar-кнопок (`index.html:868-869` vs `index.html:977-978`).** Два набора Undo/Redo на одной странице — избыточны и провоцируют conflicting-state. Оставить один с `data-scope="global"`.
2. **Прокинуть `aria-label` во все 14 toolbar-кнопок Гантa и Реестра** (`index.html:868-978`, `views/employees.js:177`). Берётся из `title=""`, всё равно уже написан текст.
3. **Сократить `border-radius` до 4 уровней** (`tokens/radius.json`: `--radius-sm:4 --radius-md:8 --radius-lg:12 --radius-pill:9999`). Поиск-замена даст единообразие на ~80 % UI.
4. **Перевести KPI-карточки дашборда на signal-палитру** (`views/dashboard.js:91-103`). Удалить декоративные `kpi-red/yellow/green` где значение не «статус курса» — заменить на нейтральный `kpi-neutral` с тонкой стрипкой слева (V15 spine-pill).
5. **Убрать `style=""` из `index.html:81-541`** в CSS-классы `.welcome-overlay-flex`, `.modal-kpi-body` и т.д. Это 50+ инлайнов в одном файле.
6. **Заменить 7 type-icon emoji на line-SVG в `views/gantt.js:635, views/metrics.js:470`** (общий helper в `app/prizmaUI.js`). За одно — DRY-fix.
7. **Привести подписи статусов в `views/integrationsView.js:133-352` к signal-dot + текст** (вместо `⏳/✓/✗`). 5 одинаковых блоков, одно место правки.
8. **Удалить fixed-hex в `views/dashboard.js:140-144`** — заменить на `--prizma-release-1-20/21/22/ot/all` CSS-vars; применить в `progress-bar-fill background`.
9. **Включить `font-feature-settings: "tnum"`** на `.kpi-value`, `.timeline-team-count`, `.gex-meta-num`, `.progress-counts`. Один CSS-rule, на всю страницу.
10. **Empty-state иллюстрация** для дашборда (`views/dashboard.js:36-39` уже текст «Курс ещё не проложен») — добавить SVG-звезду 64×64 + breathe-анимация (брендбук §9.2). Один компонент `renderEmptyState({title, hint, illustration:'star-breathe'})` — переиспользуем в Реестре, Сотрудниках, Метриках.

---

## 4. Итоговая матрица (агрегат)

| Вкладка | H | D | C | M | Cn | Среднее |
|---|---|---|---|---|---|---|
| Дашборд | 2 | 2 | 2 | 3 | 3 | **2.4** |
| Реестр | 3 | 1 | 3 | 3 | 3 | 2.6 |
| Гант | 2 | 2 | 2 | 4 | 2 | 2.4 |
| Канбан | 3 | 3 | 1 | 3 | 2 | 2.4 |
| Таймлайн | 3 | 3 | 2 | 3 | 3 | 2.8 |
| Подложка | 2 | 4 | 4 | 3 | 3 | 3.2 |
| Сотрудники | 3 | 3 | 3 | 3 | 2 | 2.8 |
| Сводная | 2 | 4 | 3 | 3 | 3 | 3.0 |
| Метрики | 2 | 3 | 2 | 3 | 2 | 2.4 |
| Инсайты | 3 | 3 | 3 | 3 | 3 | 3.0 |
| Ритуалы (заглушки) | 2 | 4 | 3 | 3 | 3 | 3.0 |
| AI-CEO | 3 | 3 | 2 | 3 | 3 | 2.8 |
| Действия | 3 | 3 | 2 | 3 | 1 | 2.4 |
| AI Анализ | 2 | 3 | 3 | 3 | 3 | 2.8 |
| Интеграции | 2 | 2 | 3 | 3 | 2 | 2.4 |
| **Среднее по продукту** | **2.5** | **2.9** | **2.5** | **3.1** | **2.5** | **2.7 / 5** |

H — hierarchy, D — density, C — colour, M — motion, Cn — consistency.

**Главные удары:** *consistency* и *colour* — 2.5/5. Анимация (motion) — лучший показатель (3.1/5), потому что брендбук §9 уже инфраструктурно реализован. Quick-win №3 (radius-токены) и №4 (signal-цвета KPI) дадут максимум визуального лифта.
