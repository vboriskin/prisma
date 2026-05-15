# Design — senior product designer (vs reference screenshots)

> Сравнение текущей mascot-интеграции с двумя референс-скринами от заказчика.
> Дата: 2026-05-07

## 1. Таблица расхождений

| # | Контекст | Сейчас | На референсе | Impact | Fix |
|---|----------|--------|--------------|--------|-----|
| **A** | Chat per-message avatar | Один `#obsidian-chat-avatar` 32×32 в шапке. `assistant-msg-assistant` рендерится без аватара (см. `chatUIRenderer.js:167-169` и `:184-188`) | У КАЖДОГО assistant-bubble — свой 28-32px маскот слева; user-bubble — кружок с инициалами справа | UX: главное расхождение. Сейчас разговор «безликий». Brandbook §13.7 — Living Shape должен «жить» рядом с контентом, а не быть запертым в header | `chatUIRenderer.js`: в `renderStructuredResponse()` / `renderThinking()` / `renderError()` обернуть в `assistant-msg-row` с `<span class="msg-avatar obs obs--breathe"><svg><use href="#obs-base"/></svg></span>`. На активном streaming-сообщении менять класс на `obs--ls-streaming`, на завершении — `obs--ls-complete` |
| **B** | Streaming-каретка | В `renderThinking` есть три точки `.msg-thinking`. Самой каретки `▋` в конце streamed-text нет | В bubble во время стрима в конце текста мигающий cursor | Visual polish | `<span class="msg-caret">` в конец `msg-text` пока `assistant-msg-streaming`. CSS `@keyframes blink 1s steps(2)`. В `llmAssistant.onDelta` снимать класс `streaming` → каретка пропадает |
| **C** | Подпись `PRIZMA · СВЕРЯЕТ КУРС` под bubble | Нет. Есть только `chat-category-badge` сверху (не тот вижуал — это pill, не CAPS-caption) | CAPS 9-10px / letter-spacing .6-.7px подпись с `·` под текстом | Brandbook §spine-pill: типичный «caption» бренда не реализован в чате | Новый стиль `.msg-spine-caption`: `font: 600 9.5px ui-monospace; letter-spacing: .65px; text-transform: uppercase`. Рендерить из `resp.spineCaption` (LLM возвращает в JSON) или derive из `resp.category` (`searchPlan` → «PRIZMA · ИЩЕТ КУРС») |
| **D** | Toast/Error — маскот | `ToastQueue.show` (uxKit.js:196-226) рендерит без маскота. `prizma-toast` в styles.css:741 — отдельный визуал без mascot-slot | Toast «Не удалось обновить курс» / «Замечен дрейф в Atlas» содержит маскот 28-32px слева (concerned для error, alert для drift), CAPS-sub-text, кнопку справа | Brandbook §13.7: маскот обязан появляться в системно-важных моментах. Сейчас error-сигнал визуально расходится | (1) В `ToastQueue.show()` принять опц. `mascot: 'concerned'\|'alert'\|null` и `subText`. (2) Шаблон: `<span class="toast-mascot obs obs--concerned"><svg><use href="#obs-concerned"/></svg></span><div class="toast-body"><span class="toast-msg">…</span><span class="toast-sub">…</span></div><button class="toast-cta">…</button>`. (3) `errorsLog.js` / `chatEngine.js` при ошибке стрима зовёт `Toast.show({ msg, mascot:'concerned', subText:'СОЕДИНЕНИЕ · ПОВТОР ЧЕРЕЗ 5 СЕК', undo:'ПОВТОРИТЬ' })`. (4) Drift-detection → `mascot:'alert'` |
| **E** | Onboarding tour с ls-move | `onboarding/onboardingUI.js` рендерит `#ob-tour-tooltip` + ring (line 182-227). Маскота нет | Маскот ~40-48px «плывёт» (ls-move) от карточки к карточке между шагами | UX/brand: тур ощущается как стандартный popover, без персонажа | В `_positionTourTooltip` добавить `<span class="ob-tour-mascot obs obs--ls-move"><svg><use href="#obs-base"/></svg></span>` внутри tooltip. Между шагами: до удаления tooltip — анимация `ls-move` 4с с CSS-translate от старой позиции к новой через `getBoundingClientRect`. После landing — `obs--cur` (Curious) на 600мс → `obs--breathe` |
| **F** | Concerned/Alert на FAB при error в чате | `pulseAlertOnFab()` зовётся из `llmAssistant` finally → но только для streaming-end, не для error | Reference #1 правый-нижний toast — concerned-маскот | UX-мелочь | В `llmAssistant` catch-блок: `Toast.show({ mascot:'concerned', … })` + добавить `pulseConcernedOnFab()` (новый метод по аналогии с `pulseAlertOnFab` — `_playOnce(this._fab, 'obs--concerned', 'obs--breathe')`) |
| **G** | User-bubble — инициалы | `assistant-msg-user` (line 178) — голый текст, без avatar-кружка | Кружок с «МК» справа от bubble | Visual symmetry | Обернуть в row: `<div class="msg-row msg-row-user"><div class="bubble">…</div><span class="msg-initials">МК</span></div>`. Источник инициалов — `state.currentUser` или derive из `state.employees[me]` |
| **H** | Scroll-to-bottom button (↓) | Не вижу в `chatUIRenderer.js` | Reference #2: `↓` в правом-нижнем углу скролл-зоны | UX | `<button class="chat-scroll-down hidden">↓</button>` в `chat`-shell; show когда `scrollTop + clientHeight < scrollHeight - 80`; click → `scrollTo({top:scrollHeight,behavior:'smooth'})` |

