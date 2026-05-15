# Jenkins integration

Phase 1+2+3 (2026-05-10) — выгрузка builds из Jenkins folder, attribution
по сотрудникам, UI-индикаторы (J-chip / per-row source-chip / cross-team tile)
+ Auto-Resolve `jenkinsUserName` через cascade.

## Что собираем

- Список jobs из folder (`cfg.jenkinsFolder`, default `sbof`)
- Последние 30 builds на каждый job (parallelism 8, timeout 6с)
- Per-author counts (48ч / 7д) через `culprits[].fullName` + `actions[].causes[].userName`

## Server endpoints

- `GET /api/integrations/jenkins-verify` — проверка соединения, status, x-jenkins header (Phase 1.5 audit pre-2026)
- `POST /api/integrations/jenkins-scan` — реальная выгрузка builds (Phase 1, 2026-05-10)

Обе ручки проксируют через `_jiraForward` (с `allowInsecureTls` для корп-proxy)
и используют Basic/Bearer auth (server detects scheme по наличию `:` в token).

## Identity-mapping

- На server-side aggregation: `jobBuild.culprits[].fullName` (приоритет) → fallback `jobBuild.actions[].causes[].userName`
- На client-side attribution: точное name-match по нормализованному `participant.label / fullName / displayName / name / email` × `model.jenkins.perAuthor` keys (lowercase, trim, whitespace-collapse)
- Auto-Resolve: cascade `/asynchPeople/api/json` → fallback `/user/{email-prefix}/api/json` → запись в `state.employees[].jenkinsUserName`

Identity-deterministic per [CLAUDE.md контракт #2](../../CLAUDE.md) — никаких fuzzy-match'ей, substring не считается совпадением.

## Schema `model.jenkins`

```
{
  fetchedAt: '2026-05-10T...',
  folder: 'sbof',
  totalJobs: 47, scannedJobs: 47,
  perJob: [{
    name, url, color,
    lastBuild: { n, result, ts, durationMs },
    healthScore,
    builds7d, failures7d, successes7d,
    abortRate, avgDurationSec,
    lastFailure: { n, ts, url } | null,
  }],
  perAuthor: {
    '<displayName>': { builds7d, failures7d, builds48h, failures48h, lastBuildAt }
  },
  summary: {
    totalBuilds7d, failures7d, failureRatePct,
    deployFreqPer7d, mttrHours,
  },
  errors: [{ scope, message }],
  elapsedMs: N,
}
```

Pure aggregation — `_aggregateJenkinsBuilds()` в `server/jenkins.js`. Не делает
HTTP, не читает env. Покрыто `tests/unit/jenkinsAggregation.test.js` (19 тестов).

## Где видно в UI

- **Person modal** — J chip с tooltip-формулой (`renderPersonMetricsPanel` в `integrations/teamScanner2Renderer.js`)
- **Per-row** — source-chip `J<N>` рядом с Bitbucket (`B<N>`) / Confluence (`C<N>`) / Zephyr (`Z<N>`); Information accent `#2563eb`
- **Глубже / +Все (multi-view)** — cross-team tile «Jenkins активность»: failure rate / deploy freq / MTTR / Top-5 failed jobs с links
- **Diagnostic-modal** — секция JENKINS с status pill + KV-rows (folder, last-fetch, jobs, builds 7д, failure-rate, authors, deploy/7д, MTTR, errors)

## Failure-rate тиры (cross-team tile)

| failureRatePct | class           | визуал |
|----------------|-----------------|--------|
| < 10%          | `ts2-sd-good`   | зелёный |
| 10-19.9%       | `ts2-sd-mid`    | жёлтый |
| ≥ 20%          | `ts2-sd-bad`    | красный |

## Troubleshooting

### J chip всегда показывает 0

- Проверить `cfg.jenkinsBaseUrl` и `cfg.jenkinsToken` в настройках интеграций
- Проверить что `cfg.jenkinsFolder` указывает на правильный folder (default `sbof`)
- В Diagnostic-modal → JENKINS section смотри `errors[]`

### `/api/integrations/jenkins-scan` падает 401

- Token истёк или отозван
- Сменить тип scheme (Basic vs Bearer) — server detects по наличию `:` в token
- Создать новый API token в Jenkins UI: People → ваш юзер → Configure → API Token → Add new Token
- Использовать формат `username:apiToken`

### `/api/integrations/jenkins-scan` падает 302

- SSO-redirect — token похож на cookie, не API-token
- В Jenkins → User → Configure → API token → создать новый
- Положить в настройки интеграций
- Если в errors[] видишь `Suspected SSO redirect — token may be cookie not API token` — значит ssoRedirectCount ≥ 2 в одном scan

### authorsCount > 0 но attributedCount маленький

- Identity gap — Jenkins fullName не совпадает с `state.employees[].fio`
- Bulk Auto-Resolve в Diagnostic-modal попробует найти `jenkinsUserName` через cascade
- Проверить что email в реестре сотрудников валидный (используется для fallback `/user/{email-prefix}`)

### MTTR proxy — что это

- Среднее время между FAILURE-build и следующим SUCCESS на том же job
- Не учитывает manual recovery (когда merge fix-а сделан без перезапуска job)
- Сравнимо с DORA MTTR только если каждый failure → re-deploy

### Deploy frequency

- Подсчёт jobs с `-deploy` в имени, завершившихся SUCCESS, за 7 дней
- Если у вас другой naming convention (например `release-` prefix) — нужно изменить `_aggregateJenkinsBuilds` в `server/jenkins.js`

## Phase 1 / 2 / 3 — что когда

- **Phase 1 (2026-05-10)** — server scan, person-card chip, diag section
- **Phase 2 (2026-05-10)** — per-row chip, cross-team tile, Auto-Resolve `jenkinsUserName`
- **Phase 3 (2026-05-10)** — render unit-тесты (`tests/unit/jenkinsRender.test.js`, 37 тестов), эта документация

## Limits

- topN jobs scanned = 50 (cap в server)
- Last 30 builds на job
- Cache TTL 5 минут (in-memory `Map` per-folder, очищается на restart)
- Concurrency 8 (per-job parallel fetch)
- Per-job timeout 6с
- Никаких фактических данных от builds кроме number / result / timestamp / duration / url + author info — никаких build artifacts, console output, build params (security/scope)

## Caveats

- `_loadJenkinsPeople` cache в `server/integrations-api.js` — per-request scope (создаётся внутри handler'а на каждый bulk-resolve запрос). Если нужно ускорить серию вызовов — TODO: вынести в module-scope с TTL.
- Cross-team tile показан только в multi-view (`scope='multi'` или undefined без team filter). В team-view скрыт намеренно — Jenkins folder shared на всю platform, per-team разрез бессмысленен.
- Per-row J<N> chip окно — 48ч (короче чем у BB/CF/Z 72ч), потому что builds обычно daily — более частая каденция.

## Тесты

```
tests/unit/jenkinsAggregation.test.js                  19 (Phase 1+2 aggregation)
tests/unit/jenkinsRender.test.js                       37 (Phase 3 render-логика)
tests/unit/integrationsSync-mapResolveResult.test.js    4 (Jenkins shape)
```

При изменении render-кода — синхронизировать `tests/unit/jenkinsRender.test.js`
(там pure-replica логики через комментарии «Phase-1 Jenkins MVP», «Phase-2 Jenkins»).
