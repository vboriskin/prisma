# 05. Server

## SRV-1 [M] Декомпозиция server.js частична — Portfolio Pulse и Jira API остались inline

**Файл**: `server.js` (1828 LOC)

V13 декомпозиция #19 вынесла:
- `server/integrations/techInfo.js` (589 LOC)
- `server/integrations/blackDashboard.js` (255 LOC)

Не вынесено:
- **Portfolio Pulse** (`ppFetchBitbucketActivity` 220 LOC, `ppFetchDevStatusForIssues` 150 LOC, `ppFetchConfluenceActivity` 150 LOC, `_ppMergeAuthorMaps` 30 LOC) — **все** вокруг `_ppMakeAuthHeader` который сейчас shared с tech-info.
- **GigaChat proxy** (`proxyChat`, `gigachatGetToken`, `forwardSSEOrChunk` ~210 LOC).
- **Jira API infrastructure** (`jiraRequest`, `jiraSearchAll`, `jiraResolveSprintFieldId`, `jiraResolveZephyrResultFieldId`, `jiraBuildAreaReport` ~300 LOC).
- **Static handler + security headers** (`serveStatic` 60 LOC).
- **`handleJiraApi` + `handleIntegrationsApi`** route handlers (~400 LOC).

**Severity**: M (декомпозиция продолжается, не критика).

**Рекомендация**: следующая итерация — `server/jiraApi.js` (Jira infrastructure, общий для всех интеграций) + `server/integrations/portfolioPulse.js`. Они **больше** связаны через `_ppMakeAuthHeader` и `jiraSearchAll`, чем через прямые вызовы — DI-фабрика подойдёт по тому же шаблону.

---

## SRV-2 [M] `proxyChat` — нет timeout cap на upstream stream (NEW-12 частично)

**Файл**: `server.js:207-326` (proxyChat)

V12 audit #9: «Не логировать в proxyChat без timeout-cap». Реализован `r.setTimeout(timeoutMs, ...)` на initial connect, но **на сам stream** (между chunk'ами) — нет idle-timeout. Если upstream GigaChat зависнет в середине ответа — клиент просто будет висеть.

**Severity**: M.

**Рекомендация**: добавить idle-timeout на client-side stream (как в jiraForward) либо through-pipe abort через AbortController.

---

## SRV-3 [M] `_jiraSprintFieldIdCache` / `_zephyrResultFieldIdCache` — глобальные mutable, не thread-safe

**Файл**: `server.js:497-535`

```js
const _SPRINT_TTL = 30 * 60 * 1000;
let _jiraSprintFieldIdCache = { url: '', id: '', at: 0 };
async function jiraResolveSprintFieldId(cfg) {
  // ... read cache; if stale → fetch + write cache
}
```

Two parallel requests both miss cache → both call `jiraRequest('/field')` → both write the same cache entry. **Cache stampede**, аналогичный NEW-5 для Tech Info.

Также: после `jiraWriteConfig` cache не invalidated (REL-8).

**Severity**: M.

**Рекомендация**: single-flight + invalidate on config-write (см. REL-4, REL-8).

---

## SRV-4 [M] handleIntegrationsApi — gigantic switch (380 LOC), нет роутинга

**Файл**: `server.js:1311-1690` (примерно)

```js
async function handleIntegrationsApi(req, res, pathname) {
  // ...
  if (pathname === '/api/integrations/jira-issue') { ... return; }
  if (pathname === '/api/integrations/portfolio-pulse') { ... return; }
  if (pathname === '/api/integrations/jira-fetch-all') { ... return; }
  if (pathname === '/api/integrations/bitbucket-prs') { ... return; }
  if (pathname === '/api/integrations/confluence-search') { ... return; }
  if (pathname === '/api/integrations/verify-bitbucket') { ... return; }
  if (pathname === '/api/integrations/sigma-verify') { ... return; }
  if (pathname === '/api/integrations/tech-info') { ... return; }
  if (pathname === '/api/integrations/black-dashboard') { ... return; }
  if (pathname === '/api/integrations/verify-confluence') { ... return; }
}
```

Каждая ветка — 20-100 LOC. Один большой try/catch снаружи. Если в одной ветке throw — общий catch на `pathname`-уровне отдаёт 500 без знания контекста.

**Эффект**: сложно тестировать, сложно читать, сложно расширять.

**Severity**: M.

**Рекомендация**: разделить на 10 отдельных handler-функций + минимальный роутер:
```js
const ROUTES = {
  '/api/integrations/jira-issue':       handleJiraIssue,
  '/api/integrations/portfolio-pulse':  handlePulse,
  // ...
};
async function handleIntegrationsApi(req, res, pathname) {
  const handler = ROUTES[pathname];
  if (!handler) return writeJson(res, 404, { error: 'Unknown route' });
  try { await handler(req, res); }
  catch (e) { writeJson(res, 500, { error: e.message }); }
}
```
В новых модулях — каждый handler с попутными контракт-тестами.

