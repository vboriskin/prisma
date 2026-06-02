# Сводный аудит таблицы сотрудников

**Дата:** 2026-06-02
**Эксперты:** 8 параллельных аудитов (без HR)
**Всего находок:** 134

## Главное

Roster в Сканнере команды формально работает, но при попытке использовать его «утром за 5 минут» рассыпается сразу в нескольких независимых углах. Перегрузка визуальными сигналами — каждая строка несёт до 18 атрибутов и почти ничего не приоритизировано (UX/UI), при этом за визуальной плотностью прячутся реальные дата-баги: LLM получает часы делёные на 360 вместо 3600, диф-бэйдж idle→stop рендерится как улучшение, share-link не открывается с новым каноническим URL (bugs-QA). Значительная часть «продуктивностных» сигналов считается на чужих ивентах (commits + reviewer-сессии засчитываются как переключения, closedToday читает regex по тексту транзишена, TZ браузера и сервера расходятся) — то есть тимлид получает не просто шум, а систематически смещённые данные (signal-quality). При этом инструмент закрывает inspection-job («что у команды»), а не decision-job («с кем и про что говорить») — лучший actionable-компонент `buildActionQueue` уже есть в коде, но спрятан в брифах (product-jobs). Архитектурно `teamScanner2.js` стал God Object на 4171 LOC с пятью кэшами и без VM-pattern (tech-frontend), поэтому каждый search-keystroke — это full innerHTML rewrite на ~120 ms (~420 ms на mid-range Android) с input-lag'ом (performance). A11y — на бумаге заявлен, на практике контраст amber 2.2:1, focus-trap пробивается, source-chips SR озвучивает мусором (accessibility). И на этом фоне есть простор для killer-features (1:1 memory lane, conflict radar, workload headroom, stand-up draft), которые сегодня уже доступны по данным, но не собраны в UI (killer-features).

## Топ-приоритеты (одобрено ≥2 экспертами)

1. **Сократить визуальную плотность строки (3-tier amortization)** — каждая строка несёт 18+ сигналов, дубликаты «всё плохо» (stripe-left + ▌Nh + ↓-arrow + pulse) сбивают приоритизацию. (UX/UI, product-jobs, accessibility, performance)
2. **Заменить полноэкранную modal-panel на slide-in справа** — текущая модалка ломает обещание side-by-side и flow «прошёл 30 человек утром». (UX/UI, product-jobs)
3. **Surface `buildActionQueue` как primary block над roster** — готовая приоритизация «с кем говорить и про что» уже есть в коде, но спрятана. (product-jobs, killer-features частично через stand-up draft)
4. **Чистка productivity-zombie chips (PROD/SWITCH/LOC) за localStorage-флагом** — нет owner-job, токсичны для SR-озвучки, потенциальный compliance-риск. (product-jobs, UX/UI, accessibility, signal-quality)
5. **Pulse-animation на регрессе — выпилить или статичная альтернатива** — 5 строк × 5 секунд = когнитивная паника + vestibular trigger + ломается reduced-motion. (UX/UI, accessibility)
6. **Sort внутри stop-группы по `maxDwellHours desc`** — сейчас сортировка по `timelineToday desc`, а у stop этот counter всегда 0 → порядок случайный. (UX/UI, product-jobs, signal-quality косвенно)
7. **Контраст signal-токенов (amber 2.2:1 на белом)** — counter amber/orange не читается у low-vision, fail WCAG AA для всех чисел. (accessibility, UX/UI косвенно)
8. **Fix дата-багов высокой критичности**: LLM seconds/360 → /3600, share-link canonical-формат, idle→stop diff-badge как улучшение, isStaleData всегда false. (bugs-QA)
9. **Inline-копия classifier в `_extractSnapshot` + переход на single-source-of-truth** — classifier-модуль явно предупреждает об этом сценарии в комментарии. (tech-frontend, bugs-QA, performance)
10. **Search keystroke = full re-render → in-place visibility toggle** — 120 ms на M2, 420 ms на Snapdragon, input-lag заметен пользователю. (performance, tech-frontend)
11. **TZ-консистенция row dot-strip vs panel heatmap** — bucketByHour использует browser, computeHeatmap принимает tzOffsetMin → пики в строке и панели не совпадают. (signal-quality, bugs-QA)
12. **Focus-trap через `inert` + accessible name на row** — текущий ручной Tab-handler пробивается, SR озвучивает «B 2 J 3 C 0» 10 секунд на строку. (accessibility)

## Полная таблица находок

