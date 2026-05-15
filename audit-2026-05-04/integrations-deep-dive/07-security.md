# 07 — Security & Privacy audit

Scope: Сканнер команд 2.0 (`integrations/teamScanner2*.js`, ~12k LOC) + Чёрный дашборд (`integrations/blackDashboard*.js`) + общий `views/integrationsView.js` + `integrations/integrationsRenderer.js` + `integrations/integrationsStore.js` + `integrations/telemetry.js`.

Контракты, против которых выполнялась проверка:
1. `_scrubSecrets` policy (`docs/state-contracts.md` § 3, `docs/integrations/auth-and-secrets.md`)
2. HTML inserts только через `Utils.escapeHtml`
3. CSV formula injection guard (V17 P9 F1)
4. Identity-deterministic attribution (V17.2 I1c)

## Сводка
- **Critical: 1** (XSS via untrusted href в events feed Сканнера)
- **High: 2** (полный токен в DOM-input value; full email в `data-*`-атрибуте)
- **Medium: 6** (location.href в clipboard-share, CSP `'unsafe-inline'`, `noopener` без `noreferrer` в BD, server `who` в innerHTML без esc, snapshot/history без автопурга при logout, history.replaceState без проверки уникальности hash)
- **Low: 5** (defensive scheme guard на BB url, narrative-md в `data-*` атрибуте полный label/PII, `audit log` в localStorage, лимит share-key 64 символа но без проверки длины Jira keys, `q2_diag_consent_until` legal compliance)
- **Polish: 3** (упорядочить `rel` атрибуты, унифицировать через `Utils.safeUrl`, e2e tests на XSS payload)

## Метод

1. Грепы: `innerHTML\s*=`, `insertAdjacentHTML`, `eval(`, `new Function(`, `javascript:`, `console.log`, `console.warn`, `localStorage`, `sessionStorage`, `location.hash`, `location.href`, `Authorization`, `Bearer`, `token`, `onclick=\"`, `target=\"_blank\"`, `rel=\"noopener`.
2. Прошёл по `_scrubSecrets`-pathway: `prepareDiagnosticExport` → `_scrubInPlace` / `_scrubTokensOnly` (`integrations/teamScanner2Diagnostic.js:769-820`). Покрытие ключей расширенное (`email`, `accountId`, `bitbucketLogin`, `userKey`, `userName`, `username`, `fio`, `summary`, `description`, error/message). Контракт соблюдён.
3. Проверил identity-deterministic attribution (`_gatherIdentityCoverage` — lookup только через `email`/`jiraAccountId`, без fuzzy-name; `_syncEmployeesFromParticipants` — ключ = `jiraAccountId`).
4. Изучил token storage flow: `loadSettingsForUI()` (`integrations/integrationsStore.js:84-93`) — возвращает raw token в UI; `value="${esc(s.jiraToken||'')}"` в `integrationsRenderer.js:46/70/93/116`.
5. Проверил все XSS-surface'ы: 4587-LOC `teamScanner2Renderer.js` — ВСЕ user-data interpolations пропущены через `esc()`. Один critical-исключение — см. F1.
6. Просмотрел CSP/headers — `server.js:5213-5232`. Permissive `'unsafe-inline'`, в остальном стандартный pack.

---

## Находки

### F1 — Untrusted href из BB/CF API без scheme allowlist [Critical]
**Класс:** Reflected/Stored XSS via `javascript:` URI
**Где:** `integrations/teamScanner2Renderer.js:3266-3267, 3275-3276`
**Симптом:**
```js
const titleHtml = e.url
  ? `<a class="ts2-issue-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(titleText)}</a>`
  : esc(titleText);
```
`e.url` берётся из `bbItems[].url` / `cfItems[].url` — values возвращённые сервером (`server.js:2050` `url: pr.url || ''` — прямо из Bitbucket API JSON без валидации) → enriched в `participant.timeline72h` → renderer вставляет в href.

`Utils.escapeHtml` нормализует `<>"&'`, но НЕ блокирует `javascript:alert(1)` / `data:text/html,...` schemes. Если корп-Bitbucket прокси компрометирован, или администратор PR'а сможет вписать `javascript:` в произвольное URL-поле BB API (некоторые BB plugin'ы позволяют), **clickable XSS в side-panel** при просмотре профиля сотрудника.

