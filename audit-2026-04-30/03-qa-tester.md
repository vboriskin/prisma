# Audit #1 — QA Tester

Scope: Q2 Plan Analyzer V15. Pure user-flow correctness. 436 unit tests pass; this audit
finds what they DON'T cover and concrete edge-case defects in `views/gantt.js`,
`views/employees.js`, the V14 modal Promises in `app.js`, `dataStore.import()`,
`errorsLog.js`, plan-lock + edit-mode, Black Dashboard exclusion, Forest Hero Banner.

## Test coverage matrix

| Area | Existing tests | Missing | Priority |
|------|---------------|---------|----------|
| `errorsLog.js` | add shape, level counts, clear, listener fire/unsub, listener crash, persistence write, MAX cap | localStorage **load** path on init (round-trip persistence), id-counter restart after _load, quota-exceeded fallback (`_persist` 2-step retry), `_safeReplacer` truncation/circular/Error path, console.error wrapping idempotency (`_q2Wrapped`) | **HIGH** |
| `EmployeesView` | `_splitTags`, `_applyFilters`, `_applySort` (8 cases) | `parseImportedRows` (no `fio` row, mixed-case `ФИО` header, BOM, all-empty matrix), `mergeImported` (no add/no update branch, all-empty fio dedupe), `importCSV` empty/whitespace, `importXLSX` no XLSX lib, view-mode toggle persistence, expanded-cards state stability across renders, OT date range that produces zero results, empty employee list rendering branch | **HIGH** |
| Black Dashboard | `analyseBlackDashboard` model: null input, goal grouping, coverage rounding, donut buckets, readinessByGoal, expand/collapse | done-before-quarter rule with malformed Fix Version (no version, "1.20-RC", localised "Q2"), missing `resolutiondate`, `excluded` counter without per-rule key, fragmented `rule:done-before-quarter:<date>` grouping in renderer | MEDIUM |
| Gantt drag-drop | none | drop on same column (early return at `srcCol===dstCol`), drop **on a ghost pill**, locked-plan drop with cancelled comment dialog (Promise resolves null), edit-mode flipped mid-drag, drop while `state.rows` mutated by another tab, drop on cell of row deleted between dragstart and drop | **CRITICAL** |
| Gantt context menu | none | right-click on ghost (only "undo-move" item rendered), right-click during animation, double-open on a second pill while modal still resolving, ESC during open modal, right-click on pill whose `wt === 'задача'` (early return is silent) | HIGH |
| Modal Promise contracts (`requireMoveComment`, `openGanttCompleteModal`, `openGanttDatesModal`, `openGanttAssignModal`, `openGanttAddTargetModal`) | none | concurrent opens (the second call wires NEW listeners on the SAME DOM, the first Promise never resolves), ESC handling (none of the 5 modals listen for ESC), focus-trap (none implemented), date validation in `complete` (only checks empty), assign modal with **no `state.employees`** (renders empty list, no message) | **CRITICAL** |
| `dataStore.import()` | none | malformed CSV (1-line, no headers), BOM-only file, empty bundle JSON, malformed `EMPLOYEES_MARKER` JSON (silently dropped, no toast), missing markers (legacy file, employees stays in-memory — but rows are wiped: data-loss vector) | **CRITICAL** |
| Plan-lock | none | F5 mid-comment-modal (overlay survives in DOM as `.hidden`? actually `.hidden` is removed before render), edit-mode toggled mid-drag (Promise still resolves with comment, but state.ganttEditMode now true → comment recorded anyway since `requireMoveComment` checks at call-time only), `confirm()` cancel for unlock | HIGH |
| Forest Hero Banner | none | render with 0 rows, render with all flag-counts zero (calm-day branch), DOM IDs missing (`return` early), date locale fallback, multiple section navigations re-binding listeners (memory leak: `addEventListener` on each render, no cleanup) | MEDIUM |
| `rowFactoryV14` | covered | — | — |

---

## Critical bugs found (reproducible)

### [bug-C1] `app.js:1689-1721` `requireMoveComment` — concurrent opens corrupt the Promise

Repro:
1. Lock the plan, edit-mode OFF.
2. Drag pill A from 1.20→1.21 — modal opens, do NOT click anything.
3. With the modal still open, drag pill B from 1.21→1.22 (the wrap re-renders are scrollable; another pill is reachable). The same `#modal-gantt-move` overlay is reused: `summary.textContent`, `ta.value=''`, second set of listeners attached on top of first.
4. Click "OK".

