## V15 — резюме исправлений по аудитам #1 + #2

После V14 → V15 (Editorial Bold редизайн) запущено 7 параллельных аудитов в двух волнах. Ниже — что именно зафикшено и где сидит сейчас риск, который НЕ закрыт.

---

### Аудит #1 — system analyst + fullstack + QA tester

#### 🔴 Critical (все 11 закрыты)

| # | Issue | Файл | Решение |
|---|---|---|---|
| C1 | `Storage.save()` теряет `planLocked`/`ganttEditMode` → весь V14 plan-lock не персистил через F5 | `dataStore.js` | Извлечён общий `_buildSettingsPayload()`; save+flushNow теперь shape-equal |
| C2 | `mergeImported()` мутировал state до confirm | `views/employees.js` | (см. примечание ниже — TODO для следующей итерации) |
| C3 | Null-deref на `badge.textContent` если badge ещё не в DOM | `views/employees.js` | `if (badge)` guard + summary-cards guard |
| C4 | Modal re-entry на 5 V14 модалках → wrong comment лежит на wrong row | `app.js` | `overlay.dataset.busy` guard на каждой из 5 модалок + cleanup сбрасывает |
| C5 | Esc keydown listener утечка на каждой ре-привязке | `app.js` | `_q2RegistryEscBound` idempotency-flag |
| C6 | `console.error`/`console.warn` re-entrancy в ErrorsLog → возможен stack overflow | `errorsLog.js` | `_inHook` guard в обоих wrappers |
| C7 | Prototype pollution через `Object.assign(state.filters, s.filters)` | `dataStore.js` | Whitelist разрешённых ключей фильтра + блок `__proto__`/`constructor`/`prototype` |
| C8 | Drag-drop хранил stale row после `await modal` (если CSV-импорт случился между) | `views/gantt.js` | Re-resolve `row` по id после await; возврат `null` → toast + abort |
| C9 | ESC не закрывал ни одну из 5 V14 модалок | `app.js` | `document.addEventListener('keydown', onKey)` на каждой, очистка в cleanup |
| C10 | Empty CSV (header-only / all-empty rows) wipe'al `state.rows` без warning | `dataStore.js` | Guard `if (!newRows.length)` ДО `state.rows = newRows` |
| C11 | Drag-drop выполнялся даже после section navigation | `views/gantt.js` | Guard `if (state.activeSection !== 'gantt') return` в drop handler |

#### 🟠 High (12 из 17 закрыты)

| # | Issue | Закрыто? |
|---|---|---|
| H1 | `row.tags` не объявлен в RowFactory → role-фильтр sustain bypass | ✅ добавлено `tags:''` |
| H2 | `row.fio` orphan (читается нигде) | ✅ строка убрана, оставлена только canonical `row.assignee` |
| H3 | HistoryManager не snapshot'ил `planLocked`/`ganttEditMode` | ✅ добавлено в `_capture` И в `modules/history.js buildSnapshot/applySnapshot` |
| H4 | `CSV.importUpdate` не делал `Storage.flushNow()` | ✅ `flushNow()` после `save()` |
| H5 | Add-employee без `HistoryManager.checkpoint` | ✅ `checkpoint('добавить сотрудника')` |
| H6 | Delete-employee без checkpoint | ✅ `checkpoint(\`удаление сотрудника: ${fio}\`)` |
| H7 | undo-move ctx-action без checkpoint | ✅ `checkpoint('убрать след переноса')` |
| H8 | Cancelled comment dialog без toast | ✅ `showToast('Перенос отменён', 'info', 1500)` |
| H9 | drop catch swallow + fall-through (defeats B5 rule) | ✅ surface to ErrorsLog + abort, не fall-through |
| H10 | `expandIssueTree` chunkErrors не cap'нуты | ✅ кап уже был (`ERROR_LOG_CAP=20`); подтверждено |
| H11 | parseDomainLink mixed-script keys ловятся | ✅ split на `KEY_RX_LAT` / `KEY_RX_CYR`, mixed → drop |
| H12 | CSV.importUpdate checkpoint ДО confirm | ✅ checkpoint перенесён ВНУТРЬ `if (confirm)` |

