# Пункт 11 — Аудит «Фильтры» (полный)

**Команда:** 5 экспертов в фоне:
1. Senior full-stack dev
2. Senior QA tester
3. Senior system analyst
4. Art director
5. Senior product designer (interaction)

**Базис:** 516/11/0.

## I. Консенсус (нашли ≥3 эксперта независимо)

### CONS-1: **`FilterEngine.invalidate()` не вызывается на row-mutations** (BLOCKER)
- *(full-stack F-1, sys-analyst §2)*
- `_buildCacheKey` хэширует `state._dataVersion + 11 filter fields`. `_dataVersion` бампается ТОЛЬКО в `forceSave()` / CSV import. Inline-edit / Gantt-drag / RiskEngine recompute мутируют `state.rows[i].*` через reactive proxy не трогая `_dataVersion`. Результат: `getFiltered()` возвращает stale array. `FilterEngine.invalidate()` экспортируется но никогда не вызывается извне.

### CONS-2: **applyPreset clobbers user state silently** (BLOCKER UX)
- *(QA B3, sys-analyst §4, designer §4)*
- Repro: user picks role=BE → clicks preset «Критичное» → state has BOTH `onlyRisky=true` AND `role='BE'`. Preset claim не соответствует реальности — пользователь видит "Critical AND BE" и не понимает почему так мало строк.

### CONS-3: **Listener accumulation в FiltersUI.init()** (BLOCKER)
- *(full-stack F-5, sys-analyst §2)*
- Никаких `_bound` guards / clone-replace / AbortController. 11 listeners добавляются на каждый `init()` call. Сейчас init вызывается один раз, но любой re-init (test setup, hot-reload, import-после-restore) удвоит handler стек.

### CONS-4: **Search dual-handler race: `change` + `input` debounce** (BLOCKER)
- *(full-stack F-4, QA B1)*
- `bind('filter-search','search')` навешивает `change`-listener (записывает raw `e.target.value`). Параллельно `input`-listener debouncer 140ms пишет trimmed value. На blur/Enter `change` записывает синхронно untrimmed → 140ms спустя debounce пишет trimmed. State diverges from UI.

### CONS-5: **Tag splitter inconsistency (`|` vs `[|,]`)** (Critical bug)
- *(QA B4, sys-analyst косвенно)*
- `FilterEngine.getFiltered` line 73 split по `|` only. `tagInput.js` `getUniqueTagValues` split по `[|,]`. Row imported с тегами «BE, FE» — 2 chips в dropdown (BE, FE), но `getFiltered` сравнивает с literal «BE, FE» (single value) → filter never matches.

### CONS-6: **Multiselect не tab-reachable / нет Esc / без a11y** (BLOCKER a11y)
- *(QA A1, designer §4, art-director §3)*
- `display` это `<div>` без `role`/`tabindex`. Tab перепрыгивает мимо. Нет `aria-haspopup`/`aria-expanded`. Esc не закрывает (только outside-click).

### CONS-7: **Toggle chip visual class out of sync с checkbox** (annoyance)
- *(QA A2, designer §3)*
- При прямом клике на chip checkbox внутри toggle'нулся, но `.active` class на chip не toggle'нулся. Класс ставится ТОЛЬКО в `applyPreset`/`syncUI`/`reset`. Visual lies to user между preset-нажатиями.

### CONS-8: **Active filter chip strip отсутствует** (annoyance)
- *(designer §3, art-director §3, QA косвенно)*
- Topbar-badge показывает только число активных filter dimensions. Пользователь не видит КАКИЕ фильтры активны без открытия drawer'а. Стандарт Linear / GitHub: chip-strip с × per chip.

### CONS-9: **Emoji 🔴 ✅ ✕ ▾ в presets / global-filters-bar** (annoyance)
- *(art-director §3, designer §3, sys-analyst косвенно)*
- На фоне V15 SVG-only standard эмодзи в preset-кнопках выглядят как наследие.

### CONS-10: **state.filters не персистится через reload** (annoyance)
- *(sys-analyst §3, designer §4)*
- `_buildSettingsPayload` (dataStore.js:27-51) не включает `state.filters`. После F5 все фильтры reset. Filters попадают только в bundle-export / bundle-import.

