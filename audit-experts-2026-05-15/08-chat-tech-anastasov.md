# Marko Anastasov — Чатбот: tech + reliability аудит

> **Кто я:** Marko Anastasov, бывший CI/CD infra-lead (co-founder Semaphore CI),
> 12 лет в realtime/streaming. Сейчас занимаюсь LLM-streaming-инфраструктурой
> и SSE-надёжностью в enterprise-чатах. Привычная оптика — wire-protocol,
> backpressure, race condition'ы между сетью и UI, recovery после corp-proxy.
>
> **Что смотрел:**
> - `app/llmAssistant.js` (1706 LOC — клиент, SSE parser, AbortController flow)
> - `server/llm.js` (556 LOC — Node proxy, OAuth, heartbeat, budget)
> - `chat/chatEngine.js` (779 LOC — оркестратор intent/rule/LLM)
> - `chat/chatContextBuilder.js`, `chat/chatActions.js`, `chat/chatActivityHandler.js`
> - `chat/scrubChatSecrets.js`, `chat/chatIntentParser.js`, `chat/chatUIRenderer.js`
> - Тесты: `tests/contract/llm.test.js`, `tests/unit/chatIntentParser.test.js`,
>   `tests/unit/chatPrompts.test.js`, `tests/unit/v17ChatRedesign.test.js`
>
> Не смотрел: `chatExplain.js`, `chatPrompts.js` (за пределами скоупа SSE/OAuth),
> `chatReports.js`. По умолчанию доверяю что они не делают сетевых вызовов.

---

## TL;DR (5 главных рисков)

1. **SSE-parser режет строки по `\n` без учёта `\r\n`** (`llmAssistant.js:409`).
   Если upstream шлёт CRLF (часть corp-proxy перепаковывают line-endings) —
   `data:` остаётся `data: ...\r`, JSON.parse падает, токен «съедается».
   **Hypothesis** — нужен fuzz-тест с `\r\n` или `\r\r\n`.

2. **Aborted-flag не идемпотентен между closeBtn / outside-click / stopBtn /
   ESC.** Если abort прилетает между `decoder.decode(...)` и следующим
   `reader.read()`, partial chunk дописывается в `assistantMsg.content`
   ПОСЛЕ `finally`-блока (см. `llmAssistant.js:1597-1624`). `state.llm.history`
   уже свернут, но `onDelta` всё ещё в полёте через rAF и пишет «после смерти».
   **Stale-callback risk** — гарантированно воспроизводится при abort в момент
   крупного chunk'а от GigaChat (~4-16KB delta).

3. **Single-flight OAuth refresh имеет TOCTOU-окно при истечении кеша.**
   `gigachatGetToken` сначала проверяет cache, затем `_tokenInflight`. Между
   ними нет атомарности — если параллельно прилетают 2 запроса и cached.token
   только что просрочился, оба попадут в `_tokenInflight.set(...)` (второй
   увидит уже первое значение). Race узкий, но реальный (см. §High-3).

4. **401-retry на серверной стороне сбрасывает кеш по `clientId`, но НЕ
   гасит in-flight refresh.** `_tokenCache.delete(clientId)` на строке 432
   создаёт окно когда concurrent-запрос ещё держит ссылку на старый token
   из inflight-promise и получит уже-инвалидированный токен. Single retry
   не зацикливается (`retryOnUnauth=false`), но второй вызов получит другой
   401 без второго refresh → user видит 401 без понимания.

5. **Heartbeat `: ping` посылается через `setInterval(..., 25_000)` БЕЗ
   первого ping'а сразу.** Если upstream молчит первые 30+ секунд (медленный
   GigaChat thinking-фрейм для длинного контекста) и proxy режет idle на 30с —
   heartbeat НЕ успевает «прогреть» соединение. Нужен primer-ping сразу после
   `writeHead(200)`. **Уже устранено частично** (`clientRes.write('event: meta')`
   на стр. 251) — но meta-frame летит ДО апстрима, а пауза опасна между
   meta и первым delta-фреймом.

---

## Critical (S0) — token-leak / data-corruption / падение

### S0-1. AbortController: stale-callback пишет в свёрнутую history
**Файл:** `app/llmAssistant.js:1539-1545`, `1670-1690`, `app/llmAssistant.js:592-610`

**Сценарий:**
1. Юзер нажимает «Стоп» (`stopBtn.click` → `state.llm.abortController.abort()`).
2. `reader.read()` в `parseStreamResponse` бросает `AbortError`.
3. **НО** между последним успешным `reader.read()` и проверкой
   `if (abortSignal?.aborted)` на `llmAssistant.js:401` может проскочить
   delta — `onDelta(chunk)` уже вызван, `assistantMsg.content += delta`,
   запланирован `_scheduleStreamRender()`.
4. `catch(err)` ловит AbortError, выставляет `assistantMsg.aborted=true`,
   `state.llm.history` остаётся как есть.
5. **`_streamRafId` всё ещё запланирован.** Когда rAF выстреливает,
   `renderMessages(true)` смотрит на `state.llm.history[history.length-1]`
   — то самое сообщение с уже припёрнутым `…[остановлено пользователем]`
   суффиксом. Но `parseLLMResponse(lastMsg.content)` парсит обрывок JSON
   в structured ещё раз → potential `_validationErrors`.

**Воспроизведение:** длинный ответ (≥4KB), abort в момент когда `onDelta`
уже вызван, но `setTimeout(rAF, 16ms)` ещё в очереди. Время окна ~16ms.

**Почему критично:** при partial JSON-блоке в `assistantMsg.content` после
abort и суффикса « …[остановлено]» — JSON.parse(`jsonMatch[1]`) внутри
`parseStructuredFromLLM` (`chatUIRenderer.js:362`) сбрасывает actions=[],
но **до** этого `assistantMsg.structured` мог быть set в previous render
с валидным `actions`. После abort и pop'а через retry — стейт inconsistent.

**Fix (концептуально):**
- В `finally`-блоке `onLLMPrompt` вызывать `_flushStreamRender()` ДО
  `renderMessages()`, чтобы pending rAF не догнал нас.
