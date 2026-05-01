# Integrations — Overview

4 внешних источника + LLM + audit log. Все идут через `server.js` (proxy) — токены никогда не попадают в браузер.

## Источники данных

| Источник | Что тянем | Frontend | Server endpoints | Identity-поле |
|---|---|---|---|---|
| **Jira Delta** | Задачи, эпики, статусы, changelog, worklog, comments | `integrations/portfolioPulseApi.js`, sync `integrationsSync.js` | `/api/integrations/portfolio-pulse`, `/api/integrations/jira-issue`, `/api/integrations/jira-fetch-all` | `email`, `jiraAccountId` |
| **Jira Sigma** | Goal-эпики (квартальные цели) с Domain link | `integrations/blackDashboard*.js` | `/api/integrations/black-dashboard/*` | (не на сотрудника) |
| **Bitbucket** | PR / commits за окно активности | `portfolioPulseApi.js` (внутри pulse) | внутри `/api/integrations/portfolio-pulse` | `bitbucketLogin`, `email` |
| **Confluence** | Правки, комментарии, упоминания, аудит логинов | `portfolioPulseApi.js` (pulse) + sync `integrationsSync.js` | `/api/integrations/confluence-search`, `/api/integrations/confluence-resolve-user`, `/api/integrations/confluence-audit-logins` | `confluenceAccountId`, `email` |
| **GigaChat / OpenAI-compat** | LLM streaming для AI-ассистента | `app/llmAssistant.js` | `/api/llm/chat` | (не на сотрудника) |

→ Полный список endpoints: [`api-endpoints.md`](./api-endpoints.md)
→ Auth-flow и token-handling: [`auth-and-secrets.md`](./auth-and-secrets.md)

## Three high-level pipelines

### 1. Portfolio Pulse (analytics + per-team aggregation)

```
state.employees ─┐
                 ▼
[browser]  PortfolioPulse.refresh()                           [server]
            │
            ├── fetchPulseData(projectKeys, employees) ───── POST /portfolio-pulse
            │                                                  │
            │                                                  ├── jiraBuildReport (per-PK, concurrency 2)
            │                                                  │   ├── search /rest/api/2/search (changelog, worklog)
            │                                                  │   └── фильтры по cutoffTs
            │                                                  ├── ppFetchBitbucketActivity (params: cutoffTs, cutoffIso)
            │                                                  │   └── repo walk + PR activity
            │                                                  ├── ppFetchConfluenceActivity (params: cutoffTs, employees)
            │                                                  │   ├── 3-CQL passes: edits / comments / mentions
            │                                                  │   ├── space-scope from cfg.confluenceSpaceKeys
            │                                                  │   ├── per-employee `contributor in (...)` clauses
            │                                                  │   └── pagination start/limit cap=1000
            │                                                  └── ppFetchDevStatusForIssues (Jira dev-info → BB-data fallback)
            │                                                  ↓
            ◄── { reports[], bitbucket, confluence, diagnostics }
            │
            ├── analysePulse(raw, { employees }) ── PulseModel
            │   └── identity-deterministic attribution:
            │       - employees{} → byEmail/byJiraId/byBbLogin/byCfId indexes
            │       - participant.email/accountId → employee → bb/cf lookup by login/email
            │       - НЕ fuzzy
            │
            ├── _autofillEmployeeIdentities(model, state.employees)
            │   └── auto-заполняет email + jiraAccountId по FIO match
            │
            ├── buildInsights(model, opts) ── recommendations
            ├── buildMetrics(model)
            ├── buildBacklogModel(model)
            └── render via portfolioPulseRenderer.js
```

Файлы: `integrations/portfolioPulse*.js` (8 файлов суммарно).

### 2. Black Dashboard (Sigma goal-coverage)

Async-job pattern (большой long-running запрос):

```
[browser]                                            [server]
BlackDashboard.start()
  ├── POST /black-dashboard/start                ──► создаёт jobId, асинхронно запускает
  │                                                   многопроектный fetch goal-эпиков из Sigma
  │                                                   + раскрытие Domain-link → Delta tasks
  │                                                   + per-PK timeout, multi-concurrency
  │
  ├── poll GET /black-dashboard/status?jobId  ──►  { status:'running'|'done'|'error', progress, result? }
  │   (every 2s)
  │
  └── render когда status === 'done'
```

Файлы: `integrations/blackDashboard*.js` (4 файла).

### 3. Per-row sync (TechInfo + ручная синхронизация)

Пользователь кликает «🔄» на строке Реестра → синхронизирует одну Jira-задачу:

```
[browser]                                            [server]
syncJiraRow(row)
  └── proxyPost('/jira-issue', { key })          ──► fetch /rest/api/2/issue/{key}?expand=...
                                                       + parse response
                                                       + token via cfg.jiraToken
                                                       ↓
        ◄── { id, jiraStatus, jiraPriority, jiraType, jiraAssignee, ... }
  → mutates row через Reactive proxy
```

Аналогично `syncBitbucketRow`, `syncConfluenceRow` для других источников. Все используют `proxyPost` helper (timeout 90s, V17.2 I4c).

Файлы: `integrations/integrationsSync.js`, `views/integrationsView.js`.

## Path-cascade pattern

Confluence Cloud живёт на `/wiki/rest/api/...`, Server/DC — на `/rest/api/...`. Bitbucket — Cloud/Server тоже разные пути. Применён pattern «cascade» в **4 местах независимо**:

```js
const PATHS = [
  { tag: 'wiki-rest', url: `${base}/wiki/rest/api/content/search` },
  { tag: 'rest',      url: `${base}/rest/api/content/search` },
];
for (const p of PATHS) {
  const r = await fetch(p.url, ...);
  if (r.status === 401 || r.status === 403) return { authError: r.status };  // bail
  if (r.status >= 200 && r.status < 300) return r;                          // success
  // 404 → try next path
}
```

Где применён:
1. `ppFetchConfluenceActivity` (server.js)
2. `confluence-search` endpoint (server.js)
3. `verify-confluence` endpoint (server.js)
4. `confluence-resolve-user` endpoint (V17.2 I2c-G5, server.js)
5. `confluence-audit-logins` (V17.2 I2c-G7, server.js)

**При изменении** — изменения должны применяться во всех 5 местах, иначе непоследовательное поведение между sync и pulse.

> TODO: вынести cascade в shared helper `_cfPathCascade(paths, baseUrl, headers)`. Сейчас inline. См. также `dont-touch.md`.

## Configuration

Все конфиги хранятся в **`jira_config.json`** (рядом с `server.js`, **не** env). Frontend локально кэширует через localStorage `q2_integrations_v1`, но source of truth — server-side файл.

Поля:

```jsonc
{
  // Delta Jira
  "jiraBaseUrl": "https://company.atlassian.net",
  "jiraToken": "Bearer ...",
  "jiraProjectKeys": "PAY, SBOF, KYC",

  // Sigma Jira
  "sigmaJiraBaseUrl": "https://sigma.example.com",
  "sigmaJiraToken": "PAT-...",
  "sigmaGoalEpicKeys": "GOAL-1, GOAL-2, GOAL-3",

  // Bitbucket
  "bitbucketBaseUrl": "https://bb.example.com",
  "bitbucketToken": "Bearer ...",
  "bitbucketProjectKeys": "frontend-repo, backend-repo",   // или "PROJ" для project-walk

  // Confluence
  "confluenceBaseUrl": "https://corp.atlassian.net",
  "confluenceToken": "Bearer ...",
  "confluenceSpaceKeys": "DEV, PAY, SBOF",                 // V17.2 I2c — CQL space scope

  "activityWindowHours": 72,                                // V17.2 I2c — окно для Pulse / audit
  "allowInsecureTls": false,                                // для корп-MITM CA
  "sinceDate": "2025-01-01"
}
```

→ полный shape: см. `JIRA_DEFAULT_CONFIG` в `server.js`

## V17.2 ключевые изменения

| Что | Было | Стало |
|---|---|---|
| BB attribution | fuzzy 2-token overlap по ФИО | deterministic email/login lookup |
| CF activity | 48h global scan, post-filter, no pagination | 72h, per-employee `contributor in (...)`, pagination cap=1000 |
| CF coverage | только page edits | edits + comments + mentions |
| CF resolve | manual ввод confluenceAccountId | auto-resolve по email при сохранении в карточке |
| CF audit log | не было | `/confluence-audit-logins` endpoint + UI кнопка |
| Identity | unstructured | `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}` |
| `_ppFindByPartial` | production-active | dev-only за флагом `allowFuzzyAuthorMatch` |

См. `audit-2026-05-V17/13-integrations-audit.md` для полного описания.

## Когда писать код

- **Новый source данных** (например GitLab) → новая директория `integrations/<name>/` + endpoint `/api/integrations/<name>-*` + identity-поле в `EmployeeFactory` если нужна атрибуция
- **Расширение текущего pipeline'а** (например labels из Jira) → в `analysePulse` (frontend) + `jiraBuildReport` (server). Не проксируй сырые ответы — нормализуй до user-readable shape
- **Per-row sync поле** → `integrationsSync.js` + новое поле в `RowFactory.create`
- **Token handling** → ВСЕГДА через `_ppMakeAuthHeader` + регex-redact в error path → см. [`auth-and-secrets.md`](./auth-and-secrets.md)
