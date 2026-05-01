# 06. Интеграции (Jira / BB / CF / GigaChat)

## Покрытие API

### Jira REST 2.0

| Endpoint | Используется? |
|---|---|
| `/rest/api/2/myself` | ✓ verify, tech-info |
| `/rest/api/2/serverInfo` | ✓ tech-info |
| `/rest/api/2/search` (POST) | ✓ jiraSearchAll, основной путь |
| `/rest/api/2/issue/{key}` | ✓ jira-issue endpoint |
| `/rest/api/2/project` | ✓ tech-info |
| `/rest/api/2/project/{key}/statuses` | ✓ tech-info |
| `/rest/api/2/project/{key}/versions` | ✓ tech-info |
| `/rest/api/2/project/{key}/components` | ✓ tech-info |
| `/rest/api/2/issuetype` | ✓ tech-info |
| `/rest/api/2/status` | ✓ tech-info |
| `/rest/api/2/priority` | ✓ tech-info |
| `/rest/api/2/resolution` | ✓ tech-info |
| `/rest/api/2/field` | ✓ tech-info, sprint discovery, zephyr discovery |
| `/rest/api/2/customField/{id}/option` | ✓ tech-info (cap 20) |
| `/rest/api/2/issueLink` | ✗ **НЕ используется** (но в FOUND_BUGS отмечена потенциальная польза) |
| `/rest/api/2/jql/autocompletedata` | ✗ — не критично |
| `/rest/agile/1.0/board` | ✓ tech-info |
| `/rest/agile/1.0/board/{id}/sprint` | ✓ tech-info |
| `/rest/dev-status/1.0/issue/detail` | ✓ Phase 1 PR/commits |

**Что не используется, но могло бы**:
- `/rest/api/2/issuetypeschemes/project` — узнать какие типы доступны на конкретном проекте (сейчас угадываем).
- `/rest/api/2/screens/...` — какие поля видны (для tech-info).

### Bitbucket Server 1.0

| Endpoint | Используется? |
|---|---|
| `/rest/api/1.0/application-properties` | ✓ tech-info |
| `/rest/api/1.0/projects` | ✓ tech-info |
| `/rest/api/1.0/repos` | ✓ tech-info |
| `/rest/api/1.0/projects/{k}/repos/{r}/branches` | ✓ tech-info |
| `/rest/api/1.0/projects/{k}/repos/{r}/pull-requests` | ✓ ppFetchBitbucketActivity |
| `/rest/api/1.0/projects/{k}/repos/{r}/pull-requests/{id}/activities` | ✓ wave 4d |
| `/rest/api/1.0/projects/{k}/repos/{r}/commits` | ✓ ppFetchBitbucketActivity |
| `/rest/api/1.0/users` | ✗ — мог бы помочь cross-script matching, но используем dev-status вместо |

**Bitbucket Cloud (`bitbucket.org`)**: detect'ed но **не реализован** в tech-info (returns `{cloudUnsupported:true}`). В `ppFetchBitbucketActivity` Cloud-path есть (server.js:687-723), но не везде.

### Confluence REST

