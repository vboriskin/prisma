# State Contracts

Три неочевидных контракта, нарушение которых ломает приложение или роняет безопасность. Прочти **прежде чем** менять что-то в `state.js` / `dataStore.js` / `integrations/`.

## Contract 1: Reactive.silent

### Проблема

`state.js` экспортирует mutable Object, обёрнутый в Proxy (`reactiveStore.js`). Любая мутация поля автоматически:

1. Помечает store dirty
2. После 100ms debounce вызывает subscribers
3. Subscribers: `Storage.save()` + `App.refreshAll()` + `FilterEngine.invalidate()`

Это удобно для user-actions (юзер кликнул → состояние изменилось → автоматически сохранилось и перерисовалось). Но **ломается** для bulk-mutations:

- Snapshot restore (`Storage.restore`): мы пишем 1000 строк в state → 1000 trap-fires → 100ms debounce → re-render → во время re-render ещё мутации (filter dropdowns переинициализируются) → re-render → ... → **infinite loop**.
- Bootstrap: `state.colOrder = saved.colOrder` при загрузке.
- `syncColumnSettings` в `Storage.save`: внутри save мы переписываем колонки, что повторно triggers save.

### Контракт

Любой mass-mutation path **обязан** быть в `Reactive.silent(() => { ... })`:

```js
import { Reactive } from './reactiveStore.js';

// ✗ НЕПРАВИЛЬНО — infinite loop
state.rows = newRows;
state.employees = newEmployees;

// ✓ ПРАВИЛЬНО
Reactive.silent(() => {
  state.rows = newRows;
  state.employees = newEmployees;
});
```

### Где это уже применено (примеры)

- `dataStore.js` `Storage.restore` — оборачивает всё restoration в `silent`
- `dataStore.js` `Storage.save` — `syncColumnSettings()` внутри save обёрнут (иначе loop)
- `state.js` bootstrap — Proxy создаётся ПОСЛЕ initial assignment
- `app.js` Reactive.subscribe body — `Reactive.silent` чтобы view-rendering не triggered re-flush

### Re-entry guard

Дополнительно `app.js` держит `_reactiveFlushing = false` flag — belt-and-braces для микротаск-гонок:

```js
let _reactiveFlushing = false;
Reactive.subscribe(() => {
  if (_reactiveFlushing) return;
  _reactiveFlushing = true;
  Reactive.silent(() => { Storage.save(); App.refreshAll(); });
  _reactiveFlushing = false;
});
```

### Auto-rerender grace period

`_AUTO_RERENDER_GRACE_MS = 250` — если view был рендерен только что (например, юзер сам кликнул pill в Ганте → handler уже отрисовал результат), субскрайбер **не перерендеривает** ещё раз. Иначе scroll-position теряется и мигает.

```js
const justRendered = App._lastRenderSection === state.activeSection
                  && (Date.now() - (App._lastRenderAt || 0)) < _AUTO_RERENDER_GRACE_MS;
if (!justRendered) App.refreshAll();
```

→ `App.markRenderedNow()` вызывается из любого view сразу после render.

---

## Contract 2: Identity-deterministic attribution (V17.2 I1c)

### Проблема

До V17.2 атрибуция данных Bitbucket / Confluence к сотруднику делалась через **fuzzy 2-token overlap** по lowercased displayName:

```js
// portfolioPulseModel.js:803 (deprecated в production)
function _ppFindByPartial(authorsMap, labelLower, keys) {
  // tokens('Иванов А.') ∩ tokens('aivanov') >= 2 → match
}
```

Симптом: «Иванов А.» (без BB-аккаунта) получал PR/commits от любого BB-автора с пересечением 2 токенов. Жалоба пользователя: «Bitbucket-данные привязываются к сотрудникам которые вообще не сидят в битбакет».

### Контракт

`state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}` — **авторитетная identity-таблица**.

Атрибуция только через explicit identity:

1. Сначала ищем employee по `participant.email` или `participant.jiraAccountId` (что Jira вернул).
2. Если нашли employee — ищем BB-автора по `employee.bitbucketLogin` или `employee.email`.
3. Если у employee `bitbucketLogin === ''` — НЕ привязываем BB-данные. Строго.
4. Fallback: если participant есть но не сматчился с employee — пробуем `bb.email === participant.email`.

```js
// portfolioPulseModel.js — текущий production-path
if (emp) {
  if (emp.bitbucketLogin)  bb = bbLookup.byKey.get(emp.bitbucketLogin.toLowerCase());
  if (!bb && emp.email)    bb = bbLookup.byEmail.get(emp.email);
} else if (p.email) {
  bb = bbLookup.byEmail.get(p.email);   // не в state.employees, но email от Jira совпал
}
// Никаких ФИО-токенов.
```

### Auto-fill (V17.2 I5)

При каждом успешном Portfolio Pulse fetch вызывается `_autofillEmployeeIdentities(model, state.employees)`:

- Match по нормализованному ФИО (trim + lowercase + collapse spaces)
- **Manual wins**: если поле уже заполнено вручную — не перезаписываем
- **Ambiguous skip**: если 2+ employees с одинаковым ФИО — оба пропускаются
- Заполняем `email` + `jiraAccountId` (то что Jira отдал)

Confluence — отдельно: при сохранении email в карточке сотрудника срабатывает `EmployeesView._tryResolveConfluenceUser(emp)` → POST `/api/integrations/confluence-resolve-user` → автозаполнение `confluenceAccountId`.

### Где код