## 2. Топ-5 задач (приоритет дизайнер + артдиректор)

1. **P0 — Per-message mascot avatar в чате** (item A). Главное визуальное отличие. Артдиректор: согласовать размер 28 vs 32px и spacing 8px gap. Дизайнер: макет user-row с инициалами (G).
2. **P0 — Toast/Error mascot integration** (D). Унифицирует error-experience с брендом. Дизайнер: 3 варианта — concerned (error), alert (drift), success (ok). Артдиректор: проверить §13.10 п.7 — нельзя стакать ls-move с concerned, проверить что toast статичен.
3. **P1 — Spine-pill caption под assistant-bubble** (C). Связано с типографической ДНК Призмы. Артдиректор: список фраз («СВЕРЯЕТ КУРС», «ИЩЕТ КУРС», «АНАЛИЗИРУЕТ», «ПОДТВЕРЖДАЕТ») — финальный copy-deck.
4. **P1 — Onboarding ls-move integration** (E). Превращает скучный туториал в фирменное «знакомство с Обсидианом». Дизайнер: storyboard 5-7 шагов. Артдиректор: тайминг ls-move (сейчас 4с — может быть слишком медленно для тура).
5. **P2 — Streaming-каретка + scroll-to-bottom** (B, H). Polish, можно во второй заход.

## 3. Не-затронутые контексты

| Где | Текущее состояние | Где должен появиться маскот | Метод |
|-----|-------------------|------------------------------|-------|
| `ToastQueue` (uxKit.js) | Голый toast | `mascot:` параметр в API | item D |
| `errorsLog.js` | Текстовый лог | Каждый user-visible error → toast с concerned | подключить к `Toast.show` |
| `onboarding/onboardingUI.js` | Tooltip без персонажа | ls-move между шагами + Curious при landing | item E |
| `insightEngine.js` / drift-detection | (если есть) | Drift → toast с `obs--alert` | item D |
| `chatActions.js` | Action-кнопки в bubble | Success-feedback после `apply` action — `obs--success` micro-anim на per-message avatar | hook в action-handler |
| `aiCeoRenderer.js` / `ai/` views | Без маскота | Долгий compute → ls-thinking рядом с заголовком блока | новый `<span class="ai-block-mascot obs">` в header AI-карточки |
| Empty-states (нет данных в реестре, пустой gantt) | Текстовые placeholder'ы | Большой 64-80px маскот в hibernate (§13.5) | новый компонент `<EmptyState mascot="hibernate">` |

