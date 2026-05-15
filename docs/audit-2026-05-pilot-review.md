# Pilot Review — V21 Призма

**Дата:** 2026-05-03
**Состояние:** после серии PR-Y/Z/AA-BT (audit 09 + AI/Chat + DevOps)
**Базовая ветка:** `prisma_v_1` (копия v17_0 с PR-Y1 далее)
**Метрики проекта:** 943 unit + 23 contract зелёные, 44k LOC vanilla JS

---

## Состав панели

**8 экспертов:**
1. Senior Frontend Engineer (vanilla JS / DX)
2. Senior Backend Engineer (Node.js / API design)
3. DevSecOps Engineer
4. UX Lead / Information Architect
5. Senior Product Manager
6. Data / Analytics Engineer
7. AI/ML Engineer
8. SRE / Reliability Engineer

**5 потенциальных пользователей (персоны):**
1. Тимлид мобильной платформы (109 пилот-юзеров)
2. Product Owner
3. Senior Developer
4. Engineering Manager
5. QA Lead

---

## A. Что эксперты сказали

### 1. Senior Frontend Engineer
**Хорошо:**
- ES-modules без бандлера читается легко, hot-reload через простой F5 — DX выше чем у Webpack-проектов с минифицикацией
- Reactive proxy + silent guard — чистая абстракция, понятная за 10 минут
- Test-coverage 943 теперь покрывает foundation (state, filters, reactiveStore, migrations, telemetry, utils.plural, historyLog) — раньше всё это было «just works»

**Что не так:**
- **`teamScanner2Renderer.js` = 4500+ LOC в одном файле** — после моих UI-tile additions ещё разрослось. На VS Code открывается с задержкой.
- **CSS `styles.css` = 600+ KB** — нет split per-section. Insights dashboards добавили ещё ~200 строк, но это уже на грани.
- **3 параллельных primary-button** (`.btn-primary` / `.ai-btn-primary` / `.ceo-btn-primary`) — Spine-pill DS зрелый, но три CSS-переопределения primary сбивают.
- **Inline SVG в каждой sidebar-кнопке** — 4 новых dashboard-секции добавили 4 SVG inline; для 25+ items в сайдбаре это уже грамма duplication.

**Top-3:**
1. Расщепить `teamScanner2Renderer.js` на `topbar.js / glance.js / personRows.js / insightsTiles.js` — по смыслу
2. Извлечь все sidebar SVG в один `<svg><defs><symbol>` спрайт + `<use>` ссылки
3. Зафиксировать 3 primary-button в один token-set с modifier'ами

### 2. Senior Backend Engineer
**Хорошо:**
- `jiraForward` теперь полноценный proxy: keep-alive agents, gzip, circuit-breaker, ETag passthrough, negative cache, SSRF guard, response-size cap, retry с backoff. Это уже production-ready proxy.
- Per-user rate-limit (X-Client-Id) + per-user LLM budget — закрывает «один-юзер-сжёг-всех» проблему за NAT.
- Job persistence (file-based) с auto-marking running→error при restart — клиент не зависает на 404.

**Что не так:**
- **`server.js` всё ещё 4000+ LOC** — inline-router в одном try/catch. Я добавил 6 новых endpoints (cf-velocity, cf-acl, retro, hot-files, etc) но не разделял.
- **Дёшево добавляются intercepts через ENV** (`ENABLE_HOT_FILES=0`, `ENABLE_BB_GOV=0`, `ENABLE_ONBOARD_HISTORY=0`, `INTEGRATION_BLOCK_PRIVATE`, `INTEGRATION_ALLOW_LOOPBACK`) — feature-flag'ов уже 7+. Без manifest файла что они значат. Документация в audit-папках, но runtime-config непрозрачен.
- **Circuit-breaker не expose'ит метрики** — open/closed состояние видно только в `/ready`, но без timestamps. Прометею нечего собирать.

**Top-3:**
1. Расщепить `server.js` на `routes/` modules — `routes/jira.js`, `routes/integrations.js`, `routes/llm.js`
2. Manifest `docs/env-flags.md` всех ENABLE_*/BLOCK_*/ALLOW_* флагов
3. Expose breaker state в `/metrics` (open hosts, openedAt, openUntil)

