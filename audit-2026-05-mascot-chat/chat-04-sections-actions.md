# Chat — взаимодействие со вкладками и действиями + интеграции

> Full-stack engineer аудит. Фокус: как чат взаимодействует с разделами и действиями, отдельно — Чат × Интеграции.
> Дата: 2026-05-07

## 1. Таблица проблем

| # | Sev | File:line | Симптом | Корень |
|---|---|---|---|---|
| **P1** | HIGH | `chatActions.js:200-220` fallback ветка `applyPendingBatch` | Mass-mutation при отсутствии `window.applyBulkAction` идёт через прямую запись в `state.rows[i].x`, т.е. **через Proxy**, без `Reactive.silent()`. На каждой строке триггерится debounce save + `App.refreshAll`. Контракт #1 (CLAUDE.md) нарушен | fallback переписан на «прямую мутацию» без guard'а |
| **P2** | HIGH | `chatActions.js:36-53` `matchRowsByFilter` | `release` поддерживает только `120/121/122/ot`, но `state.filters.release` ниже принимает любую строку (`f.release = '1.21'`). UX-несоответствие: chat «Релиз 1.21» → apply_filter `release="121"` (см. `chatEngine.js:95`, `replace('.','')`), но `matchRowsByFilter` ждёт **строку без точки** — а filters в registry часто хранят с точкой. Двойная нормализация |
| **P3** | HIGH | `chatActions.js:250-268` `handleApplyFilter` + `nav.js:goTo` | Фильтр применён через чат → пользователь кликает «Дашборд» в sidebar → `state.filters` сохраняются, но дашборд их не показывает; затем возврат в Реестр — фильтры **остались**, без признака «они от чата». Нет авто-сброса при navigate, нет визуального chat-mark |
| **P4** | HIGH | `chatActions.js:151-241` | mass-mutation **не пишется в HistoryLog**. `writeChangeLogEntry` пишет в `state.actionLog` (chat-log), но `HistoryLog.ai('chat_message', …)` логируется только для отправки сообщения. Confirm batch на 50 задач — invisible в общей истории. Двойная система логирования |
| **P5** | MED | `chatActions.js:17-23` `navigateTo` | Использует `window.App?.goTo` или fallback `.nav-item[data-section]`-click. Nav вынесен в `app/nav.js`, а не `App.goTo`. Если `window.App.goTo` не выставлен — DOM-fallback работает, но без `Nav.goTo` теряется data-active-module / `<title>` / chip-bar refresh |
| **P6** | MED | `chatActions.js:331-335` `handleConfirmBatch` | На mismatched batchId просто toast, никакого диагностического сообщения в чат |
| **P7** | MED | `chatReports.js:33-41`, `applyPendingBatch` | **Race**: snapshot хранится в `localStorage`. Между `takeSnapshot` и `diff` пользователь может выполнить mass-edit; следующий `buildDailyReport` смешает «изменения от чата» и «изменения от руки» |
| **P8** | MED | `chatActions.js:175-181` `payloadMap.assign_release` | hard-coded `types: ['backend']` для assign_release. Если у задачи UI-ный chip-выбор был `frontend+QA` — **чат стирает их и ставит backend** |
| **P9** | MED | `chatActivityHandler.js:174-187` employee match | matches по `p.label` (display name) — substring-include, не по `state.employees[].{email,jiraAccountId,bbLogin}`. Контракт #2 «Identity-deterministic attribution» (CLAUDE.md) не соблюдён |
| **P10** | MED | `chatContextBuilder.js:77-87` `pickRow` | В payload утекают служебные поля: `id` (внутренний row-id), `riskFlags` (без redaction). Custom payload (`buildCustomContextPayload`) **никак не sanitize'ит** custom-JSON — пользователь может туда положить токен |
| **P11** | MED | `chatEngine.js:664` `pulseModel` source | `window.PortfolioPulse?._model` — приватное поле (`_model`). Если refactor переименует — чат тихо потеряет integrations-context. Два независимых пути: `chatActivityHandler` и `buildScannerQueryContext` используют **разные источники** |
| **P12** | LOW | `chatActions.js:353-369` `executeAction` | **Мёртвый**: `preview_release` принимает `payload.release`, но в коде не используется. LLM может вернуть `type:"preview"` (см. FEW_SHOT_ACTION в chatPrompts.js:62) — такого type нет → silent ignore |
| **P13** | LOW | `chatEngine.js:63-65` `buildExecutiveSummaryResponse` | `actions: navigate registry/gantt` — без передачи фильтра. Пользователь спросил про блокеры → перешёл в Реестр без фильтра «onlyBlocking» |
| **P14** | LOW | `chatPrompts.js:62` few-shot example | Содержит JSON `{"type":"preview","payload":{"intent":"move_to_overtime",...}}` — type, который **не существует** в executeAction. LLM учится несовместимому формату |
| **P15** | LOW | `nav.js:104` HistoryLog.view не пишется при `section==='history'` | Если чат navigate → history, в логе ничего не появится |

