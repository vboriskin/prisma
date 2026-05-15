# Полный аудит проекта — 2026-05-03

**9 последовательных команд экспертов** проанализировали всё приложение. Каждый аудит — отдельный файл, ниже — executive summary.

---

## Файлы аудита

| # | Файл | Авторы | Главное |
|---|---|---|---|
| 01 | [01-technical.md](./01-technical.md) | 6 экспертов: Performance, Architecture, Backend, Frontend, Reliability, Security | Perf bottlenecks, server monolith, SSRF/auth gaps |
| 02 | [02-testing.md](./02-testing.md) | 5 экспертов: QA Lead, Manual Tester, Visual/Theme, A11y, Cross-browser | 4 critical bugs, focus-trap missing, color-mix без fallback |
| 03 | [03-design-ux.md](./03-design-ux.md) | 5 экспертов: Senior Designer, UX Researcher, IA, Brand, Interaction | 30+ Spine-pill violations, IA chaos, UX friction |
| 04 | [04-ai-chat.md](./04-ai-chat.md) | 4 эксперта: AI/ML Engineer, Conversational UX, Prompt Engineer, Integration Architect | Scanner 2.0 ↔ AI = 0 hooks, PII в LLM payload |
| 05 | [05-devops.md](./05-devops.md) | 4 эксперта: SRE/DevOps Lead, Release Engineer, DevSecOps, Observability | No CD, no SAST/SCA, PII в логах, no audit-log |
| 06 | [06-prizma-rebrand.md](./06-prizma-rebrand.md) | 6 экспертов: Brand Strategist, Visual Designer, UX Lead + 3 user-персоны | «Призма» утверждается, sub-brands по оптической логике |
| 07 | [07-tabs-header-settings.md](./07-tabs-header-settings.md) | 5 экспертов: Tab+UX Auditor, Topbar, Settings, Sidebar/IA + Team Lead persona | Save теряется, дублирующая иконка sidebar, settings spread |
| 08 | [08-test-coverage.md](./08-test-coverage.md) | 4 эксперта: Test Architect, QA Lead, Tech Specialist, Coverage Auditor | 46% модулей at 0%, testRunner.js drift hazard, нет coverage gate |
| 09 | [09-integrations-deep.md](./09-integrations-deep.md) | 4 эксперта: Atlassian Expert, QA/Zephyr, Data Analyst, API Performance | Sleeping data огромное, нет HTTP keep-alive, Zephyr silent truncation |

---

## 🚨 Top-15 critical findings (по всем аудитам)

| # | Категория | Issue | Audit |
|---|---|---|---|
| 1 | **Security** | No authentication / `?user=email` spoof тривиален | 01,05 |
| 2 | **Security** | SSRF через `body.apiBaseUrl` в `/api/llm/chat` | 01,05 |
| 3 | **Security** | CQL/JQL injection через user-controlled input | 01 |
| 4 | **Security** | ПДн (email/ФИО) в логах без redaction → 152-ФЗ | 01,05 |
| 5 | **Reliability** | Async-job state в RAM → server restart = orphan jobs | 01 |
| 6 | **Performance** | `HTTP keep-alive` отсутствует — +40-50% latency | 01,09 |
| 7 | **Performance** | Sequential JQL pagination внутри PK | 01,09 |
| 8 | **Browser compat** | `color-mix(in srgb, ...)` × 112 без `@supports` fallback → ломает Safari <16.4 | 02 |
| 9 | **Testing** | 46% модулей at 0% coverage; testRunner.js drift hazard | 08 |
| 10 | **UX** | 4 секции с одинаковой целью (Дашборд / Сводная / Метрики / Инсайты) | 03 |
| 11 | **UX** | Russian plural broken — «1 задач», «5 сотрудников» везде | 02 |
| 12 | **UX** | Все ячейки Реестра постоянно editable → DOM-шум, accidental edits | 03 |
| 13 | **UX** | Native `confirm()` для destructive actions | 03 |
| 14 | **UX** | «Удалить всех сотрудников» без double-confirm в шапке секции | 02,07 |
| 15 | **AI** | Scanner 2.0 ↔ LLM = 0 hooks (теряем главный value-prop) | 04 |

---

## 🎯 Top-10 must-fix перед расширением пилота (>1 команды)