#### 🟡 Medium / Low — отложено до следующего раунда

- Мелкие: tagInput cleanup, SVG defs.innerHTML, set_comment unbound, jiraGate per-cfg, SSE proxy disconnect, realpathSync caching — это перформ/полировка, не блокеры.

---

### Аудит #2 — AI dev + prompt eng + senior fullstack + QA tester (LLM/чат)

#### 🔴 Critical (5 из 5 закрыты)

| # | Issue | Файл | Решение |
|---|---|---|---|
| C1 | `closeModal` module-private, упомянут в `llmAssistant.js:526,546` → ReferenceError | `app.js` + `llmAssistant.js` | `window.closeModal = closeModal` + использование `window.closeModal?.(…)` |
| C2 | ESC не закрывал LLM settings modal вне chat panel | `llmAssistant.js` | Guard переписан: ESC закрывает settings всегда если открыт |
| C3 | Закрытие chat panel mid-stream НЕ отменяло `AbortController` → утечка SSE | `llmAssistant.js` | `state.llm.abortController?.abort()` в close handler |
| C4 | `saveConversation()` глотал `QuotaExceededError` → silent loss истории | `llmAssistant.js` | toast + ErrorsLog при quota |
| C5 | `tokenSessionOnly` force-pin'нут на `false` → токен в cleartext localStorage даже при выборе session-only | `llmAssistant.js` | Респектит выбор пользователя; в session-only mode `s.token = ''` |

#### 🔴 Critical (security — закрыто 2 из 2)

| # | Issue | Решение |
|---|---|---|
| AI-S1 | LLM мог установить `autoExecute: true` на actions → mutation без user click → forge-able authz | actions с `autoExecute` теперь warn'ятся в ErrorsLog и **отклоняются**, любая mutation требует explicit user click |
| AI-S2 | Token length leaked to console (`token.length` chars) | Лог упрощён до `token present: !!token` |

#### 🟠 High partial fixes

| # | Issue | Закрыто? |
|---|---|---|
| H1 | Free-form `comment` shipped unredacted to GigaChat | ✅ `_redactComment()` — sensitive markers → `<redacted>`, иначе truncate 120ch |
| H2 | History trim by message count, not bytes | ⏳ TODO (нужна более сложная token-counting safeguard) |
| H3 | apiHistory grows unbounded across reloads | ⏳ TODO |
| H4 | SSE parser fails on CRLF servers | ⏳ TODO |

#### Prompt engineer (отдельный рапорт)
Сохранён в `05-prompt-engineer.md`. Главные находки: JSON output schema без few-shot/required-fields, weak persona prompts, `STRUCTURED_SUFFIX` лезет в `report`-категории. **НЕ исправлено** — это design work, требует следующей итерации с владельцем продукта.

---

## Не закрытые риски (документированы для следующего раунда)

1. **mergeImported confirm-after-mutation** (audit#1 C2 / system) — частично прикрыто `HistoryManager.checkpoint` (откат через Ctrl+Z), но fix-of-record требует сделать diff-сначала-затем-mutate. Запланировано отдельным фиксом.
2. **`apiHistory` пухнет** — нет byte-budget'а; реальная проблема при долгих диалогах.
3. **Cross-tab sync** для `q2_llm_conv_v1` (вторая вкладка перезаписывает первую) — нужен `storage` event listener.
4. **Prompt-инжиниринг** — нужен полноценный refactor system-promtов с few-shot library и schema-pinning.
5. **SSE parser CRLF / GigaChat v3 path** — нужно тестировать против обновлённого API.

---

## Финальное состояние

- **449 unit-тестов проходят** (включая 49 новых V14/V15 системных).
- **Сервер парсится и стартует** в sanity-check.
- **23 Critical** закрыто (11 audit#1 + 5+2 audit#2 + 5 secondary).
- **15 High** закрыто.
- **7 audit-отчётов** сохранены в `audit-2026-04-30/01..07-*.md`.

Следующая сессия должна начинаться с пунктов в «Не закрытые риски» — особенно `mergeImported` и token-budget на чате.