- Frontend: `integrations/portfolioPulseModel.js` функция `analysePulse({employees})`, секция «Hydrate badges from Bitbucket / Confluence aggregates»
- Server: `server.js` `ppFetchConfluenceActivity(cfg, tls, cutoffTs, {employees})` — per-employee CQL `contributor in (...)`
- Auto-fill: `integrations/portfolioPulse.js` `_autofillEmployeeIdentities`
- UI: `views/employees.js` `_buildIdInput`

### Dev-fallback

`_ppFindByPartial` всё ещё в коде, но **production-disabled**. Включается через `analysePulse(raw, { allowFuzzyAuthorMatch: true })`. Не «фикси» это как production-bug.

→ См. [`dont-touch.md`](./dont-touch.md) — секция `_ppFindByPartial`

---

## Contract 3: `_scrubSecrets` policy

### Проблема

Любой токен (`jiraToken`, `bitbucketToken`, `confluenceToken`, `sigmaJiraToken`, `gigachatAuthKey`, etc) может попасть в:

- CSV/JSON exports (settings bundle прикреплён к экспорту данных)
- Logs / ErrorsLog (при echo-proxy сервер может вернуть Authorization header в body)
- LLM payloads (если settings попали в context)

Раз попал — пользователь шарит файл / логи → чужой токен в открытом виде.

### Контракт

**Все** export-paths и error-bubbling-paths ОБЯЗАНЫ проходить через scrub:

#### Export-side: `CSV._scrubSecrets`

Рекурсивный scrubber в `dataStore.js`:

```js
_SECRET_FIELD_NAMES: [
  'token', 'jiratoken', 'bitbuckettoken', 'confluencetoken', 'sigmatoken',
  'gigachatauthkey', 'authkey', 'apikey', 'password', 'secret', 'bearer',
],
_scrubSecrets(obj) {
  // Рекурсивно обходит, выкидывает любой ключ содержащий substring из _SECRET_FIELD_NAMES
}
```

Применяется в:
- `CSV._buildSettingsBundle()` — bundle для CSV export
- `JSONExport.buildSnapshot()` — для JSON export (V17.1 F1 — добавлено)

#### Error-side: token-redact regex

В error-bubbling paths (`employeePerformance.js`, etc) перед throw:

```js
const safe = String(txt).slice(0, 200)
  .replace(/Bearer\s+[A-Za-z0-9\-_=.]+/gi, 'Bearer ***')
  .replace(/(Authorization|X-API-Key)\s*[:=]\s*[^\s,;]+/gi, '$1: ***')
  .replace(/(token|secret|password|apiKey|authKey)\s*[:=]\s*[^\s,;"]+/gi, '$1: ***');
throw new Error(`HTTP ${res.status}: ${safe}`);
```

#### Allowlist на import

`dataStore.js` `JSON_ALLOWED_BUNDLE_KEYS` — белый список ключей которые import может писать в localStorage. Включает `q2_integrations_v1` (V17.1 F1) — но конкретные tokens в payload уже scrubbed на export-стороне.

### Если добавляешь новый export-path

```js
// ✗ НЕПРАВИЛЬНО
function exportEverything() {
  return JSON.stringify({ settings: localStorage.getItem('q2_integrations_v1') });
}

// ✓ ПРАВИЛЬНО
function exportEverything() {
  const raw = JSON.parse(localStorage.getItem('q2_integrations_v1'));
  const scrubbed = CSV._scrubSecrets(raw);
  return JSON.stringify({ settings: scrubbed });
}
```

### Тест

`tests/unit/v17AuditFixes.test.js` имеет тесты CRIT-1: «token не должен появиться нигде в snapshot». Если добавляешь новый export — добавь analogous-тест.

---

## Migration policy для localStorage

State-keys с версиями:

| Key | Версия | Замена |
|---|---|---|
| `q2_plan_v3` | current | (был v2, v1 — ломающие миграции) |
| `q2_settings_v3` | current | |
| `q2_llm_settings_v1` | current | |
| `q2_integrations_v1` | current | |
| `q2_onboarding_v1` | current | |
| `sbof_app_settings_v1` | current | |
| `q2_action_log_v1` | current | |
| `q2_llm_conv_v1` | current | |
| `welcomeShown` | current | (boolean flag) |
| `dataStorageMode` | current | `'localStorage'` или `'sqlite'` |

Когда менять версию:

- **patch к существующей** — добавил optional поле → не трогай версию
- **breaking change** — переименовал поле, изменил тип → bump version + migration в `Storage.restore`

Migration pattern:

```js
// dataStore.js Storage.restore (упрощённо)
const v3 = localStorage.getItem('q2_plan_v3');
if (v3) restoreFromV3(JSON.parse(v3));
else {
  const v2 = localStorage.getItem('q2_plan_v2');
  if (v2) {
    const migrated = migrateV2toV3(JSON.parse(v2));
    localStorage.setItem('q2_plan_v3', JSON.stringify(migrated));
    localStorage.removeItem('q2_plan_v2');
    restoreFromV3(migrated);
  }
}
```

→ Полная история migrations в `dataStore.js` `JSON_ALLOWED_BUNDLE_KEYS` + audit-папки

---

## Resumé для LLM

3 правила:
1. **Mass-mutation? → `Reactive.silent(...)`**.
2. **Атрибутируешь интеграционные данные? → через identity, никаких ФИО-токенов**.
3. **Экспортируешь что-то? → `CSV._scrubSecrets()` обязательно**.

Эти три контракта — корни системы. Всё остальное — кожа.