1. **PII-redaction в `server/logger.js`** (152-ФЗ blocker)
2. **Auth model** (SAML/OIDC через WAF) — без этого rollout невозможен
3. **SSRF allowlist** для `apiBaseUrl/jiraBaseUrl` + secrets manager
4. **Async-job persistence** (jobs/*.ndjson) — recover на restart
5. **`@supports (color-mix)` fallback** — UI не должен ломаться на Safari <16.4
6. **Focus-trap** во всех 6+ модалках + skip-link
7. **Pluralize-helper** + рефактор ~30 мест
8. **`HTTP keep-alive` + gzip** — quick win 40-50% latency
9. **Theme persistence** в localStorage
10. **localStorage corruption guards** + atomic snapshot

---

## 🔥 Quick wins (≤2д каждая, >40 пунктов)

### Производительность
1. **HTTP keep-alive** для всех 4 fetch-функций — −150ms/req, −60% bytes
2. **LRU httpCache 5min** для GET search — −90% repeated pulse-retries
3. **Parallel pagination** внутри PK (PLimit 3) — ×2.5 throughput
4. **Differential JQL** `updated > last` — ×10 на тёплых PK
5. **Zephyr pagination** + cap=1000 + concurrency limit
6. **Per-author worklog breakdown** — данные уже есть

### Безопасность
7. **PII-scrub в logger** (regex маски email/phone/ФИО)
8. **`npm audit` + gitleaks + osv-scanner** в CI как required check
9. **SemVer + git tags** + sync `package.json#version`
10. **`launch.js` hardcoded "v11"** → читать из `package.json`

### UX
11. **Pluralize-helper** — `Intl.PluralRules`
12. **Focus-trap mini-lib** для всех модалок
13. **Skip-link** + `<main>` wrapper + `aria-label` на ✕
14. **Theme persistence** в localStorage
15. **Toast queue** + Undo CTA
16. **Filter chip-bar** над Registry
17. **Replace native `confirm()`** custom dialog
18. **Tabular nums в `:root`**

### Quick AI features
19. **Daily morning brief** AI auto-generate
20. **Action queue Top-5** в Scanner 2.0
21. **Diff vs yesterday badge** на каждой row
22. **Slash commands** `/scan team CORE`, `/risks 1.21`

### Sprint metrics (одна tile каждая)
23. **Resolution-split** (Done/Won't Do/Duplicate) — JQL уже едет
24. **Sub-task completion ratio per epic** — `subtasks[]` уже в payload
25. **Issue-link graph (blocked-by)** — добавить `issuelinks` в `JIRA_FIELDS`
26. **PR cycle-time p50/p90** — данные уже в `_prsForActivity`
27. **First-review-latency** — те же activities
28. **Stale Confluence (>1y)** — одна CQL
29. **Stale branches BB** — `/branches?orderBy=MODIFICATION`
30. **Backlog hygiene tile** — JQL для no-SP/no-priority/no-AC

---

## 📅 Roadmap по фазам

### Phase 1 — Foundation (1-2 месяца)
**Безопасность + Reliability:**
- Bug-fixes из всех 9 аудитов
- PII-scrub + SAML/OIDC + secrets manager
- Async-job persistence
- Color-mix fallback + theme persistence
- Focus-trap + skip-link + a11y baseline

**DevOps:**
- `Dockerfile`, `package-lock.json`, `npm ci`
- Security CI lane
- 3 environment (dev/stg/prod)
- `/ready` endpoint
- Prometheus + Grafana
- Alertmanager → Mattermost

### Phase 2 — Polish + Test coverage (2-3 месяца)
**Quality:**
- Migrate `testRunner.js` legacy → `node:test`
- Coverage gate в CI (line ≥75%, critical ≥90%)
- Playwright e2e + visual regression (40 baselines)
- axe-core a11y baseline
- Property-based для scrub/escape/format

**UX foundation:**
- Pluralize-helper рефактор
- Toast queue + Undo CTA
- Component primitives (Button/Field/Modal/Toast/Badge/KPI/DataTable)
- Filter chip-bar + Sticky thead везде
- Cmd+K command palette
- Sidebar reorg в 4 кластера

### Phase 3 — AI integration + Scanner 2.0 ↔ LLM (1-2 месяца)
- `chatIntentParser` SCANNER_QUERY intent
- LLM-rephrase для `composePersonNarrative`
- AI Daily-brief auto-generate в 9:00
- AI metric-explainer на каждом числе
- AI Sprint-retro generator
- AI burnout-intervention suggestion
- Per-team LLM budget + cache layer

### Phase 4 — Призма rebrand (3-6 месяцев)
- Phase 1 (M1-M2): Soft introduction (имя в footer/splash/email)
- Phase 2 (M3-M4): Visual refresh (logo Triad, palette `ray.*`, favicon)
- Phase 3 (M5-M6): Full rebrand (URL redirect, internal docs)
- Tour ≤90 sec + skip + «ничего не сломалось»
- 5 must-have features: search, focus mode, spectrum theming, migration banner, URL redirect tool

### Phase 5 — Integrations expansion (2-3 месяца)
**Top sleeping data implementation:**
- Sprint-velocity history (`/rest/agile/1.0`)
- PR cycle-time aggregator
- Issue-links graph
- Per-author worklog breakdown
- Resolution-split + reopen-rate
- Sub-task completion ratio
- Hot-files + bus-factor
- Stale branches/pages

**New views:**
- Component health card
- Bus-factor map
- Dependency Sankey
- Burnout watchtower
- Onboarding tracker
- Doc-debt console
- Flaky-tests leaderboard (Zephyr)
- Release train cockpit
- Estimation calibration
- Knowledge flow graph

---

## 🚫 Сознательно НЕ делаем (по решению user'а)

- HR блокеры (heatmap downgrade, переименовать «Стоп», убрать badges, DPIA, self-view, HR-checklist) — приняты риски ст. 86 ТК / surveillance / ranking-эффекта
- Z4 Comparison X vs Y между конкретными людьми
- Z5 Predicted attrition (нет ML pipeline + 152-ФЗ ML-профайлинг)

---

## 💡 Стратегические решения (требуют CTO sign-off)

1. **Server-side persistence** — для metrics + 1:1 notes + consent (cross-device, 90+ day time-series, audit trail)
2. **Renderer split** (god-module 2300 LOC) — на 500+ employees first paint не уложится в 16ms
3. **Vanilla server compromise** — на 500+ users `server.js` уже implement'ирует mini-Express; **дешевле принять fastify** чем продолжать самописное
4. **Metric pipeline reuse** — Prometheus/Kafka если уже стоят в Сбере
5. **Rollout cadence** — 100 → 500 → 2000 → весь Сбер с 2-week soak между ступенями
6. **Призма rebrand** — анонс, согласование с DPO, юр. имя в реестре ПО Сбера

---

## 🎓 Призма rebrand — главные decisions

1. **Имя «Призма»** утвердить, кириллица первична
2. **English form: Prizma** через Z (развести с Prisma ORM, Palo Alto Prisma Cloud)
3. **Метафора в UX**, не в маркетинге («поворот призмы» при view-switch)
4. **Sub-brands:** Спектр (Реестр) / Ось (Гант) / Грань (Канбан) / Фокус (AI) / Луч (Сканнер) / Обзор (Dashboard) / Поток (Планирование)
5. **Logo: Triad** (треугольник + 7 лучей)
6. **Palette: 7 лучей радуги** + ночной синий, indigo extends to `ray.focus`
7. **Spine-pill сохраняется** + spectrum accent extension
8. **Co-branding 3 мес** «СБОФ · Призма»
9. **301 redirect 12 мес минимум**
10. **Brand-имена только для 2-3 hero-фич** (не для всех actions)

---

## 📊 Метрики проекта

| Метрика | Сейчас | Target (через 6 спринтов) |
|---|---|---|
| Unit tests | 848 | ~3000 |
| Integration tests | ~0 | ~200 |
| Contract tests | 11 | ~50 |
| E2E (Playwright) | 10 smoke | 30+ flows |
| Visual regression | 0 | ~40 baselines |
| A11y violations | not measured | 0 critical |
| Coverage % global | not measured | ≥75% line |
| Coverage % critical | not measured | ≥90% line |
| Pilot users | 109 | 500-2000 |
| Server LOC | 3500 | <2500 (split) |
| Renderer LOC | 3700 (Scanner 2.0) | <2000 (split) |

---

## 🔗 Ссылки на детальные отчёты

- [01 — Technical](./01-technical.md) (Performance, Architecture, Backend, Frontend, Reliability, Security)
- [02 — Testing](./02-testing.md) (QA, Visual, Theme, A11y, Cross-browser)
- [03 — Design/UX](./03-design-ux.md) (Visual, IA, Brand, Interaction)
- [04 — AI / Chat](./04-ai-chat.md) (LLM, prompts, Scanner 2.0 связь)
- [05 — DevOps](./05-devops.md) (CI/CD, Security ops, Observability, Release)
- [06 — Призма rebrand](./06-prizma-rebrand.md) (Brand, visual identity, UX migration)
- [07 — Tabs/Header/Settings](./07-tabs-header-settings.md) (17 sections, sidebar, topbar)
- [08 — Test Coverage](./08-test-coverage.md) (Maximum coverage strategy)
- [09 — Integrations Deep](./09-integrations-deep.md) (Jira/BB/CF/Zephyr + new metrics)

---

**Все 9 аудитов завершены.** Каждый файл содержит:
- TL;DR
- Top issues (15-30)
- Per-section / per-component breakdown
- Quick wins (≤2д)
- Roadmap (phases / sprints)
- File:line references для всех findings

Всего ~50k слов экспертных анализов от 47 экспертов в 9 сессиях параллельной работы.
