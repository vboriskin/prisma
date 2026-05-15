# State Shape — `state.js` / Row / Employee

> Сгенерируется автоматически из `state.js` + `rowFactory.js` JSDoc через
> `scripts/docgen.js` (P8 phase-2). Сейчас — ручной snapshot из исходников
> на момент **2026-05-08** (V21).
>
> Контракты, нарушение которых ломает приложение: см. [`state-contracts.md`](./state-contracts.md).
> Доменные значения полей (что значит scope, release120Types и т.п.): см. [`glossary.md`](./glossary.md).

## Top-level `state` (из `state.js` `_rawState`)

| Ключ | Тип | Назначение | Invariants |
|---|---|---|---|
| `rows` | `Row[]` | Реестр эпиков (строк планирования). | Все мутации `state.rows[i].x = y` идут через Reactive Proxy → debounced flush. Mass-mutation → `Reactive.silent`. См. Contract 1. |
| `employees` | `Employee[]` | Identity-таблица для интеграций (V17.2). | Никаких fuzzy-name-match'ей — атрибуция только через `email`/`jiraAccountId`/`bitbucketLogin`/`confluenceAccountId`. См. Contract 2. |
| `filters` | `{ search, team, scope, release, workType, role, assignee, tag, onlyBlocking, onlyRisky, onlyDone, preset }` | Активные фильтры Реестра. | `FilterEngine.invalidate()` после любой мутации. |
| `activeSection` | `string` | Текущий раздел (`'dashboard'` / `'registry'` / `'gantt'` / ...). | Меняется только через `Nav.go(section)`. |
| `diagnostics` | `{ sources, sheets, rowsPerSheet, detectedColumns, missingColumns, warnings, registryCount, csvImportCount, localStorageCount }` | Импорт-диагностика последнего CSV/XLSX. | Read-only из views. |
| `sort` | `{ col: string \| null, dir: 'asc' \| 'desc' }` | Сортировка Реестра. | — |
| `ganttMode` | `'detailedTasks'` (only) | Legacy: V14 B2 retired GanttV2. | Сохранён для backwards-compat. |
| `ganttEpicsWell` | `'none' \| ...` | Состояние «колодца» эпиков в Ганте. | — |
| `epicDeps` | `Record<epicKey, epicKey>` | Зависимости эпиков (стрелки). | `from !== to` всегда. Чистится в `syncColumnSettings`. |
| `planLocked` | `null \| { at: ISO, by: 'user' }` | V14 B4: фиксация плана. | Если `!== null` — переносы pill требуют комментария. |
| `ganttEditMode` | `boolean` | V14 B3: bypass plan-lock. | Sticky между навигациями. |
| `lastClickedRowId` | `number \| null` | Anchor для shift-select в Реестре. | — |
| `timelineMode` | `string` | Режим топ-таймлайна Ганта. | — |
| `podlozhkaGroup` / `podlozhkaMode` | `string` | Группировка строк в Ганте под team-header. | — |
| `summaryMode` | `'brief' \| ...` | **DEPRECATED**: «Сводная» удалена в П4-MS Wave 1. Поле оставлено для backwards-compat сериализации. | Удалить после миграции. |
| `presetsCollapsed` | `boolean` | UI-флаг collapsed-state блока пресетов. | — |
| `theme` | `'light' \| 'dark' \| 'auto'` | Активная тема. | Влияет на `[data-theme]` на `<html>`. |
| `colVisibility` | `Record<colKey, boolean>` | Видимость колонок Реестра. | Дополняется в `syncColumnSettings()` для отсутствующих ключей. |
| `colOrder` | `string[]` | Порядок колонок Реестра. | Дедуп + только existing keys. |
| `colWidths` | `Record<colKey, number>` | Ширины колонок (clamp 70-420). | — |
| `colLabels` | `Record<colKey, string>` | Юзер-override для подписей колонок. | trim, only non-empty. |
| `pinnedCols` | `string[]` (max 6) | Закреплённые колонки. | Должны быть `visible === true`. |
| `rowHeight` | `number` (28-44) | Высота строки в Реестре. | Hard clamp в `syncColumnSettings`. |
| `customCols` | `CustomColumn[]` | Пользовательские колонки (v8). | Sanitize: dedupe key, clamp width. |
| `colTypes` | `Record<colKey, COL_TYPES[number]>` | Override типа колонки. | Только из `COL_TYPES` whitelist. |
| `sidebarCollapsed` | `boolean` | UI-флаг sidebar. | Поддерживает legacy string `'true'/'false'`. |
| `_idCounter` | `number` | Источник `nextId()`. | Монотонно растёт. |
| `_dataVersion` | `number` | Бамп при миграциях snapshot. | — |
| `llm` | `object` | LLM-чат состояние (см. `chat/`). | Не путать с `chat.*` (это runtime, llm — persisted settings). |
| `simMode` | `boolean` | Симуляционный режим (V20). | — |
| `bulkSelected` | `Set<rowId>` | Bulk-выделение в Реестре. | Не сериализуется в localStorage. |
| `actionLog` | `LogEntry[]` | Аудит-журнал (см. `historyLog.js`). | Retention 30 дней, persists в `q2_action_log_v1`. |
| `meta` | `MetaContext` | Единый context-объект: user / permissions / featureFlags / version. См. ниже. | Persists в `q2_settings_v3` (миграция 2→3). Mass-mutation в `Reactive.silent`. |

