# Технический аудит «Призмы» — 2026-05-03

**Объём:** ~50 KLOC vanilla JS + Node proxy. Особый фокус — **Сканнер команд 2.0** + **Чёрный дашборд**.
**Состав:** 943 unit + 23 contract тестов на момент проведения. Серия PR-AY…PR-CV.

## Состав команды экспертов

| # | Эксперт | Фокус |
|---|---|---|
| 1 | Senior Backend Engineer | server.js, async jobs, circuit-breaker, fetch pipeline |
| 2 | Senior Frontend Engineer (vanilla JS) | teamScanner2*, insightsDashboards, state lifecycle |
| 3 | Data / Analytics Engineer | model construction, metrics, identity-attribution |
| 4 | DevSecOps Engineer | security audit + Чёрный дашборд + sigma isolation |
| 5 | UX Lead / IA + Accessibility | sidebar IA, dashboards UX, WCAG 2.1 AA |
| 6 | QA + SRE Engineer | test coverage, observability, fault tolerance |
| 7 | AI/ML Engineer | chat, LLM safety, prompt economy |

(Седьмой эксперт работал параллельно с шестью основными.)

---

## A. Сильные стороны (что хорошо)

| Область | Что отметили |
|---|---|
| **Backend** | Async-job persistence + recovery, circuit-breaker per-host, parallel pagination в Jira (×2.5 throughput), HTTP cache с ETag passthrough, partial failure isolation per-PK |
| **Frontend** | Чистая разделённость orchestrator/renderer, TTL-cheat-sheet в коде, race-condition guard на abort, persistent snapshots с auto-cleanup |
| **Data** | Identity-deterministic attribution (V17.2 I1c), sleeping-data agregation без новых HTTP, статус-зависимые dwell thresholds (CR 8ч / QA 16ч / In-Progress 48ч), мемоизация с fingerprint |
| **Security** | Token isolation (Delta ≠ Sigma), SSRF guard с RFC-1918 блоком, multi-layer PII scrub (logger + LLM payload + diagnostic), structured logging |
| **UX** | Divider-grouped sidebar, manager-only фрейминг у Burnout, Spine-pill DS централизован, scope-banner прозрачности фильтров |
| **QA** | 1390+ test/describe блоков, contract-tests с fake Jira, миграция на node:test |
| **AI/ML** | Dual-path intent (rule-based vs LLM), JSON Schema validation структурированных ответов, hallucination guard через cite-pill, ANTI_INJECT token-fence |
| **SRE** | SSE heartbeat 25s, per-user LLM budget (X-Client-Id), telemetry с regex-whitelist, structured NDJSON логи |

---

## B. Критичные риски (sorted by severity)

| # | Риск | Severity | Кто отметил | Источник |
|---|---|---|---|---|
| 1 | **Burnout Watchtower без permission gate** — все видят after-hours метрики команды без backend enforcement | CRITICAL (152-ФЗ) | DevSecOps, UX | [insightsDashboards.js:147](views/insightsDashboards.js) |
| 2 | **Sigma jiraToken plaintext в jira_config.json** — компрометация ноутбука = доступ к Sigma instance | HIGH | DevSecOps | [integrationsStore.js](integrations/integrationsStore.js) |
| 3 | **CSP / HSTS / X-Frame-Options отсутствуют** в server.js — clickjacking surface | HIGH | DevSecOps | [server.js](server.js) |
| 4 | **Memory unbounded** — `_httpCache`, `_recentBucketCache`, `_metrics.latencies` накапливаются без TTL audit. На 30+ дней runtime — leak | HIGH | SRE | [server.js:706](server.js), [server.js:1154](server.js) |
| 5 | **Zero coverage в LLM proxy + OAuth retry** — `proxyChat`, `gigachatGetToken`, token refresh dedup. PR-CI без regression test | HIGH | QA | [server.js:256](server.js) |
| 6 | **Black Dashboard без graceful degrade** — если sigma fetch упадёт, весь dashboard = error. Нет partial model | HIGH | Backend | [blackDashboardApi.js](integrations/blackDashboardApi.js) |
| 7 | **Confidence levels отсутствуют** — quantile p50/p90 на 1-2 PR-ах коллапсирует в одно число, метрика выдаётся как solid | MEDIUM | Data | [server.js:1654](server.js) |
| 8 | **No regression tests для PR-CV/CG/CJ/CH** — TDZ bug, BB allowlist, tzSkew, deactivated filter — все могут вернуться | MEDIUM | QA | tests/unit/ |
| 9 | **`allowInsecureTls` глобальный для всех сервисов** — если включён для on-prem Delta, и Sigma уязвима MITM | MEDIUM | DevSecOps | [server.js:34](server.js) |
| 10 | **PR cycle-time исключает declined/abandoned** — для команд с частыми decline'ами p50/p90 завышены | MEDIUM | Data | [server.js:1654](server.js) |
| 11 | **WCAG 2.1 AA gap** — focus management в модалках неполный, dark theme contrast не проверен | MEDIUM | UX | [teamScanner2Renderer.js:2326](integrations/teamScanner2Renderer.js) |
| 12 | **Audit log для config-mutations отсутствует** — кто и когда поменял `jiraToken` — никто не узнает | MEDIUM | DevSecOps | [integrationsStore.js:96](integrations/integrationsStore.js) |
| 13 | **Renderer monolith 4500 LOC** — `teamScanner2Renderer.js` сложно читать, регрессии при добавлении PR | MEDIUM | Frontend | [teamScanner2Renderer.js](integrations/teamScanner2Renderer.js) |
| 14 | **Comment redaction агрессивна** — regex `[A-Za-z0-9_-]{40,}` обрезает legitim длинные описания | LOW | AI/ML | [chatContextBuilder.js:68](chat/chatContextBuilder.js) |
| 15 | **/ready не sample real Jira** — depth-check проверяет config + memory, но не «реально ли работают upstream» | LOW | Backend, SRE | [server.js:5085](server.js) |

