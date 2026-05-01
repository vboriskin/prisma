# 01. Security

## SEC-1 [H] SSRF surface через `/api/jira/config` POST

**Файл**: `server.js:1266-1290`, `server.js:388-413` (`jiraForward`)

`POST /api/jira/config` принимает строки `jiraBaseUrl`, `bitbucketBaseUrl`, `confluenceBaseUrl`, `sigmaJiraBaseUrl` без валидации схемы или хоста. Затем `jiraForward({targetUrl: ...})` парсит URL через `new URL(...)` и пускает запрос:

```js
function jiraForward({ targetUrl, ... }) {
  let parsed;
  try { parsed = new URL(targetUrl); } catch(e) { return reject(...); }
  const lib = parsed.protocol==='https:' ? https : http;
  // ничего не проверяет: schema, hostname, port, IP-class
}
```

**Демонстрация уязвимости**:

```js
new URL('http://169.254.169.254/latest/meta-data/')   // → AWS metadata service
new URL('http://localhost:8080/admin')                 // → внутренний сервис
new URL('file:///etc/passwd')                          // → парсится! (lib=http defaults)
new URL('gopher://1.2.3.4/')                           // → парсится!
```

`lib = parsed.protocol==='https:' ? https : http;` — для НЕ-`https:` всегда падает в `http`. Для `file:` это значит, что `http.request({hostname: ''})` отвалится (good). Но `gopher://` или какой-нибудь RPC port (DNS/redis/etc.) пройдёт.

**Эффект**:
- Конфиг персистентен — администратор сохранил вредоносный URL → каждый последующий вызов `tech-info`, `jira-issue`, `pulse` шлёт credentials туда, куда указал злоумышленник.
- В мульти-tenant сценарии (несколько пользователей делят один сервер) — крит-уязвимость.
- В intra-corp single-tenant — **существенно ниже**, но всё равно неприятно: пользователь может случайно прописать `localhost:11211` (memcached) и получить garbled JSON-error от чужого сервиса.

**Severity**: H (mitigation — допустимо в текущем deployment-сценарии, но не задокументировано).