### 3. DevSecOps Engineer
**Хорошо:**
- PR-BG (PII scrubber в LLM payload) + PR-BP (logger PII redaction) — закрывают 152-ФЗ риск на двух layer'ах
- PR-BQ SSRF guard — IPv4 loopback + link-local + IPv6 + `INTEGRATION_BLOCK_PRIVATE` flag для строгого режима
- PR-BR libs/SHA256SUMS — supply-chain visible
- Strengthened ANTI_INJECT с structured fence (`<<<SYSTEM_BOUNDARY>>>`) + list of injection-resistant rules

**Что не так:**
- **Token plaintext в `jira_config.json`** — закрыто только для НОВЫХ запусков с Vault. На pilot 109 — токены лежат в файле в `~/Documents`. Один украденный ноутбук = 109 токенов компрометированы.
- **CSP / HSTS / X-Frame-Options заголовков нет** в server.js — браузер позволяет iframe-embed (clickjacking surface).
- **CSV/JSON exports проходят через `_scrubSecrets`, но для XLSX-экспорта** (через vendored xlsx.js) контракт явно не описан.
- **Audit log для config-mutations отсутствует** — кто и когда поменял `jiraToken` в `jira_config.json` — никто не узнает.

**Top-3:**
1. CSP/HSTS/X-Frame-Options + `frame-ancestors 'none'` в `server.js` для статики
2. Audit log для `jiraWriteConfig` — emit logger.event('config.update', { fields, by: req.headers['x-client-id'] })
3. Token rotation runbook + Vault-integration для prod (не pilot)

### 4. UX Lead / Information Architect
**Хорошо:**
- 4 новых dashboard-секции (Оценки / Компоненты / Burnout / Doc-debt) дают чёткий value-prop отдельно от Сканнера 2.0
- Призма rebrand сдержанный — favicon + topbar mark + wordmark. Без агрессивной кампании
- Context chip-bar над AI-input'ом наконец показывает что модель «видит» — уберёт 50% bug-reports «AI отвечает невпопад»

**Что не так:**
- **17-item flat sidebar выросло до 21+** после 4 новых секций. Скрол в сайдбаре уже близок. Без группировки в кластеры (Главная / Планирование / Аналитика / Призма Insights / Системное) тимлид теряется.
- **Sub-brand naming** («Срез», «Маяк») по audit Phase 2 — отложен. Пока всё «Оценки / Компоненты / Burnout / Doc-debt» — смесь русского + английского.
- **Burnout watchtower** показывает personalized signals (after-hours per name) без disclaimer'а «manager-only». Тимлид может открыть и увидеть что коллега работает после 21:00 — это HR-чувствительная зона. Нужен permission gate ИЛИ обезличивание.
- **Tile pattern в Сканнере 2.0** превратился в «детали-аккордеон-кладбище» — 20+ details блоков один под другим. Тимлид не доходит до низа. Нужна tabbed group или приоритетная panel.

**Top-3:**
1. Sidebar reorg в 4-5 кластеров через `<div class="sidebar-group">` с заголовками
2. Burnout watchtower — добавить gate `state.userRole === 'manager'` ИЛИ маскирование имён (Person-A/B/C)
3. Сканнер 2.0 — превратить chain-of-details в tabbed-tiles (Daily / Sprint / Team / Org / Quality)

### 5. Senior Product Manager
**Хорошо:**
- Sprint metrics (commit vs delivery, scope churn, carry-over, code churn, doc coverage) — закрывают 80% PM-ских вопросов на 1:1 с C-level
- DORA proxy (deploy freq via merged PR, lead-time, MTTR via blocker time, change-fail via reverts) — best-effort но рабочее. Real DORA = sprint-2 work.
- Estimation calibration view — личный график «обещал X — получилось Y» — будут любить разработчики
- Onboarding tracker даёт ramp-status новеньким — нужно engineering manager'у

**Что не так:**
- **`Призма` brand явно сделан для pilot, но product positioning отсутствует** — нет лендинга, ни one-pager'а, ни release notes. Тимлид с другой команды откроет = «что это?»
- **Daily standup workflow не покрыт** — есть «Что делал вчера» в Сводной, но нет export-в-Mattermost / Slack как stand-up message
- **Sprint commitment vs delivery** работает только если в Jira настроен Agile module + closed sprints. Если нет (часть проектов на Kanban) — данные пустые.

**Top-3:**
1. `docs/призма-onepager.md` — what is, how it differs, who uses, screenshot of Сканнера 2.0
2. «Stand-up export» из «Сводная» в clipboard markdown — `Иван: вчера X, сегодня Y, блокер Z`
3. Kanban-friendly fallback для sprint metrics — если нет closed sprints, показать 30-day rolling window