| # | Аудит | Находка | Описание | Зачем делать | Как делать | Критичность | Сложность | Ценность |
|---|-------|---------|----------|--------------|------------|-------------|-----------|----------|
| 1 | bugs-qa | LLM payload секунды→часы делит на 360 | Конвертер в LLM-промпте даёт ×10 ошибку, замаскированную округлением, но ломается на дробных часах | LLM выдаёт «План сегодня» по этим часам — корректность фундамент AI-логики | Заменить /360 на /3600, покрыть unit-тестом | high | low | high |
| 2 | bugs-qa | Share-link не работает с новым URL | Парсер ищет legacy `/employee/key`, а пишется canonical `?focusKind=employee&focusId=...` — silent no-op | Заявленная фича async-команды не работает | Добавить парсер canonical-формата в `_consumeShareLink` | high | low | medium |
| 3 | bugs-qa | Diff-badge idle→stop рендерится как улучшение | Order-map ставит idle=-1, любой переход idle→X показывается зелёной стрелкой вверх | Дезинформирует тимлида в самом критичном сегменте (кто требует разговора) | Переписать ранг-функцию по «требуется ли внимание» | high | low | high |
| 4 | bugs-qa | `composePersonNarrative.isStaleData` всегда false | Читает поле participant, а пишется только на model — dead UI indicator | Либо чинить, либо удалить — сейчас silent regression | Передавать fetchedAtMs через ctx или удалить блок | medium | low | low |
| 5 | bugs-qa | Team-medians читают несуществующее поле | `hoursLoggedToday` вместо `loggedTodaySec` → медиана всегда 0ч | Tooltip «Медиана команды: 0ч» подрывает доверие к числам | Заменить на корректное поле | low | low | medium |
| 6 | bugs-qa | Search-cache не учитывает смену команды | Cache key `length+first+last` — две команды одинакового размера дают cache-hit с чужими результатами | False-positive data display при переключении команд | Включить projectKeys-фингерпринт в dataKey | medium | low | medium |
| 7 | bugs-qa | TZ-skew между server и browser | Heatmap row-strip — browser TZ, timelineToday — server TZ → события около server-midnight попадают не в тот день | Систематическая ошибка для всех событий рядом с UTC-midnight | Прицеплять localDate по tzOffsetMin на сервере | medium | high | medium |
| 8 | bugs-qa | Panel открыта когда строка скрыта search-фильтром | renderPanel читает m (unfiltered), row filtered из filteredModel | State inconsistency, тимлид видит карточку человека которого нет в списке | Сбрасывать `_expandedKey` если participant отфильтрован | medium | low | medium |
| 9 | bugs-qa | Kebab-абoрт orphan listeners | На быстром re-toggle controller может быть abort'нут до setTimeout tick'а, document-listeners живут | Memory leak (small but documented) | abort предыдущего controller'а в `_renderFull` | low | low | low |
| 10 | bugs-qa | closedYesterday не ловит русские статусы | Regex /done|closed|resolved/i не матчит «Готово»/«Закрыто»/«Решено» | LLM-payload пустой для RU-only Jira — фича бесполезна | Добавить terminalDestination boolean из state-machine | medium | low | medium |
| 11 | bugs-qa | LLM-inflight не abort'ится при смене команды | `_setSelectedTeam` обнуляет `_expandedKey`, но не abort'ит assistant fetch | Waste resources + утечка PII через unhandled response | abortAllAssistants при смене команды | low | low | low |
| 12 | bugs-qa | Share-link match только по key, не по email | Cross-view focus с Реестра шлёт email, Сканнер матчит только lowercased ФИО | Cross-view focus contract сломан | Повторить identity-resolve в `_renderFull` | medium | low | medium |
| 13 | bugs-qa | Jenkins chip не отличает «не настроен» от «настроен, но 0» | jChipRow скрывается при n=0, не показано различие конфигурации | Тимлид думает «у Феди 0 deploy», а Jenkins вообще не настроен | Server explicit flag `configured:false` + UI-вариант chip | low | medium | medium |
| 14 | bugs-qa | Filter pill закрывает раскрытую assistant section | `renderAssistantSection` не получает open-state, при rebuild схлопывается | Микро-frustration на каждом filter переключении | Держать `_assistantOpenKeys` в state | low | medium | medium |
| 15 | bugs-qa | bucketByHour асимметричен к clock-skew | Защита только от forward-skew, backward не отлавливается | Edge case, но без telemetry нельзя увидеть в проде | Добавить telemetry на drop'нутые events | low | low | low |
| 16 | bugs-qa | tasksTouchN fallback не использует timelinePrev | distinctIssueKeys всегда сразу считается, fallback dead code или ошибка на 24ч | Только для тестов | Использовать в fallback и today+yesterday+prev | low | low | low |
| 17 | bugs-qa | WIP-counter и classifier WeakMap cache рассинхрон | Sprint-filter мутирует p.issuesNow, classifier cache hit вернёт stale | Theoretical, регрессивно при добавлении новых рендер-сайтов | bumpClassifyEpoch явно в enrichForScanner2 | low | low | low |
| 18 | bugs-qa | `_announce` после rerender падает в пустоту | rAF выставляет textContent на detached node | SR-объявления теряются при стресс-нажатиях | Проверять `document.contains(el)` перед setting | low | low | low |
| 19 | bugs-qa | `_pendingShareKey` не очищается на abort | Висит между mount-циклами, false-positive toast при возврате во вкладку | False-positive «больше не работает в команде» | Сбрасывать в `_paintCancelled` и abort-branch | low | low | low |
| 20 | bugs-qa | Email mask в panel header против комментария | Visible text masked, mailto-href unmasked — несоответствие с V22 «masking убран» | Confusion: видишь masked, кликаешь — открывается full | Удалить вызовы maskEmail или сделать toggle | low | low | low |
| 21 | tech-frontend | Inline-копия classifier в `_extractSnapshot` | Классификация stop/watch/moving переписана руками вопреки предупреждению в classifier.js | Bug-bait — при добавлении нового сигнала забудут обновить копию | Использовать classifyPerson из модуля напрямую | medium | low | high |
| 22 | tech-frontend | `teamScanner2.js` — God Object 4171 LOC | Orchestrator + 13 модалок + 5 кэшей + audit-queue в одном объекте, unit-test невозможен | Каждый новый dev читает 2-3 часа, blame-chain катастрофа | Extract Modals/AssistantController/AuditQueue/Snapshot модули | medium | medium | high |
| 23 | tech-frontend | WeakMap classifier-cache держится на ручном bumpClassifyEpoch | Контракт нигде не enforced, при добавлении нового render-сайта легко регрессирует | Скрытая fragile-инвариант, выявится через несколько месяцев | Сделать epoch автоматическим по model.fetchedAt | medium | low | medium |
| 24 | tech-frontend | PersonRows/Hero/Renderer считают src-chips по разным формулам | Три параллельные иерархии для одного набора «J/B/C/Zc/Ze» | При добавлении 6-го источника надо править 3-5 мест | Единый Sources.js registry + одна функция рендера | medium | medium | high |
| 25 | tech-frontend | `_bindEvents` рекомпилирует 50+ listener'ов на каждый renderFull | Вместо delegation — querySelector + addEventListener × 50 | Performance regression, блокирует partial render | Один listener на container + data-action атрибуты | medium | medium | high |
| 26 | tech-frontend | AbortController + escHandler — двойная подписка | belt-and-suspenders с ручным removeEventListener и AbortController | Хрупкая mental-model, теоретически возможна leaktover | Оставить только AbortController-based path | low | low | medium |
| 27 | tech-frontend | `setRenderContext` — module-level mutable state | Hidden dependency, race при двух контейнерах | Текущий singleton, theoretical для multi-team-view | Передавать ctx как props, drillthrough | low | medium | medium |
| 28 | tech-frontend | `_classifyPerson` re-export через alias indirection | Cargo-cult от пред-extract эпохи, затрудняет поиск call-sites | Developer experience, искать call-sites труднее | Удалить alias, импортировать напрямую | low | low | low |
| 29 | tech-frontend | DOMParser в брифе — string→DOM→string pipeline | Бриф реверсит renderer чтобы извлечь данные которые у него уже были | Один patch — три брифа надо обновить, нет тестов | Двухфазный renderer: buildRowVM + renderRowVM | medium | medium | high |
| 30 | tech-frontend | Пять кэшей с разными контрактами инвалидации | metricsMemo/classifyCache/detailCache/assistantCache/searchCache — разные стратегии | Debuggability на длинных сессиях нулевая | CacheRegistry с единой invalidate-key | low | medium | medium |
| 31 | tech-frontend | Cyclic import Renderer.js ↔ RendererHero.js | Работает через late-binding ES-модулей | Архитектурный долг, при импорте top-level переменной даст undefined | Extract общий tab-bar в отдельный модуль | low | medium | medium |
| 32 | tech-frontend | localStorage в hot path рендера | 4+ места, прежде всего hideProductivity в renderRow на каждую строку | Safari подёргивает event-loop, ×100 на 100-person команде | Один read в `_renderFull`, передать через ctx | low | low | medium |
| 33 | tech-frontend | Renderer возвращает template-strings — невозможно протестировать | Чтобы проверить наличие кнопки — надо парсить HTML | Нет unit-теста rendering layer'а | VM-pattern или jsdom snapshot tests | low | medium | high |
| 34 | tech-frontend | `_renderFull` смешивает 12+ ответственностей | 172 LOC одной функцией, double-call gatherDiagnosticState | Каждый шаг имеет failure-mode без границ | Pipeline: prepareRenderState → renderTemplate → applyToContainer → mountSideEffects | low | high | medium |
| 35 | tech-frontend | Hero re-вычисляет агрегаты которые уже есть в model | 48h-aggregates считаются и в enrichment, и в hero | Расхождение в шапке при изменении enrichment-фильтров | Положить в `model.scannerV2.aggregate48h` | low | low | medium |
| 36 | tech-frontend | `_announce` без проверки isConnected | Silent fail при unmount→mount cycle | SR-аннонсы пропадают при стресс-нажатиях | Глобальный live region в index.html или проверка | low | low | low |
| 37 | ux-ui | 18 сигналов в одной строке = за гранью parallel scan | 48-72 атома на строку × 30 строк = 2160 атомов на экране | Тимлид физически не успевает прочитать ни одной строки за 10 сек | 3-tier amortization: always-visible / hover / panel | high | medium | high |
| 38 | ux-ui | Dot-strip 24×6px — орнамент, а не данные | 144px ширины × 2 strip'а = 30% строки на трудночитаемую визуализацию | Реальный вопрос «была активность сегодня» — бинарный, 144px переплата | 8-segment 3-hour-bucket + delta-glyph «vs вчера» | high | medium | high |
| 39 | ux-ui | Triple-duplicate сигнал «всё плохо» | stripe-left + ▌Nh + diff-arrow + pulse + group-header — четыре раза одно и то же | Noise, тимлид игнорирует «громкое», тонкие сигналы теряются | Одна правда — порядок групп + header, убрать дубликаты | high | low | high |
| 40 | ux-ui | Pulse-animation на регрессе — anti-pattern на data-dense | 3 пульса × 1600ms = 5 сек дёргающейся стрелки, 5-7 строк параллельно | Cognitive panic, motion sickness, reduced-motion удаляет инфу | Статичный border + summary toast | high | low | high |
| 41 | ux-ui | «Panel» — полноэкранная modal | inset 4vh/4vw = 94% экрана, закрывает roster | Side-by-side comparison невозможен, mode-switch ×30 за утро | Slide-in 540px справа, roster не блокирован | high | medium | high |
| 42 | ux-ui | «Сегодня/Вчера» labels — паразитный шум | 60 повторений одинаковых CAPS-labels, информация = 0 бит | Шум на каждой строке, табличный column-header стандарт с 1970-х | Sticky table-header перед группой | medium | low | medium |
| 43 | ux-ui | 4 counter'а без иерархии и сравнения | WIP/PR/задач/ч одинакового weight, vs медиана только в tooltip | KPI-tile soup, тимлид игнорирует пока не торчит «×3.5» | Inline bullet-chart relative to median | medium | medium | medium |
| 44 | ux-ui | Source-chips B/J/C/Z — 4 counter'а маскирующиеся под action-badges | Counts не actionable, цвета semantically wrong | Конкурируют по weight с реально важными сигналами | Composite src-glyph (5 микро-dot'ов) | medium | medium | medium |
| 45 | ux-ui | Detail panel — длинный vertical stack без navigation | 10 секций сверху вниз, filter pills под heatmap'ом который контролируют | Тимлид доходит до 30% и закрывает | Sticky section-tabs + filter pills над heatmap | medium | medium | medium |
| 46 | ux-ui | Group-headers без cursor:pointer аффорданса | Click-affordance невидимый — никто не догадается нажать | Обещанная функциональность недоступна по discoverability | cursor:pointer + sticky + hover-state | medium | low | medium |
| 47 | ux-ui | Idle-группа в `<details>` collapsed | «Тихий» сотрудник не виден, roster обещает «команду сегодня» | Тимлид на standup'е скажет «Васи нет в Сканнере» | Compact chip-row для idle с avatars | medium | medium | medium |
| 48 | ux-ui | Stop sort — мёртвый код | Сортировка по timelineToday desc, но у stop today=0 по определению | 79 stop без приоритизации — основной pain | Sort по maxDwellHours desc внутри stop | medium | low | high |
| 49 | ux-ui | Email в panel header — двусмысленность | Display masked, click открывает full → UX-разрыв | Tooltip обещает «клик раскрыть полностью», не выполняется | Удалить masking совсем по V22 комментарию | low | low | low |
| 50 | ux-ui | Activity bar — 4 hero-tiles прикидывающиеся bar-chart | «Сегменты с пропорциями» обещаны, реализация — 4 button'а 1fr | Pretending to be bar chart, без сравнения с медианой | Real horizontal bullet-chart relative to median | medium | medium | medium |
| 51 | ux-ui | Heatmap 72×4 занимает 60% panel вертикали | 360 клеток × 4×4px = читается как текстура, не данные | Жалоба пилотов прямая, ~15% screen × low utility | Collapsed by default, 3-day bar-chart как summary | medium | medium | medium |
| 52 | ux-ui | Productivity-флаги в localStorage = admission of failure | Invisible DevTools-only command, разные defaults для одной семантики | Не visible toggle = broken contract | Explicit settings-checkbox с consent-modal | low | low | medium |
| 53 | ux-ui | Diff-arrow с полным русским label «↓ наблюдение» | 11 символов wider чем counter, конкурирует по weight | Reading 0.5 сек × 30 строк = +15 сек | Icon-only + tooltip, только при downgrade | low | low | medium |
| 54 | ux-ui | Scroll fatigue в длинных roster'ах | Нет sticky group-head, нет mini-map, нет keyboard jump | Длинные команды 50+ — primary use-case | sticky group-head + scroll-restore + keyboard shortcut | medium | low | medium |
| 55 | ux-ui | Banner severity uncalibrated | «Маленькая команда» (info) и «Вся в idle» (alarm) одинаково оформлены | Info-banner учится игнорироваться | All-idle — full-width red + action; small — inline в headers | low | low | low |
| 56 | ux-ui | Assistant section — lottery affordance | Default collapsed, click → 10 сек fetch без cancel | Internal AI-tool с invisible default — низкий ROI | Auto-fetch или inline 1-line preview | low | medium | medium |
| 57 | signal-quality | classifyPerson не учитывает reviewer-role | Senior на full-day code-review без assignee попадает в stop | False-positive 1:1-trigger, провоцирует ненужный разговор | Добавить reviewSig в stop-rule + class 'review-focus' | high | medium | high |
| 58 | signal-quality | «Коммиты без транзишенов» — judgemental label на нормальный workflow | Trunk-based/squash/force-push/feature-flag — все нормальны | Стигматизирующий текст на legitimate workflow | Заменить на «Работа в репо: N коммитов» | medium | low | high |
| 59 | signal-quality | bucketByHour и computeHeatmap используют разные TZ | row dot-strip — browser, panel heatmap — server | Тимлид видит разные пики в строке и панели — теряет доверие | Пробросить tzOffsetMin в bucketByHour | high | low | high |
| 60 | signal-quality | switchEvents штрафует code-review-фокус | Reviewer-сессия на 5 PR подряд = ↻5 как «контекст-свитчинг» | Метрика inverse-correlated с deep-work | Разделять по actorRole, reviewer = один контекст | medium | medium | high |
| 61 | signal-quality | tasksTouchN как productivity-сигнал | 1 коммент на чужой issue = +1 задача | Подкрепляет миф «активность = ценность» | Gini-coefficient или top-1 issue | medium | low | high |
| 62 | signal-quality | maxDwell не учитывает externally-blocked статусы | Awaiting Stakeholder/Blocked-External бьют по assignee | Атрибуция dwell-time не на actor'а, а на ситуацию | 4-я категория threshold=Infinity + regex по статусу | high | low | high |
| 63 | signal-quality | closedToday через regex по тексту transition | /done|закрыт|готов/ ловит «Готов к QA» (false-positive) | Z1 multiplied на 5.0 — один false-positive = +5 productivity | terminalDestination boolean из portfolioPulseModel | high | low | high |
| 64 | signal-quality | Heatmap нормировка peakCell ловит глобальный max | Bitbucket-актив с 80 событий красит heatmap, архитектор с 12 — тихий | Нормировка усиливает выбросы, прячет медианных | Нормировка по роли или persona baseline | medium | medium | medium |
| 65 | signal-quality | WIP считается без role/draft-статусов | Discovery/Sprint-Backlog — это inbox, не WIP | Counter «загрузки» шумит в обе стороны | Делить на active vs inbox по статус-bucket | medium | low | medium |
| 66 | signal-quality | Narrative «вчера» в понедельник = воскресенье | rolling-24h cutoff не уважает рабочие дни | Пн утром systematically говорит «вчера тишина» для здоровых команд | Working-day mask или timestamp последней активности | medium | low | high |
| 67 | signal-quality | CRV median теряет cross-team review | prOpenedAt только из bbItems participants — cross-team PR без data | Senior на 30 review соседней команды показывается как «не делает» | Server-side full PR pool | medium | medium | medium |
| 68 | signal-quality | prThroughput не отделяет DRAFT/ABANDONED | DRAFT 5 дней = stalled-flag, хотя это намеренно | Visible badge показывает overload где его нет | Считать relevantOpened = opened - draft - abandoned | medium | low | medium |
| 69 | signal-quality | Pulse без cooldown и weekend-skipping | Понедельник пт→пн = drop для всей команды | Тимлид «отключает зрение» на регулярном сигнале | Skip pulse если prevSnapshotAt > 36h | medium | low | medium |
| 70 | signal-quality | loggedTodaySec — подмножество реальных часов | 5-15% разработчиков логируют worklog, остальные «0ч» | Counter «часов» вводит в заблуждение для большинства | Hide когда team medianHours=0 или active-events proxy | high | low | high |
| 71 | signal-quality | Communication/pairing не измеряется | Senior полдня менторит — `idle` или `stop` | Систематическая слепота для самой ценной работы senior'ов | Self-reported quick-action или Teams/calendar API | medium | high | high |
| 72 | signal-quality | Sprint-filter: badges vs bbItems рассинхрон | `B 5` в строке + пустая bb-секция в panel | Тимлид теряет доверие к данным, flag'ged в diag | Пересчитывать badges после sprint-filter | high | low | high |
| 73 | signal-quality | pickDwellThreshold regex не покрывает Sber-статусы | Code Review WIP, Awaiting Reviewer, UAT, Active, Coding — не ловятся | False-positive blockers = false-positive stop | _UNKNOWN_DWELL_STATUSES + per-team override | medium | medium | medium |
| 74 | signal-quality | team-medians включают idle/stop | Median 7 человек с 0 активности = 0, tooltip «×Infinity» | Распределение не нормальное, median мусорный | Median по moving+watch или 14d-rolling | medium | low | medium |
| 75 | product-jobs | Roster — inspection-mode, не decision-mode | buildActionQueue уже есть, но спрятан в брифах | Owner-job «с кем поговорить» не закрыт явно | Primary block над roster с top-3 actions | high | medium | high |
| 76 | product-jobs | PROD/SWITCH/LOC chips = feature-zombie | За localStorage-флагом, нет owner-job у тимлида | Technical debt + cognitive overhead на чтение кода | Удалить PROD/SWITCH/LOC, оставить burnout-high | medium | low | high |
| 77 | product-jobs | CR Nч и N↗ Z% chips без owner-job | Не показывают delta, не сравнивают, не actionable | Метрика без «и что дальше» = когнитивная нагрузка | Только при overload + team-level KPI в шапку | medium | low | medium |
| 78 | product-jobs | Heatmap 72×4 — артефакт без явного решения | 360 клеток для одной строки «пик 14-16ч» | Detail panel должна стать focus view, не дашборд | Collapse в `<details>` + summary line | medium | low | medium |
| 79 | product-jobs | EventsFeed дублирует heatmap, открыт по умолчанию | Комментарий обещает collapsed, реализация — нет | Detail panel закрывает decision job первыми 30 сек | Обернуть в `<details>` collapsed | medium | low | medium |
| 80 | product-jobs | 4 почти одинаковые кнопки копирования | TG/Share/Narrative/1on1 — разный output, разные триггеры | Тимлид не знает заранее что какая кнопка делает | 1 primary action + dropdown пресетов | medium | medium | medium |
| 81 | product-jobs | Source-chips в строке read-only, не actionable | B/J/C/Zc/Ze не filter'ы, не deep-link'и | Каждый чип в строке должен закрывать risk/filter/deep-link | Сделать deep-link с filter в panel или удалить | low | low | medium |
| 82 | product-jobs | Sprint-context отсутствует в roster | WIP «5» не отличает sprint от не-sprint | Owner-job тимлида — спринт-делает или нет | Chip «вне спринта» + подсветка sprint-critical | high | medium | high |
| 83 | product-jobs | Watch-группа смешивает 3 разных решения | overload / разговор сегодня / vacuum в одной группе | Тимлид читает каждую строку чтобы понять «срочно или нет» | Подгруппы внутри watch с mini-headers | medium | low | medium |
| 84 | product-jobs | Idle-row с 4 нулями = noise | Counters не отвечают «почему idle» | Idle — простой actionable (identity или отпуск) | Гипотеза в строке вместо counters | medium | low | high |
| 85 | product-jobs | Dot-strips 24+24 — high cognitive cost vs low yield | 30% ширины строки на trudnoчитаемую визуализацию | Decision-job не закрыт | 1 × 12-сегментный mini-heatmap или only сегодня | low | medium | low |
| 86 | product-jobs | Narrative без recommended action | Observation без recommendation, closing-the-loop не сделан | Тимлид сам додумывает «что делать» | Добавить action из buildActionQueue в финал | high | low | high |
| 87 | product-jobs | LLM-сводка живёт параллельно rule-based narrative | Две сводки за одну job, LLM спрятана в `<details>` | Тимлид сравнивает, inverted user-flow | LLM как primary с rule-based fallback или разделить jobs | medium | medium | medium |
| 88 | killer-features | 1:1 Memory Lane — журнал договорённостей | Auto-prep diff «что изменилось с прошлого 1:1» | Roster становится sticky-loop тимлида | Новый модуль OneOnOneLog + section в panel | medium | medium | high |
| 89 | killer-features | Async-handoff draft перед отпуском | Auto-собранный markdown с in-flight/blockers/solo-files | Closes анxious job «уходить в отпуск без чувства вины» | Кнопка в kebab + composeHandoffDraft + reverse-handoff | medium | medium | high |
| 90 | killer-features | Conflict Radar — двое правят один файл | Detection multi-author overlap в bbItems за 48ч | Предотвращает merge-conflict / rework | Pure-function detectCollisionPairs + ⇄ badge | high | medium | high |
| 91 | killer-features | Workload Balance Forecast — headroom-bar | Mini-progress «сколько ещё WIP человек потянет» | Equitable distribution + recommendation для назначения | headroomFor pure-function + mini-bar в строке | medium | medium | high |
| 92 | killer-features | Deep Work Protector — learned-rhythm | Personal rhythm chart по 14-day history | Closes humane-tool positioning (не watchdog) | detectPersonalRhythms + strip над dot-strip | low | medium | medium |
| 93 | killer-features | Mentor-Mentee Auto-Match | На основе solo-author paths и onboarding ramp | Закрывает bus-factor-1 риски до увольнения | suggestMentorPairs + section в panel новичка | low | medium | medium |
| 94 | killer-features | Retention Radar — long-window | Тренды за 4-8 недель: укорачивающийся день, исчезновение CF | Early-warning об увольнении за неделю | detectRetentionDrift на 60-day history | medium | high | high |
| 95 | killer-features | Ambient Background Mode — pinned tab | Favicon-индикатор + native Notification на state-change | Always-present companion, не «task-mode page» | Service worker + Notification flow | low | high | medium |
| 96 | killer-features | Stand-up Draft — auto markdown для команды | Reuse composePersonNarrative для всей команды | Снижает 15-минутный ритуал до 3 минут | composeStandupDraft в team header | medium | low | high |
| 97 | killer-features | Sentiment-Aware Empty States | Контекст + history → adaptive формулировки | Tone-shift «caring observation» вместо «robotic info» | Расширить composePersonNarrative empty-branch | low | low | medium |
| 98 | killer-features | Roster Time Machine — week ago view | Time-slider, snapshot replay | Retrospective с цифрами, понимание trends | UI поверх существующего teamScanner2History | medium | medium | high |
| 99 | killer-features | Quick-Action Sidebar — right-click menu | 6 высокочастотных actions без drill-down | scan → act без переключения tab | contextmenu handler на `.ts2-row` | medium | low | high |
| 100 | killer-features | Risk Replays — что случилось до stop | Storyline of decline из timeline72h | Помогает на 1:1 не спрашивать «что случилось», а показывать | buildStoryOfDecline pure-function | medium | high | medium |
| 101 | killer-features | Voice Note Stitch — приватные заметки | Encrypted localStorage на person + auto-check | Sticky-loop, единый контекст вместо Notion параллельно | Web Crypto + PIN + UI section | low | medium | medium |
| 102 | killer-features | Smart-Compare — bisect vs team или own past | Counter получает delta vs platform avg | Benchmarking surface, политический инструмент | platformBenchmarks dataset + toggle | medium | high | medium |
| 103 | accessibility | Row как div role=button с вложенным контентом | SR озвучивает «B 2 J 3 C 0» 10 секунд | WCAG 4.1.2, 2.4.6 — roster неюзабелен в browse mode | Pre-composed aria-label + aria-hidden на decorations | high | medium | high |
| 104 | accessibility | Focus trap пробивается, inert не выставлен | Tab уходит в roster под backdrop, SR читает всё под модалкой | WCAG 2.4.3, 2.1.2 — focus order сломан | inert на main + circular focus loop | high | medium | high |
| 105 | accessibility | Source-chips произносятся как мусор | title снят в data-tip, SR не получает расшифровку | WCAG 1.3.1, 3.3.2 — labels должны быть в accessible name | aria-label на chip + aria-hidden на span | high | low | high |
| 106 | accessibility | Pulse-animation = vestibular trigger | 5+ одновременных пульсов 5 сек, reduced-motion удаляет инфу | WCAG 2.3.3, 2.2.2 — animation > 5s requires stop | Статичный visual cue при reduced-motion | medium | low | medium |
| 107 | accessibility | Heatmap 72×4 ось времени aria-hidden | SR не получает шкалы — «пик 23ч назад» бесполезно | WCAG 1.1.1, 1.3.1 — структура скрыта от AT | Динамический summary + SR-only `<table>` | medium | medium | medium |
| 108 | accessibility | «Требует разговора» — стигматизирующий label | SR произносит дословно для каждого в группе | WCAG 3.3.2 + этический red flag при shared screen | Operational labels: «Низкая/Стандартная/Высокая активность» | medium | low | high |
| 109 | accessibility | Контраст amber #f59e0b на белом = 2.16:1 | WCAG AA требует 4.5:1 для text | Counter numbers фактически невидимы для low-vision | Darker text-only variants токенов (#b45309) | high | medium | high |
| 110 | accessibility | Empty state «—» не озвучивается смыслово | SR читает «тире» без context-label | WCAG 1.1.1, 3.3.2 | aria-hidden на знак + SR-only sibling text | medium | low | medium |
| 111 | accessibility | Tooltip-only labels снимаются в data-tip | SR полностью теряет доступ к расшифровкам | WCAG 1.3.1, 4.1.2 — accessible name не в data-* | Patch `_promoteTitlesToTooltips` с проверкой aria-* | high | medium | high |
| 112 | accessibility | Русский UI без lang="ru" в production paths | SR выбирает неверный TTS-engine, latin keys читаются как кириллица | WCAG 3.1.1 (A), 3.1.2 (AA) | `<html lang="ru">` + lang="en" на латинских keys | medium | low | medium |
| 113 | accessibility | PROD/BURNOUT chip без focus management | Popover открывается, focus остаётся на chip | WCAG 4.1.2 + ethical — BURNOUT на screen-share | aria-label «Нагрузка: высокая» + focus в popover | medium | medium | medium |
| 114 | accessibility | Click-to-expand events без aria-expanded | li кликабельный, нет role, нет keyboard access | WCAG 4.1.2, 2.1.1 | li → button aria-expanded + aria-controls | medium | low | medium |
| 115 | accessibility | Counter без comparative aria-label | «×1.5 от среднего» в title (снят), для SR — только число | WCAG 1.4.1 (color cannot be only means), 1.3.1 | aria-label с comparative context | medium | low | medium |
| 116 | accessibility | ARIA-live один общий, без priority | aria-atomic true, errors и status конкурируют | WCAG 4.1.3 Status Messages | Два live regions: polite + assertive | low | low | medium |
| 117 | accessibility | Skip link отсутствует, group-head не heading | 80 Tab'ов чтобы добраться до областей под roster | WCAG 2.4.1 Bypass Blocks | Skip link + group-heads как h3 + g-shortcuts | medium | medium | medium |
| 118 | accessibility | Breadcrumb «← Назад» дублирует ✕ Close | Конфликтующая роль с одинаковым поведением | WCAG 2.4.6, 4.1.2 | Wrap arrow в aria-hidden span, либо удалить одну | low | low | low |
| 119 | performance | Search keystroke = full _renderFull | 200ms debounce маскирует ~120ms full re-render | Тимлид видит input lag при печати | In-place visibility toggle на существующих row-nodes | high | medium | high |
| 120 | performance | Roster rows не виртуализированы | 4500 нод на 100 человек, линейный рост | querySelector дороже, listener'ы плодятся | content-visibility: auto + IntersectionObserver | medium | low | high |
| 121 | performance | Panel filter pill = полный rebuild | 1500-нодный heatmap rerender ради смены CSS-класса | 60-120 ms на каждый клик pill'а | CSS-class toggle + `data-active-filters` атрибут | medium | medium | high |
| 122 | performance | `_promoteTitlesToTooltips` O(N) на каждый render | 4800 DOM-touches на 100-person команде | 30 ms «налог» на каждый search keystroke | Сразу класть `data-tip` в renderer'ах, убрать функцию | medium | low | medium |
| 123 | performance | Heatmap 72×4 рендерится eagerly без cache | 380 нод × inline-style на каждый open панели | 8-14 ms parse + 4-6 ms layout на M2 | Cache по grid-hash + lazy через IntersectionObserver | medium | medium | medium |
| 124 | performance | classifyPerson вызывается 4-6× на participant | WeakMap-cache полезен только внутри одного render'а | 3-5 ms на classifier'е на каждый full render | Pre-compute Map один раз в `_renderFull` | low | low | medium |
| 125 | performance | ECharts dispose+mount на каждом renderFull | Search в metrics-tab делает dispose+mount × keystroke | 30 ms ECharts overhead на keystroke в metrics-tab | setOption notMerge:false или disable search в metrics | medium | medium | medium |
| 126 | performance | localStorage в hot path рендера | hideProductivity ×100 на 100-person команде | Sync I/O в hot loop, jitter в WebStorage backend | Snapshot flags один раз, передать в ctx | low | low | medium |
| 127 | performance | `_assistantCache` копится без ограничения | До ~1 MB heap при 50 открытиях | Memory growth, заметно на mobile | LRU max=10 entries + TTL 1 час | low | low | low |
| 128 | performance | linkifyIssueKeys regex hot loop | 200 events × 2 regex passes per render | 3-5 ms per panel rebuild на M2 | Skip linkify если text < 10 chars или без «-» | low | low | low |
| 129 | performance | Per-row click handlers без delegation | 200 listener'ов на 100 человек | 5-8 ms init + 150KB closure'ов | Делегированный listener на `.ts2-rows` | low | low | low |
| 130 | performance | bucketByHour 2× на participant без cache | 200 вызовов на каждый search keystroke | 10-20 ms на 100-person × 50 events | Прикреплять hour-bucket в enrichment | low | low | medium |
| 131 | performance | teamMedians 3 sort на каждый render | Считается inside render-функции | 1 ms на medium команде, edge case | Один раз в `_renderFull` или в enrichment | low | low | low |
| 132 | performance | Layout thrash в `_renderPanelOnly` | remove + insertAdjacentHTML = 2 layout pass'а | 3-8 ms layout per pill-click | DocumentFragment + single replaceChild | low | medium | low |
| 133 | performance | Search-cache key без normalization | «Иван» / « иван» / «ИВАН» = 4 cache entries | Cache miss rate выше, лишние filter passes | Normalize query как cache key | low | low | low |
| 134 | performance | Mobile: tap target ≤4px на strip cells | 24 cells × 3-4 px нарушает 44 px guideline | Mobile useless + slow compositing на 4500 absolute spans | 8 buckets × 8 px под media-query | low | medium | medium |