---

## C. По экспертам (выжимки)

### 1. Backend Engineer
- **Сильные стороны:** async-job persistence, circuit-breaker, parallel pagination, partial failure isolation
- **Главный риск:** Black Dashboard fail-closed на Sigma fail (vs Pulse fail-open per-PK)
- **Топ-3 рекомендаций:**
  1. Smart partial failure recovery в Black Dashboard expand-phase
  2. Comprehensive telemetry per-integration (error rates per-host, breaker transitions)
  3. `/ready` sample real Jira `/myself` за 2 сек

### 2. Frontend Engineer
- **Сильные стороны:** TTL cheat-sheet в коде, race-condition guard, persistent snapshots
- **Главный риск:** 4500-LOC renderer monolith
- **Топ-3 рекомендаций:**
  1. Split renderer на 5 модулей (topbar / glance / personRows / modals / helpers)
  2. Focus Manager для модалок (push trigger → pop on close)
  3. CSS lazy-load — `styles/ts2-*.css` модули

### 3. Data Engineer
- **Сильные стороны:** identity-deterministic attribution, sleeping-data, мемоизация с fingerprint
- **Главный риск:** confidence levels отсутствуют, малые выборки выдают solid-метрики
- **Топ-4 рекомендации:**
  1. `{ value, n, confidence: high|medium|low }` для всех метрик. UI: badge «⚠ данных мало» если n<10
  2. Centralized `identityConfig.js` (service-account patterns в одном месте)
  3. Declined/Abandoned PR'ы — отдельный bucket (`prMetrics.cycleTimeDeclined`)
  4. Per-reviewer comment-depth map (не proxy через `reviewer.size`)

### 4. DevSecOps
- **Сильные стороны:** SSRF guard, multi-layer PII scrub, token masking
- **Критичные риски:**
  1. **Burnout Watchtower без permission gate (152-ФЗ нарушение)** — BLOCKER перед wide rollout
  2. Sigma jiraToken plaintext
  3. CSP/HSTS/X-Frame отсутствуют
- **Топ-5:**
  1. Permission gate для Burnout (role check + backend filter)
  2. HTTP security headers (5-минутный fix)
  3. Per-service `allowInsecureTls` (Delta vs Sigma)
  4. Усилить comment redaction (50 chars cap или drop вообще)
  5. ADR-doc + contract test «sigma token isolation от LLM payload»

### 5. UX/IA
- **Сильные стороны:** divider-grouped sidebar, manager-only framing, transparency-banner
- **Главные риски:**
  1. WCAG 2.1 AA — focus management неполный, dark theme contrast
  2. Burnout метрика `afterHoursRatio` — двусмысленна (% от чего?)
  3. Sidebar 21+ items без кластеров
- **Топ-5:**
  1. Accessibility sprint (3-5 дней audit + 2-3 fix)
  2. Sidebar hierarchization (label-prefixes или nested)
  3. HR-sensitive content protection: переименовать метрику, audit log просмотров
  4. Empty-state inline requirements (всегда visible, не только когда пусто)
  5. AI chat hallucination guard — visible иконка ⚠ для invalid citations

### 6. QA + SRE
- **Сильные стороны:** 1390+ test блоков, contract tests, async-job persistence, structured logging
- **Главный риск:** zero-coverage в LLM proxy + recent PR fixes
- **Топ-5:**
  1. **Regression test suite** для PR-CV (TDZ), PR-CG (allowlist), PR-CJ (tzSkew), PR-CH (deactivated)
  2. **LLM proxy contract test** + GigaChat OAuth mock
  3. `/metrics` Prometheus-compatible: breaker state per-host
  4. Test isolation для state-dependent tests (beforeEach reset)
  5. Snapshot/golden tests для portfolio-pulse / black-dashboard outputs

