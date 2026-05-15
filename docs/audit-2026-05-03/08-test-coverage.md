# Audit 08 — Maximum Test Coverage

**Авторы:** 4 эксперта — Senior Test Architect, QA Lead (per-section), Tech Specialist (test infrastructure), Test Coverage Auditor.

---

## TL;DR

**Текущая coverage:**
- 848 unit / 11 contract / 10 e2e (из ~83 source files в scope)
- **~46% модулей at 0% coverage** (38 critical-zero-coverage files)
- Heavy concentration в teamScanner2 (10 файлов, 3.5K LOC) + portfolioPulse (5 файлов, 1.4K LOC)
- testRunner.js legacy — **drift hazard** (riskEngine/metricsEngine/dependencyEngine/filters тестируются через inlined копии, не live source)

**Top-5 must-fix:**
1. **Migrate `testRunner.js` → `node:test`** — устранить drift hazard на 5 critical модулях
2. **Coverage gate в CI** — без него coverage никогда не растёт
3. **Server contract расширить** до 50 cases с fault-injection
4. **Visual regression baseline** для критичных views (40 baselines)
5. **a11y axe-core** в e2e — 0 serious/critical violations gate

---

## A. Текущая coverage

### Сильные модули (🟢 Good ≥60%)
- teamScanner2: Enrichment / Diagnostic / Metrics / Classifier / History / PersonMetrics / Insights / Config
- portfolioPulse: Model / Insights / Metrics / Utils / Backlog
- chatPrompts, chatTemplates, aiFallbackEngine, aiContextBuilder
- utils, errorsLog, employeeFactory, blackDashboardModel

### Coverage matrix (top critical files)

| File | LOC | Tests | Coverage | Severity |
|---|---|---|---|---|
| **views/gantt.js** | 2315 | NO | 0% | 🔴 |
| **views/metrics.js** | 859 | NO | 0% | 🔴 |
| **views/registry.js** | 822 | NO | 0% | 🔴 |
| **views/integrationsView.js** | 806 | NO | 0% | 🔴 |
| **views/employees.js** | 767 | YES (193) | partial | 🟠 |
| **views/dashboard.js** | 287 | NO | 0% | 🔴 |
| **views/timeline.js** | 202 | NO | 0% | 🔴 |
| **views/kanban.js** | 98 | NO | 0% | 🔴 |
| **views/history.js** | 211 | NO | 0% | 🔴 |
| **views/errorsView.js** | 172 | NO | 0% | 🔴 |
| **views/aiView.js / aiCeoView.js** | 348/398 | NO | 0% | 🔴 |
| integrations/teamScanner2.js | 2100 | partial | ~30% | 🟠 |
| integrations/teamScanner2Renderer.js | 3626 | YES (678) | ~50% | 🟡 |
| integrations/portfolioPulseRenderer.js | 1374 | NO | 0% | 🔴 |
| integrations/blackDashboardRenderer.js | 681 | partial | ~20% | 🟠 |
| integrations/techInfoRenderer.js | 618 | NO | 0% | 🔴 |
| integrations/integrationsRenderer.js | 539 | NO | 0% | 🔴 |
| integrations/integrationsSync.js | 297 | NO | 0% | 🔴 |
| integrations/employeePerformance.js | 280 | NO | 0% | 🔴 |
| integrations/telemetry.js | 118 | NO | 0% | 🔴 |
| **app/llmAssistant.js** | 971 | NO | 0% | 🔴 |
| **app/appSettings.js** | 591 | NO | 0% | 🔴 |
| **app/actionLayer.js** | 202 | NO | 0% | 🔴 |
| app/historyManager.js | 152 | NO | 0% | 🔴 |
| app/storageSettings.js + ~6 others | 90-185 | NO | 0% | 🔴 |
| **chat/chatEngine.js** | 737 | NO | 0% | 🔴 |
| chat/chatActions.js | 411 | NO | 0% | 🔴 |
| chat/chatExplain.js | 348 | NO | 0% | 🔴 |
| chat/chatUIRenderer / chatContextBuilder / chatAlerts / chatReports | 268/222/208/204 | NO | 0% | 🔴 |
| ai/aiCeoFallback.js | 654 | NO | 0% | 🔴 |
| ai/aiCeoRenderer.js / aiRenderer.js | 446/388 | NO | 0% | 🔴 |
| **dataStore.js** | 1197 | NO direct | partial | 🔴 |
| **state.js** | 186 | NO | 0% | 🔴 |
| **reactiveStore.js** | 145 | NO | 0% | 🔴 |
| sqliteStore.js | 551 | partial | ~10% | 🟠 |
| historyLog.js | 109 | NO | 0% | 🔴 |
| filters.js | 125 | testRunner only (stale) | drift risk | 🟠 |
| dependencyEngine / riskEngine / metricsEngine / insightEngine | 28-44 | testRunner only (stale) | drift risk | 🟠 |
| appDataStore.js | 178 | NO | 0% | 🔴 |
| types.js / constants.js | 256/138 | NO | 0% | 🟠 |

