# Codebase — стратегические улучшения

> Product engineer / strategist. Стратегические улучшения, не дефекты.
> Дата: 2026-05-07

## 1. Топ-15 product improvements

| # | Идея | Проблема | Реализация | Eff | Imp |
|---|------|----------|------------|-----|-----|
| 1 | **Командные viewports (saved views)** с share-link | Каждый тимлид каждое утро вручную накладывает фильтры | Сериализовать `state.filters + sort + colVisibility` в URL hash + локальный реестр `views[]` | S | H |
| 2 | **What-if симулятор плана** на базе `simMode` | `simMode` есть, но без UI diff и rollback | Оверлей «симуляция»: ghost-rows, сравнение метрик до/после, «принять/откатить» | M | H |
| 3 | **CEO-режим (1 экран KPI)** | CEO открывает Гант — слишком детально | Отдельный `activeSection: 'exec'` — 6 тайлов: at-risk releases, capacity heatmap, dependency hotspots | M | H |
| 4 | **Dependency-graph поверх Ганта** | `dependencyEngine.js` — 35 LOC, по сути заглушка | Полноценный orient-граф (sugiyama), подсветка critical path | L | H |
| 5 | **Inline-комментарии и @-mentions на ячейке** | История есть, обсуждения нет — уходят в Telegram | `comments` table в SQLiteStore уже есть → UI-popover + counter в ячейке | M | H |
| 6 | **Risk score auto-explain (LLM)** | `riskEngine.js` ставит флажок без обоснования | `llmAssistant.js` уже есть → генерировать «почему рисковая» по features | M | M |
| 7 | **Capacity-aware drag в Ганте** | Перетаскивание не учитывает загрузку | При drop — расчёт overcommit, soft-warning toast | M | H |
| 8 | **Bulk-edit через формулу** | `bulkEditPanel.js` — только set-value | Mini-DSL: `team = 'X' WHERE release='4Q'`, превью diff | M | M |
| 9 | **Backlog → план drag-handoff** | `portfolioPulseBacklog.js` изолирован от Ганта | Унифицированный DnD контекст между секциями | M | H |
| 10 | **Snapshots / time-travel** | Plan-lock есть, но нет «вернись в состояние 3 недели назад» | Weekly snapshot в SQLite (compressed dump), diff-viewer | M | H |
| 11 | **Personal digest для тимлида** | В Призме нет «что изменилось с моего последнего входа» | Использовать `historyLog` → top-10 changes since last seen | S | M |
| 12 | **Read-only публичная ссылка** | Делиться можно только скриншотом | Snapshot-export + статичный viewer (тот же index.html в read-only mode) | M | M |
| 13 | **Mobile-tablet read-mode** | На iPad открывают перед сходкой, всё ломается | Отдельный CSS-layer + touch-friendly Гант (1500 LOC max) | M | M |
| 14 | **Keyboard-палитра (cmd+K)** | Навигация мышью — медленно для power-users | Поверх существующего nav.js, fuzzy-поиск по командам/issue/people | S | M |
| 15 | **Onboarding-tour для нового тимлида** | `onboarding.js` есть, но обрывочный | 6-шаговый tour с реальными данными пилота | S | M |

## 2. Architecture bottlenecks (5 лет)

- **`dataStore.js` (1313 LOC) + `app.js` (2094 LOC)** — оба god-modules, режут возможность независимой работы команд. Нужен domain-split: `domain/issues`, `domain/people`, `domain/plan`, `domain/integrations`.
- **`styles.css` 19 302 LOC, single file** — медленный hot-edit, конфликты, нельзя tree-shake. Compliance запрещает bundler? — split на `@import` слои + design-tokens-файл. Или Lightning CSS как «постпроцессор без bundler».
- **Reactive Proxy** (см. `state-contracts.md`) — `Reactive.silent` это leaky abstraction; через 2 года новые контрибьюторы будут постоянно ловить infinite-loop. Нужно: либо event-sourcing (commands → reducer → state), либо immutable snapshots с явным `commit()`.
- **`server.js` 6103 LOC** — монолит growing linearly с фичами. Разделить по доменам сейчас, пока ещё дёшево.
- **Integrations (BlackDashboard, PortfolioPulse, TeamScanner2)** — каждая интеграция приносит ~10 файлов в один каталог. Выделить `integrations/<name>/{api,model,renderer,store}.js` структуру.