### 7. AI/ML
- **Сильные стороны:** dual-path intent, hallucination guard, ANTI_INJECT, per-user budget
- **Главные риски:**
  1. Token economy недо-документирован (top-12 vs top-5 — почему?)
  2. Few-shot hardcoded ru-only
  3. Comment redaction слишком агрессивна
- **Топ-3:**
  1. Версионировать few-shot examples + A/B test
  2. Partial-response recovery в parseStreamResponse (показать % полученного + retry)
  3. Split system prompt на core (ROLE + SAFETY 0.8KB) + optional DOMAIN_CONSTANTS

---

## D. Сводный Top-15 рекомендаций (сорт. impact/effort)

| # | Рекомендация | Категория | Размер | Приоритет |
|---|---|---|---|---|
| 1 | **Permission gate для Burnout Watchtower** (152-ФЗ blocker) | Security/UX | S | **P0** |
| 2 | **HTTP security headers** (CSP/HSTS/X-Frame-Options) | Security | XS | **P0** |
| 3 | **Audit log для config-mutations** + Sigma token rotation runbook | Security | S | **P0** |
| 4 | **Regression tests** для PR-CV/CG/CJ/CH (4 теста) | QA | S | **P1** |
| 5 | **LLM proxy contract tests** + OAuth mock | QA | M | **P1** |
| 6 | **Memory bounds audit** — `_httpCache`, `_recentBucketCache` TTL/eviction | SRE | S | **P1** |
| 7 | **Confidence levels** для всех метрик (`n<10 → low`) | Data | M | **P1** |
| 8 | **Black Dashboard partial graceful degrade** на Sigma down | Backend | M | **P1** |
| 9 | **Centralized identityConfig.js** (service-account / deactivated patterns) | Data/Security | S | **P1** |
| 10 | **Per-service `allowInsecureTls`** (Delta vs Sigma раздельно) | Security | S | **P2** |
| 11 | **Renderer.js split** на 5 модулей | Frontend/DX | M | **P2** |
| 12 | **Focus Manager + Tab-trap** для всех модалок (WCAG 2.1 AA) | UX/A11y | M | **P2** |
| 13 | **`/metrics` Prometheus-compatible** + breaker state per-host | Observability | S | **P2** |
| 14 | **Declined PR bucket** + per-reviewer comment-depth map | Data | S | **P2** |
| 15 | **Sidebar hierarchization** (cluster-prefixes) + HR-метрика disclaimer | UX | S | **P3** |

---

## E. Финальный вердикт

**Архитектурно** проект solid. Identity-deterministic attribution, sleeping-data, async-job persistence, circuit-breaker, multi-layer PII scrub — это инженерная зрелость уровня production-ready proxy.

**Однако**, перед wide rollout (>200 человек или несколько команд) **обязательны три фикса**:

1. **Burnout Watchtower** → permission gate (P0, без этого 152-ФЗ нарушение)
2. **HTTP security headers** → CSP/HSTS/X-Frame-Options (P0, 1-2 часа работы)
3. **Audit log + token rotation** для config-mutations (P0)

После них — **P1 кластер** (regression tests, memory audit, confidence levels, partial degrade) можно делать в темпе спринтов.

**Главный долг** проекта — наблюдаемость:
- circuit-breaker state per-host не в `/metrics`
- `/ready` не делает sample real upstream call
- Snapshot/history persistence local-only (теряется на restart)
- Frontend telemetry в stdout, но downstream visibility отсутствует

Это не блокеры для пилота на 99 человек, но **первое узкое место** при росте до сотен пользователей и нескольких сред.

**Тестовый базис** (943 unit + 23 contract) — solid, но **regression tests для recent fixes отсутствуют**, что создаёт риск возврата уже исправленных багов (TDZ, allowlist leak, tzSkew false positive).

**LLM-флоу** хорошо защищён от injection и hallucination, но **token economy** недо-документирован: магические числа top-12, top-5, max=20 разбросаны без обоснования. Few-shot examples hardcoded для русского языка — риск при i18n.

---

**Рекомендуемый план:**
- **Sprint 1 (1 неделя):** P0 (permission gate, headers, audit log)
- **Sprint 2-3 (2 недели):** P1 (regression tests, memory, confidence, partial degrade, identityConfig)
- **Phase 2 (отдельный квартал):** P2-P3 (renderer split, A11y, observability)

После Sprint 1 → можно открывать wide rollout до **300 человек / 5 команд**. Перед exit к 1000+ — нужен Phase 2.

---

**Дата:** 2026-05-03
**Версия:** V21 (PR-AY…PR-CV merged)
**Тестовая база:** 943 unit + 23 contract = 966 зелёных
