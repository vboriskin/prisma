# 02. Reliability

## REL-1 [H] NEW-15 не починен — `_reactiveBooted` навсегда `false` при синхронном крахе `App.init()`

**Файл**: `app.js:1891-1897`

```js
document.addEventListener('DOMContentLoaded', () => {
  Reactive.silent(() => App.init());     // если бросает — flag не выставится
  _reactiveBooted = true;                 // никогда не достигается
});
```

`Reactive.silent` использует `try { return fn(); } finally { _silentDepth--; }` — он НЕ глотает throws, а перевыбрасывает их. Если `App.init()` выкинет исключение синхронно (например, `Storage.load` хитро упал, или `localStorage.getItem` вернул "[]" → `JSON.parse` упал внутри), линия `_reactiveBooted = true` не выполнится.

**Эффект**:
- Reactive subscribers видят `_reactiveBooted === false` → игнорируют все мутации.
- `Storage.save` через Reactive auto-flush НЕ выполняется до конца сессии.
- Пользователь видит UI (потому что одна из binders успешно отработала до краха), редактирует, **закрывает вкладку — данные не сохранились**.
- Никакого error-boundary / toast / console.error нет в этом пути.

**Severity**: H. Воспроизводимо.

**Рекомендация**:
```js
document.addEventListener('DOMContentLoaded', () => {
  try { Reactive.silent(() => App.init()); }
  catch (e) {
    console.error('[boot] App.init failed:', e);
    window.showToast?.('Критическая ошибка при загрузке. Перезагрузите страницу.', 'error', 0);
    // Не выставляем _reactiveBooted — это правильно (а не баг). Но даём signal.
    return;
  }
  _reactiveBooted = true;
});
```

---

## REL-2 [H] `notify()` глушит exceptions подписчиков

**Файл**: `state.js:178-180`

```js
export function notify(reason='') {
  _listeners.forEach(fn => { try { fn(reason); } catch(e) {} });
}
```

Empty-catch гарантирует «приложение не упадёт», но и **скрывает любой баг внутри listener'а** (typically `App.refreshAll`, `populateFilterDropdowns`).

**Эффект**: silent failure. Я сам это поймал в V12-аудите при ReferenceError на `PromptsEditor` — пользователь видел пустой портал, никакого диагностического сигнала.

**Severity**: H (для разработки) / M (для прод-юзера, у которого «оно как-то работает»).

**Рекомендация**:
```js
_listeners.forEach(fn => {
  try { fn(reason); }
  catch (e) { console.error('[state.notify] subscriber threw on reason="' + reason + '":', e); }
});
```

Один `console.error` в проде в браузерном devtools достаточен — именно его логи разработчик читает первыми, когда «у юзера что-то не работает».

Тоже самое в `reactiveStore.js:69` — там уже `console.warn`, OK.

---

## REL-3 [H] testRunner.js (104 теста) — inline-копии, НЕ тестируют реальный код

**Файл**: `testRunner.js`

```js
// строки 30-31 в файле:
// Inline domain logic (mirrors v8_0 modules — no import needed)
// ============================================================

const RiskEngine = {
  computeFlags(row) { /* ... INLINE COPY ... */ },
};
```

Это **104 теста**, которые работают на КОПИИ кода. Если поменять `riskEngine.js`, эти тесты НЕ упадут — они тестируют свою устаревшую копию.

**Эффект**:
- Создаётся ложная уверенность в надёжности (404 пройденных теста!).
- Реальные `riskEngine.js`, `filters.js`, `dataStore.js`, `state.js`, `rowFactory.js` тестов в `tests/unit/` **не имеют**.
- `npm test` возвращает 0 даже если все эти модули поломались.

**Severity**: H (architectural risk — выглядит будто покрытие есть, на деле нет).

**Рекомендация** (в порядке возрастания усилий):