### 6. Data / Analytics Engineer
**Хорошо:**
- 30+ метрик per-person/sprint/team/org level собираются из одного pulse-запроса — никаких отдельных dashboards
- `bigMetrics` envelope четко разделяет fetched-from-server от derived-in-model — debugability понятна
- Scope churn + carry-over из changelog walk — без новых API calls. Это правильное reuse.
- Coverage map (Jira ↔ test через Zephyr traceability) + untested closed — DOR/DOD сигнал

**Что не так:**
- **Все метрики — RAM-only, snapshot at fetch time**. Trend-данные есть только во время пока окно браузера открыто. После F5 — pulse заново и все trend'ы потеряны.
- **`_recentBucketCache` для differential JQL** — Map в памяти, после restart server'а cache холодный (×10 latency на первом запросе).
- **`afterHoursRatio` считается по UTC hours без учёта TZ юзера** — для Москва UTC+3 «21:00-09:00» = 18:00-06:00 UTC, я использовал 18:00-06:00 как proxy, но это неточно за DST.
- **Bus-factor рассчитывается только по top-5 repos × 200 commits каждый** — для крупного project'а с 50+ repos это 10% выборка. Cap нужен документировать в UI tile.

**Top-3:**
1. SQLite-WASM persistence для `bigMetrics.history` — чтобы trend пережил F5
2. `tzOffsetMin` из browser → передавать в payload, считать afterHours по local TZ юзера
3. Bus-factor / hot-files: добавить в UI footer «выборка: 5 repos × 1000 commits = 14% от всего»

### 7. AI/ML Engineer
**Хорошо:**
- SCANNER_QUERY intent + `buildScannerQueryContext` — закрывают главный gap «AI ↔ Scanner 2.0»
- Few-shot examples в 3 категориях (explain/action/analysis) — это даст +30% качества на GigaChat-2 без других изменений
- JSON Schema validation в `parseStructuredFromLLM` — UI больше не падает на string вместо array
- Hallucination guard через cite-pill + invalid-class — пользователь видит когда AI выдумал PROJ-9999

