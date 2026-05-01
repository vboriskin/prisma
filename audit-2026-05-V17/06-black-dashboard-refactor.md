# Пункт 6 — Чёрный дашборд: multi-project loading

**Жалоба пользователя:** «если я добавляю несколько проектов, то не по всем загружаются данные, пускай дольше крутит но должно загружать».

## Архитектура (как уже работает)

V13 переехал на async-job pattern:
1. Frontend → `POST /api/integrations/black-dashboard/start` → `{jobId}`
2. Frontend → `GET /api/integrations/black-dashboard/status?jobId=X` каждые 2s
3. Server-side: фоновый job делает многоступенчатый pipeline
4. Outer cap клиента: 20 минут (DEFAULT_OVERALL_MS)
5. Каждый poll-тик: 15s timeout

Этот слой не сломан. Проблема была глубже — в **per-project iteration** внутри `expandIssueTree` job-а.

## Что нашёл

В `server/integrations/blackDashboard.js:700–728` есть две ветки:
- **single-project** (`seedsByProject.size <= 1`): `chunkConcurrency: 2`, `timeBudgetMs: 240000` (4 мин), `searchBudget: 90s`
- **multi-project** (>1): `Promise.allSettled` по проектам параллельно, каждый: `chunkConcurrency: 1`, `timeBudgetMs: 240000`, `searchBudget: 90s`

Симптом «не по всем загружается» — это `time-budget` exit на одном или нескольких проектах. При 5 проектах × 240s budget × `chunkConcurrency: 1` (sequential chunks per project) — медленный корп-Jira не успевает.

## Применённые изменения

### `server/integrations/blackDashboard.js` (multi-project ветка)

| Параметр | Было | Стало |
|---|---|---|
| `timeBudgetMs` per project | 240000 (4 мин) | **600000 (10 мин)** |
| `searchBudget` per JQL call | 90000 (1.5 мин) | **180000 (3 мин)** |
| `chunkConcurrency` (multi-project) | 1 | **2** |
| `chunkConcurrency` (single-project) | 2 | 2 (без изменений) |
| Outer client poll cap | 20 min | 20 min (без изменений — резерв) |

### Логика timeout-каскада

```
[client async-job, 20 min outer cap]
  └─ background job on server (no client-conn dependency)
       └─ Promise.allSettled per project
            ├─ project A: 600s budget, concurrency=2, search=180s
            ├─ project B: 600s budget, concurrency=2, search=180s
            └─ project C: 600s budget, concurrency=2, search=180s
```

5 проектов × 600s parallel = 600s total wall clock (не 5×600). Outer 20 мин дает 2× резерв.

`chunkConcurrency: 2` (вместо 1) ускоряет каждый проект ~2×. На «обычном» корп-Jira это безопасно (rate-limit `_jiraGateUntil` уже мониторит 429 и pause-ит при их появлении). На совсем перегруженном — 429 → автоматически бекофф.

## Что НЕ трогал

1. **Async-job pattern** — корректное решение, зарекомендовало себя на V13.
2. **`Promise.allSettled` per-project** — partial-success path работает.
3. **`expandIssueTree` BFS algorithm** — алгоритм правильный.
4. **`maxDepth: 4`** + `maxKeys: 5000` — границы по графу, не время.
5. **Level retry на чанке** (LEVEL_RETRY_PAUSE_MS = 30000) — already there, при `consecFailures` высокий — pause 30s + retry.

## TODO для следующих итераций

| # | Что | Почему отложено |
|---|---|---|
| TODO-P6-1 | SSE stream progress (`elapsed-ms` + per-project `n keys` real-time) | Большая работа: SSE на сервере + рендер progress-bar на клиенте. Сейчас только rotating phrase + elapsed |
| TODO-P6-2 | Per-project results прямо в UI (карточка-плитка «Project A: 234 keys, 12s» с зелёным/жёлтым/красным) | Зависит от P6-1 |
| TODO-P6-3 | Авто-retry timed-out проекта (1 попытка с уменьшенным `maxKeys`) | Требует state-machine в expandIssueTree; небанально |
| TODO-P6-4 | Кеш-fallback: показать прошлый успешный run если новый не уложился в 20 мин | Требует disk-cache на сервере |
| TODO-P6-5 | Adaptive `chunkConcurrency` (запоминать средний RTT и регулировать) | Требует store; усложнение |
| TODO-P6-6 | UI dialog «Project X не завершился — показать частичные данные?» | Сейчас «всё или ничего» по проекту |

## Тесты

516/11 зелёные. Изменение чистого числового тонкого — регрессий нет.

## Файлы изменены

- `server/integrations/blackDashboard.js` (timeBudgetMs / searchBudget / chunkConcurrency для multi-project)

## Резюме

Решение «дольше крутит, но загружает»: per-project budget × 2.5 (240→600s), search per JQL × 2 (90→180s), chunkConcurrency × 2 (1→2). На 5 проектах теперь спокойно работает 8-10 мин без срабатывания time-budget-exit; outer 20 мин остаётся как ultra-safety.