1. **Минимум**: переписать testRunner.js на использование `import` из реальных модулей (потерять 0 тестов, найти все баги-зеркала).
2. **Лучше**: удалить testRunner.js целиком, мигрировать в `tests/unit/riskEngine.test.js`, `tests/unit/filterEngine.test.js`, и т.д. Запускать через node:test.
3. **Идеально**: ESLint custom rule, запрещающая `const RiskEngine = {` и аналогичные паттерны вне самого `riskEngine.js` (защита от регресса).

В аудите V12 (рекомендация: «Не рекомендую делать») было сказано: «Полный re-rewrite testRunner.js → node:test — XL, low value». Это **неверно** — это medium effort и **high value**, поскольку текущая ситуация хуже отсутствия тестов: ложная уверенность.

---

## REL-4 [M] NEW-5 (cache stampede в Tech Info) сохраняется после декомпозиции

**Файл**: `server/integrations/techInfo.js:103-110`

При декомпозиции в V13 кэш переехал в closure factory:
```js
function createTechInfo(deps) {
  const _techInfoCache = {
    jira:       { data: null, fetchedAt: 0 },
    bitbucket:  { data: null, fetchedAt: 0 },
    confluence: { data: null, fetchedAt: 0 },
  };
  // ...
}
```

Single-flight семантики по-прежнему НЕТ. Если 5 пользователей одновременно открывают Tech Info после рестарта — все 5 параллельно идут в Jira/BB/CF, забивая корпоративный API.

**Severity**: M.

**Рекомендация**:
```js
const _inFlight = { jira: null, bitbucket: null, confluence: null };

async function fetchSource(key, fetcher) {
  // ...
  if (_inFlight[key]) return _inFlight[key];   // join existing
  const promise = fetcher().then(...).finally(() => { _inFlight[key] = null; });
  _inFlight[key] = promise;
  return promise;
}
```

---

## REL-5 [M] `jiraWriteConfig` — НЕ атомарная запись

**Файл**: `server.js:353-356`

```js
function jiraWriteConfig(patch) {
  const next = { ...jiraReadConfig(), ...patch };
  fs.writeFileSync(JIRA_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
```

`writeFileSync` truncate's the file before writing. Если процесс упадёт между truncate и write (kill -9, full disk, OOM) — `jira_config.json` останется пустым/обрезанным.

**Эффект**: после рестарта `jiraReadConfig()` ловит JSON.parse exception (try/catch есть), `JIRA_DEFAULT_CONFIG` (пустые токены) загружается. **Все интеграции отвалились без диагностики.**

**Severity**: M.

**Рекомендация**: write-then-rename:
```js
const tmp = JIRA_CONFIG_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
fs.renameSync(tmp, JIRA_CONFIG_FILE);   // atomic on POSIX
```

---

## REL-6 [M] `readFileSync` / `writeFileSync` блокируют event loop в request handler

**Файл**: `server.js:349, 354`

`jiraReadConfig` вызывается **на каждом** запросе `/api/jira/*` и `/api/integrations/*`:

```js
async function handleIntegrationsApi(req, res, pathname) {
  // ...
  try {
    const cfg = jiraReadConfig();   // ← sync read, ~150 µs typical
```

При 100 RPS на одном Node-инстансе это даёт ~15 ms блокировки event-loop в секунду = **деградация tail-latency**. Для intra-corp 2-3 пользователя — **OK**, но в reusable scenario деградирует.

**Severity**: M (operationally — на текущем deployment не страшно).

**Рекомендация**: либо кэшировать `cfg` в памяти + invalidating при `jiraWriteConfig`, либо переписать на `fs.promises.readFile`. Кэш проще.

---

## REL-7 [M] `Storage.save` — error swallow для не-Quota ошибок (NEW-3 не починен)

**Файл**: `dataStore.js:35-37, 55-57`

```js
} catch(e){
  if (e && e.name === 'QuotaExceededError') window.showToast?.('...', 'error');
}
```

Любой `SecurityError` (Safari Private Mode), `InvalidAccessError` (frame без cookies), JSON-stringify-исключение (циклическая ссылка от пользовательского custom-col) — **проглатывается без сообщения**.