## 3. Performance ceiling

**50k issues**:
- Полный re-render таблицы через `rowFactory` упрётся в DOM. Нужна виртуализация.
- `FilterEngine.invalidate` на каждый mutate × 50k = подвиснет UI. Indexed filters (Map<team, Set<rowId>>).
- `Storage.save` сериализация всей `state.rows` в localStorage/IndexedDB — счёт идёт на сотни мс. Diff-based save или SQLite.
- CSV/Excel импорт: `csv-stream-exporter.js` есть, импорт же — синхронный. Worker-thread для парса.

**500 employees**:
- Capacity-расчёты в `metricsEngine.js` — O(rows×employees). Memoization по `_dataVersion`.
- People-pickers (auto-complete) — нужна индексация по префиксу.
- Гант group-by-employee нагенерит 500 swimlanes; нужен collapse-by-default + lazy render.

## 4. DX gaps

- **Нет ADR** — `docs/state-contracts.md` хорош, но 3 контракта мало; добавить ADR для: reactive-flush, plan-lock, integration-isolation, telemetry-PII boundary.
- **`globals.d.ts` 73 строки** — на 44k LOC проекта недостаточно; нет типов для `state.rows[]` issue. Минимум JSDoc-схема в `types.js` с `@typedef` для Issue/Employee/Release.
- Неочевидные контракты: `_dataVersion` инкремент (кто отвечает?), `Reactive.silent` re-entry guard, `colVisibility` vs `colOrder` рассинхрон, `Set` в state (сериализация).
- **Отсутствует `docs/architecture-map.md`** с DAG модулей — новичок не понимает, кто кого импортирует.
- **`audit-2026-*` папки в корне** — шум, нужен `archive/`.

## 5. Tooling

- **ESLint custom rules уже есть** (`eslint-rules/`) — расширить: запретить прямые мутации `state.rows` вне `Reactive.silent`, обязать JSDoc на public API модулей.
- **TypeScript через JSDoc + `tsc --noEmit --checkJs`** — типы без bundler, реальная защита.
- **Vitest в Node + jsdom** — unit-тесты на чистых модулях (`metricsEngine`, `filters`, `riskEngine`) без браузера. `e2eTest.js` оставить для in-app smoke.
- **Playwright headless** для E2E — один artifact, без bundler.
- **Без bundler** теряем: tree-shaking, code-split, CSS-modules. Компенсация: native ES-modules + `<link rel=modulepreload>` + ручной split CSS по `@layer`.
- **`launch.js`** — добавить `--profile` режим с CPU/memory snapshot.

## 6. Telemetry gaps

`integrations/telemetry.js` хорош (sendBeacon, opt-out), но **не логируется**:
- Long-task / frame-drop в Ганте (Performance Observer).
- Filter-funnel: какие фильтры открыли → применили → очистили (для UX).
- Bulk-edit cancel-rate (proxy для confidence в feature).
- Time-to-first-interaction после загрузки.
- LLM-assistant: prompt → accepted/rejected.
- JS errors из `errorsLog.js` — есть локально, но не отправляются батчем на сервер.
- Plan-lock bypass usage (см. `ganttEditMode`) — хорошая метрика «обходов процесса».
- Integration sync failures (TeamScanner2/BlackDashboard) с типом ошибки.

## 7. Data layer

**SQLite-WASM как default — да, но в 2 этапа:**
1. **Сейчас (default для новых пилотов)**: SQLiteStore остаётся как primary, localStorage — fallback. Это снимает потолок 5MB и даёт нормальные комментарии/changelog.
2. **Через 6 мес (миграция всех)**: фоновая миграция при первом входе, удалить localStorage-путь из horizons. Преимущества: индексы, JOIN, оконные функции для метрик, сжатый dump 3-5x меньше JSON.

Риски: WASM-load 300+ KB (закешировать), corp-CSP (доверенный self-hosted `libs/sql-wasm.js` — уже есть), backup на сервер обязателен (локальный SQLite = SPOF на 1 машине).
