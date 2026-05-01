# Audit #2 — AI Developer

Scope: LLM/chat subsystem (`app/llmAssistant.js`, `chat/*`, `ai/aiContextBuilder.js`, `ai/aiFallbackEngine.js`, `server.js::proxyChat`). Date: 2026-04-30.

---

## Critical (data leak, runtime crash, silent corruption)

### C1. Token persisted in plaintext localStorage; `tokenSessionOnly=false` force-pinned
**File:** `app/llmAssistant.js:384`, `:433-440`
The init forcibly overrides any saved `tokenSessionOnly: true` to `false` (one-time migration that is permanent). Combined with `localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(s))` at line 439, the GigaChat Bearer token is written to disk in cleartext on every save. Any other JS in the page (analytics, third-party libs, future XSS) reads it via `localStorage`.
**Fix:** keep the user toggle honoured; default to `tokenSessionOnly=true` for tokens; persist only `clientId` (never `clientSecret`/`token`) to localStorage; for OAuth path require server-side env (`SERVER_ACCESS_TOKEN` / `clientId+clientSecret` already supported by `proxyChat`).

### C2. Free-form `comment` field shipped to LLM verbatim — PII / secret leak vector
**File:** `app/llmAssistant.js:96, 117, 131`; `ai/aiContextBuilder.js:37-49` (slim() strips comment but `pickRowFields`/`buildVisibleContextPayload` keep it)
Russian-language tool — comments routinely contain customer names, internal URLs, tickets, sometimes credentials. Three out of four context modes (`summary`, `currentView`, `fullRegistry`) include `comment` unredacted; payload is sent to GigaChat (external) and any custom `apiBaseUrl` the user types.
**Fix:** redact comments by default — slice to 120 chars + strip emails/URLs/JIRA-keys with regex; expose an opt-in toggle "Включить полные комментарии в контекст LLM".

### C3. Anti-injection trailer is opt-in per-prompt and bypassed entirely on the legacy path
**File:** `chat/chatPrompts.js:33-36, 86, 106…`; `app/llmAssistant.js:178-180` (legacy `buildLLMMessages`)
`{{antiInject}}` only fires for the new intent-based prompts. The legacy single-blob path (`buildLLMMessages` → `state.llm.settings.systemPrompt`) sends user-controlled `epic/comment/tasks` JSON straight into the prompt with no anti-injection guard — a malicious comment can rewrite the assistant's role and trigger UI actions (see C4).
**Fix:** prepend `ANTI_INJECT` to every `system` content path (`buildLLMMessages` and `buildApiCallMessages`).

### C4. `autoExecute: true` on rule-based path runs mutations with zero confirmation
**File:** `app/llmAssistant.js:744-748`; `chat/chatEngine.js:550-558` (`buildConfirmBatchResponse` emits `autoExecute:true`)
Comment line 125 of `chatPrompts.js` says "НИКОГДА не ставь autoExecute: true" — but `buildConfirmBatchResponse` does exactly that, and `LLMAssistant.sendFromInput` auto-fires it. A user typing a single "да" replays the *previous* `pendingBatch` even if it was created in a different tab/session (state lives in `state.llm.pendingBatch`, in-memory, with no expiry/owner check). Combined with C3, an LLM-injected confirm response can also trigger it.
**Fix:** require human click on the rendered "Применить" button for every batch; remove `autoExecute` from `confirm_batch`; expire `pendingBatch` after 60 s.

### C5. SSE parser accepts arbitrary JSON `data:` lines that did not pass `Content-Type` check
**File:** `app/llmAssistant.js:227-234`
When response is `application/json` (non-stream) the code reads the *whole* body via `response.text()`. There is no upper bound — a hostile or misconfigured endpoint can deliver multi-GB body and exhaust browser memory. `MAX_BODY` only guards the server inbound, not the browser→upstream direct mode.
**Fix:** wrap `response.text()` with a streamed reader and a hard cap (e.g. 4 MB).

---

## High (model misbehaviour, truncated context, weak retries)

### H1. Conversation history never trimmed by tokens, only by message count
**File:** `app/llmAssistant.js:183-188, 196-199`
`trimApiHistory(apiHistory, 20)` is the only guard. Each saved message can be 200 KB JSON (Sec C2), so 20 messages × 200 KB ≈ 4 MB → guaranteed 413/context-window overflow on GigaChat (≤128k tokens). No token estimator. No retry-on-context-exceeded.
**Fix:** estimate bytes (`JSON.stringify(messages).length`) and pop oldest pairs while > ~120 KB; on 413 from upstream, retry once with halved history.

