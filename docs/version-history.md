# Version History (V11 → V22+)

Карта эпох проекта. Если в коде встречаешь ярлык типа `V14 (B2)` или
`V17.2 I1c` — здесь расшифровка.

## Зачем эта карта

Audit-папки (`audit-2026-*`) удалены (см. commit `afeb858` — все находки давно
реализованы и legacy-метки в коде самодостаточны). Эта таблица —
индекс «что в каком V-релизе появилось/умерло».

Для детального диффа конкретной V-эпохи: `git log --grep="V17.2 I1c"`.

## V-эпохи

| Эпоха | Дата | Главное |
|---|---|---|
| **V11** | до 2026-04 | SQLite-WASM as opt-in storage, cross-tab `storage` event listener |
| **V12** | 2026-04-29 | Black Dashboard, Tech Info modal, dev-status BB Phase 1, Confluence cascade Phase 2, Zephyr field auto-discovery, security headers (CSP/X-Frame), bundle-CSV import allowlist |
| **V13** | (отменена) | План был, но не вмерж'ен — отвергнутые идеи легли в V14 |
| **V14** | 2026-04-30 | Plan-lock + edit-mode (B3+B4+B5), GanttV2 retired (B2), employees inline employees-as-JSON (A3), card-view (A1), gantt2* settings retired |
| **V15** | 2026-04-30 | **Spine-pill design language**: flat surfaces, 3px stripe-left, mono-tabular numerals, no emoji в production UI, no gradients |
| **V16** | стык V15-V17 | 5 макро-улучшений Ганта (team-rail, sparkline, today-pill, flow-badges, jump palette) |
| **V17** | 2026-04-30 → 2026-05-01 | Overnight roadmap (12 пунктов): tech audit, chat redesign, Performance tab, Portfolio Pulse + Black Dashboard refactor, аудит 6 dashboard-вкладок / Реестра / Шапки / Фильтров / Тура |
| **V17.1** | 2026-05-01 | Patch pack: 12 групп правок (chat A1-A5, registry stretch, gantt 12 fixes, html-export, employees, settings) |
| **V17.2** | 2026-05-01 | **Identity-deterministic integrations** (I1+I2+I3+I4+I5) + **Confluence I2c** (space-scope, per-employee CQL, comments+mentions, audit log) |
| **V18** Block A+B | 2026-05-01 | **Process foundation + integration consistency** — 8/15 пунктов: P1 git init, P2 contract-tests → node:test, P3 CONTRIBUTING.md, P4 CI gate, P5 _cfPathCascade helper, P6 token-handling consolidation, P7 Pulse async-job pattern, P8 BB bucket separation |
| **V18.1** Block C partial | 2026-05-01 | **Decomposition partial** — P9 app.js −704 LOC (uiToggles+bulkEditPanel+appSettings), P10 server.js −108 LOC (jobs cluster factory + authHelpers) |
| **V19** | 2026-05-08 | NDJSON structured logger в `server/logger.js` (E4); Pulse facade `pulse/index.js` (D3); Scanner2 persistent retention (C2); telemetry events (C4) |
| **V20** | 2026-05-10 | Scanner 2.0 production: hero metrics (CR / PR-throughput / MTTR / Gini), CR-queue depth, blocker dwell tracking |
| **V21** | 2026-05-03 | Tab consolidation (Инсайты свернуты в Дашборд); rollout cadence для пилота |
| **V22** | 2026-05-15 | audit-experts-2026-05-15: 36 правок Ганта / Сканнера / Чата / Cross-cutting (теперь в git history) |
| **V22+ Phase 4** | 2026-05-16 | Chat-bot meta-navigator (4 weeks + killer features K-K1/K-K4/K-K6 — CEO-update / Smart suggestions / Explain-engine) |
| **V22+ Phase 5** | 2026-05-16 | **Подвкладка «Release 2.0» в Интеграциях** — 56 custom-fields, lazy-loading, expand-panel с 3-tabs, diff-banner, owners stat-card, smart presets |
| **V22+ Phase 5.1** | 2026-05-17 | Phase 5 visual grooming v1 — фиксы первого визуал-аудита: phase-bar v2 sqrt-grow, токенизация HEX, SVG glyphs, 4-tab «Здоровье» |
| **V22+ Phase 5.2** | 2026-05-17 | Полная итерация по 4-экспертному аудиту: 30 фиксов visual + microcopy + density encoding. Mini-Gantt в «Сроки», status-spine, plan-vs-fact sparkline в row |
| **V22+ Sprint A** | 2026-05-17 | **Scanner team** brand compliance: 9 hardcoded HEX → токены, inline-CSS migration, 8 unicode glyphs → SVG, CAPS unify, mascot hide, `[В]` marker |
| **V22+ Sprint B** | 2026-05-17 | **Scanner microcopy** (Birman): «без assignee» → «без исполнителя» + denominator, «CR/MTTR» → human-фразы, PROD/SWITCH за флагом, B/C/Z/J tooltips |
| **V22+ Sprint C** | 2026-05-17 | **Scanner density encoding**: 4 stat-tiles → segmented activity-bar, pk-pills → bullet-graphs, sticky team-switcher, heatmap row-tail sparkline, 3-day sparkline, event-log → collapsed |
| **V22+ Playwright** | 2026-05-17 | E2E visual smoke harness: `scanner-smoke.spec.js` + `full-audit.spec.js`, CI `visual` job, 22 view-screenshots + 3 sub-tabs + chat |

