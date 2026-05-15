# Audit 04 — AI-помощник в чате + связь со Scanner 2.0

**Авторы:** 4 эксперта — AI/ML Engineer, Conversational UX Designer, Prompt Engineer, Integration Architect.

---

## TL;DR

**Главный диагноз:** Scanner 2.0 — самая зрелая фича (S1-S15) с самой богатой аналитической поверхностью (метрики CRV/slope/Z-score/EMA), и **полностью изолирована от LLM**. Чат не имеет ни одного intent для scanner-данных, не читает `appState.scannerV2`, не имеет deep-link «Open chat with X context». Все «AI-интеграции» в Scanner 2.0 — pure rule-based markdown→clipboard.

**Top-5 must-fix:**
1. **PII-поля в LLM payload без redaction** (`assignee`, `email`, `comment` rows) — нарушение `_scrubSecrets` контракта
2. **Prompt-injection через `r.comment`** — ANTI_INJECT слабый, не attestation-paired
3. **Budget-cap global, не per-user** — обходится restart'ом
4. **Scanner 2.0 ↔ LLM = 0 hooks** — теряем главный value-prop
5. **Нет JSON Schema validation** — `parseLLMResponse` крашится при string вместо array

---

## A. Архитектура AI-помощника

### Streaming SSE
- `server.js:320-440` `proxyChat` — двухслойный SSE proxy через `forwardSSEOrChunk`
- Client `app/llmAssistant.js:210-281` `parseStreamResponse` — 3 ветки (json / SSE / no-body)
- **Корректность B+:** heuristic content-type (`upstreamType.includes('json')`) ошибается; `[DONE]` шлётся даже не-stream upstream (двойной wrap)
- **Bug:** нет heartbeat/ping — corp proxy с idle-timeout 60s оборвёт длинные ответы молча

### Context construction
- 4 режима: `none / summary / currentView / fullRegistry / custom` (`llmAssistant.js:56-141`)
- Progressive truncation `truncateForLLM`, hard-cap `payloadLimitBytes` (250KB default)
- **Hole:** identity-поля (`assignee`, `email`) попадают в payload **без redaction** — нарушение
- **Hole:** custom-payload пишется в localStorage без валидации

### Conversation history
- `state.llm.apiHistory` — `MAX_HISTORY=20`, `trimApiHistory` сохраняет system + tail
- localStorage `q2_llm_conv_v1`, TTL 24h
- **Bug:** при overflow первый user-message режется; system заменяется свежим — кастомный system теряется

### Token budget
- **Token-counting отсутствует** (нет tiktoken / `chars/4`). Только byte-count
- Server-side: `LLM_BUDGET_PER_DAY=5000` global — **не per-user**, **не календарный** (reset на uptime — restart обнуляет)
- Защита формальная

### Error recovery
- 401 retry с invalidation `_tokenCache.delete(clientId)` (1 попытка)
- Client распознаёт «token / 401» и «fetch / network»
- AbortController + close-panel ✓
- Empty-stream warning + retry-button (CHAT-12) ✓

---

## B. Связь с разделами приложения

| Раздел | AI чтение | AI Mutation |
|---|---|---|
| Реестр | ✓ filters в context | ✓ apply_filter, clear_filters, confirm_batch (preview) |
| Гант | navigate-only | ✗ |
| **Scanner 2.0** | **✗ NONE** — chat не имеет доступа к `model.scannerV2` | **✗ NONE** |
| Sigma / Pulse / BD / TechInfo | ✗ (есть `chatActivityHandler.js` для PortfolioPulse, backwater) | ✗ |
| Dashboard | ✗ | navigate-only |
| AI-Анализ (`views/aiView.js`) | ✓ отдельный `callLLM` non-stream JSON | ✗ |
| AI-CEO | ✓ свой `callLLM` | ✗ |

**Diagnosis:** В `chatIntentParser.js` (~547 LOC) RULES распознают только Реестр/Релизы/Команды (`state.rows` Jira-эпики). Слов `сканнер`, `Иванов в работе`, `1:1` — **нет**. `chatContextBuilder.js` берёт только `state.rows`, не `state.scannerV2`.

---

## C. Prompt engineering audit