## Группировка по типу

### Баги (severity high → low)
- LLM payload seconds→hours делит на 360 (high)
- Share-link не работает с новым URL (high)
- Diff-badge idle→stop рендерится как улучшение (high)
- Sprint-filter: badges vs bbItems рассинхрон (high)
- isStaleData всегда false (medium)
- Search-cache не учитывает смену команды (medium)
- TZ-skew между server и browser (medium)
- Panel открыта когда строка скрыта (medium)
- closedYesterday не ловит русские статусы (medium)
- Share-link match только по key, не по email (medium)
- LLM-inflight не abort'ится при смене команды (low)
- Jenkins chip не отличает «не настроен» (low)
- Filter pill закрывает раскрытую assistant section (low)
- bucketByHour асимметричен к clock-skew (low)
- Email mask в panel header против комментария (low)
- Team-medians читают несуществующее поле (low)
- Kebab orphan listeners (low)
- `_announce` после rerender падает в пустоту (low)
- `_pendingShareKey` не очищается на abort (low)
- tasksTouchN fallback не использует timelinePrev (low)
- WIP-counter и classifier WeakMap cache рассинхрон (low)

### Технический долг
- Inline-копия classifier в `_extractSnapshot` (medium)
- `teamScanner2.js` God Object 4171 LOC (medium)
- WeakMap classifier-cache на ручном bumpClassifyEpoch (medium)
- PersonRows/Hero/Renderer src-chips расходятся (medium)
- `_bindEvents` рекомпилирует listener'ы (medium)
- DOMParser в брифе (medium)
- AbortController + escHandler двойная подписка (low)
- `setRenderContext` module-level mutable state (low)
- `_classifyPerson` re-export alias (low)
- Пять кэшей разных контрактов (low)
- Cyclic import Renderer ↔ RendererHero (low)
- localStorage в hot path (low)
- Renderer возвращает template-strings (low)
- `_renderFull` смешивает 12+ ответственностей (low)
- Hero re-вычисляет агрегаты (low)