## II. Уникальные находки (важные)

### Full-stack
- **F-2** `populateDropdowns()` allocates 3 fresh Multiselect widgets per refresh (потенциальная утечка listeners если widget не cleanup-ится)
- **F-3** Tag-фильтр имеет UI ТОЛЬКО в `preset-tags-wrap` Multiselect, но `reset()` пишет `state.filters.tag=''` без re-render Multiselect — chips остаются visually selected
- **F-4** Stale closure в Multiselect: `currentValues` array captured at build time; subsequent state mutations не propagate

### QA
- **B1** Search trim asymmetry между change vs input handlers
- **B5** workType filter ignores release intersection (testing в 1.21 проходит фильтр release=1.20 + workType=Тестирование)
- **E1** Search `.join(' ')` cross-field-boundary substring match — false positives
- **E3** `getRoles()` split по `|` only, но `getFiltered` для role split по `[|,]` — asymmetric listing vs matching
- **E4** `_buildCacheKey` collision via `~` separator (theoretical)

### System analyst
- **§1** Bypasses: `views/employees.js:44/52` re-implements filter intersection over employees
- **§3** Storage.save fires на каждом search keystroke хотя `state.filters` не персистится — pure overhead
- **§5** Composability: добавление фильтра требует изменений в 5 местах (state default, cache key, predicate, active count, reset shape) + HTML/JS bindings

### Art director
- **§1** `#global-filters-bar` полупрозрачный `rgba(240,242,247,.98)` + heavy double box-shadow — float-popover не flat-surface
- **§1** `.toggle-chip:has(input:checked)` filled accent-light fill — нарушает Spine-pill (нужна 3px stripe + neutral surface)
- **§2** Letter-spacing разный у `.filter-label` (.5px) / `.presets-label` (.5px) / `.preset-source-title` (.4px) — inconsistent
- **§3** Нет `font-variant-numeric: tabular-nums` на `.filter-input/.filter-select` (release "1.20"/"1.21" дрожат)
- **§3** `.btn-reset-filters` dashed border — out of system
- **§4** Spacing 8/6/5/3/2px mixed — off the 4/8/12/16 grid
- **§4** Hard-coded `#fff`, `#fafbfd` в `.tag-input-wrap`, `.preset-source-group` — bypass design tokens

### Designer
- **§3** Нет per-chip remove (× kebab)
- **§3** Multiselect: нет Shift-range, нет Cmd-toggle, нет Select-all, нет search-within-options
- **§5** Нет distinct empty-after-filter state — рендерится тот же no-data
- **§5** Topbar shows только total `state.rows.length`, не «showing X of N»
- **§5** Mobile: нет media-query <640px, drawer scroll-spaghetti

## III. Применённые фиксы (top-9)

| # | Фикс | Файл | Severity |
|---|---|---|---|
| **F1** | `FilterEngine.invalidate()` вызывается в reactive subscriber на каждом flush — drop stale cache | `app.js` Reactive.subscribe | **Critical (data correctness)** |
| **F2** | Idempotent guard `FiltersUI._bound` + защита от double-init | `app.js` FiltersUI.init | High (leak prevention) |
| **F3** | Drop dual-handler search race: убрать `change`-bind для filter-search; debounced `input` теперь sole writer; добавлен equality check `state.filters.search === next` для skip noop write | `app.js` FiltersUI.init | High (state correctness) |
| **F4** | applyPreset теперь CLEARS все 11 dimensions ПЕРЕД применением preset (search/team/workType/role/assignee/tag/scope/release + 3 toggles); preset = clean view, не overlay | `app.js` FiltersUI.applyPreset | **Critical (UX correctness)** |
| **F5** | Tag splitter: `String(row.tags).split('|')` → `String(row.tags).split(/[|,]/)` для consistency с `getUniqueTagValues` в tagInput.js | `filters.js` getFiltered | High (filter correctness) |
| **F6** | Multiselect a11y: `role=button` + `tabindex=0` + `aria-haspopup=listbox` + `aria-expanded` sync на trigger; `role=listbox` + `aria-multiselectable=true` на dropdown; Enter/Space toggles; Esc closes (per-instance + global Esc handler с idempotent guard `_q2MsEscBound`) | `components/multiselect.js` | **Critical (a11y blocker)** |
| **F7** | Toggle-chip ↔ checkbox sync: `change`-listener на каждом `filter-{blocking,risky,done}` mirror `cb.checked` → `tg.classList` | `app.js` FiltersUI.init | Medium (visual lies) |
| **F8** | Manual filter mutation drops `state.filters.preset` highlight (preset claim no longer matches reality) | `app.js` FiltersUI.init bind() | Medium (visual lies) |
| **F9** | Preset emoji 🔴 ✅ ✕ → text labels («Критичное» / «Сделанные» / «Сбросить»); `aria-label` на reset; comment объясняет что active state выражается через `.active` class | `index.html` presets-row | cosmetic (Spine consistency) |

