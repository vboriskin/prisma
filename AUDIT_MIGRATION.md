# AUDIT_MIGRATION.md — Целесообразность миграции на React + Node.js

> **Этап 13 из 14.** Команда: tech lead (опыт больших миграций) + senior frontend (React) + senior backend (Node.js) + продакт.
>
> Объём — взвешенный анализ. Цель **не «продать React»** и **не «защитить vanilla»**, а дать честное основание для решения.
>
> Корень: `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`
> Карта: [`AUDIT_MAP.md`](./AUDIT_MAP.md). Архитектура: [`ARCHITECTURE.md`](./ARCHITECTURE.md). Точка входа LLM: [`CLAUDE.md`](./CLAUDE.md).
>
> Дата: 2026-05-07.

---

## TL;DR (для тех кто читает только первые 2 экрана)

**Вердикт: НЕ мигрировать целиком. Частично — только если появятся конкретные триггеры (сейчас их нет).**

Одной фразой: **«Vanilla здесь не легаси, а архитектурный актив; миграция на React/Node-стек обойдётся в ~24-40 человеко-месяцев и не решит ни одной из реальных проблем продукта, но создаст 8-12 новых.»**

Trade-offs мы обсуждаем ниже. Если коротко:
- **Боль 1 «нанимать сложно»** — слабая и нерелевантная (продукт растёт через AI-augmented workflow, не через найм React-разработчиков).
- **Боль 2 «производительность фронта»** — реальная локально (Гант, Сканнер), но решается точечной оптимизацией DOM, а не сменой стека. React не быстрее, чем правильно написанный imperative DOM на 2k строк.
- **Боль 3 «онбординг разработчика»** — реальная, но решается документами и декомпозицией god-modules (`teamScanner2Renderer.js` 4.9k строк, `gantt.js` 2.8k, `server.js` 6.5k), а не React-ом.
- **Боль 4 «AI-стек на TS/Node»** — фронт не нуждается в SDK напрямую, всё проксируется через `server.js`; на сервере мы УЖЕ Node.js. SDK (Anthropic, OpenAI, GigaChat) можно интегрировать без React.
- **Сильные стороны, которые можно потерять:** corporate compliance (security review каждого пакета), supply-chain immunity (нет npm-зависимостей в рантайме), one-step deploy (`node server.js`), AI-augmented dev workflow (vanilla генерируется LLM-ами надёжнее, чем JSX/TSX в больших фрагментах).

Развёрнутый разбор — ниже.

---

## Оглавление

