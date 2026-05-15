# П2 — Функциональный аудит (только отчёт)

> Дата: 2026-05-04. Метод: `npm test` / `npm run typecheck` / grep TODO/FIXME / прочтение `errorsLog.js`, `dataStore.js`, `app.js`, `integrations/*` + DOM-проба всех 25 секций через preview MCP. Только отчёт, изменений не вносилось.

**Эксперты-роли:**
- **Senior frontend engineer** (10y vanilla/React) — runtime / lifecycle / event handling.
- **QA lead** — coverage и регрессии.
- **Tech lead / data integrity** — silent data loss, persistence races.
- **A11y reviewer** — keyboard nav, ARIA, focus management.

## TL;DR

- Тесты **1005 unit / 28 contract / 0 fail** (~5 c). 1 предупреждение `MODULE_TYPELESS_PACKAGE_JSON`.
- `npm run lint` локально не работает: `eslint: command not found` (нет `node_modules`). CI-gate декларирован, но не страхует.
- `npm run typecheck` — silent OK.
- 25 секций отрисовываются без runtime-ошибок; все `Nav.goTo(...)` отрабатывают.
- **Критичный silent-loss** в `dataStore.js:156` — позиционный вызов `ErrorsLog.add(...)` вместо object-API.
- **Memory leak потенциал** в `errorsLog.js` — нет верхней границы `_reportQueue`.
- **Identity-fuzzy reachable** в `portfolioPulseModel.js` — `_ppFindByPartial` достижим через `opts.allowFuzzyAuthorMatch`.

## 1. Базовая диагностика

| Проверка | Результат |
|---|---|
| `npm test` | 1005 / 28 / 0 fail. 1 предупреждение про `package.json` без `"type": "module"` (для `tests/unit/views-headers.test.js` и `integrations/portfolioPulseModel.js`). |
| `npm run lint` | **fail**: `eslint: command not found`. `devDependencies` декларирует `eslint@^9.10.0`, но `node_modules/` отсутствует. `npm run ci` падает на этом шаге. |
| `npm run typecheck` | OK (silent). |
| TODO/FIXME/XXX/HACK | 1 косметический в `utils.js:159` (комментарий про СНИЛС). Мусора-маркеров нет. |
| 28 contract tests | pass — endpoint-интеграции (Jira / BB / CF / GigaChat / LLM proxy) покрыты. |
| Audit V17/V18 | Большинство закрыто. Открыты: V18.3 A1–A5 / B1 (gantt split), V19 C1–C5 / E3 (infrastructure). |
| 25 секций — рендер | все отрабатывают; runtime errors не ловятся. |

`errorsLog.js`: in-memory ring (max 500, LRU) → `localStorage[q2_errors_v1]`. Источники: `window.onerror`, `unhandledrejection`, обёртки `console.error/warn`, `showToast(_, 'error'|'warning')`. Уровни: `error / warn / info`. Дебаунс отчёта пакетами в `/api/client-error` каждые 2с.

## 2. Топ-10 функциональных проблем

| # | Severity | Файл:строка | Описание | Proposed fix (one-liner) |
|---|---|---|---|---|
| 1 | **Critical (silent data loss)** | `dataStore.js:156` | `ErrorsLog.add('warn', '<msg>', {…})` вызвано **позиционно**, а API ждёт object `{level,source,message,…}`. По факту записывается `{level:'error',source:'unknown',message:'undefined'}` — corruption-сигнал теряется при `localStorage`-load. | `ErrorsLog.add({ level:'warn', source:'dataStore.load', message: ..., details: ... })`. |
| 2 | **Functional / leak** | `errorsLog.js:42–64` | `_reportQueue` без верхней границы; `_reportTimer` ставится 1 раз и батчит первые 20 каждые 2с. При шторме ошибок очередь растёт до перезагрузки. | `if (_reportQueue.length > 200) _reportQueue.length = 200;` после push. |
| 3 | **Critical (security defence-in-depth)** | `integrations/portfolioPulseModel.js:651,735,768` | `_ppFindByPartial` (fuzzy FIO match) достижим через `opts.allowFuzzyAuthorMatch`. CLAUDE.md помечает «dev-only за флагом», но никто в `server.js` / `portfolioPulse.js` не проверяет, что флаг **не приходит снаружи**. Случайная утечка → BB/CF атрибуция не тому сотруднику (CONS-A регрессия из V17 I1c). | Обернуть guard'ом `if (process.env.NODE_ENV!=='development') allowFuzzy=false;` или удалить параметр из публичного API. |
| 4 | **Functional (DX)** | `package.json` (lint script) | `npm run ci` падает на `lint`. CI-gate (V18 P4) декларирован живым, локально сломан. | `npm install` или закоммитить lockfile + `npm ci` в `start.sh`. |
| 5 | **Functional** | `package.json` | Нет `"type": "module"`. Node трижды переинтерпретирует `*.test.js` / `portfolioPulseModel.js` как ESM с предупреждением. | Добавить `"type": "module"` или explicit `.cjs/.mjs`. |
| 6 | **Functional (sync race)** | `dataStore.js:110–135` (`flushNow`) | `save()` зеркалит rows в SQLite (`AppDataStore.saveRows`), `flushNow()` — нет. На `beforeunload`/`visibilitychange` SQLite mirror отстаёт. После reload в SQLite-режиме можно увидеть устаревшее состояние. | В `flushNow()` после `localStorage.setItem` — тот же блок `if (window.AppDataStore?.mode === 'sqlite') AppDataStore.saveRows(state.rows)`. |
| 7 | **Cosmetic** | `errorsLog.js:213` | Опечатка `// fire-and-forget repor in background`. Дополнительно — нет дедупа на сервере → в `/api/client-error` ring-buffer 50 заполняется одинаковыми msg. | `repor → report` + дедуп в `server` `clientErrorsRecent.push` по `msg+src+at`. |
| 8 | **Functional (cross-tab race, V17 known)** | `app.js:1879–1903` | Listener `storage` слушает `STORAGE_KEYS+SETTINGS_KEYS`, не интеграционный `q2_integrations_v1` (токены). V17 F-3 «cross-tab desync для токена ротации» открыт. | В `storage` listener: при `e.key === 'q2_integrations_v1'` — `IntegrationsStore.reload()` без `App.refreshAll`. |
| 9 | **A11y / cosmetic** | `audit-2026-05-V17/12-tour-audit.md` `TODO-P12-N18` | Step 12 missing в legacy 24-step онбординг-tour. WCAG 2.1.2 fail (нет keyboard nav). Тесты не покрывают tour. | Восстановить step-12 + Tab/Shift+Tab handler в overlay. |
| 10 | **Functional (deferred V18.3)** | V18.3 A1–A5 / B1 / V19 C2 / C5 | Pilot Day-14 закрыт «borderline pass»; A3 «Ready for QA» dwell, P1.1 multi-team aggregate, P1.3 WIP-counter — заявлены closed в master plan, но в `scanner2-pilot-feedback.md` ещё открыты. Возможен дрейф между планом и реальным кодом. | Сверка `team-scanner-v2.md` ↔ implementation, single source of truth. |

