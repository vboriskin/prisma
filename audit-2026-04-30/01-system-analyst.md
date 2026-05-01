# Audit #1 — System Analyst

V15 audit. Focus: V14 → V15 deltas — Editorial Bold redesign, employees card view + sort/filter, plan-lock, gantt edit-mode, comment-on-move, ctx-menu (assign/set-dates/complete), bulk-add flow.

## Critical (data corruption, silent failures, production blockers)

- [persistence] `dataStore.js:46-54` — `Storage.save()` writes SETTINGS_KEY **without** `planLocked` and `ganttEditMode`, but `Storage.flushNow()` (lines 93-94) and `Storage.loadSettings()` (lines 143-144) include them. Every lock/unlock/edit-mode toggle in `bindGanttPlanLock()` (app.js:1657, 1667, 1675) calls `Storage.save()`, which silently strips both keys. After F5, `state.planLocked` always reverts to `null` — the entire B3+B4 feature is non-persistent. Fix: add `planLocked: state.planLocked, ganttEditMode: state.ganttEditMode,` to the object literal in `Storage.save()` so it matches `flushNow()`.

- [data integrity] `views/employees.js:564-582` — `mergeImported()` mutates `state.employees` (assigns roles/teams/overtimeDays/weekdayReady/weekdayComment, pushes new entries, calls `EmployeeFactory.normalize`) **before** asking the user to confirm at line 580. If user clicks Cancel, the in-memory state is already corrupted; the next `Storage.save` writes it to disk. Fix: build a "diff" array first, apply mutations only after `confirm()` returns true.

- [crash] `views/employees.js:210-213` — `const badge=document.getElementById('employees-count-badge'); badge.textContent=…` with no null check. If the DOM scaffold isn't yet rendered (first render before tab switch), `badge` is null → TypeError → view fails to render. Fix: `if (badge) badge.textContent = …;`