### H2. No upstream timeout / idle-disconnect for `/api/llm/chat`
**File:** `server.js:240-318` (`proxyChat`)
`upstreamReq` has no `setTimeout`. If GigaChat hangs the connection, both the client `fetch` and server hold open indefinitely. SSE keep-alive (`X-Accel-Buffering:no` is set) but no heartbeat ping is emitted to the client between deltas — front-end has no way to detect dead stream.
**Fix:** `upstreamReq.setTimeout(60_000, …)`; emit `: keep-alive\n\n` every 15 s in `forwardSSEOrChunk`.

### H3. 429 rate-limit not handled in proxy chat (unlike Jira proxy)
**File:** `server.js:271-283` vs. `:431-500` (Jira has gate + back-off)
A 429 from GigaChat is forwarded as-is to the browser with no retry/back-off, no `Retry-After` propagation, no shared cooldown — bursty user can trigger sustained 429 storms.
**Fix:** mirror the Jira `_jiraGateWait()` pattern for `proxyChat`; honour `Retry-After`; surface `429` to UI as "Сервер LLM ограничивает запросы, попробуй через …сек" (currently lands as a generic error text in `assistantMsg`).

### H4. Token refresh on 401 happens once, then silently fails
**File:** `server.js:261-268`
On 401 the code refreshes the token and retries with `retryOnUnauth=false`. If the refresh itself returns a stale token (rare but observed when `expires_at` arrives in seconds, not ms — see fallback at line 178), every subsequent call fails forever (cache poisoned with a ~29-min TTL).
**Fix:** validate `expires_at` units (if < 1e12, treat as seconds); on second 401 in a row, evict cache and retry once more before giving up.

### H5. `parseLLMResponse` mid-stream re-parses on every delta — O(n²) on long answers
**File:** `app/llmAssistant.js:673-678`; `chat/chatUIRenderer.js:194-211`
Every delta callback runs `parseLLMResponse(lastMsg.content)` which re-scans the whole accumulated text via regex. For a 30 KB response with 600 SSE chunks → 9 MB of regex work; visibly stutters the UI.
**Fix:** parse JSON tail only when stream ends OR debounce re-parse to 200 ms during streaming.

### H6. Activity-handler uses raw `pulseModel._model` global with no guard
**File:** `chat/chatEngine.js:658-659`; `chat/chatActivityHandler.js:163-261`
If PortfolioPulse hasn't initialised, `pulseModel` is `null`, every branch falls into the "не найден" string — but the LLM still receives a malformed prompt (data block = `— участник не найден в данных Pulse`) and fabricates events. No clarification path back to user.
**Fix:** when `pulseModel` is null, return `needsClarification: 'Pulse-данные не загружены. Откройте раздел Activity, чтобы я мог анализировать.'` from `handleActivityQuery`.

### H7. `apiHistory` saves the *trimmed* user message, not the original — context drift
**File:** `app/llmAssistant.js:736-737, 799-800`
The rule-based path stores `text` (raw user input) but the LLM path stores `sentUserContent`, which is the *rendered* user template containing the entire JSON context. The next turn re-includes the previous turn's full context inside the new user prompt → exponential blow-up over 3-4 turns.
**Fix:** in `apiHistory`, persist only the user's plain message; rebuild context per call.

---

## Medium (prompt fragility, UX issues)

### M1. JSON tail extraction regex anchors to `$` — fails when LLM appends epilogue
**File:** `chat/chatUIRenderer.js:197`
`/^…\s*$/` — if the model says "…```json{…}```\nНадеюсь это поможет!" the block is dropped. GigaChat does this often.
**Fix:** match last `\`\`\`json … \`\`\`` non-greedy without `$` anchor; or use a stack scanner.

### M2. `extractDeltaFromChunk` silently returns '' for unknown shapes
**File:** `app/llmAssistant.js:201-208`
GigaChat-2 v3 changed delta location to `output[0].content[0].text`. Currently logs "extractDelta=empty" but user sees an empty bubble with the canned "Ответ пустой. Проверь…" and no actionable diagnostic.
**Fix:** add `obj.output?.[0]?.content?.[0]?.text` to the chain; log unknown chunk shape once with telemetry.