Expected: each drop resolves its own Promise with its own comment.
Actual: `cleanup()` of the SECOND call removes only the listeners IT attached. The
FIRST call's `onOk/onCancel` listeners are never removed (separate closures), AND
both `resolve` callbacks fire on the same click — first Promise resolves with
the second drop's comment. Comment trail in `row.transferComments` for drop A
gets the wrong text. `row.transferComments[]` is silently corrupt.

Fix: guard with `if (overlay.dataset.busy) return Promise.resolve(null);` set/clear
around the await; or queue requests. Same pattern affects `openGanttCompleteModal`,
`openGanttDatesModal`, `openGanttAssignModal`, `openGanttAddTargetModal`.

### [bug-C2] `app.js` — none of the 5 V14 modals handle ESC or backdrop click

Repro: Open «Завершить задачу» modal via right-click → `done`. Press ESC.
Expected: modal closes, Promise resolves null.
Actual: nothing — the modal stays open. User must click "Отмена". Same for
`#modal-gantt-move`, `#modal-gantt-dates`, `#modal-gantt-assign`,
`#modal-gantt-add-target`. Only the Gantt fullscreen toggle listens for ESC
(`gantt.js:43`).

Fix: in each modal's promise body add `document.addEventListener('keydown', onKey)`
where `onKey` calls `onCancel()` on `ESC`; remove in `cleanup()`.

### [bug-C3] `dataStore.js:286` — single-line CSV silently wipes `state.rows`

Repro: import a CSV that has ONLY the header line (or `allRows.length === 1`).
The guard is `if (allRows.length<2) { alert('CSV пустой'); return; }` — OK.
But: import a CSV with header + a single all-empty cells line. `allRows.length === 2`,
`newRows = []`, then **`state.rows = newRows` (line 387)** — the user's existing
data is wiped without confirmation. The `HistoryManager.checkpoint('импорт CSV')`
on line 290 does run, so Ctrl+Z recovers, but the user gets no warning that
0 rows were imported.

Fix: `if (!newRows.length) { alert('Не найдено валидных строк. Импорт отменён.'); return; }`
BEFORE the `state.rows = newRows` assignment.

### [bug-C4] `gantt.js:457-487` per-cell drop fires AFTER user navigates away

Repro: in fullscreen Gantt, start dragging a pill. Without releasing, click
sidebar/another section header — the wrap re-renders, but the in-flight HTML5
drag continues. When mouseup lands on a stale `.gantt-cell` element still in
memory from a sibling view, `cell.addEventListener('drop', ...)` closure captures
the OLD `wrap` reference — `state.rows.find(...)` still works (state survived),
but `GanttView.renderChart()` paints on an inactive section. Net effect: the
user lands on dashboard with a successful state mutation they didn't visually
see; comment dialog fires on top of dashboard view.

Fix: in the drop handler, early-return if `state.activeSection !== 'gantt'`.

---

## High (likely-bug edge cases)

### [bug-H1] `gantt.js:466-487` drop on the SAME column is a no-op but still calls modal

`if (!rowId || !wt || srcCol === dstCol) return;` — fine. BUT this guard runs
BEFORE `await window.App?.requireMoveComment(...)` — wait, re-read: actually the
guard is line 467 (correct order). OK no bug here. **HOWEVER** the `cell.classList.remove('gantt-cell-dragover')` on line 462 fires correctly only on this drop;
if the cell was target-decorated by a *different* dragover from another pill that
finished outside, decoration sticks. Cosmetic.

### [bug-H2] `gantt.js:460-487` cancelled comment dialog logs nothing

When `requireMoveComment` returns `null` (cancel), control returns. No toast,
no checkpoint, no console hint. User has no feedback that the drop was rejected
— they'll think the page froze.

Fix: `showToast('Перенос отменён', 'info', 1500)` on null.

### [bug-H3] `gantt.js:482` — `try/catch` swallows error and falls through

```js
} catch (_) { /* fall through with no comment */ }
```

If `requireMoveComment` throws (e.g. DOM detached after F5), the move proceeds
WITHOUT a comment even though plan is locked. Defeats the V14 (B5) requirement.

