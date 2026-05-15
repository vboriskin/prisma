# Audit 05 — DevOps / Release / Security Ops / Observability

**Авторы:** 4 эксперта — Senior SRE/DevOps Lead, Release Engineer, DevSecOps Engineer, Observability Engineer.

---

## TL;DR

**Текущее состояние:** проект имеет **CI** (тесты+lint+typecheck), но **нет CD**, нет Docker/K8s, нет alerting, нет SAST/SCA, нет audit-log для config-changes, ПДн (email/ФИО) логируется без redaction.

**Top-5 must-fix:**
1. **PII в логах не scrub'ится** (152-ФЗ violation risk) — `_scrubSecrets` есть для CSV/JSON, но не для log-pipeline
2. **Нет `package-lock.json`** + нет `npm audit` / SCA → vendored libs (xlsx, sql-wasm) supply-chain blind spot
3. **Plain HTTP server без TLS termination** + SSRF через user-controlled `jiraBaseUrl` proxy
4. **`launch.js` hardcoded "v11"** + `package.json#version` заморожен на 17.0.0 при V21 в коде → семантика версий мертва, нет git tags
5. **Frontend JS-errors not collected** (`window.onerror` missing) — JS-краши у пользователей невидимы

---

## A. Текущее DevOps состояние

| Слой | Что есть | Gap |
|---|---|---|
| **Build** | Нет (vanilla ES modules as-is) | Нет cache-busting, нет SRI checksum для vendored libs |
| **CI** | `.github/workflows/ci.yml` + `.gitlab-ci.yml` (зеркало). `node:22-alpine`, validate→test→smoke, ~10мин timeout | Дублирующиеся pipelines, нет release-job, нет SAST/DAST/SCA |
| **Tests** | typecheck (tsc --checkJs), eslint (--max-warnings 215), unit (848), contract (11), legacy testRunner (~104), e2e (10), perf:budget | Нет security-tests, нет coverage gate |
| **Deploy** | `npm start` → `launch.js` → `node server.js`, port-discovery 8080-8090 | Нет prod CD, нет artifact registry, нет blue-green |
| **Config** | `jira_config.json` в repo (с Sigma legacy) + ENV: `LOG_LEVEL/FORMAT/TS`, `allowInsecureTls` | Нет dotenv, нет Vault, plain-text tokens |
| **Secrets** | Bearer-tokens runtime от клиента, не на сервере | Нет rotation, нет signing |
| **Logging** | `server/logger.js` NDJSON (ELK-friendly), `/health` + `logger.event` (V19 C4) | **PII не redact'ится**, нет log-rotation, нет frontend-error pipeline |
| **Metrics** | `/metrics` JSON: `requestsTotal/byPath/4xx/5xx/rateLimited/uptime/memoryMB` | Не Prometheus-format, нет histograms, in-memory reset on restart |
| **Alerts** | Нет | `llm.budget_exceeded` логируется, но никто не получает |

---

## B. Major Gaps

### CI/CD maturity
- Только CI (validate/test). Нет CD, нет artifact registry, нет SBOM/SCA
- Нет dev/stg/prod environments — pilot 109 чел работает на одной инсталляции
- Нет rollback strategy (откат = `git revert` + ручной перезапуск)
- Нет load-tests / capacity planning

### Release
- **Нет git tags** — невозможно `git checkout V17.2`
- `package.json#version = "17.0.0"` заморожен при V21 в коде
- **`launch.js` hardcoded "v11"** в баннере — рассинхрон
- Vendored libs (`xlsx`, `sql-wasm`) **без SHA-256 / SRI / lockfile**
- Нет cache-busting — пользователи видят stale JS после обновления
- `audit-2026-*/` папки попадают в дистрибутив (лишние MB + confidential ADR)
- Нет centralized update channel — обновление = social engineering

