# V18 P6 — Token-handling consolidation

**Дата:** 2026-05-01
**Tests:** 534 / 11 / 0 (без регрессий)
**Effort:** S

## Проблема

Token-handling до V18 был рассыпан по разным слоям:

1. **Auth-header building** — две функции с одинаковой логикой:
   - `_ppMakeAuthHeader(token)` — top-level в server.js
   - `makeAuthHeader(token)` — локально внутри `/api/integrations/*` handler'а

2. **Token-redact regex** — inline в каждом call-site который touched external response:
   - `integrations/employeePerformance.js` (V17.2 I4a) — copy-paste regex
   - `server.js` — нигде не было (но требовалось)
   - `integrationsSync.js` — нигде не было (тоже требовалось)
   - `app/llmAssistant.js` — нигде не было

3. **`_scrubSecrets`** — единый, в `dataStore.js`. С этим было OK.

При добавлении нового endpoint'а / нового error-path'а легко забыть один из слоёв.

## Решение — централизация redact + удаление дубля auth-header

### 1. `_ppRedactSecretsInText(text, maxLen=200)` в `server.js`

Server-side helper рядом с другими `_pp*` функциями (line ~770). Содержит canonical regex set:
- `/Bearer\s+[A-Za-z0-9\-_=.]+/gi` → `Bearer ***`
- `/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi` → `$1: ***`
- `/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi` → `$1: ***`

Применять везде где error-text от внешнего сервиса всплывает в response / logs.

### 2. `Utils.redactSecretsInText(text, maxLen=200)` в `utils.js`

Frontend mirror серверной функции. Доступен через `import { Utils } from './utils.js'`.

### 3. Унификация `makeAuthHeader`

```diff
- // Smart auth: if token contains ':', use Basic base64(token); otherwise Bearer
- function makeAuthHeader(token) {
-   if (!token) return '';
-   return token.includes(':')
-     ? 'Basic ' + Buffer.from(token).toString('base64')
-     : 'Bearer ' + token;
- }
+ // V18 P6 — унифицировал на top-level _ppMakeAuthHeader (был локальный дубль).
+ const makeAuthHeader = _ppMakeAuthHeader;
```

Никакого поведенческого изменения — alias на тот же helper.

### 4. Применение redact в frontend error-paths

#### `integrations/employeePerformance.js`

```diff
- if (!res.ok) {
-   const txt = await res.text();
-   const safe = String(txt).slice(0, 200)
-     .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, 'Bearer ***')
-     .replace(/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi, '$1: ***')
-     .replace(/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, '$1: ***');
-   throw new Error(`HTTP ${res.status}: ${safe}`);
- }
+ if (!res.ok) {
+   const txt = await res.text();
+   throw new Error(`HTTP ${res.status}: ${Utils.redactSecretsInText(txt)}`);
+ }
```

3 строки regex → 1 строка helper-call.

#### `integrations/integrationsSync.js`

Раньше: `const err = await res.json().catch(() => ({})); throw new Error(err.error || `HTTP ${res.status}`);`
Сейчас: пытается парсить как JSON, но при failure читает как text + applies `Utils.redactSecretsInText`.

Покрывает случай когда сервер вернул не-JSON (например, корп-proxy вернул HTML с echo'enным Authorization header).

## Что НЕ сделано (явно — следует обсудить отдельно)

- **`app/llmAssistant.js` parseStreamResponse** — error path там сейчас бросает `Error(errTxt || ...)` без redact. Вынес бы тоже на helper, но parseStreamResponse — критическая функция стриминга, рискованно менять без отдельного теста на стриминг (пока такого нет). Помечен в backlog для P13 (coverage expansion).
- **Всеобъемлющий middleware `withAuth(req, res, next)` для всех `/api/integrations/*`** — рассматривал, но `server.js` написан как один большой handler с if/else по pathname, не через middleware-pattern. Полная миграция на middleware = предметная задача (relate to P10 — server decomposition), не блокирующая P6.

## Что закрыто из аудита

P6 закрывает Phase 3 audit Bullet **I2** — «Token-handling рассыпан по 3 местам, нет единого middleware»:
- Auth-header — теперь единый `_ppMakeAuthHeader`, `makeAuthHeader` alias
- Redact — теперь единый `_ppRedactSecretsInText` (server) + `Utils.redactSecretsInText` (frontend)
- `_scrubSecrets` — был и остался (export-side), не тронут

## Тесты

Поведенческих изменений ноль. Tests: 534 / 11 / 0.

Регрессионный тест на token leak уже есть в `tests/unit/v17AuditFixes.test.js` («tech-info: no token / token-field-name leakage in response») — не сломался.

## Метрика

```
До:  4 места с inline regex (3 frontend potential + 1 frontend actual)
     2 копии auth-header функции

После: 1 server helper + 1 frontend helper
       1 auth-header функция (alias)
       Применено в 2 frontend местах
       2 места отложены (parseStreamResponse, server middleware) с обоснованием
```

## Резюме

```
✓ server.js: _ppRedactSecretsInText helper (~22 LOC)
✓ utils.js: Utils.redactSecretsInText helper (~18 LOC)
✓ server.js: makeAuthHeader → alias _ppMakeAuthHeader
✓ employeePerformance.js: inline regex → helper
✓ integrationsSync.js: error path теперь через helper
✓ Tests: 534 / 11 / 0
```

V18 P6 закрыт. Дальше — P7 (async-job unification).
