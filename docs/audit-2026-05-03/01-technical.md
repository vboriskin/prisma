# Audit 01 — Technical (Performance · Architecture · Backend · Frontend · Reliability · Security)

**Дата:** 2026-05-03
**Авторы:** 6 экспертов параллельно — Performance Engineer, Software Architect, Backend/Integrations Engineer, Frontend Engineer, Reliability/SRE Engineer, Security Engineer (CISO mindset).
**Скоп:** всё приложение (~49k LOC frontend + 3.4k LOC server.js + интеграции).

---

## TL;DR — что критично

| Severity | Кол-во | Категория |
|---|---|---|
| 🔴 Critical | 4 | No-auth API, SSRF, plaintext tokens, async-job loss on restart |
| 🟠 High | 18 | Server monolith, render perf, SQL/CQL injection, scrub gaps, registry full-rebuild |
| 🟡 Medium | 25 | Listener leaks, inconsistent retries, CSP `unsafe-inline`, duplicate state-subscribe машинерия, no DAU metrics |
| 🟢 Low | 12 | dead code, double-decomposition, vendored libs hashes, etc. |

**3 must-fix перед расширением пилота:**
1. **Auth модель** — нет реальной аутентификации, `?user=email` spoof тривиален. Без SAML/OIDC pilot >1 команды нельзя.
2. **SSRF в `/api/llm/chat`** — `body.apiBaseUrl` принимается как trusted, server подключается с `rejectUnauthorized:false`. Атакующий может target'ить internal endpoints.
3. **Async-job state в RAM** — Black Dashboard / Pulse jobs теряются при server restart, клиент остаётся с 404 polling.

---

## A. Performance — топ находок

| # | Что | Где | Severity | Effort |
|---|---|---|---|---|
| P1 | innerHTML rebuild Ганта целиком на каждый action | `views/gantt.js:1389` | 🟠 High | M |
| P2 | createElement-per-cell в Registry без virtualization (2k rows × 15 cols = ~30k DOM ops) | `views/registry.js:204-261` | 🟠 High | M |
| P3 | Sequential JQL pagination внутри одного PK | `server.js:660-670, 2274-2312` | 🟠 High | S |
| P4 | Полный `JSON.stringify(state.rows + employees)` на каждом save (200-500 KB на main thread) | `dataStore.js:70, 103` | 🟠 High | L |
| P5 | Scanner2 history: parse → findIndex → sort → stringify → setItem на каждый refresh | `teamScanner2History.js:107-124` | 🟡 Med | S |
| P6 | LRU eviction через `[…entries].sort()` O(n log n) на каждый 101-й insert | `server.js:1454-1456` | 🟡 Med | S |
| P7 | `participants.find` повторяется 4× на каждый panel-render | `teamScanner2.js:844, 1184, 1316, 1343` | 🟡 Med | S |
| P8 | Polling 2с × 30 мин = 900 запросов на 1 user (BD/Pulse `/status`) | `blackDashboard.js, server.js` | 🟡 Med | S |
| P9 | resolve-identities без server-side cache по email/fio | `server.js:3170-3186` | 🟡 Med | S |
| P10 | 84 `addEventListener` vs 16 `removeEventListener` в Scanner 2.0 | `teamScanner2.js` | 🟡 Med | M |
| P11 | 17 wholesale `innerHTML` rebuild в dashboard.js + metrics.js | `dashboard.js:33-282`, `metrics.js:×9` | 🟠 High | M |
| P12 | querySelectorAll в mousemove (resize-handle) | `views/registry.js:178-182` | 🟡 Med | XS |

**Bottleneck по сценариям:**
- Реестр cold load: 600-900 ms (parse + dropdown rebuild × 4 + row loop)
- Sprint switch: 250-500 ms jank (Gantt full re-render)
- Scanner 2.0 refresh: 3-6 sec end-to-end (sequential pagination + heatmap × 109 + history I/O)
- AI/LLM chat: typing-jank в длинных ответах (нет RAF batching при stream parse)

**Memory profile:**
- localStorage: 0.5–1 MB (близко к 5 MB cap при росте)
- Server memory leaks: `_pulseJobs`, `_rlBuckets` без TTL prune → ~5-10 MB/час за сутки
- Long-running tab 8ч: scanner2 history + 84 listeners на каждый pk-switch → heap растёт

---

## B. Архитектура — топ долгов

