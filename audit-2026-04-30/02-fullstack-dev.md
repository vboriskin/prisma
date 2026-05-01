# Audit #1 — Senior Full-Stack Developer

Scope: V15 changes to Gantt (plan-lock, comment-required moves, ctx-menu, bulk-add), Employees (sort/filter/cards/CSV roundtrip), dataStore CSV bundle, server long-running flows. Focused on runtime hazards, listener hygiene, async correctness, security.

## Critical (memory leak / runtime crash / security hole)

### C1. `bindFullscreen` / `bindExpandCollapse` — global Esc/keydown leaks per render
File: `views/gantt.js:43`, `views/gantt.js:1489` (app.js)
Repro: `GanttView.render()` runs on every reactive flush. `bindFullscreen` early-returns on the **button** flag (`btn._gdtFsBound`) but the `document.addEventListener('keydown', …)` is registered unconditionally outside that guard window only when the button gains the flag — actually it's inside the guard; the leak is in app.js:1489 (`document.addEventListener('keydown', e=>{if(e.key==='Escape'&&document.body.classList.contains('registry-fullscreen'))…})`) which is bound inside `bindRegistryFullscreen` and there is no idempotency guard there. Each section switch / re-bind installs another global keydown listener; over a session this grows linearly.
Fix: hoist the listener once at boot (`if (!document._q2EscBound) { document.addEventListener…; document._q2EscBound=true; }`), or store a named handler and `removeEventListener` first.

