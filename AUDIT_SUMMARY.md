# AUDIT_SUMMARY.md — единый верхнеуровневый отчёт ночного аудита Призмы

> Сводка 14 этапов аудита (TECH / UX / LAYOUT / ARTDIRECTION / MASCOT / LLM / COPY / DEVOPS / QA / SCANNER / SCANNER_METRICS / ARCHITECTURE / MIGRATION / HOLISTIC) над Призмой v22.
> Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`. Дата: 2026-05-07.
> Все находки — со ссылкой на исходный аудит и строку проекта (где есть). Severity / потенциал / трудозатраты унифицированы.

---

## 1. Executive summary

Призма — внутренний quarterly-планировщик (vanilla-JS, ~44k LOC + один Node-сервер `server.js` 6.5k LOC) с identity-deterministic интеграциями (Jira Delta+Sigma / Bitbucket / Confluence / Zephyr / Jenkins / GigaChat). Ядро здоровое: Reactive Proxy, identity-таблица сотрудников, splash + breathe-mark + маскот «Обсидиан», логирование с PII-scrub, `/health`+`/ready`+`/metrics`. На поверхности — V21 «Spine-pill» ребрендинг идёт, но 70% data-views всё ещё «средне-корпоративный enterprise», а не «компас».

**3 главные сильные стороны:** (1) брендовая оболочка topbar/splash/маскот собрана со вкусом — это самый сильный визуальный актив; (2) контракты state (`Reactive.silent`, identity-deterministic, `_scrubSecrets`) — продуманы и пережили 5 эпох audit-папок; (3) vanilla без бандлера — сознательный выбор compliance/supply-chain immunity, миграция на React невыгодна (см. §11).

**3 главные системные проблемы:** (1) god-modules — `teamScanner2Renderer.js` 4890 LOC, `server.js` 6486 LOC, `gantt.js` 2804 LOC, `styles.css` 19995 LOC, `app.js` 2208 LOC — каждая правка стоит часа навигации; (2) дублирование без общей платформы — 4 motion-системы, 3 toast-API, 3 AI-fallback engine'а, 7 empty-state копирайтов, 120+ `*-card` классов, 50 z-index; (3) AI-разделы (10/11/13) визуально не отличаются от rule-based отчётов 2018-го года — нет «думаю» как ощущения, и при этом 17+ эмодзи в LLM-промптах нарушают spine no-emoji rule.

---

## 2. Топ-5 critical (чинить срочно)

| # | Проблема | Раздел | Источник | Файл:строка | Severity | LOE |
|---|---|---|---|---|---|---|
| 1 | **Auth tools без permission-check**: любой пользователь через preview-чип может удалить блокеры / mark_done / переназначить scope 100+ задачам без role-проверки. Архитектурно нет `state.currentUser.permissions`. | LLM / state | AUDIT_LLM.md S1 + AUDIT_HOLISTIC.md #18 | `chat/chatActions.js:160-274,283-306` | critical | L |
| 2 | **SSRF в proxyChat**: `body.apiBaseUrl` принимается от клиента и без `_ssrfBlocked` фильтра — POST на любой URL. На 127.0.0.1+XSS = выкачивание кластерного state / EC2 metadata. | LLM / server | AUDIT_LLM.md S2 | `server.js:455-456` | critical | S |
| 3 | **Утечка всего реестра в external GigaChat**: `buildAppContextPayload` отправляет ВСЕ `state.rows` (включая чужие команды) + `assignee` без согласия (152-ФЗ риск). | LLM / data | AUDIT_LLM.md S5 | `app/llmAssistant.js:183-186` | critical | L |
| 4 | **localStorage quota overflow** на 5000+ строк → `Storage.save` отдаёт toast но данные в state остаются и теряются на F5 (нет force-flush на `beforeunload`). | Storage | AUDIT_QA.md AS.1 + AS.3 + AUDIT_TECH.md «Общее: dataStore» | `dataStore.js:82,129,155-184` | critical | L |
| 5 | **`teamScanner2Renderer.js` 4890 LOC god-module** + `server.js` 6486 LOC + `styles.css` 19995 LOC — рост блокирует декомпозицию, любой patch требует часа grep. | Архитектура | AUDIT_ARCHITECTURE.md #12,#17 + AUDIT_TECH.md раздел 17 / Общее | `integrations/teamScanner2Renderer.js`, `server.js`, `styles.css` | critical | L |

---

## 3. Топ-10 high-impact фиксов (большой эффект / разумная цена)

| # | Проблема | Раздел | Источник | Файл:строка | Severity | LOE |
|---|---|---|---|---|---|---|
| 1 | **OAuth `clientSecret` принимается в request body** — каждый XSS читает токен через DevTools. Перенести creds в server env. | LLM / server | AUDIT_LLM.md S16 | `server.js:436-438` | high | L |
| 2 | **`*`-transition в `theme.css:147`** — universal selector с 4-prop transition × десятки тысяч nodes на theme-switch = paint всего DOM. Сузить до 10-15 явных селекторов. | LAYOUT | AUDIT_LAYOUT.md #36 | `theme.css:147-153` | critical→S | S |
| 3 | **`box-shadow --shadow-xs` определён дважды** (rgba(0,0,0,.05) vs .55) — функциональный баг dark-theme. | LAYOUT | AUDIT_LAYOUT.md #43 | `styles.css:84,88` | high | S |
| 4 | **Native `alert/confirm/prompt` × 12+** в data-import path при готовом ConfirmDialog/ToastQueue. Codemod через `app/uxKit.js`. | UX / COPY | AUDIT_UX.md «Сквозное» + AUDIT_COPY.md #51 | `dataStore.js:418/533/549/551/617/618/707/850/871/882`, `app.js:865`, `app/uxKit.js:503/592` | critical→M | M |
| 5 | **Эмодзи в LLM/AI-fallback × 17+** — нарушает spine no-emoji rule, рендерится в чате (модель воспроизводит). | COPY / ART | AUDIT_COPY.md #25/#30/#40/#57 + AUDIT_ARTDIR.md #21/#22/#34/#35 | `ai/aiCeoFallback.js:264..581`, `ai/aiFallbackEngine.js:127..376`, `chat/chatActivityPrompts.js:43`, `integrations/portfolioPulseRenderer.js:38..1214`, `integrations/teamScanner2.js:1727..1899` | high | M-L |
| 6 | **`addEventListener` без cleanup × 88+ Сканнер, 39 Гант** — утечка handler'ов на длинных сессиях; перерасход reactive-flush (drag&drop без `Reactive.silent`). | TECH | AUDIT_TECH.md разделы 4 / 17 + AUDIT_QA.md A4.10 | `views/gantt.js`, `integrations/teamScanner2.js`, `views/registry.js:678` | high | M |
| 7 | **30+ direct `Storage.save()` в `views/registry.js`** при том что Reactive Proxy сам triggers save → дубль-flush + лишний disk I/O. ESLint guard. | Архитектура / TECH | AUDIT_ARCHITECTURE.md #5 + AUDIT_TECH.md раздел 3 | `views/registry.js:183..705` | high | M |
| 8 | **Identity-таблица employees без lock**: одновременный auto-create from Jira participants + manual edit = lost write. | TECH / 16 | AUDIT_TECH.md раздел 16 | `integrations/integrationsStore.js`, `integrations/integrationsSync.js` | high | M |
| 9 | **innerHTML XSS surface в Реестре + Сотрудниках × 17+** с интерполяцией пользовательских ФИО / ролей / тегов / комментариев. | TECH | AUDIT_TECH.md разделы 3 + 7 | `views/registry.js:158..816`, `views/employees.js:223..817` | high | M |
| 10 | **`metricsHistory` нигде не пишется** — все 60 чартов deep-metrics с трендами получают `[]`, и 40/60 чартов на синтетике sin/cos/random. | SCANNER METRICS | AUDIT_SCANNER_METRICS.md F-FAKE-3 + F-FAKE-1/2/4/5/6/7/8 + F-LIE-1/2/3 | `views/metricsDeep/dataAdapter.js:43-44`, `categories/*.js` | critical→L | L |

---

## 4. Топ-5 quick wins (S по трудозатратам, заметный эффект)

| # | Проблема / действие | Раздел | Источник | Файл:строка | Severity | LOE |
|---|---|---|---|---|---|---|
| 1 | **Добавить `.profile/` в `.gitignore`** — heap-snapshots содержат всю server-память включая Bearer-токены. Один `printf >> .gitignore` закрывает class риска. | DEVOPS | AUDIT_DEVOPS.md 5.6 / 10 magic-1 | `.gitignore`, `launch.js:80-83`, `server.js:6464-6486` | high | S |
| 2 | **`chmod 600 jira_config.json` при write** + `tmp+rename` atomic write. | DEVOPS / TECH | AUDIT_DEVOPS.md 5.2 + AUDIT_TECH.md раздел 16 | `server.js:621-624` (jiraWriteConfig) | medium | S |
| 3 | **Default `JOBS_PERSIST_DIR` → `~/.prizma/jobs/`** (вместо `/tmp` где macOS чистит). | DEVOPS | AUDIT_DEVOPS.md 10.2 | `server.js:2421` | high | S |
| 4 | **HTTP security headers в `writeJson`** (`X-Content-Type-Options:nosniff`, `X-Frame-Options:DENY`, basic CSP). | DEVOPS | AUDIT_DEVOPS.md 13.7 | `server.js:103` | medium | S |
| 5 | **Заменить статический `<<<SYSTEM_BOUNDARY>>>` на per-request nonce** — закрывает boundary-confusion в prompt-injection. | LLM | AUDIT_LLM.md S12 | `app/llmAssistant.js:1343`, `constants.js:15` | medium | M (но фактический patch ~S) |

Дополнительные quick-wins (резерв): rename `'warn'` → `'warning'` в `showToast` (COPY 47); снять `visibilitychange` reset в `_wireIdleHibernate` (MASCOT раздел 2); `timeout-minutes` per-step в CI (DEVOPS 1.4); `npm ci || npm install` → чистый `npm ci` (DEVOPS 1.2); replace `JSON.parse(JSON.stringify(...))` → `structuredClone` × 5 мест (HOLISTIC #6).

---

## 5. Топ-10 продуктовых идей (PRODUCT-части и HOLISTIC)

| # | Идея | Что даёт | Раздел | Источник | Потенциал | LOE |
|---|---|---|---|---|---|---|
| 1 | **`state.meta = { user, permissions, featureFlags, version, lastSeenVersion, lastActiveAt }`** — фундамент для авторизации, A/B, «что нового», маскот-persistence. | сквозное | AUDIT_HOLISTIC.md #1, #18 / AUDIT_LLM.md S1 / AUDIT_DEVOPS.md 6.5 | `state.js` (новое поле) | high | M |
| 2 | **Глобальный Cmd+K + полнотекстовый поиск** (Задачи / Сотрудники / История + actions) — сейчас Cmd+K есть только в Ганте. | сквозное | AUDIT_HOLISTIC.md F1+F2 / AUDIT_UX.md #4 | новый `app/commandPalette.js` + `app/globalSearch.js` | high | M |
| 3 | **Сохранённые представления (saved views)** в каждом разделе с share-link. | сквозное (Реестр/Гант/Сотрудники/Метрики/Сканнер) | AUDIT_UX.md «Сквозное» / AUDIT_HOLISTIC.md F3 | `state.savedViews[]`, кнопка в filter-bar | high | L |
| 4 | **AI-frame primitive**: insight-glow обводки + маскот в углу + 3px insight-stripe — превращает «AI-таблички» в «второй мозг». | AI CEO / AI Анализ / CEO-режим | AUDIT_ARTDIR.md #20/#26/B + #27 / AUDIT_MASCOT.md разделы 4+I3 / AUDIT_HOLISTIC.md #5 | `views/aiCeoView.js`, `views/aiView.js`, `app/obsidianMascot.js`, `RICH_OBS_SVG` | high | L |
| 5 | **Bulk-platform (preview / dry-run / apply / undo / audit-trail)** — единый движок для Реестра / Гигиены / ActionLayer / AI-batches. | сквозное | AUDIT_HOLISTIC.md F5/#6 / AUDIT_UX.md #12 / AUDIT_QA.md A3.6 | новый `app/bulkPlatform.js` | high | L |
| 6 | **Hero-звезда reactive: rotate ±2° на drift, signal-pulse на off-course** — материализует метафору «компас». | Дашборд | AUDIT_ARTDIR.md #1 / Топ-10 идей #1 | `views/dashboard.js:128-148`, `app/prizmaUI.js renderHero` | high | M |
| 7 | **AI: «Объясни этот экран»** через `?` хоткей — contextual explainer для блока (что показывает / как считается / что делать). | сквозное | AUDIT_HOLISTIC.md AI1 / AUDIT_SCANNER_METRICS.md F-EXPL-1 / AUDIT_COPY.md #22 | `app/explainOverlay.js` (новое), `views/metricsDeep` meta | high | M |
| 8 | **Маскот в empty-states + AI-states + mood-ring**: маскот-как-барометр (concerned на drift, alert на off-course). | сквозное (FAB глобально) | AUDIT_MASCOT.md I2/I6 + раздел 2 / AUDIT_ARTDIR.md «Особое внимание C» / AUDIT_HOLISTIC.md F11 | `app/obsidianMascot.js`, `app/mascotMood.js` (новое), `app/prizmaUI.js renderEmptyState` | high | M |
| 9 | **Чёрный дашборд — monochrome palette + tile-hero `#0A0A0F` solid** (без forced-theme): создаёт «комнату внутри продукта» для executive. | 18. Чёрный дашборд | AUDIT_ARTDIR.md #36/#37/#38 + «Особое внимание A» | `integrations/blackDashboardRenderer.js:296-326,333-435,445-478` | high | L |
| 10 | **Action-block доминирующий weight на Дашборде ×1.6 плотность**, остальное mute — глаз сразу видит «куда смотреть». | Дашборд | AUDIT_ARTDIR.md #2 / Топ-10 идей #7 | `views/dashboard.js:213-264` | high | S |

---

## 6. Топ-5 стратегических ставок (большие сквозные идеи)

| # | Ставка | Почему это меняет продукт | Раздел | Источник | Потенциал | LOE |
|---|---|---|---|---|---|---|
| 1 | **«Гигиена» как rule-engine поверх ВСЕХ data-views** (Jira / реестр / employees / DocDebt) — 24 правила в 4 группах (D/R/Q/M) + scheduler + LLM-обоснование per-click. | заменяет 4 параллельных view (EstimationCalibration, ComponentHealth, DocDebt, Sleeping data tiles) единой платформой; убирает ~30% поверхности дублей. | сквозное (Сканнер +) | AUDIT_SCANNER.md Часть Б полностью / AUDIT_HOLISTIC.md #11 | high | L (1 нед MVP, 1-2 мес V1+V2) |
| 2 | **Единый PII/secrets/scrub module shared client+server+telemetry+LLM** | сегодня 3 параллельных whitelist'а (`scrubChatSecrets` / `Utils.scrubPii` / server `_PII_PATTERNS`) — гарантированный дрейф. Закрывает LLM S3/S4/S11/S15 + DEVOPS 5.7 + TECH 13. | архитектура / safety | AUDIT_HOLISTIC.md #2/P4 / AUDIT_LLM.md S3..S15 / AUDIT_TECH.md «Кросс: telemetry» | high | M |
| 3 | **Pz design-system (`pz-card`/`pz-chip`/`pz-badge`/`pz-modal`) + token-coverage CI gate** | 120+ `*-card` / 71 `*-chip` / 63 `*-badge` / 59 `*-modal` уникальных классов → 4 базовых + variants. Brandbook discipline становится принудительным. | LAYOUT / визуальный язык | AUDIT_LAYOUT.md #52/#53/#7-#13/#36-#54 / AUDIT_HOLISTIC.md #10/P1+P2 | high | L |
| 4 | **Декомпозиция god-modules как закон CI** — `teamScanner2Renderer.js` 4890→7 файлов ≤800 LOC, `server.js` 6486→`server/integrations/*` (≤500), `gantt.js` 2804→4 модуля, `app.js` финальный split. | разблокирует тестирование, миграцию контрактов, AI-augmented contributions; без этого через 6-12 мес «не декомпозируется» (см. AUDIT_MIGRATION триггер #6). | архитектура | AUDIT_ARCHITECTURE.md #5/#7-#14/#17 / AUDIT_MIGRATION.md «action plan» | high | L (12-20 ч-мес total) |
| 5 | **Mascot mood-ring + AI-frame + проактивные инсайты** — маскот реагирует на состояние портфеля (drift→concerned, off-course→alert), AI-pipeline шлёт push-инсайты в Notification Center, AI-разделы получают insight-glow. | переводит AI из «отчёта» в «второй мозг + барометр». Самый сильный brand-asset (маскот) перестаёт быть декорацией. | сквозное (UX + AI + brand) | AUDIT_HOLISTIC.md #5/#11/#12/AI6 / AUDIT_MASCOT.md I2 / AUDIT_ARTDIR.md «Особое внимание B+C» | high | L |

---

## 7. Топ-5 структурных шагов по вёрстке/арт-дирекшну

| # | Шаг | Что фиксится | Раздел | Источник | Severity | LOE |
|---|---|---|---|---|---|---|
| 1 | **Унификация worktype-палитр** — убрать `_wtColors` Tailwind-rainbow в Timeline + hardcoded `PHASE_COLORS` в Ганте; всё через `PHASE_COLOR_TOKENS`. | Timeline и Гант перестают выглядеть как два разных приложения. | 6 / 4 | AUDIT_ARTDIR.md #15 / #11 / Топ-10 идей #4 | critical→S | S |
| 2 | **Z-scale 6-step через `--z-*`** + лимит на новые z-index числом без token (lint-rule). | Сейчас 50 уникальных z-index (1..100000), `9999` встречается 6 раз с разной семантикой. | LAYOUT / Общее | AUDIT_LAYOUT.md #44 / Топ-10 #3 | critical | M |
| 3 | **Type-scale 10/12/13/14/16/20/24/32 + spacing 4-pt grid** через codemod (10.5/11.5/12.5/13.5 — запретить, 7/9/11/13 px outliers — заменить). | 32 уникальных font-size + 117 уникальных px → 8 + 11. | LAYOUT / Общее | AUDIT_LAYOUT.md #39 / #41 / Топ-10 #5 | critical | L |
| 4 | **Token-coverage codemod** — 503 raw `:#hex` / 209 уникальных hex → `var(--prizma-…)`. | ⅓ цветов идёт мимо токен-системы. dark-theme парность держится на shim. | LAYOUT / Общее | AUDIT_LAYOUT.md #51 / Топ-10 #6 / HOLISTIC P2 | high | L |
| 5 | **`room-headers`-концепт** (caps eyebrow + 32px space) для всех multi-block страниц (Метрики, Сканнер, DocDebt). | density становится осознанной; брендбук §3 «5% signal» восстанавливается. | 2 / 17 / 15 / Дашборд | AUDIT_ARTDIR.md #6/#33/#30 / Топ-10 идей #5 | high | M |

Резерв: gradient cleanup (23 живых linear-gradient вне spine-pill); motion-system unify (3 ease-namespace → 1); KPI-grid → KPI-strip (4 главных + collapse) на Дашборде / Метриках / Сотрудниках; subhero context-line «10:14 · 4 апреля 2026 · сводка свежая» под page-header.

---

## 8. Топ-10 текстовых правок с самым большим эффектом

| # | Правка | Раздел | Источник | Файл:строка | Severity | LOE |
|---|---|---|---|---|---|---|
| 1 | **Зарезервировать `'Курс сверен'` для редких целевых событий** (welcome, restore, plan-lock) — сейчас 15+ мест используют как универсальный success → бренд-фраза девальвирована. | сквозное | AUDIT_COPY.md #48 / Топ-7 #1 | `app.js:376/940`, `app/llmAssistant.js:775`, `chat/chatActions.js:272`, `dataStore.js:1274`, `views/integrationsView.js:237/299/364/441` (15 мест) | high | M |
| 2 | **Симметрично `'Курс не сверен · …'`** (8 мест quota-exceeded / network-error) — заменить на точный текст («Не удалось сохранить — переполнено локальное хранилище»). | сквозное | AUDIT_COPY.md #49 | `app.js:369`, `app/llmAssistant.js:666`, `dataStore.js:101/143`, `chat/chatActions.js:304/414`, `integrations/techInfo.js:214`, `views/integrationsView.js:242/303/368/443` | high | M |
| 3 | **Удалить эмодзи из LLM-инструкций и AI-fallback × 17+ позиций** (см. §3 Топ-10 high #5). Заменить на iconKey + Lucide. | сквозное (chat/ai/scanner/pulse) | AUDIT_COPY.md #25/#30/#40/#57 + AUDIT_ARTDIR.md #21/#22/#34/#35 | `ai/aiCeoFallback.js:264..581`, `ai/aiFallbackEngine.js`, `chat/chatActivityPrompts.js:43`, `integrations/portfolioPulseRenderer.js`, `integrations/teamScanner2.js:1727..1899` | high | L |
| 4 | **Переименовать `'Вы обманываете себя'`** (AI CEO «Hard truths») — обвинительный тон оскорбителен внутреннему пользователю. | 10 AI CEO | AUDIT_COPY.md #24 | `ai/aiCeoRenderer.js:277` | high | S |
| 5 | **Овертайм canon × 8+ файлов**: `OT / Овертайм / overtime / ot` → один канон «Овертайм». | 7 Сотрудники + сквозное | AUDIT_COPY.md #17 / Глоссарий | `views/employees.js:150/258/607/881`, `index.html:1029/1069/1145`, `chat/chatActions.js`, `views/dashboard.js` | medium | M |
| 6 | **`FUNNY_PHRASES` 20 фраз с эмодзи** (`🐌 Ловлю улитку с задачами Jira…`) — контрастируют с северно-звёздным брендом. Удалить или перевыпустить через mascot phrase-bank без эмодзи. | сквозное / loaders | AUDIT_COPY.md #50 + AUDIT_HOLISTIC.md O9 | `app.js:263-284` | high | M (delete) / L (rebrand) |
| 7 | **Server error → UI sanitization**: `error: 'GigaChat upstream error', details: parsed || errText` подставляет сырое тело upstream (внутренняя инфра). Возвращать только `userMessage` + `code`. | сквозное / server | AUDIT_COPY.md #52 / AUDIT_LLM.md S11/S15 | `server.js:530-535`, `app/llmAssistant.js:1499-1515` | high | L |
| 8 | **Тон чата на «вы»** — LLM сейчас отвечает на «ты», UI на «вы»; добавить в каждый system-prompt «Обращайся к пользователю на «вы»». | 13 AI Анализ / 10 AI CEO / chat | AUDIT_COPY.md #56/#60 | `chat/chatPrompts.js:132/149/174/197/218/247/270`, `chat/chatEngine.js`, `chat/chatActions.js:91/132/383/388` | low | S |
| 9 | **Empty-state унификация × 7** через `renderEmptyState({title, hint, action})` + единый словарь копирайта (Дашборд / Реестр / Сотрудники / Таймлайн / Гант / AI). | сквозное | AUDIT_UX.md «Сквозное» / AUDIT_COPY.md #1/#9/#15/#18 / AUDIT_HOLISTIC.md #5 | `views/dashboard.js:79`, `views/registry.js:64-78`, `views/employees.js:267-269`, `views/timeline.js:104,144`, `views/gantt.js:704`, `views/aiView.js:177`, `ai/aiCeoRenderer.js:76` | medium | M |
| 10 | **Зафиксировать ToV в `docs/tone-of-voice.md`** + глоссарий 30 терминов из `AUDIT_COPY.md §5` (scope/объём, курс, эпик, релиз, спринт, овертайм, без курса, бэклог, сверка, дрейф). | сквозное | AUDIT_COPY.md Топ-7 #6 / Глоссарий | `docs/tone-of-voice.md` (new), `docs/domain-glossary.md` extend | medium | S |

---

## 9. Топ-5 DevOps-улучшений с самым большим эффектом

| # | Улучшение | Раздел | Источник | Файл:строка | Severity | LOE |
|---|---|---|---|---|---|---|
| 1 | **Dependabot конфиг** (`.github/dependabot.yml`) + `npm audit --audit-level=high` step. Сейчас нет dependency scanner — все транзитивные deps без contrôle. | InfraSec | AUDIT_DEVOPS.md 13.2 / 10 magic-4 | `.github/dependabot.yml` (new) | high | S |
| 2 | **`reqId` через `withReqId(...)` в `http.createServer`** — 5 строк, разблокирует трассировку всех логов post-mortem. | Obs | AUDIT_DEVOPS.md 7.5 / 10 magic-5 | `server.js` main handler, `server/logger.js:142` | high | M (5 строк, остальное — пропускать через handlers) |
| 3 | **Persist `_metrics` + frontend `clientErrors` в logger** — сейчас сбрасываются при restart, weekly-trend невозможен. Frontend errors хранятся только in-memory. | Obs | AUDIT_DEVOPS.md 7.4 / 7.8 | `server.js:152`, `server.js:163-169`, `JOBS_PERSIST_DIR/metrics.json` | high | M |
| 4 | **Раздать `Dockerfile` + `.dockerignore`** + `make-release.sh` (исключающий `audit-2026-*/` и `.git`) — сейчас раздача = вся папка с audit-историей. Также `package-lock.json` bump 12.0.0→17.0.0 + чистый `npm ci`. | Build | AUDIT_DEVOPS.md 3.1 / 3.2 / 3.4 / 1.2 | (new) `Dockerfile`, `.dockerignore`, `make-release.sh` | high | S |
| 5 | **Backup endpoint** (`POST /api/state/snapshot` с `_scrubSecrets`) + cron-rotate keep-last-30 в `JOBS_PERSIST_DIR/snapshots/<userId>/<ts>.json`. Сейчас все user-данные в localStorage браузера, чистка cache = потеря. | Backup | AUDIT_DEVOPS.md 10.1 + 10.2 + 10.3 | `server.js`, `dataStore.js _scrubSecrets` | high | M |

Резерв из top-10 magic: `.profile/` в `.gitignore` (#5.6 critical hygiene); `chmod 600 jira_config.json` (#5.2); `JOBS_PERSIST_DIR` default → `~/.prizma/jobs/` (#10.2); HTTP security headers (#13.7); smoke-step retry-loop вместо `sleep 2` (#1.6).

---

## 10. Топ-20 наиболее вероятных багов (из AUDIT_QA.md)

| Ранг | Баг | Раздел | Источник | Severity × Вероятность | LOE |
|---|---|---|---|---|---|
| 1 | localStorage quota overflow (5000+ строк) → silent data loss на F5 | Storage | AUDIT_QA.md AS.1 | critical × high | L |
| 2 | Undo + toast-undo race → дубль-restore (две копии одной строки) | Реестр / Сотрудники | AUDIT_QA.md A3.2, A7.1 | high × high | S |
| 3 | Snapshot — ссылка, не клон в delete-undo → undo возвращает мутированную строку | Реестр / Сотрудники | AUDIT_QA.md A3.1, A7.2 | high × medium | S |
| 4 | Gantt прогресс-бар деление на 0 при `workStartDate === workEndDate` → Infinity, NaN width | Гант | AUDIT_QA.md A4.1 | high × medium | S |
| 5 | Year-rollover (декабрь→январь) ломает `month*100+day` сравнение → задачи показываются «впереди» когда прошли | Гант | AUDIT_QA.md A4.2 | high × high (ежегодно 31.12/01.01) | M |
| 6 | `JSON.parse(JSON.stringify(state))` теряет Date/Map/Set в HistoryManager → undo откатывает с потерей типов | Storage / Undo | AUDIT_QA.md A3.4, AS.6 | high × medium | S |
| 7 | Bulk-edit без `Reactive.silent` на 1000+ строк → infinite loop / 30+ сек freeze | Реестр / Bulk | AUDIT_QA.md A3.6, AS.4 | critical × medium | M |
| 8 | Timezone shift в `toISOString()` для `donePills.at` / `assignedAt` → дата «выполнено» сдвигается на день | Гант / Точность оценок | AUDIT_QA.md A4.3, A14.1 | medium × high | M |
| 9 | `JSON.parse(localStorage)` без try/catch (integrationsStore / scanner queue / scanner audit) → corrupted = вся секция падает | Интеграции / Сканнер | AUDIT_QA.md A16.1, A16.2, A17.1 | high × medium | S |
| 10 | LLM proxy без whitelist `apiBaseUrl` → возможный leak токена на attacker-controlled URL | Сервер / AI | AUDIT_QA.md AX.7, AUDIT_LLM.md S2 | critical × low | M |
| 11 | Cross-tab desync (last-writer-wins) — две вкладки → потеря данных | Storage / Реестр | AUDIT_QA.md AX.2 | high × medium | M |
| 12 | Heap-pressure undo-stack 20× state → OOM на слабых машинах | Undo | AUDIT_QA.md AS.6 | high × low (видимый jank) | L |
| 13 | Cycle в зависимостях (`A→B→A`) → бесконечная рекурсия в `views/dependencyGraph.js` | Гант | AUDIT_QA.md A4.8 | high × low | M |
| 14 | AI-context payload >max_tokens на 5000 rows → LLM 4xx или мусорный ответ → fallback не покрывает | AI Анализ | AUDIT_QA.md A13.3 | medium × high | M |
| 15 | `Promise.all` вместо `allSettled` в AI refresh → один fail обрывает оставшиеся в окне | AI Анализ | AUDIT_QA.md A13.1 | medium × medium | M |
| 16 | `Math.round` 100% на dashboard hero при 99.5% → пользователь думает «всё готово» | Дашборд | AUDIT_QA.md A1.1 | medium × high | S |
| 17 | God-module `teamScanner2Renderer.js` 5300 LOC без unit-тестов на reentrancy → любая правка ломает 10+ функций | Сканнер | AUDIT_QA.md A17.7 | high × high | L |
| 18 | HTML-export Ганта не sanitize строки → XSS в exported HTML | Гант | AUDIT_QA.md A4.9 | high × low | S |
| 19 | Mascot/Chat FAB overlap drag-and-drop на Ганте → пилюли не дропаются в зоне FAB | Маскот / Гант | AUDIT_QA.md AX.9 | medium × medium | S |
| 20 | `detectBlocked` не trim'ает суффикс `[Х]` → ФИО с trailing space не классифицируется как заблокированный, утечёт в attribution | Сотрудники / Identity | AUDIT_QA.md A7.4, AX.4 | high × medium | S |

---

## 11. Вердикт по миграции на React+Node

**Не мигрировать.** Vanilla — не легаси, а архитектурный актив (corporate compliance + supply-chain immunity + one-step deploy + AI-augmented dev workflow + 0 рантайм-зависимостей). Полная миграция = 24-40 человеко-месяцев, не решит ни одной реальной боли (god-modules, perf, CSS) и создаст 8-12 новых (потеря compliance, drop velocity 30-50% на год, переписывание 534 unit-тестов, перенос onboarding-тура с DOM-selectors).

**Рекомендуемые следующие шаги (альтернатива Д.2 + Д.4, ~11-21 ч-мес за 6-12 месяцев):**
1. Завершить V18 9-10: декомпозицию `app.js` / `server.js` (~3-5 ч-мес).
2. Декомпозиция `gantt.js` (2.8k → 4 модуля по ~700) + виртуализация (~1-2 ч-мес).
3. Декомпозиция `teamScanner2Renderer.js` (4.9k → 7 sub-renderers по ≤800 LOC) (~3-4 ч-мес).
4. CSS разделить на 18 файлов + design-tokens, gradient cleanup, token-coverage CI gate (~1-3 ч-мес).
5. ESLint warnings → 0 (~0.5-1 ч-мес).
6. Bundler opt-in (esbuild для production) для cold-load (~0.5-1 ч-мес).
7. Performance budgets в CI per-section (~0.3-0.5 ч-мес).

Через 12-18 месяцев — пересмотр (триггеры в AUDIT_MIGRATION.md). Источник: `AUDIT_MIGRATION.md` целиком (1300 строк, единогласный вердикт tech-lead + senior frontend + senior backend + продакт).

---

## 12. Архитектурный вердикт

**Архитектура концептуально 5-слойная (state / persistence / view / integrations / orchestrator), но протекает в трёх местах:** (1) `views/* → Storage.save` direct × 30+ в `registry.js`; (2) `views/* → fetch('/api/...')` direct в integrationsView/employees вместо `integrationsSync.proxyPost`; (3) `ai/* → chat/chatAlerts` импортирует `computeHealthScore`. ARCHITECTURE.md рассинхронизирован с кодом на 3 эпохи (V17.2 в шапке — V19/V21/V22 в коде).

**Ключевые шаги (приоритет):**
1. **Обновить `ARCHITECTURE.md`** по черновику в `AUDIT_ARCHITECTURE.md` (V22, текущая декомпозиция, async-job pattern для Pulse + BlackDashboard, missing modules `migrations.js`/`uxKit.js`/`pulse/index.js`/`server/logger.js`/`telemetry.js`).
2. **ESLint custom-rules** в `eslint-rules/`: `no-direct-storage-save-in-views`, `no-direct-api-fetch-in-views`, `no-unsafe-json-parse`, `require-reactive-silent-on-bulk`, `no-emoji-in-templates` для `chat/`+`ai/`, `no-export-without-scrub`.
3. **Вынести `computeHealthScore`** из `chat/chatAlerts.js` в `metricsEngine.js` (нейтральное место) — закрывает единственный ai→chat импорт.
4. **Удалить параллельный legacy event-bus** `state.subscribe/notify` (или явно задокументировать когда что; сейчас работает параллельно с Reactive Proxy = двойная нотификация).
5. **Декомпозиция god-modules** по плану §11 шаги 1-3.
6. **Завести `storage/` пакет** (`storage/index.js` facade + `local.js` + `sqlite.js`) — отрезать `appDataStore.js` от `dataStore.js`.
7. **`docs/persistence-keys.md`** + `docs/adr/` папка с ADR-лог.

Источник: `AUDIT_ARCHITECTURE.md` Часть А-Г + 38 находок (4 critical / 9 high / 13 medium / 12 low).

---

## 13. Дизайн новой подвкладки «Гигиена Jira» — резюме концепции

**TL;DR:** «Гигиена Jira» = быстрый обзор того, насколько данные команды в Jira пригодны для управленческих решений; список конкретных задач с проблемами; массовые действия для починки. Внутри Сканнера команд, рядом с подвкладками «Сегодня / Глубже / Метрики». Источник: `AUDIT_SCANNER.md` Часть Б.

**Ядро — Интерпретация-Б «дисциплина процесса»** (тимлид ежедневно, action-loop) + куски Интерпретации-А «качество backlog» (PO раз в спринт) и -В «reporting-чистота» (CEO/PM раз в месяц) как переключаемые модули.

**24 правила в 4 группах** (severity / threshold / autoFix per rule):
- **Daily process (D-01..D-06):** без assignee в активном sprint; in-progress без коммитов >5д; status='In Review' >3д; >2 transitions assignee/неделя; in-progress но другой коммитит; orphan в sprint.
- **Backlog DoR (R-01..R-10):** без приоритета / описания / epic-link / component / estimate / fixVersion / AC; бесхозный эпик; эпик без срока; эпик с 0 sub-задач.
- **Quality (Q-01..Q-06):** дубли (cosine ≥ 0.85); estimate vs actual >2×; закрыто без коммитов; циклы зависимостей; sub-task переживает родителя; странные transitions.
- **Reporting (M-01..M-04):** components без owner; releases без даты + open issues; story points отсутствуют у >30% sprint; заброшенные доски.

**UI:** Hero (Hygiene Score 0-100 + breakdown D/R/Q/M + Identity coverage) → 4 столбца «Action Lanes» (top-3 правил в каждом) → Trend row (sparkline 30д) → Bulk Actions Bar (sticky bottom). Multi-team mode = heatmap rules×teams. Side-panel drill-down 480px со списком тикетов + bulk-assign + LLM-обоснование per-click.

**MVP (1 неделя, 8 правил, single-team):** D-01, D-02, R-01, R-02, R-03, R-05, R-08, Q-05 + Hero + drill-down side-panel + open-in-Jira + snooze. **V1 (3-4 недели):** все 24 правила + settings modal + bulk actions + per-team config + Trend + LLM. **V2 (1-2 мес):** multi-team heatmap + scheduler + Slack/TG webhooks + email digest + AI CEO tile + cross-link с Sprint Health / Сотрудники.

**Перекличка с другими разделами:** заменяет inline-chips в Sprint Health; tile «Backlog health» в Sleeping Data ведёт сюда; per-employee row в Сотрудниках получает счётчик `🩹 5`; AI Анализ + AI CEO получают `hygiene_summary` блок; bulk-actions пишут в `actionLayer` с audit-trail в historyLog. **Стратегически расширяется до универсального rule-engine** поверх всех data-views (см. §6 ставка #1 / HOLISTIC #11).

---

## 14. Главные сквозные паттерны (системные боли через несколько разделов)

1. **Дублирование без общей платформы.** 4 motion-системы (`--ease-*` / `--prizma-ease-*` / `--obs-ease-*` + 20 ad-hoc cubic-bezier), 3 toast-API (`showToast` legacy / `ToastQueue` / native `alert`), 3 AI-fallback engine'а (`aiCeoFallback` / `aiFallbackEngine` / `exec`-aggregator), 7 empty-state копирайтов, 120+ `*-card` / 71 `*-chip` / 63 `*-badge` / 59 `*-modal` уникальных классов, 50 z-index, 32 font-size, 117 уникальных px, 105 box-shadow, 23 gradient'а вне spine-pill. Видно в **AUDIT_LAYOUT** (#36-#54) + **AUDIT_ARTDIR** (3 параллельные «зелёных») + **AUDIT_COPY** (#47/#48) + **AUDIT_HOLISTIC** (#9/#13/P1).

2. **God-modules как класс, не как файл.** `teamScanner2Renderer.js` 4890 LOC, `server.js` 6486 LOC, `gantt.js` 2804 LOC, `views/registry.js` 997, `app.js` 2208, `styles.css` 19995, `index.html` 1726. Каждое расширение прикладывает 500-1000 строк к одному файлу. Без правила «≤800 LOC + audit-trail» как закона CI расщепляться они не будут. Источник: **AUDIT_TECH** разделы 4 / 17 / Общее + **AUDIT_ARCHITECTURE** #5/#7/#8/#12/#17 + **AUDIT_QA** A17.7 + **AUDIT_HOLISTIC** TL;DR.

3. **Отсутствие фундамента `state.meta` (user / permissions / featureFlags / version / lastSeen).** Любая permission-логика, A/B-флаги, «что нового», маскот-persistence упираются в это. Сейчас: любой пользователь может через preview-чип удалить блокеры всем (LLM S1); нет feature-flags для kill-switch; нет «давно не виделись» для маскота (MASCOT раздел 2/I9); нет version в footer (DEVOPS 4.1). Источник: **AUDIT_LLM** S1 / **AUDIT_DEVOPS** 4.1+6.5 / **AUDIT_MASCOT** I5 / **AUDIT_HOLISTIC** #18/P5/P6 (#1 фундаментальная идея).

4. **AI-разделы (10/11/13) визуально не отличаются от rule-based отчётов** + 3 параллельных pipeline (`aiView` 13 блоков, `aiCeoView`, `exec`) с дублированной fallback-логикой + 17+ эмодзи в LLM-промптах нарушают spine no-emoji rule. Нет «думаю» как ощущения, нет insight-цвета, нет mascot reagирования, маскот-как-барометр не реализован. Источник: **AUDIT_ARTDIR** #20-#26 + «Особое внимание B» / **AUDIT_MASCOT** I3+«не используется в AI» / **AUDIT_COPY** #25/#30/#40/#57 / **AUDIT_HOLISTIC** O6+#5.

5. **PII / secrets / scrub распылены по 3 параллельным наборам правил** (`scrubChatSecrets` frontend + `Utils.scrubPii` + server-side `_PII_PATTERNS` + telemetry без scrub) — гарантированный дрейф. Email/jiraAccountId/employee FIO утекают в server logs (V19 E4 JSON-stringify) и в external GigaChat. Источник: **AUDIT_LLM** S3/S4/S5/S11/S15 / **AUDIT_TECH** «Кросс: telemetry» + раздел 13 / **AUDIT_DEVOPS** 5.7 / **AUDIT_HOLISTIC** #2/P4. Закрывается единым `shared/pii.js + secrets.js` модулем (re-used в client + server + telemetry + LLM-payload).

---

## Приложение: метрики покрытия аудита

| Этап | Файл | Находок | Critical | High | Medium | Low |
|---|---|---|---|---|---|---|
| 0 | AUDIT_MAP.md | (карта 18 разделов + общее + кросс) | — | — | — | — |
| 1 | AUDIT_TECH.md | 53 | 4 | 14 | 26 | 9 |
| 2 | AUDIT_UX.md | 56 | 1 | 9 | … | … |
| 3 | AUDIT_LAYOUT.md | 54 | 7 | 9 | 21 | 9 |
| 4 | AUDIT_ARTDIRECTION.md | 38 | 5 | 12 | 17 | 4 |
| 5 | AUDIT_MASCOT.md | 33 (+12 идей) | 1 | 6 | 17 | 9 |
| 6 | AUDIT_LLM.md | ~50 (+12 идей) | 3 | 5 | 20 | … |
| 7 | AUDIT_COPY.md | 61 (+30 терминов глоссарий + ToV) | 0 | 9 | 24 | 18 |
| 8 | AUDIT_DEVOPS.md | 38 (+top-10 magic) | 0 | 11 | 19 | 8 |
| 9 | AUDIT_QA.md | 66 (+ smoke / 5 сценариев / топ-20 багов) | 5 | … | … | … |
| 10 | AUDIT_SCANNER.md | 50 (+ полный дизайн «Гигиена Jira») | 1 | … | … | … |
| 11 | AUDIT_SCANNER_METRICS.md | 36 | 5 | 9 | 13 | 9 |
| 12 | AUDIT_ARCHITECTURE.md | 38 (+draft replacement) | 4 | 9 | 13 | 12 |
| 13 | AUDIT_MIGRATION.md | 1300 строк, вердикт «не мигрировать» (~11-21 ч-мес декомпозиции) | — | — | — | — |
| 14 | AUDIT_HOLISTIC.md | 18 болей + 12 фич + 7 AI-идей + 6 автоматизаций + 3 сценария + 10 устаревшего + 8 платформенных + топ-15 | — | — | — | — |
| **Итого** | | **~640 находок** | **~36** | **~95** | **~170** | **~80** |

---

*Сгенерировано Этапом сводным (после 14 этапов аудита). Все находки — с прямой ссылкой на исходный файл аудита. Используется для триажа на Q3-Q4 2026 + основа для V23+ roadmap'а.*