| # | Долг | Где | Risk | Effort |
|---|---|---|---|---|
| A1 | `server.js` monolith / inline routing — 30 inline `if (pathname===...)` в одном try/catch | `server.js:2206-3275` (`handleIntegrationsApi`) | 🟠 High | L |
| A2 | `teamScanner2Renderer.js` 3626 LOC — UI templating + бизнес-логика | весь файл | 🟠 High | L |
| A3 | `app.js` 1909 LOC — orchestrator + 10 утилит + global window-bag | `app.js` | 🟠 High | M |
| A4 | Direct `Storage.save()` calls в views — **196 раз** (race vs reactive flush) | `views/*.js` | 🟡 Med | S |
| A5 | Token plaintext в `jira_config.json` (laptop steal/backup leak) | `server.js:478` | 🔴 High security | M |
| A6 | Migration model `q2_*_v3` без runner'а — следующая миграция ломает 5+ точек | `dataStore.js:118-200`, `app.js:1833` | 🟠 High | M |
| A7 | Async-in-silent invariant — `Reactive.silent(async () => …)` теряет depth-counter | `reactiveStore.js:119`, `views/employees.js:303` | 🟡 Med | XS |
| A8 | Sigma fields в общем `jira_config.json` (cross-tenant leak vector) | `server.js:454` | 🟡 Med | M |
| A9 | `_ppFindByPartial` dead-code-still-callable — fuzzy за флагом `allowFuzzy` | `portfolioPulseModel.js:950` | 🟡 Med | XS |
| A10 | Two subscribe machineries (`state.subscribe` + `Reactive.subscribe`) | `state.js:177`, `reactiveStore.js:126` | 🟢 Low-Med | S |
| A11 | Mixed concerns: views делают fetch и identity-resolve | `views/employees.js:303-323` | 🟡 Med | S |
| A12 | Decomposition в `app/*` имеет circular deps risk через `window.App` | `app.js`, `app/*.js` | 🟢 Low | M |

**Vanilla-JS justification на 500+ employees:**
- ✅ Frontend оправдан до ~1000 users
- ❌ Server становится узким горлышком: уже implement'ирует mini-Express (rate-limit, metrics, async-jobs, middleware) — **дешевле принять одну зависимость** (fastify) чем продолжать самописное

---

## C. Backend / Integrations — топ находок

| # | Что | Severity | Где |
|---|---|---|---|
| B1 | Hard-coded `rejectUnauthorized:false` для GigaChat без env-override | 🔴 High | `server.js:234, 378` |
| B2 | CQL/JQL escape только `\"` — injection через unary operators / unicode | 🔴 High | `server.js:1646, 1697, 2884, 3083, 3124` |
| B3 | `body.projectKeys` admin-uncontrolled → попадает в JQL без whitelist | 🔴 High | `_runPortfolioPulse:1477` |
| B4 | `e.message` без `_ppRedactSecretsInText` в error responses (token-echo leak) | 🟠 High | `proxyChat:341`, разные routes |
| B5 | No `keepAlive` — TLS handshake на каждом запросе → +30-50s на bulk | 🟡 Med | `server.js` |
| B6 | Нет maxResponseBytes — OOM на huge changelog | 🟡 Med | `jiraForward:534` |
| B7 | TTL gc убивает running jobs | 🟡 Med | `jobs.js:53` |
| B8 | `/status` возвращает полный `result` при каждом polling (5-50MB JSON) | 🟡 Med | `server.js:2391` |
| B9 | Race на одновременном refresh GigaChat token | 🟡 Med | `_tokenCache:208` |
| B10 | Per-IP rate-limit, не per-user (за NAT все смешаны) | 🟢 Low | `server.js:116` |
| B11 | Zephyr `maxResults=200` без пагинации — silent truncation | 🟡 Med | `server.js:2049, 2087` |
| B12 | resolve-identities sequential CF cascade — 100+ users × ~110 sec | 🟡 Med | `server.js:3170-3186` |

---

## D. Frontend / Render — топ находок

| # | Что | Где | Severity |
|---|---|---|---|
| F1 | `tbody.innerHTML=''` + per-row N×addEventListener (нет event delegation) | `registry.js:200-262` | 🟠 High |
| F2 | `styles.css` 520KB single file, нет `contain:`/`content-visibility` | весь файл | 🟠 High |
| F3 | 17 wholesale innerHTML rebuilds в dashboard/metrics | `dashboard.js, metrics.js` | 🟠 High |
| F4 | Gantt innerHTML wipe → 2×rAF scroll-restore | `gantt.js:1389+1419-1434` | 🟠 High |
| F5 | Set/Map mutations не flush (контракт `Reactive.silent` не enforced) | `reactiveStore.js:81` + `registry.js:116` | 🟡 Med |
| F6 | 121 controls без aria-label, все секции в DOM (initial parse cost) | `index.html` (1164 строк) | 🟡 Med |
| F7 | 153 `!important` в CSS (specificity wars) | `styles.css` | 🟡 Med |
| F8 | `color-mix()` без `@supports` fallback (Safari <16.4) | `styles.css` (112 occurrences) | 🟡 Med |
| F9 | 540 `body.theme-dark` overrides (можно через CSS variables в 1×) | `styles.css` | 🟡 Med |
| F10 | querySelectorAll в mousemove (registry resize) | `registry.js:178-182` | 🟡 Med |
| F11 | Layout thrashing read/write loops в Gantt | `gantt.js:147, 209, 1621, 2141` | 🟢 Low |
| F12 | `Reactive.flushNow()` ни разу не вызывается — задокументированный контракт нарушен | global | 🟡 Med |

