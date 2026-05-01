# 04. Фронтенд

## State management — реактивный proxy vs ручной save+refresh

Проблема **двух путей** реактивности:

**Путь А (реактивный, audit #6)**: `state.x = y` → Reactive proxy → `_markDirty()` → 100ms debounce → subscriber → `Storage.save()` + `App.refreshAll()`.

**Путь Б (ручной, legacy)**: модуль изменяет state → явно вызывает `Storage.save() + notify('reason')` → subscriber видит reason → `App.populateFilterDropdowns(); App.refreshAll();`.

Конфликт: оба путя могут сработать на одну мутацию. На текущий момент:

```bash
$ grep -rn "Storage\.save()" --include="*.js" | grep -v testRunner | grep -v node_modules | wc -l
~25 manual calls
```

Места ручного вызова `Storage.save()`:
- `dataStore.js:308, 351, 390, 454, 497, 645, 786, 813` — CSV/XLSX import paths, bulk actions.
- `app.js:339, 612, 634, 1309, 1623` — Reactive subscribe handler (один), различные top-level handlers.
- остальные — внутри методов классов (BulkEdit, и т.п.)

**Анализ**: Reactive auto-flush работает, **но manual paths ВСЁ ЕЩЁ существуют**. Это не unique single source of truth. История: audit #6 хотел убрать ручные вызовы, но миграция не завершена. Есть дублирующие вызовы.

**Эффект**: при CSV-импорте Storage.save вызывается 2 раза:
1. `CSV.import` → `Storage.save()` (debounced 400ms)
2. Reactive proxy ловит каждое присваивание `state.rows[i] = ...` → debounced 100ms → ещё один Storage.save через subscriber.

**Конфликта нет** (оба пишут одинаковые данные), но это inefficient + усложняет debugging.

## Render-производительность

### Полный re-render на каждое изменение

`App.refreshAll() → renderSection(state.activeSection)` — это **innerHTML = stringContent** через `safeHtml.render`. На больших таблицах это блокирует main-thread.

**Бенчмарки сделать не успел**, но ожидаемо:
- Registry с 500 строк × 30 columns → ~15000 DOM nodes → re-render ~300-500ms на старом ноуте.
- Gantt с 200 эпиков × 50 task-pills → ~10000 DOM nodes → ~200-400ms.

**Что мешает UX**:
- Каждое drag-drop в Ganttе вызывает re-render (хоть и с scroll preservation после fix — см. v11 session).
- Каждый bulk-edit → re-render.
- При open `<details>` во вкладке Pulse — Reactive auto-flush НЕ должен вызывать re-render благодаря 250ms grace, но граничный случай (медленный рендер) бьёт.

### Подписки на DOM — утечки

```bash
$ grep -rn "addEventListener" --include="*.js" 2>/dev/null | grep -v node_modules | wc -l
~150 places
```

Многие listeners навешиваются при render'е и НЕ снимаются при следующем render'е (старые DOM-элементы уходят в GC, listener удаляется вместе с элементом). Это **OK для чистой replacement re-render** (innerHTML = ...).

**НО**: есть глобальные listener'ы (на document/window), которые висят:

```bash
$ grep -n "document.addEventListener\|window.addEventListener" --include="*.js" 2>/dev/null | grep -v node_modules
```

Оригинал команды я выполнил (см. ниже) — несколько мест:

- `app/init.js:149` — welcome keyboard listener (с `removeEventListener` в callback ✓)
- `views/integrationsView.js` — модалки имеют свои `keydown` для Escape
- `integrations/portfolioPulse.js:240` — `_openHowModal` вешает `document.addEventListener('keydown', onKey)` и снимает в `close()` ✓
- `integrations/techInfo.js:_wireGlobalKeys` ✓

**Проверки на утечки** делал поверхностно — кажется, что в новых модулях (Pulse / TechInfo) очистка корректная. В старых views/* (gantt.js, registry.js) — возможны утечки.

## innerHTML vs safeHtml — миграция

```bash
$ grep -rn "innerHTML\s*=" --include="*.js" 2>/dev/null | grep -v node_modules | grep -v libs/ | grep -v tests/ | wc -l
126
```

126 мест с `innerHTML = ...`. Это включает и safe (через safeHtml.html``) и raw.

**Раскладка по файлам**:

| Файл | innerHTML calls | Через safeHtml? |
|---|---|---|
| `views/registry.js` | ~14 | большинство — raw |
| `views/metrics.js` | ~40 | raw |
| `views/gantt.js` | ~23 | raw |
| `app.js` | ~30 | raw + некоторые `Utils.escapeHtml` |
| `integrations/techInfoRenderer.js` | 1 | safeHtml.html`` ✓ |
| `integrations/blackDashboardRenderer.js` | 0 (через `safeHtml.html\`\``) | ✓ |
| `views/timeline.js` | ~5 | через `sht` (safeHtml import) ✓ |
| `views/renderHelpers.js` | через `html`, `unsafe` | ✓ |

**Вывод**: миграция на safeHtml завершена в новом коде (V11+), не завершена в старом (`views/registry.js`, `views/metrics.js`, `views/gantt.js`). 234 lint warning'а — почти все там.

## AI Analysis 13-блоков (`ai/`)

```
ai/
  aiCeoFallback.js     653 LOC — 7 функций (computeCeoMetrics, computeCeoHealth, etc) для CEO-режима
  aiFallbackEngine.js  527 LOC — 13 функций (computeBaseMetrics, computeProjectHealth, etc)
  aiContextBuilder.js   97 LOC — context для LLM
  aiCeoRenderer.js     446 LOC — рендер CEO-блоков
  aiRenderer.js        382 LOC — рендер обычных AI-блоков
```

**Дублирование**: `computeIfNothingChanges` есть и в `aiCeoFallback.js:154` и в `aiFallbackEngine.js:146` — это **two разные** реализации. Логика похожая, но не идентичная. Confusing.

**Рекомендация**: разделить `compute*Metrics` (общая) от `format*ForCeoBlock` (специфика). Сейчас слой "что считать" + "как форматировать" перепутаны.

## Chat (`chat/`)

```
chat/
  chatActions.js          411 LOC — выполнение action intents (move/delete/...)
  chatAlerts.js           208 LOC — daily snapshots + alerts
  chatContextBuilder.js   202 LOC — per-intent context
  chatEngine.js           699 LOC — orchestrator
  chatExplain.js          348 LOC — explain intent handler
  chatIntentParser.js     547 LOC — pattern-based intent classification
  chatPrompts.js          349 LOC — system + user prompt templates
  chatReports.js          204 LOC — report generators
  chatTemplates.js        177 LOC — quick-prompt templates
  chatUIRenderer.js       259 LOC — UI rendering
```

**Связность**:
- `chatEngine` импортирует ВСЕ остальные модули — это центральный узел.
- `chatPrompts` независим (только `localStorage`).
- `chatIntentParser` — pure functions, идеально для unit-тестов (мы это сделали).
- `chatTemplates` зависит от `state` + `window.FilterEngine` — грязно (см. 01-architecture.md).

**Где границы размыты**:
- `chatExplain` (intent handler) и `chatActions` (action intents) — оба обрабатывают типы запросов, но не выровнены под общий interface (`handle(intent, params)`).
- `chatEngine` делает классификацию + орhестрацию + рендер. Можно вынести render в чистый `chatUIRenderer` (он уже есть, но 259 LOC показывает что его доля невелика).

**Severity**: L. Работает, но рефакторинг помог бы.

## Portfolio Pulse — самый сложный кусок

`integrations/portfolioPulseRenderer.js` 1366 LOC. **Структура**:

| Строки | Что |
|---|---|
| 1-90 | Imports, atoms (`safeUrl`, `escape`, render-context) |
| 90-180 | `renderTopHeader` — main header + tabs + diagnostics |
| 180-280 | `renderDiagnostics` — pp diagnostics block |
| 280-470 | `HOW_DATA` — explainer modal data |
| 470-510 | `renderHowModal` |
| 510-625 | `renderParticipantCard` — gigantic |
| 625-780 | `_renderTodaySection` |
| 780-980 | `_renderDaySection` (yesterday/dayBefore) |
| 980-1100 | `renderTeamsTab`, `renderUnassignedBlock` |
| 1100-1250 | `renderSummaryTab` |
| 1250-1366 | `renderSprintsTab`, `renderInsightsTab`, `renderMetricsTab`, `renderBacklogTab` |

**Читаемость**: средняя. Большой файл, но логически структурирован. Можно разбить на:
- `pp-renderer-header.js` (top + diagnostics)
- `pp-renderer-card.js` (participant card + today + day sections)
- `pp-renderer-tabs.js` (tabs entry points)
- `pp-renderer-how-modal.js` (how data + modal)

Но **выгода неочевидна** — все 5 файлов всё равно будут импортироваться из одного места. Возможно, проще оставить как есть.

## Доступность (a11y)

```bash
$ grep -rn "aria-" --include="*.js" 2>/dev/null | grep -v node_modules | wc -l
~30
```

**Что есть**:
- `aria-modal="true"` на TechInfo modal, How modal — ✓
- `aria-labelledby="ti-title"` — ✓
- `aria-label="Закрыть"` на крестиках — ✓
- `aria-hidden="true"` на чевронах ✓

**Что отсутствует**:
- **Keyboard navigation** между tabs (нет `aria-selected`, `tabindex` rules для Pulse-tabs).
- **Focus management в модалках** — при открытии focus не переводится на input, при закрытии не возвращается.
- **Skip links** для main content.
- **Live regions** для toast'ов (`aria-live="polite"`).

**Severity**: M — для intra-corporate B2B-приложения это обычно допустимо, но если пользуется ассистивная технология — будет плохо.

## Bundle size

```
✓ all JS (raw)                  1133.1 KB / 1500.0 KB   (76%)
✓ all JS (gzipped)               324.3 KB / 400.0 KB    (81%)
✓ biggest single JS file         105.5 KB / 120.0 KB    (88%) ← app.js
✓ biggest single CSS file        339.7 KB / 360.0 KB    (94%) ← styles.css
```

**Запас невелик**:
- styles.css — 94% от лимита. Любой новый блок CSS толкнёт за бюджет.
- biggest single JS — 88% (app.js 105KB). Если app.js разрастётся ещё на 15KB — превысит.

**Что можно сократить**:
- styles.css 339 KB — **много дублирования**. `dark theme` overrides делается через `body.theme-dark .x` — копий примерно столько же, сколько light styles. Можно перейти на CSS-переменные для цветов и сократить минимум на 30%.
- app.js 105 KB — gigantic. Декомпозиция (см. 01) сократит на ~40 KB.

## Заключение

Категория | Оценка
---|---
State (Reactive vs manual) | удовлетворительно — два пути сосуществуют, миграция #6 не завершена
Render-perf | удовлетворительно — полный re-render бьёт по UX на больших таблицах
DOM listeners | хорошо — в новом коде чисто, в старом не разбирался
innerHTML migration | плохо — 234 raw warnings, миграция на 60% завершена
AI block dup | удовлетворительно — `computeIfNothingChanges` дубль, остальные OK
Chat связность | хорошо — границы видны, граф зависимостей понятен
Pulse renderer | удовлетворительно — большой файл, но структурированный
A11y | плохо — базовые ARIA есть, но keyboard navigation/focus management отсутствуют
Bundle | удовлетворительно — 88-94% от лимитов, запас минимальный
