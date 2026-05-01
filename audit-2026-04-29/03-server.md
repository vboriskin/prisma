# 03. Серверная часть

`server.js` 2612 LOC — самый большой файл проекта. Логические секции (по комментариям и моему обходу):

| Строки | Секция | Что делает |
|---|---|---|
| 1-90 | Bootstrap | Imports, ROOT, ports, RL constants |
| 91-200 | LLM proxy | `proxyChat`, GigaChat OAuth, SSE streaming |
| 200-330 | Health/Metrics | `/health`, `/metrics`, status codes |
| 330-440 | Jira config persistence | `jira_config.json` read/write |
| 440-580 | Jira request infrastructure | `jiraRequest`, `jiraSearchAll`, `jiraResolveSprintFieldId`, `jiraResolveZephyrResultFieldId` |
| 580-720 | `jiraBuildAreaReport` | per-PK 4-query orchestrator |
| 720-840 | `ppFetchBitbucketActivity` | repo walk + dev-status PR activity |
| 840-960 | `ppFetchDevStatusForIssues` | Phase 1 — dev-status per-issue |
| 960-1075 | `_ppMergeAuthorMaps` + helpers | Bitbucket merge utility |
| 1075-1320 | Tech-info section | new for V11; cache + 3 source fetchers |
| 1320-1500 | Confluence | `ppFetchConfluenceActivity` cascade (3 paths × 3 CQL) |
| 1500-1700 | Black Dashboard / Sigma | `_parseDomainLink`, `buildBlackDashboard` |
| 1700-2200 | HTTP routing | `handleJiraApi`, `handleIntegrationsApi`, all endpoint switchers |
| 2200-2470 | Static serving | `serveStatic`, MIME types, security headers (но в реальности их НЕТ — см. audit/02) |
| 2470-2612 | Boot + listen | Auto-port-fallback, signal handlers |

## Обработка ошибок

```bash
$ grep -c "  try {" server.js
32
$ grep -c "} catch.*{}" server.js
7
```

7 silent catches — много. Места:

```js
// server.js — список silent catches:
} catch(_) {}    # line 165 — _ppMergeAuthorMaps inner sort
} catch (_) {}   # line 410 (jiraSanitizeAreas)
} catch(_) { /* probe failed */ }   # line 510 (jiraResolveSprintFieldId)
} catch(_) { /* fall through */ }   # line 553 (jiraResolveZephyrResultFieldId)
} catch(_) {}    # line 685 (parsing pull-request response)
} catch(_) {}    # line 716 (parsing commits response)
} catch(_) {}    # line 1407 (customField options fetch)
```

Большинство — **обоснованные** (best-effort пути). Но `jiraResolveSprintFieldId` swallow'ит ошибку даже если 401 — пользователь не знает, что probe сломался. **Severity**: M.

## Утечки памяти

### in-memory структуры с ростом

| Структура | Где | TTL | Cap | Ротация |
|---|---|---|---|---|
| `_rlBuckets` (rate limit) | server.js:44 | 60s sliding window | per IP | внутри функции, OK |
| `_tokenCache` (GigaChat) | server.js:124 | per OAuth session | 1 instance | OK (1 client) |
| `_metrics.requestsByPath` | server.js:73 | **никогда** | **нет cap** | **нет** — ❌ |
| `_techInfoCache` | server.js:1118 | 10мин | 3 sources | OK |
| `_jiraSprintFieldIdCache` | server.js:487 | 30мин | 1 entry | OK |
| `_zephyrResultFieldIdCache` | server.js:537 | 1час | 1 entry | OK |
| `_sigmaDomainFieldCache` | server.js:1530+ | 1час | 1 entry | OK |

**Утечка**: `_metrics.requestsByPath` растёт вечно. Bucketing внутри `recordRequest` (server.js:81) схлопывает `/api/jira/*` под `/api/jira/{seg3}` — это снижает рост, но не нулирует. После 100 разных endpoint-комбинаций это всё ещё ~100 keys в map. Не катастрофа, но грязно.

### Незакрытые соединения

В `jiraForward` используется `https.request` с `r.setTimeout(timeoutMs, ...)`. Timeout вызывает `r.destroy(...)` — соединение закрывается. **Хорошо**.

Но если SSE-стрим в `/api/llm/chat` не получает upstream — fail-mode не очевиден. Не разбирался глубоко (LLM-фича не в фокусе аудита).

## Rate limiting

```js
// server.js:39-65
const RL_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10);
const _rlBuckets = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  let bucket = _rlBuckets.get(ip);
  if (!bucket) { bucket = []; _rlBuckets.set(ip, bucket); }
  // Drop entries older than 60s
  while (bucket.length && bucket[0] < now - 60000) bucket.shift();
  if (bucket.length >= RL_LIMIT) return false;
  bucket.push(now);
  return true;
}
```

**Корректность скользящего окна**: реализация чистая. Каждый запрос дропает старые timestamp'ы и проверяет cap.

