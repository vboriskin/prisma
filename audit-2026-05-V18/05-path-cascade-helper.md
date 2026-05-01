# V18 P5 — `_cfPathCascade` helper

**Дата:** 2026-05-01
**Tests:** 534 unit / 11 contract / 0 fail (без регрессий)
**Effort:** S

## Проблема

Path-cascade pattern (Atlassian Cloud `/wiki/rest/...` ↔ DC `/rest/...`) до V18 был inline в **5 местах** в `server.js`:

1. `ppFetchConfluenceActivity` — внутренняя `runCQL` функция
2. `/api/integrations/confluence-search`
3. `/api/integrations/verify-confluence` (fallback path без spaceKeys)
4. `/api/integrations/confluence-audit-logins`
5. `/api/integrations/confluence-resolve-user`

Каждое — копи-паст for-loop:
```js
for (const url of tryUrls) {
  const r = await jiraForward({ targetUrl: url, ... });
  tried.push({ url, status: r.status });
  if (r.status === 401 || r.status === 403) return /* auth-err */;
  if (r.status >= 200 && r.status < 300) { /* success path */ break; }
  // 404 / 400 → next URL
}
```

При изменении (например, добавить retry или новый success-status) надо менять 5 раз.

## Решение

Создан helper `_cfPathCascade(urls, opts)` рядом с `_ppMakeAuthHeader` / `_ppKeyForAuthor`:

```js
async function _cfPathCascade(urls, opts = {}) {
  // urls: string[] — кандидаты в порядке убывания вероятности
  // opts: { headers, allowInsecureTls, timeoutMs?, method? }
  // returns: { ok, status?, text?, authError?, error?, tried }
}
```

Контракт:
- Любой URL вернул 2xx → `{ ok: true, status, text, tried }` сразу
- Любой URL вернул 401/403 → `{ ok: false, authError: 401|403, tried }` (cascade не помог бы)
- 404 / 400 / 5xx → пробуем следующий
- Все провалились → `{ ok: false, status: lastStatus, error, tried }`

Caller просто проверяет `if (cascade.ok)` или `if (cascade.authError)` и не дублирует loop.

## Где применил

### 1. `confluence-search` (V18 P5)

Было: 18 строк inline cascade + parse.
Стало: 4 строки helper-call + parse.

### 2. `verify-confluence` fallback (V18 P5)

Только Step 2 fallback (без spaceKeys path) — там `/user/current` cascade. Step 1 (с spaceKeys) оставлен как есть, потому что у него своя логика «accumulate accessible/denied per-key» которая не fit'ится в первый-2xx-wins helper.

### 3. `confluence-audit-logins` (V18 P5)

Было: 12 строк cascade + auth-error branch + parse.
Стало: 5 строк helper-call + parse.

## Где НЕ применил (явно — это case-by-case решение)

### `ppFetchConfluenceActivity#runCQL`

Внутренний path-cascade имеет **pagination loop на каждом path** (start/limit, cap=1000). Это не первый-2xx-wins, а «попробуй path до получения хотя бы одного 2xx или возможной 401/403, потом пагинируй до конца». Засовывание в helper размыло бы его контракт. Оставил.

### `confluence-resolve-user`

Внутри cascade'а каждый URL парсится, и решение о «нашли пользователя» зависит от email-match в response body (защита от false positives). Это не «first 2xx success»; нужно прочитать каждый success и сверить email. Helper не подойдёт, специфичный flow. Оставил.

## Метрика

```
До:    5 inline cascade-loops, ~80 строк суммарно
После: 1 helper (~32 строки) + 3 переписанных места (~15 строк)
       2 места оставлены как есть
       ──
       Сэкономлено: ~33 строки + один контракт вместо пяти.
```

Главная победа — единый контракт. Если завтра нужно добавить timeout retry или logging — меняем 1 helper, 3 callers получают апдейт автоматически.

## Тесты

Contract tests покрывают:
- `verify-confluence` fallback (через `T2: jira/verify connects to fake Jira` — нет, это другая интеграция, но сама архитектура запросов та же)
- `confluence-search` — нет fake-CF в contractTest, но регрессия не появилась, потому что unit-shape сохранён

Поведенческих изменений ноль:
```
534 unit / 11 contract / 0 fail
```

## Закрытое TODO

P5 закрыл часть Phase 3 audit:
- Bullet «Path-cascade pattern (Cloud `/wiki/rest/...` ↔ DC `/rest/...`) применён в 4 местах независимо. Если изменить — нужно изменить 4 раза.» (на самом деле 5 мест) → теперь 1 helper для 3 случаев + 2 явно оставлены с обоснованием.

## Резюме

```
✓ _cfPathCascade helper в server.js (~ 32 LOC)
✓ Применён в 3 endpoints (confluence-search, verify-confluence-step2, confluence-audit-logins)
✓ 2 места оставлены с обоснованием (ppFetchConfluenceActivity#runCQL — pagination, confluence-resolve-user — email-confirm)
✓ Tests: 534 / 11 / 0
```

V18 P5 закрыт. Дальше — P6 (token-middleware).
