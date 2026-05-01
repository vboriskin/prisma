# 09. Качество кода

## Дублирование (детально)

### Парсеры дат — 4 разных места

| Файл / функция | Что парсит |
|---|---|
| `utils.js:57-69 — Utils.parseDateish` | RU (dd.mm.yyyy) + ISO + free Date() fallback |
| `portfolioPulseUtils.js:20-26 — ts(s)` | only ISO via Date.parse, returns ms |
| `chat/chatIntentParser.js:240-260` (relative date extraction) | "сегодня"/"вчера"/"в понедельник" |
| `server.js:1392-1394 — isoCutoffShort` | ISO truncate to "YYYY-MM-DD HH:MM" |

Не одинаковое, но похожее. Стоит выделить shared helper, но требует анализа всех использований.

### URL builders — 3 места

| Файл | Что строит |
|---|---|
| `integrations/portfolioPulseRenderer.js:62` | `${baseUrl}/browse/${key}` |
| `integrations/integrationsRenderer.js:194` | `${baseUrl}/browse/${jiraKey}` |
| `integrations/blackDashboardRenderer.js:50` | `${sigmaUrl}/browse/${g.key}` |

Можно вынести в `Utils.jiraIssueUrl(baseUrl, key)` — 5-строчная функция. Win: единая точка для безопасности.

### `safeUrl` — 3 копии

```js
// portfolioPulseRenderer.js:18
function safeUrl(u) {
  const s = String(u || '').trim();
  return /^(https?:|mailto:)/i.test(s) ? s : '';
}
// integrations/blackDashboardRenderer.js:20 — exact copy
// integrations/techInfoRenderer.js:23 — exact copy
```

**Один-в-один копия** в трёх местах. Должно быть в `utils.js`.

### Author key normalisation — несколько мест

```js
// portfolioPulseUtils.js:74 — userKey()
// server.js:617-618 — _ppKeyForAuthor()
```

Разные модули, но логика похожа: lowercased displayName/email.

### Concurrency limiters — 3 копии

```js
// server.js:467 — jiraPLimit(concurrency, tasks)
// server.js:1133 — _tiPLimit(concurrency, jobs)
// server.js:1287 — concurrency-bounded loop в ppFetchBitbucketActivity
```

Три почти-одинаковые реализации `pLimit`. Можно вынести в один shared helper.

### `bump` author counter — 2 копии

```js
// server.js:629-647 — bump() в ppFetchBitbucketActivity
// server.js:856-872 — bump() в ppFetchDevStatusForIssues
```

Идентичная сигнатура, идентичная логика. Различие — в какой `authors` map пишется.

## Мёртвый код

### Экспорты, никем не импортируемые

Прошёлся выборочно — нашёл подозрительные:

```bash
$ grep -rn "export function" --include="*.js" 2>/dev/null | grep -v node_modules | wc -l
~80 exports
```

Не успел проверить каждый. Конкретные подозрения:

- `tests/fixtures/jiraPulseResponse.js:84 — `export function makeJiraIssue(...)`` — есть в фикстурах, но `grep -rn "makeJiraIssue"` показывает использования только в тестах portfolioPulseModel — **OK**.
- `chat/chatTemplates.js:166 — renderQuickPromptsHTML` — используется в `app/llmAssistant.js:643`. **OK**.
- `chat/chatPrompts.js — PROMPTS` (proxy) — используется ли? `grep` показывает только в тестах. **Возможно мёртв**.

Глубокий unused-exports анализ требует TypeScript Language Server / `ts-prune` — не настроено.

### Поля row, никем не читаемые

См. `05-data.md` — `donePills: {}`, `backlogTypes: []`, может быть `dirty`. Не разбирался во всех 53 полях.

## TODO / FIXME / HACK

```bash
$ grep -rEn "(TODO|FIXME|HACK|XXX):" --include="*.js" 2>/dev/null | grep -v node_modules
2 hits (only in libs/)
```

**Чисто** — комментариев типа TODO в коде ПРОЕКТА нет. Хорошо.

## Длинные функции (>100 LOC)

Топ кандидаты:

| Файл | Функция | LOC |
|---|---|---|
| `server.js` | `analysePulse` (через model.js) | ~250 LOC |
| `integrations/portfolioPulseModel.js` | `analysePulse` | 298 LOC |
| `integrations/portfolioPulseRenderer.js` | `renderParticipantCard` | 120 LOC |
| `integrations/portfolioPulseRenderer.js` | `_renderTodaySection` | 130 LOC |
| `integrations/portfolioPulseRenderer.js` | `_renderDaySection` | 165 LOC |
| `app.js` | `App.init` | ~110 LOC |
| `app.js` | `App.bindGanttModes` | ~70 LOC |
| `views/gantt.js` | `renderChart` | ~280 LOC |
| `views/registry.js` | `RegistryView.render` | ~150 LOC |
| `chat/chatEngine.js` | `processMessage` | ~120 LOC |
| `ai/aiCeoFallback.js` | `computeSaveTheRelease` | ~120 LOC |

