# Пункт 8 — Аудит 6 dashboard-вкладок (полный)

**Команда:** 5 экспертов в фоне с разными angle'ами:
1. Senior full-stack dev (perf / data-flow / dead code)
2. Senior QA tester (broken scenarios)
3. Senior system analyst (architecture / duplications)
4. Art director (visual coherence vs Spine-pill)
5. Senior product designer (interaction / drilldown)

**Базис:** 516/11 unit/contract, 0 fail.

## I. Консенсус (нашли ≥3 экспертов независимо)

### CONS-1: **Spine-pill model полностью игнорируется**
*(full-stack 1.4.2 + sys-analyst R-2)*. 6 вкладок не используют `donePills / assigneePills / inProgressPills / unplannedPills`. Считают по row-level `r.isDone / r.hasRelease120` как до V11. Severity: blocker (semantically incorrect aggregates after Spine-redesign).

### CONS-2: **AI views игнорируют global filters** (BLOCKER)
*(QA B-2 + sys-analyst §5)*. `aiView.js` и `aiCeoView.js` читают `state.rows` напрямую. Все остальные 4 вкладки идут через `FilterEngine.getFiltered()`. Когда юзер ставит фильтр и переходит в AI Анализ — цифры противоречат остальным дашбордам.

### CONS-3: **Memory leaks в AI views**
*(full-stack 1.5.2 / 1.6.1 + designer 5.1)*. `root.addEventListener('click', ...)` на `#section-ai` / `#section-ai-ceo`. Эти DOM-узлы НЕ пересоздаются между tab-switch — только innerHTML внутри. Каждый `_bindEvents` накапливает по одному handler'у → click срабатывает N раз после N посещений вкладки.