### Severity counts
- 🔴 **Critical (≈0%):** 38 files
- 🟠 **High (≤30%):** 9 files
- 🟡 **Medium (30-60%):** 4 files
- 🟢 **Good (≥60%):** 14 files

**Headline metric:** ~46% модулей at 0%. Weighted by LOC ещё хуже. Closing items 1-10 в Top-25 ниже поднимет coverage с ~35% до ~70%.

---

## B. Per-section test plan (17 секций)

| Section | Critical paths | Edge cases | Tests to add (priority) |
|---|---|---|---|
| **registry** | CRUD эпика, фильтрация, sort, bulk-edit, экспорт CSV | 10k строк, кириллица, NULL даты, дубль ID | virtualization>5k, bulk 500 items, filter+sort persist, inline-edit conflict, CSV Excel-encoding |
| **gantt** | drag bar, dep arrows, zoom day/week/month | пересечение зависимостей, циклы, рекурсия parent | циклическая dep блокируется, drag>1y, zoom-perf 1k bars, auto-layout, baseline diff |
| **dashboard** | KPI cards, доли по статусам, drill-down | пустой план, NaN%, division-by-zero | empty-state, % rounding sum=100, drill→registry filter, recompute on edit, chart-resize |
| **kanban** | drag card, WIP-limit, swimlanes | drop в disabled, parallel moves | optimistic-rollback, WIP-violation toast, DnD touch, lazy-load >200, swimlane persist |
| **timeline** | scroll, milestones, today-line | DST, leap year, разные TZ | TZ Moscow→UTC, milestone overlap, keyboard arrows, virtual-scroll 5y, today-line on reload |
| **podlozhka** | upload PNG/PDF, layer-toggle, opacity | >50MB, broken file, EXIF rotated | reject>50MB, PDF multipage, opacity persist, zoom+pan sync, print preview |
| **employees** | список 109, фильтр PK, role-edit | дубль email, неактивный, сменивший PK | bulk role-change, deactivated hidden, PK-reassign cascade, аватар fallback, поиск cyrillic |
| **summary** | агрегаты, дельты vs prev, PDF | период без данных, частичный | PDF pagination, Δ-знак цвет, period-picker boundary, PK-rollup, skeleton |
| **metrics** | velocity, burndown, throughput | sprint=0, мердж sprint | burndown ideal-line, velocity 3-sprint avg, throughput per assignee, export PNG, tooltip precision |
| **insights** | AI-инсайты, severity, dismiss | LLM timeout, empty result | timeout fallback, dismiss persist user-scope, re-rank order, i18n EN/RU, PII-redaction |
| **diagnostics** | health-check, latency, schema-validate | offline, partial outage | red/amber/green thresholds, auto-refresh 30s, копирование диагностики, schema mismatch, sentry link |
| **actions** | план действий, assign, deadline | overdue, повторяющиеся | overdue badge, recurring → next, bulk-assign, deadline TZ, markdown render |
| **ai** | prompt→response, история, regenerate | rate-limit, censored, large output | 429 backoff, stream cancel, 32k tokens, markdown+code blocks, PII filter |
| **integrations** | OAuth, sync, conflict | expired token, schema-change | (см. под-секции) |
| → Pulse | sentiment | empty опрос | mapping employee→pulse |
| → BD | sync | дубли | dedup, currency |
| → TechInfo | tech-stack | unknown lang | unknown→other |
| → EmployeePerf | KPI | sabbatical | exclusion rule |
| → Scanner2 | code-scan | huge repo | timeout, partial |
| → Sigma | bidirectional sync | conflict | last-write-wins + log |
| → Jira | webhook | mass-import | rate-limit, JQL escape |
| → BB | repo→epic link | force-push | re-link, branch deleted |
| → CF | pages | permission denied | graceful skip |
| **aiCeo** | стратег. вопросы, scenario | provocative, multi-turn | memory across turns, scenario fork, numeric grounding, RU/EN, cite sources |
| **history** | audit-log, diff view, revert | 100k events, deleted user | virtualization, revert→registry, filter by user, export, deleted-user label |
| **errors** | error-list, group, mark-fixed | flood, dup hash | dedup hash, group-by stack, sentry-link, auto-archive 30d, toast→list |

