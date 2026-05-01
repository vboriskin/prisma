# Пункт 2 — Применённые фиксы + новые тесты

**До:** 478 unit / 11 contract / 0 fail.
**После:** **497 unit / 11 contract / 0 fail**. (+19 regression-тестов)

## Применённые фиксы

| # | Severity | Файл / строки | Что |
|---|---|---|---|
| F1 | **CONSENSUS-1** Blocker | `views/gantt.js` `_buildPill` | Закрыл `<span>` пилюли (`>` после `data-tip`). 4 эксперта нашли независимо |
| F2 | **CRIT-1** Critical (security) | `dataStore.js` `STORAGE_KEYS_FOR_EXPORT` + `_buildSettingsBundle` | Удалил `q2_integrations_v1` из export bundle + добавил `_scrubSecrets()` defence-in-depth (любое поле содержащее `token/key/password/secret/bearer` фильтруется в любой части bundle) |
| F3 | **CRIT-3** Critical (compliance) | `views/gantt.js` `moveWtBetweenCols` | Под plan-lock + edit-mode → запись `{text:'[edit-mode]'}` в `transferComments` (раньше пустота, ломала аудит-trail) |
| F4 | **CRIT-4** Critical (data-loss) | `views/gantt.js` ctx action `delete` | `ganttArrows.filter(a => !(a.wt === wt && (a.srcCol === srcCol \|\| a.dstCol === srcCol)))` — раньше слишком широкий filter сносил все trails этого wt |
| F5 | **CRIT-5** Critical (data-loss) | `app.js` init() | `beforeunload` + `visibilitychange→hidden` → `Storage.flushNow()`. Раньше изменения за 400ms до ⌘W терялись |
| F6 | **H3** High (data-corruption) | `views/gantt.js` 3 regex sites | `[^a-zA-Zа-яА-ЯёЁъЪ0-9]` (раньше Ё/Ъ съедались, «Ёлки» и «Елки» получали разные ключи) |
| F7 | **H4** High (TypeError на старых snapshot'ах) | `dataStore.js` `Storage.restore` | Каждый row через `RowFactory.create(r)` — legacy snapshots авто-получают `assigneePills/unplannedPills/inProgressPills/transferComments/...` |
| F8 | **H6** High (perf, ~4.5M итераций/render) | `views/gantt.js` `_buildPill` | `findAddComment` / `findMoveComment` → один проход → Map по `${col}__${wt}` |
| F9 | **M2** Medium (perf, drag-flight) | `views/gantt.js` end of `renderChart` | Удалил 750ms-дубль `drawPostponeArrows`. Двойной rAF достаточен; 750ms-таймер рисовал поверх уже удалённых нод |
| F10 | **M4** Medium (z-index дубль) | `styles.css` 2 `.gantt-header` rules | Привёл оба определения к z-index:10 (раньше 5 vs 10 — cascade случайно работал) |

## TODO (отложено в backlog)

| Severity | Что | Почему отложено |
|---|---|---|
| **CRIT-2** SSRF | server.js `jiraForward` host allowlist | Требует UI для allowlist + миграции существующих конфигов |
| **H1** Race в drop под Reactive auto-rerender | После `await requireMoveComment` ре-валидировать `wt` в `row[srcField]` | Тонкая race condition, требует обширного тестирования |
| **H2** Двойной save-канал | Убрать redundant Reactive-flush после явного `Storage.save` | Требует аккуратной координации с `App.refreshAll`-схемой |
| **H5** Dual storage-event listener | Удалить дубль (toast «обновите» + silent reload) | Решить product-вопрос: тост или silent reload |
| **M1** 3000 dragstart listeners | Делегировать на wrap | Уже частично есть wrap-level dragstart, нужна аккуратная отвязка per-pill |
| **M3** em-dash `::after` vs `.gdt-drop-invalid::after` | Перевести один на `::before` | Cosmetic, ловит только в drag-сессии |
| **M5** drag-flight ghost накапливается | Отменить ghost при следующем move | Cosmetic, редко |
| **M6** revertMove первой dstCol | Сменить на последнюю по timestamp | Edge-case |
| **M7** JSON-import `_idCounter` bump | `state._idCounter = max(...rows.id) + 1` | Edge-case |
| **M8** focus-trap на 5 модалах | Util + проброс по всем | Большая работа, отдельная итерация |
| **M9** Overview-row keyboard | tabindex+role на `.gdt-overview-row` | A11y, отдельная итерация |
| **M10** 5 параллельных pill-maps в один | Большой data-model рефакторинг | Требует миграции данных |
| **M11** ganttArrows cap | `.slice(-10)` или агрегация | Cosmetic |
| **M12** `jira_config.json` mode 0o600 | `fs.writeFileSync(..., {mode: 0o600})` | server-side полу-критично |

## Новые regression-тесты (19 штук)

Файл: `tests/unit/v17AuditFixes.test.js`

| Группа | Тестов | Что проверяют |
|---|---|---|
| **CRIT-1** token leak | 3 | CSV bundle / JSON snapshot не содержит `q2_integrations_v1`; `_scrubSecrets` удаляет любые `*token*` поля даже из allowlisted ключей |
| **H4** restore via RowFactory | 2 | Legacy row без новых полей получает их через `RowFactory.create`; row с уже заполненными полями сохраняется без потерь |
| **CRIT-4** delete pill scoping | 3 | Удаление wt в r122 сохраняет r120↔r121 trail; удаление в r121 убивает оба арроу-конца; разный wt не задевается |
| **H3** Cyrillic regex | 4 | Ё/ё/Ъ/ъ сохраняются; пунктуация → `_`; Ёлки ≠ Елки (regression for E1) |
| **CRIT-3** edit-mode trail | 4 | Plan-locked + edit-mode + пустой comment → `[edit-mode]`; реальный comment побеждает; unlocked → ничего; locked без edit-mode → ничего |
| **H6** Map-based transferComments | 3 | Latest-by-timestamp выигрывает; add/move maps разделены; malformed-entries skipped |

## Финальные тесты

```
ℹ tests 497
ℹ pass 497
ℹ fail 0
Contract: 11 passed, 0 failed
```

Регрессий нет, базис улучшен на 10 фиксов и 19 тестов. Edit-mode теперь полноценно part of audit trail. Token leak закрыт (был critical security blocker для CSV-share use-case). Двойной z-index конфликт ушёл.