### System prompt (constants.js:11-25)
- ~1.8KB, structure: role → schema → domain constants → behaviour rule
- **Constraints размазаны** — нет ROLE / CAPABILITIES / OUTPUT / CONSTRAINTS секций
- **Few-shot отсутствуют** ВЕЗДЕ — критическая просадка на GigaChat-2
- **Russian quality A-** (после V17.1 A5 — естественно)
- **`ANTI_INJECT` слабый** — короткая фраза-trailer, без token-fence, без attestation-pairing
- **Output format** — markdown + ```json (STRUCTURED_SUFFIX), но **JSON Schema** отсутствует

### Per-task prompts (chatPrompts.js — 7 категорий)
- `search/explain/action/analysis/planning/report/general`
- Each — label + system + userTemplate + customised flag
- `chatActivityPrompts.js` — 3 режима (basic/detailed/analytical)
- **Few-shot:** нет ни одного `<example_input>/<example_output>`
- **Chain-of-thought:** не используется
- **Перекрытия:** двойной prompt path (legacy `llmPrompt` + new `system/user`) — confusing

### Scanner 2.0 contextual prompts
- **НЕ ИСПОЛЬЗУЕТ LLM** (явно в `teamScanner2Insights.js:149`)
- При открытии карточки — LLM не вызывается
- Чат-канал отдельный (`chatActivityHandler`), `dataBlock` без email/SAP-ID, но employee приходит как display name
- **PII-частично:** `chatContextBuilder.js:58-72` redactit «bearer/password/secret/apikey» из user-message, но **не из `comment` rows** — комментарии могут содержать ФИО + телефон + ссылки

---

## D. Hallucination prevention

- **Source attribution:** prompt просит «ссылайся на конкретные команды/эпики» — но без cite-id contract `<cite>PROJ-123</cite>`
- **«I don't know»:** есть в general и в activity-promptах правило 3+6, но **нет negative few-shot**
- **Validation post-generation:** **отсутствует**. Нет проверки что упомянутые epic-id реально есть в payload — LLM может вернуть несуществующий `PROJ-9999` как факт

---

## E. Token / cost / latency

- **Per-request cost:** не считается. Без token-count: payload ~25KB ≈ 6500 tokens in + 900 max_tokens out ≈ ₽3/запрос (GigaChat-2). 5000/день = ₽15k/день worst-case
- **Streaming TTFB:** corp GigaChat 800-1500ms до первого `data:`. Server proxy + OAuth (cached 90s)
- **Caching отсутствует** — identical question на identical context каждый раз идёт upstream. Очевидный win: hash(messages) → 5min TTL в `proxyChat`
- **Local fallback** частично есть (`isRuleBased(intent)` в `chatEngine.js`) — 11 rule-based intents покрывают `EXECUTIVE_SUMMARY`, `RISKS`, `OVERLOAD`, `FILTER_TASKS`. Сильная сторона.

---

## F. Conversation UX

### Onboarding
- Нет dedicated first-run tutorial. Юзер видит сразу пустой input + template-кнопки
- Нет «Что я умею» / capabilities tour
- Нет smart greeting («У вас 3 новых блокера со вчера — спросить?»)
- При пустом токене — silent fallback на rule-based (нет wizard'а)

### Message UX
- **Streaming visual:** `assistant-msg-streaming` + `msg-thinking` (3 точки). Но реального token-by-token streaming в `chatUIRenderer` нет — `body.stream:false` в `aiView.js`
- **Markdown:** `renderMarkdownLite` поддерживает headings/bold/italic/lists/code. **НЕ поддерживает таблицы** — критично для analytics-чата
- **Code blocks** без syntax highlight + per-block copy
- **Long messages** не сворачиваются
- **Edit / delete** — нет (только retry на error)

### Context awareness
- **Page X:** `chatContextBuilder` собирает stats/teams/releases — это про данные, не про где юзер
- **Selected row / filter:** `chatTemplates.js` использует `FilterEngine.getFiltered()` для условных кнопок, но в LLM-промпт активный фильтр **НЕ передаётся** в виде явного «User is currently looking at: Release 1.21, Team CORE»
- **Clear context indicator:** нет UI-чипа «AI sees: filter=1.21, team=CORE» — юзер не понимает что видит модель

### Trust
- **Confidence:** В `aiView.js` BLOCK_SCHEMA содержит `confidence: high|medium|low` ✓. **В chat — отсутствует**
- **Citations:** `chatUIRenderer.js:232` — `cite-pill` для Jira-IDs (regex postprocessing) — слабо
- **«AI may be wrong»:** нет глобального disclaimer
- **Sensitive data warning:** нет hint что данные уходят в GigaChat

---

## G. Top-15 AI issues (consolidated)

| # | Where | What | Sev |
|---|---|---|---|
| 1 | `llmAssistant.js:91-99` | PII-поля (`assignee`, `email`) в LLM payload без redaction | 🔴 P0 |
| 2 | `chatPrompts.js` | Prompt-injection через `r.comment` (ANTI_INJECT слабый) | 🔴 P0 |
| 3 | `server.js:304-318` | Budget-cap global, не per-user, reset на uptime | 🔴 P0 |
| 4 | global | Zero LLM-интеграция Scanner 2.0 | 🟠 P0 |
| 5 | `parseLLMResponse` | Нет JSON Schema validation — UI крашится | 🟠 P1 |
| 6 | `server.js:262-278` | Нет SSE-heartbeat — corp proxy idle-timeout рвёт | 🟠 P1 |
| 7 | `chatPrompts.js` | Нет few-shot / chain-of-thought | 🟠 P1 |
| 8 | `chatActions.js:36-53` | matchRowsByFilter без LLM-injection валидации | 🟠 P1 |
| 9 | `llmAssistant.js:183-188` | History trim ломает custom system на overflow | 🟡 P1 |
| 10 | server-side | Нет prompt-cache — identical messages повторно к upstream | 🟡 P1 |
| 11 | `chatTemplates.js` | LLM не знает активный view+filter — context-blindness | 🟠 P1 |
| 12 | `chatUIRenderer` | Markdown не рендерит таблицы | 🟠 P1 |
| 13 | system prompts | Нет «I don't know» / handoff паттерна — модель галлюцинирует | 🟡 P2 |
| 14 | `chatActivityPrompts.js` | emoji 🔷🧪🔀📘 нарушают «без emoji» rule | 🟡 P2 |
| 15 | global | Hallucination guard отсутствует (нет cite-id check) | 🟡 P2 |

---

## H. Top-10 integration opportunities Scanner 2.0 ↔ AI

| # | Что | Effort | Value |
|---|---|---|---|
| 1 | `chatIntentParser` SCANNER_QUERY intent + scanner ctx-builder | M | High |
| 2 | LLM-rephrase toggle для `composePersonNarrative` | S | High |
| 3 | «✨ Объяснить» badge на каждой метрике (slope/CRV/Z) | M | High |
| 4 | AI Daily-brief auto-generate в 9:00 (cron + cache) | M | High |
| 5 | Scanner→Chat deep-link («Open chat with X context») | S | Med |
| 6 | Anomaly diagnosis on-click | S | High |
| 7 | Sprint-retro generator из History (14d window) | M | High |
| 8 | Burnout-intervention suggestion | M | Med |
| 9 | Cross-team Q&A (вектор-search по participants) | L | Med |
| 10 | Per-team LLM budget + cache layer | S | High (gating) |

---

## I. AI-roadmap (15 идей)

### Quick wins (1-2 спринта)
1. **PII scrubber в payload-builder** — вынести в shared util, прогонять `r.comment / r.epic / r.tasks` через regex+denylist (Bearer/email/SNILS/+7-phone)
2. **Token counting** — heuristic `chars/3.5` (русский) + persistent KV-store budget; UI badge «осталось ₽15 из ₽50/день»
3. **Server-side prompt cache** — `hash(model + messages) → response` 5min TTL — cut 30-50% upstream calls
4. **JSON Schema validation в parseLLMResponse** + 1 retry с repair_prompt
5. **Slash commands** `/scan team CORE`, `/risks 1.21`, `/explain BIK-1234`, `/diff vs-yesterday`
6. **Context chip-bar** над input: `[view: Gantt] [filter: 1.21] [selected: BIK-1234] [×]`
7. **Scanner→Chat deep-link** — кнопка «Спросить AI про Иванова» из карточки

### Scanner 2.0 LLM features
8. **AI Sprint-retro generator** — feed `teamScanner2History` 14d snapshots
9. **AI 1:1 talking-points generator** — заменяет markdown clipboard на 5 вопросов в HR-tone
10. **AI metric-explainer** на каждом числе — slope/CRV/EMA/Z-score
11. **AI anomaly diagnosis** — на каждый Z-badge: «PR throughput ↓3σ потому что …»
12. **AI scope-churn explainer** — diff planning/Jira с narrative
13. **AI burnout-intervention** — composite signal → suggested intervention text
14. **AI Q&A over team data** — `«@scanner расскажи о Иванове за апрель»` (RAG over snapshots)

### Process / quality
15. **Prompt versioning + A/B** — `chat/promptCatalog.js` с `{id, version, system, user, hash}`, telemetry per-variant
16. **Eval framework** — `tests/eval/` golden-set ~50 пар, nightly через GigaChat в CI
17. **Conversation pinning + multi-thread** — left rail с pinned threads
18. **«Citations dock»** — правая панель с источниками (rows, метрики, дашборд-блоки), click → подсветка в реестре
19. **Few-shot library** — для каждой категории 2 worked examples
20. **Hallucination validator** — post-hoc walk через response, проверить что упомянутые `epic`/`team`/`row.id` существуют в state.rows

---

## J. Главный quick win

**§H #1 + #2** — даёт пользователю «расскажи о Иванове» в чате за ~2 дня:
- новый `SCANNER_QUERY` intent в `chatIntentParser.js`
- ctx-builder из `appState.scannerV2`
- LLM-rephrase narrative

Это закрывает 80% value-prop связки Scanner 2.0 ↔ AI.

---

**Файлы high-priority:**
- `chat/chatPrompts.js, chatTemplates.js, chatIntentParser.js, chatActivityPrompts.js, chatEngine.js, chatContextBuilder.js, chatActions.js, chatUIRenderer.js`
- `app/llmAssistant.js`
- `server.js:320-440` `proxyChat`
- `constants.js:11-25` `DEFAULT_LLM_SYSTEM_PROMPT`
- `integrations/teamScanner2Insights.js, teamScanner2.js, teamScanner2Renderer.js, teamScanner2Classifier.js`
- `views/aiView.js, aiCeoView.js`
