# Лидия Жукова — Чатбот: UX-аудит

> **Кто я.** Лидия Жукова, 5 лет в OpenAI над ChatGPT-Playground (streaming-renderer, modal flows для tool-use), 2 года в Anthropic над Claude.ai (sidebar conversations, regenerate-tree, artifacts). Сейчас независимый консультант — собираю чат-интерфейсы для enterprise: Сбер, Тинькофф, ABBYY, Авито.
>
> **Что смотрела.** Только вкладка/панель «Помощник» в Призме. Прочла все 15 файлов в `chat/`, `app/llmAssistant.js` целиком, `docs/microcopy-style-guide.md`, `docs/tone-of-voice.md`, чат-разметку `index.html:1485-1563`. На уровне «что чувствует пользователь, когда…», а не «как починить регекс».
>
> Аудитов на этом коде уже было много (V15/V17/V21/V22, audit-04 §G, AUDIT_MASCOT, V17 P3, AUDIT_HOLISTIC AU5, и т.д. — отметки в коде густые). Поэтому ниже я разделяю «дыры, которые правда мешают пользователю» и «эпохальные доработки» — не повторяю фиксы из chat-01..04. Где старый фикс смотрит «технически закрыт, UX-сторона осталась» — это явно отмечаю.

## TL;DR