---

## C. Cross-section scenarios (15+)

1. Filter в registry → переход в gantt сохраняет scope
2. Theme switch (dark/light) применяется к gantt-canvas, charts, podlozhka
3. CSV-импорт виден в registry, dashboard counters, gantt bars, kanban cards
4. Sigma sync → registry status, dashboard %, history-event, errors=0
5. Bulk-edit 100 эпиков → registry/dashboard/gantt/summary одновременно
6. Undo стека работает кросс-секционно (Ctrl+Z в gantt откатывает в registry)
7. Translation pipeline: term-fix в Sigma reflects в Реестре <30s
8. 8-часовая сессия: нет утечек памяти, токен auto-refresh
9. Multi-tab: edit в tab-A → tab-B видит через broadcast/SW
10. Network drop mid-fetch → retry+toast, no partial state
11. Server restart → reconnect, queued mutations flushed
12. Browser reload mid-edit → draft restored из IndexedDB
13. Token expiry mid-action → silent refresh, action retried
14. Cross-team Pulse+EmployeePerf+BD → consistent employee.id
15. Clock skew клиент vs сервер (>5min) → корректные timestamps
16. Permission downgrade mid-session → UI re-renders без crash
17. Kanban drag во время Sigma sync → no double-write

---

## D. План для maximum coverage (5 фаз)

### Phase 1 — Unit gaps (1 спринт, ~150 тестов)
- Render-pure-funcs из всех `views/*` (DOM-string-builders без DOM)
- Edge-cases для всех utils (escape, scrub, format, plural)
- Property-based для всех scrub paths
- Migrate `testRunner.js` legacy → `node:test` (filters, riskEngine, metricsEngine, dependencyEngine, insightEngine)

### Phase 2 — Integration tests (1 спринт, ~80 тестов)
- View → state → localStorage round-trip
- Cross-section consistency (Gantt↔Kanban↔Dashboard на одних данных)
- Миграции store v15→v17

### Phase 3 — E2E (2 спринта)
- Playwright vendored (chromium only)
- 30+ critical user flows
- Visual regression baselines (~40 для Registry/Gantt/Dashboard light+dark, 1280/1440/1920)
- a11y axe-core (0 serious/critical violations baseline)
- Cross-browser matrix (chromium обязательно, firefox/webkit nightly)

### Phase 4 — Server & API (1 спринт, ~50 cases)
- Расширить contract с inject (latency/500/timeout/partial-JSON)
- DTO schema validation
- Auth flow (GigaChat OAuth happy/expired/refresh/401)
- `/api/llm/chat` SSE streaming/cancel/abort

### Phase 5 — Performance / Load (1 спринт)
- Memory leak detection (10k mutations)
- Render budget per section (extended `perfBudget.js`)
- API load test (k6 5 scenarios: 50/200/500/1000/2000 RPS)

---

## E. Recommended test architecture

| Layer | Now | Target |
|---|---|---|
| Unit (node:test) | 848 | ~3000 |
| Integration | ~0 | ~200 |
| Contract | 11 | ~50 |
| E2E (Playwright) | 10 smoke | 30+ flows |
| Visual regression | 0 | ~40 baselines |
| A11y (axe-core) | 0 | per view |
| Property-based (fast-check) | 0 | ~30 |
| Load (k6) | 0 | 5 scenarios |
| Mutation (Stryker, critical only) | 0 | weekly nightly |

---

## F. Tooling additions (15)

