# Audit #2 — QA Tester (LLM Focus)

Scope: chat / LLM subsystem under `v15_0/` — `app/llmAssistant.js`, `chat/*`, related tests.
Code lines cited as `path:line` against the snapshot read on 2026-04-29.

---

## Test coverage matrix (chat-specific)

| Area | Covered by | Status |
|---|---|---|
| Intent classification (rule-based) | `tests/unit/chatIntentParser.test.js` | OK |
| Prompt registry, overrides, fallbacks | `tests/unit/chatPrompts.test.js` | OK |
| Quick-prompt templates | `tests/unit/chatTemplates.test.js` | OK |
| Activity-intent classification | `tests/unit/chatActivityIntents.test.js` | OK |
| Activity prompt building | `tests/unit/chatActivityPrompts.test.js` | OK |
| AI context payload builder | `tests/unit/aiContextBuilder.test.js` | OK |
| AI fallback / heuristic answers | `tests/unit/aiFallbackEngine.test.js` | OK |
| `parseStructuredFromLLM` JSON-block extraction | — | **GAP** |
| SSE stream parser (`parseStreamResponse`) | — | **GAP** |
| `endpoint = buildOpenAIChatEndpoint` (trailing slash, `/v1`, full URL) | — | **GAP** |
| Send-while-streaming guard | — | **GAP** |
| Cross-tab `q2_llm_conv_v1` sync | — | **GAP** |
| ESC handling, focus management on panel | — | **GAP** |
| Retry button after failed stream | — | **GAP** |
| `clearConversation` confirmation / logging | — | **GAP** |
| Settings round-trip (saveSettingsFromUI → syncSettingsUI) | — | **GAP** |
| Batch action confirm/cancel UI flow | — | **GAP** |

---

## Critical bugs found

### [bug-C1] `app/llmAssistant.js:526, 546` — `closeModal` is **undefined** at runtime
`app.js` is loaded as `<script type="module">` (`index.html:1036`), so `function closeModal(el)` declared at `app.js:160` is module-private. `llmAssistant.js` calls it bare:
```js
if (appModal) closeModal(appModal);                       // L526 (Save in LLM tab)
…
if (e.key === 'Escape' && state.llm?.panelOpen && !settingsModal.classList.contains('hidden')) closeModal(settingsModal);  // L546
```
Repro: open chat panel → ⚙ → Save settings. Expected: modal closes. Actual: `ReferenceError: closeModal is not defined` thrown silently in event handler; modal stays open. Same on Esc-while-modal-open.
Fix: expose `window.closeModal = closeModal` in `app.js` near the declaration, OR import via a shared `app/modal.js`.

### [bug-C2] `app/llmAssistant.js:546` — settings modal can only be closed by ESC if chat panel is also open
Logic in the global `keydown`:
```js
if (e.key === 'Escape' && state.llm?.panelOpen && !settingsModal.classList.contains('hidden')) closeModal(settingsModal);
else if (e.key === 'Escape' && state.llm?.panelOpen) { … close panel …; }
```
If the user opens settings via the topbar gear (chat panel closed) and presses ESC, neither branch fires — modal stays open. Repro: close chat panel → click `#btn-llm-settings` → ESC. Expected: modal closes. Actual: nothing.
Fix: drop the `state.llm.panelOpen` guard on the modal arm; close any visible modal first, fall through to panel.

### [bug-C3] `app/llmAssistant.js:709-826` — no SSE cancel when panel is closed mid-stream
The Close (`✕`) and Minimize handlers (L511-518) only flip `panel.classList`. They never call `state.llm.abortController.abort()`. The fetch keeps running, deltas keep mutating `assistantMsg`, and `renderMessages(true)` writes to a hidden DOM. Network bytes and tokens are wasted; if the user re-opens, partial output streams in mid-conversation.
Repro: send a long prompt → click `✕` while streaming. Expected: stream aborts. Actual: console shows continuing `[LLM] stream` chunks; final message appears next time panel opens.
Fix: in close handler, `if (state.llm.isStreaming) state.llm.abortController?.abort();`.