### UX/UI
- 18 сигналов в одной строке (high)
- Dot-strip 24×6px — орнамент (high)
- Triple-duplicate «всё плохо» (high)
- Pulse-animation на регрессе (high)
- Panel — полноэкранная modal (high)
- Stop sort — мёртвый код (medium)
- «Сегодня/Вчера» labels — паразитный шум (medium)
- 4 counter'а без иерархии (medium)
- Source-chips B/J/C/Z — маскирующиеся counters (medium)
- Detail panel без navigation (medium)
- Group-headers без аффорданса (medium)
- Idle в `<details>` collapsed (medium)
- Activity bar — fake bar-chart (medium)
- Heatmap 72×4 занимает 60% panel (medium)
- Scroll fatigue в длинных roster'ах (medium)
- Productivity флаги в localStorage (low)
- Diff-arrow с полным русским label (low)
- Banner severity uncalibrated (low)
- Email в panel header — двусмысленность (low)
- Assistant section — lottery affordance (low)

### Качество сигналов
- classifier игнорирует reviewer-role в stop-rule (high)
- TZ inconsistency row vs panel (high)
- closedToday через regex (high)
- maxDwell без externally-blocked carve-out (high)
- loggedTodaySec misleading для не-worklog команд (high)
- Sprint-filter badges vs bbItems рассинхрон (high)
- «Коммиты без транзишенов» — judgemental (medium)
- switchEvents штрафует reviewer-фокус (medium)
- tasksTouchN как productivity (medium)
- WIP без role/draft-статусов (medium)
- Narrative «вчера» в понедельник (medium)
- CRV median теряет cross-team review (medium)
- prThroughput не отделяет DRAFT/ABANDONED (medium)
- Pulse без cooldown и weekend-skipping (medium)
- pickDwellThreshold regex не покрывает Sber-статусы (medium)
- team-medians включают idle/stop (medium)
- Heatmap нормировка peakCell (medium)
- Communication/pairing не измеряется (medium)