---

## E. Reliability — топ дыр

| # | Gap | Severity |
|---|---|---|
| R1 | Async-job state в RAM → server restart = orphan jobs (404 polling) | 🔴 High |
| R2 | Silent `catch(_) {}` без telemetry в десятках мест | 🟠 High |
| R3 | Cross-tab — двойной listener: toast + silent reload одновременно | 🟠 High |
| R4 | Нет `beforeunload` flush на debounced save (400ms окно потери данных) | 🟡 Med |
| R5 | Corrupt JSON в localStorage → silent reset без уведомления | 🟡 Med |
| R6 | Нет client→server error reporter; ErrorsLog только локально | 🟡 Med |
| R7 | Нет p95/error-rate/DAU метрик; `/metrics` = плоские счётчики | 🟡 Med |
| R8 | Snapshot non-atomic: 2 ключа localStorage пишутся раздельно | 🟡 Med |
| R9 | Partial-data из Pulse/BD без user-visible "partial" badge | 🟡 Med |
| R10 | Нет circuit-breaker per integration: одна Jira-проблема плодит retries | 🟢 Low-Med |
| R11 | GigaChat token expiry mid-stream — НЕ обработан | 🟡 Med |
| R12 | localStorage QuotaExceeded — `errorsLog` урезает себя без warning | 🟡 Med |

---

## F. Security — Top-10 vulnerabilities

