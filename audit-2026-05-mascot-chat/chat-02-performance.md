# Chat — performance + memory

> Performance engineer аудит. Фокус: render perf, memory leaks, network efficiency, layout thrashing, animation jank.
> Дата: 2026-05-07

| ID | Sev | Файл:строка | Bottleneck | Impact | Fix |
|---|---|---|---|---|---|
| **P1** | **HIGH** | `app/llmAssistant.js:1118-1126` + `:980-999` | `renderMessages(true)` зовётся на КАЖДЫЙ SSE-delta. Fast-path есть, но он вызывает `parseLLMResponse` (regex+`JSON.parse`) → `renderStructuredResponse` → `renderMarkdownLite` (8+ regex.replace) → `bodyEl.innerHTML=...` плюс **regex `/.../`-extract из готового HTML** (стр. 994). На длинном ответе (2-5 KB, 100-300 chunks) это O(N²): каждый chunk парсит весь накопленный текст. | ~5-30ms/chunk × 100-300 chunks = 500-9000 ms CPU, jank при streaming, dropped frames | rAF-throttle: коалесцировать `onDelta`→render через `requestAnimationFrame` (max 60fps); или time-budget (≥16ms между рендерами). Кэшировать `parseStructuredFromLLM` по длине raw-text + быстрый exit если нет ` ```json `. Убрать regex-extract из HTML — `renderStructuredResponse` должен опционально возвращать только msg-body innerHTML. |
| **P2** | **HIGH** | `app/llmAssistant.js:1162` (+ caller chain) | `saveConversation()` вызывается после стрима — sync `localStorage.setItem` с `JSON.stringify(history+apiHistory)` (до 50×~2KB ≈ 100KB). На finally блокирует main thread на 5-30ms. Также `_trimContent` пересоздаёт массив при каждом save. | 5-50ms блок main thread; на quota — silent loss мог быть, сейчас toast — OK | Дебаунс 500-1000ms; вынести в `requestIdleCallback`; инкрементальное хранение (last-N append вместо full rewrite). |
| **P3** | MED | `app.js:1810-1812` | `LLMAssistant.updateQuickPrompts()` зовётся **на каждый `App.show(section)`** → `wrap.innerHTML = renderQuickPromptsHTML(...)`. Промпты редко меняются (зависят от section/filters), но innerHTML пишется всегда — теряем кешированные dataset/listeners (в данном случае delegated → не leak, но GC-pressure + reflow). | 2-8ms reflow на каждой навигации × частые переключения | Кэшировать по `(section, filtersHash)`; писать только если HTML изменился; или хранить prebuilt DocumentFragment. |
| **P4** | MED | `chat/chatUIRenderer.js:298-384` | `renderMarkdownLite` — 8 chained `.replace(/.../g, ...)` + line-by-line state machine, без cache. На каждом streaming-chunk полностью парсит накопленный markdown. | Часть P1; на 5KB markdown ~3-8ms | Memoize по hash(text); или incremental — рендерить только хвост между last anchor и end. |
| **P5** | MED | `app/llmAssistant.js:957` | `state.llm.history.some(m => m.streaming \|\| m.thinking)` пересчитывается на КАЖДОМ render (включая streaming fast-path). При `HISTORY_MAX_MESSAGES=50` это 50 итераций × 100+ rendr = 5000 дополнительных проходов. | Минор, ~0.5ms/render | Кэшировать флаг `state.llm.isStreaming` который уже есть (см. 1181). |
| **P6** | LOW | `app/llmAssistant.js:485-489` | `_ringbuffer` cap=50 — OK. `apiHistory` тоже cap+`_trimContent` 2KB — OK. Утечки памяти долгой беседы НЕТ. | n/a | Подтверждено: cap есть, growth ограничен (~150KB worst case). |
| **P7** | LOW | `app/llmAssistant.js:842` `chatActions.js:375-410` | `bindActionClicks(messagesWrap)` — **event delegation, навешивается ОДИН раз** в bindUI (стр. 842). Listener leak'а на render НЕТ. | n/a | OK. |
| **P8** | LOW | `app/llmAssistant.js:1002-1009` | Full re-render через `wrap.innerHTML = …map().join('')` для **всей** истории на каждый non-streaming render (476/1021/1059/1077/1183). История ≤50 → ~50 нод. На streaming finally (1183) — 1 раз, OK. | 5-15ms на финал стрима | Diff-rendering (last-N) или DOM-reuse. Низкий приоритет — non-streaming path. |
| **P9** | LOW | `chat/chatUIRenderer.js:178`, `:144-146`, mdHtml | User content escaped через `esc()` (стр. 178). Assistant content (LLM) escaped в `renderMarkdownLite` через `Utils.escapeHtml(seg)` ПЕРЕД inline replacements. **XSS vector нет**. | n/a | OK. Проверить что `Icons.get(...)` возвращает trusted SVG — да, из icons.js. |
| **P10** | LOW | resize/MutationObserver | НЕТ resize-listener'ов в chat-модулях (grep пуст). НЕТ MutationObserver в `llmAssistant.js`/`chatUIRenderer.js`. Mascot pulse на FAB вызывается событийно, не по таймеру. | n/a | OK. |
| **P11** | LOW | `app/llmAssistant.js:721-740` | 2 глобальных `document.addEventListener('keydown'…)` (797, 826) + `mousedown` (721). Навешиваются 1 раз. Но `bindUI()` если будет вызвана дважды — двойные хэндлеры. | Защита отсутствует | Идемпотентный bindUI: guard-флаг `LLMAssistant._bound`. |
| **P12** | LOW | `app/llmAssistant.js:997, 1010` | `wrap.scrollTop = wrap.scrollHeight` на каждый chunk — forced reflow (read+write). | ~0.5-2ms/chunk × N chunks | rAF-coalesce вместе с P1. |

## Top-3 фикса (наибольший ROI)

1. **rAF-throttle streaming render** (P1 + P12) — главная оптимизация. `onDelta` пишет в `assistantMsg.content`, render запускается ≤1×/frame через `requestAnimationFrame`. Снимет 90% jank'а длинных ответов и устранит O(N²) парсинг.
2. **Debounce `saveConversation`** (P2) — `requestIdleCallback`/setTimeout 500ms, разовая запись в конце вместо sync writes.
3. **Memoize `parseStructuredFromLLM` + `renderMarkdownLite`** (P4) — кэш по `raw.length` + early-exit если нет ` ```json `.

## Что подтверждено как НЕ-проблема

- History cap 50 + content trim 2KB → нет memory leak долгой беседы.
- `bindActionClicks` использует event delegation — нет listener-накопления.
- XSS-защита: `escapeHtml` применяется до inline-markdown replacements; user content тоже escaped.
- Нет resize/MutationObserver/setInterval-leak в chat.
- `prizmaLoaderMark` не упоминается в audited файлах — splash leak не наблюдается.