### Product улучшения
- Surface buildActionQueue как primary block (high)
- Narrative завершить recommended action (high)
- Sprint-context в строке (high)
- Удалить feature-zombie PROD/SWITCH/LOC (medium)
- Heatmap в focus-mode collapse (medium)
- EventsFeed обернуть в `<details>` (medium)
- 4 кнопки копирования объединить (medium)
- Watch-группа разделить на подгруппы (medium)
- Idle-row с гипотезой (medium)
- CR/PRT chips без owner-job (medium)
- LLM-сводка + narrative разделить jobs (medium)
- Source-chips: deep-link или удалить (low)
- Dot-strips в строке (low)

### Killer features
- 1:1 Memory Lane (high value)
- Async-handoff draft (high value)
- Conflict Radar (high value)
- Workload Headroom-bar (high value)
- Stand-up Draft (high value)
- Quick-Action Sidebar right-click (high value)
- Roster Time Machine (high value)
- Retention Radar long-window (high value)
- Deep Work Protector (medium value)
- Mentor-Mentee Auto-Match (medium value)
- Sentiment-Aware Empty States (medium value)
- Risk Replays (medium value)
- Voice Note Stitch (medium value)
- Smart-Compare benchmarking (medium value)
- Ambient Background Mode (medium value)

### Accessibility
- Row role+structure (high)
- Focus trap через inert (high)
- Source-chips SR-name (high)
- Контраст amber 2.2:1 (high)
- Tooltip-only labels (high)
- Стигматизирующий «требует разговора» (medium)
- Heatmap ось времени aria-hidden (medium)
- Empty state «—» (medium)
- lang="ru" missing (medium)
- PROD/BURNOUT chip focus mgmt (medium)
- Click-to-expand events (medium)
- Counter без comparative aria-label (medium)
- Skip link + group-heads as headings (medium)
- Pulse vestibular trigger (medium)
- ARIA-live priority (low)
- Breadcrumb back duplicate (low)