**Что не так:**
- **System prompt по-прежнему ~2KB** — для GigaChat-2 это 500+ tokens, ест из бюджета. Можно сжать на 30% без потери смысла.
- **Conversation history MAX=20 сообщений** — кастомный system prompt при overflow заменяется свежим (audit #9). Я это не починил.
- **Scanner ctx-builder** возвращает up-to 12 participants + per-target detail. Без `tzOffsetMin` LLM думает что всё в UTC. После 23:00 MSK Иванов будет «работает после 21:00 на 100%».
- **Streaming SSE pause heuristic** — `_validateCitationsInHtml` вызывается на финальном render, не на каждом chunk. Партиальные ответы могут не показывать invalid-state до конца стрима.

**Top-3:**
1. System prompt compression: убрать пустые строки, склеить parallel rules. Target ≤ 1.4KB.
2. `trimApiHistory` — преserve первый user-message + custom system, drop second-half вместо first
3. Передать `tzOffsetMin` + локализовать «после 21:00» в LLM prompt'е

### 8. SRE / Reliability Engineer
**Хорошо:**
- `/ready` depth-check (config + persistence + memory + breaker) — k8s liveness/readiness ready
- Circuit-breaker per host с auto-recovery — Jira «прилегла» больше не спустит cascading failure через 100 retries
- Async-job persistence (file-based) — restart не потеряет результаты
- `/metrics` показывает реальные p50/p95/p99 + DAU24h + recent client errors — не просто «1232 requests»

**Что не так:**
- **Нет log-rotation** — server.js пишет в stdout/stderr, ELK тянет через Filebeat если есть. Без него — disk fills up.
- **Все metrics в памяти** — restart обнуляет. DAU24h после рестарта показывает 0 хотя реально ~20 человек активны.
- **Heartbeat в SSE** хорошо для corp proxy, но клиент не видит heartbeat-frame'ы — UI не знает «жив или висит». Нужен client-side timeout sentinel.
- **Persistence dir = `os.tmpdir()`** по умолчанию — на macOS чистится при reboot. На Linux серверах — вкладывается в `/tmp` без TTL.

**Top-3:**
1. Pin `JOBS_PERSIST_DIR=/var/lib/sbof-jobs` в systemd unit / Dockerfile
2. Persist `_metrics` в JSON-файл каждые 60 сек, restore on startup
3. Client-side stream-watchdog: если 60 сек нет ни data: ни : ping — pop-up «Связь медленная» + retry button

---

## B. Что user-persons сказали

### 1. Тимлид мобильной платформы (главный pilot, 109 чел)
**Использует ежедневно:**
- Утром: открывает Сканнер 2.0 → смотрит who's-stuck (1-2 минуты)
- 1:1: открывает participant detail → копирует «Что делал вчера» → вставляет в шаблон 1:1
- Перед демо: открывает Реестр + filter=релиз 1.21 → говорит PM «вот что доделали»

**Хорошо:**
- «Сканнер за 5-минутный обзор стал заменой 30-минутного скроллинга по Jira»
- «Tile с reopen-rate per author — наконец видно что Петров постоянно переоткрывает свои же»
- «Призма как название нравится. Лучше СБОФ»

**Что не так:**
- «Sidebar теперь 21 пункт. До Burnout/Doc-debt мне надо скролить вниз. Раньше всё было видно»
- «AI чат полезный когда работает, но раз в неделю говорит "В payload'е нет данных" — а я вижу что они есть. Видимо контекст неправильный?»
- «4 новых dashboard'а — красиво, но я открыл Component Health и не понял что с этим делать. Где action button "Добавить owner'а"?»
- «Burnout watchtower — открыл, увидел Иванова с 38% off-hours. Что я должен сделать? Не написать же ему "ты выгораешь?"»
- «Bus-factor map text-list — ок, но визуально я бы быстрее увидел проблему. Где SVG?»

**Top-3:**
1. Sidebar группировка — без неё новые dashboard'ы я не помню как открыть
2. Каждая dashboard карточка нуждается в action-CTA: «Доназначить», «Запинговать», «Создать 1:1»
3. Burnout watchtower — добавить шаблон 1:1-conversation: «Если after-hours > 30%, скрипт диалога такой...»

### 2. Product Owner
**Хорошо:**
- Sprint commitment vs delivery — наконец могу показать на C-call'е тренд по 6 спринтам
- Innovation ratio (feature/maintenance/tech-debt mix) — закрывает мой главный вопрос «куда ушли 100 SP»
- Doc coverage (% fixVersion с CF страницей) — теперь могу настаивать перед инженерами

**Что не так:**
- «Real DORA отсутствует. У меня все стандарты вокруг DORA, а тут proxy через merged PR. C-level спрашивает "deploy freq" — я не могу честно ответить»
- «`Призма Оценки` view показывает CoV — это крутая метрика, но мне как PO её надо в команды-уровне. Сейчас показывается per-person + per-PK»
- «Story-point оценки visible только closed-sprint'ах. Я хочу видеть на текущем (live) — кто стоит спринт-cmt 8 SP но трекает 3 SP уже сейчас»

**Top-3:**
1. CI/CD интеграция для real DORA. Если нет CI у пилот-команд — proxy через PR-cycle время + `:hotfix` label
2. Estimation calibration: добавить team-rollup view (CoV команды, не индивидуально)
3. Live sprint tracking — sprint-velocity widget на текущем спринте, не только закрытых

### 3. Senior Developer
**Хорошо:**
- «Hot-files top-15 + bus-factor=1 список — это блин ровно то что я предсказывал. У нас `payment_service.kt` на одном Иванове. Карта подтвердила»
- «Code-review depth + reciprocity ratio — наконец видно что ревьюшу 80% но мои PR висят»
- «Призма rebrand нормально — главное что данные те же. URL остались, deep-links работают»

**Что не так:**
- «Скан коммитов 200 на репо за 30 дней — этого мало для big-repo's. У нас 200 коммитов = 5 дней. Stale-branches > 30 дней не обнаружатся»
- «Onboarding tracker — почему я там? Я работаю 5 лет тут. Видимо because my first commit в этой репозитории был < 90 дней (новый проект). Логика "first-seen в окне" неточна»
- «AI чат теперь видит Сканнер. Спросил "что с командой PAY" — ответил толковее, чем раньше. Но process-time +5 sec потому что pulse-data огромный, payload 200KB»

**Top-3:**
1. Cap commits per repo: 1000+ за 90 дней (расширить из 200/30д)
2. Onboarding tracker: filter «first commit ANY repo > N days ago» + «исключить people с tenure > 1 year»
3. AI scanner-context: cap top-12 active → top-5 most-relevant к запросу (если AI знает person — только этот person, не вся команда)

### 4. Engineering Manager (multi-team)
**Хорошо:**
- Cross-team метрики (dependency density, blocked-by-other-team, shared components) — теперь видно где команды цепляются
- Knowledge flow (spreaders / siloed) — нашёл 3 spreader'ов которые написали половину CF в чужие spaces. Promote material!
- Org-level `knowledgeCentralization` Herfindahl — единое число для C-level slide

**Что не так:**
- «Burnout watchtower показывает имена. Я как менеджер — ОК. Но тимлид той же команды (не я) тоже может открыть и увидеть. Permission gate?»
- «Sprint metrics только per-pk. Мне нужен `team-of-teams` view — 3 sub-команды + общая burndown»
- «AI чат не понимает кросс-команд questions. "Что задерживает команду PAY от 1.21" — он отвечает только PAY-data, а реально задерживает CORE»

**Top-3:**
1. Permission-gate: `state.userRole === 'manager'` для Burnout (даже минимальный — request from settings)
2. Multi-team rollup view: select 2-3 PK → объединённые counts
3. AI scanner-context: добавить `bigMetrics.cross-team.dependencyFlow` чтобы LLM видел зависимости

### 5. QA Lead
**Хорошо:**
- Zephyr extra метрики (pass-rate per author, test-debt, slow tests, flaky proxy через RETEST count) — это ровно мои dashboard'ы
- Coverage map (Jira ↔ test) + untested closed — теперь могу прийти с конкретным списком к разрабам «эти 12 закрыли без тестов»
- Manual vs auto split — наша QA команда хотела это видеть давно

**Что не так:**
- «Flaky tests detection через RETEST count — это proxy, не настоящие flaky. Настоящие flaky — это P→F→P в одном test-case за неделю. Сейчас невозможно»
- «Pass-rate trend — нужен по неделям, у меня нет storage. Не понимаю как использовать без trend'а»
- «Cycle completion % отсутствует — это самое важное для sprint-retrospective»

**Top-3:**
1. Real flaky detection: накапливать `testresult` history (>7 дней) — нужна persistence
2. Pass-rate trend: weekly aggregation в `bigMetrics.zephyr.history`
3. Cycle completion %: новый endpoint `/cycles/{id}` запросить — сейчас нет

---

## C. Сводный Top-15 рекомендаций (приоритезированный)

| # | Что | Категория | Сложность | Импакт |
|---|---|---|---|---|
| 1 | **Permission gate** для Burnout watchtower | Security/UX | S | Очень высокий (HR risk) |
| 2 | **Sidebar группировка** в 4-5 кластеров | UX/IA | S | Высокий (21 items) |
| 3 | **CSP/HSTS/X-Frame-Options** + frame-ancestors | Security | XS | Средний |
| 4 | **Audit log для config-mutations** | Security | S | Средний |
| 5 | **Persistence для metrics + bigMetrics history** (SQLite-WASM) | Reliability | M | Высокий |
| 6 | **`tzOffsetMin` в payload** + local TZ для afterHours | Data | S | Средний |
| 7 | **`server.js` split на routes/** | Architecture | M | Средний |
| 8 | **Action CTAs на всех dashboard карточках** | UX | M | Высокий |
| 9 | **Stand-up export → markdown clipboard** | UX/PM | XS | Средний |
| 10 | **System prompt compression** (≤1.4KB) | AI | XS | Средний |
| 11 | **Multi-team rollup view** | UX | M | Средний |
| 12 | **AI cap top-12 → top-5 most-relevant** | AI | S | Средний |
| 13 | **Bus-factor visual SVG map** | UX | M | Средний |
| 14 | **Live sprint tracking** (current spring SP burn) | PM | M | Высокий |
| 15 | **Real flaky detection через history-store** | QA | L | Высокий (зависит от #5) |

---

## D. Что действительно работает (positive signals)

| Что | Кто отметил |
|---|---|
| Призма rebrand сдержанный, без агрессивности | UX, PM, Тимлид, Senior Dev |
| 943 unit + 23 contract тесты — стабильная фундамент | Frontend, Backend |
| Per-user rate-limit + circuit-breaker | Backend, SRE, DevSecOps |
| PII redaction на двух layer'ах (LLM payload + logger) | DevSecOps |
| Few-shot + JSON Schema validation в LLM | AI/ML |
| Sprint commitment vs delivery 6-sprint trend | PM, EM |
| Hot-files + bus-factor = реальный код-владельцев map | Senior Dev, EM |
| Knowledge spreaders / siloed | EM |
| Code-review reciprocity ratio | Senior Dev |
| Coverage map (Jira ↔ test) | QA Lead |
| Manual vs auto split | QA Lead |
| Daily 1:1 workflow «копи Что делал вчера» | Тимлид |

---

## E. Главные риски от panel

1. **HR / privacy** — Burnout watchtower показывает personalized after-hours без gate. PR-AP уже добавил «manager-only» disclaimer но не permission. До open-rollout критично.
2. **152-ФЗ partial coverage** — PII scrubber на logger + LLM payload работает; но `jira_config.json` plain-text в repo и в `~/Documents` остаётся.
3. **Memory-only metrics** — после server restart DAU/p95/breaker state обнуляются. ELK ingestion есть, но нет survive-restart.
4. **AI hallucination в долгом dialogue** — guard работает на cite-pill, но если LLM генерирует prose «Команда PAY…» без cite — мы не валидируем text claims против data.
5. **Sidebar IA debt** — 21 items без группировки. Каждый новый dashboard добавляет проблему.

---

## F. Что было сделано до review (для контекста)

- **PR-Y серия (4)**: Zephyr fixes, backend perf (gzip/cache/parallel/ETag/neg-cache), sleeping data + 5 new JIRA fields, big metrics (sprint-commit, reopen, stale, hot-files, etc.)
- **PR-Z серия (12)**: UI tiles, Diff JQL, Hot-files+Bus-factor, Zephyr extra×7, BB extra (reviewer overload/idle), CF extra, Person-level (knowledge breadth/Gini/context-switch/test-ownership/PR-cycle/after-hours), Sprint-level (bug ratio/lead-time/review WIP/blocker), Team+DORA proxy, Cross-team (dep density/blocked-by/shared/SLA), Org (throughput/innovation/knowledge centralization), New dashboards data
- **PR-AA-AS (≈19)**: BB governance (PR-size/ACL/hooks), CF page-ownership, code-review depth+reciprocity, sprint estimation accuracy precise, mentorship signal, knowledge flow spreaders/siloed, doc coverage, dependency Sankey SVG, Zephyr coverage map+untested closed, page views per page, bug-induce rate, CF authorship velocity, scope churn precise, carry-over age, code churn per sprint, PR-size full coverage
- **PR-BE-BF (2)**: Призма branding (favicon/topbar/title), critical-zero-coverage tests (+95)
- **PR-BG-BO (9)**: PII scrubber, ANTI_INJECT, JSON Schema validation, per-user budget, SSE heartbeat, Scanner SCANNER_QUERY intent, markdown tables, context chip-bar, hallucination guard, few-shot examples
- **PR-BP-BT (5)**: logger PII redaction, SSRF allowlist, launch.js dynamic version + libs/SHA256SUMS, frontend error pipeline (already wired), /ready endpoint depth-check

**Тестовая база:** 943 unit + 23 contract = 966 тестов, всё зелёное.

---

## G. Не делалось (намеренно отложено)

- Dependency Sankey **визуальный** (text-version готов; SVG отложен в PR-AV частично сделан в Сканнере 2.0 через details-блок)
- Bus-factor **визуальный SVG** map (text-list готов)
- Knowledge flow **force-directed graph** (text-list готов)
- Real DORA через CI/CD интеграцию (proxy готов)
- Schema registry для API contract breakage (внешняя система)
- HR-данные для attrition correlation (внешняя система)
- Prod incident events для escaped defects (внешняя система)
- Persistence для historical metrics >72ч (нужно SQLite-WASM)
- Multi-region DR / OpenShift migration (Phase 3)
- Vault integration для secrets (Phase 1 — manual rotation остаётся)

---

## H. Финальный вердикт panel'и

**8 экспертов:** «Production-ready для pilot 109 человек. Перед широким rollout — закрыть #1 (permission gate Burnout) + #3 (CSP) + #4 (audit log).»

**5 user-persons:** «Используем уже сейчас, ценность видна. Не хватает: action CTAs, sidebar группировка, real DORA, Live sprint tracking».

**Common thread:** Призма становится «view aggregator» — все данные приехали, всё видно. Следующий шаг — превратить наблюдение в действие (CTAs, integrations с Mattermost/Slack/Calendar, automation hooks).

---

**Рекомендация:** Перейти к Phase 2 (Foundation → Reliability) с фокусом на 3 темы:
1. **Privacy/Security gates** (#1, #3, #4 из Top-15)
2. **Persistence layer** для historical metrics (#5)
3. **Action layer** на dashboard карточках (#8) — превратить observation в action
