# V18 — Structural debt cleanup + DX enablement

**Стартовая дата:** 2026-05-01
**Прогресс:** 10/15 (Block A полностью, Block B полностью, Block C: 2/3 partial)
**Tests:** 534 unit / 11 contract / 0 fail (held throughout)
**Базис:** V17.2 (534 unit / 11 contract / 0 fail) + 12 docs + PR-template + .gitignore
**Триггер:** аудит Phase 3 «Документирование проекта для LLM-агентов» — 27 zon роста выявлено

## Цели V18

V17 закрыл **поведенческие баги** (token leak, fuzzy match, Confluence broken). V17.1/V17.2 — **functionality gaps**. V18 — **structural debt** что накопился под итеративной разработкой:

1. Привести проект под git-контроль (его сейчас нет)
2. Унифицировать integration patterns (token-middleware, path-cascade, async-job)
3. Продолжить decomposition больших файлов (`app.js`, `server.js`, `gantt.js`, `styles.css`)
4. Закрыть legacy testRunner, поднять покрытие app.js/server.js/views
5. Внедрить process: CONTRIBUTING.md, CI gate, structured logging

Что **НЕ делаем** в V18 — выписано в § «Отложено в V19+» внизу.

## Roadmap (15 пунктов в 5 блоках)

Делаем последовательно. После каждого пункта — тесты + audit-md. Блоки могут перемежаться (если P3 застрял на ревью — идём к P5).

### Block A — Process foundation (4 пункта) ✅

| # | Что | Effort | Impact | Файл-отчёт | Status |
|---|---|---|---|---|---|
| **P1** | `git init` + первый коммит. Audit на токены, initial branch `main`. | M | **Critical** | [`01-git-init.md`](./01-git-init.md) | ✅ `ee1580c` |
| **P2** | Поправить `test:contract` config: миграция `contractTest.js` в `tests/contract/integrations.test.js` под node:test. | XS | Low | [`02-test-contract-fix.md`](./02-test-contract-fix.md) | ✅ `e6fcab3` |
| **P3** | `CONTRIBUTING.md` — entry point для humans: workflow, commits, V-эпохи, contracts, style, pre-merge. | S | Medium | [`03-contributing.md`](./03-contributing.md) | ✅ `1e3e3ba` |
| **P4** | CI gate: GitHub Actions + GitLab CI yaml. Stages typecheck → lint → tests → smoke. | S | Medium | [`04-ci-gate.md`](./04-ci-gate.md) | ✅ `0f56b5b` |

### Block B — Integration consistency (4 пункта) ✅

| # | Что | Effort | Impact | Файл-отчёт | Status |
|---|---|---|---|---|---|
| **P5** | `_cfPathCascade(urls, opts)` helper — вынес pattern из 3-5 мест в один helper (3 переписаны, 2 оставлены с обоснованием). | S | Medium | [`05-path-cascade-helper.md`](./05-path-cascade-helper.md) | ✅ `962ce18` |
| **P6** | Token-handling consolidation: централизованный `_ppRedactSecretsInText` (server) + `Utils.redactSecretsInText` (frontend); унификация `_ppMakeAuthHeader`. | S | **High (security)** | [`06-token-middleware.md`](./06-token-middleware.md) | ✅ `4cd0c85` |
| **P7** | Pulse async-job pattern: новые `/start` + `/status` endpoints, выделен `_runPortfolioPulse` helper, frontend на polling+fallback. | L | High | [`07-async-job-unification.md`](./07-async-job-unification.md) | ✅ `165a15c` |
| **P8** | Bitbucket bucket separation: `bitbucket.{repoAuthors, devStatusAuthors}` раздельно + `p.bbSource` provenance. | S | Medium | [`08-bb-bucket-split.md`](./08-bb-bucket-split.md) | ✅ `c2efed8` |

### Block C — Decomposition (3 пункта)

| # | Что | Effort | Impact | Файл-отчёт | Status |
|---|---|---|---|---|---|
| **P9** | `app.js` 2613 LOC → app/uiToggles + app/bulkEditPanel + app/appSettings. -704 LOC (-27%). Цель < 1500 не достигнута; App orchestrator + FiltersUI + bindExport остались. | M | High | [`09-app-decomposition.md`](./09-app-decomposition.md) | ✅ partial `5c4c2b8` |
| **P10** | `server.js` 2657 LOC → server/integrations/jobs.js (generic factory) + authHelpers.js. -108 LOC. Pulse aggregation + route handlers остались. | M | High | [`10-server-decomposition.md`](./10-server-decomposition.md) | ✅ partial `a623cbe` |
| **P11** | `views/gantt.js` 2637 LOC → разбить на `views/gantt/{render,ctxMenu,dnd,history}.js`. **Самый большой view, читабельность критична. ОТЛОЖЕН в V18.2 — требует свежей сессии для careful split.** | L | High | TODO `11-gantt-split.md` | ⏸ deferred |

### Block D — Testing (2 пункта) — отложено в V18.1

| # | Что | Effort | Impact | Файл-отчёт |
|---|---|---|---|---|
| **P12** | `testRunner.js` 900 LOC legacy → миграция 104 тестов в `tests/unit/*.test.js` (node:test). После — удалить testRunner.js. План в файле-отчёте. | L | Medium | `12-testrunner-retire.md` |
| **P13** | Поднять покрытие `app.js` / `server.js` / `views/*`. Сейчас 0 unit для них; покрываются только через contract+e2e. Цель: + ~30 unit-тестов на ключевых функциях. | L | Medium | `13-coverage-expansion.md` |