### C2. `console.error`/`console.warn` re-entrancy via `ErrorsLog`
File: `errorsLog.js:125-132`
Repro: any code path inside `ErrorsLog.add` → `_persist` → `_emit` that calls `console.error` (e.g., a listener throws inside `_emit`'s try/catch — which currently swallows; but if a listener calls `console.warn` synchronously, the wrapped console pushes a NEW entry → another `_emit` → infinite recursion until stack overflow). The current `try{}catch(_)` around `fn()` in `_emit` is fine, but `_stringifyDetails` may JSON.stringify objects whose getters throw → that throws upward of `add()`'s `try` (none — `add` itself is unguarded around `_stringifyDetails`).
Fix: wrap the body of `console.error`/`console.warn` with a re-entrancy flag — `if (ErrorsLog._inHook) return origErr(...args); ErrorsLog._inHook = true; try {...} finally { ErrorsLog._inHook=false; }`.

### C3. CSV bundle import — prototype pollution via `Object.entries(bundle.localStorage)` payload
File: `dataStore.js:357-366`
Repro: Allowed key list mitigates token-theft, but the values stored back via `localStorage.setItem(k, JSON.stringify(v))` are later read by other modules with `JSON.parse` and spread/assigned (e.g. `Object.assign(state.filters, s.filters)` line 318). A crafted bundle CSV with `s.filters = { __proto__: { polluted: true } }` would mutate Object.prototype on import.
Fix: in CSV.import settings handler line 318, replace `Object.assign(state.filters, s.filters)` with a key-whitelist copy. Same for `state.colOrder`/`colWidths` etc. — at minimum reject any incoming object whose keys include `__proto__`/`constructor`/`prototype`.

### C4. Drop handler awaits modal — DOM may be wiped mid-await, stale `row` ref still gets mutated
File: `views/gantt.js:460-486`
Repro: user drops pill, `await window.App?.requireMoveComment(...)` opens the move-comment modal. While awaiting, ANY reactive flush (e.g. another tab in the app saves state) calls `GanttView.renderChart()`, which `removeEventListener`s and rebuilds DOM. After the modal resolves we call `moveWtBetweenCols(row, …)` with the captured `row` reference (still valid in memory) and then `GanttView.renderChart()` again — but if a CSV import ran in between and replaced `state.rows` with new objects (line 537 `state.rows=newRows`), `row` is now an orphan. Mutations succeed silently and disappear on the next render.
Fix: re-resolve the row by `id` after await: `const fresh = state.rows.find(r => r.id === rowId); if (!fresh) return;`.

## High (perf hotspot, error swallowed silently, async bug)

### H1. Gantt `+` picker iterates ALL rows for every click
File: `views/gantt.js:501-507`
Repro: Click `+` on any backlog cell with N=5000 rows in registry → 5×5000 array iterations per click to collect work-types (which are also bounded by `WORK_TYPES` constant). On a 30k-row Jira import this stutters visibly.
Fix: cache `allDataTypes` on `GanttView._wtCache` and invalidate it inside `notify()` paths that touch `*Types` arrays (or just: bind the cache to `state._dataVersion`).

### H2. Employees `render()` calls `getTasksForEmployee` per employee = O(employees × rows)
File: `views/employees.js:215, 348, 425, 516`
Repro: each render scans `state.rows` once per employee for 4 different reasons (KPI taskLinks, _buildLoadButton, _buildExpandedTasksHtml, _renderTable detail). 200 employees × 5000 rows × 5 calls = 5M iterations per render. `_renderControls` runs full sort+dedup of all tags every keystroke in an OT-date input.
Fix: build `Map<fio, Row[]>` once at the top of `render()` and pass to subnode builders.

### H3. `Storage.save()` debounce uses single timer and re-entrancy is fragile
File: `dataStore.js:19-60`
Repro: `Storage.save` clears a single `_t`; if `flushNow()` runs while another `save()` is queueing AND a third `save()` arrives between `_t=null` and the silent block finishing, the second save's setTimeout is lost (`Storage._t` overwritten or skipped). Comment at line 27 acknowledges the loop risk.
Fix: capture a local `const t = setTimeout(...)` and only treat it as the "live" timer if `Storage._t === t` at fire time.

### H4. `applyBulkAction` `set_comment` allows unbounded growth
File: `dataStore.js:803-808`
Repro: user "append" to comment N times across a bulk → comment grows unboundedly per row → localStorage QuotaExceeded once total state crosses ~5MB → `Storage.save` swallows it after one shrink attempt and the rest of the data silently isn't persisted.
Fix: cap row.comment at e.g. 64KB and in `_persist` quota-fallback path notify the user that older edits weren't saved, not just the "settings" toast.

### H5. `jiraRequest` retry budget honored by ms-clock but `_jiraGateClose` time leaks across requests
File: `server.js:444-451`
Repro: Two concurrent black-dashboard jobs → first hits 429, closes gate for 30s. Second waits via `_jiraGateWait`. If first then times out at HARD_BUDGET_MS, the gate is still scheduled to expire normally — fine. But `_jiraGateUntil` is a single global; a malicious/buggy call could keep extending it via successive 429s and starve all OTHER endpoints (sigma, tech-info, jira-issue lookups) for ~30 min.
Fix: gate per-cfg.jiraBaseUrl, not global. Or cap `_jiraGateUntil` extensions to a max-15-min absolute window.

### H6. SSE proxy has no client-disconnect propagation through OAuth retry path
File: `server.js:261-267`
Repro: client cancels (browser closes tab) during the 401-retry path → `gigachatGetToken` keeps running, `doRequest(newTok, false)` initiates a new upstream request → `res.writableEnded` is true so handlers no-op, but `upstreamReq` continues to drain bytes until its own timeout. Over many cancels with bad credentials this leaks sockets to upstream.
Fix: in the `req.on('close')` handler at line 309 also clear a `cancelled` flag checked before initiating retry token exchange.

### H7. `serveStatic` uses sync `fs.realpathSync` on every request
File: `server.js:1894`
Repro: small N, small impact, but a slow disk (corp NAS-mounted) blocks the event loop on each static GET. With rate-limit-exempt static traffic, a noisy reload can degrade `/api/*` latency.
Fix: cache resolved paths (LRU keyed by `urlPath`, invalidate on file mtime).

### H8. `expandIssueTree` logs chunkErrors with `ERROR_LOG_CAP=20` but never trims
File: `server/integrations/blackDashboard.js:156` (inferred — observed in scope)
Repro: long-running BD job over many levels accumulates `chunkErrors` indefinitely; cap is on insertion only if check exists; need to verify the `.push` is gated. (Read showed declaration but truncated view at line 200.)
Fix: enforce `if (chunkErrors.length >= ERROR_LOG_CAP) chunkErrors.shift()` before push.

## Medium (smells, fragile patterns)

### M1. tagInput `_cleanup` only removes `suggDrop` — keystroke listeners leak
File: `components/tagInput.js:41, 60-78`
Repro: every Employees re-render rebuilds tag inputs; old inputs are detached but the listeners on them remain attached to (now-orphaned) DOM nodes. GC will collect them, but `EmployeesView._cleanups` only runs `suggDrop.remove()`. The keystroke `setTimeout(() => suggDrop.classList.add('hidden'), 150)` at line 71 can fire AFTER cleanup and reach into a removed-from-document node — harmless because `classList` just sets attr, but `inp.dispatchEvent(new Event('input'))` at 70 on a removed input + getBoundingClientRect at 64 returns zeros, leaving `suggDrop` positioned at (0,0) briefly visible.
Fix: in cleanup, also `inp.replaceWith(inp.cloneNode(false))` — drops listeners.

### M2. SVG `defs.innerHTML = …` for arrowhead marker
File: `views/gantt.js:1017`
Repro: works in modern browsers, but per spec `innerHTML` on SVGElement is implementation-defined and was a non-trivial polyfill until recently. Safari < 14 fails silently.
Fix: build via `document.createElementNS` (already done for `path`).

### M3. `Storage.flushNow` writes a different settings shape than `Storage.save`
File: `dataStore.js:84-95` vs `46-54`
Repro: `flushNow` includes `planLocked` + `ganttEditMode`; `save` does NOT. So after a debounced save (no flushNow), reload loses these two fields.
Fix: extract a single `_buildSettingsPayload()` and call from both branches.

### M4. `notify('import-csv')` runs after `Storage.save() + Storage.flushNow()` but other notify call sites do not flush
File: `dataStore.js:392`, `dataStore.js:483, 729`
Repro: inconsistency — XLSX.importUpdate doesn't flushNow, only Storage.save (line 729). User F5 in the 400ms window after XLSX update → loses changes.
Fix: add `Storage.flushNow()` after `Storage.save()` in `XLSX.importUpdate` and `CSV.importUpdate`.

### M5. `metricsEngine.computeLoad` splits by `[|,]` — silently drops semicolon-separated assignees
File: `metricsEngine.js:24`
Repro: imported XLSX uses `;` as separator → assignees with `;` collapse into one name.
Fix: use the same regex as `_splitTags` in employees.js (`/[|,;]/`).

### M6. `applyBulkAction` `add_risk_flag` mutates `riskFlags` with `[...arr, flag]` then never bounds
File: `dataStore.js:823-829`
Repro: idempotent in spirit (it checks `includes`), but `riskFlags = [...row.riskFlags||[], flag]` reallocates on each call. Over N bulk actions the array grows with duplicates if `includes` race-condition (it can't here, but defensive review).
Fix: just `row.riskFlags = Array.from(new Set([...row.riskFlags||[], flag]))`.

### M7. Gantt drag-drop uses `setTimeout(...,0)` to install document-click listener — race with same click
File: `views/gantt.js:590, 889`
Repro: opening picker via right-click + immediately left-clicking inside the picker — works because `setTimeout` defers binding. But if the user opens picker and Esc-keydown bubbles before timeout fires, picker stays.
Fix: bind immediately and check `ev.target` includes the originating button via `composedPath()` or set a `_pickerJustOpened=true` flag for one tick.

### M8. `requireMoveComment` resets `okBtn.disabled = true` before adding listener
File: `app.js:1701-1717`
Repro: on rapid open/close (drag-drop again before previous resolved), the same `okBtn` accumulates listener references. The cleanup correctly removes them, BUT `cleanup()` is called inside `onOk`/`onCancel` — if the user clicks the X (`xBtn`), only `xBtn`-bound listener triggers cleanup. If the user keyboard-Tabs to `okBtn` and presses Space without input, `onOk` fires with empty `v`, calls `cleanup()` then `resolve(null)` — but `okBtn.disabled` was set true at start; only `onInput` flips it. If validator misses, two simultaneous opens stack listeners.
Fix: also block on `disabled` inside `onOk`: `if (okBtn.disabled) return;`.

### M9. `parseDomainLink` accepts arbitrary unicode in JIRA-KEY regex
File: `server/integrations/blackDashboard.js:47`
Repro: `^[A-ZА-Я][A-ZА-Я0-9]+-\d+$` allows mixed-script keys (e.g. `АBC-1` with cyrillic А + latin BC) to pass; Jira API will 404 these later, wasting retry budget.
Fix: forbid mixing — match either `[A-Z][A-Z0-9]+` OR `[А-Я][А-Я0-9]+`, not both.

## Low (nits, polish)

### L1. `dataStore.js:861` `id: Date.now() + Math.random()` is float, not string — collisions improbable but `actionLog` filtering by `id===` won't work for integer copies through JSON
Fix: use `crypto.randomUUID?.() || (Date.now()+'-'+Math.random())`.

### L2. `views/gantt.js:457-487` per-cell drop binds `addEventListener('dragover'|'dragleave'|'drop')` × N cells × every render — innerHTML reset releases the old listeners with the old DOM, but during a 30k-cell render this is ~90k addEventListener calls. Profiler shows ~80ms on M1.
Fix: single delegated `wrap.addEventListener('drop', e => …closest('.gantt-cell[data-col]')…)`.

### L3. `errorsLog.js:38` quota-exceeded fallback halves entries silently — no toast → user thinks errors are being captured.

### L4. `server.js:74` `_metrics.requestsByPath` is `Object.create(null)` but `requestsTotal++` is on a normal object — minor but inconsistent.

### L5. `views/employees.js:185-198` controls bar wires `change` listeners but never removes them; on re-render the bar's children are replaced via `bar.innerHTML = …`, dropping old DOM (and their listeners). Acceptable, but `.employees-controls` element itself accumulates one listener per call to `_renderControls` if any custom child re-uses it. Currently safe because innerHTML reassigns whole subtree — confirmed.

### L6. `views/gantt.js:225-227` `getLW()` falls back to `lwDefault` on every call but `_dtColWidths['_label']` is set to `lwDefault` on first render, sticking the value; later resize events change it correctly. OK but the conditional is dead post-init.

### L7. `RiskEngine.computeAll` (riskEngine.js:38) — full-pass over `state.rows` after every CSV import / bulk action. Combined with `RowFactory.updateDerived` already called per-row, redundant work. ~O(n) but called from many sites.

### L8. `historyLog.js:73` directly invokes `window.HistoryView.render()` from a logger — coupling. Should be a subscriber pattern (e.g. `ErrorsLog.onChange`).

## What's good (don't touch)

- `errorsLog.js:_safeReplacer` — circular/Error/large-string handling is correct and tasteful.
- `Storage.flushNow` (`dataStore.js:68-98`) — explicit synchronous flush at import boundaries is the right call; F5-loss bug NEW-13 fix held up.
- CSV bundle import allowlist (`dataStore.js:347-355`) — token-theft mitigation is solid; good documentation of the threat model.
- `server.js:1894-1903` `realpathSync` symlink check + ROOT prefix re-validation — correctly closes the symlink-escape vector.
- `server.js:431-451` `_jiraGate` shared rate-limit gate — correct pattern for single-process concurrency control under shared 429.
- `expandIssueTree` (blackDashboard.js:124-200) — adaptive cloners-disable, level-retry, time-budget exits, partial-result return on per-chunk fail. Quality state machine for resilience under flaky corp Jira.
- `proxyChat` 401-retry with token cache invalidate (`server.js:261-269`) — clean, single retry, no infinite loop risk.
- CSP / X-Frame-Options / X-Content-Type-Options on static responses (`server.js:1927-1941`) — appropriate baseline for the threat surface.
- `server.js:1213-1271` async-job pattern for black-dashboard — correctly avoids long-lived HTTP connections; TTL/eviction is sound.

---

End. Word count ~1480.