- [Часть А: Текущий стек и его проблемы](#часть-а-текущий-стек-и-его-проблемы)
  - [А.1. Что используется сейчас](#а1-что-используется-сейчас)
  - [А.2. Реальные боли по коду](#а2-реальные-боли-по-коду)
  - [А.3. Сильные стороны, которые можно потерять](#а3-сильные-стороны-которые-можно-потерять)
- [Часть Б: Целесообразность миграции](#часть-б-целесообразность-миграции)
  - [Б.1. Скорость разработки 1/2/3 года](#б1-скорость-разработки-123-года)
  - [Б.2. Найм и онбординг](#б2-найм-и-онбординг)
  - [Б.3. Экосистема и доступность библиотек](#б3-экосистема-и-доступность-библиотек)
  - [Б.4. Производительность](#б4-производительность)
  - [Б.5. Стоимость инфраструктуры](#б5-стоимость-инфраструктуры)
  - [Б.6. Риски миграции](#б6-риски-миграции)
  - [Б.7. Совместимость с LLM-стеком](#б7-совместимость-с-llm-стеком)
  - [Б.8. Честный вердикт](#б8-честный-вердикт)
- [Часть В: Если стоит — стратегия](#часть-в-если-стоит--стратегия)
  - [В.1. Big-bang vs Strangler](#в1-big-bang-vs-strangler)
  - [В.2. Очерёдность разделов](#в2-очерёдность-разделов)
  - [В.3. Контракты между старым и новым](#в3-контракты-между-старым-и-новым)
  - [В.4. Команда не должна остановиться](#в4-команда-не-должна-остановиться)
- [Часть Г: Оценка трудозатрат и рисков](#часть-г-оценка-трудозатрат-и-рисков)
  - [Г.1. Сложность миграции по 18 разделам](#г1-сложность-миграции-по-18-разделам)
  - [Г.2. Общая оценка в человеко-месяцах](#г2-общая-оценка-в-человеко-месяцах)
  - [Г.3. Топ-10 рисков](#г3-топ-10-рисков)
  - [Г.4. Что нужно решить ДО начала](#г4-что-нужно-решить-до-начала)
- [Часть Д: Альтернативы](#часть-д-альтернативы)
- [Финальная рекомендация](#финальная-рекомендация)

---

# Часть А: Текущий стек и его проблемы

## А.1. Что используется сейчас

### А.1.1. Frontend — vanilla JS, ES modules, без бандлера

| Слой | Реализация | Объём |
|---|---|---|
| Модули | Native ES modules (`<script type="module">`), импорты по relative path | 44k LOC, 18 разделов |
| Rendering | Imperative DOM через `innerHTML` + `Utils.escapeHtml` | per-view `render()` функции |
| State | Single mutable object `state`, обёрнут в Proxy → debounced flush 100мс | `state.js` 188 LOC + `reactiveStore.js` |
| Persistence | `localStorage` (default) + SQLite-WASM (opt-in) | `dataStore.js` 1.3k LOC |
| Type checking | JSDoc + `tsc --checkJs` (per-file `// @ts-check`) | `globals.d.ts`, `tsconfig.json` |
| Tests | `node:test` + samописный `testRunner.js` | 534 unit / 11 contract / 10 e2e |
| Lint | ESLint 9 flat config + custom rules в `eslint-rules/` | `--max-warnings 215` (legacy debt) |
| Vendored libs | `xlsx.full.min.js` (~930 KB), `sql-wasm.{js,wasm}` (~50+660 KB), `safeHtml.js`, `echarts.esm.min.js` | в `libs/` |
| Build-step | **Нет.** Нет webpack, vite, esbuild, swc | вообще |

Отсутствие бандлера — это не «не успели», а **сознательная позиция** (см. `ARCHITECTURE.md` §«Почему vanilla — рацио» и `CLAUDE.md`). Каждый импорт работает в браузере 1-в-1 как в `node:test`. Source maps не нужны — стек-трейсы указывают на исходный файл и строку.

### А.1.2. Backend — один Node.js процесс на встроенных модулях

| Что | Реализация |
|---|---|
| HTTP-сервер | `node:http` + `node:https` напрямую, без Express/Fastify/Koa |
| Маршрутизация | switch по `req.url` в `server.js` (~6.5k LOC) |
| Static-server | `fs.realpath`-based path-traversal guard, MIME map в коде |
| Proxy для интеграций | `/api/integrations/*` (Jira Delta, Jira Sigma, Bitbucket, Confluence, Zephyr, Jenkins, GigaChat) |
| Конфиг-стор | `jira_config.json` рядом с `server.js`, atomic write |
| Логирование | `server/logger.js` — NDJSON в stdout, child loggers с reqId, telemetry events, timeStart/timeEnd |
| Auth | OAuth для GigaChat (server-side caching токена), Bearer/Basic для остального |
| Async jobs | inline cache `{jobId: {status, result, progress}}` (Black Dashboard) |
| DevDeps | `typescript`, `eslint`, `@eslint/js` — **только три devDependencies, ноль рантайм-зависимостей** |

`server.js` 6.5k строк — это уже монолит, и это известная боль (V18 §10 `10-server-decomposition.md`). Но это **боль декомпозиции god-module-а**, а не «нам нужен Express».

### А.1.3. Shared / общее

- **Контракты state** (`docs/state-contracts.md`): Reactive.silent, identity-deterministic attribution, _scrubSecrets policy. Это бизнес-инварианты, которые пережили бы ребазу на React (но потребовали бы переписывания на новой парадигме reactivity).
- **Domain glossary** (`docs/domain-glossary.md`): Sigma vs Delta Jira, scope=Требует подтверждения, релизы 1.20-Овертайм-Бэклог. На этом стоит вся доменная модель — стек не влияет.
- **Identity tables**: `state.employees[].{email, jiraAccountId, bitbucketLogin, confluenceAccountId, jenkinsUserId}` — авторитетная таблица для всех интеграций.
- **CSV/JSON/XLSX export** через `_scrubSecrets`. Любой новый стек обязан перенести эту политику.
- **Onboarding-тур** (24-step legacy + CEO micro-tour) — DOM-driven, опирается на selectors конкретных секций.

## А.2. Реальные боли по коду

Отделим **реальные боли** (имеющие следы в коде или в audit-папках) от **гипотетических болей** (часто приписываемых vanilla в общем).

### А.2.1. Реальные боли (документированные)

#### Боль 1. God-modules — есть и они тяжёлые

| Файл | LOC | Причина роста | План |
|---|---|---|---|
| `integrations/teamScanner2Renderer.js` | 4 890 | god-renderer для Glance/Today/Operations/Trends/Sleeping data sub-tabs | Разделение на под-рендереры — V19 backlog |
| `server.js` | 6 486 | роуты + fetcher'ы + Pulse helpers + аналитики в одном файле | `audit-2026-05-V18/10-server-decomposition.md` |
| `views/gantt.js` | 2 804 | основной ганттовый рендер + interactions + drag/drop + подсветки | V18.3 `v18-3-B1-gantt-recon.md` |
| `integrations/teamScanner2.js` | 2 711 | orchestrator + scheduling + classification routing | разделить с classifier как single source |
| `app.js` | 2 208 | bootstrap + nav + bulk-edit + helpers | `audit-2026-05-V18/09-app-decomposition.md` (частично сделано) |
| `dataStore.js` | 1 337 | persist + import/export + migrations + scrub | OK для своего класса |
| `integrations/teamScanner2Enrichment.js` | 1 351 | enrich + classify + score | требует разделения |

**Это не «vanilla виноват».** Те же файлы на React были бы такими же длинными — потому что причина роста — **отсутствие доменной декомпозиции**, а не выбор фреймворка. Переписывание в JSX размером 4.9k LOC станет 4.5k LOC + потеря всех V17/V18-фиксов.

#### Боль 2. Reactive race condition (tech-audit V17 §H1)

`audit-2026-05-V17/01-tech-audit.md:65` фиксирует: drag/drop в Ганте вызывает `Storage.save() + GanttView.renderChart()` напрямую, параллельно Reactive proxy ловит мутации и через 100мс делает `Storage.save() + App.refreshAll()`. Грэйс-период 250мс не всегда срабатывает → двойной рендер → ~120мс freeze.

**Это не «vanilla виноват»** — это design-bug в reactive layer. Аналогичная проблема в React — это «`setState` в `useEffect` вызвал rerender, который вызвал ещё один setState» — лечится одинаково: explicit batching и understanding control flow.

В React эту проблему **сложнее** диагностировать, не легче: VDOM diff скрывает то, что в imperative коде видно стек-трейсом.

#### Боль 3. ESLint legacy warnings (215 max-warnings)

`package.json` фиксирует `--max-warnings 215`. Это технический долг, но он:
- не блокирует CI
- частично legacy от V14-V15 (filled-pill chips, GanttV2)
- лечится постепенным cleanup-ом

В React-стеке аналогичный долг был бы выражен в `react-hooks/exhaustive-deps`, `no-unused-vars`, `import/order` — то же самое в другой форме.

#### Боль 4. Производительность Ганта на 1k+ строках

Гант рендерит DOM-узлами (не canvas), на 1500 эпиках падает в 3-5fps при scroll. Это известно (V18.3 B1 recon). Лечится:
- виртуализацией (только видимые ячейки)
- canvas-режимом для read-only превью
- де-дупликацией selectors (cache)

Ни одно из этих решений **не требует React**. Виртуализация в vanilla — 200-400 LOC, и это уже частично сделано в Реестре. На React можно взять `react-window` (одна зависимость → corporate review), но это не «бесплатно».

#### Боль 5. Onboarding 24-шаговый тур хрупкий к переработке секций

`onboarding/onboarding.js` опирается на DOM selectors конкретных секций (registry/gantt). При reflow секции — тур ломается. Это описано в `audit-2026-05-V17/12-tour-audit.md`.

В React-стеке — было бы то же самое (тур по `data-tour-id`-атрибутам), плюс пришлось бы переписать его под новый рендеринг. **Миграция тур не починит, а удвоит работу.**

#### Боль 6. Async-job pattern для Black Dashboard inline в server.js

`/api/integrations/black-dashboard/start` + `/status?jobId=...` — реализован как inline cache в памяти процесса. Если сервер падает — джобы теряются. Это OK для внутреннего инструмента, но видимо как боль (`audit-2026-05-V18/07-async-job-unification.md`).

Не требует React/Node — это backend-decomposition, и решается на текущем стеке (вынести в `server/jobs.js`, добавить optional persist в SQLite).

#### Боль 7. CSS на 20k LOC в одном файле

`styles.css` 19 995 строк. Это уже структурно тяжело: нет namespacing, ESLint для CSS не настроен, селекторы пересекаются. Audit-папки фиксируют это (visual audit, design-audit).

**Миграция на React не лечит.** Это лечит:
- разделение по разделам (`styles/registry.css`, `styles/gantt.css`, ...)
- CSS Layers или PostCSS scoping
- удаление dead-rules через `purgecss`-like инструмент

В React можно было бы взять CSS Modules / styled-components / Tailwind. Но:
- CSS Modules требует бандлера
- styled-components — runtime overhead
- Tailwind — мог бы помочь, но он работает и без React (есть build-step CSS scanner)

То есть «лечить CSS» можно отдельным треком, не привязанным к React.

### А.2.2. Гипотетические боли (часто приписываемые vanilla)

| Гипотетическая боль | Реальность в этом проекте |
|---|---|
| «Без Reactвозможно нет компонентной модели» | Есть: `views/*.js` — фактически компоненты с `render(rows)`. Reusable: `components/multiselect.js`, `components/tagInput.js` |
| «Без VDOM медленно» | Imperative DOM с правильным diff (changed-keys patching) **быстрее** VDOM. Гант и Реестр пишут в DOM целево, не перерисовывают всё. |
| «Без TypeScript нет типобезопасности» | Есть: JSDoc + `tsc --checkJs`. Не такой строгий как `.ts`, но 80% покрытия типов уже даёт. |
| «Без бандлера нет tree-shaking» | Не нужен: 44k LOC + 0 рантайм-зависимостей = 0 dead code from third-party. ES modules nativly загружают только импортируемое. |
| «Без HMR медленно разрабатывать» | Нет HMR — есть `Cmd+R`. Cold reload `localhost:8080` — ~300мс. Hot reload в React-проекте на 44k LOC даёт ~500-1500мс с warm cache. Разница не существенна. |
| «Без npm нет библиотек» | Есть: vendored xlsx, sql-wasm, echarts. Каждый — single-file, прошёл security review. **Это feature, не bug.** |

## А.3. Сильные стороны, которые можно потерять

Это самая важная часть Части А. **Если миграция теряет хотя бы один из этих пунктов — нужен ясный план компенсации.**

### А.3.1. Corporate compliance (security review каждой зависимости)

Текущая ситуация: 0 рантайм-зависимостей, 3 devDependencies (`typescript`, `eslint`, `@eslint/js`). 4 vendored библиотеки прошли разовый security review.

**С React + Next.js:**
- `react`, `react-dom` — ~25 transitive dependencies
- `next` — ~150-200 transitive dependencies
- Минимальный enterprise-стек (`@tanstack/react-query`, `zod`, `react-hook-form`, `radix-ui`, иконки) — **300-500 packages**

Каждый требует security review. Каждое minor-обновление — повторный review. В крупных корпоративных стеках это занимает 2-12 недель **на каждый review-цикл**.

**Если вы не пройдёте этот процесс быстро — миграция стоит на месте.**

### А.3.2. Supply-chain immunity

Сценарии типа `event-stream` (2018), `node-ipc` (2022), `ua-parser-js` (2021), `colors.js` / `faker.js` (2022), `xz-utils backdoor` (2024) — **невозможны в текущей конфигурации**. Mitigation в стеке с 500 npm-deps стоит:
- private npm registry
- SBOM scanning (Snyk / Dependency-Track)
- `npm audit` в CI с blocking failure
- pinned versions (`package-lock.json` + lockfile-lint)
- weekly dependency review

Это весь штат security engineer-а или ~25-40% времени одного DevOps. На внутреннем инструменте — оверкилл.

### А.3.3. One-step deploy

`node server.js` — это весь production-флоу. Никакого `npm run build`, `next build`, `docker build`, `kubectl apply`. На внутреннем сервере под Сбером это:
- exit-code 0 если упало → systemd restart
- логи в stdout → ELK ingestion
- конфиг через `jira_config.json` рядом

С Next.js:
- `next build` — обязателен
- `.next/` — артефакт ~50-200 MB
- ISR / SSR routing — добавляет surface
- standalone-mode `output: 'standalone'` — отдельный процесс, отдельные правила

### А.3.4. AI-augmented dev workflow (vanilla генерируется LLM-ами надёжнее)

Это **сложно квантифицировать, но эмпирически наблюдаемо** на этом проекте (V11→V17.2, ~20 итераций аудитов с LLM-командой):

- LLM **редко** ошибается в plain ES modules + imperative DOM (если контракты state описаны)
- LLM **часто** ошибается в JSX + hooks (особенно: `useEffect` deps, stale closures, key warnings, server vs client components в Next.js App Router)
- LLM **очень часто** ошибается в Server Components / RSC boundary (это новая парадигма, документация противоречит сама себе ещё в 2025)

44k LOC vanilla генерируются LLM-ами с ~95% правильностью при наличии CLAUDE.md. Тот же объём в React/Next.js — ~80-85% (нужно больше итераций fix-up). На длинной дистанции (10-30 итераций аудитов) — это **3-5x времени**.

> **Это не «React хуже».** Это «React сложнее для LLM в текущем состоянии моделей». Через 2-3 года, возможно, паритет — но мы не можем ждать.

### А.3.5. Offline-friendly режим (`file://` / proxy without network)

Прямо сейчас работает: открыть `index.html` через `file://` или `localhost:8080` без доступа в интернет. SQLite-WASM persistence — локальный файл.

Next.js / Vite-стек требует dev-server для HMR и dev-mode features. Production-build static-export возможен, но ограничивает SSR/middleware.

### А.3.6. Zero-cost long-term-support

Vanilla ES modules не «устаревают». Код 2026 года будет читаться браузером 2036-го без правок (если нет syntax-deprecation, чего на ES2020-2024 не происходит).

React 16 → 17 → 18 → 19 — каждый переход стоил миграционного флоу. React 19 + Server Actions — отдельный mental model. Через 5 лет проект на React 19 будет иметь legacy class components / function components / server components / suspense boundaries — три-четыре эры в одной кодовой базе.

### А.3.7. AI-команда уже растит проект на vanilla

В CLAUDE.md прямо: «Команда фактически растит проект через Claude/Cursor». Это значит:
- Существующие промпты, паттерны, гайды — все vanilla-ориентированные
- Разработчик-человек выступает как код-ревьюер LLM-генерации, не как primary author
- Если переписать на React — нужно переписать **все промпты, все паттерны, все гайды**, переучить команду на новый mental model

Это **скрытая стоимость**, которая не видна в migration estimate, но реально измеряется в месяцах.

---

# Часть Б: Целесообразность миграции

## Б.1. Скорость разработки 1/2/3 года

### Б.1.1. Метрика: «фичи в квартал» (proxy для velocity)

Текущая velocity (по audit-папкам): V17, V18, V19, V21-tabs — каждый ~3-6 месяцев, ~5-12 значимых фичей за итерацию. То есть ~15-30 фичей в год.

#### Сценарий A: остаёмся на vanilla

| Период | Velocity | Обоснование |
|---|---|---|
| 0-12 мес | 100% (baseline) | Команда продолжает по AI-augmented workflow |
| 12-24 мес | 105-110% | Decomposition (V18 09/10) уменьшит time-to-feature на 5-10% |
| 24-36 мес | 100-105% | Естественная стагнация по мере роста кодбазы |

Total features 1-3 yr: ~50-90 фичей.

#### Сценарий B: full migration (big-bang) на React + Next.js

| Период | Velocity | Обоснование |
|---|---|---|
| 0-3 мес | 30-50% | PoC, выбор фреймворков, security review зависимостей |
| 3-9 мес | 10-30% | Параллельная разработка (старая фича + перенос) |
| 9-18 мес | 0-20% | Critical path migration phase, 70% времени на rewrite |
| 18-24 мес | 50-70% | Стабилизация, fix-up bugs |
| 24-36 мес | 110-130% | Если миграция удалась — выйдете на новый baseline |

Total features 1-3 yr: ~25-50 фичей. **Минус 30-50% за 3 года.**

#### Сценарий C: strangler pattern (постепенная замена)

| Период | Velocity | Обоснование |
|---|---|---|
| 0-3 мес | 80% | PoC одного нового раздела |
| 3-12 мес | 70-85% | Параллельная инфра, два стека работают вместе |
| 12-24 мес | 60-80% | Самый болезненный этап: legacy + new обновляются одновременно, удвоенный onboarding |
| 24-36 мес | 80-100% | Если strangler удался — выходите на старый baseline |

Total features 1-3 yr: ~35-65 фичей. **Минус 15-30%.**

### Б.1.2. Где разница реально (за 3 года)

- **Меньше времени** уходит в год N≥2 на: типобезопасность (TS), компонентная переиспользуемость (если её не было), DX (HMR, devtools).
- **Больше времени** уходит на: dependency management, breaking changes между мажорными релизами React/Next, security review, разделение SSR/Client boundaries.

Нет строгого выигрыша. Для **этого** проекта (внутренний инструмент, узкая аудитория, AI-augmented команда) — миграция теряет за 3 года, не выигрывает.

## Б.2. Найм и онбординг

### Б.2.1. Текущая ситуация

- Команда **малочисленная** (по тону документов: один-два разработчика + LLM как multiplier).
- «Нанимать сложно» — не подтверждается данными. Vanilla JS — известная любому кто знает JavaScript. Найти разработчика с 5+ лет опытом vanilla DOM сложнее, чем с React, но **здесь не нужна команда из 10 человек**.
- Реальная задача — научить разработчика читать `state.js` + `reactiveStore.js` + `views/registry.js`. Это занимает 1-2 дня (есть CLAUDE.md, ARCHITECTURE.md, state-contracts.md).

### Б.2.2. После миграции

- React-разработчиков на рынке больше. Но: они привыкли к Next.js / TanStack / shadcn-стеку. Запретный пакет-лист в Сбере резко сужает воронку.
- React-разработчик начнёт «пинать» проектные решения: «давайте Redux Toolkit», «давайте Zustand», «давайте нормальные хуки», «нам нужен Storybook». Это **не плохо**, но превращается в фрагментацию выбора.
- Онбординг до productive contribution — 1-2 недели (идиомы команды + бизнес-логика). Не быстрее, чем сейчас.

### Б.2.3. AI-augmented vs human-augmented

Главное: команда **уже** AI-augmented. Расширение через LLM-агентов, не через найм. Аргумент «нам легче нанимать» — не релевантен, если стратегия не в найме.

**Если в течение 12-18 месяцев планируется расширение команды до 5+ человек — этот аргумент частично возвращается.** Но даже тогда, найм «vanilla + JSDoc» не критически сложнее найма «React + TS».

## Б.3. Экосистема и доступность библиотек

### Б.3.1. Что vanilla может терять

| Категория | Vanilla обходится | React даёт «из коробки» |
|---|---|---|
| Forms | ручной biend через `<input>` + state mutation | `react-hook-form` + `zod` |
| Data fetching | `fetch` + кеш в state | `tanstack-query` |
| Date pickers | свои компоненты или `<input type="date">` | `react-datepicker`, `react-day-picker` |
| Drag-and-drop | свой DOM-DnD (есть в Ганте) | `dnd-kit` |
| Charts | echarts vendored | `recharts`, `visx`, `react-plotly` |
| Icons | свои SVG | `lucide-react`, `heroicons` |
| UI primitives | свои | `radix-ui`, `react-aria` |

Каждая «удобная» библиотека — **5-50 transitive dependencies**, каждая требует security review.

### Б.3.2. Что vanilla уже использует и не теряет

- `xlsx` — vendored, single-file, работает
- `sql-wasm` — vendored, работает
- `echarts` (V19 lazy-load) — vendored
- DnD — самописный (работает в Ганте, Реестре)
- Forms — самописные (Multiselect, TagInput компоненты)
- Charts — самописный sparklines в metrics + echarts deep view
- Date pickers — `<input type="date">` (browser-native, локализован)

**Vanilla здесь не «бедный родственник» — у него все нужные компоненты есть.** Они просто написаны под продукт, а не подтянуты из экосистемы.

### Б.3.3. Где vanilla реально проигрывает

- **Accessibility (a11y)**. `radix-ui` / `react-aria` дают сильную базу за бесплатно: focus management, screen-reader announcements, keyboard navigation. Самописные компоненты на vanilla **могут** быть на том же уровне, но требуют усилий.
- **Анимации.** `framer-motion` для сложных choreographed-анимаций удобнее, чем CSS keyframes + JS orchestration. На vanilla заметные паттерны типа shared layout transitions писать дольше.
- **i18n.** `react-i18next` — батарейки. На vanilla есть `Intl` API, но без infra.

Для этого продукта (RU-only, узкая внутренняя аудитория, не мобильный, не consumer-facing) — все три проблемы малозначимы.

## Б.4. Производительность

### Б.4.1. Frontend

#### Что есть сейчас

| Раздел | Узкое место | Замер |
|---|---|---|
| Реестр | DOM-нодов на 1k+ строк × 30+ колонок | OK при виртуализации, плохо без |
| Гант | DOM-узлы на 1.5k+ эпиков | 3-5fps на scroll, V18.3 B1 |
| Сканнер | Renderer 4.9k LOC, full-recompute on update | 800-1500мс на refresh |
| Метрики | sparklines + control rings | OK |
| AI Анализ | 13 блоков, lazy-render | OK |

#### React это починит?

| Узкое место | Vanilla-fix | React-fix | Разница |
|---|---|---|---|
| Реестр без виртуализации | `views/registry.js` + virtualized window | `react-window` / `react-virtual` | + ~1 неделя на R, - ~1 зависимость |
| Гант 1500 эпиков | DOM patches diff per cell + canvas hover | reconciler + `useMemo` | Реконсилер **не быстрее** на 30k нодов. Может быть медленнее. |
| Сканнер god-renderer | разделить на под-рендереры по табам | разделить на компоненты | Параллельно. R помогает только если сейчас одна большая `render()` функция |
| Метрики | OK | OK | — |

**React VDOM не быстрее, чем правильный imperative DOM.** Это известная истина. Проблемы Ганта — алгоритмические (полный реndr вместо diff), не «нет VDOM».

Может ли React **замедлить**? Да, если:
- много `useEffect` с зависимостями, которые triggerят rerender на каждый mutate
- `useMemo` забыт на тяжёлых вычислениях → recompute on every render
- глобальный store (Redux / Zustand / Jotai) с неправильными selectors → all consumers rerender

**В среднем React-перенос не даст видимого выигрыша по фронт-перформансу для этого продукта.**

### Б.4.2. Backend

Текущий `server.js`:
- `node:http` напрямую → **очень быстрый**, нет middleware-стека
- request-handling latency: десятки микросекунд (без I/O)
- proxy fetch latency: bound сетью к Jira/BB/CF, не CPU
- async-job pattern для heavy aggregations

После миграции на Next.js / Express / Fastify:
- Express middleware overhead: ~50-200μs на handler. Не критично для proxy.
- Fastify ~ почти как `node:http`. OK.
- Next.js API routes (App Router) — сильно медленнее голого `http.createServer`, особенно с middleware-стеком.

**Нет выигрыша, есть небольшой проигрыш (5-30%) если уйти в Next.js.**

Что **могло бы** улучшить backend на текущем стеке:
- worker-threads для heavy aggregations (Black Dashboard async job)
- streaming response для больших экспортов
- горизонтальное scaling через cluster module

Все три — не требуют React.

## Б.5. Стоимость инфраструктуры

### Б.5.1. Сейчас

- 1 Node.js процесс (или systemd-сервис)
- ~30-80 MB RAM в покое
- Зависимостей: 0 рантайм
- Билд-сервер: не нужен
- CI: GitHub Actions / GitLab CI запускает `npm run ci` (typecheck + lint + test + e2e + perf budget) ~3-5 минут
- Disk: ~150 MB включая `libs/`, `audit-*` папки, и т.п.
- Egress: только integration proxy traffic

### Б.5.2. После миграции на React + Next.js

- 1 Next.js процесс или Node-сервер с обслуживанием статики
- ~150-300 MB RAM в покое (Next.js footprint)
- Зависимостей: 300-500 npm packages
- Билд-сервер: нужен (`next build` → `.next/`, ~50-200 MB артефакта)
- CI: ~5-15 минут (build + lint + test). Caching обязателен.
- Disk: ~400-800 MB включая `node_modules/`
- Лицензионный аудит: нужен (300+ packages, разные лицензии)

**Разница в стоимости железа** — пренебрежимо мала (внутренний инструмент). **Разница в стоимости процессов** — заметна:
- security review каждой минорной зависимости
- weekly `npm audit` фиксы
- SBOM-генерация для compliance
- CI время → стоимость build minutes

Грубая оценка: +0.5-1.5 FTE-month/year на dependency hygiene.

### Б.5.3. На Bun или Deno

Если уйти не на Node.js, а на Bun или Deno:

| Аспект | Bun | Deno |
|---|---|---|
| Совместимость с npm | хорошая (Node-shims) | через `npm:` specifier (медленнее) |
| Стабильность для prod | условная (1.x, в активной разработке) | стабильная (2.x) |
| Производительность | в 2-3x быстрее старта/HTTP | сравнима с Node |
| Corporate compliance | нестандарт, новый pen-test | то же |
| Ecosystem-fit | unstable | TS-first, но другой модель импортов |

**Для внутреннего инструмента в Сбере уход с Node.js на Bun/Deno — большой риск без видимого выигрыша.** Node.js LTS — стандарт.

## Б.6. Риски миграции

Подробно — в части Г, здесь общая категоризация.

| Категория | Риск-кейс |
|---|---|
| Технический | Контракты state (Reactive.silent, identity, _scrubSecrets) теряются при переписывании |
| Доменный | 18 разделов с 10+ годами накопленной бизнес-логики; «ой, пропустили scope=Требует подтверждения» |
| Тестовый | 534 unit-теста привязаны к API текущих модулей; почти все придётся переписать |
| Командный | Переход с AI-augmented vanilla на AI-augmented React — переучивание |
| Сроки | Любая миграция в больших корпорациях занимает 1.5-2x запланированного |
| Compliance | 300+ новых зависимостей через corporate security review — сроки непрогнозируемы |
| Бизнес | Параллельный freeze фичей на 6-12 месяцев = кому отвечать перед стейкхолдерами |

## Б.7. Совместимость с LLM-стеком

Это **самый часто называемый pro-аргумент** для миграции. Разберём.

### Б.7.1. Что есть LLM-стек в Призме

- **Чат**: 13 файлов в `chat/` + `app/llmAssistant.js`. Streaming через `/api/llm/chat`.
- **AI Анализ**: 13 блоков в `ai/aiView.js`, аналитика через `ai/llmClient.js`.
- **AI CEO**: отдельный view, `ai/aiCeoRenderer.js`.
- **GigaChat**: основной LLM. Server-side OAuth-кеш токена.
- **Промпты**: editor через `app/promptsEditor.js`, хранятся в `state` или в `jira_config.json`.

### Б.7.2. Где SDK реально нужен

SDK (Anthropic SDK, OpenAI SDK, GigaChat SDK) **на сервере**, не в браузере. Причины:
- API-ключи — серверные секреты
- Rate-limiting — серверная обязанность
- Streaming — должен быть proxy-able
- Caching — серверный layer

**На сервере мы УЖЕ Node.js.** Anthropic / OpenAI / GigaChat SDK для Node.js работают напрямую с текущим `server.js`. Нужно только:
- `npm install @anthropic-ai/sdk` (или OpenAI / fetch-based для GigaChat)
- security review SDK
- интегрировать в `/api/llm/chat`

**Это не требует React на фронте.** Браузер общается с `server.js` через простой HTTP/SSE — это интерфейс, агностичный к фронт-стеку.

### Б.7.3. Где LLM-инфра удобнее в React

- **Streaming UI**: библиотеки типа `ai/react` от Vercel (`useChat`, `useCompletion`) дают готовую интеграцию SSE → state. На vanilla — пишешь сам (~150-300 LOC), что **уже сделано** в `chatEngine.js` + `chatUIRenderer.js`.
- **Tool-use UX**: рендеринг tool-calls в UI с фолбэками удобнее в JSX.
- **RAG-связки**: на React + Next.js удобнее склеить `pgvector` или `chroma` через server actions. Но это **infrastructure-level**, не UI-level.

Ни одно из этих преимуществ не применяется в Призме напрямую: streaming уже работает, tool-use в чате реализован через `chatActivityHandler.js`, RAG не используется (контекст подсовывается через `chatContextBuilder.js` из state).

### Б.7.4. Reality check

| Якобы-аргумент | Реальность |
|---|---|
| «Большинство LLM SDK на TS» | Они на TS как dev-experience, но **runtime-совместимы с JS**. JSDoc + `tsc --checkJs` в проекте уже даёт большинство преимуществ. |
| «`ai/react` лучше чем самопис» | Через 6 мес проект на самопис будет в любом случае лучше под свои нужды. Lock-in в Vercel-стек = риск. |
| «AI-фичи легче строить на React» | На внутреннем продукте с 13-блочным AI-аналитикой — как раз нет. Каждый блок — кастомный, paint-by-numbers React не подходит. |

**Совместимость с LLM-стеком не является валидным аргументом для миграции в этом продукте.**

## Б.8. Честный вердикт

### Б.8.1. Вердикт: НЕ мигрировать целиком

**Обоснование (краткое):**

1. **Реальные боли (god-modules, Reactive race, Гант perf, CSS) — не лечатся миграцией.** Они лечатся на текущем стеке.
2. **Сильные стороны (compliance, supply-chain immunity, AI-augmented workflow, one-step deploy) — теряются в любом сценарии миграции.** Не компенсируются ничем сравнимым.
3. **Скорость разработки 1-3 года**: миграция отнимает 30-50% velocity. Без миграции — flat или slight growth.
4. **Найм/онбординг**: команда AI-augmented, не human-augmented. Аргумент не релевантен.
5. **Производительность**: React не делает Гант быстрее. Бэк уже быстр.
6. **Стоимость**: +0.5-1.5 FTE-month/год на dependency hygiene и compliance review.
7. **LLM-совместимость**: фронт-стек не влияет, бэк уже Node.js.

### Б.8.2. Вердикт: ЧАСТИЧНО — не имеет смысла

«Частичная миграция» (Strangler pattern для одного-двух разделов) — звучит как компромисс, но **на практике хуже всех вариантов**:

- Удвоенная инфраструктура (два build-флоу, два test-стека, два set onboarding-доков)
- Контракты между legacy и new (см. часть В.3) — добавляют свой слой багов
- Onboarding-тур, FilterEngine, Reactive proxy, identity tables — **shared** между разделами; их нельзя «частично»
- Команда фрагментируется ментально: «эта секция React, эта vanilla»

Если бы был **один отделённый ребёнок** (отдельный standalone-продукт внутри monorepo) — его можно было бы написать на чём угодно. Но в Призме все 18 разделов — части одного state.

### Б.8.3. Вердикт: ОТЛОЖИТЬ

Имеет смысл **отложить** обсуждение миграции до появления одного из триггеров:

| Триггер | Что меняет |
|---|---|
| Команда расширяется до 5+ разработчиков | Onboarding cost начинает доминировать; React-знание у новых может стать выгоднее |
| Продукт становится consumer-facing | Mobile, a11y, i18n становятся первичными — экосистема React выигрывает |
| Возникает конкретное узкое место, для которого нужен React-only пакет | Точечно (но и тогда не вся миграция, а 1 раздел) |
| LLM достигают уверенной генерации JSX/RSC на длинных промптах | Через 2-3 года это вероятно; пересмотреть тогда |
| Smear V20-V25 показывает что god-modules не декомпозируемы на vanilla | Сейчас декомпозируемы — V18 09/10 в работе |
| Появляется publicly-shared component между несколькими внутренними продуктами Сбера | Component-libraries удобнее на React |

**До появления хотя бы одного из этих триггеров — миграция не оправдана.**

### Б.8.4. Что **точно** делать вместо миграции

(подробнее в Части Д — Альтернативы)

1. **Декомпозиция god-modules**: `teamScanner2Renderer.js` 4.9k → 5-7 sub-rendererов; `gantt.js` 2.8k → orchestrator + sub-views; `server.js` 6.5k → routes + integrations + jobs
2. **Виртуализация Ганта** + canvas-режим для больших датасетов
3. **CSS-разделение по разделам** + dead-code purge
4. **ESLint legacy warnings cleanup** до `--max-warnings 0`
5. **Stricter JSDoc типы** на всех публичных API + `tsc --checkJs` everywhere
6. **AI-фичи на текущем стеке** (Claude SDK на сервере, vanilla streaming на фронте — уже работает)
7. **Onboarding doc improvements** для нового разработчика (CLAUDE.md уже хорош, но можно расширить про-section)

---

# Часть В: Если стоит — стратегия

> Раздел заполнен «гипотетически — если бы решили мигрировать». Это не рекомендация, а ответ на вопрос «как делать если всё-таки делать».

## В.1. Big-bang vs Strangler

### В.1.1. Big-bang (полная переписка с нуля)

**Плюсы:**
- Чистая архитектура без legacy compromise
- Один стек, один tooling, один mental model
- Возможность исправить накопленные доменные ошибки одним заходом

**Минусы:**
- Все 18 разделов одновременно — 24-40 ч-мес минимум
- 6-12 месяцев feature-freeze для команды
- Невозможно валидировать «всё работает» инкрементально
- Если на 9-м месяце окажется, что какая-то интеграция не переносима — катастрофа
- Бизнес-стейкхолдеры теряют доверие к команде («полгода ничего не выкатили»)

**Известный паттерн:** Joel Spolsky «Things You Should Never Do, Part I» (2000) про Netscape rewrite. До сих пор актуально.

**Рекомендация:** big-bang **только** если объём <10k LOC и продукт можно поставить на паузу. Здесь — **44k LOC + активный продукт. Big-bang исключён.**

### В.1.2. Strangler pattern (постепенная замена)

**Концепт (Martin Fowler):** новый код растёт «вокруг» старого, пока старый не задушится.

**Плюсы:**
- Инкрементальная валидация
- Бизнес видит прогресс
- Можно откатиться на любой стадии

**Минусы:**
- Удвоенная инфраструктура надолго (~12-24 мес)
- «Пограничные» компоненты (FilterEngine, Reactive store, identity tables) усложняются — нужны адаптеры между парадигмами
- Двойной test maintenance
- Onboarding нового разработчика — учить **оба** стека

**Реалистичный путь:**

```
Фаза 0 (1-2 мес):  PoC одного раздела (Метрики или Документация — простые)
Фаза 1 (3-6 мес):  Инфраструктура (Next.js shell, общий API gateway, auth bridge)
Фаза 2 (6-18 мес): Миграция разделов в порядке от простого к сложному
Фаза 3 (18-24 мес): Миграция Ганта и Сканнера (сложные)
Фаза 4 (24-30 мес): Удаление legacy infra, finalization
```

**Это 24-30 месяцев для опытной команды.** Для команды без опыта Next.js — ×1.5-1.8.

## В.2. Очерёдность разделов

Если бы мигрировали — **сначала простые и активно меняющиеся, последними — стабильные и критичные**.

### В.2.1. Early phase (фаза 1, простые)

| # | Раздел | Почему early |
|---|---|---|
| 5 | История | 211 LOC view + historyLog. Read-only, мало interactions. |
| 6 | Таймлайн | 223 LOC. Простой layout. |
| 14 | Точность оценок | внутри teamHealthDashboards, ~80 LOC blocks |
| 15 | Документация (доки-долги) | внутри teamHealthDashboards, ~100 LOC |
| 11 | CEO-режим | 237 LOC, read-only KPI |

Цель: на этой фазе **отладить инфру** (build, deploy, auth-bridge с legacy сервером, shared identity, shared FilterEngine adapter).

### В.2.2. Mid phase (средние, активно меняются)

| # | Раздел | Почему mid |
|---|---|---|
| 1 | Дашборд | 655 LOC + helpers. Меняется часто, но логически прост. |
| 2 | Метрики | 549 LOC. Sparklines/control rings — есть echarts vendored. |
| 7 | Сотрудники | 934 LOC. Identity-heavy, но stable schema. |
| 8 | Перегрузка | внутри teamHealthDashboards |
| 9 | Здоровье компонентов | внутри teamHealthDashboards |
| 12 | Действия | actionLayer.js. Plugin model — должен быть аккуратно перенесён. |
| 16 | Интеграции (контейнер) | 850 LOC view + settings modal. |

### В.2.3. Late phase (сложные/критичные)

| # | Раздел | Почему late |
|---|---|---|
| 3 | Реестр | 997 LOC + bulk-edit + filters + col customization. Главная рабочая поверхность. |
| 4 | Гант | 2.8k LOC + drag/drop + dependency graph + html-export. Самый сложный UI в проекте. |
| 10 | AI CEO | 410 LOC, но завязан на LLM-стек. |
| 13 | AI Анализ | 352 LOC + 13 блоков. LLM-интеграция должна сохраниться. |
| 17 | Сканнер команд | 12 файлов, ~14k LOC суммарно. Самый большой раздел. |
| 18 | Чёрный дашборд | async-job pattern, multi-project Sigma aggregation. |

### В.2.4. Что мигрировать в **самом конце**

- **state.js + reactiveStore.js + dataStore.js** — это сердце приложения. Их нужно мигрировать тогда, когда **все** views уже на новом стеке (иначе адаптер на каждом mutation становится bottleneck). На практике это значит: на легаси-стороне эмулируем интерфейс, у нового store держим source of truth, до тех пор, пока последний view не переедет.
- **Onboarding-тур** — переписать в самом конце, когда selectors стабилизировались.
- **Identity layer** — на сервере, не зависит от фронт-миграции.

## В.3. Контракты между старым и новым

Это самая хрупкая часть strangler pattern. Перечислим минимум.

### В.3.1. Shared API gateway

`server.js` остаётся **единственной точкой**, оба фронта (legacy vanilla и new React) бьют в неё. Это значит:
- Endpoints API не меняются
- Token-handling остаётся серверным
- Async-jobs работают одинаково для обеих фронт-частей

**Фаза 0:** server.js не трогаем (decompose, но не переписываем). После фазы 4 — можно (если решат) переписать server на Express/Fastify, но это **отдельная отложенная миграция**.

### В.3.2. Общий state-bridge

Самая болезненная часть. Варианты:

**Вариант A: shared localStorage** (один origin):
- Legacy пишет в `q2_plan_v3` через `dataStore.js`
- New читает через `dataStore.adapter` (тонкий wrapper)
- Mutations идут одновременно с обеих сторон → race conditions
- Reactive proxy теряет смысл — нужно событийно

**Вариант B: server-side state** (БД):
- localStorage retire в пользу серверного хранения
- Оба фронта читают/пишут через REST/SSE
- Optimistic UI на обеих сторонах
- Это **большое архитектурное изменение** (сейчас state клиентский!), оно стоит само по себе ~5-8 ч-мес независимо от React

**Вариант C: iframe-isolation** (перекрёстный postMessage):
- Каждый раздел в отдельном iframe
- Cross-frame messaging для shared state
- Изолированные стеки в каждом frame
- Простая инфра, но плохой UX (фокус, история, animations)

**Реалистично:** Вариант B (server-side state) обязателен для strangler. Без него — race-conditions и corrupted state.

### В.3.3. Shared auth

Текущая модель: токены в `jira_config.json` на сервере, фронт не видит токенов. Это совместимо с любым фронт-стеком — ничего не меняется.

### В.3.4. Shared identity table (state.employees)

`state.employees[]` — авторитетная identity-таблица. На strangler-фазе:
- На сервере поднимаем endpoint `/api/state/employees` (read/write)
- Оба фронта читают через него
- Один источник правды, нет дублирования

Это **должно быть сделано на фазе 1**, до того как мигрировать любую интеграцию.

### В.3.5. Shared FilterEngine

`filters.js` — кеширующий движок фильтров. Используется в **9 разделах**. Стратегия:
- Фаза 1: extract в `@prisma/filter-engine` (workspace package)
- Используется обеими сторонами через одинаковый API
- Кеш — пер-фронт (cross-frame не нужен)

### В.3.6. Shared CSS / design tokens

`styles.css` 20k LOC — невозможно «частично переписать». Стратегия:
- Извлечь design tokens в `:root` CSS variables
- Оба фронта импортируют tokens
- Component styles — каждый стек свой

## В.4. Команда не должна остановиться

Главный практический риск strangler — **феноменальный context-switch для команды** между двумя стеками.

### В.4.1. Минимум, который защищает velocity

1. **Двухтрековая разработка**: один разработчик-track в legacy (фичи), другой в new (миграция). Не «все сразу мигрируем».
2. **Feature-freeze не на 100%**: legacy продолжает получать **только critical bug fixes**, не новые фичи. Все новые фичи — на новом стеке. Это создаёт давление на скорость миграции.
3. **Контракты state стабилизированы перед миграцией**. Если сейчас контракты ещё гуляют (в V18 идёт decompose) — это плохой момент для миграции.
4. **CI должен быть `--all-pass`**: если 1 из 534 тестов в legacy упал из-за миграции — это не «потом починим», это `red`.
5. **Каждый мигрированный раздел проходит regression**: side-by-side тест на одной и той же data → diff outputs.

### В.4.2. Куда команда уйдёт во время миграции

- 30-40% времени — на адаптеры между legacy и new
- 20-30% — на переписывание test suite
- 10-20% — на dependency hygiene и build infra
- 20-30% — на собственно фичи (если повезёт)

То есть **velocity на feature-development упадёт до 30-50%** в течение всей фазы 1-3 (~12-18 месяцев).

### В.4.3. Внешний наём усилителя

Опыт показывает: успешные strangler-миграции часто требуют **внешнего консультанта** с опытом подобных миграций (2-4 ч-мес). Это **не обязательно**, но снижает риск ×2-3.

---

# Часть Г: Оценка трудозатрат и рисков

## Г.1. Сложность миграции по 18 разделам

### Г.1.1. Шкала сложности

- **S (small)**: 0.5-1 ч-мес. Простой view, мало interactions, малое API surface.
- **M (medium)**: 1-2.5 ч-мес. Standard view с filtering, sorting, basic CRUD.
- **L (large)**: 2.5-5 ч-мес. Сложные interactions (drag/drop, dependency graph, drilldowns) или большой LOC.
- **XL (extra large)**: 5+ ч-мес. God-module размером, требует декомпозиции до миграции.

Сложность включает: rewrite кода, перенос тестов, regression testing, code review, edge cases.

### Г.1.2. Таблица по разделам

| # | Раздел | Файлы / LOC | Сложность | Обоснование | Приоритет |
|---|---|---|---|---|---|
| 1 | Дашборд | `views/dashboard.js` 655 + helpers | **M** | Метрики, KPI cards, taskbreakdown. Завязан на metricsEngine/riskEngine — нужно адаптеры. | mid |
| 2 | Метрики | `views/metrics.js` 549 | **M** | Sparklines + control rings. echarts vendored — вопрос: переехать на `recharts` или оставить? | mid |
| 3 | Реестр | `views/registry.js` 997 + `bulkEditPanel` + `rowFactory` 1k | **L** | Главная поверхность. Bulk-edit, col customization, виртуализация, identity, scope-3values. | late |
| 4 | Гант | `views/gantt.js` 2 804 + `dependencyGraph.js` 187 + `ganttHtmlExport.js` 1 097 | **XL** | Drag/drop эпиков + зависимости + html-export + 3 режима. Самый сложный UI. | late |
| 5 | История | `views/history.js` 211 + `historyLog.js` | **S** | Read-only, list of mutations. Простой. | early |
| 6 | Таймлайн | `views/timeline.js` 223 | **S** | Simple horizontal scroll layout. | early |
| 7 | Сотрудники | `views/employees.js` 934 + `EmployeeFactory` | **L** | Identity-heavy, ghost/blocked detection, integration с Jira/BB/CF. | mid |
| 8 | Перегрузка | `BurnoutWatchtowerView` ~80 LOC | **S** | Sub-view внутри teamHealthDashboards. | early |
| 9 | Здоровье компонентов | `ComponentHealthView` ~80 LOC | **S** | Sub-view внутри teamHealthDashboards. | early |
| 10 | AI CEO | `views/aiCeoView.js` 410 + `aiCeoRenderer.js` + `aiCeoFallback.js` | **M** | LLM-интеграция, fallback engine, prompts editor link. | late |
| 11 | CEO-режим | `views/exec.js` 237 | **S** | Read-only KPI экран. | early |
| 12 | Действия | `app/actionLayer.js` | **M** | Plugin-model, workflow buttons. Аккуратный перенос. | mid |
| 13 | AI Анализ | `views/aiView.js` 352 + 13 блоков + `aiContextBuilder.js` + `aiFallbackEngine.js` | **L** | 13 toggleable blocks, LLM streaming, context builder. | late |
| 14 | Точность оценок | `EstimationCalibrationView` ~80 LOC | **S** | Sub-view. | early |
| 15 | Документация (доки-долги) | `DocDebtConsoleView` ~100 LOC | **S** | Sub-view. | early |
| 16 | Интеграции | `views/integrationsView.js` 850 + `integrationsRenderer.js` + settings modal | **L** | Settings modal + token UI + sync orchestration. Нельзя сломать. | mid |
| 17 | Сканнер команд | 12 файлов в `integrations/teamScanner2*` ~14k LOC + Pulse pipeline ~5k | **XL** | Самая тяжёлая часть. 4.9k god-renderer + classifier + enrichment + history + insights + person-metrics. | late |
| 18 | Чёрный дашборд | `integrations/blackDashboard.js` + Api/Model/Renderer | **L** | Async-job UI, multi-project Sigma aggregation, progress tracking. | late |

### Г.1.3. Shared / Общее (отдельной строкой — это не «раздел», но требует миграции)

| Подсистема | Файлы / LOC | Сложность | Обоснование |
|---|---|---|---|
| Reactive state proxy | `state.js` + `reactiveStore.js` | **L** | Сердце приложения. Заменить на Zustand/Jotai/Redux Toolkit/signals. Все 18 разделов зависят. |
| Persistence | `dataStore.js` 1 337 + `appDataStore.js` + `sqliteStore.js` | **L** | localStorage migrations v1→v3, SQLite-WASM, scrub policy. |
| FilterEngine | `filters.js` | **M** | Кеш + selectors. Один из 9 потребителей переедет → адаптер. |
| App.js orchestrator | `app.js` 2 208 | **L** | Bootstrap + Nav + bulk + helpers. Декомпозиция до миграции — обязательна. |
| Server.js | 6 486 LOC | **L** | Если оставляем — только декомпозиция. Если переписываем (Express/Fastify/Next API routes) — отдельные ~3-6 ч-мес. |
| Чат | 13 файлов в `chat/` + `app/llmAssistant.js` | **L** | LLM-streaming, intent parser, context builder, templates. |
| AI Анализ stack | `ai/*` (renderer, context builder, fallback, llm client) | **M** | Уже учтено в #13 + #10 разделах. |
| Интеграции (Pulse) | `portfolioPulse*` 1.9k + helpers ~3k | **L** | Pulse pipeline shared между Сканнером, Pulse, BD. Декомпозиция до миграции. |
| Onboarding-тур | `onboarding/` + `app/onboarding.js` | **M** | DOM-selector dependency. Переписать после стабилизации новых selectors. |
| Components (Multiselect, TagInput) | `components/*` | **S** | Простые. Переписать на React-эквиваленты. |
| Маскот + чат UI | `obsidian/` + `chat/chatUIRenderer.js` | **M** | Глобальный FAB + per-message + tour + toast. |
| HistoryLog / ErrorsLog / Telemetry | `historyLog.js`, `errorsLog.js`, `integrations/telemetry.js` | **S-M** | Простые stores. |
| CSS reorg + design tokens | `styles.css` 20k LOC + `theme.css` + `obsidian/obsidian.css` | **L** | Разделить + design tokens + dead-code purge. Параллельный трек. |
| HTML shell | `index.html` 1 726 LOC | **M** | Один SPA-shell → нужен router. |
| Server-side logger | `server/logger.js` | **S** | Прямой перенос (это просто JSON в stdout). |
| Vendored libs | `libs/xlsx.full.min.js`, `libs/sql-wasm.{js,wasm}`, `libs/safeHtml.js`, `libs/echarts.esm.min.js` | **S** | Решить: оставить vendored или взять npm-эквиваленты. |
| Tests | 534 unit + 11 contract + 10 e2e | **L** | Перенос на vitest/jest + react-testing-library + playwright. ~20-30% переписать с нуля. |

## Г.2. Общая оценка в человеко-месяцах

### Г.2.1. По сложности

| Сложность | Кол-во разделов / shared | ч-мес/единицу | Итого ч-мес |
|---|---|---|---|
| S | 7 разделов + 5 shared | 0.5-1 | 6-12 |
| M | 5 разделов + 4 shared | 1-2.5 | 9-22 |
| L | 5 разделов + 7 shared | 2.5-5 | 30-60 |
| XL | 2 раздела (Гант + Сканнер) | 5-10 | 10-20 |
| | | **Сумма (без overhead)** | **55-114** |

### Г.2.2. Overhead

| Категория | % от core | Обоснование |
|---|---|---|
| Build/deploy infra | +10% | Next.js setup, CI configs, Docker, dependency hygiene |
| Test infra | +10% | Vitest setup, RTL, e2e replay |
| Adapter layer (strangler) | +20% | На strangler-варианте — обязательно |
| Code review + integration | +10% | Внутренний review + bug-fix |
| Domain knowledge transfer | +5% | Glossary check, contracts-aware migration |
| Buffer для unknown | +15% | Любая миграция имеет «непредвиденные» расходы |
| **Total overhead** | **+70%** | |

### Г.2.3. Финальный диапазон

| Сценарий | Оптимист | Реалист | Пессимист |
|---|---|---|---|
| Big-bang (full rewrite) | 24 ч-мес | 32 ч-мес | 48 ч-мес |
| Strangler (рекомендуемый, если делать) | 30 ч-мес | 42 ч-мес | 60 ч-мес |
| Strangler с server-side state migration | 38 ч-мес | 52 ч-мес | 72 ч-мес |

> Для команды без опыта Next.js: ×1.3-1.5 ко всем числам.
> Для команды без опыта React vDOM perf optimization (Гант): ×1.5-2.0 на L4 (Гант).
> Для команды с активным AI-augmented workflow (текущая): неизвестно — данных мало для оценки.

**Рекомендуется планировать на 42 ч-мес (реалист) с буфером до 60.** В календарных месяцах для команды из 2 человек это **21-30 месяцев**.

### Г.2.4. Calendar timing для команды из 2-3 человек

| Команда | Min | Realistic | Max |
|---|---|---|---|
| 2 человека (один на новом, один на legacy) | 18 мес | 24 мес | 36 мес |
| 3 человека | 14 мес | 18 мес | 24 мес |
| 4 человека (sweet spot) | 11 мес | 15 мес | 20 мес |
| 5+ (diminishing returns из-за коммуникации) | 9 мес | 13 мес | 18 мес |

## Г.3. Топ-10 рисков

| # | Риск | Вероятность | Impact | Митигация |
|---|---|---|---|---|
| 1 | Контракты state (Reactive.silent, identity-deterministic, _scrubSecrets) теряются при переписывании; intermittent bugs появляются спустя месяцы | **high** | **high** | Письменный contract test suite перед миграцией; каждый контракт — отдельный property-based test; regression replay на real production data |
| 2 | Потеря бизнес-логики при rewrite одного из 18 разделов; «забыли что scope=Требует подтверждения 3-значный» | **high** | **high** | Обязательное пере-чтение `docs/domain-glossary.md` для каждого раздела; side-by-side regression test (legacy vs new на одной data) |
| 3 | Corporate compliance review зависает на 300+ npm packages; миграция стоит на 3-6 мес | **med** | **high** | Заранее (фаза 0) запустить compliance review для core-stack: react/react-dom/next/zustand/zod/tanstack-query. Pre-approved list. |
| 4 | God-renderer сканера (4.9k LOC) переписывается «1-в-1», новая версия сохраняет ту же структуру и боль | **high** | **med** | Декомпозиция renderer-а **на текущем стеке до миграции**; миграция уже декомпозированных под-рендереров |
| 5 | Reactive race condition воспроизводится в новой парадигме (например, useEffect-cycle вместо Proxy-cycle) | **med** | **med** | Architecture review state-management before rewrite; explicit batching strategy; doc «as-built» reactive flow |
| 6 | Velocity-degradation команды на 12-18 мес не выдерживается стейкхолдерами → миграция отменяется на полпути → проект в ещё худшем состоянии | **med** | **high** | Регулярные milestone-демо стейкхолдерам; «убитый раздел» — раз в 3 мес минимум; чёткий rollback-план для каждой фазы |
| 7 | LLM-augmented workflow становится менее эффективным на новом стеке (доказано выше — JSX/RSC у моделей хуже); реальная velocity падает сильнее ожидаемого | **med** | **med** | PoC одного раздела на новом стеке с измеренной LLM-velocity; если ×2 хуже — переоценить |
| 8 | Onboarding-тур (24-step) ломается при каждом мигрированном разделе; QA bottleneck | **high** | **low** | `data-tour-id` атрибуты ставятся **до** миграции на legacy; тур переписывается **в самом конце** |
| 9 | Two-stack period порождает интеграционные баги, которых нет ни в legacy, ни в new (cross-stack state corruption) | **med** | **high** | Server-side state как single source of truth обязательно; cross-stack contract tests; chaos-test cross-stack scenarios |
| 10 | Гант (2.8k LOC, drag/drop + dependency graph) на React оказывается медленнее vanilla; perf-regression виден users; вынуждены откатываться | **med** | **med** | PoC Ганта на React first; benchmark vs vanilla; план B — Гант остаётся vanilla iframe-embedded |

### Г.3.1. Дополнительные риски (не вошли в топ-10, но реальные)

| # | Риск | Митигация |
|---|---|---|
| 11 | CSS 20k LOC — частичный port даёт visual-regressions, которые сложно автоматизировать | Visual regression test suite (Playwright + diff) до миграции |
| 12 | SQLite-WASM persistence не пере-работает прозрачно (File System Access API в new SPA-shell) | Сохранить vanilla persistence layer на server, фронт — простой client |
| 13 | XLSX export через vendored xlsx — заменить на `exceljs` или `xlsx-js-style` (npm) — security review цикл | Оставить vendored (single-file, прошёл review), не менять |
| 14 | echarts может не lazy-load так же эффективно в новом bundler (Vite/webpack chunking) | Проверить на PoC; план B — manual dynamic import |
| 15 | Существующие audit-папки (V11-V21, ~30 файлов) — потеря контекста при rewrite | Audit-папки оставить read-only, обязательно прочитать перед каждым разделом |
| 16 | Тесты `node:test` → vitest port: edge-case в `assert.deepStrictEqual` поведении | Side-by-side run обоих суит на shared data |
| 17 | LLM-чат streaming через SSE — `ai/react` от Vercel предполагает Edge runtime; на корпоративном Node-only хостинге может не работать | Использовать стандартный `EventSource` API на vanilla (уже работает); не зависеть от Vercel-specific |
| 18 | identity-таблица (state.employees) с jiraAccountId/bitbucketLogin/etc — schema migration на сервере; старые snapshots могут поломаться | Backward-compat reader; migration plan v3→v4 с тестами на real data |
| 19 | jira_config.json как конфиг-стор — атомарная замена на БД (SQLite/Postgres) — стоит ~1-2 ч-мес | Оставить jira_config.json + добавить read-only БД для аудита; миграция конфиг-стора отложить |
| 20 | corporate proxy / TLS / IP-allowlist на корпоративных серверах — Next.js dev-server не всегда работает за proxy | Документированный setup; план B — Vite только |

## Г.4. Что нужно решить ДО начала

Если бы решили мигрировать — **до первого commit** надо ответить на следующие вопросы. Без ответов миграция превращается в расследование на ходу.

### Г.4.1. Технологические выборы

#### Frontend framework

| Опция | Плюсы | Минусы | Recommendation для Призмы |
|---|---|---|---|
| **Next.js (App Router)** | Industry standard, SSR/RSC, file-based routing | Vercel-bias, RSC complexity, large surface | Только если нужен SSR — здесь не нужен |
| **Next.js (Pages Router)** | Stable, простой | «Уходящий» паттерн, Vercel bias | Не рекомендуется — устаревает |
| **Remix** | Web-standards-first, nested routes | Меньше экосистема, недавно куплен Shopify | Аналог Next.js, без RSC drama |
| **Vite + React Router** | Bundler чистый, без opinionated framework | Сами строим: roting, data fetching, errors | **Рекомендую для этого продукта** — нужен SPA, не SSR |
| **TanStack Start** | TS-first, type-safe routing | Beta, малое community | Не для production-critical |
| **Astro** | Multi-framework, MPA-first | Не SPA-friendly | Не подходит — Призма SPA |

> **Recommendation:** **Vite + React 18 + React Router**. Без Next.js. Это внутренний SPA, никаких SSR не нужно.

#### State management

| Опция | Recommendation |
|---|---|
| Redux Toolkit | Overkill, но стабильный |
| Zustand | Простой, мало overhead. Ближе всего к текущей `state.js` |
| Jotai / Recoil | Atom-based, переучивание |
| signals (preact-signals / @preact/signals-react) | Ближе всего к Proxy-based reactive store |
| Context + useReducer | Не масштабируется на 18 разделов |

> **Recommendation:** **Zustand или signals**. Идеологически ближе к текущему mutable state с Proxy-flush.

#### Data fetching

| Опция | Recommendation |
|---|---|
| TanStack Query | Industry standard, кеш + invalidation. **Yes**. |
| RTK Query | Только если выбран Redux |
| SWR | Чуть проще TanStack Query, меньше фич |
| `fetch` напрямую | OK для простых случаев |

> **Recommendation:** **TanStack Query**.

#### Forms

| Опция | Recommendation |
|---|---|
| React Hook Form + Zod | De-facto стандарт |
| Formik | Уходит, не рекомендуется новых |
| Native `<form>` + `useState` | Для простых — OK |

> **Recommendation:** **React Hook Form + Zod**.

#### CSS

| Опция | Recommendation |
|---|---|
| CSS Modules | Простой, scoped, работает |
| Tailwind | Быстро, но требует переучивания дизайн-системы |
| styled-components | Runtime overhead, теряет позиции |
| vanilla-extract | TS-first CSS, но новый |
| Plain CSS + design tokens | Минимум зависимостей |

> **Recommendation:** **CSS Modules + design tokens via :root variables.** Не Tailwind — Призма имеет свою design language (V15 Spine-pill, V17 audit), Tailwind её перетягивает.

#### Backend

| Опция | Recommendation |
|---|---|
| `node:http` (как сейчас) | OK, минимум зависимостей |
| Express | Industry standard, много middleware |
| Fastify | Faster Express, schema validation встроен |
| Hono | TS-first, edge-runtime-friendly |
| Next.js API routes | Только если фронт уже Next |
| tRPC | TS end-to-end, **только** если фронт TS |

> **Recommendation для бэка:** **Оставить `node:http` или мигрировать на Fastify**. Не Express (legacy middleware-стек), не Next.js API (lock-in).

#### Runtime

| Опция | Recommendation |
|---|---|
| Node.js LTS (текущий) | Стандарт. **Рекомендую.** |
| Bun | Не для prod-internal |
| Deno | TS-first, но другой mental model |

> **Recommendation:** **Node.js LTS**.

#### ORM / DB

Если решат уйти от localStorage / SQLite-WASM на server-side persistence:

| Опция | Recommendation |
|---|---|
| Prisma | Industry standard, schema-first. **Рекомендую** при уходе на серверный persist. |
| Drizzle | Lighter, SQL-first. Тоже хороший выбор. |
| Knex | Query builder, no schema |
| Raw SQL | Для маленьких приложений |

> **Recommendation:** **Drizzle или Prisma**, если решат добавить серверный persist. Иначе — оставить SQLite-WASM как сейчас.

#### Testing

| Опция | Recommendation |
|---|---|
| Vitest | De-facto стандарт. Аналог node:test, но для React. |
| Jest | Слабее Vitest на ESM, но стабильный |
| React Testing Library | Standard |
| Playwright | E2E. Уже подходит проекту. |
| Storybook | Только если есть design system + 50+ компонентов |

> **Recommendation:** **Vitest + RTL + Playwright**. Без Storybook (overkill для внутреннего инструмента).

### Г.4.2. PoC обязательны

До начала миграции — **2-3 PoC**:

| PoC | Что проверяет | Длительность | Критерий успеха |
|---|---|---|---|
| PoC-1: один простой раздел (История или Таймлайн) на Vite+React+Zustand | Базовый стек работает; build/test/deploy | 2-3 нед | Раздел рендерится; тесты на новом стеке проходят; e2e работает на feature-flag |
| PoC-2: state-bridge между legacy и new | Strangler-инфра работает | 3-4 нед | Один раздел на new + один на legacy — оба читают одни и те же данные через server-API |
| PoC-3: Гант на React | Performance-prove (или disprove) | 4-6 нед | 1500 эпиков рендерятся ≥60fps; drag/drop работает; перерисовка под bench < legacy |

**Без успешных PoC — не запускать миграцию.** PoC-3 — это «go/no-go gate».

### Г.4.3. Архитектурные решения

| Решение | Варианты | Recommendation |
|---|---|---|
| state-management парадигма | Mutable+proxy / Immutable+actions | Mutable Zustand (ближе к существующему) |
| URL-routing | Hash / History API | History API (Vite + React Router) |
| Code-splitting | По разделу / по фиче | По разделу (18 chunks) |
| Public assets | Static / CDN / inline | Static (внутренний инструмент) |
| Auth / SSO | Не меняется | Не меняется |
| Server-side state migration | Yes / No | **Yes** (для strangler) |
| Vendored libs (xlsx, sql-wasm, echarts) | Vendored / npm | Vendored (compliance) |
| Migration of `_scrubSecrets` | Auto-perpetuated / re-implement | **Re-implement как hook + middleware** |

### Г.4.4. Процессы

- **Code review process** для миграционных PR — стрикт. Каждый PR: «не теряем ли контракт?»
- **Migration playbook** — checklist на каждый раздел (rewrite → test → regression diff → migrate → keep)
- **Rollback plan** — feature-flag или per-route flip; **не git revert** на финале фазы (поздно)
- **Communication cadence** — еженедельный demo стейкхолдерам; ежемесячный risk review
- **Definition of done** для раздела: код + тесты + e2e + visual regression + perf ≥ legacy + onboarding-тур работает

### Г.4.5. Бюджет / sponsor

- Кто оплачивает 12-30 месяцев замедленной velocity?
- Какой ROI планируется и в чём измеряется?
- Что показывает ROI достижимым? (например: «через 18 мес планируем расширение команды до 5 чел.»)

**Без явного sponsor-buy-in — не запускать.** Это политический риск, не технический.

---

# Часть Д: Альтернативы

## Д.1. Альтернатива 1: ничего не менять

**Описание:** оставить текущий стек, продолжать audit-driven evolution (V18 → V19 → V20 → ...).

**Плюсы:**
- 0 risk
- Velocity сохраняется
- Все сильные стороны (compliance, immunity, deploy-simplicity, AI-workflow) — сохраняются
- Команда продолжает работать в известном паттерне

**Минусы:**
- Существующие боли (god-modules, Гант perf, CSS 20k) — лечатся **только** если активно лечить
- Риск пропустить «правильный момент» для миграции на 1-2 года

**Вердикт:** базовая опция. Лучше любой миграции **сегодня**.

## Д.2. Альтернатива 2: декомпозиция текущего стека

**Описание:** активно работать над болями текущего стека без смены технологии.

**Конкретные треки:**

### Д.2.1. God-modules decomposition (3-6 ч-мес)

| Файл | Текущий LOC | Цель | Подход |
|---|---|---|---|
| `integrations/teamScanner2Renderer.js` | 4 890 | 5 файлов по ~1k LOC | разделить по табам (Glance / Today / Ops / Trends / Sleeping) |
| `views/gantt.js` | 2 804 | 3-4 файла | orchestrator + cells + interactions + html-export-prep |
| `server.js` | 6 486 | 4-6 файлов | routes + integrations + jobs + logger + config |
| `app.js` | 2 208 | 3-4 файла (часть уже сделана) | продолжить V18 09 |

### Д.2.2. Performance optimization (1-2 ч-мес)

- Виртуализация Ганта (только видимые ячейки) — 200-400 LOC
- Реестр virtualized scrolling — уже частично, доработать на bulk-edit
- Canvas-mode для Гант print/export

### Д.2.3. CSS reorg (1-3 ч-мес)

- Разделить `styles.css` 20k на `styles/<section>.css` (18 файлов)
- Извлечь design tokens в `theme.css` `:root` variables
- `purgecss`-like script для dead-rules
- ESLint-CSS / stylelint setup

### Д.2.4. JSDoc/TS strict-coverage (1-2 ч-мес)

- 100% public API типизировано
- `// @ts-check` на всех файлах
- `tsc --strict` в CI

### Д.2.5. ESLint warnings → 0 (1 ч-мес)

- 215 → 0 за 2-3 спринта
- Закроется V14/V15 legacy debt

**Total: 7-14 ч-мес.** Это **в 3-5 раз меньше** миграции на React, и решает все реальные боли.

**Вердикт:** **сильно рекомендуется**. Эта альтернатива — почти всё, что миграция «обещает», без её рисков.

## Д.3. Альтернатива 3: новый стек только для нового модуля

**Описание:** старые 18 разделов остаются на vanilla. **Новые** разделы (например, гипотетический «Sber-AI-Hub» с глубокой LLM-интеграцией) — пишутся на React с нуля.

**Плюсы:**
- Не трогаем существующий код
- Команда учится React на изолированной задаче
- Можно отказаться, если не зашло

**Минусы:**
- Два стека одновременно — onboarding cost, infra cost
- Cross-stack state-bridge всё равно нужен
- Может застрять на полпути: «старое осталось, новое разрослось» — два проекта вместо одного

**Когда применимо:** если **планируется** новый раздел значительного масштаба (>2k LOC) с принципиально другими паттернами (например, real-time multi-user editing). Сейчас в roadmap V19/V20 такого нет.

**Вердикт:** **отложить решение** до момента появления конкретного нового раздела. Принципиальное решение «теперь весь новый код на React» — преждевременно.

## Д.4. Альтернатива 4: обновить current-stack tooling без смены стека

**Описание:** добавить modern dev tools, не меняя архитектуру.

**Конкретные треки:**

### Д.4.1. Bundler как opt-in (esbuild / Vite)

- ES modules продолжают работать в браузере directly (dev-mode)
- Опционально: production-build через esbuild (concat + minify) — для уменьшения количества HTTP requests
- 0 рантайм-зависимостей сохраняется
- Тесты работают как сейчас

**Стоимость:** 0.5-1 ч-мес. **Польза:** -30-50% page load на холодном кеше.

### Д.4.2. Web Components для re-usable

- `Multiselect`, `TagInput` → web-components с Shadow DOM
- Native, без зависимостей
- Re-usable между Призмой и (потенциально) другими внутренними продуктами

**Стоимость:** 1-2 ч-мес. **Польза:** проще re-use, лучше изоляция CSS.

### Д.4.3. Observable / signals для reactivity

- Заменить Proxy + debounced flush на signals (можно minimal own implementation)
- Точечная reactive subscription (не full re-render)
- Без сторонних зависимостей

**Стоимость:** 2-4 ч-мес. **Польза:** меньше Reactive race conditions, явнее граф зависимостей.

### Д.4.4. View Transitions API (browser-native)

- Anim между разделами через `document.startViewTransition()`
- Без `framer-motion` или аналогов

**Стоимость:** 0.3-0.5 ч-мес.

**Total для пакета Д.4:** 4-7 ч-мес. **Modernizes без миграции.**

**Вердикт:** хорошая комбинация с Д.2. Можно выполнять параллельно.

## Д.5. Альтернатива 5: переписать только bottlenecks

**Описание:** трогать только то, что реально болит. Не системно переписывать.

**Кандидаты:**
- **Гант** — переписать на canvas (или WebGL для тяжёлых датасетов)
- **Сканнер** — декомпозировать renderer + кешировать enrichment
- **CSS** — разделить и почистить

**Плюсы:**
- Минимум рисков
- Точечный выигрыш в performance/maintainability
- Поэтапно

**Минусы:**
- Не решает «общесистемных» проблем (но их и нет реальных)

**Вердикт:** хорошая опция, фактически — это часть Д.2.

## Д.6. Сравнительная таблица альтернатив

| Альтернатива | ч-мес | Lifetime risk | Решает боли? | Сохраняет сильные стороны? |
|---|---|---|---|---|
| Д.1: ничего не менять | 0 | низкий | нет | да |
| Д.2: декомпозиция текущего | 7-14 | низкий | **да (всё реальное)** | да |
| Д.3: новый стек для нового модуля | 0 (откладывается) | среднеспаршленный | гипотетически | частично |
| Д.4: modern tooling без миграции | 4-7 | низкий | частично | да |
| Д.5: переписать только bottlenecks | 3-6 | низкий | **да (точечно)** | да |
| Д.2 + Д.4 (комбо) | 11-21 | низкий | **да полностью** | да |
| Strangler-миграция на React | 30-72 | высокий | частично (новые в обмен на текущие) | **нет** (теряются compliance, immunity, AI-workflow) |
| Big-bang full rewrite | 24-48 | очень высокий | (если выживет) | **нет** |

**Победитель в любом приближении: Д.2 + Д.4 комбо.** Решает реальные боли в 3-5x меньше миграции и без потери сильных сторон.

---

# Финальная рекомендация

## Одной фразой

**Не мигрировать на React + Node.js. Сосредоточиться на декомпозиции god-modules и точечных оптимизациях текущего стека (~12-20 человеко-месяцев), что даст 80-90% ожидаемого выигрыша от миграции при <20% её рисков и без потери архитектурных активов проекта (corporate compliance, supply-chain immunity, AI-augmented workflow, one-step deploy).**

## Trade-offs (что мы получаем и что теряем)

### Что мы **сохраняем**, оставаясь на vanilla:

- **0 рантайм-зависимостей** → 0 supply-chain attack surface
- **Проходимость corporate compliance** → нет 300-pkg review queue
- **One-step deploy** (`node server.js`)
- **AI-augmented dev workflow** на проверенных паттернах
- **Velocity** на 1-3 года вперёд (без 30-50% drop из-за миграции)
- **534 unit-теста** не нужно переписывать
- **18 разделов** с накопленной 10+ летней доменной логикой остаются
- **Контракты state** (Reactive.silent, identity-deterministic, _scrubSecrets) — гарантированно сохраняются
- **Long-term-support**: vanilla ES2020 будет работать без правок и в 2036

### Что мы **теряем** (или: что не получаем):

- React-экосистема (`react-hook-form`, `tanstack-query`, `radix-ui`, ...) — **не нужна** для внутреннего планировщика, но субъективно «удобнее»
- TypeScript «full-strict» опыт — **компенсируется JSDoc + tsc --checkJs**
- Богатые devtools (React DevTools) — **компенсируется** простотой imperative DOM
- Найм на «React-разработчик» — **не релевантно** при AI-augmented команде
- «Modern feel» проекта — **субъективно**, не влияет на пользователей

### Что мы **получаем**, идя по альтернативе Д.2 + Д.4:

- god-modules декомпозированы (-30-50% времени на новые фичи в этих модулях)
- Гант рендерит 1500 эпиков на 60fps (виртуализация)
- CSS разделён, dead-rules вычищены, ESLint в зелёной зоне
- Modern tooling (esbuild bundle opt-in, View Transitions, signals) **без npm-зоопарка**
- Velocity растёт на 5-15% в год N+1 после декомпозиции

## Когда пересмотреть это решение

**Поставить calendar reminder на пересмотр через 12-18 месяцев** или раньше, если случится один из следующих триггеров:

1. Команда расширяется до **5+ разработчиков** (onboarding cost начинает доминировать)
2. Продукт **становится consumer-facing** (a11y, mobile, i18n становятся первичными)
3. Появляется конкретный новый раздел с **>5k LOC** требующий принципиально другой парадигмы (real-time, collaborative editing, etc.)
4. **LLM-модели** достигают паритета по точности генерации JSX/RSC с vanilla (вероятно через 2-3 года)
5. **Compliance team Сбера** добавляет pre-approved React/Next.js stack (тогда supply-chain аргумент ослабевает)
6. Через V25-V30 audits станет очевидно, что god-modules **не декомпозируемы** на текущем стеке (сейчас декомпозируемы — V18 09/10 в работе)
7. Появляется **shared component library** между Призмой и другими внутренними продуктами Сбера (тогда component-libs удобнее на React)

## Что делать **уже сейчас** (action items)

В порядке приоритета:

1. **V18 9-10 завершить**: app.js / server.js decomposition (~3-5 ч-мес). Это снижает onboarding cost на 30-40%.
2. **Гант декомпозировать**: 2.8k LOC → 3-4 модуля по ~700 LOC. Параллельно — виртуализация (~1-2 ч-мес).
3. **Сканнер renderer декомпозировать**: 4.9k LOC → 5 sub-renderer по 1k (~3-4 ч-мес).
4. **CSS разделить** на 18 файлов + design tokens (~1-3 ч-мес). Параллельный трек.
5. **ESLint warnings → 0** (~0.5-1 ч-мес).
6. **JSDoc strict + tsc --strict** на всех публичных API (~1-2 ч-мес).
7. **Bundler opt-in** (esbuild для production) — для ускорения cold load (~0.5-1 ч-мес).
8. **Performance budgets** в CI: каждый раздел ≤ X kB JS, ≤ Y kB CSS, render time ≤ Zмс на 1k rows (~0.3-0.5 ч-мес).

**Total для action plan: ~10-18 ч-мес** в течение **6-12 месяцев** на команду из 2-3 человек. Не блокирует фичи (можно параллельно).

После выполнения этих пунктов — **пересмотреть** позицию по миграции с лучшими данными:
- velocity на новой декомпозированной кодбазе
- замер LLM-augmented productivity на decomposed-модулях
- замер performance после виртуализации Ганта

Если после этого аргументы за миграцию окажутся сильнее — обсуждать снова. Сегодня их нет.

---

## Подпись команды

| Роль | Позиция |
|---|---|
| **Tech lead (опыт миграций)** | Не мигрировать. Vanilla здесь архитектурно корректен. Big-bang исключён, strangler — overkill для проблем, которые есть. |
| **Senior frontend (React)** | Не мигрировать. React не починит Гант. AI-workflow на vanilla работает лучше. Реальная боль (god-modules, CSS) — не «у vanilla», а «в декомпозиции». |
| **Senior backend (Node.js)** | Не мигрировать в стек Next.js / Express. Текущий `node:http`-based server — оптимален для proxy-роли. Декомпозировать `server.js` — да; уйти с `node:http` — нет. |
| **Продакт** | Не мигрировать. 12-30 мес velocity-degradation не оправданы. Стейкхолдеры не получат улучшений, которые они смогут увидеть. ROI отрицательный. |

**Единогласно: рекомендуется альтернатива Д.2 + Д.4 (декомпозиция + modern tooling без смены стека). Миграция на React + Node.js не оправдана для текущего состояния проекта и команды.**

---

*Этап 13 из 14. Документ создан 2026-05-07. См. также: [`AUDIT_MAP.md`](./AUDIT_MAP.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`CLAUDE.md`](./CLAUDE.md), [`audit-2026-05-V18/MASTER_PLAN.md`](./audit-2026-05-V18/MASTER_PLAN.md), [`audit-2026-05-V18/v18-3-and-v19-roadmap.md`](./audit-2026-05-V18/v18-3-and-v19-roadmap.md).*