### [bug-C4] `app/llmAssistant.js:393-399` — `saveConversation` swallows `QuotaExceededError`
```js
saveConversation() { try { … localStorage.setItem(CONV_KEY, JSON.stringify(data)); } catch(_) {} }
```
When localStorage is full (large registry + chat history), the `setItem` throws and the user is never told their conversation is no longer being persisted. On F5 they lose all messages with no warning.
Repro: fill localStorage to ~5 MB (paste large registry export), then chat for several turns; reload — all turns gone.
Fix: surface via `showToast('Хранилище переполнено: чат не сохраняется', 'warn')`, set a flag to skip future writes, and/or trim oldest history rows automatically.

---

## High edge cases

### [bug-H1] `app/llmAssistant.js:709-714` — second send during streaming silently drops
```js
if (!text || state.llm.isStreaming) return;
```
The send button is disabled (L722) so this is mostly defensive, but Enter in the textarea (L543) still calls `sendFromInput()`. If the user types fast and presses Enter mid-stream, the message is silently dropped — no toast, no shake, no inline hint. UX impression: "the chat ate my question".
Expected: visible feedback + (better) queue the message until current turn finishes.
Fix: `showToast('Дождитесь окончания ответа', 'warn')` + visually wiggle the input.

### [bug-H2] `app/llmAssistant.js:699-704` — "Очистить чат" with **no** confirmation
`✦ Новый` → `clearConversation()` wipes both UI history and `apiHistory` immediately. No `confirm()`, no toast, no entry in `HistoryLog`. A misclick destroys the entire conversation; recovery is impossible (localStorage already overwritten on next message anyway).
Repro: hold a long valuable conversation → click `✦ Новый`.
Fix: confirmation modal OR an undo toast (5 s) + `HistoryLog.ai('chat_clear', …)`.

### [bug-H3] `app/llmAssistant.js:373` — no `storage` event listener for cross-tab sync
Two browser tabs → user chats in tab A → tab B still shows stale history. When tab B sends a message, `apiHistory` is overwritten with B's slice and tab A's reload corrupts it. The key `q2_llm_conv_v1` is mentioned in the cross-module deps comment but no `window.addEventListener('storage', …)` exists anywhere in `llmAssistant.js`.
Fix: subscribe to `storage` events keyed on `CONV_KEY` and reload state, OR mark history as tab-scoped (`sessionStorage`).