| # | Finding | CVSS-like | Loc |
|---|---|---|---|
| 1 | **No authentication / auth-z** на любом `/api/*` | 9.6 🔴 Critical | `server.js:3346–3403` |
| 2 | **SSRF via `body.apiBaseUrl`** в `/api/llm/chat` + `rejectUnauthorized:false` | 8.6 🔴 High | `server.js:351, 378` |
| 3 | **CQL injection** в confluence-resolve-user (только `"` escape, нет `\` neutralisation) | 7.5 🟠 High | `server.js:2884–2895` |
| 4 | **Tokens persisted plaintext** в `jira_config.json` + `localStorage` (`q2_integrations_v1`); `loadSettingsForUI` возвращает raw token в JS | 7.4 🟠 High | `integrationsStore.js:84` + FS |
| 5 | **User identity client-supplied** (`?user=email` для scanner-prefs) — full spoof | 7.2 🟠 High | `server.js:2951` |
| 6 | **CSP allows `unsafe-inline`** + ~234 raw `innerHTML` sites + Jira/BB content без sanitization → stored XSS via Jira summary | 7.0 🟠 High | `server.js:3329`, `views/*.js` |
| 7 | **`rejectUnauthorized:false`** unconditional для GigaChat OAuth+chat — MITM в corp net | 6.5 🟡 Med-High | `server.js:234,378,530` |
| 8 | **No CSRF protection** + no CORS allowlist | 6.1 🟡 Medium | global |
| 9 | **Missing audit log для config mutations** (POST `/api/jira/config`) — silent token replacement | 5.8 🟡 Medium | `server.js:484` |
| 10 | **Email в plaintext в log/event/URL/access.log** (152-ФЗ violation potential) | 5.4 🟡 Medium | `server.js:2978, 2951` |

**Vendored libs:**
- `xlsx.full.min.js` 0.20.3 — CVE-2023-30533 (pp), CVE-2024-22363 (ReDoS) **fixed**. Recommend bump до 0.20.4 + verify SHA256 checksum.
- `sql-wasm.js` 1.10.3 (sql.js) — current, no open CVEs.

---

## G. Идеи развития (35+)

### Performance
1. **IndexedDB** для `state.rows` + scanner2 history — async, без 5MB cap
2. **Web Worker** для `enrichForScanner2` + heatmap calc (109 × 72ч timeline)
3. **Service Worker** как HTTP cache layer для Jira/BB/CF GET с stale-while-revalidate; offline read-only Реестр/Гант
4. **SSE/WebSocket** вместо polling для Pulse/BD статусов
5. **Streaming render (windowed virtualization)** Registry/Gantt — recycle DOM nodes
6. **HTTP/2 через `node:http2`** на server.js — multiplexing
7. **Reactive batching через microtask** — RAF-debounced flush; сейчас каждая правка = save+render
8. **`content-visibility: auto`** на длинных секциях (registry, gantt, kanban) — 30-50% scroll FPS бесплатно

### Архитектура
9. **Event bus** вместо двух subscribe'ов + Proxy-flush — typed channels (`row.changed`, `import.complete`, ...)
10. **Repository pattern** для persistence — RowRepository/EmployeeRepository/SettingsRepository с pluggable backend
11. **Server feature-services split** — `routes/{static,llm,jira,integrations,telemetry}.js` + `middleware/{rateLimit,bodyParse,scrub,metrics,error}.js` через `compose([])`
12. **TypeScript migration постепенно** — сначала server.js, потом state/dataStore/rowFactory
13. **Module federation / lazy import** — `ai/`, `chat/`, `gantt/`, `teamScanner2*` через dynamic `import()`
14. **Identity service consolidation** — `services/identity.js` фронт+сервер с одним API
15. **DTO contracts через JSON Schema + ajv** — schema-validate каждый `/api/integrations/*`

### Backend / Integrations
16. **WebSocket вместо polling** — `ws://localhost/jobs` push'ит phase-updates (-900 req/job)
17. **Bulk fetch optimization (GraphQL-like field selection)** — `{ fields: ['heatmap','blockers'] }`
18. **Server-side cache layer** общий `cacheGet/cacheSet(key, ttl, fn)` поверх Map с per-key promise-locking
19. **Circuit breaker per integration** — opossum-style без deps
20. **Prometheus metrics endpoint** — `/metrics?format=prom` text exposition
21. **Persistent jobs (file-backed)** — recover на restart
22. **Per-user budget + quota visibility** — `X-LLM-Budget: 234/5000` header

### Frontend
23. **Web Components** для `EmptyState`, `KpiCard`, `Chip`, `RiskBadge`, `JiraTagLink`
24. **CSS containment** + per-view split + critical inline в `<head>`
25. **Lazy view mount** — `<template>` injection вместо всех 18 секций сразу
26. **View Transitions API** для smooth section-switch
27. **Virtual list mini-lib** ~80 LOC через `IntersectionObserver`
28. **Reactive granular subs** — `Reactive.subscribe(fn, paths?)` с path-фильтром

### Reliability
29. **Deep `/health/ready`** — dry-ping каждой интеграции, status matrix
30. **Persisted async jobs** через append-only `tmp/jobs.ndjson`
31. **Atomic snapshot** — `_tmp` rename pattern или single-payload key
32. **Auto-cloud-backup** опциональный — JSON-snapshot в Confluence/git раз в сутки
33. **Latency histogram + DAU** — rolling buckets, Prometheus expose

### Security
34. **Reverse-proxy + WAF (nginx + ModSecurity OWASP CRS)** — bind server.js на UNIX socket
35. **SAML/OIDC SSO via WAF (Sber STS)** — signed `X-Forwarded-User`
36. **Secrets manager** (HashiCorp Vault / Sber Vault) — `{ "tokenRef": "vault:..." }`
37. **DLP scan в export pipeline** — TIN/INN/SNILS/passport regex+ML scan
38. **Strict CSP без unsafe-inline** — nonce-based, migrate `innerHTML` к `<template>` + `textContent`
39. **SSRF allowlist** — hostname regex для `apiBaseUrl`/`jiraBaseUrl`
40. **Pen-test scope** — внешний red-team: token-leak via crafted CSV, SSRF, CSP-bypass, scanner-prefs cross-user

---

## H. Топ-10 must-fix перед рост-up до 500+

1. ✅ **Auth model** (SAML/OIDC через WAF) — без этого rollout >1 команды нельзя
2. ✅ **SSRF allowlist** для `apiBaseUrl` + secrets manager
3. ✅ **Async-job persistence** (jobs/*.ndjson) — recover на restart
4. ✅ **Server.js routing split** — middleware pipe + feature routes
5. ✅ **Repository pattern** persistence — eliminate 196 ad-hoc `Storage.save()` calls
6. ✅ **Migration runner** для `q2_*_v3 → _v4`
7. ✅ **Connection pooling** (`keepAlive`) + circuit breakers per integration
8. ✅ **Strict CSP без unsafe-inline** + sanitize Jira/BB rendered content
9. ✅ **Latency histogram + p95** в /metrics + Prometheus pipeline
10. ✅ **Renderer split + virtualization** для Registry/Gantt → 500+ rows без jank

---

**Файлы для глубокого внимания:**
- `server.js` (3430 LOC) — критический monolith
- `integrations/teamScanner2Renderer.js` (3626 LOC) — UI god-module
- `app.js` (1909 LOC) — остаточный orchestrator
- `views/registry.js`, `views/gantt.js` — perf hotspots
- `dataStore.js`, `errorsLog.js`, `reactiveStore.js` — reliability foundation
- `integrations/portfolioPulseModel.js`, `teamScanner2Enrichment.js` — heavy compute
