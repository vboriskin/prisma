# Виктор Кравченко — Сканнер команд: tech + reliability аудит

> **Кто я.** SRE-architect, 15 лет на reliability и распределённых системах
> (Yandex → JetBrains → independent). В этот аудит беру оптику Сберовского
> прода: вечный 429-storm на корп-Jira, медленные ответы 90s+, SSO-redirect
> возвращающий HTML вместо JSON, токен ротация → 401. Фокус — fault
> tolerance, partial-data, race conditions, perf, контракты.
>
> **Что смотрел.** ~16k LOC scanner2 (`integrations/teamScanner2*.js`),
> `pulse/index.js` facade, `server/pulse-runner.js` + `server/upstream.js`,
> 12 unit-test файлов, `server/integrations-api.js` (employee-detail
> endpoint), util-хелперы (`scrubSecrets / hashAccountId / maskEmail`).
> Корпус кода активный, V18→V22 итераций — много кода написано наспех под
> пилот, многое уже починено, что приятно. Все ссылки — `file:line`,
> код-сниппеты только там где это load-bearing.

## TL;DR — 5 главных рисков

1. **S0 — XSS-vector в инлайн-popover'е «формула метрики».**
   `teamScanner2.js:2399-2401` строит innerHTML через ручной regex-escape
   (только `<>&"`), но забывает `'` и backtick. `data-pm-formula`
   склеивается в renderer'е через `esc()`, но включает в себя
   user-controlled значения (`bo.signals.map(s => …)`, `jErrPm`, имя папки
   Jenkins из server response). Atom-эскейп `[<>&"]` пропускает `'`,
   а атрибут html всё ещё может прийти в одинарных кавычках после reformat —
   рисково. Используйте `Utils.escapeHtml` единообразно.

