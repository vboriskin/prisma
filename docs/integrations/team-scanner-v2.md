# Сканнер команд v2.0 — operations & internals

> **Status:** production-graduated в V18.2 (после Sprint 1-3 в V18.1 P7).
> **Subtab:** `/integrations` → «Сканнер команд» (default).
> **Legacy v1:** «📡 Сканнер команд» с `[legacy]` pill — для отката.

Этот документ — operations-reference для:
- тимлидов и PO (как читать сигналы, что значат группы)
- разработчиков (что считается, где, какие пороги, как тестировать)
- DevOps (rate-limits, security, performance budgets)

## 1. Что это и зачем

v2.0 — internal team-monitoring tool, отвечает на 3 вопроса для тимлида утром:
1. Кто застрял?
2. Где риск релиза?
3. Кто перегружен / молчит?

Source data — Jira (changelog, worklog, comments), Bitbucket (PR/commits/reviews), Confluence (page edits/comments), Zephyr (test cases / executions). Те же данные что v1 PortfolioPulse — отличается **визуализация и аналитика**.

## 2. Информационная архитектура (3 уровня)

```
[Уровень 1] team-glance — sticky topbar + 1-2 lines
            «Спринт 12 ▮▮▮▱▱ 60% по плану  /  3 проекта  / ↻ Обновить»
            «5 движется · 2 наблюдение · ▌1 требует разговора · 24/6/9 кмт/PR/CF»
            «▌3 без assignee · 8 out-of-sprint (24%)»

[Уровень 2] per-person rows — группированы по статусу:
            ▌ ТРЕБУЕТ РАЗГОВОРА  [N]      red stripe
              ПОД НАБЛЮДЕНИЕМ  [N]        amber stripe
              ДВИЖЕТСЯ  [N]               green stripe
            ▾ БЕЗ АКТИВНОСТИ  [N]         collapsed by default

[Уровень 3] 72h side-panel — slide-in 480px справа, click по row:
            counters · heatmap 72×4 · filters J/B/C/Z · ▾ Старые задачи · события
```

## 3. Группы участников (classifyPerson)

Pure-function `classifyPerson(p)` в `integrations/teamScanner2Renderer.js`. Возвращает один из 4 значений:

| Группа | Условия |
|---|---|
| **stop** «Требует разговора» | `stuck > 0` И `today === 0` (есть старые задачи без активности сегодня) |
| **watch** «Под наблюдением» | `WIP ≥ 3` ИЛИ (`stuck > 0` И `today > 0`) ИЛИ (`today === 0` И `yesterday > 0`) |
| **moving** «Движется» | есть today ИЛИ есть other-signal (BB/CF/Zephyr/reviews) |
| **idle** «Без активности» | совсем нет signal'ов нигде (today + yest + WIP + stuck + PR + commits + reviews + cf + zephyr — всё 0) |

`stuck` = `p.blockers.length` если P3 enrichment запущен (precise dwell-time), иначе fallback на `p.stale.length` (broad: 7d без update).

**Edge cases:**
- Senior с PR-reviews но 0 commits → `moving` (S1.3 fix).
- Архитектор только в Confluence → `moving`.
- QA только в Zephyr → `moving`.
- Сотрудник в отпуске / без активности → `idle` (collapsed).

## 4. Operational signals (synthesis 7-сигналов)

| # | Сигнал | Где | Status |
|---|---|---|---|
| 1 | Sprint Goal Progress | Topbar gauge: name, %, pace, days left | ✅ |
| 2 | Stuck-list | Side-panel «Старые задачи» details | ✅ |
| 3 | Code Review Aging | Differential dwell (CR > 8ч → blocker) | ✅ |
| 4 | WIP per Person | classifyPerson (≥3 → watch); pure UI counter — backlog | ⚠ |
| 5 | Context-switch Index | Row badge `↻N` при ≥3 переключений / 72ч | ✅ |
| 6 | Out-of-sprint Work | team-glance risk row: «8 out-of-sprint (24%)» | ✅ |
| 7 | Orphan Risks | team-glance risk row: «3 без assignee» | ✅ |

**Score: 6/7 ✅ + 1/7 ⚠** (WIP-counter — P8 backlog).

## 5. Differential dwell thresholds

```js
// integrations/teamScanner2Enrichment.js
DEFAULT_DWELL_THRESHOLDS = {
  codeReview:  8,   // Code Review > 8ч → blocker (зависает на reviewers)
  qa:         16,   // QA / Testing > 16ч
  inProgress: 48,   // In Progress > 48ч (нормальная разработка)
  todo:       72,   // To Do > 72ч в спринте → подвис
  default:    24,   // Все остальные non-terminal
};
```