## 2. Чат × Интеграции (BB / CF / Jira / Zephyr)

### Что работает
- Activity-pipeline (`chatActivityHandler.js`) даёт чату доступ к Pulse-модели: `issuesNow`, `blockers`, `bbItems` (commits/PR), `cfItems`, `doneToday/Yesterday`, `afterHoursRatio`, `gini`, `reworkRatio`. Самый богатый интеграционный контекст в чате.
- `buildScannerQueryContext` (`chatContextBuilder.js:206-279`) вытаскивает из `window.TeamScanner2.getModel()` агрегаты по топ-12 активным + per-target `metrics`/`reworkRatio`. Корректно фильтрует `[X]`-уволенных.
- Если pulse не запущен → честный hint «откройте Сканнер команд и нажмите ↻».

### Чего не хватает
1. **Нет pulse-trigger action**. Чат не умеет сказать «сейчас обновлю pulse» — `executeAction` не имеет `refresh_pulse`/`refresh_scanner`. Юзер должен идти в раздел вручную.
2. **Identity-gap detection отсутствует**. Запрос «покажи кто без bbLogin» не маршрутизируется — нет intent'а в `chatIntentParser.js`. CLAUDE.md контракт #2 явно требует identity-таблицу как первоисточник, но чат её не читает (`state.employees[]` нигде не присутствует в `buildContextForIntent`).
3. **Два независимых window-handle'а**: `window.PortfolioPulse._model` (чат) vs `window.TeamScanner2.getModel()` (scanner_query). Между ними нет синхронизации; ответы могут расходиться.
4. **Activity-handler матч по display name** — нарушение identity-deterministic-контракта. Двойники сливаются.
5. **Jira/Zephyr/Confluence напрямую** — чат не имеет prompted контекста про их статусы (например «сколько тестов в Zephyr fail для команды X»). Только косвенно через `bbItems.kind === 'pr'`.
6. **PII guard асимметричен**: `_redactComment` (`chatContextBuilder.js`) и `Utils.scrubPiiInText` (`llmAssistant.js`) — разные функции в двух ветках. Custom-payload не санитизируется вообще (P10).

### Predicted user pains
- «Чат не видит изменений из BB после ручного pulse-refresh» (если model — старый snapshot).
- «Спросил про Иванова — а это не тот Иванов» (display-name fuzzy match).
- «Не могу из чата запустить refresh интеграций» — UX-fragmentation.
- «Чат показал 5 блокеров, а в Реестре 7» (filter-engine vs `state.rows.filter` несинхронизированы).

## 3. Топ-5 предложений

1. **Новый intent `INTEGRATION_HEALTH`** + context-builder, читающий `state.employees[]` и сравнивающий с BB/CF/Jira identity-таблицами. Запросы вида «кто без bbLogin», «у кого нет Jira-аккаунта», «команды без Confluence-space». Resolver — через email/`jiraAccountId` (контракт #2), не fuzzy.
2. **Action `refresh_integration` с payload `{source: 'pulse'|'scanner'|'jira'|'zephyr'}`** — единая точка триггера pulse-refresh из чата. Логировать через `HistoryLog.integration` (новый channel).
3. **Унифицировать HistoryLog для чат-mutations**: `applyPendingBatch` обязан вызывать `HistoryLog.ai('chat_batch', label, {rowIds, action})` **ПЛЮС** оборачивать запись в `Reactive.silent()` в fallback-ветке (P1+P4).
4. **Filter-affinity tag**: при `apply_filter` ставить `state.filters._source = 'chat'` + бейдж «фильтр от ассистента» в Реестре с кнопкой «сбросить». При navigate в нерелевантный раздел — не сбрасывать, но в Реестре показывать affordance очистки.
5. **Context-builder `integrations` mode** в `buildLLMMessages` — отдельно от `currentView/summary/full/custom`. Включает: identity-coverage, last-pulse-ts, BB-stale PR-кол-во, Zephyr fail-rate.

**Bonus fix (P14):** заменить few-shot пример action JSON в `chatPrompts.js:62` с несуществующего `type:"preview"` на реальный `type:"confirm_batch"` payload — иначе LLM учит несовместимый формат.