- В `_scheduleStreamRender` проверять `if (!state.llm.isStreaming) return;`
  перед запуском CB.
- Альтернатива: bind rAF к `abortController.signal` и cancel'ить на abort.

---

### S0-2. SSE parser не обрабатывает `\r\n` line-endings
**Файл:** `app/llmAssistant.js:409-428`

```js
while ((idx = buffer.indexOf('\n')) >= 0) {
  const line = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 1);
  ...
  if (line.startsWith('event:') || line.startsWith('id:') ...) continue;
  let dataLine = line;
  if (line.startsWith('data:')) dataLine = line.slice(5).trim();
```

**Что увидел:** parser splits по `\n` и потом `.trim()`. Это работает для
honest LF и CRLF (trim() убирает trailing \r). Но:

- Если `decoder.decode(value, { stream: true })` возвращает chunk
  оканчивающийся на `\r` (CRLF разорван между TCP-пакетами), и следующий
  чанк начинается с `\n` — `buffer.indexOf('\n')` найдёт `\n` сразу,
  и `\r` уйдёт в trim, **строка после нормальная**.
- НО SSE spec (RFC 6202 / WHATWG): валидные separator'ы — `\r\n`, `\n`,
  `\r` (одиночный). Одиночный `\r` (старые Mac-style) **не парсится**.
  GigaChat вряд ли его шлёт, но Sberbank corp-proxy переписывал бы я
  не доверял.
- Двойной newline `\n\n` (SSE event boundary) рассматривается как
  «пустая строка между событиями» (`if (!line) continue;`) — это OK.

**Hypothesis:** не баг сейчас, но fragile. **Fix:**
```js
while ((idx = buffer.search(/\r\n|\r|\n/)) >= 0) {
  // ...
}
```

**Severity:** S0 если в проде appearances одиночного `\r`. Сейчас — High.

---

### S0-3. SSE parser лопается на multi-line `data:` events
**Файл:** `app/llmAssistant.js:409-428`

SSE-spec: одно событие может содержать несколько `data:` строк, конкатенируется
с разделителем `\n` (см. WHATWG EventSource §Processing). Текущий парсер
обрабатывает каждый `data:` как independent JSON-frame:

```js
if (line.startsWith('data:')) dataLine = line.slice(5).trim();
...
const parsed = safeJSONParse(dataLine, null);
```

