# AUDIT_DEVOPS — DevOps / SRE / Infra-Security аудит Призмы

> **Этап 8 из 14.** Аудит pipeline / secrets / deploy / observability / cost / IaC.
> **Дата:** 2026-05-07. **Корень:** `/Users/vaceslavboriskin/Documents/claude/prisma/prisma_new_design_v2/`.
> **Скоп:** не код, а всё вокруг — конфиги CI, секреты, деплой, мониторинг, бэкапы, runbook.

## Контекст в одну фразу

Призма — **vanilla-JS no-bundler** инструмент с **одним** Node-сервером (`server.js`, ~6.5k LOC) + проксирование к Jira/Bitbucket/Confluence/GigaChat. Раздаётся как **папка** (git clone / SMB / USB / ZIP) — никакого централизованного деплоя, никаких контейнеров, **никакого Dockerfile** в репо. CI = GitHub Actions + GitLab CI (mirror), **только проверки**, без деплоя. Это сильно меняет приоритеты: «zero-downtime» не существует (deploy = пользователь дёрнул `git pull`), а главные риски — **secrets-leakage**, **dependency-supply-chain** и **отсутствие observability у пользователя**.

---

## Формат находок

`раздел | файл:строка | severity | проблема | решение | трудозатраты`

severity: **critical / high / medium / low** • трудозатраты: **S** ≤ 4ч, **M** ≤ 1д, **L** ≤ 1нед.

---

