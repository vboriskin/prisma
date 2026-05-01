# Audit #2 — Senior Full-Stack (LLM Focus)

Scope: chat ↔ app integration, SSE handling, GigaChat proxy, persistence,
action layer, error UX. Prompt content and model selection out of scope.

---

## Critical

### C1. LLM-supplied actions can `autoExecute` without user click
**File:** `app/llmAssistant.js:744-748` and `chat/chatActions.js:353-369`.
**Repro:** the LLM (or any prompt-injection text echoed back inside the
`` ```json … ``` `` trailer) returns
`{"actions":[{"type":"clear_filters","autoExecute":true}]}`.
`renderStructuredResponse` parses it; the rule-based code path scans
`structured.actions` for `a.autoExecute` and dispatches `executeAction(...)`
silently — bypassing any "preview / confirm" step. Today only
`confirm_batch` uses the flag intentionally, but the dispatcher trusts
the boolean for **any** action type, including `apply_filter`,
`navigate`, or future mutating actions.
**Fix:** in `llmAssistant.js:744` whitelist auto-executable types:
`if (autoAction && autoAction.type === 'confirm_batch')`. Strip
`autoExecute` for any action coming from `parseStructuredFromLLM`.

### C2. `confirm_batch` ID is forge-able by the LLM
**File:** `chat/chatActions.js:151-165`, `chat/chatEngine.js:539-558`.
**Repro:** `applyPendingBatch(batchId)` only checks `pending.id ===
batchId`. The pending batch is created server-state-side, but the LLM
response can include its own action with `type:'confirm_batch',
payload:{batchId: pending.id}` and `autoExecute:true` — once C1 above is
exploited, the model itself confirms a batch the user never approved
(it sees the ID inside the structured-response stream).
**Fix:** require an explicit human click — set a flag like
`state.llm.batchConfirmedByUser=true` only inside the DOM click handler
in `bindActionClicks` (chatActions.js:385) and check it inside
`applyPendingBatch`.

### C3. Token length logged to console
**File:** `app/llmAssistant.js:308`.
**Repro:** every chat request logs `(${token.length} chars)`. Combined
with the verbose endpoint log on a help-desk screen-share, this
leaks classification info about the secret format.
**Fix:** drop the length; log only `!!token`. Add a redact helper
for any payload-bearing log.

---

## High

### H1. Conversation persistence has no quota / size guard
**File:** `app/llmAssistant.js:393-408`.
**Repro:** `saveConversation()` writes the entire `state.llm.history` +
`apiHistory` to `localStorage` on every assistant turn. After ~20 long
LLM responses with embedded JSON payloads the entry exceeds the typical
5 MB localStorage quota and **all** subsequent saves throw, swallowed
by `catch(_) {}` — the user thinks history persists but it's stale.
**Fix:** before stringify, slice both arrays to a hard cap (e.g. last
40 messages, max 200 KB each) and on `QuotaExceededError` drop the
oldest 50 % of history and retry once.

### H2. `apiHistory` grows unbounded despite 20-message trim at send
**File:** `app/llmAssistant.js:736-737, 799-800` and `183-188`.
**Repro:** every turn pushes `{user, assistant}` into
`state.llm.apiHistory`. `trimApiHistory` only trims at *send* time — the
stored array keeps growing forever and is reloaded verbatim on F5
(line 407). After 200 turns the array carries ~200×LLM-blob worth of
chars and balloons localStorage (see H1) and the JSON.stringify cost in
`callGigaChatStream`.
**Fix:** prune `apiHistory` to `MAX_HISTORY*2` *after* push, not before
send.

### H3. No token-window / context-overflow safeguard
**File:** `app/llmAssistant.js:143-198`.
**Repro:** `truncateForLLM` caps *context* bytes, but the final
messages array (system + 20 history + user + context) is never
size-checked. Default `payloadLimitBytes=250000` + full history can
exceed GigaChat-2's 32K window; proxy returns 400/413 and user sees
only "Не удалось получить ответ от LLM".
**Fix:** sum messages byte length; drop oldest history pairs until
under ~180 KB, surface via `setPayloadStatus`.

