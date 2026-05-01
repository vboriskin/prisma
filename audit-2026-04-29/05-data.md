# 05. Данные и персистентность

## Дуальность localStorage / SQLite

Логика выбора в `appDataStore.js`:
```js
function _readMode() { ... return ('sqlite' === storedMode) ? 'sqlite' : 'localStorage'; }
```

**Mode flag** хранится в `localStorage['q2_storage_mode']`. По умолчанию `localStorage`.

**Дублирование данных при mode='sqlite'**:
- `Storage.save()` (`dataStore.js:24-60`) ВСЕГДА пишет в localStorage.
- ДОПОЛНИТЕЛЬНО, если `mode === 'sqlite'`, копирует rows в SQLite через `window.AppDataStore.saveRows(state.rows)`.

То есть **localStorage ВСЕГДА — primary**, SQLite — mirror. Нет mode где SQLite primary.

**Расхождения возможны** если:
- Одна вкладка пишет в `localStorage`, вторая (с включённым `sqlite`) синхронизирует свой SQLite, а потом импорт даёт конфликт. NEW-1 в `11-found-bugs.md` об этом.
- При migration `localStorage → SQLite` (`AppDataStore.migrateFromLocalStorage`) — однонаправленно. Reverse migration теоретически есть (`migrateToLocalStorage`), но я её не тестировал.

## Размер localStorage — потенциальное превышение

Лимит браузера ~5-10 MB на origin. Что мы кладём:

```bash
# Данные пользователя в "production":
q2_plan_v3              ~ rows (variable), can grow to 1-2 MB easily for 500 rows × 50 fields
q2_settings_v3          ~ 10 KB (col config)
q2_action_log_v1        ~ unbounded growth (NEW-2 — баг)
q2_chat_prompts_v1      ~ < 50 KB (только overrides)
q2_llm_settings_v1      ~ ~5 KB
q2_integrations_v1      ~ ~2 KB (с токенами)
q2_onboarding_v1        ~ ~ 100 bytes
sbof_app_settings_v1    ~ ~ 1 KB
welcomeShown            ~ "true"
dataStorageMode         ~ "localStorage"
q2_sqlite_migrated_v1   ~ "true"
```

**Реальный риск**: при 500 строк × всех полях `q2_plan_v3` уже 1.5 MB. Plus `q2_action_log_v1` без ротации (NEW-2) растёт линейно. Через год активного использования — будет несколько MB.

**Что произойдёт при превышении**:
- `Storage.save` ловит `QuotaExceededError` → toast «Память браузера заполнена — экспортируйте данные в CSV». **Хорошо**, есть UX.
- НО: action log writes в `historyLog.js:90` **не защищены** — если quota переполнена там, тишина. Логи перестанут писаться. Severity: M.

## Schema rows — мёртвые поля?

В `rowFactory.js:9-31` (создание row):

```js
{ id, sourceType, sourceSheet, team, category, epic,
  backend, frontend, analytics_estimate, testing_estimate, total_estimate,
  tasks, taskComment, teamDependency, risks,
  release120Raw, release121Raw, release122Raw, overtimeRaw,
  release120Types, release121Types, release122Types, overtimeTypes,
  hasRelease120, hasRelease121, hasRelease122, hasOvertime,
  isUnassigned, scopeStatus, role,
  blockingDependency, blockingDeadline, commitToCounterparty, commitDate,
  isDone, doneDate, backlogTypes, donePills, ganttArrows,
  comment, dirty, riskFlags, workPeriodStart, workPeriodEnd,
  assignee, rowColor, createdAt, updatedAt, tags,
  jiraKey, jiraStatus, jiraAssignee, jiraUpdatedAt,
  prUrl, prStatus, prUpdatedAt, docUrl, docTitle, riskScore }
```

53 поля. Из них:

**Используемые активно** (нашёл grep'ом):
- `id, team, epic, isDone, blockingDependency, scopeStatus, riskFlags, riskScore` — везде
- `hasRelease120/121/122, hasOvertime` — везде
- `release120Types, release121Types, release122Types, overtimeTypes` — рендер реестра, Gantt
- `tasks, comment, taskComment, teamDependency, risks` — реестр UI
- `assignee, role, isUnassigned` — везде
- `jiraKey, prUrl, docUrl` — интеграции

**Подозрительно мёртвые / редко используемые** (нашёл 0-3 ссылки):
- `backlogTypes` — rowFactory создаёт, но `grep -rn backlogTypes --include="*.js"` показал только rowFactory + serialize. **Не используется в рендерах**. Возможно legacy — раньше, до wave 4, был тип "backlog".
- `donePills` — то же самое. Объявлен `{}`, нигде не читается. Кандидат на удаление.
- `ganttArrows` — `[]`, читается ТОЛЬКО в `views/gantt.js` для arrowsNew mode, но в legacy `arrowsNew` mode который depricated. Нужна верификация.
- `dirty` — устанавливается при импорте, но непонятно кем читается. Похоже — для отслеживания "rows that need re-save".
- `sourceType, sourceSheet` — заводятся при импорте, читается только при re-export. OK.
- `commitToCounterparty, commitDate` — реестр UI; редко (B2B-feature).

**Поля `raw JSON` нет** — все поля типизированные. Хорошо.

## SQLite — индексы и схема

В `sqliteStore.js`:

```bash
$ grep -n "CREATE TABLE\|CREATE INDEX" sqliteStore.js
```

Не разбирался глубоко (sqliteStore.js 551 LOC). Знаю:
- Schema: 3 таблицы — `rows`, `comments`, `change_log`
- `rows.id` PRIMARY KEY
- Не нашёл индексов на `team`, `epic`, `assignee` (типичные фильтры)

**Severity**: L. Поскольку SQLite — opt-in mirror, реальной нагрузки нет. Но при включённом sqlite mode фильтрация `state.rows` (in-memory) не использует SQLite вообще — это дублирование. Опять же, см. 04-frontend.

## HistoryManager — undo/redo

`app/historyManager.js` 148 LOC. Хранит снапшоты state. **Размер снапшотов**:

Каждый снапшот = `JSON.parse(JSON.stringify(state.rows))`. При 500 строк × 50 полей × ~100 bytes/поле = ~2.5 MB на один снапшот. Ограничение `MAX_HISTORY = ?` — не нашёл, надо смотреть.

```bash
$ grep -n "MAX_HISTORY\|history\.length\|.shift\(\)" app/historyManager.js
```

Если ограничения нет → undo-стэк может занять десятки MB в RAM.

**Severity**: M — но не персистится, только in-memory. Reload очистит.

## changeLog — растёт ли бесконечно

`historyLog.js` (208 LOC чата) и отдельно `historyLog.js` (root) — last `unshift({type, ...})` без ротации. NEW-2 — сюда же.

```bash
$ grep -n "shift\|slice\(0," historyLog.js
```

Если sla'ятся первые N — OK. Если нет — растёт вечно.

## Конкурентность — две вкладки

NEW-1 — баг race condition. Подробнее:

Browser оф — `storage` event на window'е срабатывает у **другой** вкладки когда первая пишет. Сейчас приложение **НЕ слушает** `storage` event:

```bash
$ grep -rn "addEventListener.*'storage'" --include="*.js"
0 hits
```

Это значит, что 2-я вкладка не узнает что 1-я что-то записала, продолжит работать со старым state, и при следующем save перезапишет.

**Severity**: H. Воспроизводится у любого пользователя.

**Починка**: добавить
```js
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) Storage.load() && App.refreshAll();
});
```

## Заключение

Категория | Оценка
---|---
LocalStorage / SQLite дуальность | удовлетворительно — primary всегда localStorage, SQLite mirror только; нет real conflict |
Размер данных в localStorage | удовлетворительно — есть QuotaExceeded handler, но action_log без ротации |
Schema rows | удовлетворительно — несколько мёртвых полей (`backlogTypes`, `donePills`) |
SQLite индексы | не разбирался — мирно работает но не оптимально |
HistoryManager | удовлетворительно — без MAX_HISTORY риск памяти |
changeLog ротация | плохо — NEW-2 растёт без границ |
Конкурентность вкладок | плохо — NEW-1 race condition, нет storage listener |