1. **Empty-state и onboarding не объясняют ментальную модель** (`app/llmAssistant.js:1238-1248`). Пользователь — PM/EM — открывает панель, видит абстрактный glyph и три bullet'а на «движенческом» жаргоне («Сверь курс / Найди дрейф»). Не понятно, КАК спросить: команды это или текст? Откуда чат знает мои задачи? Quick-prompts помогают, но они шумные (8 кнопок, многие про одну и ту же сущность) и слабо связаны с empty-state — два разных «голоса».
2. **Streaming visual состояние ≠ streaming pipeline.** Идея с per-message Obsidian-аватаром в фазах thinking/streaming/error великолепна как concept, но: маскот «дышит» **сильнее**, чем шевелится текст, а реальный caret-курсор в bubble (`chatUIRenderer.js:190`) — это пустой span. Glyph отвлекает; долгий streaming визуально неотличим от «зависло». 15-секундный long-hint (`renderThinking` line 274) — единственный явный сигнал, и он спрятан до 15 сек.
3. **Recovery-петли разорваны.** Auth-error CTA «Открыть настройки LLM» (`llmAssistant.js:1357-1369`) — единственная rich error. Все остальные ошибки (rate-limit, network drop, payload too large, 5xx, JSON-парсинг) идут plain-text без shortcut к решению; retry на rate-limit запустит тот же отказ.
4. **Mental-model overpromise.** В quick-prompts есть «Перенеси задачи без релиза в 1.22», в alert'ах — «Предложить исправление». Пользователь читает это как **«бот сделает»**, а движок аккуратно строит preview-batch и просит подтверждение. Это правильный safety-выбор, но UI его не сигналит до клика. Юзер тратит первое action на «давай попробуем» и обнаруживает, что нужно ещё кликать.
5. **Trust-attribution размыт.** Есть `assistant-context-bar` («AI видит: view=registry, team=Кардиолог, filters…») — отличная штука, **но рядом сидит** `assistant-context-mode-label` («Контекст: текущий вид») — тот же информационный объект, два UI-элемента, противоречат друг другу по гранулярности. И ни один не показывает, СКОЛЬКО реально ушло в payload (это известно — `setPayloadStatus`, line 1530 — но только мелким текстом в footer'е и только пост-фактум).

---

## Critical (S0) — юзер теряется / бросает чат

### S0-1. Empty-state не учит, как разговаривать с ботом

**Где:** `app/llmAssistant.js:1238-1248`

```html
<div class="chat-empty-mark">[glyph]</div>
<div class="chat-empty-caption">ПРИЗМА СЛУШАЕТ</div>
<div class="chat-empty-hint">«Сверь курс», «Найди дрейф», «Кто перегружен?» — спросите. Или выберите типовой вопрос выше.</div>
<ul class="chat-empty-capabilities">
  <li>Читает текущий вид (фильтры, выбранную строку) — payload pre-scrubbed.</li>
  <li>Предлагает фильтры, план, разбор рисков — всё через preview-чип.</li>
  <li>Не выполняет мутации без вашего клика, не зовёт интеграции.</li>
</ul>
```

Что пользователь читает (PM/EM, не дизайнер, не понимает «pre-scrubbed»):

- Какой-то значок.
- «Призма слушает» — ок, это маркетинг.
- Три примера команд в брендовом стиле — НИ ОДИН не звучит как нормальный человеческий вопрос. «Сверь курс» — это команда или метафора? «Найди дрейф» — что такое «дрейф»? «Кто перегружен» — а, это вот понятное.
- Три bullet'а под ними — «payload pre-scrubbed», «preview-чип», «не зовёт интеграции» — три термина подряд, два из них чисто инженерные.

**Сценарий поломки.** PM открывает чат впервые. Хочет сводку по релизу 1.21. Колеблется: «Покажи статус по 1.21»? «Что в 1.21?»? «Сводка 1.21»? Перематывает на quick-prompts сверху — да, там есть пункт, но он 12-й сверху и обрезан до 60 символов. Возвращается к empty-state, прочитывает третий bullet — «не зовёт интеграции» — теряет интерес («значит, реальных данных не будет»).

**Fix-direction.**
- Empty-state должен показывать **3 живых примера запроса** с ожидаемым результатом-превью (скрин-preview карточки). У ChatGPT (новый empty-state) и Linear AI это работает.
- Первый запрос должен быть «warm-up»: 1 клик из galery, чат сразу пишет ответ — пользователь убеждается, что бот понимает русский и знает данные.
- «Что чат НЕ умеет» — третий пункт сейчас читается как ограничение. Переписать как обещание безопасности: «Все изменения вы подтверждаете кликом. Без вашего клика — только чтение.»
- Убрать брендовый словарь («дрейф», «сверь курс») ИЗ примеров запросов. Оставить в caption'е, в caption'ы под bubble (`_categoryToCaption`) — пусть. Но команды-примеры на нормальном русском.

### S0-2. Streaming-зависание = «выключенный chat»

**Где:** `chat/chatUIRenderer.js:266-279` + `app/llmAssistant.js:1463-1469`

`renderThinking` создаёт thinking-bubble, но **3-точечный индикатор `.msg-thinking` спрятан `display:none`** (line 273 — там стоит inline-style), и **`.msg-thinking-longhint` спрятан `hidden`** до 15 секунд (line 1465-1469).

В промежутке между «нажал Отправить» и «прилетел первый токен» пользователь видит **только маскота-аватара** в фазе `obs--ls-thinking`. Если у пользователя ослабленный фокус или маскот закрыт системной анимацией (Reduce Motion?), визуально это «панель замерла».

**Сценарий поломки.** GigaChat в плохой день отвечает за 6-9 секунд. Все три bullet'а в empty-state уже скрыты (история не пустая). Маскот тихонько «дышит» (это `breathe`, не `thinking`? проверила — там `ls-thinking`, но визуально на 32px разница мизерна). Пользователь ждёт 4 сек, открывает Settings, начинает читать — приходит ответ, маскот дёргается, пользователь не замечает.

**Fix-direction.**
- 3 точки ВКЛЮЧИТЬ обратно (или заменить на skeleton-bar — Linear AI, NotebookLM). Маскот — приятный бренд-сигнал, но в ноль текста не должен оставаться единственным feedback'ом.
- Долгий-hint (`.msg-thinking-longhint`) показывать через **5-7 секунд**, не 15. Через 5 сек пользователь уже психологически вышел из «стрим вот-вот пойдёт» в «что-то не так». В audit-04 §G #11 это уже отмечалось, фикс «C6» поставил 15с — слишком поздно.
- Добавить визуальный progress (точки/skeleton/«streaming…» badge) что **прямо сейчас** идёт сетевой запрос, отдельно от маскота.

### S0-3. Rule-based ответ выглядит как LLM-ответ — пользователь думает, что бот «умнее, чем есть»

**Где:** `chat/chatEngine.js:730-755`, рендер в `chat/chatUIRenderer.js:144-208`

`buildExecutiveSummaryResponse / buildRisksResponse / buildFindTasksResponse` — это **rule-based** хардкод (статистика берётся из state, текст шаблонизирован). Ответ рендерится с теми же маскотом, той же кареткой, тем же spine-caption, что и стрим LLM. Пользователь не видит разницы.

**Почему это критично:** в первом ответе бот может вернуть rule-based «Сводка по проекту» на запрос «дай статус». Юзер впечатлён — задаёт нестандартный follow-up «А почему именно 4 блокера у команды PAY?». Это уже LLM-маршрут, и качество ответа резко падает (GigaChat-2 на 6KB payload без few-shot — слабоват). Доверие пробивается.

**Fix-direction.**
- Маркировать rule-based ответ **другим визуальным языком**: на бэйдже «rule-based · мгновенно» (он уже есть в `setPayloadStatus(line 1488)`, но он во footer'е). В bubble дать pill «по правилу» рядом с category-badge. У ChatGPT-Tools это сделано через «Searched the web» — отдельный мини-блок над ответом.
- Альтернатива: rule-based ответы НЕ дают категориальный caption «PRIZMA · АНАЛИЗИРУЕТ» (`_categoryToCaption`) — он создаёт иллюзию reasoning. Подходящий caption — «по фильтру», «по правилам».

### S0-4. «Пустой ответ» — единственный recovery без рассказа, что случилось

**Где:** `app/llmAssistant.js:1566-1582`

```js
assistantMsg.content = 'Внимание: ответ пустой — стрим завершился без текста. Возможные причины: истёк токен, неверная модель, перегруз сети. Нажми «Повторить» или открой настройки.';
```

Текст хороший, но:
1. Он на «ты», что нарушает `tone-of-voice.md:31` (на «вы»). R5 lint должен бы его поймать, но он не натравлен на наш собственный fallback-копи.
2. Слово «Внимание» — это R4 violation (`tone-of-voice.md:49`).
3. Три «возможные причины» в одну строку — пользователь не понимает, **какая** и **что делать**.
4. Кнопка «Повторить» в renderError — это `<br><button>`, без spacing'а и без secondary CTA «настройки».

И главное: **на этом этапе у системы есть данные** — мы знаем `tokenPresent`, `apiMode`, `model` (line 1567-1574 их логирует). Они могли бы превратиться в **диагностическую матрицу**: «Token: есть · API mode: proxy · Model: GigaChat-2 · ответ: пуст». Тогда пользователь видит «токен есть, режим proxy» — значит, виновата сеть/модель, не он. Это снимает «я виноват» feeling, который у корп-пользователей выключает чат навсегда.

**Fix-direction.**
- Rich-error block с 3 чек-боксами диагностики (как 401-CTA уже сделано, line 1357-1369): «Токен задан · Сервер отвечает · Модель доступна → стрим пуст». Один из чек-боксов будет красным.
- Кнопка «Открыть настройки LLM» рядом с «Повторить».
- Текст переписать в брендовом ровном тоне без «Внимание» и на «вы».

---

## High (S1) — скрытые трения, выученная беспомощность

### S1-1. Quick-prompts перегружены, нет «recently used» и «pinned»

**Где:** `chat/chatTemplates.js:137-161` + `index.html:1539`

`getQuickPrompts()` склеивает `BY_SECTION + ALWAYS + BY_DATA` → cap 8. Это значит, пользователь видит 8 кнопок при любом раскладе. Контент динамичный (зависит от `state.activeSection` и `state.rows`), но **порядок не запоминается**, **личная статистика «что я уже использовал часто» не учитывается**. После 50-й сессии PM всё ещё пробегает глазами 8 кнопок, чтобы кликнуть в свою привычную «CEO-update».

Дополнительно: текст обрезается до 60 символов (line 171: `p.prompt.slice(0, 60) + '…'`) — то есть пользователь читает **«Подготовь повестку для груминга»** как «Подготовь повестку для гру…». Это видно в quick-prompts.

**Fix-direction.**
- Хранить top-3 «недавно использованных» из localStorage и пинить их сверху.
- Сокращать до 6 кнопок: 3 pinned + 3 contextual.
- Если текст не помещается — переносить на 2 строки (lower density), а не resize обрезкой. Это пилюля — в 60 chars не помещается ни один реальный полный запрос.
- «Все шаблоны» → отдельная dropdown/panel (как у ChatGPT Suggestions).

### S1-2. Send-prompt label несёт «↻ Спросить:» — слишком серый язык, но проблема не в этом

**Где:** `chat/chatUIRenderer.js:69-71`

```js
const label = atype === 'send_prompt'
  ? `<span class="chat-action-prefix">↻ Спросить:</span> ${esc(a.label)}`
  : esc(a.label);
```

Фикс L4 был обоснован security'ём (LLM не может замаскировать re-ask под «Применить»). Но визуально получается **двойной заголовок** в кнопке: «↻ Спросить:» + чьё-то длинное предложение. На action-row из 3 кнопок одна — «↻ Спросить: Какие задачи могут не успеть к своим дедлайнам?» — это не помещается, ломает layout. Дополнительно `↻` рядом с «Спросить» семантически путает (↻ = retry/refresh, не «отправить»).

**Fix-direction.**
- Заменить `↻ Спросить:` на маленькую серую chip-обёртку (`<span class="chip-prompt-source">prompt</span>`), без двоеточия.
- Длинные label'ы обрезать с tooltip'ом на полный текст.

### S1-3. Context-mode-label vs context-bar — две правды

**Где:** `index.html:1506` (`assistant-context-mode-label`) и `index.html:1550` + `app/llmAssistant.js:716-755` (`assistant-context-bar`)

`assistant-context-mode-label` показывает абстрактный режим («Контекст: текущий вид»). При клике циклически переключает между `currentView/fullRegistry/dashboard/none` через toast (`line 1142-1151`). Toast скрывается через 2 сек — нет визуального state'а, кроме надписи в шапке.

`assistant-context-bar` — внизу панели — показывает **конкретные** chip'ы (view=registry, team=PAY, +blockers). Это лучшая UX-фича чата.

Проблема: **они описывают одно и то же**, но с разной гранулярностью, и физически разнесены — пользователь не понимает связи. Если он переключит mode-label на «без контекста» — chip'ы в context-bar остаются прежними (потому что они описывают `state.filters`, не `settings.contextMode`). Это противоречие, которое читается как баг.

**Fix-direction.**
- Слить в один UI: context-bar внизу + при клике на bar (или на «AI видит:» label) разворачивается popover с режимом «что отправлять» (current view / dashboard / nothing).
- Если режим = `none`, chip'ы перечёркнуты или приглушены до 30% — визуально сразу видно, что bot ничего не получит.
- Слово «без контекста» канонизировать (см. microcopy-style-guide.md: «Под наблюдением», «Связь потеряна»). «без контекста» — нейтрально, ок.

### S1-4. Streaming-render всё ещё innerHTML на каждый rAF — потенциально джанк для длинных ответов

**Где:** `app/llmAssistant.js:1252-1276`

Patched (P1, P12 fix'ы) — мемоизирован markdown, флаг rAF. Хорошо. Но `bodyEl.innerHTML = ...` всё равно стирает выделение текста, ломает текущий focus, и (главное для UX) на длинных ответах с inline-citations (`cite-pill`, line 473-474 в chatUIRenderer) — каждый rAF переcоздаёт все DOM-узлы chip'ов. Если пользователь навёл на pill для hover-tooltip'а — он гаснет.

**Сценарий.** GigaChat выдаёт ответ длиной 1.5KB с 8 inline-PROJ-123 chip'ами. Пользователь хочет навести на чип на 4-й строке, пока стрим ещё идёт на 12-й строке. Hover ломается — каждые 16ms tooltip перезагружается.

**Fix-direction.**
- В streaming-режиме рендерить только **новый delta** в конец bubble (append, не replace). Это требует пере-архитектуры renderStructuredResponse — выделить «text-chunk» как отдельный mutable child.
- ChatGPT и Claude.ai делают это через DOM-diff (морфдом). У вас 44k LOC vanilla, без diff'ера — можно простым «приклеить delta как text node, при появлении JSON-блока перестроить только action-row».

### S1-5. Abort-семантика непрозрачна

**Где:** `app/llmAssistant.js:1597-1623` и `chatUIRenderer.js` (нет специального renderAborted)

Кнопка «Стоп» отменяет stream. Если контент уже частично пришёл, его суффикс становится `… [остановлено пользователем]` (line 1602-1603). Это хорошо. НО:

- Bubble остаётся с category-badge **«PRIZMA · АНАЛИЗИРУЕТ»** в caption (потому что `isStreaming=false` и `_categoryToCaption` возвращает caption). Сообщение помечено `aborted: true`, но визуально оно неотличимо от **успешного ответа**.
- Пользователь, открыв чат через час, не сможет понять, дочитан ли он или прерван.
- Нет UI «продолжить с того места».

**Fix-direction.**
- Aborted-сообщение получает свой визуальный стиль (как `assistant-msg-error` с stripe-left, но другого цвета — neutral-gray, не red).
- Caption переписан в «PRIZMA · ОСТАНОВЛЕНО».
- Action-row: «Продолжить» (re-send с suffix-prompt `… продолжи с того места, где остановилась`).

### S1-6. «Применить» в batch-preview — clickjacking-сосед к «Отмена», нет undo

**Где:** `chat/chatActions.js:148-160` + `applyPendingBatch` line 174-288

`buildBatchPreview` рисует две кнопки рядом: `Применить (N)` primary + `Отмена`. На моб./tablet и в плотном layout'е они сидят в 8px друг от друга — мискликов будет много.

После клика «Применить» — мутация необратима (через `applyBulkAction` или fallback Reactive.silent + Storage.save). В Toast есть текст «Курс скорректирован — N задач», но **нет «Отменить» / undo**, в отличие от `clearConversation` (там undo есть, line 1396-1404).

Это критично, потому что batch может тронуть 50+ задач — пользователь хочет 6-секундное окно отката, как у Gmail и у вас в чат-clear.

**Fix-direction.**
- В Toast после `applyPendingBatch` дать `undoLabel: 'Отменить'` с 6-8 сек. Реализация: запомнить `beforeState` (которые уже считаются, line 213-224) в snapshot и применить обратно при undo.
- Кнопки `Применить` и `Отмена` визуально разнести: primary + ghost, расстояние ≥16px, или вообще `Отмена` в drilldown-row.

### S1-7. Cite-pill «галлюцинация» — UI есть, но юзер не знает, что это значит

**Где:** `chat/chatUIRenderer.js:435-455`

Hallucination guard — отличная фича. `cite-pill-invalid` получает `title="Не найден в текущем реестре — возможно галлюцинация модели"` и alert-triangle icon. Но это **только tooltip** — на touch не увидеть, на узком layout пропадает. И слова «галлюцинация модели» в title — это очень технический язык для PM'а.

**Fix-direction.**
- Делать invalid-pill зачёркнутым с красной полоской (visual default), tooltip — для деталей.
- Title переписать: «Не найдено в реестре — проверьте ключ задачи».
- Добавить «Проверить» action: клик → поиск в Реестре.

### S1-8. Tone-of-voice lint выключен по умолчанию (`warn-only`)

**Где:** `chat/toneOfVoiceLint.js:50` + `tone-of-voice.md:13`

> Default — `warn-only`: текст не модифицируется, только лог в `console.debug`.

То есть **в проде эмодзи в ответе GigaChat НЕ удаляются**. Учитывая, что GigaChat-2 любит вставлять 🚀, 🔥, ✅ — это нарушение `spine-pill.md` (no-emoji policy). Пользователь видит фирменный «брендовый» интерфейс без эмодзи, и внутри bubble — emoji. Когнитивный диссонанс.

R3 (Курс сверен overuse) — тоже warn-only. Бренд-слоган девальвируется.

**Fix-direction.**
- Default = `on`. R1 (emoji) стрипить всегда в production UI. Если в dev — toggle через q2_chat_debug.
- Для R3-R5 — оставлять warn-only, но повторно ловить в evals на ranking промптов.

---

## Medium (S2) — накопленное неудобство

### S2-1. Drilldown-row внизу ответа не визуально слабее, чем actions

`chat/chatUIRenderer.js:97-104` — drilldown рендерит кнопки `.chat-drilldown-btn` со словом «Уточнить:» перед ними. В плотном action-row три actions-button + три drilldown-button — это **6 кнопок-конкурентов** под одним сообщением. Юзер не знает, во что кликнуть первым.

Решение: drilldown — это **mini-chips**, не buttons. Уменьшить вес (border:none; bg:transparent), оставить text + chevron-right.

### S2-2. Review-mode (CEO/DM/Risk/Lead) — мощная идея с неочевидным entry-point

`<select id="chat-review-mode-select">` в шапке (`index.html:1512-1518`). Это **выпадушка** — на тач это лишний тап + лишний скролл; на десктопе её перекрывает FAB при минимизации. Дополнительно: выбор role'и **отправляет prompt автоматически** (line 1130-1138) — пользователь не успевает дописать контекст.

**Fix-direction.**
- Review-mode → row chip'ов (CEO / DM / Risk Officer / Team Lead) под empty-state как «попробуйте режим обзора». При клике prompt подставляется в input, фокус на input, ждём **ручного** «Отправить».
- В шапке оставить compact badge только для **активного** режима, кликом — выйти. Не select.

### S2-3. «Контекст: текущий вид» — кликаемая надпись без affordance

`index.html:1506` — `<div class="assistant-subtitle-clickable" id="..." title="Нажмите чтобы сменить режим контекста">`. Underline есть в css (надеюсь), но в общем плотном layout'е читается как label. Tooltip спасает на десктопе, но это accessibility-flag («click affordance not visible»).

Fix: добавить chevron-icon (`▾`) рядом, чтобы это явно был toggle.

### S2-4. Token-budget trim — невидим, ломает доверие к «memory»

`app/llmAssistant.js:322-341` — trim'ит apiHistory до 3000 токенов, **молча**. Пользователь после 15 сообщений вдруг получает ответ без памяти о шаге 3. UI не сигналит, что «история была обрезана».

**Fix-direction.**
- Если `trimApiHistory` действительно срезал → пометить в footer ассистент-сообщения: «история сжата (старше N сообщений не передаётся)».
- На сессии 20+ сообщений — баннер «Память чата заполнена — старые сообщения не передаются модели. Открыть новую беседу?».

### S2-5. Rate-limit error — message без CTA

`app/llmAssistant.js:573-586` — rate-limit сообщает «Слишком часто, подожди 2с — повторная отправка разрешена через 2 секунд.». **Грамматика странная** («подожди 2с» + duplicate «через 2 секунд»), на «ты», и нет action'а «дождаться» (например, disabled-кнопка с countdown'ом).

**Fix-direction.**
- Текст: «Подождите 2 секунды. Можно отправить с {time:hh:mm:ss}.» (или countdown в кнопке).
- Кнопка Отправить — disabled с inline countdown, не отдельная toast. ChatGPT и Linear делают exactly это.

### S2-6. История очистки чата сильно проигрывает clearConversation

В `LLMAssistant.clearConversation` (`line 1381-1410`) есть полноценный **undo 6 секунд** через toast.

Но `applyPendingBatch` (мутация state.rows) — undo НЕТ (см. S1-6).

Также: «Новый» (clear) на длинной истории — пользователь после reload видит чат после ringbuffer truncation: первые сообщения пропали. Indication «обрезано после 50 сообщений» отсутствует.

### S2-7. Maskot per-message complete-phase — too much «жизни»

`renderStructuredResponse` дает каждому ассистент-сообщению маленький per-message аватар (`line 185-187`). При rerender — `hydrate'нём ` маскотов (line 1297). На 30-сообщенной истории — 30 SVG'шек, у каждой `obs--breathe`. CPU-cost после P5-фикса терпимый, но **визуальный шум** остаётся: 30 «думающих кристаллов» — внимание расфокусируется.

medium-3.3 fix (line 184) уже задает `ls-streaming` только последнему — это хорошо. Но `breathe` для остальных всё равно тянет глаза. ChatGPT/Claude.ai используют **статичный** иконобокс для не-стримящихся сообщений.

**Fix-direction.**
- За пределами streaming-сообщения — заморозить маскот в neutral-state (один кадр, не анимация). У `ObsidianMascot.setMessageAvatarPhase` это уже есть в `error` / `complete` — нужно дополнить `idle = freeze frame`.

### S2-8. «Применить (N)» в response action не сообщает, ЧТО конкретно

`chat/chatEngine.js:579-580` — `label: 'Применить (${pending.rowIds?.length})'`. Бот сделал preview-batch, юзер видит preview-text + кнопку «Применить (12)». Если пользователь скроллил, текст ушёл наверх → видна только кнопка → клик → 12 задач изменены, юзер уже забыл, что именно.

**Fix-direction.**
- На button — двухстрочно: «Применить (12)» + caption «assign_release → 1.22».
- Перед мутацией — **summary modal**: «Будет: 12 задач → 1.22. Команды: A, B, C. [Применить] [Отмена]». Это destructive bulk action — modal-confirm обязателен для UX-safety.

### S2-9. CONFIRM_BATCH через текст «да» / «применить» — magic words

`chat/chatIntentParser.js:223-228`

```js
patterns: [
  /^(да|применить|подтвердить|ок|ok|apply|confirm|выполни|запусти)[\s!.]*$/i,
  /^применить$|^да$|^подтвердить$/i,
],
```

Юзер написал «применить ну ка» — не подойдёт (там «\s+» в конце нужно). Юзер написал «давай» — НЕ подойдёт. Юзер написал «да!!» — подойдёт. Это спрятанный паттерн, не описан в empty-state и нет hint'а «можно ответить «да» для подтверждения».

**Fix-direction.**
- В preview-batch добавить hint под текст: «Подтвердить кликом «Применить» или напишите «да»». Это сделает паттерн viable.
- Поддержать ещё «давай», «ага», «погнали», «ok», «yes». Сейчас «давай» не работает.

---

## Low

- **L1.** `prizmaEmptyGlyph()` дёргается из `app/prizmaUI.js` (не читала, имя ок). Empty-glyph + caps-caption — это decorative. Если в Reduce Motion браузер выключает анимации — glyph остаётся статичный кадр. Хорошо. Но caption «ПРИЗМА СЛУШАЕТ» статичен и единствен — было бы человечнее иногда чередовать («ПРИЗМА ГОТОВА К РАЗГОВОРУ», «ПРИЗМА ЖДЁТ»).
- **L2.** `assistant-payload-status` (line 1554, `chat/chatUIRenderer` не использует, обновляется через `setPayloadStatus`) показывает «rule-based · мгновенно» или «План · payload ~12KB». Это полезное мета, **но `12KB`** — для PM-а абстрактно. Лучше «12KB / 150KB лимит» или «6% от лимита». Прогресс-бар миниатюрный.
- **L3.** Quick-prompts collapse — состояние `q2_quick_prompts_collapsed` сохраняется (line 1185). Хорошо. Но иконка `chevron-down` не меняется на `chevron-right` при свёрнутости — `aria-expanded` синхронизируется (`line 1192-1193`), а визуально chevron статичен. Минорный а11y несоответствие.
- **L4.** В `renderError` (`chatUIRenderer.js:287-303`) сама error-bubble использует rotate-cw icon (`alert-triangle`). На белом фоне без stripe-left этот icon в bubble может быть незаметен. Спасает класс `assistant-msg-error` (видимо stripe-left в CSS). Если в CSS не реализован — слепое пятно.
- **L5.** `_userInitials` (`chatUIRenderer.js:233-244`) умеет ФИО, ок. Но fallback «Я» — для пользователя без `state.currentUser` это нормально, для empty-onboarding отображения — не появляется (это user-message-only).
- **L6.** Insert context button (`#assistant-btn-insert-context`, line 1162-1168 in llmAssistant) — вставляет JSON в input. Полезно для power-юзеров, но для PM'а — пугающий поток текста. Можно либо скрыть за debug-флагом (как `payload`), либо сделать «свернуть/развернуть» — вставить compact summary.
- **L7.** `clearConversation` undo (line 1396-1404) — хорошо, но toast position зависит от Toast service'а. Если toast рисуется в правом-верхнем углу, а чат-панель в правом-нижнем — могут визуально перекрываться или потеряться.
- **L8.** `localStorage.q2_chat_debug='1'` — раскрывает `payload` button + verbose logs (line 887-892, 487-498). Хорошо для саппорта, **но никакого UI hint'а нет**: «debug mode active». Если поддержка попросила пользователя включить — потом её забывают выключить, и в общих скриншотах payload показан.

---

## Conversation flow — раскадровка

### Шаг 1. Empty-state (первое открытие чата)

**Что юзер видит:** Glyph + «ПРИЗМА СЛУШАЕТ» + три брендовых хинта + три инженерных bullet'а + 8 quick-prompts кнопок над всем этим. В шапке — «PRIZMA · ПОМОЩНИК», select «Режим», 3 кнопки, контекст-label.

**Что плохо:**
- Жёсткое нагромождение: caps-eyebrow, title, subtitle, 4 кнопки, quick-prompts toggle, 8 кнопок prompt'ов, glyph, caption, hint, ul. **14+ UI-объектов в первом взгляде.**
- Глаз не знает, куда лечь. Привычка с ChatGPT — input внизу + чистое поле сверху — здесь нарушена.
- Бренд-слова в hint'ах требуют объяснения.

**Что хорошо:**
- `assistant-context-bar` ниже сообщений — если он показан и информативен, это сильный trust-signal.
- aria-log + aria-busy — отлично для screen-reader'а (V21 §3).
- Focus-trap + inert (line 866-882, 907-922) — выше middle-tier qualified design.

### Шаг 2. First prompt — клик по quick-prompt «Сводку по проекту»

**Pipeline:** click → `sendFromInput(contextOverride)` → rate-limit check (ok) → `state.llm.history.push(user, assistant)` → render thinking-bubble → `chatProcess` определяет `EXECUTIVE_SUMMARY` → rule-based → `buildExecutiveSummaryResponse` → `onRuleBased` → render с category «analysis» + caption «PRIZMA · АНАЛИЗИРУЕТ».

**Что плохо:**
1. Thinking-bubble мелькнул на 50ms (rule-based — sync), пользователь увидел вспышку.
2. Ответ выглядит как LLM-ответ (caption, category, маскот) — но это rule-based. Юзер думает: «бот умеет анализ». Следующий вопрос будет open-ended.
3. Карточек 5 — все скучные («Team X: 12 задач · 4 сделано · 0 блокеров»). Нет hover, нет click-to-drill.

**Что хорошо:**
- `actions: [{ type: 'apply_filter', payload: {onlyBlocking: true} }]` — это правильный path. Кликом юзер попадает в Реестр с фильтром. Очень хорошо.
- `drilldown: [{text: 'Показать блокеры', prompt: ...}]` — есть.

### Шаг 3. Open-ended follow-up — «А почему у PAY 4 блокера?»

**Pipeline:** Это не rule-based pattern → confidence низкий → fallback в LLM (line 721-727) → `buildPromptParts(GENERIC, ..., text)` → `parseIntentCategory` находит «explain» → `getPrompt('explain')` → system + user → `callGigaChatStream` → SSE → `_scheduleStreamRender` каждый frame.

**Что плохо:**
1. **Долгое thinking** (4-8 сек на GigaChat-2 без warm-up) — пользователь видит маскот, ничего больше.
2. Первый токен прилетел — маскот переключился на streaming, в bubble появилась пустая каретка (`<span class="msg-caret">`). **Пока текста нет**, каретка одна — это «мигание в пустоте», семантически неясно.
3. Стрим идёт. Если пользователь успел проскроллить вверх — `_updateNewMsgPill` появляется (хорошо, line 1307-1334).
4. JSON-блок прилетел последним → cards/actions/drilldown пересчитываются в самом конце. Юзер видит, как ответ «перетряхивается» — text был, потом вдруг под ним появились card'ы.

**Fix-direction.**
- Каретку показывать только после первого токена.
- JSON-блок прилетает в конце? Можно либо парсить агрессивнее (на каждом rAF в `parseStructuredFromLLM`), либо показать loader «оформляю карточки» до прилёта JSON. Сейчас visible jump приходит резко.
- Маскот → дополнить text-skeleton (3-4 строки серых ровных).

### Шаг 4. Error (network drop / 401)

Token истёк. SSE прерывается на середине. `parseStreamResponse` throw'ает. `catch` ставит `assistantMsg.isError=true`, обновляет content «Не удалось получить ответ…» + heuristic-hint «проверь API-токен в настройках». Если есть `serverHint` — добавляет через `cause.hint`. Если auth → `structured.actions.push({ type:'open_settings' })` + setError rich CTA.

**Что плохо:**
1. Если стрим успел выдать половину ответа, а потом drop — половина сохраняется (это правильно), но в нижней части bubble — **исчезает streaming-caret**, и НИЧЕГО не указывает что обрыв. Пока пользователь не доскроллит до конца, он не увидит error-bubble.
2. Если retry (line 1109-1116) — попытка перезапустить тот же prompt. Если первый раз упало с 401 и юзер не открыл settings → retry упадёт снова с тем же 401. UI не запрещает retry до фикса.
3. CTA-блок (asst-error-rich, line 1357-1369) расположен **под** messages, не в самой error-bubble. Юзер скроллит вниз, читает error-text «токен истёк», и нужно ещё поискать кнопку. На моб это серьёзно — она вне viewport'а часто.

**Fix-direction.**
- Втянуть CTA-кнопку «Открыть настройки» в саму error-bubble (через `structured.actions`, уже есть инфраструктура).
- На обрыве посреди стрима — appendить в bubble inline-notice «связь потеряна, попытка прервана» + retry рядом.
- При retry — проверять, что юзер изменил token/settings; если нет, predict-block: «Повторить с теми же настройками? Возможно, ошибка повторится.»

### Шаг 5. Long answer + scroll

Ответ 2KB. Юзер начал читать с третьей строки. Дочитал до 12-й. В этот момент пришёл ещё кусок. `nearBottom = false` (line 1273) → автоскролл не сработал. `_updateNewMsgPill` показал «↓ новые сообщения». Хорошо.

Юзер кликнул — `scrollTop = scrollHeight` → ушёл на дно — но **потерял место чтения**. Нет «вернуться к месту чтения».

Также: long-answer внутри bubble — нет `Copy` per-paragraph, нет «свернуть длинный list», нет «прочитать в widescreen» (открыть как article).

**Fix-direction.**
- Copy per code-block — добавить кнопочки на `<pre><code>`.
- Длинные list (>10 items) → collapsible.
- «Открыть в полном размере» — кнопка в шапке bubble.

### Шаг 6. Многосекундное ничего → юзер закрывает чат

`document.addEventListener('mousedown', ...)` (line 977-998) — outside-click закрывает чат, **но не во время streaming**: `if (state.llm?.isStreaming) return;`. Очень хорошо.

Но: после успешного завершения streaming юзер случайно кликнул на Реестр — чат закрывается, состояние panel.hidden. Если потом откроет — увидит чат **до** последнего ответа? Нет, история сохраняется через `_saveDebounced`. Но если debounce 800ms ещё не сработал — да, последний ответ может быть потерян после reload. На production-сети редко, но возможно.

---

## Trust & verification

Это центральная тема для PM/EM, которым нужно reportить вверх по цепочке. Если бот сказал «у PAY 4 блокера», юзер должен иметь возможность за 1-2 клика убедиться, что это правда.

### Что работает

1. **`assistant-context-bar`** (line 712-755) — chip'ы «AI видит: view=registry, team=PAY». Это лучшая trust-фича. Юзер видит, что данные ушли = state.filters. 5/5.
2. **`cite-pill` chips** (line 473-474 chatUIRenderer) — Jira-style ID завёрнуты в `<span class="cite-pill" data-cite="PROJ-123">`. С `_validateCitationsInHtml` (line 435-455) — `cite-pill-invalid` для несуществующих. 4/5. Не хватает: click-to-navigate в Реестр на этот ID.
3. **`setPayloadStatus`** (line 1422-1425) — «План · payload ~12KB» в footer. Существует, но мелкое.
4. **`_safeRowForLLM`** (line 188-202) — PII-scrub (email, phone, SNILS, passport). Пользователь не знает об этом — но это правильно (не на каждое сообщение писать «безопасно»). 5/5.
5. **`computeHealthScore` + explainMetric** (chatExplain.js) — pure rule-based объяснения, видно формулу. 4/5.

### Чего не хватает

1. **Source-of-truth pin.** Когда бот говорит «4 блокера у PAY», нет ссылки «эти 4 задачи». Решается так: каждое утверждение с числом → ссылка-pill в Реестр с pre-applied filter. Сейчас этот pattern есть в action'ах («Только блокеры»), но не inline.
2. **Confidence level.** GigaChat ничего не возвращает про uncertainty. Можно эмулировать: если в payload было `_truncated:true` (line 232-243 в chatPrompts.js, line 247-273 в llmAssistant) → показать badge «частичные данные».
3. **Source attribution.** Где-то ответ построен на summary, где-то на полном registry, где-то rule-based. Сейчас footer `setPayloadStatus` единственный сигнал — мало, разнесён, не сохраняется при view-render.
4. **Activity bot — там 4-стр system prompt с правилами (chatActivityPrompts.js:25-36): «опирайся только на данные», «не выдумывай», «отсутствие активности в источниках ≠ отсутствие работы»**. Это идеально. Но в обычном chat'е (chatPrompts.js DEFAULT_PROMPTS) — анти-инжекшн вписан жирно, а **анти-галлюцинация — слабо** («НЕ выдумывай задачи и поля, которых нет в контексте» — да, но только для search/explain). Для general — нет.

### Risk: hallucination в анализе

Сценарий. Пользователь: «Какие риски у team PAY?». GigaChat-2 на 6KB context может «приукрасить» — добавить риски, которых в `riskFlags` нет, или предложить блокеры, не указанные в `blockingDependency`. Pure-text response, цитаций нет → ответ выглядит уверенно. Юзер скопировал в свой weekly report → начальник спрашивает «откуда» → юзер ищет → не находит. Через 2 недели чат-боту перестают доверять.

**Mitigations, которые сейчас есть:**
- cite-pill validation — частично (только PROJ-XXXX, не имена команд, не сроки).
- few-shot examples (line 41-71) — хорошо, особенно `FEW_SHOT_EXPLAIN` указывает на конкретные ID.
- `ANTI_INJECT` (chatPrompts.js:33-35) — про инструкции, не про факты.

**Что нужно добавить:**
- В DEFAULT_PROMPTS.analysis / explain / planning — добавить **обязательное правило цитации**: «Каждое число/имя сопровождай ID задачи или командой в скобках».
- Post-process: чекать, есть ли в ответе число, не подкреплённое cite-pill'ом → warn-pill «без подтверждения». Это уровень V22+, но реалистично.

---

## Killer features / новые идеи

Чего не хватает по сравнению с ChatGPT / Claude.ai / Linear AI / Cursor:

### 1. Edit-and-resend last user message

ChatGPT и Claude.ai: hover на user-message → «Edit». Меняешь текст → старый assistant-reply убирается, новый стримится. Здесь — нельзя. Можно только написать новый message. После 10 уточнений тред засорён.

Реализация низкая: на каждом `msg-row-user` иконка-карандаш → input.value = msg.content → удалить пару (user+assistant) из history → `sendFromInput`.

### 2. Regenerate response

ChatGPT: «Regenerate» под последним assistant-bubble. Здесь — есть `msg-retry-btn` только для error-bubble. Для успешного — нет. Иногда хочется «то же, но иначе».

### 3. Branching / fork

Claude.ai: edit user-msg → создаётся новая ветка. Можно сравнить два варианта ответа на тот же вопрос.

Для PM это критично: «У меня есть два сценария — план A и план Б». Сейчас юзер копирует диалог, открывает Settings → New conversation, теряет первую ветку.

### 4. Slash-commands в input

Linear AI: `/issue`, `/cycle`, `/team`. Cursor: `@file`. Здесь quick-prompts есть, но они visible во весь час. Slash-меню в input было бы compact'нее:
- `/release 1.21` → автокомплит → enter
- `/team PAY blockers`
- `/explain healthScore`
- `/snapshot` → take snapshot
- `/new` → clear conversation

Это снимает нагрузку с quick-prompts (можно сократить до 3 pinned), даёт power-юзерам keyboard-driven workflow.

### 5. Inline data card on hover/click

Когда в ответе упоминается PROJ-123 (`cite-pill`) — на click внутри bubble показывается мини-карточка задачи (epic, team, scope, assignee, blockers). Это устраняет «приходится переключаться в Реестр и обратно».

Бэкенд готов — `state.rows` доступен синхронно, по id найти.

### 6. «Pin» сообщения

Длинный тред, важный ответ № 5 («сводка релиза 1.22») — хочется его сохранить наверху. Linear, Slack: pin. Здесь — копируем в Notion. Pin-block в шапке чата с pinned-message preview.

### 7. Voice input для empty-state

Не для PMов, но для EMов на встречах. «Микрофон → говорю, бот пишет prompt». GigaChat-speech есть как сервис в экосистеме — интеграция не дальняя.

### 8. «Дай мне 3 версии плана»

Sytem prompt у planning уже это говорит (chatPrompts.js:218-237, «conservative / balanced / aggressive»). Но в UI нет визуального разделения 3 вариантов: всё одним мегабубом. Card-grid с 3 columns под planning-ответом сделал бы это сильно более consumable.

### 9. «Объясни» в виде tooltip-hover

Caption «PRIZMA · АНАЛИЗИРУЕТ» — никаких action'ов. Hover на caption → tooltip «Этот ответ построен по category 'analysis' на основе summary-payload, 23 строки данных». Trust-усиление за 0 кликов.

### 10. Streaming-progress hint

ChatGPT, Claude.ai после ~1 сек показывают «Думает над ответом…», «Анализирует данные…», «Пишет код…». Это **fake** state-messages, но человеку легче ждать. Здесь — только маскот. Можно генерить по category: «PRIZMA анализирует данные…», «PRIZMA сверяет курс…». Семантически связано с captionToCaption, можно переиспользовать.

---

## Что бы я сделала первой

### №1. Перепаковать empty-state в первичный «контракт»

Ничего не работает без чёткой ментальной модели. На той же неделе:

- 3 example-card'а с **реальным** prompt'ом и **скриншот-превью** ответа (statically rendered HTML — не дёшево, но один раз).
- Убрать инженерный жаргон («payload pre-scrubbed»).
- Добавить «warm-up CTA»: одна большая кнопка «Сводку по проекту» → клик → instant ответ. Юзер чувствует, что бот работает за 1 сек.
- Caption переформулировать в действие: не «ПРИЗМА СЛУШАЕТ» (passive), а «СПРОСИТЕ ЛЮБОЙ ВОПРОС ПО ДАННЫМ» — это инструкция, не лозунг.

**Impact:** drop-off в первые 30 сек упадёт. Для внутреннего инструмента это самое важное метрик.

### №2. Привести streaming feedback в порядок

Параллельно к №1:

- 3 точки в thinking ВКЛЮЧИТЬ (или skeleton-bar).
- Long-thinking hint показывать через **5-7 сек**, не 15.
- Catch-22 на streaming-render через innerHTML: текстовый delta — appendChild text node, JSON-блок — отдельный pre-render слот.
- Streaming-progress hint per category («PRIZMA анализирует данные…»).
- Aborted-сообщение получает свой visual + «Продолжить» action.

**Impact:** ощущение «zaмерло» уходит. Trust в систему растёт линейно с количеством удачных стримов.

### №3. Слить context-mode + context-bar в один объект и привязать его к payload-status

- Убрать `assistant-context-mode-label` из шапки (subtitle).
- В `assistant-context-bar` (бывшем chips-bar внизу) добавить mode-selector через popover.
- На каждом ответе — footer с числовой ссылкой на payload («23 строки данных, ~12KB / 150KB лимит»). Кликабельно — показывает что именно ушло.
- Inline-цитации (`cite-pill`) кликабельны → опен в Реестре с пред-фильтром.

**Impact:** в корпоративной среде (Сбер) trust-сигналы решают всё. Когда PM может в любой момент сказать «бот сказал X, потому что увидел Y», ChatGPT-фобия снимается.

---

> **Финальная заметка.** Чат уже сильно подрезан 5 итерациями аудита (V15..V22). Это видно по комментам в коде — каждый class-name несёт по 2-3 audit-метки. Самое опасное на этом этапе — попасть в local minimum: каждая мелочь точечно зачищена, но **первый опыт пользователя** всё ещё «технологичный продукт, разговаривающий на брендовом жаргоне». Брендбук и tone-of-voice — отличные, но они должны звучать **в фоне** (в caption'ах, в успешных формулировках), а не в первичных hint'ах, где пользователь учится говорить с системой.
>
> — Лидия Жукова, 2026-05-15