**Контракт:** §A XSS surface — href/src без sanitisation (особенно `javascript:` URIs).
**Рекомендация:** Все 2 места обернуть через `Utils.safeUrl(e.url)` (allowlist `^(https?:|mailto:)`):
```js
const safeHref = Utils.safeUrl(e.url);
const titleHtml = safeHref
  ? `<a class="ts2-issue-link" href="${esc(safeHref)}" target="_blank" rel="noopener noreferrer">${esc(titleText)}</a>`
  : esc(titleText);
```
`blackDashboardRenderer.js` уже использует `safeUrl` локально (его дубль) — единая точка правды должна быть `Utils.safeUrl`.

**Цена:** S (2 правки в одном файле + unit-test с `e.url='javascript:alert(1)'`).
**Эксплуатация:** требует контроля над BB API response (insider/proxy-MITM). Defense-in-depth обязательна.

---

### F2 — Полный токен пре-fill'ится в DOM input value [High]
**Класс:** Token leak in DOM
**Где:** `integrations/integrationsRenderer.js:46, 70, 93, 116`; `integrations/integrationsStore.js:84-93` (`loadSettingsForUI`).
**Симптом:**
```js
<input class="int-field-input" id="int-jira-token" type="password"
       placeholder="Bearer token или email:token" value="${esc(s.jiraToken||'')}">
```
4 token-поля (Jira, Sigma, BB, Confluence) при открытии Settings modal вставляют **полный token в `value`-атрибут** (даже если поле `type="password"`). `loadSettingsForUI` явно возвращает raw token «чтобы password fields can pre-populate».

DOM-инспектор / DevTools / browser extension с `documentTree` permission получает токен в открытом виде — `s.jiraToken` приходит из `localStorage.q2_integrations_v1`. На корпоративных машинах с installed extensions (browser policy enforce) это уже observed-leak vector.

Вторичный риск: **«eye» toggle (`integrationsView.js:476-481`)** переключает `inp.type` на `text` — токен виден on screen-share / screenshot.

**Контракт:** §B Secret leakage — UI inputs (settings) → password type, never log. Файл `auth-and-secrets.md` явно говорит «Token **никогда** не возвращается обратно в browser». Здесь `loadSettingsForUI` нарушает это для UI-удобства pre-fill.

**Рекомендация:**
- При наличии `hasJiraToken === true` рендерить `value=""` + placeholder «Сохранён, оставьте пустым чтобы не менять» (как уже делается для Sigma — `integrationsRenderer.js:71`).
- `loadSettingsForUI` либо удалить полностью, либо выдавать только при явном «Edit token»-клике (lazy reveal, без pre-fill).
- «Eye» toggle оставить только для UNSAVED inputs (когда юзер только что вписал).

**Цена:** M (1 файл renderer, 1 файл store, 4 token-поля × 2 пути).
**Эксплуатация:** browser-extension / screen-share / open DevTools.

---

### F3 — Полный email в `data-email-full` атрибуте [High]
**Класс:** PII leak in DOM
**Где:** `integrations/teamScanner2Renderer.js:3056-3058`.
**Симптом:**
```js
<button class="ts2-panel-email" data-email-toggle type="button"
        ...
        data-email-full="${esc(emailFull)}"
        data-email-masked="${esc(emailMasked)}">${esc(emailMasked)}</button>
```
Mask-on-screen хороший pattern (visible text masked), но **полный email лежит в DOM-атрибуте `data-email-full`** для каждого открытого участника. Любой DOM-snapshot / DevTools / `document.outerHTML.includes(email)` exposes. На статус-митингах/screen-share с открытыми DevTools — leak. В export/share-screenshot — leak.

В `gatherDiagnosticState` диагностический payload `incomplete[].label` всё ещё хранит `p.label || p.key`, без mask. Diagnostic safe-mode скрабит при export, но в-memory state ходит во всё clipboard'ы и telemetry без mask'инга.

**Контракт:** §B Secret leakage / privacy — DOM attributes доступны через любой extension с tabs permission.
**Рекомендация:** Lazy unmask: при click сделать **fetch /api/integrations/employee-detail?key=...** (или просто `EmployeeFactory.getByKey(key)`) и подставить email runtime, без хранения в DOM. Альтернатива (cheap): masked + копировать в clipboard, но не в `data-*`.

**Цена:** S (1 место renderer + 1 в `_bindPanelEvents` для click handler).

---

### F4 — `share-link` копирует полный `location.href` в clipboard [Medium]
**Класс:** Identity exposure через копированную ссылку
**Где:** `integrations/teamScanner2.js:1529-1556`, `1483-1527` (TG copy).
**Симптом:**
```js
const url = (typeof location !== 'undefined' ? location.href : '');
await navigator.clipboard.writeText(url);
```
`location.href` содержит `#scanner2/employee/<key>` где `<key>` — это `participant.key` = jiraAccountId / Jira user-key. При вставке в TG/Slack ссылка раскрывает идентификатор сотрудника. Plus Telegram/Slack-server log хранит её. Plus permalink в TG copy включает full URL.