### [bug-H4] `chat/chatUIRenderer.js:194-211` — empty / malformed assistant response renders as raw error text
If the LLM replies with `"Ответ пустой. Проверь модель/токен и режим контекста."` (set at `llmAssistant.js:790`), it's pushed via `assistantMsg.content` and re-parsed by `parseLLMResponse`. There's no `isError` flag, no retry button, no category badge — it looks like a normal answer the user must read carefully. If LLM emits a malformed JSON block (e.g. a stray ``` ``` ` ``inside text), the regex at L197 matches a partial tail, throws inside `JSON.parse`, the catch at L206 silently strips the suffix, and the whole bubble can become empty.
Repro: configure a model that returns a 200 with `{}` → empty body. Expected: a clear retry path. Actual: a normal-looking grey bubble with text only.
Fix: classify "empty" as `isError: true`; render via `renderError` so the retry button appears.

### [bug-H5] `app/llmAssistant.js:556-571` — Retry pops two messages without checking they're a pair
```js
if (lastMsg?.isError) state.llm.history.pop();
const prevMsg = state.llm.history[state.llm.history.length - 1];
if (prevMsg?.role === 'user' && prevMsg.content === state.llm.lastUserText) state.llm.history.pop();
```
If the user retries after editing `lastUserText` indirectly (via a drilldown that overwrote the input), the equality check fails, only the error is popped, and the new send creates a duplicate user message. Visible artifact: two identical user bubbles.
Fix: track the user-message index alongside `lastUserText`, or pop pair atomically.

### [bug-H6] `app/llmAssistant.js:543` — Enter sends an **empty** prompt when only whitespace typed but rejects without feedback
`if (!text || state.llm.isStreaming) return;` — silently returns. Combined with auto-grow textarea, the user may believe they hit a key combo issue.
Fix: trivial — add a 1-line toast on empty submit.

### [bug-H7] `app/llmAssistant.js:415-444` — token sanitisation is missing
`saveSettingsFromUI` reads the token raw, no `trim()` is called when populating `s.token` (line 436 trims via the input value but stores `inputToken` directly, fine — but never validates length, never removes leading/trailing whitespace from a paste with newline). The same applies to `apiBaseUrl` (L418): trailing slash is stripped only inside `buildOpenAIChatEndpoint` later, and the **stored** value still has it — confusing in the UI on next reload. `proxyUrl` at L292 is also stripped only at call time.
Fix: normalise once at save time so what is stored = what is used.

---

## Medium defensive holes

### [bug-M1] `app/llmAssistant.js:553-571` — message-list click handler has no guard for streaming state on Copy
While streaming, `data-index` references the still-mutating message; `navigator.clipboard.writeText` copies whatever the partial buffer is. Probably acceptable but undocumented; users may not realise they're getting a partial answer.

### [bug-M2] `app/llmAssistant.js:401-409` — conversation rehydrate on F5 ignores `state.llm.lastUserText`
`loadConversation()` only restores `history` and `apiHistory`. If the last turn was an LLM error, the retry button rendered by `renderError(idx, !!state.llm.lastUserText)` (L687) is suppressed because `lastUserText` is empty. After F5, the user sees the failed bubble but cannot retry.
Fix: persist and restore `lastUserText` along with history.

### [bug-M3] `chat/chatActions.js:336` — Cancel batch silently drops state without confirmation that the action was queued
`handleCancelBatch` clears `state.llm.pendingBatch` and shows toast. There's no rendered chat bubble informing the user. Two consecutive `cancel` clicks produce two toasts — no idempotency check.

### [bug-M4] `app/llmAssistant.js:597-606` — `assistant-btn-preview` reuses `modal-kpi` without a dedicated close button check
If `#modal-kpi` has been removed/repurposed in some view, `modal.classList.remove('hidden')` throws. No optional-chain guard.

### [bug-M5] `chat/chatUIRenderer.js:90` — drilldown `data-prompt` attribute receives **double-escaped** content
`prompt = esc(item.prompt || item.text || '')` HTML-escapes once when injected (good for markup) but then `chatActions.js:404` reads `drillBtn.dataset.prompt` as raw — so a prompt containing `&` or `<` is now `&amp;` / `&lt;` when re-sent. The dataset reader yields the decoded value (browser auto-decodes attributes), so this works for normal text — but a prompt with literal `&amp;` from a customised template becomes mangled. Edge-case but real if user puts `&` in a custom drilldown.

### [bug-M6] `app/llmAssistant.js:373-386` — `state.llm.sessionToken` is never cleared on logout/clear-saved-settings flow
Even after `clearSavedSettings()` (L445) clears localStorage, `sessionToken` lingers in RAM if previously typed (L437 still wrote it). Not a security issue per se but surprising behaviour: "I cleared settings yet API still works".

### [bug-M7] `app/llmAssistant.js:711-722` — sendBtn / stopBtn are looked up by ID **inside** an async path, vulnerable to DOM swap
If the panel is re-rendered (none today, but planned in audit-1 recommendations) between L711 and the `finally` at L815, the variables refer to detached nodes; `sendBtn.disabled = false` becomes a no-op. Defensive: re-resolve in `finally`.

### [bug-M8] No ErrorsLog integration for chat failures
`grep -n "ErrorsLog" chat/* app/llmAssistant.js` returns **zero** matches. The V13 ErrorsLog was specifically advertised to surface integration errors. LLM stream failures (HTTP 401/timeouts/CORS) currently land only in the inline red banner and `console.error`. The user has no global view of "5 failed AI calls today" via the Errors tab.
Fix: in the `catch` arm at L803-812, call `window.ErrorsLog?.push?.({ source: 'llm', message: errStr, ts: Date.now() })`.

### [bug-M9] `app/llmAssistant.js:283-289` — `buildOpenAIChatEndpoint` does not validate that the URL is reachable
A user pasting `localhost:3000` (no protocol) lands in `new URL(..., window.location.origin)` (L315) and resolves against the file:// or current origin, not the intended host. Repro: type `localhost:3000/v1` into baseUrl → request goes to current page origin, fails with 404. Error message ("сервер недоступен") is misleading.
Fix: regex-validate `^https?://` at save time; warn if missing.

---

## Low (cosmetic)

- **[lo-1]** `app/llmAssistant.js:658` — empty-state placeholder uses raw HTML, no `aria-live` so screen readers miss the "Готов помочь" hint. Add `role="status"`.
- **[lo-2]** `chat/chatUIRenderer.js:172-175` — thinking dots have no `aria-label="LLM генерирует ответ"`; SR users hear nothing.
- **[lo-3]** `index.html:840` — textarea has placeholder text but no `<label>` or `aria-label`; chat input is unlabeled in accessibility tree.
- **[lo-4]** `app/llmAssistant.js:660` — `wrap.scrollTop = wrap.scrollHeight` runs on every streaming delta and steals the user's manual scroll-back. Add a "user scrolled up — pause auto-scroll" check (delta < 40 px from bottom).
- **[lo-5]** `chat/chatActions.js:404-409` — drilldown click only fills the input but does not auto-send; two-click pattern is inconsistent with `[data-prompt]` non-drilldown buttons that send on click (L394-398).
- **[lo-6]** `app/llmAssistant.js:545-548` — global keydown listener leaks: no `removeEventListener` on teardown. Single-page app, but if `init()` is ever called twice (HMR / re-init), ESC fires twice.
- **[lo-7]** Assistant bubble contrast on dark theme not audited here — no programmatic contrast check exists; recommend axe-core sweep.
- **[lo-8]** `chat/chatPrompts.js:241` — `JSON.parse` exception is caught and `_overrideCache` set to `{}`; user's hand-edited custom prompts are silently lost on next load.

---

## Recommended new tests

| # | File / target | Test |
|---|---|---|
| T1 | `parseStructuredFromLLM` | round-trip with valid `\`\`\`json` block; truncated tail; nested code fences inside text; empty `raw` |
| T2 | `parseStreamResponse` | given a `ReadableStream` of fake SSE chunks (multi-byte split mid-`\n`); `[DONE]` only; non-JSON `data:` lines |
| T3 | `buildOpenAIChatEndpoint` | trailing slash; `/v1` only; full `…/chat/completions`; missing scheme |
| T4 | `LLMAssistant.sendFromInput` | guard rejects when `isStreaming=true` and **shows toast** |
| T5 | `LLMAssistant.sendFromInput` | abort while streaming → `assistantMsg.content` ends with "Генерация остановлена."; `apiHistory` not appended |
| T6 | Close-button mid-stream | `state.llm.abortController` is `null` after close |
| T7 | `loadConversation` | stale (>24 h) data wiped; corrupt JSON → silent fallback to empty; `lastUserText` restored (regression for [bug-M2]) |
| T8 | `saveConversation` | quota-exceeded simulation triggers user-visible warning |
| T9 | Cross-tab sync | `storage` event with new `q2_llm_conv_v1` value re-renders messages |
| T10 | Retry flow | clicks `[data-retry]` after error → only the error+user pair is popped, no duplicate user bubble |
| T11 | `executeAction('confirm_batch', …)` | with no `state.llm.pendingBatch` → returns `{ok:false}` and shows error toast |
| T12 | ESC key | with settings modal open and chat panel **closed** → modal closes (regression for [bug-C2]) |
| T13 | `clearConversation` | called while `isStreaming=true` → no-op, history preserved |
| T14 | `chatProcess` activity short-circuit | when `classifyActivityIntent` returns `{intent:null}` → falls through to legacy parser |
| T15 | A11y | `assistant-input` has accessible name; thinking indicator has `aria-label`; assistant bubble announces via `aria-live="polite"` |

---

End of report. Word count ≈ 1490.
