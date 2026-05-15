# V21 — Rollout Cadence для Сканнер команд 2.0

> Документ описывает ступенчатый rollout от пилота 109 человек до организации.
> Создан в S15 как часть PR-I V6 (CTO request).

## Текущее состояние (на 2026-05-03)

- **Pilot**: 1 команда, 109 человек, 5 project keys (`SBOFPLCORE, SMECM, SMEAM, SMEND, SMECIS`)
- **Tests**: 847 unit зелёные, scrub property-based (200 random fuzz)
- **LOC**: ~5000 в `integrations/teamScanner2*.js`
- **Persistence**: localStorage (POC server-side в S15)

## Ступени раскатки

| Ступень | Команд | Чел. | Что замеряем | Минимум до next |
|---|---|---|---|---|
| **0 (now)** | 1 | 109 | first-paint latency, fetch-error rate, daily-brief usage | 2 недели green metrics |
| **1** | 5 | ~500 | `_renderFull` <50ms на p95, server `proxyChat` budget OK | 2 недели |
| **2** | 20 | ~2000 | renderer ceiling — может потребовать V2 split | 4 недели |
| **3** | 50 | ~5000 | scrub-fuzz coverage, server-side prefs durability | 4 недели |
| **4 (org-wide)** | 200+ | 20k+ | full org integration | — |

## Пререкизы между ступенями

### Ступень 0 → 1
- [ ] `_renderFull` p95 < 50ms на 100-employee fixture
- [ ] V20 S11.1 баги (1-9) закрыты ✓
- [ ] HR-блокеры решены (либо принят риск с подписями)

### Ступень 1 → 2
- [ ] **V2 Renderer split** — `teamScanner2Renderer.js` >2300 LOC, performance regression при 500+
- [ ] Server-side prefs replace localStorage для cross-device sync
- [ ] Telemetry dashboard в ELK / Grafana

### Ступень 2 → 3
- [ ] **V1 Server-side persistence** для metrics + 1:1 notes (cross-device)
- [ ] **V3 Scrub-fuzz** real fuzzing pipeline в CI ✓ (200 random payloads)
- [ ] Renderer p95 holds < 50ms на 1000-employee fixture
- [ ] CISO sign-off на storage policy

### Ступень 3 → 4
- [ ] Full SAML integration для user identity (replace `?user=email` query)
- [ ] Audit log retention 90+ days в server-side store
- [ ] Disaster recovery план для prefs file
- [ ] LLM budget cap fine-tuned для org scale (V4)

## Ops / observability

**Что мониторим:**
- `scanner2.fetch_done` — client-side latency
- `scanner2.silent_error` — все catch'нутые исключения
- `/api/integrations/*` — p95 server latency, 4xx/5xx ratio
- `llm.budget_exceeded` — алерт на исчерпание quota
- `scanner_prefs.update` — DAU per pref-write

**Pre-prod gates** (для каждой ступени):
- [ ] All 847+ unit tests green
- [ ] `node --check server.js` syntax OK
- [ ] `npm run perf:budget` в норме
- [ ] CISO review для PII-touching changes

## Решения требующие CTO sign-off

1. **V1 Server-side persistence** (POC scaffolding в S15) → когда переходить с localStorage на full server-side store, какой DB-engine
2. **V2 Renderer split** — выделить time-budget на refactor
3. **Cross-org rollout** — после ступени 4 ждём ли пользовательский запрос или раскатываем централизованно

## История

- **V20 S10**: PR-A..D (UI улучшения от пилота — дни/часы, выравнивание, header metrics, switcher, sprint filter, lag breakdown)
- **V20 S11**: 9 bugs + 8 personal metrics (Z1-Z3, Z6-Z10) + Z7 velocity comparison
- **V20 S12**: PR-F (14 high-impact items — search, daily brief, action queue, sprint health, zombies, diff badge)
- **V20 S13**: PR-G (narrative + sprint detail + scope churn detail + PR cycle)
- **V20 S14**: PR-H (Health Score, weekday-anomaly, stale PR, estimate accuracy, bus-factor, onboarding, blocker MTTR, cross-team deps, sprint confidence)
- **V21 (S15)**: PR-I infrastructure (server-side prefs POC, scrub-fuzz, LLM budget cap, this doc)