### M3. System prompt UI lets the user blank out anti-injection / structured-suffix
**File:** `app/llmAssistant.js:427`
`s.systemPrompt = (… || DEFAULT_LLM_SYSTEM_PROMPT)` — but the editable field replaces the whole prompt. There is no way to keep `{{antiInject}}` if the user customises.
**Fix:** always append the immutable `ANTI_INJECT` + structured-format trailer server-side or in `buildApiCallMessages`, regardless of the user-edited body.

### M4. `summariseContext` truncates JSON at byte 5990 mid-token — corrupts structure
**File:** `chat/chatPrompts.js:42-44`
`s.slice(0, 5990) + '…[truncated]'` produces invalid JSON. The LLM still parses it as text — but follow-up "сколько задач" answers based on partial data are wrong.
**Fix:** drop arrays element-by-element (`pop()` until under limit) instead of mid-string slice.

### M5. Chat tab does NOT know which view is open (current section / current row id / current chart)
**File:** `app/llmAssistant.js:101` only stores `activeTab: state.activeSection`
No selected-row, no scroll position, no chart filters. User asks "почему эта задача рискованная" → assistant doesn't know which task is on screen.
**Fix:** add `state.selectedRowId`, `state.activeChart`, current Gantt range to context payload.

### M6. `intentParser` regex order matters; `BATCH_ACTION` patterns overlap with `FIND_TASKS`
**File:** `chat/chatIntentParser.js:225-269`
"назначь всем задачам без релиза релиз 1.22" matches `BATCH_ACTION`, but "назначь" alone with `\s` boundary leaks into action category in `CATEGORY_RULES`. Easy false-positive that produces a destructive preview.
**Fix:** require a verb-object pair OR move ambiguous verbs behind `\b(всем|задач)`.

### M7. `loadConversation` 24h TTL silently drops history — no UI hint
**File:** `app/llmAssistant.js:405`
User opens app on Monday after weekend chat → all context gone, no toast.
**Fix:** show toast "История чата старше 24ч — очищена" once after auto-purge.

### M8. `_overrideCache` is module-level singleton, never invalidated on logout / settings reset
**File:** `chat/chatPrompts.js:235-244`
After `clearSavedSettings()`, the prompt overrides cache still serves stale system prompts.
**Fix:** export `__resetCache()` and call from `clearSavedSettings`.

---

## Low (polish)

- **L1.** `app/llmAssistant.js:212` etc. — verbose `console.log('[LLM] …')` survives in prod; gate behind `window.__LLM_DEBUG`.
- **L2.** `app/llmAssistant.js:546` — `closeModal` referenced but never imported (will throw on Esc when LLM panel is open and modal is hidden).
- **L3.** `chat/chatActions.js:201-220` — fallback duplicates `applyBulkAction`; risk of drift if the canonical impl changes. Deprecate the fallback or import directly.
- **L4.** `chat/chatPrompts.js:86` — `buildPromptParts` doesn't pass `userText` length check; long pasted log (>50 KB) blows the user template.
- **L5.** `server.js:14` `SERVER_ACCESS_TOKEN` is read from env once at boot; rotating the env var requires server restart. Cache invalidation API would help.
- **L6.** `chatUIRenderer.js:194` — `parseStructuredFromLLM` does not validate action `type` against an allow-list; an LLM-injected `{type:'eval', payload:{…}}` would be silently dropped today, but executor only switches on known types — still, harden with `KNOWN_ACTION_TYPES`.

---

## What's good (don't touch)

- **Streaming SSE state machine** in `parseStreamResponse` (`llmAssistant.js:210-281`) — handles 3 content-type branches, partial chunks, tail buffer, abort signal cleanly.
- **OAuth token cache** keyed by `clientId` with 90 s skew (`server.js:131-188`) — sound design; never logs secrets.
- **Truncation strategy** (`truncateForLLM` 143-166) — three-stage minimisation is the right idea, just need to add comment redaction.
- **Intent → category → prompt routing** (`chat/chatIntentParser.js` `parseIntentCategory`, `chatPrompts.getPrompt`) — clean separation, easily extendable, well-tested in `chatPrompts.test.js`.
- **Rule-based fallback engine** (`ai/aiFallbackEngine.js`) — comprehensive, deterministic, lets the app degrade gracefully when GigaChat is down.
- **Test coverage** for parser/intents/prompts/templates is solid (`tests/unit/chat*.test.js`).
- **Activity handler** (`chatActivityHandler.js`) — proper clarification flow, dependency injection (`deps.pulseModel`) — testable.

---

File written to `/Users/vaceslavboriskin/q2_parse/v15_0/audit-2026-04-30/04-ai-developer.md`. Word count ≈ 1280.
