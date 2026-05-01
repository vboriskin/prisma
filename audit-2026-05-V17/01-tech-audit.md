# Пункт 1 — Технический аудит V17

**Команда:** senior full-stack dev / senior QA tester / senior system analyst / гант-специалист.
**База:** v17_0 на момент копирования из v16_0.
**Тесты до:** 478 unit / 11 contract / 0 fail.

Каждый из 4 экспертов работал независимо. В этом файле — **синтез**: что нашли все, что нашёл кто-то один, и приоритет фиксов для пункта 2.

---

## ⛔ Полный консенсус (все 4 эксперта нашли независимо)

### CONSENSUS-1: Битый HTML в `_buildPill` ганта

**Где:** `views/gantt.js:1059–1070`. Открывающий тег `<span class="gantt-type-pill ..." ... data-tip="...">` НЕ закрывается `>` перед вложенным `<span class="gdt-pill-row-1">`.

Браузер парсит лояльно — все «inner spans» становятся **сиблингами**, а не детьми. CSS flex это маскирует, селектор `.gantt-type-pill .gdt-pill-row-1` теоретически не должен работать (но работает из-за browser-recovery), `aria-label` присваивается выкидышу, скрин-ридер читает «name → state → meta» как соседние элементы.

**Severity:** Blocker (функционально работает, но любая правка attr-порядка сломает).
**Fix:** добавить `>` после `data-tip="..."` (1 символ).

---

## 🔴 Critical (нашли 1-2 эксперта, но согласие в severity)

### CRIT-1: Token leak в CSV/JSON export (system analyst, S1)

`dataStore.js:215–224` — `STORAGE_KEYS_FOR_EXPORT` включает `q2_integrations_v1`, в котором `loadSettingsRaw()` хранит сырые `jiraToken / sigmaJiraToken / bitbucketToken / confluenceToken`. Этот ключ попадает в `_buildSettingsBundle()` (line 240) и в `JSONExport.buildSnapshot` (line 562). На import фильтруется allowlist'ом, на export — НЕТ. Любой пользователь, отправивший CSV/JSON-snapshot коллеге для шаринга плана, **отдаёт свой Jira-токен plain-text**.

**Severity:** Critical (security, data exfiltration).
**Fix:** удалить `q2_integrations_v1` из export bundle, либо применить ту же allowlist как на import.

### CRIT-2: SSRF через jira_config.json (full-stack, C4)

`server.js:403–428, 1485–1885` — `jiraForward({ targetUrl })` принимает `cfg.jiraBaseUrl / cfg.bitbucketBaseUrl / cfg.confluenceBaseUrl` напрямую. Эти поля правятся через `/api/jira/config POST`. Сервер слушает 127.0.0.1, но прокси-эндпоинты не требуют аутентификации. Злоумышленник с локальным доступом к UI может задать `jiraBaseUrl=http://169.254.169.254/latest/meta-data/...` и вытаскивать инстанс-метаданные через `jiraToken`-форварды.

**Severity:** Critical (security, multi-tenant context).
**Fix:** allowlist хостов из конфига при старте.

### CRIT-3: Edit-mode под plan-lock не пишет в transferComments (QA, B3)

`app.js:1753` — `requireMoveComment()` resolves `''` если `state.ganttEditMode === true`. Гант пишет `moveWtBetweenCols(..., { comment: '' })`, а guard `if (opts.comment)` (gantt.js:658) пропускает запись. Под plan-lock включаешь edit-mode, перетаскиваешь 30 пилюль — формально лок «продолжает действовать», но истории переноса нет. После выхода из edit-mode никто не докажет кто и зачем переносил.

**Severity:** Critical (compliance breach, plan-lock существует именно ради аудита).
**Fix:** в edit-mode писать в `transferComments` хотя бы `{ text: '[edit-mode]', user, at }`.

### CRIT-4: Delete pill убивает чужие trail-arrows того же `wt` (QA, B2)

`views/gantt.js:1894–1896` — `row.ganttArrows = row.ganttArrows.filter(a => a.wt !== wt)` слишком широкий. Если `wt` (например «backend») есть в r120, r121, r122 одной строки и есть trail 1.20→1.21, удаление пилюли в r122 (никак не связанной) сотрёт **все** стрелки этой `wt` строки.