| Endpoint | Используется? |
|---|---|
| `/rest/api/user/current` | ✓ tech-info, verify |
| `/rest/api/settings/systemInfo` | ✓ tech-info (best-effort, 403 OK) |
| `/rest/api/space` | ✓ tech-info |
| `/rest/api/space/{key}/label` | ✓ tech-info |
| `/rest/api/template/page` | ✓ tech-info |
| `/rest/api/content/search?cql=...` | ✓ ppFetchConfluenceActivity (Phase 2 cascade) |
| `/rest/api/content/{id}/version` | ✗ **НЕ используется** (для history view'а страниц мог бы) |

### GigaChat

| Endpoint | Используется? |
|---|---|
| `/api/v1/oauth` | ✓ token refresh |
| `/api/v1/chat/completions` | ✓ proxyChat |
| Streaming SSE | ✓ |

**Что не разбирался**: GigaChat API я не знаю в деталях.

## Обработка пагинации

### Jira `/search`
`jiraSearchAll` (server.js:441-460):
```js
while (true) {
  const data = await jiraRequest(cfg, 'POST', '/rest/api/2/search', { jql, startAt, maxResults: 100, fields, expand });
  out.push(...data.issues);
  if (issues.length < 100) break;
  if (out.length >= (data.total || out.length)) break;
  if (startAt > hardCap) break;
  if (elapsed > timeBudgetMs) break;
  startAt += issues.length;
}
```

**Корректно**: пагинация полная, есть hardCap и timeBudget. Хорошо.

**НО**: cap'ы (sprint=500, recent=400, inProgress=500, backlog=200) — для больших проектов могут отрезать данные. Видел в логах `pulse]: ... 500 issues` — значит уперлись. Tech-info Jira показывает полный список без пагинации (для 100+ projects может усечь, но это OK для diagnostics).

### Bitbucket — НЕТ полной пагинации

```js
// server.js:732 — pull-requests
const prsResp = await get(`...pull-requests?state=ALL&order=NEWEST&limit=50`);
```

**Только первая страница**. Если в репо PR'ов больше 50 за 48ч — урежется. Аналогично с commits (`limit=100`).

**Severity**: M. Для крупных моно-репо с активной разработкой — потеряем 50+ PR'ов в день.

### Confluence — нет полной пагинации

```js
// server.js:1373 — search
const url = `${path.url}?cql=${...}&limit=100&expand=version,space`;
```

**Только первая страница** (limit=100). Если за 48ч страниц больше 100 — урежется.

## Retry / backoff

### Jira (server.js:418-432)

```js
async function jiraRequest(cfg, method, apiPath, body, maxRetries=2) {
  let delay=2000;
  for (let i=0; i<=maxRetries; i++) {
    const resp = await jiraForward(...);
    if (resp.status===429) {
      const wait = parseInt(resp.headers['retry-after']||'0',10);
      await jiraSleep(Math.min(wait>0?wait*1000:delay, 8000));
      delay = Math.min(delay*2, 8000);
      continue;
    }
    return jiraParseResp(resp, 'Jira');
  }
}
```

**Retry только на 429** (rate limit). На 500 / 502 / 503 — не повторяется. Это **дыра** — Jira иногда возвращает 502 при reverse-proxy, и pulse падает на одном PK.

**Severity**: M.

### Bitbucket
```js
const get = (url) => jiraForward({...}).catch(e => ({ status: 0, text: '', _err: e.message }));
```

**Никаких retry**. На любую сетевую ошибку — `_err` записан, идём дальше. Это OK для best-effort, но agressive timeout (20s) может промахнуться без retry.

### Confluence

То же самое — `tryFetch(...).catch(e => ({...}))`. Без retry.

## JQL/CQL — экранирование

### Jira JQL

```js
// server.js:524-533 — пример
const queries = [
  { name: 'sprint',     jql: `project="${pk}" AND sprint in openSprints()`, ... },
  { name: 'recent',     jql: `project="${pk}" AND updated >= -3d`, ... },
  { name: 'inProgress', jql: `project="${pk}" AND statusCategory = "In Progress"`, ... },
  { name: 'backlog',    jql: `project="${pk}" AND statusCategory != Done AND (sprint is EMPTY OR sprint not in openSprints())`, ... },
];
```

**`pk` — пользовательский ввод** из `cfg.jiraProjectKeys`. Если admin введёт `PAY" OR sprint = "evil`, JQL injection проходит:
```
project="PAY" OR sprint = "evil" AND sprint in openSprints()
```

**Реалистичность атаки**: пользователь сам себе вредит, потому что у него же кредентиалы admin'а Jira. **Severity**: L (insider threat only). Но защититься — прямая лучшая практика (pk должен быть `[A-Z][A-Z0-9_]+` regex).

### CQL Confluence

```js
// server.js:1340 onwards
const CQLS = [
  { tag: 'modern',  cql: `lastmodified > "now('-48h')"` },
  { tag: 'legacy',  cql: `lastmodified > "${isoCutoffShort}"` },
  ...
];
```

`isoCutoffShort` — server-derived, не user-input. **Безопасно**.

### Sigma → Delta batch (`sigmaFetchDeltaIssuesByKeys`)

```js
// server.js:1830 onwards
const jql = `key in (${chunk.map(k => `"${k}"`).join(',')})`;
```

`chunk` — keys из Sigma `Domain link` field. Прошёл через `_parseDomainLink` → regex `/^[A-ZА-Я][A-ZА-Я0-9]+-\d+$/`. **Безопасно** благодаря regex-фильтру.

## GigaChat OAuth

Не разбирался глубоко. Вижу:
- `_tokenCache` (`server.js:124`) — `clientId → { token, expiresAt }`
- `getAuthToken(...)` где-то рядом

**NEW-12**: при истечении token'а нет автоматического refresh. Проверь.

## Streaming SSE

LLM-proxy транслирует SSE chunks от GigaChat обратно в браузер. Не разбирался. Возможные проблемы:
- Что если client отвалился на середине streaming'а? Сервер должен закрыть upstream connection — посмотреть.
- timeout'ы на SSE? Не нашёл.

## fake Jira vs реальный 8.20.11

Сравнение `contractTest.js` fake'а с реальным Jira 8.20.11:

| Aspect | Fake | Реальный |
|---|---|---|
| `/rest/api/2/myself` shape | `{displayName, name, emailAddress, active}` | OK |
| `/rest/api/2/search` shape | `{issues, total, startAt, maxResults}` | OK |
| changelog в issue | присутствует, `histories[]` | OK |
| `customfield_10020` (sprint) | ✓ array | OK |
| Rate limit 429 with Retry-After | НЕ симулируется | реальный Jira может 429 |
| Slow response (>5s) | НЕ симулируется | в production бывает |
| Network errors | НЕ симулируется | бывает |
| Pagination beyond 100 | НЕ тестируется | реальный — пагинирует |

**Дыры**: contract-тесты не покрывают сетевые ошибки и таймауты. Реальные баги с retry-логикой не поймаем.

## Заключение

Категория | Оценка
---|---
Покрытие API | хорошо — основные endpoint'ы используются |
Пагинация | удовлетворительно — Jira полная, BB/CF только первая страница |
Retry/backoff | плохо — только Jira 429, ничего на 500/502 |
JQL/CQL safety | удовлетворительно — пользовательский pk не санитизируется (но low-risk) |
GigaChat OAuth refresh | плохо — NEW-12, истекает молча |
SSE streaming | не разбирался |
Contract test fidelity | удовлетворительно — happy path OK, error scenarios нет |