GigaChat посылает один frame = одна data-строка, и текущая реализация
работает. Но **если frame >16KB** (длинный delta после reasoning'а) и
GigaChat решит сегментировать JSON на две `data:` строки — `safeJSONParse`
вернёт null на каждую половину, токен потерян.

**Реалистичность:** GigaChat-2 не делает мульти-`data:` сегментацию,
но GigaChat-3 / GigaChat-Pro может. **Уже не устранено.**

---

### S0-4. Token может попасть в `apiHistory` через assistantMsg.content
**Файл:** `app/llmAssistant.js:1591-1593`, `1455`

```js
state.llm.apiHistory.push({ role: 'user', content: sentUserContent });
state.llm.apiHistory.push({ role: 'assistant', content: assistantMsg.content });
LLMAssistant._saveDebounced();
```

`assistantMsg.content` — это финальный текст от LLM. **LLM сам может
галлюцинировать токен** (видел такое у GPT-4 — выдумывает Bearer'ы).
В `saveConversation` (`llmAssistant.js:679-682`) — есть scrubChatSecrets
на apiHistory **перед persist в localStorage**. Это OK.

**НО** между `apiHistory.push` и `_saveDebounced` 800ms — если в этот
момент произошёл page-crash, content в RAM с потенциальным «выдуманным»
Bearer мог быть прочитан через `chrome://memory`. Привязка — гипотетическая.

**Уже устранено для transit'а** (V21 §16 + L13). Но для RAM-snapshot'а
угрозы пока нет защиты. Severity — Low (theoretical).

---

### S0-5. Heartbeat clearInterval гарантированно течёт на upstream-error
**Файл:** `server/llm.js:254-289`

```js
const heartbeat = setInterval(() => { ... }, 25_000);
const _cleanup = () => clearInterval(heartbeat);
clientRes.on('close', _cleanup);
clientRes.on('error', _cleanup);
...
upstreamRes.on('end', () => { _cleanup(); ... });
upstreamRes.on('error', _cleanup);
```

Всё хорошо? Почти. **Нет cleanup на `upstreamRes` reset** — `upstreamRes.on('end')`
вызовет cleanup, `upstreamRes.on('error')` — тоже. Но если `upstreamReq`
получит `RST` от GigaChat (TCP-reset), события могут не выстрелить, а
upstream закроется через socket-error. На `clientRes` ничего не упадёт
(они независимы) → heartbeat живёт до thread-pool exhaustion.

**Hypothesis** (нужен load-тест с 1000 broken connections).

**Fix:** добавить `upstreamReq.on('close', _cleanup)` + сделать `_cleanup`
идемпотентным (он уже OK: clearInterval × N — no-op).

---

## High (S1) — race / partial-data / stale-state

### S1-1. OAuth single-flight: TOCTOU между `_tokenCache.get` и `_tokenInflight.get`
**Файл:** `server/llm.js:150-215`

```js
async function gigachatGetToken(clientId, clientSecret) {
  const cacheKey = clientId;
  const cached = _tokenCache.get(cacheKey);              // ← read 1
  const now = Date.now();
  if (cached && cached.token && cached.expiresAt - now > 90_000) {
    return cached.token;
  }
  const inflight = _tokenInflight.get(cacheKey);        // ← read 2
  if (inflight) return inflight;
  ...
  _tokenInflight.set(cacheKey, fetchPromise);
  fetchPromise.finally(() => {
    if (_tokenInflight.get(cacheKey) === fetchPromise) _tokenInflight.delete(cacheKey);
  });
  return fetchPromise;
}
```

**Сценарий race:**
- T=0: запрос A читает cached с `expiresAt - now = 89_000` → выходит из
  if-блока, читает `_tokenInflight.get` = undefined, начинает fetch.
- T=10ms: запрос B читает cached с `expiresAt - now = 89_010` (уже не TTL,
  но пред-expiry). НО Node single-threaded → между этими read'ами
  не может быть конкуренции **в одном тике**. Между разными тиками —
  ОК, потому что `_tokenInflight.set` уже выполнен.

Реальный race — НЕ внутри одного `gigachatGetToken`, а **между**
этим вызовом и `_tokenCache.delete(clientId)` на `server/llm.js:432`
(401-retry flow):

```js
if (status === 401 && retryOnUnauth && clientId && clientSecret) {
  ...
  _tokenCache.delete(clientId); // invalidate cached token
  gigachatGetToken(clientId, clientSecret)
    .then(newTok => doRequest(newTok, false))
```

Если параллельный запрос B уже **прошёл cache-check** и держит старый
token в локальной переменной `bearerToken` (closure'ом в `doRequest`),
запрос A инвалидирует cache → запрос B получает 401 от upstream → `B.doRequest`
запускает свой refresh (он `retryOnUnauth=true`) → две инвалидации, две
refresh-цепочки на тот же clientId. Single-flight `_tokenInflight` спасёт
от двух OAuth-вызовов, но не от двух конкурирующих 401-retry циклов.

**Vector:** burst traffic от одного пользователя при экспирации токена.

**Severity:** S1 (worst case — лишний OAuth-roundtrip, юзер видит slow
response).

---

### S1-2. SSE parser теряет первый chunk если приходит до `await reader.read()`
**Файл:** `app/llmAssistant.js:395-407`

```js
const reader = response.body.getReader();
const decoder = new TextDecoder('utf-8');
let buffer = '';
let totalChunks = 0;
let totalDelta = 0;
while (true) {
  if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const { value, done } = await reader.read();
  if (done) {
    dlog('[LLM] stream done | chunks emitted:', totalChunks, '| total delta chars:', totalDelta);
    break;
  }
  buffer += decoder.decode(value, { stream: true });
```

Code корректный. **НО** есть вопрос с `TextDecoder({ stream: true })`:
последний `reader.read()` после `done` НЕ flushes `TextDecoder`'s
internal buffer. Если в `decoder` остался невыровненный UTF-8 (multi-byte
character начался в последнем chunk'е и продолжение не пришло), tail
не появится в buffer.

**Файл:** `app/llmAssistant.js:430-458` — tail-обработка ЕСТЬ, но она
читает `buffer.trim()`, а не вызывает `decoder.decode()` без `stream:true`
для flush'а. Один UTF-8-character (русская буква в payload) может молча
исчезнуть.

**Fix:**
```js
buffer += decoder.decode(); // flush remaining bytes
```
после `break;`.

**Severity:** S1. Видно глазом юзера как «обрезанная буква» в конце
ответа.

---

### S1-3. `state.llm.history` race между rule-based и LLM path
**Файл:** `app/llmAssistant.js:1456-1502`, `chatEngine.js:679-770`

```js
const assistantMsg = { role: 'assistant', content: '', streaming: true, thinking: true, structured: null };
state.llm.history.push(assistantMsg);
...
chatProcess(text, {
  onRuleBased: ({ structured }) => {
    handled = true;
    assistantMsg.thinking = false;
    assistantMsg.streaming = false;
    ...
  },
  onLLMPrompt: async ({ ... }) => {
    ...
    await callGigaChatStream(messages, ...);
  },
});
```

`chatProcess` — синхронный для rule-based, но async для activity-flow
(см. `chatEngine.js:685-715`). Если `classifyActivityIntent` подбирает
LLM-path, `opts.onLLMPrompt` вызывается **сразу** (`return`).

**Сценарий gotcha:** если в активити-флоу есть `needsClarification` —
вызывается `onRuleBased`, но **БЕЗ** `intent: 'activity_clarify'` —
проверка `handled` остаётся true, но переменная `handled` в outer scope
не читается (`if (!handled) {...}` блок — пустой, только комментарий).
Концептуальный bug отсутствует, но код запутан: `handled` объявлен,
но не используется после assignment.

**Severity:** S1 (поддерживаемость, потенциальное расхождение поведения
после рефакторинга).

---

### S1-4. `_tokenInflight.delete` после `finally` — TOCTOU при reject
**Файл:** `server/llm.js:211-213`

```js
fetchPromise.finally(() => {
  if (_tokenInflight.get(cacheKey) === fetchPromise) _tokenInflight.delete(cacheKey);
});
```

Identity-check `=== fetchPromise` правильный, защищает от удаления
свежего inflight'а. **НО** между `finally` и удалением может пройти
несколько микротасков, и параллельный запрос на тот же `cacheKey`
получит **уже rejected** promise и упадёт с тем же `OAuth timeout`.

**Реальность:** OAuth fail = 12s timeout. Если за это окно прилетит 20
запросов, все 20 получат тот же reject. Пользователь видит 502 на каждый
из 20 запросов = «GigaChat OAuth failed».

**Mitigation idea:** при rejection `_tokenInflight.delete(cacheKey)`
делать **синхронно** в reject-branch, чтобы следующий запрос мог
попробовать заново. Trade-off: thundering herd 20 параллельных OAuth.

**Verdict:** не баг, но не resilient. **Severity:** S1.

---

### S1-5. `tokenSessionOnly` — `sessionToken` живёт в `state.llm.sessionToken`,
но не реплицируется на `sessionStorage`
**Файл:** `app/llmAssistant.js:756-760`, `784-791`

```js
state.llm.sessionToken = inputToken; // always in RAM for immediate use
if (s.tokenSessionOnly) {
  s.token = '';
} else {
  s.token = inputToken;
}
```

«Session-only» = только RAM. **На F5** `sessionToken` теряется. Это OK
если юзер каждый раз вводит токен. **НО** комментарий на стр. 109-112:
> "Раньше bearer-token GigaChat по умолчанию писался в localStorage cleartext...
> Теперь токен по умолчанию живёт только в sessionStorage / memory"

**Не вижу записи в sessionStorage.** Только `state.llm.sessionToken`
(volatile RAM). Это противоречит комментарию-обещанию. Либо комментарий
устарел, либо реализация неполная.

**Severity:** S1 (документация vs реализация).

---

### S1-6. Stream-buffer без size-cap — slowloris через GigaChat
**Файл:** `app/llmAssistant.js:407-428`

`buffer += decoder.decode(value, { stream: true })` без cap'а. Если upstream
шлёт огромное `data:` событие без `\n` (атакующий контролирует
GigaChat-compatible endpoint через apiBaseUrl=localhost gpt2giga proxy),
буфер растёт до OOM browser tab'а.

`max_tokens` = 2000 защищает на уровне LLM-response. Но если apiBaseUrl
= attacker-controlled (через `mode='direct'` + sameOrigin proxy который
не валидирован), buffer growth не ограничен.

**Mitigation:** ввести `MAX_SSE_LINE = 64KB`, если `buffer.length > MAX_SSE_LINE`
без `\n` → abort + log.

**Severity:** S1 (нужен malicious apiBaseUrl).

---

## Medium (S2)

### S2-1. `_extractUsageFromTail` парсит только последние 30 строк хвоста
**Файл:** `server/llm.js:223-242`

```js
const lines = tail.split('\n').slice(-30).filter(l => l.startsWith('data:'));
```

Если GigaChat шлёт usage в frame'е №31 от конца (необычно, но возможно
если после usage идут closing comments) — usage не найдётся → telemetry
без token-counts. Не fatal, но искажает billing.

**Severity:** S2.

---

### S2-2. SSE heartbeat не валидируется на клиенте
**Файл:** `app/llmAssistant.js:412-414`

```js
if (line.startsWith('event:') || line.startsWith('id:') || line.startsWith('retry:') || line.startsWith(':')) {
  dlog('[LLM] SSE field (skipped):', line.slice(0, 80));
  continue;
}
```

`: ping` (с пробелом после `:`) обрабатывается как comment — OK.
Но если heartbeat прилетел **между** `data:` строкой и её парсингом
(теоретически невозможно в одном `decoder.decode`-batch'е, но возможно
в TCP retransmit) — payload может разорваться.

Конкретно: heartbeat — `: ping\n\n`. Спецификация SSE требует `\n\n`
как event-boundary. `data: {"choices"...}\n` + `: ping\n\n` → парсер
делит по `\n`, обрабатывает data, потом видит `: ping` → skip, потом
пустую строку → continue. **Работает корректно.**

Single-`\n` обрыв между `data:` и continuation теоретически невозможен,
GigaChat шлёт frames только полностью.

**Severity:** S2 (защищён, но проверки нет — нет fuzz-тестов).

---

### S2-3. `_tokenCache` не имеет защиты от race на eviction
**Файл:** `server/llm.js:129-140`

```js
function _tokenCacheSet(key, value) {
  const cutoff = Date.now() - TOKEN_CACHE_TTL_MS;
  for (const [k, v] of _tokenCache) {
    if (v?.expiresAt && v.expiresAt < cutoff) _tokenCache.delete(k);
  }
  while (_tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldestKey = _tokenCache.keys().next().value;
    if (oldestKey === undefined) break;
    _tokenCache.delete(oldestKey);
  }
  _tokenCache.set(key, value);
}
```

Внутри `for...of` идёт `_tokenCache.delete(k)` — modification during
iteration. В V8 это **defined behavior** для Map (continue iteration
over remaining entries), но fragile. Если cap'нем TOKEN_CACHE_MAX
до маленького (=2), evict логика становится дёрганой:
last-set entry может вытеснить только-что-добавленный (нет timestamp
для LRU).

**FIFO != LRU.** Eviction по insertion-order — старый token, который
часто refresh'ится, никогда не вытесняется. Новый clientId, который
зашёл один раз, прилетает первым в eviction. Это OK для нашего use-case
(uptime года не подразумевает 200+ активных clientId), но **performance
characteristic** — не documented.

**Severity:** S2.

---

### S2-4. `parseLLMResponse` memoization работает только на reference equality
**Файл:** `app/llmAssistant.js:32-44`

```js
let _parseLastRaw = null, _parseLastVal = null;
function parseLLMResponse(raw) {
  if (raw === _parseLastRaw) return _parseLastVal;
```

`raw` — string. `===` сравнение для strings — value equality в JS,
но **создание новой строки** через `assistantMsg.content += delta`
каждый раз даёт новый primitive. Memo работает только когда два
**идентичных вызова подряд** с тем же `lastMsg.content` (e.g. retry
после flush'а). Это и есть use-case в P4 fix. **Корректно.**

Но: длинный ответ в 100KB → 50 streaming render'ов с разным content →
50 раз идёт полный markdown-parse. P4-cache спасает от **второго**
прохода на тот же raw (=fix после flush'а). Это **частичная** оптимизация,
не полная. **Уже устранено** (V21 P4 commentary).

**Severity:** S2 (perf, не корректность).

---

### S2-5. `_streamRafId` через setTimeout fallback теряет cancellation context
**Файл:** `app/llmAssistant.js:601-608`

```js
if (typeof requestAnimationFrame === 'function') {
  LLMAssistant._streamRafId = requestAnimationFrame(cb);
} else {
  LLMAssistant._streamRafId = setTimeout(cb, 16);
}
```

`_streamRafId` хранит handle — но `cancelAnimationFrame` и `clearTimeout`
принимают разные id-spaces. Сейчас `_flushStreamRender` проверяет
`typeof cancelAnimationFrame === 'function'`, не type'у самого id'а.
Если rAF доступен, но `_streamRafId` был выставлен через setTimeout
(теоретически невозможно при стабильном окружении, но при HMR — может),
`cancelAnimationFrame(setTimeoutId)` — no-op без error. Timer выстрелит.

**Severity:** S2 (defensive code).

---

### S2-6. `_isLocalHost` whitelist разрешает IPv6 loopback неполностью
**Файл:** `server/llm.js:102-117`

```js
const _LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal', '::1']);
function _isLocalHost(host) {
  const bare = String(host || '').toLowerCase().split(':')[0];
  return _LOCAL_HOSTS.has(bare);
}
```

`split(':')[0]` для IPv6 URL `[::1]:8080` даёт `[`. **`_isLocalHost`
возвращает false для `[::1]:8080`.** Bracket-notation IPv6 не поддержан.

URL.host для IPv6 = `[::1]:8080`, для IPv4 = `127.0.0.1:8080`.
Bare для IPv6 = `[` — не в set'е. Если кто-то ставит локальный proxy
на IPv6 → не пройдёт whitelist → fallback на DEFAULT_GIGACHAT_BASE.

**Severity:** S2 (edge case, IPv6 на dev-машинах редок).

---

## Low

### L1. `dlog` / `dwarn` — дебаг-логи доступны через `localStorage.q2_chat_debug`,
но `console.warn` в `dwarn` идёт всегда, а в проде может содержать
sliced токены (см. `llmAssistant.js:427`).
**Файл:** `app/llmAssistant.js:96`, `371`, `427`

```js
const dwarn = (...args) => { try { console.warn(...args); } catch (_) {} };
...
dwarn('[LLM] unparseable line (not JSON, not SSE field):', dataLine.slice(0, 120));
```

`dataLine.slice(0, 120)` — если SSE отдаст `data: Bearer eyJ...` (LLM
галлюцинирует token), 120 chars хватит на полный JWT-header + payload.
Корп-телеметрия браузера может это собирать.

**Mitigation:** прогнать `scrubChatSecrets(dataLine.slice(0, 120))`
перед `dwarn`.

---

### L2. `safeJSONParse` ловит SyntaxError, но не Memory/StackOverflow
**Файл:** `app/llmAssistant.js:117-119`

```js
function safeJSONParse(raw, fallback) {
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}
```

`JSON.parse('{a:'.repeat(10000))` бросает SyntaxError — поймается. OK.
`JSON.parse('{"a":'.repeat(200000) + '1' + '}'.repeat(200000))` —
deeply-nested object, может перебрать stack-size (V8 ~10k). RangeError.
`catch(_)` поймает любую Error, ОК. Но если parsed возвращает
1GB-объект (валидный JSON) — `safeJSONParse` отдаст его, и дальше
`tail.split('\n').slice(-30)` стянет память.

**Severity:** L (нужен hostile upstream).

---

### L3. `RATE_WINDOW_MAX=30` в 5-минутном окне — слишком много для
ручного использования и слишком мало для авто-генерации
**Файл:** `app/llmAssistant.js:570-585`

30 запросов в 5 минут = 1 в 10 секунд. Для активного юзера в активной
сессии нормально. Для автотестов / e2e — нужен env-override. Нет
mechanism'а bypass'а для тестов. Если e2e зашлёт >30 → начнётся пайп.

**Severity:** L (test-affecting).

---

### L4. `chatActivityHandler._resolveParticipantByIdentity` — substring-match
на ФИО
**Файл:** `chat/chatActivityHandler.js:42-47`

```js
const emp = (state?.employees || []).find(e => {
  const fio = String(e.fio || e.name || '').trim().toLowerCase();
  return fio === dn || fio.includes(dn) || dn.includes(fio);
});
```

`Иванов И.` → совпадёт с `Иванов Иван Петрович` (fio.includes(dn)),
и **наоборот** `Иванов Иван Петрович` совпадёт с фио `Иванов И.`
(dn.includes(fio) если dn длиннее). Это **нарушает** identity-deterministic
контракт (CLAUDE.md §3.2). В чате это даёт неоднозначность:
LLM получит данные не того сотрудника.

**Severity:** L (CLAUDE.md контракт #2 violation, но identity-resolver
сам — fallback к display-name; всё-таки identity-based матч идёт первым).

---

### L5. `Services.PortfolioPulse._model` fallback — кросс-модульный приватный доступ
**Файл:** `chat/chatEngine.js:690`

```js
const pulseModel = (pp?.getModel?.() ?? pp?._model) || null;
```

Underscore-prefix = private. Чтение `_model` из соседнего модуля —
encapsulation break. Если PortfolioPulse поменяет shape — chat молча
сломается без типового warning'а.

**Severity:** L (architectural smell).

---

## SSE streaming — детальный разбор

### Parser robustness (`llmAssistant.js:365-463`)

**Что хорошо:**
- Учёт content-type — JSON / SSE / no-body разделены.
- Memoization через `_parseLastRaw` (P4 fix).
- Partial-JSON reconstruction в tail (`buffer reconstruction` на стр. 437-456).
- abort-signal check в начале каждой итерации while.
- Skip non-data SSE fields (`event:`, `id:`, `retry:`, `:`).
- `[DONE]` handling.
- Hint extraction из server error response (PR-CI на стр. 374).

**Что fragile (см. S0/S1):**
- LF-only split (S0-2).
- TextDecoder без финального flush (S1-2).
- Buffer без size-cap (S1-6).
- Tail-reconstruct работает только для `{` (см. строку 438): `if (!parsed && tailData.startsWith('{'))`. Если хвост — JSON-array (`[`), reconstruct не сработает.

**Что недокументировано:**
- Что делать если SSE-стрим возвращает HTTP 200 но content-type `text/plain`?
  Сейчас проваливается в `// SSE stream path`, парсит как SSE. Если plain-text
  — `[LLM] unparseable line` и нет deltas.
- Что делать если first byte ответа = `<` (HTML 500 от corp-proxy)?
  Падение через unparseable line, totalDelta=0, появится `dwarn` «stream finished
  but NO delta text was emitted». Юзер увидит «Ответ пустой».

### Heartbeat (`server/llm.js:252-289`)

**Что хорошо:**
- Interval 25_000ms (corp-proxy idle обычно 60s, есть запас).
- `: ping` syntax — comment, не event → клиент skip'нет.
- Cleanup на `clientRes.close/error`, `upstreamRes.end/error`.
- Идемпотентный clearInterval.

**Что плохо:**
- **Нет первого ping'а сразу.** Если upstream думает 30+ сек до первого
  delta, heartbeat выстрелит только через 25с — окно [25-30s] не покрыто
  ничем кроме `event: meta` (на стр. 251) который летит сразу. Если
  corp-proxy режет по idle=30s после первого write'а — может прервать.
  **Fix:** отправить `: ping` сразу после writeHead.
- Нет cleanup на `upstreamReq.on('close')` — гипотетический leak (S0-5).
- Heartbeat не учитывает что `clientRes.write` может block'ировать на
  backpressure. Если client читает медленно, `write` буферизуется в
  Node, eventually `writable=false`. `clientRes.writableEnded` —
  только end-flag, не back-pressure.

### Multi-byte UTF-8 boundaries

`TextDecoder('utf-8', { fatal: false })` создаётся в `parseStreamResponse`.
`{ stream: true }` correctly handles partial sequences (см. S1-2).
**Но** нет финального flush. Multi-byte char в самом последнем chunk'е
без последующего chunk'а — потеряется.

**Hypothesis** — нужен fuzz-тест: разделить 1000-байтный chunk на 2 части
ровно посередине русской буквы (e.g. между двумя bytes UTF-8 sequence),
посмотреть восстановится ли символ.

### Abort mid-stream

`abortSignal` пробрасывается из `LLMAssistant.sendFromInput` → `callGigaChatStream`
→ `fetch(... { signal })` → `parseStreamResponse(..., abortSignal)`.

**Что хорошо:**
- Check signal в начале каждой while-итерации.
- `fetch` сам поддерживает abort → reader.read() выкинет AbortError.
- Серверная сторона: `req.on('close')` → `upstreamReq.destroy(new Error('Client disconnected'))` (стр. 519).

**Что fragile (см. S0-1):**
- rAF-callback запланирован после abort → stale render.
- `_longThinkingTimer` (стр. 1465) — clear'ится в `finally`, OK.
- Но `_saveDebounced` (800ms setTimeout) НЕ канселится. Если abort
  пришёл, content уже push'нут в apiHistory ДО abort (только в успешном
  path — стр. 1591), save идёт спустя 800ms даже если history свернули.

### Reconnect

**Что есть:** ничего. На abort → throw → `setError(message)`. Юзер должен
вручную нажать «Повторить» (data-retry button на error-message).

**Что нет:**
- Auto-reconnect на network-error.
- Resume-from-checkpoint (последний полученный delta + продолжить генерацию).
  Это сложно: LLM не знает «откуда продолжить». OpenAI/GigaChat не поддерживают
  resume. Лучший вариант — full retry с тем же prompt'ом.
- Партиал-display после disconnect: если streaming прервался на середине,
  `assistantMsg.content` остаётся как partial; finally-block рендерит
  его без флага «обрезано». **Уже устранено для AbortError** (L6 fix,
  суффикс `…[остановлено пользователем]`), но **НЕ для NetworkError**.

---

## OAuth / token security

### Single-flight check

**Файл:** `server/llm.js:150-215`.

**Что увидел:**
- `_tokenInflight` правильно дедуплицирует concurrent OAuth-fetch'и.
- Identity-check `=== fetchPromise` защищает от race'а delete'а.
- Cleanup в `finally` гарантирован.

**Что fragile:**
- TOCTOU между `_tokenCache.get` и `_tokenInflight.get` (см. S1-1).
- Reject не очищает inflight быстро — следующий запрос получит тот же reject.
- 401-retry на стр. 432 `_tokenCache.delete(clientId)` не координируется
  с inflight (S1-4).

### Cache eviction

**Файл:** `server/llm.js:129-140`.

- Cap = 200 entries (TOKEN_CACHE_MAX).
- TTL = 24h после `expiresAt` (TOKEN_CACHE_TTL_MS).
- FIFO eviction по insertion-order (Map iteration order).
- Sweep по TTL на каждом `_tokenCacheSet` — O(n) per call.

**Что хорошо:**
- Защита от unbounded growth (на uptime года).
- Sweep дёшев при n=200.

**Что неidealno:**
- FIFO, не LRU. Активный juicy-token может быть evict'нут раньше unused
  one если он попал в cache раньше.
- Нет metric'а на eviction rate. Если evictions > Y/мин, это симптом
  rotation tons of clientId — нужно alerting.

### 401-retry flow

**Файл:** `server/llm.js:402-528` (вся `doRequest` cycle).

**Что хорошо:**
- Single retry (`retryOnUnauth=true` → second call с `false`).
- Cache invalidation перед refresh.
- Structured hint про scope/clientId (PR-CI).
- `wwwAuthenticate` header пробрасывается в response.

**Что fragile:**
- Если refresh бросает с любой ошибкой → 502 с детальным hint. Хорошо.
- Если refreshed token тоже даёт 401 → status>=400 branch, **первое
  чтение body** через `errChunks` (стр. 451). НО `upstreamRes.on('data')`
  уже мог быть привязан в 401-retry-branch выше (стр. 426-447) — там
  тоже `errChunks`. Конкретный код **переписывает** `const errChunks = []`
  внутри 'if status>=400' — это новая локальная переменная. Конфликта
  нет, **корректно**.

### Mode-switch token-flow

**Файл:** `app/llmAssistant.js:480-521`.

Три mode'а:
1. `direct` + sameOrigin: `fetch(endpoint, { Authorization: Bearer ${token} })`.
   Токен в Authorization header. Если apiBaseUrl = `localhost:3000/v1` —
   токен уходит на local gpt2giga proxy. Same-origin → CORS не нужен.
2. `direct` + cross-origin: fallback в proxy через `/api/llm/chat`,
   токен передаётся в body.token. **Токен идёт в JSON body на proxy.**
   POST body может попасть в `logger.event('llm.completed', ...)` —
   нет, там только model/tokens/ms/cid. **OK.**
3. `proxy`: токен в body.token, идёт через `/api/llm/chat`.

**Что хорошо:**
- Whitelist apiBaseUrl на сервере (`_resolveSafeLlmBase`).
- Same-origin guard (`isSameOriginRequest`).
- Токен не пишется в logger (проверил).

**Что fragile:**
- При rotate mode `direct → proxy` token из `body.token` идёт на сервер
  в JSON. Если кто-то снимет network capture в DevTools → токен в clear-text.
  Это нормально для HTTPS, но enterprise-DLP видит JSON body.
- Token может быть передан как `clientId+clientSecret` (preferred, OAuth)
  или как готовый Bearer. Smart-defaults не очевидны юзеру.

---

## Тестовое покрытие — пробелы

### Что покрыто (`tests/contract/llm.test.js`):
- Happy-path 200 + JSON (token напрямую).
- 401 → refresh → 200.
- 401 после retry → structured hint.
- Budget exceeded → 429.
- No-token → 400.

### Что НЕ покрыто:

1. **SSE chunked response.** Все contract-тесты используют `stream:false`
   и JSON-response. Парсинг SSE на клиенте — **0% покрытие**.

2. **Multi-byte UTF-8 boundary.** Нет ни одного теста на разрыв русской
   буквы между chunk'ами.

3. **Abort mid-stream.** Нет теста что `abortController.abort()` корректно
   останавливает SSE-read и не пишет stale delta.

4. **CRLF line-endings.** Нет fuzz'а с `\r\n` в SSE.

5. **Heartbeat propagation.** Нет теста что `: ping` фрейм игнорируется
   client-side parser'ом.

6. **Single-flight OAuth race.** Один тест happy-path (`oauthCallCount >= 1`),
   но нет теста что 10 concurrent запросов дают **ровно 1** OAuth-call.

7. **Token cache eviction.** Нет теста что 201 уникальный clientId
   вытесняет первый.

8. **TTL sweep.** Нет теста с моком clock'а.

9. **`scrubChatSecrets` integration.** Wrapper в `chat/scrubChatSecrets.js`
   делегирует в `shared/pii.js` — но **PII shared/pii.js не присутствует
   в импорте app/llmAssistant.js**, там по-прежнему inline regex (стр. 176-181).
   TODO на стр. 32-34 wrapper'а: `replace local scrubChatSecrets в app/llmAssistant.js`.
   **Не сделано.** Двойная реализация = риск drift'а.

10. **Mode-switch validation.** Нет тестов что `apiBaseUrl=evil.com`
    через `body` отлуплен на сервере (whitelist).

11. **Partial JSON reconstruct.** Tail-reconstruct (стр. 437-456) — не покрыт
    unit-тестами.

12. **Empty stream / 0-delta.** Тест что `totalDelta===0` → юзер видит
    «Ответ пустой» error.

13. **Backpressure.** Нет load-теста на 100KB ответ + slow consumer.

### Конкретные тест-кейсы, которые я бы написал:

```js
// SSE parser robustness
test('SSE parser handles CRLF line endings', () => {
  // input: 'data: {"choices":[{"delta":{"content":"hi"}}]}\r\ndata: [DONE]\r\n\r\n'
  // expect: onDelta('hi') × 1, no errors
});

test('SSE parser handles split multi-byte UTF-8', () => {
  // chunk1: bytes [0xD0, 0xBF, 0xD1]  ← incomplete second char
  // chunk2: bytes [0x80, 0xD0, 0xB8]  ← completes second char
  // expect: onDelta with valid Russian text (no replacement chars)
});

test('SSE parser ignores : ping heartbeats', () => {
  // input: ': ping\n\ndata: {...}\n\n: ping\n\ndata: [DONE]\n\n'
  // expect: onDelta × 1, no warn-logs
});

test('OAuth single-flight: 10 concurrent calls → 1 OAuth fetch', async () => {
  // expect: state.oauthCallCount === 1
});

test('AbortController stops mid-stream cleanly', async () => {
  // start stream, abort after first chunk
  // expect: no stale onDelta calls after abort
});

test('Token cache evicts FIFO at TOKEN_CACHE_MAX', () => {
  // add 201 unique clientId → first evicted
});

test('apiBaseUrl=evil.com falls back to default', () => {
  // POST /api/llm/chat with apiBaseUrl='https://evil.com/v1'
  // expect: warn-log llm.base_not_allowed, fetch goes to DEFAULT_GIGACHAT_BASE
});
```

---

## Killer ideas (streaming/infra профиля)

### 1. Server-Sent Events «sequence number» для resume
Внедрить `id:` SSE-field с monotonic counter. Клиент при reconnect шлёт
`Last-Event-ID` header. Сервер хранит partial response в Redis/memory
кэше 60 секунд и продолжает оттуда. Стандарт SSE (`EventSource` API
делает это автоматически). Для нашего самописного reader — добавить
вручную.

Для LLM — challenge: можно вернуть «cached prefix» и тот же `messages`
re-feed'ить в GigaChat с уменьшенным max_tokens. Не идеально (модель
может разнообразиться), но **partial display + retry**, а не «начать заново».

### 2. Heartbeat-monitoring телеметрия
`logger.event('llm.heartbeat_sent', { cid, elapsed_ms })` — посчитать
сколько ping'ов отправлено vs reconnect-rate. Если > X% сессий имеют
heartbeat>0 + completion=ok — corp-proxy работает. Если heartbeat>0 +
completion=err → heartbeat недостаточно частый.

### 3. Circuit breaker на GigaChat upstream
Если за 60s > 5 ошибок 5xx/timeout — открыть circuit на 30s, отказывать
с 503 «Service temporarily unavailable». Это защищает от thundering herd
и от каскадного refresh'а токенов.

### 4. Token-rotation observability
Audit-trail каждой OAuth-refresh: `logger.event('oauth.refresh', { clientId_hash,
reason: 'expired' | '401-retry' | 'manual', latency_ms })`. Сейчас в логи
идёт `gigachat 401 — refreshing token` (стр. 431) но без structured fields.

### 5. SSE wire-format snapshot diff
Записывать первые 64KB SSE-стрима в локальную папку tests/fixtures/
(в dev mode за флагом). Через 100 запусков — у нас golden-corpus реальных
GigaChat-ответов. Можно гонять unit-test'ы парсера против них.

### 6. ProxyAgent для GigaChat upstream
Использовать `undici` Agent с `keepAliveTimeout: 60_000` + connection pooling.
Сейчас `http.request` создаёт TCP-connection per call. На GigaChat OAuth +
chat per user — 2 TCP-handshake'а. ProxyAgent сохранит 2 RTT (= ~100ms
на корпоративную сеть).

### 7. Backpressure-aware writes
`forwardSSEOrChunk` пишет в `clientRes` без проверки `.writable`. Если
client медленный, Node буферизует в process memory → OOM на больших ответах.
Добавить:
```js
upstreamRes.pipe(clientRes, { end: false });
```
с правильной обработкой error. `pipe` нативно handle'ит backpressure.

### 8. Token-leak red-team test
Автотест: запустить fake GigaChat который возвращает в content токен
«Bearer eyJ.x.y». Проверить что этот content **не появляется** в:
- `localStorage['q2_llm_conv_v1']`
- HistoryLog
- Browser DevTools network capture логов

---

## Что бы я сделал первым (Top-3)

### #1 — Закрыть AbortController stale-callback race (S0-1)
**Файл:** `app/llmAssistant.js:592-610`, `1670-1690`

В `_scheduleStreamRender` добавить:
```js
if (!state.llm.isStreaming) return;
```
И в `finally`-блоке `onLLMPrompt` сначала `_flushStreamRender()`, потом
`renderMessages()`, потом `state.llm.isStreaming = false`. Не наоборот.

**Time-cost:** 30 минут.
**Risk-reduction:** убирает category «stale UI после abort», экономит
~5% поддержки тикетов «у меня осталось half-response после стопа».

### #2 — Unit-тесты на SSE-parser
**Файл:** новый `tests/unit/sseParser.test.js`

Покрыть:
- CRLF / LF / CR endings.
- Multi-byte UTF-8 split.
- Heartbeat (`: ping`) frames.
- `[DONE]` terminator.
- Partial JSON tail-reconstruct.
- Abort signal mid-stream.

Это требует вынести `parseStreamResponse` в отдельный module (сейчас
в `app/llmAssistant.js` inline). Refactor — 1 час, тесты — 3 часа.

**Risk-reduction:** baseline coverage SSE. Сейчас 0%.

### #3 — Первый heartbeat сразу после writeHead
**Файл:** `server/llm.js:251-256`

```js
clientRes.writeHead(200, { ... });
clientRes.write('event: meta\ndata: {"ok":true}\n\n');
clientRes.write(': ping\n\n');  // ← добавить
const heartbeat = setInterval(() => { ... }, 25_000);
```

И **уменьшить интервал** до 20с (corp-proxy idle обычно 30s, не 60s).

**Time-cost:** 5 минут.
**Risk-reduction:** убирает категорию «GigaChat thinks long → proxy
cuts connection → user sees empty error».

---

## Дополнительные находки (вне S0-S2 scoring)

### Гигиена кода

1. `handled` flag в `sendFromInput` (`llmAssistant.js:1474, 1696`) —
   объявлен, set'ится, но финальный if-блок пустой. Dead variable.

2. Inline-implementation `scrubChatSecrets` (`llmAssistant.js:176-181`)
   дублирует `chat/scrubChatSecrets.js`. TODO на стр. 32-34 wrapper'а
   не закрыт.

3. `dlog` и `dwarn` (`llmAssistant.js:92-96`) — `dwarn` всегда писать
   в console, может содержать sliced JWT (см. L1).

4. `_LOCAL_HOSTS` (`server/llm.js:102`) не поддерживает IPv6 bracket-notation
   (см. S2-6).

5. TDZ-bug fixed (комментарий на `server/llm.js:25` отмечает что
   pre-existing TDZ преодолён в V22). Hist.

6. Hardcoded magic-numbers: 25_000 (heartbeat), 90_000 (token TTL buffer),
   12_000 (OAuth timeout), 16384 (TAIL_MAX). Должны быть named constants
   в config-объекте.

### Архитектурные наблюдения

1. `chat/chatEngine.js:process` — sync для rule-based, async для
   activity-clarify. Calling code (`llmAssistant.js:1474-1697`)
   полагается на это callback-flag-pattern, но `handled` не используется
   эффективно. Pattern fragile.

2. `forwardSSEOrChunk` handle SSE+JSON+chunked simultaneously
   (`server/llm.js:471-516`) — слишком много путей через один factory.
   Я бы разделил на `forwardSSE`, `forwardJsonAsSSE`, `forwardJsonAsJson`.

3. `state.llm` — много полей (settings, history, apiHistory, panelOpen,
   panelMinimized, isStreaming, abortController, sessionToken,
   lastUserText, pendingBatch). Это **больше контракта №3** из CLAUDE.md.
   Нужен explicit shape (TypeScript or JSDoc).

### Безопасность (выше уже в S0)

1. `clientId` в `_tokenCache` key — full clientId. Eviction-log
   потенциально пишет его в plain. Hash'ировать перед logging'ом.

2. `body.apiBaseUrl` без strict-URL validation: только `new URL(host)`,
   нет проверки на http vs https, нет проверки на path injection
   (e.g. apiBaseUrl="https://legit.com/api/v1@evil.com/path" — URL
   парсит host как `legit.com`, а fetch попадает... зависит от
   реализации). Edge-case.

3. CSRF guard работает только для same-origin. Если корп-CDN ставит
   custom Origin header → может ложно разрешать. Severity Low (защита
   глубинна).

---

## Сводка

**Категория** | **Найдено** | **Уже устранено** | **Активные**
--- | --- | --- | ---
S0 (Critical) | 5 | 0 (heartbeat частично) | 5
S1 (High) | 6 | 0 | 6
S2 (Medium) | 6 | 1 (P4 memo) | 5
L (Low) | 5 | 0 | 5

**Главный сюрприз:** в коде много audit-меток (V21 §X, V22 fix, P4
fix, L-fix'ы), все правильные fixes — то есть кто-то систематически
проходит и латает. Но **SSE-parser остаётся untested** — это самое
тонкое место в стеке, и regress'ировать его легче всего следующей
правкой.

**Главная рекомендация:** unit-тесты на `parseStreamResponse` —
single biggest reliability investment.

**Опциональная мысль для маскота:** ls-thinking/ls-streaming/ls-complete
phase'ы дёргаются хорошо, но при abort до первого токена есть проверка
`if (lastMsg?.thinking || !lastMsg?.streaming)` (`llmAssistant.js:1616`)
— читается тяжело. Inline-комментарий есть, OK.

— Marko Anastasov, 2026-05-15