**Severity:** Critical (потеря истории решений).
**Fix:** filter по `(a.wt === wt && (a.srcCol === srcCol || a.dstCol === srcCol))`.

### CRIT-5: Beforeunload flushNow отсутствует (QA, B4 + system analyst, C2)

`Storage.save()` имеет 400 мс debounce. Drag-drop пилюли → ⌘W в течение полусекунды → запись в localStorage НЕ выполнится. Нет ни `beforeunload`, ни `visibilitychange` хука. Также нет в обычном registry-edit (`views/registry.js:306–419`).

**Severity:** Critical (тихая потеря последнего изменения).
**Fix:** `addEventListener('beforeunload', () => Storage.flushNow())` + `visibilitychange→hidden`.

---

## 🟡 High (важные, фиксятся по бюджету)

### H1: Race race condition в drag/drop под Reactive auto-rerender (full-stack, C2-C3)
Drop handler делает `await App.requireMoveComment(...)`. Между захватом `dataTransfer` и мутацией пользователь может импортировать CSV (заменяет state.rows целиком). Защита есть только для исчезновения row, не для перезаписи row[srcField]-массива. Также `_dragData` остаётся живым между renderChart re-builds → фантомный реордер.

### H2: Двойной канал save → двойной renderChart (full-stack, C5)
Ctx-menu и drag handlers явно вызывают `Storage.save() + GanttView.renderChart()`. Параллельно Reactive proxy ловит мутации и через 100мс запускает `Storage.save() + App.refreshAll()` (полный rerender). Грэйс-период 250мс спасает только при совпадении секции. Любой ErrorsLog.add → грэйс сбрасывается → двойной рендер. На 100 команд = ~120мс freeze видимый «дёргание».

### H3: Cyrillic Ё/Ъ съедаются в team-key regex (QA, E1)
`team.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')` (gantt.js:263, 480, 708). Cyrillic блок 0x0410-0x044F включает А-Я а-я, но **не Ё (0x0401) и Ъ (0x042A)**. Команды «Ёлки» / «Объект» получают сломанные ключи; collapse-state и Cmd+K-jump перепутаются.
**Fix:** `[^a-zA-Zа-яА-ЯёЁ0-9]`.

### H4: Сторадж/restore не нормализует новые поля row (system analyst, M3 + QA, R1)
`Storage.restore` не пересоздаёт строки через `RowFactory.create()`. Старые snapshots не получают `assigneePills / unplannedPills / inProgressPills / transferComments`. Первый клик в гант → `Object.entries(undefined)` → TypeError.
**Fix:** прогон каждой row через `RowFactory.create(r)` в `Storage.restore`.

### H5: Dual storage event listener (QA, R5)
`bindCrossTabStorageSync()` (line 2106) показывает toast «обновите страницу», другой listener (line 2367) тихо перезагружает state. Toast лжёт.
**Fix:** удалить дубль либо однозначно решить — toast ИЛИ silent reload.

### H6: O(N²) в transferComments find на каждый рендер (full-stack, P2)
`findAddComment / findMoveComment / findComment` пробегают весь `row.transferComments` для каждой пилюли. На 30 пилюль × 50 переносов = 1500 итераций per row × 3000 rows = 4.5М итераций per render.
**Fix:** один проход → Map по ключу `${col}__${wt}` перед `cells.map`.

---

## 🟢 Medium (annoyances, отложить или quick wins)

| # | Источник | Что |
|---|---|---|
| M1 | full-stack P5 | 3000 dragstart listeners привязываются на каждый renderChart. Делегировать на wrap. |
| M2 | full-stack W4 | `setTimeout(() => drawPostponeArrows(wrap), 750)` дублирует rAF×2. Удалить. |
| M3 | gantt #1.4 | Em-dash `::after` конфликтует с `.gdt-drop-invalid::after`. Перевести на `::before`. |
| M4 | gantt #3.2 | Sticky-header z-index дубль (line 843 vs 4360). Удалить один. |
| M5 | gantt #2.1 | Drag-flight ghost накапливается на быстром move-next (700мс, не отменяется). |
| M6 | QA E7 | revertMove находит первую `dstCol === currentCol` без учёта последней цепочки. |
| M7 | QA E4 | JSON import конфликтующих id → дубль ключей в DOM. `_idCounter` не bump-ится. |
| M8 | QA A1/A4 | Focus-trap отсутствует на Cmd+K palette + 4-5 модалах. |
| M9 | gantt #5.7 | Overview-row: keyboard-нет (нет tabindex/role="button"). |
| M10 | system analyst Q5 | 5 параллельных map'ов pills (donePills/unplannedPills/inProgressPills/assigneePills + transferComments) — corruption-prone. Один map с `{state, assignee, comments}`. |
| M11 | full-stack Q6 | `ganttArrows.push` без капа — 50 переездов = 50 trail-rows. |
| M12 | system analyst S2 | `jira_config.json` plain-text без `mode: 0o600`. |

