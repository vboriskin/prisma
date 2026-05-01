# Running (для разработчика)

> Эта инструкция — для разработчика. Для конечного юзера есть `КАК-ЗАПУСТИТЬ.md` в корне.

## Quick start

```bash
git clone <repo>
cd v17_0
npm start         # → http://localhost:8080
```

`npm start` = `node launch.js 8080`. `launch.js` — обёртка которая:
1. Открывает браузер на нужном URL после короткой задержки
2. Запускает `server.js` на указанном порту
3. Перехватывает Ctrl+C и аккуратно выключает сервер

Без обёртки: `node server.js 8080`.

## Для конечного юзера vs разработчика

В корне есть **два разных пути запуска**:

| Файл | Кому | Что делает |
|---|---|---|
| `КАК-ЗАПУСТИТЬ.md` | конечный юзер (PM/team-lead в Сбере) | пошаговая инструкция «двойной клик и работайте» |
| `Запустить (Mac).command` | конечный юзер на macOS | shell-скрипт, проверяет `node`, запускает `start.sh` |
| `Запустить (Windows).bat` | конечный юзер на Windows | bat-скрипт |
| `Разблокировать на Mac.txt` | конечный юзер на Mac | xattr trick для blocked .command |
| `start.sh` | dev / end-user | запускает `node launch.js 8080` |
| `npm start` / `node launch.js` | разработчик | стандартный путь |

Для разработки используй `npm start`. Остальное — для пользователей которым нельзя ставить Node руками.

## Порты

```bash
npm start          # 8080
npm run start:3000 # 3000 (для случая когда 8080 занят)
node server.js 19099   # любой порт (smoke-tests)
```

## Где живёт конфиг

**`jira_config.json`** рядом с `server.js`. Не env, а файл — **сознательно**:

- Токены пишутся через UI («Настройки → Интеграции») → POST `/api/jira/config` → файл
- Frontend локально кэширует через localStorage `q2_integrations_v1`, но source of truth — server-side файл
- Файл создаётся автоматически при первом save из UI

Пример:
```jsonc
{
  "jiraBaseUrl": "https://corp.atlassian.net",
  "jiraToken": "Bearer eyJh...",
  "jiraProjectKeys": "PAY, SBOF, KYC",
  "sigmaJiraBaseUrl": "https://sigma.example.com",
  "sigmaJiraToken": "PAT-...",
  "sigmaGoalEpicKeys": "GOAL-1, GOAL-2",
  "bitbucketBaseUrl": "https://bb.example.com",
  "bitbucketToken": "Bearer ...",
  "bitbucketProjectKeys": "frontend-repo, backend-repo",
  "confluenceBaseUrl": "https://corp.atlassian.net",
  "confluenceToken": "Bearer ...",
  "confluenceSpaceKeys": "DEV, PAY, SBOF",
  "activityWindowHours": 72,
  "allowInsecureTls": false,
  "sinceDate": "2025-01-01"
}
```

**`jira_config.json` в `.gitignore`** — содержит токены, не коммить никогда. Защищён через `.gitignore` (rule `jira_config.json` + `.env*` + `*.pem` + `*.key`).

> На момент V17.2 проект не находится под git-контролем (`.git` отсутствует). При первом `git init` `.gitignore` уже защитит — добавлен превентивно.

## Env-переменные

| Переменная | Default | Где | Зачем |
|---|---|---|---|
| `RATE_LIMIT_PER_MIN` | `60` | `server.js` | Rate-limit на `/api/*`. Контракт-тесты выставляют 500 |
| `PULSE_PK_TIMEOUT_MS` | `90000` | `server.js` | Per-project-key timeout в pulse. На медленной Jira — поднять |
| `JIRA_CONFIG_FILE` | `./jira_config.json` | `server.js` | Override path к конфигу (для multi-instance dev) |
| `PORT` | (не используется) | `server.js` берёт port из argv | — |

Запуск с overrides:
```bash
PULSE_PK_TIMEOUT_MS=180000 RATE_LIMIT_PER_MIN=200 node server.js 8080
```

## Запуск за корп-proxy / TLS-MITM