**Рекомендация**:
1. Валидировать схему: только `http:` / `https:`.
2. Резолвить hostname → IP, отклонять loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`), private RFC1918 если деплоймент публичный.
3. Документировать эту policy в `ARCHITECTURE.md` § Security.

---

## SEC-2 [M] CSP `unsafe-inline` script-src — есть рантайм-привязки `onclick="..."`

**Файл**: `server.js:1734-1748` (CSP заголовок), `integrations/blackDashboardRenderer.js:73`, `integrations/portfolioPulseRenderer.js:96, 749, 776, 790`

CSP установлен как:
```
script-src 'self' 'unsafe-inline';
```

Комментарий в server.js (lines 1724-1728) объясняет: `'unsafe-inline'` нужен для inline event handlers и стилей. Тесты подтверждают — встречается `onclick="event.stopPropagation()"` в динамически генерируемом HTML (`integrations/blackDashboardRenderer.js:73`).

**Эффект**: при наличии любого `innerHTML` без эскейпа (95 lint warnings подтверждают наличие таких мест), злоумышленник может внедрить inline-JS, которое CSP пропустит.

**Severity**: M — XSS surface существует (см. SEC-3), CSP не блокирует.

**Рекомендация**: заменить `onclick="event.stopPropagation()"` на per-element `addEventListener` (можно делегатом). После — переключить CSP на `'self'` без `'unsafe-inline'` для script-src. Style-src оставить `'unsafe-inline'` (157 inline-style writes — миграция дороже выигрыша).

---

## SEC-3 [M] 95 raw-innerHTML lint warnings — XSS surface не закрыт

**Файлы**: распределены по `views/*`, `integrations/*Renderer.js`. Топ-3:
- `views/metrics.js` — 40 warning
- `app.js` — 32 warning
- `views/gantt.js` — 19 warning

ESLint custom-rule `local/no-unescaped-innerhtml` маркирует места, где интерполяция в template literal не обёрнута в `esc()` / `Utils.escapeHtml` / `safeUrl`. Audit #1 (2026 — год назад) ввёл это правило с целью миграции; миграция **не завершена**.

**Эффект**: для каждого warning **нужно проверить**, что источник данных не идёт от пользователя/Jira-summary/Confluence-page-title. Если идёт — XSS возможен.

Спот-чек на одном из мест в `app.js:986`:
```js
warning  innerHTML interpolation must be wrapped in esc()
```
— это поле имени проекта, которое ИДЁТ из `cfg.jiraProjectKeys`. Хоть config admin-controlled, но **persistent stored XSS** через POST `/api/jira/config` всё равно теоретически возможен.

**Severity**: M (defense-in-depth; до публичного deployment'а — H).

**Рекомендация**: разделить 95 warnings на 3 категории:
- (а) Полностью статичный контент (нумерик/enum) — задокументировать в `// eslint-disable-line` с пояснением, **не убирать через `--fix`**.
- (б) Контент из Jira/BB/CF — обернуть в `esc()`.
- (в) Контент из user-input — обернуть в `esc()` обязательно.

После триажа цель — **0 warnings**, и в CI поднять `--max-warnings 0`.

---

## SEC-4 [L] Path-traversal: TOCTOU между `realpathSync` и `readFile`

**Файл**: `server.js:1689-1750` (`serveStatic`)

После V12 рекомендации #8 защита идёт так:
```js
let resolvedFile;
try { resolvedFile = fs.realpathSync(filePath); }
catch (_e) { resolvedFile = path.resolve(filePath); }
if (!resolvedFile.startsWith(ROOT + path.sep) && resolvedFile !== ROOT) {
  res.writeHead(403, ...); return;
}
fs.readFile(filePath, ...);   // ← использует ИСХОДНЫЙ filePath, не resolvedFile
```

Если между `realpathSync(filePath)` и `fs.readFile(filePath, ...)` злоумышленник заменит symlink в ROOT (TOCTOU race), `readFile` прочитает новый target. На single-host/single-user OK, в shared-hosting сценарии может быть эксплуатируемо.

**Severity**: L (требует write-доступа в ROOT для эксплуатации — если он есть, проблема в любом случае).

**Рекомендация**: использовать `fs.readFile(resolvedFile, ...)` вместо `filePath`.

---

## SEC-5 [L] Bundle-CSV import: ALLOWLIST реализован, но whitelist неполный

**Файл**: `dataStore.js:317-354`

V12 закрыл NEW-13 — ALLOWED_BUNDLE_KEYS контролирует, какие keys из CSV-bundle попадают в localStorage. Но текущий список содержит `q2_action_log_v1` (history log). История — это log, **не настройка**, и импортировать чужую историю в свою сессию (а) бессмысленно, (б) даёт audit-log poisoning surface.

```js
const ALLOWED_BUNDLE_KEYS = new Set([
  'q2_plan_v3', 'q2_plan_v2', 'q2_plan',
  'q2_settings_v3', 'q2_settings_v2', 'q2_settings',
  'q2_onboarding_v1',
  'sbof_app_settings_v1',
  'welcomeShown',
  'dataStorageMode',
  'q2_action_log_v1',     // ← вопрос: зачем это в bundle?
]);
```

**Severity**: L.

**Рекомендация**: убрать `q2_action_log_v1` из allowlist. История должна экспортироваться/импортироваться отдельной командой, если вообще нужно.

---

## SEC-6 [L] `new Function(...)` в parseDomainLink тесте

**Файл**: `tests/unit/parseDomainLink.test.js:29`

Тест извлекает функцию из `server/integrations/blackDashboard.js` через регулярку и `new Function(...)`. Если кто-то закоммитит туда вредоносный код, при `npm test` он выполнится.

**Severity**: L (требует полного захвата репозитория).

**Рекомендация**: экспортировать `_parseDomainLink` напрямую (можно как `__test_only` поле). Лучший вариант: сделать его обычным экспортом, убрав префикс `_` — функция чистая, ничего не утекает.

---

## SEC-7 [L] `cfg.allowInsecureTls` отключает проверку сертификата globally в jiraForward

**Файл**: `server.js:398`

```js
rejectUnauthorized: !allowInsecureTls,
```

Если admin поставит `allowInsecureTls: true` (например, для self-signed Jira) — флаг применяется ко **всем** дальнейшим запросам, в т.ч. к Bitbucket / Confluence / Sigma. Granular контроль (отдельные TLS-настройки на каждый сервис) отсутствует.

**Severity**: L (operationally questionable — для self-signed corp Jira normal practice).

**Рекомендация**: либо добавить per-service TLS-флаг (`allowInsecureTlsBitbucket`, ...), либо хотя бы пометить в UI «применяется ко всем интеграциям».

---

## Что **хорошо** с точки зрения security в V13

✅ **CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy** — все на месте (audit #6).
✅ **Path traversal** — закрыт через `fs.realpathSync` (audit #8). TOCTOU остаётся, но это L.
✅ **Token sanitisation** в `jiraSanitizeConfig` — токены не отдаются в GET, только `hasJiraToken: bool`.
✅ **Rate limit** — `RL_WINDOW_MS=60s`, `RL_LIMIT=120/min` per-IP, `/health` exempt. e2e-тест подтверждает срабатывание.
✅ **Body size cap** — `readBody(req, MAX_BODY=8MB)` для `/llm/chat`, `512KB` для config, `256KB` для integrations.
✅ **Bundle-CSV ALLOWLIST** — токены НЕ восстанавливаются (audit #7).
✅ **`Buffer.byteLength` для Content-Length** — корректно с UTF-8.