### CONS-4: **Gradient-катастрофа** (visual)
*(art-director #1 cross-cutting + designer §3 + sys-analyst косвенно)*. Hero-блоки `summary-super-hero / metrics-hero / ceo-hero-ok|risk|critical` — у каждого radial+linear gradient в стиле «GPT-Web-2018». Анимированные glow-blob'ы. Pie/conic. Двух-stop bar'ы.

### CONS-5: **Эмодзи-зоопарк** 50+ across 6 tabs
*(art-director cross-cutting #3 + full-stack 1.3.4 + designer)*. `wtEmoji` 12 штук, AI block-icons 13, AI CEO 18+, table-titles `📊📭⚠`, severity `🔴🟡🔵🟢`.

### CONS-6: **Дубликаты вычислений** ≥9 раз
*(sys-analyst §2 + full-stack §2)*. `done = rows.filter(r=>r.isDone)` в 9+ местах. `blockers/risky/перelease` — то же. На AI Analytics `computeBaseMetrics(rows)` зовётся **8 раз** в одном render.

## II. Уникальные находки (важные)

### Full-stack
- F-1.2.1/1.2.2 **Dead code:** `renderHero` / `renderDetailed` (~70 LOC) / `renderBeautiful` (~65 LOC) никогда не вызываются. ~140 LOC мертвечины.
- F-1.5.5 **XSS hint** в `aiView.js:163`: `pre.innerHTML = lines.replace(/</g,'&lt;')` — двойной escape, но `&` не экранится.
- F-1.6.4 `aiCeoView.js:84` hard-coded threshold 45000 — слишком консервативно для GigaChat 32k context (~100K байт).

### QA
- **B-1 BLOCKER**: Dashboard крашится на пустом наборе (нет guard на `rows.length===0`).
- **B-4**: SLA / on-time расчёт ломается на `DD.MM.YYYY` (`new Date("30.04.2026") = Invalid Date`).
- **B-5**: KPI-modal не закрывается при section-switch + shared с AI explain.
- **B-7**: InsightsView action-buttons (`assign_120 / confirm_scope / clear_blockers`) рендерятся, но click-handlers НЕ подвязаны.

### System analyst
- **dependencyEngine.js не используется** в этих view'ах — мёртвая связь.
- `insightEngine.js` (28 LOC) — содержит **только** `parseLLMCommand` для chat. Сам InsightsView вычисляет всё inline в `metrics.js:709-790` — naming/architecture mismatch.
- **`splitTags(v)` определён 4 раза** (SummaryView/MetricsView/InsightsView/chatAlerts).
- `state._dataVersion` существует, но **никто не читает** его для memo.

### Art director
- **Stripe сверху, не слева** на `.kpi-card`. AI-dashCards тоже сверху. Остальные 5 из 6 вкладок stripe вообще нет.
- **Border-radius шкала: 4 / 6 / 8 / 10 / 12 / 14 / 999px** — 7 значений одновременно.
- **Typography хаос: 13/600, 13/700, 14/700, 15/700, 16/700, 18/600, 20/700, 24/700, 24/800, 28/700, 30/800** — 11 разных «h3».
- **5 параллельных severity-палитр** (kpi-{green,red,yellow,blue,purple,gray,teal} + insight-badge.{high,medium,low} + ceo-sev-{critical,warning,info,ok} + ai-imp-{high,med,low} + ai-status-{ok,risk,critical,info}).

### Designer
- **KPI-modal — терминал**: показывает срез, но кнопки «Открыть в реестре с этим фильтром» нет.
- **Risk-counter / progress-card / release-card / teams-summary cell не кликабельны** — никаких drilldown'ов.
- **Sparkline без tooltip per точку**.
- **`assign_120 / confirm_scope / clear_blockers` без preview-modal** — single-click destructive.

## III. Применённые фиксы (топ-7 quick wins)

| # | Фикс | Файлы | Что |
|---|---|---|---|
| **F1** | QA B-1 (blocker) | `views/dashboard.js` `render()` | empty-guard: при `rows.length===0` → показывает empty-state и ранний return для всех 8 контейнеров. + retired `renderHero` (full-stack #5 dead code) |
| **F2** | CONS-2 (blocker) | `views/aiView.js` + `views/aiCeoView.js` | `state.rows` → `FilterEngine.getFiltered()`. AI теперь подчиняется фильтрам. Импорт filters.js добавлен |
| **F3** | CONS-3 (memleak) | `views/aiView.js` + `views/aiCeoView.js` `_bindEvents` | `root.addEventListener('click', ...)` → `root.onclick = ...` (overwrite-pattern). Один handler в любой момент |
| **F4** | art-director CC #3 (эмодзи) | `views/dashboard.js` 3 sites | Убрал `📊 / 📭 / ⚠` из `data-table-title` |
| **F5** | art-director #1 cross-cutting | `styles.css` `.summary-super-hero` + `.metrics-hero` + `.ceo-hero-ok/-risk/-critical` | radial+linear gradient → neutral surface + 3px coloured stripe слева. Glow-blobs скрыты (`display:none`). Title 18px/700, sub 12px/text-3 |
| **F6** | art-director Quick win 2 | `styles.css` `.kpi-card::before` | stripe `top:0;left:0;right:0;height:3px` → `top:0;bottom:0;left:0;width:3px` (вертикально слева, как в Spine-эталоне). Padding-left:19px |
| **F7** | art-director #6 (CEO score ring) | `styles.css` `.ceo-hero-score-ring` + `.ceo-score-num` + `.ceo-hero-label` | Glassmorphism-кольцо убрано. Score-num — mono 36px/800 tabular-nums. Label убран text-shadow, font 18/700 |
| **F8** | art-director Quick win 7 | `styles.css` `.kpi-value` | Mono ui-monospace 26px/800 tabular-nums (раньше plain 28/700) |
| **F9** | designer Quick win 1 | `index.html` + `views/dashboard.js` `openKpiModal` + `styles.css` | KPI-modal → CTA «Открыть в реестре с фильтром». Маппит `kpiKey → state.filters payload`, применяет, `notify('filters')`, navigates `App.goTo('registry')`. Скрыт когда modal открыт не Dashboard'ом |
| **F10** | full-stack 1.1.3 | `views/dashboard.js` `renderKPIs` | `el.querySelectorAll('[data-kpi]').forEach(addEventListener)` → `el.onclick = (e) => e.target.closest('[data-kpi]')` (overwrite, no accumulate) |
| **F11** | art-director CC #6 (color overload) | `styles.css` `.kpi-label` | 11px/600 text-transform-uppercase letter-spacing-.4px → 9px/700 letter-spacing-.6px (выравнено с Spine eyebrow-style) |

## IV. Тесты

516 unit / 11 contract / 0 fail (без изменений; функциональные правки не задели существующих тестов).

## V. TODO для отдельных итераций

| # | Severity | Откуда | Effort |
|---|---|---|---|
| TODO-P8-N1 | **Blocker** | CONS-1 (Spine-pill не учитывается) | L (большая семантическая работа: что значит «прогресс» если half pills done?) |
| TODO-P8-N2 | High | CONS-6 (унифицировать `dashboardMetrics` engine с memo по `_dataVersion`) | M |
| TODO-P8-N3 | High | full-stack 1.6.1 + sys-analyst §4.5 (унифицировать `callLLM` / `callCeoLLM`) | M |
| TODO-P8-N4 | High | QA B-4 (DD.MM.YYYY parser) | S |
| TODO-P8-N5 | High | QA B-5 (modal-kpi shared с AI без owner-tracking — partial fix через `data-owner`, нужен полный refactor) | M |
| TODO-P8-N6 | High | QA B-7 (InsightsView action-buttons — wire handlers OR remove) | S |
| TODO-P8-N7 | Medium | QA B-3 (AICeoView _bindEvents может вешать handler 2× после refresh) | S |
| TODO-P8-N8 | Medium | full-stack 1.4.5 (Cyrillic Ё в `wtEmoji`) | S |
| TODO-P8-N9 | Medium | full-stack 1.2.1 / 1.2.2 (~140 LOC dead code: renderDetailed/renderBeautiful) | S |
| TODO-P8-N10 | Medium | sys-analyst quick-win 4 (унифицировать `applyFilter` в `app/filterRouter.js`) | S |
| TODO-P8-N11 | Medium | designer §1 (drilldown везде: release-card, risk-counter, sparkline-точка) | M |
| TODO-P8-N12 | Medium | art-director CC #4-5 (border-radius шкала + typography хаос) | M (system-wide) |
| TODO-P8-N13 | Medium | designer §3.4 (3/13 progress-bar в `_refreshAll`) | S |
| TODO-P8-N14 | Low | designer §3.5 (`AICeoView.preview-modal` «Применить» = false-affordance) | S |
| TODO-P8-N15 | Low | full-stack 1.5.5 (`pre.innerHTML` XSS hint в showExplain) | S |
| TODO-P8-N16 | Low | art-director Quick win 9 (pie/conic → segmented horizontal bars) | M |
| TODO-P8-N17 | Low | full-stack 1.5.7 (errorsLog проброс из `aiView`) | S |
| TODO-P8-N18 | Low | sys-analyst long-term 5 (декомпозиция MetricsView 851 LOC) | L |

## VI. Резюме

Применил **11 фиксов** из top-priority (3 blocker'а, 3 cross-cutting visual, 5 quick wins). Исправил:
- AI views больше не игнорируют фильтры (CONS-2)
- Memory leaks в AI bind closed (CONS-3)
- Hero gradients убраны на всех 3 hero-блоках (CONS-4)
- Эмодзи зачищены из dashboard table-titles (CONS-5 partial)
- KPI stripe ВЛЕВО, mono numerals, neutral surfaces — Spine-эталон (CONS-7)
- KPI-modal теперь не тупик, а навигатор в реестр (designer Quick win 1)
- Dashboard больше не падает на пустых данных (QA B-1)

Оставил 18 TODO разной severity с конкретным effort'ом — готовый backlog для следующих спринтов.

Не in-scope для этой итерации: декомпозиция metrics.js (851 LOC), унификация LLM-клиента, dependency-engine integration, унифицированный dashboardMetrics — это более крупные рефакторы.