## Что появилось в каждой версии

### V11 (foundation)

- localStorage-based persistence
- Reactive proxy в state.js
- HistoryManager (Undo/Redo)
- HistoryLog (action audit log)
- SQLite-WASM как opt-in
- Vendored xlsx + sql-wasm libs

### V12

- 8 documented bugs закрыты
- Black Dashboard (Sigma goal-coverage)
- Tech Info modal (versions/fields/projects discovery)
- Phase 1 — Bitbucket via Jira dev-status panel
- Phase 2 — Confluence path-cascade (3 paths × 3 CQL)
- Phase 3 — Zephyr customfield auto-discovery + per-day buckets
- `safeUrl` / `jiraIssueUrl` extracted to `utils.js`
- Security headers (CSP, X-Frame-Options)
- Cross-tab `storage` event listener
- Allowlist на bundle-CSV import

### V13 (отменена)

Не вмерж'ена. Если видишь `V13` в коде — исторический артефакт.

### V14

- B2: **GanttV2 retired** — старый «Гант со стрелками» удалён
- B3: **Plan-lock** (`state.planLocked`)
- B4: **Edit-mode** (`state.ganttEditMode`)
- B5: **Comment-on-move** в plan-locked
- A1: Employees card-view + view-toggle
- A3: Employees inline JSON в CSV bundle
- Decomposition: `Onboarding`, `BulkEditPanel`, `ActionLayer`, `LLMAssistant` extracted в `app/`

### V15

- **Spine-pill design language**: 3px stripe-left, mono-tabular numerals, no-emoji, no gradients
- Editorial Bold редизайн отвергнут пользователем

### V16

5 макро-улучшений Ганта: Team-rail / Capacity sparkline / Unified Date-Rail / Cmd+K palette / Density toggle.

### V17

12-пунктовый «overnight roadmap»: технический аудит, fixes, chat redesign, Performance tab, Portfolio Pulse + Black Dashboard refactor, аудит 6 dashboard / Реестра / Шапки / Фильтров / Тура. Тесты: 478 → 516.

### V17.1

12 групп правок: chat-bot (FAB позиция, sparkles, click-outside), registry stretch, gantt 12 fixes, HTML export, employees dark theme, settings JSON roundtrip, Action Layer dedupe, AI Анализ overflow, AI CEO dark fix.

### V17.2

- **Identity-deterministic integrations** (I1+I2+I3+I4+I5)
- `EmployeeFactory` extended: `email`, `jiraAccountId`, `bitbucketLogin`, `confluenceAccountId`
- `analysePulse` rewrite: deterministic identity-first lookup
- Confluence: path-cascade, CQL вместо exact title, space-scope, per-employee `contributor in (...)`, pagination, audit log
- Tests: 516 → 534

### V18

P1 git init, P2 contract-tests → node:test, P3 CONTRIBUTING.md, P4 CI gate, P5 `_cfPathCascade` helper, P6 token-handling consolidation, P7 Pulse async-job pattern, P8 BB bucket separation, P9 app.js decomposition, P10 server.js decomposition.

### V19

NDJSON structured logger; Pulse facade; Scanner2 persistent retention; telemetry events.

### V20

Scanner 2.0 production: CR median, PR throughput, MTTR, Gini coefficient, CR-queue depth, blocker dwell tracking, heatmap72×4 sqrt-нормировка.

### V21