Pилот feedback prоizvelena использовался как async share, но V18.3 A4 не делал pseudonymisation. Идентификаторы Jira `jirauser123` / `08350318` — это PII когда сопоставимы с реальными сотрудниками.

**Контракт:** §B Secret leakage — V18.3 A4 share-link на сотрудника есть риск раскрыть jiraAccountId / bitbucketLogin.
**Рекомендация:**
1. Hash `expandedKey` через `Utils.hashAccountId(key, sessionSalt)` для URL-репрезентации; на mount читать hash и обратно ресолвить через `participant.key === computeHash(p.key, sessionSalt)`. Salt — случайный per-session.
2. ИЛИ короче: отправлять подсчитанный `<short-token>` (3-byte hex от SHA-1 от key) и lookup в model.
3. На clipboard write добавить toast-warning «ссылка содержит идентификатор сотрудника».

**Цена:** M.

---

### F5 — CSP `'unsafe-inline'` для script-src и style-src [Medium]
**Класс:** CSP weakness
**Где:** `server.js:5220-5224`.
**Симптом:**
```js
"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "
"style-src 'self' 'unsafe-inline'; "
```
Комментарий в коде сам признаёт: «tightening to strict-CSP would require a significant rewrite». Все critical-XSS защиты опираются на developer discipline (escapeHtml). Из 5 inline `onclick="event.stopPropagation()"` в `blackDashboardRenderer.js` ни одна не пропускает user-input, но prevents migration to strict-CSP.

**Контракт:** §H CSP / headers.
**Рекомендация (defense-in-depth path):**
1. Удалить inline `onclick="event.stopPropagation()"` из BD renderer'а — обработать через event-delegation на parent (BD already has `_wire()`).
2. Добавить `'nonce-<random>'` для статически inlined `<script>` блоков (если такие есть).
3. Тогда `'unsafe-inline'` в `script-src` можно снимать. Style — большая работа (inline styles в куче мест), оставить как известный debt.

**Цена:** L (audit-wide, многоместная задача — отдельная PR).

---

### F6 — `noopener` без `noreferrer` в Чёрном дашборде [Medium]
**Класс:** Referrer leak
**Где:** `integrations/blackDashboardRenderer.js:228, 257, 359, 431, 545`.
**Симптом:** `<a ... target="_blank" rel="noopener" onclick="event.stopPropagation()">` — нет `noreferrer`. При клике на Sigma/Delta link браузер отправляет `Referer: <корп-prisma-URL>` в Sigma/Delta Jira. Если эти инстансы за corp-proxy с logging — log содержит наш origin path.

Сканнер 2.0 уже использует `rel="noopener noreferrer"` (`teamScanner2Renderer.js:33`). Несогласованность = bug.