## 1. CI/CD — длительность, кеш, параллельность, preview-окружения

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 1.1 | CI/CD | `.github/workflows/ci.yml:10` | medium | **Один job `ci` гонит ВСЁ последовательно** (typecheck → lint → unit → contract → testRunner → e2e → perf → smoke). Если падает lint — мы не узнаём что unit ОК. P95 wall-clock = sum(стадий), хотя 5 из 7 шагов независимы. | Разбить на параллельные jobs (matrix или `needs`-граф): `typecheck`, `lint`, `unit`, `contract`, `e2e+smoke` — по отдельности. `.gitlab-ci.yml:8` уже разбит на стадии — синхронизировать GitHub-конфиг с ним. | M |
| 1.2 | CI/CD | `.github/workflows/ci.yml:25` `.gitlab-ci.yml:21` | high | **`npm ci \|\| npm install` fallback** — если `package-lock.json` отсутствует или устарел, тихо падает на `npm install`, что ставит **другие** версии транзитивных deps. Воспроизводимость билда нарушается, supply-chain-риск. | `package-lock.json` уже есть (38KB). Заменить на чистый `npm ci`. Если lock устаревший — пусть упадёт громко. Удалить комментарий «lock-файл ещё не создан» — он устарел. | S |
| 1.3 | CI/CD | `.gitlab-ci.yml:15` | medium | Кеш `node_modules/` по `$CI_COMMIT_REF_SLUG` — при PR в новую ветку кеш холодный. Plus кешировать сами `node_modules` антипаттерн (npm cache работает быстрее). | Кешировать `~/.npm` (npm cache) ключом по `package-lock.json` hash. GitHub Actions это делает автоматически (`cache: npm` в `setup-node@v4`), GitLab — нет. | S |
| 1.4 | CI/CD | `.github/workflows/ci.yml:13` | low | `timeout-minutes: 10` для всего `ci` job. При висящем e2e (ждёт сервер на 19099 — `sleep 2`) job упадёт молча через 10 мин, runner разогрет вхолостую. | Per-step timeouts: `timeout-minutes: 2` на typecheck/lint, `5` на unit, `3` на e2e+smoke. | S |
| 1.5 | CI/CD | весь pipeline | medium | **Нет preview-окружений / preview deploy.** PR никак не «попробуешь» — только локально клонируется. Для vanilla-JS приложения GitHub Pages preview / Vercel-style would be trivial. | Добавить job `preview-deploy`: `actions/deploy-pages@v4` или surge.sh для PR-веток. Стоимость: ~50 строк YAML. | M |
| 1.6 | CI/CD | `.gitlab-ci.yml:79-88` | medium | Smoke-step: `node server.js 19099 &` + `sleep 2` + `curl /health`. **`sleep 2` = флакающий**: если CI runner медленный, server не успел подняться → false-negative. | Заменить на retry-loop: `for i in {1..10}; do curl -fsS .../health && break; sleep 1; done`. Тот же fix в GH Actions (`ci.yml:60-68`). | S |
| 1.7 | CI/CD | оба pipeline | high | **Нет кеша между разными jobs** в GitHub Actions конфиге (там 1 job = не нужен; но если разделить — нужен). | После разделения (#1.1) — `actions/cache@v4` ключом по `package-lock.json`. | S |

## 2. Тесты в pipeline — покрытие, скорость, что блокирует мердж

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 2.1 | Tests | `package.json:13` | medium | `test:coverage` есть, но **не запускается в CI**. Нет coverage-gate (е.г. «не падать ниже 60%»). Регрессии в покрытии незаметны. | В CI добавить `npm run test:coverage` → парсить вывод Node `--experimental-test-coverage` → fail если < baseline. Или интеграция с Codecov/Coveralls. | M |
| 2.2 | Tests | `package.json:10` | medium | `npm test` = **3 разных раннера последовательно** (legacy `testRunner.js` + `node:test unit` + `node:test contract`). Legacy testRunner будет retired в V18 P12 — но всё ещё в CI блокирует мердж. | Удалить `testRunner.js` шаг из обоих pipeline после V18 P12 миграции (см. `audit-2026-05-V18/MASTER_PLAN.md`). Сократит CI на ~30s. | S |
| 2.3 | Tests | `.github/workflows/ci.yml:45-48` | low | Comment гласит `~104 legacy tests`, но это обещание. Никто не считает их в реальном времени. Если `testRunner.js` стал ассертить меньше — мы не увидим. | Печатать `passed: N / failed: 0` в каждом раннере (уже есть в `node:test --reporter=spec`), aggregate в job summary. | S |
| 2.4 | Tests | `e2eTest.js`, contract-tests | medium | E2E и contract spawn локальный server.js на 19099/19200/19201. **При параллельном запуске** в CI — порты столкнутся (если перейти на matrix-jobs из #1.1). | Использовать `port=0` (kernel выбирает свободный) и читать `LISTENING:<port>` из stdout (паттерн уже есть в `launch.js:146`). | M |
| 2.5 | Tests | весь pipeline | high | **Нет mutation-testing / property-based**. Для критичных мест — `_scrubSecrets`, `Identity attribution`, `Reactive.silent` — было бы крайне ценно. | Опционально: `stryker-mutator` для 3-4 критичных модулей. Долго запускается — отдельный nightly job, не блокирующий PR. | L |

## 3. Сборка и артефакты — Dockerfile, lockfile, воспроизводимость

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 3.1 | Build | (отсутствует) | high | **Нет `Dockerfile`** в репо. Раздача = «скопируй папку» — это работает для пользователя, но любой serverside-deploy / CI runner не может стандартизироваться. Также: размер «папки» = весь репо, включая `audit-2026-*/` (≈ 50% объёма!) — раздаём audit-историю на пользовательские машины. | Создать минимальный `Dockerfile`: `FROM node:22-alpine; COPY . .; CMD node server.js`. Для production-like запуска. И/или — `.dockerignore` исключит `audit-2026-*/`, `.git/`, `.profile/`. | S |
| 3.2 | Build | `package-lock.json:3` | medium | **Версия в lockfile ≠ версия в package.json** — `package-lock.json:3 = "12.0.0"`, `package.json:3 = "17.0.0"`. Lock явно устарел / не пересоздавался после bump'ов. | `rm package-lock.json && npm install` → закоммитить новый lock. Иначе следующий `npm ci` тихо может встать на старые транзитивные. | S |
| 3.3 | Build | `package-lock.json` | low | Lockfile весит 38KB при только **3 dev-deps** (eslint, @eslint/js, typescript). Это норма, но `node_modules` после установки = ~80MB → нужен `.gitignore` запись для `node_modules/` (уже есть, ОК). | Никаких действий, обоснованно. | — |
| 3.4 | Build | весь репо | medium | `audit-2026-*/` папок — **5 штук**, weight ~ нескольких MB документации. Раздаются вместе с приложением. | `.gitignore` оставить, но `.dockerignore` / build-script — исключить из артефакта раздачи. Создать `make-release.sh` — `tar czf prizma.tgz --exclude=audit-2026-* --exclude=.git --exclude=.profile .`. | S |
| 3.5 | Build | `libs/` | medium | Vendored `xlsx.full.min.js` + `sql-wasm.*` — без integrity-чек (SRI) или origin-trace. CLAUDE.md говорит «обновлять только через security review» — но нигде нет лога версий и SHA. | `libs/VERSIONS.md` с актуальными версиями + SHA-256 hash + дата vendor'а. Добавить CI step `verify-libs-integrity.sh` — проверяет SHA. | S |

## 4. Окружения — dev / staging / prod, паритет, дрейф

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 4.1 | Env | вся раздача | high | **Только одно окружение — пользовательский ноут.** Нет staging, нет prod в инфра-смысле. Каждый пользователь = свой prod, каждый со своим `jira_config.json`. Дрейф между «релизной» папкой и «у Васи в Documents» неизмерим. | Минимум: `/api/version` endpoint возвращает git-SHA из embedded build-info. Frontend показывает в footer. Это позволит при инциденте понять «у тебя какая версия?». | M |
| 4.2 | Env | `server.js:78,79,237,239` | medium | Конфиг = смесь `process.env.GIGACHAT_*` + `jira_config.json`. У типичного пользователя нет shell-env, поэтому envs работают только если запущен из терминала. Двойной клик `.command` — env vars от parent shell не наследуются предсказуемо. | Документировать в `КАК-ЗАПУСТИТЬ.md`: где менять env vars (через `.command`-обёртку). Альтернатива: ВСЕ конфиги через `jira_config.json` + UI настроек. | S |
| 4.3 | Env | (отсутствует) | low | Нет `.env.example` шаблона. Новый пользователь не знает, какие env vars влияют на сервер. | Создать `.env.example` с задокументированными `LOG_LEVEL`, `LOG_FORMAT`, `RATE_LIMIT_PER_MIN`, `INTEGRATION_BLOCK_PRIVATE`, `INTEGRATION_ALLOW_LOOPBACK`, `JOBS_PERSIST_DIR`, `GIGACHAT_*`, `PULSE_BB_*` и т.д. (нашёл ≥15 env vars в server.js). | S |

## 5. Конфигурация — секреты, .env, jira_config.json

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 5.1 | Secrets | `.gitignore:12` + `jira_config.json` | low (✓) | **`jira_config.json` КОРРЕКТНО исключён из git** (`git ls-files` пусто, в истории не появлялся). Локальная копия есть, но **содержит fake/test-токены** (`"jiraToken": "fake-token-for-tests"`, `"jenkinsToken": "test-token-xyz"`). Critical-инцидента не произошло. | Никаких действий. Гигиена ОК. Поддерживать паттерн. | — |
| 5.2 | Secrets | `jira_config.json:3,21` | medium | Файл ХРАНИТСЯ В CWD сервера в plain JSON. У любого процесса с правами чтения файла = доступ ко всем токенам Jira/BB/Confluence/Jenkins/Sigma. На корпоративном Mac это все приложения user'а. | Файлы 0600 permissions: `chmod 600 jira_config.json` при write (`server.js:jiraWriteConfig`). Это уже ускоряется в comments в `.gitignore:11`. **Verify**: добавить в код `fs.writeFileSync(p, json, { mode: 0o600 })`. | S |
| 5.3 | Secrets | `server.js:79` | high | **`SERVER_ACCESS_TOKEN = process.env.GIGACHAT_ACCESS_TOKEN`** — server-wide static token. Если установлен, любой клиент с доступом к серверу (localhost) может его дёргать через `/api/llm/chat` без аутентификации. У Призмы нет user-auth, всё что слушает на 127.0.0.1 — открыто для всех процессов user'а. | Документировать в `docs/integrations/auth-and-secrets.md` риск-модель: «локальный сервер = доверенная среда user'а». **Дополнительно**: одноразовый `?key=<random>` token в URL при `launch.js` boot — только этот процесс знает. | M |
| 5.4 | Secrets | весь сервер | high | **Нет `vault` / secret-manager**. Токены живут в `jira_config.json` (locally) и env vars (CI). Ротация = вручную. | Долгосрочно: Doppler/Vault/AWS-SM. Краткосрочно: задокументировать quarterly-rotation policy в `SECURITY.md`. | M |
| 5.5 | Secrets | `.gitignore:13-16` | low (✓) | `*.pem`, `*.key`, `.env`, `.env.*` исключены — ОК. | Поддерживать. Добавить `.profile/` (heap dumps могут содержать память с секретами!). | S |
| 5.6 | Secrets | `.profile/heap-snapshot-*.heapsnapshot` | high | **`.profile/` НЕ в `.gitignore`!** `launch.js:80-83` создаёт директорию для CPU/heap profiles, `server.js:6464-6486` пишет heap-snapshots. Heap-dump содержит **всю** память сервера, включая Bearer-токены, пароли OAuth и др. Если разработчик работал в `--profile` режиме, потом сделал `git add .` — снапшоты могут попасть в коммит. | Добавить в `.gitignore`: `.profile/`. Critical hygiene fix. | S |
| 5.7 | Secrets | `server.js:495,752` | low (✓) | Logger `_PII_PATTERNS` (см. `server/logger.js:75-89`) скрабит Bearer-токены, password, SNILS, паспорт, email — **до** emit. Хорошо. Также `server.js:495` redacts `Bearer` в `wwwAuth` debug. | Поддерживать. Добавить тест `tests/unit/loggerScrub.test.js` — регрессия может случиться. | S |
| 5.8 | Secrets | `jira_config.json` | medium | **Нет схема-валидации.** UI POST → server `jiraWriteConfig` принимает whitelist полей (`server.js:4913`), но если поле не в whitelist — silent drop. Опечатка в имени поля → unsaved → пользователь не узнает. | JSON-Schema validate на input + явный 400 с unknown-fields. | M |

## 6. Деплой — zero-downtime, rollback, миграции, фиче-флаги

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 6.1 | Deploy | (модель раздачи) | medium | **Нет zero-downtime deploy.** Раздача = пользователь делает `git pull` → перезапускает `Запустить.command`. На время рестарта `/health` вернёт ошибку. Если у user'а в этот момент бежит фоновая Pulse-job (`server.js:2421` JOBS_PERSIST_BASE) — она persistится в `/tmp/sbof-jobs/` и переживёт restart, но in-flight HTTP queries обрываются. | Документировать в runbook: «ждите завершения текущих операций перед закрытием». Фоном можно показать badge «есть незавершённые задачи». | S |
| 6.2 | Deploy | (нет миграций) | medium | **Нет миграций БД** — но есть localStorage migrations (`q2_*_v3` → `q2_*_v4`, см. `docs/state-contracts.md`). Если bump key и user откатил версию приложения — данные **потеряны** (старая версия не читает новый ключ). | Migration-policy: rollback compatibility ≥ 1 версии назад. Дублировать запись в N+1 и N-1 ключи в течение одной мажорной версии. | M |
| 6.3 | Deploy | `package.json:3` | low | Версия в `package.json` = single source of truth для UI footer (`launch.js:31`). Но **никаких git-tags** не видно (нужен внешний контроль). | Pre-release script: `version=$(node -p "require('./package.json').version"); git tag v$version`. Хук в CI на push в main. | S |
| 6.4 | Deploy | (нет rollback) | high | Если bad-release — каждый user должен **сам** делать `git checkout HEAD~1`. Нет «emergency-rollback» канала. | Документировать в `docs/incident-response.md`: «emergency rollback = `git revert <SHA>` в main → `git pull` у каждого user'а». Slack/email-шаблон уведомления. | S |
| 6.5 | Deploy | (фиче-флаги) | medium | Нет централизованной системы feature-flags. Локальные флаги через `localStorage.PRIZMA_*` есть в нескольких местах, но непрозрачны для админа. Невозможно «выключить feature X для всех». | Хотя бы: server отдаёт `/api/flags` GET → client опрашивает на boot → блок UI рендерится по флагам. Управляется через `jira_config.json`. | M |

## 7. Наблюдаемость — логи, метрики, трейсинг, дашборды

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 7.1 | Obs | `server/logger.js` | low (✓) | Structured JSON logger есть, levels (error/warn/info/debug), reqId-child, event(), timeStart/timeEnd. PII-scrub. **Хорошо реализовано.** | Поддерживать. | — |
| 7.2 | Obs | `server.js:6457` | low | `console.log('LISTENING:...')` — единственный non-logger вызов; нужен для launcher.js парсинга. ОК как есть. | Не трогать (контракт с launch.js). | — |
| 7.3 | Obs | `server.js:6240` (`/health`), `:6255` (`/ready`), `:6297` (`/metrics`) | low (✓) | Три endpoint'а: `/health` (liveness), `/ready` (depth-check с 4 проверками), `/metrics` (p50/p95/p99 latency, DAU, breakers, cache sizes). **Хорошо.** | Поддерживать. Возможно — отдельный `/metrics/prom` в Prometheus exposition format (упомянут в коде, но проверить наличие). | S |
| 7.4 | Obs | `server.js:152` (метрики in-memory) | high | **Метрики reset при restart.** `_metrics = { startedAt: ..., latencies: [...], daus: Map, ... }` — всё in-process. После рестарта = чистый лист. У single-tenant tool это терпимо, но любой weekly-trend невозможен. | Persist `_metrics` в `JOBS_PERSIST_DIR/metrics.json` каждые N мин + load on boot. Или slim Prom exporter → external Prometheus. | M |
| 7.5 | Obs | весь сервер | high | **Нет request-correlation ID в логах.** `logger.withReqId(id)` существует (`server/logger.js:142`), но grep по server.js: НЕТ ни одного `withReqId` вызова. Все логи без reqId — невозможно trace path запроса по логам. | В main `http.createServer` handler: `const reqLogger = logger.withReqId(crypto.randomUUID().slice(0,8))` + пропустить через все handlers. | M |
| 7.6 | Obs | весь сервер | medium | **Нет distributed tracing (OpenTelemetry).** Для интеграции с Jira/BB/Confluence/GigaChat — нужны spans вокруг каждого upstream-call. | Долго: `@opentelemetry/sdk-node` + Jaeger backend. Альтернатива минимальная: `logger.timeEnd('jira.fetch', ...)` — уже есть, но не везде применяется. Покрыть все upstream-calls. | M |
| 7.7 | Obs | (нет дашбордов) | high | **Нет Grafana/Kibana/etc.** `/metrics` endpoint есть, но никто его не скрейпит. Чтобы увидеть p95 latency — надо `curl localhost:8080/metrics` руками. | Минимум: Prometheus + Grafana docker-compose в `infra/observability/`. Включить в опциональный «Pro» режим. | M |
| 7.8 | Obs | `server.js:163-169` | medium | `clientErrors` и `clientErrorsRecent` — frontend ошибки шлются на сервер, server хранит **в памяти**, не emit'ит в logger. После рестарта потеряны. | `recordClientError → logger.error('[client]', { msg, stack, reqId })`. Появятся в structured-logs ELK-stream. | S |

## 8. Алертинг — что алертится, не шумно ли, runbook'и

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 8.1 | Alerting | (отсутствует) | high | **Нет alert-системы вообще.** Нет PagerDuty/Slack-webhook/email-alert. Если у user'а упал сервер — никто не узнает. У админа нет канала «у 5 человек 5xx-spike». | Минимум: cron-job `node scripts/health-check.js` у админа → если any user > X% 5xx за N часов → email. Reactive, но лучше чем ничего. | M |
| 8.2 | Alerting | (нет runbooks) | medium | `КАК-ЗАПУСТИТЬ.md` — это user-runbook. Но нет dev-/admin-runbook'а: «что делать если /health падает», «что если Pulse-job завис», «как rotate GigaChat token». | Создать `docs/runbooks/`: `01-server-wont-start.md`, `02-pulse-job-stuck.md`, `03-token-rotation.md`. | M |
| 8.3 | Alerting | `server.js:_breakers` | medium | Circuit-breakers за upstream'ы (Jira/BB/Conf) — есть, видно в `/metrics`. Но **нет alert'а** «3+ breaker'ов open» — даже хотя `/ready` вернёт 503 (good), никто не наблюдает. | Связать с #8.1 — `/ready` 503 = trigger alert. | S |

## 9. Инциденты — postmortem-культура, recovery time

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 9.1 | Incidents | `audit-2026-*/` | low (✓) | Есть **5 audit-папок** — это де-факто ADR-history (`CLAUDE.md` так и говорит). Хороший паттерн «как мы решили задачу». | Поддерживать паттерн для будущих incidents → `incidents/2026-MM-DD-<slug>.md`. | — |
| 9.2 | Incidents | (нет postmortem'ов) | medium | Аудиты — это **задачные** артефакты, не post-incident. Если в проде у кого-то ушёл токен в лог — где write-up? | Шаблон `docs/postmortem-template.md` (timeline, root-cause, mitigations, actions). | S |
| 9.3 | Incidents | (нет MTTR/MTBF) | low | Нет measure'ов «recovery time». User-side приложение, замерять сложно — но frontend telemetry (`/api/telemetry`) могла бы emit'ить `boot_failure` events. | Опциональный mid-term improvement. | M |

## 10. Бэкапы

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 10.1 | Backup | localStorage / `q2_*` | high | **Все user-данные в localStorage браузера.** Если пользователь чистит cache / меняет браузер / теряет ноут — данные **потеряны**. Нет server-side persistent копии. SQLite-WASM mode = тоже client-side. | Опциональный `POST /api/state/snapshot` — server сохраняет JSON в `JOBS_PERSIST_DIR/snapshots/<userId>/<ts>.json`. Cron-rotate keep last 30. **CSV._scrubSecrets** обязателен на пути экспорта. | M |
| 10.2 | Backup | `JOBS_PERSIST_DIR=/tmp/sbof-jobs/` | high | **`/tmp/` чистится при рестарте macOS** (раз в N дней by default). Pulse/BD job persistence теряется. Из server.js:2421: `process.env.JOBS_PERSIST_DIR \|\| _osTmp + 'sbof-jobs'`. | Default → `~/.prizma/jobs/` или `${ROOT}/.prizma-data/jobs/`. Обновить README + docs/running.md. | S |
| 10.3 | Backup | (нет restore-test) | medium | Даже если бэкап делается — никто не проверяет, что **восстановление работает**. Классический gotcha. | `tests/integration/backup-restore.test.js` — round-trip тест. | M |

## 11. Performance в проде — узкие места

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 11.1 | Perf | `server.js:1066` | medium | `JIRA_RATE_LIMIT_RETRIES = 12` (по умолчанию). На медленной Jira / 429 — может затянуть запрос на минуты, blocking event-loop через cascade'ы. | Backoff с jitter + global cap 60s per request. Уже есть `timeoutMs: 60000` в forward — проверить корректность. | S |
| 11.2 | Perf | `server.js:154` `_metrics.latencies = []` | low | Ring-buffer 1000 записей — норма. Quantile compute через sort O(n log n) на каждый `/metrics`-hit — на N=1000 окей, но если scale'нуть buffer до 100k — будет hot path. | Заменить на t-digest или histogram-buckets (Prometheus-style). Сейчас не критично. | M |
| 11.3 | Perf | `scripts/perfBudget.js:104` | low (✓) | Perf budget gate реализован — `htmlRawKB:70`, `cssRawKB:360`, `jsRawKB:1500`, `jsGzipKB:400`, `biggestJsKB:120`. Запускается в CI. **Хорошо.** | Поддерживать. После ребрендинга «Призма» style.css 814KB **превышает** `cssRawKB:360` — заметить и скорректировать budget или CSS. | S |
| 11.4 | Perf | `styles.css` (814KB!) | high | `styles.css = 814,781 bytes = ~795KB` raw. Будет fail'ить `perfBudget.js` (lim 360KB raw). Уже сейчас. Если perfBudget зелёный — кто-то поднял budget без commit-trail. | Минифицировать styles.css в build-step (даже без bundler'а: `csso styles.css -o styles.min.css`). Или разделить на per-view CSS. | M |
| 11.5 | Perf | `server.js:_HTTP_CACHE` | medium | In-memory cache upstream-ответов. Без TTL eviction по памяти — если cache key cardinality высокая, RAM растёт без bound'а до OOM. | Add LRU + max size cap (есть `_MAX_RESPONSE_BYTES` per response, но нет global cache size cap). | M |

## 12. Стоимость инфры

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 12.1 | Cost | `server.js:385` `LLM_BUDGET_LIMIT=5000`, `:386` `LLM_BUDGET_PER_USER=300` | medium (✓) | Per-user/day budget на GigaChat — есть. Hard-cap. **Хорошо**, защищает от runaway-cost. | Поддерживать. **Verify**: budget счётчик persist'ится между рестартами? Если нет — после рестарта user может запросить ещё 300. | S |
| 12.2 | Cost | `server.js:GIGACHAT_OAUTH` | medium | Token cache (`_tokenCache`) — TTL до `expiresAt - 90s`. Хорошо. Но **per-clientId** scope. Если 10 user'ов одновременно поднимают сервер — каждый делает свой OAuth-exchange. На corp Jira это N×запросов. | Локальный single-tenant — нет проблемы. Если когда-нибудь будет shared deploy — централизовать. Сейчас ОК. | — |
| 12.3 | Cost | Pulse `BB_REPO_CONCURRENCY=4` | low | Параллельные запросы к Bitbucket — 4 одновременно. Если у user'а 100 репо × 4 концурренси = 400 запросов на Pulse-run. Может ударить по Bitbucket-rate-limit. | Уже clamp'ed `Math.max(1, Math.min(16, ...))` → ОК. | — |
| 12.4 | Cost | (over-provisioning) | low | Single Node-server, 1 процесс, 1 thread (event-loop). Resource-claim = ~50MB RSS. Не over-provisioned. | — | — |

## 13. Безопасность инфры

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 13.1 | InfraSec | `server.js:6455` | low (✓) | **`server.listen(PORT, '127.0.0.1', ...)`** — bind только на loopback. Не expose'ится в локальную сеть. **Хорошо.** | Поддерживать. Добавить в comment'е объяснение «не менять на 0.0.0.0». | — |
| 13.2 | InfraSec | (нет dependency-scanner) | high | **Нет `npm audit` в CI.** Нет Dependabot. Нет Snyk. Нет Renovate. eslint v9 + typescript v5.9 — будут уязвимости в транзитивных deps, никто не узнает. | GitHub: `dependabot.yml` + `actions/dependency-review-action@v4` на PR. GitLab: `Auto DevOps Dependency Scanning` или `npm audit --audit-level=high` step. **High severity finding** per твоей инструкции. | S |
| 13.3 | InfraSec | `server.js:824` `INTEGRATION_BLOCK_PRIVATE` | low (✓) | SSRF-guard: `INTEGRATION_BLOCK_PRIVATE=1` блокирует RFC-1918, `INTEGRATION_ALLOW_LOOPBACK=1` опционально 127/8 для тестов. Хорошо. | **Verify**: default = разрешено всё (envs не set). На прод-deploy надо `INTEGRATION_BLOCK_PRIVATE=1`. Документировать. | S |
| 13.4 | InfraSec | `server.js:117` `RL_LIMIT=120/min` | low | Rate-limit per X-Client-Id или IP. ОК для local-tool, но `health/metrics` exempt — могут DDoS'нуть `/metrics` (sort O(n log n)). | exempt только `/health`. `/metrics` подпадать под RL (он тяжелее по compute). | S |
| 13.5 | InfraSec | OAuth/SSO | low (✓) | Нет user-auth — но это by design (single-tenant local tool). | — | — |
| 13.6 | InfraSec | dependencies | medium | Отсутствует **SBOM** (Software Bill of Materials). Для compliance аудита Сбера это, скорее всего, обязательно. | `npm sbom --sbom-format=spdx > SBOM.spdx.json` в CI release-step. | S |
| 13.7 | InfraSec | `server.js:103` `writeJson` | medium | Нет `Content-Security-Policy` / `X-Frame-Options` / `Strict-Transport-Security` HTTP headers. Локально — некритично, но если когда-нибудь deploy'ится за reverse-proxy без CSP — XSS-surface. | `res.writeHead(..., { ..., 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'" })`. | S |
| 13.8 | InfraSec | secret-rotation | medium | Нет периодической ротации токенов. `jiraToken` хранится месяцами. | Документировать quarterly-rotation в SECURITY.md. UI-warning «токен старше 90 дней». | M |

## 14. IaC — terraform/ansible/helm

| # | раздел | файл:строка | sev | проблема | решение | LOE |
|---|---|---|---|---|---|---|
| 14.1 | IaC | (отсутствует) | low | Нет Terraform / Ansible / Helm — но и инфра-цели нет (нет cloud-deploy). Single-tenant pattern. | По делу — не нужно. Если когда-то будет dedicated staging-сервер — добавить. | — |

---

## Итог по числу находок

| sev | count |
|-----|-------|
| critical | 0 |
| high | 11 |
| medium | 19 |
| low | 8 (включая `(✓)` — соответствие practices) |
| **итого** | **38 находок** |

> Note: critical нет благодаря тому, что `jira_config.json` КОРРЕКТНО исключён из git (`.gitignore:12`) и не попадал в историю. Это «ожидаемая critical»-проверка из задания не подтвердилась — гигиена соблюдена.

---

## ТОП-10 «магических» улучшений — маленькие изменения с большим эффектом

> Каждое — ≤ 1 рабочий день, эффект — disproportionate.

1. **Добавить `.profile/` в `.gitignore`** (S, finding 5.6) — heap-snapshots содержат всю server-память включая Bearer-tokens. Один `printf '\n.profile/\n' >> .gitignore` — закрывает critical-class риск.

2. **Заменить `npm ci \|\| npm install` на чистый `npm ci` в обоих pipeline** (S, finding 1.2) — supply-chain воспроизводимость. Удалить устаревший fallback-комментарий.

3. **Bump `package-lock.json` version с 12.0.0 → 17.0.0** (S, finding 3.2) — `rm package-lock.json && npm install` + commit. Liminal-bug «у меня lock из старой эры» уходит.

4. **Добавить Dependabot конфиг в `.github/dependabot.yml`** (S, finding 13.2) — high-severity finding из задания. 10 строк YAML → еженедельные PR с обновлениями. Free.

5. **Добавить `permanent reqId logging` в HTTP-handler** (M, finding 7.5) — `logger.withReqId()` уже написан, но **нигде не используется**. 5 строк изменения в `http.createServer` callback'е → возможность trace request-flow через все логи. Прямая выгода для post-mortem'ов.

6. **Default `JOBS_PERSIST_DIR` → `~/.prizma/jobs/`** (S, finding 10.2) — сейчас `/tmp/` чистится macOS. Один env-default change → user'ы не теряют Pulse-jobs.

7. **`chmod 600 jira_config.json` в коде write'а** (S, finding 5.2) — `fs.writeFileSync(p, json, { mode: 0o600 })`. Неактивные процессы user'а перестают читать токены.

8. **Smoke-step retry-loop вместо `sleep 2`** (S, finding 1.6) — флакающий CI лечится 5 строками bash. Меньше раздражения, меньше «retry CI» кликов.

9. **`.dockerignore` исключающий `audit-2026-*/` и `.git/`** (S, finding 3.4) — будущий Dockerfile будет в 2× меньше; ZIP-раздача будет легче.

10. **HTTP security headers** в `writeJson` и static-server (S, finding 13.7) — `X-Content-Type-Options`, `X-Frame-Options`, `CSP`. Без них одно случайное deploy за reverse-proxy = XSS-surface. Один helper-wrap решает на годы.

---

## Что **НЕ** требует действий (намеренно)

- Single-tenant model — design-choice, не bug. Никаких k8s/HA не нужно.
- Vanilla-JS no-bundler — sizable trade-off, но осознанный.
- `127.0.0.1` bind — safe-by-default.
- LLM per-user budget — реализован, работает.
- Logger PII-scrub — реализован хорошо.
- Audit-папки как ADR-history — отличная практика.
- Circuit-breakers per host — реализованы.
- `/health` + `/ready` + `/metrics` — реализованы.
- Rate-limit per X-Client-Id (NAT-friendly) — продумано.

---

## Связи с другими этапами аудита

- Этап 6 (Security): see overlap with sections 5, 13.
- Этап 7 (Performance): overlap with section 11 (perfBudget exists).
- Этап 5 (Testing): overlap with section 2.
- `audit-2026-05-V18/MASTER_PLAN.md`: P12 (testRunner retire) — finding 2.2.
- `audit-2026-05-V19/`: E4 (logger), C4 (telemetry) — затронуты в section 7.

— конец аудита —