| # | Tool | Where | Cost | Vanilla-respecting? |
|---|---|---|---|---|
| 1 | Playwright (chromium only) | devDep, CI install | 1d | ✓ devDep |
| 2 | axe-core vendored | `libs/axe.min.js` | 0.5d | ✓ vendored |
| 3 | fast-check vendored | `libs/fast-check.umd.js` | 1d | ✓ vendored |
| 4 | sandbox.html + manifest | new `sandbox/` | 1.5d | ✓ pure static |
| 5 | Visual regression suite | `tests/visual/` | 1d | ✓ devDep |
| 6 | Coverage gate script | `scripts/coverageGate.js` (lcov parser, 50 LOC) | 0.5d | ✓ vanilla |
| 7 | Stryker (critical modules only) | devDep, weekly nightly | 1d | ⚠ npm |
| 8 | Flaky retry wrapper | `--test-retries=2` extension | 0.25d | ✓ vanilla |
| 9 | Test impact analysis | `scripts/affected.js` (git diff → test glob) | 0.5d | ✓ vanilla |
| 10 | Contract snapshot diff | extend `contractTest.js` | 0.5d | ✓ vanilla |
| 11 | HTML coverage report | `scripts/lcov2html.js` | 0.5d | ✓ vanilla |
| 12 | Perf budget per-route | extend `perfBudget.js` (TTI per view) | 0.5d | ✓ vanilla |
| 13 | Network mocking lib | vendor `msw` для sandbox | 0.5d | ✓ vendored |
| 14 | Lighthouse CI | dev-only, против `sandbox.html` | 0.5d | ✓ devDep |
| 15 | Test data builders | `tests/helpers/builders.js` | 0.5d | ✓ vanilla |

**Total: ~10 dev-days.** Production остаётся zero-npm.

---

## G. Top-30 priority test suites к добавлению

| # | Test file | Что покрывает | Effort |
|---|---|---|---|
| 1 | `tests/unit/state.test.js` | mutations, init, schema migration | M |
| 2 | `tests/unit/reactiveStore.test.js` | silent/batch/subscribers leak | M |
| 3 | `tests/unit/dataStoreMigrations.test.js` | v15→v16→v17 LS migrations | M |
| 4 | `tests/unit/registryRouter.test.js` | view-switch, hash routing | S |
| 5 | `tests/unit/dashboardRender.test.js` | KPI cards, empty/error | M |
| 6 | `tests/unit/ganttRender.test.js` | timeline math, edge dates | L |
| 7 | `tests/unit/kanbanRender.test.js` | columns, drag-drop pure logic | M |
| 8 | `tests/unit/timelineRender.test.js` | aggregation buckets | M |
| 9 | `tests/unit/metricsView.test.js` | charts data shape | M |
| 10 | `tests/unit/historyView.test.js` | diff/audit log render | S |
| 11 | `tests/unit/errorsViewRender.test.js` | grouping, severity filters | S |
| 12 | `tests/unit/aiViewRender.test.js` | message bubbles, streaming UI | M |
| 13 | `tests/unit/aiCeoViewRender.test.js` | exec-summary cards | S |
| 14 | `tests/unit/integrationsViewRender.test.js` | source list, status pills | S |
| 15 | `tests/unit/dependencyEngine.test.js` | DAG, cycles, topo-sort (replace stale testRunner) | M |
| 16 | `tests/unit/metricsEngine.test.js` | velocity, throughput (replace stale) | M |
| 17 | `tests/unit/riskEngine.test.js` | scoring, thresholds (replace stale) | M |
| 18 | `tests/unit/insightEngine.test.js` | rule firing (replace stale) | M |
| 19 | `tests/unit/parseStreamResponse.test.js` | SSE chunks, abort, malformed | M |
| 20 | `tests/unit/llmAssistant.test.js` | prompt build, retry | M |
| 21 | `tests/unit/chatEngine.test.js` | full pipeline e2e mock | L |
| 22 | `tests/property/scrubSecrets.property.test.js` | fast-check fuzzing | M |
| 23 | `tests/property/escapeHtml.property.test.js` | XSS payload corpus | S |
| 24 | `tests/contract/jiraSearch.test.js` | /api/jira/search + faults | M |
| 25 | `tests/contract/llmChat.test.js` | /api/llm/chat SSE | L |
| 26 | `tests/contract/gigachatOAuth.test.js` | token refresh, 401 retry | M |
| 27 | `tests/contract/integrationsSync.test.js` | full sync cycle | M |
| 28 | `tests/integration/crossSection.test.js` | gantt↔kanban↔dashboard parity | L |
| 29 | `tests/e2e/playwright/criticalFlows.spec.js` | 30+ flows | XL |
| 30 | `tests/load/k6/api-mix.js` | sustained 50 RPS, p95 budget | M |