- [duplicate writes] `views/gantt.js:548-580` — Bulk-add `+` flow can be re-invoked while the modal is open (button isn't disabled and modal allows re-clicks on the underlying pill). Each invocation appends to `row.transferComments` without deduping; the `inWells.has(t)` check in the picker only marks pills as "already added", it doesn't prevent re-selection. Repeated rapid clicks duplicate transferComment entries. Fix: disable the `+` button while modal is open (or guard `openGanttAddTargetModal` against re-entry by checking `overlay.classList.contains('hidden')`).

## High (real bugs, missing safeguards)

- [silent failure] `views/gantt.js:765` + `rowFactory.js:12-36` — `openGanttAssignModal` filters employees by `taskTags = String(row.tags || '')`. The field `row.tags` is **never declared** in `RowFactory.create()`. Only CSV/XLSX import populates it. For in-app-created rows `row.tags` is always undefined → `tagSet.size === 0` → role filter is bypassed → user always sees all employees. Fix: add `tags:''` to RowFactory defaults at rowFactory.js:21; consider `row.role` as fallback.

- [orphan field] `views/gantt.js:773` — `row.fio = result.fio` writes to a field absent from `RowFactory` schema. `row.assignee` (next line) is canonical. `fio` is dead data: no view reads it, no exporter knows about it. Fix: drop the `row.fio = result.fio` line.

- [HistoryManager coverage gap] `app/historyManager.js:43-52` — `_capture()` omits `planLocked`, `ganttEditMode`. After undo, lock toggles are not reverted (because `Object.assign(state, snapshot)` doesn't touch unmentioned keys). Decide: include them so undo reverts the lock, or document the carve-out. Fix: add `planLocked, ganttEditMode` to `_capture()`.

- [persistence semantics] `dataStore.js:475-484` — `CSV.importUpdate()` calls `Storage.save()` (400ms debounce) but NOT `Storage.flushNow()`. F5 within 400ms loses the import. `CSV.import` (line 392) and XLSX (line 541) do `flushNow()`. Fix: add `Storage.flushNow();` after line 482.

- [missing checkpoint] `app.js:1538-1543` — "Add employee" pushes a fresh employee + `Storage.save()` but never `HistoryManager.checkpoint()`. User cannot Ctrl+Z a misclick. Fix: prepend `HistoryManager.checkpoint('добавить сотрудника');`.

- [missing checkpoint] `views/employees.js:374-380` — Single-employee delete confirms then mutates without `HistoryManager.checkpoint`. The "удалить всех" path (app.js:1602) does it correctly. Fix: `window.HistoryManager?.checkpoint(\`удаление сотрудника: ${emp.fio}\`);` before `state.employees=…filter…`.

- [missing checkpoint] `views/gantt.js:807-816` — `undo-move` ctx action mutates `row.ganttArrows` without checkpoint; can't be undone. Fix: add `window.HistoryManager?.checkpoint('убрать след переноса')` at line 808.

- [modal race] `app.js:1689-1721, 1726-1759, 1764-1798, 1804-1887, 1892-1931` — All five new V14 modal helpers (`requireMoveComment`, `openGanttCompleteModal`, `openGanttDatesModal`, `openGanttAssignModal`, `openGanttAddTargetModal`) attach listeners to persistent DOM elements every time they open. If a second invocation happens while the first modal is still open, a duplicate pair of listeners fires on the SAME OK click → both pending Promises resolve with the same comment → wrong comment/date/employee lands on the first row. Fix at each helper: `if (!overlay.classList.contains('hidden')) return Promise.resolve(null);`.

## Medium (technical debt, future risk)

- [SSoT] `dataStore.js:209-221` — `_buildSettingsBundle()`'s `stateView` omits `planLocked`/`ganttEditMode`, so a CSV bundle export→import roundtrip silently drops the lock. Fix: add both keys to `stateView` and restore them in CSV.import's SETTINGS_MARKER handler (lines 296-322).

- [leaky state] `views/employees.js:23-33` — `_expanded`, `_sort`, `_filter`, `_viewMode` are module-level state, never persisted, never reset on data clear. Filter employees, F5, full list returns — surprising. Either persist via SETTINGS_KEY or document the carve-out.

- [type drift] `views/gantt.js:262, 313, 671-673` — `donePills[k]` was a boolean (`true`); V14 (B7) made it `{at, comment, ts}`. Renderer's `!!dp[…]` check works for both but any consumer that does `dp[k] === true` would silently break. No such caller today; add a regression test asserting both shapes round-trip through `_capture/_apply`.

- [checkpoint pollution] `dataStore.js:470, 473` — `CSV.importUpdate` calls `HistoryManager.checkpoint` BEFORE the `confirm()` dialog. Cancel still leaves a no-op entry on the undo stack. Fix: move checkpoint inside the `if (confirm(...))` branch.

- [legacy bundle target] `dataStore.js:347-355` — `ALLOWED_BUNDLE_KEYS` allows `q2_plan_v2`, `q2_plan` (legacy). Importing a bundle from an older app writes to a legacy key; `Storage.load()` prefers `q2_plan_v3` first (current STORAGE_KEY) → bundle import silently no-ops on the data portion. Fix: rewrite legacy keys into `STORAGE_KEY` on import, or refuse with a warning.

- [test coverage] `tests/unit/` lacks: `Storage.save/loadSettings` round-trip of `planLocked`/`ganttEditMode` (would have caught the critical persistence bug); `requireMoveComment` cancel flow; `EmployeesView._applyFilters` edge cases; `mergeImported` cancel-after-mutation flow.

## Low (nice-to-have)

- [readability] `views/gantt.js:478, 561, 622` — `COL_LABEL`/`NEXT_RELEASE` are referenced in handlers above their `const` declaration. Closure resolves at call-time so no TDZ — but a reader stumbles. Hoist to the top of `renderDetailedTasks`.

- [DRY] `dataStore.js:33-58, 72-97` — `Storage.save` and `Storage.flushNow` duplicate the entire localStorage write block. Extract `_writeAll()`.

- [robustness] `errorsLog.js:122-134` — `console._q2Wrapped` flag on the global console: if another script hot-reloads errorsLog, the flag prevents re-wrap but the OLD `origErr` reference may dangle. Move flag to module scope.

- [accidental coupling] `state.js:62` — `bulkSelected: new Set()` is in the reactive proxy but Sets aren't intercepted (reactiveStore.js:81). Currently works because nothing reads it reactively; documents at reactiveStore.js:20 — fragile.

## What's good (don't touch)

- `reactiveStore.js` — Clean Proxy with re-entrant `silent()` and a real `_dirty` flag. Better than most ad-hoc reactivity layers.

- `dataStore.js:347-372` — Bundle import token allow-list (V12). Refuses to overwrite `q2_integrations_v1`, `q2_llm_settings_v1`. Critical security gate.

- `dataStore.js:24-30` — The "MUST run inside Reactive.silent" doc block is a model for documenting reactive-loop hazards.

- `app/historyManager.js:84-97` — Wrapping `_apply` in `Reactive.silent` + one explicit refresh at the end is the right pattern.

- `rowFactory.js:29-34` — V14 schema additions (transferComments / workStartDate / workEndDate / actualDoneDate / doneComment / assignedAt) have stable defaults, no shared-reference leaks (verified by `tests/unit/rowFactoryV14.test.js`).

- `views/gantt.js:91-98, 379-403` — Multi-axis scroll preservation across `renderChart()` re-runs (window vs `gantt-wrap` vs `.gantt-container`). The 2-arg `window.scrollTo(x,y)` workaround for CSS `scroll-behavior:smooth` is the kind of detail that pays off.

- `errorsLog.js` — Centralized log with retention, listener-emit, safe-replacer for circulars, idempotent console wrap.

- `views/employees.js:250-345` — Sub-builder pattern (`_buildFioInput`, `_buildRolesInput`, etc.) shared between table and card views. Single source of behavior for both layouts.