## 4. Набросок DOM/CSS для chat per-message avatar

**`chat/chatUIRenderer.js`** — заменить `renderStructuredResponse` обёртку:

```js
const phaseClass = isStreaming ? 'obs--ls-streaming' : 'obs--breathe';
return `<div class="msg-row msg-row-assistant" data-index="${idx}">
  <span class="msg-avatar obs ${phaseClass}" aria-hidden="true">
    <svg viewBox="-60 -60 120 120"><use href="#obs-base"/></svg>
  </span>
  <div class="assistant-msg assistant-msg-assistant${streamingCls}">
    <div class="msg-body">${parts.join('')}${isStreaming ? '<span class="msg-caret"></span>' : ''}</div>
    ${spineCaption ? `<div class="msg-spine-caption">${esc(spineCaption)}</div>` : ''}
    ${copyBtn}
  </div>
</div>`;
```

**`renderUserMessage`**:
```js
return `<div class="msg-row msg-row-user" data-index="${idx}">
  <div class="assistant-msg assistant-msg-user">${esc(msg.content)}</div>
  <span class="msg-initials" aria-hidden="true">${initials}</span>
</div>`;
```

**`styles.css`** (или новый `chat/chat-mascot.css`):
```css
.msg-row { display: flex; align-items: flex-end; gap: 8px; margin: 12px 0; }
.msg-row-assistant { justify-content: flex-start; }
.msg-row-user      { justify-content: flex-end; }
.msg-avatar { flex: 0 0 28px; width: 28px; height: 28px; }
.msg-avatar svg { width: 100%; height: 100%; display: block; }
.msg-initials {
  flex: 0 0 28px; width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--prizma-ink); color: var(--prizma-bg);
  font: 600 11px ui-monospace; letter-spacing: .4px;
}
.msg-spine-caption {
  margin-top: 4px; font: 600 9.5px ui-monospace;
  letter-spacing: .65px; text-transform: uppercase;
  color: var(--prizma-ink-muted);
}
.msg-caret {
  display: inline-block; width: 6px; height: 1em;
  background: currentColor; vertical-align: text-bottom;
  margin-left: 2px; animation: caret-blink 1s steps(2) infinite;
}
@keyframes caret-blink { 50% { opacity: 0; } }
```

**Контроллер фазы per-message**: `ObsidianMascot.setMessageAvatarPhase(idx, phase)` — найти `.msg-row[data-index="${idx}"] .msg-avatar`, применить `_setLoop` / `_playOnce`. Вызывать из `llmAssistant`:
- `onStart(idx)` → `'thinking'`
- `onFirstDelta(idx)` → `'streaming'`
- `onComplete(idx)` → `'complete'` once → `'breathe'`
- `onError(idx)` → `'error'` once → `'concerned'`

Header-аватар (`#obsidian-chat-avatar`) можно либо удалить (ref #2 его не показывает), либо оставить как «системный» индикатор глобальной фазы.

---

**Ключевые файлы для правок**:
- `chat/chatUIRenderer.js` — A, B, C, G, H
- `app/llmAssistant.js` — wiring per-message phases
- `app/obsidianMascot.js` — `setMessageAvatarPhase`, `pulseConcernedOnFab`
- `app/uxKit.js` — Toast API расширение (D)
- `onboarding/onboardingUI.js` — ls-move в tour (E)
- `styles.css` — `.msg-row`, `.msg-spine-caption`, `.msg-caret`, toast-mascot
- `errorsLog.js` — hook на toast с маскотом
- `index.html` — добавить sprite `#obs-success` для action-feedback