### Security
- SAST/DAST/SCA отсутствуют
- Plain HTTP server без TLS layer
- SSRF через `jiraBaseUrl` proxy
- ПДн (email, displayName) в логах без маскировки → **152-ФЗ violation**
- Нет audit trail для `jira_config.json` mutations
- Retention policy отсутствует на `historyLog`, `errorsLog`, sqlite
- Нет right-to-be-forgotten endpoint

### Observability
- Нет per-integration health metrics
- Нет latency histograms (только counters)
- Нет `X-Request-Id` middleware + downstream propagation
- Нет log-rotation
- Нет DAU/MAU aggregation (events emitted, не aggregated)
- Нет SLI/SLO definitions

---

## C. План DevOps по фазам

### Phase 1 — Foundation (1 месяц)
1. **Lock-файл + `npm ci`** — закрыть TODO в CI
2. **`Dockerfile`** (multi-stage, `node:22-alpine`, non-root user) + `.dockerignore`
3. **3 environment**: `dev` (auto-deploy main), `stg` (manual promote), `prod` (pilot)
4. **CD pipeline** — добавить `deploy:dev / stg` стадии в GitLab CI с manual gate на prod
5. **Readiness probe** — `/ready` (Jira ping, FS write-test для prefs-store)
6. **Config externalization** — `jira_config.json` в ConfigMap, secrets в Vault
7. **Security CI lane** — semgrep + `npm audit --audit-level=high` + gitleaks + osv-scanner. SBOM (CycloneDX)
8. **PII-redaction middleware** в `server/logger.js`: regex-маски для email/phone/ФИО + unit-tests «log NEVER contains @»
9. **`package-lock.json` сгенерировать** + переключить CI на `npm ci`
10. **Документ `docs/runbook.md`** — incidents, rollback, on-call rotation

### Phase 2 — Reliability (2 месяца)
11. **Observability stack**: NDJSON → Filebeat → ELK. Метрики через `prom-client` (devDep) → Prometheus → Grafana
12. **Alerting** — Alertmanager: `5xx > 1% / 5min`, `p95 > 1s`, `llm.budget_exceeded`, `/ready` flapping → Mattermost
13. **Rollback** — blue-green на 2 VM за nginx upstream switch, RTO ≤ 5 мин
14. **Load-test** — `k6` сценарий 500 / 2000 / 5000 RPS на `/api/integrations/jira/*`
15. **SAST/SCA** — Semgrep / corp `Solar appScreener`
16. **Backup / DR** — server-side prefs ежедневный snapshot, retention 30 дней
17. **Secrets-vault integration** — вытащить Bearer-tokens в Vault, rotation 24h
18. **Frontend error pipeline** — `window.onerror`/`unhandledrejection` → `/api/telemetry` event → Grafana panel

### Phase 3 — Scale (3+ месяцев)
19. **K8s migration** (если ≥2000 чел) — corp OpenShift с HPA + custom metric (RPS)
20. **OpenTelemetry SDK** в `server.js` — экспорт в Jaeger
21. **SLO/Error budget** — 99.5% доступность, p95 `/api/integrations/jira/team` < 1.5s
22. **Chaos / GameDay** — отключить Jira, проверить graceful degradation
23. **Multi-region** (если 20k+) — active-passive DR в другом ЦОДе
24. **Self-service developer portal** — `Backstage` (если в Сбере есть) с template для нового view/integration

---

## D. Tools recommendations (corp Сбер)