### H4. SSE parser blocks on multi-byte UTF-8 split across chunks
**File:** `app/llmAssistant.js:251`.
**Repro:** `buffer.indexOf('\n')` walks the raw buffer; if a Cyrillic
character spans a network boundary, `decoder.decode(value, {stream:
true})` handles it correctly, but the *line-split logic* does not
strip a trailing `\r` (CRLF servers send `data: …\r\n`). Result: the
trailing `\r` ends up on parsed JSON tokens like `…content"}\r"` —
`safeJSONParse` returns `null`, the chunk is silently dropped (line
269 logs "unparseable line").
**Fix:** in line 252 do `const line = buffer.slice(0, idx).replace(/\r$/, '').trim();`.

### H5. Proxy never times out the upstream stream
**File:** `server.js:240-316`.
**Repro:** `proxyChat`'s `transport.request(...)` has no `setTimeout`.
If GigaChat hangs (e.g. network blip mid-stream) the server keeps the
connection open until the OS TCP timeout (~minutes). Client also has
no idle-disconnect — `parseStreamResponse` waits in
`reader.read()` forever; user sees a stuck spinner.
**Fix:** `upstreamReq.setTimeout(120_000, () =>
upstreamReq.destroy(new Error('upstream timeout')));` and a
`AbortController` `setTimeout` on the client (e.g. 90s rolling: reset
on each delta).

### H6. OAuth token refresh race
**File:** `server.js:131-188, 261-269`.
**Repro:** two concurrent `proxyChat` calls with the same `clientId`
hit an expired cache entry, both fire `gigachatGetToken()`,
GigaChat 429s one — `_tokenCache` ends up half-populated and the
other request 401-retries (single retry flag).
**Fix:** in-flight Promise map per `clientId`:
`if (cached?.inFlight) return cached.inFlight;`.

### H7. `tokenSessionOnly` was removed but UI checkbox still exists
**File:** `app/llmAssistant.js:382-384, 433-434` vs. `index.html`.
**Repro:** comment at line 382 says "Force-disable session-only".
`saveSettingsFromUI` always writes `s.tokenSessionOnly=false` and
persists the token to localStorage — but if the index.html still
exposes the checkbox (legacy), users believe they can opt out.
Effectively the feature is silently dead and the token is **always**
saved to localStorage regardless of what the user clicks.
**Fix:** remove the dead checkbox from the markup, or honour the flag
again. Document behaviour.

---

## Medium

### M1. `aiContextBuilder.js` not wired into the chat path
**File:** `ai/aiContextBuilder.js` vs. `chat/chatContextBuilder.js`.
**Repro:** the chat flow only calls `chatContextBuilder.buildContextForIntent`
or `llmAssistant.buildSummaryContextPayload`. The richer
`buildAIContext()` (with `riskScore` sorting, `topRows` slim shape,
`load` tables) is referenced **only** from `views/aiView.js:266,292`.
Two parallel context builders means the chat sees a coarser/larger
payload than the dedicated AI tab.
**Fix:** consolidate — let `chatContextBuilder` delegate top-N
selection to `aiContextBuilder.buildAIContext()` to share the
"slim row" shape and the byte cap (`serializeContext`).

### M2. Chat does not know which view/tab is active beyond `state.activeSection`
**File:** `app/llmAssistant.js:101` (`activeTab: state.activeSection`),
`chat/chatContextBuilder.js:77`.
**Repro:** `activeTab` is included only in the *summary* context payload
(line 101) — *not* in the per-intent contexts produced by
`chatContextBuilder` (executive, release, team, …). So when user is on
"Gantt" and asks "что я вижу?" the LLM gets no view hint.
**Fix:** add `activeTab: state.activeSection, currentFilters: state.filters`
into every `buildXxxContext()` return.

### M3. `parseStructuredFromLLM` regex requires fence at end-of-text
**File:** `chat/chatUIRenderer.js:197`
(`raw.match(/```json\s*([\s\S]*?)```\s*$/)`).
**Repro:** if LLM appends a sign-off line *after* the JSON fence
("Если нужно ещё — спросите."), the trailing `$` anchor fails and
**no actions/cards/drilldown** render. The user sees raw JSON in
text instead.
**Fix:** drop the `\s*$` anchor; pick the *last* `` ```json … ``` ``
match in the string.

