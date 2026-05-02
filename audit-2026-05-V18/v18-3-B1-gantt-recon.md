# V18.3 B1 — Gantt.js Reconnaissance + Split Proposal

**Дата:** 2026-05-02
**Файл:** `views/gantt.js`
**Размер:** 2637 LOC, 1 export (`GanttView`), 22 method'а
**Задача:** распределить на 4 файла с минимальным риском regression

## Карта текущей структуры

| Строки | Что | LOC |
|---|---|---|
| 1-48 | Imports, helpers `pl()` / plural-forms / `formatLongRange()` | 48 |
| 49-72 | GanttView declaration + state (`gf`, `_cancelTransientInteractions`) | 24 |
| 58-72 | `render()` | 15 |
| 73-167 | `bindKeyboardNav()` — roving tabindex, Enter/F2/Esc | 95 |
| 168-197 | `applyMode()`, `bindMode()` | 30 |
| 198-225 | `_withScrollAnchor()` | 28 |
| 226-255 | `applyDensity()`, `bindDensity()` | 30 |
| 256-404 | `bindJumpPalette()`, `openJumpPalette()` — quick-jump UI | 149 |
| 405-493 | `renderPillLegend()` | 89 |
| 494-552 | `_openHistoryModal()` | 59 |
| 553-662 | `_openAddEpicModal()` | 110 |
| 663-679 | `bindFullscreen()` | 17 |
| 680-696 | `bindExpandCollapse()` | 17 |
| 697-700 | `renderFilters()` | 4 |
| 701-709 | `getRows()` | 9 |
| 710-763 | `renderChart()` | 54 |
| **764-2455** | **`renderDetailedTasks(rows, wrap, cols)` — MASSIVE** | **1692** |
| 2456-2505 | `bindFastTooltip()` | 50 |
| 2506-end | `drawPostponeArrows()` | 132 |

**Главный балласт — `renderDetailedTasks` (1692 LOC, 64% файла).** Внутри неё:

| Sub-region (line-range) | Что | LOC |
|---|---|---|
| 765-855 | Setup helpers (esc, toTags, wtEmoji, _shortPeriod, _assigneeLabel, _initialsLabel, fmtMoveDate) | 90 |
| 856-1655 | Cell rendering (chart-grid build, pills, postpone-arrows) | 800 |
| 1656-1885 | Pill-level DnD + per-cell DnD listeners | 230 |
| 1886-2345 | Context-menu (700+ LOC: `removeCtxMenu`, `wrap.addEventListener('contextmenu')`, menu construction) | 460 |
| 2346-2455 | Wrap-level DnD final wiring (dragstart/dragend/dragover) | 110 |

## Закрытые сложности

1. **Closures over shared state** — внутри `renderDetailedTasks` есть много `const`-биндингов (`cols`, `rows`, `wrap`, `getLW`, `getW`, `moveWtBetweenCols`, `revertMove`, `removeCtxMenu`, `_dragData`). Splitting в отдельные модули требует либо:
   - Extract как pure functions с параметрами (~50% существующего кода)
   - Pass closure-captured context через explicit object → bigger refactor

2. **Audit-метки в коде** ссылаются на `V17 / V17.1 / V17.2` фразы — split не должен их потерять, иначе теряется trace для будущих audit'ов.

3. **Test coverage** — `views/gantt.js` имеет **0 unit-тестов** (только e2e в `e2eTest.js`). Регрессия после split'а ловится только через manual smoke. Один из вариантов — снижать риск.

## Spec: 4-файла split (proposed)

```
views/gantt.js              — orchestrator (~900 LOC)
views/gantt/render.js       — renderDetailedTasks helpers + cell rendering (~900 LOC)
views/gantt/dnd.js          — DnD handlers (~340 LOC)
views/gantt/ctxMenu.js      — context-menu logic (~460 LOC)
```

**Содержимое:**

### `views/gantt.js` (orchestrator) — 870 LOC
Остаётся:
- imports + helpers (1-48)
- GanttView state (49-72)
- render(), bindKeyboardNav(), applyMode/bindMode, _withScrollAnchor,
  applyDensity/bindDensity (~258 LOC, lines 58-255)
- bindJumpPalette/openJumpPalette (~149)
- renderPillLegend (~89)
- _openHistoryModal, _openAddEpicModal (~169)
- bindFullscreen, bindExpandCollapse, renderFilters, getRows, renderChart (~101)
- bindFastTooltip + drawPostponeArrows (~182, since они малые и self-contained)
- `renderDetailedTasks` — становится thin wrapper, делегирующий в render.js + dnd.js + ctxMenu.js.