| Слой | Рекомендация | Почему |
|---|---|---|
| **CI** | **GitLab CI** | Уже есть, corp standard; GitHub mirror только для open-mind dev |
| **Container** | **Podman rootless** или Docker | Подман предпочтителен в банковских контурах. Image `node:22-alpine` или corp-mirror |
| **Orchestration** | **K8s OpenShift (Phase 3); VM + systemd (Phase 1-2)** | Pilot 109 чел не требует K8s; при >2000 — OCP кластер |
| **Logging** | **ELK** или **Splunk** (corp instance) | Logger уже emit-ит ELK-friendly NDJSON |
| **Metrics** | **Prometheus + Grafana** | `prom-client` (devDep) — минимальная dep |
| **Tracing** | **OpenTelemetry → Jaeger** | OTel SDK как единственная новая dep |
| **Secrets** | **HashiCorp Vault** (corp instance) | KV v2 + AppRole для server.js |
| **Artifact registry** | **Nexus / Artifactory** | Для container-images и npm proxy |
| **Vulnerability** | **Solar appScreener** + **Trivy** | Trivy в CI на Docker-image |

---

## E. Top-15 immediate actions

| # | Action | Severity | Phase |
|---|---|---|---|
| 1 | PII-redaction в `server/logger.js` (regex маски email/phone/ФИО) | 🔴 P0 | 1 |
| 2 | `npm audit` + gitleaks + osv-scanner в CI как required check | 🔴 P0 | 1 |
| 3 | SSRF allowlist для `jiraBaseUrl/bitbucketBaseUrl/cfBaseUrl` | 🔴 P0 | 1 |
| 4 | Сгенерировать `package-lock.json` + `npm ci` в CI | 🟠 P1 | 1 |
| 5 | `Dockerfile` distroless non-root + `.dockerignore` | 🟠 P1 | 1 |
| 6 | `/ready` endpoint (depth-check Jira/BB/CF + write-test) | 🟠 P1 | 1 |
| 7 | Вынести `jira_config.json` из repo в `/etc/sbof/config.json` | 🟠 P1 | 1 |
| 8 | `prom-client` + `/metrics` Prometheus exposition | 🟠 P1 | 1 |
| 9 | SemVer + git tags + sync `package.json#version` через `scripts/release.js` | 🟠 P1 | 1 |
| 10 | `launch.js` hardcoded "v11" → читать из `package.json` | 🟠 P1 | 1 |
| 11 | SRI + lockfile для vendored libs (`libs/SHA256SUMS`) | 🟠 P1 | 1 |
| 12 | `window.onerror` frontend pipeline → `/api/telemetry` | 🟡 P2 | 2 |
| 13 | Filebeat sidecar / DaemonSet → ELK для NDJSON-логов | 🟡 P2 | 2 |
| 14 | Grafana dashboard 6 panels (RPS / p95 / 5xx / /ready / llm.budget / silent_error) | 🟡 P2 | 2 |
| 15 | Alertmanager rules → Mattermost | 🟡 P2 | 2 |

---

## F. Top-10 release issues

| # | Issue | Severity |
|---|---|---|
| 1 | Нет git tags — невозможно сравнить релизы | 🟠 High |
| 2 | `package.json#version` заморожен 17.0.0 | 🟠 High |
| 3 | `launch.js` hardcoded "v11" | 🟡 Med |
| 4 | Vendored libs без SRI/checksum | 🔴 High |
| 5 | Нет cache-busting в `index.html` | 🟠 High |
| 6 | Нет centralized update channel | 🟠 High |
| 7 | `audit-2026-*/` в дистрибутиве | 🟡 Med |
| 8 | Нет release notes для пользователей | 🟡 Med |
| 9 | localStorage migration без downgrade-guard | 🟠 High |
| 10 | `.github/workflows/ci.yml` + `.gitlab-ci.yml` дублируются | 🟢 Low |

---

## G. Top-10 security ops issues

1. Plain HTTP server без TLS termination layer
2. SSRF через user-controlled `jiraBaseUrl` proxy
3. Secrets в `jira_config.json` (file-on-disk, не Vault)
4. ПДн (email/ФИО) логируется без маскировки → 152-ФЗ violation
5. Vendored libs без integrity hash + без SCA → supply-chain
6. Нет `npm audit` / OSV в CI
7. Нет gitleaks pre-commit + CI gate
8. Нет retention/TTL на `historyLog`, `errorsLog`, sqlite
9. Нет right-to-be-forgotten endpoint
10. CSP/HSTS/X-Frame-Options headers в `server.js` (есть частично)