### M4. Quota / `localStorage.setItem` in settings has no try/catch
**File:** `app/llmAssistant.js:439, 593`.
**Repro:** `localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(s))`
without guard — if quota is exceeded (large custom payload pasted
into `customPayload` field) the call throws and the toast
"LLM settings сохранены" is never shown; the user thinks save worked.
**Fix:** wrap in `try/catch`, on failure show error toast.

### M5. Retry button doesn't restore the chat-engine context
**File:** `app/llmAssistant.js:556-562`.
**Repro:** retry pops the last error message + last user msg, then
re-fires `sendFromInput()`. But intent classification re-runs from
scratch — if the original turn used activity-handler with extracted
employee/date params, those are not preserved; user gets a different
prompt category than before.
**Fix:** cache the resolved `{system, user, category}` on the message
and replay verbatim.

### M6. SSE proxy adds spurious `data: [DONE]` for non-stream responses
**File:** `server.js:296-298`.
**Repro:** when `payload.stream=true` but upstream returns
`application/json` (e.g. an error wrapped as 200), the proxy wraps it
in `data: <text>\n\n` then `[DONE]`. Client `parseStreamResponse`
parses the JSON, calls `onDelta` with whatever
`extractDeltaFromChunk` picks — for an error JSON like `{"error":…}`
that's empty, so the user sees "Ответ пустой".
**Fix:** when upstreamType is `application/json`, propagate it as
`Content-Type: application/json` (drop the SSE wrapper), client path
already handles JSON content-type at line 227.

### M7. Server-set `connection close` headers missing → idle keep-alive leak
**File:** `server.js:191-205`.
**Repro:** `forwardSSEOrChunk` sets `Connection: keep-alive` but no
`req.on('aborted', …)` handler — only `req.on('close', …)` on the
inbound. Aborted client SSE leaves the upstream stream draining
(`upstreamRes.on('data')` keeps writing into a closed `clientRes`,
crashes with `ERR_STREAM_WRITE_AFTER_END` once per chunk).
**Fix:** check `if (clientRes.writableEnded) return;` inside the
`upstreamRes.on('data')` callback before `write()`.

---

## Low

- **L1.** `HistoryLog.ai` (llmAssistant.js:718) stores 400 chars of user
  prompt without scrubbing — token / JWT / email patterns leak into
  the exportable action log. Mask before `logAction`.
- **L2.** `clearConversation` (llmAssistant.js:699) bails when streaming;
  abort-then-clear is friendlier.
- **L3.** `executeAction` default branch (chatActions.js:366) only
  `console.warn`s on unknown type — show a toast.
- **L4.** `_tokenCache` keyed by `clientId` only (server.js:124). Rotating
  `clientSecret` without changing `clientId` reuses the stale token
  until upstream 401. Include a hash of secret in the key.
- **L5.** `rejectUnauthorized:false` hard-coded (server.js:161, 256).
  Mirror Jira's `allowInsecureTls` env flag.
- **L6.** Bad-JSON `customPayload` silently falls back to raw text
  (llmAssistant.js:136) — show a validation error in settings.
- **L7.** CSP allows `'unsafe-inline'` script (server.js:1931). Chat
  uses data-attr payloads only; inline can be dropped.

---

## What's good

- SSE streaming has tail-buffer flush (lines 272-277) and verbose,
  well-tagged debug logs that make field-debugging easy.
- `truncateForLLM` does two-pass shrink (full → minimised → 12-row
  hard cap) with telemetry fields (`_truncated`, `_payloadBytes`).
- Batch action layer (`chatActions.js`) **does** show preview,
  pending-batch state, before/after change-log entries.
- OAuth basic-auth credentials are never logged (only `RqUID`
  generated; `Buffer.from(...)` stays local).
- Per-IP rate-limit on `/api/*` (server.js:43, 1979) covers proxyChat.
- `escapeHtml` covers single-quote, so `data-action-payload='…'` is
  safe against attribute-break XSS even if LLM crafts evil JSON.
- Anti-injection trailer (`ANTI_INJECT` in chatPrompts.js) explicitly
  tells the model that JSON-context fields are data, not instructions.
- Abort wired through `AbortController` from UI Stop button down to
  `fetch()` and the SSE reader loop (line 243).
