# AUDIT_MASCOT.md — Маскот «Обсидиан» в продукте Призма

> Этап 5 из 14. Команда: motion-дизайнер + продуктовый дизайнер + конверсионный аналитик.
> Дата: 2026-05-07. Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`.
> Брендбук: `my_prisma-brand/obsidian/MASCOT_OBSIDIAN.md` (245 строк).
> A11Y явно вынесено за скобки этого аудита (есть отдельный поток).
>
> Контекст: после V22 mascot-pass (mM1–mM10, MD-1..5, IxD-1..3, top4–top5) большая часть
> тира-стэкинга и эмерж-гардов закрыта. Этот аудит ищет **новые** или **не-закрытые**
> проблемы — преимущественно на стыках (toast-mascot не используется, hibernate
> не учитывает streaming, RICH_OBS_SVG не имеет всех node-hooks, per-message
> phase race и т.д.).

---

## 1. Карта компонентов

| Компонент | DOM-id / класс | Файл (рендер) | Состояния | Анимации | Триггеры | Тексты | Переход в чат | Аналитика |
|---|---|---|---|---|---|---|---|---|
| **FAB-маскот** | `#assistant-fab` > `#obsidian-fab-mascot.obs.assistant-fab-mascot` (144×144 wrapper, 112×112 mascot) | `index.html:1447–1451`, hydrate в `app/obsidianMascot.js:67` | breathe (default), emerge (T1, sessionStorage-guard), vanish (T1, hibernate prelude), hibernate (T1 loop), awaken (T2), curious (T2 loop on hover), alert (T2 once on stream-end-while-closed), concerned (T2 once on error-while-closed) | T1: emerge 2400ms / vanish 2800ms / hibernate 5000ms loop. T2: cur-body-fab 2200ms loop, alert 1200ms once, concerned 800ms once. T3: breathe 4500ms loop поверх T2 | splash inline-script (1800ms через DOMContentLoaded), `ObsidianMascot.init`, hover (`mouseenter/mouseleave` → `_wireFabHover`), idle 5min (`_wireIdleHibernate`), `pulseAlertOnFab()`, `pulseConcernedOnFab()` | нет (декоративный, `aria-hidden`) | click → toggle `#assistant-panel`, FAB hidden, `setChatPhase('idle')` для `#obsidian-chat-avatar` | `HistoryLog.event('obsidian.phase', { target, phase, durMs })` через `_logPhase` |
| **Chat header avatar** | `#obsidian-chat-avatar.obs.assistant-chat-avatar` (56×56) | `index.html:1459–1461`, hydrate в `init` | breathe, ls-thinking, ls-streaming, ls-complete (once→breathe), ls-stop (once→breathe), ls-error (once→breathe→concerned-alive), ls-tool (once→ls-streaming), ls-move | LS animations (1600–2800ms) | `setChatPhase(phase)` callsites в `app/llmAssistant.js:901,1357,1433,1445,1494,1535` | нет | находится прямо в чате | как FAB |
| **Per-message avatar** | `.msg-row[data-index] .msg-avatar.obs.obs--sm` (40×40) | `chat/chatUIRenderer.js:176–178,246–248,274–276` | breathe, ls-thinking, ls-streaming, ls-complete, ls-stop, ls-error | как Living Shape, через `obs--sm` overrides (mM6) | `setMessageAvatarPhase(idx, phase)` → `setChatPhase(phase, el)` (`obsidianMascot.js:484–489`); вызов из `llmAssistant.js:1560` | есть caption `PRIZMA · СВЕРЯЕТ КУРС` etc. через `_categoryToCaption` (chatUIRenderer.js:200) | в чате уже | `obsidian.phase` per-element |
| **Toast mascot** | `.toast.toast-with-mascot > .toast-mascot.obs.obs--sm` (40×40) | `app/uxKit.js:209–224` | concerned / alert / success / null | static + Tier-2 over breathe (через `obs--alive` стак) | `ToastQueue.show({ mascot:'concerned' })` — **API существует, но нигде не вызывается** | `toast-msg` + `toast-sub` (CAPS 9.5px) | нет | нет (toast'ы не логируются) |
| **Tour mascot** | `.ob-tour-mascot.obs.obs--sm` (44×44, position: absolute top:-50) | `onboarding/onboardingUI.js:198–209` | breathe (step 0), ls-move (step >0) → потом curious (через cb) | ls-move 4000ms once + curious 2200ms once | `_positionTourTooltip` каждые 50ms на step | нет, есть title/text шага | при последнем шаге `_endCeoTour()` | нет |
| **Splash → FAB handoff** | inline-script в `index.html:186–243` | inline | pending (opacity 0) → emerge → breathe + sessionStorage flag | emerge 2400ms (CSS keyframes via `obs--emerge` class) | DOMContentLoaded + 1800ms timeout | нет | FAB | через ObsidianMascot нет — splash сам ставит/снимает classes |
| **Welcome / empty-state** | нет (отдельный mascot-блок намеренно убран в V22) | `index.html:312` | — | использует `prizmaEmptyGlyph()` — 8-лучевая звезда, не маскот | нет | нет | нет | нет |

---

## 2. Поведение и триггеры

| Аспект | Текущее состояние |
|---|---|
| **Появление** | Splash inline-script: `setTimeout(1800ms)` после DOMContentLoaded → ставит `obs--emerge obs--once` на `#obsidian-fab-mascot`, через 4200ms → `obs--breathe`. Параллельно `ObsidianMascot.init` вызывается из `app.js:691` — он проверяет `splashActive` и `sessionStorage[q2_obsidian_emerged_v1]` чтобы не запустить второй Emerge. На повторных F5 sessionStorage очищается через `performance.navigation.type === 'reload'`. |
| **Исчезновение** | `setFabVisible(false)` ставит `.hidden` (display:flex !important + opacity:0). Если `obs--emerge` ещё крутится — guard очищает класс (M1). Полного `vanish` нет (только в hibernate path). |
| **Назойливость** | FAB всегда виден (z-index 100000). Размер 144×144 wrapper — **очень большой**: ~10% высоты экрана на 1280×800. Постоянное breathe `scale(1) → 1.04` каждые 4.5s + случайные T2 (alert/concerned) — может отвлекать в долгих рабочих сессиях. Управления для уменьшения нет. |
| **Память состояния** | `sessionStorage.q2_obsidian_emerged_v1` — single boolean, без TTL и версии. Hibernate-state хранится только в JS-памяти (`_isHibernating`). После reload Hibernate сбрасывается → 5min idle counter начинает отсчёт заново. |
| **Приоритеты** | T1 > T2/LS (interaction lock `_t1Active`). T3 ambient стакаются поверх. `pulseAlertOnFab` queue'ится во время Emerge. Но `pulseConcernedOnFab` НЕ имеет такого guard — может прерывать Emerge. |
| **Контекстность** | FAB не реагирует на смену секции (gantt/registry/dashboard) — поведение одинаковое везде. Per-message avatar phase зависит только от LLM-фазы, не от категории prompt'а (`category` идёт в caption, но не в анимацию). |
| **Лезет ли в критичные моменты** | Breathe не блокирует, но при `pulseAlertOnFab` (1200ms ring + body shake) поверх работы пользователя — может дёрнуть взгляд во время чтения отчёта. Concerned-pulse (800ms) аналогично. На критичных операциях (xlsx import, save) маскот в обычном breathe. |
| **Idle / Hibernate** | 5min таймер `_wireIdleHibernate` слушает `mousemove`/`keydown`/`pointerdown`/`visibilitychange`. На любое событие — reset. **Подвох:** `visibilitychange` срабатывает каждый раз когда юзер переключается между вкладками — counter перезапускается, Hibernate в реальной работе может никогда не сработать. Также reset не учитывает `obs--ls-streaming`/`ls-thinking`/`ls-tool` — теоретически может зайти hibernate во время чата. |
| **Multi-tab** | sessionStorage per-tab — каждая вкладка играет Emerge заново. Если у юзера 5 вкладок Призмы открыто, при F5 одной — там Emerge, в других маскоты в Breathe (нормально, но не синхронизировано). |

### Находки — поведение

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 2 поведение | `app/obsidianMascot.js:307` | high | `_wireIdleHibernate` слушает `visibilitychange` для reset — каждый tab-switch обнуляет idle-counter, Hibernate в реальном workflow не сработает (юзер часто Cmd+Tab'ит). §13.7 «idle 5+ мин → Hibernate» нерабочая. | Убрать `visibilitychange` из reset-events. Дополнительно: при `visibilitychange + document.hidden` — НЕ reset, при возврате (visible) — пушнуть `awaken` если был hibernate. | S |
| 2 поведение | `app/obsidianMascot.js:316` | high | `_enterHibernate` гард только на `obs--alert` и `_t1Active`, но не на `obs--ls-thinking/streaming/tool` и не на `state.llm.isStreaming`. Маскот может уснуть прямо во время стрима, если юзер 5min не двигает мышь (ждёт длинный ответ). | Расширить guard: `if (state.llm?.isStreaming) return;` + проверка classes `obs--ls-*`. | S |
| 2 поведение | `app/obsidianMascot.js:407` | medium | `pulseConcernedOnFab` НЕ имеет guard на `_t1Active`/queue (как у `pulseAlertOnFab`). Если ошибка чата прилетит во время splash Emerge — concerned начнётся поверх emerge → §13.9 «T1+T2 нельзя стакать». | Симметрично pulseAlertOnFab: guard `_t1Active` + `_concernedQueued` flag, отыграть после Emerge. | S |
| 2 поведение | `app/obsidianMascot.js:312–322` | medium | После `_enterHibernate` отсутствует таймер «как долго хибернейтит» — если Hibernate включился, маскот спит loop'ом, и при следующем `mousemove` сразу `_wakeFromHibernate` → awaken (1200ms) → сразу idle-counter снова на 5min. Нет никакой телеметрии «сколько спал». UX-метрика «глубокий idle» теряется. | В `_enterHibernate` сохранить `this._hibernateStartedAt = Date.now()`, в `_wakeFromHibernate` — `_logPhase('mascot', 'hibernate-end', Date.now() - start)`. | S |
| 2 поведение | `app/obsidianMascot.js:309` | low | `mousemove` ловится на `window` без throttle — на 144Hz mouse = 144 reset/sec, каждый clearTimeout+setTimeout. На noisy machines это шум в перфе. | Throttle 1000ms через `requestIdleCallback` или флаг `_idleResetThrottled`. | S |
| 2 поведение | `index.html:201–243` & `app/obsidianMascot.js:209–249` | medium | **Двойной владелец Emerge:** splash inline-script ставит `obs--emerge` на FAB, и `_playEmergeIfFirstSession` тоже умеет его ставить (защита через `splashActive` checks). Логика разнесена в 2-х местах, sessionStorage flag координирует — при изменении timing (новая длительность splash) можно получить race condition или 2 параллельных Emerge. | Унифицировать: splash просто ставит `data-fab-pending=1`, а Emerge всегда играет controller через `playEmergeOn(fab)`. Sessions storage и `splashActive` checks в одном месте. | M |
| 2 поведение | `app/obsidianMascot.js:317` & `app.js` | medium | `_isHibernating` хранится только в JS-памяти контроллера. На F5 / закрытии вкладки сбрасывается. Если юзер ушёл на 30min, вернулся на вкладку (без F5) — маскот ещё в hibernate (loop), но reset_idle на mousemove → wake. Фактически работает. Но если юзер прыгнул на F5 — Emerge снова, и состояние «давно offline / спал» теряется. Нет персистентного «давно отсутствовал». | `localStorage.q2_obsidian_last_active = Date.now()`, при init — если diff > 30min → `awaken` once вместо обычного breathe. Persistent welcome-back момент. | M |

---

## 3. Переход маскот → чатбот

| Аспект | Текущее состояние |
|---|---|
| Контекст текущего экрана | Чат сам собирает контекст через `app/llmAssistant.js` + `chat/chatContextBuilder.js`. Маскот не передаёт ничего. |
| Передача активного раздела | Нет — `category` для caption берётся из LLM-ответа (post-hoc), не из state. На FAB-click маскот просто скрывается и открывает panel. |
| Сохранение фазы | Если чат в `ls-streaming` и юзер закрыл panel (`assistant-btn-close`) — abortController убивает стрим, FAB возвращается `setFabVisible(true)` → `_setLoop('breathe')`. Если стрим **завершился сам** при закрытом чате — `pulseAlertOnFab` (1200ms once → breathe). Если ошибка — `pulseConcernedOnFab`. |
| Re-open после pulseAlert | Открыл chat → `setChatPhase('idle')` → breathe. Информация «была ошибка» теряется (только текст в bubble). |
| Hover на FAB → tooltip | Нет tooltip'а с прерогативой («Юра, спроси меня»). Curious-анимация — только тело наклоняется, без копирайта. |
| Quick-prompts | Видны в `assistant-quick-wrap` после открытия чата, никак не связаны с FAB-anim. |

### Находки — переход

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 3 переход | `app/llmAssistant.js:895–909` | high | При click на FAB — `setChatPhase('idle')` сразу. Если в backlog был `pulseAlertOnFab` (юзер закрыл чат, стрим докрутился, ring погас) — открытие чата **не подсвечивает** последнее сообщение. Юзер видит history, но не понимает что новое. | После открытия чата найти `state.llm.history.length-1` и play `obs--ls-complete` once на этом per-message avatar. Также scroll к этому сообщению. | S |
| 3 переход | `app/obsidianMascot.js:361–372` | medium | `setFabVisible(false)` ставит `.hidden`, но НЕ останавливает `_idleTimer`. Если юзер открыл чат и сидит читает 5+ min — таймер срабатывает, `_enterHibernate` запускает `obs--vanish` на скрытом FAB-маскоте (opacity:0). При закрытии чата FAB возвращается уже **в hibernate-loop**, что неожиданно. | В `setFabVisible(false)` — `clearTimeout(this._idleTimer); this._idleTimer = 0`. В `setFabVisible(true)` — reset idle counter. | S |
| 3 переход | `chat/chatUIRenderer.js:175,246` | medium | `phaseClass` для `.msg-avatar` ставится в HTML как `obs--ls-streaming` на ВСЕХ msg-row при streaming-update path (renderMessages full re-render). Каждое прошлое сообщение получает streaming animation в момент re-render. Hydration через `wrap.querySelectorAll('.msg-avatar').forEach(hydrate)` — массовая подгрузка rich SVG для 10–50 старых сообщений = mass DOM mutation jank. | `phaseClass = isStreaming && idx === lastIdx ? 'obs--ls-streaming' : 'obs--breathe'`. И hydrate вызывать только на `.msg-row:not([data-obs-hydrated])`. | S |
| 3 переход | `app/llmAssistant.js:1556–1561` | high | `setMessageAvatarPhase(lastIdx, phase)` после `renderMessages()` — но `renderStructuredResponse` ставит class `obs--breathe` (не error), а `setMessageAvatarPhase('error')` запускает `_playOnce(el, 'obs--ls-error', 'obs--breathe').then(() => add concerned+alive)`. Если юзер сразу пишет новое сообщение — `state.llm.history` push'нул новый assistantMsg, lastIdx сместился, а Promise.then всё ещё навешает `obs--concerned obs--alive` на **старый** index, что логически неправильно (concerned стоит на устаревшем сообщении после успешного нового ответа). | Сохранять `el` reference в Promise.then closure (не перевыбирать через querySelector с lastIdx); проверять `el.isConnected` перед add classes. | M |
| 3 переход | `chat/chatUIRenderer.js:170–171,176` | low | `<use href="#obs-base"/>` в HTML рендерится → потом hydrate перетирает на rich SVG. Между этими двумя кадрами (1–2 frame) маскот виден как basic SVG (без всех hooks). Микро-flash, особенно заметен в `renderError` где сразу `obs--breathe` (ОК) и `renderThinking` где `obs--ls-thinking` (нет hooks → нет анимации до hydrate). | Hydrate синхронно в `renderStructuredResponse` через `RICH_OBS_SVG` constant import (а не `<use>`). Или ставить `obs--ls-thinking` после hydrate явно через `setMessageAvatarPhase`. | S |

---

## 4. Визуализация (motion)

| Аспект | Текущее состояние |
|---|---|
| Состояния | 3 тира (T1: emerge/vanish/hibernate/awaken; T2: ack/cur/alert/success/surprised/settle/squint/wink/concerned; LS: thinking/streaming/complete/stop/error/tool/move). Stack T2+T3 / T2+LS через `obs--alive`. T1 эксклюзивен. |
| Производительность | CSS keyframes на `.obs-body`/`.obs-eye*`/`.obs-emit-*` — все через transform/opacity (compositor-friendly). Breathe loop infinite — постоянная композитная нагрузка на FAB (1 layer 144×144). На chat scroll с 50+ msg-avatar (40×40) каждый со своим breathe = 50 параллельных infinite анимаций. На low-end машинах может быть perf-debt. |
| `prefers-reduced-motion` | `obsidian.css:1083–1089` глобальный media-guard на `.obs *` + `.obs svg` + `_playOnce` early-return. ОК. Но: `_playOnce` resolved сразу синхронно — `setChatPhase('error')` `.then()` callback срабатывает в same tick → `obs--concerned obs--alive` ставятся даже в reduced-motion (а они анимированы и тоже глушатся, но class висит «впустую»). |
| Позиционирование FAB | `position: fixed`, bottom 20px, right 20px, 144×144. На 1280×720 — FAB занимает 11% высоты, угол 144+20=164px от края. Может перекрывать sticky-элементы (registry-bottom-bar, gantt-zoom). Нет collision-detection. |
| z-index | 100000 (поверх splash 99999, welcome 9000). Жёсткий single-value, без константы. Если в проекте появится модал > 100000 — конфликт. |
| Темы | `--obs-body` / `--obs-feature` через `[data-theme="light"]` block. `--obs-emerge-glow` отдельный токен (light=ink, dark=star). `_wireThemeTransition` инжектит `transition: fill 200ms` для smooth-перехода. ОК. |
| Размеры контекстов | FAB 144 wrapper / 112 mascot. Header 56. Per-message 40 (`obs--sm` амплитуда). Toast 40 (`obs--sm`). Tour 44 (`obs--sm`). Не все сценарии под `obs--sm` подходят: `obs--sm` усиливает `breathe`, `eye`, `bar`, `brow` для small (≤32px), но 40–44px попадают в зону между «small» и «default». |
| Анти-flash на theme-switch | `_wireThemeTransition` ставит `transition: fill 200ms` + исключения для bars/brows/emit/return/particle/socket/ring/blade/edges. ОК. Но: `transform: scale` (breathe) НЕ имеет transition → на theme-switch breathe-цикл может выглядеть ступенчато. Нет `transition: transform`. |

### Находки — визуализация

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 4 motion | `app/obsidianMascot.js:28–62` (RICH_OBS_SVG) vs `obsidian.css:121–140,408–419,442–459,497,672–710,721–723,1005–1009,354–357` | **critical** | **CSS таргетит несуществующие nodes в RICH_OBS_SVG:** `obs-lid`, `obs-lid-l`, `obs-lid-r` (Blink, Awaken, Settle, Wink, Hibernate); `obs-spark`, `obs-spark--2/3/4` (Success); `obs-aura`, `obs-inner-star` (Hibernate signature — звезда Призмы); `obs-edge-1`, `obs-edge-2`, `obs-edge-3` (ls-thinking edge-shimmer); `obs-body-x`, `obs-body-wave`, `obs-trail-1/2/3` (ls-move). Эти анимации **не воспроизводятся**. §13.6/13.7 не выполнен для Hibernate (нет звезды), Awaken/Settle/Wink (без век), Success (без искр), ls-thinking (только тело без edge-shimmer), ls-move в туре (без trail). | Добавить в `RICH_OBS_SVG` все недостающие узлы: 2 path для obs-lid-l/r, 4 circle для obs-spark--1..4, 1 circle для obs-aura, 1 polygon (8-лучевая звезда) для obs-inner-star, 3 line для obs-edge-1/2/3, 3 circle obs-trail-1/2/3, 1 g.obs-body-x для translateX-обёртки, 1 g.obs-body-wave для skew. | M |
| 4 motion | `app/uxKit.js:217–222` | high | Toast-mascot для `success` использует комбо `obs--breathe obs--success obs--alive`, но `obs--success` keyframes таргетят `.obs-spark` (которого в hydrated SVG нет) — анимация success видна только как body-bounce без искр. |  Связано с критическим выше — после фикса RICH_OBS_SVG hooks → success восстановится. | S (зависим от fix RICH_OBS_SVG) |
| 4 motion | `obsidian.css:1005–1019` | high | `.obs--ls-move .obs-body-x { animation: obs-ls-move-x 4000ms }` — `obs-body-x` это контейнер для translateX 0%→48%→0%. Если в SVG нет `<g class="obs-body-x">`, анимация не играет → tour-mascot стоит на месте, не «плывёт» → §13.7 «шаг онбординга → ls-move» не работает. | См. fix выше: добавить `<g class="obs-body-x"><g class="obs-body-wave"><g class="obs-body">…</g></g></g>` в RICH_OBS_SVG. | M |
| 4 motion | `obsidian.css:111–118` | medium | Breathe `transform-origin: 50% 50%` + scale на root `<svg>` + одновременно у `.obs-body` есть свой `transition: transform 200ms` (стр. 241). При смене hover→leave bridge mM4 inline-style на `.obs-body` и сразу breathe-анимация продолжается на svg-root. Двойной transform-origin / pivot — на 144px FAB видно лёгкий «дрейф» центра в момент leave. | Перенести breathe-scale на `.obs-breathe-root` обёртку или применить `transform-box: fill-box` явно. Альтернатива — задержать «return to breathe» на 220ms (после inline-bridge clear). | M |
| 4 motion | `obsidian.css:294–296` | medium | `.obs--alert .obs-bar-l/-r` две анимации одновременно: `obs-alert-bar-l 1200ms both, obs-alert-bar-pulse 1200ms infinite 1200ms` — `infinite` означает после 1200ms → начинается infinite pulse навечно. После `_playOnce` отыграется animationend на первом event (bar-l), `_clearExclusive` снимет `obs--alert`, но если какая-то 3rd-party CSS reset не пройдёт в тот же frame — pulse останется крутиться. Risky compound. | Заменить второй `infinite` на `1` или использовать explicit `obs-alert-bar-pulse 1200ms both 1200ms, obs-alert-bar-pulse 1200ms both 2400ms` с 2-мя repeats. После 1200ms+repeat — bars исчезают через `_clearExclusive`. | S |
| 4 motion | `styles.css:5455–5464` | medium | `.msg-avatar` 40×40 + `.obs--sm` обработка — но `obs--sm` keyframes overrides только для **breathe** и **emit-1..4** (small variants). Остальные state'ы (alert, concerned, ls-streaming-body) на 40px НЕ масштабированы. Concerned-brows на 40px — `stroke-width: 2.0` (`obs--sm`), `d="M -14 -10 L -5 -8"` — 9 SVG-units length / 120 viewBox * 40px = 3px. Реально читается, но без bold. | Добавить `obs--md` size-class (33–48px) и проводить `eye r=2.1`, `breathe scale 1.05`, `bar height 2.0`. Обновить `.msg-avatar`/`.toast-mascot`/`.ob-tour-mascot` чтобы класс совпадал с реальным DPR. | M |
| 4 motion | `styles.css:4686–4710` | high | FAB размером 144×144 wrapper + 112×112 mascot → **очень большой**: на FullHD 1920×1080 — 13.4% высоты. Брендбук §13.12 chec-лист: «Размер маскота больше или равен 24px» — это о минимуме, не о максимуме. На 1366×768 (типичный корпоративный ноутбук) FAB занимает ~19% высоты экрана и тяжёлый bottom-right якорь. | Уменьшить до 96×96 wrapper / 80×80 mascot для `min-width: 1280px`, оставить 144 только для очень больших экранов (≥1920). Или — настройка размера в `App.settings`. | S |
| 4 motion | `styles.css:4708`, `obsidian.css:670` | low | `z-index: 100000` для FAB — magic number. В styles.css есть `.modal-overlay` z=10000, splash z=99999. Жёсткие константы. Если появится debug-overlay с большим z — FAB закроется. | Объявить `--z-mascot: 100000` в theme.css, использовать var(). | XS |
| 4 motion | `obsidian.css:1083–1089` | medium | `prefers-reduced-motion` глушит ВСЁ внутри `.obs *` и `.obs svg` через `animation: none !important`. Но `obs--alive::after` (стр. 1044) — pseudo-element без animation, остаётся. Mid-state: тело замёрзло, но `::after` эффект (если будет добавлен) висит. В текущей реализации `::after` без анимации ничего не делает, но это grown gap — если кто-то добавит ambient в `::after`, забудет про reduced-motion. | Расширить guard: `.obs *, .obs::before, .obs::after, .obs svg { animation: none !important }`. | XS |
| 4 motion | `app/obsidianMascot.js:113–145` | medium | `_playOnce` Promise resolves в reduced-motion **синхронно** (`return Promise.resolve()`). Callsites вроде `setChatPhase('error')` ожидают что `.then(() => addClass('concerned alive'))` вызовется ПОСЛЕ animation. В reduced-motion это вызывается в same tick → concerned ставится мгновенно (не критично, но не «выраженный момент»). | В reduced-motion для error / move / tool — не вызывать `.then()` chain (или сделать chain короче, без post-emotion). В `_playOnce` reduced-path — возвращать Promise который уже resolved с `_reducedMotion: true` flag, callsite пропускает. | S |
| 4 motion | `obsidian/obsidian-sprite.svg:1–229` vs `app/obsidianMascot.js:28–62` | medium | **Sprite vs RICH_OBS_SVG дублирование** — sprite имеет 11 symbols (`#obs-base`, `#obs-shell`, `#obs-base-h`, `#obs-favicon`, `#obs-resting`, `#obs-alert`, `#obs-concerned`, `#obs-L0/L2/L3/L4`), RICH_OBS_SVG в JS имеет полный hydrated layout. Когда HTML использует `<use href="#obs-base"/>`, потом hydrate перетирает на inline. Получаются 2 источника правды, и `<use>`-версия (sprite) НЕ имеет obs-spark/obs-aura/obs-inner-star тоже — для каких-то контекстов где hydrate не вызвался — visual bugs. Также `<symbol id="obs-base">` в sprite имеет obs-trail-1/2/3, а RICH_OBS_SVG — нет. | Single source of truth: либо sprite полный (+lid/spark/aura/star/edge1-3/body-x/wave), либо отказаться от sprite и всегда rich-hydrate. Рекомендую второе — все mascot-DOM hydrate'ить через `playEmergeOn(el)` или прямо `hydrate(el)`. | M |
| 4 motion | `obsidian.css:241` | low | `.obs-body { transition: transform 200ms var(--obs-ease-out, ease-out); }` — глобально на все `.obs-body`. Но animation overrides transition пока играет. На completion одной T2 → animation отгорает → transition подхватывает next-state, но для T2 которая ставит final-state через `animation-fill-mode: both` (`obs--once`) — transition не нужен. На больших FAB visible jitter в момент handoff. | Сузить: `.obs:not(.obs--once) .obs-body` или `.obs--cur .obs-body { transition: transform 200ms; }` только для curious. | S |

---

## 5. Подсказки как контент

| Аспект | Текущее состояние |
|---|---|
| Хранение | `_categoryToCaption(category)` хардкод switch в `chat/chatUIRenderer.js:200` — 7 категорий, нет externalized строк |
| Копирайтинг | «PRIZMA · СВЕРЯЕТ КУРС / ИЩЕТ КУРС / ОБЪЯСНЯЕТ / ПОДТВЕРЖДАЕТ / АНАЛИЗИРУЕТ / ОТЧЁТ». Только русский, captsLock-стиль |
| Персонализация | Нет — captions одинаковые для всех ролей (CEO / DM / Risk / Lead) |
| Шум vs полезность | Caption под каждым ассистентским bubble (при non-streaming) — даёт бренд-DNA, но повторяется на каждом сообщении подряд: 10 ответов «АНАЛИЗИРУЕТ» → визуальный шум |
| Toast subText | `subText` в `ToastQueue.show({ subText: 'СОЕДИНЕНИЕ · ПОВТОР ЧЕРЕЗ 5 СЕК' })` — API есть, callsites нет |
| Tour text | Свободный текст в `step.title` + `step.text` в `onboarding/`, без бренд-каптов |

### Находки — подсказки

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 5 подсказки | `chat/chatUIRenderer.js:200–211` | medium | `_categoryToCaption` switch с хардкод-русским текстом и без default-fallback (`return null` → пустой caption). Если LLM вернёт `category: 'unknown'` или новую категорию — caption тихо исчезнет. Также «general» и «planning» дают одинаковый «СВЕРЯЕТ КУРС» — нет дифференциации. | Externalize в `chat/chatTemplates.js` как объект `CATEGORY_CAPTIONS`. Default — `'PRIZMA · ОТВЕЧАЕТ'`. Добавить категорию `metric` / `kpi` для AI блоков. | S |
| 5 подсказки | `chat/chatUIRenderer.js:185` | low | Caption повторяется под КАЖДЫМ assistant-bubble (`!isStreaming && caption`). 10 одинаковых ответов = 10× «АНАЛИЗИРУЕТ» столбиком. Когнитивный шум. | Показывать caption только когда `idx === lastIdx` ИЛИ когда `category` отличается от предыдущего assistant-message. | S |
| 5 подсказки | `app/uxKit.js:201,225` | high | API `subText` принимается, но **в проекте нет ни одного callsite** который его передаёт. `errorsLog.js:76` `showToast(...)` использует legacy строковую сигнатуру без mascot/subText. UX-возможность не задействована. | Создать helper `Toast.error(msg, { hint, retry })` который автоматически ставит `mascot:'concerned'` + subText. Заменить existing `showToast(_, 'error')` на него (там где имеет смысл). | M |
| 5 подсказки | `chat/chatUIRenderer.js:243–257` | medium | `renderThinking` показывает `<span class="msg-thinking">` (3 точки CSS-bouncing) + `msg-thinking-longhint` после 15s. Но при этом per-message avatar играет `obs--ls-thinking` — 2 индикатора одного и того же, а ls-thinking ещё и без edge-shimmer (см. п.4 RICH_OBS_SVG hooks). Шум. | После реализации edge-shimmer hooks (п.4 critical) убрать `<span class="msg-thinking">`-точки, оставить только маскот. ИЛИ оставить точки, но усилить: «Призма думает 15 секунд». | S |
| 5 подсказки | `onboarding/onboardingUI.js:198–209` | low | Tour-mascot имеет `aria-hidden`, но текст шага рядом — это контент. Нет связи маскота с текстом, маскот декоративный. Подсказка «Это Обсидиан, ваш проводник» ни разу не вводится. | Первый шаг тура — явный intro: «Это Обсидиан. Он будет показывать дорогу.» с `obs--surprised` (T2 once). | S |
| 5 подсказки | `app/uxKit.js:218–223` | medium | Mapping `concerned/alert/success` → класс-комбо. Нет `info`, `loading`, `done`. Если хочется «Сохранено» — нужно использовать success. Если «Готовится отчёт» — нет ничего, нужно `ls-thinking`-like loading toast. | Добавить `loading: 'obs--breathe obs--ls-thinking obs--alive'` и `info: 'obs--breathe obs--cur obs--alive'`. | S |

---

## 6. Роль маскота в чатботе (синхронизация с LLM)

| LLM phase | Mascot phase | Файл / callsite | Корректно? |
|---|---|---|---|
| User отправил сообщение | `setChatPhase('thinking')` → `obs--ls-thinking` loop на header avatar | `app/llmAssistant.js:1357` | ОК |
| Первый delta | `setChatPhase('streaming')` → ack-bridge → `obs--ls-streaming` loop | `app/llmAssistant.js:1429–1434`, `app/obsidianMascot.js:436–445` | ОК (ack-bridge через `setChatPhase` case 'streaming' if `wasThinking`) |
| Stream complete | `setChatPhase('complete')` → once → `breathe` | `app/llmAssistant.js:1444–1450` | ОК |
| Stream complete + чат закрыт | + `pulseAlertOnFab()` | `app/llmAssistant.js:1447–1449` | ОК |
| User нажал Stop | `setChatPhase('stop')` → once → `breathe` | `app/llmAssistant.js:1493–1494` | ОК (но без preceding streaming проверки — §13.10 п.7 «stop без streaming = нонсенс») |
| Error | `setChatPhase('error')` → ls-error → breathe → +concerned+alive | `app/llmAssistant.js:1534–1540` | смешано — см. находку IxD-3 в design-01, но Promise.then race в section 3 |
| Error + чат закрыт | + `pulseConcernedOnFab()` | `app/llmAssistant.js:1537–1539` | ОК (но без emerge-guard — см. п.2 finds) |
| Tool-use (LLM зовёт инструмент) | `setChatPhase('tool')` → ls-tool → ls-streaming | `app/obsidianMascot.js:464–467` | **Контроллер готов, но нет callsite** — chat не зовёт `tool`. GigaChat tool-use не реализован ⇒ ls-tool анимация мертвая. |
| Per-message phase | `setMessageAvatarPhase(idx, phase)` after renderMessages | `app/llmAssistant.js:1556–1561` | Race condition: см. п.3 |

### Находки — синхронизация LLM

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 6 LLM | `app/llmAssistant.js:464–467` (controller) vs callsites | low | `setChatPhase('tool')` есть в контроллере, но GigaChat-streaming в проекте не использует tool-use API → анимация **мёртвый код**. §13.7 «Ассистент дёрнул tool → ls-tool» не воспроизводится. | Когда tool-use появится — добавить hook в `chatActivityHandler.js`. Пока — пометить TODO в комментарии и не показывать в demo'ах. | XS (доку обновить) |
| 6 LLM | `app/llmAssistant.js:1493–1494` | medium | `setChatPhase('stop')` вызывается **в catch блоке AbortError** — но не проверяет был ли `streaming` перед этим. Если юзер нажал stop в фазе `thinking` (стрим ещё не начался) — `obs--ls-stop` отыгрывает «freeze mid-undulation» поверх застывшей `ls-thinking`. Семантически странно. | Перед `'stop'` проверить `state.llm.history[lastIdx].thinking`: если true → `setChatPhase('idle')`, иначе `'stop'`. §13.10 п.7. | S |
| 6 LLM | `app/llmAssistant.js:1556–1561` | high | `setMessageAvatarPhase(lastIdx, phase)` зовётся в **`finally`**, но `LLMAssistant.renderMessages()` — тоже в `finally`, перед setMessageAvatarPhase. RenderMessages full re-render создаёт новые DOM-элементы → старые .msg-row отбрасываются. После re-render `setMessageAvatarPhase` находит свежий msg-avatar (initial class из renderStructuredResponse `obs--breathe`) и навешает на него ls-error/ls-stop. Но тогда `.then()` chain в `setChatPhase('error')` cb навешивает `obs--concerned obs--alive` через 2400ms — за это время может прийти уже **новое** сообщение (юзер быстро перезапросил), и concerned попадёт на устаревший index. Race race. | (1) `el.isConnected` check в .then. (2) Сохранять `el` reference в closure. (3) Если history.length изменился — abort the chain. | M |
| 6 LLM | `app/llmAssistant.js:1444–1450` | low | Stream complete → setChatPhase('complete') → once 1600ms → breathe. **Pulse Alert на FAB ставится синхронно**, не дожидаясь complete-once. Если юзер открыл chat за это время — Alert на FAB и Complete на header играют параллельно (на разных DOM узлах) → визуально 2 события «новое». | Отложить `pulseAlertOnFab` через `_playOnce` Promise.then complete. Или Alert — только если panel.hidden ПРЕЖНИМ check'ом ПОСЛЕ animationend. | S |
| 6 LLM | `app/obsidianMascot.js:438–445` | medium | `setChatPhase('streaming')` ack-bridge: если `wasThinking` → `_playOnce(el, 'obs--ack', 'obs--ls-streaming').then(() => _setLoop(el, 'obs--ls-streaming'))`. Внутри `_playOnce`: `baseState='obs--ls-streaming'` (не AMBIENT) → `el.classList.add('obs--ls-streaming')` после `animationend`. Затем .then(() => _setLoop) ставит ещё раз ls-streaming с `_clearExclusive` + `_ensureAmbient`. Двойная установка. | После .then достаточно проверить наличие класса. Или убрать .then() и положиться на `_playOnce`'s baseState чтобы оно само ставило ls-streaming как loop. | S |

---

## 7. Управление маскотом

| Аспект | Текущее состояние |
|---|---|
| Горячая клавиша открытия чата | `Cmd/Ctrl + /`, `Cmd/Ctrl + .`, `Cmd/Ctrl + J/О` (русская раскладка) — `app/llmAssistant.js:1000–1009` |
| Горячая клавиша скрытия маскота | **Нет** |
| Settings UI «отключить маскот» | **Нет** в `app/appSettings.js` |
| Settings «уменьшить размер» | Нет |
| Settings «отключить hibernate» | Нет |
| Reduced-motion preference | Через `prefers-reduced-motion` ОС-уровень — кнопки в продукте нет |
| Right-click context menu на FAB | Нет (только `title="Открыть помощника"`) |

### Находки — управление

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 7 управление | `app/appSettings.js`, `app/obsidianMascot.js` | high | Нет UI / hotkey для отключения маскота. Юзер с эпилепсией / в долгом фокусе / на встрече без screen-share — может хотеть скрыть FAB. Только костыль через DevTools `document.getElementById('assistant-fab').remove()`. | (1) В Settings → Помощник: чекбокс «Скрыть маскот в углу» (FAB остаётся как `<button>` без mascot, или скрыт до hotkey). (2) Hotkey `Cmd/Ctrl + Shift + .` toggle visibility. (3) `localStorage.q2_mascot_hidden = '1'`. | M |
| 7 управление | `app/appSettings.js` | medium | Нет «уменьшить размер маскота». На 13" ноуте 144×144 FAB огромный. | Settings → размер: 96 / 144 / 192 (var --obs-fab-size). | S |
| 7 управление | `app/obsidianMascot.js:299–311` | medium | Нет UI для отключения hibernate. На терминалах supervisor'ов где экран должен быть всегда «бодрым» — hibernate визуально как ошибка. | Settings checkbox «Спящий режим маскота через 5 мин». | S |
| 7 управление | `app/obsidianMascot.js` | low | Нет API для одноразового скрытия по контексту (например, во время preview модала). Пока маскот всегда виден. | Метод `ObsidianMascot.suspend()` / `.resume()` — для модальных flow'ов где FAB перекрывает действие. | S |
| 7 управление | `app/llmAssistant.js:1001–1004` | low | Hotkey коллизия: `e.key === 'j' || 'J' || 'о' || 'О'` — русская раскладка для J. Но `'.'` в русской раскладке = `'ю'`, и `/` = `'.'` (зависит от layout) — не покрыто. Юзер на русской раскладке Cmd+. может не открыть чат. | Добавить `e.code` based fallback (KeyJ / Slash / Period) — universal layout-agnostic. | S |

---

## 8. Аналитика

| Event | Параметры | Файл / точка | Используется? |
|---|---|---|---|
| `obsidian.phase` | `{ target, phase, durMs }` | `app/obsidianMascot.js:104–106` (`_logPhase`) — вызывается из `_playOnce` finish и `_setLoop` | Заходит в `HistoryLog.event` (action log). Не уходит в server-telemetry, не агрегируется |
| `chat_message` | `{ details, source }` | `app/llmAssistant.js:1351` | через `HistoryLog.ai` |
| `_telLLM('sent'/'aborted')` | `{ category, intent }` | `app/llmAssistant.js:1428,1496` | через `integrations/telemetry.js` → server `/api/telemetry` |
| `mascot.click` | — | **нет** | юзер кликает FAB → `togglePanel`, но эвент не пишется |
| `mascot.dismiss` | — | **нет** | нет mechanism для disable / dismiss |
| `mascot.hibernate-enter / exit` | — | **нет** (только generic phase log с phase='obs--hibernate') | без durMs |

### Находки — аналитика

| раздел | файл:строка | severity | проблема | решение | трудозатраты |
|---|---|---|---|---|---|
| 8 analytics | `app/obsidianMascot.js:103–106` | medium | `_logPhase` пишет в `HistoryLog.event` — это локальная audit-история, не уходит в server. На UX-метрики «сколько раз сработал alert / concerned» нужны server-side aggregation. | Дополнительно вызывать `integrations/telemetry.js` → `track('mascot.phase', {...})` для phase'ов которые матерят (alert, concerned, hibernate-start, hibernate-wake). Не для каждого breathe. | S |
| 8 analytics | `app/obsidianMascot.js:148–155` | medium | `_setLoop` логирует `phase` с `durMs=0` (loop'ы не имеют конечной длительности). Это правильно. Но: ambient (breathe/blink) не логируются — что норма, но по логу не видно «сколько маскот в breathe vs ls-streaming». Невозможно посчитать %time in alert / concerned. | Логировать phase-enter и phase-exit с timestamp, на server строить duration через diff. | M |
| 8 analytics | `app/llmAssistant.js:895–909` | medium | FAB-click не emitнет event. Невозможно построить funnel «увидел FAB → кликнул → что спросил». | `HistoryLog.event('mascot.click', { context: state.activeSection, hasUnread: !!_alertQueued })`. | S |
| 8 analytics | `app/obsidianMascot.js:312–322` | low | `_enterHibernate` логирует только `obs--hibernate` без `idleMs` (сколько простоял). | Добавить `_logPhase('mascot', 'hibernate-enter', IDLE_HIBERNATE_MS)`. | XS |
| 8 analytics | `app/uxKit.js:196–245` | medium | Toast'ы не логируются вообще — нет события `toast.shown`. На А/B `concerned-mascot vs no-mascot` метрики собрать невозможно. | `logger.event('toast.shown', { type, hasMascot, hasUndo, ms })`. | S |
| 8 analytics | `app/obsidianMascot.js:416–481` | medium | `setChatPhase` вызывает `_setLoop` или `_playOnce` каждый из которых самостоятельно логирует. Но **fast tab-switching** между phase'ами (thinking → streaming → complete за <500ms на rule-based) → 3 log entries за полсекунды. Лог зашумлён, реальные UX-моменты теряются. | Throttle: одинаковая phase подряд — пропустить. Очень короткие phase'ы (<200ms) — игнорировать. | S |

---

## 9. Идеи по улучшению маскота (8–12)

| # | Идея | потенциал | файл/контекст | трудозатраты |
|---|---|---|---|---|
| **I1** | **Контекстный Curious при наведении на graph-row.** На hover Gantt-bar / Registry-row маскот в углу делает короткий `obs--cur` (наклон в сторону row) — давая ощущение «он смотрит вместе с тобой». Параметризовано через `data-attention-target` атрибут. | high | `app/obsidianMascot.js` + global hover delegate в `app.js`; расширить `_wireFabHover` для arbitrary targets через `data-` opt-in | M |
| **I2** | **Mood ring — состояние портфеля как state маскота.** Каждые 2min проверять health: high-risk count > N → маскот в `concerned-alive` (медленный breathe + brows). Все ОК — `obs--breathe` + `obs--blink`. Drift detected — `alert` once. Делает маскот живым «барометром» как обещано брендбуком §13.7. | high | новый `app/mascotMood.js` подписка на `state.rows`/`riskEngine`, дебаунс 2min | L |
| **I3** | **Long-running task companion.** При export XLSX / heavy AI compute → маскот переходит в `obs--ls-tool` (наклон к socket) loop, при завершении — `obs--success` + Toast. Сейчас juicy анимация мертва. | medium | Hook'и в `dataStore.js` xlsx-export, `aiView.js` analyze, `integrations/teamScanner2.js` long fetch | M |
| **I4** | **Per-section mascot accent.** В Реестре маскот breathe в normal, в AI-CEO breathe + slight tilt left (фокус на анализ), в Перегрузке — `concerned-alive` если есть >threshold burnt-out. Контекстуальная подсказка без слов. | medium | `app/nav.js` section-change → `mascot.setSectionMood(section)`. Каркас для I2. | M |
| **I5** | **«Что нового» через маскот.** При первом запуске после deploy (`localStorage.q2_lastSeenVersion < CURRENT_VERSION`) FAB играет `obs--surprised` + tooltip «Что нового в Призме» 1 раз. Замена release notes modal — лёгкий nudge. | medium | новый `app/whatsNew.js` + version constant в `package.json`/`constants.js` | S |
| **I6** | **Mascot-driven empty-state.** В `views/registry.js`/`views/gantt.js` при пустых данных — большой 80×80 mascot в `obs--hibernate` (звезда внутри) с caption «Тут пока курс не проложен». Замена `prizmaEmptyGlyph()` (8-лучевая звезда) на маскота — даёт характер. | high | `app/prizmaUI.js renderEmptyState` поддержка `illustration: 'mascot-hibernate'` + новый компонент | M |
| **I7** | **Keyboard navigation между маскот-state'ами для demo.** Cmd+Shift+K → циклится по T2-state'ам (alert/concerned/wink/success) — для PR / demo screencast'ов / QA. Не для production. | low | hotkey + dev-flag `localStorage.q2_mascot_dev=1` | S |
| **I8** | **Sound design opt-in.** Брендбук явно не упоминает звук, но §13 «спокойный наблюдатель» — лёгкий sub-100Hz «дыхание» на breathe + чёткий тик на alert (через WebAudio). Off by default. | medium | новый `app/mascotSfx.js` (WebAudio API), settings checkbox | M |
| **I9** | **Persistence «давно не виделись»**. `localStorage.q2_obsidian_last_active` — diff > 1 day → emerge с custom flavor (slower, добавить `obs--awaken` после), tooltip «Призма не видела вас сутки. Что-нибудь обновим?». | medium | `app/obsidianMascot.js` init + сохранять время на beforeunload | S |
| **I10** | **Воркфлоу-coach.** Юзер совершил критическую операцию (delete row, bulk-edit) → mascot → `obs--squint` + toast «Готов помочь — спросить почему?». Conversion funnel в чат от destructive actions. | high | hooks в `app/bulkEditPanel.js`, `rowFactory.js` deletePath | M |
| **I11** | **Mascot pinned mode.** Drag&drop FAB — pin position в углу (BR / BL / TR / TL). `localStorage.q2_obsidian_pos`. Для 4K-мониторов где BR далеко от рабочей области — пин в TL. | medium | `app/obsidianMascot.js` + drag handler, `--obs-fab-pos: br/bl/tr/tl` CSS var | M |
| **I12** | **Intent-aware Curious.** При hover на FAB вместо generic curious — анимация которая «знает» что в чате последнее сообщение thinking/streaming/idle. Если есть unread (alert pulse был) — `obs--surprised` (привлечь). Иначе — обычный `cur`. | low | `_wireFabHover` ветвление по `_alertQueued` / `state.llm.history[last].streaming` | S |

---

## Сводка

**Всего находок:** 33 (1 critical, 6 high, 17 medium, 9 low)
**Идей:** 12

### Топ-5 фикс-приоритетов

1. **CRITICAL — RICH_OBS_SVG missing hooks** (раздел 4): 9+ CSS keyframes таргетят несуществующие узлы (lid, spark, aura, inner-star, edge-1/2/3, body-x, body-wave, trail-1/2/3). Hibernate без звезды, Awaken/Settle/Wink без век, Success без искр, ls-thinking без shimmer, ls-move без trail в туре. — `app/obsidianMascot.js:28–62`. **M effort**.

2. **HIGH — Hibernate gate ломается на visibilitychange** (раздел 2): 5min idle counter перезапускается на каждый Cmd+Tab → §13.7 hibernate в реальном workflow никогда не сработает. — `app/obsidianMascot.js:307`. **S**.

3. **HIGH — Hibernate ловится во время LLM-streaming** (раздел 2): guard только на `obs--alert`, не на `ls-streaming/thinking/tool`. Можно уснуть посреди ответа. — `app/obsidianMascot.js:316`. **S**.

4. **HIGH — Per-message phase race** (раздел 3, 6): Promise.then в `setChatPhase('error')` навешивает concerned на устаревший index если юзер быстро перезапросил. — `app/llmAssistant.js:1556–1561`, `app/obsidianMascot.js:460–462`. **M**.

5. **HIGH — Mascot отключить нельзя** (раздел 7): Нет UI / hotkey / setting для скрытия. Юзер с фокусной задачей/эпилепсией не может убрать движущийся 144×144 элемент в углу. — `app/appSettings.js`, `app/obsidianMascot.js`. **M**.

### Не-закрытые из предыдущих этапов

- **Toast `mascot:` параметр API существует (`app/uxKit.js:201,209,217–224`), но никто не вызывает** — design-01 D «item D» формально done в API, но без callsites в `errorsLog.js` / drift-detection / action-success — UX-effect нулевой. (раздел 5, find #3)

- **`subText` поддерживается в `ToastQueue.show`, но не используется** — (раздел 5).

- **`setChatPhase('tool')` контроллер готов, но GigaChat tool-use не реализован → анимация мёртвая** — (раздел 6, find «tool»).

### Закрытые в V22 (для контекста; не дублировать)

- ✅ Tier 3+2 stacking (mM1, AMBIENT_CLASSES vs EXCLUSIVE_CLASSES split).
- ✅ Emerge guard / interaction lock `_t1Active` (M1).
- ✅ Curious mouseleave bridge (mM2 v3 inline-transform).
- ✅ Error → Breathe (не Concerned) с alive-stack (M3, IxD-3).
- ✅ Hover debounce 100ms (mM4).
- ✅ Easings tokens cleanup (mM5).
- ✅ ls-streaming amplitude для small (mM6 + obs--sm).
- ✅ Particles emit-1..4 в RICH_OBS_SVG (mM7).
- ✅ Idle-Hibernate timer (mM8, кроме гейтов в п.2 этого аудита).
- ✅ `_playOnce` clearTimeout double-reset fix (M4).
- ✅ Theme transition 200ms на fill (mM10).
- ✅ Per-message avatar (design-01 A, размер 40, через `obs--sm`).
- ✅ User initials chip (design-01 G).
- ✅ Spine-eyebrow caption (design-01 C, M6, top4).
- ✅ Streaming caret (design-01 B).
- ✅ Tour mascot ls-move (design-01 E, IxD-1).
- ✅ Toast mascot **API** (design-01 D, реализовано в uxKit, callsites — проблема в этом аудите).
- ✅ pulseConcernedOnFab (design-01 F).
- ✅ Sparkles → plus в шапке чата (top5 design-02).
- ✅ Splash mascot убран в пользу persistent FAB (v22 mascot-pass).
