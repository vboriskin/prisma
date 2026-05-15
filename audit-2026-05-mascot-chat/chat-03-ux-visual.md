# Chat — UX / visual / brandbook compliance

> Senior UX-дизайнер аудит. Фокус: empty/loading/error states, mobile, a11y, brandbook compliance.
> Дата: 2026-05-07

| ID | Sev | File:line / Element | Issue | Brandbook ref | Fix |
|---|---|---|---|---|---|
| **C1** | LOW | `llmAssistant.js:1150` | В user-facing error: emoji `⚠` («⚠ Ответ пустой…») | §12 (no emoji) | Заменить на `Icons.get('alert-triangle')` или префикс «Внимание:» без glyph |
| **C2** | **HIGH** | `llmAssistant.js:1017` `clearConversation()` | Кнопка «Новый» очищает всю историю **без confirm-dialog**. Юзер теряет диалог в 1 клик | §13 (destructive action confirmation) | Confirm-modal или undo-toast 5s («История очищена · Восстановить») |
| **C3** | **HIGH** | `llmAssistant.js:997, 1010` | **Auto-scroll всегда жёсткий**: `wrap.scrollTop = wrap.scrollHeight` на каждый chunk. Если юзер скроллит вверх — рывком утаскивает вниз | §11 (no jank) | Sticky-scroll: `if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 60) scroll`; иначе показать «↓ новые сообщения» pill |
| **C4** | **HIGH** | `styles.css:5144-5152` (mobile MQ) | Mobile breakpoint `max-width: 900px`, не `768px/375px`. На 375px панель `100vw - 10px` ОК, но `assistant-quick-prompts max-height:200px` + 8 chips = переполнение, скрытое overflow:hidden — **обрезает кнопки** | §15 (mobile) | `@media(max-width:480px)` с `max-height:140px`+`overflow-y:auto`, либо горизонтальный scroll-strip |
| **C5** | MED | `chatTemplates.js:160` `slice(0,8)` | Quick-prompts капятся на 8, но при 7+ wrap'ятся в 3-4 строки. На mobile это 50% высоты viewport | §15, §3 (breathe) | Cap = 5 на mobile, остальные за «ещё» chip; либо single-row horizontal scroll |
| **C6** | MED | `chatUIRenderer.js:184-188` `renderThinking` | Thinking-indicator статичный (3 bouncing dots), **нет timeout-state** «Долго думает (>15s)» | §11 (signal feedback) | После 15s вставлять hint «Запрос длится дольше обычного…» внутри thinking-bubble |
| **C7** | MED | `chatUIRenderer.js:193-198` `renderError` | Retry-button нейтральный (info-color). Ошибка не различима визуально от обычного assistant-bubble | §11 signal palette (off-course) | `border-left:3px solid var(--prizma-off-course)` + `Icons.alert-triangle` префикс |
| **C8** | MED | `styles.css:4861, 4972` | User vs assistant контраст слабый: оба `var(--card)` / `rgba(127,127,127,.06)`, различие только `align-self` | §3 (visual hierarchy) | User: `border-left:3px solid var(--text-3)` (spine-pill); либо assistant — accent-information stripe |
| **C9** | LOW | `chatUIRenderer.js:165` | Copy-btn появляется только на `:hover`, на keyboard-focus тоже opacity:0 | §a11y | `opacity:1` при `.msg-copy-btn:focus-visible` |
| **C10** | LOW | `index.html:1390` | `<textarea rows="2">` без `aria-label` (только placeholder). Screen-reader читает «edit text» | a11y WCAG | `aria-label="Сообщение помощнику"` |
| **C11** | MED | `llmAssistant.js:770-791` | **Tab-нав через messages не реализована**. Нет roving-tabindex / focus-trap. Tab из textarea уходит на FAB вне панели | §a11y (keyboard nav) | Focus-trap внутри `aside` пока `panelOpen`, или `tabindex="-1"` на messages-wrap с roving |
| **C12** | LOW | `chatUIRenderer.js:298-387` | Long messages: `<pre>` использует `overflow:auto` ОК. Но `md-table` НЕ имеет `overflow-x:auto` wrapper'а — **широкая таблица растягивает bubble и ломает 92% max-width** | §15 mobile | Обернуть `<table>` в `<div class="md-table-wrap" style="overflow-x:auto">` |
| **C13** | LOW | `styles.css:4988-5001` | `code` background `rgba(15,23,42,.92)` + `pre` background `#111827` — hardcoded, **не реагирует на theme-light** | §brandbook tokens | `var(--prizma-bg-elevated-strong)` или token-based |
| **C14** | MED | `chatUIRenderer.js:90-97` `renderDrilldown` | Drilldown-кнопки и quick-prompt-кнопки визуально не консистентны (разные радиусы, цвета) | §3 consistency | Унифицировать drilldown под `assistant-quick-btn` style |
| **C15** | LOW | `chatActions.js:128` confirm_batch | UX confirmation flow — preview-карточка с `confirm_batch` action. **Нет «Отмена» button рядом** | §13 (reversibility) | Парный chat-action `cancel_batch` или drilldown «Отменить превью» |
| **C16** | LOW | `index.html:1352-1358` `<select id="chat-review-mode-select">` | Native `<select>` дропдаун в брендированном header — рендерится OS-style | §3 visual lang | Кастомный dropdown через `Multiselect` component (уже есть) |
| **C17** | LOW | `styles.css:4720-4724` `.assistant-panel.hidden` | Анимация ухода — `transform: translateX(100%+20px)` 250ms. **Focus остаётся внутри hidden panel** (нет `inert` / `aria-hidden`) | §a11y | Добавить `inert` атрибут когда `.hidden` |
| **C18** | LOW | `app-settings-modal` (LLM tab) | **Нет валидации** при пустом API-token: юзер сохраняет, потом получает «пустой ответ» в чате (C7) | §UX form | Inline-validation в LLM-tab + warning-banner при empty token |
| **C19** | LOW | `chatUIRenderer.js:185` `renderThinking` | Thinking dots — `transform:translateY(-6px)` infinite. Не rotating spinner — допустимо. Но fade-in пересекается с streaming-stripe | §11 (no rotating) | OK — рекомендация: не показывать `assistant-msg-streaming::after` stripe одновременно с `msg-thinking` |
| **C20** | INFO | `llmAssistant.js:966-976` empty-state | `prizmaEmptyGlyph` + caption + 3-bullet onboarding — корректно | §10/§3 | OK |

## Топ-3 critical к фиксам прямо сейчас
1. **C2** — confirm на «Новый» (потеря данных в один клик).
2. **C3** — sticky-auto-scroll: ломает чтение длинных ответов.
3. **C4/C12** — mobile + table overflow: на 375px часть UI клипается.
