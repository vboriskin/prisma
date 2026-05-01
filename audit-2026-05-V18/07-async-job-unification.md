# V18 P7 — Pulse async-job pattern

**Дата:** 2026-05-01
**Tests:** 534 unit / 11 contract / 0 fail (без регрессий)
**Effort:** L (~2 часа)

## Проблема

До V18:
- **Pulse** был sync-blocking POST до 10 минут (`fetchPulseData` с `timeoutMs = 600000`).
- **Black Dashboard** уже использовал async-job pattern (`/start` → poll `/status`).

Два разных паттерна для long-running запросов. Sync-blocking имел реальные минусы:
- Один stuck-запрос держит TCP-connection открытым 10 минут
- Юзер не имеет feedback'а, не видит на каком этапе сейчас (Jira / Bitbucket / Confluence / dev-status)
- Network drop посредине = всё с нуля
- Client-timeout установлен в 600s «just in case» — но если действительно > 10 мин (что бывает на slowest corp Jira tier), запрос обрывается без recovery

## Решение

Унифицировал на async-job pattern (как у Black Dashboard).

### Server: новые endpoints

| Endpoint | Метод | Что делает |
|---|---|---|
| `/api/integrations/portfolio-pulse/start` | POST | Создаёт job, запускает фоновое выполнение, возвращает `{jobId}` сразу |
| `/api/integrations/portfolio-pulse/status?jobId=X` | GET | Возвращает текущее состояние: `{status:'running'\|'done'\|'error', phase, result?, error?}` |
| `/api/integrations/portfolio-pulse` | POST | **Сохранён для backward-compat** + contract-тестов |

### Server: рефактор pulse handler

Вынесена ВСЯ логика handler'а (152 строки inline) в `_runPortfolioPulse(body, cfg, tls, onPhase?)`:

- Валидационные ошибки бросают `Error` с `.statusCode = 400`
- На успехе возвращает full response object (`{reports, bitbucket, confluence, ...}`)
- Optional `onPhase(newPhase)` callback для обновления job.phase в async-mode

Sync-handler стал тонкой обёрткой:
```js
if (pathname === '/api/integrations/portfolio-pulse') {
  try {
    const result = await _runPortfolioPulse(body, cfg, tls);
    writeJson(res, 200, result);
  } catch (e) {
    writeJson(res, e.statusCode || 500, { error: e.message });
  }
  return;
}
```

### Server: pulse job-tracker

Скопировал паттерн `_bdJobs` → `_pulseJobs` (отдельная Map с тем же контрактом):
- TTL 30 мин (как у BD)
- MAX 20 одновременных pulse-jobs
- GC по time + max-count при создании нового
- `pulseCreateJob(payload)` / `pulseGetJob(id)` / `pulseRunJob(job, runner)`

**Generic `Jobs` cluster (унификация _bdJobs + _pulseJobs) НЕ выделил** — рефакторинг существующего blackDashboard рисковее чем дублирование (паттерн идентичный, ~30 строк кода). Если когда-нибудь добавим 3-й long-running endpoint — выделим в `server/jobs.js` или отдельный модуль (ещё в backlog для V19+).

### Frontend: автоматический fallback

`integrations/portfolioPulseApi.js` переписан:

1. **Default path (async-job):**
   - POST `/start` → получаем jobId
   - Polling `/status?jobId=X` каждые 2с
   - При `status === 'done'` возвращаем `data.result`
   - При `status === 'error'` бросаем Error
   - `onPhase` callback вызывается на каждый poll → UI может показать прогресс

2. **Auto-fallback на sync:**
   - Если `/start` вернул **404** (старый сервер) → автоматически бьём sync `/portfolio-pulse`
   - Если network-level failure → тоже sync fallback
   - Опция `forceSync: true` — для testing / debugging

3. **Cancel поддержан** через стандартный AbortSignal — если внешний `signal.abort()`, polling прекращается и status остаётся «running» на сервере (job сам завершится через TTL 30 мин).

### Что НЕ сделано (явно)

- **Generic Jobs cluster** (`server/jobs.js` объединяющий `_bdJobs` + `_pulseJobs`) — оставлено для будущей итерации. Сейчас разница в коде минимальна, унификация не оправдывает риск регрессии в blackDashboard.
- **Cancel-endpoint `DELETE /jobs/<id>`** — не нужен пока (abort на клиенте достаточен; jobs сами умирают по TTL). Добавить если появится UI «Отменить запрос».
- **Sync `/portfolio-pulse` retire** — пока нужен contract-тестам (T3, T4, T7 в `tests/contract/integrations.test.js`). Когда тесты переедут на async-job — sync можно удалять. Это отдельный TODO для V18.1.
- **UI progress в Pulse-renderer** — `onPhase` callback пробрасывается через fetchPulseData, но `portfolioPulseRenderer` ещё его не показывает (есть skeleton-loader, без progress). Будет в P9 (app.js decomposition) когда появится `Pulse.setLoadingPhase(text)`.

## Что закрыто из аудита

P7 закрывает Phase 3 audit Bullet **I3** — «Black Dashboard async-job + Pulse sync — разные паттерны для long-running запросов; унификация».

## Тесты

```
534 unit / 11 contract / 0 fail
```

Contract-тесты проходят без изменений — sync-endpoint остался, тестируется как раньше. Async-pattern не покрыт contract-тестом отдельно — добавить в P13 (coverage expansion).

Проведённое ручное тестирование:
- `npm start` → frontend ходит через `/start` + `/status`, успешно получает данные (на test-Jira с 1 issue полный цикл < 1с).
- Принудительный `forceSync: true` → fall-back на sync работает.

## Метрика

```
Backend:
  + ~50 LOC (pulse jobs cluster)
  + ~150 LOC (_runPortfolioPulse helper)
  - ~150 LOC (inline handler)
  + ~30 LOC (новые /start /status routes)

Frontend:
  portfolioPulseApi.js: ~57 → ~110 LOC (теперь содержит polling + fallback)
```

## Резюме

```
✓ /api/integrations/portfolio-pulse/start  (POST)
✓ /api/integrations/portfolio-pulse/status (GET)
✓ /api/integrations/portfolio-pulse        (POST, sync, backward-compat)
✓ _runPortfolioPulse() helper выделен из inline handler
✓ pulse jobs cluster (_pulseJobs + create/get/runJob, TTL 30min, MAX 20)
✓ Frontend: async-job by default + auto-fallback на sync
✓ Tests: 534 / 11 / 0
```

V18 P7 закрыт. Дальше — P8 (BB bucket separation).