---

## SRV-5 [M] `jiraSanitizeAreas` принимает массив `{name, projectKey}` без длины-кэпа

**Файл**: `server.js:357-365`, вход — POST `/api/jira/config`

```js
function jiraSanitizeAreas(areas) {
  if (!Array.isArray(areas)) return [];
  const seen = new Set(), out = [];
  for (const a of areas) {           // ← нет cap на length
    const pk = String(a.projectKey||'').trim(), nm = String(a.name||pk||'').trim();
    if (!pk || seen.has(pk)) continue;
    seen.add(pk); out.push({ name:nm, projectKey:pk });
  }
  return out;
}
```

Размер тела ограничен 512 KB через `readBody(req, 512*1024)`. Но 512 KB можно разбить на ~3 000 областей. После записи в `jira_config.json` каждый запрос `jiraReadConfig()` парсит этот мусор.

**Severity**: M (DoS-amp).

**Рекомендация**: cap `areas.length` на 500 (или 100). Cap `name`/`projectKey` length на 50.

---

## SRV-6 [L] HTTP keep-alive не настроен явно

**Файл**: `server.js:1751` (`http.createServer`)

Default Node.js HTTP server использует keep-alive с `keepAliveTimeout = 5000` ms. Корпоративные load-balancer'ы (если есть) могут иметь больший timeout — несовпадение приводит к flaky 502 (server закрывает раньше LB).

**Severity**: L (текущий deployment, по факту, single-host без LB).

**Рекомендация**: при появлении LB — выровнять `server.keepAliveTimeout` и `server.headersTimeout` под него.

---

## SRV-7 [L] `/metrics` — без auth

**Файл**: `server.js:1762-1790`

```js
if (pathname === '/health') return writeJson(res, 200, {...uptime...});
if (pathname === '/metrics') return writeJson(res, 200, {...counters...});
```

Любой, у кого есть network-access к серверу, может получить metrics (request counts, 4xx/5xx breakdowns). В корпоративной сети это OK, но если когда-то засветится в публичном net — info disclosure.

**Severity**: L.

**Рекомендация**: документировать в `ARCHITECTURE.md § Security` что endpoint без auth и предполагает trusted-network deployment.

---

## SRV-8 [L] Декомпозированные модули используют `require(...)` (CommonJS) вместо `import`

**Файл**: `server.js:1118, 1128`, `server/integrations/techInfo.js`, `server/integrations/blackDashboard.js`

server.js стилем CommonJS. Декомпозиция логично продолжила этот стиль. Но это контрастирует с остальным проектом (frontend — ESM).

**Severity**: L (выбор архитектуры; просто несогласованность).

**Рекомендация**: при следующем рефакторе server.js — мигрировать на ESM (`type: "module"` в `package.json` уже неявно частично работает для frontend через `<script type="module">`). Но это значимый refactor, не делать «по случаю».

---

## SRV-9 [L] `jiraForward` отдаёт `text` как `Buffer.concat(chunks).toString('utf8')` независимо от content-type

**Файл**: `server.js:401-403`

Если upstream вернёт **бинарный ответ** (например, `image/png` для аватарки), `toString('utf8')` испортит данные. В контексте Jira/BB/CF API это редко применимо (всё JSON), но если когда-нибудь добавится файлоскачивание — баг.

**Severity**: L.

**Рекомендация**: сейчас documented limitation; при появлении binary endpoint — отдельный путь.

---

## Что **хорошо** про сервер в V13

✅ **`fs.realpathSync`** для path-traversal — закрыт NEW-7.
✅ **CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy** — на месте.
✅ **Rate limit per-IP** с `Retry-After` header (429 правильный).
✅ **Body-size cap** на каждом endpoint.
✅ **Retry on 502/503/504** в `jiraRequest` — V12 audit #10 ✓.
✅ **Promise.allSettled** для параллельных fetch'ей (Tech Info, Pulse).
✅ **Token sanitisation в GET-config** — `hasJiraToken: bool`, не сам токен.
✅ **Health & metrics endpoints** — observability.
✅ **Graceful shutdown в `launch.js`** (SIGINT/SIGTERM forward).
✅ **Декомпозиция через factory + DI** — Tech Info / Black Dashboard вынесены чисто, без circular deps.
✅ **Contract-тесты** покрывают все integration endpoints (11 cases).
✅ **`_ppMakeAuthHeader`** — единая логика Bearer/Basic auth для трёх сервисов.