---

## 🟦 Low (косметика / далёкая дистанция)

- Multi-tab CRDT / lock — для 30+ юзеров (system analyst R1/R2)
- Виртуализация ганта — для 100+ команд (full-stack P1)
- Распилить gantt.js на ganttRender / ganttDnD / ganttCtxMenu (full-stack Q1)
- Распилить server.js на server/handlers/* (system analyst R4)
- Контракт runtime-валидация на read-path (system analyst §2)
- Memo `Utils.unique` / `getTeams` / `getWorkTypes` по `_dataVersion` (full-stack P3)
- AbortController на GigaChat-OAuth race (system analyst C4)
- HistoryManager не сохраняет filters/activeSection/timelineMode (system analyst §2 row 4)
- prototype-pollution в `state.colVisibility = s.colVisibility` (system analyst S5)
- ESLint `local/no-unescaped-innerhtml` 215 warnings (full-stack Q7)

---

## 📊 Итоги-резюме (синтез из 4 резюме)

| Эксперт | Оценка | Главный вывод |
|---|---|---|
| **Full-stack** | 70% к проду на 100+ команд | Гант — 2300-LOC монолит. Один blocker (CONSENSUS-1), тонкий race в drag/drop, redundant двойной save, O(N²) — на 30×30 ОК, на 100×30 будет ~200-300мс freeze |
| **QA** | 2/5 для 30+ юзеров одновременно; 4/5 для admin+read-only | Нет CRDT, нет server-sync. Plan-lock + edit-mode = дыра в audit-контракте |
| **System analyst** | «Средняя плюс» зрелость | 3 блокера до прода: token leak, multi-tab race, миграция row-format. SQLite режим есть, но opt-in |
| **Gantt-spec** | 7/10 визуально / технически на грани | Дизайн-language очень сильный. «Магия» работает на пределе — sticky in non-scroll-context, em-dash vs hatched через один ::after, незакрытый span, browser-recovery держит каскад |

**Сходятся в:** битый HTML пилюли — НЕМЕДЛЕННЫЙ фикс. Token leak — blocker. Edit-mode без аудита — compliance breach.

**Расходятся в:** виртуализация ганта (full-stack за, остальные не упоминают), CRDT (system analyst и QA, остальные не приоритет).

---

## План фиксов для Пункта 2

Применяем в одну итерацию:
1. ✅ **CONSENSUS-1**: закрыть `<span>` тег пилюли (1 char)
2. ✅ **CRIT-1**: token leak — удалить `q2_integrations_v1` из export bundle
3. ✅ **CRIT-3**: edit-mode → пишет `[edit-mode]` в transferComments
4. ✅ **CRIT-4**: delete pill — точечный filter ganttArrows
5. ✅ **CRIT-5**: beforeunload + visibilitychange flushNow
6. ✅ **H3**: cyrillic Ё/Ъ в team-key regex
7. ✅ **H4**: Storage.restore через RowFactory.create
8. ✅ **H6**: один проход для transferComments → Map (perf)
9. ✅ **M2**: удалить 750мс дубль drawPostponeArrows
10. ✅ **M4**: дубль `.gantt-header z-index`

CRIT-2 (SSRF) — отдельная задача (требует allowlist UI), не in-scope для quick fix. **TODO** для будущей итерации.
H1, H2 — сложные race conditions, требуют рефакторинга. **TODO** для отдельной итерации.
M1, M3, M5–M12 — оставляю в backlog. **TODO**.

После фиксов — добавить тесты на каждый CRIT/H (regressions) — пункт 2.