## 3. Сценарии действий — точечные находки

| Сценарий | Что замечено | Severity |
|---|---|---|
| Переключение темы | После предыдущей правки работает корректно (`data-theme=light/dark` всегда), FOUC отсутствует. | OK |
| Открытие модалки настроек | Открывается, табы переключаются. **Проблема прежде** — отключение блоков терялось при перерисовке секции — починено через inject CSS (см. отчёт от 2026-05-03). | OK после fix |
| Импорт CSV | `q2_action_log_v1` пишется в `localStorage` нормально. JSON импорт идёт через `JSONImport.apply` без потерь, проверено в contract-test. | OK |
| Тур по приложению | Step 12 missing (см. #9). | functional |
| Drag-and-drop в настройках | HTML5 drag/drop. На touch — не работает (ожидаемо, только desktop). | minor (по design не критично) |
| Drag-and-drop в Ганте | работает, но при отмене (drag без drop) `ghostRow` иногда остаётся. См. `views/gantt/eventHandlers.js`. | minor |
| LLM stream | Идёт через SSE proxy, contract-test не покрывает abort. Если пользователь закрывает чат во время stream — fetch не abort'ится. | functional |
| `Reactive.silent` | Используется во всех bulk-mutation путях (snapshot restore, syncColumnSettings). Без него — infinite loop. Контракт сохранён. | OK |
| Identity-deterministic attribution | `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}` — соблюдается в Pulse / BB. Однако `_ppFindByPartial` остаётся достижимым (#3). | medium |
| `_scrubSecrets` policy | Все экспорты (CSV/JSON/bundle) проходят. Contract-test проверяет, что в bundle нет `Bearer/token/password`. | OK |
| `Enter` в поле ФИО сотрудника | submit-form не зашит — после ввода нужно жать кнопку. Незаметно но привычно ломает поток ввода. | usability minor |

## 4. Что не проверено

- **ESLint warnings count** — бинарь не установлен; реальный счётчик неизвестен. Лимит 215.
- **Server logger E4** — заявлен в master-плане, не сверено все ли call-sites мигрированы с `console.log`.
- **V20 W1–W7 watchlist** — backlog, не баги.
- **Performance budget** (`scripts/perfBudget.js`) — не запускался.
- **E2E** (`e2eTest.js`) — заявлен 10 тестов, не запускался отдельно.

## 5. Релевантные пути

- [`dataStore.js:156`](../dataStore.js) — bug #1
- [`errorsLog.js:42-64,213`](../errorsLog.js) — bug #2, #7
- [`integrations/portfolioPulseModel.js:651,735,768`](../integrations/portfolioPulseModel.js) — bug #3
- [`package.json:21-23`](../package.json) — bug #4, #5
- [`dataStore.js:110-135`](../dataStore.js) — bug #6
- [`app.js:1879-1903`](../app.js) — bug #8
- [`audit-2026-05-V17/12-tour-audit.md`](../audit-2026-05-V17/12-tour-audit.md) — bug #9
- [`audit-2026-05-V18/scanner2-pilot-feedback.md`](../audit-2026-05-V18/scanner2-pilot-feedback.md) — bug #10

## 6. Категории

| Severity | Кол-во |
|---|---|
| Critical (silent loss / security) | 2 (#1, #3) |
| Functional (фича работает не до конца) | 5 (#2, #4, #6, #8, #10) |
| Cosmetic / DX | 2 (#5, #7) |
| A11y | 1 (#9) |

---

**Резюме:** функциональный фундамент стабилен (тесты зелёные, секции рендерятся, контракты держатся). Реальный риск — два «critical»: silent corruption-warning и достижимый fuzzy-author-matcher. Остальное — DX (lint setup) и долги пилота V18.3.
