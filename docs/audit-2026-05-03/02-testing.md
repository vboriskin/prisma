# Audit 02 — Testing / QA / Visual / A11y / Cross-Browser

**Дата:** 2026-05-03
**Авторы:** 5 экспертов параллельно — QA Lead, Manual Tester, Visual/Theme Specialist, A11y Specialist (WCAG AA), Cross-browser/Compatibility Tester.

---

## TL;DR

| Severity | Кол-во |
|---|---|
| 🔴 Critical | 4 (corrupt localStorage crash, no auth pre-rollout, race conditions Pulse/BD double-START, CSV-injection в экспорте) |
| 🟠 High | 22 (focus-trap отсутствует во всех модалках, plural-bug везде, color-mix без fallback ломает Safari <16.4, dark-mode contrast fail, theme persistence отсутствует) |
| 🟡 Medium | 30+ |

**Top-5 must-fix перед расширением пилота:**
1. **`color-mix(in srgb, ...)` × 112 occurrences без `@supports` fallback** → ломает UI на Safari <16.4 и Chrome <111
2. **Focus-trap отсутствует во всех 6+ модалках** → Tab вылетает в фон, юзер теряется
3. **Russian plural broken** — «1 задач», «5 сотрудников» везде в dashboard/metrics/app
4. **Theme persistence отсутствует** — switch dark → reload → light
5. **Async race conditions** — double-START Pulse/BD без abort, switch-team race в Scanner 2.0

---

## A. End-to-end critical user flows

| # | Flow | Покрытие сейчас | Gap |
|---|---|---|---|
| 1 | Загрузка плана (boot) | unit | Нет e2e: cold-start, corrupt JSON crash, v2→v3 migration |
| 2 | Импорт CSV | unit roundtrip | Нет: BOM, CRLF/LF mix, `;` vs `,`, кавычки, дубликаты ID, Excel-даты, ru locale `1 234,56` |
| 3 | Импорт JSON | unit | Нет: чужой `version: 2`, partial employees без email |
| 4 | Импорт XLSX | — | **Полный gap** (multi-sheet, merged cells, числа as text) |
| 5 | Экспорт CSV/JSON/XLSX | unit на `_scrubSecrets` | Нет e2e что secrets фактически вырезаны на каждом из 3 path |
| 6 | Фильтрация Реестра | unit `FilterEngine` | Нет combo-сценариев, reset не очищает hidden chips |
| 7 | Drag-drop в Ганте | — | **Полный gap** (drop за viewport, на read-only релиз, snap, undo, dependencies) |
| 8 | Bulk-edit | — | Нет: select-all → filter change → редактируем «невидимые» строки |
| 9 | Scanner 2.0 switch-team→card | unit | Нет integration: switch race, карточка удалённого employee |
| 10 | AI-чат запуск | unit | Нет: timeout LLM, partial stream, отмена, 4xx fallback, RU кавычки в prompt |
| 11 | Black Dashboard async-job | unit | Нет: poll loop при 500/timeout, double-START, jobId collision |
| 12 | Resolve identities I1c | unit | Нет: bbLogin пуст → не получает BB-данные (контракт-критический), case collision |
| 13 | Switch theme dark/light | — | **Полный gap**: persistence через reload, во время modal, в Ganttsvg, prefers-color-scheme |
| 14 | Sigma-проверка | — | Нет: эпик без матча в Sigma, дубль Sigma-эпиков |
| 15 | Pulse + TechInfo + EmployeePerformance | unit each | Нет cross-integration consistency |

---

## B. Bugs to look for (топ-20)

