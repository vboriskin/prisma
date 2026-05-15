# AUDIT_HOLISTIC.md — этап 14/14 · Сквозной взгляд на Призму

> Команда: продакт-директор + системный продуктовый дизайнер. Этот этап смотрит **поверх** разделов и команд: ищет паттерны, повторяющиеся в 3+ аудитах; фичи, которые живут на стыках; AI и автоматизацию, которые применимы платформенно; пути пользователя через несколько секций; устаревшее; платформу.
>
> Основа — 13 предыдущих файлов: MAP, TECH (53), UX (56), LAYOUT (54), ARTDIRECTION (38), MASCOT (33), LLM (50), COPY (61), DEVOPS (38), QA (66), SCANNER (50), SCANNER_METRICS (36), ARCHITECTURE (38), MIGRATION.
>
> Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`.
> Дата: 2026-05-07.

---

## TL;DR (для тех, кто читает 60 секунд)

Призма — продукт со здоровым ядром (vanilla-JS, identity-deterministic интеграции, Reactive proxy, маскот, splash) и **быстро накапливающимся слоем дублирования**: 4 системы для motion-easing, 3 toast-API, 12 native `alert/confirm`, 17+ эмодзи в LLM-промптах, 60→21 чарт в metricsDeep с 66% синтетики, 120+ `*-card` классов, 50 уникальных z-index, 7 несовместимых empty-states. Самые ценные сквозные ходы — **глобальный Cmd+K, единая платформа для bulk/preview/undo, AI-frame primitive (insight-glow + маскот в углу), сохранённые представления, унифицированный rule-engine «Гигиена» поверх всех data-views и единый объект `state.meta` (currentUser, permissions, featureFlags, lastSeen) которого сейчас нет**.

Главный системный риск: **AI-разделы (10/11/13) — 3 параллельных движка с дублированной логикой**, при этом ни один не передаёт «думаю» как ощущение. Главный системный долг: **god-modules не одного файла, а одного класса** (`teamScanner2Renderer.js` 4.9k, `server.js` 6.5k, `gantt.js` 2.8k, `styles.css` 20k, `index.html` 1.7k) — это не про React, это про то, что нет правила «≤800 LOC и `audit-trail`» как закона CI.

---

## 1. Сквозные паттерны и боли (что повторяется в 3+ разделах = системно)

| # | Паттерн / боль | Где видно | Серьёзность | Решение (платформенное, не точечное) |
|---|---|---|---|---|
| 1 | **Native `alert/confirm/prompt` × 12+ в data-store** при наличии готового `ConfirmDialog`/`ToastQueue` (`app/uxKit.js`). | UX C1, COPY 51, TECH 6 | high | Codemod: auto-replace `alert/confirm/prompt` → `ToastQueue.show / ConfirmDialog.show`. ESLint-rule `local/no-native-dialogs`. |
| 2 | **Эмодзи в LLM-промптах и AI-fallback × 17+** при правиле «no-emoji в production UI». | COPY 25/30/40/57, ART 21/22/34/35, MASCOT-карта (toast-mascot mute) | high | Заменить data-icon → Lucide-key (`{iconKey:'alert-triangle'}`); ESLint-rule `local/no-emoji-in-templates` для `chat/*` и `ai/*`. Один pass закрывает 4 раздела. |
| 3 | **`JSON.parse(...)` без try/catch × 5+ путей** (integrationsStore, scanner queue, scanner audit, prompt-overrides, llmClient response). | QA A16.1/A16.2/A17.1, LLM F1, TECH catch(_) {} | critical | Helper `safeJsonParse(raw, fallback)` + ESLint `local/no-unsafe-json-parse`. Один helper × 30 callsites. |
| 4 | **Loading-state отсутствует в 5+ views** (Дашборд, Метрики, Реестр, Сотрудники, Таймлайн) при том что в AI-views и Сканнере он есть. Skeleton/shimmer не унифицирован. | UX «Сквозное», ART 4, LAYOUT 25 | high | Один `prizmaLoaderMark` + 1 skeleton-system; контракт: «view с >300 ms в render — обязан показывать loader». |
| 5 | **Empty-state inconsistency × 7** (7 разных копирайтов, 3 разных шаблона). | UX «Сквозное», COPY 1/9/15/18, ART 27 | medium | Один `renderEmptyState({title, hint, action, illustration})` + единый словарь копи (rebuild через codemod). Маскот как опция вместо звезды. |
| 6 | **Снимок через `JSON.parse(JSON.stringify(...))` × 5+** (HistoryManager, registry copyRow, employees, scanner diagnostic) — теряет Date/Map/Set, ломает undo. | TECH 3, QA A3.4/AS.6, scanner diagnostic | high | `structuredClone` + helper `Snapshots.deepClone` + tests на типы. |
| 7 | **`addEventListener` без `removeEventListener` / без `AbortController` × 88+ в Сканнере, 39 в Ганте**, утечка handler'ов на длинных сессиях. | TECH 3.4/4/17, MASCOT раздел 2 | high | `local/listener-must-have-abort` ESLint + helper `withAbort(target, type, fn, ctx)`. |
| 8 | **`Storage.save()` напрямую из views × 30+ мест в registry** (контракт ARCHITECTURE.md прямо запрещает). | ARCH A.2 (A2), TECH 3, AS.3 | high | ESLint `local/no-direct-storage-save-in-views`. Replace на mutation. |
| 9 | **Двойной API: `showToast(msg,type,ms)` legacy и `showToast({...})` × 75 callsites** + параметр `'warn'` vs `'warning'`. | COPY 47, UX «Сквозное», MASCOT раздел 5 | medium | Один API; codemod legacy → object-form; gauntlet-test. |
| 10 | **Брендовая фраза «Курс сверен/не сверен» девальвирована × 23 места** — используется как универсальный success/error. | COPY 48/49 | high | Зарезервировать «Курс сверен» для редких событий (welcome, plan-lock). Везде иначе — нейтральные success-формулы. |
| 11 | **Нет request-id в server-handlers** (logger.withReqId написан, не используется). Невозможно trace path запроса. | DEVOPS 7.5 | high | 5 строк в `http.createServer` callback'е. Один pass. |
| 12 | **Frontend `scrubChatSecrets`/`Utils.scrubPii` ≠ server-side scrub ≠ telemetry scrub** — 3 параллельных набора правил, дрейф неизбежен. | LLM S3/S4/S11/S15, TECH 13, DEVOPS 5.7 | high | Один `pii.js` + `secrets.js` shared-module (re-used в client + server + telemetry). |
| 13 | **3 ease-namespace** (`--ease-*`, `--prizma-ease-*`, `--obs-ease-*`) + 20 ad-hoc cubic-bezier; **3 системы скролл-lock** (`:has`, `body.modal-open`, `html:has`). | LAYOUT 36, MASCOT 4, ART 14 | medium | Один namespace `--prizma-ease-*` + alias из остальных. Один `body.is-modal-open` класс из JS. |
| 14 | **Drill-down фильтры мутируют `state.filters` без attribution** — пользователь не понимает откуда фильтр пришёл. | UX exec/dashboard/aiCeo, COPY 55 | medium | `state.filters._source` + breadcrumb «Из Дашборда → ...» в filter-bar. URL-hash ditto. |
| 15 | **Идемпотентность кнопок отсутствует**: двойной клик на «Применить» / «Refresh AI» / «Test connection» — 2 запроса. | QA A12.1, A16.3, UX 16 | medium | Шаблон `withInflight(button, fn)` (disable + spinner) — единый helper. |
| 16 | **Latency feedback отсутствует** для long-running operations (LLM 25s, Pulse 1.5min, ECharts mount 1.2s). Прогресс/ETA нет. | UX 17, SCANNER 35-37, SCANNER_METRICS F-PERF-1 | high | Прогресс-bar/ETA convention для всех операций >2s. |
| 17 | **Cross-tab desync**: 2 вкладки, last-writer-wins. | QA AX.2 | high | `window.addEventListener('storage', ...)` + `BroadcastChannel('prizma')`. |
| 18 | **Нет `state.currentUser` / `state.permissions` / `state.featureFlags` / `state.meta.lastSeen`** — **критический архитектурный пробел**: любая фича авторизации, флагов или «что нового» упирается в их отсутствие. | LLM S1, DEVOPS 6.5, MASCOT I5 | critical | Ввести `state.meta = { user, permissions, featureFlags, version, lastSeenVersion, lastActiveAt }`. Это разблокирует 8+ других идей. |

---

## 2. Сквозные фичи (10 штук, которые живут МЕЖДУ разделами)

| # | Фича | Что даёт | Где живёт | Сложность | Зависимости |
|---|---|---|---|---|---|
| F1 | **Глобальная командная палитра Cmd+K** | мгновенный jump в любой раздел / эпик / задачу / employee + быстрые actions (apply preset, open settings, run AI block). Сейчас Cmd+K есть только в Ганте. | shared `app/commandPalette.js` | M | requires F2 (search index) |
| F2 | **Сквозной полнотекстовый поиск** — единый индекс по `state.rows + state.employees + scanner.participants + history`. | один search bar в topbar; результаты с группировкой «Задачи / Сотрудники / История». | новый `app/globalSearch.js` + индексы из `_searchIndex` (уже частично в filters.js) | M | F1, F18 (saved views контекст) |
| F3 | **Сохранённые представления (saved views)** | тимлид утром ≠ заново выставляет фильтры. Per-section presets с именем, иконкой, share-link. | `state.savedViews[]` + кнопка «Сохранить как…» в filter-bar; `app/views.js` | L | UX «Сквозное» finding |
| F4 | **Единый центр уведомлений (notification panel)** | сейчас 4 канала: toast-queue, mascot-pulse, FAB-ring, badge на nav. Тимлид пропускает события если не у экрана. | `app/notifyCenter.js` + bell-icon в topbar; persistent в `state.notifications[]` | M | связан с MASCOT I2 mood-ring |
| F5 | **Bulk-операции как платформа** — preview перед apply, prog-bar, undo, dry-run, audit-trail. | сейчас bulk есть в Реестре и Сканнере (Гигиена) — два разных API. Объединить. | `app/bulkPlatform.js` (preview, dryRun, apply, undo) — re-used в Registry / Hygiene / Action Layer / AI-batches | L | F18 (state.meta.permissions) |
| F6 | **Глобальный undo/redo c хронологией шагов** | сейчас Ctrl+Z делает только undo последнего mutation; нет ленты «что я делал последние 30 минут» с возможностью вернуться к шагу N. | расширить `historyManager.js` (snapshots + tags) + UI «Поток действий» в topbar | L | связан с F4 |
| F7 | **Версионирование плана (snapshots по дате)** | «как выглядел план 14 дней назад», diff с сегодня, цитирование snapshot'а в SteerCo. | `state.snapshots[]`, server-side persist (`/api/state/snapshot`) | L | DEVOPS 10.1 |
| F8 | **Комментарии и треды на любом объекте** (row, epic, employee, hygiene-violation, sprint, sleeping-data tile) | вместо личной задачи в Jira — обсуждение в контексте. | `state.threads[{anchorType, anchorId, messages[]}]` + drawer «Discussion» | L | F18 |
| F9 | **Шаринг ссылок с фильтром и контекстом (deep-links)** | `#registry?team=Alpha&sprint=PI-1.21` сейчас не работает — `state.filters` не сериализуется в URL. | `app/router.js` (hash-based) + 2-way bind с `state.filters` | M | UX «Сквозное» finding |
| F10 | **Сквозной audit-log поверх всех модулей** (history-log + errorsLog + telemetry + server-NDJSON) | сейчас 4 параллельных лога, дрейф shape. | unified `LogStore({kind:'history'|'errors'|'audit'|'security'})` + viewer | M | TECH «Кросс: history log», DEVOPS 9.2 |
| F11 | **Mascot mood-ring** (барометр портфеля) | маскот не просто FAB, а отражает состояние плана: drift → concerned, off-course → alert, on-course → blink/breathe. | `app/mascotMood.js` подписан на `riskEngine` + `Insights` | M | MASCOT I2 |
| F12 | **Workspace settings panel (settings 2.0)** | сейчас настройки разбросаны: AppSettings, integrations modal, prompts editor, теме, маскот (которого нет в settings). Один экран. | `views/settingsView.js` (replace fragmented dialogs) | M | F18 |

---

## 3. AI поверх продукта (где LLM даёт ценность ВНЕ чата)

| # | Идея | Сценарий | Стоимость токенов | Эффект |
|---|---|---|---|---|
| AI1 | **Объясни этот экран** (universal explain) — глобальный hotkey `?`, click на любой блок → LLM объясняет «что показывает / как считается / что делать если плохо». | новичок открыл «Перегрузку» — не понимает «Gini 0.42»; нажал `?` — получил contextual explainer. | низкая (cached prompt + chart-meta only) | high — закрывает SCANNER_METRICS F-EXPL-1 + COPY 22 + UX 8 |
| AI2 | **Естественный язык → действие** — в `app/commandPalette` (F1) дополнительно ввод свободным текстом. «Назначь блокеры команды Альфа на следующий релиз с комментарием X» → preview-batch. | заменяет 5 кликов в Реестре + bulkEditPanel. | средняя (intent + preview JSON ≤2k токенов) | high — bridges chat-actions ↔ Гигиена ↔ bulk-platform |
| AI3 | **Авто-summary для длинных списков** — Action queue (top-5), Sleeping Data tiles, Hygiene violations, history filtered → одна LLM-фраза «суть и приоритет». | вместо «23 violations» — «23, из них 18 без assignee — это 4 эпика, в основном `ALPHA-checkout-*`». | низкая (рутинный rule-extraction + LLM-ретушь) | medium |
| AI4 | **Семантический поиск** (поверх F2) — «задачи похожие на ALPHA-123», «epics about payments» — embeddings над `summary+description+tags`. | сейчас поиск только substring. | средняя (один embedding-call на rebuild + retrieval) | medium — требует RAG, явно отсутствует (LLM RG1) |
| AI5 | **Авто-заполнение полей по контексту** — открыл новую row, AI предлагает team / scope / release / assignee на основе соседних эпиков и стиля автора. | устраняет 5 dropdowns × 5 sec. | низкая (1 запрос на open-edit) | high — заметно ежедневно |
| AI6 | **Проактивные инсайты** (push, не pull) — раз в день LLM смотрит diff и шлёт «3 эпика просели, 1 ушёл из release scope, 5 новых без оценки». В notification center (F4). | заменяет ритуал утреннего скана. | средняя (1 запрос/день/команда) | high — ключевая ценность для CEO |
| AI7 | **Черновики коммуникации** — «открой текст для SteerCo на основе текущего состояния», «напиши Slack-сообщение что блокер ушёл», «составь stand-up brief». | сейчас тимлид сам формулирует. | средняя | medium |

---

## 4. Автоматизация рутины (5 ходов, объединяющих повторяющиеся действия)

| # | Идея | Триггер | Реализация |
|---|---|---|---|
| AU1 | **Workflows по правилам** — пользователь определяет: «когда задача in-progress >5 дней без коммитов → ping assignee, mark hygiene, повторить через день». | условные сценарии в settings | новый `app/workflows.js` + декларативный YAML/JSON; reuse Hygiene rule-engine из SCANNER §Б |
| AU2 | **Cron / scheduler для regular operations** — auto-snapshot 9:00, auto-Pulse-refresh 8:00 + 14:00, weekly digest, alert при score-drop ≥5. | server-side cron (или client при открытой вкладке) | server endpoint `/api/scheduled/run`; persist в `JOBS_PERSIST_DIR` |
| AU3 | **Macros и pinned actions** — пользователь записывает последовательность («apply filter X → bulk-edit Y → export Z») как именованный macro. | recorder в Action Layer | расширение `actionLayer.js` regсистрии |
| AU4 | **Auto-merge of duplicate detections** — Гигиена находит дубли тикетов; вместо ручного триажа — авто-`won't fix` для top-90% confidence + email с дайджестом. | rule-engine + LLM-confirmation | re-use Hygiene Q-01 |
| AU5 | **Опт-in tone-of-voice линт LLM-output** — перед показом ответа в чате/AI — фильтр: «есть ли эмодзи / английские термины / `Курс сверен`-overuse». | post-processor в `chatUIRenderer` | один pass, реализуется как middleware |
| AU6 | **Self-heal job stack** — Pulse-job 6мин залип → server auto-restart (`server.js` HARD_BUDGET_MS уже есть, но без restart) + UI «попытаемся ещё»; client-side также retry на 401 (был только на одном path). | `server/jobs.js` decompose | DEVOPS 6, TECH 17 |

---

## 5. Перекрёстные пути пользователя (3 сценария, где теряется контекст)

### Сценарий 1. «Утро тимлида» (Дашборд → Сканнер → Сотрудник → AI Анализ → Действия)

**Текущее**: 5 секций, 5 разных empty/loading states, 5 разных способов вернуться обратно. Тимлид видит "блокер у Иванова" в дашборде → click ведёт в Реестр (не в Сканнер); потом руками в Сканнер → ищет Иванова заново; → AI Анализ открывается отдельно и не знает про Иванова; → Действия — ещё один tab без контекста.

**Боль**: 4 раза заново выставить контекст «Иванов в команде Альфа за неделю».

**Сокращение**: единый «контекст-якорь» в state.meta.focus = `{kind:'employee', id:'ivanov', period:'7d'}`. Все секции читают его. Маскот в углу подсвечен `obs--cur` — «я смотрю с тобой». Возврат через Cmd+[ / Cmd+] (browser-style history).

### Сценарий 2. «Подготовка к SteerCo» (CEO-режим → AI CEO → Чёрный дашборд → Метрики → AI Анализ → Экспорт)

**Текущее**: 6 ритуальных секций со своими LLM-pipelines (3 разных AI-движка). Каждая делает свой fallback rule-based текст. CEO копирует руками в Slides.

**Боль**: 6 разных карточек, отчёт собирается вручную, нет «единого нарратива».

**Сокращение**: `views/exec.js` агрегирует выходы AI CEO + AI Анализ + Чёрный дашборд + Гигиена в один read-out (см. ART находка 23). Кнопка «Экспорт в slide-deck markdown / pptx outline».

### Сценарий 3. «Починка плана перед planning'ом» (Реестр → Гигиена → Bulk → Преview → Apply → History)

**Текущее**: bulk-edit в Реестре, отдельный bulk в Гигиене (сейчас design-doc), Action Layer — третий канал. История — отдельная вкладка. Нет «черновика плана».

**Боль**: непонятно, какие изменения «применил, но не зафиксировал».

**Сокращение**: единый `bulkPlatform` (F5) с режимами `dry-run / preview / apply / undo`; "draft mode" для квартального плана (F7 snapshots).

---

## 6. Что устарело и подлежит переделке

| # | Устаревшее | Решение |
|---|---|---|
| O1 | **`testRunner.js` legacy + 104 legacy-test описание** (DEVOPS 2.2) — должны быть migrate'нуты в `node:test`. | retire в V18 P12, удалить из CI. |
| O2 | **3 системы persistence** (`localStorage`, `appDataStore`, `sqliteStore`) с runtime-switch без migration-path в обе стороны (TECH «Кросс: storage layer»). | один `Storage` interface с pluggable backend; миграции через `app/migrations.js` с явным confirm. |
| O3 | **`PodlozhkaView` + `summaryMode`** — мёртвый код в state, помечен `// удалить после миграции` (TECH 6) | bump version и drop. |
| O4 | **`renderDailyBrief` stub в Сканнере** + `buildDailyBrief()` Insights — инфраструктура есть, render пуст (SCANNER 02) | либо восстановить, либо удалить infra. |
| O5 | **40 / 60 чартов в metricsDeep — синтетика sin/cos/random** (SCANNER_METRICS F-FAKE-*). | удалить категорию «Активность» полностью; оставить только реальные данные; ввести `metricsHistory` writer. |
| O6 | **3 параллельных AI-движка** (`aiView` 13 блоков, `aiCeoView` + `aiCeoFallback`, `exec` агрегатор) с дублированной fallback-логикой | один `AIPipeline` с реестром блоков, один fallback-engine, разные view = просто конфигурация блоков. |
| O7 | **2 «Метрики»** — top-level `views/metrics.js` и sub-tab внутри Сканнера (SCANNER A.2). | переименовать sub-tab в «Графики» или «Тренды»; явное разделение portfolio vs team. |
| O8 | **«Действия» (`actionLayer`) и Action queue в Сканнере** — два параллельных списка действий | bridge: queue → создаёт ticket в actionLayer; единая лента действий по командам. |
| O9 | **20 «funny-loader» фраз с эмодзи** (`FUNNY_PHRASES`) контрастируют с компасным брендом | удалить или перевыпустить через mascot phrase-bank без эмодзи. |
| O10 | **Inline `style.X` в JS × 120+** в Ганте/Реестре конкурируют с CSS, ломают theme-switch и `prefers-reduced-motion` | CSS custom-properties через `setProperty('--x', val)` + ESLint правило. |

---

## 7. Платформенные улучшения (невидимые пользователю, но критичные)

| # | Платформенное | Что | Эффект |
|---|---|---|---|
| P1 | **Дизайн-система Pz** (`pz-card` / `pz-chip` / `pz-badge` / `pz-modal`) с data-attr вариантами | заменяет 120+ `*-card` / 71 `*-chip` / 63 `*-badge` / 59 `*-modal` уникальных классов | dramatically снижает поддержку CSS, ускоряет новые экраны, фиксирует тон |
| P2 | **Token-coverage gate** в CI — `grep '#[0-9a-f]{6}' styles.css` lint-budget; новые raw hex запрещены | сейчас 503 raw hex / 209 уникальных, ⅓ цветов мимо токенов | dark-theme парность, brandbook discipline |
| P3 | **Единый event-bus + state-context object** вместо 50+ `window.*` глобалов | сейчас невозможен tree-shake / тесты в изоляции / типизация | разблокирует декомпозицию `app.js` (god-module), open path к V18 |
| P4 | **Единый PII/secrets module** (`shared/pii.js`, `shared/secrets.js`) reused в `client + server + telemetry + LLM-payload` | 3 параллельных whitelist'а — гарантированный дрейф | закрывает LLM S3/S4/S11/S15, DEVOPS 5.7 |
| P5 | **Feature-flags** через `state.meta.featureFlags` + server `/api/flags` | сейчас локальные `localStorage.PRIZMA_*` непрозрачные; невозможно «выключить feature X у всех» | A/B, поэтапные раскатки, kill-switch |
| P6 | **Permissions matrix** (`state.meta.permissions = { canBulkEdit, canChangeScope, canMarkDone, ... }`) | сейчас любой клик на preview-chip может удалить блокеры всем (LLM S1) | критическое security-fix; разблокирует enterprise-distribution |
| P7 | **Telemetry events convention** — `domain.action[.qualifier]` шкала, single helper `Telem.track(name, data)` с PII-scrub встроен | 3 параллельных канала (`HistoryLog.event`, `_telLLM`, raw `console.log`); event-имена не стандартизованы | observability + UX-метрики становятся реальностью |
| P8 | **Документация-как-код**: один `docs/` единый, `docs/glossary.md`, `docs/tone-of-voice.md`, `docs/state-shape.md` — генерируются из JSDoc и audit-папок | 5 audit-папок не интегрированы; `ARCHITECTURE.md` устарел на 2 версии | LLM-onboarding (CLAUDE.md уже паттерн) — делает Призму AI-friendly для контрибьюторов |

---

## 8. Топ-15 сквозных идей (сводная таблица)

| # | Идея | Тип | Боль (что закрывает) | Разделы | Сложность | Эффект | Зависимости |
|---|---|---|---|---|---|---|---|
| 1 | **`state.meta = { user, permissions, featureFlags, version, lastSeenVersion }`** | платформа | LLM S1, DEVOPS 6.5, MASCOT I5, любая permission/A-B-логика | все | M | high | ничего, разблокирует 8 идей ниже |
| 2 | **Единый PII/secrets/scrub module shared client+server+telemetry+LLM** | платформа | LLM S3/S4/S11/S15, DEVOPS 5.7, TECH 13 | LLM, integrations, scanner, telemetry | M | high | ничего |
| 3 | **Глобальный Cmd+K + полнотекстовый поиск** | фича | UX 4, fragments гонок «найти Иванова/эпик/команду» | все | M | high | F2 (search index) |
| 4 | **Сохранённые представления (saved views) в каждом разделе** | фича | UX «Сквозное», ежедневный ритуал тимлида | Реестр/Гант/Сотрудники/Метрики/Сканнер | L | high | F9 deeplinks |
| 5 | **AI-frame primitive: insight-glow + маскот в углу + 3px insight-stripe** | AI/паттерн | ART 20/26/B, MASCOT раздел 2/I3 | AI CEO, AI Анализ, CEO-режим | L | high | RICH_OBS_SVG hooks (MASCOT critical) |
| 6 | **Bulk-platform (preview / dry-run / apply / undo / audit-trail)** | платформа | UX 12, QA A3.6/A12.1, SCANNER Гигиена Б.6 | Реестр, Гигиена, Сканнер, ActionLayer | L | high | #1 (permissions) |
| 7 | **Единый `Storage`-interface (localStorage / SQLite / server-snapshot)** + migrations + restore-test | платформа | TECH «Кросс: storage», DEVOPS 10.1, QA AS.1/AS.2/AS.3 | Persistence, Backup | L | high | ничего |
| 8 | **AI: «Объясни экран» через `?` хоткей** | AI | SCANNER_METRICS F-EXPL-1, COPY 22, onboarding | все | M | high | meta-описания блоков (F-EXPL-1) |
| 9 | **AI: проактивные инсайты + центр уведомлений** | AI/фича | UX 4, отсутствие push-инсайтов, scattered notifications | все | L | high | F4 notify center, scheduler AU2 |
| 10 | **Pz design-system (`pz-card / pz-chip / pz-badge / pz-modal`)** + token-coverage CI gate | платформа | LAYOUT critical 11/31/36/41/44/52/53, ART | весь UI | L | high | сначала P1 codemod-фаза |
| 11 | **«Гигиена» как rule-engine поверх ВСЕХ data-views (не только Jira)** — реестр-rules, employee-rules, doc-debt-rules — один config-driven движок | платформа/фича | SCANNER §Б полностью + UX 7-9-15 | Реестр, Сотрудники, DocDebt, Сканнер | L | high | #6 bulk-platform |
| 12 | **Mood-ring маскот = барометр портфеля** | фича/паттерн | MASCOT I2, ART «Особое внимание», теплота тона | все (FAB глобально) | M | medium | RICH_OBS_SVG hooks, #11 mood-source |
| 13 | **Cmd-K + Natural Language → preview-batch (NL2Action)** | AI | UX «дрейф фильтров», LLM tools auto-execute | Реестр / Гант / Гигиена / Bulk | L | high | #3 Cmd-K, #6 bulk-platform |
| 14 | **Унификация `showToast` → `Toast.success/error/info/loading` + mascot-phase + subText** | паттерн | COPY 47/48/49, MASCOT раздел 5 (subText/mascot mute) | все | S | medium | ничего |
| 15 | **Cross-tab sync через BroadcastChannel + версия в footer** | платформа | QA AX.2, DEVOPS 4.1, multi-window data loss | все | S | medium | ничего |

---

## Разрезы и связки (как читать таблицу)

- **Идеи 1, 2, 7, 10 — фундамент.** Без них остальное недоделается чисто. Сделать первыми.
- **Идеи 3, 4, 6, 14 — daily-flow ускорители.** Тимлид заметит за 1-3 дня.
- **Идеи 5, 8, 9, 13 — AI-присутствие как ощущение.** Сейчас AI = «отчёт по rule-based» (ART «AI таблички»); эти 4 идеи переводят его в «второй мозг».
- **Идея 11 — стратегический long-bet.** «Гигиена как платформа» убирает дубли между EstimationCalibration / ComponentHealth / DocDebt / Sleeping data — это ~30% поверхности продукта.
- **Идея 12 — единственная идея про эмоцию**, остальные про функцию. Маскот сейчас декоративный, должен стать барометром.
- **Идея 15 — простая страховка** (cross-tab + версия в footer): минимум усилий, закрывает целый класс багов.

---

## Что НЕ предлагается (намеренно)

- **Миграция на React** — AUDIT_MIGRATION однозначно говорит «нет», все «реальные боли» решаются на текущем стеке.
- **Удалить маскота / эмодзи в чате / ECharts** — каждое предложение балансируется бренд-оценкой и не должно быть дешёвой жертвой.
- **Бандлер / монорепо** — ARCHITECTURE: vanilla — актив, не легаси.
- **Forced theme** для Чёрного дашборда — ART рекомендует «Решение B без forced»; не вводим disorienting режим.
- **Расширение FUNNY_PHRASES** в маскот phrase-bank — пока нет `docs/tone-of-voice.md`, добавлять голос маскоту опасно.
- **Полная переписка `styles.css` на CSS Modules** — 20k LOC, 6+ ч/мес — несоразмерно эффекту; постепенная декомпозиция через P1 + token-coverage gate (P2).

---

## Связи с другими этапами

- **Идеи 1-2** требуют синхронизации с DEVOPS (sec headers, `.env.example`), LLM (S1, S16), QA (test coverage).
- **Идея 3 (Cmd-K)** — финальный пункт UX «Сквозное», ART 23 (CEO-режим navigation), SCANNER 31.
- **Идея 5 (AI-frame)** связана с MASCOT critical RICH_OBS_SVG hooks — без них glow / маскот в AI углу не оживут.
- **Идея 6 (bulk-platform)** объединяет AUDIT_SCANNER §Б (Гигиена), QA A3.6, UX 12, COPY 60.
- **Идея 11 (rule-engine)** — расширение AUDIT_SCANNER §Б до универсальной платформы.

---

## Метрики успеха через 30 / 90 дней

| Метрика | Сейчас | 30 дней (после идей 1-2-14-15) | 90 дней (после 1-15) |
|---|---|---|---|
| Сценарий «утро тимлида» (открытие → решение) | ~6 минут (5 секций ручной context-switch) | ~3 минуты | ~90 секунд (Cmd+K + saved view + AI-summary) |
| % раздач с native `alert/confirm` | 100% | 0% (codemod) | 0% |
| Эмодзи в production UI | 17+ | 0 (одним pass'ом) | 0 |
| Уникальных font-size / z-index / box-shadow | 32 / 50 / 105 | 32 / 50 / 105 | 8 / 7 / 5 (после P1+P2) |
| AI-views читаются как AI (subjective brand survey) | 2/10 | 4/10 (insight-stripe + caption) | 8/10 (mood-ring + glow + маскот в углу) |
| Cross-tab data loss инцидентов | случается | 0 (BroadcastChannel) | 0 |
| Permissions-bypass risk (LLM S1) | критический | критический (если #1 не сделана) | закрыт (#1+#6) |

---

## Финальная мысль

Призма уже умеет **больше**, чем кажется на поверхности — `_ppFindByPartial`, `EmployeeFactory.detectGhost`, `bigMetrics.reopenRate`, `computeContextSwitches`, `computeEstimateAccuracy`, `Hygiene rule-engine` (design-doc). Проблема не в недостатке функций, а в том, что **они спрятаны в god-modules за дубликатами и не имеют единого api**.

Ребрендинг V21 / Spine-pill — это поверхность. Сквозная зрелость — это:

1. Один state-meta объект с user/permissions/flags/version.
2. Один способ показать loading / empty / error.
3. Один bulk / undo / preview.
4. Один rule-engine для гигиены любого data-view'а.
5. Один маскот, который не декорация, а барометр.
6. Один AI-frame, который читается как «думает».
7. Один Cmd+K, который ведёт куда угодно.

Семь «один». Это и есть holistic уровень — там, где product-direction перестаёт быть про разделы и становится про продукт.

---

*Сгенерировано Этапом 14/14. Команда: продакт-директор + системный продуктовый дизайнер. Источники: 13 предыдущих AUDIT_*.md + cross-stage синтез. Не дублирует находки внутри разделов — все 15 идей живут на стыках.*