Fix: on catch, abort the move (don't fall through).

### [bug-H4] `app.js:1804-1887` `openGanttAssignModal` with empty `state.employees`

Repro: open a fresh plan, assign-employee from Gantt right-click.
`candidates = []`, `renderList` shows "Никого не найдено" — fine. But the
`hintEl` says "Без фильтра по роли" with no hint to add employees. Cancel
returns null silently.

Fix: when `all.length === 0`, render a banner with link to `goTo('employees')`.

### [bug-H5] `employees.js:580` — `confirm()` after Storage normalisation already ran

`mergeImported` calls `EmployeeFactory.normalize(existing)` and mutates
`existing` IN PLACE before the user clicks OK on the confirm. If the user
cancels, normalised data persists (rolled back only because `Storage.save()`
hasn't fired — until any other action triggers it). This is fragile.

Fix: snapshot+restore, or run the confirm BEFORE the loop.

### [bug-H6] `errorsLog.js:51` — id counter restart on reload may overlap

`_idCounter = maxId` after load. `add()` does `++_idCounter`. OK normally.
BUT if another tab adds entries since the page loaded, `_persist()` overwrites
the cross-tab additions. (Storage event listener missing.) Multi-tab usage
loses error log entries silently.

### [bug-H7] `gantt.js:43` plan-lock state read at drop START is stale

`requireMoveComment` checks `state.planLocked` at call time. If the user
toggles edit-mode IN BETWEEN dragstart and drop, the comment requirement
follows the LATEST state, not the state when the drag began. This is
arguably intentional but can surprise users.

### [bug-H8] `dataStore.js:328-336` malformed `EMPLOYEES_MARKER` silently dropped

`console.warn('CSV employees parse failed:', e)` — but no toast. User imports
a CSV expecting employees to come back; they don't. ErrorsLog **does** capture
the warn (because `console.warn` is wrapped on line 129 of errorsLog.js), but
that's a cold trail. Add a `showToast('Раздел сотрудников повреждён, пропущен', 'warning')`.

### [bug-H9] `views/dashboard.js:42` — Hero banner re-binds click listeners on every render

`renderHero` is called from `DashboardView.render()` which fires on every
notify. Each call does `listEl.querySelectorAll('[data-hero-filter]').forEach(btn => btn.addEventListener('click', ...))`. Since innerHTML wipes the previous nodes,
the listeners die with them — OK no leak. BUT if the renderer is ever changed
to update text-only (not re-set innerHTML), this becomes a leak. Document the
contract or use event-delegation on `listEl`.

---

## Medium (defensive holes)

### [bug-M1] `gantt.js:625-890` context menu — right-click while previous menu still resolving

Two rapid right-clicks on different pills: `removeCtxMenu()` is called at the
top of the second handler, removing the first menu's DOM. Outside-click handler
`onOutside` from the first call is still attached (`document.addEventListener('click', onOutside, true)` with `setTimeout`). It will fire on the next document
click and try to call `menu.contains(ev.target)` on a detached node — returns
false, removes the (now non-existent) menu, and removes itself. Mostly harmless,
but creates a window where the second menu's outside handler races with the first.

### [bug-M2] `employees.js:540` overtimeDays parsing — invalid date strings preserved

`Utils.parseDateList(get(cells,'overtimeDays'))` — if the source has
"31.02.2026" or "garbage", it depends on `parseDateList` behaviour (untested
for malformed). Card view then runs `Date.parse(d)` and silently treats NaN
as "doesn't match" — filter `OT с/по` will exclude this employee even though
they have a chip showing a garbage date. Confusing.

### [bug-M3] `errorsLog.js:30-39` — `_persist` retry on quota loses half the log

When localStorage quota hits, `_entries` is sliced to `MAX_ENTRIES/2 = 250`
**in memory** — the user's currently-loaded log shrinks, and they have no
hint that this happened. No `console.warn`, no UI trail. Add a one-time
`showToast` when quota first triggers.

### [bug-M4] `views/gantt.js:1019` SVG arrow marker — `polygon` `points` formatting

`<polygon points="0 0, 6 3, 0 6"` — comma-separated pairs. Works in Chrome/Safari
but Firefox is strict; user reports of missing arrowheads on Firefox would map here.

### [bug-M5] `views/employees.js:194-198` Reset button does not collapse expanded cards

`EmployeesView._expanded` is not cleared. After "Сбросить" the user sees a
filter-cleared list with a few unexpectedly-expanded cards.

### [bug-M6] `gantt.js:736-757` `openGanttDatesModal` — only validates `start > end`, not invalid dates

User types "2026-13-99" in either field (browsers vary). `new Date(s)` is
`Invalid Date`, comparison `>` returns false, validation passes, garbage
ISO is saved into `row.workStartDate`.

### [bug-M7] `dataStore.js:340-373` bundle restore — empty `bundle.localStorage` shows no toast

If the imported bundle has `{ localStorage: {} }` (or only disallowed keys),
`restored = 0`, no toast. User assumes restore worked.

---

## Low (cosmetic / non-blocking)

- `gantt.js:80` `document.querySelectorAll('.gep-tooltip,.gtx-tooltip').forEach(...)` always runs even when no tooltip exists. Negligible cost; ignore.
- `gantt.js:858` `setTimeout(() => GanttView.renderChart(), 700)` after move-next animation: if user starts another action in those 700 ms, two renders run in sequence. Visible flicker.
- `employees.js:233` "Список сотрудников пуст" message has emoji 👥 which the codebase generally avoids per CLAUDE.md guideline. Cosmetic.
- `errorsLog.js:71` `String(details)` fallback after JSON-stringify failure can yield `[object Object]` — useless.
- `dashboard.js:51-53` Russian day/month arrays hardcoded; `toLocaleString` would be cleaner but locale-dependent — keep.
- `gantt.js:993` `console.warn('[gantt] drawPostponeArrows:', diag);` warning lands in ErrorsLog every time arrows fail — noisy.

---

## Recommended new tests (to add)

- `tests/unit/errorsLog.test.js` → load-path round-trip (persist via one instance, load via fresh import; assert `_idCounter > 0`, no collisions); quota fallback (mock `setItem` to throw `QuotaExceededError` on first call; assert log shrinks but `add()` returns valid entry); `console.error` wrap idempotency (`_q2Wrapped` flag prevents double wrap on hot reload). **Why**: these were intentional in V13 design but no test enforces them.
- `tests/unit/employeesImport.test.js` (new) → `parseImportedRows` with no FIO header → returns []; with mixed-case ФИО header (already covered by `normalizeHeader`) → still works; with all-empty matrix → returns []. `mergeImported` with imported = [] → alert path; with all imported FIOs already present → 0 add, N updates. **Why**: V14 employees CSV roundtrip is critical user flow.
- `tests/unit/ganttDropContract.test.js` (new, DOM-stubbed) → `moveWtBetweenCols(row, wt, src, dst)` puts `wt` once into dstField even when called twice (idempotence on existing entry); `revertMove` returns null on missing arrow; `ganttArrows` filter on `wt` matches case-sensitively. **Why**: catches the slice(0,4) class of bugs.
- `tests/unit/modalContracts.test.js` (new, DOM-stubbed) → each of the 5 modal Promises: `cleanup()` removes ALL its listeners; concurrent opens reject the second; ESC resolves null; cancel resolves null; OK with empty required field stays open. **Why**: 0 coverage on V14's most user-visible feature.
- `tests/unit/csvImport.test.js` (new) → header-only CSV → no row wipe; whitespace-only data lines → no row wipe; malformed `q2_employees` marker → state.employees untouched + warn; bundle with disallowed keys only → no restore + no false toast. **Why**: data-loss prevention.
- `tests/unit/dashboardHero.test.js` (new) → `renderHero(rows=[])` shows "Спокойный день", no items rendered, `artEl` shows the calm SVG; `renderHero` with non-zero counts renders the right number of `data-hero-filter` buttons; multiple successive calls do NOT accumulate listeners (use `replaceWith(node.cloneNode(true))` pattern or test via `addEventListener` spy). **Why**: V15 feature, 0 coverage.
- `tests/unit/blackDashboardExclusion.test.js` (new) → `analyseBlackDashboard` with goal carrying malformed `fixVersions` (empty / "TBD" / non-quarter), `excluded` counter passes through verbatim; renderer's group-by collapses `rule:done-before-quarter:<date>` to a single bucket. **Why**: V13 §13 rule, only the renderer test exists.
- `tests/unit/employeesViewMode.test.js` (new) → toggle `_viewMode` while `_filter` is non-default → filter survives; `_expanded` does NOT survive a `_filter` change that drops the employee from the list (otherwise dangling `_expanded[deletedId] = true`). **Why**: state cleanup on filter changes is implicit.

(Word count ~1480.)