2. **S0 — Sprint-snapshot localStorage квота-bomb для долгих сессий.**
   `teamScanner2.js:419-433` пишет snapshot per refresh без хитрого
   pruning, а `_cleanupStaleSnapshots()` крутится только при successful
   save. При первой попытке записи в забитый storage → QuotaExceededError,
   `telemetry.silent_error`, тренд НЕ показывается, и cleanup НЕ
   запускается. Каждый последующий refresh даёт ту же ошибку. История
   снимков (`q2_scanner2_history:HASH`) тоже не делится квотой ни с одним
   другим storage (см. ниже #M2).

3. **S1 — Race condition: bumpClassifyEpoch + WeakMap-cache + late callback.**
   `teamScanner2.js:779` делает `bumpClassifyEpoch()` в refresh(). Но если
   старый pulse-fetch завершится ПОСЛЕ нового refresh'а — старый колбэк
   `onJobId` отсечётся через reqId-guard (`teamScanner2.js:980`), а вот
   `analysePulse → enrichForScanner2 → applyPersonMetrics` уже могли
   успеть проклассифицировать participants старого model'а в новой epoch.
   Cache в `_classifyCache` WeakMap пишется по reference на старый объект,
   но повторное чтение этого объекта через render будет читать новую
   epoch и пересчитывать — нет corruption, но **ratchet нарушается**:
   classifier может вернуть разные значения для одного объекта между
   двумя renders (если кто-то изменил поля в участнике между ними).
   В текущем коде participants не мутируются — но это негарантируемый
   инвариант.

4. **S1 — _detailCache TTL-prune асимметричен: пишет до prune, prune
   удаляет всё кроме нового.** `teamScanner2.js:823-836` сначала чистит
   все expired entries, потом запускает LRU eviction (`size >= MAX`),
   потом `set(cacheKey, …)`. На малых N это ОК, но при concurrent calls
   к `fetchDetail` (двойной клик) могут одновременно очистить и записать;
   ничего критичного не ломается, но рискованно если в будущем добавят
   shared cache (например server-mirror).

5. **S1 — _autoSyncDisabled — terminal silent state, требующий перезагрузки
   страницы.** `teamScanner2.js:1488`, `_autoSyncDisabled` ставится один
   раз при QuotaExceededError и далее `_syncEmployeesFromParticipants`
   игнорируется. UI не показывает этого пилоту: при следующем pulse
   bbItems-attribution тихо снова уползает к 0, и Auto-Resolve не помогает
   (новые participants не auto-created). Нет UI-кнопки «restart sync»,
   нет банера «storage переполнен — очистите историю».

---

## Critical (S0) — реальный риск падения / data corruption

### S0-1. XSS через innerHTML в `_bindDashboardEvents` — popover формулы

`integrations/teamScanner2.js:2399-2401`:
```js
const titleSafe  = String(heading).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const bodySafe   = String(formula).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
pop.innerHTML = `<div class="ts2-pm-chip-popover-title">${titleSafe}</div><div class="ts2-pm-chip-popover-body">${bodySafe}</div>...`;
```

**Сценарий:** `formula = chip.getAttribute('data-pm-formula')`. Эти атрибуты
зашиваются в HTML в `teamScanner2RendererPersonRows.js:1238` и далее (см.
`grep data-pm-formula …`) с включением `bo.signals.map(s => s.kind=s.value)`
и `jErrPm = jenkinsError`. `jenkinsError` приходит с сервера. Если
Jenkins-сервер вернёт ошибку, содержащую кавычки или другие спецсимволы,
строка попадает в DOM через innerHTML и **попутно ослабляется по
re-encoding**.

`<>&"` покрывают базовый surface, но ослабляются для контекста template
literal: если formula содержит ` ${alert(1)} ` — это валидный CSS context,
не код. Однако HTML-entity escape не покрывает control characters и не
учитывает то, что строка пройдёт ещё раз через `innerHTML`. Безопаснее
использовать **textContent** или `Utils.escapeHtml` (единственный
canonical в кодбазе), который покрывает 5 символов и mirror'ит
серверной semantics.

**Impact:** Низкая вероятность активной эксплуатации (нет authenticated
attacker'а на server-stage Jenkins), но это нарушает контракт
«User-controlled strings — только через `Utils.escapeHtml`» (CLAUDE.md
§Безопасность).

**Fix:**
```js
const titleSafe = Utils.escapeHtml(heading);
const bodySafe  = Utils.escapeHtml(formula);
// или, лучше, перейти на textContent:
const pop = document.createElement('div');
pop.className = 'ts2-pm-chip-popover';
const titleEl = document.createElement('div');
titleEl.className = 'ts2-pm-chip-popover-title';
titleEl.textContent = heading;
const bodyEl = document.createElement('div');
bodyEl.className = 'ts2-pm-chip-popover-body';
bodyEl.textContent = formula;
pop.appendChild(titleEl); pop.appendChild(bodyEl);
```

### S0-2. Quota-exceeded бомба на snapshot/history без UX warning

`teamScanner2.js:419-433` (`_saveSnapshot`):
```js
try {
  localStorage.setItem(this._snapshotKey(), JSON.stringify(snap));
  this._cleanupStaleSnapshots();   // ← запускается ТОЛЬКО при успехе
} catch (e) {
  try { telemetryEmit('scanner2.silent_error', { where: '_saveSnapshot', msg: ... }); } catch (_) {}
}
```

**Сценарий:** тимлид использует Призму на одном браузере 2 года, накопил
сотни ключей `q2_scanner2_snapshot:HASH` (разные проекты) и
`q2_scanner2_history:HASH` (по 30 snapshots × 2.5KB ≈ 75KB на каждую
ключевую конфигурацию). Плюс приложение пишет `q2_diag_audit_outbox`,
`q2_diag_export_log`, `q2_scanner2_team_config`, `q2_scanner2_selectedTeam`,
`q2_scanner_show_blocked`, `q2_scanner_active_sprint_only`, `q2_diag_consent_until`,
`q2_telemetry_disabled`, `q2_last_diag_snapshot`, `q2_scanner_sd_tab`,
`q2_scanner_velocity_view`, `q2_scanner2_prefs_synced_at`, плюс own state
приложения (`q2_state_*`). Можно легко выйти за 5MB.

Когда `setItem` падает с QuotaExceededError:
1. `_cleanupStaleSnapshots` НЕ запускается → стереть ничего не удалось.
2. `_lastRawDiag` зачищается только при `unmount` (`teamScanner2.js:3593`).
3. UI не показывает баннер; пилот видит «тренд = none» без объяснения.
4. **Каждый следующий refresh** делает попытку — пишет в telemetry → ddos
   на logger endpoint.

Аналогично `teamScanner2History.js:153-157` ловит quota silently через
`console.warn` (нет даже telemetry — модуль изолирован от orchestrator'а).

Сам `saveDailySnapshot` имеет prune `MAX_ENTRIES=30` внутри одного
`localStorage.getItem(key)` (одна команда), но между разными командами
нет cap.

**Impact:** Невидимый failure пилоту, бесконечный retry-loop на
telemetry endpoint, тренд+история отключаются после одного цикла quota
overflow без uncorrected recovery.

**Fix-direction:**
- При первом QuotaExceededError: толстый toast «Хранилище переполнено,
  откройте Настройки → Очистить историю снимков»; пометить флаг
  `_storageQuotaExceeded = true`, не делать `setItem` до restart'а.
- `_cleanupStaleSnapshots` запускать **до** `setItem` (или раз в N
  минут идемпотентно). Сейчас он работает по принципу «cleanup как награда
  за успех» — заведомо неработающий.
- Дать кнопку «Очистить snapshots/history» в Diagnostic-modal.

---

## High (S1)

### S1-1. _autoSyncDisabled — sticky terminal state с no escape

`teamScanner2.js:1488` объявляет `_autoSyncDisabled: false`. Set в
`teamScanner2.js:1558` при `Storage.save?.()` throw'е. Поскольку
employee-auto-create блокируется до перезагрузки страницы, дальнейшие
pulse-fetch'и **не подтянут новых сотрудников из Jira**. После того как
тимлид очистит storage (через DevTools), bug сохраняется. Нужно: либо
сброс при `unmount`, либо при успешном manual save.

Также гипотеза: внутри `Reactive.silent` save throws → catch ловит,
rollback `appState.employees.length = _empLenBefore`. Но **rollback тоже
проходит через Reactive.silent** (на `teamScanner2.js:1553`) — это
нормально, но `appState.employees.length = N` через Proxy может
вызвать setter с key=`length` (Proxy hooks на массивах работают
по-разному). Не покрыто тестами.

### S1-2. Bumping classify epoch — race с late-arriving fetch

`teamScanner2.js:779` в `refresh()` делает `bumpClassifyEpoch()` ДО
`await this._fetchAndRender()`. То есть:

1. refresh() #1 → bumpEpoch (epoch=5) → начинает fetch.
2. Пользователь жмёт ещё раз refresh() #2 → bumpEpoch (epoch=6) →
   abort'ит #1, начинает #2.
3. #2 завершается, model→participants→render использует epoch=6, всё ок.

Это работает. Но рассмотрим:
1. refresh() #1 → bumpEpoch=5 → fetch #1 in-flight.
2. Внутри `_fetchAndRender` происходит TDZ-error / smoke-test fail
   (`teamScanner2.js:1356-1365` ловит и telemetry, но _model остаётся
   старым) → render продолжается с epoch=5 на старых participants.
3. Тогда `_classifyCache` для старых participants хранит value@epoch=5,
   а текущий epoch=5 → cache hit → OK.

Реальный риск: `bumpClassifyEpoch()` также вызывается в начале каждого
`_renderFull` (`teamScanner2.js:1580`). Если render внутри
`_fetchAndRender` падает после bump'а — последующие renders без bump (как
re-paint от click на toggle без refresh) могут читать cache from previous
epoch, но это уже исправляется bump'ом в `_renderFull`. **В целом OK,
но invariant хрупкий**: любой code path, ведущий к render'у без
прохождения через `_renderFull`, ломает correctness.

Не покрыто тестами: что происходит с classifyCache при partial render
(`_renderPanelOnly`).

### S1-3. Concurrent fetch / late callback: jobId race

`teamScanner2.js:976-984` — после fix'а 2026-05-11 закрыт race на
`onJobId` callback, но **остаётся** race на `jenkinsPromise.await`:

```js
const jenkinsData = await jenkinsPromise;   // 2980
// V19 C4 — pulse fetch выполнен → emit latency event.
const fetchLatencyMs = Date.now() - fetchStart;
```

Если `jenkinsPromise` падает (timeout) ПОСЛЕ того, как `reqId !==
this._reqId` уже произошёл (refresh #2 запущен) — `jenkinsData = {error:
'aborted'}`. Хорошо. Но `this._lastRawDiag` всё ещё пишется снаружи
guard'а — то есть на `teamScanner2.js:1000` `_lastRawDiag = {...}`
выполнится для refresh #1, **переписав** _lastRawDiag от refresh #2
(если #2 уже завершился раньше — невероятно, но не невозможно).

Reqid-guard на `teamScanner2.js:985` (`if (reqId !== this._reqId) return`)
помогает: после этого guard'а `_lastRawDiag` уже не пишется. ОК.

**Но** `_lastFetchLatencyMs` пишется на `teamScanner2.js:997` после guard'а,
тоже ОК.

Реальный race: `this._jobId = id` в `onJobId` callback вызывается из
`startData.jobId` (внутри `portfolioPulseApi.js:80-81`). Если #1 уже
получил jobId=A и записал в `this._jobId`, потом #2 запустился (новый
`reqId++` → A's reqId-check не сработает в onJobId уже не вызывается,
т.к. #1 aborted'ом), но **детальный fetchDetail может попасть на jobId A
который уже abort'нут на сервере** → 404. Это уже обрабатывается
graceful'но через `fetchEmployeeDetail` → throw. OK.

### S1-4. Identity-deterministic — exception для Jenkins norm match

`teamScanner2.js:1373-1389` — Jenkins identity match:
```js
const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
const byName = new Map();
for (const [name, rec] of Object.entries(perAuthor)) {
  const k = norm(name); if (k) byName.set(k, rec);
}
for (const p of model.participants) {
  const candidates = [p?.label, p?.fullName, p?.displayName, p?.name, p?.email].filter(Boolean);
  let rec = null;
  for (const c of candidates) {
    const r = byName.get(norm(c));
    if (r) { rec = r; break; }
  }
  ...
}
```

Это **не identity-deterministic** в смысле CLAUDE.md §2: норма case-
insensitive + whitespace-collapse это не fuzzy, но всё ещё ловит
тёзок. Если в Jenkins есть «Иван Иванов» (consultant on контракт) и в
Jira участник «Иван Иванов» — match произойдёт, хотя люди могут быть
разные. Контракт говорит: «email > jiraAccountId > bbLogin». Jenkins
match через email или явный `jenkinsUserName` field — да, это
identity-deterministic. Match через `label` — ослабленный fuzzy.

Контракт-комментарий на `teamScanner2.js:1366-1369` явно заявляет «не
fuzzy», но реализация всё-таки fuzzy в широком смысле. В Сберовской
specifics часто бывают полные тёзки (это причина всего ambiguous-cf
flow!) — Jenkins тут уязвим.

**Fix-direction:** перенести Jenkins match на BulkResolve flow, где у
employee есть `jenkinsUserName` поле (уже сделано — `teamScanner2.js:3325-
3326`). Здесь же — fallback ТОЛЬКО по email (deterministic).

### S1-5. fetchEmployeeDetail без abort через unmount

`teamScanner2.js:797-838` — `fetchDetail` дёргает `fetchEmployeeDetail`
с **собственным таймаутом 30 сек**, но без `signal` от `this._abort` или
`_globalAbortCtrl`. То есть если пользователь нажал на row, потом
переключил subtab — fetch продолжает 30 сек в воздухе. На graceful
unmount HTTP запрос продолжает крутиться, `_detailCache.set` после
завершения промаха в Map (cache живой), но всё в скрытом subtab'е.

**Impact:** memory churn + network. На активных пользователях drill-down
очень часто.

**Fix-direction:** прокинуть `signal: this._abort?.signal` (или новый
detailAbortCtrl) в fetchEmployeeDetail; abort при unmount.

### S1-6. `_searchCache` инвалидация по shape-key — слабая

`teamScanner2.js:174-181`:
```js
const first = list[0]; const last = list[list.length - 1];
const dataKey = list.length + ':' + (first?.key || first?.label || first?.id || '') +
                ':' + (last?.key || last?.label || last?.id || '');
```

Hash на 3 фичах: length + first.key + last.key. Это ловит большинство
случаев замены, но **не ловит**: участники добавились в середину
(например auto-create employees из Jira возвращает их в `sort`-order'е
которое случайно совпадает с предыдущим первым/последним). На малых
изменениях команды (1-2 человека, новый сотрудник посередине) cache
вернёт stale результат поиска. Для поиска по имени риск низкий, но
гипотеза: если новый member должен matchнуться в текущем query, он не
появится до полного refresh.

**Fix-direction:** добавить hash от sum-of-key-hashes (FNV-1a по сумме
participants.map(p=>p.key)), или вообще использовать `bumpClassifyEpoch`
counter как cache key. Идемпотентность важнее микро-оптимизаций.

### S1-7. Snapshot CRC32 — defense-in-depth, не security

`teamScanner2History.js:102-122` — добавил CRC32 для tamper-detection.
**Намерение хорошее, но**:
- CRC32 не криптографический. Если XSS-attacker имеет write-access в
  localStorage — он легко пересчитает CRC.
- Комментарий честно говорит «tamper-detection, not authentication» —
  ок, **но это даёт false sense of security**: следующий разработчик
  может подумать «integrity → ok, доверяем».
- Применение: если snapshot не валиден — он **drop**ается (`loadHistory`
  фильтрует через `verified`). Тимлид думает «нет тренда», не понимая
  что-то pruned. Нет UI-уведомления.

**Fix-direction:** либо снять CRC32 как noise, либо переименовать в
`_recoveryHash` и эмитить telemetry-event на drop. Если делать
security всерьёз — нужен HMAC с server-issued key.

### S1-8. `_pulseCluster` TTL=120мин + persist-file — но cancel-registry в памяти

`server.js:831` — `_pulseCluster` имеет `persistDir`. То есть jobs
переживают server-restart. **Но** `_pulseCancelRegistry` в
`server/pulse-runner.js:106` — обычный Map, не persistent.

Scenario:
1. Job `pulse-A` создан, занесён в persistDir.
2. Server crashes / OOM-kill.
3. Restart → `_pulseCluster.load` восстанавливает job (если cluster это
   делает; не проверил, но persistDir обычно используется для этого).
4. **Cancel-registry пуст**. Если client попытается `/cancel/pulse-A` —
   нет entry → 404 (или silent).

Это не data-corruption, но cancel становится no-op'ом для
переживших-restart jobs. Не критично (TTL 120 мин их закроет), но если
job был «running» в persist-state — после restart его phase=`fetch-jira`
останется навсегда (job-runner не перезапустится; `_pulseRunJob`
вызывается только при `/start`).

Также `_pulseDetailCache` (`server.js:854`) — Map в памяти, после
restart drill-down — cold cache, 200-500мс penalty (OK).

### S1-9. _flushServerAuditQueue без backoff

`teamScanner2.js:2656-2680` — flush аудит-очереди на mount. **Никакого
backoff/throttling** — если сервер дал 500, на следующем mount опять
весь queue улетает. Pилот может открывать-закрывать вкладку каждые 30
сек → DDoS-effect на свой же `/diag-audit` endpoint.

Также: `remaining[]` накапливает до `_AUDIT_QUEUE_MAX=50` (`teamScanner2.js:2640`),
после чего slice(-50) выкидывает старые — потенциально HR-аудит-trail
теряется.

**Fix-direction:** exponential backoff с jitter, последняя попытка
timestamp, не флушить если прошло меньше N минут с прошлой неудачи.
Не теряем старые entries — лучше fail loudly чем silent loss.

### S1-10. Reactive.silent + identity-resolve double-mutation gap

`teamScanner2.js:3243-3266` (preview save) внутри одного
`Reactive.silent`:
```js
Reactive.silent(() => {
  for (const d of changes) { ... emp.bitbucketLogin = d.after.bb ... }
  for (const p of ambigPicks) { ... emp.confluenceAccountId = p.cfAccountId ... }
});
try { Storage.save?.(); } catch (e) { console.warn(...); }
```

Один Reactive.silent блок — хорошо. Но **Storage.save** ВНЕ silent, как
и положено по комментарию `teamScanner2.js:3242`. Проблема: при
QuotaExceededError здесь — **state в памяти уже изменён** (employees
получили `bitbucketLogin = newSlug`), а диск НЕ обновлён. После reload
изменения потеряются. См. также `teamScanner2.js:3417-3431` в
`_runBulkIdentityResolve` — там фикс 2026-05-11 даёт toast пользователю,
но **не rollback'ит** мутации.

Контракт «save после silent» означает «save один раз». Но если save
fail'нул — нужен либо rollback, либо persistent-retry-queue (как
audit), либо хотя бы UI «изменения не сохранены, попробуйте через минуту».

`_syncEmployeesFromParticipants` (`teamScanner2.js:1547-1559`) делает
правильный rollback. Тут — нет.

### S1-11. Sync `localStorage.getItem` в горячем пути

`teamScanner2.js:444-449` (`_cleanupStaleSnapshots`) делает
`localStorage.length`-iteration и `getItem` для каждого ключа. На
браузере с 200+ ключами это блокирующая операция ~10-30мс. Запускается
на каждом `_saveSnapshot` (на каждом refresh). Не критично, но
переписать на throttled cleanup (раз в час).

Аналогично `teamScanner2.js:444-449`, `loadHistory` парсит JSON-blob 30
snapshot × N команд на каждом render (`_renderFull` дёргает `loadHistory`
through `loadHistory(projectKeys, 14)` — синхронно). Это уже cached в
браузере (localStorage native), но JSON.parse + filter не cached.
~5-10мс на render для 30 snapshot'ов. На каждом click toggle это
дополнительный latency.

### S1-12. computeBlockers — потенциальное двойное чтение assigneeIndex

`teamScanner2Enrichment.js:1076-1078`:
```js
const candidates = []
  .concat(assigneeIndex.get(p.jiraAccountId) || [])
  .concat(assigneeIndex.get(p.email) || []);
```

Если у participant заполнены и `jiraAccountId` и `email`, и в
`buildAssigneeIndex` они оба указывают на одни и те же issues — будет
duplicate iteration (отфильтровывается через `seen` Set, ОК). Но это
N×2 RAM walk на больших командах.

`buildAssigneeIndex` (`teamScanner2Enrichment.js:1012-1040`) сохраняет
issue под двумя ключами (accountId и email) — раздувание Map в 2 раза.
На 5 PK × 500 issues × 100 employees это 250k Map-entries. На 1 GB
heap'е это копейки. Скорее observability concern — diagnostic'у сложнее
понять размер index'а.

### S1-13. CR velocity — outlier-фильтр на client side

`teamScanner2Enrichment.js:1147-1159` бракует deltaH > 14 дней. Это OK,
но: PR который открыт 8 дней назад и получил review «через 30 минут»
будет в данных (т.к. delta правильная). Однако если **review-event
вернулся из BB позже чем opened-event** (например server BB вернул items
неупорядоченно, или один автор сделал PR от лица другого) — `prOpenedAt`
будет min из reviewer items, что не правильно.

Гипотеза: BB activity API всегда возвращает opened-event автору
участника-автора (тот, кто создал PR), а review-event — ревьюеру. Если
этот invariant нарушается (например `state.employees` без BB-mapping
автора → PR не attribut'ится автору → `prOpenedAt` берёт `at` review-
event'а как min!) — CR velocity медиана становится ~0, что выглядит как
«мгновенное ревью».

**Fix-direction:** `prOpenedAt` строить ТОЛЬКО из `it.kind === 'pr' &&
it.action === 'opened'` (если такое поле есть), иначе не учитывать.

### S1-14. cancel-fetch для Jenkins использует `AbortSignal.any` с polyfill-guard

`teamScanner2.js:940-942`:
```js
const combinedSignal = AbortSignal.any
  ? AbortSignal.any([this._abort.signal, AbortSignal.timeout(JENKINS_TIMEOUT_MS)])
  : this._abort.signal;
```

`AbortSignal.any` доступна в Chrome 116+, Firefox 124+, Safari 17.4+. В
корп-Сбер часто стоит Chrome 110-115 (политика обновлений). Тогда
fallback'ом будет `this._abort.signal` — БЕЗ таймаута 8s. Значит Jenkins
fetch с зависшим SSO-redirect'ом будет ждать… до конца pulse fetch'а
(600s). Это противоречит явному комментарию.

**Fix-direction:** ручной polyfill через `Promise.race` + manual abort
(как было раньше — комментарий упоминает это).

---

## Medium (S2) — будущая боль, постепенный гниль

### S2-1. Sigma vs Delta — переключение источников не идёт через scanner

Scanner работает ТОЛЬКО с Delta-Jira (`jiraBaseUrl`/`jiraToken`),
комментарий `teamScanner2.js:27-32` явно говорит. Это нормально, но
`sigmaErrorsCount` в `_lastRawDiag` (`teamScanner2.js:1288-1294`)
читает `raw?.errors` и фильтрует Sigma-scope'ы. Зачем сканер trekит
Sigma errors? Это noise в diagnostic. Не критично, но contributes к
«размытию» что есть scanner state.

### S2-2. teamScanner2.js 3640 LOC — god-orchestrator

Файл оркестратора 3640 строк, 50+ методов. Каждый метод вешает свои
listener'ы через global Abort (хорошо), но cognitive load огромный.
Контракты "single-file orchestrator" нет — есть `pulse/index.js`
facade, но scanner не facade'ит. Раньше планировался S10 split на
attach/paint/detach (`teamScanner2.js:257-289` уже есть), но никто на
него не мигрирован.

**Impact:** новый feature → строка в orchestrator → conflict-prone, hard
to test in isolation. Renderer'ы уже split'нуты на 5 файлов; orchestrator
заслуживает то же.

### S2-3. `_renderFull` re-render полный, не diff

Каждый toggle search keystroke (debounce 200ms) → `_renderFull` →
`this._container.innerHTML = html`. Из 109 participants → весь DOM
перестраивается. UX feedback это «работает», но **в любой момент
listener'ы детачаются вместе со старым DOM**. Чудо что текущая система
не leaks: всё держится на `_globalAbortCtrl` + `_kebabAbort` (хорошо
покрывает global listeners). Local listeners (на rows) уходят с
removeChild, тоже OK. Но **focus теряется** на каждый rebuild — costly
для accessibility.

`teamScanner2.js:2015-2022` восстанавливает focus в search-input через
`requestAnimationFrame`, **но**: setSelectionRange(len,len) — курсор в
конец. Если пользователь печатал в середине строки — теряет позицию.

**Fix-direction:** diff-based render для toggle/search (или хотя бы
сохранение selectionStart/End до innerHTML rewrite).

### S2-4. Heatmap72x4 — 5×72 grid на каждом participant, x N participants

`teamScanner2Enrichment.js:923-973` строит 5×72 grid (=360 чисел) per
participant. На 109 participants × refresh = 40k чисел. Не дорого, но
делается **дважды** (`p.heatmap72x4` и `p.sparkline72h` через
`computeSparkline72h` который сам пере-вычисляет если нет cache — `929-
1001`). Реализация cache-aware (`computeSparkline72h:982` использует
`p.heatmap72x4.colTotals`), но это implicit dependency.

### S2-5. computeContextSwitches — O(N log N) сортировка на каждом render

`teamScanner2Enrichment.js:548-580` сортирует все timeline-events. Это
вызывается в `enrichForScanner2` (`teamScanner2Enrichment.js:412`)
**один раз на pulse fetch**, не на render — ОК. Но `applyPersonMetrics`
(`teamScanner2PersonMetrics.js:287-289`) тоже walks participants. Под
debug profile'ом я бы ожидал ~50-100мс enrichment на 109 participants —
видеоный пилот это терпит.

### S2-6. Service-account regex дублирован

`teamScanner2Enrichment.js:74-81` дублирует логику из
`EmployeeFactory.detectServiceAccount`. Комментарий объясняет: cycle-
break. **Это правильно**, но pattern не имеет shared-test'ов: один из
них может разойтись с другим. Property-test «при изменении паттернов —
обе должны catch одинаково» нет.

### S2-7. Анализ TZ-skew vs network latency — confounded

`teamScanner2Diagnostic.js:740-779` — `computeTzSkew` различает
`unmeasurable=true` если cache age > 60s (хороший fix). Но **если cache
< 60s**, `skewSeconds = ageMs / 1000` всё ещё включает network latency.
Если корп-VPN добавляет 50-60s latency (бывает на BB-storms), это
ложно покажется как «clock skew». UI banner предложит «сверь часы», что
не applicable.

**Fix-direction:** различать «ageMs > 30s» как «not measurable for skew,
only cacheAge». Или передать `Date.now()` client-side ПЕРЕД fetch'ом
вместе с другим payload — round-trip difference измерит latency
отдельно от skew.

### S2-8. Sprint-filter fail-open — но нет UI-индикации

`teamScanner2Enrichment.js:342-363` ловит failOpenReason — но рендер
этого в UI зависит от `model.scannerV2.activeSprintFilter.failOpenReason`.
В `teamScanner2RendererHero.js` (не читал, но можно искать) этот флаг
обрабатывается, но я не уверен что пилот видит явный banner «filter не
применён из-за API-error». Без banner'а — silent stale-data.

### S2-9. Bb prefix-resolve включает email-prefix без dot — collisions

`server/integrations-api.js:931-935` пробует `prefix` + `prefix.replace(/\./g, '')` + плюс strip — это 3-4 lookups per user. На 100 candidates × 4 = 400 BB API calls. С `concurrency 5` это ~80 секунд. Если BB throttle'нёт — multi-min lookup. UX «ждите минуту-другую» — fragile.

### S2-10. _detailCache — нет server-side TTL alignment

Client cache TTL 5min (`teamScanner2.js:794`). Server jobId TTL 120min
(`server.js:831`). Pulse-detail rate-limit 30 req/60s
(`server.js:850`). Эти три TTL не coordinated. Если client cache miss
сразу после server-side rate-limit refill — race ОК. Если client serves
stale (TTL 5min) после refresh но до server jobId expiration (120min)
— inconsistency: пользователь видит «вчерашние» blocker'ы в drill-down,
но «свежие» в team-glance.

### S2-11. _smokeTestWarnings — silent если orchestrator не рендерит

`teamScanner2.js:1349-1364` фиксирует warnings про BB/CF-attrition.
Сохраняет в `this._model._smokeTestWarnings`. Но я не вижу в renderer'е
кода, который их **визуализирует** (нужно искать `_smokeTestWarnings`).
Если renderer не показывает — это «ghost data» только для telemetry.

### S2-12. Demo-mode + classify cache

`teamScanner2.js:568-637` (loadDemo) делает `bumpClassifyEpoch` неявно
через последующий `_renderFull` → OK. Но `enrichForScanner2` для demo
запускается на fixture, который НЕ имеет real `model.spaces` —
`_buildActiveSprintKeySet` вернёт пустой Set, `activeSprintFilter` —
fail-open. Comment'арий 2026-05-09 это упоминает. ОК, но это race-
sensitive: demo с включённым sprint-toggle → fall through.

### S2-13. searchInputHandler — closure хранит this

`teamScanner2.js:2009-2034` создаёт debounced handler с captures `this`.
Очистка в `unmount()` (`teamScanner2.js:3633`) обнуляет, ОК. Но между
`_renderFull` пере-вызовами handler остаётся **тот же** (ленивая
инициализация на line 2011). Хороший дизайн — не пересоздавать.

Однако: внутри handler'а `_renderFull` вызывается через `this`. Если
после debounce'а unmount произошёл, но handler уже в timer'е → triggers
`_renderFull` на размонтированном sub-tab'е. Защита — на line 2017
`const newEl = this._container?.querySelector(...)`. Если `_container ===
null` — focus не восстанавливается, но `_renderFull` УЖЕ выполнен,
делая render в null container'е (`teamScanner2.js:1574: if
(!this._container || !this._model) return`). Защита есть. ОК.

### S2-14. eslint-rules — отсутствие проверки на `Reactive.silent` mass-mutation

Не нашёл custom eslint-rule для проверки что `state.X.push` вне
`Reactive.silent` помечается warning'ом. CLAUDE.md контракт #1 — самый
важный invariant, и единственная защита — discipline разработчика.

---

## Low / Nice-to-have

### L1. `_extractSnapshot` дублирует classifier-логику inline

`teamScanner2.js:367-403` — снова inline classify, тогда как
`teamScanner2History.js:50-54` уже использует canonical `classifyPerson`.
Не критично, но S8 #15 commitment broken: «single source of truth».

### L2. `_postCancelToServer` без retry

`teamScanner2.js:867-879` — fire-and-forget. Если сеть отказала ровно в
этот момент — server-side job продолжит работать. Низкий риск, server-side
TTL подметёт.

### L3. `_AUDIT_QUEUE_MAX=50` — magic number

`teamScanner2.js:2640`. Если HR-аудит требует все события — 50 мало для
2-3 месячного offline-периода. Не критично.

### L4. `data-pm-formula` содержит «формулу с эмодзи»

`teamScanner2RendererPersonRows.js:1302` — `data-pm-formula="...
Confidence: ..."` — формулы могут содержать символы которые в attr-
value требуют escaping. В коде через `esc()` — но `esc()` (=
portfolioPulseUtils.js) делает 5 standard символов. Скорее всего OK,
но property-test был бы полезен.

### L5. Memoize-cache `_v20s8_metricsMemo` с non-enumerable

Хорошее решение. Но если кто-то делает structuredClone — теряется. Если
делается deep copy для testing — теряется. Документирована рядом —
надо чтобы тесты на enrichment'е специально проверяли что memo не
влияет на повторные вызовы.

### L6. computeZScore + computeEmaWoW дублированы в Diagnostic

`teamScanner2Diagnostic.js:862-895` — комментарий честный, но
дублирование легко расходится в семантике (см. различие
`emaLastWeek: null` (diagnostic) vs `0` (enrichment) при insufficient
history — это разные fallback'и для одного и того же).

### L7. CF-attribution heuristic в `bbCfAttribution`

`teamScanner2Diagnostic.js:982` `bbBadgeItemsMismatch = commits48h > 0 &&
bbItems.length === 0` — хорошая идея, но если оба `0` — нет mismatch'а
по этой формуле. Edge cases не покрыты тестами.

---

## Соответствие 4 контрактам

### Reactive.silent: ✓ соблюдён (с одной оговоркой)

- `_syncEmployeesFromParticipants` (`teamScanner2.js:1540-1546`) —
  push в `Reactive.silent`, Storage.save вне. ✓
- `_openIdentityResolvePreview` save (`teamScanner2.js:3243-3266`) —
  mutations в silent, save вне. ✓ (но без rollback on save fail, см.
  S1-10)
- `_runBulkIdentityResolve` (`teamScanner2.js:3398-3414`) — ✓
- `_bindBbAuthorToEmployee` (`teamScanner2.js:3088`) — single-field
  mutation вне silent. Согласно комментарию `teamScanner2.js:3061`
  это допустимо для single-field. Контракт CLAUDE.md §1 явно говорит
  про **mass-mutations**, поэтому ✓.

**Оговорка:** `Reactive.silent(async fn)` (V21 M fix в
`reactiveStore.js:162-172`) — depth держится до Promise resolve. Scanner
не использует async внутри silent, но если кто-то добавит — сейчас
безопасно (хорошо).

### Identity-deterministic attribution: частично ✗

- Jira: ✓ (через `jiraAccountId`)
- BB: ✓ (через `bitbucketLogin` + BulkResolve cascade)
- CF: ✓ (через `confluenceAccountId` + ambiguous-cf handling)
- Zephyr: ✓ (через `jiraAccountId` mapping в server)
- **Jenkins: ✗** — fallback fuzzy-match по `label / displayName` без
  email (`teamScanner2.js:1380-1389`). См. S1-4. После заполнения
  `jenkinsUserName` через bulk-resolve становится deterministic, но
  initial state — fuzzy.

### _scrubSecrets: ✓ соблюдён

- `prepareDiagnosticExport` (`teamScanner2Diagnostic.js:507-553`) —
  единая точка экспорта. ✓
- `_scrubInPlace` + `_scrubTokensOnly` (`teamScanner2Diagnostic.js:1257-
  1317`) — defense-in-depth (raw mode тоже скрабит токены). ✓
- `_safeDeepClone` (`teamScanner2Diagnostic.js:838-854`) — корректно
  handles circular, BigInt, Map, Set, Date. ✓
- Property-based test есть (`teamScanner2ScrubProperty.test.js:149-186`),
  200 random PII payloads. ✓
- Memo `_v20s8_metricsMemo` non-enumerable → не попадает в export. ✓
- `_lastRawDiag` сам не PII, но содержит `bbAuthorSlugs` (`teamScanner2.js:1004`)
  → они проходят через scrub regex `^(bbAuthorSlugs|...)$` в
  `_scrubInPlace:1270`. ✓
- **Гипотеза-риск (не нашёл прямого нарушения):** если в server response
  попадёт поле с именем не из regex (например `usrLogin` без 'username'
  pattern) — может утечь. Но 200-fuzz-test это покрывает.

### Auto-rerender grace 250ms: ✓ соблюдён через debounce 200ms

- Search debounce 200ms (`teamScanner2.js:2022`) — близко к 250ms
  (комментарий тут говорит «всё ещё ощущается responsive»). ✓
- `Reactive.silent` отключает debounced flush — масс-операции не
  триггерят авто-render. ✓
- `requestAnimationFrame` для focus restoration — не блокирует commit.
  ✓

---

## Тестовое покрытие — пробелы

**Что покрыто хорошо:**
- Classifier (`teamScanner2Classifier.test.js` — 14 тестов, включая
  edge cases на reviewer-heavy роли).
- Scrub contract (`teamScanner2ScrubProperty.test.js` — 200 random
  PII).
- Diagnostic shape, sensitivity, TZ skew (35+ тестов).
- Enrichment metrics (>40 тестов на heatmap, blockers, sprint goal,
  pickDwellThreshold).
- History dedupe + extractTrendSeries.
- Lifecycle (`unmount` cleanup).
- Demo fixture.

**Серьёзные пробелы:**

1. **Race condition tests — НЕТ.** Концепция reqId-guard
   (`teamScanner2.js:980`, `985`) ловит double-refresh, но **нет тестов**
   что second `refresh()` корректно abort'ит и не оставляет stale
   _model / _jobId. Hard to test без integration setup, но реальный
   риск.

2. **TTL race / abort-during-fetch — НЕТ.** Что если AbortController
   abort'ится во время `analysePulse` (CPU-bound)? CPU-bound функция
   не реагирует на abort. Проверки `_pulseAssertNotCancelled` на phase-
   transitions — ОК (server-side), но client-side нет такого checkpoint'а
   в analysePulse / enrichForScanner2.

3. **Storage quota exceeded — НЕТ.** Property-test «при QuotaExceededError
   на любом setItem, state в памяти остаётся consistent». Прецеденты:
   `_saveSnapshot`, `saveDailySnapshot`, `_persistSelectedTeam`,
   `_enqueueServerAudit`, `_openDiagDisclaimer` (consent_until). Каждый
   handles по-разному.

4. **Demo + real + demo цикл — НЕТ.** `loadDemo → real `refresh` → `loadDemo`
   — пути `_model`, `_jobId`, `_pendingShareKey`, `_lastRawDiag`
   корректно зачищаются? Есть `exitDemo` логика, но не покрыта тестом
   на полный цикл.

5. **Service-account regex синхронизация — НЕТ.** Тест что
   `EmployeeFactory.detectServiceAccount` и
   `_detectServiceAccountByKey` ловят одно и то же на ~100 random patterns.

6. **Search-cache invalidation — частично.** Тестов на shape-change
   pattern не нашёл. Если new participant добавлен в середину массива
   без изменения first/last — cache отдаст stale.

7. **Reactive.silent + Storage.save mass-mutation contract — НЕТ
   eslint-rule** (поверхностно проверил `eslint-rules/`). Discipline-only.

8. **`fetchEmployeeDetail` без signal — НЕТ тестов** что после unmount
   in-flight detail не вызывает `_detailCache.set` на размонтированном
   orchestrator'е.

9. **CRC32 tamper — НЕТ negative-теста** что подделанный CRC drop'ает
   snapshot.

10. **Jenkins fuzzy-match — НЕТ negative-теста** что два разных «Иван
    Иванов» матчатся в одного.

11. **Sprint-filter `failOpenReason='api-error'` UI — НЕТ contract-теста**
    что renderer показывает баннер.

12. **`AbortSignal.any` polyfill fallback — НЕТ.** Если браузер старый,
    Jenkins fetch без timeout — тест на это в e2e отсутствует.

---

## Killer ideas (моего профиля)

### K1. Server-emitted health-token для invalidation
Каждый pulse response несёт `_healthToken = sha256(authHash + cfg
fingerprint + git-rev)`. Client сравнивает с предыдущим (был — нет).
При rotation токена / config change → token меняется → client делает
hard refresh, не используя stale cache. Закрывает class «old jobId жил
дольше, чем authHash живой».

### K2. Result-degradation badge: partial-data marker
Если pulse fetch вернулся с `reports[i].error` для одного из PK — model
получает `_partial: true`. UI явно показывает «N из M PK ok»,
classification считается **только по успешным**, idle-classification
explicit'но помечается «нет данных по проекту X». Сейчас один failed PK
тихо разрушает counts.

### K3. Snapshot circular-buffer вместо localStorage hash
Перевести history на `IndexedDB` (поддержано во всех Сбер-браузерах) —
quotа 50MB+ против 5MB localStorage, structured storage, transaction
guarantees. Текущий CRC32 заменяется на native tx commit. Снизит
quota-risk до нуля, открывает дорогу к 90-day history (требуется PO).

### K4. Telemetry pipeline c sampling
Сейчас `scanner2.silent_error` шлётся на каждый failure (потенциально
100+/min при storm). Server-side получает шум. Sampling: 1 на 100 для
recurring errors (детектится по `where` + `msg`-prefix), 100% для new.
Снижает logger pressure на 99% без потери visibility.

### K5. Background-prefetch для drill-down
Detail-cache cold-miss = 200-500мс. Если пользователь наводит мышкой
на row (hover-event) — prefetch detail в `_detailCache` с low-priority.
К моменту click — уже cached. Standard pattern, скрывает network latency.

### K6. Circuit-breaker на client-side для diag-audit endpoint
Если 3 подряд `_flushServerAuditQueue` упали → circuit open на 5 минут.
Сейчас retry-без-backoff на каждом mount.

### K7. Smoke-test → soft-error UI banner
`_smokeTestWarnings` сейчас silent. Banner «BB raw=234 → enriched 0
items. Возможно identity-фильтр или enrichment-баг. Открыть Diagnostic?»
повышает self-service по 80% incidents без обращения к разработчику.

### K8. Source-of-truth для server vs client TZ
Передавать в `/start` тело request'а `clientTzOffsetMin + clientNow`
(timestamp в UTC ms). Server возвращает в `pulse.diagnostics.timeSync = {
clientNow, serverNow, deltaMs }`. Client при render показывает «clock
drift Xs» в diag-modal — точно, без confounding с network latency.

### K9. Reactive.silent linter
`eslint-rules/no-state-mutation-outside-silent.js`: AST-rule, ищет
`state.<x>.push(`, `state.<x>.splice(`, `delete state.<x>.y` вне
явного `Reactive.silent(() => {…})`. Predicate: «mutation на reactive
proxy не должна происходить outside silent на bulk-paths». Найти
inline-comment whitelist (`/* @reactive-ok */`) для legitimate
single-field mutations. Закрыл бы main contract в CI permanently.

### K10. Persist-recovery test harness
Mock-IndexedDB / mock-localStorage, который spec'ит:
- При quota exceeded на любом setItem, поведение orchestrator'а
  определено (не infinite loop, не silent ghosting).
- При corrupted JSON в любом ключе — graceful fallback.
- Migration V18 → V22 не теряет данных.
Property-test через `fast-check` или ручной — но обязательно systematic.

---

## Что бы я сделал первым

### #1. Quota-resilience pass (S0-2 + S1-1 + S1-10)
1. `_cleanupStaleSnapshots` сделать **pre-write**, идемпотентным,
   throttle 1 раз в час.
2. На QuotaExceededError — single toast «storage переполнен» + lock
   до user-action (кнопка «очистить» в Diagnostic-modal).
3. Identity-resolve save — rollback на quota fail (как у
   `_syncEmployeesFromParticipants`).
4. `_autoSyncDisabled` — banner в UI «auto-sync приостановлен», кнопка
   re-enable. Сейчас silent.

Стоимость: 1-2 дня. Покрытие: главный pilot pain после долгой сессии.

### #2. XSS audit + Utils.escapeHtml единообразие (S0-1)
1. Найти все `innerHTML = \`...\${X}...\`` где X не Utils.escapeHtml'нут.
   Сейчас минимум 3 точки (`teamScanner2.js:2401`, plus наверняка в
   renderer-файлах).
2. Заменить ad-hoc regex-escape на canonical helper.
3. Property-test «100 random strings из ASCII+control+unicode → нет
   `<script>` в результирующем DOM».

Стоимость: 0.5 дня. Покрытие: предотвращает 1 class of vuln'ов
permanently.

### #3. Race-condition + abort coverage (S1-2 + S1-5)
1. Прокинуть `signal` в `fetchEmployeeDetail` от `_abort`. unmount =
   automatic cancel detail-fetch.
2. Добавить `_pulseAssertNotCancelled`-equivalent client-side checkpoint
   в `analysePulse`/`enrichForScanner2`: если `reqId !== _reqId` — bail
   из CPU-bound loop. Простейшее: проверка каждые N iterations участников.
3. Test harness, имитирующий double-refresh: оба должны finish без
   stale-data crossover.

Стоимость: 1-2 дня. Покрытие: long-running pilot sessions, особенно при
slow Jira (90s+).

---

## Резюме

Код **работает**, и большая часть обнаруженных проблем — это либо
silent-failure modes (когда что-то невидимо ломается), либо contract
violations которые ловятся только под нагрузкой / в краях. Команда
сделала отличную работу с `Reactive.silent` контрактом, scrub policy
(property-test это серьёзный sign), и identity-deterministic базой.

**Главные структурные debt'ы** (не показал отдельно, но виден сквозь
аудит):
- `teamScanner2.js` (3640 LOC) пора split'ить — `attach/paint/detach`
  API уже задеклорирован, миграция view-консьюмеров ждёт.
- `_lastRawDiag`-структура продолжает разрастаться с каждой новой
  диагностикой — пора выделить в отдельный модуль с типизированной shape.
- Test harness для race conditions / abort / quota — отсутствует как
  класс; это **risk multiplier** на каждом следующем фиче.

С production-ready точки зрения: scanner готов для пилота (5-15 команд,
100-500 человек). Для tier-1 enterprise (1000+ человек, 24/7) — нужны
ещё quota-resilience, real circuit-breakers и server-side persistence
для audit-trail.