### `views/gantt/render.js` — ~900 LOC
- Helpers (esc, toTags, wtEmoji, _shortPeriod, _assigneeLabel, fmtMoveDate, moveWtBetweenCols, revertMove)
- Cell rendering (build cols, pills, postpone arrows in cells)
- Public exports: `renderDetailedTasksHTML(rows, wrap, cols, ctx)` — pure HTML builder.

### `views/gantt/dnd.js` — ~340 LOC
- Pill-level dragstart/dragend listeners (1660-1670)
- Per-cell dragover/dragleave/drop (1674-1685)
- Wrap-level dragstart/dragend/dragover (2346-2455)
- Public exports: `bindGanttDnd(wrap, ctx)` — accept context (cols, getLW, moveWtBetweenCols).

### `views/gantt/ctxMenu.js` — ~460 LOC
- `removeCtxMenu()`, `wrap.contextmenu` listener (1886-2345)
- Menu construction + action handlers
- Public exports: `bindGanttCtxMenu(wrap, ctx)` — accepts ctx for actions.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Closures break после extract** | High | Pass explicit `ctx` object (cols, rows, wrap, getLW, etc.). Каждый module получает только нужный subset. |
| **Audit-метки потерять** | Medium | Grep на `V17` / `V17.1` / `V17.2` до split'а — сохранить mapping. Каждая метка остаётся в логически правильном файле. |
| **Visual regression в gantt** | Medium | Manual smoke 5-минутный pass: открыть все 3 modes (день/неделя/месяц), drag pill между cells, ctx-menu actions, fullscreen, jump-palette. |
| **DnD state shared между pill+cell+wrap слоями** | High | `_dragData` — это closure variable. После split нужен либо module-level state, либо передавать через `ctx` объект. Module-level safer (single global within module). |
| **Кириллица + escapeHtml в helpers** | Low | Tested already. Move без modification. |
| **`renderDetailedTasks` parameter `cols` modified inside** | Medium | Audit для side-effects на `cols`. Если есть — refactor сложнее. |

## Effort estimate

**Для full 4-file split:** ~10-14ч (S2-style, careful work):
1. Extract helpers + cell rendering → render.js (~3-4ч).
2. Extract DnD layer → dnd.js (~2-3ч). Включает unit-test coverage добавить как safety net.
3. Extract ctxMenu → ctxMenu.js (~2-3ч).
4. Refactor `renderDetailedTasks` в gantt.js на thin wrapper → 1ч.
5. Manual smoke + audit-метка update + commit ~1-2ч.

**Альтернатива — partial split (recommended for V18.3 если хочется finish today):** ~3-4ч:
- Extract `_openHistoryModal` (60 LOC), `_openAddEpicModal` (110 LOC), `bindFastTooltip` (50 LOC), `drawPostponeArrows` (132 LOC) → новый `views/gantt/modals.js` + `views/gantt/visual.js` (~350 LOC moved).
- Не трогать `renderDetailedTasks` — самое страшное место.
- gantt.js становится ~2280 LOC (sigh, всё ещё большой), но split случился, дальше можно делать частями.

## Рекомендация

**Defer полный 4-file split в V19** через отдельную итерацию с:
- Pre-split unit test coverage расширение (~5-10 unit-тестов для render.js / dnd.js / ctxMenu.js)
- D4 visual regression infrastructure (Percy / CSS snapshots) сначала
- Outsourced effort 1-2 дня concentrated work

**Сейчас в V18.3** — partial split (Option B):
- Move 4 self-contained method'а в `views/gantt/aux.js`:
  - `_openHistoryModal` (~60 LOC)
  - `_openAddEpicModal` (~110 LOC)
  - `bindFastTooltip` (~50 LOC)
  - `drawPostponeArrows` (~132 LOC)
- Result: gantt.js 2637 → 2285 LOC. Useful preliminary; renderDetailedTasks как-был.
- Effort ~2-3ч + 5-минутный smoke.
- Risk: low (методы self-contained, 0 closure dependencies в renderDetailedTasks).

---

## Что мне нужно от тебя

Три варианта продолжения — твой выбор:

| Опция | Что делаю | Effort | Risk |
|---|---|---|---|
| **A: Полный 4-file split в V18.3** | render.js + dnd.js + ctxMenu.js + slim gantt.js | 10-14ч | Medium-High (DnD state, closures) |
| **B: Partial split (рекомендую)** | aux.js с 4 self-contained method'ами | 2-3ч | Low |
| **C: Defer полностью в V19** | Этот audit — финал. Gantt.js остаётся 2637 LOC. | 0ч | None |

Я рекомендую **B**: получаем cleanup без риска, полный split — отдельной итерацией в V19 с D4 visual regression infrastructure.
