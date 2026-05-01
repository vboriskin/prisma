# CLAUDE.md — точка входа для LLM-агента

> Если ты LLM-агент, читающий этот проект впервые — этот файл. Остальное по ссылкам.

> **Текущая активная итерация: V18** (structural debt cleanup + DX enablement). Roadmap: [`audit-2026-05-V18/MASTER_PLAN.md`](./audit-2026-05-V18/MASTER_PLAN.md).

## Что это за проект

**СБОФ Планирование v17** — внутренний инструмент квартального планирования для мобильной платформы Сбербанка. Управление эпиками / релизами / зависимостями + интеграции (Jira / Bitbucket / Confluence / GigaChat-LLM).

- **44k LOC vanilla JS** (ES modules), **без бандлера, без build-step**
- Браузер ↔ один Node.js сервер (`server.js`, ~2.5k строк)
- Никаких рантайм npm-пакетов; vendored только `xlsx.full.min.js` + `sql-wasm.*`
- Test base: **534 unit / 11 contract / 10 e2e**

Vanilla — **сознательно** (corporate compliance, supply-chain immunity, AI-augmented dev workflow). Подробнее в [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Карта в 30 секунд

```
/
├── server.js             ← один Node-сервер: статика + /api/* proxy для интеграций
├── app.js                ← orchestrator: bootstrap, navigation, reactive flush
├── state.js              ← единый mutable state (Proxy-обёрнут — см. контракты!)
├── dataStore.js          ← persistence (localStorage + SQLite-WASM optional)
├── rowFactory.js         ← фабрики Row + Employee (включая identity-поля для интеграций)
├── filters.js            ← FilterEngine (cache, getFiltered, getActiveCount)
├── reactiveStore.js      ← Reactive proxy + silent guard
├── views/                ← per-section render: registry, gantt, dashboard, employees, ...
├── integrations/         ← Portfolio Pulse, Black Dashboard, TechInfo, EmployeePerformance
├── chat/                 ← LLM-чат (отдельный AI-ассистент, не путать с aiView)
├── ai/                   ← AI-Анализ + AI-CEO views (analytics, не chat)
├── components/           ← переиспользуемые: Multiselect, TagInput
├── tests/unit/           ← 27 файлов, node:test
├── audit-2026-*/         ← read-only ADR-history (см. `docs/version-history.md`)
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
```

Расшифровка:
- **`V17.2 I1c`** — версия + группа фиксов. Найди в `audit-2026-05-V17/13-integrations-audit.md` секцию I1c.
- **`(QA §3 Bug 3.2)`** — источник (эксперт + параграф). У нас 5-агентный аудит-паттерн (full-stack / QA / system analyst / art-director / designer), `audit-2026-*/<пункт>.md` содержит их находки.
- Если ярлык — `V14 (B2)` без группы — значит legacy. См. `docs/version-history.md` для расшифровки V11→V17.2.

## Доменный словарь — must read

LLM, не знающий что такое **Sigma Jira** или **scope=Требует подтверждения**, делает чушь. Прочти [`docs/domain-glossary.md`](./docs/domain-glossary.md) **прежде** чем менять что-то в Реестре / Ганте / Дашборде.

Ключевые термины (1-строчная справка):
- **Delta Jira** — основная Jira (задачи команд, источник Реестра)
- **Sigma Jira** — отдельный инстанс для квартальных эпиков-целей (Чёрный дашборд)
- **Релизы 1.20 / 1.21 / 1.22 / Овертайм / Бэклог** — окна планирования (не релизы в общем смысле)
- **Scope** — `Да / Нет / Требует подтверждения` (3-значный, не bool)
- **Эпик** в Реестре = строка с epic-name; **«N задач у эпика»** в Ганте = типы работ (BE/FE/QA), не sub-tasks

## Принципы дизайна (V15 Spine-pill)

- **Без эмодзи** в production UI (✓ толкьо в emoji-палитре или диагностике)
- **Без gradients** на surfaces; accent — semantic only
- **3px stripe-left** для активных/выделенных элементов вместо filled background
- **Mono-tabular numerals** на всех числовых данных (ui-monospace + `font-feature-settings: "tnum"`)
- **CAPS sub-headers** 9-10px / letter-spacing .6-.7px
- Полнее: [`docs/spine-pill.md`](./docs/spine-pill.md)

## Команды

```bash
npm start                    # node launch.js 8080 → http://localhost:8080
npm run server               # node server.js 8080 (without launch.js wrapper)
npm test                     # testRunner + unit + contract → 534/11/0
npm run test:unit            # node:test only
npm run typecheck            # tsc --checkJs (JSDoc-typed files only)
npm run lint                 # eslint --max-warnings 215
npm run ci                   # typecheck + lint + test + e2e + perfBudget
```

Для одного теста: `node --test tests/unit/foo.test.js`

## Куда копать при типичных задачах

| Хочу… | Иди в… |
|---|---|
| Добавить view / section | [`ARCHITECTURE.md` § Adding a view](./ARCHITECTURE.md) |
| Добавить интеграцию-endpoint | [`docs/integrations/README.md`](./docs/integrations/README.md) + [`api-endpoints.md`](./docs/integrations/api-endpoints.md) |
| Изменить state shape | [`docs/state-contracts.md`](./docs/state-contracts.md) — особенно про migrations `q2_*_v3` |
| Понять как работает Portfolio Pulse pipeline | [`docs/integrations/README.md` § Pulse pipeline](./docs/integrations/README.md) |
| Запустить за корп-proxy | [`docs/running.md`](./docs/running.md) — `allowInsecureTls` flag |
| Написать тест | [`docs/testing.md`](./docs/testing.md) |
| Понять почему `_ppFindByPartial` существует но не используется | [`docs/dont-touch.md`](./docs/dont-touch.md) |
| Найти когда что появилось | [`docs/version-history.md`](./docs/version-history.md) |

## Что НЕ трогать

- `audit-2026-*/` — read-only ADR-history, не редактируй
- `Reactive.silent(...)` обвязка в `Storage.save / restore / syncColumnSettings` — без неё infinite loop
- Vendored libs (`libs/xlsx.full.min.js`, `libs/sql-wasm.*`) — обновлять только через security review
- `_ppFindByPartial` в `integrations/portfolioPulseModel.js` — dev-only fallback за флагом, не «починяй» как production code (см. [`docs/dont-touch.md`](./docs/dont-touch.md))
- `Sigma fields` хранятся ВНУТРИ `jira_config.json` — это исторический артефакт, миграция = breaking change

## Безопасность по умолчанию

- Никогда не логи / экспорты не должны содержать `Authorization`, `Bearer`, `token`, `password`, `apiKey`, `authKey`, `secret` (и nested-формы) — пройди через `CSV._scrubSecrets`
- HTML вставка в DOM — только через `Utils.escapeHtml`
- CSV-экспорт префиксует `​` для значений начинающихся с `= + - @ \t \r` (formula injection guard, V17 P9 F1)
- См. [`docs/integrations/auth-and-secrets.md`](./docs/integrations/auth-and-secrets.md)

## Если что-то пошло не так

1. `npm test` — должно быть 534/11/0. Если меньше — что-то регрессировало.
2. `node --check <file>` — синтаксис.
3. Browser console — F12, типичные ловушки: `SyntaxError: Unexpected private name #int` = backtick внутри HTML-комментария внутри template literal (V17.2 — реальная история, см. `docs/dont-touch.md`).

---

**Краткое резюме для LLM:** проект — vanilla JS frontend + Node proxy, identity-deterministic интеграции, single mutable state с Reactive proxy, audit-папки = ADR. Сделай маленькое — не сломай контракты. Остальное по ссылкам выше.
