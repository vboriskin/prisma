# Naveen Selvadurai — Cross-cutting product audit

> Меня зовут Naveen. Foursquare я строил с нуля до 50M юзеров, продавал в 2014; в Expa был product partner у Garrett'а на 18 ранних SaaS. С 2019 — advisor для 10+ внутренних B2B-tools. Моя оптика: я не «дизайнер фич», я смотрю как **феномен «продукта-целиком»** возникает (или не возникает) поверх отдельных вкладок. На Foursquare мы 18 месяцев имели «Check-in» и «Explore» как два разных приложения в одном бинарнике — пока не поняли, что real moat был в **их пересечении**, а не в каждом отдельно.
>
> Здесь я смотрел три вкладки Призмы — **Гант**, **Сканнер команд 2.0**, **Чатбот** — не каждую саму по себе (этим занимаются другие эксперты в этой папке), а **между ними**: как пользователь переходит, как состояние «телепортируется», какие данные шарятся, где compound-эффект случается, где упущен. Прочитал ~7k LOC ключевых файлов + state-контракты + roadmap V22+/V23. Это отчёт.

---

## TL;DR

1. **Это не один продукт. Это три почти-независимых приложения, пришитых через единый `state.js`.** Гант живёт в Реестре (`state.rows`, эпики, релизы 1.20/1.21/1.22). Сканнер — в Jira-pulse (`TeamScanner2._model.participants`, issueKey, sprint, BB/CF). Чатбот — в обоих, но via shallow projection (`buildExecutiveSummaryContext`). У них **разный domain-vocabulary** (epic-в-Реестре ≠ issue-в-Сканнере), разный identity-слой (Реестр — фио + assignee text, Сканнер — email+jiraAccountId+bbLogin), и они **почти не знают друг про друга**.

2. **Focus-context (`state.meta.focus`) — лучший задел в коде, но он не используется из продукта.** `app/focusManager.js` есть, `Focus.set/get/back/forward` есть, EventBus-мост `'focus-changed' → TeamScanner2.applyFocus` есть (`app.js:699-707`) — но **ни одна production-секция Focus.set не вызывает**. Production-call-сайты: 0 (grep подтверждает: только tests/unit/focus-manager.test.js). Это shovel-ready инфраструктура, которая не подключена ни к чему. **Это самая дешёвая в мире победа** — 4-6 часов работы открывает 80% «утра тимлида».

3. **Чатбот — не meta-навигатор, а одиночная кнопка «Реестр + фильтр».** Все `actions[]` из `chat/chatEngine.js` ведут только в `registry` или `gantt`. `Сканнер_QUERY` intent **читает** из Сканнера (`chatContextBuilder.js:213`), но **не возвращает в него** через action-chip («Открыть Сканнер на Иванове»). Это асимметрия, которая режет 60% compound value.

4. **Deep-link Router (V21 `app/router.js`) — отличная инфраструктура, но whitelist обрывается у границы Сканнера и Ганта.** `SAFE_FILTER_KEYS` — это только `state.filters` Реестра. Sharable URL в формате `#scanner2/employee/иванов и.и.` существует параллельно (`integrations/teamScanner2.js:678-705`), но **через другой механизм** (location.hash напрямую, не через Router). Два роутера, два формата hash. Гант share-link'ов вообще не имеет.

5. **Roadmap V22+/V23 (Hygiene + Cross-team Benchmarks) — distraction, а не вектор.** Обе фичи — ещё одна подвкладка Сканнера. Они НЕ решают «как 3 вкладки склеиваются». Если выкатить их без работы над cross-tab glue — продукт ещё больше будет ощущаться как «папка с инструментами», а не как «продукт». Я бы их отложил на квартал и положил все силы в Focus + chat-as-meta-navigator + symmetric deep-links.

---

## Что я увидел в продукте — гештальт

Если закрыть глаза и описать Призму одним предложением, получится: **«внутренний Jira с кастомным реестром эпиков, ганттом по релизам, отдельным HR-экраном для тимлида и кнопкой ассистента в углу»**. Это четыре разных «бренда» под одной крышей, каждый со своей логикой:

| Вкладка | Главный объект | Identity | Время | Где живёт state | Кто рендерит |
|---|---|---|---|---|---|
| Гант | `Row` (Реестр-эпик) | `assignee` (text) | релизные окна (`hasRelease120/121/122/overtime`) — `state.js:31` (GANTT_RELEASE_WINDOWS) | `state.rows`, `state.epicDeps`, `state.planLocked` (`state.js:32-37`) | `views/gantt.js` 2924 LOC |
| Сканнер 2.0 | `Participant` (Jira-человек) | email + jiraAccountId + bbLogin (`CLAUDE.md` contract #2) | sprint / 24ч / 7d / 30d | `TeamScanner2._model` in-memory (`integrations/teamScanner2.js:199`) + `localStorage snapshot:HASH` (`teamScanner2.js:11-15`) | `integrations/teamScanner2.js` 3640 LOC + 5 renderer-файлов |
| Чатбот | `Message` + `Intent` + `pendingBatch` | — (без понятия чей контекст) | таймлайн apiHistory + token-budget | `state.llm` (settings, history, pendingBatch) | `chat/*.js` (16 файлов) + `app/llmAssistant.js` 1706 LOC |

Между этими тремя — **четыре связующих контура**, и каждый сделан на разном уровне зрелости:

1. **Reactive proxy** (`reactiveStore.js:140-148`) — единое «что-то изменилось» — работает идеально, но это auto-flush для persistence, **не** product-level glue.
2. **Legacy named-bus** (`state.js:218-248`, `subscribe/notify('chat_filter')`) — phased-out, но всё ещё работает; есть double-notification риск (документировано в `state.js:236`).
3. **EventBus** (`app/eventBus.js`) — современный модерн-event-bus, **минимум подписчиков**: только `focus-changed`, `notification-added`, `flags-changed`, `permission-denied`. Никаких событий `epic-clicked`, `participant-clicked`, `release-hovered`. Это **слабая связь**, не сильная.
4. **Focus context** (`app/focusManager.js`) — **отличная идея, ноль production-call-сайтов**. Об этом отдельный блок.

**Гештальт:** инфраструктура есть, **продукт не построен**. Это очень частый паттерн в B2B internal tools: команда тратит 70% энергии на то, чтобы внутри каждой вкладки было хорошо, и 5% — на пересечения. Compound-эффект ожидаемый — в районе нуля. Призма сейчас в этой точке.

---

## Compound value — упущенные пересечения

Здесь я перечисляю места, где **Гант × Сканнер × Чатбот вместе могли бы давать больше суммы**, и где этого не происходит. Каждая строка — конкретный сценарий, конкретный file:line того что **есть**, и место отсутствия того что **нет**.

### 1. Эпик в Ганте → люди, которые над ним работают «прямо сейчас»

**Сценарий:** руководитель видит в Ганте эпик 1.21 «Платёжный шлюз v2», команда «Альфа», pill — «BE/QA в работе». Естественный вопрос: «кто конкретно из людей этим занимается сегодня, и есть ли у них блокеры?»

**Что есть:**
- В Ганте контекстное меню на эпике (`views/gantt.js:2399-2474`) — ctx-menu с действиями на самом эпике.
- В Сканнере есть `participants[].projects[]` (`chat/chatContextBuilder.js:236-238`) — Сканнер знает кто работает над каким PK.
- В Сканнере есть participant `applyFocus({kind:'employee', id:'email'})` (`integrations/teamScanner2.js:714-736`) — может развернуть человека.

**Чего нет:**
- В ctx-menu Ганта **нет** пункта «Кто работает над этим эпиком сейчас → Сканнер». Меню рендерит только Gantt-local actions (`views/gantt.js` рендерит menuitem'ы для drag/copy/lock — не для cross-tab).
- В Сканнере НЕТ `applyFocus({kind:'epic', id:'EPIC-key'})` — есть только для `employee`. `FocusManager.VALID_KINDS` (`app/focusManager.js:58-60`) включает `'epic'`, но Сканнер реагирует только на `employee` (`teamScanner2.js:715`).
- В Гант-row нет Jira-key — только `r.epic` (text). Чтобы связать эпик с issueKey в Сканнере, нужен mapping слой, и его нет.

**Compound effect упущен:** примерно 1 минута на каждый вопрос «кто конкретно». В день у тимлида таких вопросов — 5-10.

### 2. Сотрудник в Сканнере → его эпики и релизы

**Обратный сценарий:** в Сканнере «Иванов И.И. → 12 issues, 3 blockers, 60% velocity вчера». Естественный вопрос: «а в каком эпике он сидит, и не сорвёт ли он мне 1.21?»

**Что есть:**
- В Сканнере на participant.rows есть expand → `renderEmployeeDetailPanel` (`integrations/teamScanner2.js:91`) с blockers / stale / doneYesterday.
- В Реестре есть `assignee` field — текстовое.
- В Ганте есть фильтр по `assignee` (`state.filters.assignee`).

**Чего нет:**
- В expand-панели сотрудника **нет** chip-link «→ Гант: эпики Иванова в 1.21» (с pre-set фильтра + Nav.goTo('gantt')).
- В Ганте нет режима «highlight rows where assignee includes X» — есть фильтр (полный hide), нет hover-highlight (`views/gantt.js` filter logic).
- Identity-проблема: Сканнер знает Иванова как `email='ii@sber.ru'`, Реестр знает как `assignee='Иванов И.И.'` или `'Иванов'` или пусто. Нет identity-resolver UI-уровня (V20 S4 есть для backend, но не для cross-tab).

**Compound effect упущен:** это самый натуральный hand-off в продукте. Сейчас он требует «откройте Реестр, в фильтре assignee введите Иванов» — 6 действий.

### 3. Блокер в Сканнере → блокирующая задача в Реестре/Ганте

**Сценарий:** в Сканнере «Петров: 3 блокера, dwellHours=72». Естественный вопрос: «что это за блокеры, входят ли они в скоуп 1.20, нужно ли откладывать?»

**Что есть:**
- Sканнер хранит блокеры как `participant.blockers[].{issueKey, blockerKey, dwellHours}` (`chat/chatContextBuilder.js:268`).
- В Реестре есть `r.blockingDependency` (bool) + `r.blockingDeadline` (`rowFactory.js:21`).
- В Ганте `blockingDependency` отрисовывается как warn-индикатор (см. также `riskEngine.js`).
- В чате есть `INTENTS.WHAT_RISKS` (`chat/chatContextBuilder.js:131-139`) который собирает блокеры **только из Реестра** (`r.blockingDependency`), **не из Сканнера**.

**Чего нет — критично:**
- **Два независимых понятия «блокер»** живут в одном продукте:
  - Реестр-blocker: `r.blockingDependency === true` — manual flag на эпике, без Jira-link.
  - Сканнер-blocker: real Jira issue-blocker-link с dwellHours.
- Нет map между ними. Тимлид смотрит и думает «у нас 7 блокеров (Реестр) или 23 (Сканнер)?». Это **противоречивый health score**.
- Chat `WHAT_RISKS` intent не объединяет два источника.

**Compound effect:** негативный. Сейчас это активно путает — два числа в одном инструменте без объяснения разницы.

### 4. Чатбот не открывает Сканнер / не открывает конкретный эпик в Ганте

**Сценарий:** в чате «Покажи мне Иванова». LLM возвращает данные. Естественное продолжение: chip-button «→ Открыть Сканнер на Иванове».

**Что есть:**
- `chat/chatActions.js:434-454` диспетчер action-type'ов — поддерживает `navigate`, `apply_filter`, `clear_filters`, `preview_release`, `confirm_batch`, `set_review_mode`, `take_snapshot`, `open_settings`. **Не поддерживает** `set_focus` или `open_scanner_employee`.
- `handlePreviewRelease(payload)` (`chatActions.js:333-340`) — единственный пример «открыть Гант + предустановить mode». Это **прототип** для cross-tab handoff'а.
- `buildScannerQueryContext` (`chatContextBuilder.js:213-286`) умеет вытащить targetPerson из Сканнера для контекста LLM.

**Чего нет:**
- Action-chip'а `{type:'open_scanner', payload:{employeeEmail:'...'}}` нет.
- Action-chip'а `{type:'open_gantt_epic', payload:{epicKey:'...'}}` нет.
- Action-chip'а `{type:'set_focus', payload:{kind:'employee', id:'...'}}` нет.

**Это самое нелепое упущение в продукте**, потому что: (а) Focus уже существует и работает, (б) Сканнер уже умеет `applyFocus(employee)`, (в) чат уже умеет parse `SCANNER_QUERY` и читает Сканнер. **Не хватает одной строки** в `executeAction` switch'е и одной строки в response-builder'е `buildScannerQueryResponse` (которого, кстати, тоже нет — для SCANNER_QUERY есть только context-builder, response собирается через generic LLM-path в `chatEngine.process`).

### 5. Гант не имеет квик-кнопки «Спросить ассистента про этот эпик»

**Сценарий:** руководитель смотрит эпик «Перенос на 1.22 / 50% готов». Хочет: «спроси LLM что мне с этим делать».

**Что есть:**
- `app/llmAssistant.js:862` — FAB глобальный.
- В Реестре по hover на row отображается ctx (но cross-grep'ом ни Гант, ни Сканнер не зовут `LLMAssistant.openWithPrompt`/`prefill` — таких API вообще нет).

**Чего нет:**
- API `LLMAssistant.askAbout({kind:'epic', id, prefillPrompt})` не существует.
- В Ганте на pill / в ctx-menu нет «✦ Спросить помощника» (или icon-button, согласно §1 audit-experts/08-chatbot.md без эмодзи).
- В Сканнере на participant.row нет «✦ Спросить про этого человека».

**Compound effect:** chat сейчас работает в режиме «общий пульт». Чтобы спросить LLM о конкретном объекте, юзер копирует контекст руками («у Иванова 3 блокера, почему он сорвал 1.20?»). Это работает, но мимо product-level potential — chat должен ловить контекст hand'ом из текущей вкладки + selected object, без копи-паста.

### 6. Sharable share-link только из Сканнера, и только для employee

**Что есть:**
- Router (`app/router.js`) — отличная инфра для `#section?filter=X` deep-link'а **только для Реестра** (whitelist `SAFE_FILTER_KEYS` — `team, sprint, done, scope, assignee, release, priority, role, workType, tag, search, onlyBlocking, onlyRisky, onlyDone` — `router.js:55-58`).
- Параллельно: `integrations/teamScanner2.js:678-705` — собственный hash-роутер `#scanner2/employee/<key>` (V18.3 A4, pilot-finding Максим).

**Чего нет:**
- В Ганте share-link'а на эпик/строку нет вообще. `#gantt?team=X` сработает (через Router) но НЕ откроет конкретный эпик / pill.
- Чат не share-link'абелен. Открыл интересный диалог — не отправишь коллеге URL.
- Никакой согласованности формата: `#registry?team=X` vs `#scanner2/employee/иванов и.и.`. Два формата (`?key=val` vs `/key/val`) — два mental-model'a у разработчиков.

**Compound effect упущен:** «отправь мне ссылку на это» — главная асинхронная коммуникация в Slack/почте. Сейчас работает только если ты делишься Реестром.

### 7. Permissions / featureFlags не дифференцированы по вкладке

`state.meta.permissions` — глобальные булевы (`state.js:88-94`): canBulkEdit, canExport, canMarkDone, canEditEmployees. Нет per-tab прав («лид Альфы видит Сканнер только для Альфы»). Это не критично сегодня, но мешает product-level rollout новых вкладок (нельзя выпустить Hygiene только для PMs).

---

## Mental model coherence

Здесь — **самая болезненная** часть аудита. У трёх вкладок **разный domain language**, и это путает пользователя на каждом шагу.

### Эпик ≠ эпик

- **Реестр/Гант:** «эпик» = строка `state.rows[i]` с полями `r.epic` (текст-название), `r.tasks` (текст-краткое описание), `r.team`, `r.hasRelease120/121/122/overtime` (bool — попадает ли в окно), `r.assignee` (текст-исполнители через `|`). Это **не Jira-эпик**. Это «квартальный планируемый кусок» — внутренний контракт Призмы. См. `CLAUDE.md` § «Эпик в Реестре = строка с epic-name; «N задач у эпика» в Ганте = типы работ (BE/FE/QA), не sub-tasks».
- **Сканнер:** «эпик» = `epicKey` в Jira (`teamScanner2RendererInsights.js:182`, «Sub-task ratio — top epics с low completion ratio»). Это **Jira-эпик** (real key, проектный префикс). Используется в `subtasksByEpic` агрегатах (`teamScanner2RendererInsights.js:290-291`).
- **Чат:** имеет `r.epic` (Реестр) в context'е (`chatContextBuilder.js:84`) и НИЧЕГО про Сканнер-эпики (`buildScannerQueryContext` не упоминает epicKey).

**Эффект:** если пользователь спрашивает чат «какой эпик у Иванова?», LLM ответит из контекста Реестра — но **Иванов не появится в Реестре**, потому что Реестр agnostic к Jira identity. Получится мискоммуникация.

### Задача ≠ задача

- **Реестр/Гант:** «задача» = тип работы в эпике («BE: 5 задач»). Это **счётчик типов**, не Jira-tickets. `views/gantt.js:48` «N задач у эпика = типы работ (BE/FE/QA)».
- **Сканнер:** «задача» = Jira-issue (`issuesNow`, `stale`, `doneToday` — `chat/chatContextBuilder.js:247-251`).
- **Чат:** `_pl_task` плюрализатор используется и для одного, и для другого — без disambiguation (`chat/chatEngine.js:44`).

**Эффект:** «у Иванова 3 задачи в работе» в Сканнере и «у эпика Альфы 8 задач» в Ганте — это **разная единица**, отображаемая одинаково.

### Команда ≠ команда

- **Реестр/Гант:** `r.team` — текстовый label, набирается вручную в Реестре.
- **Сканнер:** «команда» = projectKey-фильтр + `loadTeamConfig` (`teamScanner2Config.js`), включает threshold'ы.
- **Employees view (`views/employees.js`):** ещё одно понятие команды.

**Эффект:** «Альфа» в Ганте и «Альфа» в Сканнере **могут не совпадать** (textual match vs config-driven). Никакой identity-проверки нет.

### Релиз ≠ релиз

- **Реестр/Гант:** релиз = окно 1.20/1.21/1.22/Овертайм/Бэклог (`GANTT_RELEASE_WINDOWS`, `state.js:31`). 3 квартальные релизные точки + два «складских» состояния.
- **Сканнер:** «релиз» = Jira `fixVersion` (`teamScanner2RendererInsights.js:185`, «Fix-version coverage — release readiness прогресс»). Это **общий Jira-механизм**, не привязанный к 1.20/1.21/1.22.
- **Чат:** mapping явный (`chat/chatEngine.js:47-50`, `relLabel: r120 → '1.20'`), но **только** для Реестра-релизов.

**Эффект:** если в Jira кто-то заведёт fix-version `1.21.5`, Сканнер её покажет, но Реестр про неё не знает. Health-score между «in scope by 1.21» (Реестр) и «fix-version=1.21 in Jira» (Сканнер) расходится — никто не объясняет почему.

### Блокер ≠ блокер

См. Compound #3 выше — самый болезненный пример. Цитата уже была.

### Score / health-метрика

В каждой вкладке есть свой health-индикатор и **они не сходятся**:
- Чат: `computeHealthScore` (`chat/chatAlerts.js` экспортит, метрики на основе Реестра — блокеры, риски, % готового — `chat/index.js:55-59`).
- Сканнер: `sprintGauge` (`renderTopBar` — sprint-progress %, sprint-goal slope `computeSprintGoalSlope`).
- Гант: визуальные signal'ы (`PHASE_COLOR_TOKENS`, off-course pill, см. `views/gantt.js:135` «overload-bar остаётся signal-цветом (off-course красный)»).
- Hygiene engine (V23): `score = 100 - sum(weight × violations)` (`integrations/jiraHygiene.js:30`).

**Каждая вкладка показывает свой 0-100 score, и пользователь видит 4 несогласованных числа.** Это **классический симптом** silo-продукта.

### Что я бы сделал

Нужен **shared domain glossary, прописанный в коде и в UI**. У вас уже есть `docs/domain-glossary.md` — но его недостаточно: концепты «эпик/задача/блокер/команда/релиз/score» должны иметь **single typed contract** и UI-микрокопию, которая везде одинакова. Сейчас у chat plural «задачи», у Сканнера «issues», у Ганта «pills» — три тона, три словаря.

---

## Cross-tab navigation gaps

| Сценарий | Есть? | Где | Что не так |
|---|---|---|---|
| Deep-link на Реестр с фильтром | ✓ | `app/router.js:55-58` | работает |
| Deep-link на Гант с фильтром | ✓ | то же | работает, но не открывает конкретный эпик |
| Deep-link на Сканнер employee | ✓ | `integrations/teamScanner2.js:678` | **другой формат hash**, своя реализация — не через Router |
| Deep-link на Сканнер team | ✗ | — | нет |
| Deep-link на Сканнер подвкладку (Сегодня / Глубже / Метрики / Гигиена) | ✗ | — | tab выбирается через DOM-state |
| Deep-link на чат / на конкретное сообщение / на pendingBatch | ✗ | — | вообще нет; перезагрузил — потерял диалог |
| Anchor-jump внутри Ганта (к команде) | ✓ | `views/gantt.js:287-310` (B4 scroll anchor) | работает, но только при re-render |
| Cross-tab navigation с сохранением «фокуса» (Реестр→Гант сохраняет filters) | ~ | через Router | работает только если фильтры в whitelist'е |
| Cross-tab navigation Реестр→Сканнер с identity-handoff | ✗ | — | нет |
| Context-handoff Гант→Чат («спроси про этот эпик») | ✗ | — | нет |
| Context-handoff Сканнер→Чат («спроси про этого человека») | ✗ | — | нет, хотя `SCANNER_QUERY` intent уже умеет это в обратную сторону |
| Cmd+[ / Cmd+] back-forward navigation | ✓ | `app/focusManager.js:286` (Focus.bindHotkeys) | работает **только** для focus-history, в которую никто не пишет |
| Browser back-button (history.pushState) | ✗ | — | Router использует `replaceState` (`router.js:259`); никакого history-stack'а нет → browser-back не возвращает на пред. вкладку |
| Share-link на конкретное состояние Ганта (zoom, режим, конкретный pill) | ✗ | — | нет |

**Главный gap:** Гант share-link'и беспомощны. Гант — главное визуальное представление плана, и его нельзя пошарить. «Посмотри этот эпик» → «откройте Гант → ищите глазами».

---

## AI как product-glue

Здесь мой главный contrarian thesis: **chat не должен быть «отдельной вкладкой в углу». Chat должен быть meta-навигатором по продукту.**

### Что чат уже делает (baseline)

- Понимает 20+ intent'ов (`chat/chatIntentParser.js`) включая `SCANNER_QUERY` — может **читать** контекст Сканнера.
- Может прыгнуть в Реестр с фильтром (`apply_filter` action — `chat/chatActions.js:297`).
- Может прыгнуть в Гант с пре-выбранным mode (`preview_release` — `chatActions.js:333`).
- Имеет режимы обзора (CEO / Risk / DM / Lead — `set_review_mode`).
- Может выполнить bulk-action на Реестре (`confirm_batch` — `chatActions.js:390-411`).
- Знает текущую активную вкладку (`activeTab: state.activeSection` — `chatContextBuilder.js:104`).
- Quick-prompts адаптируются по `state.activeSection` (`chat/chatTemplates.js:90-129`).

### Чего чат НЕ делает (и должен)

1. **Не открывает Сканнер на конкретном человеке.** Нет action-type `open_scanner_person` / `set_focus`. Самая простая fix: одна строчка в `executeAction` switch'е → `Focus.set({kind:'employee', id})`. Focus mostly уже сделает остальное (`EventBus.emit('focus-changed')` → `TeamScanner2.applyFocus` — `app.js:699-707`).
2. **Не открывает Гант на конкретном эпике.** Похожая ситуация — `Focus.set({kind:'epic', id})` есть в API (`VALID_KINDS` — `focusManager.js:58-60`), но Гант **не подписан** на `focus-changed` (только Scanner подписан в `app.js:701`).
3. **Не объединяет два источника блокеров.** Для intent'а `WHAT_RISKS` (`chatContextBuilder.js:131-139`) даже не пытается прочитать Сканнер. Должно: `topBlockers = mergeBy(epic, [...registry-blockers, ...scanner-blockers])` с явной маркировкой источника.
4. **Не суммаризирует cross-tab состояние.** «Открой Призму, расскажи что важное» — должен дать executive summary, в котором: (а) % готового по релизам (Реестр), (б) sprint-progress по командам (Сканнер), (в) топ-блокеры объединённые, (г) action-chip'ы в обе вкладки. Сейчас summary только из Реестра (`buildExecutiveSummaryContext` — `chatContextBuilder.js:98-105`).
5. **Не «обучается» от user-actions.** В Сканнере есть telemetry (`integrations/telemetry.js`), в чате есть `_telLLM('accepted', ...)` (`chatActions.js:437`). Но никто не агрегирует: «90% пользователей кликают action-chip "Только блокеры"» → должно влиять на drilldown[]. Это V23+ задача, но архитектура уже готова.
6. **Не имеет режима «watch this focus, ping me when changes».** Focus имеет history, но не имеет watcher'ов. Тимлид: «следи за Ивановым, пинуй меня если у него появится новый блокер» — невозможно.

### Что я бы сделал (приоритизированно)

1. **`set_focus` action-type** (1 час): добавить case в `chatActions.js:438-454` → `Focus.set(payload)`. Это унифицирует «открой X на Y» для всех trois.
2. **Симметричный SCANNER intent response с action-chip'ами** (3 часа): в `chat/chatEngine.js` добавить `buildScannerQueryResponse` который возвращает actions `[{type:'set_focus', payload:{kind:'employee', id:targetEmail}}]`.
3. **Подписка GanttView на focus-changed** (2 часа): в `app.js:699` добавить второй handler, в `views/gantt.js` — метод `applyFocus({kind:'epic', id})` который scroll'ит к эпику + highlight.
4. **«Открой Призму» dashboard-prompt** (4 часа): новый intent `OVERVIEW_ALL`, контекст-билдер который мержит Registry + Scanner данные.
5. **Watch-list для Focus** (V23): `state.meta.watchList = []`, NotifyCenter ping при изменениях.

---

## Product-level killer features (top 10)

Это фичи, которые **не имеют смысла без пересечения** всех трёх вкладок. Если их выпустить в Jira / Tableau / ChatGPT — они не работают, или работают плохо. **Это и есть moat Призмы**, если её строить как продукт.

### 1. «Морнинг-помощник» — single-glance briefing с действиями

> Тимлид заходит утром. На splash-экране: «**За ночь**: 3 новых блокера у Иванова (Сканнер), Альфа отстаёт от 1.21 на 2 дня (Гант), 5 эпиков "Требует подтверждения" в скоупе 1.21 (Реестр). Что сделать?» — три chip-action'а: «Сними блокеры», «Перенеси 2 эпика в 1.22», «Запроси подтверждение скоупа».

Сейчас: каждая часть видна **в отдельной вкладке**, никто не объединяет. У вас есть `chat/chatAlerts.js` (alert bar) и `state.notifications` (NotifyCenter, `state.js:72`) — это **обломки** killer-feature, но не сама фича. Нужен меган-intent + cross-tab data merge + adaptive chip-actions.

### 2. «Кто блокирует кого» — единая блокер-карта

Сейчас два понятия блокера (Реестр vs Сканнер) дают **противоречивые ответы**. Killer-фича: единая карта где `Иванов (Сканнер blocker → PROJ-123) blocks Эпик "Платёжный шлюз" (Реестр)`. Это **explicit join** Сканнер.participant.blockers ↔ Registry.rows by Jira-key.

Сегодня: `dependencyEngine.js` (212 LOC) делает эпик-эпик зависимости в Реестре. Сканнер-блокеры в это не интегрированы.

### 3. «Спросить про X из любого места» — universal LLM-ask

Кнопка «✦» (без эмодзи в проде, через `Icons.get('sparkle')`) на любом объекте: эпике в Ганте, человеке в Сканнере, blocker'е, релизе. По клику — чат открывается с pre-filled prompt'ом + `state.meta.focus` устанавливается. LLM получает full context.

Сегодня: нет. FAB — единственный access-point к чату.

### 4. Symmetric deep-link router — единый URL-format для всего

Один формат `#<section>?<filter>` для всех вкладок, включая Сканнер podtab + employee, Гант + конкретный эпик + zoom, Чат + history-id. Сейчас фрагментировано — Router отвечает за `state.filters`, Сканнер сам делает свой hash, Гант не делает ничего.

Killer use-case: «отправь Slack-ссылку коллеге на конкретный кусок состояния». Это **главная асинхронная коммуникация** в офисе. У Tableau это есть. У Jira это есть. У Призмы — частично.

### 5. «Ретроспектива одной командой» — replay

Killer-фича: тимлид открывает Гант на 1.20 + Сканнер на «месяц назад» + чат подаёт executive summary за тот период. Time-travel через все три вкладки одновременно. Используется для ретро.

Сегодня: Сканнер имеет `teamScanner2History.js` (multi-day snapshots — V19 C2). Гант не имеет time-travel. Чат имеет `apiHistory`, но он привязан к диалогу, не к state.

### 6. Watch-list / focus-subscriptions

Тимлид: «следи за Альфой + Ивановым + эпиком 1.21». NotifyCenter (уже есть, `state.notifications`) пингует при изменениях: новый блокер, новая регрессия в гигиене, sprint-goal drift. Из notification — клик ведёт обратно в Focus.

Сегодня: `state.meta.watchList` отсутствует. NotifyCenter показывает global events, не персонализирован.

### 7. «Перенос с обоснованием» — двусторонняя сверка

Сценарий: тимлид в Ганте перетаскивает эпик из 1.21 в 1.22. Сейчас открывается comment-required modal (V14 B4-B5 plan-lock — `state.js:35-37`). **Killer-extension**: автоматически — чат генерирует draft обоснования на основе Сканнер-данных («Иванов: 3 блокера за неделю, velocity -40% — основа для переноса»). Тимлид редактирует и подтверждает.

Сегодня: comment-modal требует ручного текста.

### 8. «Health-score одной командой» — explainable composite

Один общий health-score (0-100) на команду, **explainable** — раскрывается в drill-down: «65/100. -10 за 3 блокера (Сканнер), -8 за 5% задач без эпика (Hygiene), -7 за перенос 1.21 → 1.22 на 2 эпика (Гант), -5 за low sprint-goal alignment (Сканнер), -5 за 0% reopen-rate ниже benchmark (Benchmarks)». Click on row → focus.

Сегодня: четыре разных score'а в четырёх вкладках, без связи.

### 9. «Bulk-action со сверкой» — диалоговое подтверждение

Сегодня bulk-action работает (`chatActions.js:101-160`, `buildBatchPreview`). Killer-extension: **перед apply** показать в Сканнере, кто из людей пострадает (Иванов: 5 эпиков → 1.22 — это +20% его quarter-нагрузки), и в Ганте — как изменится shape релиза (1.22 переполнится).

Сегодня: bulk preview показывает только counts.

### 10. Onboarding-через-наблюдение

Новый тимлид: чат подсказывает «у Иванова есть свободные часы (Сканнер), у вас 3 эпика в Бэклоге требуют owner'а (Реестр), плотность 1.22 ещё низкая (Гант)». Это **product-level суггестия**, которая невозможна в каждой вкладке отдельно.

Сегодня: Onboarding (`app/onboarding.js`) — статический tour, без data-awareness.

---

## What's the moat

Сейчас, объективно, Призма vs Jira + Tableau + ChatGPT-в-соседней-вкладке:

| Признак | Jira | Tableau | ChatGPT | Призма |
|---|---|---|---|---|
| Реестр-таблица с custom-полями | ✓ (с натяжкой) | — | — | ✓ |
| Гант по квартальным окнам | плагин | — | — | ✓ |
| HR-pulse Сканнер | — | через датасет | — | ✓ |
| LLM с domain-context | — | — | ✓ | ~ |
| Identity-deterministic attribution Jira/BB/CF | — | — | — | ✓ (контракт #2) |
| Cross-tab focus context | — | partial | — | ✗ (есть API, не подключено) |
| Comment-required переносы / planLock | — | — | — | ✓ (V14) |
| Hygiene engine для Jira-данных | — | — | — | ✓ (V23) |
| Vanilla-JS без npm-supply-chain | corporate-friendly | enterprise | open | **✓ — moat** |

Что реально неотделимое от Призмы (moat):
- **Identity-deterministic attribution** между Jira / Bitbucket / Confluence. Это **самое сильное** в инструменте, потому что fuzzy-match — головная боль во всех соседних tools. См. `CLAUDE.md` contract #2.
- **Quarter-window planning ритуал** (1.20/1.21/1.22/Овертайм/Бэклог) — это **корпоративный ритуал Сбера**, ни у кого другого не повторяется. Гант под него заточен.
- **Vanilla-JS, no-build, single-server** — снаружи кажется недостатком, на самом деле **moat в enterprise** (нет supply-chain атак, нет CI-сложности, может работать на file://). Это не «фича», но это причина «почему не Jira-плагин».
- **Inline LLM с domain-vocabulary** (релизы 1.20/1.21, Sigma vs Delta Jira, scope=Требует подтверждения) — общий ChatGPT не знает.

Что нужно усилить чтобы стало неотделимо:
1. **Focus как контракт продукта** — везде, во всех вкладках. Сейчас это API без callers.
2. **Cross-tab join по identity** — Реестр-assignee ↔ Сканнер-email ↔ Jira-key. Имея identity-таблицу, это **legkij win**.
3. **Объединённая block-graph** (Реестр-эпики ↔ Сканнер-issues по Jira-key).
4. **Chat-as-meta-navigator** — а не «ассистент в углу».

Без этих четырёх Призма — **good multi-tool**. С ними — **integrated product** который заменяет Jira + Tableau + ChatGPT и **на котором сидят 4-8 часов в день**, потому что ходить никуда не нужно.

---

## Roadmap critique

**Что в V22+ / V23 (из `NIGHT_2026-05-11_SUMMARY.md`):**
- V23 **Jira Hygiene Engine** — новая подвкладка в Сканнере, 12 правил, score (`integrations/jiraHygiene.js`).
- **Cross-team Benchmarks** — новая под-подвкладка в «Сравнение команд» Сканнера.
- Telemetry-расширения (`telemetry.js`).
- UI-усовершенствования (EMA overlay, 5-color heatmap, etc).
- Demo-fixture (V21 π5).

### Это правильный вектор?

**Контр-мнение: нет.** Это **внутри-Сканнерные** улучшения. Каждая фича делает Сканнер лучше. Ни одна не **связывает Сканнер с Гантом или Чатом**.

Почему это плохо стратегически:
1. **Marginal value уже падает.** Сканнер — 3640 LOC orchestrator + 5 renderer-файлов (1365+1192 = 2557 LOC только для hero/insights). Каждая новая под-фича — +200-400 LOC при том же compound-эффекте (≈0).
2. **Product-level confusion растёт.** Hygiene-score и Benchmarks-score — это **ещё два числа** в продукте, который уже путает пользователя 4 разными score-метриками. Без работы над unified-health-score новые score только усугубят.
3. **Distraction от main moat.** Identity-deterministic attribution + cross-tab focus — это unique selling points. Они недо-вложены.
4. **«Killer feature» в Night-summary' — XL?** Я бы спорил. Hygiene — полезная feature, но **не moat**. SonarQube, Linear, JiraSenpai делают то же самое. Cross-team Benchmarks — interesting, но это аналитика, не product-glue.

### Что я бы изменил в roadmap

**V22 (вместо Hygiene):**
- F1. Production-call-сайты для `Focus.set` в Реестре, Ганте, Сканнере и Чате. 4 точки входа. ≤16 часов.
- F2. `executeAction` case `'set_focus'` + chip-actions для SCANNER_QUERY response. ≤8 часов.
- F3. GanttView.applyFocus({kind:'epic'}) — scroll + highlight + temp-style. ≤8 часов.
- F4. Объединённый router: `#scanner?employee=...` через Router whitelist. Удалить дубликат hash-логики из teamScanner2.js. ≤12 часов.

**V23 (вместо Cross-team Benchmarks):**
- F5. Unified health-score model. Engine-уровень merge всех 4 score'ов в один с explainable breakdown. ≤24 часа.
- F6. Cross-tab block-graph: Реестр-эпики ↔ Сканнер-Jira-issues by epicKey. ≤32 часа.
- F7. «Утренний briefing» — новый intent `OVERVIEW_ALL` + UI-блок над FAB / на dashboard. ≤24 часа.
- F8. Symmetric deep-link с history.pushState (browser-back работает). ≤12 часов.

**V24 (только после ↑):** Hygiene engine может прийти как **новая lens** на unified-health-score, не как отдельная вкладка. Benchmarks — как cross-team view внутри Сканнера, но с handoff'ом в Гант.

### Хорошие новости

Это **не разрушительный rewrite**. Все нужные блоки **уже есть**:
- Focus API — есть, не подключён.
- EventBus — есть.
- Router — есть, не симметричен.
- Identity contract (V17.2 I1c) — есть.
- ChatActions executor — есть.
- Telemetry — есть.

Нужен **4-6 недельный sprint cross-tab integration**, без новых модулей. Это самая дешёвая killer-feature, которая бывает.

---

## Что бы я сделал в первую очередь

Если бы у меня было 2 недели и one engineer:

### #1 — Focus.set everywhere (≤2 дня) — **самый high-leverage move**

Подключить `Focus.set()` в production:
- В `views/registry.js`: клик по row → `Focus.set({kind:'employee', id:r.assigneeEmail||r.assignee, source:'registry'})`.
- В `views/gantt.js`: клик по pill / row → `Focus.set({kind:'epic', id:r.epic, source:'gantt'})`.
- В `integrations/teamScanner2RendererPersonRows.js`: клик по participant → `Focus.set({kind:'employee', id:p.email||p.key, source:'scanner'})`.
- В `chat/chatActions.js`: добавить case `'set_focus'` в `executeAction` (`chatActions.js:438`).
- В `app.js:699`: расширить `focus-changed` handler чтобы Гант / Реестр / Employees тоже реагировали (сейчас только Сканнер + Employees).

**Эффект:** один общий контекст между вкладками. Cmd+[ / Cmd+] начнут работать. Маскот начнёт менять mood. Toast-chip «Контекст: Иванов · 7 дней» появится. Это **single product moment**, который сейчас отсутствует.

**Почему это #1:** ROI огромный. Из 4-6 часов работы получается **product feel** который сейчас не существует. Это самая дешёвая «win» в roadmap.

### #2 — Chat-as-meta-navigator (≤3 дня)

Конкретно:
1. Добавить `'set_focus'` action в `chatActions.js:executeAction` (`chatActions.js:438-454`).
2. Расширить `buildScannerQueryResponse` (отсутствует — добавить в `chatEngine.js`) — возвращать `actions: [{type:'set_focus', label:'Открыть Иванова в Сканнере', payload:{kind:'employee', id:...}}]`.
3. Добавить кнопку «Спросить ассистента» в Ганте (на эпик-row) и в Сканнере (на participant-expand) → `LLMAssistant.openWithPrompt({prompt:'Расскажи про эпик X', focus:{kind:'epic', id:'X'}})`. API `LLMAssistant.openWithPrompt` нужно создать (~20 LOC).
4. Расширить `buildExecutiveSummaryContext` (`chatContextBuilder.js:98`) — мержить blockers из Реестра + Сканнера, маркируя источник.

**Эффект:** чат перестаёт быть отдельной кнопкой и становится «продуктовым клеем». Каждая вкладка может его призвать с контекстом. Чат может вернуть пользователя обратно с фокусом.

**Почему #2:** второй-самый-high-leverage. Без него Focus останется fragmented.

### #3 — Unified deep-link router (≤2 дня)

1. Удалить custom hash-handler из `teamScanner2.js:678-705` (`_consumeShareLink`).
2. Расширить `SAFE_FILTER_KEYS` в `app/router.js:55-58` — добавить `scannerTab`, `scannerEmployee`, `scannerTeam`, `ganttEpic`, `ganttZoom`.
3. Format: `#scanner?tab=today&employee=ii@sber.ru&team=alpha&period=7d`.
4. Router → `Focus.set` если scanner+employee параметры есть (через `_applyHashToState`).
5. Использовать `history.pushState` вместо `replaceState` для navigate-action'ов → browser back-button работает.

**Эффект:** sharable URL на любое состояние продукта. Самый базовый «coffee-table-shareability». Существенно для async-команд (pilot finding Максим уже это подсветил — `teamScanner2.js:674`).

**Почему #3:** меньше user-feel impact чем #1/#2, но **необходимо** для async-коммуникации, которая для distributed-team Сбера — основной канал.

### Что я бы НЕ делал в этом квартале

- **Hygiene Engine V23.** Уже сделан (`integrations/jiraHygiene.js` 276 LOC + 380 LOC renderer). Не переделывать, но и не расширять до 24 правил. Оставить в beta под featureFlag, наблюдать.
- **Cross-team Benchmarks.** Та же история. Оставить как есть.
- **Любые новые вкладки.** 16 вкладок в sidebar (`index.html` data-section grep) — это **уже** перебор. Пользователь не запомнит, что куда. Сначала glue, потом expansion.

---

## Заключение

У вас отлично спроектированная **инфраструктура**: Reactive proxy, EventBus, Focus API, Router, Services. У вас есть глубокие, специализированные **вкладки** — Гант элегантно сделан, Сканнер — серьёзная HR-аналитика, Чат — продвинутый intent-based assistant с structured responses. Каждая по отдельности — **сильна**.

Что отсутствует — **продукт-уровень connective tissue**. Это редкая, но фиксируемая ошибка зрелых tools: когда команды настолько хорошо специализированы по вкладкам, что забывают про пользовательский путь между ними.

Хорошая новость: **вы в одном sprint'е от исправления.** Всё нужное есть в коде. Focus, EventBus, Router, action-system. Нужно только **подключить**.

Я бы пропустил весь V22/V23 cross-team-benchmarks и Hygiene-expansion в пользу **2-недельного focus-sprint'а с тремя приоритетами выше**. Это даст compound-effect, который весь предыдущий год не давал. И **сделает Призму product-ом**, а не workspace'ом с несколькими tabs.

— Naveen