Tab consolidation (Инсайты → Дашборд через `Nav.goTo` redirect); pilot rollout cadence (109 чел → организация); Multiselect компонент (V21 контракт `components/multiselect.js`).

### V22

36 правок Ганта / Сканнера / Чата / Cross-cutting (по audit-experts-2026-05-15, теперь в git log).

### V22+ Phase 4

Chat-bot meta-navigator: 4 weeks + killer features:
- K-K1 CEO-update — переиспользует buildEmployeeReport + cross-source merge
- K-K4 Smart suggestions — listen Focus.changed → trigger weekly preset
- K-K6 Explain-engine — buildReviewSections growth-explanation patterns

### V22+ Phase 5 (Release 2.0)

Подвкладка «Release 2.0» в Интеграциях:
- 56 custom-fields mapping (`release2Fields.js`)
- analyseRelease2List + diffRelease2Lists (`release2Model.js`)
- Server endpoints `/api/integrations/release2-fetch` + `/release2-related`
- 6 → 4 tabs expand-panel (Что внутри / Сроки / Связи / Здоровье)
- Diff-banner с 7-day sparkline
- Owners stat-card с micro-phasebar

### V22+ Phase 5.1/5.2 (visual grooming)

30 фиксов после 4-экспертного аудита (Maeda / Vrba / Tufte / Birman):
- Phase-bar v2: sqrt-grow + filled-tint + min-width + dominant-hero
- Native `<select multiple>` → V21 Multiselect
- Status-spine 36px на вершине expand
- Mini-Gantt timeline + 5 lifecycle blocks в «Сроки»
- 4-й таб «Здоровье» с data-quality auto-checklist
- Plan-vs-fact sparkline в row
- Identity-aware [В]/[X] muted-render

### V22+ Sprint A/B/C (Scanner team)

После 3-экспертного аудита Сканнера:
- **Sprint A** (brand): hardcoded HEX → токены, inline-CSS → `styles.css`, unicode → SVG, CAPS unify .6px, mascot hide via `body.ts2-active`, `[В]` marker
- **Sprint B** (microcopy): «CR Xч» → «До первого ревью: ~Xч», MTTR → «Блокеры висят», PROD/SWITCH за флагом
- **Sprint C** (density): 4 hero-tiles → segmented activity-bar, pk-pills → bullet-graphs, sticky team-switcher, heatmap row-tail sparkline, 3-day sparkline, event-log → collapsed

### V22+ Playwright

`tests/playwright/`:
- `playwright.config.js` — webServer + chromium + localStorage seed
- `scanner-smoke.spec.js` — 4 теста (hero / person card / mascot / Глубже)
- `full-audit.spec.js` — 30 тестов (20 main views + 3 sub-tabs + chat + sanity)
- CI workflow `visual` job в `.github/workflows/ci.yml`

## Что retired

| Когда | Что | Где остались следы |
|---|---|---|
| V14 (B2) | `GanttV2` mode | `constants.js` GANTT_TIMELINE_*, types.js |
| V14 (B2) | gantt2* settings | dataStore migration |
| V15 | Editorial Bold редизайн | (отвергнут до коммита) |
| V17 P9 | filled-pill chips в Реестре | заменены на 3px stripe + neutral |
| V17.2 I1c | `_ppFindByPartial` fuzzy match | `portfolioPulseModel.js` — alive за флагом |
| V17.2 I1d | dev-status authors без email/login | фильтруется в `server.js` |
| V21 | Вкладка «Инсайты» | `Nav.goTo('insights')` → редирект на `dashboard` |
| V21 | «Сводная» view | retired (не в sidebar; key `summary` не существует) |
| V22+ Phase 5.1 | unicode `↻ ⤓ ▾ ▸ ↗` в Release 2.0 | заменены на inline SVG через ICONS-helper |
| V22+ Sprint A | hardcoded HEX в `.ts2-row-src-*` | → CSS-токены `var(--prizma-*)` |
| V22+ Sprint A | inline-`<style>` injection в Scanner JS | → перенесено в `styles.css` |

→ См. [`dont-touch.md`](./dont-touch.md) для «осознанной кривизны»

## Когда читать какую папку

- **Что-то странное в коде** → ищи V-метку → `git log -S "V14 (B2)"` для контекста
- **Хочу добавить feature похожую на X** → найди V-метку last audit где X описывался
- **Сломал тест/contract** → `git log --diff-filter=A tests/<file>` понять зачем тест появился
- **Готовлю release notes** → `git log --grep="V22"` для последней эпохи
