# Пункт 3 — Чат-ассистент: редизайн

**Команда:** арт-директор + senior product designer (interaction). Раздельные angles.

## I. Консенсус (то на чём оба сошлись)

### CHAT-CONS-1: Открытие чата — нужен hotkey
- Арт-директор (Quick win 9): «Hotkey ⌘/ — toggle assistant»
- Designer (Top-3 #1): «Cmd+J / ⌘/ открывает/закрывает панель из любой точки app»

### CHAT-CONS-2: Streaming feedback недостаточен
- Арт-директор (Quick win 8): «caret → 2px sweep gradient»
- Designer (Top-3 #3): «live tokens-per-second / elapsed + watchdog 15s + token-died explicit»

### CHAT-CONS-3: Header перегружен (6 кнопок)
- Арт-директор (Quick win 1): «payload скрыть в debug; ⚙ / ✦ / — в ⋯ overflow»
- Designer (§1): «5 кнопок не помещаются на 320px; нет иерархии primary/secondary/overflow»

## II. Уникальные находки

### Арт-директор (визуал):
1. Header gradient + radial-gradient 1200×420 — «GPT-Web-2018»
2. User-bubble фиолетовый градиент с тенью — кричит громче контента
3. Quick-prompts в виде collapse-секции — старый Web 2.0 паттерн
4. Category-badge с эмоджи + 7 пастельных фонов — «детский конструктор»
5. Markdown-цитаты не подсвечены (нет inline-citation для `WT-1342` / имён команд)
6. Cards внутри bubble дают двойную контейнеризацию
7. payload-кнопка в production = debug-чип

### Designer (interaction):
1. Esc + settings modal + chat — порядок закрытия неоднозначен
2. Закрытие во время стрима — silent abort без подтверждения
3. Cancel mid-stream → apiHistory не пушит обрыв (LLM теряет контекст)
4. Streaming structured-response мерцает (cards вспыхивают только в конце)
5. Token expired mid-stream → «Ответ пустой» без объяснения
6. Activity-intents и mutation-intents в одном UI — нет confirmation diff
7. Нет undo для batch mutations
8. Review-mode select disposable — роль не «прицеплена»
9. ⊕ контекст дампит 2KB JSON в textarea
10. На <800px перекрывает контент, нет swipe-close
11. Cmd+Enter не работает (только Enter)
12. Up-arrow в пустом textarea не подставляет последний запрос
13. role="log" / aria-live отсутствует на #assistant-messages

## III. Концепты редизайна

### Concept A — «Spine Console» (арт-директор, главная рекомендация)
Чат — продолжение таблицы, не отдельный мессенджер. Bubble удалены, сообщения — секции с тонким divider. Header сжат до 32px (overflow-меню `⋯`). Citations — first-class mono-pill chips. Cards без двойной контейнеризации. Streaming = 2px gradient sweep. Slash-menu вместо chips в input.

### Concept B — «Pill-Native Workspace»
Двух-колонник: conversation + sticky Evidence panel. Цитаты-пилюли тех же пилюль что в гант-таблице. Hover в чате → подсветка пилюли в Evidence. Review-mode карточки = first-class slots.

**Финал:** A с элементами B (inline-citations + global ⌘/). Концепт B отложен — большой layout-рефакторинг.

## IV. Что применяю сейчас

### CHAT-1 (CONS-1): hotkey ⌘/ + ⌘J открывает/закрывает aside

### CHAT-2 (Visual #1): убрать gradients (radial 1200×420 + linear header)

### CHAT-3 (Visual #2): user-bubble в neutral

### CHAT-4 (Visual #4): category-badge без emoji + neutral pill

### CHAT-5 (Visual #5): inline-citations v0 — `WT-\d+` → `<span class="cite-pill">`

### CHAT-6 (CONS-2): streaming 2px gradient sweep вместо caret-..

### CHAT-7 (Visual #7): payload скрыть в debug-флаге

### CHAT-8 (Designer #11): Cmd+Enter для отправки (mac рефлекс)

### CHAT-9 (Designer #12): Up-arrow в пустом textarea → последний запрос

### CHAT-10 (Designer #13): aria-live="polite" + role="log" на #assistant-messages

### CHAT-11 (Visual subtitle): ▾ + dotted-underline на context-mode subtitle

### CHAT-12 (Designer Top-3 #3 partial): token-died explicit message вместо «Ответ пустой»

## V. TODO (отложено в backlog)

| # | Severity | Что | Почему отложено |
|---|---|---|---|
| TODO-1 | High | Confirm/preview/undo batch (Designer Top-3 #2) | Большой UI на diff + reverse-action в chatActions.js |
| TODO-2 | High | Concept B Evidence panel | Layout-рефакторинг, требует synced renderer |
| TODO-3 | Medium | Slash-menu в input | UX-большой refactor, новые widgets |
| TODO-4 | Medium | Watchdog 15s slow stream | Требует проектирование backoff-policy |
| TODO-5 | Medium | Mobile / narrow swipe-close | Отдельная mobile-итерация |
| TODO-6 | Medium | Header overflow ⋯ menu | Требует new component, отдельный заход |
| TODO-7 | Low | Quick-prompts → empty-state | UX-вопрос когда показывать |
| TODO-8 | Low | Cards без двойной контейнеризации | Требует CSS-rewrite chat-card / chat-plan-item |

## VI. Финальные тесты

**До:** 497 / 11 / 0
**После:** **516 / 11 / 0** (+19 regression-тестов в `tests/unit/v17ChatRedesign.test.js`)

## VII. Применённые фиксы (детально)

| # | Файл / строки | Что |
|---|---|---|
| **CHAT-1** | `app/llmAssistant.js` `bindUI` | Глобальный hotkey ⌘/ ⌘. ⌘J (+RU layout о/О); guard когда фокус в чужом input; toggle panel + focus textarea |
| **CHAT-2** | `styles.css` `.assistant-panel` + `.assistant-panel-header` | Удалил radial 1200×420 + linear 90deg gradient → flat surface `var(--card)` |
| **CHAT-3** | `styles.css` `.assistant-msg-user` + dark | Убрал фиолетовый градиент + shadow → neutral `var(--surface-2)` + 1px border + radius 4px (вместо 12px). Symmetric для assistant-msg |
| **CHAT-4** | `chat/chatUIRenderer.js` + `styles.css` | `CATEGORY_ICONS` (🔍💡⚡📊🗺📋💬) → `CATEGORY_LABELS` (поиск/объяснение/...). 7 пастельных фонов → 1 neutral pill + 2px left-stripe per category |
| **CHAT-5** | `chat/chatUIRenderer.js` `applyInline` + `styles.css` | inline-citations: regex `/\b([A-Z]{2,6}-\d{1,6})\b/g` → `<span class="cite-pill">`. Mono-font + neutral background, как `gdt-ctx-bucket-chip` в гант ctx-menu |
| **CHAT-6** | `styles.css` `.assistant-msg-streaming::after` | 7×12 caret blink → 2px gradient sweep bar внизу message, animation `assistant-stream-sweep` 1.2s |
| **CHAT-7** | `index.html` payload-button + `app/llmAssistant.js` bindUI | Кнопка `payload` теперь `class="hidden"` по default. Открывается через `localStorage.q2_chat_debug = '1'` (debug-flag) |
| **CHAT-8** | `app/llmAssistant.js` input keydown | Cmd+Enter / Ctrl+Enter работает как Enter (mac муscle memory) |
| **CHAT-9** | `app/llmAssistant.js` input keydown | Up-arrow на пустом input → `state.llm.lastUserText` подставляется + caret в конец |
| **CHAT-10** | `index.html` #assistant-messages | `role="log"` + `aria-live="polite"` + `aria-label` |
| **CHAT-11** | `styles.css` `.assistant-subtitle-clickable` | `::after { content: ' ▾' }` + dotted-underline на hover — visible affordance |
| **CHAT-12** | `app/llmAssistant.js` empty-stream branch | «Ответ пустой. Проверь модель/токен» → конкретный «⚠ Стрим завершился без текста ... Нажми Повторить или открой настройки» + `assistantMsg.isError=true` для retry-кнопки |

## VIII. Тесты (19 новых regression)

Файл: `tests/unit/v17ChatRedesign.test.js`

| Группа | Тестов | Что проверяют |
|---|---|---|
| **CHAT-5** cite-regex | 7 | `BIK-1234` / `WT-42` matches; `A-1` no; lowercase no; multiple cites; URL-context |
| **CHAT-1** hotkey policy | 6 | Cmd+/ / Ctrl+J / RU `о` matches; plain `/` does not; skipped in foreign input; not skipped in own panel |
| **CHAT-9** up-recall policy | 4 | empty input + ArrowUp = recall; non-empty / shift / other key = no |
| **CHAT-4** category labels | 2 | no emoji glyphs in any label; all lowercase Russian |