Также server.js имеет `Referrer-Policy: same-origin` (`server.js:5230`) — хороший fallback, но в новых доменах (https://sigma.example.com) считается cross-origin → referrer всё-таки stripped до origin only. Acceptable, но per-link `noreferrer` строже.

**Рекомендация:** заменить `rel="noopener"` → `rel="noopener noreferrer"` в 5 местах BD renderer'а.
**Цена:** XS.

---

### F7 — Server-controlled values без esc в `_statusBadge` meta [Medium]
**Класс:** XSS если server compromised (defense-in-depth)
**Где:** `views/integrationsView.js:444-446`.
**Симптом:**
```js
const meta = `Аудит за <span class="num-tnum">${data.windowHours}</span>ч: <span class="num-tnum">${users.length}</span> пользователей, <span class="num-tnum">${data.loginRecords}</span> событий${top ? ' · топ: ' + _esc(top) : ''}`;
res_el.innerHTML = `<span class="signal-dot signal-on-course" aria-hidden="true"></span> ${meta}`;
```
`data.windowHours` / `users.length` / `data.loginRecords` interpolated **без `_esc`**. Они должны быть числами, но JSON-парсер не enforce. Если server (или MITM) возвращает `{"windowHours": "</span><img src=x onerror=alert(1)>"}`, — XSS.

**Контракт:** §A — innerHTML с template literals — если хотя бы один interpolated сегмент не пропущен через escapeHtml → XSS-vector.
**Рекомендация:** обернуть числа в `_esc(String(data.windowHours))` или enforce `Number(...)`.
**Цена:** XS.

---

### F8 — Snapshot / history / consent в localStorage без cleanup-on-logout [Medium]
**Класс:** State persistence без clearing path
**Где:** `integrations/teamScanner2.js:237` (`q2_scanner2_snapshot:`), `integrations/teamScanner2History.js:30` (`q2_scanner2_history:`), `integrations/teamScanner2.js:1984` (`q2_diag_consent_until`), `1661` (`q2_diag_audit_outbox`), `307` (cleanup только staleSnapshots > 7 дней).
**Симптом:**
- Snapshot хранится 24h TTL, history 30 дней, audit-queue 50 entries, consent — 24h.
- НЕТ единой «logout / clear data» функции, нет пользовательского control'а «сбросить scanner-cache».
- При смене пользователя браузера (shared workstation) — old snapshots видны новому юзеру. Counts с PR-авторами 4 проектов другой команды.
- `q2_diag_audit_outbox` может содержать metadata о raw-mode export'ах (с PII в фильмах) — pending в outbox если server упал.

**Контракт:** §C Persistence — что хранится; есть ли expiry; clear по logout.
**Рекомендация:**
1. Добавить `TeamScanner2.clearAllPersistence()` метод — очищает все `q2_scanner2_*` ключи + `q2_diag_*`. Вызывается при logout / settings → "Очистить данные сканнера".
2. На demo-mode переключение тоже очищать чтобы demo-data не залипала после exit.
3. `_AUDIT_QUEUE_KEY` flush-on-flush уже есть, но если queue стуёт — данные могут жить долго. Добавить TTL 7 дней per-entry.

**Цена:** S.

---

### F9 — `history.replaceState` пишет hash без trim'а длины [Medium]
**Класс:** URL-injection (низкий impact, но контракт §G validation)
**Где:** `integrations/teamScanner2.js:528-540`, `460-464`, `476-484`.
**Симптом:** `_consumeShareLink` ОК validate'ит regex `^[A-Za-z0-9._-]{1,64}$`, но обратное направление `_updateShareLinkHash` пишет `encodeURIComponent(this._expandedKey)` без проверки. Если каким-то путём `_expandedKey` мутируется во что-то длинное (e.g. concat in a bug) — попадёт в URL bar и в clipboard share.

Пилотное: я не нашёл active path к мутации, но defense-in-depth.
**Рекомендация:** validate same regex on write side.
**Цена:** XS.

---

### F10 — `data-narrative-md` хранит full markdown с PII в DOM [Low]
**Класс:** PII in DOM
**Где:** `integrations/teamScanner2Renderer.js:1038-1039, 2893-2894`.
**Симптом:** `data-narrative-md="${esc(md)}"` — markdown содержит full label, статус блокеров, имена issue. Хорошо escape'нут как HTML, но `outerHTML.includes(label)` exposes. Те же концерны что F3 но менее sensitive (label != email).
**Рекомендация:** lazy compose markdown в click handler, не pre-bake в DOM.
**Цена:** S.

---

### F11 — Markdown сборка не sanitises issue summary для injection в TG [Low]
**Класс:** Markdown injection (downstream)
**Где:** `integrations/teamScanner2.js:1497-1499`, `composeNarrativeMarkdown` (`teamScanner2Insights.js:968`).
**Симптом:** `\`  · ${b.key} «${(b.summary || '').slice(0, 50)}» — ▌${b.dwellHours || 0}ч в "${b.status || '?'}"\`` — issue summary напрямую вставляется в copied-to-TG текст. Если admin вставил в Jira summary `"@channel"` или `[fake link](evil.com)` — TG получит intеактивный markdown.

Не XSS в нашем app, но downstream attack on chat tools.
**Рекомендация:** Заменить markdown-special chars `[]()_*~`\` в summary при composeNarrativeMarkdown.
**Цена:** S.

---

### F12 — Telemetry `errMsg` 100 chars может содержать чувствительный stack [Low]
**Класс:** PII в telemetry log
**Где:** `integrations/telemetry.js:98, 104`; `integrations/teamScanner2.js:311, 745, 1263, 1674, 1950, 2197`.
**Симптом:** `String(e?.message || e).slice(0, 100)` в `silent_error` событиях. 100 chars — большинство error msgs влезают целиком. Если Jira возвращает «`HTTP 401: invalid token Bearer abcdef...`», 100-char-prefix может содержать key/секрет.

Для telemetry endpoints `redactSecretsInText` НЕ применяется (в отличие от ErrorsLog.add path в employeePerformance).
**Рекомендация:** в telemetry.js перед `_buffer.push` пропустить data через `Utils.redactSecretsInText(JSON.stringify(data), N)` (или per-field). Защита от случайного попадания токена в server-side log.
**Цена:** S.

---

### F13 — `console.warn` в catch'ах с full error object [Low]
**Класс:** Token leak в browser-console (если корп-proxy echo'ит Authorization)
**Где:** `integrations/teamScanner2.js:702, 756, 826, 1347, 1480, 1525, 1552, 2129, 2197`; `integrations/blackDashboard.js:161`.
**Симптом:** `console.warn('[scanner2] fetch failed:', e)` — `e.message` может содержать echo'enный header (см. `auth-and-secrets.md` § «echo-proxy attacks»). Browser-console screenshot / paste в bug report = leak.

`employeePerformance.js` имеет token-redact regex (per `auth-and-secrets.md`), но scanner2/black-dashboard catch-handlers — нет.
**Рекомендация:** обернуть все catch-консольные logs:
```js
console.warn('[scanner2] fetch failed:', Utils.redactSecretsInText(String(e?.message || e), 500));
```
Или вынести в helper `_safeLog(scope, e)`.
**Цена:** S (10 мест).

---

### F14 — Audit log в localStorage может удерживаться неконтролируемо [Polish]
**Класс:** Compliance trail
**Где:** `integrations/teamScanner2Diagnostic.js:41` (`q2_diag_export_log`), `teamScanner2.js:1661` (`q2_diag_audit_outbox`).
**Симптом:** Audit log — это compliance feature, но если localStorage очищается (юзер clear cache), trail пропадает без warning. Outbox flush — fire-and-forget, при offline'е длительном — entries старые.
**Рекомендация:** TTL 90 дней per entry, на clear-cache → telemetryEmit для server-aware count.
**Цена:** XS.

---

### F15 — Identity sync создаёт employee при первом fetch без user consent [Polish]
**Класс:** Privacy / GDPR adjacent
**Где:** `integrations/teamScanner2.js:783-834` (`_syncEmployeesFromParticipants`).
**Симптом:** При первом fetch автоматически создаются employee-stub'ы из 110 Jira-participants — `email`, `fio`, `jiraAccountId` записываются в `state.employees[]`. Пользователь, открывший Сканнер первый раз, неявно сохраняет в localStorage идентификаторы 110 коллег. Никакого consent UI.

DSGVO compliance — для внутреннего корп-инструмента в Сбере вероятно не critical (legitimate interest), но pattern достоин документации.
**Рекомендация:** В `gatherDiagnosticState` или CLAUDE.md явно указать «scanner2 на mount пишет identity 100+ человек в локалку, для деаноним export нужен safe-mode».
**Цена:** XS (документация).

---

## Защитные меры без потери функционала

1. **`Utils.safeUrl(e.url)` в events feed** — F1, защита от `javascript:` URI в BB/CF responses. **Quick win** (2 строки).
2. **Не pre-fill'ить tokens в DOM**: использовать «✓ Сохранён» badge + пустой input (уже сделано для Sigma — `integrationsRenderer.js:71`). **Quick win** (4 поля).
3. **Унифицировать `Utils.safeUrl`** — `blackDashboardRenderer.js` имеет свою копию, заменить на импорт из `utils.js` (исключить drift).
4. **`rel="noopener noreferrer"` везде где `target="_blank"`** — defense-in-depth, низкая цена, согласовать BD с Scanner2.
5. **Lazy email reveal** — F3, не хранить full email в `data-*`. Click → fetch detail или lookup в state.
6. **`TeamScanner2.clearAllPersistence()`** — F8, единая кнопка очистки в settings + автоматический вызов на demo-exit / logout.
7. **`Utils.redactSecretsInText` в telemetry payload** — F12, перед `_buffer.push`. Защищает от случайного попадания echo'ed token в server-side log.
8. **Pseudonymise share-link key** — F4, hash `expandedKey` через session-salt; обратный lookup в renderer'е.
9. **Унифицированный `_safeLog(scope, err)` helper** — F13, заменить все `console.warn(scope, e)` на `_safeLog`. Cross-cutting concern (employeePerformance уже redacts).
10. **CSP migration plan** — F5, отдельный PR: убрать inline-handlers из BD renderer'а → удалить `'unsafe-inline'` из `script-src`.
11. **Validate `_expandedKey` regex на write-path** — F9, мирроринг с `_consumeShareLink` validation.
12. **e2e XSS payload tests** — добавить в `tests/unit/teamScanner2*.test.js` smoke с `{url: 'javascript:alert(1)', summary: '<script>'}` и assert `outerHTML.includes('javascript:') === false`.