Lookup — fuzzy lowercase regex по `statusName`:
- Code Review: `/code\s*review|peer\s*review|на\s+ревью|ревью\s+кода/`
- QA: `/\bqa\b|\btest(ing)?\b|тестирован/`
- In Progress: `/in\s*progress|\bworking\b|\bdoing\b|в\s+работе|разработ/`
- TODO: `/\btodo\b|to\s*do|\bopen\b|\bnew\b|открыт|новая/`

Override через `enrichForScanner2(model, raw, { thresholds: {...custom} })` или client config.

В UI блокер показывает `42ч (порог 8ч)` если threshold ≠ default.

## 6. Heatmap 72×4

Layout: 4 строки (Jira / Bitbucket / Confluence / Zephyr) × 72 колонки (часы от now-72ч до now-1ч).

```
J ░░·░░░·▒░░·░·░·░·▒░·░·░░░░·░·...
B ········▒······▒······▒·······...
C ··················▒·········· ...
Z ····················▒······· ...
  −72ч  −48ч  −24ч              сейчас
```

**Density:** opacity 0.10 / 0.35 / 0.60 / 0.85 / 1.0 для 0/1/2/3/4+ events.

**Saturation marker:** клетки с ≥4 events получают `box-shadow: inset 0 0 0 1px accent` — иначе при 200 events/час неотличимо от 4-х.

**Peak cell:** outline 1px accent — самый плотный час за 72ч.

## 7. TZ behavior

**Проблема:** `analysePulse + enrichForScanner2` запускается:
1. На клиенте — browser local TZ через `Date.getHours()`.
2. На сервере (`/employee-detail` drill-down) — server local time, обычно UTC в k8s.

Без TZ-сдвига heatmap съезжает: пик 14:00 МСК показывается в часе 11:00 UTC при server-side drill-down.

**Решение:** клиент капчит `new Date().getTimezoneOffset()` (минуты WEST of UTC; для МСК = -180), передаёт в:
- `enrichForScanner2(model, raw, { tzOffsetMin })` — in-page enrichment
- `fetchEmployeeDetail({ tzOffsetMin, ... })` — body POST `/employee-detail`

Server передаёт offset обратно в `enrichForScanner2`. Cache key включает `tzOffsetMin` — разные TZ → разные cache entries.

`getLocalHour(iso, tzOffsetMin)`:
- Если `tzOffsetMin` is number → `getTime() - offsetMin*60000` → читаем как UTC → корректный hour-of-day в browser TZ.
- Если undefined → fallback на environment-local `Date.getHours()`.

## 8. Server endpoint `/employee-detail`

```
POST /api/integrations/portfolio-pulse/employee-detail
Body: {
  jobId:       string,                 // обязательный, из cached pulse-job
  employeeKey: string,                 // participant.key
  dwellHours?: number,                 // optional, default 24
  tzOffsetMin?: number,                // optional, browser TZ
}

Response 200: {
  employee:   { key, label, email, jiraAccountId, avatar, projects },
  enrichment: { heatmap, contextSwitches, timeline72h, blockers },
  aggregates: { loggedTodaySec, loggedYesterdaySec, ..., badges, issuesNowCount, staleCount },
  meta:       { fromCache, fromResultCache, jobId, builtMs, dwellThresholdHours,
                serverLocalTZ, tzOffsetMin },
}

400: missing jobId / employeeKey
404: unknown jobId (TTL 30мин истёк) or employeeKey not in cached participants
405: GET (POST-only)
409: job.status !== 'done' (running / errored)
429: rate-limit (max 30 req/min per jobId)
500: enrichment failed
```

### Rate-limit

Sliding window 60 sec, max 30 req per `jobId`. После лимита — 429 с `retryAfter: 60` в body.

### Result cache

Key: `${jobId}|${employeeKey}|${dwellHours}|${tzOffsetMin ?? 'srv'}`. TTL 5 мин. Hit → no `analysePulse` re-run, instant response (~1-2мс vs ~200-500мс при miss). GC при размере >100: выкидывается самый старый entry.

## 9. Performance budgets

| Path | Budget | Actual |
|---|---|---|
| Initial pulse fetch (50 чел × 72ч) | ≤ 30s | ~5-15s |
| Client-side enrichment | ≤ 500мс | <100мс |
| Filter-pill click → re-render | ≤ 50мс | ~30мс (S2.4 partial render) |
| Panel open (dashboard click) | ≤ 100мс | ~150мс (full re-render — приемлемо для row click) |
| Server `/employee-detail` cache hit | ≤ 50мс | ~1-5мс |
| Server `/employee-detail` cache miss | ≤ 1s | ~200-500мс |

**Scaling note:** при росте до 200 чел dashboard rows становятся ~9600 SPAN'ов. Виртуализация (IntersectionObserver) — backlog для V19.

