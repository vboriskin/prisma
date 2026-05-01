# V18.1 P10 — server.js decomposition (partial)

**Дата:** 2026-05-01
**Tests:** 534 unit / 11 contract / 0 fail (без регрессий)
**Effort:** S

## Метрика

```
До:  server.js 2657 LOC
После: server.js 2549 LOC  (-108 LOC, -4%)
```

2 новых модуля в `server/integrations/`:

| Файл | LOC | Что |
|---|---|---|
| `server/integrations/jobs.js` | 100 | Generic async-job cluster factory (унифицирует `_bdJobs` + `_pulseJobs`) |
| `server/integrations/authHelpers.js` | 41 | Pure helpers: `makeAuthHeader`, `keyForAuthor`, `redactSecretsInText` |

## Что вынесено

### 1. Generic Jobs cluster (jobs.js, 100 LOC)

**Главная победа.** Это закрывает аудит-bullet что был оставлен в P7 как backlog: «Generic Jobs cluster (server/jobs.js unifying _bdJobs + _pulseJobs)».

До — было два почти идентичных inline-кластера в server.js:
```js
const _bdJobs = new Map(); let _bdJobCounter = 0;
const BD_JOB_TTL_MS = 30*60*1000; const BD_JOB_MAX = 50;
function bdGCJobs() { ... }      // GC по TTL + max-count
function bdCreateJob() { ... }    // generate id + insert
function bdGetJob(id) { ... }
function bdRunJob(job, cfg) { ... }   // Promise.then writes result/error

// И зеркальный pulseGCJobs / pulseCreateJob / pulseGetJob / pulseRunJob
```

После — single factory:
```js
const { createJobsCluster } = require('./server/integrations/jobs.js');
const _bdCluster    = createJobsCluster({ prefix: 'bd',    ttlMs: 30*60*1000, maxCount: 50, label: 'bd' });
const _pulseCluster = createJobsCluster({ prefix: 'pulse', ttlMs: 30*60*1000, maxCount: 20, label: 'pulse' });
```

Public API кластера:
```ts
{
  create(payload?) → Job,
  get(id) → Job | null,
  run(job, runner) → starts background runner (mutates job on settle),
  gc() → manual GC,
  _map: Map      // for inspection
}
```

Job shape сохранён 1:1: `{ id, status, startedAt, finishedAt, result, error, phase, payload }`.

`bdRunJob` — закреплён за `buildBlackDashboard(cfg)`:
```js
function bdRunJob(job, cfg) {
  _bdCluster.run(job, () => buildBlackDashboard(cfg));
}
```

`pulseRunJob(job, runner)` — принимает inline-runner (для async-job передаёт всю Pulse-логику через closure → `_runPortfolioPulse(...)`).

### 2. Auth helpers (authHelpers.js, 41 LOC)

Три pure-helpers, вынесены без поведенческих изменений:
- `makeAuthHeader(token)` — Bearer/Basic, бывший `_ppMakeAuthHeader`
- `keyForAuthor(name, email)` — lowercased identity, бывший `_ppKeyForAuthor`
- `redactSecretsInText(text, maxLen)` — bывший `_ppRedactSecretsInText`, mirror frontend `Utils.redactSecretsInText`

Импортируются обратно с прежними именами:
```js
const _authHelpers = require('./server/integrations/authHelpers.js');
const _ppMakeAuthHeader      = _authHelpers.makeAuthHeader;
const _ppKeyForAuthor        = _authHelpers.keyForAuthor;
const _ppRedactSecretsInText = _authHelpers.redactSecretsInText;
```

Все ~30 callsites внутри server.js работают как раньше.

## Что НЕ вынесено

Оставлено в server.js (для будущих P10.x итераций):

- **Pulse aggregation helpers** (~700 LOC): `ppFetchBitbucketActivity`, `ppFetchConfluenceActivity`, `ppFetchDevStatusForIssues`, `_ppMergeAuthorMaps`, `_runPortfolioPulse`, `_cfPathCascade`. Большой кластер с тесными зависимостями между функциями. Самый перспективный extract — но требует careful test coverage.
- **Jira config** (read/write/sanitize, ~80 LOC) и `jiraReadConfig`/`jiraSanitizeConfig` — связь с persistence файлом
- **`jiraForward` + `jiraPLimit`** (~250 LOC) — HTTP client utilities
- **LLM endpoints** (`gigaChatOAuth`, `/api/llm/chat`) — отдельная иерархия
- **All `/api/*` route handlers** в монолитной if/else цепочке (~800 LOC) — миграция на middleware-pattern это P10.x
- **Static-server** (file serving + security headers) — отдельный нижний слой

Эти места плотно связаны. P10 как отдельная итерация (которая уже сделана для blackDashboard и techInfo — смотри `server/integrations/blackDashboard.js`, `techInfo.js`) даст большие победы, но опасны без careful testing.

## Backward compatibility

Имена локальных переменных (`_bdJobs` маппится на `_bdCluster._map`, `bdCreateJob` остался как функция-wrapper) **не сохранены**, но это OK потому что они НЕ экспортируются — ни одна внешняя точка кода не читала `_bdJobs` напрямую (проверил через grep).

Внешний контракт endpoints `/black-dashboard/start /status` + `/portfolio-pulse/start /status` не изменился — same shape, same headers, same TTL.

## Тесты

```
npm test → 534 unit / 11 contract / 0 fail
node --check server.js → syntax OK
```

Регрессий ноль. Smoke (server boot + /health) проходит.

## Что закрыто из аудита

- Phase 3 audit Bullet **A2** (server.js 2537 LOC monolith) — частичный прогресс (-4%, до 2549). Главные кластеры (Pulse aggregation, route handlers) остались.
- V18 P7 audit § «Generic Jobs cluster (`server/jobs.js`) — оставлено для будущей итерации» — **полностью закрыто**.

## Резюме

```
✓ server/integrations/jobs.js          (100 LOC) — generic async-job cluster
✓ server/integrations/authHelpers.js   (41 LOC)  — 3 pure helpers
✓ server.js: 2657 → 2549 LOC (-108)
✓ Tests: 534 / 11 / 0
```

V18.1 P10 закрыт частично (jobs cluster + auth helpers; Pulse aggregation отложен). Дальше — P11 (gantt.js split).