**Severity**: M. Пользователь думает что сохранилось, нет.

**Рекомендация**:
```js
} catch(e) {
  if (e?.name === 'QuotaExceededError') window.showToast?.('Память браузера заполнена...', 'error', 4200);
  else { console.error('[Storage.save] failed:', e); window.showToast?.('Не удалось сохранить: ' + (e?.message || 'unknown'), 'error', 4500); }
}
```

---

## REL-8 [L] NEW-6 (sprint-field-id cache invalidation) — частично

**Файл**: `server.js:497-520`

Cache по-прежнему привязан к `cfg.jiraBaseUrl`. Если admin поменяет URL **без рестарта сервера**, в окне TTL=30мин будет использоваться старый field-id.

В V13 этот код **не трогали** — при декомпозиции Tech Info остался `jiraResolveSprintFieldId` в `server.js`.

**Severity**: L (редко).

**Рекомендация**: при `jiraWriteConfig` сбрасывать кэш:
```js
function jiraWriteConfig(patch) {
  // ...
  if (patch.jiraBaseUrl !== undefined) {
    _jiraSprintFieldIdCache = { url: '', id: '', at: 0 };
    _zephyrResultFieldIdCache = { url: '', id: '', at: 0 };
  }
  fs.writeFileSync(...);
}
```

---

## REL-9 [L] `setTimeout` в `_flushTimer` — нет cleanup при unload

**Файл**: `reactiveStore.js:55-58, dataStore.js:65-79`

При закрытии вкладки невыполненный debounced `Storage.save` и `Reactive` flush теряются. Audit V12 ввёл `flushNow()` (вызывается в hot paths типа CSV-import), но в `beforeunload` listener'ах его нет.

**Эффект**: если пользователь редактирует строку и быстро закрывает вкладку (<100ms между keypress и close) — изменение **может** не сохраниться.

**Severity**: L (редкий timing).

**Рекомендация**:
```js
window.addEventListener('beforeunload', () => {
  try { Storage.flushNow(); } catch(_) {}
  try { Reactive.flushNow(); } catch(_) {}
});
```

---

## REL-10 [L] activity handler возвращает confusing clarification если Pulse не загружен

**Файл**: `chat/chatActivityHandler.js:165, 174, 184`, `chat/chatEngine.js:658-665`

```js
const pulseModel = (typeof window !== 'undefined' && window.PortfolioPulse?._model) || null;
const result = handleActivityQuery(userText, { pulseModel });
// ...
const participants = pulseModel?.participants || [];   // → []
const employees = extractEmployees(text, []);          // → []
// → return needsClarification: 'Уточните, активность какого сотрудника...'
```

Пользователь спрашивает «что делает Иван», но на сервере `Pulse._model = null` (модалка ещё не открывалась). В ответ — «уточните какого сотрудника». **Misleading**: имя в запросе ЕСТЬ, но recognizer не имеет с чем сравнить.

**Severity**: L UX.

**Рекомендация**: в `handleActivityQuery` явная проверка:
```js
if (!pulseModel) {
  return { intent, needsClarification: 'Сначала откройте Portfolio Pulse, чтобы загрузить данные о сотрудниках.' };
}
```

---

## Что **хорошо** с точки зрения reliability в V13

✅ **`storage` event listener** — cross-tab sync (NEW-1 закрыт).
✅ **`historyLog` ротация** — `MAX_ENTRIES=1000`, `RETENTION_DAYS=90` (NEW-2 закрыт).
✅ **GigaChat token refresh on 401** — `gigachatGetToken` повторно вызывается в proxyChat (NEW-12 закрыт).
✅ **Storage.flushNow()** — synchronous flush в hot paths типа CSV-import.
✅ **Bundle-CSV allowlist** — токены не восстанавливаются (audit #7).
✅ **/health, /metrics** endpoints — observability на месте.
✅ **rate limit** — DoS protection.
✅ **Promise.allSettled** в Tech Info — partial failures не каскадируют.