### Performance
- Search keystroke = full re-render (high)
- Roster не виртуализирован (medium)
- Panel filter = полный rebuild (medium)
- `_promoteTitlesToTooltips` O(N) (medium)
- Heatmap eagerly без cache (medium)
- ECharts dispose+mount (medium)
- classifyPerson 4-6× (low)
- localStorage в hot path (low)
- `_assistantCache` копится (low)
- bucketByHour 2× без cache (low)
- linkify regex hot loop (low)
- Per-row listeners без delegation (low)
- teamMedians 3 sort (low)
- Layout thrash _renderPanelOnly (low)
- Search-cache normalization (low)
- Mobile tap target (low)

## Roadmap-подсказка

### Сделать в первую очередь (high critical, low/medium complexity)
1. **Fix 4 high-критичных багов в LLM/share/diff**: seconds→hours делитель, canonical URL парсер, idle→stop order map, badges vs bbItems рассинхрон при sprint-filter. Точечные правки + unit-тесты.
2. **Stop sort по maxDwellHours desc** — одна правка sort-функции в renderPersonRows, мгновенное value для пилотов с большим stop-сегментом.
3. **Pulse-animation выключить** — удалить `is-pulse-attention`, оставить border-color как differentiator. CSS-уровень, низкий риск.
4. **Контраст signal-токенов** — добавить `--prizma-drift-text`, `--prizma-on-course-text` darker variants, заменить counter usage. Прогнать через axe-core.
5. **classifier `_extractSnapshot` inline-копия → импорт из модуля** — закрывает класс будущих рассинхронов между snapshot'ом и live UI.
6. **terminalDestination boolean из portfolioPulseModel** — заменяет regex /done|закрыт|готов/ для closedToday и closedYesterdayByMe. Корректирует Z1-productivity и LLM-payload одной правкой.