---

## H. Top-10 observability gaps

1. **No PII/secret scrub в logger** — single biggest risk
2. Frontend JS-errors not collected
3. `/metrics` not Prometheus-format
4. No latency histograms (только counters)
5. No per-integration health metrics
6. No `X-Request-Id` middleware + downstream propagation
7. No log-rotation / retention policy
8. No DAU/MAU aggregation
9. No alerting wired
10. No SLI/SLO definitions

---

## I. Идеи развития (20+)

### Release engineering
1. **SemVer + git tags** — `scripts/release.js` + sync `package.json#version`
2. **`CHANGELOG.md` авто-генерация** — парсить commit-prefixes + audit-папки
3. **Update-check ping** — `server.js` при старте проверяет версию против internal-mirror
4. **SRI + lockfile для vendored libs** — `libs/SHA256SUMS`, CI gate на коммит libs/
5. **Canary через feature-flags в `state.featureFlags`** — `localStorage.canary=1` для 5-10% pilot
6. **`npm run pack`** собирающий минимальный zip (без audit/tests/.git)

### Observability
7. **`scrubSecrets` в `logger._emit`** — middleware redact Authorization/Bearer/token/password/apiKey/cookie
8. **OTel SDK + `X-Request-Id` middleware** + propagation в downstream fetch
9. **Prometheus exposition** в `/metrics?format=prom` через `prom-client` или 50 LOC self-rolled
10. **Frontend error pipeline** — `window.onerror`/`unhandledrejection` → `/api/telemetry`
11. **SLI/SLO** — availability 99.5%, p95 < 2s, sync-freshness < 15min
12. **`/metrics/usage`** — telemetry events + server `_metrics` для DAU/MAU без external БД

### Security
13. **Security CI lane** — semgrep + npm audit + gitleaks + osv-scanner + SBOM
14. **Secrets-vault integration** — bearer-tokens в Vault, rotation 24h
15. **Container baseline** — distroless `gcr.io/distroless/nodejs22`, non-root UID 10001, read-only FS, k8s NetworkPolicy
16. **Compliance ops kit** — retention-job (cron, drop >180d), `/api/gdpr/forget?userId=` endpoint, threat-model (STRIDE)

### Reliability
17. **Health checks** — `/ready` depth-check + `/health` liveness
18. **Load-tests** — `k6` baseline на staging
19. **Chaos / GameDay** quarterly — отключить Jira, graceful degradation
20. **DR plan** — backup/restore, RPO 1 час, RTO 5 мин

---

## J. Cost (rough)

- **Phase 1:** ~0₽ (corp infra reuse) + ~40 чел-дней SRE
- **Phase 2:** ~80 чел-дней + лицензии Splunk если требуется (иначе ELK free)
- **Phase 3:** K8s namespace + 4-8 vCPU / 8-16 GB RAM на pilot-кластере, ~120 чел-дней

**Ключевой риск:** vanilla-no-deps философия (CLAUDE.md) запрещает runtime npm. Все DevOps tools — devDeps + sidecars (Filebeat, Prometheus exporter), либо infra-side (nginx, K8s probes). `prom-client` и OTel SDK — единственные предлагаемые runtime deps; требуют security review в духе vendored libs.

---

**Файлы high-priority:**
- `server.js` (3500 LOC) — proxy, TLS, SSRF, /metrics, PII в логах
- `server/logger.js` — добавить scrub middleware
- `.github/workflows/ci.yml` + `.gitlab-ci.yml` — добавить security stages
- `package.json` + `launch.js` — version sync
- `jira_config.json` — вынести из repo
- `libs/` — SRI checksums
- `docs/v21-rollout-cadence.md` — расширить под этот план