### Block E — Operations (2 пункта) — отложено в V18.1

| # | Что | Effort | Impact | Файл-отчёт |
|---|---|---|---|---|
| **P14** | Structured logging на сервере: log levels (debug/info/warn/error) + log rotation rules + structured JSON output (для будущего шипа в ELK). Сейчас `console.log` всё подряд. | M | Medium | `14-structured-logging.md` |
| **P15** | `styles.css` 11000 LOC + 433KB → audit dead-code (Editorial Bold остатки от V15) + split на `styles/{base,views,integrations,onboarding}.css` через `<link>` теги. | M | Medium (perf) | `15-css-cleanup.md` |

## Тесты на момент старта V18

```
npm test → 534 unit / 11 contract / 0 fail
```

После каждого пункта прогон + обновление этой строки. Не должны откатываться.

## Ожидаемая трудоёмкость

- **Block A** — ~1 день
- **Block B** — ~2-3 дня
- **Block C** — ~3-4 дня
- **Block D** — ~3-5 дней
- **Block E** — ~2 дня

**Итого: ~2 недели сосредоточенной работы.** Реалистично растянется на 2-3 итерации (V18.0 → V18.1 → V18.2) если делать параллельно с фичами.

## Отложено в V19+

Эти 12 пунктов из аудита Phase 3 зафиксированы как backlog но не входят в V18:

| # | Что | Почему отложено |
|---|---|---|
| **B1** | DTO-схемы между frontend ↔ server | Preventive, низкий impact пока ничего не ломалось |
| **B2** | `state.rows[i]` терминологический долг (epic/task/row) | Cosmetic, изменение типов сломает много кода |
| **B3** | Pulse pipeline 5-файловый объединить в `pulse/index.js` фасад | Уже понятно после `integrations/README.md` |
| **B4** | Visual regression tests (CSS snapshots / Percy) | Слишком дорого, ROI неясен |
| **B5** | Migration telemetry для localStorage версий | Нет инфраструктуры телеметрии |
| **B6** | Audit-папок consolidation после X месяцев | Решение через 6-12 месяцев |
| **B7** | Sigma fields миграция в отдельный `sigma_config.json` | Breaking change без триггера |
| **B8** | `gantt2*` migration cleanup | После 12+ месяцев в проде |
| **B9** | `_ppFindByPartial` retire дата | Через 6 месяцев от V17.2 |
| **B10** | Demo-mode lifecycle FSM (если ещё всплывёт) | One-time UX, низкий impact |
| **B11** | Onboarding fragmentation (24-step + CEO tour два engine'а) | Большой DX-проект, отдельная итерация |
| **B12** | Shared fixture library (помимо jiraPulseResponse) | Естественно вырастет в P12/P13 |

## Audit-папка V18

```
audit-2026-05-V18/
├── MASTER_PLAN.md            ← этот файл
├── 01-git-init.md            ← пишется когда P1 закроется
├── 02-test-contract-fix.md
├── ...
└── 15-css-cleanup.md
```

Каждый отчёт = что сделал + что не сделал + tests pass + регрессии. По шаблону `audit-2026-05-V17/13-integrations-audit.md`.

## Договорённости

- **Порядок** — последовательно по одной (пользовательский запрос)
- **Тесты** не должны откатываться: 534/11/0 минимум, но точно вырастут (P13 + new fixtures)
- **Documentation impact** — каждый пункт должен trigger'нуть PR-template чек-лист
- **Audit-метки в коде** — формат `V18 P<n> [(<expert> §<sec>)] — <описание>`

---

**Готовность V18 к старту:** есть план + есть аудит-папка + есть PR-template + есть .gitignore. Можно приступать к P1.

---

## V18.1 P7 — Сканнер команд 2.0 (V18.1 → V18.2 graduation)

Параллельно V18.1 декомпозиции (P9-P10) команда экспертов спроектировала и реализовала **новый «Сканнер команд 2.0»** — отдельный subtab в /integrations с чистого листа. После 6 фаз initial implementation (P1-P6) + pre-release audit + 3 sprints fixing 17 P0/P1 findings — graduate в production V18.2.

- **Дизайн:** [`scanner2-graduation.md`](./scanner2-graduation.md) — ADR с decisions, trade-offs, rollback
- **Operations:** [`../docs/integrations/team-scanner-v2.md`](../docs/integrations/team-scanner-v2.md) — что считается, какие пороги, как читать сигналы
- **Tests:** 645 unit / 18 contract / 0 fail
- **Status (2026-05-02):** Sprint 3 closed, automated DoD passed. Pre-release audit completed. **Pilot Day-14 PASSED with conditions** ([feedback](./scanner2-pilot-feedback.md)) — 5-6/7 daily users. Sprint 4 (multi-team + trends + WIP + 3 polish) closed. **V18.2 graduated to production.**
- **Next:** [`v18-3-and-v19-roadmap.md`](./v18-3-and-v19-roadmap.md) — V18.3 (Scanner 2.0 P2 polish + gantt split) + V19 (structural backlog: telemetry, persistent retention, RBAC, etc.).
- **V18.3 kickoff:** [`v18-3-MASTER_PLAN.md`](./v18-3-MASTER_PLAN.md) — open questions resolved (UI config / reconnaissance / Olga last / no D4 для B1). Order: A3→A2→A4→A5→B1→A1. Effort ~30-40ч.
- **V18.3 closed (2026-05-02):** all 6/6 пунктов закрыты — A3/A2/A4/A5/B1 partial split/A1 per-team config. Tests 670 unit / 18 contract / 0 fail. Olga ML re-pilot pending.