### Сделать следующим спринтом (high value, medium complexity)
1. **Surface buildActionQueue как primary block над roster** — конверсия inspection-tool в decision-tool, использует существующий компонент.
2. **Narrative завершать recommended action из buildActionQueue** — closing-the-loop в detail panel.
3. **Sprint-context chip «вне спринта» в строке** — sprint-criticality видна на scan'е без drill-down.
4. **Slide-in panel 540px справа вместо полноэкранной modal** — возвращает promise side-by-side, code-история показывает что было ранее.
5. **Удалить PROD/SWITCH/LOC chips, оставить burnout-high как row badge** — снимает feature-zombie + cognitive overhead + a11y/compliance проблемы.
6. **Search keystroke → in-place visibility toggle** — 70% win на самом частом use-case, ~120ms → ~10ms.
7. **classifier учитывает reviewer-role в stop-rule** — устраняет false-positive для senior'ов на code-review focus.
8. **Focus trap через `inert` + accessible name на row** — WCAG-compliant, roster становится usable в SR browse mode.

### На квартал (требует архитектурных изменений или новых данных)
1. **Extract God Object teamScanner2.js на модули** (Modals/AssistantController/AuditQueue/Snapshot) + VM-pattern для тестируемости renderer'а. Без этого каждая следующая фича roster'а — risk to regress.
2. **3-tier amortization строки + replacement dot-strip → 8-bucket + delta-glyph** — фундаментальный UX-shift, требует measure-execute-verify (Hotjar/Mixpanel session recording).
3. **TZ-aware pipeline** — пробросить tzOffsetMin через server analysePulse, изменить bucketByHour API, координация с DevOps. Закрывает signal-quality + bugs-qa одновременно.
4. **Killer-feature pack для роли «копилот тимлида»**: 1:1 Memory Lane + Stand-up Draft + Workload headroom-bar + Quick-action right-click + Conflict Radar — превращает roster из view в command surface.