1. **State desync** — `state.rows` мутирован напрямую без Proxy → Реестр видит, Гант нет
2. **Race**: Scanner2 enrichment fetch не отменяется при switch team — поздний ответ перезаписывает свежий
3. **Race**: Black Dashboard double-START без abort предыдущего AbortController
4. **Reactive infinite loop** при mass-mutation вне `Reactive.silent()` (массовый CSV-импорт)
5. **localStorage QuotaExceededError** — обработан только для settings, не для `STORAGE_KEY` (rows+employees)
6. **localStorage corruption** — `JSON.parse` без try/catch → крах boot
7. **Schema migration** v2→v3 — нет guard на старые данные у пилотных
8. **Russian plural**: «1 задача / 2 задачи / 5 задач» — нет `pluralize`-helper, hardcoded формы
9. **TZ skew**: `new Date(s)` без явной зоны → дедлайн «сегодня» на сервере = «завтра» у юзера
10. **Excel-date 1900 leap-bug** при импорте XLSX
11. **CSV injection**: ячейка с `=`, `+`, `-`, `@` без префикса — risk если `_scrubSecrets` забыл
12. **`_scrubSecrets` bypass**: новый export-path в `ganttHtmlExport.js` или `historyLog.js` мимо
13. **Identity case-sensitivity** — `Email@x.ru` ≠ `email@x.ru` в I1c lookup
14. **Empty/null defensive** — `row.scope` undefined → `.toLowerCase()` крах
15. **Browser compat** — `structuredClone`, `Array.prototype.at()`, optional chaining assignment
16. **Print/PDF** — `position: sticky` thead в Ганте ломает paginated PDF
17. **History log unbounded growth** → quota
18. **Drag-handle blur** — `mouseup` + `window.blur` → двойной snapshot в history
19. **Zero-row state** — деление на 0 в Дашборде → `NaN%`
20. **Sigma2.0 vs Sigma duplicates** — оба пишут в одно поле без приоритета

---

## C. Visual / verstka / dergania

### Layout shift / jitter
1. `body { overflow-x: hidden }` + 18 `position: fixed` без `scrollbar-gutter: stable` → topbar/sidebar/modals shift 6-8px при scroll
2. `transition: all` × 17 раз — animates `width/height/padding`, forcing reflow each hover
3. `.gdt-container { max-height: calc(100vh - 210px) }` — `100vh` на iOS Safari = with-URL-bar height; viewport jumps
4. `App.animateSection()` (`app.js:1656`) staggers 48 cards × `transform/opacity` на каждый render → first-paint flash
5. Gantt `applyScrolls()` runs **dvazhdy** (immediate + rAF) → возможный leap
6. ResizeObserver→rAF chains в Gantt → arrow re-draw loops on hover-induced layout
7. **Нет `contain:` rules** во всех 14k строках CSS — каждый list re-render invalidates global layout
8. `backdrop-filter: blur(12px)` на `#topbar` и modal overlay — repaints whole layer on scroll, jitter on Intel iGPU

### Theme transitions
9. **`.btn-outline { transition: ... background, color }` triggers per-button color tween** → при theme switch видна «волна» цветов across thousands of cells (Gantt) ~140ms — **самое заметное мерцание dark↔light**

### Tooltip / overflow
10. Tooltip clipping в Gantt (overflow:hidden контейнера прокрутки)
11. Длинные имена в карточке без `text-overflow: ellipsis` → ломают layout
12. Modal z-index: BulkEdit + AI-chat drawer конфликт → focus-trap ломается

---

## D. Dark / Light theme

### Dark mode contrast fails
- `--text-4: #64748b` на `--card: #121a2f` = **4.0:1** → fails AA для body text (4.5)
- `--accent-light: #202b4f` на `--card: #121a2f` = **1.6:1** → accent fill почти невидим
- Border `#1a2440` на `--card: #121a2f` = **1.15:1** → table row separators **invisible**
- Disabled buttons `opacity:.6` на `#121a2f` = ~1.3:1 → fails WCAG 3:1 UI
- `#cbd5e1` на dark surface ≈ 3.1:1 → AA fail
- `body.theme-dark .gantt-window-overtime { background: var(--bg, #0b1020) }` — same as wrapper bg ⇒ **«Overtime» column invisible**

### Light mode contrast issues
- `--text-3:#6b7280` на `--bg:#f0f2f7` = **4.45:1** — borderline
- Hover `--border-light` (`#f3f4f6`) на `--card:#fff` ≈ **1.05:1** → invisible
- Disabled inputs: фон `--border-light` color `--text-4` → impossible distinguish

### Theme persistence
- **Theme не сохраняется** (нет в `SETTINGS_KEYS`) → switch dark → reload → light
- 540 `body.theme-dark` overrides + 2 `[data-theme="dark"]` — **двойственная convention**, легко рассинхронить
- `box-shadow` colors `rgba(2,6,23,...)` почти невидимы на `#0b1020` — elevation hierarchy collapses
- ~140 hex literals в dark-overrides bypass token system — drift inevitable
- SVG в Ганте `stroke="black"` hardcode → невидимо на dark

