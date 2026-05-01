# API Endpoints

Все `/api/*` маршруты `server.js`. Sync = blocking response, async = job-pattern, cached = с TTL. Все требуют `cfg.<name>Token` если не указано иное.

## Config

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/jira/config` | — | sanitized config (без tokens, только `hasXxxToken: bool`) | Boot-hydrate frontend |
| POST | `/api/jira/config` | partial config patch | sanitized config | Empty token field = preserve existing (V17.2 I3) |
| POST | `/api/jira/verify` | — | `{ok, who}` | Тестит current jiraBaseUrl + jiraToken |

Whitelist string-полей в POST: `jiraBaseUrl, jiraProjectKeys, sigmaJiraBaseUrl, sigmaGoalEpicKeys, bitbucketBaseUrl, bitbucketProjectKeys, confluenceBaseUrl, confluenceSpaceKeys`. Numbers: `activityWindowHours` (clamp [1,168]), `staleDays`, `noMovementDays`. Bools: `allowInsecureTls`. Tokens — отдельные поля, persisted ТОЛЬКО при non-empty.

## Jira (Delta)

| Method | Path | Body | Response | Sync? | Cache |
|---|---|---|---|---|---|
| POST | `/api/integrations/jira-issue` | `{key}` | enriched issue (status/priority/type/assignee/...) | sync | нет |
| POST | `/api/integrations/jira-fetch-all` | `{projectKeys?}` | array всех Jira-issues по configured PKs | sync, медленно | нет |
| POST | `/api/integrations/portfolio-pulse` | `{projectKeys, employees?}` | `{reports[], bitbucket, confluence, devStatus, diagnostics}` | sync, до 10 мин | нет (дорогой запрос) |
| POST | `/api/integrations/employee-performance` | `{}` | per-employee Jira metrics | sync | нет |
| POST | `/api/integrations/tech-info` | `{source: 'all'|'jira'|'bitbucket'|'confluence', forceRefresh?}` | `{jira, bb, cf}` диагностика | sync | 10-min in-memory cache |

Pulse `employees[]` (V17.2 I2c) — slim payload identity для per-employee CQL:
```js
employees: [{
  fio: 'Иванов И.', email: 'i@co', jiraAccountId: '...',
  bitbucketLogin: 'i.ivanov', confluenceAccountId: '...'
}]
```

## Bitbucket

| Method | Path | Body | Response | Sync? |
|---|---|---|---|---|
| POST | `/api/integrations/bitbucket-prs` | `{repoSlug?, projectKey?}` | PR list | sync |
| POST | `/api/integrations/verify-bitbucket` | — | `{ok, who}` | sync |

## Confluence

| Method | Path | Body | Response | Sync? | V17.2 |
|---|---|---|---|---|---|
| POST | `/api/integrations/confluence-search` | `{query, sinceDate?}` | `{pages[], query, sinceDate, error?}` | sync | path-cascade + CQL `title ~ ... OR text ~ ...` + space-scope (I2c-G2) |
| POST | `/api/integrations/verify-confluence` | — | `{ok, who, spaces?, tried[]}` | sync | если `confluenceSpaceKeys` заданы — проверяет доступ к каждому пространству (I2c) |
| POST | `/api/integrations/confluence-resolve-user` | `{email?, fullname?}` | `{ok, user, tried[]}` | sync | **новое в I2c-G5** — резолв по email/ФИО → confluenceAccountId/username |
| POST | `/api/integrations/confluence-audit-logins` | — | `{ok, users[], totalRecords, retention?, tried[]}` | sync | **новое в I2c-G7** — audit log из `/rest/api/audit?startDate=ms&endDate=ms`, окно = `cfg.activityWindowHours` |

`confluence-resolve-user` cascade:
1. `${base}/wiki/rest/api/search/user?cql=user.email = "..."`
2. `${base}/rest/api/search?cql=user.email = "..."`
3. `${base}/rest/api/user/search?username=<email-prefix>`
4. `${base}/wiki/rest/api/search/user?cql=user.fullname ~ "..."`

`confluence-audit-logins` пробует `/wiki/rest/api/audit` → `/rest/api/audit`. Может вернуть 401/403 если audit отключён в админке (Audit log → Configuration); ответ содержит понятное сообщение.

Per-pulse Confluence (внутри `/portfolio-pulse`):
- 3 раздельных CQL прохода: page edits + comments + mentions
- pagination через start/limit, cap = 1000 events × 10 страниц
- TZ-skew guard: CQL cutoff с +1ч padding, точная фильтрация на сервере
- Возвращает `authors[k] = {edits, comments, mentions, items[{kind:'create'|'edit'|'comment'|'mention'}]}` с дедупом по `targetId`

## Sigma Jira (Чёрный дашборд)

Async job-pattern:

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/integrations/black-dashboard/start` | `{goalEpicKeys?}` | `{jobId}` | Запускает background job |
| GET | `/api/integrations/black-dashboard/status` | (query: `?jobId=...`) | `{status: 'running'|'done'|'error', progress, result?, error?}` | Poll каждые 2с |
| POST | `/api/integrations/black-dashboard` | (legacy, sync) | result | sync вариант (для мелких запросов) |
| POST | `/api/integrations/sigma-verify` | — | `{ok, who, configured}` | Тестит Sigma подключение |

Job lifecycle: `_jobs[jobId] = {status, result, progress, startedAt, ttl}` — in-memory, TTL 1 час после `done`.

## LLM (GigaChat / OpenAI-compat)

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/llm/chat` | OpenAI-compat `{model, messages, stream, ...}` + `{apiBaseUrl, token}` | SSE stream | Server-side OAuth caching для GigaChat (TTL ~30 min) |

Frontend (`app/llmAssistant.js`) поддерживает 3 mode'а:
- `direct` (same-origin) — прямой fetch на endpoint
- `direct→proxy` (cross-origin) — через `/api/llm/chat`
- `proxy` — всегда через `/api/llm/chat`

## Прочее

| Method | Path | Что | Notes |
|---|---|---|---|
| GET | `/health` | `{ok, uptime, pid, now}` | Liveness probe |
| GET | `/metrics` | в-памяти счётчики `/api/*` запросов | Простая телеметрия |

## Rate limit

`RATE_LIMIT_PER_MIN` (env, default 60) — на все `/api/*`. При превышении — `429`. Контракт-тесты выставляют `500` чтобы не упираться.

## Timeouts

| Контекст | Timeout |
|---|---|
| `proxyPost` (frontend → server) | 90с (V17.2 I4c, было 15с) |
| `PER_PK_TIMEOUT_MS` (server per-PK in pulse) | 90с (env override) |
| `pulse` overall (frontend) | 600с (10 мин) — slowest corp Jira tier |
| `confluence-search`, `verify-*` | 20-25с per-request |
| Black Dashboard per-PK budget | 600с (V17 P6) |

## Error shapes

Все `/api/integrations/*` при ошибке возвращают `{error: string, ...diagnostics}` со статусом 400/500. Frontend бросает `Error(err.error || HTTP <code>)`.

V17.2 I4a — token-shaped substrings вычищены из error-text перед throw (regex по `Bearer|Authorization|token|secret|password|apiKey|authKey`).

## Auth & secrets

См. [`auth-and-secrets.md`](./auth-and-secrets.md) для полного token-flow и scrub policy.