## IV. Тесты

516 unit / 11 contract / 0 fail. Регрессий нет.

## V. TODO для отдельных итераций

| # | Severity | Откуда | Effort |
|---|---|---|---|
| TODO-P11-N1 | High | designer §3 + CONS-8 — active-filter chip strip с × per chip (chips.js component) | M |
| TODO-P11-N2 | High | designer §5 — «showing X of N» в topbar когда `getActiveCount() > 0` | S |
| TODO-P11-N3 | High | designer §3 — Multiselect: search-within-options (для длинных списков employees) | M |
| TODO-P11-N4 | High | sys-analyst §3 + CONS-10 — `state.filters` в `_buildSettingsPayload` (persist + skip Storage.save при search-only mutation) | M |
| TODO-P11-N5 | Medium | art-director §1 — `#global-filters-bar` flat surface + 1px bottom border (drop translucent + double-shadow) | S |
| TODO-P11-N6 | Medium | art-director §1 — `.toggle-chip:has(input:checked)` / `.preset-btn.active` → 3px accent stripe + neutral surface | S |
| TODO-P11-N7 | Medium | designer §5 — distinct empty-after-filter state с CTA «Сбросить фильтры» | S |
| TODO-P11-N8 | Medium | QA B5 — workType filter intersect с release scope | M |
| TODO-P11-N9 | Medium | full-stack F-3 — `reset()` re-renders Multiselect widgets (call populateDropdowns() unconditionally) | S |
| TODO-P11-N10 | Medium | designer §3 — Multiselect Shift-range + Cmd-toggle + Select-all | M |
| TODO-P11-N11 | Medium | sys-analyst §5 — declarative filter registry (composability) | L |
| TODO-P11-N12 | Low | art-director §2 — letter-spacing унификация .6px на CAPS labels | S |
| TODO-P11-N13 | Low | art-director §3 — `font-variant-numeric: tabular-nums` на filter-input/select | S |
| TODO-P11-N14 | Low | art-director §3 — `.btn-reset-filters` dashed → ghost text-button | S |
| TODO-P11-N15 | Low | art-director §4 — spacing унификация на 4/8 grid | M |
| TODO-P11-N16 | Low | designer §5 — mobile media-query <640px (bottom-sheet pattern) | M |
| TODO-P11-N17 | Low | QA E1 — search field-separator (избежать cross-boundary false matches) | S |
| TODO-P11-N18 | Low | QA E3 — `getRoles()` split по `[|,]` для symmetry | S |

## VI. Резюме

Применил **9 фиксов** из top-priority (3 critical: cache invalidation / preset overlay-clobber / multiselect a11y, 6 высокоprior visual + state correctness). Регрессий нет.

Главное что НЕ сделал в этой итерации:
- Active-filter chip strip (новый component, требует дизайн-проход)
- «X of N» counter в topbar (требует FilterEngine.getFiltered() в hot path topbar update)
- Multiselect search-within-options (расширение компонента)
- state.filters persistence (требует skip-save policy для search-keystroke)
- Spine-pill глобально для filter-bar (требует синхронизации с design-tokens)

18 TODO с severity + effort для следующих спринтов.