### Responsive breakpoints
- 26 `@media` queries; 10 inconsistent breakpoints (1366, 1280, 1180, 1100, 1080, 980, 900, 860, 720, 680)
- 1280px (типичный ноут пилота): topbar buttons вылетают за edge
- 1024px: sidebar 200px съедает 30% screen; tables overflow horizontally
- 768px: нет real mobile layout

---

## E. A11y (WCAG 2.1 AA) — top issues

| # | Issue | WCAG | Severity |
|---|---|---|---|
| 1 | **Skip-to-content link отсутствует** | 2.4.1 | 🟠 High |
| 2 | **Focus-trap в 6 gantt-модалках отсутствует** | 2.1.2 | 🟠 High |
| 3 | `outline:none` без `:focus-visible` замены × 9 мест | 2.4.7 | 🟠 High |
| 4 | Focus-ring alpha 12% — контраст <3:1 | 1.4.11 | 🟠 High |
| 5 | `<label>` без `for=` × 8+ модалок | 1.3.1/3.3.2 | 🟠 High |
| 6 | Modal close `✕` без `aria-label="Закрыть"` | 4.1.2 | 🟠 High |
| 7 | `placeholder` как единственный label | 3.3.2 | 🟡 Med |
| 8 | `topbar-brand role=button` без Enter/Space handler | 2.1.1 | 🟡 Med |
| 9 | Нет `<main>` landmark | 1.3.1 | 🟡 Med |
| 10 | Multiselect: нет `role=listbox`/`aria-selected` + arrow keys | 4.1.2/2.1.1 | 🟡 Med |
| 11 | Sections-as-tabs без `role=tab*` + `aria-current` в nav | 4.1.2 | 🟡 Med |
| 12 | `*` required без `aria-required` | 3.3.2 | 🟢 Low |

**Status of compliance:** примерно **60% WCAG AA** (есть `lang="ru"`, `aria-live` на toast/log, но fail на focus-management, contrast, formn labels).

---

## F. Browser compatibility — Top-10 risks

| # | Issue | Where | Affected | Severity |
|---|---|---|---|---|
| 1 | **`color-mix(in srgb, …)` × 112 без fallback** | styles.css | Safari <16.4, Chrome <111 | 🔴 Critical |
| 2 | `:has(input:checked)` × 16 без fallback | styles.css | FF <121 | 🟠 High |
| 3 | `?.`/`??` без транспиляции | 200+ JS | IE11, Edge legacy | 🟠 High (если требуется) |
| 4 | ES Modules без bundler | index.html | IE11 | 🟠 High |
| 5 | CSS custom properties (`var(--accent)`) | весь CSS | IE11 | 🟠 High |
| 6 | `backdrop-filter` без `-webkit-` префикса | styles.css | старые Safari | 🟡 Med |
| 7 | `localStorage` без quota guard | dataStore.js | Safari iOS 5MB | 🟡 Med |
| 8 | `fetch` без `AbortController` | везде | UX issue | 🟡 Med |
| 9 | `accent-color` × 8 | styles.css | Safari <15.4 | 🟢 Low |
| 10 | `inset: 0` shorthand | styles.css | Safari <14.1 | 🟢 Low |

**Critical:** без `@supports (color: color-mix(...))` fallback **UI на Safari 16.0–16.3 и Chrome <111 ломается визуально** (background прозрачный).

---

## G. Top-15 visual/usability bugs (consolidated)