## 10. Security & PII

- **`/employee-detail` rate-limit + auth** — corp-network is the perimeter. RBAC между командами — V19+ backlog.
- **Email PII masking** — default «v****@sber.ru», click toggle reveal. Полный email в `data-email-full` attribute (visible через F12 — accepted risk для internal tool).
- **No tokens в response** — server возвращает только enrichment + employee identity. Token leakage grep пройдён clean.
- **CSRF** — endpoint POST принимает JSON. CORP network → low priority. Add при первом ext-deploy.

## 11. Тесты

- **`tests/unit/teamScanner2Classifier.test.js`** (20 тестов) — classifyPerson edge cases.
- **`tests/unit/teamScanner2Enrichment.test.js`** (~50 тестов) — heatmap, context-switches, timeline, blockers, sprint-goal, risks, TZ-aware, differential dwell.
- **`tests/unit/teamScanner2Renderer.test.js`** (17 тестов) — render output structure, peak/saturation marks, filter behavior, sprint gauge, risk shelf, HR-language.
- **`tests/unit/teamScanner2Lifecycle.test.js`** (5 тестов) — unmount, escHandler cleanup, subtab switch.
- **`tests/contract/integrations.test.js`** (4 теста для employee-detail) — 400/404/405/429/200 happy path.

**Total: 645 unit + 18 contract / 0 fail.**

## 12. WCAG AA compliance

| WCAG | Что | Status |
|---|---|---|
| 1.1.1 Non-text Content | heatmap `role="img"` + summary `aria-label` | ✅ |
| 1.3.1 Info & Relationships | `aria-controls` rows ↔ panel; `aria-labelledby` dialog | ✅ |
| 2.1.1 Keyboard | Enter/Space на rows | ✅ |
| 2.4.3 Focus Order | open→panel.focus(), close→row.focus() | ✅ |
| 2.4.7 Focus Visible | `:focus-visible` outline на всех interactive elements | ✅ |
| 4.1.2 Name/Role/Value | `aria-modal`, `aria-pressed` filter pills, `aria-label` close-btn | ✅ |
| 4.1.3 Status Messages | `aria-live="polite"` для panel open/close announcements | ✅ |

Audit: manual `axe` DevTools на `/integrations` — 0 violations при последнем прогоне.

## 13. Архитектура

```
                 ┌──────────────────────────────────────┐
                 │ Browser                              │
                 │                                      │
    [/integrations] → IntegrationsView → subtab=scanner2
                                ↓
                 ┌─ teamScanner2.js (orchestrator)
                 │   - render(container) lifecycle
                 │   - cache: _model, _jobId, _detailCache, _expandedKey
                 │   - unmount() при subtab leave
                 ↓
        fetchPulseData() → POST /pulse/start (server)
                                ↓
        analysePulse(raw) — общий с v1
                                ↓
        enrichForScanner2(model, raw, opts)  ← v2-only
                  ↓ produces:
                  - p.heatmap72x4
                  - p.contextSwitches
                  - p.blockers (with thresholdHours)
                  - p.timeline72h (4-source unified)
                  - model.scannerV2.{ sprintGoal, risks, ... }
                                ↓
        teamScanner2Renderer.js — Spine-pill HTML
                                ↓
        Слой 1+2: dashboard (full re-render при row-click)
        Слой 3: side-panel (partial re-render при filter-click)
                                ↓
        TeamScanner2.fetchDetail(employeeKey) →
                          POST /pulse/employee-detail
                          → server cache hit / re-enrich
                 │
                 └──────────────────────────────────────┘
```

## 14. Известные ограничения

| Ограничение | Воркэраунд / план |
|---|---|
| WIP-per-person не выведен числом в UI | P8 backlog — Manager finding |
| Нет тренда «спринт N vs N-1» | V19 backlog — нужен persistent storage |
| Нет RBAC между командами | V19 backlog — corp perimeter защищает |
| Email доступен через F12 inspect | Accepted risk для internal tool |
| Heatmap 72×4 при 200+ чел = 9600 SPAN'ов | V19 — virtualization (IntersectionObserver) |
| Sprint Goal SP-fields не считаются | Fallback на count(done)/count(total). PO попросит — добавим в P8. |

## 15. Rollback procedure

См. `audit-2026-05-V18/scanner2-graduation.md` § Rollback.

## 16. Историческая справка

- V18.1 P1-P6 — initial implementation (subtab, classifier, enrichment, server endpoint, side-panel, graduate).
- V18.1 P7 — pre-release audit + 3 sprints fixing all P0/P1 findings.
- V18.2 — production graduate.

Pull-history: `git log --oneline --grep "scanner2"` показывает все 25+ commits.