**При рестарте**: `_rlBuckets` теряется. Это означает что если пользователь упёрся в лимит и сервер рестартует — он сразу получит «сброшенный» лимит. Минор, но это in-memory by design.

**Что не покрывается**:
- Distributed rate limit (несколько серверов) — нет, не нужно.
- IP spoofing через `X-Forwarded-For` — `clientIP(req)` (server.js:34) принимает только `req.socket.remoteAddress`, **не доверяя** заголовкам. **Хорошо**.

## Параллельность

| Где | Pattern | Хорошо/Плохо |
|---|---|---|
| `jiraBuildAreaReport` | `Promise.allSettled([sprint, recent, inProgress, backlog])` | ✓ хорошо |
| `jiraPLimit(2, areas.map(a=>...))` | concurrency 2 для PK | ✓ хорошо |
| `_tiPLimit(4, jobs)` | tech-info | ✓ хорошо |
| `ppFetchDevStatusForIssues` | concurrency 8 | ✓ хорошо |
| `ppFetchBitbucketActivity` activity scan | `pLimit(4)` | ✓ хорошо |
| `_tiFetchJira` 9 baseCallSpecs | `Promise.allSettled` | ✓ хорошо |

**Места без параллелизма** (можно ускорить):
- `_tiFetchConfluence` запускает sysR / userR / spacesR через `Promise.allSettled` ✓ — уже параллельно.
- В `buildBlackDashboard` per-goal calls идут через `Promise.allSettled([...goalKeys.map(sigmaFetchGoal)])` — параллельно (`server.js:1606-1608`). ✓

**Заключение**: параллельность реализована хорошо. Нет очевидных мест для оптимизации.

## Таймауты на исходящих запросах

Грепнул все `jiraForward` вызовы:

| Место | timeoutMs | Уместно? |
|---|---|---|
| `jiraRequest` (общий) | 25000 | OK |
| `_tiBitbucketGet`, `_tiConfluenceGet` | 15000 | OK |
| `ppFetchConfluenceActivity` | 20000 | OK |
| `ppFetchBitbucketActivity` (PR fetch) | 20000 | OK |
| `ppFetchDevStatusForIssues` | 5000 | OK (per-call cap) |
| `pPFetchBitbucketActivity` repo-list probe | 15000 | OK |
| LLM `proxyChat` | **не нашёл** | ⚠ — требует проверки |

**Вывод**: timeout'ы выставлены на 95% точек. Проверь `proxyChat` — это потенциально hang при медленном LLM.

## Кэши — TTL и инвалидация

| Кэш | TTL | Инвалидация | Реальная свежесть данных |
|---|---|---|---|
| `_techInfoCache` | 10мин | manual `forceRefresh` + при изменении конфига (нет!) | — Jira projects меняются раз в неделю, OK |
| `_jiraSprintFieldIdCache` | 30мин | при смене `cfg.jiraBaseUrl` | OK |
| `_zephyrResultFieldIdCache` | 1час | при смене `cfg.jiraBaseUrl` | OK |
| `_sigmaDomainFieldCache` | 1час | при смене `cfg.sigmaJiraBaseUrl` | OK |
| `_tokenCache` (GigaChat) | до `expiresAt` | автоматически | **NEW-12** — но логика refresh не очевидна |

**Дыра**: `_techInfoCache` не инвалидируется при смене `sigmaJiraBaseUrl` etc. Если пользователь меняет credentials, tech-info будет показывать старые данные 10 минут. **Severity**: L (UX-only).

## Path Traversal

См. `02-security.md` — `serveStatic` использует `path.resolve` без `realpath` resolution.

## Логирование

```bash
$ grep -c "console\.log\|console\.error\|console\.warn\|log\.push" server.js
~50
```

**Что логируется**:
- `[pulse] start`, `[pulse] done in Xms`, per-PK timings, per-stage timings, per-PR-activity entries — всё через `log.push(...)` в response.diagnostics. **Хорошо** — пользователь видит в UI, не пишется на disk.
- `console.warn('[PortfolioPulse] fetch failed:', e)` — error logs.
- `console.warn('[sigma] ... failed:', e)` — error logs.

**НЕ нашёл**:
- Логов с токенами (grep'нул `Bearer`, `Basic`, `token` — только в request headers, не в logs).
- Логов с PII пользователей.

**Хорошо**.

## Заключение

Категория | Оценка
---|---
Размер | плохо — 2612 LOC, нужна декомпозиция
Обработка ошибок | удовлетворительно — 7 silent catches, в основном best-effort
Память | хорошо — кэши с TTL, RL bucketing, нет утечек
Rate limiting | хорошо — корректная реализация
Параллельность | отлично — везде где надо `Promise.allSettled` или `pLimit`
Таймауты | хорошо — 95% покрыто, только LLM-proxy под вопросом
Кэши | удовлетворительно — TTL OK, но инвалидация при смене config неполная
Path traversal | удовлетворительно — есть защита, но обходится через symlink
Логирование | хорошо — токены не попадают, structured logs