| # | Где | Что увидит юзер | Severity |
|---|---|---|---|
| 1 | `dataStore.js:120` `JSON.parse(raw)` | Crash на corrupt localStorage | 🔴 Critical |
| 2 | `portfolioPulseApi.js`, `blackDashboardApi.js` | Double-START race (поздний ответ overwrite) | 🔴 Critical |
| 3 | `dashboard.js:121,234`, `app.js:1087` | «1 задач», «5 сотрудников» plural везде | 🟠 High |
| 4 | Все модалки `index.html` | Tab вылетает в фон, нет focus-trap | 🟠 High |
| 5 | Все модалки | Body scroll не lockается | 🟠 High |
| 6 | LLM settings (`index.html:1056-1131`) | Полностью English UI «Temperature/Max tokens» | 🟠 High |
| 7 | CSV export | CSV injection если новый path забыл префикс | 🟠 High |
| 8 | XLSX import | Excel 1900-leap off-by-1 + ru locale | 🟠 High |
| 9 | Theme | Persistence отсутствует | 🟠 High |
| 10 | `utils.js:67` `new Date(s)` | TZ-implicit local interpret | 🟠 High |
| 11 | Identity I1c lookup | Case-sensitive email | 🟠 High |
| 12 | Scanner2 switch-team | Stale enrichment race | 🟠 High |
| 13 | Theme switch wave | Per-button color tween 140ms wave across Gantt | 🟠 High |
| 14 | Dark border `#1a2440` | Invisible (1.15:1) | 🟠 High |
| 15 | Disabled vs enabled в dark | Неотличимо (3:1 fail) | 🟡 Med |
| 16 | `🎉 📂 ⚠️ 🔒 ✏ 🔓 💾 👋` | Эмодзи нарушают Spine-pill | 🟡 Med |
| 17 | `app.js:127` showToast | Мерцание при 2× toast в 160ms | 🟡 Med |
| 18 | `bulk-assignee-input` без trim | «Иванов» vs «Иванов » → дубль | 🟠 High |
| 19 | `Utils.truncate` slice(0,30) | Surrogate-pair разорвёт эмодзи | 🟢 Low |
| 20 | `lock-time` без TZ | Разные часовые пояса = разный момент | 🟠 High |

---

## H. Идеи развития testing strategy

### Quick wins (1 спринт)
1. **Pluralize-helper** — `pluralize(n, ['задача', 'задачи', 'задач'])` через `Intl.PluralRules`; рефактор ~30 мест
2. **Focus-trap mini-lib** — `focusTrap(modal)` + `restoreFocus(trigger)` для всех 6+ модалок
3. **Skip-link** + `<main>` wrapper + `aria-label` на ✕
4. **`@supports (color-mix)` fallback** для critical surfaces
5. **Theme persistence** в localStorage + `prefers-color-scheme` initial

### Medium effort
6. **Playwright e2e** на 15 critical flows (replace `e2eTest.js` self-rolled). Headless Chromium + Firefox + WebKit
7. **Visual regression** через Playwright `toHaveScreenshot()` (vendored, без облака) — 30-40 baseline для Registry/Gantt/Dashboard в light+dark, 1280/1440/1920
8. **Property-based** через `fast-check` на: `_scrubSecrets`, CSV round-trip, identity-resolve idempotence, plural forms
9. **axe-core в CI** — `@axe-core/playwright`, fail PR при new violations
10. **Contract expansion + chaos** — fake-сервер с инъекцией latency/500/partial-JSON/timeout

### Long-term
11. **SR test matrix** (NVDA+FF / JAWS+Chrome / VoiceOver+Safari) на 3 ключевых сценариях
12. **Stylelint plugin** banning hex literals outside `:root` / `body.theme-dark`; force tokens
13. **Browser support matrix doc** + `browserslist` в `package.json` + `eslint-plugin-compat`
14. **Motion contract** — single `motion.css` (3 длительности + 2 easings) + `[data-motion=full|reduced|off]`
15. **Layout-stability budget** — `scrollbar-gutter: stable both-edges`, `contain: layout paint`, заменить `transition: all` явными списками, CLS budget <0.05

---

## I. Файлы high-priority

- `dataStore.js`, `errorsLog.js`, `reactiveStore.js` — boot/persist gaps
- `views/registry.js`, `views/gantt.js` — perf + DnD coverage
- `index.html` (1164 строки) — все модалки без focus-trap
- `styles.css` (520KB / 14k LOC) — color-mix, theme contrast, double convention
- `app.js` (1909 LOC) — orchestrator + animateSection + theme switch logic
- `tests/` — отсутствуют e2e/theme/import-XLSX/DnD purchases
- `components/multiselect.js`, `tagInput.js` — ARIA gaps
- `utils.js:67` — TZ
- `integrations/portfolioPulseApi.js`, `blackDashboardApi.js` — race conditions
- `views/dashboard.js`, `views/metrics.js`, `app.js` (× 30 мест) — plural-bug