---

## H. Test data fixtures (need)

- `empty.json` — 0 epics, 0 emp
- `small.json` — 50 ep / 10 emp
- `medium_1k.json` — 1k ep / 30 emp / 5 PK
- `large_5k.json` — 5k / 60 / 15 PK
- `xl_10k.json` — 10k / 109 emp / 30 PK (perf gate)
- `multilingual.json` — RU/EN/中/AR (RTL)
- `edge_dates.json` — 1970, 2099, leap, DST cross
- `cyclic_deps.json` — циклы зависимостей
- `unicode_names.json` — emoji, ZWJ, RTL
- `corrupt.csv` — BOM, CRLF, escaped quotes
- `sigma_conflict.json` — одновременная правка
- `pulse_empty.json` — нет ответов
- `tokens_expired.json` — истёкшие OAuth
- `huge_history.json` — 100k events
- `attachments_50mb.bin` — лимит файла

---

## I. CI integration

### Stage gates
- **PR fast-lane:** typecheck + lint + unit + contract + e2e-smoke + perfBudget + a11y diff + visual. Runtime ≤6 мин
- **Nightly:** Playwright full + visual + axe + k6 + property-based long runs (10k iter) + Stryker (critical modules)

### Coverage gate
- global: line ≥75% / branch ≥65% / function ≥80%
- critical modules (scrub, rowFactory, riskEngine, dependencyEngine, filters): line ≥90% / branch ≥80%

### Visual diff
- Playwright `toHaveScreenshot` с tolerance 0.1%
- PR-comment с diff-артефактом
- Reviewer apply-baseline через label `viz-approved`

### Flaky strategy
- auto-retry × 2 в e2e
- метка `@flaky` карантин в nightly
- weekly report по топ-10 нестабильных
- hard-fail после 3 недель в карантине

### Artefacts
- JUnit XML + HTML report + traces (Playwright) + k6 JSON в `artifacts/`

### Metrics успеха (через 6 спринтов)
- unit ~3000, integration ~200, contract ~50, e2e ~30, visual ~40
- line-coverage ≥80% global / ≥90% горячих
- MTTR регрессии ≤24ч
- 0 critical a11y violations на главных views

---

## J. 20 Priority tests (P0 — first sprint)

1. Registry: render 10k virtualized
2. Registry: bulk-status update 500 items
3. Gantt: cyclic-dep prevention
4. Gantt: drag updates registry
5. Dashboard: % sum=100
6. Kanban: optimistic rollback on 500
7. Timeline: TZ correctness
8. Employees: PK-reassign cascade
9. Sigma: bidirectional conflict resolution
10. Jira: webhook idempotency
11. AI: 32k token streaming cancel
12. Filter persistence registry→gantt
13. Theme switch all views
14. CSV import → all-views consistency
15. Multi-tab broadcast sync
16. Token auto-refresh mid-action
17. Browser reload draft restore
18. Undo across views
19. History: revert→registry
20. Error dedup by stack-hash

---

## K. Bug-bounty zones (где исторически больше регрессий)

1. **Gantt drag/zoom** — px/date math
2. **Sigma↔Registry sync** — race conditions
3. **Filter+URL+section-switch** — persistence теряется
4. **Bulk mutations** — частичные провалы
5. **Date/TZ/DST** — классика
6. **AI streaming cancel/retry**
7. **Virtualization re-mount** на theme/locale change
8. **OAuth token refresh** на длинных сессиях
9. **CSV/PDF export** encoding (BOM, кириллица)
10. **Permission cascade** при PK-reassign

---

**Файлы high-priority:**
- `dataStore.js` (1197 LOC) — самый критичный без direct test
- `views/gantt.js` (2315 LOC) — largest view, scheduling math
- `state.js, reactiveStore.js` — global truth
- `chat/chatEngine.js, app/llmAssistant.js` — LLM glue
- `historyLog.js, app/historyManager.js` — undo/redo
- `testRunner.js` — migrate everything → `node:test`
