# V18 — Structural debt cleanup + DX enablement

**Стартовая дата:** 2026-05-01
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

### Block A — Process foundation (4 пункта)

| # | Что | Effort | Impact | Файл-отчёт |
|---|---|---|---|---|
| **P1** | `git init` + первый коммит. Включает: проверку что в файлах нет токенов (audit), создание initial branch `main`, push в репо (если нужно). | M | **Critical** | `01-git-init.md` |
| **P2** | Поправить `test:contract` config: либо переместить `contractTest.js` в `tests/contract/`, либо обновить script на правильный путь. Сейчас `package.json` указывает на пустую папку. | XS | Low | `02-test-contract-fix.md` |
| **P3** | `CONTRIBUTING.md` — точка сборки: ссылки на CLAUDE.md / state-contracts / spine-pill / dont-touch + правила «как мы коммитим / как пишем audit-метки / как добавляем view/integration». Включает `npm install` для dev. | S | Medium | `03-contributing.md` |
| **P4** | CI gate (GitHub Actions / GitLab CI yaml): `npm run ci` на каждый PR. Должен ругать если `npm test` не зелёный или lint > 215. | S | Medium | `04-ci-gate.md` |

### Block B — Integration consistency (4 пункта)

| # | Что | Effort | Impact | Файл-отчёт |
|---|---|---|---|---|
| **P5** | `_cfPathCascade(paths, baseUrl, headers, opts)` helper — вынести pattern из 5 мест (ppFetchConfluenceActivity, confluence-search, verify-confluence, confluence-resolve-user, confluence-audit-logins) в один helper. Тесты что failure-modes сохранились. | S-M | Medium | `05-path-cascade-helper.md` |
| **P6** | Единый token-middleware для всех `/api/integrations/*`: scrub + auth-header + redact регекс в одном wrapper'е. Сейчас 3 разных места легко забыть в новом endpoint'е. | M | **High (security)** | `06-token-middleware.md` |
| **P7** | Унификация long-running запросов: Pulse сейчас sync-blocking 10-минутный POST, Black Dashboard async-job. Перевести Pulse тоже на async-job pattern (start → poll → done) — UI получит progress + cancel. | L | High | `07-async-job-unification.md` |
| **P8** | Bitbucket bucket separation: `bitbucket.repoAuthors` + `bitbucket.devStatusAuthors` отдельно. UI решает что показывать. Вместо single merged authors. | M | Medium | `08-bb-bucket-split.md` |

### Block C — Decomposition (3 пункта)

| # | Что | Effort | Impact | Файл-отчёт |
|---|---|---|---|---|
| **P9** | `app.js` 2613 LOC → продолжить decomposition в `app/*`. Кандидаты: BulkEditPanel, остатки save-flow, parts of Reactive subscriber. Цель: app.js < 1500 LOC. | M | High | `09-app-decomposition.md` |
| **P10** | `server.js` 2537 LOC → разбить на `server/*` модули (по примеру frontend `integrations/*`). Кандидаты: `server/integrations/jiraPulse.js`, `bitbucket.js`, `confluence.js`, `audit.js`. Цель: server.js < 1500 LOC, остальные ≤ 500. | M | High | `10-server-decomposition.md` |
| **P11** | `views/gantt.js` 2637 LOC → разбить на `views/gantt/{render,ctxMenu,dnd,history}.js`. Главный view, читабельность критична. | L | High | `11-gantt-split.md` |

### Block D — Testing (2 пункта)

| # | Что | Effort | Impact | Файл-отчёт |
|---|---|---|---|---|
| **P12** | `testRunner.js` 900 LOC legacy → миграция 104 тестов в `tests/unit/*.test.js` (node:test). После — удалить testRunner.js. План в файле-отчёте. | L | Medium | `12-testrunner-retire.md` |
| **P13** | Поднять покрытие `app.js` / `server.js` / `views/*`. Сейчас 0 unit для них; покрываются только через contract+e2e. Цель: + ~30 unit-тестов на ключевых функциях. | L | Medium | `13-coverage-expansion.md` |

### Block E — Operations (2 пункта)

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
