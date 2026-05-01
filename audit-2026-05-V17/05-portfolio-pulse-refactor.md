# Пункт 5 — Portfolio Pulse: refactor под таймауты

**Жалоба пользователя:** «таймауты сыпятся постоянно, пускай дольше крутит но должно загружать».

## Анализ

Источник таймаутов — каскад из 4 уровней timeout/budget на разных слоях:

| Слой | Старое | Что регулирует |
|---|---|---|
| Frontend `fetchPulseData(timeoutMs)` | 180000 (3 мин) | Внешний AbortController |
| Per-PK сборка (4 параллельных query) | — | `Promise.allSettled` с per-query `budgetMs` |
| `query.budgetMs` (sprint) | 30000 | Sprint-query внутренний бюджет |
| `query.budgetMs` (recent +changelog) | 30000 | Самая тяжёлая |
| `query.budgetMs` (inProgress) | 25000 | |
| `query.budgetMs` (backlog) | 20000 | |
| `jiraForward` per-call | 25000 | Per-page HTTP timeout |

На медленном корп-Jira с тысячами issues per project любая из 4 query'й могла упереться в `budgetMs` или `jiraForward`-timeout раньше клиентского 180s, и user видел общий fail.

## Применённые изменения

### Frontend — `integrations/portfolioPulse.js`
| Параметр | Было | Стало |
|---|---|---|
| `fetchPulseData(timeoutMs)` | 180000 | **600000 (10 мин)** |

### Backend — `server.js`
| Параметр | Было | Стало |
|---|---|---|
| `query.sprint.budgetMs` | 30000 | **75000** |
| `query.recent.budgetMs` (+changelog) | 30000 | **75000** |
| `query.inProgress.budgetMs` | 25000 | **60000** |
| `query.backlog.budgetMs` | 20000 | **60000** |
| `jiraForward` per-call (используется в `jiraRequest`) | 25000 | **60000** |

## Логика timeout-каскада после фикса

```
[client AbortController 600s — outer ceiling]
  └─ Promise.allSettled (4 sub-queries)
       ├─ sprint:     up to 75s budget; pages × 60s per HTTP call
       ├─ recent:     up to 75s budget; +changelog (heaviest)
       ├─ inProgress: up to 60s budget
       └─ backlog:    up to 60s budget
```

Worst-case: 4 query × 75s = 300s (если бы sequential, а они parallel) → ≪ 600s outer.
Реальный worst-case parallel: max(75s) + ~10s overhead = 85s — комфортно укладывается в 600s ceiling.

## Что НЕ трогал (оставил как есть, оно правильно)

1. `Promise.allSettled` — каждая query независима, partial-success path. Это правильное поведение, **не меняем**.
2. `_jiraGateUntil` (rate-limit gating, 429) — global gate с retry-after. Уже есть (строки 470-474 server.js).
3. `stageTimings` — диагностика per-stage уже течёт обратно к клиенту, рендерится в pp-diagnostics панели.
4. Per-PK дисплей через `analysePulse` — не зависит от сетевого слоя.

## TODO для следующих итераций

| # | Что | Почему отложено |
|---|---|---|
| TODO-P5-1 | Streaming progress: SSE `/api/integrations/portfolio-pulse/stream` с per-stage events «sprint started / sprint:20 issues / recent done» | Большая работа: SSE на сервере + рендер progress на клиенте. Cookbook есть — Black Dashboard тоже это просил |
| TODO-P5-2 | Per-stage retry с уменьшением `cap` (если budget вышел — повторить с cap/2) | Требует state machine в jiraSearchAll. Сейчас один shot |
| TODO-P5-3 | Кеш-fallback: если запрос >5 мин и не вернулся — предложить «показать прошлый снэпшот» | Требует disk-cache на сервере |
| TODO-P5-4 | Adaptive `budgetMs` (телеметрия: запоминать средний ответ Jira за прошлые fetches) | Требует store на сервере |

## Тесты

516/11 зелёные. Регрессий нет — это чистое подкручивание чисел.

## Файлы изменены

- `integrations/portfolioPulse.js` (1 timeoutMs +константа)
- `server.js` (5 budgetMs / timeoutMs)

## Резюме

Решение в духе «дольше крутит, но загружает»: ceiling × 3.3 (180→600s), per-query × 2-3 (20-30→60-75s), per-HTTP × 2.4 (25→60s). User увидит больше patience-ожидания (вместо обрыва), плюс stage-timings в panel «Диагностика» точно покажет какой PK / какая sub-query медленная — это уже было, теперь просто реже срабатывает.
