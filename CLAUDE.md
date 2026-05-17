# CLAUDE.md — точка входа для LLM-агента

> Если ты LLM-агент, читающий этот проект впервые — этот файл. Остальное по ссылкам.

> **Текущая активная итерация: V22+ Phase 5.2** (Release 2.0 sub-tab + Scanner Sprint A+B visual grooming + Playwright e2e harness).
>
> Roadmap живёт прямо в `git log`: `git log --oneline --no-merges` показывает все V-эпохи. Audit-папки V14→V21 удалены (находки в коде через legacy-метки `// V17.2 I1c`).

## Что это за проект

**Призма** — внутренний инструмент квартального планирования для мобильной платформы Сбербанка. Управление эпиками / релизами / зависимостями + интеграции (Jira / Bitbucket / Confluence / Zephyr / Jenkins / GigaChat-LLM).

- **~90k LOC vanilla JS** (ES modules), **без бандлера, без build-step**
- Браузер ↔ один Node.js сервер (`server.js` + `server/*` модули)
- Никаких рантайм npm-пакетов; vendored только `xlsx.full.min.js` + `sql-wasm.*`
- Test base: **~1613 unit / 11 contract / 10 e2e HTTP / 22 Playwright visual**

Vanilla — **сознательно** (corporate compliance, supply-chain immunity, AI-augmented dev workflow). Подробнее в [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Карта в 30 секунд

```
/
├── server.js             ← один Node-сервер: статика + /api/* proxy для интеграций
├── server/               ← extracted modules: jira-api / integrations-api / pulse-runner / logger
├── app.js                ← orchestrator: bootstrap, navigation, reactive flush
├── app/                  ← decomposed: nav, init, services, llmAssistant, storageSettings, …
├── state.js              ← единый mutable state (Proxy-обёрнут — см. контракты!)
├── dataStore.js          ← persistence (localStorage + SQLite-WASM optional)
├── rowFactory.js         ← фабрики Row + Employee (включая identity-поля для интеграций)
├── filters.js            ← FilterEngine (cache, getFiltered, getActiveCount)
├── reactiveStore.js      ← Reactive proxy + silent guard
├── views/                ← per-section render: registry, gantt, dashboard, employees, …
├── integrations/         ← Portfolio Pulse, Black Dashboard, TechInfo, EmployeePerformance, TeamScanner2, Release 2.0
│   └── release2/         ← V22+ Phase 5 — Release 2.0 sub-tab (Fields/Model/Api/State/Renderer/Orchestrator)
├── chat/                 ← LLM-чат + meta-navigator (Scanner / Чёрный / Гант queries)
├── ai/                   ← AI-Анализ + AI-CEO views (analytics, не chat)
├── components/           ← переиспользуемые: Multiselect, TagInput
├── tests/unit/           ← node:test
├── tests/contract/       ← contract-tests (fake-Jira + server.js)
├── tests/playwright/     ← V22+ Sprint C — visual smoke (`scanner-smoke` + `full-audit`)
└── libs/                 ← vendored xlsx + sql-wasm
```

## 3 контракта которые легко нарушить

Эти три вещи **не очевидны** и ломают всё если их не знать. Прочти **прежде чем что-то менять в state**:

1. **Reactive.silent contract** — мутации `state.rows[i].x = y` через Proxy автоматически триггерят `Storage.save + App.refreshAll`. Mass-mutations (snapshot restore, syncColumnSettings) ОБЯЗАНЫ быть в `Reactive.silent(() => { ... })` иначе infinite loop.

2. **Identity-deterministic attribution** (V17.2 I1c) — `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId}` это **авторитетная identity-таблица** для всех интеграций. Никаких fuzzy-name-matches. Если у сотрудника `bitbucketLogin` пустой — он НЕ должен получать BB-данные.

3. **`_scrubSecrets` policy** — все экспорты (CSV / JSON / bundle) ОБЯЗАНЫ проходить через `CSV._scrubSecrets()`. Любой новый export-path без него = security regression.

→ Полные контракты с code examples: [`docs/state-contracts.md`](./docs/state-contracts.md)

## Как читать audit-метки в коде

Часто встретишь комментарии вида:
```js
// V17.2 I1c (QA §3 Bug 3.2) — empty-URL guard
// V22+ Sprint A — tokenized (was hardcoded HEX × 9)
```

Расшифровка:
- **`V17.2 I1c`** — версия + группа фиксов. Audit-папки удалены — найди контекст через `git log -S "V17.2 I1c"`.
- **`(QA §3 Bug 3.2)`** — источник (эксперт + параграф) из 5-агентного аудит-паттерна (full-stack / QA / system analyst / art-director / designer).
- **`V22+ Sprint A`** — последняя активная итерация: Release 2.0 sub-tab + Scanner visual grooming. См. `git log --grep='V22+'`.

## Доменный словарь — must read

LLM, не знающий что такое **Sigma Jira** или **scope=Требует подтверждения**, делает чушь. Прочти [`docs/domain-glossary.md`](./docs/domain-glossary.md) **прежде** чем менять что-то в Реестре / Ганте / Дашборде.

Ключевые термины (1-строчная справка):
- **Delta Jira** — основная Jira (задачи команд, источник Реестра)
- **Sigma Jira** — отдельный инстанс для квартальных эпиков-целей (Чёрный дашборд)
- **Release 2.0** — кастомный Jira issue-type для управления процессом релизов (56 custom-fields)
- **Релизы 1.20 / 1.21 / 1.22 / Овертайм / Бэклог** — окна планирования (не релизы в общем смысле)
- **Scope** — `Да / Нет / Требует подтверждения` (3-значный, не bool)
- **Эпик** в Реестре = строка с epic-name; **«N задач у эпика»** в Ганте = типы работ (BE/FE/QA), не sub-tasks

## Принципы дизайна (V15 Spine-pill, V22+ refined)

- **Без эмодзи** в production UI (✓ только в emoji-палитре или диагностике); unicode-glyphs тоже → inline SVG
- **Без gradients** на surfaces; accent — semantic only
- **3px stripe-left** для активных/выделенных элементов вместо filled background
- **Mono-tabular numerals** на всех числовых данных (ui-monospace + `font-feature-settings: "tnum"`)
- **CAPS sub-headers** унифицированы 10px/700/`letter-spacing: .6px`
- **Color через токены** — `var(--prizma-information / -on-course / -drift / -off-course / -approve)`; никаких hardcoded HEX
- Полнее: [`docs/spine-pill.md`](./docs/spine-pill.md)

## Команды

```bash
npm start                    # node launch.js 8080 → http://localhost:8080
npm run server               # node server.js 8080 (without launch.js wrapper)
npm test                     # testRunner + unit + contract
npm run test:unit            # node:test only (~1613 tests)
npm run test:contract        # 11 contract tests (fake-Jira + server.js)
npm run test:e2e             # HTTP smoke (e2eTest.js)
npm run test:visual          # Playwright visual smoke
npm run test:visual:ci       # same + JSON-reporter для CI artifact
npm run typecheck            # tsc --checkJs (JSDoc-typed files only)
npm run lint                 # eslint --max-warnings 215
npm run ci                   # typecheck + lint + test + e2e + perfBudget
```

## Server logging (V19 E4)

Server использует `server/logger.js` — structured JSON logger вместо
ad-hoc `console.log`. По умолчанию newline-delimited JSON в stdout
(error → stderr) для ELK ingestion.

```bash
LOG_LEVEL=debug node server.js     # показать debug entries (default: info)
LOG_FORMAT=pretty node server.js   # human-readable для разработки
LOG_TS=epoch node server.js        # ms timestamps вместо ISO
```

Code:
```js
const logger = require('./server/logger.js');
logger.info('jira-fetch ok', { pks: ['A','B'], ms: 234 });
logger.error('crashed', { err: e.message });
const reqLogger = logger.withReqId('r-42');   // child с reqId
reqLogger.info('handling /api/foo');
logger.event('scanner2.detail_open', { ... }); // V19 C4 telemetry
logger.timeStart('jira.fetch');
// ... work ...
logger.timeEnd('jira.fetch', { pks });   // emits info с latencyMs
```

Для одного теста: `node --test tests/unit/foo.test.js`

## Куда копать при типичных задачах

| Хочу… | Иди в… |
|---|---|
| Добавить view / section | [`ARCHITECTURE.md` § Adding a view](./ARCHITECTURE.md) |
| Добавить интеграцию-endpoint | [`docs/integrations/README.md`](./docs/integrations/README.md) + [`api-endpoints.md`](./docs/integrations/api-endpoints.md) |
| Изменить state shape | [`docs/state-contracts.md`](./docs/state-contracts.md) — особенно про migrations `q2_*_v3` |
| Понять как работает Portfolio Pulse pipeline | [`docs/integrations/README.md` § Pulse pipeline](./docs/integrations/README.md) |
| Работать с Release 2.0 sub-tab | [`docs/integrations/release2.md`](./docs/integrations/release2.md) |
| Запустить за корп-proxy | [`docs/running.md`](./docs/running.md) — `allowInsecureTls` flag |
| Написать тест | [`docs/testing.md`](./docs/testing.md) |
| Понять почему `_ppFindByPartial` существует но не используется | [`docs/dont-touch.md`](./docs/dont-touch.md) |
| Найти когда что появилось | [`docs/version-history.md`](./docs/version-history.md) + `git log --grep="V22"` |
| Прогнать Playwright | `npm run test:visual` — config в `tests/playwright/playwright.config.js` |

## Что НЕ трогать

- `Reactive.silent(...)` обвязка в `Storage.save / restore / syncColumnSettings` — без неё infinite loop
- Vendored libs (`libs/xlsx.full.min.js`, `libs/sql-wasm.*`) — обновлять только через security review
- `_ppFindByPartial` в `integrations/portfolioPulseModel.js` — dev-only fallback за флагом, не «починяй» как production code (см. [`docs/dont-touch.md`](./docs/dont-touch.md))
- `Sigma fields` хранятся ВНУТРИ `jira_config.json` — это исторический артефакт, миграция = breaking change
- Welcome 3-stage flow (overlay + onboarding-empty + tour) — не пытайся сломать порядок, тесты Playwright bypass это покрывают

## Безопасность по умолчанию

- Никогда не логи / экспорты не должны содержать `Authorization`, `Bearer`, `token`, `password`, `apiKey`, `authKey`, `secret` (и nested-формы) — пройди через `CSV._scrubSecrets`
- HTML вставка в DOM — только через `Utils.escapeHtml`
- CSV-экспорт префиксует `​` для значений начинающихся с `= + - @ \t \r` (formula injection guard, V17 P9 F1)
- Server SSRF-guard блокирует исходящие запросы на IPv4 loopback (127.0.0.0/8) — fake-Jira в тестах работает через `allowInsecureTls`
- См. [`docs/integrations/auth-and-secrets.md`](./docs/integrations/auth-and-secrets.md)

## Если что-то пошло не так

1. `npm test` — baseline 1613/1618 unit (5 pre-existing fails). Если меньше pass — что-то регрессировало.
2. `node --check <file>` — синтаксис.
3. `npm run test:visual` — visual regression на демо-данных.
4. Browser console — F12, типичные ловушки: `SyntaxError: Unexpected private name #int` = backtick внутри HTML-комментария внутри template literal (V17.2 — реальная история, см. `docs/dont-touch.md`).
5. `state.integrations` НЕ существует — для проверки настроек интеграций используй `integrations/integrationsStore.js` → `loadSettings()` (см. fix-commit `9972a20`).

---

**Краткое резюме для LLM:** проект — vanilla JS frontend + Node proxy, identity-deterministic интеграции, single mutable state с Reactive proxy. Текущая итерация V22+ — Release 2.0 sub-tab + Scanner visual grooming + Playwright e2e. Сделай маленькое — не сломай контракты. Остальное по ссылкам выше.