**`analysePulse` 298 LOC** — самый длинный. См. `01-architecture.md` — стоит разнести.

## Магические числа / строки

Найденные:

- `400` ms debounce в `Storage.save` — magic. Должно быть `STORAGE_DEBOUNCE_MS`.
- `100` ms в Reactive — есть `_DEBOUNCE_MS` const. ✓
- `45000` (45s) — `PER_PK_TIMEOUT_MS` — есть. ✓
- `25000`, `30000`, `20000`, `12000` per-query budgetMs — inline literals.
- `48 * 3600 * 1000` — 48h window в нескольких местах. Можно `WINDOW_48H_MS`.
- `'iso'`, `'todo'`, `'wip'`, `'done'` — статус buckets — constants.js?
- `customfield_10020` — sprint field fallback. const есть.
- 'Готово|Closed|...' — terminal status names в `isTerminalStatus` regex. Inline.
- `'q2_plan_v3'`, `'q2_settings_v3'` — STORAGE_KEY константы есть. ✓
- `'q2_chat_prompts_v1'` — есть `PROMPTS_STORAGE_KEY`. ✓

**Hardcoded numbers в цикле parsePulse**: `cap: 500, budgetMs: 30000` etc — inline в queries[]. Стоит вынести в `PULSE_QUERY_CONFIG`.

## Имена

**Сбивающие с толку**:
- `ts(s)` в `portfolioPulseUtils.js` — `ts` это `Date.parse` обёртка. Слишком короткое имя для функции, которую вызывают в 50+ местах.
- `_ppKeyForAuthor` vs `userKey` vs `userNameKey` — три похожих имени для разных things. Confusing.
- `bbItems` / `cfItems` — нормально кратко, но newcomer не сразу поймёт что это.
- `_t` в `Storage._t` — ладно, но `_storageDebounceTimer` лучше.
- `RULES` в chatIntentParser — общий name, но рядом `CATEGORY_RULES` — putt of "rules". Может `INTENT_RULES`.

## Комментарии

```bash
$ grep -c "^[[:space:]]*//" server.js
~250 lines
$ grep -c "^[[:space:]]*\*" server.js
~80 lines (multi-line блок-комменты)
```

**Качество**: высокое. Видел отличные комментарии вида:
- `server.js:419-421` — объясняет почему 2 retries вместо 4 (бывший таймаут чейн 60s).
- `dataStore.js:28-30` — объясняет why Reactive.silent на _dataVersion++.
- `integrations/portfolioPulseRenderer.js:43-45` — объясняет почему TL_KIND_ICON на module-scope.

**Расхождения с кодом**:
- `ARCHITECTURE.md` устарел (см. 01).
- `// TODO: ...` — нет, чисто.
- Нашёл одну стейл-ссылку на `bg-red-700` (не нашёл стиль).

## JSDoc — распространение

```bash
$ grep -rn "^[[:space:]]*\* @param" --include="*.js" 2>/dev/null | wc -l
~150 mentions
$ grep -rn "^[[:space:]]*\* @returns" --include="*.js" 2>/dev/null | wc -l
~50 mentions
```

Используется в:
- `libs/safeHtml.js` — полностью.
- `chat/chatPrompts.js` — частично.
- `integrations/portfolioPulseModel.js` — на 2 функциях.
- `integrations/blackDashboardModel.js` — на главных функциях.
- `dataStore.js` — несколько.

Большинство файлов — без JSDoc. `tsc --noEmit` не ругается, потому что без аннотаций tsc просто infers `any`.

## Обработка ошибок на frontend

**Паттерны**:
- `try { ... } catch(_) {}` — silent swallow, ~30 раз. Плохо для debugging.
- `try { ... } catch(e) { console.warn('[X] failed:', e) }` — best-effort log, ~20 раз. **Хорошо**.
- `window.showToast?.(...)` — UX feedback, ~10 раз. Хорошо.
- `alert(...)` — нашёл 0 occurrences. **Отлично**.
- `confirm(...)` — нашёл несколько (`StorageSettings._wire` для confirm-clear). OK для destructive actions.

**Несогласованность**: в одних модулях error → console + toast, в других — silent swallow. Стоит выработать стандарт.

## Заключение

Категория | Оценка
---|---
Дублирование | удовлетворительно — 5-6 явных случаев на extract |
Мёртвый код | удовлетворительно — несколько подозрительных полей в row, но не критично |
TODO/FIXME | отлично — нет |
Длинные функции | удовлетворительно — ~10 функций >100 LOC, но они структурированы |
Магические числа | удовлетворительно — большинство в const, несколько inline |
Имена | хорошо — в новом коде понятные, в legacy `ts()` короткое |
Комментарии | отлично — высокое качество, объясняют WHY |
JSDoc | удовлетворительно — частичное покрытие |
Обработка ошибок (frontend) | удовлетворительно — нет alert(), но silent catches |
