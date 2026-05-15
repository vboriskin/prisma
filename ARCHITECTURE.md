# ARCHITECTURE.md (last full audit: V22 — partial AUDIT_ARCHITECTURE 2026-05-08)

> **AUDIT_ARCHITECTURE #1 / #3 (2026-05-08):** документ актуализирован. Полный
> draft replacement лежит в `AUDIT_ARCHITECTURE.md` § Часть Г (готов к копи-пасту).
> Здесь — только критичные расхождения с реальным кодом исправлены:
>
> - **Reactive debounce = 200 ms** (было «100 ms» — устарело после P6 fix)
> - **server.js = 6486 LOC** (CLAUDE.md говорил «~2.5k» — устарело)
> - **`BulkEditPanel` вынесен** в `app/bulkEditPanel.js` (V18.1 P9)
> - **`ALL_LOCALSTORAGE_KEYS` в `constants.js`** — единый реестр localStorage ключей (AUDIT_ARCHITECTURE #21/#22)
> - **`app/migrations.js`** (V21 W versioned migration runner) подключён
> - **`server/logger.js`** NDJSON structured logger (V19 E4)
> - **`pulse/index.js` facade** (V19 D3) — для всех импортов из integrations/
> - **4-й контракт: Auto-rerender grace 250 ms** (`_AUTO_RERENDER_GRACE_MS`)
> - **Async-job pattern** теперь используется И для Pulse, И для BlackDashboard (V18 P7) — не «только blackDashboard» как написано ниже
> - **Operational endpoints** `/health`, `/ready`, `/metrics`, `/metrics/prom` (`server.js:6240+`)
> - **Cross-tab sync** через `storage` event listener (`app.js:2127`)
>
> **Stale-секции помечены ниже** `> **STALE — нуждается в обновлении (V21+)**`.
>
> Текущая активная итерация: **V22** (mascot-pass + scanner consolidation).
> Последний holistic-пасс: [`AUDIT_HOLISTIC.md`](./AUDIT_HOLISTIC.md) (2026-05-07).
>
> История V11→V17.2: [`docs/version-history.md`](./docs/version-history.md).
> LLM-агенту читать сначала [`CLAUDE.md`](./CLAUDE.md), потом этот файл.
> Каноническая навигация по docs/: [`docs/README.md`](./docs/README.md).
> Индекс audit-папок: [`docs/audits-index.md`](./docs/audits-index.md).

## Overview

Внутренний инструмент квартального планирования для мобильной платформы Сбербанка. Управление эпиками / релизами / зависимостями + интеграции (Jira Delta + Sigma, Bitbucket, Confluence, GigaChat-LLM).

Архитектура: **vanilla-JS browser + один Node.js сервер**, без бандлера и без рантайм-зависимостей. Сервер работает как:
1. Static-server для модулей и `index.html`
2. Proxy для интеграций (`/api/integrations/*`) — там и хранятся токены
3. Конфиг-стор (`jira_config.json` рядом с `server.js`)

## Почему vanilla — рацио

Это **сознательный выбор**, не легаси:

1. **Corporate compliance** — каждый npm-пакет проходит security review. 1500-package React/Next-стек = process bottleneck.
2. **Supply-chain immunity** — `event-stream` / `node-ipc` сценарии тут невозможны. Vendored только `xlsx` и `sql-wasm`.
3. **Offline-friendly** — работает с `file://` или локальным proxy без сети (только LLM/integrations требуют network).
4. **AI-augmented dev workflow** — vanilla код генерируется LLM-ами надёжнее чем JSX/TSX. Команда фактически растит проект через Claude/Cursor.
5. **One-step deploy** — `node server.js` это вся production-настройка. CI ничего не собирает.

## Tech Stack

| Layer | Tech |
|---|---|
| Browser JS | Native ES Modules; никакого бандлера |
| Rendering | Imperative DOM через `innerHTML` (обязательный escape `Utils.escapeHtml`) |
| State | Single mutable `state` Object, обёрнутый в Proxy → debounced flush |
| Persistence | `localStorage` (default) или SQLite-WASM (opt-in, V11) |
| Server | Node.js built-ins (`http`, `https`, `fs`, `url`); никакого Express |
| Auth proxies | OAuth для GigaChat (server-side caching), Bearer/Basic для Jira/BB/CF |
| XLSX | `libs/xlsx.full.min.js` (vendored, ~930 KB) |
| SQLite | `libs/sql-wasm.js` + `sql-wasm.wasm` (vendored, ~50 + 660 KB) |
| Type checking | JSDoc + `tsc --checkJs` (opt-in per file через `// @ts-check`) |
| Tests | `node:test` (unit + contract) + самописный testRunner для legacy assertions (V18 P12 — план retire'а testRunner). Базы: ~534 unit / 11 contract / 10 e2e. |

## High-level data flow

```
                ┌──────────────┐
                │   browser    │
                │              │
    ┌───────────┤  app.js      │
    │           │  (orchestrator)
    │           └───┬──────────┘
    │               │ subscribes via Reactive
    │               ▼
    │         ┌─────────────────┐
    │         │  state.js       │ ← Proxy: any mutation
    │         │  (mutable)      │   triggers debounced flush
    │         └────┬─────────┬──┘
    │              │         │
    │  reads ▼     │         │ Reactive.silent(...) for
    │              │         │ snapshot/bootstrap mutations
    │       ┌──────┴────┐   ┌▼─────────────┐
    │       │ FilterEng │   │ dataStore.js │ ← localStorage / SQLite
    │       └─────┬─────┘   └──────────────┘
    │             │
    │     reads filtered rows
    │             ▼
    │      ┌──────────────────┐
    │      │  views/*         │ ← per-section render
    │      │  (registry,      │
    │      │   gantt, ...)    │
    │      └──────────────────┘
    │
    │  POST /api/* (proxy)
    └────────────────────────► server.js
                                │
                                ├── jira_config.json (tokens, URLs)
                                ├── /api/integrations/* (Jira/BB/CF/GigaChat)
                                ├── /api/jira/config (settings persistence)
                                └── /api/llm/chat (LLM streaming)
```

## State as a single source of truth

Всё живое состояние в одном объекте `state` (`state.js`). Ключевые поля:

```js
state = {
  rows: [],              // массив строк Реестра (= задач/эпиков, см. domain-glossary)
  employees: [],         // V17.2: identity-таблица для интеграций
  filters: {...},        // см. filters.js
  activeSection: '...',  // current view
  diagnostics: {...},
  sort: {...},
  ganttMode: '...',
  colOrder, colWidths, colVisibility, colTypes, colLabels, customCols, pinnedCols, ...
  theme, sidebarCollapsed, simMode,
  planLocked, ganttEditMode,        // V14
  llm: {...},                       // chat state
  actionLog: [],                    // history (см. historyLog.js)
  // ...
}
```

Полный shape — в `state.js` `_rawState`. Не дублирую тут.

## Reactive flow (must-know)

`state` обёрнут в Proxy в `reactiveStore.js`. Любая мутация:

1. `state.rows[i].team = 'X'` → Proxy fires `set` trap → marks dirty
2. 100ms debounce → fires subscribers
3. Subscribers: `Storage.save()` + `App.refreshAll()` + `FilterEngine.invalidate()`
4. View re-renders

**`Reactive.silent(() => { ... })`** временно отключает proxy-trap для mass-mutations (snapshot restore, bootstrap, syncColumnSettings). **БЕЗ silent эти пути дают infinite loop** (state-mutation → flush → re-render → state-mutation → ...).

→ Полный контракт + примеры: [`docs/state-contracts.md`](./docs/state-contracts.md)

## Key contracts

Три неочевидных контракта, нарушение которых ломает приложение:

1. **Reactive.silent** для bulk-mutations — см. выше
2. **Identity-deterministic attribution** (V17.2) — `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}` — авторитет для интеграций. Никаких fuzzy-FIO-matches.
3. **`_scrubSecrets` policy** — все экспорты через `CSV._scrubSecrets()`.

→ [`docs/state-contracts.md`](./docs/state-contracts.md) — полное описание + code examples

## Module boundaries

| Модуль | Ответственность | Не должен |
|---|---|---|
| `state.js` | Хранить state, экспортировать Proxy-обёртку | Содержать business logic |
| `dataStore.js` | Persistence (load/save/import/export) | Знать про DOM или views |
| `app.js` | Bootstrap, navigation, bind handlers, hold App-singleton | Стать «god-object»; декомпозиция в `app/*` приветствуется |
| `views/*` | Рендер per-section, обработка кликов внутри section | Вызывать `Storage.save()` напрямую (только через mutation) |
| `integrations/*` | Frontend-логика интеграций + analyse | Делать direct fetch — только через `proxyPost` / fetchPulseData |
| `server.js` | Static + proxy + config persistence | Хранить state в памяти (только cache с TTL) |
| `chat/*` | LLM-чат features | Путать с `ai/*` (там analytics) |
| `ai/*` | AI-Анализ + AI-CEO views (analytics blocks) | Путать с `chat/*` |

## Adding a new view

1. Создай `views/myview.js` экспортирующий `render(rows)` или `render()`
2. Добавь `<section id="section-myview" class="app-section hidden">` в `index.html`
3. В `app.js` `Nav.go(section)` switch — добавь case `'myview' → MyView.render()`
4. (если нужна вкладка в sidebar) — добавь `<button class="nav-item" data-section="myview">` в `index.html`

Pattern «mobile-first»: render заполняет existing DOM-узел через innerHTML (не создаёт поверх). Cleanup listeners идемпотентен — view может re-render'иться много раз.

## Adding a new integration endpoint

1. Frontend: создай fetch-helper в `integrations/<name>Api.js`. Используй `proxyPost('/api/integrations/<name>', body)` (`integrationsSync.js`).
2. Server: добавь route в `server.js` где остальные `/api/integrations/*`.
3. Token-handling: пройди через `_ppMakeAuthHeader(cfg.<name>Token)`. На error-path — token-redact (regex по `Bearer|Authorization|token|secret|password|apiKey`).
4. Если данные приходят в Pulse-pipeline → расширь `analysePulse(opts)` сигнатуру и hydrate authors.
5. Тесты: contract-test в `contractTest.js` с fake-endpoint (см. `startFakeJira`).

→ [`docs/integrations/README.md`](./docs/integrations/README.md) для полной картины

## Async-job pattern (Black Dashboard)

Большие запросы (multi-project Sigma aggregation) идут через async-job:

1. Client: `POST /api/integrations/black-dashboard/start` → `{jobId}`
2. Client: poll `GET /api/integrations/black-dashboard/status?jobId=...` каждые 2с
3. Server держит cache `{jobId: {status:'running'|'done'|'error', result, progress}}`
4. Client рендерит progress, при `done` забирает result

Используется только `blackDashboard.js` — не путать с обычными `/api/integrations/*` endpoints (sync, blocking).

## Persistence model

Два варианта (выбор юзером в Настройках → Хранилище):

1. **localStorage** (default) — keys `q2_plan_v3`, `q2_settings_v3`, `q2_llm_settings_v1`, `q2_integrations_v1`, `q2_onboarding_v1`, `sbof_app_settings_v1`, `q2_action_log_v1`, `q2_llm_conv_v1`. Migrations v1/v2/v3 (см. `dataStore.js`).
2. **SQLite-WASM** (opt-in, V11) — `sqliteStore.js`, файл сохраняется через File System Access API.

Экспорт/импорт:
- **CSV** — строки + `__Q2SETTINGS__` / `__Q2BUNDLE__` / `__Q2EMPLOYEES__` маркеры
- **JSON** — атомарный round-trip (`JSONExport.buildSnapshot` / `JSONImport.apply`)
- **XLSX** — через vendored `xlsx.full.min.js`

Все экспорты ОБЯЗАНЫ проходить через `CSV._scrubSecrets()`.

## Security defaults

| Поверхность | Защита |
|---|---|
| HTML insert | `Utils.escapeHtml` обязателен; ESLint правило `no-unescaped-html` |
| CSV/JSON exports | `CSV._scrubSecrets` рекурсивно вычищает token/secret/password/auth/key поля |
| CSV cell injection | escapeCSV префиксует ZWSP `​` для значений начинающихся с `= + - @ \t \r` |
| Path traversal | `fs.realpath` closure в static-server |
| CSP, X-Frame-Options | static-server отдаёт security headers |
| Rate-limit | `RATE_LIMIT_PER_MIN` (default 60) на `/api/*` |
| Token-redact | error-paths замазывают `Bearer`, `Authorization`, etc. |

→ [`docs/integrations/auth-and-secrets.md`](./docs/integrations/auth-and-secrets.md) для интеграций

## Decomposition status (V17)

> **STALE — нуждается в обновлении (V21+).** V18 продолжил decomposition
> (`audit-2026-05-V18/09-app-decomposition.md`, `10-server-decomposition.md`).
> Текущие LOC: `app.js` 2.2k, `server.js` 6.6k, `styles.css` 20k, `index.html`
> 1.7k. Полный список под-модулей `app/*` шире, чем таблица ниже. Точный
> срез — `wc -l app.js server.js styles.css` + `ls app/`.

`app.js` исторически monolith. Постепенное вынесение:

| Подмодуль | Где живёт |
|---|---|
| `Onboarding` | `app/onboarding.js` (legacy 24-step tour) + `onboarding/onboardingUI.js` (CEO micro-tour) |
| `LLMAssistant` | `app/llmAssistant.js` |
| `HistoryManager` | `app/historyManager.js` |
| `BulkEditPanel` | (всё ещё в `app.js`) |
| `ActionLayer` | `app/actionLayer.js` |
| `PromptsEditor` | `app/promptsEditor.js` |
| `Nav` | `app/nav.js` |
| `init` | `app/init.js` (welcome splash) |
| `StorageSettings` | `app/storageSettings.js` |

См. также `audit-2026-04-30/04-architecture-decomposition.md` (ADR).

## Что retired

> **STALE — нуждается в обновлении (V21+).** Не отражены retired-эпохи
> V18+ (legacy testRunner частично, V20 fuzzy-name-fallback в Сканнере,
> 20 funny-loader phrases — кандидаты на удаление по AUDIT_HOLISTIC §6).

| V-версия | Что retired |
|---|---|
| V14 (B2) | `GanttV2` — старый «Гант со стрелками» режим. Следы в constants остались. |
| V14 (B3) | `gantt2*` settings keys |
| V15 | Editorial-Bold редизайн (отвергнут пользователем) |
| V17 P9 | filled-pill chips в реестре → Spine-pill stripe-only |
| V17.2 I1c | `_ppFindByPartial` fuzzy-name-match — production-disabled, оставлен dev-fallback за флагом |

→ [`docs/version-history.md`](./docs/version-history.md) для полного списка
→ [`docs/dont-touch.md`](./docs/dont-touch.md) для «осознанной кривизны» что НЕ retired а живёт сознательно

## Dev tooling

| Инструмент | Команда | Зачем |
|---|---|---|
| TypeScript checking | `npm run typecheck` | JSDoc + `tsc --checkJs`, opt-in per file через `// @ts-check` |
| ESLint | `npm run lint` | `--max-warnings 215` (есть legacy warnings) |
| Tests | `npm test` | testRunner + node:test unit + contractTest |
| Performance budget | `npm run perf:budget` | `scripts/perfBudget.js` (часть `npm run ci`) |
| E2E | `npm run test:e2e` | `e2eTest.js` |

→ [`docs/testing.md`](./docs/testing.md) для подробного описания тест-уровней
→ [`docs/running.md`](./docs/running.md) для запуска

## Integration-specific docs

- [`docs/integrations/README.md`](./docs/integrations/README.md) — обзор + Pulse pipeline
- [`docs/integrations/api-endpoints.md`](./docs/integrations/api-endpoints.md) — таблица всех `/api/integrations/*`
- [`docs/integrations/auth-and-secrets.md`](./docs/integrations/auth-and-secrets.md) — token flow + scrub policy