Если у вас корпоративный сертификат (Сбер MITM-CA или Zscaler) — Node не доверяет ему по умолчанию. Симптом: `verify-jira` возвращает `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

Решение: в UI → Настройки → Интеграции → есть глобальный чек **«Разрешить self-signed TLS»**. Это пишет `cfg.allowInsecureTls = true` в `jira_config.json` → `jiraForward` создаёт `https.Agent({ rejectUnauthorized: false })`.

**Только для dev/корп-сетей.** В production-Jira-Cloud не должно быть нужно.

Альтернатива (через Node):
```bash
NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem npm start
```

## Логи

`server.js` пишет в stdout/stderr:
- `[pulse] PK=PAY ok in 4231ms` — per-PK timing
- `[bd:expand] level 1: 2/3 chunks ok` — Black Dashboard progress
- `[LLM] callGigaChatStream` (group) — для chat
- 4xx/5xx запросы и rate-limit hits

В production оборачиваем `node server.js 8080 > /var/log/sbof-planner.log 2>&1 &`. Логротация — через стандартные `logrotate` / systemd. Никакого app-side rotation нет.

## CI / pre-commit

```bash
npm run ci   # = typecheck + lint + test + e2e + perfBudget
```

Полный гон занимает ~2-3 минуты. Что делает:
1. `tsc --noEmit -p .` — JSDoc + `// @ts-check` в opt-in файлах
2. `eslint . --max-warnings 215` — `215` это **legacy budget**, нельзя добавлять новые warnings
3. `node testRunner.js && npm run test:unit && node contractTest.js` — 534 unit + 11 contract
4. `node e2eTest.js` — 10 e2e (поднимает реальный сервер)
5. `node scripts/perfBudget.js` — проверка размеров ключевых файлов

Pre-commit hook есть только если ты сам поставил (нет `.husky/`). Рекомендуется минимум `npm run typecheck && npm run lint && npm run test:unit` перед коммитом.

## Запуск с альтернативной persistence

```bash
# default — localStorage
npm start

# SQLite-WASM mode (V11) — выбирается в UI: Настройки → Хранилище → SQLite
# никаких env-флагов не нужно, juste сменить radio в UI
```

## Smoke-test после изменений

```bash
node server.js 19099 &
sleep 1
curl -s http://127.0.0.1:19099/health
# {"ok":true,"uptime":..., "pid":..., "now":"..."}
kill %1
```

Health endpoint достаточно простой чтобы быстро проверить «вообще запустился».

## Performance budgets

`scripts/perfBudget.js` проверяет (упрощённо):
- `app.js` < 3000 LOC (сейчас ~2613)
- `server.js` < 3000 LOC (сейчас ~2537)
- `views/gantt.js` < 3000 LOC (сейчас ~2637)
- `styles.css` < 12000 LOC (сейчас ~11000)

Если упёрся — декомпозируй в модули (см. `app/*` как пример) перед добавлением features.

## Что делать если что-то не работает

1. **Сервер не стартует** → `node --check server.js`. Если ok — посмотри stderr (occupied port? broken jira_config.json?)
2. **Frontend не грузится** → F12 → Console. Типичные ловушки:
   - `SyntaxError: Unexpected private name #int. Expected a ';' following a return statement.` = backtick внутри HTML-комментария внутри template literal (V17.2 — реальная). См. [`dont-touch.md`](./dont-touch.md)
   - `state.rows is undefined` — `Storage.restore` не успел; смотри `_reactiveBooted` в `app.js`
3. **Jira возвращает 401** → Settings → Verify Jira → если там 401, токен expired или неверный
4. **Confluence 'не тянутся'** → проверь `confluenceSpaceKeys` (см. UI), Audit log requires admin token
5. **Pulse timeout** → подними `PULSE_PK_TIMEOUT_MS` или уменьши `jiraProjectKeys` count

## Production deploy

Один шаг:
```bash
node server.js 80   # или 443 через nginx-frontend
```

Из репо в production: сегодня ручной `git pull && pm2 restart` (или systemd `Restart=always`). CI ничего не собирает.