## Сквозные риски

1. **Toxic-by-design metrics**: PROD/SWITCH/LOC/BURNOUT — спрятаны за localStorage-флагом, не имеют owner-job у тимлида, но активно считаются в pipeline и потенциально попадают в LLM-payload. Сразу четыре аудита (product-jobs, accessibility, signal-quality, UX/UI) указывают на то же место с разных углов. Риск compliance (HR/GDPR) при случайном screen-share, риск misinterpretation при включении флага без обучения. Решение должно быть продуктовым (удалить или обернуть в explicit consent), не инженерным.

2. **Архитектурный долг блокирует evolution**: God Object teamScanner2.js (4171 LOC), пять кэшей с разными контрактами инвалидации, циклические импорты, inline-копия classifier'а, отсутствие VM-pattern — всё это означает, что любая средняя фича сегодня требует читать 4+ файла. Это видно одновременно в tech-frontend (явно) и в performance (косвенно через невозможность partial render), bugs-qa (через state inconsistency между _expandedKey/_pendingShareKey/_assistantInflight), product-jobs (через невозможность быстро surface buildActionQueue). Без 1-2-недельного refactor sprint'а scope каждой UX-правки растёт ×2-3.

3. **Системно смещённые сигналы**: TZ-несогласованность, classifier без reviewer-role, regex по тексту транзишена для closedToday, switchEvents штрафует review-focus, loggedTodaySec для не-worklog команд, narrative «вчера» в понедельник — это не баги, это методология. Если тимлид заметит хотя бы одно расхождение «в строке 14ч пик, в панели 11ч» (TZ) или «Иван закрыл 4 задачи — нет, ни одной» (closedToday regex) — доверие ко ВСЕМ числам падает. Restoring trust обходится дороже чем не уронить его изначально.

4. **Performance vs UX trade-off под угрозой**: search keystroke = full re-render (120ms→420ms на mid-range Android), panel filter pill = rebuild 1500-нодного heatmap, `_promoteTitlesToTooltips` × 4800 узлов — все это копится. На 100-person команде уже виден input lag, на 200+ — продукт становится неюзабельным в браузере на ноутбуке. Если roster будет расти (мульти-команда / kontora-view), без virtualization + partial render + content-visibility этот scale-cliff наступит до конца квартала.

## Что не вошло

- **Heatmap nornalization** (signal-quality #8) — перцептивный спор без consensus между rolemax / personmedian / teammedian, нужен пилот-feedback. Откладывается до фактов.
- **Productivity-chips: удалить vs обернуть в consent flow** — product-jobs предлагает удалить PROD/SWITCH/LOC; UX/UI предлагает «explicit toggle с tutorial»; accessibility склоняется к «нейтральные labels»; signal-quality не возражает против удаления. Финальное решение должно быть продуктовым (есть ли job у engineering manager для composite-метрик в operational scanner'е) — отдельная встреча.
- **«Сегодня/Вчера» dot-strips: упростить или удалить** — UX/UI хочет заменить на 8-bucket; product-jobs ставит низкий приоритет; signal-quality указывает на TZ-проблему. Зависит от outcome'а 3-tier amortization sprint'а.
- **LLM narrative как primary vs rule-based fallback** (product-jobs #13) — radical refactor с продуктовыми последствиями, нужен LLM cost analysis (если auto-fetch на каждый open panel'и — счёт GigaChat) и UX-research что именно ценнее.
- **Mentor-mentee / Retention Radar / Time Machine** (killer-features) — требуют robust 60-day history, текущий history shape не подходит для per-person time-series. Foundation-проект 4-6 недель, не 2-week sprint.
- **Cross-team comparison / platform benchmarks** (killer-features #15) — политически чувствительно, нужна cross-team aggregation infra и privacy review.
- **Communication signal / Teams/Slack API** (signal-quality #15) — нужны integration discussions и corporate политика, отдельный sprint.
- **Server-side full PR pool для CRV** (signal-quality #11) — refactor server endpoint, координация с backend, отдельный sprint.