### `state.meta` — context object (AUDIT_HOLISTIC P3 + Идея 1)

Единый «контракт идентичности и прав» для всех view'ов и интеграций. Доступ:
- `state.meta.user.email` — primary identity (CLAUDE.md контракт #2; никаких name-fuzzy).
- `Permissions.can('canBulkEdit')` / `Permissions.guard(action, fn)` — права (см. `app/permissions.js`).
- `Flags.isEnabled('ai')` / `Flags.subscribe(name, h)` — feature flags (см. `app/featureFlags.js`).
- `state.meta.lastSeenVersion` vs `state.meta.version` — «Что нового» (MASCOT I5).

| Под-ключ | Тип | Назначение | Default |
|---|---|---|---|
| `user.email` | `string` (lowercased) | Primary identity текущего пользователя. | `''` |
| `user.name` | `string` | Display-имя (не для identity-match!). | `''` |
| `user.avatar` | `string` (URL) | Avatar для topbar / mentions. | `''` |
| `permissions.canBulkEdit` | `boolean` | Массовые операции (BulkPlatform.apply). | `true` |
| `permissions.canChangeScope` | `boolean` | Менять scopeStatus. | `true` |
| `permissions.canMarkDone` | `boolean` | Выставлять isDone. | `true` |
| `permissions.canExport` | `boolean` | CSV/JSON/bundle экспорт. | `true` |
| `permissions.canEditEmployees` | `boolean` | Править Employee identity-fields. | `false` |
| `featureFlags.ai` | `boolean` | AI-Анализ + AI-CEO views. | `true` |
| `featureFlags.mascotMood` | `boolean` | Маскот mood (F11). | `true` |
| `featureFlags.notifications` | `boolean` | Notification Center (F4). | `true` |
| `featureFlags.explainScreen` | `boolean` | Explain-screen overlay. | `true` |
| `version` | `string` (semver) | Текущая версия app'а — «что показывать как новое». | `'17.0.0'` |
| `lastSeenVersion` | `string` (semver) | Какую версию юзер уже «видел» — для «What's new» оверлея. | `''` |
| `lastActiveAt` | `string \| number \| null` | Timestamp последней активности — для inactivity hints. | `null` |
| `focus` | `null \| { kind, id, period }` | «Утро тимлида»: какой эпик/команду/период юзер последний смотрел. | `null` |

**Persistence**: `state.meta` сериализуется как top-level field `meta` в `q2_settings_v3` payload (см. `dataStore._buildSettingsPayload`). Миграция `q2_settings_v3 2→3` (см. `app/migrations.js`) добавляет `meta` с дефолтами в legacy payload'ы — non-breaking.

**Reactive**: мутации `state.meta.user.email = 'x@y.z'` идут через Proxy → debounced flush → SETTINGS_KEY (как любое top-level поле). Mass-mutation (например, hydrate из payload в `loadSettings`) ОБЯЗАН быть в `Reactive.silent`.

#### `state.meta.focus` — единый «контекст-якорь» (AUDIT_HOLISTIC §5.1)

Сценарий «Утро тимлида» (Дашборд → Сканнер → Сотрудник → AI Анализ → Действия): чтобы тимлид НЕ выставлял 4 раза подряд «Иванов в команде Альфа за неделю», все 5 секций читают единый `state.meta.focus`.

| Поле | Тип | Назначение |
|---|---|---|
| `kind` | `'employee' \| 'epic' \| 'team' \| 'release' \| 'block-id'` | Тип якоря — определяет, как view интерпретирует `id`. |
| `id` | `string` | Identity-deterministic key: `email` / `jiraAccountId` / team-name / release-window / Jira-key. **Никогда не ФИО** (CLAUDE.md контракт #2). |
| `period` | `'7d' \| '14d' \| '30d' \| 'q' \| 'all'` | Временное окно. Default `'7d'`. |
| `source` | `string` (опционально) | Откуда пришёл якорь — `'dashboard.action-block'`, `'scanner.row-click'`, ... — для телеметрии / debug. |

**API**: `Focus.set({kind, id, period, source})` / `Focus.clear()` / `Focus.get()` / `Focus.back()` / `Focus.forward()` (см. `app/focusManager.js`).

**Hotkeys**: `Cmd+[` / `Cmd+]` (Ctrl на Win/Linux) — browser-style history navigation по ring buffer (cap 20). Skip'ятся если фокус внутри `<input>` / `<textarea>` / `contenteditable`.

**EventBus**: каждое изменение эмитит `'focus-changed'` с payload focus (либо `null` после clear). `app.js` подписан на это событие и пробрасывает в `TeamScanner2.applyFocus` + `EmployeesView.render`.

**Маскот**: пока `focus !== null` маскот в углу подсвечен `obs--cur` («я смотрю с тобой») через `MascotMood.setCursor()`. На clear — авто-режим (breathe).

**Toast**: при `set()` показываем transient toast «Контекст: <label> · <period>» (через `ToastQueue.show({persist:false})`). Никакой записи в NotifyCenter — это не событие.

**Персистенс**: `focus` живёт в `state.meta`, и Reactive proxy сериализует его вместе с остальным `meta` в `q2_settings_v3`. При F5 последний выставленный `focus` восстанавливается. **History (Cmd+[ / Cmd+])** — runtime-only, при F5 теряется.

---

## `Row` — строка Реестра (`rowFactory.js` `RowFactory.create`)

| Поле | Тип | Назначение |
|---|---|---|
| `id` | `number` | Глобальный id (через `nextId()`). |
| `sourceType` / `sourceSheet` | `string` | Откуда строка пришла (CSV/XLSX/manual). |
| `team` | `string` | Команда (одна на эпик). |
| `category` | `string` | Категория (тег). |
| `epic` | `string` | Имя эпика — главный label строки. |
| `backend` / `frontend` / `analytics_estimate` / `testing_estimate` / `total_estimate` | `string \| number` | Story-points по типам работ. |
| `tasks` | `string` | Comma-list jira-задач у эпика. |
| `taskComment` | `string` | Комментарий к задачам. |
| `teamDependency` | `string` | Внешняя зависимость (текст). |
| `risks` | `string` | Описание рисков (текст, не флаг). |
| `release120Raw` / `release121Raw` / `release122Raw` / `overtimeRaw` | `string` | Plain-text копия из импорта (legacy). |
| `release120Types` / `release121Types` / `release122Types` / `overtimeTypes` | `string[]` (subset of `WORK_TYPES`) | Реальные типы работ для каждого окна. |
| `hasRelease120` / `hasRelease121` / `hasRelease122` / `hasOvertime` | `boolean` | Derived из соотв. *Types[]. Computed в `RowFactory.updateDerived`. |
| `isUnassigned` | `boolean` | Все has*=false → попадает в Бэклог. Derived. |
| `scopeStatus` | `'Да' \| 'Нет' \| 'Требует подтверждения' \| ''` | Scope (см. `SCOPE_OPTIONS`). |
| `role` | `string` | Pipe-list ролей (BE/QA/...). |
| `blockingDependency` | `boolean` | Флаг «блокер». |
| `blockingDeadline` | `string` (ISO) | Deadline блокера. |
| `commitToCounterparty` | `boolean` | Обязательство перед смежниками. |
| `commitDate` | `string` (ISO) | Дата обязательства. |
| `isDone` | `boolean` | Сделано. **Обнуляет `riskScore` в RiskEngine** даже с флагами. |
| `doneDate` | `string` (ISO) | Дата выставления `isDone`. |
| `actualDoneDate` | `string` (ISO) | V14 B7: фактическая дата завершения. |
| `doneComment` | `string` | V14 B7: комментарий к завершению. |
| `backlogTypes` | `string[]` | Типы работ в Бэклоге. |
| `donePills` | `Record<'<colKey>__<wt>', boolean>` | Per-pill done-flag. |
| `unplannedPills` | `Record<'<colKey>__<wt>', boolean>` | V15: per-pill «не запланирован» (dashed). |
| `inProgressPills` | `Record<'<colKey>__<wt>', boolean>` | V15: per-pill «в работе». |
| `assigneePills` | `Record<'<colKey>__<wt>', string>` | V15: per-pill assignee FIO (pipe-separated). Read-priority: per-pill → fallback `row.assignee`. |
| `ganttArrows` | `array` | Стрелки от/к этой строке в Ганте. |
| `comment` | `string` | Свободный комментарий. |
| `riskFlags` | `string[]` | Из `RISK_FLAGS` enum. Computed в RiskEngine. |
| `riskScore` | `number` (0-100) | Computed в RiskEngine. |
| `tags` | `string` | V15 audit#1: pipe-list тегов. **Обязателен default `''`** (иначе `String(undefined)` ломает role-filter). |
| `workPeriodStart` / `workPeriodEnd` | `string` (ISO) | Период работ. Auto-swap если start > end в `updateDerived`. |
| `workStartDate` / `workEndDate` | `string` (ISO) | V14 B6: per-row override workPeriod (для off-window). |
| `assignee` | `string` | Row-level assignee (fallback для assigneePills). |
| `rowColor` | `string` | Custom color override. |
| `transferComments` | `Array<{at, from, to, wt?, text}>` | V14 B5: trail комментариев при переносе pill в plan-lock. |
| `assignedAt` | `string` (ISO) | Когда был выставлен `assignee`. |
| `dirty` | `boolean` | Persisted-but-not-yet-synced flag. |
| `createdAt` / `updatedAt` | `string` (ISO) | Auto-set. `updatedAt` — bump при любой мутации. |

### Integration-only поля (заполняются Pulse / Sigma sync)

| Поле | Тип | Источник |
|---|---|---|
| `jiraKey` | `string` | Delta Jira fetch. |
| `jiraStatus` / `jiraAssignee` / `jiraUpdatedAt` | `string` | Delta Jira. |
| `prUrl` / `prStatus` / `prUpdatedAt` | `string` | Bitbucket. |
| `docUrl` / `docTitle` | `string` | Confluence. |
| `priority` | `'P0' \| 'P1' \| 'P2'` | Jira (V21). |
| `businessValue` | `number` | Manual / Jira custom field. |

---

## `Employee` — `rowFactory.js` `EmployeeFactory.create`

| Поле | Тип | Назначение |
|---|---|---|
| `id` | `string` (`'emp_' + ts + '_' + rnd`) | Локальный id. |
| `fio` | `string` | ФИО. **Trim в normalize**. |
| `roles` | `string` (pipe-separated) | BE/QA/.... |
| `teams` | `string` (pipe-separated) | Команды. |
| `overtimeDays` | `string[]` (ISO dates) | Какие дни помечены как OT. |
| `weekdayReady` | `boolean` | Готов в будний день к OT. |
| `weekdayComment` | `string` (pipe-list) | Причина если не готов. |
| `email` | `string` (lowercased) | V17.2 I1a — primary identity-канал. |
| `aliasEmails` | `string` (pipe-list, lowercased, без основного) | QD4: дополнительные email-aliases (work + personal). |
| `jiraAccountId` | `string` (lowercased) | F4: lowercased иначе создаются дубликаты. |
| `bitbucketLogin` | `string` (lowercased) | V17.2: если пусто — НЕ получает BB-данные. |
| `confluenceAccountId` | `string` (lowercased) | Обычно совпадает с jiraAccountId. |
| `isServiceAccount` | `boolean \| null` | V20 S4: auto-detect по pattern (`cab-sa-`, `sbt-`, `out-`, `bot-`). `null` = ещё не классифицирован. |
| `isBlocked` | `boolean \| null` | Заблокированный (уволенный) — ФИО содержит `[Х]/[X]/[В]/[B]`. **Исключается из identity/coverage**. |
| `sourceType` | `'manual' \| 'csv' \| 'auto'` | Откуда добавлен. |
| `createdAt` / `updatedAt` | `string` (ISO) | — |

### Производные методы (статические)

- `EmployeeFactory.detectBlocked(emp)` → boolean — regex по `[Х]/[X]/[В]/[B]` в ФИО.
- `EmployeeFactory.detectServiceAccount(emp)` → boolean — pattern по jiraKey.
- `EmployeeFactory.detectGhost(emp)` → boolean — V21: auto-created без identity и без ФИО.

---

## Persistence keys (localStorage)

См. также [`state-contracts.md` § Migration policy](./state-contracts.md).

| Key | Зачем |
|---|---|
| `q2_plan_v3` | `state.rows`, `state.employees`, derived state. |
| `q2_settings_v3` | UI-настройки (theme, colVisibility, ...) + `state.notifications` (v2) + `state.meta` (v3). Версии: 0 → 1 (drop summaryMode) → 2 (add notifications) → 3 (add meta). |
| `q2_llm_settings_v1` | LLM-config (provider, model, prompt-overrides). |
| `q2_integrations_v1` | Tokens (scrubbed на export). |
| `q2_onboarding_v1` | Tour state. |
| `sbof_app_settings_v1` | Legacy-app-settings. |
| `q2_action_log_v1` | `state.actionLog`. Retention 30 дней. |
| `q2_llm_conv_v1` | История LLM-чата. |
| `welcomeShown` | bool. |
| `dataStorageMode` | `'localStorage' \| 'sqlite'`. |
